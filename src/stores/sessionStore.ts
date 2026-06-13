import { create } from "zustand";
import type { Session, Message, TurnStats, SessionStats, SessionMode, SessionStatus, ThinkingEffort } from "../types/session";
import type { CapabilitiesDiscoveredEvent } from "../types/agent-events";
import type { SubAgentInfo } from "../types/activity";
import { useSettingsStore } from "./settingsStore";
import { useFileViewerStore } from "./fileViewerStore";

interface StreamingState {
  isStreaming: boolean;
  streamingContent: string;
  currentMessageId: string | null;
}

interface RetryState {
  isRetrying: boolean;
  retryAttempt: number;
  retryAt: number | null; // timestamp when next retry fires
  retryTimerId: ReturnType<typeof setTimeout> | null;
}

/** Tracks what Claude is currently doing for UI display. */
export interface SessionActivityInfo {
  label: string;        // e.g., "Reading files...", "Editing code..."
  toolName: string | null;
  toolElapsed: number;  // seconds
  filePath: string | null;  // file_path from tool_input (for file-based tools)
}

const DEFAULT_ACTIVITY: SessionActivityInfo = {
  label: "Thinking...",
  toolName: null,
  toolElapsed: 0,
  filePath: null,
};

/** Watchdog-detected "session has not made progress" state, surfaced
 *  through StuckActivityBanner. Set by useStuckActivityWatchdog; cleared
 *  on any new event (the watchdog re-evaluates every tick) or on
 *  session-busy=false / session removal. */
export interface SessionStuckInfo {
  since: number;
  /** "no-progress" → no events for >30s; "pending-approval-not-shown" →
   *  approvalQueue has entries but the modal isn't open. */
  reason: "no-progress" | "pending-approval-not-shown";
}

interface SessionState {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  sessionMessages: Map<string, Message[]>;
  sessionStreaming: Map<string, StreamingState>;
  sessionContext: Map<string, { used: number; max: number }>;
  sessionStats: Map<string, SessionStats>;
  sessionModes: Map<string, SessionMode>;
  sessionBusy: Map<string, boolean>;
  sessionEffort: Map<string, ThinkingEffort>;
  sessionRetry: Map<string, RetryState>;
  lastEventTimestamp: Map<string, number>;
  contextToastFired: Map<string, Set<number>>;
  sessionActivity: Map<string, SessionActivityInfo>;
  sessionCompacting: Map<string, boolean>;
  /** Recap text to prepend (once) to the next CLI prompt for a session.
   * Set by the Codex "Recover session" flow after a fresh-thread reset so the
   * new (empty-context) thread regains continuity. Consumed + cleared on the
   * next sendMessage; the displayed user message is left unprefixed. */
  pendingRecapPrefix: Map<string, string>;
  busySince: Map<string, number>;       // timestamp when busy started
  rateLimitUtilization: Map<string, number>;  // 0-1
  sessionCapabilities: Map<string, CapabilitiesDiscoveredEvent>;
  activeSubAgents: Map<string, SubAgentInfo[]>;  // sessionId → running sub-agents
  sessionThinking: Map<string, { isThinking: boolean; content: string }>;
  /** Codex review-mode content: populated by ReviewModeEntered, kept
   * across the lifecycle so ReviewModeBanner can render the latest
   * review text even after ReviewModeExited flips sessionModes back. */
  sessionReviewContent: Map<string, string>;
  /** Watchdog-detected stuck-session state. Keyed by sessionId; cleared
   *  on busy-end / session removal / next event. See
   *  useStuckActivityWatchdog. */
  sessionStuck: Map<string, SessionStuckInfo>;
  tabOrder: string[];

  // Project grouping
  activeProjectPath: string | null;
  projectOrder: string[];
  projectActiveSession: Map<string, string>;

  // Session management
  addSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  reorderTabs: (tabOrder: string[]) => void;

  // Project management
  setActiveProject: (projectPath: string) => void;
  setActiveSessionInProject: (projectPath: string, sessionId: string) => void;
  getSessionsForProject: (projectPath: string) => string[];

  // Per-session message actions
  addMessage: (sessionId: string, message: Message) => void;
  startStreaming: (sessionId: string, messageId: string) => void;
  appendStreamingContent: (sessionId: string, text: string) => void;
  finalizeStreaming: (sessionId: string, fullText?: string) => void;
  setTurnStats: (sessionId: string, messageId: string, stats: TurnStats) => void;
  updateModel: (sessionId: string, model: string) => void;
  updateContext: (sessionId: string, used: number, max: number) => void;
  setSessionMode: (sessionId: string, mode: SessionMode) => void;
  setCliSessionId: (sessionId: string, cliSessionId: string) => void;
  setSessionBusy: (sessionId: string, busy: boolean) => void;
  ensureBusy: (sessionId: string) => void;
  setSessionEffort: (sessionId: string, effort: ThinkingEffort) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  clearSessionData: (sessionId: string) => void;
  setRetryState: (sessionId: string, state: RetryState) => void;
  clearRetry: (sessionId: string) => void;
  touchLastEvent: (sessionId: string) => void;
  markContextToastFired: (sessionId: string, threshold: number) => void;
  setSessionActivity: (sessionId: string, activity: SessionActivityInfo) => void;
  setSessionStuck: (sessionId: string, info: SessionStuckInfo | null) => void;
  setSessionCompacting: (sessionId: string, compacting: boolean) => void;
  setRecapPrefix: (sessionId: string, recap: string) => void;
  clearRecapPrefix: (sessionId: string) => void;
  setRateLimitUtilization: (sessionId: string, utilization: number) => void;
  setSessionCapabilities: (sessionId: string, caps: CapabilitiesDiscoveredEvent) => void;
  accumulateUsage: (sessionId: string, inputTokens: number, outputTokens: number, cacheCreation: number, cacheRead: number, reasoningTokens?: number) => void;
  addSubAgent: (sessionId: string, agent: SubAgentInfo) => void;
  updateSubAgent: (sessionId: string, toolUseId: string, update: Partial<SubAgentInfo>) => void;
  completeSubAgent: (sessionId: string, toolUseId: string) => void;
  incrementSubAgentToolCount: (sessionId: string, toolUseId: string) => void;
  startThinking: (sessionId: string) => void;
  appendThinkingContent: (sessionId: string, text: string) => void;
  finalizeThinking: (sessionId: string, fullText?: string) => void;
  setSessionReviewContent: (sessionId: string, review: string) => void;

  // Help session (not added to tabOrder or sessions map)
  initHelpSessionMaps: (sessionId: string) => void;

  // Derived helpers (for active session)
  getActiveSession: () => Session | null;
  getActiveMessages: () => Message[];
  getActiveStreaming: () => StreamingState;
  getActiveContext: () => { used: number; max: number };
  getActiveMode: () => SessionMode;
}

const DEFAULT_STREAMING: StreamingState = {
  isStreaming: false,
  streamingContent: "",
  currentMessageId: null,
};

const DEFAULT_CONTEXT = { used: 0, max: 200000 };

const DEFAULT_STATS: SessionStats = {
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  turnCount: 0,
  apiCallCount: 0,
  totalReasoningOutputTokens: 0,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  sessionMessages: new Map(),
  sessionStreaming: new Map(),
  sessionContext: new Map(),
  sessionStats: new Map(),
  sessionModes: new Map(),
  sessionBusy: new Map(),
  sessionEffort: new Map(),
  sessionRetry: new Map(),
  lastEventTimestamp: new Map(),
  contextToastFired: new Map(),
  sessionActivity: new Map(),
  sessionCompacting: new Map(),
  pendingRecapPrefix: new Map(),
  busySince: new Map(),
  rateLimitUtilization: new Map(),
  sessionCapabilities: new Map(),
  activeSubAgents: new Map(),
  sessionThinking: new Map(),
  sessionReviewContent: new Map(),
  sessionStuck: new Map(),
  tabOrder: [],

  // Project grouping
  activeProjectPath: null,
  projectOrder: [],
  projectActiveSession: new Map(),

  addSession: (session) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(session.id, session);
      const sessionMessages = new Map(state.sessionMessages);
      sessionMessages.set(session.id, []);
      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.set(session.id, { ...DEFAULT_STREAMING });
      const sessionContext = new Map(state.sessionContext);
      const defaultContextMax = useSettingsStore.getState().settings.defaultContextWindow;
      sessionContext.set(session.id, { used: 0, max: defaultContextMax });
      const sessionStats = new Map(state.sessionStats);
      sessionStats.set(session.id, { ...DEFAULT_STATS });
      const sessionModes = new Map(state.sessionModes);
      sessionModes.set(session.id, "normal");
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(session.id, false);
      // Do NOT seed sessionEffort. The CLI in v2.1.126 stream-json mode does
      // not emit `thinking_effort` in `system/init`, so any seed value would
      // mislead the badge. EffortSelector falls back to the persisted
      // `defaultThinkingEffort` (which is what we actually passed via
      // `--effort`), then to the first available level. See memory
      // project_cli_effort_runtime_constraints.md.
      const sessionEffort = new Map(state.sessionEffort);
      const tabOrder = [...state.tabOrder, session.id];

      // Project grouping
      const projectPath = session.project_path;
      const projectOrder = state.projectOrder.includes(projectPath)
        ? [...state.projectOrder]
        : [...state.projectOrder, projectPath];
      const projectActiveSession = new Map(state.projectActiveSession);
      projectActiveSession.set(projectPath, session.id);

      return {
        sessions,
        sessionMessages,
        sessionStreaming,
        sessionContext,
        sessionStats,
        sessionModes,
        sessionBusy,
        sessionEffort,
        tabOrder,
        activeSessionId: session.id,
        activeProjectPath: projectPath,
        projectOrder,
        projectActiveSession,
      };
    }),

  removeSession: (sessionId) => {
    // Free the session's file-viewer state (open files, dirty buffers, etc.)
    useFileViewerStore.getState().clearSession(sessionId);
    // Captured inside set() and consumed after — populated when removing this
    // session also evicts its parent project (last session gone).
    let projectFullyRemoved: string | null = null;
    set((state) => {
      const sessions = new Map(state.sessions);
      const removedSession = sessions.get(sessionId);
      sessions.delete(sessionId);
      const sessionMessages = new Map(state.sessionMessages);
      sessionMessages.delete(sessionId);
      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.delete(sessionId);
      const sessionContext = new Map(state.sessionContext);
      sessionContext.delete(sessionId);
      const sessionStats = new Map(state.sessionStats);
      sessionStats.delete(sessionId);
      const sessionModes = new Map(state.sessionModes);
      sessionModes.delete(sessionId);
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.delete(sessionId);
      const sessionEffort = new Map(state.sessionEffort);
      sessionEffort.delete(sessionId);
      const activeSubAgents = new Map(state.activeSubAgents);
      activeSubAgents.delete(sessionId);
      const sessionThinking = new Map(state.sessionThinking);
      sessionThinking.delete(sessionId);
      const sessionReviewContent = new Map(state.sessionReviewContent);
      sessionReviewContent.delete(sessionId);
      // Clean up the 8 Maps that were previously leaked
      const sessionActivity = new Map(state.sessionActivity);
      sessionActivity.delete(sessionId);
      const sessionCompacting = new Map(state.sessionCompacting);
      sessionCompacting.delete(sessionId);
      const pendingRecapPrefix = new Map(state.pendingRecapPrefix);
      pendingRecapPrefix.delete(sessionId);
      const busySince = new Map(state.busySince);
      busySince.delete(sessionId);
      const rateLimitUtilization = new Map(state.rateLimitUtilization);
      rateLimitUtilization.delete(sessionId);
      const sessionCapabilities = new Map(state.sessionCapabilities);
      sessionCapabilities.delete(sessionId);
      const sessionRetry = new Map(state.sessionRetry);
      const existingRetry = sessionRetry.get(sessionId);
      if (existingRetry?.retryTimerId) clearTimeout(existingRetry.retryTimerId);
      sessionRetry.delete(sessionId);
      const lastEventTimestamp = new Map(state.lastEventTimestamp);
      lastEventTimestamp.delete(sessionId);
      const contextToastFired = new Map(state.contextToastFired);
      contextToastFired.delete(sessionId);
      const sessionStuck = new Map(state.sessionStuck);
      sessionStuck.delete(sessionId);
      const tabOrder = state.tabOrder.filter((id) => id !== sessionId);

      // Update project grouping
      let projectOrder = [...state.projectOrder];
      const projectActiveSession = new Map(state.projectActiveSession);
      let activeProjectPath = state.activeProjectPath;

      if (removedSession) {
        const projectPath = removedSession.project_path;
        // Check if any sessions remain for this project
        const remainingInProject = tabOrder.filter((id) => {
          const s = sessions.get(id);
          return s && s.project_path === projectPath;
        });

        if (remainingInProject.length === 0) {
          // Remove project entirely
          projectOrder = projectOrder.filter((p) => p !== projectPath);
          projectActiveSession.delete(projectPath);
          if (activeProjectPath === projectPath) {
            activeProjectPath = projectOrder.length > 0 ? projectOrder[projectOrder.length - 1] : null;
          }
          projectFullyRemoved = projectPath;
        } else if (projectActiveSession.get(projectPath) === sessionId) {
          // Switch to another session in this project
          projectActiveSession.set(projectPath, remainingInProject[0]);
        }
      }

      // Determine active session
      let activeSessionId: string | null;
      if (activeProjectPath) {
        activeSessionId = projectActiveSession.get(activeProjectPath) ?? null;
      } else {
        activeSessionId = null;
      }

      return {
        sessions,
        sessionMessages,
        sessionStreaming,
        sessionContext,
        sessionStats,
        sessionModes,
        sessionBusy,
        sessionEffort,
        activeSubAgents,
        sessionThinking,
        sessionReviewContent,
        sessionActivity,
        sessionCompacting,
        pendingRecapPrefix,
        busySince,
        rateLimitUtilization,
        sessionCapabilities,
        sessionRetry,
        lastEventTimestamp,
        contextToastFired,
        sessionStuck,
        tabOrder,
        activeSessionId,
        activeProjectPath,
        projectOrder,
        projectActiveSession,
      };
    });

    // If we just evicted the project that owns the current Self-Drive run,
    // force-reset Self-Drive so we don't leave a phantom paused run behind
    // (the source of the "already paused for another project" stale-state
    // bug). Dynamic import avoids the static cycle with selfDriveStore,
    // which already imports useSessionStore.
    if (projectFullyRemoved) {
      const removed = projectFullyRemoved;
      void import("./selfDriveStore")
        .then(({ useSelfDriveStore }) => {
          const sd = useSelfDriveStore.getState();
          if (sd.projectPath === removed) {
            void sd.forceReset();
          }
        })
        .catch((e) => console.warn("[sessionStore] Self-Drive cleanup skipped:", e));
    }
  },

  setActiveSession: (sessionId) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return { activeSessionId: sessionId };

      const projectPath = session.project_path;
      const projectActiveSession = new Map(state.projectActiveSession);
      projectActiveSession.set(projectPath, sessionId);

      return {
        activeSessionId: sessionId,
        activeProjectPath: projectPath,
        projectActiveSession,
      };
    }),

  renameSession: (sessionId, name) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, name });
      }
      return { sessions };
    }),

  reorderTabs: (tabOrder) => set({ tabOrder }),

  // Project management
  setActiveProject: (projectPath) =>
    set((state) => {
      const activeSessionId = state.projectActiveSession.get(projectPath) ?? null;
      return {
        activeProjectPath: projectPath,
        activeSessionId,
      };
    }),

  setActiveSessionInProject: (projectPath, sessionId) =>
    set((state) => {
      const projectActiveSession = new Map(state.projectActiveSession);
      projectActiveSession.set(projectPath, sessionId);
      const updates: Partial<SessionState> = { projectActiveSession };
      // If this is the active project, also update activeSessionId
      if (state.activeProjectPath === projectPath) {
        updates.activeSessionId = sessionId;
      }
      return updates as SessionState;
    }),

  getSessionsForProject: (projectPath) => {
    const { tabOrder, sessions } = get();
    return tabOrder.filter((id) => {
      const s = sessions.get(id);
      return s && s.project_path === projectPath;
    });
  },

  addMessage: (sessionId, message) =>
    set((state) => {
      const sessionMessages = new Map(state.sessionMessages);
      const messages = [...(sessionMessages.get(sessionId) ?? []), message];
      sessionMessages.set(sessionId, messages);
      return { sessionMessages };
    }),

  startStreaming: (sessionId, messageId) =>
    set((state) => {
      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.set(sessionId, {
        isStreaming: true,
        streamingContent: "",
        currentMessageId: messageId,
      });
      return { sessionStreaming };
    }),

  appendStreamingContent: (sessionId, text) =>
    set((state) => {
      const sessionStreaming = new Map(state.sessionStreaming);
      const current = sessionStreaming.get(sessionId) ?? { ...DEFAULT_STREAMING };
      sessionStreaming.set(sessionId, {
        ...current,
        streamingContent: current.streamingContent + text,
      });
      return { sessionStreaming };
    }),

  finalizeStreaming: (sessionId, fullText) =>
    set((state) => {
      const streaming = state.sessionStreaming.get(sessionId);
      if (!streaming?.currentMessageId) {
        const sessionStreaming = new Map(state.sessionStreaming);
        sessionStreaming.set(sessionId, { ...DEFAULT_STREAMING });
        return { sessionStreaming };
      }

      const currentId = streaming.currentMessageId;
      const content = fullText ?? streaming.streamingContent;

      const sessionMessages = new Map(state.sessionMessages);
      const messages = [...(sessionMessages.get(sessionId) ?? [])];
      const existingIdx = messages.findIndex((m) => m.id === currentId);
      if (existingIdx >= 0) {
        messages[existingIdx] = {
          ...messages[existingIdx],
          content,
          isStreaming: false,
        };
        sessionMessages.set(sessionId, messages);
      }

      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.set(sessionId, { ...DEFAULT_STREAMING });

      return { sessionMessages, sessionStreaming };
    }),

  setTurnStats: (sessionId, messageId, stats) =>
    set((state) => {
      // Attach stats to the message
      const sessionMessages = new Map(state.sessionMessages);
      const messages = [...(sessionMessages.get(sessionId) ?? [])];
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx >= 0) {
        messages[idx] = { ...messages[idx], turnStats: stats };
        sessionMessages.set(sessionId, messages);
      }

      // Update cost and turn count only — token accumulation is handled
      // incrementally by accumulateUsage (from usage_update events).
      // If no usage_update events were received (older CLI), fall back
      // to adding tokens from the result event.
      const sessionStats = new Map(state.sessionStats);
      const prev = sessionStats.get(sessionId) ?? { ...DEFAULT_STATS };
      const hadIncrementalUpdates = prev.apiCallCount > 0;
      sessionStats.set(sessionId, {
        totalCostUsd: prev.totalCostUsd + (stats.costUsd ?? 0),
        totalInputTokens: hadIncrementalUpdates ? prev.totalInputTokens : prev.totalInputTokens + stats.inputTokens,
        totalOutputTokens: hadIncrementalUpdates ? prev.totalOutputTokens : prev.totalOutputTokens + stats.outputTokens,
        totalCacheCreationTokens: hadIncrementalUpdates ? prev.totalCacheCreationTokens : prev.totalCacheCreationTokens + stats.cacheCreationTokens,
        totalCacheReadTokens: hadIncrementalUpdates ? prev.totalCacheReadTokens : prev.totalCacheReadTokens + stats.cacheReadTokens,
        turnCount: prev.turnCount + 1,
        apiCallCount: 0, // reset for next turn
        // Reasoning tokens persist across turns — accumulateUsage owns
        // the increment, this branch just preserves what's there.
        totalReasoningOutputTokens: prev.totalReasoningOutputTokens,
      });

      return { sessionMessages, sessionStats };
    }),

  updateModel: (sessionId, model) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, model });
      }
      return { sessions };
    }),

  updateContext: (sessionId, used, max) =>
    set((state) => {
      const sessionContext = new Map(state.sessionContext);
      sessionContext.set(sessionId, { used, max });
      return { sessionContext };
    }),

  setSessionMode: (sessionId, mode) =>
    set((state) => {
      const sessionModes = new Map(state.sessionModes);
      sessionModes.set(sessionId, mode);
      return { sessionModes };
    }),

  setCliSessionId: (sessionId, cliSessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, cli_session_id: cliSessionId });
      }
      return { sessions };
    }),

  setSessionBusy: (sessionId, busy) =>
    set((state) => {
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(sessionId, busy);
      const busySince = new Map(state.busySince);
      const sessionActivity = new Map(state.sessionActivity);
      const lastEventTimestamp = new Map(state.lastEventTimestamp);
      const activeSubAgents = new Map(state.activeSubAgents);
      const sessionStuck = new Map(state.sessionStuck);
      if (busy) {
        busySince.set(sessionId, Date.now());
        sessionActivity.set(sessionId, { ...DEFAULT_ACTIVITY });
        lastEventTimestamp.set(sessionId, Date.now());
      } else {
        busySince.delete(sessionId);
        sessionActivity.delete(sessionId);
        activeSubAgents.delete(sessionId);
        sessionStuck.delete(sessionId);
      }
      return { sessionBusy, busySince, sessionActivity, lastEventTimestamp, activeSubAgents, sessionStuck };
    }),

  ensureBusy: (sessionId) =>
    set((state) => {
      if (state.sessionBusy.get(sessionId)) return {};  // already busy, no-op
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(sessionId, true);
      const busySince = new Map(state.busySince);
      busySince.set(sessionId, Date.now());
      const lastEventTimestamp = new Map(state.lastEventTimestamp);
      lastEventTimestamp.set(sessionId, Date.now());
      return { sessionBusy, busySince, lastEventTimestamp };
    }),

  setSessionEffort: (sessionId, effort) =>
    set((state) => {
      const sessionEffort = new Map(state.sessionEffort);
      sessionEffort.set(sessionId, effort);
      return { sessionEffort };
    }),

  setSessionReviewContent: (sessionId, review) =>
    set((state) => {
      const sessionReviewContent = new Map(state.sessionReviewContent);
      if (review === "") {
        sessionReviewContent.delete(sessionId);
      } else {
        sessionReviewContent.set(sessionId, review);
      }
      return { sessionReviewContent };
    }),

  updateSessionStatus: (sessionId, status) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, status });
      }
      return { sessions };
    }),

  clearSessionData: (sessionId) =>
    set((state) => {
      const sessionMessages = new Map(state.sessionMessages);
      sessionMessages.set(sessionId, []);
      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.set(sessionId, { ...DEFAULT_STREAMING });
      const sessionContext = new Map(state.sessionContext);
      const defaultContextMax = useSettingsStore.getState().settings.defaultContextWindow;
      sessionContext.set(sessionId, { used: 0, max: defaultContextMax });
      const sessionStats = new Map(state.sessionStats);
      sessionStats.set(sessionId, { ...DEFAULT_STATS });
      const sessionModes = new Map(state.sessionModes);
      sessionModes.set(sessionId, "normal");
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(sessionId, false);
      const sessionEffort = new Map(state.sessionEffort);
      sessionEffort.delete(sessionId);
      const contextToastFired = new Map(state.contextToastFired);
      contextToastFired.set(sessionId, new Set());
      const sessionActivity = new Map(state.sessionActivity);
      sessionActivity.delete(sessionId);
      const sessionCompacting = new Map(state.sessionCompacting);
      sessionCompacting.delete(sessionId);
      const pendingRecapPrefix = new Map(state.pendingRecapPrefix);
      pendingRecapPrefix.delete(sessionId);
      const busySince = new Map(state.busySince);
      busySince.delete(sessionId);
      const rateLimitUtilization = new Map(state.rateLimitUtilization);
      rateLimitUtilization.delete(sessionId);
      const sessionCapabilities = new Map(state.sessionCapabilities);
      sessionCapabilities.delete(sessionId);
      const activeSubAgents = new Map(state.activeSubAgents);
      activeSubAgents.delete(sessionId);
      const sessionThinking = new Map(state.sessionThinking);
      sessionThinking.delete(sessionId);
      const sessionReviewContent = new Map(state.sessionReviewContent);
      sessionReviewContent.delete(sessionId);
      return { sessionMessages, sessionStreaming, sessionContext, sessionStats, sessionModes, sessionBusy, sessionEffort, contextToastFired, sessionActivity, sessionCompacting, pendingRecapPrefix, busySince, rateLimitUtilization, sessionCapabilities, activeSubAgents, sessionThinking, sessionReviewContent };
    }),

  setRetryState: (sessionId, retryState) =>
    set((state) => {
      const sessionRetry = new Map(state.sessionRetry);
      sessionRetry.set(sessionId, retryState);
      return { sessionRetry };
    }),

  clearRetry: (sessionId) =>
    set((state) => {
      const sessionRetry = new Map(state.sessionRetry);
      const existing = sessionRetry.get(sessionId);
      if (existing?.retryTimerId) clearTimeout(existing.retryTimerId);
      sessionRetry.delete(sessionId);
      return { sessionRetry };
    }),

  touchLastEvent: (sessionId) =>
    set((state) => {
      const lastEventTimestamp = new Map(state.lastEventTimestamp);
      lastEventTimestamp.set(sessionId, Date.now());
      return { lastEventTimestamp };
    }),

  markContextToastFired: (sessionId, threshold) =>
    set((state) => {
      const contextToastFired = new Map(state.contextToastFired);
      const existing = contextToastFired.get(sessionId) ?? new Set();
      const updated = new Set(existing);
      updated.add(threshold);
      contextToastFired.set(sessionId, updated);
      return { contextToastFired };
    }),

  setSessionActivity: (sessionId, activity) =>
    set((state) => {
      const sessionActivity = new Map(state.sessionActivity);
      sessionActivity.set(sessionId, activity);
      return { sessionActivity };
    }),

  setSessionStuck: (sessionId, info) =>
    set((state) => {
      const sessionStuck = new Map(state.sessionStuck);
      if (info === null) {
        if (!sessionStuck.has(sessionId)) return {}; // already absent, skip update
        sessionStuck.delete(sessionId);
      } else {
        const prev = sessionStuck.get(sessionId);
        // Idempotent set: only re-emit when reason or since actually changes.
        // Without this guard the watchdog's per-tick set() would force a
        // re-render every 5s even when nothing changed.
        if (prev && prev.reason === info.reason && prev.since === info.since) {
          return {};
        }
        sessionStuck.set(sessionId, info);
      }
      return { sessionStuck };
    }),

  setSessionCompacting: (sessionId, compacting) =>
    set((state) => {
      const sessionCompacting = new Map(state.sessionCompacting);
      sessionCompacting.set(sessionId, compacting);
      return { sessionCompacting };
    }),

  setRecapPrefix: (sessionId, recap) =>
    set((state) => {
      const pendingRecapPrefix = new Map(state.pendingRecapPrefix);
      pendingRecapPrefix.set(sessionId, recap);
      return { pendingRecapPrefix };
    }),

  clearRecapPrefix: (sessionId) =>
    set((state) => {
      const pendingRecapPrefix = new Map(state.pendingRecapPrefix);
      pendingRecapPrefix.delete(sessionId);
      return { pendingRecapPrefix };
    }),

  setRateLimitUtilization: (sessionId, utilization) =>
    set((state) => {
      const rateLimitUtilization = new Map(state.rateLimitUtilization);
      rateLimitUtilization.set(sessionId, utilization);
      return { rateLimitUtilization };
    }),

  setSessionCapabilities: (sessionId, caps) =>
    set((state) => {
      const sessionCapabilities = new Map(state.sessionCapabilities);
      sessionCapabilities.set(sessionId, caps);
      return { sessionCapabilities };
    }),

  addSubAgent: (sessionId, agent) =>
    set((state) => {
      const activeSubAgents = new Map(state.activeSubAgents);
      const agents = [...(activeSubAgents.get(sessionId) ?? []), agent];
      activeSubAgents.set(sessionId, agents);
      return { activeSubAgents };
    }),

  updateSubAgent: (sessionId, toolUseId, update) =>
    set((state) => {
      const activeSubAgents = new Map(state.activeSubAgents);
      const agents = activeSubAgents.get(sessionId);
      if (!agents) return {};
      const updated = agents.map((a) =>
        a.toolUseId === toolUseId ? { ...a, ...update } : a,
      );
      activeSubAgents.set(sessionId, updated);
      return { activeSubAgents };
    }),

  completeSubAgent: (sessionId, toolUseId) =>
    set((state) => {
      const activeSubAgents = new Map(state.activeSubAgents);
      const agents = activeSubAgents.get(sessionId);
      if (!agents) return {};
      const updated = agents.filter((a) => a.toolUseId !== toolUseId);
      if (updated.length === 0) {
        activeSubAgents.delete(sessionId);
      } else {
        activeSubAgents.set(sessionId, updated);
      }
      return { activeSubAgents };
    }),

  incrementSubAgentToolCount: (sessionId, toolUseId) =>
    set((state) => {
      const activeSubAgents = new Map(state.activeSubAgents);
      const agents = activeSubAgents.get(sessionId);
      if (!agents) return {};
      const updated = agents.map((a) =>
        a.toolUseId === toolUseId ? { ...a, toolCount: (a.toolCount ?? 0) + 1 } : a,
      );
      activeSubAgents.set(sessionId, updated);
      return { activeSubAgents };
    }),

  startThinking: (sessionId) =>
    set((state) => {
      const sessionThinking = new Map(state.sessionThinking);
      sessionThinking.set(sessionId, { isThinking: true, content: "" });
      return { sessionThinking };
    }),

  appendThinkingContent: (sessionId, text) =>
    set((state) => {
      const sessionThinking = new Map(state.sessionThinking);
      const prev = sessionThinking.get(sessionId) ?? { isThinking: true, content: "" };
      sessionThinking.set(sessionId, { ...prev, content: prev.content + text });
      return { sessionThinking };
    }),

  finalizeThinking: (sessionId, fullText) =>
    set((state) => {
      const sessionThinking = new Map(state.sessionThinking);
      const prev = sessionThinking.get(sessionId);
      const thinkingText = fullText ?? prev?.content ?? "";
      sessionThinking.set(sessionId, { isThinking: false, content: thinkingText });

      // Attach thinking to the current streaming message (or latest assistant message)
      const streaming = state.sessionStreaming.get(sessionId);
      const msgId = streaming?.currentMessageId;
      if (msgId && thinkingText) {
        const sessionMessages = new Map(state.sessionMessages);
        const messages = [...(sessionMessages.get(sessionId) ?? [])];
        const idx = messages.findIndex((m) => m.id === msgId);
        if (idx >= 0) {
          messages[idx] = { ...messages[idx], thinkingContent: thinkingText };
          sessionMessages.set(sessionId, messages);
          return { sessionThinking, sessionMessages };
        }
      }
      return { sessionThinking };
    }),

  accumulateUsage: (sessionId, inputTokens, outputTokens, cacheCreation, cacheRead, reasoningTokens = 0) =>
    set((state) => {
      const sessionStats = new Map(state.sessionStats);
      const prev = sessionStats.get(sessionId) ?? { ...DEFAULT_STATS };
      sessionStats.set(sessionId, {
        ...prev,
        totalInputTokens: prev.totalInputTokens + inputTokens,
        totalOutputTokens: prev.totalOutputTokens + outputTokens,
        totalCacheCreationTokens: prev.totalCacheCreationTokens + cacheCreation,
        totalCacheReadTokens: prev.totalCacheReadTokens + cacheRead,
        apiCallCount: prev.apiCallCount + 1,
        totalReasoningOutputTokens:
          prev.totalReasoningOutputTokens + reasoningTokens,
      });
      return { sessionStats };
    }),

  initHelpSessionMaps: (sessionId) =>
    set((state) => {
      const sessionMessages = new Map(state.sessionMessages);
      sessionMessages.set(sessionId, []);
      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.set(sessionId, { ...DEFAULT_STREAMING });
      const sessionContext = new Map(state.sessionContext);
      sessionContext.set(sessionId, { ...DEFAULT_CONTEXT });
      const sessionStats = new Map(state.sessionStats);
      sessionStats.set(sessionId, { ...DEFAULT_STATS });
      const sessionModes = new Map(state.sessionModes);
      sessionModes.set(sessionId, "plan");
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(sessionId, false);
      const sessionEffort = new Map(state.sessionEffort);
      sessionEffort.delete(sessionId);
      return { sessionMessages, sessionStreaming, sessionContext, sessionStats, sessionModes, sessionBusy, sessionEffort };
    }),

  // Derived helpers
  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    return activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  },

  getActiveMessages: () => {
    const { sessionMessages, activeSessionId } = get();
    return activeSessionId ? sessionMessages.get(activeSessionId) ?? [] : [];
  },

  getActiveStreaming: () => {
    const { sessionStreaming, activeSessionId } = get();
    return activeSessionId
      ? sessionStreaming.get(activeSessionId) ?? { ...DEFAULT_STREAMING }
      : { ...DEFAULT_STREAMING };
  },

  getActiveContext: () => {
    const { sessionContext, activeSessionId } = get();
    return activeSessionId
      ? sessionContext.get(activeSessionId) ?? { ...DEFAULT_CONTEXT }
      : { ...DEFAULT_CONTEXT };
  },

  getActiveMode: () => {
    const { sessionModes, activeSessionId } = get();
    return activeSessionId
      ? sessionModes.get(activeSessionId) ?? "normal"
      : "normal";
  },
}));
