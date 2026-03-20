import type {
  FrontendEvent,
  TextDeltaEvent,
  TextCompleteEvent,
  TurnCompleteEvent,
} from "../../types/claude-events";
import type { TurnStats } from "../../types/session";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { showToast } from "../../stores/toastStore";
import { getContextWindowForModel } from "../model-context";
import { handleProcessError, handleProcessExited } from "./process";
import { handleUsageUpdate, checkContextThresholds, maybeGenerateChangelog } from "./lifecycle";
import { turnToolCallCount } from "./activity";

// Store state types (derived from Zustand store getState())
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

let messageCounter = 0;

export function nextMessageId(): string {
  return `msg-${++messageCounter}`;
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

function handleTurnComplete(sessionId: string, event: TurnCompleteEvent, store: SessionStoreState): void {
  store.setSessionBusy(sessionId, false);
  // Flush any buffered text
  const turnFrame = pendingFrames.get(sessionId);
  if (turnFrame) cancelAnimationFrame(turnFrame);
  flushStreamingBuffer(sessionId);

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
}

// ── Main chat event handler ──

export function handleChatEvent(sessionId: string, event: FrontendEvent): void {
  console.log("[chat-event]", sessionId, event.type, event);
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
        const effort = event.thinking_effort.toLowerCase();
        if (effort === "high" || effort === "medium" || effort === "low") {
          store.setSessionEffort(sessionId, effort);
        }
      }
      break;

    case "cli_session_id":
      store.setCliSessionId(sessionId, event.cli_session_id);
      break;

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

    case "capabilities_discovered": {
      store.setSessionCapabilities(sessionId, event);
      break;
    }
  }
}
