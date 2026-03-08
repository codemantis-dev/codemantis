import { useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useTerminalStore } from "../stores/terminalStore";
import {
  createSession,
  sendMessage as sendMessageCmd,
  closeSession as closeSessionCmd,
  renameSession as renameSessionCmd,
  listenChatEvents,
  listenActivityEvents,
  listenApprovalEvents,
  closeTerminal as closeTerminalCmd,
} from "../lib/tauri-commands";
import {
  handleChatEvent,
  handleActivityEvent,
  handleApprovalEvent,
} from "../lib/event-classifier";

const MAX_SESSIONS = 10;

// Module-level listener map — persists across re-renders
const sessionListeners = new Map<string, UnlistenFn[]>();

interface UseClaudeSessionReturn {
  startSession: (projectPath: string) => Promise<string>;
  sendMessage: (sessionId: string, prompt: string) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  switchSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => Promise<void>;
}

export function useClaudeSession(): UseClaudeSessionReturn {
  const sessionStore = useSessionStore;
  const activityStore = useActivityStore;
  const terminalStore = useTerminalStore;

  const startSession = useCallback(async (projectPath: string): Promise<string> => {
    const state = sessionStore.getState();
    if (state.tabOrder.length >= MAX_SESSIONS) {
      throw new Error(`Maximum ${MAX_SESSIONS} sessions allowed`);
    }

    try {
      console.log("[session] Creating session for:", projectPath);
      const session = await createSession(projectPath);
      console.log("[session] Session created:", session.id, session);
      sessionStore.getState().addSession(session);

      // Register event listeners for this session
      const unlistenChat = await listenChatEvents(session.id, (event) =>
        handleChatEvent(session.id, event)
      );
      const unlistenActivity = await listenActivityEvents(session.id, (event) =>
        handleActivityEvent(session.id, event)
      );
      const unlistenApproval = await listenApprovalEvents(session.id, (event) =>
        handleApprovalEvent(session.id, event)
      );

      sessionListeners.set(session.id, [
        unlistenChat,
        unlistenActivity,
        unlistenApproval,
      ]);

      return session.id;
    } catch (e) {
      console.error("Failed to start session:", e);
      throw e;
    }
  }, []);

  const sendMessage = useCallback(async (sessionId: string, prompt: string) => {
    const session = sessionStore.getState().sessions.get(sessionId);
    if (!session) return;

    const msgId = `user-${Date.now()}`;
    sessionStore.getState().addMessage(sessionId, {
      id: msgId,
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    sessionStore.getState().setSessionBusy(sessionId, true);

    try {
      console.log("[session] Sending message:", prompt.slice(0, 100));
      await sendMessageCmd(sessionId, prompt);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  }, []);

  const closeSessionFn = useCallback(async (sessionId: string) => {
    // Unlisten all event listeners for this session
    const listeners = sessionListeners.get(sessionId);
    if (listeners) {
      for (const unlisten of listeners) {
        unlisten();
      }
      sessionListeners.delete(sessionId);
    }

    // Close all terminals for this session
    const terminals = terminalStore.getState().getTerminals(sessionId);
    for (const terminal of terminals) {
      try {
        await closeTerminalCmd(terminal.id);
      } catch (e) {
        console.error("Failed to close terminal:", e);
      }
    }
    terminalStore.getState().clearSession(sessionId);

    try {
      await closeSessionCmd(sessionId);
    } catch (e) {
      console.error("Failed to close session:", e);
    }

    sessionStore.getState().removeSession(sessionId);
    activityStore.getState().clearEntries(sessionId);
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    sessionStore.getState().setActiveSession(sessionId);
  }, []);

  const renameSessionFn = useCallback(async (sessionId: string, name: string) => {
    sessionStore.getState().renameSession(sessionId, name);
    try {
      await renameSessionCmd(sessionId, name);
    } catch (e) {
      console.error("Failed to rename session:", e);
    }
  }, []);

  return {
    startSession,
    sendMessage,
    closeSession: closeSessionFn,
    switchSession,
    renameSession: renameSessionFn,
  };
}
