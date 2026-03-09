import { useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useAssistantStore } from "../stores/assistantStore";
import {
  createSession,
  sendMessage as sendMessageCmd,
  closeSession as closeSessionCmd,
  listenChatEvents,
  listenActivityEvents,
} from "../lib/tauri-commands";
import { handleAssistantChatEvent } from "../lib/assistant-event-handler";
import { handleActivityEvent } from "../lib/event-classifier";

// Module-level listener map for assistant sessions
const assistantListeners = new Map<string, UnlistenFn[]>();

const MAX_ASSISTANTS = 6;

interface UseAssistantSessionReturn {
  createAssistant: (projectPath: string) => Promise<string>;
  sendMessage: (sessionId: string, prompt: string) => void;
  closeAssistant: (projectPath: string, sessionId: string) => Promise<void>;
  closeAllAssistants: (projectPath: string) => Promise<void>;
}

export function useAssistantSession(): UseAssistantSessionReturn {
  const createAssistant = useCallback(async (projectPath: string): Promise<string> => {
    const store = useAssistantStore.getState();
    const existing = store.getAssistants(projectPath);
    if (existing.length >= MAX_ASSISTANTS) {
      throw new Error(`Maximum ${MAX_ASSISTANTS} assistants allowed`);
    }

    const num = existing.length + 1;
    const session = await createSession(projectPath, `Assistant ${num}`, true);

    store.addAssistant(projectPath, {
      id: session.id,
      projectPath,
      name: `Assistant ${num}`,
      sortOrder: num,
      createdAt: new Date().toISOString(),
    });

    const unlistenChat = await listenChatEvents(session.id, (event) =>
      handleAssistantChatEvent(session.id, event)
    );
    const unlistenActivity = await listenActivityEvents(session.id, (event) =>
      handleActivityEvent(session.id, event)
    );

    assistantListeners.set(session.id, [
      unlistenChat,
      unlistenActivity,
    ]);

    return session.id;
  }, []);

  const sendMessage = useCallback((sessionId: string, prompt: string) => {
    const store = useAssistantStore.getState();

    const msgId = `asst-user-${Date.now()}`;
    store.addMessage(sessionId, {
      id: msgId,
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    store.setBusy(sessionId, true);

    sendMessageCmd(sessionId, prompt).catch((e) => {
      console.error("Failed to send assistant message:", e);
      store.setBusy(sessionId, false);
    });
  }, []);

  const closeAssistant = useCallback(async (projectPath: string, sessionId: string) => {
    const listeners = assistantListeners.get(sessionId);
    if (listeners) {
      for (const unlisten of listeners) {
        unlisten();
      }
      assistantListeners.delete(sessionId);
    }

    try {
      await closeSessionCmd(sessionId);
    } catch (e) {
      console.error("Failed to close assistant session:", e);
    }

    useAssistantStore.getState().removeAssistant(projectPath, sessionId);
  }, []);

  const closeAllAssistants = useCallback(async (projectPath: string) => {
    const store = useAssistantStore.getState();
    const sessionIds = store.getAllSessionIds(projectPath);

    for (const sessionId of sessionIds) {
      const listeners = assistantListeners.get(sessionId);
      if (listeners) {
        for (const unlisten of listeners) {
          unlisten();
        }
        assistantListeners.delete(sessionId);
      }
      try {
        await closeSessionCmd(sessionId);
      } catch (e) {
        console.error("Failed to close assistant session:", e);
      }
    }

    store.clearProject(projectPath);
  }, []);

  return { createAssistant, sendMessage, closeAssistant, closeAllAssistants };
}

// Exported for use in useClaudeSession cleanup
export function getAssistantListeners(): Map<string, UnlistenFn[]> {
  return assistantListeners;
}
