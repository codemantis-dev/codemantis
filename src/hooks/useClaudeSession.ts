import { useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useAttachmentStore } from "../stores/attachmentStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useChangelogStore } from "../stores/changelogStore";
import { useAssistantStore } from "../stores/assistantStore";
import { getAssistantListeners } from "./useAssistantSession";
import {
  createSession,
  sendMessage as sendMessageCmd,
  closeSession as closeSessionCmd,
  renameSession as renameSessionCmd,
  listenChatEvents,
  listenActivityEvents,
  closeTerminal as closeTerminalCmd,
} from "../lib/tauri-commands";
import { useUiStore } from "../stores/uiStore";
import {
  handleChatEvent,
  handleActivityEvent,
  startStaleDetection,
  stopStaleDetection,
} from "../lib/event-classifier";
import { showToast } from "../stores/toastStore";

const MAX_SESSIONS = 10;

// Module-level listener map — persists across re-renders
const sessionListeners = new Map<string, UnlistenFn[]>();

interface UseClaudeSessionReturn {
  startSession: (projectPath: string) => Promise<string>;
  addSessionToProject: (projectPath?: string) => Promise<void>;
  sendMessage: (sessionId: string, prompt: string) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  closeAllSessionsInProject: (projectPath: string) => Promise<void>;
  switchSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  resumeFromHistory: (projectPath: string, cliSessionId: string, originalName: string) => Promise<string>;
}

export function useClaudeSession(): UseClaudeSessionReturn {
  const sessionStore = useSessionStore;
  const activityStore = useActivityStore;
  const terminalStore = useTerminalStore;
  const changelogStore = useChangelogStore;

  const startSession = useCallback(async (projectPath: string): Promise<string> => {
    const state = sessionStore.getState();
    if (state.tabOrder.length >= MAX_SESSIONS) {
      showToast(`Maximum ${MAX_SESSIONS} sessions allowed`, "error");
      throw new Error(`Maximum ${MAX_SESSIONS} sessions allowed`);
    }

    const session = await createSession(projectPath);
    sessionStore.getState().addSession(session);

    // Register event listeners for this session
    const unlistenChat = await listenChatEvents(session.id, (event) =>
      handleChatEvent(session.id, event)
    );
    const unlistenActivity = await listenActivityEvents(session.id, (event) =>
      handleActivityEvent(session.id, event)
    );

    sessionListeners.set(session.id, [
      unlistenChat,
      unlistenActivity,
    ]);

    startStaleDetection(session.id);

    return session.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const addSessionToProject = useCallback(async (projectPath?: string) => {
    const state = sessionStore.getState();
    const targetPath = (typeof projectPath === "string" ? projectPath : undefined) ?? state.activeProjectPath;
    if (!targetPath) {
      showToast("No active project to add session to", "error");
      return;
    }
    try {
      await startSession(targetPath);
    } catch (e) {
      console.error("Failed to add session to project:", e);
      showToast(`Failed to create session: ${String(e)}`, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, [startSession]);

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
      await sendMessageCmd(sessionId, prompt);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
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

    stopStaleDetection(sessionId);

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
    useAttachmentStore.getState().clearSession(sessionId);
    changelogStore.getState().clearSession(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store refs (sessionStore, activityStore, terminalStore, changelogStore) are stable Zustand singletons
  }, []);

  const closeAllSessionsInProject = useCallback(async (projectPath: string) => {
    const state = sessionStore.getState();
    const sessionIds = state.tabOrder.filter((id) => {
      const s = state.sessions.get(id);
      return s && s.project_path === projectPath;
    });
    for (const sessionId of sessionIds) {
      await closeSessionFn(sessionId);
    }

    // Also close all assistant sessions for this project
    const aStore = useAssistantStore.getState();
    const assistantSessionIds = aStore.getAllSessionIds(projectPath);
    for (const aSessionId of assistantSessionIds) {
      const listeners = getAssistantListeners().get(aSessionId);
      if (listeners) {
        for (const unlisten of listeners) {
          unlisten();
        }
        getAssistantListeners().delete(aSessionId);
      }
      try {
        await closeSessionCmd(aSessionId);
      } catch (e) {
        console.error("Failed to close assistant session:", e);
      }
    }
    aStore.clearProject(projectPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, [closeSessionFn]);

  const switchSession = useCallback((sessionId: string) => {
    sessionStore.getState().setActiveSession(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const renameSessionFn = useCallback(async (sessionId: string, name: string) => {
    sessionStore.getState().renameSession(sessionId, name);
    try {
      await renameSessionCmd(sessionId, name);
    } catch (e) {
      console.error("Failed to rename session:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const resumeFromHistory = useCallback(async (
    projectPath: string,
    cliSessionId: string,
    originalName: string
  ): Promise<string> => {
    const state = sessionStore.getState();
    if (state.tabOrder.length >= MAX_SESSIONS) {
      showToast(`Maximum ${MAX_SESSIONS} sessions allowed`, "error");
      throw new Error(`Maximum ${MAX_SESSIONS} sessions allowed`);
    }

    try {
      const session = await createSession(projectPath, originalName, cliSessionId);
      sessionStore.getState().addSession(session);

      const unlistenChat = await listenChatEvents(session.id, (event) =>
        handleChatEvent(session.id, event)
      );
      const unlistenActivity = await listenActivityEvents(session.id, (event) =>
        handleActivityEvent(session.id, event)
      );

      sessionListeners.set(session.id, [unlistenChat, unlistenActivity]);

      startStaleDetection(session.id);
      useUiStore.getState().setShowClaudeHistory(false);

      return session.id;
    } catch (e) {
      showToast(`Failed to resume session: ${String(e)}`, "error");
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  return {
    startSession,
    addSessionToProject,
    sendMessage,
    closeSession: closeSessionFn,
    closeAllSessionsInProject,
    switchSession,
    renameSession: renameSessionFn,
    resumeFromHistory,
  };
}
