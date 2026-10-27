-- Insight candidates, AI opt-in and the weekly digest job. Idempotent like
-- 0007: may be applied by hand (psql / Supabase SQL editor) and re-run safely.
CREATE TABLE IF NOT EXISTS "insight_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"score" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"digest_at" timestamp,
	"title" text,
	"body" text,
	"shown_at" timestamp,
	"dismissed_at" timestamp,
	"helpful" boolean
);
--> statement-breakpoint
ALTER TABLE "insight_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "ai_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "ai_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "ai_consent_version" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "digest_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "digest_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "last_digest_at" timestamp;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insight_candidates_user_id_user_id_fk') THEN
    ALTER TABLE "insight_candidates" ADD CONSTRAINT "insight_candidates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insight_candidates_user_fingerprint_idx" ON "insight_candidates" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insight_candidates_user_digest_idx" ON "insight_candidates" USING btree ("user_id","digest_at");
