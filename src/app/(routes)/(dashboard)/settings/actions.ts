"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import {
  plaidItems,
  transactions,
  recurringStreams,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { plaidClient } from "@/lib/plaid/client";
import {
  deletePlaidItemData,
  holdLeaseForRemoval,
  releaseRemovalLease,
  syncItemNow,
} from "@/lib/plaid/jobs";
import { postProcessTransactions } from "@/lib/plaid/post-process";
import { isTerminalItemStatus } from "@/lib/plaid/sync-requests";
import { PLAID_ERROR_MESSAGES } from "@/lib/plaid/types";
import { decrypt } from "@/lib/utils/encryption";
import { logError, plaidErrorCode } from "@/lib/logging";
import { upsertUserPreferences } from "@/lib/db/queries/user-preferences";

const PlaidItemIdSchema = z.string().trim().min(1).max(128);

async function findOwnedItem(userId: string, plaidItemId: string) {
  const [item] = await db
    .select({
      id: plaidItems.id,
      status: plaidItems.status,
      accessToken: plaidItems.accessToken,
    })
    .from(plaidItems)
    .where(and(eq(plaidItems.id, plaidItemId), eq(plaidItems.userId, userId)));
  return item ?? null;
}

function revalidateItemPages() {
  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

/**
 * Unlink a bank connection: stop Plaid billing first (/item/remove; an item
 * Plaid no longer knows counts as removed), then delete everything stored for
 * it in one transaction. The item's sync lease is held throughout so a
 * background sync cannot re-insert rows.
 */
export async function unlinkPlaidItemAction(plaidItemId: unknown) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };
  const parsed = PlaidItemIdSchema.safeParse(plaidItemId);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };
  const userId = session.user.id;

  const item = await findOwnedItem(userId, parsed.data);
  if (!item) {
    return { success: false as const, error: "Plaid item not found" };
  }

  if (!(await holdLeaseForRemoval(item.id))) {
    return {
      success: false as const,
      error: "This connection is syncing right now. Please try again in a minute.",
    };
  }

  try {
    await plaidClient.itemRemove({ access_token: decrypt(item.accessToken) });
  } catch (error) {
    if (plaidErrorCode(error) !== "ITEM_NOT_FOUND") {
      logError("plaid-unlink.item-remove-failed", error, { plaidItemRowId: item.id });
      await releaseRemovalLease(item.id).catch(() => undefined);
      return { success: false as const, error: mapPlaidErrorMessage(error) };
    }
  }

  let partnerIds: string[] = [];
  try {
    ({ partnerIds } = await deletePlaidItemData(userId, item.id));
  } catch (error) {
    // Plaid already forgot the item: mark it terminal so nothing syncs it
    // again (a terminal item is never claimed), free the lease, and let the
    // user retry the cleanup.
    logError("plaid-unlink.delete-failed", error, { plaidItemRowId: item.id });
    await db
      .update(plaidItems)
      .set({ status: "removed", syncLeaseUntil: null })
      .where(eq(plaidItems.id, item.id))
      .catch(() => undefined);
    return {
      success: false as const,
      error: "The bank connection was removed, but cleaning up its data failed. Please try again.",
    };
  }

  if (partnerIds.length > 0) {
    try {
      await postProcessTransactions(userId, partnerIds);
    } catch (error) {
      logError("plaid-unlink.post-process-failed", error);
    }
  }

  revalidateItemPages();
  return { success: true as const };
}

/**
 * Manual "Sync": request a sync (+ recurring refresh) and drain it now
 * through the same lease as webhooks, so it never runs concurrently with a
 * background sync of the same item. Not gated on `attention`; a
 * login_required item is attempted (a success heals it).
 */
export async function syncPlaidItemAction(plaidItemId: unknown) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };
  const parsed = PlaidItemIdSchema.safeParse(plaidItemId);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  const item = await findOwnedItem(session.user.id, parsed.data);
  if (!item) {
    return { success: false as const, error: "Plaid item not found" };
  }
  if (isTerminalItemStatus(item.status)) {
    return {
      success: false as const,
      error: "This connection was disconnected at your bank. Remove it and link the account again.",
    };
  }

  try {
    const result = await syncItemNow(item.id);
    revalidateItemPages();

    if (result.status === "done" && result.errorCode) {
      return { success: false as const, error: messageForCode(result.errorCode) };
    }
    const totals =
      result.status === "done"
        ? result.totals
        : { added: 0, modified: 0, removed: 0, accountsUpdated: 0 };
    return {
      success: true as const,
      data: { ...totals, inProgress: result.status === "busy" },
    };
  } catch (error) {
    logError("plaid-manual-sync.failed", error, { plaidItemRowId: item.id });
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
  const code = plaidErrorCode(error);
  if (code && code in PLAID_ERROR_MESSAGES) {
    return PLAID_ERROR_MESSAGES[code];
  }
  return PLAID_ERROR_MESSAGES.DEFAULT;
}

function messageForCode(code: string): string {
  return PLAID_ERROR_MESSAGES[code] ?? PLAID_ERROR_MESSAGES.DEFAULT;
}
