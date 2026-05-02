CREATE TABLE "spending_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"match_type" text NOT NULL,
	"match_value" text NOT NULL,
	"spending_type" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "spending_rules_match_type_check" CHECK ("spending_rules"."match_type" IN ('merchant','name_signature')),
	CONSTRAINT "spending_rules_spending_type_check" CHECK ("spending_rules"."spending_type" IN ('necessary','discretionary'))
);
--> statement-breakpoint
ALTER TABLE "spending_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "spending_type" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "spending_type" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "spending_type_source" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "normalized_merchant" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "name_signature" text;--> statement-breakpoint
ALTER TABLE "spending_rules" ADD CONSTRAINT "spending_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spending_rules_user_match_idx" ON "spending_rules" USING btree ("user_id","match_type","match_value");--> statement-breakpoint
CREATE INDEX "transactions_normalized_merchant_idx" ON "transactions" USING btree ("normalized_merchant");--> statement-breakpoint
CREATE INDEX "transactions_name_signature_idx" ON "transactions" USING btree ("name_signature");--> statement-breakpoint
CREATE INDEX "transactions_user_spending_type_idx" ON "transactions" USING btree ("user_id","spending_type");--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_spending_type_check" CHECK ("recurring_streams"."spending_type" IS NULL OR "recurring_streams"."spending_type" IN ('necessary','discretionary'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_spending_type_check" CHECK ("transactions"."spending_type" IS NULL OR "transactions"."spending_type" IN ('necessary','discretionary'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_spending_type_source_check" CHECK ("transactions"."spending_type_source" IS NULL OR "transactions"."spending_type_source" IN ('manual','stream','rule','override'));