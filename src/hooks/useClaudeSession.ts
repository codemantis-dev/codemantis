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
  initializeSession,
  saveSessionMessages,
  loadSessionMessages,
} from "../lib/tauri-commands";
import { useSettingsStore } from "../stores/settingsStore";
import type { SessionMessagePayload, Message } from "../types/session";
import { useUiStore } from "../stores/uiStore";
import {
  handleChatEvent,
  handleActivityEvent,
  startStaleDetection,
  cleanupSession,
} from "../lib/event-classifier";
import { showToast } from "../stores/toastStore";
import { handleError } from "../lib/error-handler";
import { translateErrorForToast } from "../lib/error-messages";
import { inputDrafts } from "../lib/input-drafts";

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
  resumeFromHistory: (projectPath: string, cliSessionId: string, originalName: string, originalSessionId?: string) => Promise<string>;
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

    // Discover CLI capabilities (models, commands, account info)
    initializeSession(session.id).catch((e) => {
      console.error("Failed to discover session capabilities:", e);
      showToast("Failed to discover session capabilities", "error");
    });

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
      handleError("Failed to add session to project", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, [startSession]);

  const sendMessage = useCallback(async (sessionId: string, prompt: string) => {
    const session = sessionStore.getState().sessions.get(sessionId);
    if (!session) return;

    const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      handleError("Failed to send message", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const closeSessionFn = useCallback(async (sessionId: string) => {
    // Save session messages if session logs enabled (before messages are cleared)
    const { sessionLogsEnabled } = useSettingsStore.getState().settings;
    const messages = sessionStore.getState().sessionMessages.get(sessionId) ?? [];
    console.info(
      `[closeSession] sessionId=${sessionId} sessionLogsEnabled=${sessionLogsEnabled} messageCount=${messages.length}` +
      (messages.length > 0 ? ` roles=[${messages.map((m) => m.role).join(",")}] contentLengths=[${messages.map((m) => m.content.length).join(",")}]` : "")
    );
    if (sessionLogsEnabled) {
      if (messages.length > 0) {
        const payloads: SessionMessagePayload[] = messages.map((m, i) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          thinkingContent: m.thinkingContent ?? null,
          sortOrder: i,
        }));
        console.info(`[closeSession] Saving ${payloads.length} messages for session ${sessionId}...`);
        try {
          await saveSessionMessages(sessionId, payloads);
          console.info(`[closeSession] Successfully saved ${payloads.length} messages for session ${sessionId}`);
        } catch (e) {
          console.error("[closeSession] Failed to save session messages:", e);
          showToast("Failed to save session messages", "error");
        }
      } else {
        console.warn(`[closeSession] No messages to save for session ${sessionId}`);
      }
    } else {
      console.warn(`[closeSession] Session logs disabled — skipping save for ${sessionId} (${messages.length} messages lost)`);
    }

    // Unlisten all event listeners for this session
    const listeners = sessionListeners.get(sessionId);
    if (listeners) {
      for (const unlisten of listeners) {
        unlisten();
      }
      sessionListeners.delete(sessionId);
    }

    cleanupSession(sessionId);

    // Close all terminals for this session
    const terminals = terminalStore.getState().getTerminals(sessionId);
    for (const terminal of terminals) {
      try {
        await closeTerminalCmd(terminal.id);
      } catch (e) {
        console.error("Failed to close terminal:", e);
        showToast("Failed to close terminal", "error");
      }
    }
    terminalStore.getState().clearSession(sessionId);

    try {
      await closeSessionCmd(sessionId);
    } catch (e) {
      handleError("Failed to close session", e);
    }

    sessionStore.getState().removeSession(sessionId);
    activityStore.getState().clearEntries(sessionId);
    useAttachmentStore.getState().clearSession(sessionId);
    changelogStore.getState().clearSession(sessionId);
    inputDrafts.delete(sessionId);
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
      handleError("Failed to rename session", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const resumeFromHistory = useCallback(async (
    projectPath: string,
    cliSessionId: string,
    originalName: string,
    originalSessionId?: string
  ): Promise<string> => {
    const state = sessionStore.getState();
    if (state.tabOrder.length >= MAX_SESSIONS) {
      showToast(`Maximum ${MAX_SESSIONS} sessions allowed`, "error");
      throw new Error(`Maximum ${MAX_SESSIONS} sessions allowed`);
    }

    try {
      const session = await createSession(projectPath, originalName, cliSessionId);
      sessionStore.getState().addSession(session);

      // Always load stored messages if they exist (regardless of current sessionLogsEnabled toggle —
      // the toggle controls saving, not loading; previously saved messages should always be accessible)
      if (originalSessionId) {
        try {
          const stored = await loadSessionMessages(originalSessionId);
          console.info(`[resumeFromHistory] Loaded ${stored.length} stored messages for ${originalSessionId} → new session ${session.id}`);
          if (stored.length > 0) {
            const restoredMessages: Message[] = stored.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: m.timestamp,
              activityIds: [],
              isStreaming: false,
              thinkingContent: m.thinkingContent ?? undefined,
              isRestored: true,
            }));
            const storeState = sessionStore.getState();
            const sessionMessages = new Map(storeState.sessionMessages);
            sessionMessages.set(session.id, restoredMessages);
            sessionStore.setState({ sessionMessages });
          }
        } catch (e) {
          console.error("[resumeFromHistory] Failed to load stored messages:", e);
        }
      }

      const unlistenChat = await listenChatEvents(session.id, (event) =>
        handleChatEvent(session.id, event)
      );
      const unlistenActivity = await listenActivityEvents(session.id, (event) =>
        handleActivityEvent(session.id, event)
      );

      sessionListeners.set(session.id, [unlistenChat, unlistenActivity]);

      startStaleDetection(session.id);

      initializeSession(session.id).catch((e) =>
        console.error("Failed to discover session capabilities:", e)
      );

      useUiStore.getState().setShowClaudeHistory(false);

      return session.id;
    } catch (e) {
      showToast(translateErrorForToast(String(e)), "error");
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
