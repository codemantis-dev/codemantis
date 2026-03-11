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
    { id: "gpt-5-nano", label: "GPT-5 Nano", defaultPricing: { input: 0.5, output: 2.0 } },
    { id: "gpt-5-mini", label: "GPT-5 Mini", defaultPricing: { input: 1.0, output: 4.0 } },
    { id: "gpt-5.4", label: "GPT-5.4", defaultPricing: { input: 2.0, output: 8.0 } },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", defaultPricing: { input: 0.0, output: 0.0 } },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", defaultPricing: { input: 1.25, output: 10.0 } },
    { id: "gemini-3-flash-preview", label: "Gemini 3.0 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", defaultPricing: { input: 1.25, output: 10.0 } },
    { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", defaultPricing: { input: 0.0, output: 0.0 } },
  ],
  anthropic: [
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

/** Find the display label for a model ID. */
export function getModelLabel(provider: APIProvider, modelId: string): string {
  const model = AI_MODELS[provider]?.find((m) => m.id === modelId);
  return model?.label ?? modelId;
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
