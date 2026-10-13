/**
 * Trend statistics over figures already aggregated by ./metrics.ts.
 *
 * Nothing here sums transactions; it compares a handful of per-period totals.
 * Percentages are returned unrounded (ratios) and rounded once, at display.
 *
 *   delta   — period over period, complete periods only
 *   pace    — cumulative spend versus the same day last month, with fixed costs
 *             projected separately from the variable run-rate
 *   drift   — median of the last 3 complete months versus the 3 before, so a
 *             single large month (a tax payment) cannot dominate
 *   anomaly — this period versus median + k·IQR of the trailing months
 */

import { median } from "./periods";
import type { PaceData, PaceSplit, MonthlyBucketTotal } from "./metrics";
import { roundMoney } from "@/lib/utils/money";

/**
 * Below this a percentage is noise ("+340% on bank fees" is $1 → $4.40).
 * Report the absolute change instead.
 */
export const SMALL_BASE_THRESHOLD = 50;

/** Buckets that are offsets, not spending; they never drift or spike. */
const OFFSET_BUCKETS = new Set(["REIMBURSEMENTS", "REWARDS"]);

// ---------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------

export interface Delta {
  current: number;
  previous: number;
  absolute: number;
  /** (current − previous) / |previous|; null on a small or zero base. */
  ratio: number | null;
  direction: "up" | "down" | "flat";
}

export function computeDelta(current: number, previous: number): Delta {
  const absolute = roundMoney(current - previous);
  const ratio =
    Math.abs(previous) >= SMALL_BASE_THRESHOLD
      ? (current - previous) / Math.abs(previous)
      : null;
  return {
    current,
    previous,
    absolute,
    ratio,
    direction: absolute > 0.004 ? "up" : absolute < -0.004 ? "down" : "flat",
  };
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

export interface PaceProjection {
  /** Variable spending vs the same day last month (ratio); null on a small base. */
  variableRatioAhead: number | null;
  /** Total spending vs the same day last month (ratio); null on a small base. */
  totalRatioAhead: number | null;
  /** Projected month total: expected fixed + variable run-rate × days. */
  projected: PaceSplit;
  elapsedDays: number;
  totalDays: number;
}

/**
 * Fixed costs (rent, loan payments, subscriptions) post in lumps, usually
 * early in the month, so a straight-line projection of total spending on day
 * 3 explodes. Project them as "at least what they were last month" and only
 * extrapolate the variable run-rate.
 */
export function projectPace(pace: PaceData): PaceProjection {
  const elapsedDays = pace.period.elapsedDays;
  const totalDays = pace.period.totalDays;
  const fixed = Math.max(pace.toDate.fixed, pace.comparisonTotal.fixed);
  const variable =
    elapsedDays > 0 ? (pace.toDate.variable / elapsedDays) * totalDays : 0;

  const ratio = (now: number, then: number) =>
    then >= SMALL_BASE_THRESHOLD ? (now - then) / then : null;

  return {
    variableRatioAhead: ratio(pace.toDate.variable, pace.comparisonToDate.variable),
    totalRatioAhead: ratio(pace.toDate.total, pace.comparisonToDate.total),
    projected: {
      fixed: roundMoney(fixed),
      variable: roundMoney(Math.max(0, variable)),
      total: roundMoney(fixed + Math.max(0, variable)),
    },
    elapsedDays,
    totalDays,
  };
}

// ---------------------------------------------------------------------------
// Monthly series
// ---------------------------------------------------------------------------

/** Months (YYYY-MM) from `start` (inclusive) to `end` (exclusive). */
export function monthKeys(start: Date, end: Date): string[] {
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  while (Date.UTC(y, m, 1) < end.getTime()) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** bucket → totals aligned to `months` (0 for a month with no spending). */
export function seriesByBucket(
  rows: MonthlyBucketTotal[],
  months: string[],
): Map<string, number[]> {
  const index = new Map(months.map((m, i) => [m, i]));
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const i = index.get(r.month);
    if (i === undefined || OFFSET_BUCKETS.has(r.bucket)) continue;
    const series = out.get(r.bucket) ?? new Array<number>(months.length).fill(0);
    series[i] = r.net;
    out.set(r.bucket, series);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

export interface Drift {
  bucket: string;
  /** Median of the most recent `window` months. */
  recent: number;
  /** Median of the `window` months before those. */
  prior: number;
  absolute: number;
  ratio: number | null;
  direction: "up" | "down";
}

/**
 * Median of the last `window` months against the median of the `window`
 * before. With a mean, one $3,000 tax payment rolling out of the window read
 * as "$1,000 a month less on government" for three months straight; the
 * median of three ignores a single outlier.
 *
 * @param series bucket → monthly totals, oldest first (complete months only)
 */
export function computeDrift(
  series: Map<string, number[]>,
  window = 3,
  minAbsolute = SMALL_BASE_THRESHOLD,
): Drift[] {
  const out: Drift[] = [];
  for (const [bucket, values] of series) {
    if (values.length < window * 2) continue;
    const recentValues = values.slice(-window);
    const priorValues = values.slice(-window * 2, -window);
    const recent = roundMoney(median(recentValues));
    const prior = roundMoney(median(priorValues));
    const absolute = roundMoney(recent - prior);
    if (Math.abs(absolute) < minAbsolute) continue;
    out.push({
      bucket,
      recent,
      prior,
      absolute,
      ratio: prior >= SMALL_BASE_THRESHOLD ? absolute / prior : null,
      direction: absolute > 0 ? "up" : "down",
    });
  }
  return out.sort((a, b) => Math.abs(b.absolute) - Math.abs(a.absolute));
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export interface Anomaly {
  bucket: string;
  current: number;
  /** Median of the trailing months. */
  typical: number;
  excess: number;
  ratio: number | null;
  severity: "notable" | "high";
}

/** Linear interpolation between order statistics (matches percentile_cont). */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function interquartileRange(values: number[]): number {
  if (values.length < 2) return 0;
  return quantile(values, 0.75) - quantile(values, 0.25);
}

/**
 * Buckets whose current total sits above median + k·IQR of the trailing
 * months. Needs at least three months of history, ignores totals under the
 * small-base threshold, and never reports a percentage on a small typical.
 */
export function detectAnomalies(
  current: Map<string, number>,
  history: Map<string, number[]>,
  k = 1.5,
): Anomaly[] {
  const out: Anomaly[] = [];
  for (const [bucket, value] of current) {
    if (OFFSET_BUCKETS.has(bucket)) continue;
    if (value < SMALL_BASE_THRESHOLD) continue;
    const past = history.get(bucket) ?? [];
    if (past.length < 3) continue;
    const typical = median(past);
    // A perfectly steady series has IQR 0; require a real move, not a cent.
    const spread = Math.max(interquartileRange(past), typical * 0.25, 10);
    if (value <= typical + k * spread) continue;
    const excess = roundMoney(value - typical);
    out.push({
      bucket,
      current: value,
      typical: roundMoney(typical),
      excess,
      ratio: typical >= SMALL_BASE_THRESHOLD ? excess / typical : null,
      severity: value > typical + 3 * spread ? "high" : "notable",
    });
  }
  return out.sort((a, b) => b.excess - a.excess);
}
