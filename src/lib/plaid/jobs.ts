import { after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { describeError, logError, plaidErrorCode } from "@/lib/logging";
import { refreshAccountsFromPlaid } from "./accounts";
import { fetchRecurringTransactions } from "./recurring";
import {
  CursorConflictError,
  ItemNotSyncableError,
  syncTransactions,
  unpairedPartnerSet,
} from "./sync";
import {
  lockItemForWrite,
  requestItemSync,
  terminalStatusListSql,
} from "./sync-requests";

/**
 * Background sync for one Plaid item: the `plaid_items` row doubles as a
 * one-row job record.
 *
 * - Requests: `sync_requested_at` / `recurring_requested_at` (webhooks, the
 *   manual Sync button, the sweep — see sync-requests.ts).
 * - Lease: `sync_lease_until`, claimed by ONE atomic UPDATE … RETURNING, so it
 *   works through any pooler and across overlapping deployments. The claimed
 *   lease value is the run's fencing token: renew/release only match it.
 * - A run = sync → refresh balances (/accounts/get) → recurring (only when
 *   requested, or once after the historical pull completed). The release
 *   reports whether a request arrived after the run started; if so we claim
 *   again and run again. Two drains for the same item never run concurrently:
 *   the second one fails to claim and leaves (its request is picked up by the
 *   running drain's release check).
 * - Belt and braces: the sync's write transaction takes a per-item advisory
 *   lock and compare-and-sets the cursor, so even a run whose lease expired
 *   cannot double-apply an update.
 */

const LEASE_SQL = sql`date_trunc('milliseconds', now()) + interval '10 minutes'`;
/**
 * Recurring is due when explicitly requested after the last fetch, or when the
 * historical pull completed and recurring has not been fetched since.
 */
const needsRecurringSql = sql<boolean>`(
  ${plaidItems.recurringRequestedAt} > COALESCE(${plaidItems.recurringFetchedAt}, '-infinity'::timestamp)
  OR (${plaidItems.historicalUpdateCompleteAt} IS NOT NULL
      AND (${plaidItems.recurringFetchedAt} IS NULL
           OR ${plaidItems.recurringFetchedAt} < ${plaidItems.historicalUpdateCompleteAt}))
)`;
/** Runs per drainItem call before leaving the rest to the next drain/sweep. */
const MAX_RUNS_PER_DRAIN = 5;
/** Lets a burst of webhooks (SYNC + RECURRING arrive in the same second) coalesce. */
const DRAIN_DEBOUNCE_MS = 1500;

/** Plaid error codes that need the user to go through Link update mode. */
const LOGIN_REQUIRED_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "INVALID_CREDENTIALS",
  "INSUFFICIENT_CREDENTIALS",
  "INVALID_MFA",
  "INVALID_SEND_METHOD",
  "ITEM_LOCKED",
  "MFA_NOT_SUPPORTED",
  "NO_ACCOUNTS",
  "USER_SETUP_REQUIRED",
  "ACCESS_NOT_GRANTED",
  "ITEM_NOT_SUPPORTED",
]);
/** Plaid error codes after which the item can never sync again. */
const REVOKED_CODES = new Set(["ITEM_NOT_FOUND", "USER_PERMISSION_REVOKED"]);

/** Item status for a Plaid item error code, or null to leave status alone. */
export function statusForPlaidErrorCode(
  code: string | undefined,
): "login_required" | "revoked" | null {
  if (!code) return null;
  if (LOGIN_REQUIRED_CODES.has(code)) return "login_required";
  if (REVOKED_CODES.has(code)) return "revoked";
  return null;
}

export type DrainTotals = {
  added: number;
  modified: number;
  removed: number;
  accountsUpdated: number;
};

export type DrainResult =
  | { status: "busy" } // another worker holds the lease
  | { status: "idle" } // nothing pending (or item gone / terminal)
  | {
      status: "done";
      runs: number;
      totals: DrainTotals;
      recurringFetched: boolean;
      /** Plaid error code (or internal code) of the last failed run. */
      errorCode: string | null;
    };

type Claim = {
  token: string; // sync_lease_until as text (fencing token)
  userId: string;
  needsRecurring: boolean;
};

async function claimLease(itemRowId: string): Promise<Claim | null> {
  const rows = await db.execute<{
    token: string;
    user_id: string;
    needs_recurring: boolean;
  }>(sql`
    UPDATE ${plaidItems}
    SET sync_lease_until = ${LEASE_SQL},
        last_sync_started_at = now()
    WHERE id = ${itemRowId}
      AND status NOT IN (${terminalStatusListSql})
      AND (
        (sync_lease_until IS NULL AND (
          sync_requested_at > COALESCE(last_sync_started_at, '-infinity'::timestamp)
          OR recurring_requested_at > COALESCE(last_sync_started_at, '-infinity'::timestamp)
        ))
        -- an expired lease means the previous run died mid-way: redo it
        OR sync_lease_until < now()
      )
    RETURNING sync_lease_until::text AS token,
      user_id,
      ${needsRecurringSql} AS needs_recurring
  `);
  const row = rowsOf<{ token: string; user_id: string; needs_recurring: boolean }>(rows)[0];
  return row
    ? { token: row.token, userId: row.user_id, needsRecurring: row.needs_recurring === true }
    : null;
}

/** Extend our lease; false if it is no longer ours. */
async function renewLease(itemRowId: string, token: string): Promise<string | null> {
  const rows = await db.execute<{ token: string }>(sql`
    UPDATE ${plaidItems}
    SET sync_lease_until = ${LEASE_SQL}
    WHERE id = ${itemRowId} AND sync_lease_until = ${token}::text::timestamp
    RETURNING sync_lease_until::text AS token
  `);
  return rowsOf<{ token: string }>(rows)[0]?.token ?? null;
}

/**
 * Release our lease and report whether a request arrived after this run
 * started (then the caller runs again).
 */
async function releaseLease(
  itemRowId: string,
  token: string,
): Promise<{ pending: boolean } | null> {
  const rows = await db.execute<{ pending: boolean }>(sql`
    UPDATE ${plaidItems}
    SET sync_lease_until = NULL
    WHERE id = ${itemRowId} AND sync_lease_until = ${token}::text::timestamp
    RETURNING (
      sync_requested_at > last_sync_started_at
      OR recurring_requested_at > last_sync_started_at
    ) AS pending
  `);
  const row = rowsOf<{ pending: boolean }>(rows)[0];
  return row ? { pending: row.pending === true } : null;
}

async function recordFailure(itemRowId: string, error: unknown): Promise<string> {
  const plaidCode = plaidErrorCode(error);
  const info = describeError(error);
  const code = plaidCode ?? (info.pgCode ? `DB_${info.pgCode}` : "INTERNAL");
  const status = statusForPlaidErrorCode(plaidCode);
  await db
    .update(plaidItems)
    .set({
      lastSyncErrorCode: code,
      ...(status ? { status } : {}),
      ...(status ? { attention: status } : {}),
    })
    .where(eq(plaidItems.id, itemRowId));
  return code;
}

/**
 * Drain all pending sync work for one item. Safe to call any number of times
 * concurrently, from any process: at most one caller runs at a time; the
 * others return `busy` (their requests are seen by the running drain's
 * release check).
 */
export async function drainItem(itemRowId: string): Promise<DrainResult> {
  const totals: DrainTotals = { added: 0, modified: 0, removed: 0, accountsUpdated: 0 };
  let runs = 0;
  let recurringFetched = false;
  let errorCode: string | null = null;
  const startedAt = Date.now();

  while (runs < MAX_RUNS_PER_DRAIN) {
    const claim = await claimLease(itemRowId);
    if (!claim) {
      if (runs > 0) break;
      const [row] = await db
        .select({ lease: plaidItems.syncLeaseUntil })
        .from(plaidItems)
        .where(eq(plaidItems.id, itemRowId));
      return row?.lease ? { status: "busy" } : { status: "idle" };
    }
    runs++;
    errorCode = null;
    let token: string | null = claim.token;

    try {
      const res = await syncTransactions(itemRowId);
      totals.added += res.added;
      totals.modified += res.modified;
      totals.removed += res.removed;

      token = await renewLease(itemRowId, token);
      if (!token) break; // lease taken over after expiry; that worker continues

      try {
        const acct = await refreshAccountsFromPlaid(itemRowId);
        totals.accountsUpdated += acct.upserted;
      } catch (error) {
        // Balances are best effort; the sync itself succeeded.
        logError("plaid-drain.accounts-refresh-failed", error, { plaidItemRowId: itemRowId });
      }

      // Recurring only when requested (RECURRING_TRANSACTIONS_UPDATE, manual
      // sync) or once after the historical pull completed — including when
      // this very sync saw it complete.
      const wantRecurring =
        claim.needsRecurring || (res.historicalComplete && (await recurringStillNeeded(itemRowId)));
      if (wantRecurring) {
        try {
          await fetchRecurringTransactions(itemRowId);
          recurringFetched = true;
        } catch (error) {
          // Not fatal (often "not ready" right after linking). The request
          // stays open and is retried with the item's next sync run.
          logError("plaid-drain.recurring-failed", error, { plaidItemRowId: itemRowId });
        }
      }
    } catch (error) {
      if (error instanceof ItemNotSyncableError) {
        if (token) await releaseLease(itemRowId, token).catch(() => null);
        return { status: "idle" };
      }
      if (!(error instanceof CursorConflictError)) {
        // (A cursor conflict means another worker already applied this update.)
        errorCode = await recordFailure(itemRowId, error).catch(() => "INTERNAL");
        logError("plaid-drain.sync-failed", error, { plaidItemRowId: itemRowId, errorCode });
        // Never loop on a failing item: the next request or the sweep retries.
        if (token) await releaseLease(itemRowId, token).catch(() => null);
        break;
      }
    }

    if (!token) break;
    const released = await releaseLease(itemRowId, token);
    if (!released?.pending) break;
  }

  console.log(
    `[plaid-drain] ${JSON.stringify({ item: itemRowId.slice(0, 8), runs, ...totals, recurring: recurringFetched, error: errorCode, ms: Date.now() - startedAt })}`,
  );
  return { status: "done", runs, totals, recurringFetched, errorCode };
}

async function recurringStillNeeded(itemRowId: string): Promise<boolean> {
  const [row] = await db
    .select({ needed: needsRecurringSql })
    .from(plaidItems)
    .where(eq(plaidItems.id, itemRowId));
  return row?.needed === true;
}

/**
 * Schedule a drain after the current response is sent (Next.js `after`), or
 * fire-and-forget when called outside a request (instrumentation sweep,
 * scripts). Never throws; failures are logged without secrets.
 */
export function drainItemSoon(
  itemRowId: string,
  { debounceMs = DRAIN_DEBOUNCE_MS }: { debounceMs?: number } = {},
): void {
  const task = async () => {
    if (debounceMs > 0) await new Promise((r) => setTimeout(r, debounceMs));
    try {
      await drainItem(itemRowId);
    } catch (error) {
      logError("plaid-drain.failed", error, { plaidItemRowId: itemRowId });
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * Recovery sweep (instrumentation.ts runs it every ~10 minutes):
 * - requests a sync for active items with no successful sync in 24 h (at most
 *   one attempt per 6 h for items that keep failing), and
 * - drains items with an unprocessed request or an expired lease (work lost
 *   to a crash, SIGKILL during a deploy, or a webhook whose after() never ran).
 */
export async function sweepPlaidItems(): Promise<{ requested: number; drained: number }> {
  const requested = rowsOf<{ id: string }>(
    await db.execute<{ id: string }>(sql`
      UPDATE ${plaidItems}
      SET sync_requested_at = now()
      WHERE status = 'active'
        AND (last_successful_sync_at IS NULL OR last_successful_sync_at < now() - interval '24 hours')
        AND (last_sync_started_at IS NULL OR last_sync_started_at < now() - interval '6 hours')
        AND (sync_requested_at IS NULL OR sync_requested_at <= COALESCE(last_sync_started_at, '-infinity'::timestamp))
      RETURNING id
    `),
  ).length;

  const due = rowsOf<{ id: string }>(
    await db.execute<{ id: string }>(sql`
      SELECT id FROM ${plaidItems}
      WHERE status NOT IN (${terminalStatusListSql})
        AND (
          (sync_lease_until IS NULL AND (
            sync_requested_at > COALESCE(last_sync_started_at, '-infinity'::timestamp)
            OR recurring_requested_at > COALESCE(last_sync_started_at, '-infinity'::timestamp)
          ))
          OR sync_lease_until < now()
        )
      ORDER BY sync_requested_at NULLS FIRST
      LIMIT 50
    `),
  );

  let drained = 0;
  for (const { id } of due) {
    try {
      const res = await drainItem(id);
      if (res.status === "done") drained++;
    } catch (error) {
      logError("plaid-sweep.drain-failed", error, { plaidItemRowId: id });
    }
  }
  return { requested, drained };
}

/** db.execute returns an array (postgres-js) or { rows } (PGlite). */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] } | null)?.rows ?? [];
}

// ---------------------------------------------------------------------------
// User-initiated operations (Settings → Sync / Unlink)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Manual sync: request a sync (+ recurring) and drain it now. If a background
 * drain holds the lease, wait for it (it picks up our request before
 * releasing) instead of running concurrently.
 */
export async function syncItemNow(
  itemRowId: string,
  { waitMs = 45_000, pollMs = 1_000 }: { waitMs?: number; pollMs?: number } = {},
): Promise<DrainResult & { waitedForOther: boolean }> {
  await requestItemSync(itemRowId, { recurring: true });
  const deadline = Date.now() + waitMs;
  let waitedForOther = false;
  for (;;) {
    const result = await drainItem(itemRowId);
    if (result.status !== "busy") return { ...result, waitedForOther };
    waitedForOther = true;
    if (Date.now() >= deadline) return { ...result, waitedForOther };
    await sleep(pollMs);
  }
}

/**
 * Take the item's lease for a removal, waiting for a running drain to
 * finish. Returns false if it is still busy after `waitMs`.
 */
export async function holdLeaseForRemoval(
  itemRowId: string,
  { waitMs = 20_000, pollMs = 500 }: { waitMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rows = await db
      .update(plaidItems)
      .set({ syncLeaseUntil: sql`now() + interval '10 minutes'` })
      .where(
        and(
          eq(plaidItems.id, itemRowId),
          sql`(${plaidItems.syncLeaseUntil} IS NULL OR ${plaidItems.syncLeaseUntil} < now())`,
        ),
      )
      .returning({ id: plaidItems.id });
    if (rows.length > 0) return true;
    if (Date.now() >= deadline) return false;
    await sleep(pollMs);
  }
}

/** Give the lease back after an aborted removal. */
export async function releaseRemovalLease(itemRowId: string): Promise<void> {
  await db
    .update(plaidItems)
    .set({ syncLeaseUntil: null })
    .where(eq(plaidItems.id, itemRowId));
}

/**
 * Delete everything stored for one item in ONE transaction, under the item's
 * write lock (so a sync or recurring apply in flight either commits first and
 * is deleted too, or runs after and finds the item gone): transfer partners
 * on other items are unpaired, then transactions, recurring streams, accounts
 * and the item row are deleted (children first; the FKs are NO ACTION).
 * Returns the unpaired partner ids for post-processing.
 */
export async function deletePlaidItemData(
  userId: string,
  itemRowId: string,
): Promise<{ deleted: boolean; partnerIds: string[] }> {
  return db.transaction(async (tx) => {
    await lockItemForWrite(tx, itemRowId);
    const itemAccounts = sql`(SELECT ${financialAccounts.id} FROM ${financialAccounts} WHERE ${financialAccounts.plaidItemId} = ${itemRowId})`;

    const partners = await tx
      .update(transactions)
      .set(unpairedPartnerSet)
      .where(
        and(
          eq(transactions.userId, userId),
          sql`${transactions.accountId} NOT IN ${itemAccounts}`,
          sql`${transactions.transferPairId} IN (
            SELECT p.transfer_pair_id FROM ${transactions} AS p
            WHERE p.account_id IN ${itemAccounts} AND p.transfer_pair_id IS NOT NULL
          )`,
        ),
      )
      .returning({ id: transactions.id });

    await tx
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), sql`${transactions.accountId} IN ${itemAccounts}`));
    await tx.delete(recurringStreams).where(eq(recurringStreams.plaidItemId, itemRowId));
    await tx.delete(financialAccounts).where(eq(financialAccounts.plaidItemId, itemRowId));
    const deleted = await tx
      .delete(plaidItems)
      .where(and(eq(plaidItems.id, itemRowId), eq(plaidItems.userId, userId)))
      .returning({ id: plaidItems.id });

    return { deleted: deleted.length > 0, partnerIds: partners.map((p) => p.id) };
  });
}
