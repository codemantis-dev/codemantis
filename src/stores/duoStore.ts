/**
 * duoStore — orchestration for Duo-Coding (mentor/primary mode).
 *
 * A PRIMARY CLI session (sole writer) works the task; a READ-ONLY Duo/mentor
 * CLI session reviews each primary turn, runs the build/tests itself, and emits
 * a structured verdict. On a blocking verdict the mentor DIRECTS a repair into
 * the primary's chat (the mentor never edits). Non-convergence after
 * `maxDialogueRounds` repair attempts hits the Settings tie-break (default:
 * pause for human).
 *
 * Modeled on `selfDriveStore`: both session ids are PINNED at start; injection
 * goes through the same `sendMessage` path a human uses; turns are observed via
 * `listenChatEvents`. Phase 1 ships a single repair loop + tie-break; the full
 * bounded back-and-forth dialogue + severe-drift nudge land in Phase 2.
 */

import { create } from "zustand";
import { type UnlistenFn } from "@tauri-apps/api/event";
import {
  createSession,
  sendMessage,
  closeSession,
  setSessionMode,
  setCodexPolicy,
  getGitDiff,
  listenChatEvents,
  listenActivityEvents,
  listenDuoSnapshot,
  duoStartRun,
  duoRecordEvent,
  duoCompleteRun,
  duoAnalyze,
  duoLogCompletion,
} from "../lib/tauri-commands";
import { useSessionStore } from "./sessionStore";
import { handleChatEvent } from "../lib/event-handlers/chat";
import { useSettingsStore } from "./settingsStore";
import { DEFAULT_DUO_SETTINGS, type DuoCodingSettings } from "../types/settings";
import type { Message } from "../types/session";
import type { AgentId, FrontendEvent } from "../types/agent-events";
import {
  parseDuoVerdict,
  isBlockingVerdict,
  needsClarificationVerdict,
} from "../lib/duo-verdict";
import {
  buildReviewPrompt,
  buildRepairPrompt,
  buildReAskPrompt,
  buildDialogueToPrimaryPrompt,
  buildDialogueToDuoPrompt,
  buildPlanRequestPrompt,
  buildPlanReviewPrompt,
  buildImplementPrompt,
  buildPlanRevisePrompt,
  buildIncrementalReviewPrompt,
  buildNudgePrompt,
} from "../lib/duo-prompts";
import { classifyDrift, normalizeConcern, type ToolOp } from "../lib/duo-drift";
import type {
  DuoStatus,
  DuoPhase,
  DuoMentorMode,
  DuoConfig,
  DuoAgentConfig,
  DuoDialogueTurn,
  DuoVerdict,
  DuoMetrics,
  DuoEventKind,
  DuoEventActor,
  DuoDiffStats,
  DuoAnalystSnapshot,
  DuoRunRow,
  DuoEventRow,
  DuoSnapshotRow,
} from "../types/duo";

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export function resolveDuoSettings(): DuoCodingSettings {
  return useSettingsStore.getState().settings.duo ?? DEFAULT_DUO_SETTINGS;
}

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
    planGateEnabled: settings.planGateEnabled,
    liveReviewEnabled: settings.liveReviewEnabled,
    analystEnabled: settings.analystEnabled,
    analystProvider: settings.analystProvider,
    analystModel: settings.analystModel,
    budgetUsdCap: settings.budgetUsdCap,
    budgetTokenCap: settings.budgetTokenCap,
  };
}

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

/** Reconstruct run metrics by counting a persisted event log (for recovery). */
export function metricsFromEvents(events: DuoEventRow[]): DuoMetrics {
  const m = emptyDuoMetrics();
  for (const e of events) {
    switch (e.kind) {
      case "agreement":
        m.agreements += 1;
        m.reviews += 1;
        break;
      case "disagreement":
        m.disagreements += 1;
        m.reviews += 1;
        m.dialogueRounds += 1;
        break;
      case "concern":
        m.reviews += 1;
        break;
      case "repair":
        m.repairs += 1;
        break;
      case "drift":
        m.driftIncidents += 1;
        break;
      default:
        break;
    }
  }
  m.agreementRate = m.reviews > 0 ? m.agreements / m.reviews : 0;
  return m;
}

/**
 * Rebuild the conversation timeline from a persisted event log, so a run
 * reopened read-only after a restart still shows what was discussed and decided.
 * Mentor verdict events carry their result metadata in the payload (see
 * `verdictPayload`), so reviews reconstruct with their build/test result.
 */
export function timelineFromEvents(events: DuoEventRow[]): DuoDialogueTurn[] {
  const out: DuoDialogueTurn[] = [];
  let round = 1;
  for (const e of events) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(e.payloadJson) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const summary = typeof payload.summary === "string" ? payload.summary : "";
    const text = typeof payload.text === "string" ? payload.text : summary;
    const base = { id: e.id, round, ts: e.ts };

    const verdictFromPayload = (): DuoDialogueTurn["verdict"] | undefined => {
      if (typeof payload.stance !== "string") return undefined;
      return {
        stance: payload.stance as DuoVerdict["stance"],
        severity: (payload.severity as DuoVerdict["severity"]) ?? "advisory",
        confidence: typeof payload.confidence === "number" ? payload.confidence : 0,
        ranBuild: payload.ranBuild === true,
        ranTests: payload.ranTests === true,
        checkResults:
          typeof payload.checkResults === "string" ? payload.checkResults : undefined,
      };
    };

    switch (e.kind) {
      case "turn":
        out.push({ ...base, author: "primary", stance: "work", text: text || "(turn)" });
        break;
      case "dialogue":
        out.push({ ...base, author: "primary", stance: "defend", text: text || "(response)" });
        break;
      case "agreement":
      case "concern":
      case "disagreement":
        out.push({
          ...base,
          author: "duo",
          stance: "review",
          text: text || summary,
          verdict: verdictFromPayload(),
        });
        break;
      case "repair":
        round = typeof payload.round === "number" ? payload.round : round + 1;
        out.push({ ...base, round, author: "system", stance: "repair", text: summary });
        break;
      case "drift":
        out.push({ ...base, author: "system", stance: "drift", text: `Drift flagged: ${summary}` });
        break;
      case "escalation":
        out.push({
          ...base,
          author: "system",
          stance: summary.startsWith("Budget") ? "budget" : "decision",
          text: summary,
        });
        break;
      case "decision":
        out.push({
          ...base,
          author: "system",
          stance: summary.includes("Agreement reached") ? "resolve" : "decision",
          text: summary,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Everything an agent said after the marker message — "this turn's response". */
export function collectResponseSince(
  messages: Message[],
  markerId: string | null,
): string {
  if (!markerId) {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.content ?? "";
  }
  const idx = messages.findIndex((m) => m.id === markerId);
  if (idx < 0) {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.content ?? "";
  }
  return messages
    .slice(idx + 1)
    .filter((m) => m.role === "assistant" && m.content.trim() !== "")
    .map((m) => m.content)
    .join("\n\n");
}

/** Cap on prose stored per timeline entry / persisted event payload. */
const TIMELINE_TEXT_CAP = 1500;

// ── Tie-break blocker (drives DuoTieBreakModal) ──────────────────────────────

export interface DuoBlocker {
  kind: "duo-deadlock";
  summary: string;
  primaryPosition: string;
  duoPosition: string;
  repairTask: string | null;
}

interface DuoDecision {
  kind: DuoEventKind;
  summary: string;
  ts: number;
}

// ── Module-level listeners (one per session; not in store state) ─────────────

const listeners = new Map<string, UnlistenFn>();

/** Tool ops the primary has run in the CURRENT turn (for the drift watcher). */
let currentTurnOps: ToolOp[] = [];
/** Guard so a severe-drift nudge fires at most once per primary turn. */
let driftNudgedThisTurn = false;

// ── Continuous co-review (live mentor while the primary works) ───────────────
/** What the mentor is currently doing — routes its next turn_complete. null = free. */
let mentorMode: DuoMentorMode | null = null;
/** Mutating edits the primary has made since the last incremental review. */
let mutatingOpsSinceReview = 0;
/** Pending debounce timer for a pause-triggered incremental review. */
let incrementalTimer: ReturnType<typeof setTimeout> | null = null;
/** Epoch ms of the last incremental review (min-interval throttle). */
let lastReviewAt = 0;
/** Changes accrued while the mentor was busy — review again once it's free. */
let pendingIncremental = false;
/** The primary finished while the mentor was mid incremental review — run the
 *  final review as soon as the mentor is free. */
let finalReviewQueued = false;

// Cadence tuning (not CLI-derived — plain UX defaults, tunable later).
const LIVE_REVIEW_DEBOUNCE_MS = 9000; // pause length that triggers a review
const LIVE_REVIEW_OP_THRESHOLD = 5; // mutating edits since last review
const LIVE_REVIEW_MIN_INTERVAL_MS = 20000; // floor between reviews

function clearIncrementalTimer(): void {
  if (incrementalTimer) {
    clearTimeout(incrementalTimer);
    incrementalTimer = null;
  }
}

function detachListeners(): void {
  for (const un of listeners.values()) un();
  listeners.clear();
  currentTurnOps = [];
  driftNudgedThisTurn = false;
  analysisInFlight = false;
  mentorMode = null;
  mutatingOpsSinceReview = 0;
  pendingIncremental = false;
  finalReviewQueued = false;
  lastReviewAt = 0;
  clearIncrementalTimer();
}

/** Wire turn/activity/snapshot listeners for a (primary, duo) session pair. */
async function attachListeners(primaryId: string, duoId: string): Promise<void> {
  detachListeners();
  // Each chat listener BOTH feeds the normal chat pipeline (handleChatEvent →
  // sessionStore.sessionMessages/streaming, so the panes render live and
  // collectResponseSince sees real text) AND drives orchestration
  // (onSessionEvent reacts to turn_complete). duoStore is the sole owner of
  // these listeners for duoRole sessions (useClaudeSession's reconciler skips
  // them) so there's no duplicate-delta double-processing.
  listeners.set(
    primaryId,
    await listenChatEvents(primaryId, (e) => {
      handleChatEvent(primaryId, e);
      onSessionEvent("primary", e);
    }),
  );
  listeners.set(
    duoId,
    await listenChatEvents(duoId, (e) => {
      handleChatEvent(duoId, e);
      onSessionEvent("duo", e);
    }),
  );
  listeners.set(
    `${primaryId}:activity`,
    await listenActivityEvents(primaryId, onPrimaryActivity),
  );
  listeners.set(
    "duo:snapshot",
    await listenDuoSnapshot((payload) => {
      if (payload.runId !== useDuoStore.getState().runId) return;
      useDuoStore.setState({
        analystSnapshot: {
          narrative: payload.narrative,
          report: payload.report,
          series: payload.series,
        },
      });
    }),
  );
}

let idCounter = 0;
function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface DuoState {
  status: DuoStatus;
  phase: DuoPhase | null;
  runId: string | null;
  projectPath: string | null;
  task: string | null;
  startedAt: number | null;
  primarySessionId: string | null;
  duoSessionId: string | null;
  config: DuoConfig | null;

  dialogue: DuoDialogueTurn[];
  decisionLog: DuoDecision[];
  latestVerdict: DuoVerdict | null;
  metrics: DuoMetrics;
  /** Latest API-LLM analyst snapshot (qualitative report + numeric series). */
  analystSnapshot: DuoAnalystSnapshot | null;
  /** True for a run recovered read-only after a crash/restart (sessions gone). */
  interrupted: boolean;
  blocker: DuoBlocker | null;
  error: string | null;

  // Internal markers / counters.
  /** Dialogue/repair rounds used in the current unresolved exchange. */
  repairAttempts: number;
  /** Normalized mentor concerns raised this exchange — for ping-pong detection. */
  priorConcerns: string[];
  awaitingReAsk: boolean;
  tieBreakApplied: boolean;
  lastPrimaryPromptId: string | null;
  lastDuoPromptId: string | null;

  // Actions.
  start: (params: {
    task: string;
    projectPath: string;
    primary: DuoAgentConfig;
    duo: DuoAgentConfig;
  }) => Promise<void>;
  /** Apply a tie-break choice when status is paused on a deadlock. */
  resolveTieBreak: (choice: "mentorWins" | "primaryWins") => Promise<void>;
  /** User-initiated suspend: stops observing turns; sessions keep their state. */
  pause: () => void;
  /** Resume a user-paused run (not valid while a tie-break blocker is open). */
  resume: () => Promise<void>;
  /** Terminate the run and tear down both spawned sessions. */
  stop: (outcome?: string) => Promise<void>;
  /** Load a crash-interrupted run read-only (no live sessions to re-attach). */
  hydrateInterrupted: (params: {
    run: DuoRunRow;
    snapshot: DuoSnapshotRow | null;
    events: DuoEventRow[];
  }) => void;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as DuoStatus,
  phase: null as DuoPhase | null,
  runId: null,
  projectPath: null,
  task: null,
  startedAt: null,
  primarySessionId: null,
  duoSessionId: null,
  config: null,
  dialogue: [] as DuoDialogueTurn[],
  decisionLog: [] as DuoDecision[],
  latestVerdict: null,
  metrics: emptyDuoMetrics(),
  analystSnapshot: null,
  interrupted: false,
  blocker: null,
  error: null,
  repairAttempts: 0,
  priorConcerns: [] as string[],
  awaitingReAsk: false,
  tieBreakApplied: false,
  lastPrimaryPromptId: null,
  lastDuoPromptId: null,
};

export const useDuoStore = create<DuoState>((set, get) => ({
  ...INITIAL,

  start: async ({ task, projectPath, primary, duo }) => {
    const config = buildDuoConfig(primary, duo);
    const runId = genId("duo-run");
    try {
      // Spawn both sessions. The mentor is locked read-only before any work.
      const primarySession = await createSession(
        projectPath,
        "Duo · Primary",
        undefined,
        primary.agentId,
      );
      const duoSession = await createSession(
        projectPath,
        "Duo · Mentor",
        undefined,
        duo.agentId,
      );
      await setReadOnly(duoSession.id, duo.agentId);

      // Register both as background sessions so their chat streams into
      // sessionStore (renders in the split panes AND feeds the orchestrator's
      // collectResponseSince) — without polluting the tab bar or stealing focus.
      const sessionStore = useSessionStore.getState();
      sessionStore.registerBackgroundSession({ ...primarySession, duoRole: "primary" });
      sessionStore.registerBackgroundSession({ ...duoSession, duoRole: "mentor" });

      // Persist the task alongside the config so the backend analyst (which
      // reads `config_json.task`) and restart-recovery can recover it.
      await duoStartRun(
        runId,
        primarySession.id,
        duoSession.id,
        projectPath,
        JSON.stringify({ ...config, task }),
      );

      set({
        ...INITIAL,
        metrics: emptyDuoMetrics(),
        status: "running",
        phase: config.planGateEnabled ? "planning" : "building",
        runId,
        projectPath,
        task,
        startedAt: Date.now(),
        primarySessionId: primarySession.id,
        duoSessionId: duoSession.id,
        config,
      });

      await attachListeners(primarySession.id, duoSession.id);

      appendDialogue("system", "decision", `Run started — task: ${task}`);
      recordEvent("decision", "system", "Duo run started");
      // Plan gate: ask the primary for a plan first; otherwise go straight to work.
      if (config.planGateEnabled) {
        appendDialogue("system", "decision", "Plan gate: primary drafting an approach for mentor review.");
        await injectTo(primarySession.id, buildPlanRequestPrompt(task, primary.agentId), "primary");
      } else {
        await injectTo(primarySession.id, task, "primary");
      }
    } catch (err) {
      detachListeners();
      set({ status: "idle", error: `Failed to start Duo run: ${String(err)}` });
    }
  },

  resolveTieBreak: async (choice) => {
    const s = get();
    if (s.status !== "paused" || !s.blocker) return;
    if (choice === "mentorWins") {
      appendDialogue("system", "decision", "Tie-break: mentor wins — primary must comply.");
      recordEvent("decision", "system", "Tie-break: mentor wins");
      set({ status: "running", phase: "repairing", blocker: null, tieBreakApplied: true });
      const repair = s.blocker.repairTask ?? s.blocker.duoPosition;
      if (s.primarySessionId && s.config) {
        await injectTo(
          s.primarySessionId,
          buildRepairPrompt({
            repairTask: repair,
            rationale: s.blocker.duoPosition,
            agentId: s.config.primary.agentId,
          }),
          "primary",
        );
      }
    } else {
      appendDialogue("system", "decision", "Tie-break: primary proceeds — mentor's dissent logged.");
      recordEvent("decision", "system", "Tie-break: primary proceeds");
      set({
        status: "running",
        phase: "building",
        blocker: null,
        repairAttempts: 0,
        tieBreakApplied: false,
      });
    }
  },

  pause: () => {
    const s = get();
    if (s.status !== "running") return;
    detachListeners();
    recordEvent("decision", "system", "Run paused by user");
    useDuoStore.setState({ status: "paused" });
  },

  resume: async () => {
    const s = get();
    // A tie-break blocker must be resolved via resolveTieBreak, not resume.
    if (s.status !== "paused" || s.blocker || !s.primarySessionId || !s.duoSessionId) {
      return;
    }
    await attachListeners(s.primarySessionId, s.duoSessionId);
    recordEvent("decision", "system", "Run resumed by user");
    useDuoStore.setState({ status: "running" });
  },

  stop: async (outcome = "stopped") => {
    const s = get();
    detachListeners();
    if (s.status === "running" || s.status === "paused") {
      appendDialogue("system", "decision", `Run stopped (${outcome}).`);
    }
    if (s.runId) {
      await duoCompleteRun(s.runId, "completed", outcome).catch(() => {});
      // Write a project-progress (changelog) entry summarizing the run.
      await duoLogCompletion(s.runId, outcome).catch(() => {});
    }
    // Tear down the spawned sessions (best-effort) + drop their store state.
    for (const id of [s.primarySessionId, s.duoSessionId]) {
      if (id) {
        await closeSession(id).catch(() => {});
        useSessionStore.getState().removeBackgroundSession(id);
      }
    }
    set({ status: "completed", phase: "completed" });
  },

  hydrateInterrupted: ({ run, snapshot, events }) => {
    detachListeners();
    let config: DuoConfig | null = null;
    let task: string | null = null;
    try {
      const parsed = JSON.parse(run.configJson) as DuoConfig & { task?: string };
      config = parsed;
      task = parsed.task ?? null;
    } catch {
      // Keep config/task null if the persisted JSON is unreadable.
    }
    let analystSnapshot: DuoAnalystSnapshot | null = null;
    if (snapshot) {
      try {
        analystSnapshot = {
          narrative: snapshot.narrative,
          report: JSON.parse(snapshot.metricsJson),
          series: JSON.parse(snapshot.seriesJson),
        };
      } catch {
        analystSnapshot = null;
      }
    }
    set({
      ...INITIAL,
      status: "paused",
      phase: "escalated",
      interrupted: true,
      runId: run.id,
      projectPath: run.projectPath,
      task,
      startedAt: run.createdAt,
      config,
      metrics: metricsFromEvents(events),
      dialogue: timelineFromEvents(events),
      analystSnapshot,
    });
  },

  reset: () => {
    detachListeners();
    // Drop any still-registered background sessions (e.g. reset without stop).
    const s = get();
    const store = useSessionStore.getState();
    for (const id of [s.primarySessionId, s.duoSessionId]) {
      if (id) store.removeBackgroundSession(id);
    }
    set({ ...INITIAL, metrics: emptyDuoMetrics() });
  },
}));

// ── Read-only mentor lock ─────────────────────────────────────────────────────

async function setReadOnly(sessionId: string, agentId: AgentId): Promise<void> {
  if (agentId === "codex") {
    await setCodexPolicy(sessionId, {
      sandbox: "read-only",
      approval: "never",
      network_access: false,
    });
  } else {
    await setSessionMode(sessionId, "plan");
  }
}

// ── Injection (the human-equivalent send path) ───────────────────────────────

async function injectTo(
  sessionId: string,
  prompt: string,
  role: "primary" | "duo",
  opts: { isTurnStart?: boolean } = {},
): Promise<void> {
  const isTurnStart = opts.isTurnStart ?? true;
  const msgId = genId(`duo-${role}`);
  const msg: Message = {
    id: msgId,
    role: "user",
    content: prompt,
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: false,
    isSelfDrive: true, // injected, not human-typed — hide from "user activity" scans
  };
  useSessionStore.getState().addMessage(sessionId, msg);
  if (role === "primary") {
    // Only a real turn-start moves the marker / resets the per-turn accumulators.
    // Mid-turn nudges (isTurnStart:false) leave them so the final review still
    // sees the WHOLE turn (collectResponseSince filters to assistant text, so
    // the interleaved nudge user-message is skipped).
    if (isTurnStart) {
      useDuoStore.setState({ lastPrimaryPromptId: msgId });
      currentTurnOps = [];
      driftNudgedThisTurn = false;
      mutatingOpsSinceReview = 0;
      clearIncrementalTimer();
    }
  } else {
    useDuoStore.setState({ lastDuoPromptId: msgId });
  }
  useSessionStore.getState().setSessionBusy(sessionId, true);
  await sendMessage(sessionId, prompt);
}

// ── Event log ─────────────────────────────────────────────────────────────────

function recordEvent(
  kind: DuoEventKind,
  actor: DuoEventActor,
  summary: string,
  payload: Record<string, unknown> = {},
  diffStats?: DuoDiffStats,
): void {
  const ts = Date.now();
  useDuoStore.setState((s) => ({
    decisionLog: [...s.decisionLog, { kind, summary, ts }],
  }));
  const runId = useDuoStore.getState().runId;
  if (runId) {
    void duoRecordEvent(
      genId("duo-evt"),
      runId,
      kind,
      actor,
      JSON.stringify({ summary, ...payload }),
      diffStats ? JSON.stringify(diffStats) : undefined,
    ).catch(() => {});
  }
}

/**
 * Kick the backend analyst for the current run. Fire-and-forget: the fresh
 * snapshot arrives via the `duo:snapshot` listener. Debounced so a burst of
 * events triggers at most one in-flight analysis at a time.
 */
let analysisInFlight = false;
function triggerAnalysis(): void {
  const s = useDuoStore.getState();
  if (!s.runId || !s.config?.analystEnabled || analysisInFlight) return;
  analysisInFlight = true;
  void duoAnalyze(s.runId)
    .catch(() => {
      // Non-fatal: the dashboard simply keeps the previous snapshot.
    })
    .finally(() => {
      analysisInFlight = false;
    });
}

function bumpMetrics(patch: Partial<DuoMetrics>): void {
  useDuoStore.setState((s) => {
    const m = { ...s.metrics, ...patch };
    m.agreementRate = m.reviews > 0 ? m.agreements / m.reviews : 0;
    return { metrics: m };
  });
}

// ── Turn-boundary dispatch ────────────────────────────────────────────────────

function onSessionEvent(role: "primary" | "duo", event: FrontendEvent): void {
  if (event.type !== "turn_complete") return;
  // Both sessions' turns count toward the run's cost/token budget.
  const cost = typeof event.cost_usd === "number" ? event.cost_usd : 0;
  const out =
    event.usage && typeof event.usage.output_tokens === "number"
      ? event.usage.output_tokens
      : 0;
  if (cost || out) {
    bumpMetrics({
      costUsd: useDuoStore.getState().metrics.costUsd + cost,
      outputTokens: useDuoStore.getState().metrics.outputTokens + out,
    });
  }
  const s = useDuoStore.getState();

  if (role === "duo") {
    if (s.status !== "running") return;
    // Route the mentor's turn by what we asked it to do.
    if (mentorMode === "plan") void handleDuoPlanComplete();
    else if (mentorMode === "incremental") void handleDuoIncrementalComplete();
    else void handleDuoTurnComplete(); // "final" | "dialogue"
    return;
  }

  // role === "primary"
  if (s.status === "completed") {
    // The user guided the primary again after the run converged — reopen the
    // loop and review the new work. Re-anchor the turn marker to the user's
    // latest message and reset per-turn accumulators.
    const msgs = useSessionStore.getState().sessionMessages.get(s.primarySessionId ?? "") ?? [];
    currentTurnOps = [];
    driftNudgedThisTurn = false;
    mutatingOpsSinceReview = 0;
    useDuoStore.setState({
      status: "running",
      phase: "building",
      lastPrimaryPromptId: lastUserMessageId(msgs),
    });
    void handlePrimaryTurnComplete();
    return;
  }
  if (s.status !== "running") return;
  void handlePrimaryTurnComplete();
}

/** The id of the most recent user message in a transcript (turn boundary). */
function lastUserMessageId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].id;
  }
  return null;
}

/** Phases during which the primary is actively coding (live co-review applies). */
function isCoReviewPhase(phase: DuoPhase | null): boolean {
  return phase === "building" || phase === "repairing" || phase === "dialoguing";
}

const MUTATING_TOOL_RE = /write|edit|create|update|delete|patch|apply/i;
const CHECKPOINT_CMD_RE = /\b(test|build|tsc|lint|check|vitest|jest|cargo|pytest|eslint)\b/i;

/**
 * Mid-turn watcher: feeds BOTH the cheap drift heuristic (instant destructive-op
 * nudge) and the continuous co-review scheduler (mentor reviews the diff-so-far
 * at checkpoints / after a batch of edits / on pause).
 */
function onPrimaryActivity(event: FrontendEvent): void {
  if (event.type !== "tool_use_start") return;
  const s = useDuoStore.getState();
  if (s.status !== "running" || !s.config || !s.primarySessionId) return;

  currentTurnOps.push({ toolName: event.tool_name, input: event.tool_input });

  // (1) Drift heuristic — instant nudge on a severe/destructive op.
  if (!driftNudgedThisTurn) {
    const signal = classifyDrift(currentTurnOps, s.config.severeDriftSensitivity);
    if (signal.severe) {
      driftNudgedThisTurn = true;
      bumpMetrics({ driftIncidents: useDuoStore.getState().metrics.driftIncidents + 1 });
      const driftText = signal.reason ?? "Severe drift detected";
      appendDialogue("system", "drift", `Drift flagged: ${driftText}`);
      recordEvent("drift", "duo", driftText);
      if (s.config.severeDriftNudgeEnabled) {
        void injectTo(
          s.primarySessionId,
          `Heads up from your Duo mentor: this looks like it's going off-track — ${signal.reason}. Pause and reconsider before continuing.`,
          "primary",
          { isTurnStart: false },
        );
      }
    }
  }

  // (2) Continuous co-review scheduling (independent of drift).
  if (!s.config.liveReviewEnabled || !isCoReviewPhase(s.phase)) return;
  const cmd = String((event.tool_input as Record<string, unknown>)?.command ?? "");
  const isCheckpoint = event.tool_name === "Bash" && CHECKPOINT_CMD_RE.test(cmd);
  const isMutating = MUTATING_TOOL_RE.test(event.tool_name);
  if (isMutating) mutatingOpsSinceReview += 1;

  if (isCheckpoint || mutatingOpsSinceReview >= LIVE_REVIEW_OP_THRESHOLD) {
    void maybeTriggerIncrementalReview(isCheckpoint);
  } else if (isMutating) {
    // Arm a pause-debounce: review if the primary goes quiet after editing.
    clearIncrementalTimer();
    incrementalTimer = setTimeout(() => void maybeTriggerIncrementalReview(false), LIVE_REVIEW_DEBOUNCE_MS);
  }
}

/** Trigger an incremental review if the mentor is free, throttle/budget allow. */
async function maybeTriggerIncrementalReview(isCheckpoint: boolean): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.config?.liveReviewEnabled || s.status !== "running" || !s.duoSessionId) return;
  if (!isCoReviewPhase(s.phase)) return;
  if (mentorMode !== null || isOverBudget(s.metrics, s.config)) {
    pendingIncremental = true; // mentor busy / over budget → revisit when free
    return;
  }
  if (!isCheckpoint && Date.now() - lastReviewAt < LIVE_REVIEW_MIN_INTERVAL_MS) {
    pendingIncremental = true;
    clearIncrementalTimer();
    incrementalTimer = setTimeout(() => void maybeTriggerIncrementalReview(false), LIVE_REVIEW_MIN_INTERVAL_MS);
    return;
  }
  await triggerIncrementalReview();
}

async function triggerIncrementalReview(): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.duoSessionId || !s.config || !s.task) return;
  clearIncrementalTimer();
  mutatingOpsSinceReview = 0;
  pendingIncremental = false;
  lastReviewAt = Date.now();

  let diff = "";
  try {
    diff = (await getGitDiff(s.projectPath ?? "")).diff;
  } catch {
    // Non-fatal: skip this incremental review if we can't read the diff.
  }
  if (!diff.trim()) return; // nothing concrete to review yet

  mentorMode = "incremental";
  await injectTo(
    s.duoSessionId,
    buildIncrementalReviewPrompt({ task: s.task, diff, agentId: s.config.duo.agentId }),
    "duo",
  );
}

/** Whether the run has exceeded either configured budget cap. */
export function isOverBudget(
  metrics: DuoMetrics,
  config: DuoConfig | null,
): boolean {
  if (!config) return false;
  if (config.budgetUsdCap !== null && metrics.costUsd >= config.budgetUsdCap) {
    return true;
  }
  if (
    config.budgetTokenCap !== null &&
    metrics.outputTokens >= config.budgetTokenCap
  ) {
    return true;
  }
  return false;
}

/** Pause the run on a budget blocker if a cap is exceeded. Returns true if it paused. */
function pauseIfOverBudget(): boolean {
  const s = useDuoStore.getState();
  if (!isOverBudget(s.metrics, s.config)) return false;
  detachListeners();
  appendDialogue("system", "budget", "Budget cap reached — run paused.");
  recordEvent("escalation", "system", "Budget cap reached — run paused");
  useDuoStore.setState({
    status: "paused",
    phase: "escalated",
    blocker: {
      kind: "duo-deadlock",
      summary: `Budget cap reached ($${s.metrics.costUsd.toFixed(2)}, ${s.metrics.outputTokens} tokens)`,
      primaryPosition: "Run halted to respect the configured budget.",
      duoPosition: "Raise or clear the budget cap to continue.",
      repairTask: null,
    },
  });
  return true;
}

async function handlePrimaryTurnComplete(): Promise<void> {
  if (pauseIfOverBudget()) return;
  const s = useDuoStore.getState();
  if (!s.primarySessionId || !s.duoSessionId || !s.config || !s.task) return;

  const messages =
    useSessionStore.getState().sessionMessages.get(s.primarySessionId) ?? [];
  const primaryResponse = collectResponseSince(messages, s.lastPrimaryPromptId);

  // (A) Plan gate: the primary produced its PLAN → mentor reviews the approach.
  if (s.phase === "planning") {
    appendDialogue("primary", "work", primaryResponse || "(no plan text)");
    recordEvent("turn", "primary", "Primary proposed a plan", {
      text: primaryResponse.slice(0, TIMELINE_TEXT_CAP),
    });
    useDuoStore.setState({ phase: "reviewing", awaitingReAsk: false });
    mentorMode = "plan";
    await injectTo(
      s.duoSessionId,
      buildPlanReviewPrompt({ task: s.task, plan: primaryResponse, agentId: s.config.duo.agentId }),
      "duo",
    );
    return;
  }

  // (B) Open dialogue: the primary's turn is its RESPONSE to a mentor concern —
  // hand it back to the mentor to re-judge, no fresh diff review.
  if (s.phase === "dialoguing") {
    appendDialogue("primary", "defend", primaryResponse);
    recordEvent("dialogue", "primary", "Primary responded to the mentor", {
      text: primaryResponse.slice(0, TIMELINE_TEXT_CAP),
    });
    useDuoStore.setState({ phase: "reviewing", awaitingReAsk: false });
    mentorMode = "dialogue";
    await injectTo(
      s.duoSessionId,
      buildDialogueToDuoPrompt({
        primaryResponse,
        round: s.repairAttempts,
        agentId: s.config.duo.agentId,
      }),
      "duo",
    );
    return;
  }

  // (C) Fresh build / post-repair turn → thorough final review. If the mentor is
  // mid incremental review, queue it and let that handler run the final review.
  clearIncrementalTimer();
  if (mentorMode !== null) {
    finalReviewQueued = true;
    return;
  }
  await runFinalReview();
}

/** Inject the end-of-turn (final) diff-anchored review to the mentor. */
async function runFinalReview(): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.primarySessionId || !s.duoSessionId || !s.config || !s.task) return;
  const messages =
    useSessionStore.getState().sessionMessages.get(s.primarySessionId) ?? [];
  const primaryResponse = collectResponseSince(messages, s.lastPrimaryPromptId);

  let diffText = "";
  let diffStats: DuoDiffStats | undefined;
  try {
    const d = await getGitDiff(s.projectPath ?? "");
    diffText = d.diff;
    diffStats = { added: d.added, removed: d.removed, files: d.files };
  } catch {
    // Non-fatal: review proceeds on the response alone.
  }

  appendDialogue("primary", "work", primaryResponse || "(no textual response)");
  recordEvent("turn", "primary", "Primary completed a turn", {
    text: primaryResponse.slice(0, TIMELINE_TEXT_CAP),
  }, diffStats);
  useDuoStore.setState({ phase: "reviewing", awaitingReAsk: false });

  mentorMode = "final";
  await injectTo(
    s.duoSessionId,
    buildReviewPrompt({
      task: s.task,
      primaryResponse,
      diff: diffText,
      toolsUsed: [],
      agentId: s.config.duo.agentId,
    }),
    "duo",
  );
}

async function handleDuoTurnComplete(): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.duoSessionId || !s.config) return;

  const messages =
    useSessionStore.getState().sessionMessages.get(s.duoSessionId) ?? [];
  const duoResponse = collectResponseSince(messages, s.lastDuoPromptId);

  const parsed = parseDuoVerdict(duoResponse);
  if (!parsed.ok) {
    if (!s.awaitingReAsk) {
      // One re-ask before degrading.
      useDuoStore.setState({ awaitingReAsk: true });
      await injectTo(s.duoSessionId, buildReAskPrompt(), "duo");
      return;
    }
    await executeVerdict(needsClarificationVerdict(duoResponse));
    return;
  }
  useDuoStore.setState({ awaitingReAsk: false });
  mentorMode = null; // mentor produced a final verdict → it's free again
  await executeVerdict(parsed.verdict);
}

/** Mentor finished reviewing the PLAN (plan gate). Approve → build; else revise. */
async function handleDuoPlanComplete(): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.duoSessionId || !s.primarySessionId || !s.config) return;
  const messages = useSessionStore.getState().sessionMessages.get(s.duoSessionId) ?? [];
  const duoResponse = collectResponseSince(messages, s.lastDuoPromptId);

  const parsed = parseDuoVerdict(duoResponse);
  if (!parsed.ok) {
    if (!s.awaitingReAsk) {
      useDuoStore.setState({ awaitingReAsk: true });
      await injectTo(s.duoSessionId, buildReAskPrompt(), "duo"); // stays mode "plan"
      return;
    }
  }
  useDuoStore.setState({ awaitingReAsk: false });
  mentorMode = null;
  const verdict = parsed.ok ? parsed.verdict : needsClarificationVerdict(duoResponse);
  triggerAnalysis();
  appendDialogue(
    "duo",
    "review",
    verdict.rationale ? `${verdict.summary}\n\n${verdict.rationale}` : verdict.summary,
    toDialogueVerdict(verdict),
  );

  if (verdict.stance === "agree") {
    appendDialogue("system", "decision", "Plan approved — primary implementing.");
    recordEvent("decision", "duo", "Plan approved", verdictPayload(verdict));
    useDuoStore.setState({ phase: "building", repairAttempts: 0, priorConcerns: [] });
    await injectTo(s.primarySessionId, buildImplementPrompt(s.config.primary.agentId), "primary");
    return;
  }

  // Plan needs changes — bounded by maxDialogueRounds, then tie-break.
  recordEvent("disagreement", "duo", verdict.summary, verdictPayload(verdict));
  const round = s.repairAttempts;
  if (!s.tieBreakApplied && round >= s.config.maxDialogueRounds) {
    await applyTieBreak(verdict, "rounds-exhausted");
    return;
  }
  appendDialogue("system", "repair", `Mentor requested plan changes (round ${round + 1}).`);
  useDuoStore.setState({ phase: "planning", repairAttempts: round + 1 });
  await injectTo(
    s.primarySessionId,
    buildPlanRevisePrompt({
      feedback: verdict.repairTask ?? verdict.summary,
      rationale: verdict.rationale,
      agentId: s.config.primary.agentId,
    }),
    "primary",
  );
}

/** Mentor finished a live (incremental) review. Clear defect → interleave a
 *  nudge to the primary; otherwise just log. Never completes / counts a round. */
async function handleDuoIncrementalComplete(): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.duoSessionId || !s.primarySessionId || !s.config) {
    mentorMode = null;
    return;
  }
  const messages = useSessionStore.getState().sessionMessages.get(s.duoSessionId) ?? [];
  const duoResponse = collectResponseSince(messages, s.lastDuoPromptId);
  mentorMode = null; // mentor is free again

  const parsed = parseDuoVerdict(duoResponse);
  if (parsed.ok) {
    const v = parsed.verdict;
    appendDialogue(
      "duo",
      "review",
      v.rationale ? `${v.summary}\n\n${v.rationale}` : v.summary,
      toDialogueVerdict(v),
    );
    recordEvent("concern", "duo", `Live review: ${v.summary}`, verdictPayload(v));
    if (isBlockingVerdict(v) && v.repairTask) {
      // Interleave a concise nudge — primary keeps working (not a new turn).
      bumpMetrics({ driftIncidents: useDuoStore.getState().metrics.driftIncidents });
      appendDialogue("system", "repair", `Live nudge → primary: ${v.repairTask}`);
      recordEvent("repair", "system", `Live nudge: ${v.repairTask}`);
      await injectTo(
        s.primarySessionId,
        buildNudgePrompt(v.repairTask, s.config.primary.agentId),
        "primary",
        { isTurnStart: false },
      );
    }
  }

  // The primary finished while we were reviewing → run the final review now.
  if (finalReviewQueued) {
    finalReviewQueued = false;
    await runFinalReview();
    return;
  }
  // Otherwise, if changes accrued during the review, schedule another pass.
  if (pendingIncremental || mutatingOpsSinceReview > 0) {
    clearIncrementalTimer();
    incrementalTimer = setTimeout(() => void maybeTriggerIncrementalReview(false), 1500);
  }
}

/** Autonomous, successful completion (mentor approved). Unlike `stop`, this
 *  keeps the sessions alive so the user can keep guiding the primary. */
function completeRun(outcome: string): void {
  clearIncrementalTimer();
  mentorMode = null;
  appendDialogue("system", "resolve", "Mentor approved — task complete.");
  recordEvent("decision", "system", `Run complete — ${outcome}`);
  const runId = useDuoStore.getState().runId;
  if (runId) {
    void duoCompleteRun(runId, "completed", outcome).catch(() => {});
    void duoLogCompletion(runId, outcome).catch(() => {});
  }
  useDuoStore.setState({
    status: "completed",
    phase: "completed",
    repairAttempts: 0,
    priorConcerns: [],
    tieBreakApplied: false,
  });
}

/** Shape a mentor verdict into the timeline-entry verdict metadata. */
function toDialogueVerdict(v: DuoVerdict): DuoDialogueTurn["verdict"] {
  return {
    stance: v.stance,
    severity: v.severity,
    confidence: v.confidence,
    ranBuild: v.ranBuild,
    ranTests: v.ranTests,
    checkResults: v.checkResults,
  };
}

/** Payload extras persisted with a verdict event so the timeline rebuilds faithfully. */
function verdictPayload(v: DuoVerdict): Record<string, unknown> {
  return {
    text: (v.rationale || v.summary).slice(0, TIMELINE_TEXT_CAP),
    stance: v.stance,
    severity: v.severity,
    confidence: v.confidence,
    ranBuild: v.ranBuild,
    ranTests: v.ranTests,
    checkResults: v.checkResults?.slice(0, TIMELINE_TEXT_CAP),
  };
}

async function executeVerdict(verdict: DuoVerdict): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.primarySessionId || !s.config) return;
  useDuoStore.setState({ latestVerdict: verdict });
  bumpMetrics({ reviews: s.metrics.reviews + 1 });
  triggerAnalysis(); // refresh the dashboard analysis after each review

  // Every review enters the conversation timeline (not just blocking disputes),
  // carrying the verdict result so the dashboard shows what was decided.
  const reviewText = verdict.rationale
    ? `${verdict.summary}\n\n${verdict.rationale}`
    : verdict.summary;
  appendDialogue("duo", "review", reviewText, toDialogueVerdict(verdict));

  // Mentor approved (or only a trivial nit remains) → the task has CONVERGED.
  // Complete the run autonomously (no stall); the agree path is the only way a
  // run finishes on its own.
  if (verdict.stance === "agree" || (!isBlockingVerdict(verdict) && verdict.severity === "nit")) {
    recordEvent("agreement", "duo", verdict.summary, verdictPayload(verdict));
    bumpMetrics({ agreements: useDuoStore.getState().metrics.agreements + 1 });
    completeRun("mentor-approved");
    return;
  }

  // ANY remaining concern (blocking OR advisory) drives a fix turn so the
  // mentor's feedback always reaches the primary — this removes the old stall
  // where advisory verdicts were batched and the run idled forever.
  recordEvent("disagreement", "duo", verdict.summary, verdictPayload(verdict));
  bumpMetrics({
    disagreements: useDuoStore.getState().metrics.disagreements + 1,
    dialogueRounds: useDuoStore.getState().metrics.dialogueRounds + 1,
  });

  // Ping-pong: the mentor re-raised a concern it already raised this exchange.
  const norm = normalizeConcern(verdict.summary);
  const isRepeat = s.priorConcerns.includes(norm);
  useDuoStore.setState({ priorConcerns: [...s.priorConcerns, norm] });

  const round = s.repairAttempts;
  if (
    !s.tieBreakApplied &&
    (isRepeat || round >= s.config.maxDialogueRounds)
  ) {
    await applyTieBreak(verdict, isRepeat ? "ping-pong" : "rounds-exhausted");
    return;
  }

  // Mentor directs; primary responds (defends or fixes). Single writer.
  const repairText = `Mentor directed a repair (round ${round + 1}): ${verdict.repairTask ?? verdict.summary}`;
  appendDialogue("system", "repair", repairText);
  recordEvent("repair", "system", repairText, { round: round + 1 });
  bumpMetrics({ repairs: useDuoStore.getState().metrics.repairs + 1 });
  useDuoStore.setState({ phase: "dialoguing", repairAttempts: round + 1 });
  await injectTo(
    s.primarySessionId,
    buildDialogueToPrimaryPrompt({
      concern: verdict.repairTask ?? verdict.summary,
      rationale: verdict.rationale,
      round: round + 1,
      agentId: s.config.primary.agentId,
    }),
    "primary",
  );
}

async function applyTieBreak(
  verdict: DuoVerdict,
  reason: "ping-pong" | "rounds-exhausted",
): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.config) return;
  const policy = s.config.tieBreakPolicy;
  recordEvent("escalation", "system", `Non-convergence (${reason}) — tie-break: ${policy}`);

  const blocker: DuoBlocker = {
    kind: "duo-deadlock",
    summary: verdict.summary,
    primaryPosition: "Primary's latest implementation (see chat).",
    duoPosition: verdict.rationale || verdict.summary,
    repairTask: verdict.repairTask ?? null,
  };

  if (policy === "pause") {
    appendDialogue("system", "decision", "Couldn't converge — paused for your decision.");
    detachListeners();
    useDuoStore.setState({ status: "paused", phase: "escalated", blocker });
    return;
  }

  // Non-pause policies resolve immediately (one-shot; a further failure pauses).
  // Park in "paused" so resolveTieBreak's guard accepts the programmatic call.
  useDuoStore.setState({ status: "paused", phase: "escalated", blocker });
  await useDuoStore
    .getState()
    .resolveTieBreak(policy === "mentorWins" ? "mentorWins" : "primaryWins");
}

function appendDialogue(
  author: DuoDialogueTurn["author"],
  stance: DuoDialogueTurn["stance"],
  text: string,
  verdict?: DuoDialogueTurn["verdict"],
): void {
  useDuoStore.setState((s) => ({
    dialogue: [
      ...s.dialogue,
      {
        id: genId("duo-dlg"),
        round: s.repairAttempts + 1,
        author,
        stance,
        text: text.slice(0, TIMELINE_TEXT_CAP),
        ts: Date.now(),
        ...(verdict ? { verdict } : {}),
      },
    ],
  }));
}
