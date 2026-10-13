/**
 * Budget arithmetic in integer cents, so "over budget" is decided on exact
 * values: 100.40 spent of 100.00 is over, even though it rounds to 100%.
 */

export type BudgetStatus = "under" | "near" | "over";

/** Share of the budget used, unrounded (100.4 means 100.4%). 0 for a non-positive budget. */
export function calculateBudgetPercentage(spent: number, budgeted: number): number {
  if (!(budgeted > 0)) return 0;
  return (spent / budgeted) * 100;
}

/** Percentage label that never shows 100% while under budget or while over it. */
export function formatBudgetPercentage(spent: number, budgeted: number): string {
  const pct = calculateBudgetPercentage(Math.max(0, spent), budgeted);
  const over = Math.round(spent * 100) > Math.round(budgeted * 100);
  return `${over ? Math.ceil(pct) : Math.floor(pct)}%`;
}

const NEAR_THRESHOLD = 0.85;

export function budgetStatus(spent: number, budgeted: number): BudgetStatus {
  const spentCents = Math.round(spent * 100);
  const budgetCents = Math.round(budgeted * 100);
  if (spentCents > budgetCents) return "over";
  if (budgetCents > 0 && spentCents >= budgetCents * NEAR_THRESHOLD) return "near";
  return "under";
}
