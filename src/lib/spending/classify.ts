import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { spendingRules } from "@/lib/db/schema/spending-rules";

export type SpendingType = "necessary" | "discretionary";
export type SpendingTypeSource = "manual" | "stream" | "rule" | "override";
export type ClassifyScope =
  | "transaction"
  | "stream"
  | "merchant"
  | "name_signature";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function findRule(
  exec: Tx,
  userId: string,
  matchType: "merchant" | "name_signature",
  matchValue: string,
) {
  const [rule] = await exec
    .select()
    .from(spendingRules)
    .where(
      and(
        eq(spendingRules.userId, userId),
        eq(spendingRules.matchType, matchType),
        eq(spendingRules.matchValue, matchValue),
      ),
    )
    .limit(1);
  return rule ?? null;
}

async function deriveForTransaction(
  exec: Tx,
  userId: string,
  transactionId: string,
): Promise<{
  spendingType: SpendingType | null;
  source: SpendingTypeSource | null;
}> {
  const [row] = await exec
    .select({
      recurringStreamId: transactions.recurringStreamId,
      normalizedMerchant: transactions.normalizedMerchant,
      nameSignature: transactions.nameSignature,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return { spendingType: null, source: null };

  if (row.recurringStreamId) {
    const [stream] = await exec
      .select({ spendingType: recurringStreams.spendingType })
      .from(recurringStreams)
      .where(eq(recurringStreams.streamId, row.recurringStreamId))
      .limit(1);
    if (stream?.spendingType) {
      return {
        spendingType: stream.spendingType as SpendingType,
        source: "stream",
      };
    }
  }
  if (row.normalizedMerchant) {
    const rule = await findRule(
      exec,
      userId,
      "merchant",
      row.normalizedMerchant,
    );
    if (rule) {
      return {
        spendingType: rule.spendingType as SpendingType,
        source: "rule",
      };
    }
  }
  if (row.nameSignature) {
    const rule = await findRule(
      exec,
      userId,
      "name_signature",
      row.nameSignature,
    );
    if (rule) {
      return {
        spendingType: rule.spendingType as SpendingType,
        source: "rule",
      };
    }
  }
  return { spendingType: null, source: null };
}

export async function classifyTransaction(
  userId: string,
  transactionId: string,
  spendingType: SpendingType,
  scope: ClassifyScope,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: transactions.id,
        amount: transactions.amount,
        recurringStreamId: transactions.recurringStreamId,
        normalizedMerchant: transactions.normalizedMerchant,
        nameSignature: transactions.nameSignature,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Transaction not found");
    if (Number(row.amount) < 0) {
      throw new Error("Income transactions cannot be classified");
    }

    if (scope === "transaction") {
      // Was the row already governed by a stream/rule? If so, this is an override.
      const derived = await deriveForTransaction(tx, userId, transactionId);
      const source: SpendingTypeSource =
        derived.source && derived.source !== "manual" ? "override" : "manual";
      await tx
        .update(transactions)
        .set({ spendingType, spendingTypeSource: source })
        .where(eq(transactions.id, transactionId));
      return;
    }

    if (scope === "stream") {
      if (!row.recurringStreamId) {
        throw new Error("Transaction is not part of a recurring stream");
      }
      await tx
        .update(recurringStreams)
        .set({ spendingType, updatedAt: new Date() })
        .where(
          and(
            eq(recurringStreams.streamId, row.recurringStreamId),
            eq(recurringStreams.userId, userId),
          ),
        );
      // Apply to every transaction in the stream that is not an override.
      await tx
        .update(transactions)
        .set({ spendingType, spendingTypeSource: "stream" })
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.recurringStreamId, row.recurringStreamId),
            or(
              isNull(transactions.spendingTypeSource),
              ne(transactions.spendingTypeSource, "override"),
            ),
          ),
        );
      return;
    }

    if (scope === "merchant") {
      if (!row.normalizedMerchant) {
        throw new Error("Transaction has no merchant signature");
      }
      await upsertRule(tx, userId, "merchant", row.normalizedMerchant, spendingType);
      // Apply to every matching transaction not under an override and not under a classified stream.
      await applyRuleToTransactions(
        tx,
        userId,
        "merchant",
        row.normalizedMerchant,
        spendingType,
      );
      return;
    }

    if (scope === "name_signature") {
      if (!row.nameSignature) {
        throw new Error("Transaction has no name signature");
      }
      await upsertRule(tx, userId, "name_signature", row.nameSignature, spendingType);
      await applyRuleToTransactions(
        tx,
        userId,
        "name_signature",
        row.nameSignature,
        spendingType,
      );
      return;
    }
  });
}

async function upsertRule(
  exec: Tx,
  userId: string,
  matchType: "merchant" | "name_signature",
  matchValue: string,
  spendingType: SpendingType,
) {
  await exec
    .insert(spendingRules)
    .values({ userId, matchType, matchValue, spendingType })
    .onConflictDoUpdate({
      target: [
        spendingRules.userId,
        spendingRules.matchType,
        spendingRules.matchValue,
      ],
      set: { spendingType, updatedAt: new Date() },
    });
}

async function applyRuleToTransactions(
  exec: Tx,
  userId: string,
  matchType: "merchant" | "name_signature",
  matchValue: string,
  spendingType: SpendingType,
) {
  const matchColumn =
    matchType === "merchant"
      ? transactions.normalizedMerchant
      : transactions.nameSignature;
  // Skip rows under a classified stream — the stream wins.
  // Skip rows whose source is 'override' or 'manual'.
  await exec
    .update(transactions)
    .set({ spendingType, spendingTypeSource: "rule" })
    .where(
      and(
        eq(transactions.userId, userId),
        eq(matchColumn, matchValue),
        or(
          isNull(transactions.spendingTypeSource),
          and(
            ne(transactions.spendingTypeSource, "override"),
            ne(transactions.spendingTypeSource, "manual"),
          ),
        ),
        // Not under an active stream classification
        or(
          isNull(transactions.recurringStreamId),
          sql`NOT EXISTS (
            SELECT 1 FROM ${recurringStreams}
            WHERE ${recurringStreams.streamId} = ${transactions.recurringStreamId}
              AND ${recurringStreams.spendingType} IS NOT NULL
          )`,
        ),
      ),
    );
}

export async function clearTransactionClassification(
  userId: string,
  transactionId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Clear the row, then re-derive from stream/rule.
    await tx
      .update(transactions)
      .set({ spendingType: null, spendingTypeSource: null })
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId),
        ),
      );
    const derived = await deriveForTransaction(tx, userId, transactionId);
    if (derived.spendingType && derived.source) {
      await tx
        .update(transactions)
        .set({
          spendingType: derived.spendingType,
          spendingTypeSource: derived.source,
        })
        .where(
          and(
            eq(transactions.id, transactionId),
            eq(transactions.userId, userId),
          ),
        );
    }
  });
}

export async function clearStreamClassification(
  userId: string,
  streamId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(recurringStreams)
      .set({ spendingType: null, updatedAt: new Date() })
      .where(
        and(
          eq(recurringStreams.streamId, streamId),
          eq(recurringStreams.userId, userId),
        ),
      );
    // Null the stream-source rows in the stream
    await tx
      .update(transactions)
      .set({ spendingType: null, spendingTypeSource: null })
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.recurringStreamId, streamId),
          eq(transactions.spendingTypeSource, "stream"),
        ),
      );
    // Re-derive (rules may now apply)
    await reapplyForStream(tx, userId, streamId);
  });
}

async function reapplyForStream(exec: Tx, userId: string, streamId: string) {
  const rows = await exec
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.recurringStreamId, streamId),
        isNull(transactions.spendingTypeSource),
      ),
    );
  for (const row of rows) {
    const derived = await deriveForTransaction(exec, userId, row.id);
    if (derived.spendingType && derived.source) {
      await exec
        .update(transactions)
        .set({
          spendingType: derived.spendingType,
          spendingTypeSource: derived.source,
        })
        .where(eq(transactions.id, row.id));
    }
  }
}

export async function deleteSpendingRule(
  userId: string,
  ruleId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [rule] = await tx
      .select()
      .from(spendingRules)
      .where(
        and(eq(spendingRules.id, ruleId), eq(spendingRules.userId, userId)),
      )
      .limit(1);
    if (!rule) return;

    await tx
      .delete(spendingRules)
      .where(eq(spendingRules.id, ruleId));

    const matchColumn =
      rule.matchType === "merchant"
        ? transactions.normalizedMerchant
        : transactions.nameSignature;

    // Find affected rows that were source='rule' and matched this rule's value.
    const affected = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.spendingTypeSource, "rule"),
          eq(matchColumn, rule.matchValue),
        ),
      );

    if (affected.length === 0) return;

    // Null them out, then re-derive (stream wins, else null)
    await tx
      .update(transactions)
      .set({ spendingType: null, spendingTypeSource: null })
      .where(
        inArray(
          transactions.id,
          affected.map((r) => r.id),
        ),
      );

    for (const row of affected) {
      const derived = await deriveForTransaction(tx, userId, row.id);
      if (derived.spendingType && derived.source) {
        await tx
          .update(transactions)
          .set({
            spendingType: derived.spendingType,
            spendingTypeSource: derived.source,
          })
          .where(eq(transactions.id, row.id));
      }
    }
  });
}

export async function applySpendingClassifications(
  userId: string,
  transactionIds?: string[],
): Promise<void> {
  // Cascade: stream → merchant rule → name_signature rule → null
  // Skip rows where source ∈ {manual, override}
  if (transactionIds && transactionIds.length === 0) return;

  await db.transaction(async (tx) => {
    const baseConds = [
      eq(transactions.userId, userId),
      or(
        isNull(transactions.spendingTypeSource),
        and(
          ne(transactions.spendingTypeSource, "manual"),
          ne(transactions.spendingTypeSource, "override"),
        ),
      ),
    ];
    const conds = transactionIds
      ? [...baseConds, inArray(transactions.id, transactionIds)]
      : baseConds;

    const rows = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(...conds));

    for (const row of rows) {
      const derived = await deriveForTransaction(tx, userId, row.id);
      if (derived.spendingType && derived.source) {
        await tx
          .update(transactions)
          .set({
            spendingType: derived.spendingType,
            spendingTypeSource: derived.source,
          })
          .where(eq(transactions.id, row.id));
      } else {
        await tx
          .update(transactions)
          .set({ spendingType: null, spendingTypeSource: null })
          .where(eq(transactions.id, row.id));
      }
    }
  });
}
