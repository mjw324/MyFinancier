/**
 * Dashboard loaders. Server-only (imported by server components).
 *
 * Each loader is wrapped in React `cache` so widgets that need the same figure
 * (the cash-flow card and the insight list both need the period's cash flow)
 * share one query per request. Arguments are strings because `cache` compares
 * arguments by identity.
 *
 * `settle` turns a failure into a value: a widget whose query fails renders a
 * degraded card instead of taking the whole page down.
 */

import { cache } from "react";
import { isAiActiveForUser } from "@/lib/ai/consent";
import {
  getCashFlow,
  getDailySpending,
  getFixedVsVariable,
  getIncomeCadence,
  getMonthlyBucketTotals,
  getPace,
  getPreviousCashFlow,
  getSpendingByBucket,
  getTopMerchants,
  periodScope,
} from "@/lib/analytics/metrics";
import { getBalanceSummary } from "@/lib/db/queries/accounts";
import { getRecentTransactions } from "@/lib/db/queries/overview";
import { getUserPreferences } from "@/lib/db/queries/user-preferences";
import { logError } from "@/lib/logging";
import { utcAddDays, utcStartOfMonth, type Period } from "@/lib/analytics/periods";
import {
  DASHBOARD_PERIOD_LABELS,
  parseDateParam,
  periodToRange,
  resolveDashboardPeriod,
  toDateParam,
  type DashboardPeriodKey,
} from "@/lib/utils/date-ranges";

export type Settled<T> = { ok: true; value: T } | { ok: false };

export async function settle<T>(
  widget: string,
  userId: string,
  load: () => Promise<T>,
): Promise<Settled<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (err) {
    logError("dashboard.widget_failed", err, { widget, userId });
    return { ok: false };
  }
}

/** Everything a widget needs to know about the selected period. */
export interface DashboardContext {
  userId: string;
  key: DashboardPeriodKey;
  /** The viewer's calendar date, YYYY-MM-DD. */
  today: string;
}

export function resolveContext(ctx: DashboardContext) {
  const today = parseDateParam(ctx.today)!;
  const period = resolveDashboardPeriod(ctx.key, today);
  return {
    today,
    period,
    range: periodToRange(period),
    when: periodPhrase(ctx.key, period),
    /** Exclusive end of data that can exist: tomorrow. */
    through: utcAddDays(today, 1),
  };
}

/** "so far this month", "in September 2026", "in the last 30 days", ... */
export function periodPhrase(key: DashboardPeriodKey, period: Period): string {
  switch (key) {
    case "month":
      return "so far this month";
    case "last-month":
      return `in ${period.label}`;
    case "30d":
      return "in the last 30 days";
    case "ytd":
      return "so far this year";
  }
}

export function periodTitle(key: DashboardPeriodKey, period: Period): string {
  const base = key === "30d" || key === "ytd" ? DASHBOARD_PERIOD_LABELS[key] : period.label;
  return period.isPartial && key === "month"
    ? `${base} · day ${period.elapsedDays} of ${period.totalDays}`
    : base;
}

const scope = (userId: string, start: string, end: string) =>
  periodScope(userId, { start: parseDateParam(start)!, end: parseDateParam(end)! });

export const loadCashFlow = cache((userId: string, start: string, end: string) =>
  getCashFlow(scope(userId, start, end)),
);

export const loadBuckets = cache((userId: string, start: string, end: string) =>
  getSpendingByBucket(scope(userId, start, end)),
);

export const loadMerchants = cache((userId: string, start: string, end: string) =>
  getTopMerchants(scope(userId, start, end), 8),
);

export const loadFixedVsVariable = cache((userId: string, start: string, end: string) =>
  getFixedVsVariable(scope(userId, start, end)),
);

export const loadDaily = cache(
  (userId: string, start: string, end: string, through: string) =>
    getDailySpending(scope(userId, start, end), parseDateParam(through)!),
);

export const loadPace = cache((userId: string, today: string) =>
  getPace(userId, parseDateParam(today)!),
);

export const loadIncomeCadence = cache(
  (userId: string, today: string, start: string, end: string) => {
    const s = parseDateParam(start)!;
    const e = parseDateParam(end)!;
    const totalDays = Math.round((e.getTime() - s.getTime()) / 86_400_000);
    return getIncomeCadence(userId, parseDateParam(today)!, { start: s, end: e, totalDays });
  },
);

/** Seven complete months before the current one: drift uses the last six. */
export const loadMonthlyHistory = cache((userId: string, today: string) => {
  const end = utcStartOfMonth(parseDateParam(today)!);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 7, 1));
  return getMonthlyBucketTotals(periodScope(userId, { start, end }));
});

export const loadPrevious = cache((userId: string, key: DashboardPeriodKey, today: string) =>
  getPreviousCashFlow(userId, resolveDashboardPeriod(key, parseDateParam(today)!)),
);

/** AI on for this viewer (opt-in AND AI_ENABLED), once per request. */
export const loadAiActive = cache((userId: string) => isAiActiveForUser(userId));

export const loadBalances = cache((userId: string) => getBalanceSummary(userId));

export const loadRecent = cache(async (userId: string) => {
  const prefs = await getUserPreferences(userId);
  return getRecentTransactions(userId, { hideTransfers: prefs.hideTransfersFromList, limit: 8 });
});

export { toDateParam };
