export const LIABILITY_TYPES = ["credit", "loan"] as const;

export function isLiabilityType(type: string): boolean {
  return LIABILITY_TYPES.includes(type as (typeof LIABILITY_TYPES)[number]);
}
