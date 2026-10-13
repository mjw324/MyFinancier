import { applySpendingClassifications } from "@/lib/spending/classify";
import { detectAndFlagRefunds } from "./refunds";
import { detectAndFlagTransfers } from "./transfers";

/**
 * Post-sync classification hook, called once after a sync's writes commit.
 *
 * Contract (the classification workstream owns the implementation):
 * - Idempotent, and safe to run concurrently for the same user.
 * - Classifies `touchedIds` and also any of the user's rows whose
 *   flow_class IS NULL, so a run that failed or was killed heals on the next
 *   call.
 * - Never overwrites user-owned (manual) classifications.
 *
 * Interim body: the legacy transfer/refund/spending-type passes.
 */
export async function postProcessTransactions(
  userId: string,
  touchedIds: string[],
): Promise<void> {
  await detectAndFlagTransfers(userId);
  await detectAndFlagRefunds(userId);
  if (touchedIds.length > 0) {
    await applySpendingClassifications(userId, touchedIds);
  }
}
