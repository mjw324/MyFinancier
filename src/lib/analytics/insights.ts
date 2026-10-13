/**
 * Insight sentences ("What changed") and display formatting.
 *
 * A chart shows a shape; a sentence states the finding. Everything here is
 * worded from figures ./metrics.ts and ./trends.ts already computed — no new
 * arithmetic beyond rounding, which happens here, once, at display.
 *
 * Rules that keep the copy honest:
 *   - "saved" means net money moved to savings/investments, as a share of
 *     money in. A positive net change is not "saved", and card payments are
 *     internal transfers, never savings.
 *   - no percentage on a base under SMALL_BASE_THRESHOLD
 *   - no comparison of a partial period against a complete one
 *   - every link opens exactly the rows the sentence describes
 */

import { transactionsHref } from "@/lib/utils/date-ranges";
import type { CashFlow, IncomeCadence } from "./metrics";
import { savingsRate } from "./metrics";
import { bucketLabel, formatMoneyShort, formatRatio } from "./labels";
import type { Anomaly, Drift, PaceProjection } from "./trends";

export {
  bucketLabel,
  formatMoneyShort,
  formatPointsDelta,
  formatRatio,
  formatSignedRatio,
} from "./labels";

function bucketWords(bucket: string): string {
  return bucketLabel(bucket).toLowerCase();
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

export type InsightTone = "positive" | "neutral" | "warning";

export interface Insight {
  id: string;
  tone: InsightTone;
  text: string;
  /** Higher sorts first. */
  priority: number;
  href?: string;
  /** Subject used for de-duplication (a bucket, or the insight kind). */
  subject: string;
}

export interface InsightRange {
  from: string;
  to: string;
}

export interface InsightInputs {
  /** e.g. "so far this month", "in September 2026", "in the last 30 days". */
  when: string;
  periodLabel: string;
  isPartial: boolean;
  /** Drill-down range of the selected period. */
  range: InsightRange;
  flow: CashFlow;
  pace?: { projection: PaceProjection; range: InsightRange } | null;
  income?: IncomeCadence | null;
  anomalies?: Anomaly[];
  drifts?: Drift[];
  driftRange?: InsightRange;
}

export function cashFlowInsight(i: InsightInputs): Insight | null {
  const { flow, when, range } = i;
  if (flow.moneyIn <= 0 && flow.netSpending <= 0 && flow.savedNet === 0) return null;

  const rate = savingsRate(flow);
  if (flow.savedNet > 0 && rate !== null) {
    return {
      id: "saved",
      subject: "cash-flow",
      tone: "positive",
      text: `You moved ${formatMoneyShort(flow.savedNet)} to savings and investments ${when}, ${formatRatio(rate)} of the money that came in.`,
      priority: 90,
      href: transactionsHref({ ...range, flowGroup: "savings" }),
    };
  }
  if (flow.netChange < 0) {
    return {
      id: "net-negative",
      subject: "cash-flow",
      tone: "warning",
      text: `Money out exceeded money in by ${formatMoneyShort(-flow.netChange)} ${when}, counting savings.`,
      priority: 95,
      href: transactionsHref(range),
    };
  }
  if (flow.netChange > 0) {
    return {
      id: "net-positive",
      subject: "cash-flow",
      tone: "positive",
      text: `Money in exceeded money out by ${formatMoneyShort(flow.netChange)} ${when}, after savings.`,
      priority: 85,
      href: transactionsHref(range),
    };
  }
  return null;
}

export function paceInsight(i: InsightInputs): Insight | null {
  const p = i.pace;
  if (!p) return null;
  const { projection } = p;
  const ratio = projection.variableRatioAhead;
  if (ratio === null || projection.elapsedDays < 5) return null;
  if (Math.abs(ratio) < 0.15) return null;
  const ahead = ratio > 0;
  return {
    id: "pace",
    subject: "pace",
    tone: ahead ? "warning" : "positive",
    text: `Day-to-day spending is ${formatRatio(ratio)} ${ahead ? "ahead of" : "below"} last month at this point. With fixed costs, the month is on track for about ${formatMoneyShort(projection.projected.total)}.`,
    priority: 80,
    href: transactionsHref({ ...p.range, cost: "variable" }),
  };
}

export function incomeInsight(i: InsightInputs): Insight | null {
  const c = i.income;
  if (!c?.primary || c.expectedInPeriod === null || c.expectedInPeriod <= 0) return null;
  const actual = c.depositsInPeriod;
  const expected = c.expectedInPeriod;
  if (actual === expected) return null;
  const source = c.primary.label;
  const href = transactionsHref({ ...i.range, flowClass: "income" });

  if (actual > expected) {
    return {
      id: "income-extra",
      subject: "income",
      tone: "positive",
      text: `${i.periodLabel} had ${actual} paychecks from ${source} instead of the usual ${expected}, so income reads higher than a typical month.`,
      priority: 72,
      href,
    };
  }
  if (i.isPartial) {
    return {
      id: "income-partial",
      subject: "income",
      tone: "neutral",
      text: `${actual} of ${expected} expected paychecks from ${source} have landed so far.`,
      priority: 55,
      href,
    };
  }
  return {
    id: "income-short",
    subject: "income",
    tone: "warning",
    text: `${i.periodLabel} had ${actual} of the usual ${expected} paychecks from ${source}.`,
    priority: 72,
    href,
  };
}

export function anomalyInsights(i: InsightInputs, limit = 2): Insight[] {
  return (i.anomalies ?? []).slice(0, limit).map((a) => ({
    id: `anomaly-${a.bucket}`,
    subject: a.bucket,
    tone: "warning" as const,
    text: `${capitalise(bucketWords(a.bucket))} is ${formatMoneyShort(a.current)} ${i.when}, against a typical ${formatMoneyShort(a.typical)} a month.`,
    priority: a.severity === "high" ? 75 : 65,
    href: transactionsHref({ ...i.range, bucket: a.bucket }),
  }));
}

export function driftInsights(i: InsightInputs, limit = 2): Insight[] {
  return (i.drifts ?? []).slice(0, limit).map((d) => ({
    id: `drift-${d.bucket}`,
    subject: d.bucket,
    tone: d.direction === "up" ? ("warning" as const) : ("positive" as const),
    text: `You're spending about ${formatMoneyShort(d.absolute)} a month ${d.direction === "up" ? "more" : "less"} on ${bucketWords(d.bucket)} than in the three months before (typical month, last 3 vs prior 3).`,
    priority: 70,
    href: i.driftRange
      ? transactionsHref({ ...i.driftRange, bucket: d.bucket })
      : undefined,
  }));
}

export function cashWithdrawalInsight(i: InsightInputs): Insight | null {
  const cash = i.flow.byClass.cash_withdrawal?.total ?? 0;
  if (cash < 100) return null;
  return {
    id: "cash",
    subject: "CASH_WITHDRAWALS",
    tone: "neutral",
    text: `${formatMoneyShort(cash)} left as cash ${i.when}. It counts as spending, but nothing says what it bought.`,
    priority: 50,
    href: transactionsHref({ ...i.range, flowClass: "cash_withdrawal" }),
  };
}

/**
 * The ranked list the dashboard renders: one finding per subject, at most
 * `limit`. An empty list is fine — silence beats filler on thin data.
 */
export function buildInsights(i: InsightInputs, limit = 5): Insight[] {
  const candidates = [
    cashFlowInsight(i),
    paceInsight(i),
    incomeInsight(i),
    ...anomalyInsights(i),
    ...driftInsights(i),
    cashWithdrawalInsight(i),
  ].filter((x): x is Insight => x !== null);

  const seen = new Set<string>();
  const out: Insight[] = [];
  for (const insight of candidates.sort((a, b) => b.priority - a.priority)) {
    if (seen.has(insight.subject)) continue;
    seen.add(insight.subject);
    out.push(insight);
  }
  return out.slice(0, limit);
}
