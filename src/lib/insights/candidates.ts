import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { insightCandidates, type InsightCandidateRow } from "@/lib/db/schema/insights";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import {
  getMonthlyBucketTotals,
  getPace,
  getSpendingByBucket,
  periodScope,
} from "@/lib/analytics/metrics";
import { monthKeys, seriesByBucket } from "@/lib/analytics/trends";
import { utcAddDays, utcStartOfMonth } from "@/lib/analytics/periods";
import { getBudgetProgress } from "@/lib/db/queries/budgets";
import { listRecurringStreams } from "@/lib/db/queries/recurring";
import { loadForecastInput } from "@/lib/forecast/context";
import { computeSafeToSpend } from "@/lib/forecast/safe-to-spend";
import { calendarDateInTimeZone, isValidTimeZone } from "@/lib/utils/time-zone";
import { logError } from "@/lib/logging";
import { detectCandidates, type DetectorInputs } from "./detectors";
import type { Candidate } from "./types";

/** The user's calendar date from their saved zone (no request, so no cookie). */
export async function userTodayFor(userId: string, now: Date = new Date()): Promise<Date> {
  const [row] = await db
    .select({ timeZone: userPreferences.timeZone })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return calendarDateInTimeZone(now, isValidTimeZone(row?.timeZone) ? row.timeZone : "UTC");
}

/**
 * Everything the detectors read, from the same query functions as the
 * dashboard: seven complete months of bucket totals, this month to date,
 * pace, outflow streams, budget progress and safe-to-spend.
 */
export async function loadDetectorInputs(userId: string, today: Date): Promise<DetectorInputs> {
  const monthStart = utcStartOfMonth(today);
  const historyStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 7, 1));
  const months = monthKeys(historyStart, monthStart);

  const [history, current, pace, streams, budgets, safe] = await Promise.all([
    getMonthlyBucketTotals(periodScope(userId, { start: historyStart, end: monthStart })),
    getSpendingByBucket(periodScope(userId, { start: monthStart, end: utcAddDays(today, 1) })),
    getPace(userId, today),
    listRecurringStreams(userId, { flowType: "outflow" }),
    getBudgetProgress(userId, today),
    // Safe-to-spend is one finding among many; its failure must not sink the rest.
    loadForecastInput(userId, today)
      .then(computeSafeToSpend)
      .catch((error) => {
        logError("insights.safe_to_spend_failed", error, { userId });
        return null;
      }),
  ]);

  return {
    userId,
    today,
    currentBuckets: new Map(current.buckets.map((b) => [b.bucket, b.net])),
    series: seriesByBucket(history, months),
    months,
    pace,
    streams: streams.map((s) => ({
      streamId: s.streamId,
      flowType: s.flowType,
      status: s.status,
      isActive: s.isActive,
      frequency: s.frequency,
      description: s.description,
      merchantName: s.merchantName,
      customName: s.customName,
      pfcPrimary: s.pfcPrimary,
      firstDate: s.firstDate,
      predictedNextDate: s.predictedNextDate,
      averageAmount: Number(s.averageAmount),
      lastAmount: Number(s.lastAmount),
    })),
    budgets: budgets.map((b) => ({
      budgetId: b.budgetId,
      categoryKey: b.categoryKey,
      categoryLabel: b.categoryLabel,
      budgeted: b.budgeted,
      spent: b.spent,
      window: b.window,
    })),
    safeToSpend: safe
      ? {
          safeToSpendCents: safe.safeToSpendCents,
          billsCents: safe.billsCents + safe.cardObligationsCents,
          through: safe.through,
        }
      : null,
  };
}

/**
 * Store freshly detected candidates. A finding seen before keeps its digest
 * text and the user's dismiss/helpful answer; its figures are refreshed.
 */
export async function saveCandidates(userId: string, candidates: Candidate[], now: Date = new Date()): Promise<void> {
  if (candidates.length === 0) return;
  await db
    .insert(insightCandidates)
    .values(candidates.map((c) => ({ userId, ...c, detectedAt: now })))
    .onConflictDoUpdate({
      target: [insightCandidates.userId, insightCandidates.fingerprint],
      set: {
        severity: sql`excluded.severity`,
        score: sql`excluded.score`,
        payload: sql`excluded.payload`,
        expiresAt: sql`excluded.expires_at`,
        detectedAt: sql`excluded.detected_at`,
      },
      // Figures already narrated in a digest stay as they were shown.
      setWhere: isNull(insightCandidates.digestAt),
    });
}

export async function refreshCandidates(userId: string, today: Date, now: Date = new Date()): Promise<Candidate[]> {
  const candidates = detectCandidates(await loadDetectorInputs(userId, today));
  await saveCandidates(userId, candidates, now);
  return candidates;
}

/** Live candidates not yet used in a digest and not dismissed. */
export async function listOpenCandidates(userId: string, now: Date = new Date()): Promise<InsightCandidateRow[]> {
  return db
    .select()
    .from(insightCandidates)
    .where(
      and(
        eq(insightCandidates.userId, userId),
        isNull(insightCandidates.digestAt),
        isNull(insightCandidates.dismissedAt),
        gt(insightCandidates.expiresAt, now),
      ),
    );
}

/** The latest digest's items for the dashboard card. */
export async function getLatestDigest(userId: string, now: Date = new Date()): Promise<InsightCandidateRow[]> {
  const [latest] = await db
    .select({ at: insightCandidates.digestAt })
    .from(insightCandidates)
    .where(and(eq(insightCandidates.userId, userId), isNotNull(insightCandidates.digestAt)))
    .orderBy(desc(insightCandidates.digestAt))
    .limit(1);
  if (!latest?.at) return [];
  return db
    .select()
    .from(insightCandidates)
    .where(
      and(
        eq(insightCandidates.userId, userId),
        eq(insightCandidates.digestAt, latest.at),
        isNull(insightCandidates.dismissedAt),
        gt(insightCandidates.expiresAt, now),
      ),
    )
    .orderBy(insightCandidates.digestRank);
}
