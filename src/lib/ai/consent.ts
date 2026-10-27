import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { isAiEnabled } from "./models";

/**
 * Versioned AI opt-in. Bump AI_CONSENT_VERSION whenever AI_CONSENT_TEXT
 * changes in substance; the version a user agreed to is stored with the
 * time they agreed.
 */
export const AI_CONSENT_VERSION = "2026-10-28";

export const AI_CONSENT_TEXT =
  "MyFinancier sends our AI provider summaries it computed from your transactions (totals, dates, category and merchant names) to write your weekly digest and explain your charts, cleaned transaction descriptions to suggest categories, the searches you type to find transactions, and, when you use the AI assistant, your questions together with the totals, balances, budgets, bills and cleaned transaction details it looks up to answer them. It never sends account numbers, bank credentials, your name or your email, and names of people you pay are replaced. Every figure is calculated by MyFinancier, not by the AI, and no category changes until you accept it. Assistant chats are kept for 90 days, and you can delete them sooner. You can turn this off at any time.";

export interface AiConsent {
  optedIn: boolean;
  consentAt: Date | null;
  consentVersion: string | null;
}

export async function getAiConsent(userId: string): Promise<AiConsent> {
  const [row] = await db
    .select({
      optedIn: userPreferences.aiOptIn,
      consentAt: userPreferences.aiConsentAt,
      consentVersion: userPreferences.aiConsentVersion,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ?? { optedIn: false, consentAt: null, consentVersion: null };
}

/** AI runs for a user only with their opt-in AND the AI_ENABLED kill switch on. */
export async function isAiActiveForUser(userId: string): Promise<boolean> {
  if (!isAiEnabled()) return false;
  return (await getAiConsent(userId)).optedIn;
}

/**
 * Opting in records the consent version and makes the first digest due now
 * (the sweep picks it up); opting out stops the job. ai_consent_at is the
 * time of the latest choice either way.
 */
export async function setAiOptIn(userId: string, optIn: boolean, now: Date = new Date()): Promise<void> {
  const patch = optIn
    ? { aiOptIn: true, aiConsentAt: now, aiConsentVersion: AI_CONSENT_VERSION, digestDueAt: now }
    : { aiOptIn: false, aiConsentAt: now, digestDueAt: null };
  await db
    .insert(userPreferences)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { ...patch, updatedAt: now } });
}
