import { and, eq, gte, sql } from "drizzle-orm";
import type { LanguageModelUsage } from "ai";
import { db, type DbExecutor } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema/ai";
import { costMicros, getModelConfig, type Env, type ModelTier } from "./models";

const DEFAULT_MONTHLY_BUDGET_USD = 2;

/** Per-user monthly AI spend cap in micro-dollars (AI_MONTHLY_BUDGET_USD). */
export function monthlyBudgetMicros(env: Env = process.env): number {
  const parsed = Number(env.AI_MONTHLY_BUDGET_USD);
  const usd = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_BUDGET_USD;
  return Math.round(usd * 1_000_000);
}

/** Start of the current UTC calendar month: budgets reset on the 1st. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function spentThisMonthMicros(
  userId: string,
  now: Date = new Date(),
  executor: DbExecutor = db,
): Promise<number> {
  const [row] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${aiUsage.costMicros}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, monthStartUtc(now))));
  return Number(row?.total ?? 0);
}

/** Check before every model call; a user over budget gets no AI until the 1st. */
export async function hasBudgetRemaining(
  userId: string,
  now: Date = new Date(),
  executor: DbExecutor = db,
): Promise<boolean> {
  return (await spentThisMonthMicros(userId, now, executor)) < monthlyBudgetMicros();
}

/**
 * Record one model call. Call from the AI SDK's onEnd callback with the
 * call's total usage.
 */
export async function recordAiUsage(
  input: {
    userId: string;
    feature: string;
    tier: ModelTier;
    usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens"> & {
      inputTokenDetails?: Partial<LanguageModelUsage["inputTokenDetails"]>;
    };
  },
  executor: DbExecutor = db,
): Promise<void> {
  const { modelId, pricing } = getModelConfig(input.tier);
  const tokens = {
    inputTokens: input.usage.inputTokens ?? 0,
    cachedInputTokens: input.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: input.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    outputTokens: input.usage.outputTokens ?? 0,
  };
  await executor.insert(aiUsage).values({
    userId: input.userId,
    feature: input.feature,
    model: modelId,
    ...tokens,
    costMicros: costMicros(pricing, tokens),
  });
}
