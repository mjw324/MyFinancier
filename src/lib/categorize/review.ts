/**
 * The category review queue. A suggestion changes nothing until the user
 * accepts it here; accepting writes custom_category (source 'suggestion'),
 * optionally saves a rule for the merchant, and recomputes flows.
 */

import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { categorySuggestions } from "@/lib/db/schema/categorize";
import type { PlaidPrimary } from "./categories";
import {
  applyCategoryRules,
  recomputeAfterCategoryChange,
  ruleKeyForTransaction,
  upsertCategoryRule,
} from "./rules";

/** Suggestions that agree with the bank's own category leave nothing to decide. */
const differsFromBank = sql`${categorySuggestions.suggested} IS DISTINCT FROM ${transactions.category}`;

export interface ReviewItem {
  id: string;
  transactionId: string;
  /** Null: the model was uncertain; the user picks. */
  suggested: string | null;
  date: Date;
  name: string;
  merchantName: string | null;
  amount: string;
  /** Plaid's category, shown for comparison. */
  plaidCategory: string | null;
}

/**
 * Pending suggestions whose transaction is still uncategorized by the user
 * (a later hand edit or rule quietly takes the row out of the queue).
 */
export async function listReviewQueue(userId: string, limit = 100): Promise<ReviewItem[]> {
  return db
    .select({
      id: categorySuggestions.id,
      transactionId: categorySuggestions.transactionId,
      suggested: categorySuggestions.suggested,
      date: transactions.date,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amount: transactions.amount,
      plaidCategory: transactions.category,
    })
    .from(categorySuggestions)
    .innerJoin(transactions, eq(transactions.id, categorySuggestions.transactionId))
    .where(
      and(
        eq(categorySuggestions.userId, userId),
        eq(transactions.userId, userId),
        eq(categorySuggestions.status, "pending"),
        isNull(transactions.customCategory),
        differsFromBank,
      ),
    )
    .orderBy(desc(transactions.date), desc(categorySuggestions.id))
    .limit(limit);
}

export type DecideResult = { ok: true } | { ok: false; error: "not_found" | "already_categorized" };

export async function acceptSuggestion(input: {
  userId: string;
  suggestionId: string;
  category: PlaidPrimary;
  /** Also save a rule for this merchant, so future rows skip the model. */
  rememberForMerchant: boolean;
  now?: Date;
}): Promise<DecideResult> {
  const { userId } = input;
  const now = input.now ?? new Date();
  const outcome = await db.transaction(async (tx) => {
    const [s] = await tx
      .select({ transactionId: categorySuggestions.transactionId })
      .from(categorySuggestions)
      .where(
        and(
          eq(categorySuggestions.id, input.suggestionId),
          eq(categorySuggestions.userId, userId),
          eq(categorySuggestions.status, "pending"),
        ),
      )
      .for("update");
    if (!s) return { ok: false as const, error: "not_found" as const };

    // Only a row nobody categorized since (a rule's category may be replaced:
    // the user is choosing for this row).
    const updated = await tx
      .update(transactions)
      .set({ customCategory: input.category, customCategorySource: "suggestion" })
      .where(
        and(
          eq(transactions.id, s.transactionId),
          eq(transactions.userId, userId),
          or(isNull(transactions.customCategory), eq(transactions.customCategorySource, "rule")),
        ),
      )
      .returning({ id: transactions.id });

    await tx
      .update(categorySuggestions)
      .set(
        updated.length > 0
          ? { status: "accepted", acceptedCategory: input.category, decidedAt: now }
          : { status: "rejected", decidedAt: now },
      )
      .where(eq(categorySuggestions.id, input.suggestionId));
    if (updated.length === 0) return { ok: false as const, error: "already_categorized" as const };

    const changed = [s.transactionId];
    if (input.rememberForMerchant) {
      const key = await ruleKeyForTransaction(userId, s.transactionId, tx);
      if (key) {
        await upsertCategoryRule(userId, key, input.category, tx);
        changed.push(...(await applyCategoryRules(userId, undefined, tx)));
      }
    }
    return { ok: true as const, changed };
  });

  if (!outcome.ok) return outcome;
  await recomputeAfterCategoryChange(userId, outcome.changed);
  return { ok: true };
}

export async function rejectSuggestion(userId: string, suggestionId: string, now: Date = new Date()): Promise<DecideResult> {
  const updated = await db
    .update(categorySuggestions)
    .set({ status: "rejected", decidedAt: now })
    .where(
      and(
        eq(categorySuggestions.id, suggestionId),
        eq(categorySuggestions.userId, userId),
        eq(categorySuggestions.status, "pending"),
      ),
    )
    .returning({ id: categorySuggestions.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

export async function countPendingSuggestions(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(categorySuggestions)
    .innerJoin(transactions, eq(transactions.id, categorySuggestions.transactionId))
    .where(
      and(
        eq(categorySuggestions.userId, userId),
        eq(categorySuggestions.status, "pending"),
        isNull(transactions.customCategory),
        differsFromBank,
      ),
    );
  return row?.n ?? 0;
}
