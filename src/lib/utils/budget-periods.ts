/**
 * Budget period boundary helpers (monthly / weekly / yearly).
 * Used by `getBudgetProgress` to scope transactions to the active period.
 */

export type BudgetPeriod = "monthly" | "weekly" | "yearly" | string;

/** First instant of the active period for `now`. Falls back to `budgetStart`. */
export function getPeriodStart(period: BudgetPeriod, budgetStart: Date, now: Date): Date {
  switch (period) {
    case "monthly":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "weekly": {
      // Week starts Monday (Plaid/banking convention).
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(now.getFullYear(), now.getMonth(), diff);
    }
    case "yearly":
      return new Date(now.getFullYear(), 0, 1);
    default:
      return budgetStart;
  }
}

/** Last instant of the period that begins at `start`. */
export function getPeriodEnd(period: BudgetPeriod, start: Date): Date {
  switch (period) {
    case "monthly":
      return new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
    case "weekly":
      return new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + 6,
        23, 59, 59,
      );
    case "yearly":
      return new Date(start.getFullYear(), 11, 31, 23, 59, 59);
    default:
      return new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
  }
}
