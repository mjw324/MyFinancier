import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";

const PFC_PRIMARY_TRANSFER = ["TRANSFER_IN", "TRANSFER_OUT"];
const PFC_DETAILED_CC_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

const PAIR_LOOKBACK_DAYS = 14;
const PAIR_DATE_TOLERANCE_DAYS = 3;

/**
 * Flags transfers between the user's own accounts so they're excluded from
 * income/expense rollups. Idempotent — safe to re-run on already-flagged rows.
 */
export async function detectAndFlagTransfers(userId: string): Promise<{
  flaggedByCategory: number;
  pairedCount: number;
}> {
  const flaggedByCategory = await flagByPlaidCategory(userId);
  const pairedCount = await pairOppositeSignTransactions(userId);
  return { flaggedByCategory, pairedCount };
}

async function flagByPlaidCategory(userId: string): Promise<number> {
  const updated = await db
    .update(transactions)
    .set({ isTransfer: true })
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.isTransfer, false),
        sql`(${transactions.category} IN ${PFC_PRIMARY_TRANSFER} OR ${transactions.categoryId} = ${PFC_DETAILED_CC_PAYMENT})`,
      ),
    )
    .returning({ id: transactions.id });
  return updated.length;
}

/**
 * Pairs unpaired transactions with an opposite-sign counterpart on a different
 * account within ±PAIR_DATE_TOLERANCE_DAYS. For each pair we set is_transfer
 * and a shared transfer_pair_id on both sides.
 */
async function pairOppositeSignTransactions(userId: string): Promise<number> {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - PAIR_LOOKBACK_DAYS);

  const candidates = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amount: transactions.amount,
      date: transactions.date,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.transferPairId),
        gte(transactions.date, lookbackDate),
      ),
    );

  if (candidates.length < 2) return 0;

  // Bucket by absolute amount for O(n) pairing.
  const byAbsAmount = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const key = absAmountKey(c.amount);
    if (key === null) continue;
    const list = byAbsAmount.get(key) ?? [];
    list.push(c);
    byAbsAmount.set(key, list);
  }

  const used = new Set<string>();
  const updates: Array<{ ids: [string, string]; pairId: string }> = [];

  for (const list of byAbsAmount.values()) {
    if (list.length < 2) continue;
    const positives = list.filter((t) => parseFloat(t.amount) > 0);
    const negatives = list.filter((t) => parseFloat(t.amount) < 0);

    for (const pos of positives) {
      if (used.has(pos.id)) continue;
      let best: (typeof negatives)[number] | null = null;
      let bestDistance = Infinity;
      for (const neg of negatives) {
        if (used.has(neg.id)) continue;
        if (neg.accountId === pos.accountId) continue;
        const distance = Math.abs(
          (pos.date.getTime() - neg.date.getTime()) / 86_400_000,
        );
        if (distance > PAIR_DATE_TOLERANCE_DAYS) continue;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = neg;
        }
      }
      if (best) {
        used.add(pos.id);
        used.add(best.id);
        updates.push({ ids: [pos.id, best.id], pairId: crypto.randomUUID() });
      }
    }
  }

  if (updates.length === 0) return 0;

  for (const { ids, pairId } of updates) {
    await db
      .update(transactions)
      .set({ isTransfer: true, transferPairId: pairId })
      .where(inArray(transactions.id, ids));
  }

  return updates.length * 2;
}

function absAmountKey(amount: string): string | null {
  const n = parseFloat(amount);
  if (!Number.isFinite(n) || n === 0) return null;
  return Math.abs(n).toFixed(2);
}
