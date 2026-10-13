import { eq, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";

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
