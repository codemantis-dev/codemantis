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
  CrossSystemAction,
} from "../types/implementation-guide";
import type { FrontendEvent, TurnCompleteEvent, ProcessExitedEvent } from "../types/claude-events";
import type { SessionMode, SelfDriveInjectionKind } from "../types/session";
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
  preflightStatus,
  type ActionParityResult,
} from "../lib/tauri-commands";
import { callOrchestrator } from "../lib/self-drive-orchestrator";
import { buildSessionVerifyPrompt } from "../lib/guide-verify-prompt";
import { buildRecoveryVerifyPrompt } from "../lib/recovery-prompt";
import { classifyRecheckBatch } from "../lib/self-drive-loop-guard";
import {
  inferVocab,
  renderVocabHint,
  type EvidenceDetectionInputs,
} from "../lib/self-drive-evidence-vocab";
import { readFileContent } from "../lib/tauri-commands";
import {
  buildParityRecoveryPrompt,
  parseDeferredParityRows,
} from "../lib/parity-recovery-prompt";
import { wrapBuildPrompt } from "../lib/build-mode-preamble";
import { formatDuration } from "../lib/format-utils";
import {
  extractToolsFromTurn,
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

// Compaction events fire from the Claude Code CLI whenever it auto-compacts
// its context window. During a stuck recovery loop these can fire 15+ times
// per minute, drowning the activity feed. We rate-limit to one logged entry
// per COMPACTION_LOG_WINDOW_MS — start-of-burst is informative; the rest is
// just noise.
let lastCompactionLogAt = 0;
const COMPACTION_LOG_WINDOW_MS = 30_000;

/**
 * How many recheck rounds can fire per session before Self-Drive gives
 * up and pauses. 2 is the sweet spot: one to catch a first-round format
 * miss, one to confirm after Claude Code re-stated. A third would
 * almost always indicate the orchestrator is looping and needs human
 * judgement.
 */
const MAX_RECHECK_ROUNDS = 2;

/**
 * How many times the SAME verify-item can be rechecked per session.
 *
 * Raised to 2 once Phase B.1 landed the deterministic loop guard
 * (`src/lib/self-drive-loop-guard.ts`). The guard now terminates
 * recheck loops based on the SEMANTIC observation that the orchestrator
 * has re-asked + the worker has re-answered with concrete evidence —
 * regardless of paraphrase. With the guard in place, this hard cap is a
 * safety net rather than the primary termination mechanism, so we can
 * afford one extra round for the common case where the first recheck
 * actually does surface an evidence-shape issue that needs another nudge.
 */
const MAX_RECHECKS_PER_ITEM = 2;

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

  /**
   * Verifier-recheck loop state. When the orchestrator emits
   * `request_recheck`, Self-Drive sends a targeted re-prompt to Claude
   * Code and merges the response with the original verifier text before
   * calling the orchestrator again. These fields guard against infinite
   * loops and are reset each time the session advances.
   */
  /** Number of recheck rounds issued for the current session. Cap: 2. */
  recheckRoundsUsed: number;
  /** Per-item recheck counter. Same item cannot be rechecked twice. */
  rechecksPerItem: Record<string, number>;
  /** Original verifier response for the current cycle (set at first verifying turn). */
  originalVerifierResponse: string | null;
  /** Ordered recheck responses from Claude Code, appended each time. */
  recheckResponses: string[];
  /** Per-item verdict carried forward across recheck rounds so unaffected items don't get lost. */
  pinnedCheckResults: { label: string; passed: boolean; skipped?: boolean; reason?: string; evidence?: string }[];
  /**
   * The assembled Claude Code response from the most recent turn — the
   * same text fed into the orchestrator as `claudeCodeResponse`. Used by
   * the parity-recovery flow to honour `DEFERRED: <action> — <reason>`
   * lines Claude Code emits in reply to a parity-recovery prompt. Always
   * the latest turn's response regardless of phase, so a DEFERRED line
   * is honoured whether it came back on a fix-, verify-, or
   * advance-evaluated turn.
   */
  lastClaudeResponse: string | null;

  /**
   * ID of the most recent user message that Self-Drive itself sent
   * (verify prompt, fix prompt, recheck prompt, etc.). Used to reliably
   * capture Claude Code's full response when it spans multiple assistant
   * messages (common in verify phases — each verify item usually triggers
   * its own tool-use cycle, so a single turn_complete covers N assistant
   * messages). Taking just the last assistant message loses items 1..N-1.
   * Null when Self-Drive has not sent anything yet this run.
   */
  lastSelfDrivePromptMessageId: string | null;

  /**
   * Injection kind of the prompt the worker is currently responding to,
   * or null if the orchestrator authored it. Passed to the orchestrator
   * as `lastTurnInjection` so it can skip ACTIVITY-EVIDENCE detectors
   * when the worker was reacting to a system-gated prompt (test run,
   * commit, recovery, etc.) — see plan Issue 6 / Phase A.2.
   */
  lastSelfDrivePromptInjection: SelfDriveInjectionKind | null;

  /**
   * Pre-rendered evidence-vocabulary hint for this project (Phase C.1).
   * Computed once at start() by gathering detection inputs from the
   * project's .env.local / supabase/config.toml / mcp config. Plumbed
   * into every orchestrator call so the model sees the project's
   * canonical SQL/migrate/deploy command shapes and doesn't fabricate
   * commands the project can't run (e.g. psql for a cloud-only project).
   */
  evidenceVocabHint: string | null;

  /**
   * Per-(session, kind) flag: has the full senior-engineer preamble been
   * sent yet during this run? Phase C.3 — first turn gets the full
   * preamble; subsequent turns of the SAME kind (build / fix) within
   * the same session get the compressed reference instead.
   * Format keys: "build:1", "fix:1", "build:2", "fix:2", ...
   * Stored as string[] for clean (de)serialization with PersistedRunState.
   */
  preambleSent: string[];

  /**
   * Watermark message id used by Phase D.2 user-interjections plumbing.
   * Captured each time the orchestrator is consulted; on the next call
   * we read every non-Self-Drive user message AFTER this id and forward
   * them as `userInterjections` so the orchestrator sees what the user
   * said mid-session.
   */
  orchestratorLastUserMessageId: string | null;

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
   * Lift a pause without auto-resuming. Used when the user resolves the
   * blocker manually (e.g. force-completes the session that caused the
   * parity-gate pause). Status goes to "idle" so the user has to click
   * Start/Resume to continue — matching pause/stop semantics and avoiding
   * surprise auto-execution.
   */
  clearPause: () => void;
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
  recheckRoundsUsed: 0,
  rechecksPerItem: {},
  originalVerifierResponse: null,
  recheckResponses: [],
  pinnedCheckResults: [],
  lastClaudeResponse: null,
  lastSelfDrivePromptMessageId: null,
  lastSelfDrivePromptInjection: null,
  evidenceVocabHint: null,
  preambleSent: [],
  orchestratorLastUserMessageId: null,
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

    // Preflight gate — refuse to start if the project ships a preflight.yaml
    // and any blocking capability is unsatisfied. Legacy projects without a
    // manifest fall through (preflightStatus throws → catch → continue).
    try {
      const status = await preflightStatus(projectPath);
      if (!status.allSatisfied) {
        const missing = status.blockingCount;
        showToast(
          `${missing} setup item${missing === 1 ? "" : "s"} need${missing === 1 ? "s" : ""} attention before Self-Drive can start. Open Mission Control to fix.`,
          "error",
        );
        return;
      }
    } catch {
      // No manifest at this project — legacy behaviour, proceed.
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
      recheckRoundsUsed: 0,
      rechecksPerItem: {},
      originalVerifierResponse: null,
      recheckResponses: [],
      pinnedCheckResults: [],
      lastSelfDrivePromptMessageId: null,
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

    // Phase C.1 — gather the project's evidence vocabulary once. Plumbed
    // into every subsequent orchestrator call so the model sees the right
    // SQL/migrate/deploy command shapes for THIS project. Best-effort: a
    // detection failure leaves the hint as null (orchestrator falls back
    // to generic guidance).
    try {
      const hint = await gatherEvidenceVocabHint(projectPath);
      if (hint) {
        useSelfDriveStore.setState({ evidenceVocabHint: hint });
      }
    } catch (e) {
      console.warn("[Self-Drive] evidence vocab detection failed:", e);
    }

    addLogEntry(firstActive.index, "started", `Self-Drive started (${guide.sessions.filter((s) => s.status !== "done").length} sessions remaining)`);

    // Persist the initial run row so a restart can recover us.
    persistRunState();

    // Send first build prompt
    set({ currentPhase: "building" });
    addLogEntry(firstActive.index, "building", `Starting Session ${firstActive.index}: ${firstActive.name}`, undefined, firstActive.prompt);

    try {
      // Add user message to chat so the prompt is visible
      const msgId = `sd-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const wrappedPrompt = wrapWithPreambleTracking("build", firstActive.index, firstActive.prompt);
      useSessionStore.getState().addMessage(sessionId, {
        id: msgId,
        role: "user",
        content: wrappedPrompt,
        timestamp: new Date().toISOString(),
        activityIds: [],
        isStreaming: false,
        isSelfDrive: true,
      });
      useSessionStore.getState().setSessionBusy(sessionId, true);

      await sendMessage(sessionId, wrappedPrompt);
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
    //
    // Exclude "verifying" — a recovery turn was ALREADY sent and we are
    // waiting for Claude Code's response. Re-entering enterRecoveryPhase
    // here would re-send the recovery prompt, confusing the orchestrator
    // and flipping state backward. This path most often triggers after an
    // app restart that caught the blocker mid-verification; the turn-
    // complete listener (re-attached via startListeners above) will pick
    // up the pending response naturally.
    const blocker = useSelfDriveStore.getState().activeBlocker;
    if (
      blocker &&
      blocker.status !== "resolved" &&
      blocker.status !== "abandoned" &&
      blocker.status !== "verifying"
    ) {
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

      // Short-circuit: when the blocker is `kind: "unknown"` (typically a
      // flaky test or one-off pause) AND the user explicitly told us to
      // accept/proceed, skip the recovery round-trip. Re-running the
      // original failing command on a flaky suite would just hit a
      // different flake — see plan: self-drive-is-again-failing-cached-pnueli.
      if (
        blocker.kind === "unknown" &&
        (isAcceptAndProceedResolution(blocker.userResolution) ||
          isAcceptAndProceedResolution(chatSincePause[0]?.content))
      ) {
        useSelfDriveStore.setState({ activeBlocker: pending });
        await acceptUserOverrideAsResolution(pending, combined);
        return;
      }

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
      await sendMessageToSession(
        wrapWithPreambleTracking("build", session.index, session.prompt),
      );
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

  clearPause: () => {
    const state = get();
    if (state.status !== "paused") return;
    const sessionIdx = state.currentSessionIndex ?? 0;
    set({
      status: "idle",
      pauseReason: null,
      activeBlocker: null,
    });
    addLogEntry(
      sessionIdx,
      "resumed",
      "Pause cleared by manual session completion.",
    );
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

/**
 * Collect Claude Code's full response to the most recent Self-Drive
 * prompt by concatenating every assistant message that arrived AFTER the
 * user message we sent.
 *
 * Why this exists: verify phases almost always span multiple assistant
 * messages because each verified item triggers its own tool-use cycle
 * (Read / Bash / Grep). Claude Code emits:
 *   user("prompt") → assistant("ok let me check item 1") → tool_use(bash)
 *   → tool_result → assistant("item 1 — PASS\n\nNow item 2") → tool_use
 *   → tool_result → assistant("item 2 — PASS ...") → ... → turn_complete
 *
 * Taking only `messages.reverse().find(m.role === "assistant")` returns
 * the LAST fragment — losing items 1..N-1. That's the "verifier response
 * truncated — only item 5 visible" bug.
 *
 * Strategy: find the Self-Drive prompt's user-message by id, then gather
 * every assistant message that follows it, joined by double newlines.
 * If the marker is null (fresh run) or missing from the list (messages
 * were cleared), fall back to the last assistant message to preserve
 * backwards-compatible behaviour.
 *
 * `role === "assistant"` entries with tool-use-only content produce the
 * empty string; those are filtered out so the result is clean prose.
 */
function collectAssistantResponseSince(
  messages: Array<{ id: string; role: string; content: string }>,
  promptMessageId: string | null,
): string {
  if (!promptMessageId) {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.content ?? "";
  }
  const promptIdx = messages.findIndex((m) => m.id === promptMessageId);
  if (promptIdx < 0) {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.content ?? "";
  }
  const parts = messages
    .slice(promptIdx + 1)
    .filter((m) => m.role === "assistant" && m.content.trim() !== "")
    .map((m) => m.content);
  if (parts.length === 0) return "";
  return parts.join("\n\n");
}

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

export function markPromptSentForSession(sessionIndex: number): void {
  applyGuideMutation((g) => ({
    ...g,
    sessions: g.sessions.map((s) =>
      s.index === sessionIndex ? { ...s, promptSent: true } : s,
    ),
  }));
}

export function markVerifyRequestedForSession(sessionIndex: number): void {
  applyGuideMutation((g) => ({
    ...g,
    sessions: g.sessions.map((s) =>
      s.index === sessionIndex ? { ...s, verifyRequested: true } : s,
    ),
  }));
}

export function toggleVerifyCheckForSession(sessionIndex: number, checkId: string): void {
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
  opts: { skipParityGate?: boolean } = {},
): Promise<
  | { ok: true }
  | { ok: false; reason: "checks-incomplete" }
  | { ok: false; reason: "session-not-found" }
  | { ok: false; reason: "parity-failed"; results: ActionParityResult[] }
  | { ok: false; reason: "parity-errored"; results: ActionParityResult[] }
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

  // Parity gate — only when the session declared cross-system actions
  // AND this is NOT a handler-authoring session.
  //
  // A handler-authoring session is one where every declared handler is
  // a file this session itself modifies. In that case the callers don't
  // exist yet (they land in a later session), so running parity against
  // an inferred caller path produces false negatives. The session's
  // own verify checks still confirm each handler branch was implemented,
  // so the parity gate is redundant here and should be skipped.
  //
  // A follow-up CALLER session will declare the same actions with a
  // different (non-handler) caller context, and parity will fire there.
  const actions = target.crossSystemActions ?? [];
  const handlerAuthoring =
    actions.length > 0 && actions.every((a) => isHandlerInSessionFiles(a.handler, target.files));

  if (opts.skipParityGate && actions.length > 0 && !handlerAuthoring) {
    // User-initiated bypass — record an audit-trail entry so the run log
    // honestly shows which completions were human-overridden rather than
    // gate-cleared.
    addLogEntry(
      sessionIndex,
      "decision",
      "Session marked complete by user — parity gate bypassed.",
    );
  }

  if (!opts.skipParityGate && actions.length > 0 && projectPath && !handlerAuthoring) {
    const callerPaths = deriveCallerPaths(target.files);
    const actionInputs = actions.map((a) => ({
      action: a.action,
      // Legacy field kept empty — Rust unions callerPath + callerPaths.
      callerPath: "",
      callerPaths,
      handlerPath: a.handler,
      // undefined → Rust falls back to action; only set when present.
      wire: a.wire,
    }));

    // Transient I/O (missing rg binary, permissions blip, transient fs
    // error) shouldn't permanently block a session. Try once, retry once
    // on throw, then surface a distinct "parity-errored" reason so the
    // caller can distinguish "check itself broken" from "real parity FAIL".
    let results: ActionParityResult[];
    let firstError: unknown = null;
    try {
      results = await verifyActionParity(projectPath, actionInputs);
    } catch (e) {
      firstError = e;
      console.warn("[selfDriveStore] verifyActionParity threw, retrying once:", e);
      try {
        results = await verifyActionParity(projectPath, actionInputs);
      } catch (e2) {
        console.warn("[selfDriveStore] verifyActionParity retry also threw:", e2);
        return {
          ok: false,
          reason: "parity-errored",
          results: actions.map((a) => ({
            action: a.action,
            callerPresent: false,
            handlerPresent: false,
            handlerStubFree: false,
            status: "FAIL",
            detail: `Parity check itself errored twice (${String(e2)}; first: ${String(firstError)}) — check rg installation or workspace state, then retry. Not a real code failure.`,
          })),
        };
      }
    }

    const failed = results.filter((r) => r.status !== "PASS");
    if (failed.length > 0) {
      return { ok: false, reason: "parity-failed", results };
    }
  }

  const applied = markSessionCompleteForSession(sessionIndex);
  return applied ? { ok: true } : { ok: false, reason: "checks-incomplete" };
}

/**
 * Collect every distinct directory referenced by a session's declared
 * files. Self-Drive's parity gate scans each of these for the action/wire
 * — the call site can live in any one of them.
 *
 * Why all dirs and not just `files[0]`: limiting to the first file's
 * directory (the prior behaviour) caused false-positive halts whenever
 * the action happened to be in a sibling directory of the session — a
 * common shape, since most sessions touch components + hooks + services
 * in parallel.
 *
 * Falls back to project root when the session has no Files list — same
 * "expensive but correct" last resort as before.
 */
export function deriveCallerPaths(files: string[]): string[] {
  if (files.length === 0) return ["."];
  const dirs = new Set<string>();
  for (const raw of files) {
    const f = raw.replace(/^\.\//, "").trim();
    if (!f) continue;
    const slash = f.lastIndexOf("/");
    dirs.add(slash > 0 ? f.slice(0, slash) : f);
  }
  if (dirs.size === 0) return ["."];
  return Array.from(dirs);
}

/**
 * True when the declared handler path points to (or inside) one of the
 * files this session itself modifies. That marks it as a handler-
 * authoring session — the handler code is being WRITTEN here, so there
 * are no callers to check yet.
 *
 * Handles both `path/to/file.ts` and `path/to/file.ts::handleFoo` forms
 * by stripping any `::symbol` suffix from the handler first. Tolerant of
 * leading `./` on either side.
 */
function isHandlerInSessionFiles(handlerPath: string, files: string[]): boolean {
  if (files.length === 0) return false;
  const handlerFile = handlerPath.split("::")[0].replace(/^\.\//, "").trim();
  if (!handlerFile) return false;
  for (const raw of files) {
    const f = raw.replace(/^\.\//, "").trim();
    if (!f) continue;
    if (f === handlerFile) return true;
    // Directory containment either way: file is "a/b/c.ts", handler is
    // declared as "a/b/" — or vice versa.
    if (handlerFile.startsWith(f + "/") || f.startsWith(handlerFile + "/")) {
      return true;
    }
  }
  return false;
}

// ── Event listeners ─────────────────────────────────────────────────

async function startListeners(sessionId: string): Promise<void> {
  stopListeners();
  // Reset the rate-limit window — a freshly attached session should always
  // log its first compaction event.
  lastCompactionLogAt = 0;

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
        // Skip the trailing "compaction complete" event entirely — the
        // start-of-burst marker is enough to surface that compaction is
        // happening. Rate-limit the start markers so a stuck loop doesn't
        // flood the activity feed.
        if (!payload.is_compacting) break;
        const now = Date.now();
        if (now - lastCompactionLogAt < COMPACTION_LOG_WINDOW_MS) break;
        lastCompactionLogAt = now;
        const state = useSelfDriveStore.getState();
        addLogEntry(
          state.currentSessionIndex ?? 0,
          state.currentPhase ?? "building",
          "Context compacting...",
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
  // A single turn can emit MULTIPLE assistant messages — verify phases
  // especially, because each verified item is usually a tool-use cycle
  // that splits the assistant's text. Taking only the last message loses
  // everything before it. Walk forward from the self-drive prompt marker
  // and concatenate every assistant message after it.
  const messages = useSessionStore.getState().sessionMessages.get(sessionId) || [];
  const assistantSinceLastPrompt = collectAssistantResponseSince(
    messages,
    state.lastSelfDrivePromptMessageId,
  );
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

  // Recheck-loop response assembly. The orchestrator needs both the
  // original verifier response AND every recheck follow-up so it can see
  // the full picture. If this turn completed while we were in
  // "rechecking", append the new response to recheckResponses[] and
  // prepend the original verifier text.
  const currentResponse = assistantSinceLastPrompt;
  let assembledResponse = currentResponse;
  if (state.currentPhase === "rechecking") {
    const merged = [state.originalVerifierResponse ?? "", ...state.recheckResponses, currentResponse]
      .filter((s) => s && s.trim() !== "")
      .join("\n\n--- RECHECK RESPONSE ---\n\n");
    assembledResponse = merged;
    useSelfDriveStore.setState({
      recheckResponses: [...state.recheckResponses, currentResponse],
    });
  } else if (state.currentPhase === "verifying" && state.originalVerifierResponse === null) {
    // First verifying turn of this cycle — stash it so a later recheck
    // can re-merge. Cleared on advance/stop/fix.
    useSelfDriveStore.setState({ originalVerifierResponse: currentResponse });
  }

  // Always stash the latest assembled response so the parity-recovery
  // flow can scan it for `DEFERRED:` lines on the NEXT advance attempt.
  // Unlike originalVerifierResponse this is overwritten every turn and
  // is not phase-gated.
  useSelfDriveStore.setState({ lastClaudeResponse: assembledResponse });

  const orchestratorInput = {
    currentPhase: mapPhaseForOrchestrator(state.currentPhase),
    sessionPlan,
    claudeCodeResponse: assembledResponse,
    claudeCodeToolsUsed: toolsUsed,
    turnDurationMs: payload.duration_ms || 0,
    turnTokensUsed:
      (payload.usage?.input_tokens ?? 0) +
      (payload.usage?.output_tokens ?? 0) +
      (payload.usage?.cache_creation_input_tokens ?? 0) +
      (payload.usage?.cache_read_input_tokens ?? 0),
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
    lastTurnInjection: state.lastSelfDrivePromptInjection,
    evidenceVocabHint: state.evidenceVocabHint,
    userInterjections: gatherUserInterjections(),
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

  // Phase D.3 — compute diagnostics tags for the run-log surface.
  const interjectionCount = orchestratorInput.userInterjections?.length ?? 0;
  const diagnosticsTags = buildDecisionDiagnostics(
    decision,
    useSelfDriveStore.getState(),
    interjectionCount,
  );
  addLogEntry(
    state.currentSessionIndex!,
    "decision",
    decision.summary,
    decision,
    undefined,
    undefined,
    diagnosticsTags.length > 0 ? diagnosticsTags : undefined,
  );

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
    // A turn that completes from "rechecking" is a follow-up verification
    // response — re-evaluate it under verify rules so the orchestrator can
    // decide advance / fix / another recheck / pause.
    case "rechecking": return "verifying";
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
    case "request_recheck":
      await handleRecheck(decision);
      break;
  }
}

// ── Step handlers ───────────────────────────────────────────────────

type VerifyKind = "static" | "side-effect" | "behavioral" | "integration";

/**
 * Normalize a verify-check label for fuzzy comparison.
 *
 * Orchestrators regularly emit labels that differ from the session's
 * canonical label by whitespace, backticks, surrounding punctuation, or
 * by stripping the leading `[kind]` prefix. These variations have no
 * semantic meaning — matching on them verbatim just creates false
 * "missing + unknown label" pairs. Normalize first, then compare.
 */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    // Strip a leading "[kind]" tag like "[static] " or "[behavioral]".
    .replace(/^\s*\[(?:static|side-effect|behavioral|integration)\]\s*/i, "")
    // Collapse runs of whitespace to a single space.
    .replace(/\s+/g, " ")
    // Remove backticks anywhere.
    .replace(/`/g, "")
    // Trim edge punctuation that commonly varies (parentheses, quotes, colons).
    .replace(/^[\s"'(:.,]+|[\s"')?!:.,]+$/g, "")
    .trim();
}

/**
 * Levenshtein distance (iterative, two-row). Small strings only — we
 * never compare anything close to the quadratic ceiling here.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Fuzzy-match orchestrator result labels against session verify labels.
 *
 * A session label S matches a result label R when any of:
 *   - normalize(S) === normalize(R)
 *   - one normalised form is a prefix of the other (orchestrators often
 *     truncate or expand trailing parentheticals)
 *   - Levenshtein distance on the normalised forms ≤ 20% of the shorter
 *     length (small edits, typos, word re-ordering in short labels)
 *
 * Each session label pairs with at most one result label (first match
 * wins in session-order). Unmatched session labels + unmatched result
 * labels are returned for the caller to decide what to do.
 *
 * Exported for tests and diagnostics.
 */
export function fuzzyLabelMatch(
  sessionLabels: string[],
  resultLabels: string[],
): {
  matched: Map<string, string>; // session label → matched result label
  unmatchedSessionLabels: string[];
  unmatchedResultLabels: string[];
} {
  const matched = new Map<string, string>();
  const usedResults = new Set<number>();

  const norm = (s: string) => normalizeLabel(s);
  const sNorm = sessionLabels.map(norm);
  const rNorm = resultLabels.map(norm);

  for (let i = 0; i < sessionLabels.length; i++) {
    const s = sNorm[i];
    if (!s) continue;
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let j = 0; j < resultLabels.length; j++) {
      if (usedResults.has(j)) continue;
      const r = rNorm[j];
      if (!r) continue;
      if (s === r) {
        // Exact match wins outright — no further scoring needed.
        bestIdx = j;
        break;
      }
      // Word-boundary prefix match: the shorter normalised form is a
      // prefix of the longer AND ends at a word boundary (or the shorter
      // is itself ≥4 chars and the longer is at most 3× its length).
      // This accepts "check b" ↔ "check b with parenthetical" (prefix
      // + space boundary) but rejects "check" ↔ "check b and also c"
      // where the prefix is too generic.
      const longer = s.length >= r.length ? s : r;
      const shorter = s.length >= r.length ? r : s;
      if (
        shorter.length >= 4 &&
        longer !== shorter &&
        longer.startsWith(shorter) &&
        (longer.charAt(shorter.length) === " " ||
          longer.length <= shorter.length * 3)
      ) {
        const score = shorter.length * 0.5;
        if (score < bestScore) {
          bestIdx = j;
          bestScore = score;
        }
      }
      const shorterLen = Math.min(s.length, r.length);
      const budget = Math.max(2, Math.floor(shorterLen * 0.2));
      const d = levenshtein(s, r);
      if (d <= budget && d < bestScore) {
        bestIdx = j;
        bestScore = d;
      }
    }
    if (bestIdx >= 0) {
      matched.set(sessionLabels[i], resultLabels[bestIdx]);
      usedResults.add(bestIdx);
    }
  }

  const unmatchedSessionLabels = sessionLabels.filter((l) => !matched.has(l));
  const unmatchedResultLabels = resultLabels.filter(
    (_, j) => !usedResults.has(j),
  );

  return { matched, unmatchedSessionLabels, unmatchedResultLabels };
}

/**
 * Assess the orchestrator's "advance" verdict for STRUCTURAL integrity
 * only. This replaces the old `validateVerifyAdvance` + `analyzeVerifyAdvance`
 * pair, which did substring format checks (must contain `:`, `$ `,
 * `mocks=`, `caller=`, etc.) on the orchestrator's evidence strings and
 * blocked on mismatches. That was second-guessing the LLM's judgment
 * with a strictly worse oracle — the orchestrator sees the full verifier
 * response and applies context (spec-declared deferral, intent-over-form,
 * etc.) that a substring check cannot.
 *
 * New contract: the orchestrator is the authoritative judge. The client
 * validator's job is to catch STRUCTURAL violations that indicate the
 * verdict is untrustworthy as data:
 *
 *   1. `checkResults` is empty on an "advance" (internally inconsistent).
 *   2. ≥50% of session labels have no fuzzy match in results (the
 *      orchestrator fabricated labels or skipped checks wholesale).
 *   3. Zero `passed:true` entries on an "advance" (internally inconsistent).
 *
 * Anything else — label drift that fuzzy-matched, `passed:false` items,
 * evidence in a non-canonical shape — is a WARNING, not a block. Warnings
 * are surfaced in the run log so the user can audit; they do not pause
 * Self-Drive.
 *
 * The mock-only-PASS defence lives in the orchestrator's system prompt
 * (VERIFY_MODE_PREAMBLE) and, definitively, in the rg-based parity gate
 * (`verifyActionParity`). It does not live here anymore.
 */
export function assessVerifyAdvance(
  session: {
    verifyChecks: { label: string; kind?: VerifyKind }[];
  },
  decision: OrchestratorDecision,
): {
  structuralError: string | null;
  warnings: string[];
  matchedResults: Map<string, { label: string; passed: boolean; skipped?: boolean; evidence?: string; reason?: string }>;
} {
  const results = decision.checkResults ?? [];
  const warnings: string[] = [];
  const matchedResults = new Map<string, { label: string; passed: boolean; skipped?: boolean; evidence?: string; reason?: string }>();

  if (results.length === 0) {
    return {
      structuralError: "orchestrator returned advance with no checkResults (internally inconsistent)",
      warnings,
      matchedResults,
    };
  }

  const sessionLabels = session.verifyChecks.map((c) => c.label);
  const resultLabels = results.map((r) => r.label);
  const { matched, unmatchedSessionLabels, unmatchedResultLabels } =
    fuzzyLabelMatch(sessionLabels, resultLabels);

  // Build the matched map keyed by session label for the toggle loop.
  const resultsByLabel = new Map(results.map((r) => [r.label, r]));
  for (const [sessionLabel, resultLabel] of matched) {
    const r = resultsByLabel.get(resultLabel);
    if (r) matchedResults.set(sessionLabel, r);
  }

  // Structural check 2: ≥50% of session labels unmatched → the
  // orchestrator lost the plot or fabricated the verdict.
  const total = sessionLabels.length;
  const unmatchedFraction = total > 0 ? unmatchedSessionLabels.length / total : 0;
  if (unmatchedFraction >= 0.5) {
    return {
      structuralError: `${unmatchedSessionLabels.length}/${total} session labels have no match in the verdict (orchestrator likely fabricated or skipped)`,
      warnings,
      matchedResults,
    };
  }

  // Structural check 3: no passed:true AND no skipped:true entries on an
  // advance. A verdict with only passed:false items contradicts "advance"
  // — the orchestrator should have emitted "fix" or "pause". Skipped is
  // accepted as a satisfied state (see handleAdvance gate below).
  const anySatisfied = results.some((r) => r.passed || r.skipped);
  if (!anySatisfied) {
    return {
      structuralError: "orchestrator returned advance but no checkResults entry is passed:true or skipped:true",
      warnings,
      matchedResults,
    };
  }

  // From here down, everything is advisory.
  // Count non-exact (i.e. fuzzy-matched) pairs — these indicate the
  // orchestrator's label drifted from the session's canonical label.
  // Not a problem (match still succeeded), but worth logging.
  let driftCount = 0;
  for (const [sessionLabel, resultLabel] of matched) {
    if (sessionLabel !== resultLabel) driftCount++;
  }
  if (driftCount > 0) {
    warnings.push(
      `${driftCount} label(s) fuzzy-matched with wording drift — orchestrator's text differs from the session's canonical label`,
    );
  }
  if (unmatchedSessionLabels.length > 0) {
    warnings.push(
      `${unmatchedSessionLabels.length} session label(s) have no match in the verdict`,
    );
  }
  if (unmatchedResultLabels.length > 0) {
    warnings.push(
      `${unmatchedResultLabels.length} result label(s) did not correspond to any session label; treated as advisory`,
    );
  }

  return { structuralError: null, warnings, matchedResults };
}

/**
 * Compose a targeted `request_recheck` prompt. Used by handleAdvance
 * only when the orchestrator's verdict is STRUCTURALLY near-miss (20–50%
 * unmatched session labels) — genuine format quibbles flow through the
 * orchestrator's own `request_recheck` path now and don't hit this
 * fallback.
 */
function composeStructuralRecheckPrompt(
  unmatchedSessionLabels: string[],
  session: { verifyChecks: { label: string; kind?: VerifyKind }[] },
): string {
  const kindByLabel = new Map(
    session.verifyChecks.map((c) => [c.label, c.kind ?? "static"]),
  );
  const lines: string[] = [
    "A few verify items did not appear in the previous response. Re-state ONLY the items below — do NOT re-do others.",
    "",
  ];
  unmatchedSessionLabels.forEach((label, i) => {
    const kind = kindByLabel.get(label) ?? "static";
    lines.push(`${i + 1}. [${kind}] ${label}`);
  });
  lines.push("");
  lines.push(
    "Emit one PASS/FAIL/SKIPPED line per item in the preamble's required form for the item's [kind]. End with `Verified X/Y | PASS n · FAIL n · SKIPPED n`.",
  );
  return lines.join("\n");
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
  //
  // "rechecking" is ALSO a verify-class phase: a decision returned after
  // an auto-recheck is semantically a verify decision (the orchestrator
  // evaluated the merged verifier+recheck response). Without treating it
  // as such, the checks would never get ticked on the recheck path and
  // attemptMarkSessionComplete would reject with "checks-incomplete",
  // surfacing as a confusing "unexpected state" pause to the user.
  //
  // "fixing" is also verify-class when the orchestrator returns advance
  // with checkResults: a post-fix advance carries the orchestrator's
  // judgment of every verify item against the fixed code. Same logic —
  // without ticking, attemptMarkSessionComplete fails on checks-incomplete
  // and the user sees the catch-all pause even though every check passed.
  const fromVerifyClass =
    previousPhase === "verifying" ||
    previousPhase === "rechecking" ||
    (previousPhase === "fixing" && (decision.checkResults?.length ?? 0) > 0);
  if (session && fromVerifyClass) {
    const assessment = assessVerifyAdvance(session, decision);

    // Structural integrity first: if the orchestrator's verdict is
    // empty, contains no passed:true entries, or ≥50% of session labels
    // went unmatched, pause immediately. Rechecking an orchestrator that
    // fabricated or skipped half the verdict is unlikely to help and
    // burns the recheck budget.
    if (assessment.structuralError) {
      addLogEntry(sessionIndex, "verifying", `Advance rejected: ${assessment.structuralError}`);
      handlePause(
        `Self-Drive halted: ${assessment.structuralError}. Review the run log and continue manually.`,
      );
      return;
    }

    // Partial-match recovery: some session labels went unmatched but
    // fewer than 50%. Ask the verifier to fill in just those items.
    const sessionLabels = session.verifyChecks.map((c) => c.label);
    const resultLabels = (decision.checkResults ?? []).map((r) => r.label);
    const { unmatchedSessionLabels } = fuzzyLabelMatch(sessionLabels, resultLabels);
    const settingsState = useSettingsStore.getState().settings;
    const recheckEnabled = settingsState.selfDriveEnableRecheckLoop ?? true;
    const currentState = useSelfDriveStore.getState();
    const roundsRemaining = MAX_RECHECK_ROUNDS - currentState.recheckRoundsUsed;
    const eligibleLabels = unmatchedSessionLabels.filter(
      (label) => (currentState.rechecksPerItem[label] ?? 0) < MAX_RECHECKS_PER_ITEM,
    );
    if (
      unmatchedSessionLabels.length > 0 &&
      recheckEnabled &&
      roundsRemaining > 0 &&
      eligibleLabels.length > 0
    ) {
      addLogEntry(
        sessionIndex,
        "verifying",
        `${unmatchedSessionLabels.length}/${sessionLabels.length} label(s) unmatched — auto-requesting recheck for ${eligibleLabels.length}`,
      );
      const recheckDecision: OrchestratorDecision = {
        action: "request_recheck",
        summary: `Auto-recheck: ${eligibleLabels.length} unmatched label(s)`,
        confidence: "medium",
        recheckItems: eligibleLabels,
        recheckPrompt: composeStructuralRecheckPrompt(eligibleLabels, session),
        checkResults: decision.checkResults,
      };
      await handleRecheck(recheckDecision);
      return;
    }

    // Advisory warnings — surface in the run log so the user can audit,
    // but do NOT block. This is the whole point of the trust-the-
    // orchestrator shift: the LLM judged, we accept.
    if (assessment.warnings.length > 0) {
      addLogEntry(
        sessionIndex,
        "verifying",
        `Orchestrator advanced with warnings: ${assessment.warnings.join("; ")}`,
      );
    }

    // Tick the checks the orchestrator confirmed passed OR explicitly
    // skipped (optional items judged not-applicable for this session, e.g.
    // integration test with no credentials). Uses the fuzzy-matched map so
    // a slightly-different label in the result still ticks the session's
    // canonical check. Without this, a fuzzy-matched label would leave the
    // session check unchecked and attemptMarkSessionComplete would fail
    // with "checks-incomplete".
    const skippedLabels: string[] = [];
    for (const check of session.verifyChecks) {
      const r = assessment.matchedResults.get(check.label);
      if ((r?.passed || r?.skipped) && !check.checked) {
        toggleVerifyCheckForSession(sessionIndex, check.id);
        if (r?.skipped && !r?.passed) skippedLabels.push(check.label);
      }
    }
    if (skippedLabels.length > 0) {
      addLogEntry(
        sessionIndex,
        "verifying",
        `Skipped (not-applicable) items accepted: ${skippedLabels.join(", ")}`,
      );
    }

    // H3: matched-but-failed recheck. If the orchestrator returned
    // "advance" with some items at passed:false (not skipped), those items
    // stayed unchecked above. Before pausing, consider auto-recheck — this
    // catches the case where the orchestrator over-eagerly emits "advance"
    // while one or two items have weak evidence that a targeted re-state
    // could fix. Eligible items are those with recheck budget remaining
    // that have a matched-but-failed verdict. Unmatched-label recheck
    // already fired above.
    const matchedFailed: string[] = [];
    for (const check of session.verifyChecks) {
      if (check.checked) continue;
      const r = assessment.matchedResults.get(check.label);
      if (r && !r.passed && !r.skipped) matchedFailed.push(check.label);
    }
    const recheckEnabledH3 = settingsState.selfDriveEnableRecheckLoop ?? true;
    const stateH3 = useSelfDriveStore.getState();
    const roundsRemainingH3 = MAX_RECHECK_ROUNDS - stateH3.recheckRoundsUsed;
    const eligibleFailedForRecheck = matchedFailed.filter(
      (label) => (stateH3.rechecksPerItem[label] ?? 0) < MAX_RECHECKS_PER_ITEM,
    );
    if (
      matchedFailed.length > 0 &&
      recheckEnabledH3 &&
      roundsRemainingH3 > 0 &&
      eligibleFailedForRecheck.length > 0
    ) {
      addLogEntry(
        sessionIndex,
        "verifying",
        `${matchedFailed.length} item(s) matched but marked passed:false — auto-requesting recheck for ${eligibleFailedForRecheck.length}`,
      );
      const recheckDecision: OrchestratorDecision = {
        action: "request_recheck",
        summary: `Auto-recheck: ${eligibleFailedForRecheck.length} matched-but-failed item(s)`,
        confidence: "medium",
        recheckItems: eligibleFailedForRecheck,
        recheckPrompt: composeStructuralRecheckPrompt(eligibleFailedForRecheck, session),
        checkResults: decision.checkResults,
      };
      await handleRecheck(recheckDecision);
      return;
    }

    // Defense-in-depth: if anything stayed unchecked, do not advance.
    const freshSession = useSelfDriveStore.getState().guide?.sessions
      .find((s) => s.index === sessionIndex);
    const stillUnchecked = freshSession?.verifyChecks.filter((c) => !c.checked) ?? [];
    if (stillUnchecked.length > 0) {
      const uncheckedLabels = stillUnchecked.map((c) => c.label).join(", ");
      addLogEntry(
        sessionIndex,
        "verifying",
        `Advance rejected: ${stillUnchecked.length} check(s) remain unchecked — ${uncheckedLabels}`,
      );
      handlePause(
        `Self-Drive halted: ${stillUnchecked.length} check(s) could not be confirmed (${uncheckedLabels}). Review the run log and continue manually.`,
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
      // Honour DEFERRED:<action> lines Claude Code emitted on the prior
      // turn (typically in response to a previous parity-recovery prompt).
      // Any failing row whose action appears in a DEFERRED line is treated
      // as explicitly waived; if every failure is waived, advance the
      // session via the bypass path. Otherwise, route the remaining rows
      // through the parity-recovery loop instead of halting outright.
      const state = useSelfDriveStore.getState();
      const deferred = parseDeferredParityRows(state.lastClaudeResponse ?? "");
      const allFailed = outcome.results.filter((r) => r.status !== "PASS");
      const stillFailing = allFailed.filter((r) => !deferred.has(r.action));

      if (stillFailing.length === 0 && allFailed.length > 0) {
        addLogEntry(
          sessionIndex,
          "advancing",
          `Parity gate satisfied via DEFERRED — ${[...deferred].join(", ")}`,
        );
        const bypassOutcome = await attemptMarkSessionComplete(sessionIndex, {
          skipParityGate: true,
        });
        if (!bypassOutcome.ok) {
          handlePause(
            `Self-Drive halted: parity DEFERRED but session could not be marked complete (${bypassOutcome.reason})`,
          );
          return;
        }
        // Fall through to the normal post-complete tail of handleAdvance.
      } else {
        const freshSession = guide?.sessions.find((s) => s.index === sessionIndex);
        await handleParityRecovery(
          sessionIndex,
          stillFailing,
          deriveCallerPaths(freshSession?.files ?? []),
          freshSession?.crossSystemActions ?? [],
        );
        return;
      }
    } else if (outcome.reason === "parity-errored") {
      const erroredActions = outcome.results
        .map((r) => `${r.action}: ${r.detail}`)
        .join(" | ");
      addLogEntry(
        sessionIndex,
        "verifying",
        `Parity check errored (not a real FAIL) — ${erroredActions}`,
      );
      handlePause(
        `Self-Drive halted: the parity check itself errored. This is NOT a code failure — the rg-based scan could not complete. Check that ripgrep is installed and the workspace is readable, then click Resume to retry.`,
      );
      return;
    }
    const alreadyDone = guide?.sessions
      .find((s) => s.index === sessionIndex)?.status === "done";
    if (!alreadyDone) {
      // Surface the real `reason` from attemptMarkSessionComplete instead of
      // the historical "unexpected state" catch-all — that string told the
      // user nothing and the structured reason was being silently discarded.
      // The only paths that reach here now are `checks-incomplete` (most
      // common: handleAdvance was entered from a non-verify-class phase, so
      // verifyChecks were never auto-ticked) and `session-not-found`.
      const freshSession = useSelfDriveStore.getState().guide?.sessions
        .find((s) => s.index === sessionIndex);
      let detail: string;
      if (outcome.reason === "checks-incomplete") {
        const unchecked = (freshSession?.verifyChecks ?? [])
          .filter((c) => !c.checked)
          .map((c) => c.label);
        const fromPhase = previousPhase ?? "unknown";
        detail = unchecked.length > 0
          ? `${unchecked.length} verify check(s) not ticked (entered handleAdvance from phase "${fromPhase}"): ${unchecked.join(", ")}`
          : `attemptMarkSessionComplete returned checks-incomplete but every check is ticked — internal state drift (phase "${fromPhase}")`;
      } else {
        detail = `${outcome.reason} (phase "${previousPhase ?? "unknown"}")`;
      }
      handlePause(`Could not mark Session ${sessionIndex} complete — ${detail}`);
      return;
    }
  }

  // Log check details for human review, including evidence citations.
  if (decision.checkResults?.length) {
    const checkSummary = decision.checkResults
      .map((r) => {
        const verdict = r.passed ? "PASS" : r.skipped ? "SKIP" : "FAIL";
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

  // Session advanced — clear recheck bookkeeping so the next session
  // starts with a fresh budget and no stale verifier responses.
  useSelfDriveStore.setState({
    recheckRoundsUsed: 0,
    rechecksPerItem: {},
    originalVerifierResponse: null,
    recheckResponses: [],
    pinnedCheckResults: [],
  });

  // Re-read config from settings (user may have toggled options mid-run)
  const liveConfig = getConfigFromSettings();

  // Snapshot pre-advance activity counters BEFORE the recheck/fix bookkeeping
  // reset above clobbers them. If this session needed any fix attempts or
  // verify-rechecks to get here, the inter-session test gate is suppressed —
  // Claude Code already validated the fixes; an injected pnpm test run would
  // (a) be redundant and (b) confuse the orchestrator on the next turn (it
  // would see "pnpm test ran" without knowing the system injected it, and
  // may flag it as evidence-skipping behavior — see plan A.1).
  const preAdvanceState = useSelfDriveStore.getState();
  const sessionHadFixActivity =
    preAdvanceState.fixAttempt > 0 || preAdvanceState.recheckRoundsUsed > 0;

  // Optional: run tests between sessions. Skip if:
  //  - we're coming from a test/commit phase (existing dedup)
  //  - the session needed fix attempts or rechecks (Claude already verified)
  if (
    liveConfig.runTests &&
    getTestCommand() &&
    previousPhase !== "testing" &&
    previousPhase !== "committing" &&
    !sessionHadFixActivity
  ) {
    useSelfDriveStore.setState({ currentPhase: "testing" });
    const testPrompt =
      `Run the test suite: \`${getTestCommand()}\` to completion in the foreground (do NOT use run_in_background — wait for the command to exit). ` +
      `When it finishes, report the exit code and which tests passed or failed.`;
    addLogEntry(sessionIndex, "testing", `Running test suite: ${getTestCommand()}`, undefined, testPrompt);
    await sendMessageToSession(testPrompt, "test-gate");
    return; // wait for turn_complete → orchestrator evaluates
  }
  if (sessionHadFixActivity && liveConfig.runTests && getTestCommand()) {
    addLogEntry(
      sessionIndex,
      "advancing",
      `Inter-session test gate skipped (session had ${preAdvanceState.fixAttempt} fix attempt(s), ${preAdvanceState.recheckRoundsUsed} recheck round(s)) — Claude already validated`,
    );
  }

  // Optional: git commit between sessions (skip if coming from commit phase)
  if (liveConfig.autoCommit && previousPhase !== "committing") {
    useSelfDriveStore.setState({ currentPhase: "committing" });
    const plan = getCurrentSessionPlan(sessionIndex, useSelfDriveStore.getState().guide);
    const commitPrompt = `Commit the current changes with message: "Session ${sessionIndex}: ${plan?.name ?? "implementation"}"`;
    addLogEntry(sessionIndex, "committing", `Committing Session ${sessionIndex}`, undefined, commitPrompt);
    await sendMessageToSession(commitPrompt, "commit-gate");
    return; // wait for turn_complete → then advance
  }

  // Move to next session
  await startNextSession();
}

export async function handleVerify(): Promise<void> {
  const state = useSelfDriveStore.getState();
  const sessionIndex = state.currentSessionIndex!;
  // Read the pinned guide; the UI's guide may be on a different project.
  const guide = state.guide;
  if (!guide) {
    handlePause(
      "Self-Drive cannot verify: pinned guide missing. Stop and restart Self-Drive on this project.",
    );
    return;
  }

  const session = guide.sessions.find((s) => s.index === sessionIndex);
  if (!session) {
    handlePause(
      `Self-Drive cannot verify: Session ${sessionIndex} not found in pinned guide. Stop and restart Self-Drive on this project.`,
    );
    return;
  }

  useSelfDriveStore.setState({ currentPhase: "verifying" });

  const verifyPrompt = buildSessionVerifyPrompt(session, guide.specFilename);
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
    // The code is about to change. The recheck loop's stashed
    // verifier response no longer matches reality — clear it so the next
    // verifying turn starts a fresh cycle.
    originalVerifierResponse: null,
    recheckResponses: [],
    recheckRoundsUsed: 0,
    rechecksPerItem: {},
    pinnedCheckResults: [],
  });

  addLogEntry(
    state.currentSessionIndex!,
    isRecovering ? "blocker-verifying" : "fixing",
    `${isRecovering ? "Recovery retry" : "Fix attempt"} ${fixAttempt}/${state.maxFixAttempts}: ${decision.summary}`,
    undefined,
    decision.fixPrompt,
  );

  showToast(`${isRecovering ? "Retrying recovery" : "Fix applied, re-checking"}... (${fixAttempt}/${state.maxFixAttempts})`, "info");
  await sendMessageToSession(
    wrapWithPreambleTracking("fix", state.currentSessionIndex!, decision.fixPrompt!),
  );
}

/**
 * Run one round of parity-failure recovery. Mirrors `handleFix` — same
 * fixAttempt counter, same maxFixAttempts ceiling, same chat envelope —
 * so a session that burns one attempt on a build fix and two on parity
 * still tops out at the configured budget. The recovery prompt is built
 * client-side here (not by the orchestrator) because the orchestrator
 * never sees the parity result; the gate runs after it approves advance.
 *
 * When the ceiling is hit, halt with the same shape the gate used to
 * fire on the first FAIL — preserves today's halt copy at the boundary.
 *
 * Note: this function intentionally does NOT reset originalVerifierResponse
 * the way handleFix does. The recovery prompt is a build-mode fix, but
 * the goal is for the NEXT turn to be a re-verify (orchestrator decides),
 * and if it is, the prior verifier text is still relevant context.
 */
async function handleParityRecovery(
  sessionIndex: number,
  failed: ActionParityResult[],
  callerPaths: string[],
  actions: CrossSystemAction[],
): Promise<void> {
  const state = useSelfDriveStore.getState();
  const fixAttempt = state.fixAttempt + 1;

  if (fixAttempt > state.maxFixAttempts) {
    const summary = failed.map((r) => `${r.action}: ${r.detail}`).join(" | ");
    addLogEntry(
      sessionIndex,
      "verifying",
      `Parity recovery exhausted (${state.maxFixAttempts}/${state.maxFixAttempts}) — ${summary}`,
    );
    handlePause(
      `Self-Drive halted: cross-system action parity check failed after ${state.maxFixAttempts} recovery attempts. ${summary}`,
    );
    return;
  }

  const recoveryPrompt = buildParityRecoveryPrompt({
    failed,
    callerPaths,
    actions,
  });

  useSelfDriveStore.setState({
    currentPhase: "fixing",
    fixAttempt,
    previousFixPrompts: [...state.previousFixPrompts, recoveryPrompt],
    originalVerifierResponse: null,
    recheckResponses: [],
    recheckRoundsUsed: 0,
    rechecksPerItem: {},
    pinnedCheckResults: [],
  });

  const failedLabels = failed.map((r) => r.action).join(", ");
  addLogEntry(
    sessionIndex,
    "fixing",
    `Parity-recovery attempt ${fixAttempt}/${state.maxFixAttempts}: ${failedLabels}`,
    undefined,
    recoveryPrompt,
  );
  showToast(
    `Parity recovery (${fixAttempt}/${state.maxFixAttempts})...`,
    "info",
  );
  await sendMessageToSession(
    wrapWithPreambleTracking("fix", sessionIndex, recoveryPrompt),
    "parity-recovery",
  );
}

/**
 * Handle an orchestrator `request_recheck` decision: ask Claude Code to
 * re-state evidence for specific verify items, and prepare Self-Drive
 * to evaluate the follow-up under verify rules.
 *
 * Guards (all enforced here — the orchestrator doesn't self-gatekeep):
 *   - Feature flag (settings.selfDrive.enableRecheckLoop). When off,
 *     request_recheck decisions fall through to pause.
 *   - `recheckRoundsUsed < MAX_RECHECK_ROUNDS`. Hit the cap → pause.
 *   - Each item in `decision.recheckItems` must not already have been
 *     rechecked this session (`rechecksPerItem[label] < MAX_RECHECKS_PER_ITEM`).
 *     Any item over the cap is stripped; if nothing remains → pause.
 *   - `decision.recheckPrompt` must be non-empty and ≤ 2000 chars
 *     (parser already enforced; this is defence-in-depth).
 *
 * Pins `decision.checkResults` (the per-item verdict the orchestrator
 * made THIS round) into state so items NOT in recheckItems keep their
 * earlier verdict when the orchestrator re-evaluates. Without this
 * pin, the next round's orchestrator might lose visibility into which
 * items were already accepted.
 */
async function handleRecheck(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  const sessionIndex = state.currentSessionIndex!;
  const settings = useSettingsStore.getState().settings;
  const enabled = settings.selfDriveEnableRecheckLoop ?? true;

  if (!enabled) {
    handlePause(
      `Orchestrator requested a recheck (${decision.summary}), but the recheck loop is disabled in settings — pausing for user review.`,
      decision,
    );
    return;
  }

  if (state.recheckRoundsUsed >= MAX_RECHECK_ROUNDS) {
    handlePause(
      `Orchestrator exhausted recheck budget (${MAX_RECHECK_ROUNDS} rounds) — pausing for user review. ${decision.summary}`,
      decision,
    );
    return;
  }

  const requested = decision.recheckItems ?? [];
  const alreadyRechecked: string[] = [];
  const eligible: string[] = [];
  for (const label of requested) {
    const count = state.rechecksPerItem[label] ?? 0;
    if (count >= MAX_RECHECKS_PER_ITEM) {
      alreadyRechecked.push(label);
    } else {
      eligible.push(label);
    }
  }

  // Phase B.1 — deterministic loop guard. Before sending another recheck
  // prompt, ask the guard whether each requested label has already been
  // re-asked + re-answered enough times to short-circuit:
  //   - "accept": orchestrator looped; worker provided evidence ≥2 times;
  //     force-credit the item rather than asking yet again
  //   - "pause": orchestrator looped; worker has produced NO concrete
  //     evidence; genuine impasse, pause for user
  //   - "fresh"/"proceed": let the normal recheck round run
  const draftPrompt = (decision.recheckPrompt ?? "").trim();
  const priorResponses = [
    state.originalVerifierResponse ?? "",
    ...state.recheckResponses,
    state.lastClaudeResponse ?? "",
  ].filter((s) => s.length > 0);
  const loopReport = classifyRecheckBatch(
    eligible,
    state.previousFixPrompts,
    priorResponses,
    draftPrompt,
  );

  // Apply the guard verdicts:
  //  - drop "accept" items from eligible; we'll surface them in
  //    pinnedCheckResults as forced-PASS for the advance gate.
  //  - if any "pause" items remain, halt the recheck and pause.
  if (loopReport.pause.length > 0) {
    const pausedLabels = loopReport.pause.map((x) => x.label).join(", ");
    handlePause(
      `Loop-guard detected genuine impasse on: ${pausedLabels}. ` +
        loopReport.pause.map((x) => x.report.reason).join(" / "),
      decision,
    );
    return;
  }

  const forcedAccept = loopReport.accept;
  const proceedLabels = loopReport.proceed.map((x) => x.label);

  if (forcedAccept.length > 0) {
    // Synthesize PASS verdicts for force-accepted items and merge into
    // pinnedCheckResults so the next orchestrator round sees them as
    // already-decided. This avoids the "ask again, paraphrased" loop.
    const forcedResults = forcedAccept.map((x) => ({
      label: x.label,
      passed: true,
      skipped: false,
      reason: undefined,
      evidence: `loop-guard force-accept (asks=${x.report.askCount}, evidenceProvisions=${x.report.evidenceSignalsForLabel})`,
    }));
    const mergedPinned = [
      ...state.pinnedCheckResults.filter(
        (r) => !forcedAccept.some((x) => x.label === r.label),
      ),
      ...forcedResults,
    ];
    useSelfDriveStore.setState({ pinnedCheckResults: mergedPinned });
    for (const x of forcedAccept) {
      addLogEntry(
        sessionIndex,
        "verifying",
        `Loop-guard force-accept: ${x.label} — ${x.report.reason}`,
      );
    }
  }

  if (proceedLabels.length === 0 && forcedAccept.length > 0) {
    // Every requested label was force-accepted by the loop guard. There's
    // no real recheck to send — re-evaluate the orchestrator decision
    // from the original verifier response with the pinned forced passes.
    showToast(
      `Loop-guard accepted ${forcedAccept.length} item${forcedAccept.length === 1 ? "" : "s"}; re-evaluating`,
      "success",
    );
    // Treat as if the recheck round completed instantly with no new
    // worker output — leave the assembled response untouched and trigger
    // a fresh orchestrator pass on the next event tick by re-using the
    // verify path. The simplest re-entry: directly evaluate the current
    // (now augmented) pinnedCheckResults via handleVerify.
    await handleVerify();
    return;
  }

  // Replace eligible with proceedLabels for the remainder of the function.
  eligible.length = 0;
  for (const l of proceedLabels) eligible.push(l);

  if (eligible.length === 0) {
    const detail = alreadyRechecked.length > 0
      ? `items already rechecked once: ${alreadyRechecked.join(", ")}`
      : "no recheck items supplied";
    handlePause(
      `Recheck refused (${detail}) — pausing for user review. ${decision.summary}`,
      decision,
    );
    return;
  }

  const prompt = draftPrompt;
  if (prompt === "") {
    handlePause(
      `Recheck refused: orchestrator supplied no prompt text. ${decision.summary}`,
      decision,
    );
    return;
  }

  // Update counters and pin the current verdict before sending.
  const nextRechecksPerItem = { ...state.rechecksPerItem };
  for (const label of eligible) {
    nextRechecksPerItem[label] = (nextRechecksPerItem[label] ?? 0) + 1;
  }

  useSelfDriveStore.setState({
    currentPhase: "rechecking",
    recheckRoundsUsed: state.recheckRoundsUsed + 1,
    rechecksPerItem: nextRechecksPerItem,
    pinnedCheckResults: decision.checkResults ?? state.pinnedCheckResults,
  });

  const skippedNote = alreadyRechecked.length > 0
    ? ` (skipped ${alreadyRechecked.length} item${alreadyRechecked.length === 1 ? "" : "s"} already rechecked: ${alreadyRechecked.join(", ")})`
    : "";
  addLogEntry(
    sessionIndex,
    "verifying",
    `Recheck round ${state.recheckRoundsUsed + 1}/${MAX_RECHECK_ROUNDS}: ${eligible.length} item${eligible.length === 1 ? "" : "s"} — ${decision.summary}${skippedNote}`,
    decision,
    prompt,
  );
  showToast(
    `Re-checking ${eligible.length} item${eligible.length === 1 ? "" : "s"}... (${state.recheckRoundsUsed + 1}/${MAX_RECHECK_ROUNDS})`,
    "info",
  );

  await sendMessageToSession(prompt);
}

async function handleBuildCheck(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ currentPhase: "build-checking" });
  const cmd = decision.buildCommand || getBuildCommand() || "pnpm tsc --noEmit";
  const buildPrompt = `Run \`${cmd}\` and report any errors. If there are zero errors, say "Build clean."`;
  addLogEntry(state.currentSessionIndex!, "build-checking", `Build check: ${cmd}`, undefined, buildPrompt);
  await sendMessageToSession(buildPrompt, "build-check");
}

async function handleTest(decision: OrchestratorDecision): Promise<void> {
  const state = useSelfDriveStore.getState();
  useSelfDriveStore.setState({ currentPhase: "testing" });
  const cmd = decision.testCommand || getTestCommand() || "pnpm test";
  const testPrompt =
    `Run \`${cmd}\` to completion in the foreground (do NOT use run_in_background — wait for the command to exit). ` +
    `When it finishes, report the exit code and which tests passed or failed.`;
  addLogEntry(state.currentSessionIndex!, "testing", `Running tests: ${cmd}`, undefined, testPrompt);
  await sendMessageToSession(testPrompt, "test-dispatch");
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
  await sendMessageToSession(
    wrapWithPreambleTracking("build", nextSession.index, nextSession.prompt),
  );
  markPromptSentForSession(nextSession.index);
}

// ── Pause / Abort / Crash handlers ──────────────────────────────────

function handlePause(reason: string, decision?: OrchestratorDecision): void {
  const state = useSelfDriveStore.getState();

  // Pauses are otherwise invisible outside the running app — the run-log
  // is in-memory only. Routing through console.warn lets Tauri's webview
  // bridge mirror the line into the app log file so post-mortem analysis
  // can see what actually halted a run.
  console.warn(
    "[selfDrive] pause:",
    reason,
    {
      sessionIndex: state.currentSessionIndex,
      phase: state.currentPhase,
    },
  );

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
    orchestratorReasoning: decisionBlocker.orchestratorReasoning,
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
  await sendMessageToSession(prompt, "recovery");
}

/**
 * Validate an orchestrator "advance_recovery" verdict.
 * Returns null when the verdict can be trusted; otherwise a short reason.
 *
 * Rules (all must hold):
 *   1. There must be an active blocker to resolve.
 *   2. The decision.summary must look like evidence — long enough to be a
 *      real claim AND containing at least one structural marker (digits,
 *      quote/backtick characters, or punctuation that separates clauses).
 *      Bare verdicts like "resolved" / "done" / "all clear" fail; prose
 *      like "exits 0 on two consecutive runs (2707 passed each)" passes.
 *   3. Confidence must not be "low". (Low confidence on recovery is the
 *      worst place to trust the model — pause instead.)
 *
 * Exported for tests; not part of the store's public API.
 */
const RECOVERY_SUMMARY_MIN_LENGTH = 20;
const RECOVERY_SUMMARY_EVIDENCE_RE = /[\d`"']|[:;—–-]\s/u;

export function validateRecoveryResolution(
  blocker: Blocker | null,
  decision: OrchestratorDecision,
): string | null {
  if (!blocker) return "no active blocker to resolve";
  if (decision.action !== "advance_recovery") return "decision is not advance_recovery";
  const summary = decision.summary.trim();
  if (summary.length < RECOVERY_SUMMARY_MIN_LENGTH || !RECOVERY_SUMMARY_EVIDENCE_RE.test(summary)) {
    return "summary lacks evidence citation (need digits, quotes, or punctuated detail)";
  }
  if (decision.confidence === "low") return "low-confidence recovery verdict";
  return null;
}

/**
 * Detect a "user accepts this and wants to proceed" resolution. Used to
 * short-circuit the recovery round-trip for `kind: "unknown"` blockers
 * (typically flaky tests / one-off pause reasons) where re-running the
 * original failing command would just hit the same flake again.
 *
 * Scoped to "unknown" kind on purpose: structured kinds (infra-state-drift,
 * permissions, credentials, env-config, external-failure) genuinely benefit
 * from re-running the diagnostic command to confirm the world changed.
 *
 * Exported for tests.
 */
const ACCEPT_AND_PROCEED_RE = /^\s*(accept|skip|ignore|proceed|continue|override|dismiss|allow|move on)\b/iu;

export function isAcceptAndProceedResolution(text: string | null | undefined): boolean {
  if (!text) return false;
  return ACCEPT_AND_PROCEED_RE.test(text.trim());
}

/**
 * Post-recovery branching: pick up where the session was when the blocker
 * fired. Shared by handleAdvanceRecovery (orchestrator-cleared blocker)
 * and the user-override short-circuit path.
 */
async function continueAfterRecovery(sessionIndex: number): Promise<void> {
  const guide = useSelfDriveStore.getState().guide;
  const session = guide?.sessions.find((s) => s.index === sessionIndex);
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
    await sendMessageToSession(
      wrapWithPreambleTracking("build", session.index, session.prompt),
    );
    markPromptSentForSession(session.index);
  } else if (!session.verifyRequested) {
    await handleBuildCheck({ action: "build_check", summary: "Post-recovery build check", confidence: "high" });
  } else {
    await handleVerify();
  }
}

/**
 * Short-circuit recovery: the user explicitly accepted the situation and
 * wants Self-Drive to proceed. Mark the blocker resolved without sending
 * a recovery-verify turn to Claude Code, then continue the session.
 *
 * Why this exists: a flaky-test blocker (`kind: "unknown"`) is "verified"
 * by re-running the failing test, which on a flaky suite is structurally
 * guaranteed to surface a *different* flake eventually — turning the
 * accept-and-move-on click into an unbounded loop.
 */
async function acceptUserOverrideAsResolution(blocker: Blocker, resolution: string): Promise<void> {
  const resolved: Blocker = { ...blocker, status: "resolved", userResolution: resolution };
  const state = useSelfDriveStore.getState();
  addLogEntry(
    blocker.sessionIndex,
    "blocker-resolved",
    `User override accepted — proceeding without re-verification: ${resolution.slice(0, 200)}`,
    undefined,
    undefined,
    resolved,
  );
  useSelfDriveStore.setState({
    activeBlocker: null,
    blockerHistory: [...state.blockerHistory, resolved],
    status: "running",
    pauseReason: null,
  });
  showToast("Override accepted — resuming session", "success");
  await continueAfterRecovery(blocker.sessionIndex);
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

  await continueAfterRecovery(blocker.sessionIndex);
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
  diagnostics?: string[],
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
    diagnostics,
  };
  useSelfDriveStore.setState((prev) => ({
    runLog: [...prev.runLog, entry],
  }));
  // Every log entry is a natural persistence checkpoint — the run log IS
  // part of the snapshot, so this also captures phase changes, blockers,
  // decisions, etc. Debounced inside persistRunState().
  persistRunState();
}

/**
 * Phase D.3 — collect one-line diagnostic tags for a decision so the
 * RunLogViewer surfaces *why* the orchestrator chose this action. Pure
 * helper over the current state + decision.
 */
function buildDecisionDiagnostics(
  decision: OrchestratorDecision,
  state: SelfDriveState,
  interjectionCount: number,
): string[] {
  const out: string[] = [];

  // System-injected prompt context.
  if (state.lastSelfDrivePromptInjection) {
    out.push(`Graded a system-injected turn (${state.lastSelfDrivePromptInjection}) — Detectors A/B/C suppressed by HARD SUPPRESSION rule`);
  }

  // User interjections forwarded.
  if (interjectionCount > 0) {
    out.push(`Forwarded ${interjectionCount} user interjection(s) to orchestrator`);
  }

  // Evidence vocab active.
  if (state.evidenceVocabHint) {
    const firstLine = state.evidenceVocabHint.split("\n")[0];
    out.push(`Project evidence vocab active: ${firstLine.slice(0, 90)}`);
  }

  // Loop-guard force-accepts in this session.
  const forced = state.pinnedCheckResults.filter(
    (r) => typeof r.evidence === "string" && r.evidence.includes("loop-guard force-accept"),
  );
  if (forced.length > 0) {
    out.push(`Loop guard force-accepted ${forced.length} item(s): ${forced.map((r) => r.label).join(", ")}`);
  }

  // Recheck loop state.
  if (state.recheckRoundsUsed > 0) {
    out.push(`Recheck rounds used: ${state.recheckRoundsUsed}/2`);
  }

  // Blocker reasoning.
  if (decision.blocker?.orchestratorReasoning) {
    out.push(`Why paused: ${decision.blocker.orchestratorReasoning.slice(0, 200)}`);
  }

  // Low-confidence flag.
  if (decision.confidence === "low") {
    out.push(`Low confidence (lowCount=${state.lowConfidenceCount + 1}/3)`);
  }

  return out;
}

/**
 * Phase C.1 — gather detection inputs to choose the right evidence
 * vocabulary for this project. Best-effort: any individual probe failure
 * just leaves the corresponding flag `false`. The caller renders the
 * vocab hint once at session start and feeds it into every orchestrator
 * input on this run.
 */
async function gatherEvidenceVocabHint(projectPath: string): Promise<string | null> {
  const envPath = `${projectPath}/.env.local`;
  const supabaseConfigPath = `${projectPath}/supabase/config.toml`;

  const detection: EvidenceDetectionInputs = {
    hasSupabaseCloudUrl: false,
    hasLocalSupabaseConfig: false,
    hasDatabaseUrl: false,
    hasMcpSupabase: false,
    supabaseCliLinked: false,
  };

  // .env.local — look for VITE_SUPABASE_URL / SUPABASE_URL / DATABASE_URL.
  try {
    const envContent = await readFileContent(envPath);
    if (/^(VITE_)?SUPABASE_URL\s*=\s*\S+/m.test(envContent)) {
      detection.hasSupabaseCloudUrl = true;
    }
    if (/^(POSTGRES_URL|DATABASE_URL|SUPABASE_DB_URL)\s*=\s*\S+/m.test(envContent)) {
      detection.hasDatabaseUrl = true;
    }
  } catch {
    // No .env.local — leave flags false.
  }

  // supabase/config.toml — presence implies local stack.
  try {
    const cfg = await readFileContent(supabaseConfigPath);
    if (cfg.length > 0) detection.hasLocalSupabaseConfig = true;
  } catch {
    // No local config — fine.
  }

  // MCP Supabase: best-effort — check for a `.mcp.json` or
  // `.claude/settings.local.json` reference. Either presence is a soft
  // signal; absence doesn't disprove anything.
  try {
    const mcpJson = await readFileContent(`${projectPath}/.mcp.json`);
    if (mcpJson.includes("supabase")) detection.hasMcpSupabase = true;
  } catch {
    /* ignore */
  }

  // Supabase CLI linked: presence of `.supabase` dir at repo root.
  try {
    const linkFile = await readFileContent(`${projectPath}/supabase/.temp/project-ref`);
    if (linkFile.trim().length > 0) detection.supabaseCliLinked = true;
  } catch {
    /* ignore */
  }

  try {
    const vocab = inferVocab(detection);
    return renderVocabHint(vocab);
  } catch {
    return null;
  }
}

/**
 * Phase D.2 — collect non-Self-Drive user messages that arrived since the
 * orchestrator's last consultation. Bumps the watermark to the most
 * recent user message id seen so the next call won't re-forward the
 * same interjections. Returns at most the last 5 to keep the prompt
 * size bounded.
 */
function gatherUserInterjections(): Array<{ ts: number; text: string }> {
  const state = useSelfDriveStore.getState();
  const sessionId = state.sessionId;
  if (!sessionId) return [];
  const msgs = useSessionStore.getState().sessionMessages.get(sessionId) ?? [];

  const watermark = state.orchestratorLastUserMessageId;
  let startIdx = 0;
  if (watermark) {
    const wmIdx = msgs.findIndex((m) => m.id === watermark);
    if (wmIdx >= 0) startIdx = wmIdx + 1;
  }

  const interjections: Array<{ ts: number; text: string }> = [];
  let newestSeen: string | null = null;
  for (let i = startIdx; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "user" && !m.isSelfDrive && (m.content ?? "").trim().length > 0) {
      interjections.push({
        ts: Date.parse(m.timestamp) || Date.now(),
        text: m.content,
      });
      newestSeen = m.id;
    }
  }
  if (newestSeen) {
    useSelfDriveStore.setState({ orchestratorLastUserMessageId: newestSeen });
  }
  return interjections.slice(-5);
}

/**
 * Phase C.3 — wrap a build/fix prompt with the right preamble for the
 * current point in the session. First turn of a (kind, sessionIndex)
 * pair gets the FULL senior-engineer contract; subsequent turns get the
 * compressed reference. Records the pairing in state so next call sees
 * "already sent". Idempotent.
 */
function wrapWithPreambleTracking(
  kind: "build" | "fix",
  sessionIndex: number,
  prompt: string,
): string {
  const key = `${kind}:${sessionIndex}`;
  const state = useSelfDriveStore.getState();
  const isFirst = !state.preambleSent.includes(key);
  if (isFirst) {
    useSelfDriveStore.setState({
      preambleSent: [...state.preambleSent, key],
    });
  }
  return wrapBuildPrompt(prompt, kind, isFirst);
}

async function sendMessageToSession(
  prompt: string,
  injection?: SelfDriveInjectionKind,
): Promise<void> {
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
    selfDriveInjection: injection,
  });
  // Record the prompt's message id so handleTurnComplete can scan forward
  // from it and collect ALL subsequent assistant messages — not just the
  // last one. Fixes the "verifier response truncated — only item 5 visible"
  // bug: verifiers often emit one assistant message per item (each wrapped
  // around a tool-use call), so `lastAssistant` alone loses items 1..N-1.
  // The injection kind (if any) is also stashed so the orchestrator on the
  // next turn knows the worker was reacting to a system-gated prompt and
  // can suppress ACTIVITY-EVIDENCE detectors accordingly (Phase A.2).
  useSelfDriveStore.setState({
    lastSelfDrivePromptMessageId: msgId,
    lastSelfDrivePromptInjection: injection ?? null,
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
        orchestratorReasoning: blocker.orchestratorReasoning,
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
 * Imperative (non-hook) check: does Self-Drive currently own the guide for
 * the given project path? Use from event handlers when you need to decide
 * whether a UI mutation should route through selfDriveStore's helpers
 * (which also mirror into guideStore) or directly into guideStore.
 */
export function isSelfDriveOwningProject(projectPath: string | null): boolean {
  if (!projectPath) return false;
  const state = useSelfDriveStore.getState();
  if (state.projectPath !== projectPath) return false;
  return state.status === "running" || state.status === "paused";
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
