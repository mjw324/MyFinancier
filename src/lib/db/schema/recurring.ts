import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { plaidItems } from "./plaid";
import { financialAccounts } from "./accounts";

export const recurringStreams = pgTable(
  "recurring_streams",
  {
    streamId: text("stream_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    plaidItemId: text("plaid_item_id")
      .notNull()
      .references(() => plaidItems.id),
    accountId: text("account_id")
      .notNull()
      .references(() => financialAccounts.id),
    flowType: text("flow_type").notNull(),
    description: text("description").notNull(),
    merchantName: text("merchant_name"),
    frequency: text("frequency").notNull(),
    status: text("status").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    firstDate: timestamp("first_date", { mode: "date" }),
    lastDate: timestamp("last_date", { mode: "date" }),
    predictedNextDate: timestamp("predicted_next_date", { mode: "date" }),
    averageAmount: numeric("average_amount").notNull(),
    lastAmount: numeric("last_amount").notNull(),
    isoCurrencyCode: text("iso_currency_code").default("USD"),
    pfcPrimary: text("pfc_primary"),
    pfcDetailed: text("pfc_detailed"),
    pfcConfidenceLevel: text("pfc_confidence_level"),
    customName: text("custom_name"),
    customCategory: text("custom_category"),
    spendingType: text("spending_type"),
    plaidUpdatedDatetime: timestamp("plaid_updated_datetime", {
      mode: "date",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("recurring_streams_user_id_idx").on(table.userId),
    index("recurring_streams_plaid_item_id_idx").on(table.plaidItemId),
    index("recurring_streams_account_predicted_idx").on(
      table.accountId,
      table.predictedNextDate,
    ),
    check(
      "recurring_streams_spending_type_check",
      sql`${table.spendingType} IS NULL OR ${table.spendingType} IN ('necessary','discretionary')`,
    ),
  ],
).enableRLS();
