// ═══════════════════════════════════════════════════════════════════════
// Self-Drive Store — State machine + orchestration layer
// Manages autonomous guide execution: listens for events, calls AI
// orchestrator, sends messages, and advances through sessions.
// ═══════════════════════════════════════════════════════════════════════

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  SelfDriveStatus,
  SelfDrivePhase,
  SelfDriveConfig,
  OrchestratorDecision,
  RunLogEntry,
} from "../types/implementation-guide";
import type { FrontendEvent, TurnCompleteEvent, ProcessExitedEvent } from "../types/claude-events";
import type { SessionMode } from "../types/session";
import { useSessionStore } from "./sessionStore";
import { useGuideStore } from "./guideStore";
import { useSettingsStore } from "./settingsStore";
import { showToast } from "./toastStore";
import { sendMessage, syncSessionMode } from "../lib/tauri-commands";
import { callOrchestrator } from "../lib/self-drive-orchestrator";
import { buildSessionVerifyPrompt } from "../lib/guide-verify-prompt";
import {
  extractToolsFromTurn,
  truncateResponse,
  findCheckByLabel,
  getCurrentSessionPlan,
  getProjectTechStack,
  getBuildCommand,
  getTestCommand,
} from "../lib/self-drive-utils";

// ── Module-level listener handles ───────────────────────────────────

let chatEventUnlisten: UnlistenFn | null = null;
let activeSessionId: string | null = null;

// ── Store interface ─────────────────────────────────────────────────

interface SelfDriveState {
  status: SelfDriveStatus;
  currentSessionIndex: number | null;
  currentPhase: SelfDrivePhase | null;

  previousSessionMode: string | null;
  fixAttempt: number;
  maxFixAttempts: number;
  previousFixPrompts: string[];

  runLog: RunLogEntry[];

  startedAt: number | null;
  sessionStartedAt: number | null;
  pauseReason: string | null;

  config: SelfDriveConfig;

  // Actions
  start: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => void;
}

// ── Default config ──────────────────────────────────────────────────

function getConfigFromSettings(): SelfDriveConfig {
  const s = useSettingsStore.getState().settings;
  return {
    provider: s.selfDriveProvider,
    model: s.selfDriveModel,
    maxFixAttempts: s.selfDriveMaxFixAttempts,
    runTests: s.selfDriveRunTests,
    runBuildCheck: s.selfDriveRunBuildCheck,
    autoCommit: s.selfDriveAutoCommit,
  };
}

// ── Store ───────────────────────────────────────────────────────────

export const useSelfDriveStore = create<SelfDriveState>((set, get) => ({
  status: "idle",
  currentSessionIndex: null,
  currentPhase: null,
  previousSessionMode: null,
  fixAttempt: 0,
  maxFixAttempts: 3,
  previousFixPrompts: [],
  runLog: [],
  startedAt: null,
  sessionStartedAt: null,
  pauseReason: null,
  config: {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    maxFixAttempts: 3,
    runTests: true,
    runBuildCheck: true,
    autoCommit: false,
  },

  start: async () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) {
      showToast("No active Claude Code session", "error");
      return;
    }

    const guide = useGuideStore.getState().guide;
    if (!guide) {
      showToast("No guide loaded", "error");
      return;
    }

    const firstActive = guide.sessions.find((s) => s.status === "active");
    if (!firstActive) {
      showToast("No remaining sessions", "error");
      return;
    }

    // Validate API key
    const config = getConfigFromSettings();
    const apiKey = useSettingsStore.getState().settings.apiKeys[config.provider]?.trim();
    if (!apiKey) {
      showToast(`No API key for ${config.provider}. Configure in Settings > AI Providers.`, "error");
      return;
    }

    // Save current mode and switch to auto-accept
    const currentMode = useSessionStore.getState().sessionModes.get(sessionId) || "normal";
    activeSessionId = sessionId;

    set({
      status: "running",
      currentSessionIndex: firstActive.index,
      currentPhase: "preparing",
      previousSessionMode: currentMode,
      fixAttempt: 0,
      previousFixPrompts: [],
      runLog: [],
      startedAt: Date.now(),
      sessionStartedAt: Date.now(),
      pauseReason: null,
      config,
      maxFixAttempts: config.maxFixAttempts,
    });

    try {
      await syncSessionMode(sessionId, "auto-accept");
      useSessionStore.getState().setSessionMode(sessionId, "auto-accept");
    } catch (e) {
      console.warn("[Self-Drive] Failed to switch to auto-accept:", e);
    }

    // Start event listeners
    await startListeners(sessionId);

    addLogEntry(firstActive.index, "started", `Self-Drive started (${guide.sessions.filter((s) => s.status !== "done").length} sessions remaining)`);

    // Send first build prompt
    set({ currentPhase: "building" });
    addLogEntry(firstActive.index, "building", `Starting Session ${firstActive.index}: ${firstActive.name}`);

    try {
      await sendMessage(sessionId, firstActive.prompt);
      useGuideStore.getState().markPromptSent(firstActive.index);
    } catch (e) {
      handlePause(`Failed to send build prompt: ${e}`);
    }

    showToast(`Self-Drive started (${guide.sessions.filter((s) => s.status !== "done").length} sessions)`, "info");
  },

  resume: async () => {
    const state = get();
    if (state.status !== "paused") return;

    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) {
      showToast("No active session to resume", "error");
      return;
    }

    activeSessionId = sessionId;

    set({ status: "running", pauseReason: null });
    addLogEntry(state.currentSessionIndex ?? 0, "resumed", "Self-Drive resumed by user");

    // Re-start listeners
    await startListeners(sessionId);

    // Ensure auto-accept mode
    try {
      await syncSessionMode(sessionId, "auto-accept");
      useSessionStore.getState().setSessionMode(sessionId, "auto-accept");
    } catch { /* ignore */ }

    // Re-verify to evaluate after any manual fixes
    const phase = state.currentPhase;
    if (phase === "verifying" || phase === "fixing") {
      await handleVerify();
    } else if (phase === "building" || phase === "build-checking") {
      await handleBuildCheck({ action: "build_check", summary: "Re-checking after resume", confidence: "high" });
    } else {
      // Default: re-verify
      await handleVerify();
    }

    showToast("Self-Drive resumed", "info");
  },

  stop: async () => {
    const state = get();
    const sessionIdx = state.currentSessionIndex ?? 0;

    set({
      status: "idle",
      currentPhase: null,
      currentSessionIndex: null,
      pauseReason: null,
    });

    stopListeners();
    await restoreSessionMode();

    addLogEntry(sessionIdx, "stopped", "Self-Drive stopped by user");
    showToast("Self-Drive stopped. Mode restored.", "info");
  },

  pause: () => {
    handlePause("Paused by user");
  },
}));

// ── Event listeners ─────────────────────────────────────────────────

async function startListeners(sessionId: string): Promise<void> {
  stopListeners();

  // Listen on the session-specific channel — the backend emits ALL events
  // (turn_complete, process_exited, compacting_status, etc.) on claude-chat-{id}
  chatEventUnlisten = await listen<FrontendEvent>(`claude-chat-${sessionId}`, (event) => {
    const payload = event.payload;
    switch (payload.type) {
      case "turn_complete":
        handleTurnComplete(payload);
        break;
      case "process_exited":
        handleProcessCrash(payload);
        break;
      case "compacting_status": {
        const state = useSelfDriveStore.getState();
        addLogEntry(
          state.currentSessionIndex ?? 0,
          state.currentPhase ?? "building",
          payload.is_compacting ? "Context compacting..." : "Compaction complete",
        );
        break;
      }
    }
  });
}

function stopListeners(): void {
  chatEventUnlisten?.();
  chatEventUnlisten = null;
}

// ── Core event handler ──────────────────────────────────────────────

async function handleTurnComplete(payload: TurnCompleteEvent): Promise<void> {
  const state = useSelfDriveStore.getState();
  if (state.status !== "running") return;

  const sessionId = activeSessionId;
  if (!sessionId) return;

  // Gather Claude Code's response
  const messages = useSessionStore.getState().sessionMessages.get(sessionId) || [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const toolsUsed = extractToolsFromTurn(messages);

  const sessionPlan = getCurrentSessionPlan(state.currentSessionIndex!);
  if (!sessionPlan) {
    handlePause("Could not get session plan — guide may have been dismissed");
    return;
  }

  const guide = useGuideStore.getState().guide;
  if (!guide) {
    handlePause("Guide was dismissed during Self-Drive");
    return;
  }

  // Call the AI orchestrator
  useSelfDriveStore.setState({ currentPhase: "evaluating" });
  addLogEntry(state.currentSessionIndex!, "evaluating", "AI orchestrator evaluating...");

  const config = state.config;
  const apiKey = useSettingsStore.getState().settings.apiKeys[config.provider]?.trim();
  if (!apiKey) {
    handlePause(`No API key for ${config.provider}. Check Settings > AI Providers.`);
    return;
  }

  let decision: OrchestratorDecision;
  try {
    decision = await callOrchestrator(
      {
        currentPhase: mapPhaseForOrchestrator(state.currentPhase),
        sessionPlan,
        claudeCodeResponse: truncateResponse(lastAssistant?.content || "", 4000),
        claudeCodeToolsUsed: toolsUsed,
        turnDurationMs: payload.duration_ms || 0,
        fixAttempt: state.fixAttempt,
        maxFixAttempts: state.maxFixAttempts,
        previousFixPrompts: state.previousFixPrompts,
        techStack: getProjectTechStack(),
        testCommand: getTestCommand(),
        buildCommand: getBuildCommand(),
        specFilename: guide.specFilename,
        auditFilename: guide.auditFilename,
      },
      config.provider,
      apiKey,
      config.model,
    );
  } catch (err) {
    handlePause(`AI orchestrator error: ${err}. Check your API key and network.`);
    return;
  }

  addLogEntry(state.currentSessionIndex!, "decision", decision.summary, decision);

  // Low-confidence guard
  if (decision.confidence === "low") {
    handlePause(`Orchestrator is uncertain: ${decision.summary}. Review the conversation and Resume or Stop.`);
    return;
  }

  // Execute the decision (pass pre-evaluation phase so handleAdvance can
  // skip test/commit sub-phases that already ran this cycle)
  await executeDecision(decision, state.currentPhase);
}

function mapPhaseForOrchestrator(
  phase: SelfDrivePhase | null,
): "building" | "verifying" | "fixing" | "build-checking" | "testing" | "committing" {
  switch (phase) {
    case "building": return "building";
    case "verifying": return "verifying";
    case "fixing": return "fixing";
    case "build-checking": return "build-checking";
    case "testing": return "testing";
    case "committing": return "committing";
    case "evaluating": return "building"; // fallback
    default: return "building";
  }
}

// ── Decision execution ──────────────────────────────────────────────

async function executeDecision(decision: OrchestratorDecision, previousPhase?: SelfDrivePhase | null): Promise<void> {
  switch (decision.action) {
    case "advance":
      await handleAdvance(decision, previousPhase);
      break;
    case "verify":
      await handleVerify();
      break;
    case "fix":
      await handleFix(decision);
      break;
    case "build_check":
      await handleBuildCheck(decision);
      break;
    case "test":
      await handleTest(decision);
      break;
    case "commit":
      await handleCommit();
      break;
    case "pause":
      handlePause(decision.pauseReason || "Orchestrator requested pause");
      break;
    case "abort":
      handleAbort(decision.abortReason || "Critical failure");
      break;
  }
}

// ── Step handlers ───────────────────────────────────────────────────

async function handleAdvance(decision: OrchestratorDecision, previousPhase?: SelfDrivePhase | null): Promise<void> {
  const state = useSelfDriveStore.getState();
  const sessionIndex = state.currentSessionIndex!;

  // Mark verify checks based on AI's analysis
  if (decision.checkResults) {
    for (const result of decision.checkResults) {
      const check = findCheckByLabel(sessionIndex, result.label);
      if (check && result.passed && !check.checked) {
        useGuideStore.getState().toggleVerifyCheck(sessionIndex, check.id);
      }
    }
  }

  // Mark session complete
  const completed = useGuideStore.getState().markSessionComplete(sessionIndex);
  if (!completed) {
    // First advance call toggles checks above; if markSessionComplete still
    // fails, some verify checks weren't matched. Pause for human review.
    const alreadyDone = useGuideStore.getState().guide?.sessions
      .find((s) => s.index === sessionIndex)?.status === "done";
    if (!alreadyDone) {
      handlePause(`Could not mark Session ${sessionIndex} complete — some verify checks may not have matched`);
      return;
    }
  }
  addLogEntry(sessionIndex, "advancing", `Session ${sessionIndex} complete`);
  showToast(`Session ${sessionIndex} verified`, "success");

  // Optional: run tests between sessions (skip if coming from test/commit phase)
  if (state.config.runTests && getTestCommand() && previousPhase !== "testing" && previousPhase !== "committing") {
    useSelfDriveStore.setState({ currentPhase: "testing" });
    addLogEntry(sessionIndex, "testing", `Running test suite: ${getTestCommand()}`);
    await sendMessageToSession(`Run the test suite: ${getTestCommand()}. Report which tests pass and which fail.`);
    return; // wait for turn_complete → orchestrator evaluates
  }

  // Optional: git commit between sessions (skip if coming from commit phase)
  if (state.config.autoCommit && previousPhase !== "committing") {
    useSelfDriveStore.setState({ currentPhase: "committing" });
    const plan = getCurrentSessionPlan(sessionIndex);
    addLogEntry(sessionIndex, "committing", `Committing Session ${sessionIndex}`);
    await sendMessageToSession(
      `Commit the current changes with message: "Session ${sessionIndex}: ${plan?.name ?? "implementation"}"`,
    );
    return; // wait for turn_complete → then advance
  }

  // Move to next session
  await startNextSession();
}

async function handleVerify(): Promise<void> {
  const state = useSelfDriveStore.getState();
  const sessionIndex = state.currentSessionIndex!;
  const guide = useGuideStore.getState().guide;
  if (!guide) return;

  const session = guide.sessions.find((s) => s.index === sessionIndex);
  if (!session) return;

  useSelfDriveStore.setState({ currentPhase: "verifying" });
  addLogEntry(sessionIndex, "verifying", `Verifying Session ${sessionIndex}`);

  const verifyPrompt = buildSessionVerifyPrompt(session, guide.specFilename, guide.auditFilename);
  await sendMessageToSession(verifyPrompt);
  useGuideStore.getState().markVerifyRequested(sessionIndex);
}

async function handleFix(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  const fixAttempt = state.fixAttempt + 1;

  if (fixAttempt > state.maxFixAttempts) {
    handlePause(`Max fix attempts (${state.maxFixAttempts}) reached. Remaining issues need manual attention.`);
    return;
  }

  useSelfDriveStore.setState({
    currentPhase: "fixing",
    fixAttempt,
    previousFixPrompts: [...state.previousFixPrompts, decision.fixPrompt || ""],
  });

  addLogEntry(
    state.currentSessionIndex!,
    "fixing",
    `Fix attempt ${fixAttempt}/${state.maxFixAttempts}: ${decision.summary}`,
  );

  showToast(`Fix applied, re-checking... (${fixAttempt}/${state.maxFixAttempts})`, "info");
  await sendMessageToSession(decision.fixPrompt!);
}

async function handleBuildCheck(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ currentPhase: "build-checking" });
  const cmd = decision.buildCommand || getBuildCommand() || "pnpm tsc --noEmit";
  addLogEntry(state.currentSessionIndex!, "build-checking", `Build check: ${cmd}`);
  await sendMessageToSession(`Run \`${cmd}\` and report any errors. If there are zero errors, say "Build clean."`);
}

async function handleTest(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ currentPhase: "testing" });
  const cmd = decision.testCommand || getTestCommand() || "pnpm test";
  addLogEntry(state.currentSessionIndex!, "testing", `Running tests: ${cmd}`);
  await sendMessageToSession(`Run \`${cmd}\`. Report which tests pass and which fail.`);
}

async function handleCommit(): Promise<void> {
  // After a commit turn completes, advance to next session
  await startNextSession();
}

async function startNextSession(): Promise<void> {
  const guide = useGuideStore.getState().guide;
  if (!guide) {
    handlePause("Guide was dismissed");
    return;
  }

  const nextSession = guide.sessions.find((s) => s.status === "active");

  if (!nextSession) {
    // All sessions complete!
    useSelfDriveStore.setState({ status: "completed", currentPhase: null });

    const totalTime = Date.now() - (useSelfDriveStore.getState().startedAt ?? Date.now());
    const timeStr = formatDuration(totalTime);

    addLogEntry(0, "completed", `All ${guide.sessions.length} sessions done! (${timeStr})`);
    await restoreSessionMode();
    stopListeners();
    showToast(`Self-Drive complete! ${guide.sessions.length} sessions in ${timeStr}`, "success");
    return;
  }

  useSelfDriveStore.setState({
    currentSessionIndex: nextSession.index,
    currentPhase: "building",
    fixAttempt: 0,
    previousFixPrompts: [],
    sessionStartedAt: Date.now(),
  });

  addLogEntry(nextSession.index, "building", `Starting Session ${nextSession.index}: ${nextSession.name}`);
  await sendMessageToSession(nextSession.prompt);
  useGuideStore.getState().markPromptSent(nextSession.index);
}

// ── Pause / Abort / Crash handlers ──────────────────────────────────

function handlePause(reason: string): void {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ status: "paused", pauseReason: reason });
  addLogEntry(state.currentSessionIndex ?? 0, "paused", reason);
  showToast(`Self-Drive paused: ${reason}`, "info");
}

function handleAbort(reason: string): void {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ status: "paused", pauseReason: `ABORT: ${reason}` });
  addLogEntry(state.currentSessionIndex ?? 0, "aborted", reason);
  restoreSessionMode();
  stopListeners();
  showToast(`Self-Drive aborted: ${reason}`, "error");
}

function handleProcessCrash(payload: ProcessExitedEvent): void {
  const state = useSelfDriveStore.getState();
  if (state.status !== "running") return;

  addLogEntry(state.currentSessionIndex ?? 0, "crash", `Claude Code exited (code ${payload.exit_code})`);
  handlePause(
    `Claude Code process exited (code ${payload.exit_code ?? "unknown"}). ` +
    `Restart Claude Code and click Resume to continue.`,
  );
}

// ── Mode restoration ────────────────────────────────────────────────

async function restoreSessionMode(): Promise<void> {
  const previousMode = useSelfDriveStore.getState().previousSessionMode;
  if (previousMode) {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (sessionId) {
      try {
        await syncSessionMode(sessionId, previousMode);
        useSessionStore.getState().setSessionMode(sessionId, previousMode as SessionMode);
      } catch { /* ignore */ }
    }
    useSelfDriveStore.setState({ previousSessionMode: null });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function addLogEntry(
  sessionIndex: number,
  phase: RunLogEntry["phase"],
  summary: string,
  decision?: OrchestratorDecision,
): void {
  const entry: RunLogEntry = {
    timestamp: Date.now(),
    sessionIndex,
    phase,
    event: phase,
    summary,
    decision,
  };
  useSelfDriveStore.setState((prev) => ({
    runLog: [...prev.runLog, entry],
  }));
}

async function sendMessageToSession(prompt: string): Promise<void> {
  const sessionId = activeSessionId;
  if (!sessionId) {
    handlePause("No active session — cannot send message");
    return;
  }

  try {
    await sendMessage(sessionId, prompt);
  } catch (e) {
    handlePause(`Failed to send message to Claude Code: ${e}`);
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// ── Selectors ───────────────────────────────────────────────────────

export function useSelfDriveStatus(): SelfDriveStatus {
  return useSelfDriveStore((s) => s.status);
}

export function useSelfDrivePhase(): SelfDrivePhase | null {
  return useSelfDriveStore((s) => s.currentPhase);
}

export function useSelfDriveRunning(): boolean {
  return useSelfDriveStore((s) => s.status === "running");
}

export function useSelfDriveActive(): boolean {
  return useSelfDriveStore((s) => s.status === "running" || s.status === "paused");
}
