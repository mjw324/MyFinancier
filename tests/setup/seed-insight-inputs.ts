/**
 * Detector inputs built straight from a seed profile (scripts/seed-profiles.ts)
 * without Plaid: descriptions are bucketed by keyword, and repeated outflows
 * at a steady interval become recurring streams. Rough on purpose — the suite
 * that uses it checks where digest figures come from, not the analytics.
 */

import type { Profile } from "../../scripts/seed-profiles";
import type { PaceData } from "@/lib/analytics/metrics";
import type { BudgetInput, DetectorInputs, StreamInput } from "@/lib/insights/detectors";
import { monthKeys } from "@/lib/analytics/trends";
import { roundMoney } from "@/lib/utils/money";

const DAY = 86_400_000;

/** Movements between the user's own accounts or into savings: not spending. */
const NOT_SPENDING =
  /TRANSFER|AUTOPAY|AUTO PAY|THANK YOU|PAYMENT RECEIVED|E-PAYMENT|EPAYMENT|ONLINE PMT|CONTRIB|VERIFICATION|PAYROLL|DIRECT DEP|DEPOSIT|REFUND|RETURN|REWARD|INTEREST PAYMENT|WITHDRAWAL$/;

const BUCKETS: Array<[RegExp, string]> = [
  [/WHOLE FOODS|TRADER JOE|SAFEWAY|COSTCO|CHIPOTLE|STARBUCKS|SWEETGREEN|DOORDASH|UBER \*EATS|DINER|RESTAURANTE/, "FOOD_AND_DRINK"],
  [/DELTA|MARRIOTT/, "TRAVEL"],
  [/SHELL|CHEVRON|UBER \*TRIP|LYFT|DMV|TOYOTA/, "TRANSPORTATION"],
  [/AMC|STEAM|TICKETMASTER|NETFLIX|SPOTIFY|HULU/, "ENTERTAINMENT"],
  [/RENT|MORTGAGE|PROPERTY TAX|HOME DEPOT|LOWES/, "RENT_AND_UTILITIES"],
  [/POWER|WATER|PG&E|COMCAST|VERIZON|T-MOBILE/, "RENT_AND_UTILITIES"],
  [/CVS|WALGREENS|GREAT CLIPS|EQUINOX|KAISER|DENTAL/, "PERSONAL_CARE"],
  [/ATM/, "CASH_WITHDRAWALS"],
  [/ZELLE|VENMO/, "SENT_TO_PEOPLE"],
  [/IRS|LOAN|NELNET|FEE|INTEREST CHARGE/, "LOAN_PAYMENTS"],
];

function bucketOf(description: string): string | null {
  if (NOT_SPENDING.test(description)) return null;
  for (const [re, bucket] of BUCKETS) if (re.test(description)) return bucket;
  return "GENERAL_MERCHANDISE";
}

type Txn = { date: Date; amount: number; description: string; depository: boolean };

function txnsOf(profile: Profile): Txn[] {
  return profile.items.flatMap((item) =>
    item.kind === "custom"
      ? item.accounts.flatMap((a) =>
          a.transactions.map((t) => ({
            date: new Date(`${t.date_transacted}T00:00:00Z`),
            amount: t.amount,
            description: t.description,
            depository: a.type === "depository",
          })),
        )
      : [],
  );
}

function frequencyOf(intervalDays: number): string {
  if (intervalDays <= 8) return "WEEKLY";
  if (intervalDays <= 16) return "BIWEEKLY";
  if (intervalDays <= 35) return "MONTHLY";
  if (intervalDays >= 350) return "ANNUALLY";
  return "UNKNOWN";
}

function streamsOf(txns: Txn[], today: Date): StreamInput[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.amount <= 0) continue;
    const list = groups.get(t.description) ?? [];
    list.push(t);
    groups.set(t.description, list);
  }
  const out: StreamInput[] = [];
  for (const [description, list] of groups) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    const gaps = list.slice(1).map((t, i) => (t.date.getTime() - list[i].date.getTime()) / DAY);
    const sorted = [...gaps].sort((a, b) => a - b);
    const interval = sorted[Math.floor(sorted.length / 2)];
    if (interval < 6 || sorted.at(-1)! - sorted[0] > 6) continue;
    const last = list.at(-1)!;
    // A stream whose next date is long past has ended.
    const next = new Date(last.date.getTime() + Math.round(interval) * DAY);
    if (next.getTime() < today.getTime() - 7 * DAY) continue;
    out.push({
      streamId: `stream_${out.length + 1}`,
      flowType: "outflow",
      status: list.length >= 6 ? "MATURE" : "EARLY_DETECTION",
      isActive: true,
      frequency: frequencyOf(interval),
      description,
      merchantName: null,
      customName: null,
      pfcPrimary: /ZELLE|VENMO/.test(description) ? "TRANSFER_OUT" : null,
      firstDate: list[0].date,
      predictedNextDate: next,
      averageAmount: roundMoney(list.reduce((s, t) => s + t.amount, 0) / list.length),
      lastAmount: last.amount,
    });
  }
  return out;
}

export function seedProfileInputs(profile: Profile, today: Date): DetectorInputs {
  const txns = txnsOf(profile);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const historyStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 7, 1));
  const months = monthKeys(historyStart, monthStart);
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  const series = new Map<string, number[]>();
  const currentBuckets = new Map<string, number>();
  const streams = streamsOf(txns, today);
  const fixed = new Set(streams.map((s) => s.description));
  const pace = { toDate: { fixed: 0, variable: 0 }, comparisonToDate: { fixed: 0, variable: 0 }, comparisonTotal: { fixed: 0, variable: 0 } };
  const day = today.getUTCDate();
  const lastMonth = months.at(-1);

  for (const t of txns) {
    const bucket = bucketOf(t.description);
    if (!bucket || t.amount <= 0) continue;
    const key = t.date.toISOString().slice(0, 7);
    const kind = fixed.has(t.description) ? "fixed" : "variable";
    if (t.date >= monthStart) {
      currentBuckets.set(bucket, roundMoney((currentBuckets.get(bucket) ?? 0) + t.amount));
      pace.toDate[kind] += t.amount;
      continue;
    }
    const i = monthIndex.get(key);
    if (i === undefined) continue;
    const s = series.get(bucket) ?? new Array<number>(months.length).fill(0);
    s[i] = roundMoney(s[i] + t.amount);
    series.set(bucket, s);
    if (key === lastMonth) {
      pace.comparisonTotal[kind] += t.amount;
      if (t.date.getUTCDate() <= day) pace.comparisonToDate[kind] += t.amount;
    }
  }

  const split = (p: { fixed: number; variable: number }) => ({
    fixed: roundMoney(p.fixed),
    variable: roundMoney(p.variable),
    total: roundMoney(p.fixed + p.variable),
  });
  const totalDays = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const paceData = {
    period: { elapsedDays: day, totalDays },
    comparisonPeriod: {},
    series: [],
    toDate: split(pace.toDate),
    comparisonToDate: split(pace.comparisonToDate),
    comparisonTotal: split(pace.comparisonTotal),
  } as unknown as PaceData;

  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const budgets: BudgetInput[] = (profile.budgets ?? [])
    .filter((b) => b.period === "monthly")
    .map((b, i) => ({
      budgetId: `budget_${i + 1}`,
      categoryKey: b.categoryKey,
      categoryLabel: b.categoryKey,
      budgeted: b.amount,
      spent: currentBuckets.get(b.categoryKey) ?? 0,
      window: {
        start: ymd(monthStart),
        end: ymd(monthEnd),
        label: "this month",
        state: "active",
        daysLeft: totalDays - day + 1,
      },
    }));

  const cash = profile.items.flatMap((item) => (item.kind === "custom" ? item.accounts : [])).filter((a) => a.type === "depository").reduce((s, a) => s + a.starting_balance, 0);
  const through = new Date(today.getTime() + 14 * DAY);
  const bills = streams.filter((s) => s.predictedNextDate && s.predictedNextDate <= through).reduce((s, x) => s + x.lastAmount, 0);

  return {
    userId: `seed_${profile.username}`,
    today,
    currentBuckets,
    series,
    months,
    pace: paceData,
    streams,
    budgets,
    safeToSpend: txns.length ? { safeToSpendCents: Math.round((cash - bills) * 100), billsCents: Math.round(bills * 100), through } : null,
  };
}
