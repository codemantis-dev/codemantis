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
  isLikelySpecDocument,
  buildClaudeCodePrompt,
} from "../lib/spec-prompts";
import { parseSelectableOptions } from "../lib/spec-option-parser";
import { auditCoverage, describeFailure, extractInputDocs, summarizeReport } from "../lib/spec-coverage-audit";
import { analyzeInput, renderClarificationMessage } from "../lib/spec-input-analyzer";
import type { StreamStatus } from "../types/spec-writer";

/** Maximum auto-recheck rounds per project. Mirrors self-drive's cap. */
const MAX_RECHECK_ROUNDS = 2;
/** Stage 4: how long without a delta before we surface a "stream stalled" warning. */
const STALL_THRESHOLD_MS = 30_000;
/** Stage 4: how often the watchdog re-evaluates the last-chunk timestamp. */
const WATCHDOG_INTERVAL_MS = 5_000;

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
  /** Stage 3: re-dispatch the latest audit recheck prompt. Returns true if dispatched. */
  requestRecheck: (projectPath: string) => boolean;
} {
  const unlistenRef = useRef<(() => void) | null>(null);
  const streamBufferRef = useRef("");
  const flushScheduledRef = useRef<number | null>(null);
  const specDetectedRef = useRef(false);
  const auditDetectedRef = useRef(false);
  const preStreamSpecRef = useRef<string | null>(null);
  /** Per-project auto-recheck round counter. Reset on a fresh user-initiated turn. */
  const recheckRoundRef = useRef<Map<string, number>>(new Map());
  /** Per-project set of input-doc names already structurally analyzed. */
  const analyzedDocsRef = useRef<Map<string, Set<string>>>(new Map());
  // Stage 4: stream observability state.
  const chunkCountRef = useRef(0);
  const streamStartMsRef = useRef(0);
  const lastChunkMsRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stalledNoticedRef = useRef(false);

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
      attachments?: SpecAttachment[],
      meta?: { isAutoRecheck?: boolean }
    ) => {
      // User-initiated turns reset the recheck-round counter so the next
      // automatic recheck cycle starts fresh. Auto-recheck dispatches do NOT
      // reset (otherwise the cap would never bite).
      if (!meta?.isAutoRecheck) {
        recheckRoundRef.current.set(projectPath, 0);
      }

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

      // ─── Stage 2: Input analyzer (pre-flight, runs once per attached doc) ───
      if (!meta?.isAutoRecheck) {
        const convAfterUser = useSpecWriterStore.getState().getActiveConversation(projectPath);
        if (convAfterUser) {
          const docs = extractInputDocs(convAfterUser.messages);
          const seen = analyzedDocsRef.current.get(projectPath) ?? new Set<string>();
          const newDocs = docs.filter((d) => !seen.has(d.name));
          if (newDocs.length > 0) {
            const analysis = analyzeInput(newDocs);
            for (const d of newDocs) seen.add(d.name);
            analyzedDocsRef.current.set(projectPath, seen);
            // Stage 3: persist the structured analysis for the Coverage panel.
            store.setInputAnalysisReport(projectPath, analysis);

            if (analysis.findings.length > 0) {
              store.addMessage(projectPath, {
                id: `msg-input-analysis-${Date.now()}`,
                role: "system",
                content: analysis.report,
                message_type: "context_summary",
                timestamp: new Date().toISOString(),
              });
            }

            if (analysis.clarifications.length > 0) {
              const clar = analysis.clarifications[0];
              store.addMessage(projectPath, {
                id: `msg-input-clar-${Date.now()}`,
                role: "assistant",
                content: renderClarificationMessage(clar),
                message_type: "conversation",
                timestamp: new Date().toISOString(),
                parsedOptions: clar.options,
              });
              store.setPlanningStreaming(projectPath, false);
              return;
            }
          }
        }
      }

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
      preStreamSpecRef.current = useSpecWriterStore.getState().currentSpecContent.get(projectPath) ?? null;

      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      // Stage 4: reset stream observability state and arm the watchdog.
      chunkCountRef.current = 0;
      streamStartMsRef.current = Date.now();
      lastChunkMsRef.current = 0;
      stalledNoticedRef.current = false;
      if (watchdogTimerRef.current !== null) {
        clearInterval(watchdogTimerRef.current);
      }
      watchdogTimerRef.current = setInterval(() => {
        const last = lastChunkMsRef.current;
        if (last === 0 || stalledNoticedRef.current) return;
        if (Date.now() - last < STALL_THRESHOLD_MS) return;
        stalledNoticedRef.current = true;
        useSpecWriterStore.getState().addMessage(projectPath, {
          id: `msg-stalled-${Date.now()}`,
          role: "system",
          content:
            `Stream stalled — no chunks received for ${Math.floor(STALL_THRESHOLD_MS / 1000)}s. ` +
            `The model may have stopped responding. The buffered content so far has been preserved.`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
      }, WATCHDOG_INTERVAL_MS);

      const finalizeStreamStats = (status: StreamStatus, note?: string): void => {
        if (watchdogTimerRef.current !== null) {
          clearInterval(watchdogTimerRef.current);
          watchdogTimerRef.current = null;
        }
        const startedMs = streamStartMsRef.current;
        const endedMs = Date.now();
        const effectiveStatus = status === 'ok' && stalledNoticedRef.current ? 'stalled' : status;
        useSpecWriterStore.getState().setStreamStats(projectPath, {
          chunks: chunkCountRef.current,
          bytes: streamBufferRef.current.length,
          durationMs: startedMs > 0 ? endedMs - startedMs : 0,
          startedAt: new Date(startedMs || endedMs).toISOString(),
          endedAt: new Date(endedMs).toISOString(),
          status: effectiveStatus,
          note,
        });
      };

      // Flush accumulated stream buffer to store (batched via RAF)
      // Audit detection takes priority — an audit document is never also a spec.
      const flushStreamBuffer = (): void => {
        flushScheduledRef.current = null;
        const buf = streamBufferRef.current;
        if (!buf) return;
        const currentStore = useSpecWriterStore.getState();
        currentStore.updateLastAssistantMessage(projectPath, buf);
        if (auditDetectedRef.current || AUDIT_START_PATTERN.test(buf)) {
          // If we previously misidentified this stream as a spec, restore original
          if (!auditDetectedRef.current && specDetectedRef.current) {
            specDetectedRef.current = false;
            currentStore.setCurrentSpecContent(projectPath, preStreamSpecRef.current);
          }
          auditDetectedRef.current = true;
          currentStore.setCurrentAuditContent(projectPath, buf);
        } else if (specDetectedRef.current || SPEC_START_PATTERN.test(buf) || isLikelySpecDocument(buf)) {
          specDetectedRef.current = true;
          currentStore.setCurrentSpecContent(projectPath, buf);
        }
      };

      // Listen for CLI streaming events
      const unlisten = await listenChatEvents(sessionId, (event: FrontendEvent) => {
        const currentStore = useSpecWriterStore.getState();

        if (event.type === "text_delta") {
          streamBufferRef.current += event.text;
          // Stage 4: track chunk count + last-chunk timestamp.
          chunkCountRef.current += 1;
          lastChunkMsRef.current = Date.now();
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
          // Stage 4: persist stream observability stats.
          finalizeStreamStats('ok');

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

          // ─── Stage 1: Coverage audit + auto-recheck loop ───
          let auditTriggeredRecheck = false;
          if (isSpec) {
            const convNow = useSpecWriterStore.getState().getActiveConversation(projectPath);
            if (convNow) {
              const inputDocs = extractInputDocs(convNow.messages);
              const report = auditCoverage(inputDocs, finalContent, {
                skipForNewApp: convNow.mode === 'new_application',
              });
              // Stage 3: persist the structured report so the Coverage panel can render it.
              currentStore.setCoverageReport(projectPath, report);
              const round = recheckRoundRef.current.get(projectPath) ?? 0;
              const summary = summarizeReport(report);

              if (report.status === 'fail' && round < MAX_RECHECK_ROUNDS && report.recheckPrompts.length > 0) {
                currentStore.addMessage(projectPath, {
                  id: `msg-audit-${Date.now()}`,
                  role: "system",
                  content: `${summary}\n\nAuto-recheck round ${round + 1} of ${MAX_RECHECK_ROUNDS} dispatched.`,
                  message_type: "conversation",
                  timestamp: new Date().toISOString(),
                });
                recheckRoundRef.current.set(projectPath, round + 1);
                auditTriggeredRecheck = true;
                const recheckPrompt = report.recheckPrompts[0];
                // Recursive recheck dispatch — safe because `sendMessage` is
                // assigned by the time this microtask runs.
                // eslint-disable-next-line react-hooks/immutability
                void (async () => { await sendMessage(projectPath, recheckPrompt, undefined, { isAutoRecheck: true }); })();
              } else if (report.status === 'fail') {
                const detail = report.failures
                  .slice(0, 12)
                  .map((f) => `- ${describeFailure(f)}`)
                  .join('\n');
                currentStore.addMessage(projectPath, {
                  id: `msg-audit-${Date.now()}`,
                  role: "system",
                  content: `${summary}\n\nAuto-recheck cap reached or no recheck path available. Findings:\n${detail}\n\nYou can address these manually or ask me to take another pass.`,
                  message_type: "conversation",
                  timestamp: new Date().toISOString(),
                });
              } else {
                currentStore.addMessage(projectPath, {
                  id: `msg-audit-${Date.now()}`,
                  role: "system",
                  content: summary,
                  message_type: "conversation",
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }

          // Post-turn side effects (separate updates are fine — core state is already committed)
          if (isSpec && !auditTriggeredRecheck) {
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
          // Stage 4: persist stream observability stats. Treat non-zero exits
          // as errored; zero exits as cancelled (clean shutdown).
          finalizeStreamStats(
            event.exit_code === 0 ? 'cancelled' : 'errored',
            event.exit_code !== 0 ? `process exited with code ${event.exit_code ?? 'unknown'}` : undefined,
          );
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
          // Stage 4: persist stream observability stats with the error message.
          finalizeStreamStats('errored', event.error);
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

  /**
   * Manually re-dispatch the latest coverage-audit recheck prompt.
   * See useSpecConversation for full docs.
   */
  const requestRecheck = useCallback((projectPath: string): boolean => {
    const store = useSpecWriterStore.getState();
    const report = store.coverageReports.get(projectPath);
    if (!report || report.status !== 'fail' || report.recheckPrompts.length === 0) return false;
    recheckRoundRef.current.set(projectPath, 0);
    sendMessage(projectPath, report.recheckPrompts[0], undefined, { isAutoRecheck: true });
    return true;
  }, [sendMessage]);

  return {
    sendMessage,
    writeSpec,
    generateAudit,
    loadContext,
    cancelStream,
    changeModel,
    requestRecheck,
  };
}
