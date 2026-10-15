import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "..";
import { transactions } from "../schema";
import {
  FLOW_CLASS_GROUP,
  effectiveCategorySql,
  flowClassInSql,
  flowGroupSql,
  spendBucketSql,
  type FlowClass,
  type FlowGroup,
} from "@/lib/analytics/flow";
import {
  counterpartySql,
  fixedCostSql,
  getCashFlow,
  isTransferSql,
  spendRowsSql,
  type CashFlow,
} from "@/lib/analytics/metrics";
import { utcAddDays, utcStartOfDay } from "@/lib/analytics/periods";

export interface TransactionFilters {
  search?: string;
  accountId?: string;
  /** Effective category (custom_category ?? category), exact. */
  category?: string;
  /**
   * Spending bucket from the dashboard's "Where it went". Restricts to the rows
   * that bucket summed: counted spending/offset rows whose bucket matches.
   */
  bucket?: string;
  flowClass?: FlowClass;
  flowGroup?: FlowGroup;
  /** Counterparty key, as grouped by the merchant lists. */
  counterparty?: string;
  /** "spending": the rows net spending sums (spending + refunds/reimbursements). */
  view?: "spending";
  /** Fixed or variable costs (counted spending/offset rows only). */
  cost?: "fixed" | "variable";
  /** Inclusive calendar date (UTC midnight). */
  startDate?: Date;
  /** Inclusive calendar date (UTC midnight). */
  endDate?: Date;
  recurring?: "all" | "recurring" | "onetime";
  spendingType?: "necessary" | "discretionary" | "unclassified";
  /** false = honour the "hide transfers" list preference. */
  includeTransfers?: boolean;
}

/**
 * The one WHERE clause behind the transactions list, its count, its totals and
 * the export. Totals and counts use exactly the rows the list shows.
 */
export function buildFilterConditions(
  userId: string,
  filters: TransactionFilters,
): SQL {
  const conditions: SQL[] = [eq(transactions.userId, userId)];

  // Asking for transfers or savings explicitly overrides the hide-transfers
  // list preference; otherwise a "Saved / moved" link would open an empty list.
  const wantsTransfers =
    filters.flowGroup === "internal" ||
    filters.flowGroup === "savings" ||
    (filters.flowClass !== undefined &&
      ["internal", "savings"].includes(FLOW_CLASS_GROUP[filters.flowClass]));
  if (filters.includeTransfers === false && !wantsTransfers) {
    conditions.push(not(isTransferSql));
  }
  if (filters.view === "spending") {
    conditions.push(spendRowsSql);
  }
  if (filters.accountId) {
    conditions.push(eq(transactions.accountId, filters.accountId));
  }
  if (filters.category) {
    conditions.push(sql`${effectiveCategorySql} = ${filters.category}`);
  }
  if (filters.bucket) {
    conditions.push(spendRowsSql, sql`${spendBucketSql} = ${filters.bucket}`);
  }
  if (filters.flowClass) {
    conditions.push(flowClassInSql([filters.flowClass]));
  }
  if (filters.flowGroup) {
    conditions.push(flowGroupSql(filters.flowGroup));
  }
  if (filters.counterparty) {
    conditions.push(sql`${counterpartySql} = ${filters.counterparty}`);
  }
  if (filters.cost) {
    const fixed = fixedCostSql(userId);
    conditions.push(spendRowsSql, filters.cost === "fixed" ? fixed : not(fixed));
  }
  // Calendar dates: [start, end + 1 day). UTC throughout, so the server's (or
  // the test runner's) zone can never shift a boundary.
  if (filters.startDate) {
    conditions.push(gte(transactions.date, utcStartOfDay(filters.startDate)));
  }
  if (filters.endDate) {
    conditions.push(
      lt(transactions.date, utcAddDays(utcStartOfDay(filters.endDate), 1)),
    );
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
    // Spending rows (outflows that count as spending) with no type set.
    conditions.push(isNull(transactions.spendingType));
    conditions.push(sql`${transactions.amount}::numeric > 0`);
  }

  return and(...conditions)!;
}

/**
 * One page of matching rows, newest first. `id` breaks ties: every row of a
 * day shares the same midnight timestamp, and without a tiebreaker
 * LIMIT/OFFSET pages can repeat or skip rows.
 */
export async function searchTransactions(
  userId: string,
  filters: TransactionFilters,
  opts?: { limit?: number; offset?: number },
) {
  return db.query.transactions.findMany({
    where: buildFilterConditions(userId, filters),
    orderBy: [desc(transactions.date), desc(transactions.id)],
    limit: opts?.limit ?? 25,
    offset: opts?.offset ?? 0,
    with: { financialAccount: true },
  });
}

export async function getDistinctCategories(userId: string) {
  const rows = await db
    .selectDistinct({ category: sql<string>`${effectiveCategorySql}` })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), sql`${effectiveCategorySql} IS NOT NULL`),
    )
    .orderBy(effectiveCategorySql);

  return rows.map((r) => r.category).filter(Boolean);
}

export function hasActiveFilters(filters: TransactionFilters): boolean {
  return Boolean(
    filters.search ||
      filters.accountId ||
      filters.category ||
      filters.bucket ||
      filters.flowClass ||
      filters.flowGroup ||
      filters.counterparty ||
      filters.cost ||
      filters.view ||
      filters.startDate ||
      filters.endDate ||
      (filters.recurring && filters.recurring !== "all") ||
      filters.spendingType,
  );
}

export type TransactionTotals = CashFlow & {
  /** Rows matching the filters — the same number the list paginates. */
  count: number;
};

/**
 * Totals for exactly the rows the list shows (same filters, same
 * hide-transfers policy), computed by the same metric the dashboard uses.
 */
export async function getTransactionTotals(
  userId: string,
  filters: TransactionFilters = {},
): Promise<TransactionTotals> {
  const flow = await getCashFlow({
    userId,
    where: buildFilterConditions(userId, filters),
  });
  return { ...flow, count: flow.rowCount };
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
