import { index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { categories } from "./categories";

export const budgets = pgTable(
  "budgets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    amount: numeric("amount").notNull(),
    period: text("period").notNull(),
    startDate: timestamp("start_date", { mode: "date" }).notNull(),
    endDate: timestamp("end_date", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (table) => [index("budgets_user_id_idx").on(table.userId)],
).enableRLS();
