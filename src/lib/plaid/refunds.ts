/**
 * Refund detection used to live here: it flagged every negative-amount row
 * in a "spending" category as a refund. That rule over-flagged loan-account
 * payments (LOAN_PAYMENTS was in its list) and bank deposits, and disagreed
 * with transfer detection (verify-calcs 3.5/3.7, harness finding).
 *
 * Refunds are now a flow class (`refund`, plus `reimbursement` and
 * `card_reward` in the same "offset" group), assigned by the classifier in
 * src/lib/analytics/flow-classify.ts. `is_refund` / `refund_source` are
 * derived from the flow class by apply-flow-classes.ts (legacyFlagsFor), and
 * a user's refund decision is a manual flow class.
 */

/**
 * @deprecated Kept so older callers still compile. Refund flags are written
 * by the flow-classification pass (`postProcessTransactions`), so this is a
 * no-op that reports nothing flagged.
 */
export async function detectAndFlagRefunds(userId: string): Promise<number> {
  void userId;
  return 0;
}
