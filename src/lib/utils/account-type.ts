export const LIABILITY_TYPES = ["credit", "loan"] as const;

export function isLiabilityType(type: string): boolean {
  return LIABILITY_TYPES.includes(type as (typeof LIABILITY_TYPES)[number]);
}

export function signedBalance(
  type: string,
  balance: string | number | null,
): number {
  const n = typeof balance === "string" ? parseFloat(balance) : (balance ?? 0);
  if (Number.isNaN(n)) return 0;
  return isLiabilityType(type) ? -n : n;
}
