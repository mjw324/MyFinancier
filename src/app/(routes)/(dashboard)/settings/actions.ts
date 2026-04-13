"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import { plaidItems, financialAccounts, transactions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

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
