// ═══════════════════════════════════════════════════════════════════════
// Duo-Coding Settings Tab
// ═══════════════════════════════════════════════════════════════════════
//
// Self-contained: reads/writes `settings.duo` (DuoCodingConfig) directly via
// the settings store, so it doesn't need ~10 props threaded through
// SettingsModal. Governs run policy — tie-break, dialogue rounds, drift, the
// analyst LLM, and budget caps — not the per-run agent pairing (that lives in
// the Duo setup modal).

import { useMemo } from "react";
import { Info } from "lucide-react";
import { SectionTitle, FieldRow } from "./SettingsShared";
import { CHANGELOG_PROVIDERS } from "./constants";
import { useSettingsStore } from "../../../stores/settingsStore";
import { DEFAULT_DUO_SETTINGS, type DuoCodingSettings } from "../../../types/settings";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`w-10 h-5 rounded-full transition-colors relative ${on ? "bg-accent" : "bg-bg-elevated"}`}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

const TIE_BREAKS: { id: DuoCodingSettings["tieBreakPolicy"]; label: string }[] = [
  { id: "pause", label: "Pause for me to decide" },
  { id: "mentorWins", label: "Mentor wins" },
  { id: "primaryWins", label: "Primary proceeds" },
];

const DRIFT_SENSITIVITIES: { id: DuoCodingSettings["severeDriftSensitivity"]; label: string }[] = [
  { id: "conservative", label: "Conservative" },
  { id: "balanced", label: "Balanced" },
  { id: "aggressive", label: "Aggressive" },
];

export default function DuoTab(): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const duo = useMemo<DuoCodingSettings>(() => settings.duo ?? DEFAULT_DUO_SETTINGS, [settings.duo]);

  const patch = (p: Partial<DuoCodingSettings>): void => {
    void updateSettings({ duo: { ...duo, ...p } });
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Duo-Coding</SectionTitle>
      <p className="text-text-dim text-label leading-relaxed">
        A primary coding agent does the work while a read-only mentor reviews every turn,
        runs the build/tests itself, and directs repairs. These settings govern how the
        pair resolves disagreements and how the analyst dashboard is produced. The agent
        pairing for each run is chosen when you start it.
      </p>

      <FieldRow label="Enable Duo-Coding">
        <Toggle on={duo.enabled} onChange={(v) => patch({ enabled: v })} />
      </FieldRow>

      <div className="h-px" style={{ background: "var(--border-light)" }} />
      <SectionTitle>Disagreements</SectionTitle>

      <FieldRow label="When the pair can't converge">
        <select
          value={duo.tieBreakPolicy}
          onChange={(e) => patch({ tieBreakPolicy: e.target.value as DuoCodingSettings["tieBreakPolicy"] })}
          className="px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary"
        >
          {TIE_BREAKS.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Max dialogue rounds before tie-break">
        <input
          type="number"
          min={1}
          max={10}
          value={duo.maxDialogueRounds}
          onChange={(e) => patch({ maxDialogueRounds: Math.max(1, Math.min(10, Number(e.target.value))) })}
          className="w-16 px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary text-center"
        />
      </FieldRow>

      <div className="h-px" style={{ background: "var(--border-light)" }} />
      <SectionTitle>Mid-run drift</SectionTitle>

      <FieldRow label="Nudge the primary on severe drift">
        <Toggle on={duo.severeDriftNudgeEnabled} onChange={(v) => patch({ severeDriftNudgeEnabled: v })} />
      </FieldRow>

      <FieldRow label="Drift sensitivity">
        <select
          value={duo.severeDriftSensitivity}
          onChange={(e) => patch({ severeDriftSensitivity: e.target.value as DuoCodingSettings["severeDriftSensitivity"] })}
          disabled={!duo.severeDriftNudgeEnabled}
          className="px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary disabled:opacity-50"
        >
          {DRIFT_SENSITIVITIES.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </FieldRow>

      <div className="h-px" style={{ background: "var(--border-light)" }} />
      <SectionTitle>Analyst dashboard</SectionTitle>

      <FieldRow label="Generate the live analyst dashboard">
        <Toggle on={duo.analystEnabled} onChange={(v) => patch({ analystEnabled: v })} />
      </FieldRow>

      <FieldRow label="Analyst provider">
        <select
          value={duo.analystProvider}
          onChange={(e) => patch({ analystProvider: e.target.value })}
          disabled={!duo.analystEnabled}
          className="px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary disabled:opacity-50"
        >
          {CHANGELOG_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Analyst model">
        <input
          type="text"
          value={duo.analystModel}
          onChange={(e) => patch({ analystModel: e.target.value })}
          disabled={!duo.analystEnabled}
          className="w-56 px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary disabled:opacity-50"
        />
      </FieldRow>

      <div className="h-px" style={{ background: "var(--border-light)" }} />
      <SectionTitle>Budget</SectionTitle>

      <FieldRow label="Pause when run cost exceeds (USD, blank = no cap)">
        <input
          type="number"
          min={0}
          step={0.5}
          value={duo.budgetUsdCap ?? ""}
          onChange={(e) => patch({ budgetUsdCap: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
          className="w-24 px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary text-right"
        />
      </FieldRow>

      <FieldRow label="Pause when output tokens exceed (blank = no cap)">
        <input
          type="number"
          min={0}
          step={10000}
          value={duo.budgetTokenCap ?? ""}
          onChange={(e) => patch({ budgetTokenCap: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
          className="w-28 px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary text-right"
        />
      </FieldRow>

      <div className="flex gap-2 px-3 py-2.5 rounded-lg border border-border bg-bg-elevated">
        <Info size={14} className="text-accent shrink-0 mt-0.5" />
        <div className="text-label text-text-dim leading-relaxed">
          The analyst is a separate API LLM (a fast, cheap model is recommended), distinct
          from the two coding agents. Running two coding agents plus the analyst costs more
          than a single agent — use the budget caps to bound a run.
        </div>
      </div>
    </div>
  );
}
