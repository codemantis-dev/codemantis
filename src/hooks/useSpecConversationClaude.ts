import { useCallback, useRef } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  createSpecwriterSession,
  closeSpecwriterSession,
  sendMessage as sendMessageCmd,
  interruptSession,
  listenChatEvents,
  listTemplates,
  gatherSpecContext,
  readFileContent,
} from "../lib/tauri-commands";
import type { FrontendEvent } from "../types/claude-events";
import type { SpecMessage, SpecAttachment } from "../types/spec-writer";
import { DEFAULT_SPEC_CLAUDE_CODE_MODEL } from "../types/assistant-provider";
import {
  SPEC_READY_PATTERNS,
  SPEC_START_PATTERN,
  AUDIT_START_PATTERN,
  AUDIT_FILE_PATTERN,
  buildClaudeCodePrompt,
} from "../lib/spec-prompts";
import { parseSelectableOptions } from "../lib/spec-option-parser";

/**
 * SpecWriter conversation hook for Claude Code CLI sessions.
 * Same interface as useSpecConversation but uses CLI processes
 * (via --append-system-prompt + --model) instead of API calls.
 */
export function useSpecConversationClaude(): {
  sendMessage: (
    projectPath: string,
    content: string,
    attachments?: SpecAttachment[]
  ) => Promise<void>;
  writeSpec: (projectPath: string) => void;
  generateAudit: (projectPath: string) => void;
  loadContext: (projectPath: string) => Promise<void>;
  cancelStream: (projectPath: string) => void;
  changeModel: (projectPath: string, newModel: string) => Promise<void>;
} {
  const unlistenRef = useRef<(() => void) | null>(null);
  const streamBufferRef = useRef("");
  const flushScheduledRef = useRef<number | null>(null);
  const specDetectedRef = useRef(false);
  const auditDetectedRef = useRef(false);

  const loadContext = useCallback(async (projectPath: string) => {
    try {
      const context = await gatherSpecContext(projectPath);
      const store = useSpecWriterStore.getState();
      store.setProjectContext(projectPath, context);
      store.setContextLoaded(projectPath, true);
    } catch (e) {
      console.warn("[useSpecConversationClaude] Context gathering failed:", e);
      useSpecWriterStore.getState().setContextLoaded(projectPath, false);
    }
  }, []);

  /**
   * Ensure a Claude Code CLI session exists for this project's SpecWriter.
   * Creates one lazily on first use.
   */
  const ensureSession = useCallback(async (projectPath: string): Promise<string> => {
    const store = useSpecWriterStore.getState();
    const existingId = store.getCliSessionId(projectPath);
    if (existingId) return existingId;

    const conv = store.getActiveConversation(projectPath);
    if (!conv) throw new Error("No active SpecWriter conversation");

    const model = conv.ai_model || DEFAULT_SPEC_CLAUDE_CODE_MODEL;
    const projectContext = store.projectContext.get(projectPath) ?? "";
    const systemPrompt = buildClaudeCodePrompt(
      conv.mode,
      conv.templateCatalog ?? "",
      projectContext,
    );

    const sessionId = await createSpecwriterSession(projectPath, model, systemPrompt);
    store.setCliSessionId(projectPath, sessionId);

    return sessionId;
  }, []);

  const sendMessage = useCallback(
    async (
      projectPath: string,
      content: string,
      attachments?: SpecAttachment[]
    ) => {
      const store = useSpecWriterStore.getState();
      const conv = store.getActiveConversation(projectPath);

      // Initialize conversation if needed
      if (!conv) {
        const settings = useSettingsStore.getState().settings;
        const model = settings.taskBoardPlanningModel || DEFAULT_SPEC_CLAUDE_CODE_MODEL;
        const mode = "feature" as const;

        let templateCatalog = "";
        try {
          const templates = await listTemplates();
          templateCatalog = templates
            .map((t) => {
              let entry = `- ${t.id}: "${t.name}" [${t.category}]\n  ${t.description}`;
              if (t.long_description) entry += `\n  Details: ${t.long_description}`;
              if (t.tags.length > 0) entry += `\n  Tech: ${t.tags.join(", ")}`;
              entry += `\n  Install: ${t.install_command} | Dev: ${t.dev_command}`;
              if (t.prerequisites) entry += `\n  Requires: ${t.prerequisites}`;
              return entry;
            })
            .join("\n");
        } catch {
          // Continue without template catalog
        }
        store.initConversation(projectPath, "claude-code", model, mode, templateCatalog);
      }

      // Build prompt with inlined file content (Claude Code receives text only via stdin)
      let prompt = content;
      if (attachments && attachments.length > 0) {
        const parts: string[] = [];
        for (const att of attachments) {
          if (att.type === "image") {
            parts.push(`[Attached image: ${att.file_path ?? att.name}]`);
          } else if (att.text_content) {
            parts.push(`--- ${att.name} ---\n${att.text_content}`);
          } else {
            parts.push(`[Attached file: ${att.file_path ?? att.name}]`);
          }
        }
        prompt = parts.join("\n\n") + (content ? "\n\n" + content : "");
      }

      // Add user message to store
      const userMessage: SpecMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        attachments,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      };
      store.addMessage(projectPath, userMessage);

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

      // Ensure CLI session exists
      let sessionId: string;
      try {
        sessionId = await ensureSession(projectPath);
      } catch (err) {
        store.setPlanningStreaming(projectPath, false);
        store.addMessage(projectPath, {
          id: `msg-err-${Date.now()}`,
          role: "system",
          content: `Failed to start Claude Code session: ${err}`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Setup streaming state
      streamBufferRef.current = "";
      specDetectedRef.current = false;
      auditDetectedRef.current = false;

      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      // Flush accumulated stream buffer to store (batched via RAF)
      const flushStreamBuffer = (): void => {
        flushScheduledRef.current = null;
        const buf = streamBufferRef.current;
        if (!buf) return;
        const currentStore = useSpecWriterStore.getState();
        currentStore.updateLastAssistantMessage(projectPath, buf);
        if (specDetectedRef.current || SPEC_START_PATTERN.test(buf)) {
          specDetectedRef.current = true;
          currentStore.setCurrentSpecContent(projectPath, buf);
        }
        if (auditDetectedRef.current || AUDIT_START_PATTERN.test(buf)) {
          auditDetectedRef.current = true;
          currentStore.setCurrentAuditContent(projectPath, buf);
        }
      };

      // Listen for CLI streaming events
      const unlisten = await listenChatEvents(sessionId, (event: FrontendEvent) => {
        const currentStore = useSpecWriterStore.getState();

        if (event.type === "text_delta") {
          streamBufferRef.current += event.text;
          if (flushScheduledRef.current === null) {
            flushScheduledRef.current = requestAnimationFrame(flushStreamBuffer);
          }
        }

        if (event.type === "turn_complete") {
          // Cancel pending RAF — completeTurn will write the final content
          if (flushScheduledRef.current !== null) {
            cancelAnimationFrame(flushScheduledRef.current);
            flushScheduledRef.current = null;
          }

          const finalContent = streamBufferRef.current;
          const parsed = parseSelectableOptions(finalContent);
          const isSpec = SPEC_START_PATTERN.test(finalContent);
          const isAudit = AUDIT_START_PATTERN.test(finalContent);
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
                content:
                  "Spec complete! **Generate a Verification Audit?** This is a companion document that Claude Code uses to self-check its implementation \u2014 it opens every file, reads the actual code, and verifies it matches the spec.\n\nThis is the single most important step for implementation quality.",
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

          // Cleanup
          streamBufferRef.current = "";
          currentStore.persistState(projectPath);
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }

        if (event.type === "process_exited") {
          // Process died — clean up
          if (flushScheduledRef.current !== null) {
            cancelAnimationFrame(flushScheduledRef.current);
            flushScheduledRef.current = null;
          }
          currentStore.setPlanningStreaming(projectPath, false);
          currentStore.setCliSessionId(projectPath, null);

          if (event.exit_code !== 0) {
            currentStore.addMessage(projectPath, {
              id: `msg-err-${Date.now()}`,
              role: "system",
              content: `Claude Code process exited unexpectedly (code ${event.exit_code ?? "unknown"}). ${event.stderr_tail ?? ""}`.trim(),
              message_type: "conversation",
              timestamp: new Date().toISOString(),
            });
          }
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }

        if (event.type === "process_error") {
          currentStore.setPlanningStreaming(projectPath, false);
          currentStore.addMessage(projectPath, {
            id: `msg-err-${Date.now()}`,
            role: "system",
            content: `Error: ${event.error}`,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }
      });

      unlistenRef.current = unlisten;

      // Send the actual message to the CLI
      try {
        await sendMessageCmd(sessionId, prompt);
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
    [ensureSession]
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
    const sessionId = useSpecWriterStore.getState().getCliSessionId(projectPath);
    if (sessionId) {
      interruptSession(sessionId).catch((e) => {
        console.warn("[useSpecConversationClaude] interrupt failed:", e);
      });
    }
  }, []);

  const changeModel = useCallback(async (projectPath: string, newModel: string) => {
    const store = useSpecWriterStore.getState();
    const oldSessionId = store.getCliSessionId(projectPath);

    // Close old session
    if (oldSessionId) {
      await closeSpecwriterSession(oldSessionId).catch(console.warn);
      store.setCliSessionId(projectPath, null);
    }

    // Update the conversation model — next sendMessage will create a new session
    store.updateConversationProvider(projectPath, "claude-code", newModel);
  }, []);

  return {
    sendMessage,
    writeSpec,
    generateAudit,
    loadContext,
    cancelStream,
    changeModel,
  };
}
