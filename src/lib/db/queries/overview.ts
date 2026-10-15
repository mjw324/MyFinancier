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

// Budgets live in ./budgets (W4); re-exported so existing imports keep working.
export { getBudgetProgress } from "./budgets";
