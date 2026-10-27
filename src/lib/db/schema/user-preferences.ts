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
  // AI opt-in. AI features run only when ai_opt_in is true AND AI_ENABLED=true.
  // The timestamp and consent-text version record what the user agreed to.
  aiOptIn: boolean("ai_opt_in").notNull().default(false),
  aiConsentAt: timestamp("ai_consent_at", { mode: "date" }),
  aiConsentVersion: text("ai_consent_version"),
  // Weekly digest job (src/lib/insights/jobs.ts): this row is the one-row job
  // record, claimed by one atomic UPDATE on digest_lease_until.
  digestDueAt: timestamp("digest_due_at", { mode: "date" }),
  digestLeaseUntil: timestamp("digest_lease_until", { mode: "date" }),
  lastDigestAt: timestamp("last_digest_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export type UserPreferences = typeof userPreferences.$inferSelect;
