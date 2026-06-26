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
  | "planning" // primary drafting / mentor reviewing the approach (plan gate)
  | "building"
  | "reviewing"
  | "dialoguing"
  | "repairing"
  | "verifying"
  | "escalated"
  | "completed";

/** How to route the mentor's next `turn_complete`. */
export type DuoMentorMode = "plan" | "incremental" | "final" | "dialogue";

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

// ── Conversation timeline ────────────────────────────────────────────────────
//
// The dashboard's "Conversation" is a single chronological timeline of every
// meaningful step: primary turns, mentor reviews (with verdict result), and
// centered system markers for outcomes/decisions. (Historically this was a
// thin "dialogue" of disputes only; the shape is widened, backward-compatibly.)

/** `system` carries outcome/decision markers shown centered, not as a side. */
export type DuoDialogueAuthor = "primary" | "duo" | "system";

export type DuoDialogueStance =
  // agent prose
  | "work" // primary's turn — what it did
  | "defend" // primary argues/responds in a dialogue
  | "review" // mentor's verdict on a turn
  | "concern" // mentor raises an issue (legacy; reviews now carry verdict)
  | "accept" // either side concedes
  | "propose" // mentor proposes a concrete repair
  // system markers (author === "system")
  | "resolve" // a discussion converged
  | "repair" // mentor directed a repair
  | "decision" // tie-break / lifecycle outcome
  | "drift" // mid-turn drift nudge
  | "budget"; // budget cap pause

/** Verdict result attached to a mentor `review` entry (so the UI shows what was decided). */
export interface DuoDialogueVerdict {
  stance: DuoStance;
  severity: DuoSeverity;
  confidence: number;
  ranBuild: boolean;
  ranTests: boolean;
  checkResults?: string;
}

export interface DuoDialogueTurn {
  id: string;
  round: number;
  author: DuoDialogueAuthor;
  stance: DuoDialogueStance;
  text: string;
  ts: number;
  /** Present on mentor `review` entries — the verdict's machine-readable result. */
  verdict?: DuoDialogueVerdict;
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
  planGateEnabled: boolean;
  liveReviewEnabled: boolean;
  /** How aggressively the mentor co-reviews while the primary works. */
  liveReviewCadence: "minimal" | "balanced" | "thorough";
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
  /** Total reported agent-turn cost (Claude self-reports; Codex reports none) —
   *  used for the budget cap. The dashboard breakdown is computed separately from
   *  per-session token usage so Codex shows an estimate (see `lib/duo-cost.ts`). */
  costUsd: number;
  /** Cost of the API-LLM analyst calls (surfaced via the snapshot event). */
  costAnalystUsd: number;
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

/**
 * The analyst LLM's structured report — the dashboard's stable contract.
 * Mirrors the Rust `DuoAnalystReport` (`src-tauri/src/duo/analyst.rs`), which
 * sanitizes every field (controlled vocabularies, clamped scores/lengths) so
 * these shapes are guaranteed even on a malformed model reply.
 */
export type DuoMomentum = "accelerating" | "steady" | "stalling" | "blocked" | "unknown";
export type DuoTrend = "improving" | "stable" | "declining" | "unknown";
export type DuoTrajectory = "improving" | "flat" | "regressing" | "unknown";
export type DuoRiskSeverity = "high" | "medium" | "low";
export type DuoEffectiveness = "high" | "moderate" | "low" | "unknown";
export type DuoDecisionOutcome = "primary" | "mentor" | "converged" | "pending" | "unknown";
export type DuoPriority = "high" | "medium" | "low";
export type DuoAudience = "primary" | "mentor" | "user";

export interface DuoAnalystReport {
  schemaVersion: number;
  headline: string;
  narrative: string;
  phaseAssessment: {
    currentFocus: string;
    momentum: DuoMomentum;
    momentumRationale: string;
  };
  collaborationHealth: {
    score: number;
    trend: DuoTrend;
    summary: string;
    frictionPoints: string[];
  };
  qualityAssessment: {
    score: number;
    trajectory: DuoTrajectory;
    strengths: string[];
    risks: { severity: DuoRiskSeverity; description: string; evidence: string }[];
  };
  repairAnalysis: {
    summary: string;
    rootCausePatterns: string[];
    mentorEffectiveness: DuoEffectiveness;
    mentorEffectivenessRationale: string;
  };
  improvementAnalysis: {
    summary: string;
    delivered: string[];
    preventedIssues: string[];
  };
  decisions: { title: string; outcome: DuoDecisionOutcome; summary: string }[];
  recommendations: { priority: DuoPriority; action: string; audience: DuoAudience }[];
  watchItems: string[];
  confidence: number;
}

/** A persisted/streamed analyst snapshot: the qualitative report + numeric series. */
export interface DuoAnalystSnapshot {
  narrative: string;
  report: DuoAnalystReport;
  series: DuoSeriesPoint[];
}

/** Payload of the real-time `duo:snapshot` event. */
export interface DuoSnapshotEvent {
  runId: string;
  ts: number;
  narrative: string;
  report: DuoAnalystReport;
  series: DuoSeriesPoint[];
  /** Cost (USD) of the analyst API call that produced this snapshot. */
  analystCostUsd: number;
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
