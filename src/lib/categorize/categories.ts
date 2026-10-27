/**
 * The categories a suggestion can name: Plaid's PFC v2 primaries (pure; safe
 * on server and client). The model's structured output is an enum of these
 * plus "uncertain", so it cannot invent a category.
 */

import { z } from "zod";

export const PLAID_PRIMARIES = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_DISBURSEMENTS",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
  "OTHER",
] as const;

export type PlaidPrimary = (typeof PLAID_PRIMARIES)[number];

export const UNCERTAIN = "uncertain" as const;

export const plaidPrimarySchema = z.enum(PLAID_PRIMARIES);

/** What the model may answer for one transaction. */
export const suggestedCategorySchema = z.enum([...PLAID_PRIMARIES, UNCERTAIN]);

export function isPlaidPrimary(value: string | null | undefined): value is PlaidPrimary {
  return plaidPrimarySchema.safeParse(value).success;
}

/** Plaid confidence levels low enough to ask the model about. */
export const LOW_CONFIDENCE_LEVELS = ["LOW", "UNKNOWN", "MEDIUM"] as const;
