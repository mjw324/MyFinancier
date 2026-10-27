-- Category override rules, AI category suggestions and who set a custom
-- category. Idempotent like 0007: may be applied by hand (psql / Supabase SQL
-- editor) and re-run safely.
CREATE TABLE IF NOT EXISTS "category_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"match_type" text NOT NULL,
	"match_value" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "category_rules_match_type_check" CHECK ("category_rules"."match_type" IN ('merchant','name_signature'))
);
--> statement-breakpoint
ALTER TABLE "category_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "category_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"suggested" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_category" text,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	CONSTRAINT "category_suggestions_status_check" CHECK ("category_suggestions"."status" IN ('pending','accepted','rejected'))
);
--> statement-breakpoint
ALTER TABLE "category_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "custom_category_source" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_rules_user_id_user_id_fk') THEN
    ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_suggestions_user_id_user_id_fk') THEN
    ALTER TABLE "category_suggestions" ADD CONSTRAINT "category_suggestions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_suggestions_transaction_id_transactions_id_fk') THEN
    ALTER TABLE "category_suggestions" ADD CONSTRAINT "category_suggestions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_custom_category_source_check') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_custom_category_source_check" CHECK ("transactions"."custom_category_source" IS NULL OR "transactions"."custom_category_source" IN ('manual','rule','suggestion'));
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "category_rules_user_match_idx" ON "category_rules" USING btree ("user_id","match_type","match_value");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "category_suggestions_transaction_idx" ON "category_suggestions" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "category_suggestions_user_status_idx" ON "category_suggestions" USING btree ("user_id","status");
