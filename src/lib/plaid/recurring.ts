import { and, eq, notInArray, sql } from "drizzle-orm";
import type { TransactionStream } from "plaid";
import { db, type DbExecutor } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { decrypt } from "@/lib/utils/encryption";
import { applySpendingClassifications } from "@/lib/spending/classify";
import { plaidClient } from "./client";
import { lockItemForWrite } from "./sync-requests";
import { withTransientRetry } from "./sync";

type FlowType = "inflow" | "outflow";

export interface FetchRecurringResult {
  upserted: number;
  deactivated: number;
  /** Rows whose recurring_stream_id actually changed (Plaid's stream lists). */
  linkedTransactions: number;
  /** Earlier occurrences matched to a stream by merchant/amount/date. */
  backfilledOrphans: number;
  /** Streams skipped because their account is not (or no longer) on this item. */
  skippedStreams: number;
}

const ORPHAN_AMOUNT_TOLERANCE = 0.2;
const LINK_CHUNK = 1000;

/**
 * Fetch /transactions/recurring/get and apply it in one transaction under the
 * item's write lock. Only rows whose stream actually changes are written (and
 * reclassified), so an unchanged refresh costs a handful of statements instead
 * of rewriting every stream-linked row. Records recurring_fetched_at.
 *
 * Callers decide WHEN to fetch: on RECURRING_TRANSACTIONS_UPDATE, once after
 * the historical pull completes, or on a manual sync (see jobs.ts).
 */
export async function fetchRecurringTransactions(
  plaidItemRowId: string,
): Promise<FetchRecurringResult> {
  const [item] = await db
    .select({
      id: plaidItems.id,
      userId: plaidItems.userId,
      accessToken: plaidItems.accessToken,
      // DB clock at fetch start: a request stamped after this is not covered.
      fetchStartedAt: sql<string>`localtimestamp::text`,
    })
    .from(plaidItems)
    .where(eq(plaidItems.id, plaidItemRowId));
  if (!item) throw new Error(`Plaid item not found: ${plaidItemRowId}`);

  const response = await withTransientRetry(() =>
    plaidClient.transactionsRecurringGet({
      access_token: decrypt(item.accessToken),
    }),
  );
  const { inflow_streams, outflow_streams, updated_datetime } = response.data;

  const tagged: Array<{ stream: TransactionStream; flowType: FlowType }> = [
    ...inflow_streams.map((s: TransactionStream) => ({ stream: s, flowType: "inflow" as const })),
    ...outflow_streams.map((s: TransactionStream) => ({ stream: s, flowType: "outflow" as const })),
  ];

  return db.transaction((tx) =>
    applyRecurring(
      tx,
      { id: item.id, userId: item.userId },
      tagged,
      new Date(updated_datetime),
      item.fetchStartedAt,
    ),
  );
}

async function applyRecurring(
  tx: DbExecutor,
  item: { id: string; userId: string },
  tagged: Array<{ stream: TransactionStream; flowType: FlowType }>,
  plaidUpdatedAt: Date,
  fetchStartedAt: string,
): Promise<FetchRecurringResult> {
  await lockItemForWrite(tx, item.id);

  // The item may have been unlinked while we were talking to Plaid.
  const [stillThere] = await tx
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(eq(plaidItems.id, item.id));
  if (!stillThere) {
    return { upserted: 0, deactivated: 0, linkedTransactions: 0, backfilledOrphans: 0, skippedStreams: tagged.length };
  }

  const accounts = await tx
    .select({ id: financialAccounts.id, plaidAccountId: financialAccounts.plaidAccountId })
    .from(financialAccounts)
    .where(eq(financialAccounts.plaidItemId, item.id));
  const accountByPlaidId = new Map(accounts.map((a) => [a.plaidAccountId, a.id]));

  const known = tagged.filter(({ stream }) => accountByPlaidId.has(stream.account_id));
  const skippedStreams = tagged.length - known.length;

  const rows: (typeof recurringStreams.$inferInsert)[] = known.map(({ stream, flowType }) => ({
    streamId: stream.stream_id,
    userId: item.userId,
    plaidItemId: item.id,
    accountId: accountByPlaidId.get(stream.account_id)!,
    flowType,
    description: stream.description,
    merchantName: stream.merchant_name ?? null,
    frequency: stream.frequency,
    status: stream.status,
    isActive: stream.is_active,
    firstDate: stream.first_date ? new Date(stream.first_date) : null,
    lastDate: stream.last_date ? new Date(stream.last_date) : null,
    predictedNextDate: stream.predicted_next_date ? new Date(stream.predicted_next_date) : null,
    averageAmount: (stream.average_amount.amount ?? 0).toString(),
    lastAmount: (stream.last_amount.amount ?? 0).toString(),
    isoCurrencyCode:
      stream.last_amount.iso_currency_code ??
      stream.average_amount.iso_currency_code ??
      stream.last_amount.unofficial_currency_code ??
      "USD",
    pfcPrimary: stream.personal_finance_category?.primary ?? null,
    pfcDetailed: stream.personal_finance_category?.detailed ?? null,
    pfcConfidenceLevel: stream.personal_finance_category?.confidence_level ?? null,
    plaidUpdatedDatetime: plaidUpdatedAt,
  }));

  if (rows.length > 0) {
    await tx
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
        // A stream id is Plaid-global; never move another item's stream.
        setWhere: sql`${recurringStreams.plaidItemId} = excluded.plaid_item_id`,
      });
  }

  const seen = rows.map((r) => r.streamId);
  const deactivated = await tx
    .update(recurringStreams)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(recurringStreams.plaidItemId, item.id),
        eq(recurringStreams.isActive, true),
        ...(seen.length > 0 ? [notInArray(recurringStreams.streamId, seen)] : []),
      ),
    )
    .returning({ id: recurringStreams.streamId });

  // Link Plaid's transaction ids to their stream — only rows whose stream
  // changes are written. Newly linked rows inherit the stream's custom
  // name/category when it has one.
  const changed = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const { stream } of known) {
    for (const txId of stream.transaction_ids) pairs.push([txId, stream.stream_id]);
  }
  for (let i = 0; i < pairs.length; i += LINK_CHUNK) {
    const values = sql.join(
      pairs.slice(i, i + LINK_CHUNK).map(([txId, streamId]) => sql`(${txId}::text, ${streamId}::text)`),
      sql`, `,
    );
    const updated = await tx.execute<{ id: string }>(sql`
      UPDATE ${transactions} AS t
      SET recurring_stream_id = m.stream_id,
          custom_name = COALESCE(s.custom_name, t.custom_name),
          custom_category = COALESCE(s.custom_category, t.custom_category)
      FROM (VALUES ${values}) AS m(plaid_transaction_id, stream_id)
      JOIN ${recurringStreams} AS s ON s.stream_id = m.stream_id
      WHERE t.user_id = ${item.userId}
        AND t.plaid_transaction_id = m.plaid_transaction_id
        AND t.recurring_stream_id IS DISTINCT FROM m.stream_id
      RETURNING t.id
    `);
    for (const r of rowsOf<{ id: string }>(updated)) changed.add(r.id);
  }
  const linked = changed.size;

  // Plaid often leaves a stream's earliest occurrences (before first_date) out
  // of transaction_ids. Match unlinked rows on the same account, same merchant
  // (case-insensitive), matching sign, amount within ±20% of the stream
  // average, dated before first_date. One statement for all streams.
  const orphans = await tx.execute<{ id: string }>(sql`
    UPDATE ${transactions} AS t
    SET recurring_stream_id = s.stream_id,
        custom_name = COALESCE(s.custom_name, t.custom_name),
        custom_category = COALESCE(s.custom_category, t.custom_category)
    FROM ${recurringStreams} AS s
    WHERE s.user_id = ${item.userId}
      AND s.plaid_item_id = ${item.id}
      AND s.is_active
      AND s.merchant_name IS NOT NULL
      AND s.first_date IS NOT NULL
      AND s.average_amount::numeric <> 0
      AND t.user_id = s.user_id
      AND t.account_id = s.account_id
      AND t.recurring_stream_id IS NULL
      AND lower(t.merchant_name) = lower(s.merchant_name)
      AND t.date < s.first_date
      AND abs(t.amount::numeric) BETWEEN abs(s.average_amount::numeric) * ${sql.raw(String(1 - ORPHAN_AMOUNT_TOLERANCE))}
                                     AND abs(s.average_amount::numeric) * ${sql.raw(String(1 + ORPHAN_AMOUNT_TOLERANCE))}
      AND CASE WHEN s.flow_type = 'inflow' THEN t.amount::numeric < 0 ELSE t.amount::numeric > 0 END
    RETURNING t.id
  `);
  const orphanIds = rowsOf<{ id: string }>(orphans).map((r) => r.id);
  for (const id of orphanIds) changed.add(id);

  if (changed.size > 0) {
    await applySpendingClassifications(item.userId, [...changed], tx);
  }

  await tx
    .update(plaidItems)
    .set({ recurringFetchedAt: sql`${fetchStartedAt}::text::timestamp` })
    .where(eq(plaidItems.id, item.id));

  return {
    upserted: rows.length,
    deactivated: deactivated.length,
    linkedTransactions: linked,
    backfilledOrphans: orphanIds.length,
    skippedStreams,
  };
}

/** db.execute returns an array (postgres-js) or { rows } (PGlite). */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return rows ?? [];
}
