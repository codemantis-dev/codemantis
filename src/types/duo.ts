/**
 * Duo-Coding types — mentor/primary collaborative agent mode.
 *
 * A **primary** coding agent (a real CLI session, sole writer) does the work;
 * a read-only **Duo/mentor** CLI session monitors, runs build/tests itself,
 * and on disagreement directs a repair via an injected message into the
 * primary's chat (the mentor never edits files). A separate API-LLM analyst
 * produces the dashboard. See the approved plan / `project_duo_coding`.
 *
 * Persistence-row shapes (`Duo*Row`) mirror the serde `camelCase` output of the
 * Rust `duo_*` accessors in `src-tauri/src/storage/database.rs`.
 */

import type { AgentId } from "./agent-events";

// ── Lifecycle ──────────────────────────────────────────────────────────────

export type DuoStatus = "idle" | "running" | "paused" | "completed";

/**
 * Orchestration phases, mirroring the selfDriveStore phase vocabulary.
 * `reviewing` = Duo grading the primary's last turn; `dialoguing` = bounded
 * back-and-forth; `repairing` = primary applying a mentor-directed fix;
 * `escalated` = non-convergence handed to the tie-break policy.
 */
export type DuoPhase =
  | "preparing"
  | "building"
  | "reviewing"
  | "dialoguing"
  | "repairing"
  | "verifying"
  | "escalated"
  | "completed";

// ── Verdict (parsed from the Duo's fenced ```duo-verdict``` block) ───────────

export type DuoStance = "agree" | "concern" | "disagree";

/** Severity gates the intervention: blocking → dialogue/nudge; advisory → batched; nit → log only. */
export type DuoSeverity = "blocking" | "advisory" | "nit";

export interface DuoVerdict {
  stance: DuoStance;
  severity: DuoSeverity;
  summary: string;
  rationale: string;
  /** Present when the Duo wants the primary to change something. */
  repairTask?: string;
  /** 0..1 self-reported confidence. */
  confidence: number;
  /** True only if the Duo actually ran these itself (anti-fabrication). */
  ranBuild: boolean;
  ranTests: boolean;
  /** Free-text build/test result the Duo observed. */
  checkResults?: string;
  citedFiles: string[];
}

/** Sentinel verdict used when the Duo's response can't be parsed even after one re-ask. */
export type DuoVerdictParse =
  | { ok: true; verdict: DuoVerdict }
  | { ok: false; reason: "no-block" | "invalid-json" | "schema-mismatch"; raw: string };

// ── Dialogue ─────────────────────────────────────────────────────────────────

export type DuoDialogueAuthor = "primary" | "duo";

export type DuoDialogueStance =
  | "concern" // duo raises an issue
  | "defend" // primary argues its approach
  | "accept" // either side concedes
  | "propose"; // duo proposes a concrete repair

export interface DuoDialogueTurn {
  id: string;
  round: number;
  author: DuoDialogueAuthor;
  stance: DuoDialogueStance;
  text: string;
  ts: number;
}

// ── Tie-break (Settings-configurable; default "pause") ───────────────────────

export type DuoTieBreakPolicy = "pause" | "mentorWins" | "primaryWins";

// ── Per-run config ───────────────────────────────────────────────────────────

/** One agent side of a Duo pairing (primary or mentor). */
export interface DuoAgentConfig {
  agentId: AgentId;
  model?: string;
  effort?: string;
}

export interface DuoConfig {
  primary: DuoAgentConfig;
  duo: DuoAgentConfig;
  tieBreakPolicy: DuoTieBreakPolicy;
  maxDialogueRounds: number;
  severeDriftNudgeEnabled: boolean;
  severeDriftSensitivity: "conservative" | "balanced" | "aggressive";
  analystEnabled: boolean;
  analystProvider: string;
  analystModel: string;
  budgetUsdCap: number | null;
  budgetTokenCap: number | null;
}

// ── Event log ─────────────────────────────────────────────────────────────────

export type DuoEventKind =
  | "turn"
  | "concern"
  | "nudge"
  | "agreement"
  | "disagreement"
  | "dialogue"
  | "repair"
  | "verdict"
  | "drift"
  | "escalation"
  | "decision";

export type DuoEventActor = "primary" | "duo" | "analyst" | "system";

export interface DuoDiffStats {
  added: number;
  removed: number;
  files: number;
}

// ── Analyst output ───────────────────────────────────────────────────────────

export interface DuoMetrics {
  agreementRate: number; // 0..1 across reviews
  reviews: number;
  agreements: number;
  disagreements: number;
  repairs: number;
  dialogueRounds: number;
  driftIncidents: number;
  /** Mentor-precision: flagged concerns that turned out real (post-fix verified). */
  mentorPrecision: number | null;
  costUsd: number;
  outputTokens: number;
}

/** A single point in a dashboard time series (per primary turn). */
export interface DuoSeriesPoint {
  turn: number;
  ts: number;
  added: number;
  removed: number;
  stance: DuoStance | null;
  costUsd: number;
}

export interface DuoAnalystSnapshot {
  narrative: string;
  metrics: DuoMetrics;
  series: DuoSeriesPoint[];
}

// ── Persistence rows (serde camelCase from Rust) ─────────────────────────────

export interface DuoRunRow {
  id: string;
  primarySessionId: string;
  duoSessionId: string;
  projectPath: string;
  status: string;
  configJson: string;
  outcome: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface DuoEventRow {
  id: string;
  runId: string;
  ts: number;
  kind: string;
  actor: string;
  payloadJson: string;
  diffStatsJson: string | null;
}

export interface DuoSnapshotRow {
  id: string;
  runId: string;
  ts: number;
  narrative: string;
  metricsJson: string;
  seriesJson: string;
}
