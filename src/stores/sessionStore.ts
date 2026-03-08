import { create } from "zustand";
import type { Session, Message, TurnStats, SessionStats, SessionMode } from "../types/session";

interface StreamingState {
  isStreaming: boolean;
  streamingContent: string;
  currentMessageId: string | null;
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
  setSessionBusy: (sessionId: string, busy: boolean) => void;
  clearSessionData: (sessionId: string) => void;

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

      // Update cumulative session stats
      const sessionStats = new Map(state.sessionStats);
      const prev = sessionStats.get(sessionId) ?? { ...DEFAULT_STATS };
      sessionStats.set(sessionId, {
        totalCostUsd: prev.totalCostUsd + (stats.costUsd ?? 0),
        totalInputTokens: prev.totalInputTokens + stats.inputTokens,
        totalOutputTokens: prev.totalOutputTokens + stats.outputTokens,
        totalCacheCreationTokens: prev.totalCacheCreationTokens + stats.cacheCreationTokens,
        totalCacheReadTokens: prev.totalCacheReadTokens + stats.cacheReadTokens,
        turnCount: prev.turnCount + 1,
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

  setSessionBusy: (sessionId, busy) =>
    set((state) => {
      const sessionBusy = new Map(state.sessionBusy);
      sessionBusy.set(sessionId, busy);
      return { sessionBusy };
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
      return { sessionMessages, sessionStreaming, sessionContext, sessionStats, sessionModes, sessionBusy };
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
