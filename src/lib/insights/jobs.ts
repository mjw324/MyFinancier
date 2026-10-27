import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { insightCandidates } from "@/lib/db/schema/insights";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { isAiEnabled } from "@/lib/ai/models";
import { hasBudgetRemaining } from "@/lib/ai/usage";
import { sendEmail } from "@/lib/email/send";
import { digestEmailTemplate } from "@/lib/email/templates/digest";
import { logError } from "@/lib/logging";
import { listOpenCandidates, refreshCandidates, userTodayFor } from "./candidates";
import { generateDigest, type RenderedItem } from "./digest";

/**
 * Weekly digest job. Same shape as the Plaid sync job (src/lib/plaid/jobs.ts):
 * the user's `user_preferences` row is a one-row job record.
 *
 * - Due: `digest_due_at <= now()`, set a week ahead after every run (and to
 *   "now" when the user opts in).
 * - Lease: `digest_lease_until`, claimed by ONE atomic UPDATE … RETURNING;
 *   the claimed value is the fencing token for the release. An expired lease
 *   means a run died mid-way and the sweep may claim it again.
 * - Gates, every run: AI_ENABLED, the user's opt-in (in the claim), and the
 *   monthly AI budget. Nothing clearing the threshold means no model call.
 */

const LEASE_SQL = sql`date_trunc('milliseconds', now()) + interval '10 minutes'`;
const WEEK_SQL = sql`now() + interval '7 days'`;
const RETRY_SQL = sql`now() + interval '6 hours'`;
const SWEEP_BATCH = 25;

const dueSql = and(
  eq(userPreferences.aiOptIn, true),
  lte(userPreferences.digestDueAt, sql`now()`),
  or(isNull(userPreferences.digestLeaseUntil), lt(userPreferences.digestLeaseUntil, sql`now()`)),
);

async function claimDigest(userId: string): Promise<string | null> {
  const [row] = await db
    .update(userPreferences)
    .set({ digestLeaseUntil: LEASE_SQL })
    .where(and(eq(userPreferences.userId, userId), dueSql))
    .returning({ token: sql<string>`${userPreferences.digestLeaseUntil}::text` });
  return row?.token ?? null;
}

async function releaseDigest(userId: string, token: string, next: "week" | "retry"): Promise<void> {
  await db
    .update(userPreferences)
    .set({
      digestLeaseUntil: null,
      digestDueAt: next === "week" ? WEEK_SQL : RETRY_SQL,
      ...(next === "week" ? { lastDigestAt: sql`now()` } : {}),
    })
    .where(
      and(
        eq(userPreferences.userId, userId),
        sql`${userPreferences.digestLeaseUntil} = ${token}::text::timestamp`,
      ),
    );
}

export type DigestRunResult =
  | { status: "disabled" } // AI_ENABLED is off
  | { status: "skipped" } // not due, not opted in, or another worker holds it
  | { status: "over_budget" }
  | { status: "nothing" } // no candidate cleared the threshold; no model call
  | { status: "failed" }
  | { status: "sent"; items: number; emailed: boolean };

async function storeDigest(userId: string, items: RenderedItem[], now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [rank, item] of items.entries()) {
      await tx
        .update(insightCandidates)
        .set({ digestAt: now, digestRank: rank, title: item.title, body: item.body, shownAt: now })
        .where(and(eq(insightCandidates.id, item.candidateId), eq(insightCandidates.userId, userId)));
    }
  });
}

async function emailDigest(userId: string, items: RenderedItem[]): Promise<boolean> {
  const [row] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row?.email || !row.verified) return false;
  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  try {
    await sendEmail({
      to: row.email,
      subject: "Your week in money",
      html: digestEmailTemplate({ items, dashboardUrl: `${base}/dashboard`, settingsUrl: `${base}/settings` }),
    });
    return true;
  } catch (error) {
    // The in-app digest is already stored; email is best effort.
    logError("digest.email_failed", error, { userId });
    return false;
  }
}

/** Run one user's digest if it is due. Safe to call concurrently. */
export async function runDigest(
  userId: string,
  { model, now = new Date() }: { model?: LanguageModel; now?: Date } = {},
): Promise<DigestRunResult> {
  if (!isAiEnabled()) return { status: "disabled" };
  const token = await claimDigest(userId);
  if (!token) return { status: "skipped" };

  try {
    if (!(await hasBudgetRemaining(userId, now))) {
      await releaseDigest(userId, token, "week");
      return { status: "over_budget" };
    }
    await refreshCandidates(userId, await userTodayFor(userId, now), now);
    const open = await listOpenCandidates(userId, now);
    const result = await generateDigest({ userId, candidates: open, model });
    if (result.status !== "ok") {
      await releaseDigest(userId, token, "week");
      return { status: result.status };
    }
    await storeDigest(userId, result.items, now);
    const emailed = await emailDigest(userId, result.items);
    await releaseDigest(userId, token, "week");
    console.log(`[digest] ${JSON.stringify({ user: userId.slice(0, 8), items: result.items.length, fromTemplate: result.items.filter((i) => i.fromTemplate).length, emailed })}`);
    return { status: "sent", items: result.items.length, emailed };
  } catch (error) {
    logError("digest.failed", error, { userId });
    await releaseDigest(userId, token, "retry").catch(() => null);
    return { status: "failed" };
  }
}

/**
 * Recovery sweep (instrumentation.ts): runs every due digest, including ones
 * whose lease expired mid-run. Sequential, a batch per tick.
 */
export async function sweepDigests(): Promise<{ ran: number }> {
  if (!isAiEnabled()) return { ran: 0 };
  const due = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(dueSql)
    .orderBy(userPreferences.digestDueAt)
    .limit(SWEEP_BATCH);
  let ran = 0;
  for (const { userId } of due) {
    const res = await runDigest(userId);
    if (res.status !== "skipped") ran++;
  }
  return { ran };
}

/** The ids belong to the user; used by the dashboard's Server Actions. */
export async function setCandidateFeedback(
  userId: string,
  ids: string[],
  patch: { helpful?: boolean; dismiss?: boolean },
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(insightCandidates)
    .set({
      ...(patch.helpful !== undefined ? { helpful: patch.helpful } : {}),
      ...(patch.dismiss ? { dismissedAt: new Date() } : {}),
    })
    .where(and(eq(insightCandidates.userId, userId), inArray(insightCandidates.id, ids)))
    .returning({ id: insightCandidates.id });
  return rows.length;
}
