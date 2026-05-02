import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

export const spendingRules = pgTable(
  "spending_rules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    matchType: text("match_type").notNull(),
    matchValue: text("match_value").notNull(),
    spendingType: text("spending_type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("spending_rules_user_match_idx").on(
      table.userId,
      table.matchType,
      table.matchValue,
    ),
    check(
      "spending_rules_match_type_check",
      sql`${table.matchType} IN ('merchant','name_signature')`,
    ),
    check(
      "spending_rules_spending_type_check",
      sql`${table.spendingType} IN ('necessary','discretionary')`,
    ),
  ],
).enableRLS();
