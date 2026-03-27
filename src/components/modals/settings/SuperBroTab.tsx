import { SectionTitle, FieldRow } from "./SettingsShared";
import { Info } from "lucide-react";

interface SuperBroTabProps {
  enabled: boolean;
  provider: string;
  model: string;
  onEnabledChange: (v: boolean) => void;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
}

const PROVIDER_OPTIONS = [
  { id: "auto", label: "Auto (cheapest available)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];

const MODEL_OPTIONS: Record<string, { id: string; label: string }[]> = {
  auto: [{ id: "auto", label: "Auto — best free model" }],
  openrouter: [
    { id: "auto", label: "Auto — cheapest free model" },
    { id: "google/gemini-2.5-flash-preview-05-20:free", label: "Gemini 2.5 Flash (free)" },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  openai: [
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  ],
};

export default function SuperBroTab({
  enabled,
  provider,
  model,
  onEnabledChange,
  onProviderChange,
  onModelChange,
}: SuperBroTabProps) {
  const models = MODEL_OPTIONS[provider] ?? MODEL_OPTIONS["auto"];

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
          {/* Provider selector */}
          <FieldRow label="Provider">
            <select
              value={provider}
              onChange={(e) => {
                onProviderChange(e.target.value);
                // Reset model to auto when provider changes
                onModelChange("auto");
              }}
              className="px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary"
            >
              {PROVIDER_OPTIONS.map((p) => (
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
