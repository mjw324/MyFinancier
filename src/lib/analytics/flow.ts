import { sql, type SQL } from "drizzle-orm";
import { transactions } from "@/lib/db/schema/transactions";

/**
 * Flow classification — the one model of money movement every number in the
 * app is computed from.
 *
 * Each transaction carries exactly one flow class (transactions.flow_class).
 * Classes roll up into groups, and every aggregate (dashboard, transactions
 * totals, budgets, exports, insights) is built from the SQL expressions at the
 * bottom of this file, so two screens can never disagree about what counts as
 * income or spending.
 *
 * Signs follow Plaid: amount > 0 is money leaving the account, amount < 0 is
 * money entering it.
 *
 * Product decisions encoded here:
 * - Money received from other people (Venmo/Zelle receipts) is a
 *   `reimbursement`: it offsets spending instead of counting as income.
 * - Cash withdrawals and payments sent to people count as spending.
 * - Only movements between the user's own linked accounts (and card payments)
 *   are excluded; transfers to investments or to the user's unlinked accounts
 *   are reported as "saved / moved", never as spending.
 */

export const FLOW_CLASSES = [
  // income: earned or otherwise received money that is not a person paying you back
  "income",
  "other_inflow",
  // spending: money that left the user's perimeter for goods, services, people
  "spending",
  "debt_payment",
  "cash_withdrawal",
  "p2p_payment",
  // offset: money coming back that reduces spending
  "refund",
  "reimbursement",
  "card_reward",
  // savings: money moved to/from investments or the user's own unlinked accounts
  "savings_out",
  "savings_in",
  "external_transfer_out",
  "external_transfer_in",
  // internal: both legs inside the linked perimeter — always excluded
  "cc_payment",
  "internal_transfer",
  "zero",
] as const;

export type FlowClass = (typeof FLOW_CLASSES)[number];

export type FlowGroup = "income" | "spending" | "offset" | "savings" | "internal";

export const FLOW_CLASS_GROUP: Record<FlowClass, FlowGroup> = {
  income: "income",
  other_inflow: "income",
  spending: "spending",
  debt_payment: "spending",
  cash_withdrawal: "spending",
  p2p_payment: "spending",
  refund: "offset",
  reimbursement: "offset",
  card_reward: "offset",
  savings_out: "savings",
  savings_in: "savings",
  external_transfer_out: "savings",
  external_transfer_in: "savings",
  cc_payment: "internal",
  internal_transfer: "internal",
  zero: "internal",
};

export const FLOW_CLASS_LABEL: Record<FlowClass, string> = {
  income: "Income",
  other_inflow: "Other money in",
  spending: "Spending",
  debt_payment: "Debt payment",
  cash_withdrawal: "Cash withdrawal",
  p2p_payment: "Sent to someone",
  refund: "Refund",
  reimbursement: "Reimbursement",
  card_reward: "Reward / cashback",
  savings_out: "Saved / invested",
  savings_in: "Withdrawn from savings",
  external_transfer_out: "Moved to your other account",
  external_transfer_in: "From your other account",
  cc_payment: "Card payment",
  internal_transfer: "Transfer between your accounts",
  zero: "Zero amount",
};

export function isFlowClass(value: unknown): value is FlowClass {
  return (
    typeof value === "string" &&
    (FLOW_CLASSES as readonly string[]).includes(value)
  );
}

export function classesInGroup(group: FlowGroup): FlowClass[] {
  return FLOW_CLASSES.filter((c) => FLOW_CLASS_GROUP[c] === group);
}

/**
 * Legacy flags, derived from the flow class so older screens and filters
 * (hide-transfers toggle, refund pill) agree with the model.
 * - isTransfer: excluded from income and spending (internal + savings).
 * - isRefund: money coming back that offsets spending.
 */
export function legacyFlagsFor(flowClass: FlowClass): {
  isTransfer: boolean;
  isRefund: boolean;
} {
  const group = FLOW_CLASS_GROUP[flowClass];
  return {
    isTransfer: group === "internal" || group === "savings",
    isRefund: group === "offset",
  };
}

/**
 * Synthetic spending-bucket keys for classes whose Plaid category is not a
 * meaningful "where did it go" answer. A user-set custom category always wins.
 */
export const SYNTHETIC_BUCKETS = {
  cash_withdrawal: "CASH_WITHDRAWALS",
  p2p_payment: "SENT_TO_PEOPLE",
  reimbursement: "REIMBURSEMENTS",
  card_reward: "REWARDS",
} as const satisfies Partial<Record<FlowClass, string>>;

export const UNCATEGORIZED_BUCKET = "UNCATEGORIZED";

/** Pending rows older than this are assumed abandoned and never counted. */
export const PENDING_MAX_AGE_DAYS = 14;

// ---------------------------------------------------------------------------
// Canonical SQL. Every aggregate must be built from these expressions.
// They reference the `transactions` table columns directly, so they work in
// any query whose FROM includes `transactions` (unaliased).
// ---------------------------------------------------------------------------

// Constants are inlined as literals (not bind parameters) so the same
// expression can appear in SELECT and GROUP BY: Postgres treats $1 and $5 as
// different expressions even when they carry the same value.
function literal(value: string): SQL {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Refusing to inline non-identifier literal: ${value}`);
  }
  return sql.raw(`'${value}'`);
}

function inList(classes: readonly FlowClass[]): SQL {
  return sql.join(
    classes.map((c) => literal(c)),
    sql`, `,
  );
}

const amountNum = sql`(${transactions.amount})::numeric`;

/** Rows that participate in totals: classified, and not stale-pending. */
export const countedSql: SQL = sql`(${transactions.flowClass} IS NOT NULL AND (${transactions.pending} IS NOT TRUE OR ${transactions.date} >= now() - make_interval(days => ${sql.raw(String(PENDING_MAX_AGE_DAYS))})))`;

export function flowClassInSql(classes: readonly FlowClass[]): SQL {
  return sql`${transactions.flowClass} IN (${inList(classes)})`;
}

export function flowGroupSql(group: FlowGroup): SQL {
  return flowClassInSql(classesInGroup(group));
}

/** Positive for money in. Income group only. */
export const incomeAmountSql: SQL = sql`CASE WHEN ${flowGroupSql("income")} THEN -${amountNum} ELSE 0 END`;

/**
 * Net spending contribution: spending-group outflows, minus offsets
 * (refunds, reimbursements, rewards carry negative amounts).
 */
export const netSpendAmountSql: SQL = sql`CASE WHEN ${flowClassInSql([
  ...classesInGroup("spending"),
  ...classesInGroup("offset"),
])} THEN ${amountNum} ELSE 0 END`;

/** Gross spending (before offsets). */
export const grossSpendAmountSql: SQL = sql`CASE WHEN ${flowGroupSql("spending")} THEN ${amountNum} ELSE 0 END`;

/** Offsets as a positive number (money that came back). */
export const offsetAmountSql: SQL = sql`CASE WHEN ${flowGroupSql("offset")} THEN -${amountNum} ELSE 0 END`;

/** Net saved/moved out of view: savings_out minus savings_in, etc. */
export const savedAmountSql: SQL = sql`CASE WHEN ${flowGroupSql("savings")} THEN ${amountNum} ELSE 0 END`;

/**
 * Spending bucket for "where did it go": the effective category
 * (custom_category ?? category), except synthetic buckets for classes whose
 * Plaid category is meaningless for that question.
 */
export const spendBucketSql: SQL = sql`CASE
  WHEN ${transactions.customCategory} IS NOT NULL THEN ${transactions.customCategory}
  WHEN ${transactions.flowClass} = ${literal("cash_withdrawal")} THEN ${literal(SYNTHETIC_BUCKETS.cash_withdrawal)}
  WHEN ${transactions.flowClass} = ${literal("p2p_payment")} THEN ${literal(SYNTHETIC_BUCKETS.p2p_payment)}
  WHEN ${transactions.flowClass} = ${literal("reimbursement")} THEN ${literal(SYNTHETIC_BUCKETS.reimbursement)}
  WHEN ${transactions.flowClass} = ${literal("card_reward")} THEN ${literal(SYNTHETIC_BUCKETS.card_reward)}
  ELSE COALESCE(${transactions.category}, ${literal(UNCATEGORIZED_BUCKET)})
END`;

/** Effective category (custom_category ?? category). */
export const effectiveCategorySql: SQL = sql`COALESCE(${transactions.customCategory}, ${transactions.category})`;
