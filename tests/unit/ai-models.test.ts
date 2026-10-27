import { describe, expect, it } from "vitest";
import { costMicros, getModelConfig, isAiEnabled } from "@/lib/ai/models";

describe("getModelConfig", () => {
  it("defaults to Anthropic ids per tier", () => {
    expect(getModelConfig("small", {}).modelId).toBe("claude-haiku-5-5");
    expect(getModelConfig("mid", {}).modelId).toBe("claude-sonnet-5-5");
    expect(getModelConfig("mid", {}).provider).toBe("anthropic");
  });

  it("honors per-tier overrides", () => {
    expect(getModelConfig("mid", { AI_MODEL_MID: "custom-mid" }).modelId).toBe("custom-mid");
  });

  it("requires explicit model ids on Bedrock", () => {
    expect(() => getModelConfig("mid", { AI_PROVIDER: "bedrock" })).toThrow(/AI_MODEL_MID/);
    expect(
      getModelConfig("mid", { AI_PROVIDER: "bedrock", AI_MODEL_MID: "us.anthropic.x" }).provider,
    ).toBe("bedrock");
  });

  it("rejects unknown providers", () => {
    expect(() => getModelConfig("mid", { AI_PROVIDER: "openai" })).toThrow(/AI_PROVIDER/);
  });
});

describe("isAiEnabled", () => {
  it("is off unless explicitly enabled", () => {
    expect(isAiEnabled({})).toBe(false);
    expect(isAiEnabled({ AI_ENABLED: "1" })).toBe(false);
    expect(isAiEnabled({ AI_ENABLED: "true" })).toBe(true);
  });
});

describe("costMicros", () => {
  const pricing = { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 };

  it("bills uncached, cached, cache-write and output tokens at their own rates", () => {
    // 30K input of which 20K cached reads and 1K cache writes, 2K output:
    // 9K*2 + 20K*0.1 + 1K*2.5 + 2K*10 = 18000+2000+2500+20000 per 1M = $0.0425
    expect(
      costMicros(pricing, {
        inputTokens: 30_000,
        cachedInputTokens: 20_000,
        cacheWriteTokens: 1_000,
        outputTokens: 2_000,
      }),
    ).toBe(42_500);
  });

  it("treats missing counts as zero", () => {
    expect(costMicros(pricing, {})).toBe(0);
  });
});
