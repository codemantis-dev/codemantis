import { describe, it, expect } from "vitest";
import {
  AI_PROVIDERS,
  AI_MODELS,
  getDefaultModelPricing,
  getProviderForModel,
  getModelLabel,
  calculateCost,
  SPEC_WRITING_MODELS,
  DEFAULT_SPEC_MODEL,
  SPEC_CLAUDE_CODE_MODELS,
  DEFAULT_SPEC_CLAUDE_CODE_MODEL,
  autoSelectSpecModel,
  isSpecModelAvailable,
  getSpecModelLabel,
  isLocalCliProvider,
  SPECWRITER_WEAK_MODELS,
  modelSupportsImages,
  modelSupportsFiles,
  modelSupportsAttachments,
  findNearestVisionModel,
  getAvailableSpecModels,
} from "./assistant-provider";
import type { OpenRouterModel } from "./assistant-provider";

describe("assistant-provider types", () => {
  it("AI_PROVIDERS has 6 providers including both local CLIs", () => {
    expect(AI_PROVIDERS).toHaveLength(6);
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("codex");
    expect(ids).toContain("openai");
    expect(ids).toContain("gemini");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openrouter");
  });

  it("local-CLI providers do not require API key", () => {
    const cc = AI_PROVIDERS.find((p) => p.id === "claude-code");
    expect(cc?.requiresApiKey).toBe(false);
    const codex = AI_PROVIDERS.find((p) => p.id === "codex");
    expect(codex?.requiresApiKey).toBe(false);
    expect(codex?.label).toBe("Codex (local)");
  });

  it("isLocalCliProvider distinguishes CLI from API providers", () => {
    expect(isLocalCliProvider("claude-code")).toBe(true);
    expect(isLocalCliProvider("codex")).toBe(true);
    expect(isLocalCliProvider("openai")).toBe(false);
    expect(isLocalCliProvider("gemini")).toBe(false);
    expect(isLocalCliProvider("anthropic")).toBe(false);
    expect(isLocalCliProvider("openrouter")).toBe(false);
  });

  it("API providers require API keys", () => {
    for (const p of AI_PROVIDERS) {
      if (!isLocalCliProvider(p.id)) {
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
    expect(pricing["gpt-5.4-mini"]).toBeDefined();
    expect(pricing["gemini-2.5-flash-lite"]).toBeDefined();
    expect(pricing["claude-sonnet-4-6"]).toBeDefined();
  });

  it("getModelLabel returns label for known model", () => {
    expect(getModelLabel("openai", "gpt-5.4-mini")).toBe("GPT-5.4 Mini");
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
    const pricing = { "gpt-5.4-mini": { input: 2.0, output: 8.0 } };
    // 500 input tokens = 500/1M * 2.0 = 0.001
    // 200 output tokens = 200/1M * 8.0 = 0.0016
    const cost = calculateCost("gpt-5.4-mini", 500, 200, pricing);
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
  it("has exactly 7 models", () => {
    expect(SPEC_WRITING_MODELS).toHaveLength(7);
  });

  it("first model is the default (cheapest)", () => {
    expect(SPEC_WRITING_MODELS[0].id).toBe(DEFAULT_SPEC_MODEL);
    expect(SPEC_WRITING_MODELS[0].id).toBe("gemini-3.5-flash");
  });

  it("includes all required models", () => {
    const ids = SPEC_WRITING_MODELS.map((m) => m.id);
    expect(ids).toContain("gemini-3.5-flash");
    expect(ids).toContain("gemini-3.1-flash-lite");
    expect(ids).toContain("gemini-3.1-pro-preview");
    expect(ids).toContain("gpt-5.4-mini");
    expect(ids).toContain("gpt-5.4");
    expect(ids).toContain("claude-opus-4-7");
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

describe("SPECWRITER_WEAK_MODELS", () => {
  it("contains only models that exist in AI_MODELS", () => {
    const allModelIds = Object.values(AI_MODELS).flat().map((m) => m.id);
    for (const weakId of SPECWRITER_WEAK_MODELS) {
      expect(allModelIds).toContain(weakId);
    }
  });

  it("does not include any recommended models", () => {
    expect(SPECWRITER_WEAK_MODELS).not.toContain("gemini-3.5-flash");
    expect(SPECWRITER_WEAK_MODELS).not.toContain("claude-sonnet-4-6");
    expect(SPECWRITER_WEAK_MODELS).not.toContain("gpt-5.4");
  });
});

describe("autoSelectSpecModel", () => {
  it("returns DEFAULT_SPEC_MODEL when no API keys are set", () => {
    expect(autoSelectSpecModel({})).toBe(DEFAULT_SPEC_MODEL);
  });

  it("returns gemini model when only gemini key is set", () => {
    expect(autoSelectSpecModel({ gemini: "gm-key" })).toBe("gemini-3.5-flash");
  });

  it("returns gpt-5.4-mini when only openai key is set (cheapest openai)", () => {
    expect(autoSelectSpecModel({ openai: "sk-key" })).toBe("gpt-5.4-mini");
  });

  it("returns claude-sonnet when only anthropic key is set (cheaper than opus)", () => {
    expect(autoSelectSpecModel({ anthropic: "ant-key" })).toBe("claude-sonnet-4-6");
  });

  it("returns first match in priority order when all keys set", () => {
    expect(autoSelectSpecModel({ gemini: "g", openai: "o", anthropic: "a" })).toBe("gemini-3.5-flash");
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
    expect(isSpecModelAvailable("gemini-3.1-flash-lite", { gemini: "key" })).toBe(true);
    expect(isSpecModelAvailable("gpt-5.4-mini", { openai: "key" })).toBe(true);
    expect(isSpecModelAvailable("claude-sonnet-4-6", { anthropic: "key" })).toBe(true);
  });

  it("returns false when provider has no API key", () => {
    expect(isSpecModelAvailable("gemini-3.1-flash-lite", {})).toBe(false);
    expect(isSpecModelAvailable("gpt-5.4-mini", { gemini: "key" })).toBe(false);
  });

  it("returns false for unknown model", () => {
    expect(isSpecModelAvailable("unknown-model", { openai: "key", gemini: "key" })).toBe(false);
  });

  it("returns false for empty/whitespace API key", () => {
    expect(isSpecModelAvailable("gemini-3.1-flash-lite", { gemini: "  " })).toBe(false);
  });
});

describe("getSpecModelLabel", () => {
  it("returns label for known spec model", () => {
    expect(getSpecModelLabel("gemini-3.1-flash-lite")).toBe("Gemini 3.1 Flash Lite");
    expect(getSpecModelLabel("claude-opus-4-7")).toBe("Claude Opus 4.7");
  });

  it("returns label for Claude Code spec models", () => {
    expect(getSpecModelLabel("claude-haiku-4-5")).toBe("Haiku 4.5");
  });

  it("returns model ID for unknown model", () => {
    expect(getSpecModelLabel("unknown-model")).toBe("unknown-model");
  });
});

// ── SpecWriter Claude Code model selection ─────────────────────

describe("SPEC_CLAUDE_CODE_MODELS", () => {
  it("has exactly 3 models", () => {
    expect(SPEC_CLAUDE_CODE_MODELS).toHaveLength(3);
  });

  it("contains haiku, sonnet, and opus", () => {
    const ids = SPEC_CLAUDE_CODE_MODELS.map((m) => m.id);
    expect(ids).toContain("claude-haiku-4-5");
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-opus-4-7");
  });

  it("each model has id, label, and description fields", () => {
    for (const model of SPEC_CLAUDE_CODE_MODELS) {
      expect(typeof model.id).toBe("string");
      expect(model.id.length).toBeGreaterThan(0);
      expect(typeof model.label).toBe("string");
      expect(model.label.length).toBeGreaterThan(0);
      expect(typeof model.description).toBe("string");
      expect(model.description.length).toBeGreaterThan(0);
    }
  });

  it("all IDs are valid Claude model IDs", () => {
    for (const model of SPEC_CLAUDE_CODE_MODELS) {
      expect(model.id).toMatch(/^claude-/);
    }
  });
});

describe("DEFAULT_SPEC_CLAUDE_CODE_MODEL", () => {
  it("is claude-sonnet-4-6", () => {
    expect(DEFAULT_SPEC_CLAUDE_CODE_MODEL).toBe("claude-sonnet-4-6");
  });

  it("exists in SPEC_CLAUDE_CODE_MODELS", () => {
    const ids = SPEC_CLAUDE_CODE_MODELS.map((m) => m.id);
    expect(ids).toContain(DEFAULT_SPEC_CLAUDE_CODE_MODEL);
  });
});

describe("getSpecModelLabel with Claude Code models", () => {
  it("returns label for Claude Code spec model not in API list", () => {
    // claude-haiku-4-5 is only in SPEC_CLAUDE_CODE_MODELS, not SPEC_WRITING_MODELS
    expect(getSpecModelLabel("claude-haiku-4-5")).toBe("Haiku 4.5");
  });

  it("prefers API spec label for models in both lists", () => {
    // claude-sonnet-4-6 and claude-opus-4-7 are in SPEC_WRITING_MODELS (checked first)
    expect(getSpecModelLabel("claude-sonnet-4-6")).toBe("Claude Sonnet 4.6");
    expect(getSpecModelLabel("claude-opus-4-7")).toBe("Claude Opus 4.7");
  });

  it("returns label for API spec models (existing behavior)", () => {
    expect(getSpecModelLabel("gemini-3.1-flash-lite")).toBe("Gemini 3.1 Flash Lite");
    expect(getSpecModelLabel("gpt-5.4-mini")).toBe("GPT-5.4 Mini");
  });

  it("returns model ID for unknown model", () => {
    expect(getSpecModelLabel("totally-unknown-model")).toBe("totally-unknown-model");
  });
});

// ── OpenRouter capability helpers ──────────────────────────────

function makeModel(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: "test/model",
    name: "Test Model",
    isFree: false,
    inputModalities: ["text"],
    outputModalities: ["text"],
    contextLength: 4096,
    pricing: { input: 1.0, output: 2.0 },
    ...overrides,
  };
}

describe("modelSupportsImages", () => {
  it("returns true when inputModalities includes image", () => {
    const model = makeModel({ inputModalities: ["text", "image"] });
    expect(modelSupportsImages(model)).toBe(true);
  });

  it("returns false when inputModalities is text only", () => {
    const model = makeModel({ inputModalities: ["text"] });
    expect(modelSupportsImages(model)).toBe(false);
  });

  it("returns true when model has all modalities", () => {
    const model = makeModel({ inputModalities: ["text", "image", "file"] });
    expect(modelSupportsImages(model)).toBe(true);
  });
});

describe("modelSupportsFiles", () => {
  it("returns true when inputModalities includes file", () => {
    const model = makeModel({ inputModalities: ["text", "file"] });
    expect(modelSupportsFiles(model)).toBe(true);
  });

  it("returns false when inputModalities lacks file", () => {
    const model = makeModel({ inputModalities: ["text", "image"] });
    expect(modelSupportsFiles(model)).toBe(false);
  });
});

describe("modelSupportsAttachments", () => {
  it("returns true when model supports images", () => {
    const model = makeModel({ inputModalities: ["text", "image"] });
    expect(modelSupportsAttachments(model)).toBe(true);
  });

  it("returns true when model supports files", () => {
    const model = makeModel({ inputModalities: ["text", "file"] });
    expect(modelSupportsAttachments(model)).toBe(true);
  });

  it("returns true when model supports both", () => {
    const model = makeModel({ inputModalities: ["text", "image", "file"] });
    expect(modelSupportsAttachments(model)).toBe(true);
  });

  it("returns false when model is text-only", () => {
    const model = makeModel({ inputModalities: ["text"] });
    expect(modelSupportsAttachments(model)).toBe(false);
  });
});

describe("findNearestVisionModel", () => {
  it("returns free vision model first", () => {
    const models = [
      makeModel({ id: "paid-vision", isFree: false, inputModalities: ["text", "image"], contextLength: 128000 }),
      makeModel({ id: "free-vision", isFree: true, inputModalities: ["text", "image"], contextLength: 32000 }),
      makeModel({ id: "free-text", isFree: true, inputModalities: ["text"], contextLength: 64000 }),
    ];
    expect(findNearestVisionModel(models)).toBe("free-vision");
  });

  it("returns highest context free vision model when multiple available", () => {
    const models = [
      makeModel({ id: "free-small", isFree: true, inputModalities: ["text", "image"], contextLength: 8000 }),
      makeModel({ id: "free-large", isFree: true, inputModalities: ["text", "image"], contextLength: 128000 }),
    ];
    expect(findNearestVisionModel(models)).toBe("free-large");
  });

  it("falls back to paid vision model when no free vision available", () => {
    const models = [
      makeModel({ id: "free-text", isFree: true, inputModalities: ["text"] }),
      makeModel({ id: "paid-vision", isFree: false, inputModalities: ["text", "image"] }),
    ];
    expect(findNearestVisionModel(models)).toBe("paid-vision");
  });

  it("returns null when no vision models available", () => {
    const models = [
      makeModel({ id: "text-only-1", inputModalities: ["text"] }),
      makeModel({ id: "text-only-2", inputModalities: ["text"] }),
    ];
    expect(findNearestVisionModel(models)).toBeNull();
  });

  it("returns null for empty model list", () => {
    expect(findNearestVisionModel([])).toBeNull();
  });
});

describe("getAvailableSpecModels", () => {
  it("returns base spec models when no OpenRouter key", () => {
    const result = getAvailableSpecModels({}, []);
    expect(result).toHaveLength(SPEC_WRITING_MODELS.length);
  });

  it("returns base spec models when OpenRouter key but no models loaded", () => {
    const result = getAvailableSpecModels({ openrouter: "key" }, []);
    expect(result).toHaveLength(SPEC_WRITING_MODELS.length);
  });

  it("appends free OpenRouter models when key and models available", () => {
    const orModels: OpenRouterModel[] = [
      makeModel({ id: "free/model-1", name: "Free One", isFree: true, contextLength: 32000 }),
      makeModel({ id: "free/model-2", name: "Free Two", isFree: true, contextLength: 64000 }),
      makeModel({ id: "paid/model-1", name: "Paid One", isFree: false }),
    ];
    const result = getAvailableSpecModels({ openrouter: "key" }, orModels);
    expect(result.length).toBe(SPEC_WRITING_MODELS.length + 2); // only free models added
    const orEntries = result.filter((m) => m.provider === "openrouter");
    expect(orEntries).toHaveLength(2);
    expect(orEntries[0].label).toContain("(free)");
  });

  it("limits to 5 free OpenRouter models", () => {
    const orModels: OpenRouterModel[] = Array.from({ length: 10 }, (_, i) =>
      makeModel({ id: `free/model-${i}`, name: `Free ${i}`, isFree: true, contextLength: 1000 * i })
    );
    const result = getAvailableSpecModels({ openrouter: "key" }, orModels);
    const orEntries = result.filter((m) => m.provider === "openrouter");
    expect(orEntries).toHaveLength(5);
  });

  it("sorts free models by context length descending", () => {
    const orModels: OpenRouterModel[] = [
      makeModel({ id: "free/small", name: "Small", isFree: true, contextLength: 4000 }),
      makeModel({ id: "free/large", name: "Large", isFree: true, contextLength: 128000 }),
      makeModel({ id: "free/medium", name: "Medium", isFree: true, contextLength: 32000 }),
    ];
    const result = getAvailableSpecModels({ openrouter: "key" }, orModels);
    const orEntries = result.filter((m) => m.provider === "openrouter");
    expect(orEntries[0].id).toBe("free/large");
    expect(orEntries[1].id).toBe("free/medium");
    expect(orEntries[2].id).toBe("free/small");
  });
});

describe("getProviderForModel with OpenRouter lookup", () => {
  it("returns openrouter when lookup function matches", () => {
    const lookup = (id: string) => id === "google/gemini:free";
    expect(getProviderForModel("google/gemini:free", lookup)).toBe("openrouter");
  });

  it("prefers hardcoded provider over OpenRouter lookup", () => {
    const lookup = () => true;
    expect(getProviderForModel("gpt-5.4-mini", lookup)).toBe("openai");
  });

  it("returns null when no match and no lookup", () => {
    expect(getProviderForModel("unknown-model")).toBeNull();
  });

  it("returns null when lookup returns false", () => {
    const lookup = () => false;
    expect(getProviderForModel("unknown-model", lookup)).toBeNull();
  });
});

describe("OpenRouter in AI_PROVIDERS and AI_MODELS", () => {
  it("openrouter is in AI_PROVIDERS", () => {
    const or = AI_PROVIDERS.find((p) => p.id === "openrouter");
    expect(or).toBeDefined();
    expect(or!.label).toBe("OpenRouter");
    expect(or!.requiresApiKey).toBe(true);
  });

  it("openrouter has empty model list in AI_MODELS (dynamic)", () => {
    expect(AI_MODELS.openrouter).toEqual([]);
  });
});

describe("AI_MODELS regression guard (Self-Drive picker)", () => {
  // Every static model entry must have a non-empty label and positive pricing.
  // A zero or NaN here would silently break the cost-estimator + cheap→expensive
  // sort that the Self-Drive picker relies on.
  for (const provider of ["openai", "gemini", "anthropic"] as const) {
    it(`${provider}: every entry has non-empty label and positive pricing`, () => {
      const models = AI_MODELS[provider];
      expect(models.length).toBeGreaterThan(0);
      for (const m of models) {
        expect(m.id.length).toBeGreaterThan(0);
        expect(m.label.length).toBeGreaterThan(0);
        expect(m.defaultPricing.input).toBeGreaterThan(0);
        expect(m.defaultPricing.output).toBeGreaterThan(0);
      }
    });
  }

  it("getProviderForModel round-trips every static model ID", () => {
    for (const [provider, models] of Object.entries(AI_MODELS)) {
      for (const m of models) {
        expect(getProviderForModel(m.id)).toBe(provider);
      }
    }
  });
});
