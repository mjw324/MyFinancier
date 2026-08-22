import { and, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { TransactionStream } from "plaid";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { decrypt } from "@/lib/utils/encryption";
import { applySpendingClassifications } from "@/lib/spending/classify";
import { plaidClient } from "./client";

type FlowType = "inflow" | "outflow";

export interface FetchRecurringResult {
  upserted: number;
  deactivated: number;
  linkedTransactions: number;
  backfilledOrphans: number;
}

const ORPHAN_AMOUNT_TOLERANCE = 0.2;

export async function fetchRecurringTransactions(
  plaidItemRowId: string,
): Promise<FetchRecurringResult> {
  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, plaidItemRowId),
  });
  if (!item) throw new Error(`Plaid item not found: ${plaidItemRowId}`);

  const accessToken = decrypt(item.accessToken);

  const response = await plaidClient.transactionsRecurringGet({
    access_token: accessToken,
  });
  const { inflow_streams, outflow_streams, updated_datetime } = response.data;

  const accounts = await db.query.financialAccounts.findMany({
    where: eq(financialAccounts.plaidItemId, plaidItemRowId),
  });
  const accountByPlaidId = new Map(accounts.map((a) => [a.plaidAccountId, a]));

  const tagged: Array<{ stream: TransactionStream; flowType: FlowType }> = [
    ...inflow_streams.map((s) => ({ stream: s, flowType: "inflow" as const })),
    ...outflow_streams.map((s) => ({
      stream: s,
      flowType: "outflow" as const,
    })),
  ];

  const updatedAt = new Date(updated_datetime);

  const rows: (typeof recurringStreams.$inferInsert)[] = [];
  for (const { stream, flowType } of tagged) {
    const account = accountByPlaidId.get(stream.account_id);
    if (!account) continue;

    rows.push({
      streamId: stream.stream_id,
      userId: item.userId,
      plaidItemId: item.id,
      accountId: account.id,
      flowType,
      description: stream.description,
      merchantName: stream.merchant_name ?? null,
      frequency: stream.frequency,
      status: stream.status,
      isActive: stream.is_active,
      firstDate: stream.first_date ? new Date(stream.first_date) : null,
      lastDate: stream.last_date ? new Date(stream.last_date) : null,
      predictedNextDate: stream.predicted_next_date
        ? new Date(stream.predicted_next_date)
        : null,
      averageAmount: (stream.average_amount.amount ?? 0).toString(),
      lastAmount: (stream.last_amount.amount ?? 0).toString(),
      isoCurrencyCode:
        stream.last_amount.iso_currency_code ??
        stream.average_amount.iso_currency_code ??
        stream.last_amount.unofficial_currency_code ??
        "USD",
      pfcPrimary: stream.personal_finance_category?.primary ?? null,
      pfcDetailed: stream.personal_finance_category?.detailed ?? null,
      pfcConfidenceLevel:
        stream.personal_finance_category?.confidence_level ?? null,
      plaidUpdatedDatetime: updatedAt,
    });
  }

  let upserted = 0;
  if (rows.length > 0) {
    await db
      .insert(recurringStreams)
      .values(rows)
      .onConflictDoUpdate({
        target: recurringStreams.streamId,
        set: {
          flowType: sql`excluded.flow_type`,
          description: sql`excluded.description`,
          merchantName: sql`excluded.merchant_name`,
          frequency: sql`excluded.frequency`,
          status: sql`excluded.status`,
          isActive: sql`excluded.is_active`,
          firstDate: sql`excluded.first_date`,
          lastDate: sql`excluded.last_date`,
          predictedNextDate: sql`excluded.predicted_next_date`,
          averageAmount: sql`excluded.average_amount`,
          lastAmount: sql`excluded.last_amount`,
          isoCurrencyCode: sql`excluded.iso_currency_code`,
          pfcPrimary: sql`excluded.pfc_primary`,
          pfcDetailed: sql`excluded.pfc_detailed`,
          pfcConfidenceLevel: sql`excluded.pfc_confidence_level`,
          plaidUpdatedDatetime: sql`excluded.plaid_updated_datetime`,
          updatedAt: new Date(),
        },
      });
    upserted = rows.length;
  }

  const seenStreamIds = rows.map((r) => r.streamId);
  const deactivateResult = seenStreamIds.length
    ? await db
        .update(recurringStreams)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(recurringStreams.plaidItemId, plaidItemRowId),
            eq(recurringStreams.isActive, true),
            notInArray(recurringStreams.streamId, seenStreamIds),
          ),
        )
        .returning({ id: recurringStreams.streamId })
    : await db
        .update(recurringStreams)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(recurringStreams.plaidItemId, plaidItemRowId),
            eq(recurringStreams.isActive, true),
          ),
        )
        .returning({ id: recurringStreams.streamId });

  // Fetch current custom overrides per stream (for backfill onto linked txs)
  const streamOverrides = new Map<
    string,
    { customName: string | null; customCategory: string | null }
  >();
  if (seenStreamIds.length > 0) {
    const overrideRows = await db
      .select({
        streamId: recurringStreams.streamId,
        customName: recurringStreams.customName,
        customCategory: recurringStreams.customCategory,
      })
      .from(recurringStreams)
      .where(inArray(recurringStreams.streamId, seenStreamIds));
    for (const row of overrideRows) {
      streamOverrides.set(row.streamId, {
        customName: row.customName,
        customCategory: row.customCategory,
      });
    }
  }

  let linked = 0;
  const touchedIds = new Set<string>();
  for (const { stream } of tagged) {
    if (stream.transaction_ids.length === 0) continue;
    const overrides = streamOverrides.get(stream.stream_id);
    const updateSet: Partial<typeof transactions.$inferInsert> = {
      recurringStreamId: stream.stream_id,
    };
    if (overrides?.customName != null) updateSet.customName = overrides.customName;
    if (overrides?.customCategory != null)
      updateSet.customCategory = overrides.customCategory;

    for (const chunk of chunk100(stream.transaction_ids)) {
      const result = await db
        .update(transactions)
        .set(updateSet)
        .where(
          and(
            eq(transactions.userId, item.userId),
            inArray(transactions.plaidTransactionId, chunk),
          ),
        )
        .returning({ id: transactions.id });
      linked += result.length;
      for (const r of result) touchedIds.add(r.id);
    }
  }

  const orphanResult = await linkOrphanTransactions(item.userId, plaidItemRowId);
  for (const id of orphanResult.touchedIds) touchedIds.add(id);

  if (touchedIds.size > 0) {
    await applySpendingClassifications(item.userId, [...touchedIds]);
  }

  return {
    upserted,
    deactivated: deactivateResult.length,
    linkedTransactions: linked,
    backfilledOrphans: orphanResult.count,
  };
}

/**
 * Plaid often excludes early occurrences (before the stream's first_date)
 * from a stream's transaction_ids. This linker rescues those orphans by
 * matching unlinked transactions to active streams on:
 *   - same account
 *   - same merchant_name (case-insensitive)
 *   - amount within 20% of the stream's average_amount
 *   - matching sign for inflow/outflow
 *   - date strictly before the stream's first_date
 * When a match is found, the stream's customName/customCategory are also
 * propagated onto the orphan tx.
 */
async function linkOrphanTransactions(
  userId: string,
  plaidItemRowId: string,
): Promise<{ count: number; touchedIds: string[] }> {
  const streams = await db
    .select({
      streamId: recurringStreams.streamId,
      accountId: recurringStreams.accountId,
      merchantName: recurringStreams.merchantName,
      averageAmount: recurringStreams.averageAmount,
      flowType: recurringStreams.flowType,
      firstDate: recurringStreams.firstDate,
      customName: recurringStreams.customName,
      customCategory: recurringStreams.customCategory,
    })
    .from(recurringStreams)
    .where(
      and(
        eq(recurringStreams.userId, userId),
        eq(recurringStreams.plaidItemId, plaidItemRowId),
        eq(recurringStreams.isActive, true),
      ),
    );

  let backfilled = 0;
  const touchedIds: string[] = [];
  for (const stream of streams) {
    if (!stream.merchantName || !stream.firstDate) continue;
    const avg = Number(stream.averageAmount);
    if (!Number.isFinite(avg) || avg === 0) continue;

    const tolerance = Math.abs(avg) * ORPHAN_AMOUNT_TOLERANCE;
    const minAmount = avg - tolerance;
    const maxAmount = avg + tolerance;
    // outflow stores positive amount, inflow stores negative
    const signCondition =
      stream.flowType === "inflow"
        ? sql`${transactions.amount}::numeric < 0`
        : sql`${transactions.amount}::numeric > 0`;

    const updateSet: Partial<typeof transactions.$inferInsert> = {
      recurringStreamId: stream.streamId,
    };
    if (stream.customName != null) updateSet.customName = stream.customName;
    if (stream.customCategory != null)
      updateSet.customCategory = stream.customCategory;

    const updated = await db
      .update(transactions)
      .set(updateSet)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, stream.accountId),
          sql`${transactions.recurringStreamId} IS NULL`,
          sql`LOWER(${transactions.merchantName}) = LOWER(${stream.merchantName})`,
          lt(transactions.date, stream.firstDate),
          sql`ABS(${transactions.amount}::numeric) BETWEEN ${Math.abs(minAmount)} AND ${Math.abs(maxAmount)}`,
          signCondition,
        ),
      )
      .returning({ id: transactions.id });

    backfilled += updated.length;
    for (const u of updated) touchedIds.push(u.id);
  }

  return { count: backfilled, touchedIds };
}

function chunk100<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 100) out.push(arr.slice(i, i + 100));
  return out;
}
