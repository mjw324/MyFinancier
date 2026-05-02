import { isLiabilityType } from "./account-type";

export type Numeric = string | number | null | undefined;

function toNumber(v: Numeric): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Projected balance for a single account.
 *
 * Transactions follow Plaid's sign convention: amount > 0 = money out (expense),
 * amount < 0 = money in (income).
 *
 * - Depository: projected = currentBalance - Σ(pending.amount)
 *   (pending charge reduces, pending deposit increases)
 * - Credit / loan: currentBalance is amount owed.
 *   projectedOwed = currentBalance + Σ(pending.amount)
 *   (pending charge raises owed; pending refund — negative — reduces it)
 */
export function projectedBalance(
  type: string,
  currentBalance: Numeric,
  pendingSum: Numeric,
): number {
  const cb = toNumber(currentBalance);
  const ps = toNumber(pendingSum);
  return isLiabilityType(type) ? cb + ps : cb - ps;
}

/**
 * Net-worth contribution for one account at a given balance.
 * Liabilities subtract; assets add.
 */
export function netWorthContribution(type: string, balance: Numeric): number {
  const n = toNumber(balance);
  return isLiabilityType(type) ? -n : n;
}

/**
 * Sums the `amount` field across pending transactions.
 * Accepts a row shape compatible with both numeric and string amounts.
 */
export function sumPendingAmount(
  txns: ReadonlyArray<{ amount: Numeric; pending?: boolean | null }>,
): number {
  let s = 0;
  for (const t of txns) {
    if (t.pending === false) continue;
    s += toNumber(t.amount);
  }
  return s;
}
