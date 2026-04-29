CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"verified" boolean DEFAULT false,
	"userId" text NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "twoFactor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_streams" (
	"stream_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plaid_item_id" text NOT NULL,
	"account_id" text NOT NULL,
	"flow_type" text NOT NULL,
	"description" text NOT NULL,
	"merchant_name" text,
	"frequency" text NOT NULL,
	"status" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_date" timestamp,
	"last_date" timestamp,
	"predicted_next_date" timestamp,
	"average_amount" numeric NOT NULL,
	"last_amount" numeric NOT NULL,
	"iso_currency_code" text DEFAULT 'USD',
	"pfc_primary" text,
	"pfc_detailed" text,
	"pfc_confidence_level" text,
	"plaid_updated_datetime" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "recurring_streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_stream_id" text;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_streams_user_id_idx" ON "recurring_streams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_streams_plaid_item_id_idx" ON "recurring_streams" USING btree ("plaid_item_id");--> statement-breakpoint
CREATE INDEX "recurring_streams_account_predicted_idx" ON "recurring_streams" USING btree ("account_id","predicted_next_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_stream_id_recurring_streams_stream_id_fk" FOREIGN KEY ("recurring_stream_id") REFERENCES "public"."recurring_streams"("stream_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_recurring_stream_id_idx" ON "transactions" USING btree ("recurring_stream_id");