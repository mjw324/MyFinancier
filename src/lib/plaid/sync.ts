import { and, eq, inArray, sql } from "drizzle-orm";
import {
  PersonalFinanceCategoryVersion,
  type AccountBase,
  type Transaction as PlaidTransaction,
} from "plaid";
import { db, type DbExecutor } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { decrypt } from "@/lib/utils/encryption";
import {
  computeNameSignature,
  normalizeMerchant,
} from "@/lib/utils/spending-match";
import { describeError, logError, plaidErrorCode } from "@/lib/logging";
import { upsertPlaidAccounts } from "./accounts";
import { postProcessTransactions } from "./post-process";
import {
  isTerminalItemStatus,
  lockItemForWrite,
  terminalStatusListSql,
} from "./sync-requests";
import { plaidClient } from "./client";
import type { SyncResult } from "./types";

/** The item is revoked/removed (or gone): nothing to sync. */
export class ItemNotSyncableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemNotSyncableError";
  }
}

/**
 * The item's cursor changed between fetching pages and applying them: another
 * worker already applied this update. The transaction was rolled back; the
 * caller may simply re-run.
 */
export class CursorConflictError extends Error {
  constructor() {
    super("plaid item cursor changed during sync; update already applied");
    this.name = "CursorConflictError";
  }
}

export type SyncOutcome = SyncResult & {
  /** Row ids inserted/updated/unpaired by this sync (post-processing input). */
  touchedIds: string[];
  /** Transactions skipped because their account belongs to another item. */
  skipped: number;
  /** Plaid reported HISTORICAL_UPDATE_COMPLETE on the last page. */
  historicalComplete: boolean;
};

const PAGE_SIZE = 500;
const MAX_PAGINATION_RESTARTS = 5;
const PAGINATION_BACKOFF_MS = 200;
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_BACKOFF_MS = 500;
const UPSERT_CHUNK = 500;
const ID_CHUNK = 1000;

// Plaid categories that make a row a transfer on their own (mirrors
// transfers.ts); used to restore is_transfer when a pair partner disappears.
const CATEGORY_TRANSFER_SQL = sql`COALESCE(category IN ('TRANSFER_IN', 'TRANSFER_OUT') OR category_id = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', false)`;

/**
 * SET clause for a transaction whose transfer partner no longer exists: drop
 * the dangling pair id, put is_transfer back to what the Plaid category alone
 * says, and reset an automatic flow class so post-processing re-derives it.
 * Manual flow classes (and their flags) are left alone.
 */
export const unpairedPartnerSet = {
  transferPairId: null,
  isTransfer: sql`CASE WHEN ${transactions.flowClassSource} = 'manual' THEN ${transactions.isTransfer} ELSE ${CATEGORY_TRANSFER_SQL} END`,
  flowClass: sql`CASE WHEN ${transactions.flowClassSource} = 'manual' THEN ${transactions.flowClass} ELSE NULL END`,
  flowClassSource: sql`CASE WHEN ${transactions.flowClassSource} = 'manual' THEN 'manual' ELSE NULL END`,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pull every pending /transactions/sync page for an item and apply it.
 *
 * 1. Fetch all pages from Plaid with no DB transaction open. Accounts are
 *    unioned across pages (each page lists only the accounts it touches).
 *    A mutation during pagination restarts from the first cursor (capped);
 *    transient Plaid failures (5xx, 429, network) are retried briefly.
 * 2. Apply everything in ONE transaction under the item's advisory lock:
 *    cursor compare-and-set first (abort if another worker moved it), account
 *    upsert (never reassigns), pending→posted carry-over, transaction upserts,
 *    removals (clearing broken transfer pairs), and the success stamp.
 * 3. After commit, run post-processing exactly once.
 */
export async function syncTransactions(
  plaidItemRowId: string,
): Promise<SyncOutcome> {
  const [item] = await db
    .select({
      id: plaidItems.id,
      userId: plaidItems.userId,
      accessToken: plaidItems.accessToken,
      cursor: plaidItems.cursor,
      status: plaidItems.status,
    })
    .from(plaidItems)
    .where(eq(plaidItems.id, plaidItemRowId));

  if (!item) throw new ItemNotSyncableError(`Plaid item not found: ${plaidItemRowId}`);
  if (isTerminalItemStatus(item.status)) {
    throw new ItemNotSyncableError(`Plaid item is ${item.status}: ${plaidItemRowId}`);
  }

  const fetched = await fetchAllPages(decrypt(item.accessToken), item.cursor);

  const applied = await db.transaction((tx) =>
    applySyncUpdate(tx, { id: item.id, userId: item.userId }, item.cursor, fetched),
  );

  try {
    await postProcessTransactions(item.userId, applied.touchedIds);
  } catch (error) {
    // The sync is committed; the hook heals unclassified rows on its next run.
    logError("plaid-sync.post-process-failed", error, {
      plaidItemRowId: item.id,
    });
  }

  return {
    added: fetched.added.length,
    modified: fetched.modified.length,
    removed: fetched.removed.length,
    cursor: fetched.cursor,
    accountsUpdated: applied.accountsUpdated,
    touchedIds: applied.touchedIds,
    skipped: applied.skipped,
    historicalComplete: fetched.historicalComplete,
  };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

type FetchedUpdate = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];
  accounts: AccountBase[];
  cursor: string;
  historicalComplete: boolean;
};

async function fetchAllPages(
  accessToken: string,
  originalCursor: string | null,
): Promise<FetchedUpdate> {
  for (let restart = 0; ; restart++) {
    try {
      return await fetchPagesOnce(accessToken, originalCursor);
    } catch (error) {
      if (
        plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        restart < MAX_PAGINATION_RESTARTS
      ) {
        await sleep(PAGINATION_BACKOFF_MS * (restart + 1));
        continue;
      }
      throw error;
    }
  }
}

async function fetchPagesOnce(
  accessToken: string,
  originalCursor: string | null,
): Promise<FetchedUpdate> {
  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removed: string[] = [];
  const accounts = new Map<string, AccountBase>();
  let cursor = originalCursor ?? undefined;
  let historicalComplete = false;

  for (let hasMore = true; hasMore; ) {
    const { data } = await withTransientRetry(() =>
      plaidClient.transactionsSync({
        access_token: accessToken,
        cursor,
        count: PAGE_SIZE,
        options: {
          include_personal_finance_category: true,
          // Teams enabled before Dec 2025 default to v1; v2 is a superset
          // with better accuracy. flow-classify.ts accepts both namings.
          personal_finance_category_version: PersonalFinanceCategoryVersion.V2,
        },
      }),
    );
    added.push(...data.added);
    modified.push(...data.modified);
    for (const r of data.removed) {
      if (r.transaction_id) removed.push(r.transaction_id);
    }
    // Each page lists only the accounts with transactions in it: union them.
    for (const account of data.accounts ?? []) {
      accounts.set(account.account_id, account);
    }
    historicalComplete =
      data.transactions_update_status === "HISTORICAL_UPDATE_COMPLETE";
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  return {
    added,
    modified,
    removed,
    accounts: [...accounts.values()],
    cursor: cursor ?? "",
    historicalComplete,
  };
}

function isTransientPlaidError(error: unknown): boolean {
  const info = describeError(error);
  if (info.status === undefined) {
    // No HTTP response at all (DNS, reset, timeout) — but not a programming error.
    return error instanceof Error && /network|timeout|ECONN|ETIMEDOUT|socket|EAI_AGAIN/i.test(`${info.name} ${info.message}`);
  }
  return info.status >= 500 || info.status === 429;
}

export async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < MAX_TRANSIENT_RETRIES && isTransientPlaidError(error)) {
        await sleep(TRANSIENT_BACKOFF_MS * 3 ** attempt);
        continue;
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Apply (one transaction)
// ---------------------------------------------------------------------------

async function applySyncUpdate(
  tx: DbExecutor,
  item: { id: string; userId: string },
  originalCursor: string | null,
  update: FetchedUpdate,
): Promise<{ touchedIds: string[]; accountsUpdated: number; skipped: number }> {
  await lockItemForWrite(tx, item.id);

  // Cursor compare-and-set + success stamp. A successful /transactions/sync
  // proves the credentials work, so a login_required item heals here.
  const cas = await tx
    .update(plaidItems)
    .set({
      cursor: update.cursor,
      lastSuccessfulSyncAt: sql`now()`,
      lastSyncErrorCode: null,
      status: sql`CASE WHEN ${plaidItems.status} IN ('login_required', 'pending_expiration') THEN 'active' ELSE ${plaidItems.status} END`,
      attention: sql`CASE WHEN ${plaidItems.attention} = 'login_required' THEN NULL ELSE ${plaidItems.attention} END`,
      ...(update.historicalComplete
        ? {
            historicalUpdateCompleteAt: sql`COALESCE(${plaidItems.historicalUpdateCompleteAt}, now())`,
          }
        : {}),
    })
    .where(
      and(
        eq(plaidItems.id, item.id),
        sql`${plaidItems.cursor} IS NOT DISTINCT FROM ${originalCursor}`,
        sql`${plaidItems.status} NOT IN (${terminalStatusListSql})`,
      ),
    )
    .returning({ id: plaidItems.id });
  if (cas.length === 0) throw new CursorConflictError();

  let accountsUpdated = 0;
  if (update.accounts.length > 0) {
    const res = await upsertPlaidAccounts(tx, item, update.accounts, {
      authoritative: false,
    });
    accountsUpdated = res.upserted;
    if (res.conflicts.length > 0) {
      logError(
        "plaid-sync.account-conflict",
        new Error("account belongs to another item"),
        { plaidItemRowId: item.id, conflicts: res.conflicts.length },
      );
    }
  }

  // Dedupe added+modified by transaction id (last write wins) so one INSERT
  // never touches the same key twice.
  const byId = new Map<string, PlaidTransaction>();
  for (const t of [...update.added, ...update.modified]) {
    if (t.transaction_id) byId.set(t.transaction_id, t);
  }
  const incoming = [...byId.values()];

  const touched = new Set<string>();
  let skipped = 0;

  if (incoming.length > 0) {
    const accountRows = await tx
      .select({ id: financialAccounts.id, plaidAccountId: financialAccounts.plaidAccountId })
      .from(financialAccounts)
      .where(eq(financialAccounts.plaidItemId, item.id));
    const accountIdByPlaid = new Map(accountRows.map((a) => [a.plaidAccountId, a.id]));

    const rows: (typeof transactions.$inferInsert)[] = [];
    for (const t of incoming) {
      const accountId = accountIdByPlaid.get(t.account_id);
      if (!accountId) {
        skipped++;
        continue;
      }
      rows.push(mapPlaidTransaction(t, item.userId, accountId));
    }
    if (skipped > 0) {
      logError(
        "plaid-sync.transactions-skipped",
        new Error("transactions for an account not on this item"),
        { plaidItemRowId: item.id, skipped },
      );
    }

    await carryOverPendingRows(tx, item.userId, rows);

    for (const chunk of chunkArray(rows, UPSERT_CHUNK)) {
      const upserted = await tx
        .insert(transactions)
        .values(chunk)
        .onConflictDoUpdate({
          target: transactions.plaidTransactionId,
          set: {
            amount: sql`excluded.amount`,
            date: sql`excluded.date`,
            name: sql`excluded.name`,
            merchantName: sql`excluded.merchant_name`,
            category: sql`excluded.category`,
            categoryId: sql`excluded.category_id`,
            pfcConfidenceLevel: sql`excluded.pfc_confidence_level`,
            pending: sql`excluded.pending`,
            normalizedMerchant: sql`excluded.normalized_merchant`,
            nameSignature: sql`excluded.name_signature`,
            pendingTransactionId: sql`excluded.pending_transaction_id`,
            authorizedDate: sql`excluded.authorized_date`,
          },
          // Plaid ids are global, but never let one user's sync touch
          // another user's row.
          setWhere: sql`${transactions.userId} = excluded.user_id`,
        })
        .returning({ id: transactions.id });
      for (const r of upserted) touched.add(r.id);
    }
  }

  if (update.removed.length > 0) {
    for (const id of await removeTransactions(tx, item.userId, update.removed)) {
      touched.add(id);
    }
  }

  return { touchedIds: [...touched], accountsUpdated, skipped };
}

/**
 * Pending→posted carry-over. Plaid reports a settled pending transaction as
 * `removed: [pendingId]` + `added: [{ transaction_id: postedId,
 * pending_transaction_id: pendingId }]`. Instead of deleting the pending row
 * and inserting a fresh one (which loses everything the user or the app
 * attached to it), re-key the existing row in place: its id, custom name and
 * category, manual spending/flow classes, refund decision, recurring stream
 * and transfer pair all survive, and the upsert that follows merges Plaid's
 * posted fields onto it. The lookup is in the DB, so it also works when the
 * pending row arrived in an earlier update. The later removal of `pendingId`
 * then finds nothing to delete.
 */
async function carryOverPendingRows(
  tx: DbExecutor,
  userId: string,
  rows: (typeof transactions.$inferInsert)[],
): Promise<void> {
  const pairs = new Map<string, string>(); // pendingId -> postedId
  for (const r of rows) {
    if (r.pendingTransactionId && r.plaidTransactionId && !r.pending) {
      pairs.set(r.pendingTransactionId, r.plaidTransactionId);
    }
  }
  if (pairs.size === 0) return;

  for (const chunk of chunkArray([...pairs.entries()], ID_CHUNK)) {
    const values = sql.join(
      chunk.map(([oldId, newId]) => sql`(${oldId}::text, ${newId}::text)`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE ${transactions} AS t
      SET plaid_transaction_id = m.new_id
      FROM (VALUES ${values}) AS m(old_id, new_id)
      WHERE t.user_id = ${userId}
        AND t.plaid_transaction_id = m.old_id
        AND NOT EXISTS (
          SELECT 1 FROM ${transactions} AS x WHERE x.plaid_transaction_id = m.new_id
        )
    `);
  }
}

/**
 * Delete removed rows. A deleted row's transfer partner keeps a dangling
 * transfer_pair_id that blocks it from ever pairing again, so clear it, put
 * is_transfer back to what the Plaid category alone says, and reset an
 * automatic flow class so post-processing re-derives it. Manual flow classes
 * are left alone. Returns the partner ids (they need post-processing).
 */
async function removeTransactions(
  tx: DbExecutor,
  userId: string,
  removedIds: string[],
): Promise<string[]> {
  const pairIds = new Set<string>();
  for (const chunk of chunkArray(removedIds, ID_CHUNK)) {
    const deleted = await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.plaidTransactionId, chunk),
        ),
      )
      .returning({ transferPairId: transactions.transferPairId });
    for (const d of deleted) if (d.transferPairId) pairIds.add(d.transferPairId);
  }
  if (pairIds.size === 0) return [];

  const partners: string[] = [];
  for (const chunk of chunkArray([...pairIds], ID_CHUNK)) {
    const rows = await tx
      .update(transactions)
      .set(unpairedPartnerSet)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.transferPairId, chunk),
        ),
      )
      .returning({ id: transactions.id });
    for (const r of rows) partners.push(r.id);
  }
  return partners;
}

function mapPlaidTransaction(
  txn: PlaidTransaction,
  userId: string,
  accountId: string,
): typeof transactions.$inferInsert {
  const matchSource = txn.merchant_name ?? txn.name ?? null;
  return {
    userId,
    accountId,
    plaidTransactionId: txn.transaction_id,
    amount: txn.amount.toString(),
    // Plaid dates are calendar dates; new Date("YYYY-MM-DD") is UTC midnight.
    date: new Date(txn.date),
    name: txn.name,
    merchantName: txn.merchant_name ?? null,
    category: txn.personal_finance_category?.primary ?? null,
    categoryId: txn.personal_finance_category?.detailed ?? null,
    pfcConfidenceLevel: txn.personal_finance_category?.confidence_level ?? null,
    pending: txn.pending,
    normalizedMerchant: normalizeMerchant(matchSource),
    nameSignature: computeNameSignature(matchSource),
    pendingTransactionId: txn.pending_transaction_id ?? null,
    authorizedDate: txn.authorized_date ? new Date(txn.authorized_date) : null,
  };
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
