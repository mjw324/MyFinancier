"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import {
  plaidItems,
  financialAccounts,
  transactions,
  recurringStreams,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { syncTransactions } from "@/lib/plaid/sync";
import { fetchRecurringTransactions } from "@/lib/plaid/recurring";
import { PLAID_ERROR_MESSAGES } from "@/lib/plaid/types";
// TEMP DEBUG: item/get diagnostic on manual sync
import { plaidClient } from "@/lib/plaid/client";
import { decrypt } from "@/lib/utils/encryption";
// TEMP DEBUG: inspect Plaid-side Item config


import { upsertUserPreferences } from "@/lib/db/queries/user-preferences";

export async function unlinkPlaidItemAction(plaidItemId: string) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };

  const [item] = await db
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(
      and(
        eq(plaidItems.id, plaidItemId),
        eq(plaidItems.userId, session.user.id),
      ),
    );

  if (!item) {
    return { success: false as const, error: "Plaid item not found" };
  }

  // Delete transactions linked to accounts under this plaid item
  const accounts = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(eq(financialAccounts.plaidItemId, plaidItemId));

  for (const account of accounts) {
    await db
      .delete(transactions)
      .where(eq(transactions.accountId, account.id));
  }

  // Delete accounts under this plaid item
  await db
    .delete(financialAccounts)
    .where(eq(financialAccounts.plaidItemId, plaidItemId));

  // Delete the plaid item itself
  await db.delete(plaidItems).where(eq(plaidItems.id, plaidItemId));

  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/");
  return { success: true as const };
}

export async function syncPlaidItemAction(plaidItemId: string) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };

  const [item] = await db
    .select({ id: plaidItems.id, status: plaidItems.status })
    .from(plaidItems)
    .where(
      and(
        eq(plaidItems.id, plaidItemId),
        eq(plaidItems.userId, session.user.id),
      ),
    );

  if (!item) {
    return { success: false as const, error: "Plaid item not found" };
  }

  if (item.status !== "active") {
    return {
      success: false as const,
      error: "This connection needs to be reconnected before syncing.",
    };
  }

  // TEMP DEBUG: inspect Plaid-side Item config
  try {
    const fullItem = await db.query.plaidItems.findFirst({
      where: eq(plaidItems.id, plaidItemId),
    });
    if (fullItem) {
      const accessToken = decrypt(fullItem.accessToken);
      const itemGet = await plaidClient.itemGet({ access_token: accessToken });
      const it = itemGet.data.item;
      const status = itemGet.data.status;
      console.log(
        `[plaid-item-debug] ${JSON.stringify({
          db_id: fullItem.id,
          institution_name: fullItem.institutionName,
          db_status: fullItem.status,
          db_cursor_present: Boolean(fullItem.cursor),
          plaid_item_id: it.item_id,
          institution_id: it.institution_id,
          webhook: it.webhook,
          available_products: it.available_products,
          billed_products: it.billed_products,
          products: it.products,
          consented_products: it.consented_products,
          consent_expiration_time: it.consent_expiration_time,
          update_type: it.update_type,
          error: it.error
            ? {
                error_type: it.error.error_type,
                error_code: it.error.error_code,
                error_message: it.error.error_message,
              }
            : null,
          transactions_last_successful_update:
            status?.transactions?.last_successful_update ?? null,
          transactions_last_failed_update:
            status?.transactions?.last_failed_update ?? null,
          last_webhook: status?.last_webhook ?? null,
        })}`,
      );
    }
  } catch (debugErr) {
    console.error("[plaid-item-debug] /item/get failed:", debugErr);
  }
  // TEMP DEBUG: inspect Plaid-side Item config



  try {
    const result = await syncTransactions(plaidItemId);
    try {
      await fetchRecurringTransactions(plaidItemId);
    } catch (err) {
      console.error(
        `Recurring fetch failed for item ${plaidItemId}:`,
        err,
      );
    }
    revalidatePath("/settings");
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true as const, data: result };
  } catch (error) {
    console.error(`Manual sync failed for item ${plaidItemId}:`, error);
    return { success: false as const, error: mapPlaidErrorMessage(error) };
  }
}

export async function resetTransactionCustomizationsAction() {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };

  const userId = session.user.id;

  await db
    .update(transactions)
    .set({ customName: null, customCategory: null })
    .where(eq(transactions.userId, userId));

  await db
    .update(recurringStreams)
    .set({ customName: null, customCategory: null, updatedAt: new Date() })
    .where(eq(recurringStreams.userId, userId));

  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidatePath("/");
  return { success: true as const };
}

export async function updateHideTransfersAction(hide: boolean) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };

  await upsertUserPreferences(session.user.id, {
    hideTransfersFromList: hide,
  });

  revalidatePath("/transactions");
  revalidatePath("/settings");
  return { success: true as const };
}

function mapPlaidErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "response" in error) {
    const resp = (error as { response?: { data?: { error_code?: string } } })
      .response;
    const code = resp?.data?.error_code;
    if (code && code in PLAID_ERROR_MESSAGES) {
      return PLAID_ERROR_MESSAGES[code];
    }
  }
  return PLAID_ERROR_MESSAGES.DEFAULT;
}
