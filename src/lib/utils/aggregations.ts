/**
 * Pure aggregation helpers for dashboard widget calculations.
 * Convention: positive transaction amounts are expenses, negative are income (Plaid convention).
 */

export interface PeriodTotals {
  income: number;
  expenses: number;
}

export function aggregateIncomeAndExpenses(
  txns: ReadonlyArray<{ amount: string }>,
): PeriodTotals {
  let income = 0;
  let expenses = 0;
  for (const t of txns) {
    const amount = parseFloat(t.amount);
    if (amount > 0) {
      expenses += amount;
    } else if (amount < 0) {
      income += Math.abs(amount);
    }
  }
  return {
    income: Math.round(income * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
  };
}

/**
 * Returns savings rate as an integer percent (matching the dashboard's display rounding).
 * Returns null when there is no income — caller should render "—" or similar.
 */
export function calculateSavingsRate(
  income: number,
  expenses: number,
): number | null {
  if (income <= 0) return null;
  return Math.round(((income - expenses) / income) * 100);
}
