/**
 * Recall Settings tab (v1 minimum-viable surface).
 *
 * Ships the controls users absolutely need to opt into Recall:
 * - Master enabled toggle
 * - Mode dropdown
 * - "Open vault in Obsidian" + "Run cold-start seed" actions
 * - Read-only health summary (note count, last indexed at)
 *
 * Power-user fields (provider/model/thinking/token budget/etc.) live
 * in settings.json for v1; the full settings panel ships in v1.1.
 *
 * Bypasses the modal's batch-save flow: changes here persist
 * immediately via update_settings. The Recall config is small and
 * mostly toggles — instant-apply matches the user expectation that
 * flipping the master flag has effect right away.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { AppSettings } from "../../../types/settings";
import {
  recallForceSeed,
  recallGetHealth,
  recallOpenVault,
  recallReindex,
} from "../../../lib/tauri-commands";
import {
  defaultRecallConfig,
  type RecallConfig,
  type RecallHealth,
  type RecallMode,
} from "../../../types/recall";
import { AI_MODELS, type APIProvider } from "../../../types/assistant-provider";
import { useSessionStore } from "../../../stores/sessionStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useToastStore } from "../../../stores/toastStore";
import { SectionTitle, FieldRow } from "./SettingsShared";

// Recall's LLM dispatch supports Gemini, OpenAI, and Anthropic only — no
// OpenRouter (see src-tauri `recall/llm_client.rs`). Dropdown values are
// the canonical api-key ids used elsewhere in the app.
const RECALL_PROVIDERS: { id: APIProvider; label: string }[] = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];

/** Map the legacy `"google"` provider id to the canonical `"gemini"` so a
 * stored config self-heals on display and on the next change (mirrors the
 * Rust-side `canonical_provider`). Unknown ids fall back to Gemini. */
function normalizeRecallProvider(provider: string): APIProvider {
  if (provider === "google") return "gemini";
  if (provider === "openai" || provider === "anthropic" || provider === "gemini") {
    return provider;
  }
  return "gemini";
}

const SELECT_CLS =
  "rounded-md border border-border bg-bg-elevated text-text-primary px-2 py-1 text-ui";
const NUM_CLS = `${SELECT_CLS} w-28`;

// Reasoning/thinking levels, mapped per-provider in the backend (Gemini
// thinkingBudget, OpenAI reasoning_effort, Anthropic thinking block).
// "off" forces thinking off even on thinking-default models.
const THINKING_LEVELS: { value: string; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const MODE_OPTIONS: { value: RecallMode; label: string; help: string }[] = [
  {
    value: "off",
    label: "Off",
    help: "No Recall activity for this project. Vault stays in place but neither enricher nor harvester runs.",
  },
  {
    value: "suggested",
    label: "Suggested (default)",
    help: "Enricher + Harvester run. Failures log a warning but never block prompts or commits.",
  },
  {
    value: "enforced",
    label: "Enforced",
    help: "Enricher must complete before prompts send; Self-Drive blocks when the enricher model isn't reachable.",
  },
];

export default function RecallTab() {
  const [config, setConfig] = useState<RecallConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [health, setHealth] = useState<RecallHealth | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await invoke<AppSettings>("get_settings");
        if (cancelled) return;
        setConfig((settings.recall as RecallConfig | undefined) ?? defaultRecallConfig());
      } catch {
        setConfig(defaultRecallConfig());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeProjectPath) {
      setHealth(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const h = await recallGetHealth(activeProjectPath);
        if (!cancelled) setHealth(h);
      } catch {
        if (!cancelled) setHealth(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, config?.enabled]);

  if (!config) {
    return (
      <div className="text-text-secondary text-ui">Loading Recall settings…</div>
    );
  }

  const persist = async (next: RecallConfig) => {
    setSaving(true);
    try {
      // Route through the settings store rather than invoking update_settings
      // directly. Writing straight to disk would leave the store's in-memory
      // snapshot stale, and the modal's batch-save (handleSave) would then
      // merge that stale `recall` back over what we just wrote — silently
      // reverting the toggle. Going through the store keeps both in sync.
      await useSettingsStore.getState().updateSettings({ recall: next });
      setConfig(next);
    } catch (e) {
      addToast(`Failed to save Recall settings: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // Provider change resets that side's model to a valid default for the
  // new provider, so we never persist a model id the provider can't serve.
  const onProviderChange = (
    side: "enricher" | "harvester",
    provider: APIProvider,
  ) => {
    if (!config) return;
    const firstModel = AI_MODELS[provider]?.[0]?.id ?? "";
    if (side === "enricher") {
      void persist({ ...config, enricherProvider: provider, enricherModel: firstModel });
    } else {
      void persist({ ...config, harvesterProvider: provider, harvesterModel: firstModel });
    }
  };

  const persistNumber = (
    key: "tokenBudgetPerBrief" | "staleThresholdDays",
    raw: string,
    min: number,
    max: number,
  ) => {
    if (!config) return;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return; // ignore half-typed / empty input
    const clamped = Math.min(max, Math.max(min, n));
    void persist({ ...config, [key]: clamped });
  };

  const onSeed = async () => {
    if (!activeProjectPath) {
      addToast("Open a project before seeding Recall.", "warning");
      return;
    }
    setSeeding(true);
    try {
      const resp = await recallForceSeed(activeProjectPath);
      addToast(
        `Recall seed: ${resp.report.notesIndexed} notes (${resp.report.elapsedMs}ms, manifest: ${resp.report.manifestOutcome}).`,
        "success",
      );
      const h = await recallGetHealth(activeProjectPath);
      setHealth(h);
    } catch (e) {
      addToast(`Seed failed: ${(e as Error).message}`, "error");
    } finally {
      setSeeding(false);
    }
  };

  const onReindex = async () => {
    if (!activeProjectPath) return;
    setReindexing(true);
    try {
      const resp = await recallReindex(activeProjectPath);
      addToast(
        `Recall reindex: ${resp.notesIndexed} notes indexed${resp.partialParses ? ` (${resp.partialParses} partial)` : ""}.`,
        "success",
      );
      const h = await recallGetHealth(activeProjectPath);
      setHealth(h);
    } catch (e) {
      addToast(`Reindex failed: ${(e as Error).message}`, "error");
    } finally {
      setReindexing(false);
    }
  };

  const onOpenVault = async () => {
    if (!activeProjectPath) return;
    try {
      await recallOpenVault(activeProjectPath);
    } catch (e) {
      addToast(`Open vault failed: ${(e as Error).message}`, "error");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Recall — project & cross-project memory</SectionTitle>
        <p className="text-ui text-text-secondary mb-2">
          Recall composes a focused brief from your project&apos;s vault before
          each agent prompt, and harvests one memory note per commit anchored
          to the diff. Notes live as plain Markdown in{" "}
          <code className="text-text-primary">&lt;project&gt;/.recall/</code>{" "}
          and are openable in Obsidian.
        </p>
        <p className="text-ui text-text-faint">
          Recall sends snippets of your code and notes to the configured
          provider on every enriched prompt and harvested commit. The vault
          itself stays local-only unless you opt into committing it.
        </p>
      </div>

      <FieldRow label="Enable Recall">
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={saving}
            onChange={(e) => persist({ ...config, enabled: e.target.checked })}
            className="form-checkbox h-4 w-4"
          />
        </label>
      </FieldRow>

      <FieldRow label="Mode">
        <select
          value={config.mode}
          disabled={saving || !config.enabled}
          onChange={(e) =>
            persist({ ...config, mode: e.target.value as RecallMode })
          }
          className="rounded-md border border-border bg-bg-elevated text-text-primary px-2 py-1 text-ui"
        >
          {MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <p className="text-ui text-text-faint -mt-3">
        {MODE_OPTIONS.find((o) => o.value === config.mode)?.help}
      </p>

      <div className="border-t border-border pt-4">
        <SectionTitle>This project&apos;s vault</SectionTitle>
        {activeProjectPath ? (
          <>
            <p className="text-ui text-text-secondary mb-2">
              Project:{" "}
              <code className="text-text-primary">{activeProjectPath}</code>
            </p>
            {health ? (
              <div className="text-ui text-text-secondary space-y-1 mb-3">
                <div>
                  Indexed notes:{" "}
                  <span className="text-text-primary">{health.noteCount}</span>
                  {health.noteCountsByType.length > 0 && (
                    <span className="text-text-faint">
                      {" "}
                      (
                      {health.noteCountsByType
                        .map(([t, c]) => `${t}: ${c}`)
                        .join(", ")}
                      )
                    </span>
                  )}
                </div>
                <div>
                  Harvests logged:{" "}
                  <span className="text-text-primary">
                    {health.harvestsTotal}
                  </span>
                </div>
                <div>
                  Last indexed:{" "}
                  <span className="text-text-primary">
                    {health.lastIndexedAt ?? "never"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-ui text-text-faint mb-3">
                No vault registered yet — run cold-start seed below.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onSeed}
                disabled={seeding}
                className="px-3 py-1.5 rounded-md text-ui bg-accent text-white hover:bg-accent-light disabled:opacity-50 transition-colors"
              >
                {seeding ? "Seeding…" : "Run cold-start seed"}
              </button>
              <button
                onClick={onReindex}
                disabled={reindexing}
                className="px-3 py-1.5 rounded-md text-ui border border-border hover:bg-bg-elevated disabled:opacity-50 transition-colors"
              >
                {reindexing ? "Reindexing…" : "Reindex"}
              </button>
              <button
                onClick={onOpenVault}
                className="px-3 py-1.5 rounded-md text-ui border border-border hover:bg-bg-elevated transition-colors"
              >
                Open vault in Finder/Obsidian
              </button>
            </div>
          </>
        ) : (
          <p className="text-ui text-text-faint">
            Open a project to manage its Recall vault.
          </p>
        )}
      </div>

      {config.enabled && (
        <div className="border-t border-border pt-4 space-y-4">
          <SectionTitle>Advanced</SectionTitle>

          <div className="space-y-3">
            <p className="text-ui text-text-secondary font-medium">Enricher LLM</p>
            <p className="text-ui text-text-faint -mt-2">
              Ranks which memory notes to inject before each prompt.
            </p>
            <FieldRow label="Enricher provider">
              <select
                aria-label="Enricher provider"
                value={normalizeRecallProvider(config.enricherProvider)}
                disabled={saving}
                onChange={(e) =>
                  onProviderChange("enricher", e.target.value as APIProvider)
                }
                className={SELECT_CLS}
              >
                {RECALL_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Enricher model">
              <select
                aria-label="Enricher model"
                value={config.enricherModel}
                disabled={saving}
                onChange={(e) =>
                  persist({ ...config, enricherModel: e.target.value })
                }
                className={SELECT_CLS}
              >
                {(AI_MODELS[normalizeRecallProvider(config.enricherProvider)] ?? []).map(
                  (m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ),
                )}
              </select>
            </FieldRow>
            <FieldRow label="Enricher thinking">
              <select
                aria-label="Enricher thinking"
                value={config.enricherThinking}
                disabled={saving}
                onChange={(e) =>
                  persist({ ...config, enricherThinking: e.target.value })
                }
                className={SELECT_CLS}
              >
                {THINKING_LEVELS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>

          <div className="space-y-3">
            <p className="text-ui text-text-secondary font-medium">Harvester LLM</p>
            <p className="text-ui text-text-faint -mt-2">
              Distills one memory note per commit from the diff.
            </p>
            <FieldRow label="Harvester provider">
              <select
                aria-label="Harvester provider"
                value={normalizeRecallProvider(config.harvesterProvider)}
                disabled={saving}
                onChange={(e) =>
                  onProviderChange("harvester", e.target.value as APIProvider)
                }
                className={SELECT_CLS}
              >
                {RECALL_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Harvester model">
              <select
                aria-label="Harvester model"
                value={config.harvesterModel}
                disabled={saving}
                onChange={(e) =>
                  persist({ ...config, harvesterModel: e.target.value })
                }
                className={SELECT_CLS}
              >
                {(AI_MODELS[normalizeRecallProvider(config.harvesterProvider)] ?? []).map(
                  (m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ),
                )}
              </select>
            </FieldRow>
            <FieldRow label="Harvester thinking">
              <select
                aria-label="Harvester thinking"
                value={config.harvesterThinking}
                disabled={saving}
                onChange={(e) =>
                  persist({ ...config, harvesterThinking: e.target.value })
                }
                className={SELECT_CLS}
              >
                {THINKING_LEVELS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>

          <div className="space-y-3">
            <FieldRow label="Token budget per brief">
              <input
                aria-label="Token budget per brief"
                type="number"
                min={500}
                max={8000}
                step={100}
                value={config.tokenBudgetPerBrief}
                disabled={saving}
                onChange={(e) =>
                  persistNumber("tokenBudgetPerBrief", e.target.value, 500, 8000)
                }
                className={NUM_CLS}
              />
            </FieldRow>
            <p className="text-ui text-text-faint -mt-2">
              Max tokens for the injected brief (~4 chars/token). Lower-authority
              notes are dropped first to fit; landmines are never dropped.
            </p>
            <FieldRow label="Stale threshold (days)">
              <input
                aria-label="Stale threshold (days)"
                type="number"
                min={1}
                max={365}
                step={1}
                value={config.staleThresholdDays}
                disabled={saving}
                onChange={(e) =>
                  persistNumber("staleThresholdDays", e.target.value, 1, 365)
                }
                className={NUM_CLS}
              />
            </FieldRow>
            <p className="text-ui text-text-faint -mt-2">
              Notes whose source paths haven&apos;t been touched in this many days
              are surfaced cautiously under the brief&apos;s FRESHNESS section.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
