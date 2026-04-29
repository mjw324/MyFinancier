import {
  and,
  between,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
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

export async function getTransactionsWithAccount(
  userId: string,
  opts?: { limit?: number; offset?: number },
) {
  return db.query.transactions.findMany({
    where: eq(transactions.userId, userId),
    orderBy: desc(transactions.date),
    limit: opts?.limit ?? 50,
    offset: opts?.offset ?? 0,
    with: { financialAccount: true },
  });
}

export interface TransactionFilters {
  search?: string;
  accountId?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
  recurring?: "all" | "recurring" | "onetime";
}

function buildFilterConditions(userId: string, filters: TransactionFilters) {
  const conditions = [eq(transactions.userId, userId)];

  if (filters.accountId) {
    conditions.push(eq(transactions.accountId, filters.accountId));
  }
  if (filters.category) {
    conditions.push(eq(transactions.category, filters.category));
  }
  if (filters.startDate && filters.endDate) {
    const endOfDay = new Date(filters.endDate);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(
      between(transactions.date, filters.startDate, endOfDay),
    );
  } else if (filters.startDate) {
    conditions.push(sql`${transactions.date} >= ${filters.startDate.toISOString()}`);
  } else if (filters.endDate) {
    const endOfDay = new Date(filters.endDate);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(sql`${transactions.date} <= ${endOfDay.toISOString()}`);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(transactions.name, pattern),
        ilike(transactions.merchantName, pattern),
      )!,
    );
  }
  if (filters.recurring === "recurring") {
    conditions.push(isNotNull(transactions.recurringStreamId));
  } else if (filters.recurring === "onetime") {
    conditions.push(isNull(transactions.recurringStreamId));
  }

  return and(...conditions);
}

export async function searchTransactions(
  userId: string,
  filters: TransactionFilters,
  opts?: { limit?: number; offset?: number },
) {
  return db.query.transactions.findMany({
    where: buildFilterConditions(userId, filters),
    orderBy: desc(transactions.date),
    limit: opts?.limit ?? 25,
    offset: opts?.offset ?? 0,
    with: { financialAccount: true },
  });
}

export async function getDistinctCategories(userId: string) {
  const rows = await db
    .selectDistinct({ category: transactions.category })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`${transactions.category} IS NOT NULL`,
      ),
    )
    .orderBy(transactions.category);

  return rows
    .map((r) => r.category!)
    .filter(Boolean);
}

export async function getTransactionCount(
  userId: string,
  filters: TransactionFilters = {},
) {
  const [result] = await db
    .select({ total: count() })
    .from(transactions)
    .where(buildFilterConditions(userId, filters));
  return result?.total ?? 0;
}
