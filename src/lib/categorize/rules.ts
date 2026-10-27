/**
 * Category override rules (category_rules), the category twin of
 * spending_rules: keyed by normalized merchant or name signature, merchant
 * first. Rules write custom_category with source 'rule' and never touch a
 * category the user set by hand or accepted from a suggestion.
 *
 * Rules run before any model call (suggest.ts) and after every sync
 * (plaid/post-process.ts), so a transaction a rule covers never reaches the
 * model.
 */

import { and, eq, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { categoryRules } from "@/lib/db/schema/categorize";
import { transactions } from "@/lib/db/schema/transactions";
import { recomputeUserFlowsLocked } from "@/lib/analytics/apply-flow-classes";
import { applySpendingClassifications } from "@/lib/spending/classify";
import type { PlaidPrimary } from "./categories";

const ID_CHUNK = 500;

function rowsOf(result: unknown): Array<{ id: string }> {
  return Array.isArray(result) ? result : ((result as { rows?: Array<{ id: string }> }).rows ?? []);
}

/**
 * Derive custom_category from the rules for the user's rule-owned and
 * uncategorized rows (all of them, or just `transactionIds`). A rule-owned
 * row whose rule is gone goes back to Plaid's category. Only changed rows are
 * written. Returns their ids (the caller recomputes flows for them).
 */
export async function applyCategoryRules(
  userId: string,
  transactionIds?: string[],
  executor: DbExecutor = db,
): Promise<string[]> {
  if (transactionIds && transactionIds.length === 0) return [];
  const chunks = transactionIds
    ? Array.from({ length: Math.ceil(transactionIds.length / ID_CHUNK) }, (_, i) =>
        transactionIds.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK),
      )
    : [null];

  const changed: string[] = [];
  for (const ids of chunks) {
    const idFilter = ids ? sql`AND c.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql``;
    const result = await executor.execute<{ id: string }>(sql`
      UPDATE ${transactions} AS t
      SET custom_category = d.category,
          custom_category_source = CASE WHEN d.category IS NULL THEN NULL ELSE 'rule' END
      FROM (
        SELECT c.id, COALESCE(mr.category, sr.category) AS category
        FROM ${transactions} AS c
        LEFT JOIN ${categoryRules} AS mr
          ON mr.user_id = c.user_id AND mr.match_type = 'merchant'
         AND mr.match_value = c.normalized_merchant
        LEFT JOIN ${categoryRules} AS sr
          ON sr.user_id = c.user_id AND sr.match_type = 'name_signature'
         AND sr.match_value = c.name_signature
        WHERE c.user_id = ${userId}
          AND (c.custom_category IS NULL OR c.custom_category_source = 'rule')
          ${idFilter}
      ) AS d
      WHERE t.id = d.id
        AND (t.custom_category, t.custom_category_source) IS DISTINCT FROM
            (d.category, CASE WHEN d.category IS NULL THEN NULL ELSE 'rule' END)
      RETURNING t.id
    `);
    changed.push(...rowsOf(result).map((r) => r.id));
  }
  return changed;
}

export type CategoryRuleKey = { matchType: "merchant" | "name_signature"; matchValue: string };

/** The rule key a transaction would match: its merchant, else its name signature. */
export async function ruleKeyForTransaction(
  userId: string,
  transactionId: string,
  executor: DbExecutor = db,
): Promise<CategoryRuleKey | null> {
  const [row] = await executor
    .select({ merchant: transactions.normalizedMerchant, signature: transactions.nameSignature })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
    .limit(1);
  if (row?.merchant) return { matchType: "merchant", matchValue: row.merchant };
  if (row?.signature) return { matchType: "name_signature", matchValue: row.signature };
  return null;
}

export async function upsertCategoryRule(
  userId: string,
  key: CategoryRuleKey,
  category: PlaidPrimary,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .insert(categoryRules)
    .values({ userId, ...key, category })
    .onConflictDoUpdate({
      target: [categoryRules.userId, categoryRules.matchType, categoryRules.matchValue],
      set: { category, updatedAt: new Date() },
    });
}

export async function listCategoryRules(userId: string) {
  return db
    .select({
      id: categoryRules.id,
      matchType: categoryRules.matchType,
      matchValue: categoryRules.matchValue,
      category: categoryRules.category,
    })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId))
    .orderBy(categoryRules.matchValue);
}

/** Delete one of the user's rules and release the rows it categorized. */
export async function deleteCategoryRule(userId: string, ruleId: string): Promise<{ found: boolean; changedIds: string[] }> {
  const deleted = await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, ruleId), eq(categoryRules.userId, userId)))
    .returning({ id: categoryRules.id });
  if (deleted.length === 0) return { found: false, changedIds: [] };
  return { found: true, changedIds: await applyCategoryRules(userId) };
}

/**
 * A category is an input to flow classification: recompute the user's flows
 * after categories change, then the spending types of rows whose class moved
 * (as the transaction edit action does).
 */
export async function recomputeAfterCategoryChange(userId: string, changedIds: string[]): Promise<void> {
  const result = await recomputeUserFlowsLocked(userId);
  const ids = [...new Set([...changedIds, ...result.changedIds])];
  if (ids.length > 0) await applySpendingClassifications(userId, ids);
}
