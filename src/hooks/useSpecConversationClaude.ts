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
  probeProjectCapabilities,
  writeProjectCapabilities,
  readFileContent,
} from "../lib/tauri-commands";
import type { FrontendEvent } from "../types/claude-events";
import type { SpecMessage, SpecAttachment, SpecPatchOutcome } from "../types/spec-writer";
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
import { parseAuditPatch, applyAuditPatch, summarizePatchApplication } from "../lib/spec-audit-patch";
import {
  advanceCreationLog,
  finalizeOpenEntry,
  renderCreationLogRecap,
} from "../lib/spec-creation-log";
import { analyzeInput, renderClarificationMessage } from "../lib/spec-input-analyzer";
import type { StreamStatus } from "../types/spec-writer";

/** Marker the model emits at the start of an auto-recheck reply per buildRecheckPrompts. */
const AUDIT_PATCH_MARKER = "<!-- AUDIT-PATCH -->";

/** Maximum auto-recheck rounds per project. Mirrors self-drive's cap. */
const MAX_RECHECK_ROUNDS = 2;
/**
 * Stage 4: how long without ANY event before we surface a soft "no activity"
 * notice. Tool-call sequences (orchestrator file reads, etc.) can legitimately
 * go many minutes without text deltas but still emit other events — those
 * count as "alive". This catches the case where the connection is truly dead.
 */
const STALL_THRESHOLD_MS = 300_000; // 5 minutes
/** Stage 4: how often the watchdog re-evaluates the last-event timestamp. */
const WATCHDOG_INTERVAL_MS = 30_000;

/**
 * Per-project streaming state. The hook is instantiated once per
 * SpecWriterSlideOver mount but serves multiple projects, so all per-stream
 * scratch state must be keyed by projectPath. See useSpecConversation.ts for
 * the same pattern; the two hooks must keep this isolation in lockstep.
 */
interface PerProjectStreamState {
  unlisten: (() => void) | null;
  streamBuffer: string;
  flushScheduled: number | null;
  specDetected: boolean;
  auditDetected: boolean;
  preStreamSpec: string | null;
  /**
   * True when the current stream is an auto-recheck (AUDIT-PATCH) reply rather
   * than a fresh spec turn. Drives both the flushStreamBuffer overwrite-guard
   * and the turn_complete splice path. Mirrors useSpecConversation.ts.
   */
  isAutoRecheck: boolean;
  /**
   * Number of headings already emitted to the creation log this run.
   * `advanceCreationLog` advances this watermark on every flush so we only
   * append store actions for *new* headings, not the entire scan each time.
   */
  creationLogWatermark: number;
  chunkCount: number;
  streamStartMs: number;
  lastEventMs: number;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  stalledNoticed: boolean;
}

function makeStreamState(): PerProjectStreamState {
  return {
    unlisten: null,
    streamBuffer: "",
    flushScheduled: null,
    specDetected: false,
    auditDetected: false,
    preStreamSpec: null,
    isAutoRecheck: false,
    creationLogWatermark: 0,
    chunkCount: 0,
    streamStartMs: 0,
    lastEventMs: 0,
    watchdogTimer: null,
    stalledNoticed: false,
  };
}

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

      // Phase 0a: probe environment capabilities + persist the record so
      // Self-Drive verify-mode can read the same source of truth. Probe
      // failure is non-fatal — SpecWriter still works without a capabilities
      // section, just less informed. See plan:
      // ~/.claude/plans/analyse-this-why-refactored-yao.md
      try {
        const capabilities = await probeProjectCapabilities(projectPath);
        store.setProjectCapabilities(projectPath, capabilities);
        // Persist so subsequent loads / verify-mode can read it directly.
        // Errors here are non-fatal — the in-memory record is still usable.
        await writeProjectCapabilities(projectPath, capabilities).catch((err) => {
          console.warn(
            "[useSpecConversationClaude] Failed to persist project-capabilities.json:",
            err,
          );
        });
      } catch (probeErr) {
        console.warn(
          "[useSpecConversationClaude] Capability probe failed (non-fatal):",
          probeErr,
        );
      }

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
    const projectCapabilities = store.projectCapabilities.get(projectPath) ?? null;
    const systemPrompt = buildClaudeCodePrompt(
      conv.mode,
      conv.templateCatalog ?? "",
      projectContext,
      projectCapabilities,
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
      // Capture the post-compaction recap BEFORE we clear the per-turn state
      // below. If the prior turn was compacted, we'll prepend this recap to
      // the user's prompt so the model knows what it already wrote.
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
      // reset (otherwise the cap would never bite). Compaction info is also
      // scoped to the current user-initiated run. The last patch-outcome
      // banner is also wiped — it describes the prior recheck cycle and
      // shouldn't linger after the user moves on to a new turn. The creation
      // log is also cleared (we already captured the recap above) so the
      // new turn starts a fresh per-section progress record.
      if (!meta?.isAutoRecheck) {
        recheckRoundRef.current.set(projectPath, 0);
        useSpecWriterStore.getState().setCompactionInfo(projectPath, null);
        useSpecWriterStore.getState().setLastPatchOutcome(projectPath, null);
        useSpecWriterStore.getState().clearCreationLog(projectPath);
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

      // Build prompt with inlined file content (Claude Code receives text only via stdin).
      // project-ref attachments are not inlined — they're announced as a reference
      // block so the CLI can fetch them on demand via its read_project_files path.
      let prompt = content;
      if (attachments && attachments.length > 0) {
        const parts: string[] = [];
        const refs: string[] = [];
        for (const att of attachments) {
          if (att.type === "project-ref") {
            if (att.file_path) refs.push(att.file_path);
          } else if (att.type === "image") {
            parts.push(`[Attached image: ${att.file_path ?? att.name}]`);
          } else if (att.text_content) {
            parts.push(`--- ${att.name} ---\n${att.text_content}`);
          } else {
            parts.push(`[Attached file: ${att.file_path ?? att.name}]`);
          }
        }
        if (refs.length > 0) {
          const block =
            "[Referenced project files — read these with the Read tool as needed; paths are relative to the project root]\n" +
            refs.map((p) => `- ${p}`).join("\n");
          parts.unshift(block);
        }
        prompt = parts.join("\n\n") + (content ? "\n\n" + content : "");
      }

      // If the prior turn hit a CLI auto-compaction, prepend the per-section
      // creation-log recap so the model has programmatic memory of what it
      // already wrote. The recap is computed from `compactionInfo` + the
      // creation log; both are now cleared, but the recap string itself was
      // captured above before the clear.
      if (compactionRecap) {
        prompt = `${compactionRecap}\n\n---\n\n${prompt}`;
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

      // Setup streaming state — keyed per-project so concurrent streams across
      // projects don't corrupt each other's content slots.
      const state = getStreamState(projectPath);
      state.streamBuffer = "";
      state.specDetected = false;
      state.auditDetected = false;
      state.preStreamSpec = useSpecWriterStore.getState().currentSpecContent.get(projectPath) ?? null;
      state.isAutoRecheck = !!meta?.isAutoRecheck;
      // The watermark counts headings already emitted from THIS turn's
      // streamBuffer (which we just cleared). Reset to 0 — the log itself
      // is cumulative across turns and is appended to, not overwritten.
      state.creationLogWatermark = 0;

      if (state.unlisten) {
        state.unlisten();
        state.unlisten = null;
      }

      // Stage 4: reset stream observability state and arm the watchdog.
      state.chunkCount = 0;
      state.streamStartMs = Date.now();
      state.lastEventMs = 0;
      state.stalledNoticed = false;
      if (state.watchdogTimer !== null) {
        clearInterval(state.watchdogTimer);
      }
      state.watchdogTimer = setInterval(() => {
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

      // Flush accumulated stream buffer to store (batched via RAF)
      // Audit detection takes priority — an audit document is never also a spec.
      const flushStreamBuffer = (): void => {
        state.flushScheduled = null;
        const buf = state.streamBuffer;
        if (!buf) return;
        const currentStore = useSpecWriterStore.getState();
        currentStore.updateLastAssistantMessage(projectPath, buf);
        // Auto-recheck replies are patch envelopes, not specs. Never let the
        // streaming buffer overwrite currentSpecContent with patch text — the
        // splice happens atomically in the turn_complete handler against
        // preStreamSpec.
        if (state.isAutoRecheck && buf.includes(AUDIT_PATCH_MARKER)) {
          return;
        }
        // Creation-log advancement — append entries for any new headings
        // that have fully streamed in. Gated on non-recheck only; recheck
        // replies are patch envelopes, not spec content. Audits would also
        // be detected as headings here, but we skip them too — the recap
        // tracks SPEC progress, not audit progress.
        if (!state.isAutoRecheck && !state.auditDetected) {
          const log = currentStore.creationLogs.get(projectPath) ?? {
            entries: [],
            compactedAt: null,
          };
          const adv = advanceCreationLog(buf, log, state.creationLogWatermark);
          if (adv.toClose.length > 0 || adv.toAppend.length > 0) {
            for (const c of adv.toClose) {
              currentStore.markCreationEntryClosed(
                projectPath,
                c.idx,
                c.closedAt,
                c.bytes,
              );
            }
            for (const e of adv.toAppend) {
              currentStore.appendCreationEntry(projectPath, e);
            }
            state.creationLogWatermark = adv.nextWatermark;
          }
        }
        if (state.auditDetected || AUDIT_START_PATTERN.test(buf)) {
          // If we previously misidentified this stream as a spec, restore original
          if (!state.auditDetected && state.specDetected) {
            state.specDetected = false;
            currentStore.setCurrentSpecContent(projectPath, state.preStreamSpec);
          }
          state.auditDetected = true;
          currentStore.setCurrentAuditContent(projectPath, buf);
        } else if (state.specDetected || SPEC_START_PATTERN.test(buf) || isLikelySpecDocument(buf)) {
          state.specDetected = true;
          currentStore.setCurrentSpecContent(projectPath, buf);
        }
      };

      // Listen for CLI streaming events
      const unlisten = await listenChatEvents(sessionId, (event: FrontendEvent) => {
        const currentStore = useSpecWriterStore.getState();
        // Stage 4: every event arrival counts as "alive" — tool-call sequences
        // can run for many minutes without text deltas; those events still
        // arrive here and should keep the watchdog quiet.
        state.lastEventMs = Date.now();

        if (event.type === "text_delta") {
          state.streamBuffer += event.text;
          // chunk count tracks text deltas only — accurate content throughput.
          state.chunkCount += 1;
          if (state.flushScheduled === null) {
            state.flushScheduled = requestAnimationFrame(flushStreamBuffer);
          }
        }

        // Auto-compaction surfacing: the Claude Code CLI auto-compacts when
        // Sonnet's context fills during a long spec run. Neither the main chat
        // toast handler nor the Activity Feed sees SpecWriter-session events,
        // so without this the user has no signal that compaction happened.
        // After a compact, later output is generated from a summary, not the
        // original earlier turns — so details from early phases may be lossy.
        if (event.type === "compacting_status" && event.is_compacting) {
          currentStore.addMessage(projectPath, {
            id: `msg-compact-start-${Date.now()}`,
            role: "system",
            content:
              "Claude Code is compacting this session's context (the conversation has grown large). " +
              "The run will continue, but expect a brief pause.",
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
        }

        if (event.type === "compact_complete") {
          const preTokensK = event.pre_tokens != null ? Math.round(event.pre_tokens / 1000) : null;
          const preTokensLabel = preTokensK != null ? `~${preTokensK}K tokens` : "an unknown token count";
          const triggerLabel = event.trigger === "manual" ? "manually compacted" : "auto-compacted";
          const compactionAt = new Date().toISOString();
          currentStore.setCompactionInfo(projectPath, {
            trigger: event.trigger || "auto",
            preTokens: event.pre_tokens,
            at: compactionAt,
          });
          // Stamp the creation log so subsequent heading detections carry
          // postCompaction: true, and the next non-recheck user turn can
          // prepend a recap of "what you wrote before the compact".
          currentStore.markPostCompactionFromNow(projectPath, compactionAt);
          currentStore.addMessage(projectPath, {
            id: `msg-compact-complete-${Date.now()}`,
            role: "system",
            content:
              `⚠️ Claude Code ${triggerLabel} this session's context (was ${preTokensLabel}). ` +
              `Details from earlier in this run may now be summarized rather than preserved verbatim. ` +
              `For critical specs, consider re-running with Opus 4.7 (1M context) or splitting the session plan into smaller phases.`,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
        }

        if (event.type === "turn_complete") {
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
          // Audit takes priority — a document matching AUDIT_START_PATTERN is never also a spec
          const isAudit = AUDIT_START_PATTERN.test(finalContent);

          // Close the final open entry in the creation log (if any) so its
          // body bytes are recorded. Skip on audit/recheck turns.
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
          // original spec untouched. Mirrors useSpecConversation.ts — the two
          // hooks must keep this logic in lockstep so AUDIT-PATCH works for
          // every provider.
          let isSpec = !isAudit && (SPEC_START_PATTERN.test(finalContent) || isLikelySpecDocument(finalContent));
          let mergedSpecContent: string | null = null;
          let patchFailureReasons: string[] | null = null;
          let patchAppliedSummary: string | null = null;
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

          // Finalize the patch outcome for the Coverage panel banner. We do
          // this AFTER the re-audit so `remainingFindings` reflects the audit
          // of the merged spec. For a fail-closed patch we reuse the previous
          // report's failure count.
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
          state.streamBuffer = "";
          currentStore.persistState(projectPath);
          if (state.unlisten) {
            state.unlisten();
            state.unlisten = null;
          }
        }

        if (event.type === "process_exited") {
          // Process died — clean up
          if (state.flushScheduled !== null) {
            cancelAnimationFrame(state.flushScheduled);
            state.flushScheduled = null;
          }
          // Stage 4: persist stream observability stats. Treat non-zero exits
          // as errored; zero exits as cancelled (clean shutdown).
          finalizeStreamStats(
            event.exit_code === 0 ? 'cancelled' : 'errored',
            event.exit_code !== 0 ? `process exited with code ${event.exit_code ?? 'unknown'}` : undefined,
          );
          currentStore.setAuditPending(projectPath, false);
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
          if (state.unlisten) {
            state.unlisten();
            state.unlisten = null;
          }
        }

        if (event.type === "process_error") {
          // Stage 4: persist stream observability stats with the error message.
          finalizeStreamStats('errored', event.error);
          currentStore.setAuditPending(projectPath, false);
          currentStore.setPlanningStreaming(projectPath, false);
          currentStore.addMessage(projectPath, {
            id: `msg-err-${Date.now()}`,
            role: "system",
            content: `Error: ${event.error}`,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
          if (state.unlisten) {
            state.unlisten();
            state.unlisten = null;
          }
        }
      });

      state.unlisten = unlisten;

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
      // Mark audit as pending immediately so the SpecPreview can render the
      // Verification… tab before any content has streamed in. Cleared on the
      // terminal stream event (turn_complete/process_exited/process_error).
      useSpecWriterStore.getState().setAuditPending(projectPath, true);
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
