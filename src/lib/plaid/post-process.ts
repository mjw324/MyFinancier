import { db } from "@/lib/db";
import { applySpendingClassifications } from "@/lib/spending/classify";
import { applyCategoryRules } from "@/lib/categorize/rules";
import {
  lockUserFlows,
  recomputeUserFlows,
  type RecomputeResult,
} from "@/lib/analytics/apply-flow-classes";

/**
 * Post-sync classification hook, called once after a sync's writes commit.
 *
 * - Transfer pairing and flow classification run in one transaction under a
 *   per-user advisory lock, so concurrent syncs of two items of the same user
 *   (or a sync racing a user override) never interleave.
 * - Recomputes the user's whole history (see apply-flow-classes.ts): that
 *   covers `touchedIds`, both legs of every new or cleared pair, and any row
 *   left with flow_class IS NULL by an earlier failed run (self-healing).
 *   Only rows whose values change are written, so it is idempotent.
 * - The user's category rules run first: a category is an input to flow
 *   classification, and a row a rule covers must never reach the model.
 * - Never overwrites user-owned (manual) classifications.
 * - Spending types (necessary/discretionary) are then derived for the
 *   touched rows and for rows whose transfer status changed.
 */
export async function postProcessTransactions(
  userId: string,
  touchedIds: string[],
): Promise<RecomputeResult> {
  await applyCategoryRules(userId, touchedIds);
  const result = await db.transaction(async (tx) => {
    await lockUserFlows(tx, userId);
    return recomputeUserFlows(tx, userId);
  });
  const spendingIds = [...new Set([...touchedIds, ...result.changedIds])];
  if (spendingIds.length > 0) {
    await applySpendingClassifications(userId, spendingIds);
  }
  return result;
}
