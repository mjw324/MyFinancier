-- Audit remediation. Hand-edited from drizzle-kit output so every statement is
-- idempotent: production was managed with `drizzle-kit push` and its
-- drizzle.__drizzle_migrations journal is empty, so this file is applied by
-- hand (psql / Supabase SQL editor) and may be re-run safely.
--
-- Additive except: drops the prod-only partial unique index on plaid_items
-- (duplicate detection now compares institution + account name/mask before the
-- token exchange, per plaid.com/docs/link/duplicate-items/), and relaxes
-- budgets.category_id to nullable (budgets key on category_key).

-- plaid_items: sync scheduling and item health
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "sync_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "sync_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "last_sync_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "last_successful_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "last_sync_error_code" text;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "recurring_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "recurring_fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "historical_update_complete_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "attention" text;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "consent_expires_at" timestamp;--> statement-breakpoint
DROP INDEX IF EXISTS "plaid_items_user_institution_active_idx";--> statement-breakpoint
-- 'pending_expiration' used to be a status that blocked every sync; it is now
-- a non-blocking attention flag.
UPDATE "plaid_items" SET "status" = 'active', "attention" = 'pending_expiration' WHERE "status" = 'pending_expiration';--> statement-breakpoint

-- financial_accounts
ALTER TABLE "financial_accounts" ADD COLUMN IF NOT EXISTS "mask" text;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN IF NOT EXISTS "credit_limit" numeric;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_accounts_plaid_item_id_idx" ON "financial_accounts" USING btree ("plaid_item_id");--> statement-breakpoint

-- transactions: flow classification and pending->posted linkage
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "flow_class" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "flow_class_source" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "counterparty_key" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "pending_transaction_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "authorized_date" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_account_id_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_flow_class_date_idx" ON "transactions" USING btree ("user_id","flow_class","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_counterparty_idx" ON "transactions" USING btree ("user_id","counterparty_key");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_flow_class_source_check') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_flow_class_source_check" CHECK ("transactions"."flow_class_source" IS NULL OR "transactions"."flow_class_source" IN ('auto','manual'));
  END IF;
END $$;--> statement-breakpoint

-- budgets: key on spend bucket instead of the (never populated) categories table
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "category_key" text;--> statement-breakpoint
UPDATE "budgets" b SET "category_key" = c."name" FROM "categories" c WHERE c."id" = b."category_id" AND b."category_key" IS NULL;--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "category_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_user_category_key_idx" ON "budgets" USING btree ("user_id","category_key");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_period_check') THEN
    ALTER TABLE "budgets" ADD CONSTRAINT "budgets_period_check" CHECK ("budgets"."period" IN ('weekly','monthly','yearly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_amount_positive_check') THEN
    ALTER TABLE "budgets" ADD CONSTRAINT "budgets_amount_positive_check" CHECK ("budgets"."amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_end_after_start_check') THEN
    ALTER TABLE "budgets" ADD CONSTRAINT "budgets_end_after_start_check" CHECK ("budgets"."end_date" IS NULL OR "budgets"."end_date" >= "budgets"."start_date");
  END IF;
END $$;--> statement-breakpoint

-- user_preferences
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "time_zone" text;
