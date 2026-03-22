import type { ModelPricing } from "../../../types/settings";
import { AI_PROVIDERS, AI_MODELS } from "../../../types/assistant-provider";
import type { APIProvider } from "../../../types/assistant-provider";
import { SectionTitle } from "./SettingsShared";

export default function AIProvidersTab({
  apiKeys, modelPricing, testingKey, testResults,
  onApiKeyChange, onModelPricingChange, onTestKey,
}: {
  apiKeys: Record<string, string>;
  modelPricing: Record<string, ModelPricing>;
  testingKey: string | false;
  testResults: Record<string, "success" | "error">;
  onApiKeyChange: (provider: string, value: string) => void;
  onModelPricingChange: (modelId: string, pricing: ModelPricing) => void;
  onTestKey: (provider: string) => void;
}) {
  const apiProviders = AI_PROVIDERS.filter((p) => p.requiresApiKey);

  return (
    <div>
      <SectionTitle>AI Providers</SectionTitle>
      <p className="text-label text-text-dim mb-4">
        Configure API keys and token pricing for each provider. These are shared across Changelog and Assistant features.
      </p>

      {/* API Keys */}
      <div className="space-y-4 mb-6">
        {apiProviders.map((provider) => {
          const key = apiKeys[provider.id] ?? "";
          const isTesting = testingKey === provider.id;
          const result = testResults[provider.id];
          return (
            <div key={provider.id}>
              <label className="text-ui text-text-secondary mb-1.5 block">{provider.label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={key}
                  onChange={(e) => onApiKeyChange(provider.id, e.target.value)}
                  placeholder={`Enter ${provider.label} API key`}
                  className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                />
                <button
                  onClick={() => onTestKey(provider.id)}
                  disabled={isTesting || !key.trim()}
                  className={`px-3 py-1.5 rounded text-ui font-medium transition-colors shrink-0 ${
                    isTesting || !key.trim()
                      ? "bg-bg-elevated text-text-ghost cursor-not-allowed"
                      : "bg-accent/10 text-accent hover:bg-accent/20"
                  }`}
                >
                  {isTesting ? "Testing..." : "Test"}
                </button>
              </div>
              {result === "success" && (
                <p className="text-green text-label mt-1">API key is valid</p>
              )}
              {result === "error" && (
                <p className="text-red text-label mt-1">Could not validate API key — check that the key is correct and your internet connection is working</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Model Pricing */}
      <div className="border-t border-border-light pt-4">
        <label className="text-ui text-text-secondary mb-3 block">Model Pricing (per 1M tokens, USD)</label>
        <div className="space-y-2">
          {(Object.entries(AI_MODELS) as [APIProvider, typeof AI_MODELS[APIProvider]][]).map(([provider, models]) => (
            <div key={provider}>
              <h4 className="text-label text-text-dim uppercase tracking-wider mb-1.5 mt-2">
                {AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider}
              </h4>
              {models.map((m) => {
                const pricing = modelPricing[m.id] ?? m.defaultPricing;
                return (
                  <div key={m.id} className="flex items-center gap-3 py-1">
                    <span className="text-ui text-text-secondary w-40 shrink-0 truncate" title={m.label}>{m.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-label text-text-dim">In:</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={pricing.input}
                        onChange={(e) => onModelPricingChange(m.id, {
                          input: parseFloat(e.target.value) || 0,
                          output: pricing.output,
                        })}
                        className="w-18 px-2 py-0.5 rounded bg-bg-elevated border border-border text-text-primary text-label outline-none focus:border-accent/40 text-right"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-label text-text-dim">Out:</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={pricing.output}
                        onChange={(e) => onModelPricingChange(m.id, {
                          input: pricing.input,
                          output: parseFloat(e.target.value) || 0,
                        })}
                        className="w-18 px-2 py-0.5 rounded bg-bg-elevated border border-border text-text-primary text-label outline-none focus:border-accent/40 text-right"
                      />
                    </div>
                    <span className="text-label text-text-ghost">$</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
