ALTER TABLE "transactions" ADD COLUMN "is_refund" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "refund_source" text;--> statement-breakpoint
CREATE INDEX "transactions_user_is_refund_idx" ON "transactions" USING btree ("user_id","is_refund");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refund_source_check" CHECK ("transactions"."refund_source" IS NULL OR "transactions"."refund_source" IN ('auto','manual'));