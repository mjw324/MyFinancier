import { and, eq, lt, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { aiRateLimits } from "@/lib/db/schema/ai";

export type RateLimitRule = { limit: number; windowMs: number };

/** Chat: 20 messages per 10 minutes per user. */
export const CHAT_RATE_LIMIT: RateLimitRule = { limit: 20, windowMs: 10 * 60_000 };

const RETAIN_MS = 24 * 60 * 60_000;

export function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Count one request against a fixed window and say whether it is allowed.
 * The counter is a single atomic upsert, so concurrent requests can't both
 * squeeze under the limit. Postgres-backed so no Redis is needed.
 */
export async function consumeRateLimit(
  userId: string,
  bucket: string,
  rule: RateLimitRule,
  now: Date = new Date(),
  executor: DbExecutor = db,
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const windowStart = windowStartFor(now, rule.windowMs);
  const [row] = await executor
    .insert(aiRateLimits)
    .values({ userId, bucket, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [aiRateLimits.userId, aiRateLimits.bucket, aiRateLimits.windowStart],
      set: { count: sql`${aiRateLimits.count} + 1` },
    })
    .returning({ count: aiRateLimits.count });

  // Old windows are dead weight; prune this user's on the way through.
  await executor
    .delete(aiRateLimits)
    .where(
      and(
        eq(aiRateLimits.userId, userId),
        lt(aiRateLimits.windowStart, new Date(now.getTime() - RETAIN_MS)),
      ),
    );

  const count = row?.count ?? rule.limit + 1;
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt: new Date(windowStart.getTime() + rule.windowMs),
  };
}
