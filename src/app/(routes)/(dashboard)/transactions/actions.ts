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
  ClassificationError,
  classifyTransaction,
  clearTransactionClassification as clearTxClassification,
  clearStreamClassification as clearStreamClassificationCore,
  deleteSpendingRule as deleteSpendingRuleCore,
} from "@/lib/spending/classify";
import { applySpendingClassifications } from "@/lib/spending/classify";
import { logError } from "@/lib/logging";
import { FLOW_CLASSES } from "@/lib/analytics/flow";
import {
  clearManualFlowClass,
  recomputeUserFlowsLocked,
  setManualFlowClass,
  unpairTransfer,
  type OverrideResult,
} from "@/lib/analytics/apply-flow-classes";

/** Pages whose numbers depend on flow classes. */
function revalidateFlowPages() {
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/budgets");
}

/** Spending types follow transfer status, so refresh them for changed rows. */
async function refreshSpendingTypes(userId: string, ids: string[]) {
  if (ids.length > 0) await applySpendingClassifications(userId, ids);
}

function overrideResponse(result: OverrideResult) {
  if (!result.ok) {
    return {
      success: false as const,
      error:
        result.error === "not_found"
          ? "Transaction not found"
          : "That classification does not fit this transaction",
    };
  }
  return { success: true as const, flowClass: result.flowClass };
}

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
  // A hand-set category is the user's own: category rules never replace it.
  const customCategorySource = customCategory ? ("manual" as const) : null;
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
      .set({ customName, customCategory, customCategorySource })
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.recurringStreamId, tx.recurringStreamId),
        ),
      );
  } else {
    await db
      .update(transactions)
      .set({ customName, customCategory, customCategorySource })
      .where(
        and(
          eq(transactions.id, parsed.data.transactionId),
          eq(transactions.userId, userId),
        ),
      );
  }

  // The category is an input to flow classification (and the name to the
  // counterparty key): recompute so totals follow the edit. A failure here
  // leaves the edit saved; the next sync's pass heals the classes.
  try {
    const result = await recomputeUserFlowsLocked(userId);
    await refreshSpendingTypes(userId, result.changedIds);
  } catch (err) {
    logError("transactions.reclassify-failed", err, { userId });
  }

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidateFlowPages();
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

  // The refund toggle is a manual flow class now: on = refund, off = counts
  // as income, reset = automatic classification.
  const result =
    parsed.data.isRefund === null
      ? await clearManualFlowClass(userId, parsed.data.transactionId)
      : await setManualFlowClass(
          userId,
          parsed.data.transactionId,
          parsed.data.isRefund ? "refund" : "income",
        );
  if (!result.ok) return overrideResponse(result);
  await refreshSpendingTypes(userId, result.changedIds);

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidateFlowPages();
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
    if (err instanceof ClassificationError) {
      return { success: false as const, error: err.message };
    }
    logError("transactions.classify-failed", err, { userId });
    return { success: false as const, error: "Failed to classify" };
  }

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { success: true as const };
}

const flowClassSchema = z.object({
  transactionId: z.string().min(1),
  flowClass: z.enum(FLOW_CLASSES),
});

export type SetFlowClassInput = z.infer<typeof flowClassSchema>;

/** Pins a transaction to a flow class chosen by the user. */
export async function setFlowClassAction(input: SetFlowClassInput) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = flowClassSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;
  try {
    const result = await setManualFlowClass(
      userId,
      parsed.data.transactionId,
      parsed.data.flowClass,
    );
    if (result.ok) await refreshSpendingTypes(userId, result.changedIds);
    revalidateFlowPages();
    return overrideResponse(result);
  } catch (err) {
    logError("transactions.set-flow-class-failed", err, { userId });
    return { success: false as const, error: "Failed to update" };
  }
}

const flowRowSchema = z.object({ transactionId: z.string().min(1) });

/** Returns a transaction to automatic flow classification. */
export async function clearFlowClassAction(
  input: z.infer<typeof flowRowSchema>,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = flowRowSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;
  try {
    const result = await clearManualFlowClass(userId, parsed.data.transactionId);
    if (result.ok) await refreshSpendingTypes(userId, result.changedIds);
    revalidateFlowPages();
    return overrideResponse(result);
  } catch (err) {
    logError("transactions.clear-flow-class-failed", err, { userId });
    return { success: false as const, error: "Failed to update" };
  }
}

/** "Not a transfer": dissolves a transfer pair and reclassifies both legs. */
export async function unpairTransferAction(
  input: z.infer<typeof flowRowSchema>,
) {
  const session = await getServerSession();
  if (!session?.user) {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = flowRowSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid input" };
  }
  const userId = session.user.id;
  try {
    const result = await unpairTransfer(userId, parsed.data.transactionId);
    if (result.ok) await refreshSpendingTypes(userId, result.changedIds);
    revalidateFlowPages();
    return overrideResponse(result);
  } catch (err) {
    logError("transactions.unpair-failed", err, { userId });
    return { success: false as const, error: "Failed to update" };
  }
}
