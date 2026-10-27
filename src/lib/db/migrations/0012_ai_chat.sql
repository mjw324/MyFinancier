-- Chat assistant transcripts (ai_chat, ai_message: UIMessage parts as jsonb).
-- Idempotent like 0011: may be applied by hand and re-run safely.
CREATE TABLE IF NOT EXISTS "ai_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_chat" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_message" (
	"chat_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_message_chat_id_id_pk" PRIMARY KEY("chat_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_chat_user_id_user_id_fk') THEN
    ALTER TABLE "ai_chat" ADD CONSTRAINT "ai_chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_chat_id_ai_chat_id_fk') THEN
    ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_chat_id_ai_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."ai_chat"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_user_id_user_id_fk') THEN
    ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_chat_user_updated_idx" ON "ai_chat" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_message_chat_position_idx" ON "ai_message" USING btree ("chat_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_message_created_idx" ON "ai_message" USING btree ("created_at");
