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
import { financialAccounts } from "./accounts";
import { recurringStreams } from "./recurring";

export const transactions = pgTable(
  "transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id")
      .notNull()
      .references(() => financialAccounts.id),
    plaidTransactionId: text("plaid_transaction_id").unique(),
    amount: numeric("amount").notNull(),
    date: timestamp("date", { mode: "date" }).notNull(),
    name: text("name").notNull(),
    merchantName: text("merchant_name"),
    category: text("category"),
    categoryId: text("category_id"),
    customName: text("custom_name"),
    customCategory: text("custom_category"),
    pending: boolean("pending").default(false),
    recurringStreamId: text("recurring_stream_id").references(
      () => recurringStreams.streamId,
      { onDelete: "set null" },
    ),
    spendingType: text("spending_type"),
    spendingTypeSource: text("spending_type_source"),
    normalizedMerchant: text("normalized_merchant"),
    nameSignature: text("name_signature"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (table) => [
    index("transactions_user_id_idx").on(table.userId),
    index("transactions_date_idx").on(table.date),
    index("transactions_recurring_stream_id_idx").on(table.recurringStreamId),
    index("transactions_normalized_merchant_idx").on(table.normalizedMerchant),
    index("transactions_name_signature_idx").on(table.nameSignature),
    index("transactions_user_spending_type_idx").on(
      table.userId,
      table.spendingType,
    ),
    check(
      "transactions_spending_type_check",
      sql`${table.spendingType} IS NULL OR ${table.spendingType} IN ('necessary','discretionary')`,
    ),
    check(
      "transactions_spending_type_source_check",
      sql`${table.spendingTypeSource} IS NULL OR ${table.spendingTypeSource} IN ('manual','stream','rule','override')`,
    ),
  ],
).enableRLS();
