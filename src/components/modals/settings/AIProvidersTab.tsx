import { Sparkles, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ModelPricing } from "../../../types/settings";
import { AI_PROVIDERS, AI_MODELS } from "../../../types/assistant-provider";
import type { APIProvider } from "../../../types/assistant-provider";
import { useOpenRouterStore } from "../../../stores/openRouterStore";
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
  const hasAnyApiKey = Object.values(apiKeys).some((k) => k?.trim());
  const openRouterModels = useOpenRouterStore((s) => s.models);
  const openRouterLoading = useOpenRouterStore((s) => s.loading);
  const hasOpenRouterKey = !!(apiKeys["openrouter"] ?? "").trim();

  // Split providers: show OpenRouter separately with special treatment
  const nonOrProviders = AI_PROVIDERS.filter((p) => p.requiresApiKey && p.id !== "openrouter");
  const orProvider = AI_PROVIDERS.find((p) => p.id === "openrouter");

  return (
    <div>
      <SectionTitle>AI Providers</SectionTitle>
      <p className="text-label text-text-dim mb-1">
        Configure API keys and token pricing for each provider. These are shared across Changelog and Assistant features.
      </p>
      <p className="text-detail text-text-ghost mb-4">
        API keys are encrypted at rest. They remain readable to anyone with access to your user account on this Mac.
      </p>

      {/* OpenRouter Free Banner — show when user has no API keys or no OpenRouter key */}
      {(!hasAnyApiKey || !hasOpenRouterKey) && (
        <div
          className="rounded-lg border p-4 mb-6"
          style={{
            borderColor: "var(--accent)",
            background: "color-mix(in srgb, var(--accent) 5%, var(--bg-elevated))",
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
              style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}
            >
              <Sparkles size={16} style={{ color: "var(--accent)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-ui font-semibold mb-1" style={{ color: "var(--accent)" }}>
                No AI API Key? Use OpenRouter — Free AI for CodeMantis!
              </h4>
              <p className="text-label text-text-dim mb-3 leading-relaxed">
                OpenRouter gives you access to 200+ AI models from all major providers. Many models
                are completely free — no credit card needed. Create an account to unlock{" "}
                <strong className="text-text-secondary">Assistant</strong>,{" "}
                <strong className="text-text-secondary">Changelog</strong>, and{" "}
                <strong className="text-text-secondary">SpecWriter</strong> at no cost.
              </p>
              <button
                onClick={() => openUrl("https://openrouter.ai/keys")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui font-medium transition-colors"
                style={{
                  background: "var(--accent)",
                  color: "white",
                }}
              >
                Get Free API Key
                <ExternalLink size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Keys */}
      <div className="space-y-4 mb-6">
        {/* OpenRouter — first, with special sub-label */}
        {orProvider && (
          <div>
            <label className="text-ui text-text-secondary mb-0.5 block">{orProvider.label}</label>
            <p className="text-detail text-text-ghost mb-1.5">
              Free models available — no credit card required
            </p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKeys[orProvider.id] ?? ""}
                onChange={(e) => onApiKeyChange(orProvider.id, e.target.value)}
                placeholder="Enter OpenRouter API key"
                className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
              />
              <button
                onClick={() => onTestKey(orProvider.id)}
                disabled={testingKey === orProvider.id || !(apiKeys[orProvider.id] ?? "").trim()}
                className={`px-3 py-1.5 rounded text-ui font-medium transition-colors shrink-0 ${
                  testingKey === orProvider.id || !(apiKeys[orProvider.id] ?? "").trim()
                    ? "bg-bg-elevated text-text-ghost cursor-not-allowed"
                    : "bg-accent/10 text-accent hover:bg-accent/20"
                }`}
              >
                {testingKey === orProvider.id ? "Testing..." : "Test"}
              </button>
            </div>
            {testResults[orProvider.id] === "success" && (
              <p className="text-green text-label mt-1">
                API key is valid
                {openRouterLoading
                  ? " — loading models..."
                  : openRouterModels.length > 0
                    ? ` — ${openRouterModels.length} models available (${openRouterModels.filter((m) => m.isFree).length} free)`
                    : ""}
              </p>
            )}
            {testResults[orProvider.id] === "error" && (
              <p className="text-red text-label mt-1">Could not validate API key — check that the key is correct and your internet connection is working</p>
            )}
          </div>
        )}

        {/* Divider between OpenRouter and other providers */}
        {orProvider && nonOrProviders.length > 0 && (
          <div className="border-t border-border-light pt-2">
            <p className="text-detail text-text-ghost mb-2">Other Providers</p>
          </div>
        )}

        {/* Other providers */}
        {nonOrProviders.map((provider) => {
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
          {(Object.entries(AI_MODELS) as [APIProvider, typeof AI_MODELS[APIProvider]][])
            .filter(([, models]) => models.length > 0)
            .map(([provider, models]) => (
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

          {/* OpenRouter pricing (auto-fetched, read-only) */}
          {openRouterModels.length > 0 && (
            <div>
              <h4 className="text-label text-text-dim uppercase tracking-wider mb-1.5 mt-2">
                OpenRouter ({openRouterModels.length} models)
              </h4>
              <p className="text-detail text-text-ghost mb-1.5">
                Pricing is auto-fetched from the OpenRouter API. Free models have $0 cost.
              </p>
              {openRouterModels
                .filter((m) => m.isFree)
                .slice(0, 8)
                .map((m) => (
                  <div key={m.id} className="flex items-center gap-3 py-1">
                    <span className="text-ui text-text-ghost w-56 shrink-0 truncate" title={m.id}>{m.name}</span>
                    <span className="text-label" style={{ color: "var(--accent)" }}>Free</span>
                  </div>
                ))}
              {openRouterModels
                .filter((m) => !m.isFree && m.pricing.input > 0)
                .sort((a, b) => a.pricing.input - b.pricing.input)
                .slice(0, 5)
                .map((m) => (
                  <div key={m.id} className="flex items-center gap-3 py-1">
                    <span className="text-ui text-text-ghost w-56 shrink-0 truncate" title={m.id}>{m.name}</span>
                    <span className="text-label text-text-ghost">
                      ${m.pricing.input.toFixed(2)} / ${m.pricing.output.toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
