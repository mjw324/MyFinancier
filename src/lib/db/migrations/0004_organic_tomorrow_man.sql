CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"hide_transfers_from_list" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_pair_id" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_is_transfer_idx" ON "transactions" USING btree ("user_id","is_transfer");--> statement-breakpoint
CREATE INDEX "transactions_transfer_pair_id_idx" ON "transactions" USING btree ("transfer_pair_id");--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "gender";