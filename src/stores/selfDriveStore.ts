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
  Blocker,
  BlockerKind,
  ImplementationGuide,
} from "../types/implementation-guide";
import type { FrontendEvent, TurnCompleteEvent, ProcessExitedEvent } from "../types/claude-events";
import type { SessionMode } from "../types/session";
import { useSessionStore } from "./sessionStore";
import { useGuideStore } from "./guideStore";
import { useSettingsStore } from "./settingsStore";
import { showToast } from "./toastStore";
import {
  sendMessage,
  syncSessionMode,
  updateGuideData,
  saveSelfDriveState,
  deleteSelfDriveState,
  verifyActionParity,
  type ActionParityResult,
} from "../lib/tauri-commands";
import { callOrchestrator } from "../lib/self-drive-orchestrator";
import { buildSessionVerifyPrompt } from "../lib/guide-verify-prompt";
import { buildRecoveryVerifyPrompt } from "../lib/recovery-prompt";
import { formatDuration } from "../lib/format-utils";
import {
  extractToolsFromTurn,
  truncateResponse,
  getCurrentSessionPlan,
  getProjectTechStack,
  getBuildCommand,
  getTestCommand,
} from "../lib/self-drive-utils";

// ── Module-level listener handle ────────────────────────────────────
// NOTE: the session id is deliberately NOT a module-level variable.
// It lives in store state (see SelfDriveState.sessionId) so it can't
// be overwritten by UI navigation. Keeping it here would reintroduce
// the same race that caused Self-Drive to send prompts to the wrong
// Claude Code session after a sub-tab switch.

let chatEventUnlisten: UnlistenFn | null = null;

// ── Store interface ─────────────────────────────────────────────────

interface SelfDriveState {
  status: SelfDriveStatus;
  projectPath: string | null;
  /**
   * Claude Code session id this Self-Drive run is pinned to. Captured at
   * start() and never re-read from useSessionStore's "active" map —
   * that's a UI-facing concept and changes when the user switches tabs.
   * Self-Drive's target session must not change during a run.
   */
  sessionId: string | null;
  /**
   * Snapshot of the guide Self-Drive is executing. Taken at start() from
   * useGuideStore, then mutated through applyGuideMutation. All orchestrator
   * reads use THIS field, not useGuideStore.guide (which follows UI navigation).
   */
  guide: ImplementationGuide | null;
  /**
   * True after the store was hydrated from disk on app boot — the previously
   * pinned Claude Code session is dead (process died with the app) and the
   * user must explicitly attach a fresh session before Resume becomes usable.
   */
  needsSessionAttach: boolean;
  /**
   * True after attachSession succeeds post-restart: the next Resume should
   * force a fresh send of the current session's prompt (the new Claude Code
   * session has no memory of the old one, so jumping to verify/build_check
   * would confuse it).
   */
  postRestartFreshResumeNeeded: boolean;
  currentSessionIndex: number | null;
  currentPhase: SelfDrivePhase | null;

  previousSessionMode: string | null;
  fixAttempt: number;
  maxFixAttempts: number;
  previousFixPrompts: string[];
  lowConfidenceCount: number;

  runLog: RunLogEntry[];

  startedAt: number | null;
  sessionStartedAt: number | null;
  pauseReason: string | null;

  /** The blocker currently holding Self-Drive paused, if any. */
  activeBlocker: Blocker | null;
  /** Resolved/abandoned blockers in chronological order — orchestrator memory. */
  blockerHistory: Blocker[];
  /** Summaries of the last few pauses (most recent last). Bounded to 5. */
  recentPauseSummaries: string[];

  config: SelfDriveConfig;

  // Actions
  start: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => void;
  /**
   * Record that the user has chosen a resolution for the current blocker.
   * Transitions the blocker to "user-decided" and stashes the resolution
   * text so the next Resume triggers a recovery verification.
   */
  userResolveBlocker: (resolution: string) => void;
  /**
   * One-click path: user picked an offered option in the BlockerCard.
   * Injects a visible "User picked: …" marker into the chat transcript,
   * sets userResolution, then triggers Resume. No Claude Code round-trip.
   */
  pickBlockerOption: (option: string) => Promise<void>;
  /**
   * Called from App boot: rehydrate a persisted run record. The resulting
   * state is always `paused` + `needsSessionAttach=true`, regardless of the
   * pre-shutdown status. The original pauseReason is overridden with a
   * restart-specific message the UI can display.
   */
  hydrateFromDisk: (record: PersistedRunState, guide: ImplementationGuide | null) => void;
  /**
   * User explicitly binds the paused Self-Drive run to a fresh Claude Code
   * session after a restart. Validates session.project_path === state.projectPath
   * and refuses otherwise. Flips needsSessionAttach to false; subsequent
   * Resume goes through the normal recovery path.
   */
  attachSession: (newSessionId: string) => Promise<void>;
}

// ─── Persisted run state shape (on-disk via self_drive_runs table) ────

export interface PersistedRunState {
  version: 1;
  projectPath: string;
  guideId: string;
  sessionId: string | null;
  currentSessionIndex: number | null;
  currentPhase: SelfDrivePhase | null;
  fixAttempt: number;
  maxFixAttempts: number;
  previousFixPrompts: string[];
  lowConfidenceCount: number;
  activeBlocker: Blocker | null;
  blockerHistory: Blocker[];
  recentPauseSummaries: string[];
  pauseReason: string | null;
  startedAt: number | null;
  sessionStartedAt: number | null;
  runLog: RunLogEntry[]; // capped to last 200 entries
  config: SelfDriveConfig;
  savedAt: number;
}

// Max run-log entries persisted to disk. Older entries stay in memory
// during the active session but are dropped from the snapshot to keep
// row size bounded.
const PERSIST_RUN_LOG_CAP = 200;

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
  projectPath: null,
  sessionId: null,
  guide: null,
  needsSessionAttach: false,
  postRestartFreshResumeNeeded: false,
  currentSessionIndex: null,
  currentPhase: null,
  previousSessionMode: null,
  fixAttempt: 0,
  maxFixAttempts: 3,
  previousFixPrompts: [],
  lowConfidenceCount: 0,
  runLog: [],
  startedAt: null,
  sessionStartedAt: null,
  pauseReason: null,
  activeBlocker: null,
  blockerHistory: [],
  recentPauseSummaries: [],
  config: {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    maxFixAttempts: 3,
    runTests: true,
    runBuildCheck: true,
    autoCommit: false,
  },

  start: async () => {
    // Prevent starting if Self-Drive is already running/paused for another project
    const currentState = get();
    if (currentState.status === "running" || currentState.status === "paused") {
      showToast(`Self-Drive is already ${currentState.status} for another project. Stop it first.`, "error");
      return;
    }

    const sessionId = useSessionStore.getState().activeSessionId;
    const projectPath = useSessionStore.getState().activeProjectPath;
    if (!sessionId || !projectPath) {
      showToast("No active Claude Code session", "error");
      return;
    }

    const guide = useGuideStore.getState().guide;
    if (!guide) {
      showToast("No guide loaded", "error");
      return;
    }
    // Hardening: the guide shown in the UI must belong to the project we're
    // about to start Self-Drive on. Prevents a race where the user navigates
    // away between clicking Start and the snapshot being taken.
    if (guide.projectPath !== projectPath) {
      showToast("Guide does not belong to the active project", "error");
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

    set({
      status: "running",
      projectPath,
      // Pin the session id to state — this is now the source of truth for
      // Self-Drive's target session, immune to UI sub-tab switches.
      sessionId,
      // Snapshot the guide — UI navigation changing useGuideStore.guide no
      // longer affects Self-Drive's view.
      guide,
      currentSessionIndex: firstActive.index,
      currentPhase: "preparing",
      previousSessionMode: currentMode,
      fixAttempt: 0,
      previousFixPrompts: [],
      lowConfidenceCount: 0,
      runLog: [],
      startedAt: Date.now(),
      sessionStartedAt: Date.now(),
      pauseReason: null,
      activeBlocker: null,
      blockerHistory: [],
      recentPauseSummaries: [],
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

    // Persist the initial run row so a restart can recover us.
    persistRunState();

    // Send first build prompt
    set({ currentPhase: "building" });
    addLogEntry(firstActive.index, "building", `Starting Session ${firstActive.index}: ${firstActive.name}`, undefined, firstActive.prompt);

    try {
      // Add user message to chat so the prompt is visible
      const msgId = `sd-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      useSessionStore.getState().addMessage(sessionId, {
        id: msgId,
        role: "user",
        content: firstActive.prompt,
        timestamp: new Date().toISOString(),
        activityIds: [],
        isStreaming: false,
        isSelfDrive: true,
      });
      useSessionStore.getState().setSessionBusy(sessionId, true);

      await sendMessage(sessionId, firstActive.prompt);
      markPromptSentForSession(firstActive.index);
    } catch (e) {
      handlePause(`Failed to send build prompt: ${e}`);
    }

    showToast(`Self-Drive started (${guide.sessions.filter((s) => s.status !== "done").length} sessions)`, "info");
  },

  resume: async () => {
    const state = get();
    if (state.status !== "paused") return;

    // Must attach a fresh session first if we're resurrected from disk.
    if (state.needsSessionAttach) {
      showToast(
        "Attach a Claude Code session in this project before resuming.",
        "error",
      );
      return;
    }

    // Self-Drive is pinned to the session it started on. Do NOT re-read
    // projectActiveSession — the user may have clicked a different sub-tab
    // in the meantime, which would silently re-target a different session.
    const sessionId = state.sessionId;
    if (!sessionId) {
      showToast("Self-Drive has no pinned session — stop and restart.", "error");
      return;
    }

    set({ status: "running", pauseReason: null });
    addLogEntry(state.currentSessionIndex ?? 0, "resumed", "Self-Drive resumed by user");

    // Post-restart: reset the current guide session's prompt/verify flags so
    // the downstream branches re-send the session prompt from scratch. The
    // newly-attached Claude Code session has no memory of the previous one,
    // so jumping into verify/build_check without re-context is incorrect.
    let workingState = state;
    if (state.postRestartFreshResumeNeeded && state.currentSessionIndex != null) {
      const idx = state.currentSessionIndex;
      applyGuideMutation((g) => ({
        ...g,
        sessions: g.sessions.map((s) =>
          s.index === idx
            ? { ...s, promptSent: false, verifyRequested: false }
            : s,
        ),
      }));
      set({ postRestartFreshResumeNeeded: false });
      addLogEntry(
        idx,
        "resumed",
        "Post-restart: current session flags reset — prompt will be re-sent fresh",
      );
      // The local `state` captured at the top is now stale — the guide
      // snapshot and flag both updated via applyGuideMutation. Re-read so
      // the downstream branch sees the reset flags.
      workingState = get();
    }

    // Re-start listeners on the pinned session.
    await startListeners(sessionId);

    // Ensure auto-accept mode on the pinned session.
    try {
      await syncSessionMode(sessionId, "auto-accept");
      useSessionStore.getState().setSessionMode(sessionId, "auto-accept");
    } catch { /* ignore */ }

    // ── Recovery path ──────────────────────────────────────────────────
    // If a blocker is active and not yet resolved, confirm its resolution
    // BEFORE continuing normal session flow. Two inputs can stand in for
    // "user answered": (a) a picked option stored as blocker.userResolution,
    // or (b) chat messages that arrived after prePauseLastMessageId. If
    // neither exists we keep the pause — Resume is not silent wish-making.
    const blocker = useSelfDriveStore.getState().activeBlocker;
    if (blocker && blocker.status !== "resolved" && blocker.status !== "abandoned") {
      const chatSincePause = readChatSincePause(blocker);
      const hasUserResolution = (blocker.userResolution ?? "").trim().length > 0;
      const hasChat = chatSincePause.length > 0;

      if (!hasUserResolution && !hasChat) {
        // Resume blocked — keep paused with a clearer reason the UI can
        // pick up (SelfDriveStatus shows this). No progress is made.
        const reason = "Answer in chat or pick an option above, then click Resume.";
        useSelfDriveStore.setState({ status: "paused", pauseReason: reason });
        addLogEntry(
          state.currentSessionIndex ?? 0,
          "paused",
          "Resume blocked: no resolution provided yet",
        );
        showToast(reason, "info");
        return;
      }

      const combined = combineResolution(blocker.userResolution, chatSincePause);
      const pending: Blocker = {
        ...blocker,
        status: "user-decided",
        userResolution: combined,
      };
      await enterRecoveryPhase(pending);
      showToast("Self-Drive resumed — verifying blocker resolution", "info");
      return;
    }

    // Determine resume action from the PINNED guide's session flags.
    // Use workingState (post-restart reset may have mutated the guide above).
    const guide = workingState.guide;
    const session = guide?.sessions.find((s) => s.index === workingState.currentSessionIndex);

    if (!session) {
      handlePause("Could not find current session in pinned guide");
      return;
    }

    if (session.status === "done") {
      // Already completed — advance to next session
      await startNextSession();
    } else if (!session.promptSent) {
      // Creation prompt never sent — send it now
      set({ currentPhase: "building", fixAttempt: 0, previousFixPrompts: [] });
      addLogEntry(session.index, "building",
        `Resuming: sending creation prompt for Session ${session.index}`,
        undefined, session.prompt);
      await sendMessageToSession(session.prompt);
      markPromptSentForSession(session.index);
    } else if (!session.verifyRequested) {
      // Build was attempted but verification hasn't started — re-check build
      await handleBuildCheck({ action: "build_check", summary: "Re-checking build after resume", confidence: "high" });
    } else {
      // Verification was already requested — re-verify
      await handleVerify();
    }

    showToast("Self-Drive resumed", "info");
  },

  stop: async () => {
    const state = get();
    const sessionIdx = state.currentSessionIndex ?? 0;
    const projectPath = state.projectPath;

    // First partial reset — keeps sessionId/guide/previousSessionMode alive
    // long enough for restoreSessionMode() to find them.
    set({
      status: "idle",
      currentPhase: null,
      currentSessionIndex: null,
      pauseReason: null,
      activeBlocker: null,
    });

    stopListeners();
    await restoreSessionMode();

    // Now finish clearing pinned state and drop the persisted row.
    set({
      projectPath: null,
      sessionId: null,
      guide: null,
      needsSessionAttach: false,
      postRestartFreshResumeNeeded: false,
    });
    deletePersistedRunState(projectPath);

    addLogEntry(sessionIdx, "stopped", "Self-Drive stopped by user");
    showToast("Self-Drive stopped. Mode restored.", "info");
  },

  pause: () => {
    handlePause("Paused by user");
  },

  userResolveBlocker: (resolution: string) => {
    const state = get();
    const blocker = state.activeBlocker;
    if (!blocker) {
      // No-op: UI should not offer this unless a blocker exists.
      return;
    }
    const trimmed = resolution.trim();
    const updated: Blocker = {
      ...blocker,
      status: "user-decided",
      userResolution: trimmed.length > 0 ? trimmed : "(no option selected)",
    };
    set({ activeBlocker: updated });
    addLogEntry(
      state.currentSessionIndex ?? 0,
      "blocker-user-decided",
      `User: ${updated.userResolution}`,
      undefined,
      undefined,
      updated,
    );
  },

  hydrateFromDisk: (record: PersistedRunState, guide: ImplementationGuide | null) => {
    // Drop the row if we can't find the guide (it was dismissed / deleted
    // while CodeMantis was closed) or the guide id has drifted.
    if (!guide || guide.id !== record.guideId) {
      void deleteSelfDriveState(record.projectPath).catch(() => {});
      return;
    }
    // Don't overwrite an already-running / paused run in memory.
    const current = get();
    if (current.status === "running" || current.status === "paused") return;

    const projectName = record.projectPath.split("/").filter(Boolean).pop() ?? record.projectPath;
    set({
      status: "paused",
      projectPath: record.projectPath,
      sessionId: record.sessionId, // dead, but useful for log
      guide,
      needsSessionAttach: true,
      postRestartFreshResumeNeeded: false, // becomes true on attachSession
      currentSessionIndex: record.currentSessionIndex,
      currentPhase: record.currentPhase,
      fixAttempt: record.fixAttempt,
      maxFixAttempts: record.maxFixAttempts,
      previousFixPrompts: record.previousFixPrompts,
      lowConfidenceCount: record.lowConfidenceCount,
      activeBlocker: record.activeBlocker,
      blockerHistory: record.blockerHistory,
      recentPauseSummaries: record.recentPauseSummaries,
      pauseReason: `Restart detected — attach a Claude Code session in ${projectName} to continue.`,
      startedAt: record.startedAt,
      sessionStartedAt: record.sessionStartedAt,
      runLog: [
        ...record.runLog,
        {
          timestamp: Date.now(),
          sessionIndex: record.currentSessionIndex ?? 0,
          phase: "resumed",
          event: "resumed",
          summary: "CodeMantis restart — waiting for user to attach a Claude Code session",
        },
      ],
      config: record.config,
      previousSessionMode: null,
    });
  },

  attachSession: async (newSessionId: string) => {
    const state = get();
    if (state.status !== "paused" || !state.needsSessionAttach) {
      showToast("Self-Drive is not awaiting session attach.", "error");
      return;
    }
    if (!state.projectPath) {
      showToast("No project associated with Self-Drive.", "error");
      return;
    }
    const session = useSessionStore.getState().sessions.get(newSessionId);
    if (!session) {
      showToast("Unknown session id.", "error");
      return;
    }
    if (session.project_path !== state.projectPath) {
      showToast(
        "That session belongs to a different project. Pick one from the Self-Drive project.",
        "error",
      );
      return;
    }

    const currentMode = useSessionStore.getState().sessionModes.get(newSessionId) || "normal";
    set({
      sessionId: newSessionId,
      needsSessionAttach: false,
      postRestartFreshResumeNeeded: true,
      previousSessionMode: currentMode,
    });

    await startListeners(newSessionId);
    try {
      await syncSessionMode(newSessionId, "auto-accept");
      useSessionStore.getState().setSessionMode(newSessionId, "auto-accept");
    } catch { /* ignore */ }

    addLogEntry(
      state.currentSessionIndex ?? 0,
      "resumed",
      `Attached to session ${newSessionId} after restart`,
    );
    persistRunState();
    showToast("Attached — click Resume to re-run diagnostic evidence and continue.", "info");
  },

  pickBlockerOption: async (option: string) => {
    const state = get();
    const blocker = state.activeBlocker;
    if (!blocker) return;
    const text = option.trim();
    if (text.length === 0) return;

    // Inject a visible marker into the chat so history records the decision.
    // Marked isSelfDrive so the chat-since-pause reader ignores it (we'd be
    // double-counting: userResolution + marker).
    const pinnedSessionId = state.sessionId;
    if (pinnedSessionId) {
      useSessionStore.getState().addMessage(pinnedSessionId, {
        id: `sd-pick-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content: `(Self-Drive) Picked option: ${text}`,
        timestamp: new Date().toISOString(),
        activityIds: [],
        isStreaming: false,
        isSelfDrive: true,
      });
    }

    get().userResolveBlocker(text);
    await get().resume();
  },
}));

// ── Run-state persistence (restart recovery) ────────────────────────
//
// Self-Drive's in-memory state is periodically serialized to SQLite via
// save_self_drive_state. On app boot, App.tsx calls list_self_drive_states
// and hydrateFromDisk resurrects a "paused + needsSessionAttach" mode. The
// user then explicitly attaches a fresh Claude Code session (the pinned
// one died with the app) and clicks Resume, which re-runs the recovery
// verification to re-create diagnostic evidence against live state.

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 300;

function persistRunState(): void {
  const s = useSelfDriveStore.getState();
  // Nothing to persist if Self-Drive hasn't started, or already stopped/completed.
  if (!s.projectPath || !s.guide) return;
  if (s.status === "idle" || s.status === "completed") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const snapshot: PersistedRunState = {
      version: 1,
      projectPath: s.projectPath!,
      guideId: s.guide!.id,
      sessionId: s.sessionId,
      currentSessionIndex: s.currentSessionIndex,
      currentPhase: s.currentPhase,
      fixAttempt: s.fixAttempt,
      maxFixAttempts: s.maxFixAttempts,
      previousFixPrompts: s.previousFixPrompts,
      lowConfidenceCount: s.lowConfidenceCount,
      activeBlocker: s.activeBlocker,
      blockerHistory: s.blockerHistory,
      recentPauseSummaries: s.recentPauseSummaries,
      pauseReason: s.pauseReason,
      startedAt: s.startedAt,
      sessionStartedAt: s.sessionStartedAt,
      runLog: s.runLog.slice(-PERSIST_RUN_LOG_CAP),
      config: s.config,
      savedAt: Date.now(),
    };
    void saveSelfDriveState(s.projectPath!, JSON.stringify(snapshot)).catch((e) =>
      console.warn("[Self-Drive] Failed to persist run state:", e),
    );
  }, PERSIST_DEBOUNCE_MS);
}

function deletePersistedRunState(projectPath: string | null): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!projectPath) return;
  void deleteSelfDriveState(projectPath).catch((e) =>
    console.warn("[Self-Drive] Failed to delete run state:", e),
  );
}

// ── Guide mutation (project-isolated) ───────────────────────────────
//
// Self-Drive owns its guide snapshot (state.guide). Mutations:
//   1) update the snapshot, so the next orchestrator cycle sees them;
//   2) persist to the database, so other views/sessions pick them up;
//   3) sync the UI's guide store — but ONLY when the user is currently
//      viewing Self-Drive's project. When they're not, we must NOT
//      overwrite the guide the user is looking at (it belongs to the
//      OTHER project).
//
// This replaces calls that used to go through useGuideStore.* directly
// (markPromptSent, markVerifyRequested, markSessionComplete, toggleVerifyCheck).

function applyGuideMutation(mutator: (g: ImplementationGuide) => ImplementationGuide): void {
  const current = useSelfDriveStore.getState().guide;
  if (!current) return;
  const next = mutator(current);
  if (next === current) return; // no-op transform

  useSelfDriveStore.setState({ guide: next });

  // Persist. Fire-and-forget; the tauri command is idempotent and the
  // UI can always reload from disk if it ever falls behind.
  void updateGuideData(next.id, JSON.stringify(next)).catch((e) =>
    console.warn("[Self-Drive] Failed to persist guide mutation:", e),
  );

  // Mirror into useGuideStore ONLY when the user is looking at this
  // project — otherwise we'd overwrite some other project's guide.
  const uiGuide = useGuideStore.getState().guide;
  if (uiGuide && uiGuide.projectPath === next.projectPath) {
    useGuideStore.setState({ guide: next });
  }
}

function markPromptSentForSession(sessionIndex: number): void {
  applyGuideMutation((g) => ({
    ...g,
    sessions: g.sessions.map((s) =>
      s.index === sessionIndex ? { ...s, promptSent: true } : s,
    ),
  }));
}

function markVerifyRequestedForSession(sessionIndex: number): void {
  applyGuideMutation((g) => ({
    ...g,
    sessions: g.sessions.map((s) =>
      s.index === sessionIndex ? { ...s, verifyRequested: true } : s,
    ),
  }));
}

function toggleVerifyCheckForSession(sessionIndex: number, checkId: string): void {
  applyGuideMutation((g) => ({
    ...g,
    sessions: g.sessions.map((s) => {
      if (s.index !== sessionIndex) return s;
      return {
        ...s,
        verifyChecks: s.verifyChecks.map((c) =>
          c.id === checkId ? { ...c, checked: !c.checked } : c,
        ),
      };
    }),
  }));
}

/**
 * Mark a session complete. Returns true if the transition was applied,
 * false otherwise (e.g., session not found or verify checks incomplete).
 *
 * NOTE: the cross-system action parity gate lives in
 * `attemptMarkSessionComplete` (async wrapper below). This function runs
 * the synchronous guard (all checks ticked) and applies the state
 * transition; callers that need the parity gate MUST go through
 * `attemptMarkSessionComplete` instead.
 */
function markSessionCompleteForSession(sessionIndex: number): boolean {
  const current = useSelfDriveStore.getState().guide;
  if (!current) return false;
  const target = current.sessions.find((s) => s.index === sessionIndex);
  if (!target) return false;
  if (target.status === "done") return true; // already done, idempotent
  const allChecked =
    target.verifyChecks.length === 0 ||
    target.verifyChecks.every((c) => c.checked);
  if (!allChecked) return false;

  // Flip the current session to done; promote the next pending session
  // to active (if any).
  const nextPending = current.sessions.find(
    (s) => s.index !== sessionIndex && s.status === "pending",
  );
  applyGuideMutation((g) => {
    const updatedGuide = g.sessions.every(
      (s) => s.index === sessionIndex || s.status === "done",
    );
    return {
      ...g,
      status: updatedGuide ? "completed" : g.status,
      sessions: g.sessions.map((s) => {
        if (s.index === sessionIndex) return { ...s, status: "done" };
        if (nextPending && s.index === nextPending.index) {
          return { ...s, status: "active" };
        }
        return s;
      }),
    };
  });
  return true;
}

/**
 * Async wrapper around `markSessionCompleteForSession` that runs the
 * cross-system action parity gate BEFORE applying the transition.
 *
 * For any session whose guide data declares `crossSystemActions`, this
 * invokes the Rust `verify_action_parity` command and refuses to mark
 * the session done if any action is unpaired (caller has it, handler
 * does not — or handler exists but contains stub markers). The verifier
 * text cannot override this gate; this is the primary defence against
 * the "mocked tests green, production handler missing" failure mode.
 *
 * Returns:
 *   { ok: true }                                if transition applied
 *   { ok: false, reason: "checks-incomplete" }  if verify checks not all ticked
 *   { ok: false, reason: "session-not-found" }  if sessionIndex doesn't exist
 *   { ok: false, reason: "parity-failed", results } if parity check blocked it
 *
 * Callers (UI buttons, auto-advance) should surface `detail` from each
 * failing `ActionParityResult` to the user so they know which handler
 * is missing.
 */
export async function attemptMarkSessionComplete(
  sessionIndex: number,
): Promise<
  | { ok: true }
  | { ok: false; reason: "checks-incomplete" }
  | { ok: false; reason: "session-not-found" }
  | { ok: false; reason: "parity-failed"; results: ActionParityResult[] }
> {
  const current = useSelfDriveStore.getState().guide;
  const projectPath = useSelfDriveStore.getState().projectPath;
  if (!current) return { ok: false, reason: "session-not-found" };

  const target = current.sessions.find((s) => s.index === sessionIndex);
  if (!target) return { ok: false, reason: "session-not-found" };

  // Already done → idempotent success.
  if (target.status === "done") return { ok: true };

  // Fast-path checks (same as sync version).
  const allChecked =
    target.verifyChecks.length === 0 ||
    target.verifyChecks.every((c) => c.checked);
  if (!allChecked) return { ok: false, reason: "checks-incomplete" };

  // Parity gate — only when the session declared cross-system actions.
  const actions = target.crossSystemActions ?? [];
  if (actions.length > 0 && projectPath) {
    try {
      const results = await verifyActionParity(
        projectPath,
        actions.map((a) => ({
          action: a.action,
          callerPath: deriveCallerPath(target.files, a.action),
          handlerPath: a.handler,
        })),
      );
      const failed = results.filter((r) => r.status !== "PASS");
      if (failed.length > 0) {
        return { ok: false, reason: "parity-failed", results };
      }
    } catch (e) {
      // The parity check itself failed (missing rg, I/O, etc.). Treat
      // as a failure to protect against false positives. The user gets
      // a synthesized FAIL result explaining the situation.
      console.warn("[selfDriveStore] verifyActionParity failed:", e);
      return {
        ok: false,
        reason: "parity-failed",
        results: actions.map((a) => ({
          action: a.action,
          callerPresent: false,
          handlerPresent: false,
          handlerStubFree: false,
          status: "FAIL",
          detail: `Parity check itself errored (${String(e)}) — treat as unverified.`,
        })),
      };
    }
  }

  const applied = markSessionCompleteForSession(sessionIndex);
  return applied ? { ok: true } : { ok: false, reason: "checks-incomplete" };
}

/**
 * Best-effort caller-path inference. The spec's
 * `**Cross-system actions introduced:**` block names the handler path
 * explicitly but not the caller path — the caller is implicit: it's
 * one of the session's declared Files. For parity, we pass the whole
 * files list as a pseudo-caller-path: the Rust scan walks each entry.
 *
 * Joining with a comma is deliberate: Rust's `resolve_under` gets the
 * first path via `Path::new`, which treats the whole string as one
 * path. So we pass ONLY the first file here and rely on directory
 * scanning for broader coverage. If the session has no Files list, we
 * fall back to the project root (expensive but correct).
 *
 * NOTE: we do not currently have richer metadata tying a specific
 * caller line to a specific action — that would be an enhancement.
 * For now, if the action string appears anywhere in the session's
 * declared files, the caller side is considered present.
 */
function deriveCallerPath(files: string[], _action: string): string {
  // Use the first declared file's directory if multiple files exist;
  // the Rust scan walks directories recursively.
  if (files.length === 0) return ".";
  const first = files[0];
  const slash = first.lastIndexOf("/");
  return slash > 0 ? first.slice(0, slash) : first;
}

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

  // Pinned session id — immune to UI sub-tab switches.
  const sessionId = state.sessionId;
  if (!sessionId) return;

  // Pinned guide snapshot — immune to UI project switches. The user can
  // be viewing a completely different project; we continue operating on
  // the guide we started with.
  const guide = state.guide;
  if (!guide) {
    handlePause("Self-Drive lost its guide snapshot (internal error)");
    return;
  }
  // NOTE: no "Project switched" pause. Self-Drive keeps running on its
  // pinned state regardless of where the user navigates in the UI.

  // Gather Claude Code's response from the pinned session's message list.
  const messages = useSessionStore.getState().sessionMessages.get(sessionId) || [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const toolsUsed = extractToolsFromTurn(messages, sessionId);

  const sessionPlan = getCurrentSessionPlan(state.currentSessionIndex!, state.guide);
  if (!sessionPlan) {
    handlePause("Could not get session plan — pinned guide missing that session");
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

  const orchestratorInput = {
    currentPhase: mapPhaseForOrchestrator(state.currentPhase),
    sessionPlan,
    claudeCodeResponse: truncateResponse(lastAssistant?.content || ""),
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
    activeBlocker: state.activeBlocker,
    recentPauseSummaries: state.recentPauseSummaries,
  };

  let decision: OrchestratorDecision;
  try {
    decision = await callOrchestrator(orchestratorInput, config.provider, apiKey, config.model);

    // Retry once on parse failure (transient LLM format errors)
    if (decision.action === "pause" && decision.pauseReason?.includes("Could not parse AI response")) {
      addLogEntry(state.currentSessionIndex!, "evaluating", "Orchestrator parse error — retrying...");
      decision = await callOrchestrator(orchestratorInput, config.provider, apiKey, config.model);
    }
  } catch (err) {
    handlePause(`AI orchestrator error: ${err}. Check your API key and network.`);
    return;
  }

  addLogEntry(state.currentSessionIndex!, "decision", decision.summary, decision);

  // Inject decision card into the chat
  injectDecisionMessage(decision, state.currentSessionIndex!, state.currentPhase ?? "evaluating");

  // Low-confidence guard — graduated response
  if (decision.confidence === "low") {
    // High-stakes actions: pause immediately
    if (decision.action === "advance" || decision.action === "abort") {
      handlePause(`Orchestrator uncertain on "${decision.action}": ${decision.summary}`);
      return;
    }
    // Recoverable actions: proceed, but track consecutive low-confidence count
    const newCount = useSelfDriveStore.getState().lowConfidenceCount + 1;
    useSelfDriveStore.setState({ lowConfidenceCount: newCount });
    if (newCount >= 3) {
      handlePause(`${newCount} consecutive low-confidence decisions. Review the conversation.`);
      return;
    }
    addLogEntry(state.currentSessionIndex!, "decision",
      `Low-confidence "${decision.action}" — proceeding (${newCount}/3)`, decision);
  }
  if (decision.confidence !== "low") {
    useSelfDriveStore.setState({ lowConfidenceCount: 0 });
  }

  // Re-check status before executing — closes race window if user clicked Pause
  // while orchestrator was awaiting
  if (useSelfDriveStore.getState().status !== "running") {
    addLogEntry(state.currentSessionIndex ?? 0, "decision",
      `Decision discarded (${decision.action}) — Self-Drive was paused/stopped`);
    return;
  }

  // Execute the decision (pass pre-evaluation phase so handleAdvance can
  // skip test/commit sub-phases that already ran this cycle)
  await executeDecision(decision, state.currentPhase);
}

function mapPhaseForOrchestrator(
  phase: SelfDrivePhase | null,
): "building" | "verifying" | "fixing" | "build-checking" | "testing" | "committing" | "recovering" {
  switch (phase) {
    case "building": return "building";
    case "verifying": return "verifying";
    case "fixing": return "fixing";
    case "build-checking": return "build-checking";
    case "testing": return "testing";
    case "committing": return "committing";
    case "recovering": return "recovering";
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
    case "advance_recovery":
      await handleAdvanceRecovery(decision);
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
      handlePause(decision.pauseReason || "Orchestrator requested pause", decision);
      break;
    case "abort":
      handleAbort(decision.abortReason || "Critical failure");
      break;
  }
}

// ── Step handlers ───────────────────────────────────────────────────

/**
 * Substrings in a [behavioral] evidence `mocks=` list that indicate the
 * mock crosses a system boundary. Keep conservative — false positives
 * waste verifier time, but false negatives are exactly the bug this
 * exists to prevent. This list matches mock surfaces Claude Code is
 * likely to name when it explains what a test mocked.
 */
const BOUNDARY_MOCK_SIGNALS = [
  "http",
  "fetch",
  "axios",
  "superagent",
  "got",
  "supabase",
  "client", // db client, api client, etc.
  "db",
  "database",
  "postgres",
  "mysql",
  "sqlite",
  "redis",
  "queue",
  "kafka",
  "sqs",
  "rabbit",
  "edge",
  "api_client",
  "get_api_client", // the exact one from the incident
  "dispatch",
  "invoke",
];

/**
 * Extract the comma-separated mocks list from a [behavioral] PASS
 * evidence string.
 *
 *   'test.ts:12 — "does a thing" · mocks=httpClient,fsWrite'
 *    →   ["httpClient", "fsWrite"]
 *   'test.ts:12 — "does a thing" · mocks=none'     →   ["none"]
 *   'test.ts:12 — "does a thing"'                  →   null   (no disclosure)
 */
function extractMocksFromEvidence(evidence: string): string[] | null {
  const match = evidence.match(/(?:·|mocks=)\s*mocks=([^·\n]+)$/i)
    ?? evidence.match(/·\s*mocks=([^·\n]+)$/i)
    ?? evidence.match(/\bmocks=([^·\n]+)$/i);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function mockCrossesBoundary(mockName: string): boolean {
  const lower = mockName.toLowerCase();
  if (lower === "none") return false;
  return BOUNDARY_MOCK_SIGNALS.some((sig) => lower.includes(sig));
}

/**
 * Validate an orchestrator's "advance" verdict against a session's verify
 * checks. Returns null when the verdict is acceptable, or a short reason
 * string describing the first violation found.
 *
 * Rules (all must hold):
 *  1. checkResults must cover every VerifyCheck label in the session.
 *  2. Every passed:true entry must carry an `evidence` string containing
 *     at least a ":" (file:lines citation).
 *  3. No checkResults entry may reference a label that isn't in the session.
 *  4. Mock-disclosure rule (the mock-only-PASS fix): any [behavioral]
 *     PASS whose evidence declares a mock list containing a
 *     boundary-crossing surface (HTTP client, DB client, API client,
 *     Edge Function dispatcher, queue, etc.) must be accompanied by at
 *     least one [integration] PASS in the same verdict. A [behavioral]
 *     PASS with no `mocks=` disclosure at all is also a violation — the
 *     preamble requires disclosure. (These together catch the failure
 *     mode where all 43 tests pass on mocks while the real handler is
 *     unimplemented.)
 *
 * Exported for tests; not part of the store's public API.
 */
export function validateVerifyAdvance(
  session: {
    verifyChecks: {
      label: string;
      kind?: "static" | "side-effect" | "behavioral" | "integration";
    }[];
  },
  decision: OrchestratorDecision,
): string | null {
  const results = decision.checkResults ?? [];
  if (results.length === 0) {
    return "no checkResults in advance verdict";
  }

  const sessionLabels = new Set(session.verifyChecks.map((c) => c.label));
  const resultLabels = new Set(results.map((r) => r.label));
  const kindByLabel = new Map(
    session.verifyChecks.map((c) => [c.label, c.kind ?? "static"]),
  );

  const missing = session.verifyChecks
    .filter((c) => !resultLabels.has(c.label))
    .map((c) => c.label);

  const unknown = results
    .filter((r) => !sessionLabels.has(r.label))
    .map((r) => r.label);

  const passedWithoutEvidence = results
    .filter((r) => r.passed && (!r.evidence || !r.evidence.includes(":")))
    .map((r) => r.label);

  // Mock-disclosure rule. Only checks typed [behavioral] in the session
  // are subject to it — static/side-effect/integration have their own
  // evidence forms.
  const behavioralPassesMissingDisclosure: string[] = [];
  const behavioralPassesWithBoundaryMock: string[] = [];
  const hasIntegrationPass = results.some(
    (r) => r.passed && kindByLabel.get(r.label) === "integration",
  );

  for (const r of results) {
    if (!r.passed) continue;
    if (kindByLabel.get(r.label) !== "behavioral") continue;
    const mocks = extractMocksFromEvidence(r.evidence ?? "");
    if (mocks === null) {
      behavioralPassesMissingDisclosure.push(r.label);
      continue;
    }
    if (mocks.some(mockCrossesBoundary) && !hasIntegrationPass) {
      behavioralPassesWithBoundaryMock.push(r.label);
    }
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`${missing.length} checks missing from verdict`);
  if (passedWithoutEvidence.length > 0) parts.push(`${passedWithoutEvidence.length} PASS entries lack file:line evidence`);
  if (unknown.length > 0) parts.push(`${unknown.length} unknown labels in verdict`);
  if (behavioralPassesMissingDisclosure.length > 0) {
    parts.push(
      `${behavioralPassesMissingDisclosure.length} [behavioral] PASS entries lack mock-surface disclosure`,
    );
  }
  if (behavioralPassesWithBoundaryMock.length > 0) {
    parts.push(
      `${behavioralPassesWithBoundaryMock.length} [behavioral] PASS entries mock a system boundary but no paired [integration] PASS exists`,
    );
  }

  return parts.length > 0 ? parts.join("; ") : null;
}

async function handleAdvance(decision: OrchestratorDecision, previousPhase?: SelfDrivePhase | null): Promise<void> {
  const state = useSelfDriveStore.getState();
  const sessionIndex = state.currentSessionIndex!;
  // Read from the pinned guide — not the UI's guideStore.
  const guide = state.guide;
  const session = guide?.sessions.find((s) => s.index === sessionIndex);

  // Gate: when advancing out of a verification phase, require per-check
  // evidence and selectively mark only items the orchestrator confirmed.
  // Advancing from test/commit phases doesn't carry a per-check verdict —
  // checks must already be marked from the preceding verify pass.
  if (session && previousPhase === "verifying") {
    const gateError = validateVerifyAdvance(session, decision);
    if (gateError) {
      addLogEntry(sessionIndex, "verifying", `Advance rejected: ${gateError}`);
      handlePause(
        `Self-Drive halted: verifier/orchestrator did not produce evidence for all checks (${gateError}). Review the run log and continue manually.`,
      );
      return;
    }

    // Mark ONLY the checks the orchestrator confirmed passed, via the
    // pinned-guide mutation helper (keeps Self-Drive's snapshot, DB, and
    // the UI's guide store in sync — but only touches the UI when the
    // user is currently viewing Self-Drive's project).
    const resultsByLabel = new Map(
      (decision.checkResults ?? []).map((r) => [r.label, r]),
    );
    for (const check of session.verifyChecks) {
      const r = resultsByLabel.get(check.label);
      if (r?.passed && !check.checked) {
        toggleVerifyCheckForSession(sessionIndex, check.id);
      }
    }

    // Defense-in-depth: if anything stayed unchecked, do not advance.
    const freshSession = useSelfDriveStore.getState().guide?.sessions
      .find((s) => s.index === sessionIndex);
    const stillUnchecked = freshSession?.verifyChecks.filter((c) => !c.checked) ?? [];
    if (stillUnchecked.length > 0) {
      addLogEntry(
        sessionIndex,
        "verifying",
        `Advance rejected: ${stillUnchecked.length} checks remain unchecked after orchestrator verdict`,
      );
      handlePause(
        `Self-Drive halted: ${stillUnchecked.length} checks could not be confirmed. Review the run log and continue manually.`,
      );
      return;
    }
  }

  // Mark session complete — but run the cross-system parity gate first.
  // A session that declared cross-system actions whose handlers aren't
  // implemented CANNOT advance, even if every verify check is ticked.
  // This is the gate that would have stopped the note cross-linking
  // incident from shipping (mocked tests green, handlers missing).
  const outcome = await attemptMarkSessionComplete(sessionIndex);
  if (!outcome.ok) {
    if (outcome.reason === "parity-failed") {
      const failedActions = outcome.results
        .filter((r) => r.status !== "PASS")
        .map((r) => `${r.action}: ${r.detail}`)
        .join(" | ");
      addLogEntry(
        sessionIndex,
        "verifying",
        `Advance blocked by parity gate — ${failedActions}`,
      );
      handlePause(
        `Self-Drive halted: cross-system action parity check failed. ${failedActions}`,
      );
      return;
    }
    const alreadyDone = guide?.sessions
      .find((s) => s.index === sessionIndex)?.status === "done";
    if (!alreadyDone) {
      handlePause(`Could not mark Session ${sessionIndex} complete — unexpected state`);
      return;
    }
  }

  // Log check details for human review, including evidence citations.
  if (decision.checkResults?.length) {
    const checkSummary = decision.checkResults
      .map((r) => {
        const verdict = r.passed ? "PASS" : "FAIL";
        const detail = r.passed
          ? (r.evidence ? ` [${r.evidence}]` : "")
          : (r.reason ? ` (${r.reason})` : "");
        return `${verdict}: ${r.label}${detail}`;
      })
      .join("; ");
    addLogEntry(sessionIndex, "advancing", checkSummary);
  }
  addLogEntry(sessionIndex, "advancing", `Session ${sessionIndex} complete`);
  showToast(`Session ${sessionIndex} verified`, "success");

  // Re-read config from settings (user may have toggled options mid-run)
  const liveConfig = getConfigFromSettings();

  // Optional: run tests between sessions (skip if coming from test/commit phase)
  if (liveConfig.runTests && getTestCommand() && previousPhase !== "testing" && previousPhase !== "committing") {
    useSelfDriveStore.setState({ currentPhase: "testing" });
    const testPrompt = `Run the test suite: ${getTestCommand()}. Report which tests pass and which fail.`;
    addLogEntry(sessionIndex, "testing", `Running test suite: ${getTestCommand()}`, undefined, testPrompt);
    await sendMessageToSession(testPrompt);
    return; // wait for turn_complete → orchestrator evaluates
  }

  // Optional: git commit between sessions (skip if coming from commit phase)
  if (liveConfig.autoCommit && previousPhase !== "committing") {
    useSelfDriveStore.setState({ currentPhase: "committing" });
    const plan = getCurrentSessionPlan(sessionIndex, useSelfDriveStore.getState().guide);
    const commitPrompt = `Commit the current changes with message: "Session ${sessionIndex}: ${plan?.name ?? "implementation"}"`;
    addLogEntry(sessionIndex, "committing", `Committing Session ${sessionIndex}`, undefined, commitPrompt);
    await sendMessageToSession(commitPrompt);
    return; // wait for turn_complete → then advance
  }

  // Move to next session
  await startNextSession();
}

async function handleVerify(): Promise<void> {
  const state = useSelfDriveStore.getState();
  const sessionIndex = state.currentSessionIndex!;
  // Read the pinned guide; the UI's guide may be on a different project.
  const guide = state.guide;
  if (!guide) return;

  const session = guide.sessions.find((s) => s.index === sessionIndex);
  if (!session) return;

  useSelfDriveStore.setState({ currentPhase: "verifying" });

  const verifyPrompt = buildSessionVerifyPrompt(session, guide.specFilename, guide.auditFilename);
  addLogEntry(sessionIndex, "verifying", `Verifying Session ${sessionIndex}`, undefined, verifyPrompt);
  await sendMessageToSession(verifyPrompt);
  markVerifyRequestedForSession(sessionIndex);
}

async function handleFix(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  const fixAttempt = state.fixAttempt + 1;

  if (fixAttempt > state.maxFixAttempts) {
    handlePause(`Max fix attempts (${state.maxFixAttempts}) reached. Remaining issues need manual attention.`);
    return;
  }

  // If we're in a recovery loop, keep the phase as "recovering" so the
  // next turn is evaluated under recovery rules (advance_recovery / fix /
  // pause) rather than fix rules (build_check next).
  const isRecovering = state.currentPhase === "recovering";

  useSelfDriveStore.setState({
    currentPhase: isRecovering ? "recovering" : "fixing",
    fixAttempt,
    previousFixPrompts: [...state.previousFixPrompts, decision.fixPrompt || ""],
  });

  addLogEntry(
    state.currentSessionIndex!,
    isRecovering ? "blocker-verifying" : "fixing",
    `${isRecovering ? "Recovery retry" : "Fix attempt"} ${fixAttempt}/${state.maxFixAttempts}: ${decision.summary}`,
    undefined,
    decision.fixPrompt,
  );

  showToast(`${isRecovering ? "Retrying recovery" : "Fix applied, re-checking"}... (${fixAttempt}/${state.maxFixAttempts})`, "info");
  await sendMessageToSession(decision.fixPrompt!);
}

async function handleBuildCheck(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ currentPhase: "build-checking" });
  const cmd = decision.buildCommand || getBuildCommand() || "pnpm tsc --noEmit";
  const buildPrompt = `Run \`${cmd}\` and report any errors. If there are zero errors, say "Build clean."`;
  addLogEntry(state.currentSessionIndex!, "build-checking", `Build check: ${cmd}`, undefined, buildPrompt);
  await sendMessageToSession(buildPrompt);
}

async function handleTest(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ currentPhase: "testing" });
  const cmd = decision.testCommand || getTestCommand() || "pnpm test";
  const testPrompt = `Run \`${cmd}\`. Report which tests pass and which fail.`;
  addLogEntry(state.currentSessionIndex!, "testing", `Running tests: ${cmd}`, undefined, testPrompt);
  await sendMessageToSession(testPrompt);
}

async function handleCommit(): Promise<void> {
  // After a commit turn completes, advance to next session
  await startNextSession();
}

async function startNextSession(): Promise<void> {
  // Read from the pinned guide — any UI navigation is irrelevant here.
  const guide = useSelfDriveStore.getState().guide;
  if (!guide) {
    handlePause("Pinned guide missing (internal error)");
    return;
  }

  const nextSession = guide.sessions.find((s) => s.status === "active");

  if (!nextSession) {
    // All sessions complete!
    const projectPath = useSelfDriveStore.getState().projectPath;
    useSelfDriveStore.setState({ status: "completed", currentPhase: null });

    const totalTime = Date.now() - (useSelfDriveStore.getState().startedAt ?? Date.now());
    const timeStr = formatDuration(totalTime, "human");

    addLogEntry(0, "completed", `All ${guide.sessions.length} sessions done! (${timeStr})`);
    await restoreSessionMode();
    stopListeners();
    // Nothing to recover after a successful run — drop the persisted row.
    deletePersistedRunState(projectPath);
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

  addLogEntry(nextSession.index, "building", `Starting Session ${nextSession.index}: ${nextSession.name}`, undefined, nextSession.prompt);
  await sendMessageToSession(nextSession.prompt);
  markPromptSentForSession(nextSession.index);
}

// ── Pause / Abort / Crash handlers ──────────────────────────────────

function handlePause(reason: string, decision?: OrchestratorDecision): void {
  const state = useSelfDriveStore.getState();

  // Build a structured Blocker from the orchestrator's decision when
  // one is attached. Falls back to an "unknown" blocker so Resume still
  // takes the recovery path (freeform pauses from user action — e.g. a
  // manual Pause button click — pass decision=undefined and skip this).
  let nextBlocker = state.activeBlocker;
  if (decision?.blocker) {
    nextBlocker = buildBlockerFromDecision(
      state.currentSessionIndex ?? 0,
      decision.blocker,
      decision.pauseReason ?? reason,
    );
  }

  // Bounded pause history (keeps last 5, most recent last).
  const trimmedReason = reason.slice(0, 200);
  const history = [...state.recentPauseSummaries, trimmedReason].slice(-5);

  useSelfDriveStore.setState({
    status: "paused",
    pauseReason: reason,
    activeBlocker: nextBlocker,
    recentPauseSummaries: history,
  });

  if (nextBlocker && decision?.blocker) {
    addLogEntry(
      state.currentSessionIndex ?? 0,
      "blocker-detected",
      `Blocker (${nextBlocker.kind}): ${nextBlocker.summary}`,
      decision,
      undefined,
      nextBlocker,
    );
    injectBlockerCard(nextBlocker, state.currentSessionIndex ?? 0);
  }

  addLogEntry(state.currentSessionIndex ?? 0, "paused", reason);
  showToast(`Self-Drive paused: ${reason}`, "info");
}

/** Build a Blocker record from an orchestrator's pause decision. */
function buildBlockerFromDecision(
  sessionIndex: number,
  decisionBlocker: NonNullable<OrchestratorDecision["blocker"]>,
  pauseReason: string,
): Blocker {
  // Find the id of the last message visible in the chat at pause time.
  // Resume() uses this as the boundary for "messages since pause".
  let prePauseLastMessageId: string | null = null;
  const pinnedSessionId = useSelfDriveStore.getState().sessionId;
  if (pinnedSessionId) {
    const msgs = useSessionStore.getState().sessionMessages.get(pinnedSessionId) ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (!msgs[i].isSelfDrive) {
        prePauseLastMessageId = msgs[i].id;
        break;
      }
    }
    // Fall back: if there are no non-self-drive messages at all, still
    // stamp the very last id so we can compute "anything after this".
    if (!prePauseLastMessageId && msgs.length > 0) {
      prePauseLastMessageId = msgs[msgs.length - 1].id;
    }
  }

  return {
    id: `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    sessionIndex,
    detectedAt: Date.now(),
    kind: decisionBlocker.kind as BlockerKind,
    summary: decisionBlocker.summary || pauseReason.slice(0, 160),
    detail: pauseReason,
    optionsOffered: decisionBlocker.optionsOffered ?? [],
    resolutionCriteria: decisionBlocker.resolutionCriteria,
    status: "open",
    prePauseLastMessageId,
  };
}

/**
 * Collect non-self-drive messages that arrived after the pause boundary.
 * Used by resume() to compose userResolution with what happened in chat
 * while Self-Drive was paused. Returns [] if the boundary can't be found.
 */
export function readChatSincePause(blocker: Blocker | null): { role: "user" | "assistant"; content: string }[] {
  const sessionId = useSelfDriveStore.getState().sessionId;
  if (!blocker || !sessionId) return [];
  const msgs = useSessionStore.getState().sessionMessages.get(sessionId) ?? [];
  if (msgs.length === 0) return [];
  let startIdx = 0;
  if (blocker.prePauseLastMessageId) {
    const idx = msgs.findIndex((m) => m.id === blocker.prePauseLastMessageId);
    if (idx === -1) return []; // boundary not found — safest to report no resolution
    startIdx = idx + 1;
  }
  return msgs
    .slice(startIdx)
    .filter((m) => !m.isSelfDrive && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

/** Compose the final userResolution string sent into the recovery prompt. */
function combineResolution(
  userResolution: string | undefined,
  chatSincePause: { role: string; content: string }[],
): string {
  const parts: string[] = [];
  const trimmed = (userResolution ?? "").trim();
  if (trimmed.length > 0 && trimmed !== "(not specified)") {
    parts.push(`User picked / stated: ${trimmed}`);
  }
  if (chatSincePause.length > 0) {
    const transcript = chatSincePause
      .map((m) => `[${m.role}] ${m.content.trim()}`)
      .join("\n\n");
    parts.push(`Chat exchange during pause:\n${transcript}`);
  }
  return parts.join("\n\n");
}

/**
 * Enter the recovery phase: send a kind-specific recovery-verification
 * prompt to Claude Code. Orchestrator will evaluate the next turn under
 * currentPhase="recovering" and return advance_recovery / fix / pause.
 */
async function enterRecoveryPhase(blocker: Blocker): Promise<void> {
  const verifyingBlocker: Blocker = { ...blocker, status: "verifying" };
  useSelfDriveStore.setState({
    currentPhase: "recovering",
    activeBlocker: verifyingBlocker,
    // A recovery attempt is not a fix attempt — keep the fix counter
    // pinned so the blocker doesn't eat the session's fix budget.
    previousFixPrompts: [],
  });

  const prompt = buildRecoveryVerifyPrompt(verifyingBlocker, verifyingBlocker.userResolution ?? "");
  addLogEntry(
    verifyingBlocker.sessionIndex,
    "blocker-verifying",
    `Verifying blocker resolution: ${verifyingBlocker.summary}`,
    undefined,
    prompt,
    verifyingBlocker,
  );
  await sendMessageToSession(prompt);
}

/**
 * Validate an orchestrator "advance_recovery" verdict.
 * Returns null when the verdict can be trusted; otherwise a short reason.
 *
 * Rules (all must hold):
 *   1. There must be an active blocker to resolve.
 *   2. The decision.summary must contain at least one `:` — the orchestrator
 *      prompt asks for "Blocker {kind} resolved: {quoted evidence}". A
 *      colon is a cheap, strict proxy for "included evidence".
 *   3. Confidence must not be "low". (Low confidence on recovery is the
 *      worst place to trust the model — pause instead.)
 *
 * Exported for tests; not part of the store's public API.
 */
export function validateRecoveryResolution(
  blocker: Blocker | null,
  decision: OrchestratorDecision,
): string | null {
  if (!blocker) return "no active blocker to resolve";
  if (decision.action !== "advance_recovery") return "decision is not advance_recovery";
  if (!decision.summary.includes(":")) return "summary lacks evidence citation (':' required)";
  if (decision.confidence === "low") return "low-confidence recovery verdict";
  return null;
}

async function handleAdvanceRecovery(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  const blocker = state.activeBlocker;
  const err = validateRecoveryResolution(blocker, decision);
  if (err || !blocker) {
    handlePause(`Recovery rejected: ${err ?? "unknown"}`);
    return;
  }

  const resolved: Blocker = { ...blocker, status: "resolved" };
  addLogEntry(
    blocker.sessionIndex,
    "blocker-resolved",
    `Blocker resolved: ${decision.summary}`,
    decision,
    undefined,
    resolved,
  );
  useSelfDriveStore.setState({
    activeBlocker: null,
    blockerHistory: [...state.blockerHistory, resolved],
  });
  showToast("Blocker resolved — resuming session", "success");

  // Resume normal session flow. We re-use the same branching that
  // resume() uses, but without re-entering the recovery branch.
  // Read from the pinned guide — not useGuideStore (which follows UI nav).
  const guide = useSelfDriveStore.getState().guide;
  const session = guide?.sessions.find((s) => s.index === blocker.sessionIndex);
  if (!session) {
    handlePause("Pinned guide no longer has the recovered session — cannot continue");
    return;
  }

  if (session.status === "done") {
    await startNextSession();
  } else if (!session.promptSent) {
    useSelfDriveStore.setState({ currentPhase: "building", fixAttempt: 0 });
    addLogEntry(session.index, "building",
      `Post-recovery: sending creation prompt for Session ${session.index}`,
      undefined, session.prompt);
    await sendMessageToSession(session.prompt);
    markPromptSentForSession(session.index);
  } else if (!session.verifyRequested) {
    await handleBuildCheck({ action: "build_check", summary: "Post-recovery build check", confidence: "high" });
  } else {
    await handleVerify();
  }
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
  // Use Self-Drive's pinned session id from state — not UI-active state.
  const sessionId = useSelfDriveStore.getState().sessionId;
  if (previousMode && sessionId) {
    try {
      await syncSessionMode(sessionId, previousMode);
      useSessionStore.getState().setSessionMode(sessionId, previousMode as SessionMode);
    } catch { /* ignore */ }
    useSelfDriveStore.setState({ previousSessionMode: null });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function addLogEntry(
  sessionIndex: number,
  phase: RunLogEntry["phase"],
  summary: string,
  decision?: OrchestratorDecision,
  prompt?: string,
  blocker?: Blocker,
): void {
  const entry: RunLogEntry = {
    timestamp: Date.now(),
    sessionIndex,
    phase,
    event: phase,
    summary,
    decision,
    prompt,
    blocker,
  };
  useSelfDriveStore.setState((prev) => ({
    runLog: [...prev.runLog, entry],
  }));
  // Every log entry is a natural persistence checkpoint — the run log IS
  // part of the snapshot, so this also captures phase changes, blockers,
  // decisions, etc. Debounced inside persistRunState().
  persistRunState();
}

async function sendMessageToSession(prompt: string): Promise<void> {
  // Always read from the pinned state — never from the UI's "active" session.
  const sessionId = useSelfDriveStore.getState().sessionId;
  if (!sessionId) {
    handlePause("No pinned session — cannot send message");
    return;
  }

  // Add user message to the chat so Self-Drive prompts are visible
  const msgId = `sd-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  useSessionStore.getState().addMessage(sessionId, {
    id: msgId,
    role: "user",
    content: prompt,
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: false,
    isSelfDrive: true,
  });
  useSessionStore.getState().setSessionBusy(sessionId, true);

  try {
    await sendMessage(sessionId, prompt);
  } catch (e) {
    handlePause(`Failed to send message to Claude Code: ${e}`);
  }
}

/**
 * Inject an orchestrator decision message into the chat session.
 * These appear as center-aligned cards in the ChatPanel, distinct from normal messages.
 */
function injectDecisionMessage(
  decision: OrchestratorDecision,
  sessionIndex: number,
  phase: string,
): void {
  const sessionId = useSelfDriveStore.getState().sessionId;
  if (!sessionId) return;
  useSessionStore.getState().addMessage(sessionId, {
    id: `sd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "assistant",
    content: decision.summary,
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: false,
    selfDriveEvent: {
      action: decision.action,
      summary: decision.summary,
      confidence: decision.confidence,
      sessionIndex,
      phase,
    },
  });
}

/**
 * Inject a blocker card into the chat — actionable UI so the user can
 * pick an offered option (or provide free-text) and Resume.
 */
function injectBlockerCard(blocker: Blocker, sessionIndex: number): void {
  const sessionId = useSelfDriveStore.getState().sessionId;
  if (!sessionId) return;
  useSessionStore.getState().addMessage(sessionId, {
    id: `sd-blk-${blocker.id}`,
    role: "assistant",
    content: blocker.summary,
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: false,
    selfDriveEvent: {
      action: "pause",
      summary: blocker.summary,
      confidence: "high",
      sessionIndex,
      phase: "recovering",
      blocker: {
        id: blocker.id,
        kind: blocker.kind,
        summary: blocker.summary,
        optionsOffered: blocker.optionsOffered,
        resolutionCriteria: blocker.resolutionCriteria,
        status: blocker.status,
      },
    },
  });
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

// ── Project-scoped selectors ─────────────────────────────────────────

/** Is Self-Drive running for the CURRENTLY ACTIVE project? */
export function useSelfDriveRunningForActiveProject(): boolean {
  const sdProjectPath = useSelfDriveStore((s) => s.projectPath);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const status = useSelfDriveStore((s) => s.status);
  return status === "running" && sdProjectPath === activeProjectPath;
}

/** Is Self-Drive active (running or paused) for the CURRENTLY ACTIVE project? */
export function useSelfDriveActiveForActiveProject(): boolean {
  const sdProjectPath = useSelfDriveStore((s) => s.projectPath);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const status = useSelfDriveStore((s) => s.status);
  return (status === "running" || status === "paused") && sdProjectPath === activeProjectPath;
}

/** Self-Drive status scoped to the active project. Returns "idle" if Self-Drive belongs to a different project. */
export function useSelfDriveStatusForActiveProject(): SelfDriveStatus {
  const sdProjectPath = useSelfDriveStore((s) => s.projectPath);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const status = useSelfDriveStore((s) => s.status);
  if (sdProjectPath !== activeProjectPath) return "idle";
  return status;
}

/**
 * Does the active blocker already have a resolution signal?
 *   - Returns true when there is no active blocker (no constraint).
 *   - Returns true when the user picked an option (userResolution set), or
 *     when at least one non-self-drive message landed in the session chat
 *     after the pause boundary.
 *   - Returns false when Resume would be blocked for lack of input.
 *
 * Consumers: SelfDriveStatus uses this to disable the Resume button and
 * drive the "waiting for your decision" inline hint.
 */
export function useBlockerHasResolution(): boolean {
  const blocker = useSelfDriveStore((s) => s.activeBlocker);
  const sdProjectPath = useSelfDriveStore((s) => s.projectPath);
  const sessionMessages = useSessionStore((s) => s.sessionMessages);
  const projectActiveSession = useSessionStore((s) => s.projectActiveSession);

  if (!blocker) return true;
  if ((blocker.userResolution ?? "").trim().length > 0) return true;

  const sessionId = sdProjectPath ? projectActiveSession.get(sdProjectPath) ?? null : null;
  if (!sessionId) return false;
  const msgs = sessionMessages.get(sessionId) ?? [];
  if (msgs.length === 0) return false;

  let startIdx = 0;
  if (blocker.prePauseLastMessageId) {
    const idx = msgs.findIndex((m) => m.id === blocker.prePauseLastMessageId);
    if (idx === -1) return false;
    startIdx = idx + 1;
  }
  return msgs.slice(startIdx).some((m) => !m.isSelfDrive && m.content.trim().length > 0);
}
