import { create } from "zustand";
import type { Session, Message, TurnStats, SessionStats, SessionMode, SessionStatus, ThinkingEffort } from "../types/session";

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
  busySince: Map<string, number>;       // timestamp when busy started
  rateLimitUtilization: Map<string, number>;  // 0-1
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
  setSessionEffort: (sessionId: string, effort: ThinkingEffort) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  clearSessionData: (sessionId: string) => void;
  setRetryState: (sessionId: string, state: RetryState) => void;
  clearRetry: (sessionId: string) => void;
  touchLastEvent: (sessionId: string) => void;
  markContextToastFired: (sessionId: string, threshold: number) => void;
  setSessionActivity: (sessionId: string, activity: SessionActivityInfo) => void;
  setSessionCompacting: (sessionId: string, compacting: boolean) => void;
  setRateLimitUtilization: (sessionId: string, utilization: number) => void;
  accumulateUsage: (sessionId: string, inputTokens: number, outputTokens: number, cacheCreation: number, cacheRead: number) => void;

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
  busySince: new Map(),
  rateLimitUtilization: new Map(),
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
      sessionContext.set(session.id, { ...DEFAULT_CONTEXT });
      const sessionStats = new Map(state.sessionStats);
      sessionStats.set(session.id, { ...DEFAULT_STATS });
      const sessionModes = new Map(state.sessionModes);
      sessionModes.set(session.id, "normal");
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(session.id, false);
      const sessionEffort = new Map(state.sessionEffort);
      sessionEffort.set(session.id, "high");
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

  removeSession: (sessionId) =>
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
        tabOrder,
        activeSessionId,
        activeProjectPath,
        projectOrder,
        projectActiveSession,
      };
    }),

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
      if (busy) {
        busySince.set(sessionId, Date.now());
        sessionActivity.set(sessionId, { ...DEFAULT_ACTIVITY });
        // Reset stale detection clock so idle time before sending
        // a message doesn't count toward the 120s threshold
        lastEventTimestamp.set(sessionId, Date.now());
      } else {
        busySince.delete(sessionId);
        sessionActivity.delete(sessionId);
      }
      return { sessionBusy, busySince, sessionActivity, lastEventTimestamp };
    }),

  setSessionEffort: (sessionId, effort) =>
    set((state) => {
      const sessionEffort = new Map(state.sessionEffort);
      sessionEffort.set(sessionId, effort);
      return { sessionEffort };
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
      sessionContext.set(sessionId, { ...DEFAULT_CONTEXT });
      const sessionStats = new Map(state.sessionStats);
      sessionStats.set(sessionId, { ...DEFAULT_STATS });
      const sessionModes = new Map(state.sessionModes);
      sessionModes.set(sessionId, "normal");
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(sessionId, false);
      const sessionEffort = new Map(state.sessionEffort);
      sessionEffort.set(sessionId, "high");
      const contextToastFired = new Map(state.contextToastFired);
      contextToastFired.set(sessionId, new Set());
      const sessionActivity = new Map(state.sessionActivity);
      sessionActivity.delete(sessionId);
      const sessionCompacting = new Map(state.sessionCompacting);
      sessionCompacting.delete(sessionId);
      const busySince = new Map(state.busySince);
      busySince.delete(sessionId);
      const rateLimitUtilization = new Map(state.rateLimitUtilization);
      rateLimitUtilization.delete(sessionId);
      return { sessionMessages, sessionStreaming, sessionContext, sessionStats, sessionModes, sessionBusy, sessionEffort, contextToastFired, sessionActivity, sessionCompacting, busySince, rateLimitUtilization };
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

  setSessionCompacting: (sessionId, compacting) =>
    set((state) => {
      const sessionCompacting = new Map(state.sessionCompacting);
      sessionCompacting.set(sessionId, compacting);
      return { sessionCompacting };
    }),

  setRateLimitUtilization: (sessionId, utilization) =>
    set((state) => {
      const rateLimitUtilization = new Map(state.rateLimitUtilization);
      rateLimitUtilization.set(sessionId, utilization);
      return { rateLimitUtilization };
    }),

  accumulateUsage: (sessionId, inputTokens, outputTokens, cacheCreation, cacheRead) =>
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
      });
      return { sessionStats };
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
