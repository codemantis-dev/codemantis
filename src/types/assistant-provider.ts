import type { ModelPricing } from "./settings";

/** All supported AI provider types. */
export type AIProvider = "claude-code" | "openai" | "gemini" | "anthropic";

/** API-only providers (excludes claude-code which uses the local CLI). */
export type APIProvider = Exclude<AIProvider, "claude-code">;

export interface ProviderOption {
  id: AIProvider;
  label: string;
  requiresApiKey: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  defaultPricing: ModelPricing;
}

export const AI_PROVIDERS: ProviderOption[] = [
  { id: "claude-code", label: "Claude Code (local)", requiresApiKey: false },
  { id: "openai", label: "OpenAI", requiresApiKey: true },
  { id: "gemini", label: "Google Gemini", requiresApiKey: true },
  { id: "anthropic", label: "Anthropic API", requiresApiKey: true },
];

export const AI_MODELS: Record<APIProvider, ModelOption[]> = {
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1", defaultPricing: { input: 2.0, output: 8.0 } },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", defaultPricing: { input: 0.20, output: 1.25 } },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", defaultPricing: { input: 0.75, output: 4.50 } },
    { id: "gpt-5.4", label: "GPT-5.4", defaultPricing: { input: 2.50, output: 15.0 } },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", defaultPricing: { input: 0.10, output: 0.40 } },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", defaultPricing: { input: 1.25, output: 10.0 } },
    { id: "gemini-3-flash-preview", label: "Gemini 3.0 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", defaultPricing: { input: 1.25, output: 10.0 } },
    { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", defaultPricing: { input: 0.25, output: 1.50 } },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", defaultPricing: { input: 5.0, output: 25.0 } },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", defaultPricing: { input: 3.0, output: 15.0 } },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", defaultPricing: { input: 0.80, output: 4.0 } },
  ],
};

/** Build default pricing map from all AI_MODELS. */
export function getDefaultModelPricing(): Record<string, ModelPricing> {
  const pricing: Record<string, ModelPricing> = {};
  for (const models of Object.values(AI_MODELS)) {
    for (const m of models) {
      pricing[m.id] = { ...m.defaultPricing };
    }
  }
  return pricing;
}

/** Look up the provider for a given model ID. Returns null if not found. */
export function getProviderForModel(modelId: string): APIProvider | null {
  for (const [provider, models] of Object.entries(AI_MODELS)) {
    if (models.some((m) => m.id === modelId)) {
      return provider as APIProvider;
    }
  }
  return null;
}

/** Find the display label for a model ID. */
export function getModelLabel(provider: APIProvider, modelId: string): string {
  const model = AI_MODELS[provider]?.find((m) => m.id === modelId);
  return model?.label ?? modelId;
}

// ── SpecWriter model selection ──────────────────────────────────

export interface SpecModelOption {
  id: string;
  provider: APIProvider;
  label: string;
}

/** Models available for SpecWriter, ordered by auto-select priority (lower cost first). */
export const SPEC_WRITING_MODELS: SpecModelOption[] = [
  { id: "gemini-3.1-flash-lite-preview", provider: "gemini",    label: "Gemini 3.1 Flash Lite" },
  { id: "gpt-5.4-mini",                  provider: "openai",    label: "GPT-5.4 Mini" },
  { id: "claude-sonnet-4-6",             provider: "anthropic", label: "Claude Sonnet 4.6" },
  { id: "gemini-3.1-pro-preview",        provider: "gemini",    label: "Gemini 3.1 Pro" },
  { id: "gpt-5.4",                       provider: "openai",    label: "GPT-5.4" },
  { id: "claude-opus-4-6",               provider: "anthropic", label: "Claude Opus 4.6" },
];

export const DEFAULT_SPEC_MODEL = "gemini-3.1-flash-lite-preview";

/**
 * Auto-select the best available spec-writing model given the user's API keys.
 * Walks SPEC_WRITING_MODELS in priority order, returns first model whose
 * provider has an API key. Falls back to DEFAULT_SPEC_MODEL if none have keys.
 */
export function autoSelectSpecModel(apiKeys: Record<string, string>): string {
  for (const m of SPEC_WRITING_MODELS) {
    if (apiKeys[m.provider]?.trim()) {
      return m.id;
    }
  }
  return DEFAULT_SPEC_MODEL;
}

/** Check whether the given model's provider has an API key set. */
export function isSpecModelAvailable(modelId: string, apiKeys: Record<string, string>): boolean {
  const provider = getProviderForModel(modelId);
  if (!provider) return false;
  return !!apiKeys[provider]?.trim();
}

/** Get the display label for a spec-writing model. Falls back to modelId. */
export function getSpecModelLabel(modelId: string): string {
  return SPEC_WRITING_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
}

/** Calculate cost in USD from token counts and pricing. */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  modelPricing: Record<string, ModelPricing>,
): number {
  const pricing = modelPricing[modelId];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
