import { and, asc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "..";
import { budgets, transactions, type BudgetPeriod } from "../schema";
import {
  countedSql,
  netSpendAmountSql,
  offsetAmountSql,
  spendBucketSql,
} from "@/lib/analytics/flow";
import { spendBucketLabel } from "@/lib/budgets/categories";
import {
  resolveBudgetWindow,
  toYmd,
  type BudgetWindowState,
} from "@/lib/utils/budget-periods";
import {
  budgetStatus,
  calculateBudgetPercentage,
  type BudgetStatus,
} from "@/lib/utils/calculations";
import { toCents } from "@/lib/utils/balances";
import { getUserToday } from "@/lib/utils/user-time";

export async function getBudgetsByUserId(userId: string) {
  return db
    .select()
    .from(budgets)
    .where(eq(budgets.userId, userId))
    .orderBy(asc(budgets.createdAt), asc(budgets.id));
}

export interface BudgetProgress {
  budgetId: string;
  categoryKey: string;
  categoryLabel: string;
  /** Same as categoryLabel (kept for the dashboard's BudgetOverview). */
  categoryName: string;
  period: BudgetPeriod;
  /** "YYYY-MM-DD" */
  startDate: string;
  endDate: string | null;
  budgeted: number;
  /**
   * Net spending in the current period: spending minus refunds and
   * reimbursements that landed in this bucket. Can be negative when refunds
   * exceed spending.
   */
  spent: number;
  /** Refunds/reimbursements in the bucket this period (positive). */
  offsets: number;
  /** budgeted − max(spent, 0); negative when over budget. */
  remaining: number;
  percentage: number;
  status: BudgetStatus;
  window: {
    start: string;
    /** Last day included. */
    end: string;
    label: string;
    state: BudgetWindowState;
    daysLeft: number;
  };
}

/**
 * Budget progress for every budget of the user in ONE query (no N+1).
 *
 * spent = Σ netSpendAmountSql over counted rows whose spendBucketSql equals
 * the budget's key, inside the budget's current period [start, end).
 */
export async function getBudgetProgress(
  userId: string,
  today?: Date,
): Promise<BudgetProgress[]> {
  const rows = await getBudgetsByUserId(userId);
  if (rows.length === 0) return [];
  const day = today ?? (await getUserToday());

  const windows = rows.map((b) =>
    resolveBudgetWindow(
      { period: b.period as BudgetPeriod, startDate: b.startDate, endDate: b.endDate },
      day,
    ),
  );

  const selection: Record<string, SQL<string>> = {};
  rows.forEach((b, i) => {
    const w = windows[i];
    const inBudget = sql`${spendBucketSql} = ${b.categoryKey} AND ${transactions.date} >= ${toYmd(w.start)}::timestamp AND ${transactions.date} < ${toYmd(w.end)}::timestamp`;
    selection[`s${i}`] = sql<string>`COALESCE(SUM(CASE WHEN ${inBudget} THEN ${netSpendAmountSql} ELSE 0 END), 0)::text`;
    selection[`o${i}`] = sql<string>`COALESCE(SUM(CASE WHEN ${inBudget} THEN ${offsetAmountSql} ELSE 0 END), 0)::text`;
  });

  const minStart = new Date(Math.min(...windows.map((w) => w.start.getTime())));
  const maxEnd = new Date(Math.max(...windows.map((w) => w.end.getTime())));

  const [totals] = await db
    .select(selection)
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, minStart),
        lt(transactions.date, maxEnd),
        countedSql,
      ),
    );

  return rows.map((b, i) => {
    const w = windows[i];
    const budgetCents = toCents(b.amount) ?? 0;
    const spentCents = toCents(totals?.[`s${i}`] ?? "0") ?? 0;
    const offsetCents = toCents(totals?.[`o${i}`] ?? "0") ?? 0;
    const budgeted = budgetCents / 100;
    const spent = spentCents / 100;
    const label = spendBucketLabel(b.categoryKey);
    return {
      budgetId: b.id,
      categoryKey: b.categoryKey,
      categoryLabel: label,
      categoryName: label,
      period: b.period as BudgetPeriod,
      startDate: toYmd(b.startDate),
      endDate: b.endDate ? toYmd(b.endDate) : null,
      budgeted,
      spent,
      offsets: offsetCents / 100,
      remaining: (budgetCents - Math.max(spentCents, 0)) / 100,
      percentage: calculateBudgetPercentage(Math.max(spent, 0), budgeted),
      status: budgetStatus(spent, budgeted),
      window: {
        start: toYmd(w.start),
        end: toYmd(w.lastDay),
        label: w.label,
        state: w.state,
        daysLeft: w.daysLeft,
      },
    };
  });
}

/** Ownership-scoped lookup. */
export async function getBudgetForUser(userId: string, budgetId: string) {
  const [row] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Another budget of the user on the same bucket and period whose dates
 * overlap [startDate, endDate] (inclusive days; null end = open-ended).
 */
export async function findOverlappingBudget(
  userId: string,
  b: { categoryKey: string; period: string; startDate: Date; endDate: Date | null },
  excludeId?: string,
) {
  const newEnd = b.endDate ? sql`${toYmd(b.endDate)}::timestamp` : sql`'infinity'::timestamp`;
  const [row] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, userId),
        eq(budgets.categoryKey, b.categoryKey),
        eq(budgets.period, b.period),
        excludeId ? sql`${budgets.id} <> ${excludeId}` : undefined,
        sql`${budgets.startDate} <= ${newEnd}`,
        sql`COALESCE(${budgets.endDate}, 'infinity'::timestamp) >= ${toYmd(b.startDate)}::timestamp`,
      ),
    )
    .limit(1);
  return row ?? null;
}
