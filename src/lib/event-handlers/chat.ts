import type {
  FrontendEvent,
  TextDeltaEvent,
  TextCompleteEvent,
  TurnCompleteEvent,
  ThinkingDeltaEvent,
} from "../../types/agent-events";
import type { TurnStats } from "../../types/session";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCliModelCacheStore } from "../../stores/cliModelCacheStore";
import { showToast } from "../../stores/toastStore";
import { getContextWindowForModel } from "../model-context";
import { handleProcessError, handleProcessExited } from "./process";
import { handleUsageUpdate, checkContextThresholds, maybeGenerateChangelog } from "./lifecycle";
import { turnToolCallCount } from "./activity";
import { scheduleFlushTranscript } from "../session-transcript";

// Store state types (derived from Zustand store getState())
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

let messageCounter = 0;
const idEpoch = Date.now().toString(36);

export function nextMessageId(): string {
  return `msg-${idEpoch}-${++messageCounter}`;
}

// Streaming buffer: batches rapid text_delta events and flushes at ~60fps
export const streamingBuffers = new Map<string, string>();
export const pendingFrames = new Map<string, number>();

export function flushStreamingBuffer(sessionId: string): void {
  const buffered = streamingBuffers.get(sessionId);
  if (buffered) {
    useSessionStore.getState().appendStreamingContent(sessionId, buffered);
    streamingBuffers.set(sessionId, "");
  }
  pendingFrames.delete(sessionId);
}

function bufferStreamingText(sessionId: string, text: string): void {
  const current = streamingBuffers.get(sessionId) ?? "";
  streamingBuffers.set(sessionId, current + text);

  // Use requestAnimationFrame if available (browser), otherwise flush immediately (test env)
  if (typeof requestAnimationFrame === "function") {
    if (!pendingFrames.has(sessionId)) {
      const frame = requestAnimationFrame(() => flushStreamingBuffer(sessionId));
      pendingFrames.set(sessionId, frame);
    }
  } else {
    flushStreamingBuffer(sessionId);
  }
}

// Thinking streaming buffer: batches rapid thinking_delta events and flushes at ~60fps
export const thinkingBuffers = new Map<string, string>();
export const thinkingFrames = new Map<string, number>();

export function flushThinkingBuffer(sessionId: string): void {
  const buffered = thinkingBuffers.get(sessionId);
  if (buffered) {
    useSessionStore.getState().appendThinkingContent(sessionId, buffered);
    thinkingBuffers.set(sessionId, "");
  }
  thinkingFrames.delete(sessionId);
}

function bufferThinkingText(sessionId: string, text: string): void {
  const current = thinkingBuffers.get(sessionId) ?? "";
  thinkingBuffers.set(sessionId, current + text);

  if (typeof requestAnimationFrame === "function") {
    if (!thinkingFrames.has(sessionId)) {
      const frame = requestAnimationFrame(() => flushThinkingBuffer(sessionId));
      thinkingFrames.set(sessionId, frame);
    }
  } else {
    flushThinkingBuffer(sessionId);
  }
}

// ── Extracted chat event handlers ──

function handleTextDelta(sessionId: string, event: TextDeltaEvent, store: SessionStoreState, now: string): void {
  store.touchLastEvent(sessionId);
  store.ensureBusy(sessionId);
  store.setSessionActivity(sessionId, { label: "Generating response...", toolName: null, toolElapsed: 0, filePath: null });
  const streaming = store.sessionStreaming.get(sessionId);
  if (!streaming?.isStreaming) {
    const msgId = nextMessageId();
    store.addMessage(sessionId, {
      id: msgId,
      role: "assistant",
      content: "",
      timestamp: now,
      activityIds: [],
      isStreaming: true,
    });
    store.startStreaming(sessionId, msgId);
  }
  bufferStreamingText(sessionId, event.text);
}

function handleTextComplete(sessionId: string, event: TextCompleteEvent, store: SessionStoreState, now: string): void {
  // Flush any buffered text before finalizing
  const pendingFrame = pendingFrames.get(sessionId);
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  flushStreamingBuffer(sessionId);

  const streaming = store.sessionStreaming.get(sessionId);
  if (!streaming?.isStreaming) {
    const msgId = nextMessageId();
    store.addMessage(sessionId, {
      id: msgId,
      role: "assistant",
      content: event.full_text,
      timestamp: now,
      activityIds: [],
      isStreaming: false,
    });
  } else {
    store.finalizeStreaming(sessionId, event.full_text);
  }
}

function handleThinkingDelta(sessionId: string, event: ThinkingDeltaEvent, store: SessionStoreState): void {
  store.touchLastEvent(sessionId);
  store.ensureBusy(sessionId);
  store.setSessionActivity(sessionId, { label: "Reasoning...", toolName: null, toolElapsed: 0, filePath: null });
  const thinking = store.sessionThinking.get(sessionId);
  if (!thinking?.isThinking) {
    store.startThinking(sessionId);
  }
  bufferThinkingText(sessionId, event.thinking);
}

function handleTurnComplete(sessionId: string, event: TurnCompleteEvent, store: SessionStoreState): void {
  store.setSessionBusy(sessionId, false);
  // Flush any buffered text
  const turnFrame = pendingFrames.get(sessionId);
  if (turnFrame) cancelAnimationFrame(turnFrame);
  flushStreamingBuffer(sessionId);
  // Flush any buffered thinking
  const thinkFrame = thinkingFrames.get(sessionId);
  if (thinkFrame) cancelAnimationFrame(thinkFrame);
  flushThinkingBuffer(sessionId);
  // Finalize thinking if still active
  const thinking = store.sessionThinking.get(sessionId);
  if (thinking?.isThinking) {
    store.finalizeThinking(sessionId);
  }

  const streaming = store.sessionStreaming.get(sessionId);
  const completedMessageId = streaming?.currentMessageId ?? null;
  if (streaming?.isStreaming) {
    store.finalizeStreaming(sessionId);
  }
  // Use the LARGEST known context window — the CLI may report 200K for a [1m] model
  const storedCtx = store.sessionContext.get(sessionId);
  const settingsDefault = useSettingsStore.getState().settings.defaultContextWindow;
  const modelMax = getContextWindowForModel(store.sessions.get(sessionId)?.model, settingsDefault);
  const contextMax = Math.max(
    event.context_window ?? 0,
    storedCtx?.max ?? 0,
    modelMax,
  );

  if (event.usage) {
    const totalInput =
      (event.usage.input_tokens ?? 0) +
      (event.usage.cache_creation_input_tokens ?? 0) +
      (event.usage.cache_read_input_tokens ?? 0);
    const totalOutput = event.usage.output_tokens ?? 0;

    // Only use aggregate estimation as fallback when no per-call
    // usage_update events arrived (backward compat with older CLI).
    // When usage_updates are available, context is already up-to-date.
    const stats = store.sessionStats.get(sessionId);
    const hadIncrementalUpdates = stats && stats.apiCallCount > 0;
    if (!hadIncrementalUpdates) {
      const toolCalls = turnToolCallCount.get(sessionId) ?? 0;
      const apiCalls = Math.max(toolCalls, 1);
      const estimatedContext = Math.round((totalInput + totalOutput) / apiCalls);
      store.updateContext(sessionId, estimatedContext, contextMax);
    } else {
      // Update max from modelUsage even when incremental updates handled context.used
      const currentCtx = store.sessionContext.get(sessionId);
      if (currentCtx && contextMax !== currentCtx.max) {
        store.updateContext(sessionId, currentCtx.used, contextMax);
      }
    }
  }
  // Reset tool call counter for next turn
  turnToolCallCount.delete(sessionId);

  // Finalize session stats: add cost + turn count, and if no incremental
  // usage_update events were received (older CLI), add aggregate tokens.
  const turnStats: TurnStats = {
    durationMs: event.duration_ms,
    costUsd: event.cost_usd,
    inputTokens: event.usage?.input_tokens ?? 0,
    outputTokens: event.usage?.output_tokens ?? 0,
    cacheCreationTokens: event.usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: event.usage?.cache_read_input_tokens ?? 0,
    durationApiMs: event.duration_api_ms,
    numTurns: event.num_turns,
    stopReason: event.stop_reason,
  };

  // Attach turn stats to the completed assistant message
  const targetMsgId = completedMessageId ?? (() => {
    const msgs = store.sessionMessages.get(sessionId) ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") return msgs[i].id;
    }
    return null;
  })();

  // setTurnStats handles both message attachment AND stats accumulation
  // (with double-count protection for usage_update events)
  store.setTurnStats(sessionId, targetMsgId ?? "", turnStats);

  // Context meter toast notifications
  checkContextThresholds(sessionId);

  // Trigger changelog generation if enabled
  maybeGenerateChangelog(sessionId);

  // Eagerly persist the now-complete assistant turn so crash recovery has
  // it available — the 60s snapshot tick remains as a safety net.
  scheduleFlushTranscript(sessionId);
}

// ── Main chat event handler ──

export function handleChatEvent(sessionId: string, event: FrontendEvent): void {
  const store = useSessionStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "session_init":
      if (event.model) {
        store.updateModel(sessionId, event.model);
        // Set context max based on model name immediately (before first turn_complete)
        const settingsDefault = useSettingsStore.getState().settings.defaultContextWindow;
        const modelMax = getContextWindowForModel(event.model, settingsDefault);
        const currentCtx = store.sessionContext.get(sessionId);
        store.updateContext(sessionId, currentCtx?.used ?? 0, modelMax);
      }
      if (event.thinking_effort) {
        const effort = event.thinking_effort.toLowerCase().trim();
        // Accept whatever effort label the CLI emits (per-model
        // supportedEffortLevels — never hardcode the list). Just guard
        // against empty/whitespace.
        if (effort.length > 0) {
          store.setSessionEffort(sessionId, effort);
        }
      }
      break;

    case "cli_session_id":
      store.setCliSessionId(sessionId, event.cli_session_id);
      break;

    case "session_notice":
      // Non-alarming informational notice (e.g. a Codex resume fell back
      // to a fresh thread because the rollout was gone). Info toast, not
      // a red error.
      showToast(event.message, "info", 8000);
      break;

    case "thinking_delta":
      handleThinkingDelta(sessionId, event, store);
      break;

    case "thinking_complete": {
      // Flush any buffered thinking
      const thinkingFrame = thinkingFrames.get(sessionId);
      if (thinkingFrame) cancelAnimationFrame(thinkingFrame);
      flushThinkingBuffer(sessionId);
      store.finalizeThinking(sessionId, event.full_thinking);
      break;
    }

    case "text_delta":
      handleTextDelta(sessionId, event, store, now);
      break;

    case "text_complete":
      handleTextComplete(sessionId, event, store, now);
      break;

    case "turn_complete":
      handleTurnComplete(sessionId, event, store);
      break;

    case "process_error":
      handleProcessError(sessionId, event, store, now);
      break;

    case "process_exited":
      handleProcessExited(sessionId, event, store, now);
      break;

    case "protected_path_deny": {
      // CLI 2.1.126: `permission_denials` is a multi-purpose channel — it carries
      // (a) writes the host hook denied, (b) ALWAYS-denied control/UI tools
      // (ExitPlanMode/EnterPlanMode/AskUserQuestion — the CLI denies these
      // regardless of host hook decision and uses the entry as a UI-prompt
      // signal), and (c) protected-path guardrail blocks (rare in
      // bypassPermissions mode). Bucket by tool_name so the toast is honest.
      // See docs/internal/cli-2.1.126-protocol-report.md §"actionable bugs B1".
      const CONTROL_TOOLS = new Set(["ExitPlanMode", "EnterPlanMode", "AskUserQuestion"]);
      const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
      // Phase 2 §4.7: protected-path prefixes are per-agent. The event
      // carries `agent_id` (optional in Phase 1, populated in Phase 2);
      // missing values keep the v1.2.0 default of Claude.
      const PROTECTED_PREFIXES_BY_AGENT: Record<string, string[]> = {
        claude_code: [".claude/", ".git/", ".vscode/"],
        codex: [".codex/", ".git/", ".agents/"],
      };
      const PROTECTED_PREFIXES =
        PROTECTED_PREFIXES_BY_AGENT[event.agent_id ?? "claude_code"] ??
        PROTECTED_PREFIXES_BY_AGENT.claude_code;

      const writeDenials = event.denials.filter((d) => WRITE_TOOLS.has(d.tool_name));
      const otherDenials = event.denials.filter(
        (d) => !CONTROL_TOOLS.has(d.tool_name) && !WRITE_TOOLS.has(d.tool_name),
      );
      // Control-tool denials are intentionally NOT toasted — they drive
      // PlanCompleteModal / QuestionModal via the tool_use_start path.

      const formatList = (
        items: Array<{ tool_name: string; tool_input?: Record<string, unknown> }>,
        labelOf: (i: { tool_name: string; tool_input?: Record<string, unknown> }) => string,
      ): string => {
        const labels = items.slice(0, 3).map(labelOf);
        const more = items.length > 3 ? ` (+${items.length - 3} more)` : "";
        return labels.join(", ") + more;
      };

      if (writeDenials.length > 0) {
        const isProtectedPath = (fp: unknown): fp is string => {
          if (typeof fp !== "string") return false;
          // Match `<anything>/.claude/...`, `.claude/...`, etc. — the CLI's
          // protected-path check fires on the suffix segment, not absolute path.
          return PROTECTED_PREFIXES.some(
            (p) => fp.includes(`/${p}`) || fp.startsWith(p),
          );
        };
        const protectedPathHits = writeDenials.filter((d) =>
          isProtectedPath(d.tool_input?.file_path),
        );
        const protectedPath = protectedPathHits.length > 0;

        const labelOf = (d: { tool_name: string; tool_input?: Record<string, unknown> }) => {
          const fp = d.tool_input?.file_path;
          return typeof fp === "string" ? fp : d.tool_name;
        };
        const list = formatList(writeDenials, labelOf);
        const noun = writeDenials.length === 1 ? "Write blocked" : `${writeDenials.length} writes blocked`;
        const guardrailName =
          (event.agent_id ?? "claude_code") === "codex"
            ? "Codex's sandbox"
            : "Claude CLI's protected-path guardrail";
        const summary = protectedPath
          ? `${noun} by ${guardrailName}: ${list}. Ask the agent to use Bash heredoc instead.`
          : `${noun}: ${list}.`;
        showToast(summary, "error", 12000);
      }

      if (otherDenials.length > 0) {
        const labelOf = (d: { tool_name: string }) => d.tool_name;
        const list = formatList(otherDenials, labelOf);
        const noun = otherDenials.length === 1 ? "Tool call denied" : `${otherDenials.length} tool calls denied`;
        showToast(`${noun} by Claude CLI: ${list}.`, "error", 10000);
      }
      break;
    }

    case "compacting_status": {
      store.touchLastEvent(sessionId);
      store.setSessionCompacting(sessionId, event.is_compacting);
      if (event.is_compacting) {
        store.setSessionActivity(sessionId, { label: "Compacting context...", toolName: null, toolElapsed: 0, filePath: null });
        showToast("Compacting context — this may take a moment...", "info", 5000);
      }
      break;
    }

    case "compact_complete": {
      store.touchLastEvent(sessionId);
      store.setSessionCompacting(sessionId, false);
      const tokenInfo = event.pre_tokens
        ? ` (was ${Math.round(event.pre_tokens / 1000)}K tokens)`
        : "";
      const triggerLabel = event.trigger === "manual" ? "Manual" : "Auto";
      showToast(`${triggerLabel} compaction complete${tokenInfo}`, "info", 6000);
      break;
    }

    case "rate_limit_warning": {
      store.touchLastEvent(sessionId);
      const utilization = event.utilization || 0;
      store.setRateLimitUtilization(sessionId, utilization);

      // The CLI filters to "allowed_warning" status before sending, so always show.
      // Build a descriptive message from available fields.
      if (utilization >= 0.9) {
        const pct = Math.round(utilization * 100);
        showToast(`Rate limit ${pct}% utilized — requests may be throttled soon`, "error", 10000);
      } else if (utilization >= 0.7) {
        const pct = Math.round(utilization * 100);
        showToast(`Rate limit ${pct}% utilized`, "info", 6000);
      } else {
        // utilization is 0 (CLI doesn't send it) — show status-based warning
        const typeInfo = event.rate_limit_type ? ` (${event.rate_limit_type})` : "";
        const overageInfo = event.overage_status && event.overage_status !== "allowed"
          ? ` — overage ${event.overage_status}`
          : "";
        showToast(`Rate limit warning${typeInfo}${overageInfo}`, "info", 8000);
      }
      break;
    }

    case "usage_update":
      handleUsageUpdate(sessionId, event, store);
      break;

    case "interrupt_result": {
      if (event.success) {
        store.setSessionActivity(sessionId, { label: "Stopping...", toolName: null, toolElapsed: 0, filePath: null });
        // The subsequent turn_complete (with stop_reason: null) will clear busy state
      } else {
        showToast(`Failed to interrupt: ${event.error ?? "unknown error"}`, "error");
      }
      break;
    }

    case "model_changed": {
      if (event.success) {
        store.updateModel(sessionId, event.model);
        // Update context max for the new model
        const settingsDefaultForModel = useSettingsStore.getState().settings.defaultContextWindow;
        const newModelMax = getContextWindowForModel(event.model, settingsDefaultForModel);
        const currentCtxForModel = store.sessionContext.get(sessionId);
        store.updateContext(sessionId, currentCtxForModel?.used ?? 0, newModelMax);
        showToast(`Switched to ${event.model}`, "info", 3000);
      } else {
        showToast(`Model switch failed: ${event.error ?? "unknown error"}`, "error");
      }
      break;
    }

    case "effort_changed": {
      // Codex emits this from set_effort; mirrors model_changed. Updates
      // sessionEffort so EffortSelector's label reflects the new pick.
      if (event.success) {
        store.setSessionEffort(sessionId, event.effort);
        showToast(`Effort set to ${event.effort}`, "info", 2500);
      } else {
        showToast(`Effort change failed: ${event.error ?? "unknown error"}`, "error");
      }
      break;
    }

    case "hook_prompt": {
      // Codex hook injected one or more prompt fragments. Each surfaces
      // as its own info toast so users can see what context the hook
      // added. If this becomes noisy in practice, the plan calls out a
      // settings-toggle follow-up.
      for (const f of event.fragments) {
        showToast(f.text, "info", 4000);
      }
      break;
    }

    case "hook_status": {
      // Lifecycle marker for a hook run. The `completed` notification is
      // the meaningful one for users; `started` we surface only if it
      // matters (currently silent — log-only).
      if (event.kind !== "completed") break;
      switch (event.status) {
        case "completed":
          // Quiet — successful hook runs would be too noisy to toast.
          break;
        case "failed":
        case "stopped":
          showToast(
            `Hook ${event.event_name} ${event.status}`,
            "error",
            5000,
          );
          break;
        case "blocked":
          // toastStore has no "warning" type — surface blocks as info
          // with a longer duration so they don't get missed.
          showToast(
            `Hook ${event.event_name} blocked this action`,
            "info",
            6000,
          );
          break;
        default:
          break;
      }
      break;
    }

    case "review_mode_entered": {
      // Tier 2: flip the session into review mode and store the review
      // text. ReviewModeBanner reads sessionReviewContent + sessionModes
      // to render the banner above the chat message list.
      store.setSessionMode(sessionId, "review");
      store.setSessionReviewContent(sessionId, event.review);
      break;
    }

    case "review_mode_exited": {
      // Review ended. Restore normal mode but keep the review text
      // available so the banner can show the final-review state until
      // the user dismisses it.
      store.setSessionMode(sessionId, "normal");
      store.setSessionReviewContent(sessionId, event.final_review);
      break;
    }

    case "auth_token_refresh_requested": {
      // v1.4.1 Phase A.3 — Codex hit a 401 and asked us to refresh.
      // We don't yet implement the OAuth handoff, so the spawn loop
      // returned a structured error and we surface a clear toast with
      // the actionable recovery step.
      showToast(
        "Codex needs to refresh its ChatGPT token. Quit CodeMantis, run `codex login` in a terminal, then reopen the session.",
        "error",
        12000,
      );
      break;
    }

    case "dynamic_tool_call_denied": {
      // v1.4.1 Phase A.6 — Codex asked the client to execute a dynamic
      // tool. CodeMantis has no client-side tool registry, so the spawn
      // loop responded {success:false, contentItems:[...]} and Codex
      // continues without hanging. This toast just surfaces the gap
      // honestly so users know why a tool didn't run.
      const ns = event.namespace ? `${event.namespace}.` : "";
      showToast(
        `Codex asked to run dynamic tool '${ns}${event.tool}', which CodeMantis doesn't yet implement.`,
        "info",
        5000,
      );
      break;
    }

    case "mcp_startup_status": {
      // v1.4.1 Phase B.2 — Codex MCP server failed / cancelled startup.
      // The translator filters out the noisy starting/ready transitions
      // upstream so this case only fires when something needs the user's
      // attention.
      const detail = event.error ? `: ${event.error}` : "";
      showToast(
        `MCP server '${event.name}' ${event.status}${detail}`,
        "error",
        8000,
      );
      break;
    }

    case "capabilities_discovered": {
      store.setSessionCapabilities(sessionId, event);
      // Also seed the cross-session model cache so consumers that don't
      // own a session (SpecWriter dropdown, future planners) can render
      // a real list without waiting on their own spawn. The cache itself
      // refuses to overwrite a populated entry with an empty list, so
      // partial / transport-failed payloads can't regress the dropdown.
      const agent = event.agent_id ?? "claude_code";
      if (event.models && event.models.length > 0) {
        useCliModelCacheStore.getState().setModels(agent, event.models);
      }
      break;
    }
  }
}
