import {
  and,
  between,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
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
  spendingType?: "necessary" | "discretionary" | "unclassified";
  includeTransfers?: boolean;
}

function buildFilterConditions(userId: string, filters: TransactionFilters) {
  const conditions = [eq(transactions.userId, userId)];

  if (filters.includeTransfers === false) {
    conditions.push(eq(transactions.isTransfer, false));
  }

  if (filters.accountId) {
    conditions.push(eq(transactions.accountId, filters.accountId));
  }
  if (filters.category) {
    conditions.push(
      sql`COALESCE(${transactions.customCategory}, ${transactions.category}) = ${filters.category}`,
    );
  }
  if (filters.startDate && filters.endDate) {
    const endOfDay = new Date(filters.endDate);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(
      between(transactions.date, filters.startDate, endOfDay),
    );
  } else if (filters.startDate) {
    conditions.push(gte(transactions.date, filters.startDate));
  } else if (filters.endDate) {
    const endOfDay = new Date(filters.endDate);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(lte(transactions.date, endOfDay));
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(transactions.customName, pattern),
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
  if (filters.spendingType === "necessary") {
    conditions.push(eq(transactions.spendingType, "necessary"));
  } else if (filters.spendingType === "discretionary") {
    conditions.push(eq(transactions.spendingType, "discretionary"));
  } else if (filters.spendingType === "unclassified") {
    // Spending only (positive amount) and no spendingType set.
    conditions.push(isNull(transactions.spendingType));
    conditions.push(sql`${transactions.amount}::numeric > 0`);
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
  const effective = sql<string>`COALESCE(${transactions.customCategory}, ${transactions.category})`;
  const rows = await db
    .selectDistinct({ category: effective })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`COALESCE(${transactions.customCategory}, ${transactions.category}) IS NOT NULL`,
      ),
    )
    .orderBy(effective);

  return rows
    .map((r) => r.category!)
    .filter(Boolean);
}

export function hasActiveFilters(filters: TransactionFilters): boolean {
  return Boolean(
    filters.search ||
      filters.accountId ||
      filters.category ||
      filters.startDate ||
      filters.endDate ||
      (filters.recurring && filters.recurring !== "all") ||
      filters.spendingType,
  );
}

export async function getTransactionTotals(
  userId: string,
  filters: TransactionFilters = {},
) {
  const [result] = await db
    .select({
      count: count(),
      expenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amount} > 0 THEN ${transactions.amount} ELSE 0 END), 0)`,
      incomeNeg: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amount} < 0 THEN ${transactions.amount} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(
      and(
        buildFilterConditions(userId, filters),
        eq(transactions.isTransfer, false),
      ),
    );

  const expenses = parseFloat(result?.expenses ?? "0");
  const income = -parseFloat(result?.incomeNeg ?? "0");
  return {
    count: result?.count ?? 0,
    income,
    expenses,
    net: expenses - income,
  };
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
