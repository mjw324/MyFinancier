import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { categories } from "./categories";

export const BUDGET_PERIODS = ["weekly", "monthly", "yearly"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const budgets = pgTable(
  "budgets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /**
     * Legacy link to the (never populated) categories table. Budgets now key
     * on `categoryKey`; kept nullable so old rows survive the migration.
     */
    categoryId: text("category_id").references(() => categories.id),
    /**
     * The spending bucket this budget tracks — the value of `spendBucketSql`
     * (src/lib/analytics/flow.ts): a Plaid category (FOOD_AND_DRINK), a
     * synthetic bucket (CASH_WITHDRAWALS, SENT_TO_PEOPLE) or one of the
     * user's custom category labels.
     */
    categoryKey: text("category_key").notNull(),
    amount: numeric("amount").notNull(),
    period: text("period").notNull(),
    /** First day of the first period; later periods repeat from this anchor. */
    startDate: timestamp("start_date", { mode: "date" }).notNull(),
    /** Last day the budget applies (inclusive); null = open-ended. */
    endDate: timestamp("end_date", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (table) => [
    index("budgets_user_id_idx").on(table.userId),
    index("budgets_user_category_key_idx").on(table.userId, table.categoryKey),
    check(
      "budgets_period_check",
      sql`${table.period} IN ('weekly','monthly','yearly')`,
    ),
    check("budgets_amount_positive_check", sql`${table.amount} > 0`),
    check(
      "budgets_end_after_start_check",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
).enableRLS();
