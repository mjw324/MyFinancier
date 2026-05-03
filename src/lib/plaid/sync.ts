import { eq, inArray, sql } from "drizzle-orm";
import type { Transaction as PlaidTransaction, AccountBase } from "plaid";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { decrypt } from "@/lib/utils/encryption";
import {
  computeNameSignature,
  normalizeMerchant,
} from "@/lib/utils/spending-match";
import { applySpendingClassifications } from "@/lib/spending/classify";
import { detectAndFlagTransfers } from "./transfers";
import { plaidClient } from "./client";
import type { SyncResult } from "./types";

export async function syncTransactions(
  plaidItemId: string,
): Promise<SyncResult> {
  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, plaidItemId),
  });

  if (!item) throw new Error(`Plaid item not found: ${plaidItemId}`);
  if (item.status !== "active")
    throw new Error(`Plaid item is not active: ${plaidItemId}`);

  const accessToken = decrypt(item.accessToken);
  const originalCursor = item.cursor;
  let cursor: string | undefined = originalCursor ?? undefined;

  const allAdded: PlaidTransaction[] = [];
  const allModified: PlaidTransaction[] = [];
  const allRemoved: Array<{ transaction_id?: string }> = [];
  let latestAccounts: AccountBase[] = [];

  // Pagination loop
  let hasMore = true;
  while (hasMore) {
    try {
      const response = await plaidClient.transactionsSync({
        access_token: accessToken,
        cursor: cursor,
        count: 500,
        options: {
          include_personal_finance_category: true,
        },
      });

      const data = response.data;
      allAdded.push(...data.added);
      allModified.push(...data.modified);
      allRemoved.push(...data.removed);

      if (data.accounts.length > 0) {
        latestAccounts = data.accounts;
      }

      hasMore = data.has_more;
      cursor = data.next_cursor;
    } catch (error: unknown) {
      if (isMutationDuringPagination(error)) {
        allAdded.length = 0;
        allModified.length = 0;
        allRemoved.length = 0;
        cursor = originalCursor ?? undefined;
        hasMore = true;
        continue;
      }
      throw error;
    }
  }

  // Build lookup: plaidAccountId -> DB financial account
  const dbAccounts = await db.query.financialAccounts.findMany({
    where: eq(financialAccounts.plaidItemId, plaidItemId),
  });
  const accountLookup = new Map(
    dbAccounts.map((a) => [a.plaidAccountId, a]),
  );

  // Update account balances
  let accountsUpdated = 0;
  for (const plaidAccount of latestAccounts) {
    const dbAccount = accountLookup.get(plaidAccount.account_id);
    if (dbAccount) {
      await db
        .update(financialAccounts)
        .set({
          currentBalance:
            plaidAccount.balances.current?.toString() ?? null,
          availableBalance:
            plaidAccount.balances.available?.toString() ?? null,
          isoCurrencyCode:
            plaidAccount.balances.iso_currency_code ?? "USD",
          officialName:
            plaidAccount.official_name ?? dbAccount.officialName,
          name: plaidAccount.name ?? dbAccount.name,
          lastSyncedAt: new Date(),
        })
        .where(eq(financialAccounts.id, dbAccount.id));
      accountsUpdated++;
    } else {
      // New account added to an existing item
      const [newAccount] = await db
        .insert(financialAccounts)
        .values({
          userId: item.userId,
          plaidItemId,
          plaidAccountId: plaidAccount.account_id,
          name: plaidAccount.name,
          officialName: plaidAccount.official_name,
          type: plaidAccount.type,
          subtype: plaidAccount.subtype ?? null,
          currentBalance:
            plaidAccount.balances.current?.toString() ?? null,
          availableBalance:
            plaidAccount.balances.available?.toString() ?? null,
          isoCurrencyCode:
            plaidAccount.balances.iso_currency_code ?? "USD",
          lastSyncedAt: new Date(),
        })
        .returning();
      accountLookup.set(plaidAccount.account_id, newAccount);
      accountsUpdated++;
    }
  }

  // Upsert added transactions
  await upsertTransactions(allAdded, item.userId, accountLookup);

  // Upsert modified transactions
  await upsertTransactions(allModified, item.userId, accountLookup);

  // Delete removed transactions
  if (allRemoved.length > 0) {
    const removedIds = allRemoved
      .map((r) => r.transaction_id)
      .filter((id): id is string => id != null);

    for (const chunk of chunkArray(removedIds, 100)) {
      await db
        .delete(transactions)
        .where(inArray(transactions.plaidTransactionId, chunk));
    }
  }

  // Save the cursor
  await db
    .update(plaidItems)
    .set({ cursor, updatedAt: new Date() })
    .where(eq(plaidItems.id, plaidItemId));

  const touchedPlaidIds = [...allAdded, ...allModified]
    .map((t) => t.transaction_id)
    .filter((id): id is string => Boolean(id));
  if (touchedPlaidIds.length > 0) {
    const touchedRows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(inArray(transactions.plaidTransactionId, touchedPlaidIds));
    if (touchedRows.length > 0) {
      await detectAndFlagTransfers(item.userId);
      await applySpendingClassifications(
        item.userId,
        touchedRows.map((r) => r.id),
      );
    }
  }

  return {
    added: allAdded.length,
    modified: allModified.length,
    removed: allRemoved.length,
    cursor: cursor!,
    accountsUpdated,
  };
}

async function upsertTransactions(
  plaidTxns: PlaidTransaction[],
  userId: string,
  accountLookup: Map<string, typeof financialAccounts.$inferSelect>,
) {
  if (plaidTxns.length === 0) return;

  const values = plaidTxns
    .map((txn) => mapPlaidTransaction(txn, userId, accountLookup))
    .filter(
      (v): v is NonNullable<typeof v> => v !== null,
    );

  if (values.length === 0) return;

  for (const chunk of chunkArray(values, 100)) {
    await db
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
          pending: sql`excluded.pending`,
          normalizedMerchant: sql`excluded.normalized_merchant`,
          nameSignature: sql`excluded.name_signature`,
        },
      });
  }
}

function mapPlaidTransaction(
  txn: PlaidTransaction,
  userId: string,
  accountLookup: Map<string, typeof financialAccounts.$inferSelect>,
): typeof transactions.$inferInsert | null {
  const dbAccount = accountLookup.get(txn.account_id);
  if (!dbAccount) {
    console.warn(
      `Skipping transaction ${txn.transaction_id}: account ${txn.account_id} not found`,
    );
    return null;
  }

  const matchSource = txn.merchant_name ?? txn.name ?? null;
  return {
    userId,
    accountId: dbAccount.id,
    plaidTransactionId: txn.transaction_id,
    amount: txn.amount.toString(),
    date: new Date(txn.date),
    name: txn.name,
    merchantName: txn.merchant_name ?? null,
    category: txn.personal_finance_category?.primary ?? null,
    categoryId: txn.personal_finance_category?.detailed ?? null,
    pending: txn.pending,
    normalizedMerchant: normalizeMerchant(matchSource),
    nameSignature: computeNameSignature(matchSource),
  };
}

function isMutationDuringPagination(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "response" in error
  ) {
    const resp = (error as { response?: { data?: { error_code?: string } } })
      .response;
    return (
      resp?.data?.error_code ===
      "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
    );
  }
  return false;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
