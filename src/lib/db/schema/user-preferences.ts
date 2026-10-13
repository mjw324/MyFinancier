import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  hideTransfersFromList: boolean("hide_transfers_from_list")
    .notNull()
    .default(false),
  // IANA zone (e.g. "America/New_York"). "Today" and calendar periods are
  // resolved in this zone; null falls back to the browser cookie, then UTC.
  timeZone: text("time_zone"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export type UserPreferences = typeof userPreferences.$inferSelect;
