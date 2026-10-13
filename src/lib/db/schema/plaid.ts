import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const plaidItems = pgTable(
  "plaid_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    accessToken: text("access_token").notNull(),
    itemId: text("item_id").unique().notNull(),
    cursor: text("cursor"),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    status: text("status").notNull().default("active"),
    // Sync scheduling. A webhook stamps sync_requested_at and returns; a worker
    // claims the item by setting sync_lease_until (one atomic UPDATE) and
    // drains until no newer request is pending.
    syncRequestedAt: timestamp("sync_requested_at", { mode: "date" }),
    syncLeaseUntil: timestamp("sync_lease_until", { mode: "date" }),
    lastSyncStartedAt: timestamp("last_sync_started_at", { mode: "date" }),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { mode: "date" }),
    lastSyncErrorCode: text("last_sync_error_code"),
    recurringRequestedAt: timestamp("recurring_requested_at", { mode: "date" }),
    recurringFetchedAt: timestamp("recurring_fetched_at", { mode: "date" }),
    historicalUpdateCompleteAt: timestamp("historical_update_complete_at", {
      mode: "date",
    }),
    // Non-blocking problems the user should act on (e.g. 'login_required',
    // 'pending_disconnect', 'new_accounts_available'). Sync is gated on
    // `status`, never on this.
    attention: text("attention"),
    consentExpiresAt: timestamp("consent_expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("plaid_items_user_id_idx").on(table.userId),
    // Deliberately NO unique index on (user_id, institution_id). A user may
    // hold several logins at one bank (joint, business), which Plaid calls
    // legitimate; "one Item per institution" is "not recommended as the
    // primary means of detecting duplicate Items"
    // (https://plaid.com/docs/link/duplicate-items/). Duplicates are caught
    // in src/lib/plaid/link.ts by institution + account name + mask, before
    // the public token is exchanged, and again under a per-user advisory lock
    // before the insert. The production-only partial index
    // plaid_items_user_institution_active_idx must be dropped by migration.
  ],
).enableRLS();
