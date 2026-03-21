import { useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { useUiStore } from "../stores/uiStore";
import { useSessionStore } from "../stores/sessionStore";
import {
  createSession,
  sendMessage as sendMessageCmd,
  setSessionModel,
  setSessionMode,
  initializeSession,
  readUserGuide,
  listenChatEvents,
  closeSession as closeSessionCmd,
} from "../lib/tauri-commands";
import { handleChatEvent } from "../lib/event-classifier";
import { showToast } from "../stores/toastStore";

// Module-level listener storage — persists across re-renders
let helpUnlistenFn: UnlistenFn | null = null;

const SYSTEM_PROMPT = `You are the CodeMantis Help Assistant. You answer questions about how to use
the CodeMantis application.

RULES:
1. Answer ONLY from the user guide below. Do not invent features or UI elements
   that aren't described in the guide.
2. Use EXACT UI labels from the guide: button names ("Save to Project"),
   tab names ("Activity"), modal titles ("MCP Servers"), etc.
3. Include keyboard shortcuts when relevant: "Press ⌘⇧N or click the + button
   in the title bar."
4. Keep answers concise:
   - Simple questions: 2-4 sentences
   - How-to questions: numbered step-by-step (keep steps brief)
   - "What does X do?": explain in 1-2 sentences
5. If the guide doesn't cover the question, say: "I don't have specific
   information about that in my knowledge base. You might find help at
   codemantis.dev/help or by opening a GitHub Issue."
6. Never suggest editing files, running bash commands, or changing code.
   You are a help assistant, not a coding assistant.
7. When listing multiple options (like MCP templates or keyboard shortcuts),
   use brief formatting — don't quote the entire guide section.
8. Be warm and helpful. The user may be new to CodeMantis.

USER GUIDE:

`;

interface UseHelpSessionReturn {
  initHelpSession: () => Promise<void>;
  sendHelpMessage: (message: string) => Promise<void>;
}

export function useHelpSession(): UseHelpSessionReturn {
  const initHelpSession = useCallback(async () => {
    const ui = useUiStore.getState();
    if (ui.helpSessionId) return;

    useUiStore.getState().setHelpError(null);

    try {
      // Determine working directory
      const activeProject = useSessionStore.getState().activeProjectPath;
      const workDir = activeProject ?? (await homeDir());

      // Create the session
      const session = await createSession(workDir, "CodeMantis Help");
      useUiStore.getState().setHelpSessionId(session.id);

      // Initialize per-session maps (without adding to tabs)
      useSessionStore.getState().initHelpSessionMaps(session.id);

      // Register chat event listeners
      const unlistenChat = await listenChatEvents(session.id, (event) =>
        handleChatEvent(session.id, event)
      );
      helpUnlistenFn = unlistenChat;

      // Discover CLI capabilities
      await initializeSession(session.id);

      // Switch to Haiku model
      try {
        await setSessionModel(session.id, "claude-haiku-4-5");
      } catch {
        // Fall back to default model if Haiku unavailable
        console.warn("Failed to set Haiku model for help session, using default");
      }

      // Lock to Plan mode
      await setSessionMode(session.id, "plan");

      // Read user guide and send as first message
      const guide = await readUserGuide();
      await sendMessageCmd(session.id, SYSTEM_PROMPT + guide);

      // Wait for Claude's acknowledgment (first assistant message)
      await waitForFirstAssistantMessage(session.id);

      useUiStore.getState().setHelpSessionReady(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to initialize help session:", message);
      useUiStore.getState().setHelpError(message);
    }
  }, []);

  const sendHelpMessage = useCallback(async (message: string) => {
    const { helpSessionId, helpSessionReady } = useUiStore.getState();
    if (!helpSessionId) return;
    if (!helpSessionReady) {
      showToast("Help assistant is still loading...", "info");
      return;
    }

    // Add user message to store immediately for instant UI feedback
    const msgId = `help-user-${Date.now()}`;
    useSessionStore.getState().addMessage(helpSessionId, {
      id: msgId,
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    useSessionStore.getState().setSessionBusy(helpSessionId, true);

    try {
      await sendMessageCmd(helpSessionId, message);
    } catch (err) {
      console.error("Failed to send help message:", err);
      showToast("Failed to send message", "error");
      useSessionStore.getState().setSessionBusy(helpSessionId, false);
    }
  }, []);

  return { initHelpSession, sendHelpMessage };
}

/** Poll sessionMessages until an assistant message appears. */
function waitForFirstAssistantMessage(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve(); // Resolve anyway — don't block if acknowledgment is slow
    }, 15000);

    const unsub = useSessionStore.subscribe((state) => {
      const messages = state.sessionMessages.get(sessionId);
      if (messages && messages.some((m) => m.role === "assistant" && !m.isStreaming)) {
        clearTimeout(timeout);
        unsub();
        resolve();
      }
    });
  });
}

/** Cleanup help session listeners. Called during app teardown. */
export function cleanupHelpSession(): void {
  if (helpUnlistenFn) {
    helpUnlistenFn();
    helpUnlistenFn = null;
  }
  const helpId = useUiStore.getState().helpSessionId;
  if (helpId) {
    closeSessionCmd(helpId).catch(() => {});
    useUiStore.getState().setHelpSessionId(null);
    useUiStore.getState().setHelpSessionReady(false);
  }
}
