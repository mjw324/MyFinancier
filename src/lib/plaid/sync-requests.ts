import { eq, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";

/**
 * Item statuses after which nothing syncs again. `login_required` and the
 * legacy `pending_expiration` are NOT terminal: sync is attempted and a
 * successful sync flips the item back to `active`.
 */
export const TERMINAL_ITEM_STATUSES = ["revoked", "removed"] as const;

export function isTerminalItemStatus(status: string): boolean {
  return (TERMINAL_ITEM_STATUSES as readonly string[]).includes(status);
}

/** SQL list literal for TERMINAL_ITEM_STATUSES (constants, never user input). */
export const terminalStatusListSql = sql.raw(
  TERMINAL_ITEM_STATUSES.map((s) => `'${s}'`).join(", "),
);

/**
 * Record that an item needs a transactions sync (and optionally a recurring
 * refresh). Cheap and idempotent: the sync worker drains every request newer
 * than its last start, so repeated or concurrent requests collapse into one
 * run. Webhooks, the manual Sync button, and update-mode completion call this.
 */
export async function requestItemSync(
  plaidItemRowId: string,
  opts: { recurring?: boolean } = {},
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(plaidItems)
    .set({
      syncRequestedAt: sql`now()`,
      ...(opts.recurring ? { recurringRequestedAt: sql`now()` } : {}),
    })
    .where(eq(plaidItems.id, plaidItemRowId));
}

/**
 * Serialise every write to one item's data (sync apply, recurring apply,
 * unlink) inside the caller's transaction. Transaction-scoped, so it is safe
 * through Supabase's transaction pooler (session advisory locks are not).
 *
 * The same round trip sets a transaction-local lock_timeout, so a write never
 * waits on a row lock held elsewhere (a user edit, another item's
 * post-processing) until Postgres' 2-minute statement timeout.
 */
export async function lockItemForWrite(
  tx: DbExecutor,
  plaidItemRowId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${"plaid-item:" + plaidItemRowId}, 0)) FROM (SELECT set_config('lock_timeout', '15s', true)) AS cfg`,
  );
}
