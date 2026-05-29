import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";

/**
 * Plaid personal-finance-category primaries that represent spending. A negative
 * (money-in) transaction in one of these categories is a refund/reversal of a
 * purchase rather than genuine income. INCOME, TRANSFER_IN, TRANSFER_OUT and
 * LOAN_DISBURSEMENTS are deliberately excluded — negative amounts there are real
 * inflows (income, transfers, loan proceeds), not refunds. OTHER and null are
 * also excluded to avoid misclassifying ambiguous inflows.
 */
export const REFUND_SPENDING_PRIMARIES = [
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "RENT_AND_UTILITIES",
  "TRANSPORTATION",
  "TRAVEL",
  "LOAN_PAYMENTS",
];

/**
 * Flags refunds — negative-amount transactions sitting in a spending category —
 * so they're excluded from income and netted against expenses. Idempotent and
 * additive: it only touches rows where refund_source IS NULL, so a user's manual
 * decision (refund_source = 'manual') is never overwritten. Transfers must be
 * flagged first (see detectAndFlagTransfers) so CC payments are not caught here.
 */
export async function detectAndFlagRefunds(userId: string): Promise<number> {
  const updated = await db
    .update(transactions)
    .set({ isRefund: true, refundSource: "auto" })
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.refundSource),
        eq(transactions.isTransfer, false),
        sql`${transactions.amount}::numeric < 0`,
        inArray(transactions.category, REFUND_SPENDING_PRIMARIES),
      ),
    )
    .returning({ id: transactions.id });
  return updated.length;
}
