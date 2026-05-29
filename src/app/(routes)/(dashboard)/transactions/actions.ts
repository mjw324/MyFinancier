"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { spendingRules } from "@/lib/db/schema/spending-rules";
import {
  classifyTransaction,
  clearTransactionClassification as clearTxClassification,
  clearStreamClassification as clearStreamClassificationCore,
  deleteSpendingRule as deleteSpendingRuleCore,
} from "@/lib/spending/classify";
import { detectAndFlagRefunds } from "@/lib/plaid/refunds";

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

const refundSchema = z.object({
  transactionId: z.string().min(1),
  // true / false = manual override; null = reset to auto-detection.
  isRefund: z.boolean().nullable(),
});

export type SetTransactionRefundInput = z.infer<typeof refundSchema>;

export async function setTransactionRefundAction(
  input: SetTransactionRefundInput,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;

  const [tx] = await db
    .select({ id: transactions.id })
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

  if (parsed.data.isRefund === null) {
    // Reset to auto: clear the override, then let detection recompute.
    await db
      .update(transactions)
      .set({ isRefund: false, refundSource: null })
      .where(
        and(
          eq(transactions.id, parsed.data.transactionId),
          eq(transactions.userId, userId),
        ),
      );
    await detectAndFlagRefunds(userId);
  } else {
    await db
      .update(transactions)
      .set({ isRefund: parsed.data.isRefund, refundSource: "manual" })
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

const spendingTypeSchema = z.enum(["necessary", "discretionary"]);
const scopeSchema = z.enum([
  "transaction",
  "stream",
  "merchant",
  "name_signature",
]);

const classifySchema = z.object({
  transactionId: z.string().min(1),
  spendingType: spendingTypeSchema,
  scope: scopeSchema,
});

export type ClassifyTransactionInput = z.infer<typeof classifySchema>;

export async function classifyTransactionAction(
  input: ClassifyTransactionInput,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = classifySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;

  const [tx] = await db
    .select({ id: transactions.id })
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

  try {
    await classifyTransaction(
      userId,
      parsed.data.transactionId,
      parsed.data.spendingType,
      parsed.data.scope,
    );
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to classify",
    };
  }

  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/settings");
  return { success: true as const };
}

const clearTxSchema = z.object({ transactionId: z.string().min(1) });

export async function clearTransactionClassificationAction(
  input: z.infer<typeof clearTxSchema>,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = clearTxSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;

  const [tx] = await db
    .select({ id: transactions.id })
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

  await clearTxClassification(userId, parsed.data.transactionId);
  revalidatePath("/transactions");
  revalidatePath("/");
  return { success: true as const };
}

const clearStreamSchema = z.object({ streamId: z.string().min(1) });

export async function clearStreamClassificationAction(
  input: z.infer<typeof clearStreamSchema>,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = clearStreamSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;

  const [stream] = await db
    .select({ streamId: recurringStreams.streamId })
    .from(recurringStreams)
    .where(
      and(
        eq(recurringStreams.streamId, parsed.data.streamId),
        eq(recurringStreams.userId, userId),
      ),
    );
  if (!stream) {
    return { success: false as const, error: "Stream not found" };
  }

  await clearStreamClassificationCore(userId, parsed.data.streamId);
  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/settings");
  return { success: true as const };
}

const deleteRuleSchema = z.object({ ruleId: z.string().min(1) });

export async function deleteSpendingRuleAction(
  input: z.infer<typeof deleteRuleSchema>,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = deleteRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;

  const [rule] = await db
    .select({ id: spendingRules.id })
    .from(spendingRules)
    .where(
      and(
        eq(spendingRules.id, parsed.data.ruleId),
        eq(spendingRules.userId, userId),
      ),
    );
  if (!rule) {
    return { success: false as const, error: "Rule not found" };
  }

  await deleteSpendingRuleCore(userId, parsed.data.ruleId);
  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/settings");
  return { success: true as const };
}
