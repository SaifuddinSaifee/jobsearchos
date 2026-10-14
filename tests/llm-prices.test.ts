import { describe, expect, it } from "vitest";
import { costUsd } from "@/lib/llm/prices";

describe("costUsd", () => {
  it("prices uncached input, cached input and output separately", () => {
    // 600 uncached x 0.15 + 400 cached x 0.03 + 500 output x 0.50, per million tokens.
    expect(costUsd("zai-org/GLM-5.3-Flash", { promptTokens: 1000, cachedTokens: 400, completionTokens: 500 })).toBe(0.000352);
  });

  it("treats missing cached tokens as none", () => {
    expect(costUsd("zai-org/GLM-5.3-Flash", { promptTokens: 1000, cachedTokens: null, completionTokens: 0 })).toBe(0.00015);
  });

  it("matches model ids without regard to case", () => {
    const usage = { promptTokens: 1_000_000, cachedTokens: 0, completionTokens: 0 };
    expect(costUsd("ZAI-ORG/glm-5.3-flash", usage)).toBe(0.15);
  });

  it("gives no cost for a model with no known price", () => {
    expect(costUsd("someone/unknown-model", { promptTokens: 10, cachedTokens: 0, completionTokens: 10 })).toBeNull();
  });

  it("gives no cost when the provider reported no usage", () => {
    expect(costUsd("zai-org/GLM-5.3-Flash", { promptTokens: null, cachedTokens: null, completionTokens: null })).toBeNull();
  });

  it("never prices more cached tokens than the prompt had", () => {
    expect(costUsd("zai-org/GLM-5.3-Flash", { promptTokens: 100, cachedTokens: 500, completionTokens: 0 })).toBe(0.000003);
  });
});
