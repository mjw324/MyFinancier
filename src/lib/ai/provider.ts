import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModel } from "ai";
import { getModelConfig, type ModelTier } from "./models";

/**
 * Model access for every AI feature. Callers ask for a tier, never a model id,
 * so a provider or model swap is a config change (see models.ts).
 *
 * AI_PROVIDER=bedrock is the zero-data-retention path: Bedrock can be set to
 * retain nothing (data_retention_mode "none", enforced by an AWS SCP) without
 * a sales agreement. AI_PROVIDER=anthropic uses the first-party API on its
 * default terms (no training, deletion within 30 days).
 */
export function getModel(tier: ModelTier): LanguageModel {
  const { provider, modelId } = getModelConfig(tier);
  return provider === "bedrock" ? bedrock()(modelId) : anthropic()(modelId);
}

let _anthropic: ReturnType<typeof createAnthropic> | null = null;
let _bedrock: ReturnType<typeof createAmazonBedrock> | null = null;

function anthropic() {
  _anthropic ??= createAnthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return _anthropic;
}

function bedrock() {
  _bedrock ??= createAmazonBedrock({
    region: requireEnv("AWS_BEDROCK_REGION"),
    accessKeyId: requireEnv("AWS_BEDROCK_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("AWS_BEDROCK_SECRET_ACCESS_KEY"),
  });
  return _bedrock;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Telemetry settings for every generateText/streamText call. Inputs and
 * outputs contain users' financial data, so spans carry only timings, token
 * counts and tool names. Pass as `telemetry: aiTelemetry("digest")`.
 */
export function aiTelemetry(functionId: string) {
  return { functionId, recordInputs: false, recordOutputs: false } as const;
}
