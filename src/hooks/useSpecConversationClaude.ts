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
import type { FrontendEvent, AgentId } from "../types/agent-events";
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
import { buildHandshakeQuestions } from "../lib/capability-handshake-prompt";
import { auditCoverage, describeFailure, extractInputDocs, summarizeReport } from "../lib/spec-coverage-audit";
import { parseAuditPatch, applyAuditPatch, summarizePatchApplication } from "../lib/spec-audit-patch";
import {
  advanceCreationLog,
  finalizeOpenEntry,
  renderCreationLogRecap,
} from "../lib/spec-creation-log";
import { analyzeInput, renderClarificationMessage } from "../lib/spec-input-analyzer";
import {
  finalizeSpecForCapabilities,
  renderAdjustmentsMessage,
  vocabFromCapabilities,
} from "../lib/spec-writer-finalize";
import type { StreamStatus } from "../types/spec-writer";

/** Marker the model emits at the start of an auto-recheck reply per buildRecheckPrompts. */
const AUDIT_PATCH_MARKER = "<!-- AUDIT-PATCH -->";

/**
 * Safety ceiling for an in-band guide-recovery turn (Recognize Guide on the
 * CLI path). If the turn never produces a terminal event (process hung,
 * interrupted, killed), the resolver fires with "" so recovery degrades to a
 * single-session guide instead of hanging the Recognize-Guide flow forever.
 */
const GUIDE_RECOVERY_TIMEOUT_MS = 180_000; // 3 minutes

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
   * True when the current stream is an in-band guide-recovery turn (Recognize
   * Guide on the CLI path). The reply is a structured session-plan envelope
   * consumed by the Recognize-Guide flow — NOT chat content, a spec, or an
   * audit. Suppresses all visible-message / spec-detection / coverage
   * handling; the reply is captured and handed to the pending resolver.
   */
  isGuideRecovery: boolean;
  /**
   * True when the current stream is a Verification Audit turn (the user clicked
   * "Generate the Verification Audit"). This is the AUTHORITATIVE routing signal:
   * when set, the stream writes to currentAuditContent from the first chunk and
   * finalizeTurn forces isAudit=true, regardless of the title the model chose for
   * the document. Text-pattern detection (AUDIT_START_PATTERN) is only a fallback
   * for audits that arrive without this intent. Mirrors useSpecConversation.ts.
   */
  isAuditTurn: boolean;
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
  /**
   * True once the current turn has been finalized (spinner cleared, content
   * committed). Guards `finalizeTurn` so a turn that finalizes on
   * `text_complete` is NOT finalized again by a later `turn_complete`, and so a
   * manual `cancelStream` makes any subsequent terminal event a no-op. Codex's
   * long-lived app-server never emits a per-turn `process_exited`, so unlike
   * Claude there is no second safety net — `text_complete` must be able to
   * finalize on its own. Reset to false at the start of every turn.
   */
  finalized: boolean;
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
    isGuideRecovery: false,
    isAuditTurn: false,
    creationLogWatermark: 0,
    chunkCount: 0,
    streamStartMs: 0,
    lastEventMs: 0,
    watchdogTimer: null,
    stalledNoticed: false,
    finalized: false,
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
  /**
   * Recognize Guide (CLI path): send a recovery prompt into the live session
   * and resolve with the model's raw reply. Key-free — reuses the running CLI
   * instead of demanding an API provider.
   */
  recoverGuideViaCli: (projectPath: string, prompt: string) => Promise<string>;
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
  /**
   * Per-project resolver for an in-flight in-band guide-recovery turn. Set by
   * `recoverGuideViaCli`, fired by `finalizeTurn` with the model's raw reply
   * (or by a safety timeout with "").
   */
  const guideRecoveryResolversRef = useRef<Map<string, (text: string) => void>>(new Map());
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

        // Phase 0b: build the capability handshake questions when the
        // `selfDriveConfirmCapabilities` setting is ON (default true) AND
        // at least one capability needs user confirmation. The UI surfaces
        // these via CapabilityHandshakeBanner; `ensureSession` is gated on
        // this map being empty so we never build a SpecWriter prompt with
        // ambiguous capabilities.
        const settings = useSettingsStore.getState().settings;
        const confirmEnabled = settings.selfDriveConfirmCapabilities ?? true;
        if (confirmEnabled) {
          const questions = buildHandshakeQuestions(capabilities);
          store.setPendingHandshakeQuestions(projectPath, questions);
        } else {
          store.clearPendingHandshakeQuestions(projectPath);
        }
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

    // Phase 0b gate: don't bake the SpecWriter system prompt with ambiguous
    // capabilities. If a handshake is pending for this project, the user
    // must resolve it before a Claude Code session is created. The UI is
    // responsible for surfacing the handshake; this guard ensures the gate
    // holds even if the UI is bypassed.
    const pendingHandshake = store.pendingHandshakeQuestions.get(projectPath);
    if (pendingHandshake && pendingHandshake.length > 0) {
      throw new Error(
        "SpecWriter session cannot start while the capability handshake is pending. " +
          "Resolve the questions in the CapabilityHandshakeBanner or disable " +
          "`selfDriveConfirmCapabilities` in settings.",
      );
    }

    // v1.4.1 Phase B.1 — local-CLI dispatch. The hook handles BOTH
    // Claude Code and Codex local-CLI providers (the API providers go
    // through `useSpecConversation`). Codex sessions spawn with
    // `agent_id: "codex"` so the backend wires the ephemeral
    // ~/.codemantis/specwriter-sessions/<sid>/AGENTS.override.md path
    // (see src-tauri/src/agents/codex/agents_md.rs +
    // spawn.rs:333-370). The system prompt content stays identical;
    // Codex consumes it via AGENTS.override.md instead of Claude's
    // --append-system-prompt flag — the prompt builder is unchanged.
    const agentId: AgentId =
      conv.ai_provider === "codex" ? "codex" : "claude_code";
    // Codex's CLI picks its own default model when `model` is empty;
    // the live `model/list` later updates the ModelSelector. For
    // Claude Code we keep the hardcoded default.
    const model =
      conv.ai_model || (agentId === "codex" ? "" : DEFAULT_SPEC_CLAUDE_CODE_MODEL);
    const projectContext = store.projectContext.get(projectPath) ?? "";
    const projectCapabilities = store.projectCapabilities.get(projectPath) ?? null;
    const systemPrompt = buildClaudeCodePrompt(
      conv.mode,
      conv.templateCatalog ?? "",
      projectContext,
      projectCapabilities,
    );

    const sessionId = await createSpecwriterSession(
      projectPath,
      model,
      systemPrompt,
      agentId,
    );
    store.setCliSessionId(projectPath, sessionId);

    return sessionId;
  }, []);

  const sendMessage = useCallback(
    async (
      projectPath: string,
      content: string,
      attachments?: SpecAttachment[],
      meta?: { isAutoRecheck?: boolean; isGuideRecovery?: boolean; isAudit?: boolean }
    ) => {
      // Guide-recovery turns are out-of-band repairs, not user turns — they
      // skip every pre-flight side effect (compaction recap, recheck reset,
      // input analysis) and every visible message, just like auto-recheck but
      // more so (their reply never lands in the chat at all).
      const isSideTurn = !!meta?.isAutoRecheck || !!meta?.isGuideRecovery;

      // Capture the post-compaction recap BEFORE we clear the per-turn state
      // below. If the prior turn was compacted, we'll prepend this recap to
      // the user's prompt so the model knows what it already wrote.
      let compactionRecap = "";
      if (!isSideTurn) {
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
      if (!isSideTurn) {
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

      // Add user message to store. Guide-recovery prompts are huge, machine-
      // facing repair requests — they never appear in the conversation.
      if (!meta?.isGuideRecovery) {
        const userMessage: SpecMessage = {
          id: `msg-${Date.now()}`,
          role: "user",
          content,
          attachments,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        };
        store.addMessage(projectPath, userMessage);
      }

      // ─── Stage 2: Input analyzer (pre-flight, runs once per attached doc) ───
      if (!isSideTurn) {
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

      // Add assistant placeholder for streaming. Skipped for guide recovery —
      // its reply is captured for the Recognize-Guide flow, not rendered, so a
      // placeholder would leave a stray empty bubble behind.
      if (!meta?.isGuideRecovery) {
        const assistantMsg: SpecMessage = {
          id: `msg-${Date.now() + 1}`,
          role: "assistant",
          content: "",
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        };
        store.addMessage(projectPath, assistantMsg);
      }
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
      state.isGuideRecovery = !!meta?.isGuideRecovery;
      state.isAuditTurn = !!meta?.isAudit;
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
      state.finalized = false;
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
        // Guide-recovery replies are structured envelopes consumed by the
        // Recognize-Guide flow — never render them, never touch spec content.
        // The buffer keeps accumulating in the event handler; finalizeTurn
        // hands the full text to the pending resolver.
        if (state.isGuideRecovery) return;
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
        // tracks SPEC progress, not audit progress. `isAuditTurn` covers the
        // first chunk of an intended audit, before `auditDetected` latches.
        if (!state.isAutoRecheck && !state.auditDetected && !state.isAuditTurn) {
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
        if (state.isAuditTurn || state.auditDetected || AUDIT_START_PATTERN.test(buf)) {
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
              `For critical specs, consider re-running with Opus 4.8 (1M context) or splitting the session plan into smaller phases.`,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
        }

        // Finalize the turn: clear the spinner, commit content, run audit/recheck.
        // Idempotent via state.finalized so it can fire from EITHER text_complete
        // (Codex's reliable terminal signal) or turn_complete (Claude + Codex),
        // whichever the agent delivers first, without double-committing.
        const finalizeTurn = (): void => {
          if (state.finalized) return;
          state.finalized = true;
          // Cancel pending RAF — completeTurn will write the final content
          if (state.flushScheduled !== null) {
            cancelAnimationFrame(state.flushScheduled);
            state.flushScheduled = null;
          }
          // Stage 4: persist stream observability stats.
          finalizeStreamStats('ok');
          // Audit generation (if any) is over — the tab can lose its ellipsis.
          currentStore.setAuditPending(projectPath, false);

          // Guide-recovery turn: hand the raw reply to the pending resolver and
          // return BEFORE any spec/audit/coverage handling. Nothing about this
          // turn is allowed to mutate currentSpecContent, the chat, or the
          // creation log — it's an out-of-band repair request.
          if (state.isGuideRecovery) {
            const recoveredText = state.streamBuffer;
            state.streamBuffer = "";
            currentStore.setPlanningStreaming(projectPath, false);
            if (state.unlisten) {
              state.unlisten();
              state.unlisten = null;
            }
            const resolver = guideRecoveryResolversRef.current.get(projectPath);
            if (resolver) {
              guideRecoveryResolversRef.current.delete(projectPath);
              resolver(recoveredText);
            }
            return;
          }

          const finalContent = state.streamBuffer;
          const parsed = parseSelectableOptions(finalContent);
          // Audit takes priority — a document is never also a spec. The user's
          // explicit "Generate the Verification Audit" intent (isAuditTurn) is
          // authoritative; AUDIT_START_PATTERN is only the fallback for audits
          // that arrive without that intent. This is what prevents a verification
          // audit whose H1 doesn't match the strict title from being misrouted
          // into (and overwriting) currentSpecContent.
          const isAudit = state.isAuditTurn || AUDIT_START_PATTERN.test(finalContent);

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

          // ─── Capability-aware finalize pass ──────────────────────────
          // Spec-shaped output only. Senior-advisor behavior: infer missing
          // `capability=` tags, substitute commands that don't fit the
          // project's evidence vocabulary (e.g. `supabase db reset` on a
          // cloud-only project), surface the adjustments as a system
          // message so the user sees what changed. Never blocks, never
          // refuses; non-spec turns (audits, recheck patches) pass through
          // untouched.
          let persistedContent = mergedSpecContent ?? finalContent;
          let finalizeAdjustmentsMessage: string | null = null;
          if (isSpec && !isAudit) {
            const projectCapabilities = useSpecWriterStore
              .getState()
              .projectCapabilities.get(projectPath) ?? null;
            const vocab = vocabFromCapabilities(projectCapabilities);
            const finalized = finalizeSpecForCapabilities(
              persistedContent,
              projectCapabilities,
              vocab,
            );
            persistedContent = finalized.content;
            finalizeAdjustmentsMessage = renderAdjustmentsMessage(finalized.adjustments);
          }

          // Single batched store update: streaming=false, content, status, message type
          currentStore.completeTurn(projectPath, {
            finalContent: persistedContent,
            isSpec,
            isAudit,
            displayContent: parsed?.cleanContent,
            options: parsed?.options,
            isReadyToWrite,
          });

          if (finalizeAdjustmentsMessage) {
            currentStore.addMessage(projectPath, {
              id: `msg-finalize-${Date.now()}`,
              role: "system",
              content: finalizeAdjustmentsMessage,
              message_type: "conversation",
              timestamp: new Date().toISOString(),
            });
          }

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
              // After a successful AUDIT-PATCH merge AND the capability-aware
              // finalize pass, audit the *persisted* spec — that's what the
              // user sees and what verify-mode grades against.
              const auditTarget = persistedContent;
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
        };

        // text_complete is Codex's reliable end-of-message signal
        // (item/completed). The long-lived Codex app-server may not follow it
        // with a turn/completed that reaches this listener, and unlike Claude it
        // never emits a per-turn process_exited safety net — so without this
        // branch the "Thinking…" spinner hangs forever. Adopt the authoritative
        // full_text (deltas may be empty if the agent message arrived only via
        // item/completed) and finalize. Mirrors chat.ts:308.
        if (event.type === "text_complete") {
          if (event.full_text && event.full_text.length >= state.streamBuffer.length) {
            state.streamBuffer = event.full_text;
          }
          finalizeTurn();
        }

        if (event.type === "turn_complete") {
          finalizeTurn();
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

          // Unblock an in-flight guide recovery with whatever we have (likely
          // empty) so it degrades promptly instead of waiting on the timeout.
          const recoveryResolver = guideRecoveryResolversRef.current.get(projectPath);
          if (recoveryResolver) {
            guideRecoveryResolversRef.current.delete(projectPath);
            recoveryResolver(state.streamBuffer);
          }

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
          const recoveryResolverOnErr = guideRecoveryResolversRef.current.get(projectPath);
          if (recoveryResolverOnErr) {
            guideRecoveryResolversRef.current.delete(projectPath);
            recoveryResolverOnErr(state.streamBuffer);
          }
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
          "integration point. Follow the Verification Audit format from your instructions.",
        undefined,
        { isAudit: true }
      );
    },
    [sendMessage]
  );

  const cancelStream = useCallback((projectPath: string) => {
    const store = useSpecWriterStore.getState();
    const sessionId = store.getCliSessionId(projectPath);

    // Optimistic stop: clear the spinner and tear down stream scaffolding
    // immediately, BEFORE (and regardless of) the interrupt round-trip. Codex's
    // long-lived app-server may not emit a terminal event we recognize when a
    // turn is interrupted (e.g. there is no active turn to cancel), so waiting
    // for one would leave "Thinking…" stuck — the reported "Stop does nothing"
    // bug. Marking the stream finalized makes any late turn_complete /
    // text_complete a no-op (finalizeTurn early-returns) so we never
    // double-commit.
    const state = getStreamState(projectPath);
    state.finalized = true;
    if (state.flushScheduled !== null) {
      cancelAnimationFrame(state.flushScheduled);
      state.flushScheduled = null;
    }
    if (state.watchdogTimer !== null) {
      clearInterval(state.watchdogTimer);
      state.watchdogTimer = null;
    }
    store.setStreamStats(projectPath, {
      chunks: state.chunkCount,
      bytes: state.streamBuffer.length,
      durationMs: state.streamStartMs > 0 ? Date.now() - state.streamStartMs : 0,
      startedAt: new Date(state.streamStartMs || Date.now()).toISOString(),
      endedAt: new Date().toISOString(),
      status: "cancelled",
      note: "cancelled by user",
    });
    store.setAuditPending(projectPath, false);
    store.setPlanningStreaming(projectPath, false);
    store.persistState(projectPath);
    if (state.unlisten) {
      state.unlisten();
      state.unlisten = null;
    }

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

  /**
   * Recognize Guide on the CLI path. Dispatches a recovery prompt INTO the
   * live SpecWriter session — the same agent that just wrote the spec, with
   * full context, and crucially NO API key required — then resolves with its
   * raw reply. Mirrors the AUDIT-PATCH auto-recheck mechanism: the reply is
   * captured in `finalizeTurn` (gated on `isGuideRecovery`) and never lands in
   * the chat. Always resolves: a terminal event or the safety timeout fires
   * the resolver so the Recognize-Guide flow can never hang.
   */
  const recoverGuideViaCli = useCallback(
    (projectPath: string, prompt: string): Promise<string> => {
      // A recovery already in flight for this project — refuse a second.
      const existing = guideRecoveryResolversRef.current.get(projectPath);
      if (existing) {
        existing("");
        guideRecoveryResolversRef.current.delete(projectPath);
      }
      return new Promise<string>((resolve) => {
        let settled = false;
        const wrapped = (text: string): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(text);
        };
        const timer = setTimeout(() => {
          if (guideRecoveryResolversRef.current.get(projectPath) === wrapped) {
            guideRecoveryResolversRef.current.delete(projectPath);
          }
          wrapped("");
        }, GUIDE_RECOVERY_TIMEOUT_MS);
        guideRecoveryResolversRef.current.set(projectPath, wrapped);
        void sendMessage(projectPath, prompt, undefined, { isGuideRecovery: true }).catch(() => {
          if (guideRecoveryResolversRef.current.get(projectPath) === wrapped) {
            guideRecoveryResolversRef.current.delete(projectPath);
          }
          wrapped("");
        });
      });
    },
    [sendMessage],
  );

  return {
    sendMessage,
    writeSpec,
    generateAudit,
    loadContext,
    cancelStream,
    changeModel,
    requestRecheck,
    recoverGuideViaCli,
  };
}
