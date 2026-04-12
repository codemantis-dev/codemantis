import { useCallback, useRef } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sendAssistantChat, listenAssistantStream, cancelAssistantChat, listTemplates, gatherSpecContext, readFileContent } from "../lib/tauri-commands";
import { getProviderForModel, DEFAULT_SPEC_MODEL, isSpecModelAvailable, autoSelectSpecModel } from "../types/assistant-provider";
import { useOpenRouterStore } from "../stores/openRouterStore";
import type { SpecMessage, SpecAttachment } from "../types/spec-writer";
import type { ContentPart } from "../lib/tauri-commands";
import { SPEC_READY_PATTERNS, SPEC_START_PATTERN, AUDIT_START_PATTERN, AUDIT_FILE_PATTERN, isLikelySpecDocument, buildSystemPrompt } from "../lib/spec-prompts";
import { parseSelectableOptions } from "../lib/spec-option-parser";
import { handleFileRequests } from "../lib/spec-file-requests";
import { fileToBase64, isTextMime } from "../lib/file-utils";

export function useSpecConversation(): {
  sendMessage: (
    projectPath: string,
    content: string,
    attachments?: SpecAttachment[]
  ) => Promise<void>;
  writeSpec: (projectPath: string) => void;
  generateAudit: (projectPath: string) => void;
  loadContext: (projectPath: string) => Promise<void>;
  cancelStream: (projectPath: string) => void;
} {
  const unlistenRef = useRef<(() => void) | null>(null);
  const streamBufferRef = useRef("");
  const flushScheduledRef = useRef<number | null>(null);
  const specDetectedRef = useRef(false);
  const auditDetectedRef = useRef(false);
  const preStreamSpecRef = useRef<string | null>(null);

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
        const rawModel = settings.taskBoardPlanningModel || DEFAULT_SPEC_MODEL;
        const orHasModel = (id: string) => useOpenRouterStore.getState().hasModel(id);
        const planningModel = isSpecModelAvailable(rawModel, settings.apiKeys, orHasModel)
          ? rawModel
          : autoSelectSpecModel(settings.apiKeys);
        const provider = getProviderForModel(planningModel, orHasModel) ?? "gemini";
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
      const filteredMessages = updatedConv.messages.filter((m) => {
        if (m.role === 'user' || m.role === 'assistant') return true;
        if (m.role === 'system' && (m.message_type === 'file_context' || m.message_type === 'context_summary')) return true;
        return false;
      });
      const apiMessages: { role: string; content: string | ContentPart[] }[] =
        await Promise.all(filteredMessages.map(async (m) => {
            const apiRole = m.role === 'system' ? 'user' : m.role;

            // If message has file attachments, build multimodal content parts
            if (m.attachments && m.attachments.length > 0) {
              const parts: ContentPart[] = [{ type: "text", text: m.content }];
              for (const att of m.attachments) {
                if (att.type === "image" && att.preview_url) {
                  const base64 = att.preview_url.split(",")[1] ?? att.preview_url;
                  parts.push({ type: "image", mime_type: att.mime_type, data: base64 });
                } else if (att.type === "document" && isTextMime(att.mime_type)) {
                  // Text-readable files → include as readable text
                  if (att.text_content) {
                    parts.push({ type: "text", text: `--- ${att.name} ---\n${att.text_content}` });
                  }
                } else if (att.type === "document" && att.file_path) {
                  // Binary files (PDF, docx, etc.) → send as document part
                  try {
                    const { data, mimeType } = await fileToBase64(att.file_path);
                    parts.push({ type: "document", mime_type: mimeType, data });
                  } catch {
                    if (att.text_content) {
                      parts.push({ type: "text", text: `--- ${att.name} ---\n${att.text_content}` });
                    }
                  }
                } else if (att.type === "document" && att.text_content) {
                  parts.push({ type: "text", text: `--- ${att.name} ---\n${att.text_content}` });
                }
              }
              return { role: apiRole, content: parts };
            }
            return { role: apiRole, content: m.content };
          }));

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
      specDetectedRef.current = false;
      auditDetectedRef.current = false;
      preStreamSpecRef.current = useSpecWriterStore.getState().currentSpecContent.get(projectPath) ?? null;

      if (unlistenRef.current) {
        unlistenRef.current();
      }

      // Flush accumulated stream buffer to store (batched via RAF)
      // Audit detection takes priority — an audit document is never also a spec.
      const flushStreamBuffer = (): void => {
        flushScheduledRef.current = null;
        const buf = streamBufferRef.current;
        if (!buf) return;
        const store = useSpecWriterStore.getState();
        store.updateLastAssistantMessage(projectPath, buf);
        if (auditDetectedRef.current || AUDIT_START_PATTERN.test(buf)) {
          // If we previously misidentified this stream as a spec, restore original
          if (!auditDetectedRef.current && specDetectedRef.current) {
            specDetectedRef.current = false;
            store.setCurrentSpecContent(projectPath, preStreamSpecRef.current);
          }
          auditDetectedRef.current = true;
          store.setCurrentAuditContent(projectPath, buf);
        } else if (specDetectedRef.current || SPEC_START_PATTERN.test(buf) || isLikelySpecDocument(buf)) {
          specDetectedRef.current = true;
          store.setCurrentSpecContent(projectPath, buf);
        }
      };

      unlistenRef.current = await listenAssistantStream(assistantId, (event) => {
        const currentStore = useSpecWriterStore.getState();

        if (event.type === "delta" && event.text) {
          streamBufferRef.current += event.text;
          // Batch store updates to one per animation frame (~16/sec instead of 50-100/sec)
          if (flushScheduledRef.current === null) {
            flushScheduledRef.current = requestAnimationFrame(flushStreamBuffer);
          }
        }

        if (event.type === "done") {
          // Cancel pending RAF — completeTurn will write the final content
          if (flushScheduledRef.current !== null) {
            cancelAnimationFrame(flushScheduledRef.current);
            flushScheduledRef.current = null;
          }

          const finalContent = streamBufferRef.current;
          const parsed = parseSelectableOptions(finalContent);
          // Audit takes priority — a document matching AUDIT_START_PATTERN is never also a spec
          const isAudit = AUDIT_START_PATTERN.test(finalContent);
          const isSpec = !isAudit && (SPEC_START_PATTERN.test(finalContent) || isLikelySpecDocument(finalContent));
          const isReadyToWrite = SPEC_READY_PATTERNS.some((p) => p.test(finalContent));

          // Single batched store update: streaming=false, content, status, message type
          currentStore.completeTurn(projectPath, {
            finalContent,
            isSpec,
            isAudit,
            displayContent: parsed?.cleanContent,
            options: parsed?.options,
            isReadyToWrite,
          });

          // Post-turn side effects (separate updates are fine — core state is already committed)
          if (isSpec) {
            const existingAudit = useSpecWriterStore.getState().currentAuditContent.get(projectPath);
            if (!existingAudit) {
              currentStore.addMessage(projectPath, {
                id: `msg-audit-offer-${Date.now()}`,
                role: "system",
                content: `Spec complete! **Generate a Verification Audit?** This is a companion document that Claude Code uses to self-check its implementation — it opens every file, reads the actual code, and verifies it matches the spec.\n\nThis is the single most important step for implementation quality.`,
                message_type: "conversation",
                timestamp: new Date().toISOString(),
                parsedOptions: [
                  "\u{1F4CB} Yes, generate the Verification Audit",
                  "Not now \u2014 I'll generate it later",
                ],
              });
            }
          }

          // Fallback: audit may have been saved to a file instead of output inline
          if (!isAudit) {
            const auditFileMatch = finalContent.match(AUDIT_FILE_PATTERN);
            if (auditFileMatch) {
              const auditPath = auditFileMatch[1].startsWith("/")
                ? auditFileMatch[1]
                : `${projectPath}/${auditFileMatch[1]}`;
              void readFileContent(auditPath).then((content) => {
                if (AUDIT_START_PATTERN.test(content)) {
                  currentStore.setCurrentAuditContent(projectPath, content);
                  currentStore.persistState(projectPath);
                }
              }).catch(() => { /* file may not exist yet */ });
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
          // Cancel pending RAF
          if (flushScheduledRef.current !== null) {
            cancelAnimationFrame(flushScheduledRef.current);
            flushScheduledRef.current = null;
          }

          currentStore.setPlanningStreaming(projectPath, false);

          // If the last assistant message is empty (no deltas arrived), remove the placeholder
          const conv = currentStore.getActiveConversation(projectPath);
          if (conv && conv.messages.length > 0) {
            const lastMsg = conv.messages[conv.messages.length - 1];
            if (lastMsg.role === 'assistant' && !lastMsg.content.trim()) {
              useSpecWriterStore.setState((state) => {
                const conversations = new Map(state.conversations);
                const c = conversations.get(projectPath);
                if (c) {
                  conversations.set(projectPath, {
                    ...c,
                    messages: c.messages.slice(0, -1),
                  });
                }
                return { conversations };
              });
            }
          }

          // Confirm cancellation to the user
          currentStore.addMessage(projectPath, {
            id: `msg-cancel-${Date.now()}`,
            role: "system",
            content: "Generation stopped.",
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });

          streamBufferRef.current = "";
          currentStore.persistState(projectPath);
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }

        if (event.type === "error") {
          if (flushScheduledRef.current !== null) {
            cancelAnimationFrame(flushScheduledRef.current);
            flushScheduledRef.current = null;
          }

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

  const generateAudit = useCallback(
    (projectPath: string) => {
      sendMessage(
        projectPath,
        "Generate the Verification Audit document for the spec you just wrote. " +
        "Output the COMPLETE document directly in your response — do NOT save it to a file. " +
        "This is a guided code review document that Claude Code will use AFTER " +
        "implementation to verify every component, state, validation, and " +
        "integration point. Follow the Verification Audit format from your instructions."
      );
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
    generateAudit,
    loadContext,
    cancelStream,
  };
}
