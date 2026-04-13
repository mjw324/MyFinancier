export function calculateNetWorth(
  accounts: Array<{ currentBalance: string | null }>,
): number {
  return accounts.reduce((sum, account) => {
    const balance = account.currentBalance
      ? parseFloat(account.currentBalance)
      : 0;
    return sum + (isNaN(balance) ? 0 : balance);
  }, 0);
}

export function calculateBudgetPercentage(
  spent: number,
  budgeted: number,
): number {
  if (budgeted <= 0) return 0;
  return Math.round((spent / budgeted) * 100);
}
