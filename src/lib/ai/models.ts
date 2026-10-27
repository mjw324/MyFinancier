/**
 * Model tiers, ids and list prices. Pure (no SDK imports) so usage accounting
 * and tests can read it.
 *
 * - small: categorization fallback, merchant cleanup, routing
 * - mid:   digest narrative, insight phrasing, chat with tools
 * - large: rare multi-step planning on explicit request
 *
 * Ids and prices default to Anthropic's first-party API (list prices checked
 * 2026-10-26; re-check before relying on cost figures). Bedrock model ids
 * differ, so AI_PROVIDER=bedrock requires the AI_MODEL_* overrides.
 */

export type ModelTier = "small" | "mid" | "large";
export type AiProvider = "anthropic" | "bedrock";
export type Env = Record<string, string | undefined>;

/** USD per million tokens. */
export type ModelPricing = {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
};

const DEFAULTS: Record<ModelTier, { modelId: string; pricing: ModelPricing }> = {
  small: {
    modelId: "claude-haiku-5-5",
    pricing: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  },
  mid: {
    modelId: "claude-sonnet-5-5",
    pricing: { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
  },
  large: {
    modelId: "claude-opus-5-5",
    pricing: { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
  },
};

const ENV_MODEL: Record<ModelTier, string> = {
  small: "AI_MODEL_SMALL",
  mid: "AI_MODEL_MID",
  large: "AI_MODEL_LARGE",
};

export function getProvider(env: Env = process.env): AiProvider {
  const value = env.AI_PROVIDER ?? "anthropic";
  if (value !== "anthropic" && value !== "bedrock") {
    throw new Error(`AI_PROVIDER must be "anthropic" or "bedrock", got "${value}"`);
  }
  return value;
}

export function getModelConfig(
  tier: ModelTier,
  env: Env = process.env,
): { provider: AiProvider; modelId: string; pricing: ModelPricing } {
  const provider = getProvider(env);
  const override = env[ENV_MODEL[tier]];
  if (provider === "bedrock" && !override) {
    throw new Error(`${ENV_MODEL[tier]} must be set when AI_PROVIDER=bedrock`);
  }
  return {
    provider,
    modelId: override ?? DEFAULTS[tier].modelId,
    pricing: DEFAULTS[tier].pricing,
  };
}

/** AI features are off unless AI_ENABLED=true (a kill switch for every call). */
export function isAiEnabled(env: Env = process.env): boolean {
  return env.AI_ENABLED === "true";
}

export type TokenUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
};

/**
 * Cost in micro-dollars (integer, so sums stay exact). inputTokens is the
 * total prompt size including cached and cache-write tokens, as the AI SDK
 * reports it; only the uncached remainder is billed at the full input rate.
 */
export function costMicros(pricing: ModelPricing, usage: TokenUsage): number {
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - cached - written);
  const usd =
    (uncached * pricing.input +
      cached * pricing.cachedInput +
      written * pricing.cacheWrite +
      (usage.outputTokens ?? 0) * pricing.output) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}
