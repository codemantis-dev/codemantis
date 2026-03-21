import { describe, it, expect } from "vitest";
import {
  AI_PROVIDERS,
  AI_MODELS,
  getDefaultModelPricing,
  getModelLabel,
  calculateCost,
  SPEC_WRITING_MODELS,
  DEFAULT_SPEC_MODEL,
  autoSelectSpecModel,
  isSpecModelAvailable,
  getSpecModelLabel,
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

  it("gemini-2.5-flash-lite has non-zero pricing", () => {
    const pricing = getDefaultModelPricing();
    expect(pricing["gemini-2.5-flash-lite"].input).toBeGreaterThan(0);
    expect(pricing["gemini-2.5-flash-lite"].output).toBeGreaterThan(0);
  });
});

// ── SpecWriter model selection ──────────────────────────────────

describe("SPEC_WRITING_MODELS", () => {
  it("has exactly 6 models", () => {
    expect(SPEC_WRITING_MODELS).toHaveLength(6);
  });

  it("first model is the default (cheapest)", () => {
    expect(SPEC_WRITING_MODELS[0].id).toBe(DEFAULT_SPEC_MODEL);
    expect(SPEC_WRITING_MODELS[0].id).toBe("gemini-3.1-flash-lite-preview");
  });

  it("includes all required models", () => {
    const ids = SPEC_WRITING_MODELS.map((m) => m.id);
    expect(ids).toContain("gemini-3.1-flash-lite-preview");
    expect(ids).toContain("gemini-3.1-pro-preview");
    expect(ids).toContain("gpt-5.4-mini");
    expect(ids).toContain("gpt-5.4");
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("claude-sonnet-4-6");
  });

  it("all models have valid providers", () => {
    for (const m of SPEC_WRITING_MODELS) {
      expect(["openai", "gemini", "anthropic"]).toContain(m.provider);
    }
  });

  it("all model IDs exist in AI_MODELS", () => {
    for (const m of SPEC_WRITING_MODELS) {
      const providerModels = AI_MODELS[m.provider];
      expect(providerModels.some((pm) => pm.id === m.id)).toBe(true);
    }
  });
});

describe("autoSelectSpecModel", () => {
  it("returns DEFAULT_SPEC_MODEL when no API keys are set", () => {
    expect(autoSelectSpecModel({})).toBe(DEFAULT_SPEC_MODEL);
  });

  it("returns gemini model when only gemini key is set", () => {
    expect(autoSelectSpecModel({ gemini: "gm-key" })).toBe("gemini-3.1-flash-lite-preview");
  });

  it("returns gpt-5.4-mini when only openai key is set (cheapest openai)", () => {
    expect(autoSelectSpecModel({ openai: "sk-key" })).toBe("gpt-5.4-mini");
  });

  it("returns claude-sonnet when only anthropic key is set (cheaper than opus)", () => {
    expect(autoSelectSpecModel({ anthropic: "ant-key" })).toBe("claude-sonnet-4-6");
  });

  it("returns first match in priority order when all keys set", () => {
    expect(autoSelectSpecModel({ gemini: "g", openai: "o", anthropic: "a" })).toBe("gemini-3.1-flash-lite-preview");
  });

  it("skips gemini when only openai and anthropic keys set", () => {
    expect(autoSelectSpecModel({ openai: "o", anthropic: "a" })).toBe("gpt-5.4-mini");
  });

  it("ignores empty/whitespace API keys", () => {
    expect(autoSelectSpecModel({ gemini: "", openai: "  ", anthropic: "ant-key" })).toBe("claude-sonnet-4-6");
  });
});

describe("isSpecModelAvailable", () => {
  it("returns true when provider has API key", () => {
    expect(isSpecModelAvailable("gemini-3.1-flash-lite-preview", { gemini: "key" })).toBe(true);
    expect(isSpecModelAvailable("gpt-5.4-mini", { openai: "key" })).toBe(true);
    expect(isSpecModelAvailable("claude-sonnet-4-6", { anthropic: "key" })).toBe(true);
  });

  it("returns false when provider has no API key", () => {
    expect(isSpecModelAvailable("gemini-3.1-flash-lite-preview", {})).toBe(false);
    expect(isSpecModelAvailable("gpt-5.4-mini", { gemini: "key" })).toBe(false);
  });

  it("returns false for unknown model", () => {
    expect(isSpecModelAvailable("unknown-model", { openai: "key", gemini: "key" })).toBe(false);
  });

  it("returns false for empty/whitespace API key", () => {
    expect(isSpecModelAvailable("gemini-3.1-flash-lite-preview", { gemini: "  " })).toBe(false);
  });
});

describe("getSpecModelLabel", () => {
  it("returns label for known spec model", () => {
    expect(getSpecModelLabel("gemini-3.1-flash-lite-preview")).toBe("Gemini 3.1 Flash Lite");
    expect(getSpecModelLabel("claude-opus-4-6")).toBe("Claude Opus 4.6");
  });

  it("returns model ID for unknown model", () => {
    expect(getSpecModelLabel("unknown-model")).toBe("unknown-model");
  });
});
