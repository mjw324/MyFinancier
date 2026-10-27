-- Store Plaid's personal_finance_category.confidence_level on transactions.
-- Idempotent like 0007: production is managed with `drizzle-kit push`, so this
-- may be applied by hand and re-run safely.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "pfc_confidence_level" text;
