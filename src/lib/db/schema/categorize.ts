import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { transactions } from "./transactions";

/**
 * The user's category overrides, keyed like spending_rules (normalized
 * merchant or name signature). A rule sets custom_category on every matching
 * transaction the user has not categorized by hand, and is applied before any
 * model call, so the model never sees a transaction a rule covers.
 */
export const categoryRules = pgTable(
  "category_rules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    matchType: text("match_type").notNull(),
    matchValue: text("match_value").notNull(),
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("category_rules_user_match_idx").on(
      table.userId,
      table.matchType,
      table.matchValue,
    ),
    check(
      "category_rules_match_type_check",
      sql`${table.matchType} IN ('merchant','name_signature')`,
    ),
  ],
).enableRLS();

/**
 * One model suggestion per transaction, waiting in the review queue until the
 * user accepts or rejects it. Nothing here changes a transaction by itself:
 * accepting is a Server Action that writes custom_category.
 *
 * `suggested` is a Plaid primary, or null when the model said "uncertain"
 * (those still reach the queue, for the user to pick a category).
 */
export const categorySuggestions = pgTable(
  "category_suggestions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    suggested: text("suggested"),
    // "pending" | "accepted" | "rejected"
    status: text("status").notNull().default("pending"),
    // The category the user accepted (may differ from `suggested`).
    acceptedCategory: text("accepted_category"),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("category_suggestions_transaction_idx").on(table.transactionId),
    index("category_suggestions_user_status_idx").on(table.userId, table.status),
    check(
      "category_suggestions_status_check",
      sql`${table.status} IN ('pending','accepted','rejected')`,
    ),
  ],
).enableRLS();

export type CategorySuggestionRow = typeof categorySuggestions.$inferSelect;
