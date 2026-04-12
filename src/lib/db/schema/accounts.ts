import { index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { plaidItems } from "./plaid";

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    plaidItemId: text("plaid_item_id")
      .notNull()
      .references(() => plaidItems.id),
    plaidAccountId: text("plaid_account_id").unique().notNull(),
    name: text("name").notNull(),
    officialName: text("official_name"),
    type: text("type").notNull(),
    subtype: text("subtype"),
    currentBalance: numeric("current_balance"),
    availableBalance: numeric("available_balance"),
    isoCurrencyCode: text("iso_currency_code").default("USD"),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
  },
  (table) => [index("financial_accounts_user_id_idx").on(table.userId)],
).enableRLS();
