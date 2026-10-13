/**
 * Metrics — the single implementation behind every money figure in the app.
 *
 * The dashboard, the transactions totals bar, the export summary, the charts
 * and the insight sentences all call these functions, and every function sums
 * in Postgres (`numeric`) using only the canonical expressions in ./flow.ts.
 * There is deliberately no JavaScript twin of any figure: two code paths for
 * one number is how the old dashboard and the transactions page came to
 * disagree.
 *
 * Conventions
 * - A scope is a user, an optional [start, end) date window of UTC-midnight
 *   calendar dates, and optional extra row filters (the transactions page
 *   filters). Periods come from ./periods.ts, anchored on `getUserToday()`.
 * - Only `countedSql` rows contribute: classified, and not stale-pending.
 * - Money crosses into JavaScript once per figure and is rounded to cents
 *   there; nothing here adds floats across rows.
 */

import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { roundMoney } from "@/lib/utils/money";
import {
  FLOW_CLASSES,
  FLOW_CLASS_GROUP,
  classesInGroup,
  countedSql,
  effectiveCategorySql,
  flowClassInSql,
  flowGroupSql,
  grossSpendAmountSql,
  incomeAmountSql,
  netSpendAmountSql,
  offsetAmountSql,
  savedAmountSql,
  spendBucketSql,
  type FlowClass,
} from "./flow";
import {
  calendarPeriod,
  expectedPaychecks,
  inferPaycheckCadence,
  previousPeriod,
  utcAddDays,
  utcAddMonths,
  utcStartOfMonth,
  type PaycheckCadence,
  type Period,
} from "./periods";

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export interface MetricScope {
  userId: string;
  /** Inclusive UTC-midnight start. */
  start?: Date;
  /** Exclusive end. */
  end?: Date;
  /** Extra row filters, ANDed (the transactions page filters). */
  where?: SQL;
}

export type PeriodScope = MetricScope & { start: Date; end: Date };

export function periodScope(
  userId: string,
  period: Pick<Period, "start" | "end">,
  where?: SQL,
): PeriodScope {
  return { userId, start: period.start, end: period.end, where };
}

function scopeSql(scope: MetricScope): SQL {
  const parts: SQL[] = [eq(transactions.userId, scope.userId)];
  if (scope.start) parts.push(gte(transactions.date, scope.start));
  if (scope.end) parts.push(lt(transactions.date, scope.end));
  if (scope.where) parts.push(scope.where);
  return and(...parts)!;
}

const num = (v: unknown): number => roundMoney(Number(v ?? 0));
const int = (v: unknown): number => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------
// Shared row predicates (also used by the transactions filters so a drill-down
// opens exactly the rows a figure summed)
// ---------------------------------------------------------------------------

/** Classes that contribute to net spending: the spending group plus offsets. */
export const SPEND_CLASSES: FlowClass[] = [
  ...classesInGroup("spending"),
  ...classesInGroup("offset"),
];

/** Rows that contribute to net spending (and so to a spending bucket). */
export const spendRowsSql: SQL = sql`(${countedSql} AND ${flowClassInSql(SPEND_CLASSES)})`;

/**
 * The hide-transfers list preference: movements between the user's own
 * accounts and to savings. Derived from the flow class; falls back to the
 * legacy flag only for rows not classified yet.
 */
export const isTransferSql: SQL = sql`(CASE WHEN ${transactions.flowClass} IS NOT NULL THEN (${flowGroupSql("internal")} OR ${flowGroupSql("savings")}) ELSE ${transactions.isTransfer} END)`;

/**
 * Who the money went to or came from. Prefers the classifier's
 * counterparty_key; falls back to Plaid's merchant name, then the raw
 * description, so rows classified before counterparty keys existed still
 * group sensibly.
 */
export const counterpartySql: SQL = sql`COALESCE(${transactions.counterpartyKey}, ${transactions.normalizedMerchant}, lower(btrim(COALESCE(${transactions.merchantName}, ${transactions.name}))))`;

/** The most common display name within a counterparty group. */
const counterpartyLabelSql = sql<string>`mode() WITHIN GROUP (ORDER BY COALESCE(${transactions.merchantName}, ${transactions.name}))`;

/**
 * Fixed costs: rows linked to a recurring stream, from a counterparty that
 * has a recurring stream, debt service, rent/utilities, loan payments and
 * insurance. Wrapped in COALESCE so a NULL category, category id or
 * counterparty makes a row variable rather than falling out of both buckets.
 */
export function fixedCostSql(userId: string): SQL {
  return sql`COALESCE((
    ${transactions.recurringStreamId} IS NOT NULL
    OR ${flowClassInSql(["debt_payment"])}
    OR ${effectiveCategorySql} IN ('RENT_AND_UTILITIES', 'LOAN_PAYMENTS')
    OR ${transactions.categoryId} LIKE 'GENERAL_SERVICES_INSURANCE%'
    OR ${counterpartySql} IN (
      SELECT COALESCE(r.counterparty_key, r.normalized_merchant, lower(btrim(COALESCE(r.merchant_name, r.name))))
      FROM transactions r
      WHERE r.user_id = ${userId} AND r.recurring_stream_id IS NOT NULL
    )
  ), false)`;
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export interface ClassTotal {
  /** Magnitude in the class's natural direction (money in for inflows). */
  total: number;
  count: number;
}

export interface CashFlow {
  /** Earned income (the `income` class). */
  income: number;
  /** Other money in (`other_inflow`): interest, cash deposits, one-offs. */
  otherIncome: number;
  /** income + otherIncome. Reimbursements are NOT here: they offset spending. */
  moneyIn: number;
  /** Spending group before offsets. */
  grossSpending: number;
  refunds: number;
  reimbursements: number;
  rewards: number;
  /** refunds + reimbursements + rewards. */
  offsets: number;
  /** grossSpending − offsets. */
  netSpending: number;
  /** Moved to savings / investments / own unlinked accounts. */
  savedOut: number;
  /** Brought back from those. */
  savedIn: number;
  /** savedOut − savedIn. */
  savedNet: number;
  /** moneyIn − netSpending − savedNet, summed per row in SQL. */
  netChange: number;
  byClass: Partial<Record<FlowClass, ClassTotal>>;
  /** Rows in scope, counted or not. */
  rowCount: number;
  /** Rows in scope that are not classified yet (not counted). */
  unclassifiedCount: number;
  /** Pending rows too old to trust (not counted). */
  stalePendingCount: number;
}

/** Money direction per group, for the per-class magnitude. */
function classAmountSql(flowClass: FlowClass): SQL {
  switch (FLOW_CLASS_GROUP[flowClass]) {
    case "income":
      return incomeAmountSql;
    case "spending":
      return grossSpendAmountSql;
    case "offset":
      return offsetAmountSql;
    case "savings":
      return savedAmountSql;
    default:
      return sql`abs((${transactions.amount})::numeric)`;
  }
}

const INFLOW_SAVINGS: FlowClass[] = ["savings_in", "external_transfer_in"];
const OUTFLOW_SAVINGS: FlowClass[] = ["savings_out", "external_transfer_out"];

function sumWhere(expr: SQL, where?: SQL) {
  return where
    ? sql<string>`COALESCE(SUM(${expr}) FILTER (WHERE ${countedSql} AND ${where}), 0)`
    : sql<string>`COALESCE(SUM(${expr}) FILTER (WHERE ${countedSql}), 0)`;
}

export async function getCashFlow(scope: MetricScope): Promise<CashFlow> {
  const columns: Record<string, SQL> = {
    income: sumWhere(incomeAmountSql, flowClassInSql(["income"])),
    otherIncome: sumWhere(incomeAmountSql, flowClassInSql(["other_inflow"])),
    moneyIn: sumWhere(incomeAmountSql),
    grossSpending: sumWhere(grossSpendAmountSql),
    refunds: sumWhere(offsetAmountSql, flowClassInSql(["refund"])),
    reimbursements: sumWhere(offsetAmountSql, flowClassInSql(["reimbursement"])),
    rewards: sumWhere(offsetAmountSql, flowClassInSql(["card_reward"])),
    offsets: sumWhere(offsetAmountSql),
    netSpending: sumWhere(netSpendAmountSql),
    savedOut: sumWhere(savedAmountSql, flowClassInSql(OUTFLOW_SAVINGS)),
    savedInNeg: sumWhere(savedAmountSql, flowClassInSql(INFLOW_SAVINGS)),
    savedNet: sumWhere(savedAmountSql),
    // Each row lands in at most one of the three CASEs, so this is the signed
    // contribution per row and the identity holds exactly.
    netChange: sumWhere(
      sql`(${incomeAmountSql}) - (${netSpendAmountSql}) - (${savedAmountSql})`,
    ),
    rowCount: sql`COUNT(*)::int`,
    unclassifiedCount: sql`(COUNT(*) FILTER (WHERE ${transactions.flowClass} IS NULL))::int`,
    stalePendingCount: sql`(COUNT(*) FILTER (WHERE ${transactions.flowClass} IS NOT NULL AND NOT ${countedSql}))::int`,
  };
  FLOW_CLASSES.forEach((c, i) => {
    columns[`t${i}`] = sumWhere(classAmountSql(c), flowClassInSql([c]));
    columns[`n${i}`] = sql`(COUNT(*) FILTER (WHERE ${countedSql} AND ${flowClassInSql([c])}))::int`;
  });

  const [row] = (await db
    .select(columns)
    .from(transactions)
    .where(scopeSql(scope))) as Array<Record<string, unknown>>;

  const byClass: CashFlow["byClass"] = {};
  FLOW_CLASSES.forEach((c, i) => {
    const count = int(row?.[`n${i}`]);
    if (count === 0) return;
    const raw = num(row?.[`t${i}`]);
    // savedAmountSql is signed (money in is negative); report a magnitude.
    byClass[c] = { total: INFLOW_SAVINGS.includes(c) ? -raw : raw, count };
  });

  return {
    income: num(row?.income),
    otherIncome: num(row?.otherIncome),
    moneyIn: num(row?.moneyIn),
    grossSpending: num(row?.grossSpending),
    refunds: num(row?.refunds),
    reimbursements: num(row?.reimbursements),
    rewards: num(row?.rewards),
    offsets: num(row?.offsets),
    netSpending: num(row?.netSpending),
    savedOut: num(row?.savedOut),
    savedIn: -num(row?.savedInNeg) || 0,
    savedNet: num(row?.savedNet),
    netChange: num(row?.netChange),
    byClass,
    rowCount: int(row?.rowCount),
    unclassifiedCount: int(row?.unclassifiedCount),
    stalePendingCount: int(row?.stalePendingCount),
  };
}

/** Net savings as a share of money in (unrounded; round once at display). */
export function savingsRate(flow: Pick<CashFlow, "savedNet" | "moneyIn">): number | null {
  if (flow.moneyIn <= 0) return null;
  return flow.savedNet / flow.moneyIn;
}

// ---------------------------------------------------------------------------
// Where it went
// ---------------------------------------------------------------------------

export interface BucketTotal {
  bucket: string;
  /** Net spending in the bucket (gross − offsets). */
  net: number;
  gross: number;
  offsets: number;
  count: number;
  /** Share of the positive buckets' total (0..1), for bars. 0 for negatives. */
  share: number;
}

export interface SpendingByBucket {
  /** Buckets with net spending > 0, largest first. Safe to draw. */
  buckets: BucketTotal[];
  /** Buckets whose offsets exceed their spending (e.g. reimbursements). Report, never draw. */
  negative: BucketTotal[];
  /** Sum of every bucket — equals CashFlow.netSpending for the same scope. */
  netSpending: number;
  /** Sum of the positive buckets. */
  positiveTotal: number;
}

export async function getSpendingByBucket(
  scope: MetricScope,
): Promise<SpendingByBucket> {
  const rows = await db
    .select({
      bucket: sql<string>`${spendBucketSql}`,
      net: sql<string>`SUM(${netSpendAmountSql})`,
      gross: sql<string>`SUM(${grossSpendAmountSql})`,
      offsets: sql<string>`SUM(${offsetAmountSql})`,
      count: sql<number>`COUNT(*)::int`,
      total: sql<string>`SUM(SUM(${netSpendAmountSql})) OVER ()`,
      positiveTotal: sql<string>`SUM(GREATEST(SUM(${netSpendAmountSql}), 0)) OVER ()`,
    })
    .from(transactions)
    .where(and(scopeSql(scope), spendRowsSql))
    .groupBy(spendBucketSql);

  const positiveTotal = num(rows[0]?.positiveTotal);
  const mapped: BucketTotal[] = rows.map((r) => {
    const net = num(r.net);
    return {
      bucket: r.bucket,
      net,
      gross: num(r.gross),
      offsets: num(r.offsets),
      count: int(r.count),
      share: net > 0 && positiveTotal > 0 ? net / positiveTotal : 0,
    };
  });

  return {
    buckets: mapped.filter((b) => b.net > 0).sort((a, b) => b.net - a.net),
    negative: mapped.filter((b) => b.net < 0).sort((a, b) => a.net - b.net),
    netSpending: num(rows[0]?.total),
    positiveTotal,
  };
}

// ---------------------------------------------------------------------------
// Merchants / counterparties
// ---------------------------------------------------------------------------

export interface CounterpartyTotal {
  key: string;
  label: string;
  total: number;
  count: number;
}

/** Purchases and their refunds; excludes reimbursements from people and rewards. */
const MERCHANT_CLASSES: FlowClass[] = [...classesInGroup("spending"), "refund"];

export async function getTopMerchants(
  scope: MetricScope,
  limit = 8,
): Promise<CounterpartyTotal[]> {
  const rows = await db
    .select({
      key: sql<string>`${counterpartySql}`,
      label: counterpartyLabelSql,
      total: sql<string>`SUM(${netSpendAmountSql})`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(transactions)
    .where(and(scopeSql(scope), countedSql, flowClassInSql(MERCHANT_CLASSES)))
    .groupBy(counterpartySql)
    .having(sql`SUM(${netSpendAmountSql}) > 0`)
    .orderBy(sql`SUM(${netSpendAmountSql}) DESC`)
    .limit(limit);

  return rows
    .filter((r) => r.key)
    .map((r) => ({ key: r.key, label: r.label ?? r.key, total: num(r.total), count: int(r.count) }));
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export interface IncomeSource extends CounterpartyTotal {
  /** Median deposit — one bonus cannot drag it the way it drags a mean. */
  medianAmount: number;
  firstSeen: string;
  lastSeen: string;
}

/** Income sources: the `income` class only. Reimbursements are not income. */
export async function getIncomeSources(scope: MetricScope): Promise<IncomeSource[]> {
  const rows = await db
    .select({
      key: sql<string>`${counterpartySql}`,
      label: counterpartyLabelSql,
      total: sql<string>`SUM(${incomeAmountSql})`,
      count: sql<number>`COUNT(*)::int`,
      medianAmount: sql<string>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${incomeAmountSql})`,
      firstSeen: sql<string>`to_char(MIN(${transactions.date}), 'YYYY-MM-DD')`,
      lastSeen: sql<string>`to_char(MAX(${transactions.date}), 'YYYY-MM-DD')`,
    })
    .from(transactions)
    .where(and(scopeSql(scope), countedSql, flowClassInSql(["income"])))
    .groupBy(counterpartySql)
    .orderBy(sql`SUM(${incomeAmountSql}) DESC`);

  return rows
    .filter((r) => r.key)
    .map((r) => ({
      key: r.key,
      label: r.label ?? r.key,
      total: num(r.total),
      count: int(r.count),
      medianAmount: num(r.medianAmount),
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
    }));
}

export interface IncomeCadence {
  /** Largest 12-month source with at least MIN_PRIMARY_DEPOSITS deposits. */
  primary: IncomeSource | null;
  cadence: PaycheckCadence | null;
  /** Primary-source deposits that landed inside `period`. */
  depositsInPeriod: number;
  /** Deposits the cadence predicts for the whole period; null without a cadence. */
  expectedInPeriod: number | null;
}

const MIN_PRIMARY_DEPOSITS = 6;

/**
 * Pay cadence from the primary income source over the 12 months up to and
 * including today. (The old window ended at the start of the current month,
 * so "deposits this month" was always 0.)
 */
export async function getIncomeCadence(
  userId: string,
  today: Date,
  period: Pick<Period, "start" | "end" | "totalDays">,
): Promise<IncomeCadence> {
  const windowStart = utcAddMonths(utcStartOfMonth(today), -12);
  const windowEnd = utcAddDays(today, 1);
  // Deposits that land inside `period` but after today (none, in practice) or
  // before the window must still count, so widen the window to cover it.
  const start = period.start < windowStart ? period.start : windowStart;
  const end = period.end > windowEnd ? period.end : windowEnd;

  const sources = await getIncomeSources({ userId, start, end });
  const primary = sources.find((s) => s.count >= MIN_PRIMARY_DEPOSITS) ?? null;
  if (!primary) {
    return { primary: null, cadence: null, depositsInPeriod: 0, expectedInPeriod: null };
  }

  const events = await db
    .select({ date: transactions.date, amount: sql<string>`${incomeAmountSql}` })
    .from(transactions)
    .where(
      and(
        scopeSql({ userId, start, end }),
        countedSql,
        flowClassInSql(["income"]),
        sql`${counterpartySql} = ${primary.key}`,
      ),
    )
    .orderBy(transactions.date);

  const paychecks = events.map((e) => ({ date: e.date, amount: num(e.amount) }));
  const cadence = inferPaycheckCadence(paychecks);
  const depositsInPeriod = paychecks.filter(
    (e) => e.date >= period.start && e.date < period.end,
  ).length;

  return {
    primary,
    cadence,
    depositsInPeriod,
    expectedInPeriod: cadence
      ? expectedPaychecks(period as Period, cadence)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Fixed vs variable
// ---------------------------------------------------------------------------

export interface FixedVsVariable {
  fixed: number;
  variable: number;
  /** fixed + variable — equals net spending for the same scope. */
  total: number;
  /** fixed / total (unrounded); null when total <= 0. */
  fixedShare: number | null;
  fixedItems: CounterpartyTotal[];
}

export async function getFixedVsVariable(
  scope: MetricScope,
  itemLimit = 6,
): Promise<FixedVsVariable> {
  const isFixed = fixedCostSql(scope.userId);
  const where = and(scopeSql(scope), spendRowsSql);

  const [[row], items] = await Promise.all([
    db
      .select({
        fixed: sql<string>`COALESCE(SUM(${netSpendAmountSql}) FILTER (WHERE ${isFixed}), 0)`,
        variable: sql<string>`COALESCE(SUM(${netSpendAmountSql}) FILTER (WHERE NOT ${isFixed}), 0)`,
        total: sql<string>`COALESCE(SUM(${netSpendAmountSql}), 0)`,
      })
      .from(transactions)
      .where(where),
    db
      .select({
        key: sql<string>`${counterpartySql}`,
        label: counterpartyLabelSql,
        total: sql<string>`SUM(${netSpendAmountSql})`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(transactions)
      .where(and(where, isFixed))
      .groupBy(counterpartySql)
      .having(sql`SUM(${netSpendAmountSql}) > 0`)
      .orderBy(sql`SUM(${netSpendAmountSql}) DESC`)
      .limit(itemLimit),
  ]);

  const total = num(row?.total);
  const fixed = num(row?.fixed);
  return {
    fixed,
    variable: num(row?.variable),
    total,
    fixedShare: total > 0 ? fixed / total : null,
    fixedItems: items
      .filter((r) => r.key)
      .map((r) => ({ key: r.key, label: r.label ?? r.key, total: num(r.total), count: int(r.count) })),
  };
}

// ---------------------------------------------------------------------------
// Daily series
// ---------------------------------------------------------------------------

export interface DailyPoint {
  /** YYYY-MM-DD (UTC calendar date). */
  date: string;
  /** Net spending that day (can be negative on a refund day). */
  net: number;
}

const dayKeySql = sql<string>`to_char(date_trunc('day', ${transactions.date}), 'YYYY-MM-DD')`;

function eachDay(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let d = start; d < end; d = utcAddDays(d, 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Net spending per calendar day, dense: every day in [start, end) appears, at
 * 0 when nothing was spent, so a chart never interpolates across quiet days.
 * Pass `through` (exclusive) to stop at today for a partial period.
 */
export async function getDailySpending(
  scope: PeriodScope,
  through?: Date,
): Promise<DailyPoint[]> {
  const end = through && through < scope.end ? through : scope.end;
  const rows = await db
    .select({ day: dayKeySql, net: sql<string>`SUM(${netSpendAmountSql})` })
    .from(transactions)
    .where(and(scopeSql({ ...scope, end }), spendRowsSql))
    .groupBy(dayKeySql);

  const byDay = new Map(rows.map((r) => [r.day, num(r.net)]));
  return eachDay(scope.start, end).map((date) => ({ date, net: byDay.get(date) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

export interface PaceSplit {
  total: number;
  fixed: number;
  variable: number;
}

export interface PacePoint {
  /** Day of the month, 1-based. */
  day: number;
  /** Cumulative net spending this month; null after today. */
  current: number | null;
  /** Cumulative net spending last month by the same day. */
  comparison: number | null;
}

export interface PaceData {
  period: Period;
  comparisonPeriod: Period;
  series: PacePoint[];
  toDate: PaceSplit;
  comparisonToDate: PaceSplit;
  comparisonTotal: PaceSplit;
}

/**
 * Cumulative net spending this month against last month, split into fixed and
 * variable costs. Cumulative sums are computed in SQL (window functions); the
 * caller projects the month with `projectPace` in ./trends.ts, which treats
 * fixed costs as lumpy (rent on day 1) and only extrapolates the variable
 * run-rate.
 */
export async function getPace(userId: string, today: Date): Promise<PaceData> {
  const period = calendarPeriod("month", today);
  const comparisonPeriod = previousPeriod(period);
  const through = utcAddDays(today, 1);
  const isFixed = fixedCostSql(userId);
  const monthKey = sql`date_trunc('month', ${transactions.date})`;

  const rows = await db
    .select({
      day: dayKeySql,
      cumFixed: sql<string>`SUM(SUM(${netSpendAmountSql}) FILTER (WHERE ${isFixed})) OVER (PARTITION BY ${monthKey} ORDER BY ${dayKeySql})`,
      cumVariable: sql<string>`SUM(SUM(${netSpendAmountSql}) FILTER (WHERE NOT ${isFixed})) OVER (PARTITION BY ${monthKey} ORDER BY ${dayKeySql})`,
      cumTotal: sql<string>`SUM(SUM(${netSpendAmountSql})) OVER (PARTITION BY ${monthKey} ORDER BY ${dayKeySql})`,
    })
    .from(transactions)
    .where(
      and(
        scopeSql({ userId, start: comparisonPeriod.start, end: through }),
        spendRowsSql,
      ),
    )
    .groupBy(dayKeySql, monthKey);

  const split = (r: (typeof rows)[number] | undefined): PaceSplit => ({
    total: num(r?.cumTotal),
    fixed: num(r?.cumFixed),
    variable: num(r?.cumVariable),
  });
  const byDay = new Map(rows.map((r) => [r.day, r]));

  // Carry each month's running totals forward across days with no spending.
  const walk = (p: Period, limit: Date) => {
    const out: PaceSplit[] = [];
    let last: PaceSplit = { total: 0, fixed: 0, variable: 0 };
    for (const day of eachDay(p.start, limit < p.end ? limit : p.end)) {
      const r = byDay.get(day);
      if (r) last = split(r);
      out.push(last);
    }
    return out;
  };
  const current = walk(period, through);
  const comparison = walk(comparisonPeriod, comparisonPeriod.end);

  const days = Math.max(period.totalDays, comparisonPeriod.totalDays);
  const series: PacePoint[] = [];
  for (let i = 0; i < days; i++) {
    series.push({
      day: i + 1,
      current: i < current.length ? current[i].total : null,
      comparison: i < comparison.length ? comparison[i].total : null,
    });
  }

  const zero: PaceSplit = { total: 0, fixed: 0, variable: 0 };
  const elapsed = current.length;
  return {
    period,
    comparisonPeriod,
    series,
    toDate: current[elapsed - 1] ?? zero,
    comparisonToDate:
      comparison[Math.min(elapsed, comparison.length) - 1] ?? zero,
    comparisonTotal: comparison[comparison.length - 1] ?? zero,
  };
}

// ---------------------------------------------------------------------------
// Monthly history (drift and anomalies)
// ---------------------------------------------------------------------------

export interface MonthlyBucketTotal {
  /** YYYY-MM */
  month: string;
  bucket: string;
  net: number;
}

export async function getMonthlyBucketTotals(
  scope: PeriodScope,
): Promise<MonthlyBucketTotal[]> {
  const monthSql = sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM')`;
  const rows = await db
    .select({
      month: monthSql,
      bucket: sql<string>`${spendBucketSql}`,
      net: sql<string>`SUM(${netSpendAmountSql})`,
    })
    .from(transactions)
    .where(and(scopeSql(scope), spendRowsSql))
    .groupBy(monthSql, spendBucketSql);
  return rows.map((r) => ({ month: r.month, bucket: r.bucket, net: num(r.net) }));
}

// ---------------------------------------------------------------------------
// Period comparison
// ---------------------------------------------------------------------------

/**
 * The previous period's cash flow, for complete periods only. A partial month
 * compared with a full one always reads as a dramatic fall; use pace instead.
 */
export async function getPreviousCashFlow(
  userId: string,
  period: Period,
): Promise<{ period: Period; flow: CashFlow } | null> {
  if (period.isPartial) return null;
  const prev = previousPeriod(period);
  return { period: prev, flow: await getCashFlow(periodScope(userId, prev)) };
}
