import type { AssistantShortcut } from "../../../types/settings";
import { AI_PROVIDERS, AI_MODELS } from "../../../types/assistant-provider";
import type { AIProvider, APIProvider } from "../../../types/assistant-provider";
import { useOpenRouterStore } from "../../../stores/openRouterStore";
import OpenRouterModelSelect from "../../shared/OpenRouterModelSelect";
import { SectionTitle, FieldRow } from "./SettingsShared";

export default function AssistantSettingsTab({
  defaultProvider, defaultModel, shortcuts, apiKeys,
  onProviderChange, onModelChange, onShortcutsChange,
}: {
  defaultProvider: AIProvider;
  defaultModel: Record<string, string>;
  shortcuts: AssistantShortcut[];
  apiKeys: Record<string, string>;
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (provider: string, modelId: string) => void;
  onShortcutsChange: (shortcuts: AssistantShortcut[]) => void;
}) {
  const apiProviders = AI_PROVIDERS.filter((p) => p.id !== "claude-code");
  const orModels = useOpenRouterStore((s) => s.models);

  const handleShortcutUpdate = (index: number, field: "name" | "prompt", value: string) => {
    const updated = [...shortcuts];
    updated[index] = { ...updated[index], [field]: value };
    onShortcutsChange(updated);
  };

  return (
    <div>
      <SectionTitle>Assistant</SectionTitle>

      {/* Default Provider */}
      <div className="mb-6">
        <h4 className="text-ui text-text-secondary mb-3">Default Provider</h4>
        <p className="text-label text-text-dim mb-3">
          New assistant tabs will use this provider by default.
        </p>
        <div className="space-y-3">
          <FieldRow label="Provider">
            <select
              value={defaultProvider}
              onChange={(e) => onProviderChange(e.target.value as AIProvider)}
              className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </FieldRow>
        </div>
      </div>

      {/* Per-provider default models */}
      <div className="mb-6">
        <h4 className="text-ui text-text-secondary mb-3">Default Models</h4>
        <p className="text-label text-text-dim mb-3">
          Select which model to use for each AI provider when creating new assistant tabs.
        </p>
        <div className="space-y-3">
          {apiProviders.map((p) => {
            const isOpenRouter = p.id === "openrouter";
            const models = isOpenRouter ? [] : (AI_MODELS[p.id as APIProvider] ?? []);
            const hasKey = !!(apiKeys[p.id] ?? "").trim();
            const currentModel = defaultModel[p.id] ?? (isOpenRouter ? orModels[0]?.id : models[0]?.id) ?? "";

            if (isOpenRouter) {
              return (
                <FieldRow key={p.id} label={p.label}>
                  <div className="w-80">
                    <OpenRouterModelSelect
                      value={currentModel}
                      onChange={(id) => onModelChange(p.id, id)}
                      disabled={!hasKey}
                      placeholder={!hasKey ? "Set API key first" : "Select model..."}
                    />
                  </div>
                </FieldRow>
              );
            }

            return (
              <FieldRow key={p.id} label={p.label}>
                <select
                  value={currentModel}
                  onChange={(e) => onModelChange(p.id, e.target.value)}
                  disabled={!hasKey}
                  className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 disabled:opacity-40"
                  title={!hasKey ? `Set API key in Settings > AI Providers` : undefined}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </FieldRow>
            );
          })}
        </div>
      </div>

      {/* Shortcuts */}
      <div className="border-t border-border-light pt-4">
        <h4 className="text-ui text-text-secondary mb-2">Shortcuts</h4>
        <p className="text-label text-text-dim mb-3">
          Saved prompts available as quick-access chips in the assistant panel.
        </p>
        <div className="space-y-2">
          {shortcuts.map((sc, i) => (
            <div key={sc.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sc.name}
                  onChange={(e) => handleShortcutUpdate(i, "name", e.target.value)}
                  placeholder="Name"
                  className="w-28 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                />
                <textarea
                  value={sc.prompt}
                  onChange={(e) => handleShortcutUpdate(i, "prompt", e.target.value)}
                  placeholder="Prompt text"
                  rows={1}
                  className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost resize-y"
                />
                <button
                  onClick={() => onShortcutsChange(shortcuts.filter((_, j) => j !== i))}
                  className="text-text-ghost hover:text-red transition-colors text-ui px-1.5 py-1"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => onShortcutsChange([...shortcuts, { id: crypto.randomUUID(), name: "", prompt: "" }])}
            className="text-label text-accent hover:text-accent-light transition-colors"
          >
            + Add shortcut
          </button>
        </div>
      </div>
    </div>
  );
}
