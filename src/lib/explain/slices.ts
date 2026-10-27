/**
 * "Explain this" slices: the few pre-aggregated facts behind one dashboard
 * chart, computed here in code. Every figure the explanation can show is a
 * Fact (insights/types.ts) with its display string already formatted; the
 * model only sees fact names and values and writes {{placeholders}}, and
 * every delta, share and average is computed below, never by the model.
 *
 * Slices are built on the server from the same loaders the dashboard uses,
 * so the client sends only a chart name and a period key, never numbers.
 */

import type { CashFlow, DailyPoint, SpendingByBucket } from "@/lib/analytics/metrics";
import { computeDelta } from "@/lib/analytics/trends";
import { bucketLabel } from "@/lib/analytics/labels";
import { fact } from "@/lib/insights/detectors";
import { cleanLabel } from "@/lib/insights/sanitize";
import type { Fact } from "@/lib/insights/types";
import { roundMoney, sumMoney } from "@/lib/utils/money";

export const EXPLAIN_CHARTS = ["cash_flow", "where_it_went", "daily_spending"] as const;
export type ExplainChart = (typeof EXPLAIN_CHARTS)[number];

export interface ExplainSlice {
  chart: ExplainChart;
  facts: Record<string, Fact>;
  /** Deterministic wording with placeholders, used when model text fails checks. */
  template: string;
}

const moreOrLess = (delta: number) => (delta > 0.004 ? "more" : delta < -0.004 ? "less" : "the same");

/** Change vs the previous period as a fact: a percent on a real base, else dollars. */
function changeFact(current: number, previous: number): Fact {
  const d = computeDelta(current, previous);
  return d.ratio !== null ? fact.percent(d.ratio) : fact.money(d.absolute);
}

export function cashFlowSlice(input: {
  period: string;
  flow: CashFlow;
  previous: { label: string; flow: CashFlow } | null;
}): ExplainSlice {
  const { flow, previous } = input;
  const facts: Record<string, Fact> = {
    period: fact.text(input.period),
    moneyIn: fact.money(flow.moneyIn),
    spending: fact.money(flow.netSpending),
    saved: fact.money(flow.savedNet),
    savedDirection: fact.text(flow.savedNet >= 0 ? "moved into savings" : "taken out of savings"),
    netChange: fact.money(flow.netChange),
    netDirection: fact.text(flow.netChange >= 0 ? "more came in than went out" : "more went out than came in"),
  };
  let template =
    "In {{period}}, {{moneyIn}} came in and you spent {{spending}}, with {{saved}} {{savedDirection}}. Overall {{netDirection}}, by {{netChange}}.";
  if (previous) {
    Object.assign(facts, {
      previousPeriod: fact.text(previous.label),
      spendingChange: changeFact(flow.netSpending, previous.flow.netSpending),
      spendingMoreOrLess: fact.text(moreOrLess(flow.netSpending - previous.flow.netSpending)),
      moneyInChange: changeFact(flow.moneyIn, previous.flow.moneyIn),
      moneyInMoreOrLess: fact.text(moreOrLess(flow.moneyIn - previous.flow.moneyIn)),
    });
    template +=
      " Compared with {{previousPeriod}}, you spent {{spendingChange}} {{spendingMoreOrLess}} and {{moneyInChange}} {{moneyInMoreOrLess}} came in.";
  }
  if (flow.unclassifiedCount + flow.stalePendingCount > 0) {
    facts.uncounted = fact.count(flow.unclassifiedCount + flow.stalePendingCount);
    template += " {{uncounted}} transactions are not counted yet.";
  }
  return { chart: "cash_flow", facts, template };
}

const TOP_BUCKETS = 3;

export function whereItWentSlice(input: { period: string; buckets: SpendingByBucket }): ExplainSlice {
  const { buckets } = input;
  const facts: Record<string, Fact> = {
    period: fact.text(input.period),
    total: fact.money(buckets.netSpending),
    categoryCount: fact.count(buckets.buckets.length),
  };
  const top = buckets.buckets.slice(0, TOP_BUCKETS);
  top.forEach((b, i) => {
    facts[`category${i + 1}`] = fact.text(cleanLabel(bucketLabel(b.bucket)));
    facts[`category${i + 1}Amount`] = fact.money(b.net);
    facts[`category${i + 1}Share`] = fact.percent(b.share);
  });
  if (top.length > 0) {
    facts.topShare = fact.percent(sumMoney(top.map((b) => b.share)));
  }
  let template = "You spent {{total}} across {{categoryCount}} categories in {{period}}.";
  if (top.length > 0) template += " The largest was {{category1}} at {{category1Amount}}, {{category1Share}} of spending.";
  if (top.length > 1) template += " The top categories together made up {{topShare}}.";
  if (buckets.negative.length > 0) {
    facts.moneyBackCount = fact.count(buckets.negative.length);
    template += " {{moneyBackCount}} categories brought in more than they cost.";
  }
  return { chart: "where_it_went", facts, template };
}

export function dailySpendingSlice(input: { period: string; days: DailyPoint[] }): ExplainSlice {
  const days = input.days;
  const total = sumMoney(days.map((d) => d.net));
  const spendDays = days.filter((d) => d.net > 0.004);
  const facts: Record<string, Fact> = {
    period: fact.text(input.period),
    total: fact.money(total),
    dayCount: fact.count(days.length),
    spendDayCount: fact.count(spendDays.length),
    averagePerDay: fact.money(days.length > 0 ? roundMoney(total / days.length) : 0),
  };
  let template =
    "In {{period}} you spent {{total}} over {{dayCount}} days, about {{averagePerDay}} a day, with spending on {{spendDayCount}} of them.";
  const peak = spendDays.reduce<DailyPoint | null>((best, d) => (!best || d.net > best.net ? d : best), null);
  if (peak && total > 0) {
    facts.peakDate = fact.date(new Date(`${peak.date}T00:00:00Z`));
    facts.peakAmount = fact.money(peak.net);
    facts.peakShare = fact.percent(peak.net / total);
    template += " The biggest day was {{peakDate}} at {{peakAmount}}, {{peakShare}} of the period.";
  }
  return { chart: "daily_spending", facts, template };
}
