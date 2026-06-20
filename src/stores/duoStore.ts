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
} from "../lib/duo-prompts";
import { classifyDrift, normalizeConcern, type ToolOp } from "../lib/duo-drift";
import type {
  DuoStatus,
  DuoPhase,
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

function detachListeners(): void {
  for (const un of listeners.values()) un();
  listeners.clear();
  currentTurnOps = [];
  driftNudgedThisTurn = false;
  analysisInFlight = false;
}

/** Wire turn/activity/snapshot listeners for a (primary, duo) session pair. */
async function attachListeners(primaryId: string, duoId: string): Promise<void> {
  detachListeners();
  listeners.set(
    primaryId,
    await listenChatEvents(primaryId, (e) => onSessionEvent("primary", e)),
  );
  listeners.set(
    duoId,
    await listenChatEvents(duoId, (e) => onSessionEvent("duo", e)),
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
        phase: "building",
        runId,
        projectPath,
        task,
        startedAt: Date.now(),
        primarySessionId: primarySession.id,
        duoSessionId: duoSession.id,
        config,
      });

      await attachListeners(primarySession.id, duoSession.id);

      // Kick off the primary with the task.
      await injectTo(primarySession.id, task, "primary");
      appendDialogue("system", "decision", `Run started — task: ${task}`);
      recordEvent("decision", "system", "Duo run started");
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
    // Tear down the spawned sessions (best-effort).
    for (const id of [s.primarySessionId, s.duoSessionId]) {
      if (id) await closeSession(id).catch(() => {});
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
): Promise<void> {
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
    useDuoStore.setState({ lastPrimaryPromptId: msgId });
    // A fresh primary turn starts — reset the drift accumulator.
    currentTurnOps = [];
    driftNudgedThisTurn = false;
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
  if (s.status !== "running") return;
  if (role === "primary") void handlePrimaryTurnComplete();
  else void handleDuoTurnComplete();
}

/** Mid-turn drift watcher: accumulate the primary's tool ops and nudge on severe drift. */
function onPrimaryActivity(event: FrontendEvent): void {
  if (event.type !== "tool_use_start") return;
  const s = useDuoStore.getState();
  if (s.status !== "running" || !s.config || !s.primarySessionId) return;

  currentTurnOps.push({ toolName: event.tool_name, input: event.tool_input });
  if (driftNudgedThisTurn) return;

  const signal = classifyDrift(currentTurnOps, s.config.severeDriftSensitivity);
  if (!signal.severe) return;

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
    );
  }
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

  // In an open dialogue, the primary's turn is its RESPONSE to the mentor's
  // concern — hand it back to the mentor to re-judge, no fresh diff review.
  if (s.phase === "dialoguing") {
    appendDialogue("primary", "defend", primaryResponse);
    recordEvent("dialogue", "primary", "Primary responded to the mentor", {
      text: primaryResponse.slice(0, TIMELINE_TEXT_CAP),
    });
    useDuoStore.setState({ phase: "reviewing", awaitingReAsk: false });
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

  // Fresh build (or post-repair) turn → diff-anchored review.
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
  await executeVerdict(parsed.verdict);
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

  if (verdict.stance === "agree") {
    // Convergence — concern resolved (primary fixed it, or mentor conceded).
    recordEvent("agreement", "duo", verdict.summary, verdictPayload(verdict));
    bumpMetrics({ agreements: useDuoStore.getState().metrics.agreements + 1 });
    // If this ended an active dispute, mark the resolution as an outcome.
    if (s.repairAttempts > 0) {
      appendDialogue("system", "resolve", "Agreement reached — primary's work accepted.");
      recordEvent("decision", "system", "Agreement reached — primary's work accepted");
    }
    useDuoStore.setState({
      phase: "building",
      repairAttempts: 0,
      priorConcerns: [],
      tieBreakApplied: false,
    });
    return;
  }

  if (!isBlockingVerdict(verdict)) {
    // Advisory / nit — log, batch, don't interrupt the primary.
    recordEvent("concern", "duo", verdict.summary, verdictPayload(verdict));
    useDuoStore.setState({ phase: "building" });
    return;
  }

  // Blocking concern / disagreement — open or continue the dialogue.
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
