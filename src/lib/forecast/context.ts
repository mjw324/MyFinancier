import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { getAccountsWithBalances } from "@/lib/db/queries/accounts";
import { listRecurringStreams, toProjectionInput } from "@/lib/db/queries/recurring";
import { addUtcDays, utcDay } from "@/lib/plaid/projection";
import type { ForecastStream, ForecastTxn, ForecastWindowInput } from "./safe-to-spend";

/** Long enough to hold four semi-monthly occurrences plus the late/grace margin. */
const LOOKBACK_DAYS = 62;

/**
 * Everything the forecast needs, in three queries: active streams, accounts
 * with balances, and the last ~2 months of transactions (to recognise
 * occurrences that already posted or are pending, and SEMI_MONTHLY days).
 */
export async function loadForecastInput(
  userId: string,
  today: Date,
): Promise<ForecastWindowInput> {
  const day = utcDay(today);
  const [rows, accounts, txns] = await Promise.all([
    listRecurringStreams(userId, { activeOnly: true }),
    getAccountsWithBalances(userId),
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        recurringStreamId: transactions.recurringStreamId,
        amount: transactions.amount,
        date: transactions.date,
        pending: transactions.pending,
        name: transactions.name,
        merchantName: transactions.merchantName,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.date, addUtcDays(day, -LOOKBACK_DAYS)),
          lt(transactions.date, addUtcDays(day, 2)),
        ),
      )
      .orderBy(desc(transactions.date)),
  ]);

  const recentByStream = new Map<string, Date[]>();
  for (const t of txns) {
    if (!t.recurringStreamId || t.pending) continue;
    const list = recentByStream.get(t.recurringStreamId) ?? [];
    if (list.length < 4) list.push(t.date);
    recentByStream.set(t.recurringStreamId, list);
  }

  const streams: ForecastStream[] = rows.map((row) => ({
    ...toProjectionInput(row, recentByStream.get(row.streamId) ?? []),
    accountId: row.accountId,
  }));

  return {
    today: day,
    streams,
    txns: txns as ForecastTxn[],
    accounts: accounts.map((a) => a.balance),
  };
}
