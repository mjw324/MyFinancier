import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { spendingRules } from "@/lib/db/schema/spending-rules";


/** Error whose message is safe to show to the user. */
export class ClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassificationError";
  }
}

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
    if (!row) throw new ClassificationError("Transaction not found");
    if (Number(row.amount) < 0) {
      throw new ClassificationError("Income transactions cannot be classified");
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
        throw new ClassificationError("Transaction is not part of a recurring stream");
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
      // Apply to every transaction in the stream that is not an override
      // (transfers and inflows excluded, as in applySpendingClassifications).
      await tx
        .update(transactions)
        .set({ spendingType, spendingTypeSource: "stream" })
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.recurringStreamId, row.recurringStreamId),
            eq(transactions.isTransfer, false),
            sql`${transactions.amount}::numeric >= 0`,
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
        throw new ClassificationError("Transaction has no merchant signature");
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
        throw new ClassificationError("Transaction has no name signature");
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
  // Skip transfers and inflows: they are not spending (audit 8.2).
  await exec
    .update(transactions)
    .set({ spendingType, spendingTypeSource: "rule" })
    .where(
      and(
        eq(transactions.userId, userId),
        eq(matchColumn, matchValue),
        eq(transactions.isTransfer, false),
        sql`${transactions.amount}::numeric >= 0`,
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

const CLASSIFY_ID_CHUNK = 5000;

/**
 * Re-derive automatic spending types in one set-based UPDATE per chunk.
 *
 * Precedence: classified recurring stream → merchant rule → name-signature
 * rule → none. Rows the user owns (source manual/override) are never touched.
 * Transfers and inflows (amount < 0) never carry an automatic spending type:
 * one left over from before is cleared. The IS DISTINCT FROM guard means rows
 * whose derived value is unchanged are neither written nor locked.
 *
 * Returns the number of rows changed.
 */
export async function applySpendingClassifications(
  userId: string,
  transactionIds?: string[],
  executor: DbExecutor = db,
): Promise<number> {
  if (transactionIds && transactionIds.length === 0) return 0;
  const chunks = transactionIds
    ? Array.from(
        { length: Math.ceil(transactionIds.length / CLASSIFY_ID_CHUNK) },
        (_, i) => transactionIds.slice(i * CLASSIFY_ID_CHUNK, (i + 1) * CLASSIFY_ID_CHUNK),
      )
    : [null];

  let changed = 0;
  for (const ids of chunks) {
    const idFilter = ids
      ? sql`AND c.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
      : sql``;
    const result = await executor.execute<{ id: string }>(sql`
      UPDATE ${transactions} AS t
      SET spending_type = d.new_type, spending_type_source = d.new_source
      FROM (
        SELECT c.id,
          CASE
            WHEN c.is_transfer OR c.amount::numeric < 0 THEN NULL
            WHEN s.spending_type IS NOT NULL THEN s.spending_type
            WHEN mr.spending_type IS NOT NULL THEN mr.spending_type
            WHEN sr.spending_type IS NOT NULL THEN sr.spending_type
          END AS new_type,
          CASE
            WHEN c.is_transfer OR c.amount::numeric < 0 THEN NULL
            WHEN s.spending_type IS NOT NULL THEN 'stream'
            WHEN mr.spending_type IS NOT NULL THEN 'rule'
            WHEN sr.spending_type IS NOT NULL THEN 'rule'
          END AS new_source
        FROM ${transactions} AS c
        LEFT JOIN ${recurringStreams} AS s
          ON s.stream_id = c.recurring_stream_id
        LEFT JOIN ${spendingRules} AS mr
          ON mr.user_id = c.user_id AND mr.match_type = 'merchant'
         AND mr.match_value = c.normalized_merchant
        LEFT JOIN ${spendingRules} AS sr
          ON sr.user_id = c.user_id AND sr.match_type = 'name_signature'
         AND sr.match_value = c.name_signature
        WHERE c.user_id = ${userId}
          AND (c.spending_type_source IS NULL OR c.spending_type_source NOT IN ('manual', 'override'))
          ${idFilter}
      ) AS d
      WHERE t.id = d.id
        AND (t.spending_type, t.spending_type_source) IS DISTINCT FROM (d.new_type, d.new_source)
      RETURNING t.id
    `);
    changed += Array.isArray(result)
      ? result.length
      : ((result as { rows?: unknown[] }).rows?.length ?? 0);
  }
  return changed;
}
