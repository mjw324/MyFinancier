import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { transactions } from "@/lib/db/schema/transactions";
import type { ProjectionInputStream } from "@/lib/plaid/projection";

export interface ListStreamsOptions {
  flowType?: "inflow" | "outflow";
  activeOnly?: boolean;
  includeTombstoned?: boolean;
}

export async function listRecurringStreams(
  userId: string,
  opts: ListStreamsOptions = {},
) {
  const filters = [eq(recurringStreams.userId, userId)];
  if (opts.activeOnly !== false) {
    filters.push(eq(recurringStreams.isActive, true));
  }
  if (opts.flowType) {
    filters.push(eq(recurringStreams.flowType, opts.flowType));
  }
  if (!opts.includeTombstoned) {
    filters.push(ne(recurringStreams.status, "TOMBSTONED"));
  }
  return db
    .select()
    .from(recurringStreams)
    .where(and(...filters))
    .orderBy(recurringStreams.predictedNextDate);
}

export async function getRecurringStream(userId: string, streamId: string) {
  return db.query.recurringStreams.findFirst({
    where: and(
      eq(recurringStreams.streamId, streamId),
      eq(recurringStreams.userId, userId),
    ),
  });
}

export async function getStreamTransactions(
  userId: string,
  streamId: string,
  limit = 50,
) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.recurringStreamId, streamId),
      ),
    )
    .orderBy(desc(transactions.date))
    .limit(limit);
}

export type RecurringStreamRow = typeof recurringStreams.$inferSelect;

export function toProjectionInput(
  row: RecurringStreamRow,
  recentDates: Date[] = [],
): ProjectionInputStream {
  return {
    streamId: row.streamId,
    flowType: row.flowType as "inflow" | "outflow",
    frequency: row.frequency as ProjectionInputStream["frequency"],
    status: row.status as ProjectionInputStream["status"],
    isActive: row.isActive,
    predictedNextDate: row.predictedNextDate,
    lastDate: row.lastDate,
    averageAmount: Number(row.averageAmount),
    lastAmount: Number(row.lastAmount),
    merchantName: row.merchantName,
    description: row.description,
    customName: row.customName,
    recentTransactionDates: recentDates,
  };
}

export interface PostedStreamTransaction {
  streamId: string;
  date: Date;
  amount: number;
  customName: string | null;
  merchantName: string | null;
  name: string;
}

export async function getStreamTransactionsInRange(
  userId: string,
  streamIds: string[],
  from: Date,
  to: Date,
): Promise<PostedStreamTransaction[]> {
  if (streamIds.length === 0) return [];
  const rows = await db
    .select({
      streamId: transactions.recurringStreamId,
      date: transactions.date,
      amount: transactions.amount,
      customName: transactions.customName,
      merchantName: transactions.merchantName,
      name: transactions.name,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.recurringStreamId, streamIds),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .orderBy(desc(transactions.date));

  return rows
    .filter((r): r is typeof r & { streamId: string } => r.streamId !== null)
    .map((r) => ({
      streamId: r.streamId,
      date: r.date,
      amount: Number(r.amount),
      customName: r.customName,
      merchantName: r.merchantName,
      name: r.name,
    }));
}

export async function getRecentTransactionDatesByStream(
  userId: string,
  streamIds: string[],
  perStream = 4,
): Promise<Map<string, Date[]>> {
  if (streamIds.length === 0) return new Map();
  const rows = await db
    .select({
      streamId: transactions.recurringStreamId,
      date: transactions.date,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.recurringStreamId, streamIds),
      ),
    )
    .orderBy(desc(transactions.date));

  const result = new Map<string, Date[]>();
  for (const row of rows) {
    if (!row.streamId) continue;
    const list = result.get(row.streamId) ?? [];
    if (list.length < perStream) {
      list.push(row.date);
      result.set(row.streamId, list);
    }
  }
  return result;
}
