/**
 * Dashboard periods and the date parameters that link the dashboard to the
 * transactions page.
 *
 * Every period is resolved from the viewer's calendar date (`getUserToday()`),
 * never the server clock, and every boundary is a UTC-midnight calendar date —
 * the representation transaction dates use. A period's `end` is exclusive; the
 * transactions page takes an inclusive `to`, so links convert with
 * `periodToRange`.
 */

import { z } from "zod";
import {
  calendarPeriod,
  rollingPeriod,
  utcAddDays,
  yearToDate,
  type Period,
} from "@/lib/analytics/periods";

export const DASHBOARD_PERIODS = ["month", "last-month", "30d", "ytd"] as const;

export type DashboardPeriodKey = (typeof DASHBOARD_PERIODS)[number];

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriodKey, string> = {
  month: "This month",
  "last-month": "Last month",
  "30d": "Last 30 days",
  ytd: "Year to date",
};

/** Unknown or malformed values fall back to "this month" instead of throwing. */
export const dashboardPeriodSchema = z.enum(DASHBOARD_PERIODS).catch("month");

export function resolveDashboardPeriod(
  key: DashboardPeriodKey,
  today: Date,
): Period {
  switch (key) {
    case "last-month":
      return calendarPeriod("month", today, -1);
    case "30d":
      return rollingPeriod(30, today);
    case "ytd":
      return yearToDate(today);
    default:
      return calendarPeriod("month", today);
  }
}

const DATE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD for a UTC-midnight calendar date. */
export function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Parses a YYYY-MM-DD query value into a UTC-midnight Date. Returns null for
 * anything else, including impossible dates such as 2026-02-30, so a bad URL
 * can never reach the database as `Invalid Date`.
 */
export function parseDateParam(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = DATE_PARAM.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/** Inclusive `from`/`to` query values covering a period (whose end is exclusive). */
export function periodToRange(period: Pick<Period, "start" | "end">): {
  from: string;
  to: string;
} {
  return {
    from: toDateParam(period.start),
    to: toDateParam(utcAddDays(period.end, -1)),
  };
}

export type TransactionsLinkParams = {
  from?: string;
  to?: string;
  bucket?: string;
  category?: string;
  flowClass?: string;
  flowGroup?: string;
  counterparty?: string;
  cost?: "fixed" | "variable";
};

/** A /transactions URL that opens exactly the rows a dashboard figure summed. */
export function transactionsHref(params: TransactionsLinkParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `/transactions?${s}` : "/transactions";
}
