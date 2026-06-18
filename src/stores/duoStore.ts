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
  duoStartRun,
  duoRecordEvent,
  duoCompleteRun,
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
} from "../lib/duo-prompts";
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

function detachListeners(): void {
  for (const un of listeners.values()) un();
  listeners.clear();
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
  primarySessionId: string | null;
  duoSessionId: string | null;
  config: DuoConfig | null;

  dialogue: DuoDialogueTurn[];
  decisionLog: DuoDecision[];
  latestVerdict: DuoVerdict | null;
  metrics: DuoMetrics;
  blocker: DuoBlocker | null;
  error: string | null;

  // Internal markers / counters.
  repairAttempts: number;
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
  stop: (outcome?: string) => Promise<void>;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as DuoStatus,
  phase: null as DuoPhase | null,
  runId: null,
  projectPath: null,
  task: null,
  primarySessionId: null,
  duoSessionId: null,
  config: null,
  dialogue: [] as DuoDialogueTurn[],
  decisionLog: [] as DuoDecision[],
  latestVerdict: null,
  metrics: emptyDuoMetrics(),
  blocker: null,
  error: null,
  repairAttempts: 0,
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

      await duoStartRun(
        runId,
        primarySession.id,
        duoSession.id,
        projectPath,
        JSON.stringify(config),
      );

      set({
        ...INITIAL,
        metrics: emptyDuoMetrics(),
        status: "running",
        phase: "building",
        runId,
        projectPath,
        task,
        primarySessionId: primarySession.id,
        duoSessionId: duoSession.id,
        config,
      });

      detachListeners();
      listeners.set(
        primarySession.id,
        await listenChatEvents(primarySession.id, (e) =>
          onSessionEvent("primary", e),
        ),
      );
      listeners.set(
        duoSession.id,
        await listenChatEvents(duoSession.id, (e) => onSessionEvent("duo", e)),
      );

      // Kick off the primary with the task.
      await injectTo(primarySession.id, task, "primary");
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

  stop: async (outcome = "stopped") => {
    const s = get();
    detachListeners();
    if (s.runId) {
      await duoCompleteRun(s.runId, "completed", outcome).catch(() => {});
    }
    // Tear down the spawned sessions (best-effort).
    for (const id of [s.primarySessionId, s.duoSessionId]) {
      if (id) await closeSession(id).catch(() => {});
    }
    set({ status: "completed", phase: "completed" });
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
  if (role === "primary") useDuoStore.setState({ lastPrimaryPromptId: msgId });
  else useDuoStore.setState({ lastDuoPromptId: msgId });
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
  const s = useDuoStore.getState();
  if (s.status !== "running") return;
  if (role === "primary") void handlePrimaryTurnComplete();
  else void handleDuoTurnComplete();
}

async function handlePrimaryTurnComplete(): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.primarySessionId || !s.duoSessionId || !s.config || !s.task) return;

  const messages =
    useSessionStore.getState().sessionMessages.get(s.primarySessionId) ?? [];
  const primaryResponse = collectResponseSince(messages, s.lastPrimaryPromptId);

  // Diff-anchored review packet.
  let diffText = "";
  let diffStats: DuoDiffStats | undefined;
  try {
    const d = await getGitDiff(s.projectPath ?? "");
    diffText = d.diff;
    diffStats = { added: d.added, removed: d.removed, files: d.files };
  } catch {
    // Non-fatal: review proceeds on the response alone.
  }

  recordEvent("turn", "primary", "Primary completed a turn", {}, diffStats);
  useDuoStore.setState({ phase: "reviewing", awaitingReAsk: false });

  const reviewPrompt = buildReviewPrompt({
    task: s.task,
    primaryResponse,
    diff: diffText,
    toolsUsed: [],
    agentId: s.config.duo.agentId,
  });
  await injectTo(s.duoSessionId, reviewPrompt, "duo");
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

async function executeVerdict(verdict: DuoVerdict): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.primarySessionId || !s.config) return;
  useDuoStore.setState({ latestVerdict: verdict });
  bumpMetrics({ reviews: s.metrics.reviews + 1 });

  if (verdict.stance === "agree") {
    recordEvent("agreement", "duo", verdict.summary, { confidence: verdict.confidence });
    bumpMetrics({ agreements: useDuoStore.getState().metrics.agreements + 1 });
    useDuoStore.setState({ phase: "building", repairAttempts: 0, tieBreakApplied: false });
    return;
  }

  if (!isBlockingVerdict(verdict)) {
    // Advisory / nit — log, batch, don't interrupt the primary.
    recordEvent("concern", "duo", verdict.summary, { severity: verdict.severity });
    useDuoStore.setState({ phase: "building" });
    return;
  }

  // Blocking concern / disagreement.
  recordEvent("disagreement", "duo", verdict.summary, { severity: verdict.severity });
  bumpMetrics({ disagreements: useDuoStore.getState().metrics.disagreements + 1 });
  appendDialogue("duo", "propose", verdict.repairTask ?? verdict.rationale);

  const attempts = s.repairAttempts;
  if (attempts >= s.config.maxDialogueRounds && !s.tieBreakApplied) {
    await applyTieBreak(verdict);
    return;
  }

  // Mentor directs; primary fixes.
  recordEvent("repair", "system", "Injecting mentor repair into primary", {
    attempt: attempts + 1,
  });
  bumpMetrics({ repairs: useDuoStore.getState().metrics.repairs + 1 });
  useDuoStore.setState({ phase: "repairing", repairAttempts: attempts + 1 });
  await injectTo(
    s.primarySessionId,
    buildRepairPrompt({
      repairTask: verdict.repairTask ?? verdict.summary,
      rationale: verdict.rationale,
      agentId: s.config.primary.agentId,
    }),
    "primary",
  );
}

async function applyTieBreak(verdict: DuoVerdict): Promise<void> {
  const s = useDuoStore.getState();
  if (!s.config) return;
  const policy = s.config.tieBreakPolicy;
  recordEvent("escalation", "system", `Non-convergence — tie-break: ${policy}`);

  const blocker: DuoBlocker = {
    kind: "duo-deadlock",
    summary: verdict.summary,
    primaryPosition: "Primary's latest implementation (see chat).",
    duoPosition: verdict.rationale || verdict.summary,
    repairTask: verdict.repairTask ?? null,
  };

  if (policy === "pause") {
    detachListeners();
    useDuoStore.setState({ status: "paused", phase: "escalated", blocker });
    return;
  }

  // Non-pause policies resolve immediately (one-shot; a further failure pauses).
  useDuoStore.setState({ blocker });
  await useDuoStore
    .getState()
    .resolveTieBreak(policy === "mentorWins" ? "mentorWins" : "primaryWins");
}

function appendDialogue(
  author: DuoDialogueTurn["author"],
  stance: DuoDialogueTurn["stance"],
  text: string,
): void {
  useDuoStore.setState((s) => ({
    dialogue: [
      ...s.dialogue,
      {
        id: genId("duo-dlg"),
        round: s.repairAttempts + 1,
        author,
        stance,
        text,
        ts: Date.now(),
      },
    ],
  }));
}
