import { useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useAssistantStore } from "../stores/assistantStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { AIProvider, APIProvider } from "../types/assistant-provider";
import {
  createSession,
  sendMessage as sendMessageCmd,
  closeSession as closeSessionCmd,
  listenChatEvents,
  listenActivityEvents,
  sendAssistantChat,
  listenAssistantStream,
} from "../lib/tauri-commands";
import { handleAssistantChatEvent } from "../lib/assistant-event-handler";
import { handleActivityEvent } from "../lib/event-classifier";

// Module-level listener map for assistant sessions
const assistantListeners = new Map<string, UnlistenFn[]>();

const MAX_ASSISTANTS = 6;

const DEFAULT_SYSTEM_PROMPT = `You are a helpful coding assistant. You help with programming questions, code review, debugging, and software architecture. Be concise and direct. Use markdown for code blocks and formatting.`;

interface UseAssistantSessionReturn {
  createAssistant: (projectPath: string, provider: AIProvider, model?: string) => Promise<string>;
  sendMessage: (sessionId: string, prompt: string) => void;
  closeAssistant: (projectPath: string, sessionId: string) => Promise<void>;
  closeAllAssistants: (projectPath: string) => Promise<void>;
}

export function useAssistantSession(): UseAssistantSessionReturn {
  const createAssistant = useCallback(async (
    projectPath: string,
    provider: AIProvider,
    model?: string,
  ): Promise<string> => {
    const store = useAssistantStore.getState();
    const existing = store.getAssistants(projectPath);
    if (existing.length >= MAX_ASSISTANTS) {
      throw new Error(`Maximum ${MAX_ASSISTANTS} assistants allowed`);
    }

    const num = existing.length + 1;
    const providerLabel = provider === "claude-code" ? "Claude" :
      provider === "openai" ? "GPT" :
      provider === "gemini" ? "Gemini" :
      "Anthropic";
    const name = `${providerLabel} ${num}`;

    if (provider === "claude-code") {
      // Claude Code: create a CLI session
      const session = await createSession(projectPath, name);

      store.addAssistant(projectPath, {
        id: session.id,
        projectPath,
        name,
        provider,
        model: null,
        sortOrder: num,
        createdAt: new Date().toISOString(),
      });

      const unlistenChat = await listenChatEvents(session.id, (event) =>
        handleAssistantChatEvent(session.id, event)
      );
      const unlistenActivity = await listenActivityEvents(session.id, (event) =>
        handleActivityEvent(session.id, event)
      );

      assistantListeners.set(session.id, [unlistenChat, unlistenActivity]);
      return session.id;
    } else {
      // API provider: generate a local ID, no CLI session
      const id = `api-asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      store.addAssistant(projectPath, {
        id,
        projectPath,
        name,
        provider,
        model: model ?? null,
        sortOrder: num,
        createdAt: new Date().toISOString(),
      });
      return id;
    }
  }, []);

  const sendMessage = useCallback((sessionId: string, prompt: string) => {
    const store = useAssistantStore.getState();
    const instance = store.findAssistantInstance(sessionId);
    if (!instance) return;

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

    if (instance.provider === "claude-code") {
      // Send via CLI
      sendMessageCmd(sessionId, prompt).catch((e) => {
        console.error("Failed to send assistant message:", e);
        store.setBusy(sessionId, false);
      });
    } else {
      // Send via API
      sendApiMessage(sessionId, instance.provider as APIProvider, instance.model).catch((e) => {
        console.error("Failed to send API assistant message:", e);
        store.setBusy(sessionId, false);
        store.addMessage(sessionId, {
          id: `asst-err-${Date.now()}`,
          role: "assistant",
          content: `**Error:** ${String(e)}`,
          timestamp: new Date().toISOString(),
          activityIds: [],
          isStreaming: false,
        });
      });
    }
  }, []);

  const closeAssistant = useCallback(async (projectPath: string, sessionId: string) => {
    const store = useAssistantStore.getState();
    const instance = store.findAssistantInstance(sessionId);

    const listeners = assistantListeners.get(sessionId);
    if (listeners) {
      for (const unlisten of listeners) {
        unlisten();
      }
      assistantListeners.delete(sessionId);
    }

    if (instance?.provider === "claude-code") {
      try {
        await closeSessionCmd(sessionId);
      } catch (e) {
        console.error("Failed to close assistant session:", e);
      }
    }

    store.removeAssistant(projectPath, sessionId);
  }, []);

  const closeAllAssistants = useCallback(async (projectPath: string) => {
    const store = useAssistantStore.getState();
    const assistants = store.getAssistants(projectPath);

    for (const asst of assistants) {
      const listeners = assistantListeners.get(asst.id);
      if (listeners) {
        for (const unlisten of listeners) {
          unlisten();
        }
        assistantListeners.delete(asst.id);
      }
      if (asst.provider === "claude-code") {
        try {
          await closeSessionCmd(asst.id);
        } catch (e) {
          console.error("Failed to close assistant session:", e);
        }
      }
    }

    store.clearProject(projectPath);
  }, []);

  return { createAssistant, sendMessage, closeAssistant, closeAllAssistants };
}

/** Send a message to an API provider (OpenAI/Gemini/Anthropic) with streaming. */
async function sendApiMessage(
  sessionId: string,
  provider: APIProvider,
  model: string | null,
): Promise<void> {
  const store = useAssistantStore.getState();
  const settings = useSettingsStore.getState().settings;

  const apiKey = settings.apiKeys[provider] ?? "";
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Set it in Settings > AI Providers.`);
  }

  if (!model) {
    throw new Error(`No model selected for ${provider}.`);
  }

  // Build conversation history from stored messages
  const allMessages = store.messages.get(sessionId) ?? [];
  const chatHistory = allMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  // Create streaming message placeholder
  const assistantMsgId = `asst-api-${Date.now()}`;
  store.addMessage(sessionId, {
    id: assistantMsgId,
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: true,
  });
  store.startStreaming(sessionId, assistantMsgId);

  // Set up stream listener before invoking
  const unlisten = await listenAssistantStream(sessionId, (event) => {
    const s = useAssistantStore.getState();
    switch (event.type) {
      case "delta":
        s.appendStreamingContent(sessionId, event.text ?? "");
        break;
      case "done":
        s.finalizeStreaming(sessionId, event.content);
        s.setBusy(sessionId, false);
        if (event.inputTokens != null && event.outputTokens != null) {
          s.addTokenUsage(sessionId, event.inputTokens, event.outputTokens);
        }
        unlisten();
        break;
      case "error":
        s.finalizeStreaming(sessionId);
        s.setBusy(sessionId, false);
        s.addMessage(sessionId, {
          id: `asst-err-${Date.now()}`,
          role: "assistant",
          content: `**Error:** ${event.message ?? "Unknown error"}`,
          timestamp: new Date().toISOString(),
          activityIds: [],
          isStreaming: false,
        });
        unlisten();
        break;
    }
  });

  // Invoke the backend streaming command
  await sendAssistantChat({
    assistantId: sessionId,
    provider,
    apiKey,
    model,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    messages: chatHistory,
  });
}

// Exported for use in useClaudeSession cleanup
export function getAssistantListeners(): Map<string, UnlistenFn[]> {
  return assistantListeners;
}
