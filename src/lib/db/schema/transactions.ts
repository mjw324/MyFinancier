import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { financialAccounts } from "./accounts";

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
    pending: boolean("pending").default(false),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (table) => [
    index("transactions_user_id_idx").on(table.userId),
    index("transactions_date_idx").on(table.date),
  ],
).enableRLS();
