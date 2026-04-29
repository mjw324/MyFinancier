"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";

const updateSchema = z.object({
  transactionId: z.string().min(1),
  customName: z.string().max(100).nullable(),
  customCategory: z.string().max(100).nullable(),
});

export type UpdateTransactionOverridesInput = z.infer<typeof updateSchema>;

function normalize(v: string | null): string | null {
  if (v === null) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function updateTransactionOverridesAction(
  input: UpdateTransactionOverridesInput,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }

  const customName = normalize(parsed.data.customName);
  const customCategory = normalize(parsed.data.customCategory);
  const userId = session.user.id;

  const [tx] = await db
    .select({
      id: transactions.id,
      recurringStreamId: transactions.recurringStreamId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, parsed.data.transactionId),
        eq(transactions.userId, userId),
      ),
    );

  if (!tx) {
    return { success: false as const, error: "Transaction not found" };
  }

  if (tx.recurringStreamId) {
    await db
      .update(recurringStreams)
      .set({ customName, customCategory, updatedAt: new Date() })
      .where(
        and(
          eq(recurringStreams.streamId, tx.recurringStreamId),
          eq(recurringStreams.userId, userId),
        ),
      );

    await db
      .update(transactions)
      .set({ customName, customCategory })
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.recurringStreamId, tx.recurringStreamId),
        ),
      );
  } else {
    await db
      .update(transactions)
      .set({ customName, customCategory })
      .where(
        and(
          eq(transactions.id, parsed.data.transactionId),
          eq(transactions.userId, userId),
        ),
      );
  }

  revalidatePath("/transactions");
  revalidatePath("/");
  return { success: true as const };
}
