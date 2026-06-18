/**
 * duoStore — orchestration state for Duo-Coding (mentor/primary mode).
 *
 * PHASE 0 SCOPE: config resolution from settings, run-lifecycle state, and the
 * pure helpers that downstream phases build on. The turn-boundary review loop,
 * cross-session injection, dialogue protocol, drift watcher, and tie-break
 * pause land in Phases 1–2 — modeled on `selfDriveStore` (pinned sessions,
 * dual-channel listeners, `handlePause`/blocker machinery).
 *
 * Both session ids are PINNED at start and never re-read from the active UI
 * tab, exactly as selfDriveStore pins its single session.
 */

import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";
import { DEFAULT_DUO_SETTINGS, type DuoCodingSettings } from "../types/settings";
import type {
  DuoStatus,
  DuoPhase,
  DuoConfig,
  DuoAgentConfig,
  DuoDialogueTurn,
  DuoVerdict,
  DuoMetrics,
} from "../types/duo";

/** Read the persisted Duo settings (policy + defaults), falling back to the opt-out baseline. */
export function resolveDuoSettings(): DuoCodingSettings {
  return useSettingsStore.getState().settings.duo ?? DEFAULT_DUO_SETTINGS;
}

/**
 * Build a per-run `DuoConfig` by merging the settings-level policy/defaults
 * with the chosen primary/mentor agent pairing. Pure — easy to unit test and
 * the single place run config is assembled.
 */
export function buildDuoConfig(
  primary: DuoAgentConfig,
  duo: DuoAgentConfig,
  settings: DuoCodingSettings = resolveDuoSettings(),
): DuoConfig {
  return {
    primary,
    duo,
    tieBreakPolicy: settings.tieBreakPolicy,
    maxDialogueRounds: settings.maxDialogueRounds,
    severeDriftNudgeEnabled: settings.severeDriftNudgeEnabled,
    severeDriftSensitivity: settings.severeDriftSensitivity,
    analystEnabled: settings.analystEnabled,
    analystProvider: settings.analystProvider,
    analystModel: settings.analystModel,
    budgetUsdCap: settings.budgetUsdCap,
    budgetTokenCap: settings.budgetTokenCap,
  };
}

/** A fresh, zeroed metrics object. */
export function emptyDuoMetrics(): DuoMetrics {
  return {
    agreementRate: 0,
    reviews: 0,
    agreements: 0,
    disagreements: 0,
    repairs: 0,
    dialogueRounds: 0,
    driftIncidents: 0,
    mentorPrecision: null,
    costUsd: 0,
    outputTokens: 0,
  };
}

export interface DuoState {
  status: DuoStatus;
  phase: DuoPhase | null;
  /** Persisted `duo_runs.id` for the active run. */
  runId: string | null;
  projectPath: string | null;
  /** Pinned at start; the sole-writer session. */
  primarySessionId: string | null;
  /** Pinned at start; the read-only mentor session. */
  duoSessionId: string | null;
  config: DuoConfig | null;
  dialogue: DuoDialogueTurn[];
  latestVerdict: DuoVerdict | null;
  metrics: DuoMetrics;
  /** Last error surfaced to the UI (non-fatal). */
  error: string | null;

  // ── Lifecycle actions (Phase 0: state-only; orchestration wired in Phase 1) ──
  configure: (params: {
    runId: string;
    projectPath: string;
    primarySessionId: string;
    duoSessionId: string;
    config: DuoConfig;
  }) => void;
  setStatus: (status: DuoStatus) => void;
  setPhase: (phase: DuoPhase | null) => void;
  appendDialogueTurn: (turn: DuoDialogueTurn) => void;
  setLatestVerdict: (verdict: DuoVerdict | null) => void;
  setMetrics: (metrics: DuoMetrics) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const INITIAL: Omit<
  DuoState,
  | "configure"
  | "setStatus"
  | "setPhase"
  | "appendDialogueTurn"
  | "setLatestVerdict"
  | "setMetrics"
  | "setError"
  | "reset"
> = {
  status: "idle",
  phase: null,
  runId: null,
  projectPath: null,
  primarySessionId: null,
  duoSessionId: null,
  config: null,
  dialogue: [],
  latestVerdict: null,
  metrics: emptyDuoMetrics(),
  error: null,
};

export const useDuoStore = create<DuoState>((set) => ({
  ...INITIAL,

  configure: ({ runId, projectPath, primarySessionId, duoSessionId, config }) =>
    set({
      runId,
      projectPath,
      primarySessionId,
      duoSessionId,
      config,
      status: "running",
      phase: "preparing",
      dialogue: [],
      latestVerdict: null,
      metrics: emptyDuoMetrics(),
      error: null,
    }),

  setStatus: (status) => set({ status }),
  setPhase: (phase) => set({ phase }),
  appendDialogueTurn: (turn) =>
    set((s) => ({ dialogue: [...s.dialogue, turn] })),
  setLatestVerdict: (latestVerdict) => set({ latestVerdict }),
  setMetrics: (metrics) => set({ metrics }),
  setError: (error) => set({ error }),
  reset: () => set({ ...INITIAL, metrics: emptyDuoMetrics() }),
}));
