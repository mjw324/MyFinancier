import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { makeUser } from "../setup/factories";
import { user } from "@/lib/db/schema/auth";
import { aiRateLimits, aiUsage } from "@/lib/db/schema/ai";
import {
  hasBudgetRemaining,
  recordAiUsage,
  spentThisMonthMicros,
} from "@/lib/ai/usage";
import { consumeRateLimit } from "@/lib/ai/rate-limit";

const U = "u_ai";

beforeEach(async () => {
  await getTestDb().insert(user).values([makeUser({ id: U }), makeUser({ id: "u_other" })]);
});

afterEach(() => {
  delete process.env.AI_MONTHLY_BUDGET_USD;
});

describe("AI usage accounting", () => {
  it("records token counts and cost for a call", async () => {
    await recordAiUsage({
      userId: U,
      feature: "digest",
      tier: "mid",
      usage: {
        inputTokens: 30_000,
        outputTokens: 2_000,
        inputTokenDetails: { cacheReadTokens: 20_000, cacheWriteTokens: 1_000 },
      },
    });
    const [row] = await getTestDb().select().from(aiUsage).where(eq(aiUsage.userId, U));
    expect(row).toMatchObject({
      feature: "digest",
      model: "claude-sonnet-5-5",
      inputTokens: 30_000,
      cachedInputTokens: 20_000,
      cacheWriteTokens: 1_000,
      outputTokens: 2_000,
      costMicros: 42_500,
    });
  });

  it("sums only this user's spend in the current month", async () => {
    const db = getTestDb();
    const now = new Date("2026-10-15T12:00:00Z");
    await db.insert(aiUsage).values([
      { userId: U, feature: "chat", model: "m", costMicros: 300_000, createdAt: new Date("2026-10-02T00:00:00Z") },
      { userId: U, feature: "chat", model: "m", costMicros: 900_000, createdAt: new Date("2026-09-30T23:59:59Z") },
      { userId: "u_other", feature: "chat", model: "m", costMicros: 5_000_000, createdAt: new Date("2026-10-03T00:00:00Z") },
    ]);
    expect(await spentThisMonthMicros(U, now)).toBe(300_000);
  });

  it("blocks once the monthly budget is used up", async () => {
    process.env.AI_MONTHLY_BUDGET_USD = "0.5";
    const now = new Date("2026-10-15T12:00:00Z");
    await getTestDb().insert(aiUsage).values({
      userId: U, feature: "chat", model: "m", costMicros: 499_999, createdAt: new Date("2026-10-10T00:00:00Z"),
    });
    expect(await hasBudgetRemaining(U, now)).toBe(true);
    await getTestDb().insert(aiUsage).values({
      userId: U, feature: "chat", model: "m", costMicros: 1, createdAt: new Date("2026-10-11T00:00:00Z"),
    });
    expect(await hasBudgetRemaining(U, now)).toBe(false);
  });
});

describe("consumeRateLimit", () => {
  const rule = { limit: 2, windowMs: 10 * 60_000 };

  it("allows up to the limit within a window, then blocks", async () => {
    const now = new Date("2026-10-15T12:01:00Z");
    expect((await consumeRateLimit(U, "chat", rule, now)).allowed).toBe(true);
    expect((await consumeRateLimit(U, "chat", rule, now)).allowed).toBe(true);
    const third = await consumeRateLimit(U, "chat", rule, now);
    expect(third.allowed).toBe(false);
    expect(third.resetAt.toISOString()).toBe("2026-10-15T12:10:00.000Z");
  });

  it("starts fresh in the next window and keeps users and buckets apart", async () => {
    const now = new Date("2026-10-15T12:01:00Z");
    await consumeRateLimit(U, "chat", rule, now);
    await consumeRateLimit(U, "chat", rule, now);
    expect((await consumeRateLimit("u_other", "chat", rule, now)).allowed).toBe(true);
    expect((await consumeRateLimit(U, "explain", rule, now)).allowed).toBe(true);
    const next = new Date("2026-10-15T12:10:00Z");
    expect((await consumeRateLimit(U, "chat", rule, next)).remaining).toBe(1);
  });

  it("prunes the user's windows older than a day", async () => {
    await consumeRateLimit(U, "chat", rule, new Date("2026-10-13T12:00:00Z"));
    await consumeRateLimit(U, "chat", rule, new Date("2026-10-15T12:00:00Z"));
    const rows = await getTestDb().select().from(aiRateLimits).where(eq(aiRateLimits.userId, U));
    expect(rows).toHaveLength(1);
  });
});
