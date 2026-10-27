/**
 * The chat assistant's tools: read-only, built per request for one user.
 *
 * - userId comes from the Better Auth session through this closure and never
 *   appears in an input schema; an accountId argument is checked against the
 *   user's own accounts.
 * - Every input is a strict zod schema; every figure comes from the same
 *   query functions as the dashboard (lib/analytics/metrics.ts and
 *   lib/db/queries), in the money/change/range contract of ./values.ts.
 * - Merchant and transaction text is cleaned (cleanLabel). Outputs keep the
 *   user-facing label for the UI; toModelOutput swaps a person-to-person
 *   counterparty for a stable "Contact XX" token before the model sees it.
 *
 * Tool names, descriptions and schemas are part of the cached prompt prefix:
 * keep them byte-identical across users and deploys (nothing dynamic here).
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { bucketLabel } from "@/lib/analytics/labels";
import {
  getCashFlow,
  getDailySpending,
  getSpendingByBucket,
  getTopMerchants,
  periodScope,
  savingsRate,
} from "@/lib/analytics/metrics";
import { utcAddDays } from "@/lib/analytics/periods";
import { getAccountsWithBalances, summarizeBalances } from "@/lib/db/queries/accounts";
import { getBudgetProgress } from "@/lib/db/queries/budgets";
import { listRecurringStreams } from "@/lib/db/queries/recurring";
import {
  getDistinctCategories,
  getTransactionTotals,
  searchTransactions,
} from "@/lib/db/queries/transactions";
import { cleanLabel, counterpartyToken, isPersonToPerson } from "@/lib/insights/sanitize";
import { categoryChoices } from "@/lib/transactions/nl-search";
import { parseTransactionQuery } from "@/lib/transactions/query";
import { toDateParam } from "@/lib/utils/date-ranges";
import { displayName, formatCategory } from "@/lib/utils/format";
import { roundMoney } from "@/lib/utils/money";
import { change, money, percent, RangeSchema, resolveRange, type ResolvedRange } from "./values";

export interface ToolScope {
  userId: string;
  /** The user's calendar date, UTC midnight. */
  today: Date;
  timeZone: string;
}

/** A label shown to the user, with the model's version when they differ. */
export interface Label {
  label: string;
  /** Present only when the model must see something else (a P2P token). */
  modelLabel?: string;
}

const LIMIT = (max: number, dflt: number) => z.number().int().min(1).max(max).default(dflt);

/**
 * Model-facing copy of a tool output: every `modelLabel` replaces its
 * `label`, and is then dropped.
 */
export function forModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forModel);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "modelLabel") continue;
      out[k] = k === "label" && typeof obj.modelLabel === "string" ? obj.modelLabel : forModel(v);
    }
    return out;
  }
  return value;
}

const modelOutput = { toModelOutput: ({ output }: { output: unknown }) => ({ type: "json" as const, value: forModel(output) as never }) };

/**
 * One label for merchant / transaction text: cleaned, and tokenized for the
 * model when it names a person (P2P apps, transfers, payments to people).
 */
export function makeLabeler(userId: string) {
  return (raw: string, hints: { pfcPrimary?: string | null; flowClass?: string | null } = {}): Label => {
    const shown = cleanLabel(raw, 64) || "Unknown";
    const p2p =
      isPersonToPerson({ description: raw, pfcPrimary: hints.pfcPrimary }) ||
      hints.flowClass === "p2p_payment" ||
      hints.flowClass === "reimbursement";
    return p2p ? { label: shown, modelLabel: counterpartyToken(userId, raw) } : { label: shown };
  };
}

export function buildTools(scope: ToolScope) {
  const { userId, today, timeZone } = scope;

  const label = makeLabeler(userId);

  // The newest balance sync: the "as of" every answer can cite for posting lag.
  let asOfPromise: Promise<string | null> | null = null;
  const asOf = () =>
    (asOfPromise ??= getAccountsWithBalances(userId).then((accounts) => {
      const times = accounts.map((a) => a.lastSyncedAt?.getTime() ?? 0).filter((t) => t > 0);
      return times.length ? new Date(Math.max(...times)).toISOString() : null;
    }));

  const accountIds = () => getAccountsWithBalances(userId).then((a) => new Set(a.map((x) => x.id)));

  const tools = {
    getSpendingSummary: tool({
      description:
        "Net spending (purchases minus refunds) for a period, grouped by category or by merchant, largest first. Use for 'how much did I spend on X', 'where did my money go', 'top merchants'.",
      inputSchema: z
        .object({
          range: RangeSchema,
          groupBy: z.enum(["category", "merchant"]).default("category"),
          limit: LIMIT(20, 10),
        })
        .strict(),
      ...modelOutput,
      execute: async ({ range: input, groupBy, limit }) => {
        const r = resolveRange(input, today, timeZone);
        if ("error" in r) return { error: r.error };
        const s = periodScope(userId, r.period);
        const [buckets, merchants, stamp] = await Promise.all([
          getSpendingByBucket(s),
          groupBy === "merchant" ? getTopMerchants(s, limit + 1) : Promise.resolve([]),
          asOf(),
        ]);
        const items =
          groupBy === "category"
            ? buckets.buckets.slice(0, limit).map((b) => ({
                key: b.bucket,
                label: bucketLabel(b.bucket),
                amount: money(b.net),
                share: percent(b.share),
                transactions: b.count,
              }))
            : merchants.slice(0, limit).map((m) => ({
                key: m.key,
                ...label(m.label),
                amount: money(m.total),
                share: buckets.positiveTotal > 0 ? percent(m.total / buckets.positiveTotal) : null,
                transactions: m.count,
              }));
        const available = groupBy === "category" ? buckets.buckets.length : merchants.length;
        return {
          range: r.range,
          groupBy,
          total: money(buckets.netSpending),
          items,
          count: items.length,
          truncated: available > limit,
          moneyBack: buckets.negative.map((b) => ({ label: bucketLabel(b.bucket), amount: money(-b.net) })),
          asOf: stamp,
        };
      },
    }),

    compareSpending: tool({
      description:
        "Compare net spending between two periods, overall and by category, with the change already computed (delta = rangeA − rangeB). Use for 'did I spend more than last month', 'how does Q3 compare to Q2'.",
      inputSchema: z
        .object({
          rangeA: RangeSchema.describe("The period being asked about (usually the more recent one)"),
          rangeB: RangeSchema.describe("The period to compare against"),
          limit: LIMIT(20, 8),
        })
        .strict(),
      ...modelOutput,
      execute: async ({ rangeA, rangeB, limit }) => {
        const a = resolveRange(rangeA, today, timeZone);
        if ("error" in a) return { error: a.error };
        const b = resolveRange(rangeB, today, timeZone);
        if ("error" in b) return { error: b.error };
        const [ba, bb, stamp] = await Promise.all([
          getSpendingByBucket(periodScope(userId, a.period)),
          getSpendingByBucket(periodScope(userId, b.period)),
          asOf(),
        ]);
        const netA = new Map([...ba.buckets, ...ba.negative].map((x) => [x.bucket, x.net]));
        const netB = new Map([...bb.buckets, ...bb.negative].map((x) => [x.bucket, x.net]));
        const keys = [...new Set([...netA.keys(), ...netB.keys()])];
        const rows = keys
          .map((k) => {
            const x = netA.get(k) ?? 0;
            const y = netB.get(k) ?? 0;
            return { key: k, label: bucketLabel(k), a: money(x), b: money(y), change: change(x, y), size: Math.abs(roundMoney(x - y)) };
          })
          .sort((p, q) => q.size - p.size);
        return {
          rangeA: a.range,
          rangeB: b.range,
          totalA: money(ba.netSpending),
          totalB: money(bb.netSpending),
          change: change(ba.netSpending, bb.netSpending),
          note:
            a.range.isPartial !== b.range.isPartial
              ? "One period is still in progress, so its total is not final."
              : undefined,
          categories: rows.slice(0, limit).map(({ size: _size, ...row }) => row),
          count: Math.min(rows.length, limit),
          truncated: rows.length > limit,
          asOf: stamp,
        };
      },
    }),

    getCashflow: tool({
      description:
        "Money in, net spending, money moved to savings and the net change for a period. Use for income, savings rate, 'did I save money', 'am I spending more than I earn'.",
      inputSchema: z.object({ range: RangeSchema }).strict(),
      ...modelOutput,
      execute: async ({ range: input }) => {
        const r = resolveRange(input, today, timeZone);
        if ("error" in r) return { error: r.error };
        const [flow, stamp] = await Promise.all([getCashFlow(periodScope(userId, r.period)), asOf()]);
        const rate = savingsRate(flow);
        return {
          range: r.range,
          moneyIn: money(flow.moneyIn),
          income: money(flow.income),
          otherIncome: money(flow.otherIncome),
          grossSpending: money(flow.grossSpending),
          refundsAndReimbursements: money(flow.offsets),
          netSpending: money(flow.netSpending),
          savedNet: money(flow.savedNet),
          netChange: money(flow.netChange),
          savingsRate: rate === null ? null : { ...percent(rate), negative: rate < 0 },
          notCounted: flow.unclassifiedCount + flow.stalePendingCount,
          asOf: stamp,
        };
      },
    }),

    getDailySpending: tool({
      description:
        "Net spending per day for a period of up to 92 days, with the total, daily average and biggest day computed. Use for 'which day did I spend the most', spending patterns within a month.",
      inputSchema: z.object({ range: RangeSchema }).strict(),
      ...modelOutput,
      execute: async ({ range: input }) => {
        const r = resolveRange(input, today, timeZone);
        if ("error" in r) return { error: r.error };
        if (r.range.days > 92) return { error: "Daily spending covers at most 92 days. Use getSpendingSummary for longer periods." };
        const [days, stamp] = await Promise.all([
          getDailySpending(periodScope(userId, r.period), utcAddDays(today, 1)),
          asOf(),
        ]);
        const total = roundMoney(days.reduce((s, d) => s + d.net, 0));
        const peak = days.reduce<(typeof days)[number] | null>((best, d) => (!best || d.net > best.net ? d : best), null);
        return {
          range: r.range,
          total: money(total),
          averagePerDay: money(days.length ? roundMoney(total / days.length) : 0),
          daysWithSpending: days.filter((d) => d.net > 0.004).length,
          peakDay: peak && peak.net > 0 ? { date: peak.date, amount: money(peak.net) } : null,
          days: days.map((d) => ({ date: d.date, amount: money(d.net) })),
          count: days.length,
          truncated: false,
          asOf: stamp,
        };
      },
    }),

    searchTransactions: tool({
      description:
        "Find individual transactions by merchant text, category, direction, period, amount and recurring flag, newest first, with the matching total. Use for 'show my Amazon orders', 'what was that $80 charge', 'list subscriptions this month'.",
      inputSchema: z
        .object({
          text: z.string().trim().min(1).max(60).optional().describe("Merchant or description words"),
          category: z.string().max(100).optional().describe("A category name exactly as shown in the snapshot"),
          direction: z.enum(["spending", "income"]).optional(),
          range: RangeSchema.optional(),
          minAmount: z.number().min(0).max(10_000_000).optional().describe("Dollars, magnitude"),
          maxAmount: z.number().min(0).max(10_000_000).optional().describe("Dollars, magnitude"),
          recurring: z.enum(["recurring", "onetime"]).optional(),
          accountId: z.string().max(100).optional().describe("An account id from getAccounts"),
          limit: LIMIT(25, 10),
        })
        .strict(),
      ...modelOutput,
      execute: async (input) => {
        const params: Record<string, string> = {};
        let range: ResolvedRange | null = null;
        if (input.range) {
          const r = resolveRange(input.range, today, timeZone);
          if ("error" in r) return { error: r.error };
          range = r.range;
          params.from = r.range.from;
          params.to = r.range.to;
        }
        if (input.accountId) {
          if (!(await accountIds()).has(input.accountId)) {
            return { error: "Unknown accountId. Call getAccounts and use one of the ids it returns." };
          }
          params.account = input.accountId;
        }
        const ignored: string[] = [];
        if (input.category) {
          const choice = categoryChoices(await getDistinctCategories(userId)).get(input.category);
          if (choice) params.category = choice;
          else ignored.push("category");
        }
        if (input.text) params.search = input.text;
        if (input.direction) params.flowGroup = input.direction;
        if (input.minAmount !== undefined) params.min = String(input.minAmount);
        if (input.maxAmount !== undefined) params.max = String(input.maxAmount);
        if (input.recurring) params.recurring = input.recurring;
        // The same validation the /transactions page applies to any URL.
        const query = parseTransactionQuery(params);
        const [rows, totals, stamp] = await Promise.all([
          searchTransactions(userId, query.filters, { limit: input.limit }),
          getTransactionTotals(userId, query.filters),
          asOf(),
        ]);
        return {
          range,
          filters: query.params,
          ignored: [...ignored, ...query.invalid],
          transactions: rows.map((t) => {
            const amount = Number(t.amount);
            return {
              date: toDateParam(t.date),
              ...label(displayName({ customName: t.customName, merchantName: t.merchantName, fallback: t.name }), {
                flowClass: t.flowClass,
                pfcPrimary: t.category,
              }),
              category: formatCategory(t.customCategory ?? t.category ?? "UNCATEGORIZED"),
              // Plaid sign: positive is money out.
              direction: amount >= 0 ? "out" : "in",
              amount: money(Math.abs(amount)),
              account: t.financialAccount
                ? { name: cleanLabel(t.financialAccount.name, 40), mask: t.financialAccount.mask ? `••${t.financialAccount.mask}` : null }
                : null,
              pending: Boolean(t.pending),
              recurring: Boolean(t.recurringStreamId),
            };
          }),
          count: rows.length,
          totalMatches: totals.count,
          truncated: totals.count > rows.length,
          matchingNetSpending: money(totals.netSpending),
          matchingMoneyIn: money(totals.moneyIn),
          asOf: stamp,
        };
      },
    }),

    getBudgetStatus: tool({
      description:
        "Every budget with its current period, amount budgeted, net spent, remaining, percent used, status and days left. Use for 'am I on budget', 'how much is left for groceries'.",
      inputSchema: z.object({}).strict(),
      ...modelOutput,
      execute: async () => {
        const [budgets, stamp] = await Promise.all([getBudgetProgress(userId, today), asOf()]);
        return {
          budgets: budgets.map((b) => ({
            category: b.categoryLabel,
            period: b.window.label,
            from: b.window.start,
            to: b.window.end,
            daysLeft: b.window.daysLeft,
            budgeted: money(b.budgeted),
            spent: money(b.spent),
            remaining: money(b.remaining),
            overBy: b.remaining < 0 ? money(-b.remaining) : null,
            used: b.budgeted > 0 ? percent(Math.max(b.spent, 0) / b.budgeted) : null,
            status: b.status,
          })),
          count: budgets.length,
          truncated: false,
          asOf: stamp,
        };
      },
    }),

    getRecurring: tool({
      description:
        "Active recurring bills and subscriptions (outflow) or recurring income (inflow), with frequency, typical amount, next expected date and a computed monthly equivalent and total. Use for subscriptions, upcoming bills, 'what do I pay every month'.",
      inputSchema: z.object({ direction: z.enum(["outflow", "inflow"]).default("outflow"), limit: LIMIT(40, 25) }).strict(),
      ...modelOutput,
      execute: async ({ direction, limit }) => {
        const [streams, stamp] = await Promise.all([listRecurringStreams(userId, { flowType: direction }), asOf()]);
        const items = streams.map((s) => {
          const avg = Math.abs(Number(s.averageAmount));
          const perMonth = roundMoney(avg * (MONTHLY_FACTOR[s.frequency] ?? 0));
          return {
            ...label(s.customName ?? s.merchantName ?? s.description, { pfcPrimary: s.pfcPrimary }),
            frequency: s.frequency.toLowerCase().replace(/_/g, " "),
            typicalAmount: money(avg),
            lastAmount: money(Math.abs(Number(s.lastAmount))),
            nextDate: s.predictedNextDate ? toDateParam(s.predictedNextDate) : null,
            monthlyEquivalent: MONTHLY_FACTOR[s.frequency] ? money(perMonth) : null,
            perMonth,
          };
        });
        const monthlyTotal = roundMoney(items.reduce((sum, i) => sum + i.perMonth, 0));
        return {
          direction,
          items: items.slice(0, limit).map(({ perMonth: _p, ...i }) => i),
          monthlyTotal: money(monthlyTotal),
          count: Math.min(items.length, limit),
          truncated: items.length > limit,
          asOf: stamp,
        };
      },
    }),

    getAccounts: tool({
      description:
        "The user's linked accounts with masked numbers, balances and when each was last updated, plus net worth, cash and debt totals. Returns the account ids searchTransactions accepts.",
      inputSchema: z.object({}).strict(),
      ...modelOutput,
      execute: async () => {
        const accounts = await getAccountsWithBalances(userId);
        const open = accounts.filter((a) => a.balance.state !== "closed");
        const summary = summarizeBalances(accounts.map((a) => a.balance));
        return {
          accounts: open.map((a) => ({
            id: a.id,
            name: cleanLabel(a.name, 40),
            mask: a.mask ? `••${a.mask}` : null,
            kind: a.balance.kind,
            balance: a.balance.settledCents === null ? null : money(a.balance.settledCents / 100),
            available: a.balance.availableCents === null ? null : money(a.balance.availableCents / 100),
            asOf: a.balance.balanceAsOf?.toISOString() ?? null,
            stale: a.balance.isStale,
          })),
          netWorth: money(summary.netWorth),
          cash: money(summary.liquidCash),
          creditCardDebt: money(summary.creditDebt),
          loanDebt: money(summary.loanDebt),
          investments: summary.investments === null ? null : money(summary.investments),
          count: open.length,
          truncated: false,
          asOf: summary.asOf?.toISOString() ?? null,
        };
      },
    }),
  } satisfies ToolSet;

  return tools;
}

/** Occurrences per month by Plaid frequency. Unknown frequencies get no monthly figure. */
const MONTHLY_FACTOR: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  ANNUALLY: 1 / 12,
};

export type ChatTools = ReturnType<typeof buildTools>;
export const CHAT_TOOL_NAMES = [
  "getSpendingSummary",
  "compareSpending",
  "getCashflow",
  "getDailySpending",
  "searchTransactions",
  "getBudgetStatus",
  "getRecurring",
  "getAccounts",
] as const satisfies ReadonlyArray<keyof ChatTools>;
