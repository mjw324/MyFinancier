import { and, between, eq, lt, sql } from "drizzle-orm";
import { db } from "..";
import { financialAccounts, transactions, budgets, categories } from "../schema";
import { getPeriodStart, getPeriodEnd } from "@/lib/utils/budget-periods";
import { getAccountsWithBalances } from "./accounts";
import { sumMoney } from "@/lib/utils/money";

export async function getOverviewStats(userId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const accounts = await getAccountsWithBalances(userId);
  // Round the aggregate, not each term. Postgres `numeric` is exact decimal but
  // these balances have already been through parseFloat, so 0.10 + 0.20 sums to
  // 0.30000000000000004 and surfaces as a net worth that is off by a fraction
  // of a cent.
  const netWorth = sumMoney(accounts.map((a) => a.netWorthSettled));
  const projectedNetWorth = sumMoney(accounts.map((a) => a.netWorthProjected));

  const [expenseStats] = await db
    .select({
      total: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)`,
      pending: sql<string>`coalesce(sum(case when ${transactions.pending} then ${transactions.amount}::numeric else 0 end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.isTransfer, false),
        between(transactions.date, startOfMonth, endOfMonth),
        // Spending plus refunds (negative); the signed sum nets refunds against expenses.
        sql`(${transactions.amount}::numeric > 0 OR ${transactions.isRefund})`,
      ),
    );

  const [incomeStats] = await db
    .select({
      total: sql<string>`coalesce(abs(sum(${transactions.amount}::numeric)), 0)`,
      pending: sql<string>`coalesce(abs(sum(case when ${transactions.pending} then ${transactions.amount}::numeric else 0 end)), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.isTransfer, false),
        eq(transactions.isRefund, false),
        between(transactions.date, startOfMonth, endOfMonth),
        lt(transactions.amount, "0"),
      ),
    );

  return {
    netWorth,
    projectedNetWorth,
    accountCount: accounts.length,
    expensesThisMonth: parseFloat(expenseStats?.total ?? "0"),
    pendingExpensesThisMonth: parseFloat(expenseStats?.pending ?? "0"),
    incomeThisMonth: parseFloat(incomeStats?.total ?? "0"),
    pendingIncomeThisMonth: parseFloat(incomeStats?.pending ?? "0"),
  };
}

export async function getSpendingByCategory(
  userId: string,
  startDate: Date,
  endDate: Date,
) {
  // A user's own category override must win here exactly as it does in the
  // transactions filter, or clicking a chart slice opens a different set of
  // rows than the slice was drawn from.
  const effectiveCategory = sql<string>`coalesce(${transactions.customCategory}, ${transactions.category})`;

  const rows = await db
    .select({
      category: effectiveCategory,
      totalAmount: sql<string>`sum(${transactions.amount}::numeric)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.isTransfer, false),
        between(transactions.date, startDate, endDate),
        // Include refunds so a return nets against its own category total.
        sql`(${transactions.amount}::numeric > 0 OR ${transactions.isRefund})`,
      ),
    )
    .groupBy(effectiveCategory);

  return rows.map((row) => ({
    category: row.category ?? "Uncategorized",
    totalAmount: parseFloat(row.totalAmount ?? "0"),
  }));
}

export async function getBudgetProgress(userId: string) {
  const userBudgets = await db.query.budgets.findMany({
    where: eq(budgets.userId, userId),
    with: { category: true },
  });

  const now = new Date();

  const results = await Promise.all(
    userBudgets.map(async (budget) => {
      const periodStart = getPeriodStart(budget.period, budget.startDate, now);
      const periodEnd = getPeriodEnd(budget.period, periodStart);

      const [spentRow] = await db
        .select({
          total: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.isTransfer, false),
            sql`coalesce(${transactions.customCategory}, ${transactions.category}) = ${budget.category?.name ?? ""}`,
            between(transactions.date, periodStart, periodEnd),
            // Include refunds so a return reduces budget usage.
            sql`(${transactions.amount}::numeric > 0 OR ${transactions.isRefund})`,
          ),
        );

      return {
        budgetId: budget.id,
        categoryId: budget.categoryId,
        categoryName: budget.category?.name ?? "Unknown",
        categoryColor: budget.category?.color ?? null,
        budgeted: parseFloat(budget.amount),
        spent: parseFloat(spentRow?.total ?? "0"),
        period: budget.period,
        startDate: budget.startDate.toISOString().split("T")[0],
      };
    }),
  );

  return results;
}

