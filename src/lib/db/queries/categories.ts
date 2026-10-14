import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "..";
import { transactions } from "../schema";
import {
  builtInBudgetOptions,
  isBuiltInBudgetKey,
  type BudgetCategoryOption,
} from "@/lib/budgets/categories";

/** The user's own custom category labels (from their transactions). */
export async function getUserCustomCategories(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: transactions.customCategory })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), isNotNull(transactions.customCategory)),
    )
    .orderBy(transactions.customCategory);
  // Keep the stored value verbatim: it is matched exactly against
  // custom_category by spendBucketSql.
  return rows
    .map((r) => r.category ?? "")
    .filter((c) => c.trim().length > 0 && !isBuiltInBudgetKey(c));
}

/** Picker options: Plaid spending categories, synthetic buckets, then the user's custom categories. */
export async function getBudgetCategoryOptions(
  userId: string,
): Promise<BudgetCategoryOption[]> {
  const custom = await getUserCustomCategories(userId);
  return [
    ...builtInBudgetOptions(),
    ...custom.map((key) => ({ key, label: key, group: "custom" as const })),
  ];
}

/**
 * A budget key is valid for this user when it is a built-in bucket or one of
 * the user's own custom categories. Keys are only ever matched against the
 * user's own transactions, so there is no cross-user reference to leak.
 */
export async function isAllowedBudgetKey(userId: string, key: string): Promise<boolean> {
  if (isBuiltInBudgetKey(key)) return true;
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.customCategory, key)))
    .limit(1);
  return !!row;
}
