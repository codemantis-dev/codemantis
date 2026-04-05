// ═══════════════════════════════════════════════════════════════════════
// Self-Drive Settings Tab
// ═══════════════════════════════════════════════════════════════════════

import { SectionTitle, FieldRow } from "./SettingsShared";
import { Info } from "lucide-react";
import { AI_MODELS } from "../../../types/assistant-provider";

interface SelfDriveTabProps {
  provider: string;
  model: string;
  maxFixAttempts: number;
  runBuildCheck: boolean;
  runTests: boolean;
  autoCommit: boolean;
  apiKeys: Record<string, string>;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onMaxFixAttemptsChange: (v: number) => void;
  onRunBuildCheckChange: (v: boolean) => void;
  onRunTestsChange: (v: boolean) => void;
  onAutoCommitChange: (v: boolean) => void;
}

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
];

function getModelOptions(provider: string): { id: string; label: string }[] {
  const models = AI_MODELS[provider as keyof typeof AI_MODELS];
  if (models) {
    return models.map((m) => ({ id: m.id, label: m.label }));
  }
  return [];
}

export default function SelfDriveTab({
  provider,
  model,
  maxFixAttempts,
  runBuildCheck,
  runTests,
  autoCommit,
  apiKeys,
  onProviderChange,
  onModelChange,
  onMaxFixAttemptsChange,
  onRunBuildCheckChange,
  onRunTestsChange,
  onAutoCommitChange,
}: SelfDriveTabProps) {
  const models = getModelOptions(provider);
  const availableProviders = PROVIDERS.filter((p) => !!apiKeys[p.id]?.trim());
  const hasAnyKey = availableProviders.length > 0;

  return (
    <div className="space-y-6">
      <SectionTitle>Self-Drive — AI Orchestrator</SectionTitle>

      <p className="text-text-dim text-label leading-relaxed">
        Self-Drive autonomously implements your guide sessions. An AI orchestrator
        evaluates each step and decides what to do next — build, verify, fix, or advance.
      </p>

      {!hasAnyKey && (
        <div className="px-3 py-2.5 rounded-lg border border-yellow/30 bg-yellow/5 text-label text-text-dim">
          No AI provider API keys configured. Add a key in{" "}
          <span className="font-medium text-text-secondary">
            Settings &rarr; AI Providers
          </span>{" "}
          to enable Self-Drive.
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
                const newModels = getModelOptions(e.target.value);
                if (newModels.length > 0) {
                  onModelChange(newModels[0].id);
                }
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

          <div className="h-px" style={{ background: "var(--border-light)" }} />

          <SectionTitle>Behavior</SectionTitle>

          {/* Max fix attempts */}
          <FieldRow label="Max fix attempts per session">
            <input
              type="number"
              min={1}
              max={10}
              value={maxFixAttempts}
              onChange={(e) => onMaxFixAttemptsChange(Math.max(1, Math.min(10, Number(e.target.value))))}
              className="w-16 px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary text-center"
            />
          </FieldRow>

          {/* Run build check */}
          <FieldRow label="Run build check after each session">
            <button
              onClick={() => onRunBuildCheckChange(!runBuildCheck)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                runBuildCheck ? "bg-accent" : "bg-bg-elevated"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  runBuildCheck ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </FieldRow>

          {/* Run tests */}
          <FieldRow label="Run test suite after each session">
            <button
              onClick={() => onRunTestsChange(!runTests)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                runTests ? "bg-accent" : "bg-bg-elevated"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  runTests ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </FieldRow>

          {/* Auto-commit */}
          <FieldRow label="Auto-commit between sessions">
            <button
              onClick={() => onAutoCommitChange(!autoCommit)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                autoCommit ? "bg-accent" : "bg-bg-elevated"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  autoCommit ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </FieldRow>
        </>
      )}

      {/* Info box */}
      <div className="flex gap-2 px-3 py-2.5 rounded-lg border border-border bg-bg-elevated">
        <Info size={14} className="text-accent shrink-0 mt-0.5" />
        <div className="text-label text-text-dim leading-relaxed">
          <p>
            Self-Drive requires an AI API key for the orchestrator.
            A fast, cheap model (Haiku-class) is recommended.
          </p>
          <p className="mt-1">
            Estimated cost: <span className="font-medium">$0.05 - $0.50</span> per full run.
          </p>
        </div>
      </div>
    </div>
  );
}
