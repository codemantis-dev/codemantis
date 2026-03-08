import { create } from "zustand";
import type { Session, Message } from "../types/session";

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
  tabOrder: string[];

  // Session management
  addSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  reorderTabs: (tabOrder: string[]) => void;

  // Per-session message actions
  addMessage: (sessionId: string, message: Message) => void;
  startStreaming: (sessionId: string, messageId: string) => void;
  appendStreamingContent: (sessionId: string, text: string) => void;
  finalizeStreaming: (sessionId: string, fullText?: string) => void;
  updateModel: (sessionId: string, model: string) => void;
  updateContext: (sessionId: string, used: number, max: number) => void;
  clearSessionData: (sessionId: string) => void;

  // Derived helpers (for active session)
  getActiveSession: () => Session | null;
  getActiveMessages: () => Message[];
  getActiveStreaming: () => StreamingState;
  getActiveContext: () => { used: number; max: number };
}

const DEFAULT_STREAMING: StreamingState = {
  isStreaming: false,
  streamingContent: "",
  currentMessageId: null,
};

const DEFAULT_CONTEXT = { used: 0, max: 200000 };

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  sessionMessages: new Map(),
  sessionStreaming: new Map(),
  sessionContext: new Map(),
  tabOrder: [],

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
      const tabOrder = [...state.tabOrder, session.id];
      return {
        sessions,
        sessionMessages,
        sessionStreaming,
        sessionContext,
        tabOrder,
        activeSessionId: session.id,
      };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(sessionId);
      const sessionMessages = new Map(state.sessionMessages);
      sessionMessages.delete(sessionId);
      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.delete(sessionId);
      const sessionContext = new Map(state.sessionContext);
      sessionContext.delete(sessionId);
      const tabOrder = state.tabOrder.filter((id) => id !== sessionId);

      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        // Switch to adjacent tab or null
        const oldIdx = state.tabOrder.indexOf(sessionId);
        if (tabOrder.length > 0) {
          activeSessionId = tabOrder[Math.min(oldIdx, tabOrder.length - 1)];
        } else {
          activeSessionId = null;
        }
      }

      return {
        sessions,
        sessionMessages,
        sessionStreaming,
        sessionContext,
        tabOrder,
        activeSessionId,
      };
    }),

  setActiveSession: (sessionId) =>
    set({ activeSessionId: sessionId }),

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

  clearSessionData: (sessionId) =>
    set((state) => {
      const sessionMessages = new Map(state.sessionMessages);
      sessionMessages.set(sessionId, []);
      const sessionStreaming = new Map(state.sessionStreaming);
      sessionStreaming.set(sessionId, { ...DEFAULT_STREAMING });
      const sessionContext = new Map(state.sessionContext);
      sessionContext.set(sessionId, { ...DEFAULT_CONTEXT });
      return { sessionMessages, sessionStreaming, sessionContext };
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
}));
