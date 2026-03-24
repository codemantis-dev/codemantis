import { RotateCcw } from "lucide-react";
import type { ChangelogProvider } from "../../../types/settings";
import { DEFAULT_CHANGELOG_PROMPT } from "../../../types/settings";
import { AI_MODELS } from "../../../types/assistant-provider";
import type { APIProvider } from "../../../types/assistant-provider";
import OpenRouterModelSelect from "../../shared/OpenRouterModelSelect";
import { SectionTitle, FieldRow, CHANGELOG_PROVIDERS } from "./SettingsShared";

export default function ChangelogSettingsTab({
  enabled, provider, model, prompt,
  onEnabledChange, onProviderChange, onModelChange, onPromptChange,
}: {
  enabled: boolean; provider: ChangelogProvider; model: string; prompt: string;
  onEnabledChange: (v: boolean) => void; onProviderChange: (p: ChangelogProvider) => void;
  onModelChange: (m: string) => void; onPromptChange: (v: string) => void;
}) {
  const isOpenRouter = provider === "openrouter";
  const availableModels = isOpenRouter ? [] : (AI_MODELS[provider as APIProvider] ?? []);

  return (
    <div>
      <SectionTitle>Changelog</SectionTitle>
      <p className="text-label text-text-dim mb-4">
        Auto-generate changelog entries after each coding turn using an LLM provider.
      </p>

      {/* Toggle */}
      <div className="flex items-center justify-between py-2 mb-3">
        <label className="text-ui text-text-secondary">Enable auto-changelog</label>
        <button
          onClick={() => onEnabledChange(!enabled)}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            enabled ? "bg-accent" : "bg-bg-elevated border border-border"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4">
          <div className="border-t border-border-light pt-4 space-y-3">
            <FieldRow label="Provider">
              <select
                value={provider}
                onChange={(e) => onProviderChange(e.target.value as ChangelogProvider)}
                className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
              >
                {CHANGELOG_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Model">
              {isOpenRouter ? (
                <div className="w-80">
                  <OpenRouterModelSelect value={model} onChange={onModelChange} />
                </div>
              ) : (
                <select
                  value={model}
                  onChange={(e) => onModelChange(e.target.value)}
                  className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              )}
            </FieldRow>
          </div>

          {/* Prompt editor */}
          <div className="border-t border-border-light pt-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-ui text-text-secondary">System Prompt</label>
              <button
                onClick={() => onPromptChange(DEFAULT_CHANGELOG_PROMPT)}
                className="flex items-center gap-1 text-label text-text-ghost hover:text-text-dim transition-colors"
                title="Reset to default prompt"
              >
                <RotateCcw size={11} />
                <span>Reset</span>
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-text-primary text-ui font-mono leading-relaxed outline-none focus:border-accent/40 resize-y"
              placeholder="System prompt for changelog generation..."
            />
            <p className="text-[11px] text-text-ghost mt-1">
              The AI receives this as a system instruction. It should ask for JSON output with headline, description, and category fields.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
