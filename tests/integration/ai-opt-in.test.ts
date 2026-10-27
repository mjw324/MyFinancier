import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { makeUser } from "../setup/factories";
import { user } from "@/lib/db/schema/auth";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { insightCandidates } from "@/lib/db/schema/insights";

const ctx = vi.hoisted(() => ({ userId: "user_a" as string | null }));
vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => (ctx.userId ? { user: { id: ctx.userId } } : null)),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateAiOptInAction } from "@/app/(routes)/(dashboard)/settings/ai-actions";
import { insightFeedbackAction } from "@/app/(routes)/(dashboard)/dashboard/insight-actions";
import { AI_CONSENT_VERSION, isAiActiveForUser } from "@/lib/ai/consent";

const prefs = async () =>
  (await getTestDb().select().from(userPreferences).where(eq(userPreferences.userId, "user_a")))[0];

beforeEach(async () => {
  ctx.userId = "user_a";
  await getTestDb().insert(user).values([makeUser({ id: "user_a" }), makeUser({ id: "user_b" })]);
});
afterEach(() => vi.unstubAllEnvs());

describe("AI opt-in", () => {
  it("is off by default, and on only with opt-in AND AI_ENABLED", async () => {
    vi.stubEnv("AI_ENABLED", "true");
    expect(await isAiActiveForUser("user_a")).toBe(false);

    expect(await updateAiOptInAction(true)).toEqual({ success: true, data: { optIn: true } });
    const p = await prefs();
    expect(p.aiOptIn).toBe(true);
    expect(p.aiConsentVersion).toBe(AI_CONSENT_VERSION);
    expect(p.aiConsentAt).not.toBeNull();
    expect(p.digestDueAt).not.toBeNull();
    expect(await isAiActiveForUser("user_a")).toBe(true);

    vi.stubEnv("AI_ENABLED", "false");
    expect(await isAiActiveForUser("user_a")).toBe(false);
  });

  it("stops the digest job on opt-out", async () => {
    await updateAiOptInAction(true);
    await updateAiOptInAction(false);
    const p = await prefs();
    expect(p.aiOptIn).toBe(false);
    expect(p.digestDueAt).toBeNull();
  });

  it("rejects bad input and signed-out callers", async () => {
    expect(await updateAiOptInAction("yes" as unknown as boolean)).toEqual({ success: false, error: "Invalid choice" });
    ctx.userId = null;
    expect(await updateAiOptInAction(true)).toEqual({ success: false, error: "Unauthorized" });
  });
});

describe("digest feedback action", () => {
  async function candidate(userId: string) {
    const [row] = await getTestDb()
      .insert(insightCandidates)
      .values({
        userId,
        type: "bill_due",
        severity: "low",
        score: 55,
        fingerprint: `bill_due:${userId}`,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        payload: { subject: "s", facts: {}, template: { title: "t", body: "b" } },
      })
      .returning({ id: insightCandidates.id });
    return row.id;
  }

  it("records helpful and dismiss on the caller's own item only", async () => {
    const mine = await candidate("user_a");
    const theirs = await candidate("user_b");
    expect(await insightFeedbackAction({ id: mine, action: "not_helpful" })).toEqual({ success: true, data: null });
    expect(await insightFeedbackAction({ id: mine, action: "dismiss" })).toEqual({ success: true, data: null });
    expect((await insightFeedbackAction({ id: theirs, action: "dismiss" })).success).toBe(false);
    expect((await insightFeedbackAction({ id: mine, action: "delete" as "dismiss" })).success).toBe(false);

    const rows = await getTestDb().select().from(insightCandidates);
    const a = rows.find((r) => r.id === mine)!;
    const b = rows.find((r) => r.id === theirs)!;
    expect(a.helpful).toBe(false);
    expect(a.dismissedAt).not.toBeNull();
    expect(b.dismissedAt).toBeNull();
  });
});
