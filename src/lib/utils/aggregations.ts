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

export interface SpendingTypeTotals {
  necessary: number;
  discretionary: number;
  unclassified: number;
  totalExpenses: number;
  income: number;
}

export function aggregateBySpendingType(
  txns: ReadonlyArray<{ amount: string; spendingType?: string | null }>,
): SpendingTypeTotals {
  let necessary = 0;
  let discretionary = 0;
  let unclassified = 0;
  let income = 0;
  for (const t of txns) {
    const amount = parseFloat(t.amount);
    if (amount < 0) {
      income += Math.abs(amount);
      continue;
    }
    if (amount <= 0) continue;
    if (t.spendingType === "necessary") necessary += amount;
    else if (t.spendingType === "discretionary") discretionary += amount;
    else unclassified += amount;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    necessary: round(necessary),
    discretionary: round(discretionary),
    unclassified: round(unclassified),
    totalExpenses: round(necessary + discretionary + unclassified),
    income: round(income),
  };
}

export interface SpendingTypePercentages {
  necessary: number | null;
  discretionary: number | null;
  unclassified: number | null;
}

export function spendingTypePercentagesOfIncome(
  totals: SpendingTypeTotals,
): SpendingTypePercentages {
  if (totals.income <= 0) {
    return { necessary: null, discretionary: null, unclassified: null };
  }
  const pct = (n: number) => Math.round((n / totals.income) * 100);
  return {
    necessary: pct(totals.necessary),
    discretionary: pct(totals.discretionary),
    unclassified: pct(totals.unclassified),
  };
}
