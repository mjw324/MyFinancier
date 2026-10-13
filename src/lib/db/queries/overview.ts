import { and, between, eq, sql } from "drizzle-orm";
import { db } from "..";
import { transactions, budgets } from "../schema";
import { getPeriodStart, getPeriodEnd } from "@/lib/utils/budget-periods";
import { searchTransactions } from "./transactions";

/**
 * Dashboard queries that are not money aggregates. Every income/spending
 * figure lives in src/lib/analytics/metrics.ts; balances come from
 * getBalanceSummary (accounts.ts).
 */

/**
 * The latest rows for the dashboard list, honouring the user's
 * hide-transfers preference exactly as the transactions page does.
 */
export async function getRecentTransactions(
  userId: string,
  { hideTransfers, limit = 8 }: { hideTransfers: boolean; limit?: number },
) {
  return searchTransactions(
    userId,
    { includeTransfers: !hideTransfers },
    { limit, offset: 0 },
  );
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

