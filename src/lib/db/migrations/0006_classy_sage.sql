-- Better Auth 1.7: account identity (issuer) + two-factor lockout columns.
-- Written by hand: drizzle-kit generates `ADD COLUMN "issuer" text NOT NULL`,
-- which fails on a populated table. Add nullable, backfill, then constrain.

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text;--> statement-breakpoint

-- createLocalAccountIssuer("credential") === 'local:credential'
UPDATE "account" SET "issuer" = 'local:credential'
  WHERE "providerId" = 'credential' AND "issuer" IS NULL;--> statement-breakpoint

-- createOAuthAccountIssuer(providerId) === 'local:oauth:' || urlencode(providerId)
UPDATE "account" SET "issuer" = 'local:oauth:' || "providerId"
  WHERE "providerId" <> 'credential' AND "issuer" IS NULL;--> statement-breakpoint

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_idx"
  ON "account" USING btree ("issuer","accountId");--> statement-breakpoint

ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "failedVerificationCount" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "lockedUntil" timestamp;
