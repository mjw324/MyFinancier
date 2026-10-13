/**
 * Budgetable spending buckets (pure; safe on server and client).
 *
 * A budget's key is a value of `spendBucketSql` (src/lib/analytics/flow.ts):
 * a Plaid personal-finance-category primary, a synthetic bucket for cash
 * withdrawals / payments to people, or a user's custom category (which always
 * wins over the Plaid category on that transaction).
 */

import { SYNTHETIC_BUCKETS, UNCATEGORIZED_BUCKET } from "@/lib/analytics/flow";

/** Plaid PFC primaries that represent spending, with human labels. */
export const SPENDING_CATEGORY_LABELS: Record<string, string> = {
  FOOD_AND_DRINK: "Food & drink",
  GENERAL_MERCHANDISE: "Shopping",
  RENT_AND_UTILITIES: "Rent & utilities",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  ENTERTAINMENT: "Entertainment",
  PERSONAL_CARE: "Personal care",
  MEDICAL: "Medical",
  HOME_IMPROVEMENT: "Home improvement",
  GENERAL_SERVICES: "Services",
  GOVERNMENT_AND_NON_PROFIT: "Government & non-profit",
  BANK_FEES: "Bank fees",
  LOAN_PAYMENTS: "Loan payments",
  OTHER: "Other",
};

/** Synthetic spending buckets a budget can track. */
export const SYNTHETIC_SPEND_LABELS: Record<string, string> = {
  [SYNTHETIC_BUCKETS.cash_withdrawal]: "Cash withdrawals",
  [SYNTHETIC_BUCKETS.p2p_payment]: "Sent to people",
};

export const BUILT_IN_BUDGET_KEYS: readonly string[] = [
  ...Object.keys(SPENDING_CATEGORY_LABELS),
  ...Object.keys(SYNTHETIC_SPEND_LABELS),
];

export function isBuiltInBudgetKey(key: string): boolean {
  return BUILT_IN_BUDGET_KEYS.includes(key);
}

/** Human label for a spending bucket; custom categories are shown as typed. */
export function spendBucketLabel(key: string): string {
  if (key === UNCATEGORIZED_BUCKET) return "Uncategorized";
  return SPENDING_CATEGORY_LABELS[key] ?? SYNTHETIC_SPEND_LABELS[key] ?? key;
}

export interface BudgetCategoryOption {
  key: string;
  label: string;
  group: "category" | "custom" | "other";
}

export function builtInBudgetOptions(): BudgetCategoryOption[] {
  return [
    ...Object.entries(SPENDING_CATEGORY_LABELS).map(([key, label]) => ({
      key,
      label,
      group: "category" as const,
    })),
    ...Object.entries(SYNTHETIC_SPEND_LABELS).map(([key, label]) => ({
      key,
      label,
      group: "other" as const,
    })),
  ];
}
