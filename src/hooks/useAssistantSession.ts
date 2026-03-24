import { useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useAssistantStore } from "../stores/assistantStore";
import { useSettingsStore } from "../stores/settingsStore";
import { AI_MODELS } from "../types/assistant-provider";
import type { AIProvider, APIProvider } from "../types/assistant-provider";
import type { Attachment } from "../types/attachment";
import type { ContentPart } from "../lib/tauri-commands";
import {
  createSession,
  sendMessage as sendMessageCmd,
  closeSession as closeSessionCmd,
  listenChatEvents,
  listenActivityEvents,
  sendAssistantChat,
  listenAssistantStream,
  interruptSession,
  cancelAssistantChat,
} from "../lib/tauri-commands";
import { handleAssistantChatEvent, cleanupAssistantBuffers } from "../lib/assistant-event-handler";
import { handleActivityEvent } from "../lib/event-classifier";
import { fileToBase64, readFileContentSafe, isTextMime } from "../lib/file-utils";
import { handleError } from "../lib/error-handler";
import { translateError, formatErrorAsMarkdown } from "../lib/error-messages";
import { useOpenRouterStore } from "../stores/openRouterStore";

// Module-level listener map for assistant sessions
const assistantListeners = new Map<string, UnlistenFn[]>();

const MAX_ASSISTANTS = 6;

const DEFAULT_SYSTEM_PROMPT = `You are a helpful coding assistant. You help with programming questions, code review, debugging, and software architecture. Be concise and direct. Use markdown for code blocks and formatting.`;

interface UseAssistantSessionReturn {
  createAssistant: (projectPath: string, parentSessionId: string, provider: AIProvider, model?: string) => Promise<string>;
  sendMessage: (sessionId: string, prompt: string, attachments?: Attachment[]) => void;
  retryLastMessage: (sessionId: string) => void;
  cancelAssistant: (sessionId: string) => void;
  closeAssistant: (projectPath: string, sessionId: string) => Promise<void>;
  closeAllAssistants: (projectPath: string) => Promise<void>;
}

export function useAssistantSession(): UseAssistantSessionReturn {
  const createAssistant = useCallback(async (
    projectPath: string,
    parentSessionId: string,
    provider: AIProvider,
    model?: string,
  ): Promise<string> => {
    const store = useAssistantStore.getState();
    const existing = store.getAssistants(projectPath);
    if (existing.length >= MAX_ASSISTANTS) {
      throw new Error(`Maximum ${MAX_ASSISTANTS} assistants allowed`);
    }

    const siblings = existing.filter((a) => a.parentSessionId === parentSessionId);
    const num = siblings.length + 1;
    const providerLabel = provider === "claude-code" ? "Claude" :
      provider === "openai" ? "GPT" :
      provider === "gemini" ? "Gemini" :
      provider === "openrouter" ? "OpenRouter" :
      "Anthropic";
    const name = `${providerLabel} ${num}`;

    if (provider === "claude-code") {
      // Claude Code: create a CLI session
      const session = await createSession(projectPath, name);

      store.addAssistant(projectPath, {
        id: session.id,
        projectPath,
        parentSessionId,
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
      // Resolve model: explicit param > settings default > first model in catalog
      const settings = useSettingsStore.getState().settings;
      const resolvedModel = model
        ?? settings.assistantDefaultModel[provider]
        ?? AI_MODELS[provider as APIProvider]?.[0]?.id
        ?? null;

      const id = `api-asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      store.addAssistant(projectPath, {
        id,
        projectPath,
        parentSessionId,
        name,
        provider,
        model: resolvedModel,
        sortOrder: num,
        createdAt: new Date().toISOString(),
      });
      return id;
    }
  }, []);

  const sendMessage = useCallback(async (sessionId: string, prompt: string, attachments?: Attachment[]) => {
    const store = useAssistantStore.getState();
    const instance = store.findAssistantInstance(sessionId);
    if (!instance) return;

    // Guard against concurrent sends (UI checks busy, but retryLastMessage and other paths may not)
    if (store.busy.get(sessionId)) return;

    // For Claude Code with attachments, inline text content (CLI only accepts text)
    let finalPrompt = prompt;
    if (instance.provider === "claude-code" && attachments && attachments.length > 0) {
      const parts: string[] = [];
      for (const att of attachments) {
        if (att.isImage) {
          parts.push(`[Attached image: ${att.filePath}]`);
        } else if (isTextMime(att.mimeType)) {
          const text = await readFileContentSafe(att.filePath);
          if (text) {
            const truncated = text.slice(0, 30000) + (text.length > 30000 ? "\n..." : "");
            parts.push(`--- ${att.fileName} ---\n${truncated}`);
          } else {
            parts.push(`[Could not read: ${att.fileName}]`);
          }
        } else {
          parts.push(`[Attached file: ${att.filePath} (${att.mimeType})]`);
        }
      }
      finalPrompt = parts.join("\n\n") + (prompt ? "\n\n" + prompt : "");
    }

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
      sendMessageCmd(sessionId, finalPrompt).catch((e) => {
        handleError("Failed to send assistant message", e);
        store.setBusy(sessionId, false);
      });
    } else {
      // Send via API (pass attachments for multimodal)
      sendApiMessage(sessionId, instance.provider as APIProvider, instance.model, attachments).catch((e) => {
        handleError("Failed to send API assistant message", e);
        store.setBusy(sessionId, false);
        store.addMessage(sessionId, {
          id: `asst-err-${Date.now()}`,
          role: "assistant",
          content: formatErrorAsMarkdown(translateError(String(e))),
          timestamp: new Date().toISOString(),
          activityIds: [],
          isStreaming: false,
          retryable: true,
        });
      });
    }
  }, []);

  const retryLastMessage = useCallback((sessionId: string) => {
    const store = useAssistantStore.getState();
    const instance = store.findAssistantInstance(sessionId);
    if (!instance || instance.provider === "claude-code") return;

    const messages = store.messages.get(sessionId) ?? [];
    // Find last user message
    let lastUserMsg: typeof messages[0] | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserMsg = messages[i];
        break;
      }
    }
    if (!lastUserMsg) return;

    // Remove all messages after the last user message (error + empty streaming placeholder)
    store.removeMessagesAfter(sessionId, lastUserMsg.id);

    // Retry the API call
    store.setBusy(sessionId, true);
    sendApiMessage(sessionId, instance.provider as APIProvider, instance.model).catch((e) => {
      handleError("Retry failed", e);
      store.setBusy(sessionId, false);
      store.addMessage(sessionId, {
        id: `asst-err-${Date.now()}`,
        role: "assistant",
        content: formatErrorAsMarkdown(translateError(String(e))),
        timestamp: new Date().toISOString(),
        activityIds: [],
        isStreaming: false,
        retryable: true,
      });
    });
  }, []);

  const cancelAssistant = useCallback((sessionId: string) => {
    const store = useAssistantStore.getState();
    const instance = store.findAssistantInstance(sessionId);
    if (!instance) return;

    if (instance.provider === "claude-code") {
      interruptSession(sessionId).catch((e) =>
        console.error("[assistant] Failed to interrupt CLI session:", e)
      );
    } else {
      cancelAssistantChat(sessionId).catch((e) =>
        console.error("[assistant] Failed to cancel API stream:", e)
      );
    }
  }, []);

  const closeAssistant = useCallback(async (projectPath: string, sessionId: string) => {
    const store = useAssistantStore.getState();
    const instance = store.findAssistantInstance(sessionId);

    // Cancel in-flight API stream if busy (prevents orphaned backend streams)
    if (instance && instance.provider !== "claude-code" && store.busy.get(sessionId)) {
      cancelAssistantChat(sessionId).catch((e) =>
        console.error("[assistant] Failed to cancel API stream on close:", e)
      );
      store.setBusy(sessionId, false);
      const streaming = store.streaming.get(sessionId);
      if (streaming?.isStreaming) {
        store.finalizeStreaming(sessionId);
      }
    }

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
        handleError("Failed to close assistant session", e);
      }
    }

    // Clean up streaming buffers
    cleanupAssistantBuffers(sessionId);

    store.removeAssistant(projectPath, sessionId);
    // Clean up assistant input draft
    const { assistantInputDrafts } = await import("../lib/input-drafts");
    assistantInputDrafts.delete(sessionId);
  }, []);

  const closeAllAssistants = useCallback(async (projectPath: string) => {
    const store = useAssistantStore.getState();
    const assistants = store.getAssistants(projectPath);

    for (const asst of assistants) {
      // Cancel in-flight API streams
      if (asst.provider !== "claude-code" && store.busy.get(asst.id)) {
        cancelAssistantChat(asst.id).catch((e) =>
          console.error("[assistant] Failed to cancel API stream on close:", e)
        );
      }

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

      // Clean up streaming buffers
      cleanupAssistantBuffers(asst.id);
    }

    store.clearProject(projectPath);
  }, []);

  return { createAssistant, sendMessage, retryLastMessage, cancelAssistant, closeAssistant, closeAllAssistants };
}

/** Send a message to an API provider (OpenAI/Gemini/Anthropic) with streaming. */
async function sendApiMessage(
  sessionId: string,
  provider: APIProvider,
  model: string | null,
  attachments?: Attachment[],
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

  // Build conversation history from stored messages (exclude error/retryable messages and empty placeholders)
  const allMessages = store.messages.get(sessionId) ?? [];
  const chatHistory: { role: string; content: string | ContentPart[] }[] = allMessages
    .filter((m) => (m.role === "user" || m.role === "assistant") && !m.retryable && m.content !== "")
    .map((m) => ({ role: m.role, content: m.content as string | ContentPart[] }));

  // Capability check for OpenRouter models — reject attachments if model doesn't support them
  if (provider === "openrouter" && attachments && attachments.length > 0 && model) {
    const orStore = useOpenRouterStore.getState();
    const orModel = orStore.getModel(model);
    if (orModel) {
      const hasImages = attachments.some((a) => a.isImage);
      const hasFiles = attachments.some((a) => !a.isImage);
      if (hasImages && !orModel.inputModalities.includes("image")) {
        throw new Error(`${orModel.name} does not support image inputs. Remove image attachments or switch to a vision-capable model.`);
      }
      if (hasFiles && !orModel.inputModalities.includes("file") && !orModel.inputModalities.includes("image")) {
        throw new Error(`${orModel.name} does not support file attachments. Remove files or switch to a model that supports documents.`);
      }
    }
  }

  // For the last user message, attach images as multimodal content
  if (attachments && attachments.length > 0 && chatHistory.length > 0) {
    const lastMsg = chatHistory[chatHistory.length - 1];
    if (lastMsg.role === "user") {
      const parts: ContentPart[] = [];
      // Add text part
      const textContent = typeof lastMsg.content === "string" ? lastMsg.content : "";
      if (textContent) {
        parts.push({ type: "text", text: textContent });
      }
      // Add file attachments as multimodal content
      for (const att of attachments) {
        if (att.isImage) {
          try {
            const { data, mimeType } = await fileToBase64(att.filePath);
            parts.push({ type: "image", mime_type: mimeType, data });
          } catch (e) {
            console.error("[assistant] Failed to encode image:", e);
          }
        } else if (isTextMime(att.mimeType)) {
          // Text-readable files (.txt, .md, .json, etc.) → include as readable text
          const text = await readFileContentSafe(att.filePath);
          if (text) {
            const truncated = text.slice(0, 30000) + (text.length > 30000 ? "\n..." : "");
            parts.push({ type: "text", text: `--- ${att.fileName} ---\n${truncated}` });
          } else {
            parts.push({ type: "text", text: `[Could not read: ${att.fileName}]` });
          }
        } else {
          // Binary files (PDF, docx, etc.) → send as document part
          try {
            const { data, mimeType } = await fileToBase64(att.filePath);
            parts.push({ type: "document", mime_type: mimeType, data });
          } catch (e) {
            console.error("[assistant] Failed to encode document:", e);
            parts.push({ type: "text", text: `[Attached file: ${att.fileName} — failed to read]` });
          }
        }
      }
      if (parts.length > 0) {
        lastMsg.content = parts;
      }
    }
  }

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

  // Safety-net timeout: if no terminal event arrives within 120s, force-clear busy
  const API_STREAM_TIMEOUT_MS = 120_000;
  let streamTimeoutId: ReturnType<typeof setTimeout> | undefined;

  function clearStreamTimeout(): void {
    if (streamTimeoutId !== undefined) {
      clearTimeout(streamTimeoutId);
      streamTimeoutId = undefined;
    }
  }

  // Set up stream listener before invoking
  const unlisten = await listenAssistantStream(sessionId, (event) => {
    const s = useAssistantStore.getState();
    switch (event.type) {
      case "delta":
        s.appendStreamingContent(sessionId, event.text ?? "");
        break;
      case "done":
        clearStreamTimeout();
        s.finalizeStreaming(sessionId, event.content);
        s.setBusy(sessionId, false);
        if (event.inputTokens != null && event.outputTokens != null) {
          s.addTokenUsage(sessionId, event.inputTokens, event.outputTokens);
        }
        unlisten();
        break;
      case "cancelled":
        clearStreamTimeout();
        s.finalizeStreaming(sessionId, event.content);
        s.setBusy(sessionId, false);
        unlisten();
        break;
      case "error":
        clearStreamTimeout();
        s.finalizeStreaming(sessionId);
        s.setBusy(sessionId, false);
        s.addMessage(sessionId, {
          id: `asst-err-${Date.now()}`,
          role: "assistant",
          content: formatErrorAsMarkdown(translateError(event.message ?? "Unknown error")),
          timestamp: new Date().toISOString(),
          activityIds: [],
          isStreaming: false,
          retryable: true,
        });
        unlisten();
        break;
    }
  });

  streamTimeoutId = setTimeout(() => {
    const s = useAssistantStore.getState();
    if (s.busy.get(sessionId)) {
      console.warn("[assistant:api-timeout] Stream timed out after 120s:", sessionId);
      s.finalizeStreaming(sessionId);
      s.setBusy(sessionId, false);
      s.addMessage(sessionId, {
        id: `asst-timeout-${Date.now()}`,
        role: "assistant",
        content: "**Error:** Response timed out after 120 seconds. Please try again.",
        timestamp: new Date().toISOString(),
        activityIds: [],
        isStreaming: false,
        retryable: true,
      });
      unlisten();
    }
  }, API_STREAM_TIMEOUT_MS);

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
