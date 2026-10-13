import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { AccountBase } from "plaid";
import { db, type DbExecutor } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { decrypt } from "@/lib/utils/encryption";
import { plaidClient } from "./client";

export type AccountsUpsertResult = {
  /** Rows inserted or updated for this item. */
  upserted: number;
  /** Open accounts marked closed because Plaid no longer returns them. */
  closed: number;
  /** plaid_account_ids that already belong to a different item or user and were left untouched. */
  conflicts: string[];
};

function balanceColumns(account: AccountBase) {
  const b = account.balances;
  return {
    currentBalance: b.current?.toString() ?? null,
    availableBalance: b.available?.toString() ?? null,
    creditLimit: b.limit?.toString() ?? null,
    isoCurrencyCode: b.iso_currency_code ?? b.unofficial_currency_code ?? "USD",
  };
}

/**
 * Upsert one item's accounts from a Plaid `accounts` array.
 *
 * - Never changes `user_id` or `plaid_item_id` of an existing row: an
 *   account id already owned by another item/user is reported in
 *   `conflicts`, not reassigned.
 * - `authoritative: true` means the array is the complete list of open
 *   accounts (it came from /accounts/get). Accounts on the item that are
 *   missing from it are marked closed, and returning ones are reopened.
 *   /transactions/sync responses are NOT authoritative: they only list
 *   accounts that had transactions in that response.
 */
export async function upsertPlaidAccounts(
  executor: DbExecutor,
  item: { id: string; userId: string },
  accounts: AccountBase[],
  { authoritative }: { authoritative: boolean },
): Promise<AccountsUpsertResult> {
  const result: AccountsUpsertResult = { upserted: 0, closed: 0, conflicts: [] };
  const now = new Date();

  for (const account of accounts) {
    const balances = balanceColumns(account);
    const rows = await executor
      .insert(financialAccounts)
      .values({
        userId: item.userId,
        plaidItemId: item.id,
        plaidAccountId: account.account_id,
        name: account.name,
        officialName: account.official_name ?? null,
        type: account.type,
        subtype: account.subtype ?? null,
        mask: account.mask ?? null,
        ...balances,
        lastSyncedAt: now,
        closedAt: null,
      })
      .onConflictDoUpdate({
        target: financialAccounts.plaidAccountId,
        set: {
          name: account.name,
          officialName: account.official_name ?? null,
          type: account.type,
          subtype: account.subtype ?? null,
          mask: account.mask ?? null,
          ...balances,
          lastSyncedAt: now,
          ...(authoritative ? { closedAt: null } : {}),
        },
        setWhere: and(
          eq(financialAccounts.plaidItemId, item.id),
          eq(financialAccounts.userId, item.userId),
        ),
      })
      .returning({ id: financialAccounts.id });
    if (rows.length === 0) result.conflicts.push(account.account_id);
    else result.upserted++;
  }

  // An empty list from /accounts/get is treated as "unknown", never as
  // "every account closed".
  if (authoritative && accounts.length > 0) {
    const closed = await executor
      .update(financialAccounts)
      .set({ closedAt: now })
      .where(
        and(
          eq(financialAccounts.plaidItemId, item.id),
          isNull(financialAccounts.closedAt),
          notInArray(
            financialAccounts.plaidAccountId,
            accounts.map((a) => a.account_id),
          ),
        ),
      )
      .returning({ id: financialAccounts.id });
    result.closed = closed.length;
  }

  return result;
}

/**
 * Refresh every open account (balances, names, mask, limit) of an item from
 * /accounts/get — free, cached by Plaid, and the only call that covers
 * accounts with no new transactions.
 */
export async function refreshAccountsFromPlaid(
  plaidItemRowId: string,
  executor: DbExecutor = db,
): Promise<AccountsUpsertResult> {
  const [item] = await executor
    .select({
      id: plaidItems.id,
      userId: plaidItems.userId,
      accessToken: plaidItems.accessToken,
    })
    .from(plaidItems)
    .where(eq(plaidItems.id, plaidItemRowId));
  if (!item) throw new Error(`Plaid item not found: ${plaidItemRowId}`);

  const response = await plaidClient.accountsGet({
    access_token: decrypt(item.accessToken),
  });
  return upsertPlaidAccounts(executor, item, response.data.accounts, {
    authoritative: true,
  });
}

// Re-exported for callers that need to count open accounts consistently.
export const openAccountSql = sql`${financialAccounts.closedAt} IS NULL`;
