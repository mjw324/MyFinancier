import { and, between, desc, eq } from "drizzle-orm";
import { db } from "..";
import { transactions } from "../schema";

export async function getTransactionsByUserId(
  userId: string,
  opts?: { limit?: number; offset?: number },
) {
  return db.query.transactions.findMany({
    where: eq(transactions.userId, userId),
    orderBy: desc(transactions.date),
    limit: opts?.limit ?? 50,
    offset: opts?.offset ?? 0,
  });
}

export async function getTransactionsByAccount(
  accountId: string,
  opts?: { limit?: number; offset?: number },
) {
  return db.query.transactions.findMany({
    where: eq(transactions.accountId, accountId),
    orderBy: desc(transactions.date),
    limit: opts?.limit ?? 50,
    offset: opts?.offset ?? 0,
  });
}

export async function getTransactionsByDateRange(
  userId: string,
  startDate: Date,
  endDate: Date,
) {
  return db.query.transactions.findMany({
    where: and(
      eq(transactions.userId, userId),
      between(transactions.date, startDate, endDate),
    ),
    orderBy: desc(transactions.date),
  });
}
