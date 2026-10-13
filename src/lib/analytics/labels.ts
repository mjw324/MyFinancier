/**
 * Display labels and number formatting for analytics figures.
 *
 * Pure and dependency-free so client components can import it (metrics.ts
 * and flow.ts pull in the database schema). Percentages arrive as unrounded
 * ratios and are rounded here, once.
 */

import { formatCategory } from "@/lib/utils/format";

/** Labels for the synthetic spending buckets defined in flow.ts. */
export const SYNTHETIC_BUCKET_LABELS: Record<string, string> = {
  CASH_WITHDRAWALS: "Cash withdrawals",
  SENT_TO_PEOPLE: "Sent to people",
  REIMBURSEMENTS: "Reimbursements",
  REWARDS: "Rewards & cashback",
  UNCATEGORIZED: "Uncategorized",
};

export function bucketLabel(bucket: string): string {
  return SYNTHETIC_BUCKET_LABELS[bucket] ?? formatCategory(bucket);
}

export const FLOW_GROUP_LABELS = {
  income: "Money in",
  spending: "Spending",
  offset: "Refunds & reimbursements",
  savings: "Saved / moved",
  internal: "Between your accounts",
} as const;

/** "$1,234" (whole dollars from $100), "$12.50" below. */
export function formatMoneyShort(n: number): string {
  const abs = Math.abs(n);
  const digits = abs < 100 ? 2 : 0;
  return `$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** A ratio as a whole percent of its magnitude: 0.4951 → "50%". */
export function formatRatio(ratio: number): string {
  return `${Math.round(Math.abs(ratio) * 100)}%`;
}

/** Signed percent change: 0.123 → "+12%", -0.04 → "−4%". */
export function formatSignedRatio(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (pct === 0) return "0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/**
 * A change between two rates in percentage points: 0.4951 → 0.5049 is
 * "+1.0 pts", not "+2%" and not "0" (rounding each rate first hid it).
 */
export function formatPointsDelta(fromRatio: number, toRatio: number): string {
  const pts = (toRatio - fromRatio) * 100;
  const abs = Math.abs(pts);
  const shown = abs < 10 ? abs.toFixed(1) : String(Math.round(abs));
  if (Number(shown) === 0) return "0 pts";
  return `${pts > 0 ? "+" : "−"}${shown} pts`;
}
