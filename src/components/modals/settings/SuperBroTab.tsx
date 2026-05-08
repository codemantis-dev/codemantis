import { useEffect, useMemo } from "react";
import { SectionTitle, FieldRow } from "./SettingsShared";
import { Info } from "lucide-react";
import { AI_MODELS } from "../../../types/assistant-provider";
import { useOpenRouterStore } from "../../../stores/openRouterStore";

interface SuperBroTabProps {
  enabled: boolean;
  provider: string;
  model: string;
  apiKeys: Record<string, string>;
  onEnabledChange: (v: boolean) => void;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
}

const ALL_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];

function useModelOptions(provider: string): { id: string; label: string }[] {
  const orModels = useOpenRouterStore((s) => s.models);

  if (provider === "auto") {
    return [{ id: "auto", label: "Auto — best available model" }];
  }

  const autoOption = { id: "auto", label: "Auto — best available" };

  if (provider === "openrouter") {
    const dynamicModels = orModels.map((m) => ({
      id: m.id,
      label: `${m.name}${m.isFree ? " (free)" : ""}`,
    }));
    return [autoOption, ...dynamicModels];
  }

  // For gemini, openai, anthropic — pull from the shared AI_MODELS registry
  const providerModels = AI_MODELS[provider as keyof typeof AI_MODELS];
  if (providerModels) {
    return [
      autoOption,
      ...providerModels.map((m) => ({ id: m.id, label: m.label })),
    ];
  }

  return [autoOption];
}

export default function SuperBroTab({
  enabled,
  provider,
  model,
  apiKeys,
  onEnabledChange,
  onProviderChange,
  onModelChange,
}: SuperBroTabProps) {
  const models = useModelOptions(provider);

  // Only show providers that have a saved API key
  const availableProviders = useMemo(() => {
    const withKeys = ALL_PROVIDERS.filter(
      (p) => !!apiKeys[p.id]?.trim(),
    );
    // "Auto" is always available when at least one provider has a key
    if (withKeys.length > 0) {
      return [{ id: "auto", label: "Auto (cheapest available)" }, ...withKeys];
    }
    return [];
  }, [apiKeys]);

  const hasAnyKey = availableProviders.length > 0;

  // Reconcile drifted state: when the saved provider has no API key, the
  // <select> visually shows the first available option but `provider` state
  // stays stale, so the Model dropdown keeps offering the wrong models.
  useEffect(() => {
    if (!enabled || availableProviders.length === 0) return;
    if (!availableProviders.some((p) => p.id === provider)) {
      onProviderChange(availableProviders[0].id);
      onModelChange("auto");
      return;
    }
    if (models.length > 0 && !models.some((m) => m.id === model)) {
      onModelChange(models[0].id);
    }
  }, [enabled, provider, model, availableProviders, models, onProviderChange, onModelChange]);

  return (
    <div className="space-y-6">
      <SectionTitle>Super-Bro — AI Guidance</SectionTitle>

      {/* Enable/disable toggle */}
      <FieldRow label="Enable Super-Bro">
        <button
          onClick={() => onEnabledChange(!enabled)}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            enabled ? "bg-accent" : "bg-bg-elevated"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </FieldRow>

      <p className="text-text-dim text-label leading-relaxed">
        When enabled, Super-Bro watches your Claude Code sessions and offers
        proactive guidance — like a senior developer looking over your shoulder.
      </p>

      {enabled && (
        <>
          {!hasAnyKey && (
            <div className="px-3 py-2.5 rounded-lg border border-yellow/30 bg-yellow/5 text-label text-text-dim">
              No AI provider API keys configured. Add a key in{" "}
              <span className="font-medium text-text-secondary">
                Settings &rarr; AI Providers
              </span>{" "}
              to enable Super-Bro.
            </div>
          )}

          {hasAnyKey && (
            <>
              {/* Provider selector */}
              <FieldRow label="Provider">
                <select
                  value={provider}
                  onChange={(e) => {
                    onProviderChange(e.target.value);
                    onModelChange("auto");
                  }}
                  className="px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary"
                >
                  {availableProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </FieldRow>

              {/* Model selector */}
              <FieldRow label="Model">
                <select
                  value={model}
                  onChange={(e) => onModelChange(e.target.value)}
                  className="px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </FieldRow>
            </>
          )}

          {/* Info box */}
          <div className="flex gap-2 px-3 py-2.5 rounded-lg border border-border bg-bg-elevated">
            <Info size={14} className="text-accent shrink-0 mt-0.5" />
            <div className="text-label text-text-dim leading-relaxed">
              <p>
                Super-Bro uses your configured AI provider for guidance. Free
                models via OpenRouter are available.
              </p>
              <p className="mt-1 font-medium">
                Super-Bro never modifies files or runs commands — it only
                observes and advises.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
