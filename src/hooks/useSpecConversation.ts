import { useCallback, useRef } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sendAssistantChat, listenAssistantStream, cancelAssistantChat, listTemplates, gatherSpecContext, readFileContent } from "../lib/tauri-commands";
import { getProviderForModel, DEFAULT_SPEC_MODEL, isSpecModelAvailable, autoSelectSpecModel } from "../types/assistant-provider";
import { useOpenRouterStore } from "../stores/openRouterStore";
import type { SpecMessage, SpecAttachment, SpecPatchOutcome } from "../types/spec-writer";
import type { ContentPart } from "../lib/tauri-commands";
import { SPEC_READY_PATTERNS, SPEC_START_PATTERN, AUDIT_START_PATTERN, AUDIT_FILE_PATTERN, isLikelySpecDocument, buildSystemPrompt } from "../lib/spec-prompts";
import { parseSelectableOptions } from "../lib/spec-option-parser";
import { handleFileRequests } from "../lib/spec-file-requests";
import { fileToBase64, isTextMime } from "../lib/file-utils";
import { auditCoverage, describeFailure, extractInputDocs, summarizeReport } from "../lib/spec-coverage-audit";
import { analyzeInput, renderClarificationMessage } from "../lib/spec-input-analyzer";
import { parseAuditPatch, applyAuditPatch, summarizePatchApplication } from "../lib/spec-audit-patch";
import {
  advanceCreationLog,
  finalizeOpenEntry,
  renderCreationLogRecap,
} from "../lib/spec-creation-log";

/** Marker the model emits at the start of an auto-recheck reply per buildRecheckPrompts. */
const AUDIT_PATCH_MARKER = "<!-- AUDIT-PATCH -->";
import type { StreamStatus } from "../types/spec-writer";

/** Maximum auto-recheck rounds per project. Mirrors self-drive's cap. */
const MAX_RECHECK_ROUNDS = 2;
/**
 * Stage 4: how long without ANY event from the model before we surface a soft
 * "no activity" notice. Tool-call sequences (Claude Code orchestrator file
 * reads, etc.) can legitimately go many minutes without a text delta but
 * still emit other events — those count as "alive". This threshold catches
 * the case where the connection is truly dead with no events at all.
 */
const STALL_THRESHOLD_MS = 300_000; // 5 minutes
/** Stage 4: how often the watchdog re-evaluates the last-event timestamp. */
const WATCHDOG_INTERVAL_MS = 30_000;

/**
 * Per-project streaming state. The hook is instantiated once per
 * SpecWriterSlideOver mount but serves multiple projects, so all per-stream
 * scratch state must be keyed by projectPath. Using one map of objects (rather
 * than many maps of scalars) keeps the call sites readable.
 */
interface PerProjectStreamState {
  unlisten: (() => void) | null;
  streamBuffer: string;
  flushScheduled: number | null;
  specDetected: boolean;
  auditDetected: boolean;
  preStreamSpec: string | null;
  chunkCount: number;
  streamStartMs: number;
  /** 0 means nothing has arrived yet. Bumped on every listener invocation. */
  lastEventMs: number;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  stalledNoticed: boolean;
  /** True when this stream is the model's reply to an auto-recheck dispatch. */
  isAutoRecheck: boolean;
  /**
   * True when this stream is a Verification Audit turn (user clicked "Generate
   * the Verification Audit"). Authoritative routing signal — when set, content
   * goes to currentAuditContent from the first chunk and the turn finalizes as
   * an audit regardless of the document's H1. Mirrors useSpecConversationClaude.ts.
   */
  isAuditTurn: boolean;
  /** Heading watermark for creation-log advancement — mirrors the Claude hook. */
  creationLogWatermark: number;
}

function makeStreamState(): PerProjectStreamState {
  return {
    unlisten: null,
    streamBuffer: "",
    flushScheduled: null,
    specDetected: false,
    auditDetected: false,
    preStreamSpec: null,
    chunkCount: 0,
    streamStartMs: 0,
    lastEventMs: 0,
    watchdogTimer: null,
    stalledNoticed: false,
    isAutoRecheck: false,
    isAuditTurn: false,
    creationLogWatermark: 0,
  };
}

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
  /** Stage 3: re-dispatch the latest audit recheck prompt. Returns true if dispatched. */
  requestRecheck: (projectPath: string) => boolean;
} {
  const streamStateMapRef = useRef<Map<string, PerProjectStreamState>>(new Map());
  const getStreamState = (projectPath: string): PerProjectStreamState => {
    let s = streamStateMapRef.current.get(projectPath);
    if (!s) {
      s = makeStreamState();
      streamStateMapRef.current.set(projectPath, s);
    }
    return s;
  };
  /** Per-project auto-recheck round counter. Reset on a fresh user-initiated turn. */
  const recheckRoundRef = useRef<Map<string, number>>(new Map());
  /** Per-project set of input-doc names already structurally analyzed. */
  const analyzedDocsRef = useRef<Map<string, Set<string>>>(new Map());

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
      attachments?: SpecAttachment[],
      meta?: { isAutoRecheck?: boolean; isAudit?: boolean }
    ) => {
      // Capture the post-compaction recap BEFORE we clear the per-turn state
      // below. If a prior turn was compacted (only possible today via the
      // Claude-CLI hook, but the API hook maintains the log too for parity),
      // prepend this recap to the user's prompt so the model knows what it
      // already wrote.
      let compactionRecap = "";
      if (!meta?.isAutoRecheck) {
        const pre = useSpecWriterStore.getState();
        const compaction = pre.compactionInfo.get(projectPath);
        const log = pre.creationLogs.get(projectPath);
        if (compaction && log && log.entries.length > 0) {
          compactionRecap = renderCreationLogRecap(log, compaction);
        }
      }

      // User-initiated turns reset the recheck-round counter so the next
      // automatic recheck cycle starts fresh. Auto-recheck dispatches do NOT
      // reset (otherwise the cap would never bite). They also wipe the last
      // patch-outcome banner — it describes the previous recheck cycle and
      // shouldn't linger after the user has moved on. The creation log is
      // cleared too (we already captured the recap above).
      if (!meta?.isAutoRecheck) {
        recheckRoundRef.current.set(projectPath, 0);
        useSpecWriterStore.getState().setLastPatchOutcome(projectPath, null);
        useSpecWriterStore.getState().clearCreationLog(projectPath);
      }

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

      // If a prior turn was compacted, prepend the creation-log recap as a
      // hidden context-summary system message so the LLM sees it but the
      // chat UI doesn't show it. Added BEFORE the user message so the model
      // reads it as context for what the user is about to ask.
      if (compactionRecap) {
        store.addMessage(projectPath, {
          id: `msg-recap-${Date.now()}`,
          role: "system",
          content: compactionRecap,
          message_type: "context_summary",
          timestamp: new Date().toISOString(),
        });
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

      // ─── Stage 2: Input analyzer (pre-flight, runs once per attached doc) ───
      // Skip when this is an internal auto-recheck dispatch — those don't bring
      // new input docs and the analyzer has already run on the originals.
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
              store.persistState(projectPath);
              // Pause: wait for the user to answer before calling the AI.
              return;
            }
          }
        }
      }

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
              const refs: string[] = [];
              for (const att of m.attachments) {
                if (att.type === "project-ref") {
                  if (att.file_path) refs.push(att.file_path);
                } else if (att.type === "image" && att.preview_url) {
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
              if (refs.length > 0) {
                const block =
                  "[Referenced project files — paths are relative to the project root]\n" +
                  refs.map((p) => `- ${p}`).join("\n");
                parts.splice(1, 0, { type: "text", text: block });
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

      // Setup stream listener — all scratch state is keyed per-project so that
      // a stream still arriving for project A while the user has switched to B
      // cannot corrupt B's content slots.
      const assistantId = `spec-${projectPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const state = getStreamState(projectPath);
      state.streamBuffer = "";
      state.specDetected = false;
      state.auditDetected = false;
      state.preStreamSpec = useSpecWriterStore.getState().currentSpecContent.get(projectPath) ?? null;
      state.isAutoRecheck = !!meta?.isAutoRecheck;
      state.isAuditTurn = !!meta?.isAudit;
      state.creationLogWatermark = 0;
      // Stage 4: reset stream observability state and arm the stalled-stream watchdog.
      state.chunkCount = 0;
      state.streamStartMs = Date.now();
      state.lastEventMs = 0;
      state.stalledNoticed = false;
      if (state.watchdogTimer !== null) {
        clearInterval(state.watchdogTimer);
      }
      state.watchdogTimer = setInterval(() => {
        // Only act once at least one event has arrived; before that, the
        // request may simply be slow to start and we don't want to nag.
        if (state.lastEventMs === 0 || state.stalledNoticed) return;
        if (Date.now() - state.lastEventMs < STALL_THRESHOLD_MS) return;
        state.stalledNoticed = true;
        const minutes = Math.floor(STALL_THRESHOLD_MS / 60_000);
        useSpecWriterStore.getState().addMessage(projectPath, {
          id: `msg-stalled-${Date.now()}`,
          role: "system",
          content:
            `No activity from the AI for ${minutes} minute${minutes === 1 ? '' : 's'} — the model may still be processing (e.g. running tools). ` +
            `Cancel from the toolbar if you want to stop. The buffered content so far is preserved.`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
      }, WATCHDOG_INTERVAL_MS);

      // Stage 4: finalize stream-stats on terminal events. Called from done/cancelled/error.
      const finalizeStreamStats = (status: StreamStatus, note?: string): void => {
        if (state.watchdogTimer !== null) {
          clearInterval(state.watchdogTimer);
          state.watchdogTimer = null;
        }
        const startedMs = state.streamStartMs;
        const endedMs = Date.now();
        const effectiveStatus = status === 'ok' && state.stalledNoticed ? 'stalled' : status;
        useSpecWriterStore.getState().setStreamStats(projectPath, {
          chunks: state.chunkCount,
          bytes: state.streamBuffer.length,
          durationMs: startedMs > 0 ? endedMs - startedMs : 0,
          startedAt: new Date(startedMs || endedMs).toISOString(),
          endedAt: new Date(endedMs).toISOString(),
          status: effectiveStatus,
          note,
        });
      };

      if (state.unlisten) {
        state.unlisten();
        state.unlisten = null;
      }

      // Flush accumulated stream buffer to store (batched via RAF)
      // Audit detection takes priority — an audit document is never also a spec.
      const flushStreamBuffer = (): void => {
        state.flushScheduled = null;
        const buf = state.streamBuffer;
        if (!buf) return;
        const store = useSpecWriterStore.getState();
        store.updateLastAssistantMessage(projectPath, buf);
        // Auto-recheck replies are patch envelopes, not specs. Never let the
        // streaming buffer overwrite currentSpecContent with patch text — the
        // splice happens atomically in the done handler against preStreamSpec.
        if (state.isAutoRecheck && buf.includes(AUDIT_PATCH_MARKER)) {
          return;
        }
        // Creation-log advancement — append entries for any new spec headings
        // that have fully streamed in. Gated on non-recheck / non-audit. The
        // API hook has no native `compact_complete` event (API providers
        // handle context truncation implicitly), but maintaining the log
        // unconditionally keeps parity with the Claude-CLI hook and means the
        // recap injection in `sendMessage` works the moment any signal (a
        // future provider event, or a manual trigger) sets `compactionInfo`.
        // `isAuditTurn` covers the first chunk of an intended audit, before
        // `auditDetected` latches.
        if (!state.isAutoRecheck && !state.auditDetected && !state.isAuditTurn) {
          const log = store.creationLogs.get(projectPath) ?? {
            entries: [],
            compactedAt: null,
          };
          const adv = advanceCreationLog(buf, log, state.creationLogWatermark);
          if (adv.toClose.length > 0 || adv.toAppend.length > 0) {
            for (const c of adv.toClose) {
              store.markCreationEntryClosed(projectPath, c.idx, c.closedAt, c.bytes);
            }
            for (const e of adv.toAppend) {
              store.appendCreationEntry(projectPath, e);
            }
            state.creationLogWatermark = adv.nextWatermark;
          }
        }
        if (state.isAuditTurn || state.auditDetected || AUDIT_START_PATTERN.test(buf)) {
          // If we previously misidentified this stream as a spec, restore original
          if (!state.auditDetected && state.specDetected) {
            state.specDetected = false;
            store.setCurrentSpecContent(projectPath, state.preStreamSpec);
          }
          state.auditDetected = true;
          store.setCurrentAuditContent(projectPath, buf);
        } else if (state.specDetected || SPEC_START_PATTERN.test(buf) || isLikelySpecDocument(buf)) {
          state.specDetected = true;
          store.setCurrentSpecContent(projectPath, buf);
        }
      };

      state.unlisten = await listenAssistantStream(assistantId, (event) => {
        const currentStore = useSpecWriterStore.getState();
        // Stage 4: every event arrival counts as "alive" — keeps the stall
        // watchdog quiet during legitimate non-text activity (tool calls etc).
        state.lastEventMs = Date.now();

        if (event.type === "delta" && event.text) {
          state.streamBuffer += event.text;
          // Stage 4: chunk count tracks text deltas only, so the stats payload
          // reflects actual content throughput (not heartbeat events).
          state.chunkCount += 1;
          // Batch store updates to one per animation frame (~16/sec instead of 50-100/sec)
          if (state.flushScheduled === null) {
            state.flushScheduled = requestAnimationFrame(flushStreamBuffer);
          }
        }

        if (event.type === "done") {
          // Cancel pending RAF — completeTurn will write the final content
          if (state.flushScheduled !== null) {
            cancelAnimationFrame(state.flushScheduled);
            state.flushScheduled = null;
          }
          // Stage 4: persist stream observability stats.
          finalizeStreamStats('ok');
          // Audit generation (if any) is over — the tab can lose its ellipsis.
          currentStore.setAuditPending(projectPath, false);

          const finalContent = state.streamBuffer;
          const parsed = parseSelectableOptions(finalContent);
          // Audit takes priority — a document is never also a spec. The user's
          // explicit "Generate the Verification Audit" intent (isAuditTurn) is
          // authoritative; AUDIT_START_PATTERN is only the fallback for audits
          // that arrive without that intent. Keeps a mistitled audit from being
          // misrouted into (and overwriting) currentSpecContent. Mirrors the
          // Claude hook.
          const isAudit = state.isAuditTurn || AUDIT_START_PATTERN.test(finalContent);

          // Close the final open creation-log entry (if any) so its body
          // bytes are recorded. Skip on audit/recheck turns.
          if (!state.isAutoRecheck && !isAudit) {
            const log = currentStore.creationLogs.get(projectPath);
            if (log) {
              const close = finalizeOpenEntry(finalContent, log);
              if (close) {
                currentStore.markCreationEntryClosed(
                  projectPath,
                  close.idx,
                  close.closedAt,
                  close.bytes,
                );
              }
            }
          }

          // Auto-recheck path: response is a structured patch envelope, NOT a
          // new spec. Splice it into preStreamSpec; on any failure keep the
          // original spec untouched. This is the primary guard against the
          // "coverage repair replaced the spec" bug.
          let isSpec = !isAudit && (SPEC_START_PATTERN.test(finalContent) || isLikelySpecDocument(finalContent));
          let mergedSpecContent: string | null = null;
          let patchFailureReasons: string[] | null = null;
          let patchAppliedSummary: string | null = null;
          // Draft patch-outcome record. Finalized + persisted to the store
          // AFTER the re-audit so remainingFindings is meaningful. Without this
          // the Coverage panel would have no way to surface "your patch click
          // rewrote N sections" beyond a fleeting chat message.
          let patchOutcomeDraft: Omit<SpecPatchOutcome, 'remainingFindings'> | null = null;
          if (state.isAutoRecheck && finalContent.includes(AUDIT_PATCH_MARKER)) {
            const { ops, warnings: parseWarnings } = parseAuditPatch(finalContent);
            const apply = applyAuditPatch(state.preStreamSpec ?? '', ops);
            const allWarnings = [...parseWarnings, ...apply.warnings];
            if (apply.merged !== null) {
              mergedSpecContent = apply.merged;
              isSpec = true;
              patchAppliedSummary = summarizePatchApplication({
                ...apply,
                warnings: allWarnings,
              });
              patchOutcomeDraft = {
                timestamp: new Date().toISOString(),
                status: 'applied',
                appliedOps: apply.appliedOps,
                warnings: allWarnings,
                errors: [],
              };
            } else {
              // Fail-closed: preserve preStreamSpec, mark this turn as
              // non-spec so completeTurn does NOT touch currentSpecContent.
              isSpec = false;
              patchFailureReasons = apply.errors.length > 0 ? apply.errors : ['no recognizable patch ops in reply'];
              patchOutcomeDraft = {
                timestamp: new Date().toISOString(),
                status: 'failed',
                appliedOps: [],
                warnings: allWarnings,
                errors: patchFailureReasons,
              };
            }
          }
          const isReadyToWrite = SPEC_READY_PATTERNS.some((p) => p.test(finalContent));

          // Single batched store update: streaming=false, content, status, message type
          currentStore.completeTurn(projectPath, {
            finalContent: mergedSpecContent ?? finalContent,
            isSpec,
            isAudit,
            displayContent: parsed?.cleanContent,
            options: parsed?.options,
            isReadyToWrite,
          });

          if (patchAppliedSummary) {
            currentStore.addMessage(projectPath, {
              id: `msg-patch-${Date.now()}`,
              role: "system",
              content: patchAppliedSummary,
              message_type: "conversation",
              timestamp: new Date().toISOString(),
            });
          } else if (patchFailureReasons) {
            currentStore.addMessage(projectPath, {
              id: `msg-patch-fail-${Date.now()}`,
              role: "system",
              content:
                `Coverage repair could not be applied automatically — original spec preserved.\n\n` +
                `Reasons:\n${patchFailureReasons.map((r) => `- ${r}`).join('\n')}\n\n` +
                `The model's raw reply is shown above; you can apply changes manually or ask for another pass.`,
              message_type: "conversation",
              timestamp: new Date().toISOString(),
            });
          }

          // ─── Stage 1: Coverage audit + auto-recheck loop ───
          let auditTriggeredRecheck = false;
          let postAuditFailureCount: number | null = null;
          if (isSpec) {
            const convNow = useSpecWriterStore.getState().getActiveConversation(projectPath);
            if (convNow) {
              const inputDocs = extractInputDocs(convNow.messages);
              // After a successful AUDIT-PATCH merge, audit the merged spec —
              // not the raw patch text — so progress on the original failures
              // is actually measured.
              const auditTarget = mergedSpecContent ?? finalContent;
              const report = auditCoverage(inputDocs, auditTarget, {
                skipForNewApp: convNow.mode === 'new_application',
              });
              // Stage 3: persist the structured report so the Coverage panel can render it.
              currentStore.setCoverageReport(projectPath, report);
              postAuditFailureCount = report.failures.length;
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

          // Finalize the patch outcome for the Coverage panel banner. We do
          // this AFTER the re-audit so `remainingFindings` reflects the audit
          // of the merged spec. For a fail-closed patch we already have the
          // previous report on the store; reuse its failure count.
          if (patchOutcomeDraft) {
            const remaining = postAuditFailureCount ??
              useSpecWriterStore.getState().coverageReports.get(projectPath)?.failures.length ?? 0;
            currentStore.setLastPatchOutcome(projectPath, {
              ...patchOutcomeDraft,
              remainingFindings: remaining,
            });
            // After a SUCCESSFUL patch, switch the user back to the Spec tab so
            // they see the rewritten document instead of staring at the
            // Coverage panel and wondering whether anything happened.
            if (patchOutcomeDraft.status === 'applied') {
              currentStore.setSpecPreviewTab(projectPath, 'spec');
            }
          }

          // Post-turn side effects (separate updates are fine — core state is already committed)
          if (isSpec) {
            const existingAudit = useSpecWriterStore.getState().currentAuditContent.get(projectPath);
            if (!existingAudit && !auditTriggeredRecheck) {
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
          state.streamBuffer = "";
          currentStore.persistState(projectPath);
          if (state.unlisten) {
            state.unlisten();
            state.unlisten = null;
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
          if (state.flushScheduled !== null) {
            cancelAnimationFrame(state.flushScheduled);
            state.flushScheduled = null;
          }
          // Stage 4: persist stream observability stats.
          finalizeStreamStats('cancelled');
          currentStore.setAuditPending(projectPath, false);

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

          state.streamBuffer = "";
          currentStore.persistState(projectPath);
          if (state.unlisten) {
            state.unlisten();
            state.unlisten = null;
          }
        }

        if (event.type === "error") {
          if (state.flushScheduled !== null) {
            cancelAnimationFrame(state.flushScheduled);
            state.flushScheduled = null;
          }
          // Stage 4: persist stream observability stats with the error message.
          finalizeStreamStats('errored', event.message);
          currentStore.setAuditPending(projectPath, false);

          currentStore.setPlanningStreaming(projectPath, false);
          currentStore.addMessage(projectPath, {
            id: `msg-err-${Date.now()}`,
            role: "system",
            content: `Error: ${event.message ?? "Unknown error"}`,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
          if (state.unlisten) {
            state.unlisten();
            state.unlisten = null;
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
      // Mark audit as pending immediately so the SpecPreview can render the
      // Verification… tab before any content has streamed in. Cleared on the
      // terminal stream event (done/cancelled/error).
      useSpecWriterStore.getState().setAuditPending(projectPath, true);
      sendMessage(
        projectPath,
        "Generate the Verification Audit document for the spec you just wrote. " +
        "Output the COMPLETE document directly in your response — do NOT save it to a file. " +
        "This is a guided code review document that Claude Code will use AFTER " +
        "implementation to verify every component, state, validation, and " +
        "integration point. Follow the Verification Audit format from your instructions.",
        undefined,
        { isAudit: true }
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

  /**
   * Manually re-dispatch the latest coverage-audit recheck prompt.
   * Triggered by the Coverage panel's "Run another recheck" button.
   * Bypasses the round cap because the user explicitly opted in; resets the
   * per-project counter so subsequent automatic rechecks still get 2 tries.
   * Returns true when a recheck was dispatched, false when there's nothing to do.
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
    requestRecheck,
  };
}
