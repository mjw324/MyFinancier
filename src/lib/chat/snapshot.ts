/**
 * The per-user snapshot loaded into every chat turn (after the cache
 * breakpoint): a small, deterministic picture of the user's money built from
 * the same query functions the tools and the dashboard use. Anything not here
 * is one tool call away.
 *
 * Covers accounts (masked numbers, balances, as-of), month to date and the
 * three prior months by category, budgets with pace, active recurring
 * outflows with next dates, and the category names searchTransactions takes.
 * Sized for roughly 1–3k tokens: lists are capped and the caps are reported.
 *
 * The user's saved memories travel separately (`memories`): they are the
 * person's own words, not computed data, so the prompt labels them apart.
 */

import { bucketLabel } from "@/lib/analytics/labels";
import { getMonthlyBucketTotals, getSpendingByBucket, periodScope } from "@/lib/analytics/metrics";
import { calendarPeriod, utcAddDays, utcStartOfMonth } from "@/lib/analytics/periods";
import { getAccountsWithBalances, summarizeBalances } from "@/lib/db/queries/accounts";
import { getBudgetProgress } from "@/lib/db/queries/budgets";
import { listRecurringStreams } from "@/lib/db/queries/recurring";
import { getDistinctCategories } from "@/lib/db/queries/transactions";
import { categoryChoices } from "@/lib/transactions/nl-search";
import { cleanLabel } from "@/lib/insights/sanitize";
import { toDateParam } from "@/lib/utils/date-ranges";
import { listMemories, memoriesForSnapshot } from "./memories";
import { forModel, makeLabeler } from "./tools";
import { money, percent } from "./values";

const MAX_ACCOUNTS = 12;
const MAX_CATEGORIES_PER_MONTH = 8;
const MAX_RECURRING = 12;
const MAX_CATEGORY_NAMES = 60;

export interface ChatSnapshot {
  /** What the UI and the number check read (labels as the user sees them). */
  data: Record<string, unknown>;
  /** What the model reads: JSON of the model-facing copy. */
  text: string;
  /** Saved memories, cleaned and capped (lib/chat/memories.ts). */
  memories: { notes: string[]; truncated: boolean };
}

export async function buildSnapshot(userId: string, today: Date): Promise<ChatSnapshot> {
  const label = makeLabeler(userId);
  const monthStart = utcStartOfMonth(today);
  const historyStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 3, 1));

  const [accounts, history, current, budgets, streams, categories, memoryRows] = await Promise.all([
    getAccountsWithBalances(userId),
    getMonthlyBucketTotals(periodScope(userId, { start: historyStart, end: monthStart })),
    getSpendingByBucket(periodScope(userId, { start: monthStart, end: utcAddDays(today, 1) })),
    getBudgetProgress(userId, today),
    listRecurringStreams(userId, { flowType: "outflow" }),
    getDistinctCategories(userId),
    listMemories(userId),
  ]);

  const open = accounts.filter((a) => a.balance.state !== "closed");
  const summary = summarizeBalances(accounts.map((a) => a.balance));

  const priorMonths = [-3, -2, -1].map((offset) => {
    const p = calendarPeriod("month", today, offset);
    const key = toDateParam(p.start).slice(0, 7);
    const rows = history.filter((h) => h.month === key && h.net > 0).sort((a, b) => b.net - a.net);
    const total = history.filter((h) => h.month === key).reduce((s, h) => s + h.net, 0);
    return {
      month: p.label,
      netSpending: money(total),
      topCategories: rows.slice(0, MAX_CATEGORIES_PER_MONTH).map((r) => ({ label: bucketLabel(r.bucket), amount: money(r.net) })),
      truncated: rows.length > MAX_CATEGORIES_PER_MONTH,
    };
  });

  const monthPeriod = calendarPeriod("month", today);
  const data = {
    accounts: open.slice(0, MAX_ACCOUNTS).map((a) => ({
      name: cleanLabel(a.name, 40),
      mask: a.mask ? `••${a.mask}` : null,
      kind: a.balance.kind,
      balance: a.balance.settledCents === null ? null : money(a.balance.settledCents / 100),
      asOf: a.balance.balanceAsOf ? toDateParam(a.balance.balanceAsOf) : null,
      stale: a.balance.isStale || undefined,
    })),
    accountsTruncated: open.length > MAX_ACCOUNTS,
    totals: {
      netWorth: money(summary.netWorth),
      cash: money(summary.liquidCash),
      creditCardDebt: money(summary.creditDebt),
      loanDebt: money(summary.loanDebt),
    },
    monthToDate: {
      month: monthPeriod.label,
      day: `${monthPeriod.elapsedDays} of ${monthPeriod.totalDays}`,
      netSpending: money(current.netSpending),
      topCategories: current.buckets.slice(0, MAX_CATEGORIES_PER_MONTH).map((b) => ({
        label: bucketLabel(b.bucket),
        amount: money(b.net),
        share: percent(b.share),
      })),
      truncated: current.buckets.length > MAX_CATEGORIES_PER_MONTH,
    },
    priorMonths,
    budgets: budgets.map((b) => ({
      category: b.categoryLabel,
      period: b.window.label,
      daysLeft: b.window.daysLeft,
      budgeted: money(b.budgeted),
      spent: money(b.spent),
      remaining: money(b.remaining),
      status: b.status,
    })),
    recurringBills: streams.slice(0, MAX_RECURRING).map((s) => ({
      ...label(s.customName ?? s.merchantName ?? s.description, { pfcPrimary: s.pfcPrimary }),
      frequency: s.frequency.toLowerCase().replace(/_/g, " "),
      typicalAmount: money(Math.abs(Number(s.averageAmount))),
      nextDate: s.predictedNextDate ? toDateParam(s.predictedNextDate) : null,
    })),
    recurringTruncated: streams.length > MAX_RECURRING,
    categoryNames: [...categoryChoices(categories).keys()].slice(0, MAX_CATEGORY_NAMES),
  };

  return { data, text: JSON.stringify(forModel(data)), memories: memoriesForSnapshot(memoryRows) };
}
