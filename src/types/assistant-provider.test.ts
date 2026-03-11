import { describe, it, expect } from "vitest";
import {
  AI_PROVIDERS,
  AI_MODELS,
  getDefaultModelPricing,
  getModelLabel,
  calculateCost,
} from "./assistant-provider";

describe("assistant-provider types", () => {
  it("AI_PROVIDERS has 4 providers", () => {
    expect(AI_PROVIDERS).toHaveLength(4);
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("openai");
    expect(ids).toContain("gemini");
    expect(ids).toContain("anthropic");
  });

  it("claude-code does not require API key", () => {
    const cc = AI_PROVIDERS.find((p) => p.id === "claude-code");
    expect(cc?.requiresApiKey).toBe(false);
  });

  it("API providers require API keys", () => {
    for (const p of AI_PROVIDERS) {
      if (p.id !== "claude-code") {
        expect(p.requiresApiKey).toBe(true);
      }
    }
  });

  it("AI_MODELS has models for all API providers", () => {
    expect(AI_MODELS.openai.length).toBeGreaterThan(0);
    expect(AI_MODELS.gemini.length).toBeGreaterThan(0);
    expect(AI_MODELS.anthropic.length).toBeGreaterThan(0);
  });

  it("all models have pricing defined", () => {
    for (const [, models] of Object.entries(AI_MODELS)) {
      for (const model of models) {
        expect(model.defaultPricing).toBeDefined();
        expect(typeof model.defaultPricing.input).toBe("number");
        expect(typeof model.defaultPricing.output).toBe("number");
      }
    }
  });

  it("getDefaultModelPricing returns all model prices", () => {
    const pricing = getDefaultModelPricing();
    expect(Object.keys(pricing).length).toBeGreaterThan(0);

    // Check specific models
    expect(pricing["gpt-4.1"]).toBeDefined();
    expect(pricing["gemini-2.5-flash-lite"]).toBeDefined();
    expect(pricing["claude-sonnet-4-6"]).toBeDefined();
  });

  it("getModelLabel returns label for known model", () => {
    expect(getModelLabel("openai", "gpt-4.1")).toBe("GPT-4.1");
    expect(getModelLabel("gemini", "gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(getModelLabel("anthropic", "claude-haiku-4-5")).toBe("Claude Haiku 4.5");
  });

  it("getModelLabel returns ID for unknown model", () => {
    expect(getModelLabel("openai", "unknown-model")).toBe("unknown-model");
  });

  it("calculateCost computes correctly", () => {
    const pricing = { "test-model": { input: 2.0, output: 8.0 } };
    // 1M input tokens at $2/1M = $2.00
    // 1M output tokens at $8/1M = $8.00
    const cost = calculateCost("test-model", 1_000_000, 1_000_000, pricing);
    expect(cost).toBe(10.0);
  });

  it("calculateCost returns 0 for unknown model", () => {
    const cost = calculateCost("unknown", 1000, 1000, {});
    expect(cost).toBe(0);
  });

  it("calculateCost handles small token counts", () => {
    const pricing = { "gpt-4.1": { input: 2.0, output: 8.0 } };
    // 500 input tokens = 500/1M * 2.0 = 0.001
    // 200 output tokens = 200/1M * 8.0 = 0.0016
    const cost = calculateCost("gpt-4.1", 500, 200, pricing);
    expect(cost).toBeCloseTo(0.0026, 5);
  });

  it("gemini-2.5-flash-lite has zero pricing (free tier)", () => {
    const pricing = getDefaultModelPricing();
    expect(pricing["gemini-2.5-flash-lite"].input).toBe(0);
    expect(pricing["gemini-2.5-flash-lite"].output).toBe(0);
  });
});
