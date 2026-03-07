import { useCallback, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import {
  createSession,
  sendMessage as sendMessageCmd,
  closeSession as closeSessionCmd,
  listenChatEvents,
  listenActivityEvents,
  listenApprovalEvents,
} from "../lib/tauri-commands";
import {
  handleChatEvent,
  handleActivityEvent,
  handleApprovalEvent,
} from "../lib/event-classifier";

interface UseClaudeSessionReturn {
  startSession: (projectPath: string) => Promise<void>;
  sendMessage: (prompt: string) => Promise<void>;
  closeSession: () => Promise<void>;
}

export function useClaudeSession(): UseClaudeSessionReturn {
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const sessionStore = useSessionStore;
  const activityStore = useActivityStore;

  const startSession = useCallback(async (projectPath: string) => {
    try {
      console.log("[session] Creating session for:", projectPath);
      const session = await createSession(projectPath);
      console.log("[session] Session created:", session.id, session);
      sessionStore.getState().setSession(session);

      const unlistenChat = await listenChatEvents(session.id, handleChatEvent);
      const unlistenActivity = await listenActivityEvents(
        session.id,
        handleActivityEvent
      );
      const unlistenApproval = await listenApprovalEvents(
        session.id,
        handleApprovalEvent
      );

      unlistenRefs.current = [unlistenChat, unlistenActivity, unlistenApproval];
    } catch (e) {
      console.error("Failed to start session:", e);
      throw e;
    }
  }, []);

  const sendMessage = useCallback(async (prompt: string) => {
    const session = sessionStore.getState().session;
    if (!session) return;

    const msgId = `user-${Date.now()}`;
    sessionStore.getState().addMessage({
      id: msgId,
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    try {
      console.log("[session] Sending message:", prompt.slice(0, 100));
      await sendMessageCmd(session.id, prompt);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  }, []);

  const closeSession = useCallback(async () => {
    const session = sessionStore.getState().session;
    if (!session) return;

    for (const unlisten of unlistenRefs.current) {
      unlisten();
    }
    unlistenRefs.current = [];

    try {
      await closeSessionCmd(session.id);
    } catch (e) {
      console.error("Failed to close session:", e);
    }

    sessionStore.getState().setSession(null);
    sessionStore.getState().clearMessages();
    activityStore.getState().clearEntries();
  }, []);

  return { startSession, sendMessage, closeSession };
}
