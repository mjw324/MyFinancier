import { and, between, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "..";
import { financialAccounts, transactions, budgets, categories } from "../schema";
import { getPeriodStart, getPeriodEnd } from "@/lib/utils/budget-periods";

export async function getOverviewStats(userId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [accountStats] = await db
    .select({
      netWorth: sql<string>`coalesce(sum(
        case
          when ${financialAccounts.type} in ('credit', 'loan')
            then -1 * ${financialAccounts.currentBalance}::numeric
          else ${financialAccounts.currentBalance}::numeric
        end
      ), 0)`,
      accountCount: sql<number>`count(*)`,
    })
    .from(financialAccounts)
    .where(eq(financialAccounts.userId, userId));

  const [expenseStats] = await db
    .select({
      total: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        between(transactions.date, startOfMonth, endOfMonth),
        gt(transactions.amount, "0"),
      ),
    );

  const [incomeStats] = await db
    .select({
      total: sql<string>`coalesce(abs(sum(${transactions.amount}::numeric)), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        between(transactions.date, startOfMonth, endOfMonth),
        lt(transactions.amount, "0"),
      ),
    );

  return {
    netWorth: parseFloat(accountStats?.netWorth ?? "0"),
    accountCount: Number(accountStats?.accountCount ?? 0),
    expensesThisMonth: parseFloat(expenseStats?.total ?? "0"),
    incomeThisMonth: parseFloat(incomeStats?.total ?? "0"),
  };
}

export async function getSpendingByCategory(
  userId: string,
  startDate: Date,
  endDate: Date,
) {
  const rows = await db
    .select({
      category: transactions.category,
      totalAmount: sql<string>`sum(${transactions.amount}::numeric)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        between(transactions.date, startDate, endDate),
        gt(transactions.amount, "0"),
      ),
    )
    .groupBy(transactions.category);

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
            eq(transactions.category, budget.category?.name ?? ""),
            between(transactions.date, periodStart, periodEnd),
            gt(transactions.amount, "0"),
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

