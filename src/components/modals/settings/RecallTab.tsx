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
import { useSessionStore } from "../../../stores/sessionStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useToastStore } from "../../../stores/toastStore";
import { SectionTitle, FieldRow } from "./SettingsShared";

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

      <div className="border-t border-border pt-4">
        <p className="text-ui text-text-faint">
          Advanced fields (provider/model selection, token budget, freshness
          threshold) ship in v1.1. For v1, edit{" "}
          <code>settings.json</code> directly to override defaults
          (provider: <code>google</code>, model:{" "}
          <code>gemini-3.1-flash-lite</code>).
        </p>
      </div>
    </div>
  );
}
