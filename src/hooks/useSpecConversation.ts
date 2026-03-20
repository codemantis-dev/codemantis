import { useCallback, useRef } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sendAssistantChat, listenAssistantStream, cancelAssistantChat, listTemplates, gatherSpecContext } from "../lib/tauri-commands";
import { getProviderForModel } from "../types/assistant-provider";
import type { SpecMessage, SpecAttachment } from "../types/spec-writer";
import type { ContentPart } from "../lib/tauri-commands";
import { SPEC_READY_PATTERNS, SPEC_START_PATTERN, buildSystemPrompt } from "../lib/spec-prompts";
import { handleFileRequests } from "../lib/spec-file-requests";

export function useSpecConversation(): {
  sendMessage: (
    projectPath: string,
    content: string,
    attachments?: SpecAttachment[]
  ) => Promise<void>;
  writeSpec: (projectPath: string) => void;
  loadContext: (projectPath: string) => Promise<void>;
  cancelStream: (projectPath: string) => void;
} {
  const unlistenRef = useRef<(() => void) | null>(null);
  const streamBufferRef = useRef("");

  const loadContext = useCallback(async (projectPath: string) => {
    try {
      const context = await gatherSpecContext(projectPath);
      const store = useSpecWriterStore.getState();
      store.setProjectContext(projectPath, context);
      store.setContextLoaded(projectPath, true);
    } catch (e) {
      console.warn("[useSpecConversation] Context gathering failed:", e);
      useSpecWriterStore.getState().setContextLoaded(projectPath, false);
    }
  }, []);

  /**
   * After streaming completes, detect 📂 REQUEST_FILES markers, read files,
   * and inject contents as a system message into the conversation.
   */
  const handleFileRequestsForConversation = useCallback(async (projectPath: string, responseText: string): Promise<boolean> => {
    const store = useSpecWriterStore.getState();
    store.setFileRequestsPending(projectPath, true);

    try {
      const result = await handleFileRequests(projectPath, responseText);
      if (!result) return false;

      const { fullContent, displayContent } = result;

      // Inject as system message with file_context type
      // The AI sees the full content; the UI renders the abbreviated version
      store.addMessage(projectPath, {
        id: `msg-files-${Date.now()}`,
        role: "system",
        content: fullContent,
        message_type: "file_context",
        timestamp: new Date().toISOString(),
      });

      // Also store the display text for UI rendering
      void displayContent; // used by SpecChatMessage via parsing

      store.persistState(projectPath);
      return true;
    } catch (e) {
      console.warn("[useSpecConversation] File request failed:", e);
      store.addMessage(projectPath, {
        id: `msg-files-err-${Date.now()}`,
        role: "system",
        content: `Failed to load requested files: ${e}`,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      });
      return false;
    } finally {
      store.setFileRequestsPending(projectPath, false);
    }
  }, []);

  const sendMessage = useCallback(
    async (
      projectPath: string,
      content: string,
      attachments?: SpecAttachment[]
    ) => {
      const store = useSpecWriterStore.getState();
      const settings = useSettingsStore.getState().settings;
      let conv = store.getActiveConversation(projectPath);

      // Initialize conversation if needed
      if (!conv) {
        const planningModel = settings.taskBoardPlanningModel || "gemini-2.5-flash";
        const provider = getProviderForModel(planningModel) ?? "gemini";
        const model = planningModel;

        // Determine mode: feature if there's an active project context
        // Default to 'feature' mode — user can switch via mode selector before first message
        const mode = 'feature' as const;

        let templateCatalog = "";
        try {
          const templates = await listTemplates();
          templateCatalog = templates
            .map((t) => {
              let entry = `- ${t.id}: "${t.name}" [${t.category}]\n  ${t.description}`;
              if (t.long_description) entry += `\n  Details: ${t.long_description}`;
              if (t.tags.length > 0) entry += `\n  Tech: ${t.tags.join(', ')}`;
              entry += `\n  Install: ${t.install_command} | Dev: ${t.dev_command}`;
              if (t.prerequisites) entry += `\n  Requires: ${t.prerequisites}`;
              return entry;
            })
            .join("\n");
        } catch {
          // Continue without template catalog
        }
        store.initConversation(projectPath, provider, model, mode, templateCatalog);
        conv = store.getActiveConversation(projectPath)!;
      }

      const apiKey = settings.apiKeys[conv.ai_provider] ?? "";
      if (!apiKey) {
        store.addMessage(projectPath, {
          id: `msg-${Date.now()}`,
          role: "system",
          content: `No API key configured for ${conv.ai_provider}. Please add one in Settings → AI Providers.`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Add user message
      const userMessage: SpecMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        attachments,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      };
      store.addMessage(projectPath, userMessage);

      // Build API messages — include system messages (file_context etc.) for the AI
      const updatedConv = useSpecWriterStore.getState().getActiveConversation(projectPath)!;
      const apiMessages: { role: string; content: string | ContentPart[] }[] =
        updatedConv.messages
          .filter((m) => {
            // Include user and assistant messages
            if (m.role === 'user' || m.role === 'assistant') return true;
            // Include file_context and context_summary system messages as user messages
            // so the AI sees the file contents
            if (m.role === 'system' && (m.message_type === 'file_context' || m.message_type === 'context_summary')) return true;
            return false;
          })
          .map((m) => {
            // System messages with file context become user messages for the API
            const apiRole = m.role === 'system' ? 'user' : m.role;

            // If message has image attachments, build multimodal content
            if (m.attachments?.some((a) => a.type === "image" && a.preview_url)) {
              const parts: ContentPart[] = [{ type: "text", text: m.content }];
              for (const att of m.attachments) {
                if (att.type === "image" && att.preview_url) {
                  const base64 = att.preview_url.split(",")[1] ?? att.preview_url;
                  parts.push({
                    type: "image",
                    mime_type: att.mime_type,
                    data: base64,
                  });
                }
              }
              return { role: apiRole, content: parts };
            }
            // If message has document attachments, append text content
            let text = m.content;
            if (m.attachments) {
              for (const att of m.attachments) {
                if (att.type === "document" && att.text_content) {
                  text += `\n\n--- Attached document: ${att.name} ---\n${att.text_content}`;
                }
              }
            }
            return { role: apiRole, content: text };
          });

      // Add assistant placeholder for streaming
      const assistantMsg: SpecMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "",
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      };
      store.addMessage(projectPath, assistantMsg);
      store.setPlanningStreaming(projectPath, true);

      // Setup stream listener
      const assistantId = `spec-${projectPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      streamBufferRef.current = "";

      if (unlistenRef.current) {
        unlistenRef.current();
      }

      unlistenRef.current = await listenAssistantStream(assistantId, (event) => {
        const currentStore = useSpecWriterStore.getState();

        if (event.type === "delta" && event.text) {
          streamBufferRef.current += event.text;
          currentStore.updateLastAssistantMessage(projectPath, streamBufferRef.current);

          // Check for spec content during streaming
          if (SPEC_START_PATTERN.test(streamBufferRef.current)) {
            currentStore.setCurrentSpecContent(projectPath, streamBufferRef.current);
          }
        }

        if (event.type === "done") {
          currentStore.setPlanningStreaming(projectPath, false);
          const finalContent = streamBufferRef.current;

          // Parse selectable options from ?> markers (allow leading whitespace)
          const optionPattern = /^\s*\?>\s*(.+)$/gm;
          const options: string[] = [];
          let m;
          while ((m = optionPattern.exec(finalContent)) !== null) {
            options.push(m[1].trim());
          }
          if (options.length > 0) {
            const cleanContent = finalContent.replace(/^\s*\?>\s*.+$/gm, '').trim();
            currentStore.updateLastAssistantMessage(projectPath, cleanContent);
            currentStore.setMessageOptions(projectPath, options);
          }

          // Check if AI is ready to write spec
          if (SPEC_READY_PATTERNS.some((p) => p.test(finalContent))) {
            currentStore.setConversationStatus(projectPath, "ready_to_write");
          }

          // Check for spec document output
          if (SPEC_START_PATTERN.test(finalContent)) {
            currentStore.setCurrentSpecContent(projectPath, finalContent);
            currentStore.setConversationStatus(projectPath, "done");
            // Update the message type to spec_document
            const conv = currentStore.getActiveConversation(projectPath);
            if (conv && conv.messages.length > 0) {
              const messages = [...conv.messages];
              const lastIdx = messages.length - 1;
              if (messages[lastIdx].role === 'assistant') {
                messages[lastIdx] = { ...messages[lastIdx], message_type: 'spec_document' };
              }
              useSpecWriterStore.setState((state) => {
                const conversations = new Map(state.conversations);
                const c = conversations.get(projectPath);
                if (c) {
                  conversations.set(projectPath, { ...c, messages });
                }
                return { conversations };
              });
            }
          }

          // Cleanup FIRST (synchronous) — clear buffer, persist, unlisten
          streamBufferRef.current = "";
          currentStore.persistState(projectPath);
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }

          // THEN handle file requests + auto-continue (async, fire-and-forget)
          // Safe because sendMessage creates a new stream listener,
          // and the auto-continue text contains no REQUEST_FILES markers.
          void (async () => {
            const filesLoaded = await handleFileRequestsForConversation(projectPath, finalContent);
            if (filesLoaded) {
              await sendMessage(
                projectPath,
                "Files loaded. Continue your analysis using the file contents above."
              );
            }
          })();
        }

        if (event.type === "cancelled") {
          currentStore.setPlanningStreaming(projectPath, false);
          streamBufferRef.current = "";
          currentStore.persistState(projectPath);
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }

        if (event.type === "error") {
          currentStore.setPlanningStreaming(projectPath, false);
          currentStore.addMessage(projectPath, {
            id: `msg-err-${Date.now()}`,
            role: "system",
            content: `Error: ${event.message ?? "Unknown error"}`,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }
      });

      // Build system prompt — read project context from store
      const projectContext = useSpecWriterStore.getState().projectContext.get(projectPath) ?? "";
      const systemPrompt = buildSystemPrompt(
        conv.mode,
        conv.templateCatalog ?? '',
        projectContext
      );

      // Send the API call
      try {
        await sendAssistantChat({
          assistantId,
          provider: conv.ai_provider,
          apiKey,
          model: conv.ai_model,
          systemPrompt,
          messages: apiMessages,
          maxTokens: settings.taskBoardMaxTokens || 64000,
        });
      } catch (err) {
        store.setPlanningStreaming(projectPath, false);
        store.addMessage(projectPath, {
          id: `msg-err-${Date.now()}`,
          role: "system",
          content: `Failed to send message: ${err}`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
      }
    },
    [handleFileRequestsForConversation]
  );

  const writeSpec = useCallback(
    (projectPath: string) => {
      const store = useSpecWriterStore.getState();
      store.setConversationStatus(projectPath, "writing");
      sendMessage(projectPath, "Yes, write the specification now.");
    },
    [sendMessage]
  );

  const cancelStream = useCallback((projectPath: string) => {
    const assistantId = `spec-${projectPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
    cancelAssistantChat(assistantId).catch((e) => {
      console.warn("[useSpecConversation] cancel failed:", e);
    });
  }, []);

  return {
    sendMessage,
    writeSpec,
    loadContext,
    cancelStream,
  };
}
