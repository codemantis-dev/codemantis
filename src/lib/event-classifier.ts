import type { FrontendEvent } from "../types/claude-events";
import type { ActivityEntry } from "../types/activity";
import { extractSubAgentInfo } from "../types/activity";
import type { SessionMode } from "../types/session";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { useFileViewerStore, getLanguageFromPath } from "../stores/fileViewerStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useChangelogStore } from "../stores/changelogStore";
import { useAssistantStore } from "../stores/assistantStore";
import { showToast } from "../stores/toastStore";

// Tools that indicate actual changes were made (not just reads)
const MUTATING_TOOLS = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);

/** Maps tool names to human-readable activity labels for the ThinkingIndicator. */
function toolActivityLabel(toolName: string): string {
  switch (toolName) {
    case "Read": return "Reading file...";
    case "Glob": return "Searching files...";
    case "Grep": return "Searching code...";
    case "Write": return "Writing file...";
    case "Edit": return "Editing code...";
    case "Bash": return "Running command...";
    case "Agent": return "Running sub-agent..."; // default; overridden dynamically
    case "NotebookEdit": return "Editing notebook...";
    case "ListDirectory": case "LS": return "Listing files...";
    case "WebSearch": return "Searching the web...";
    case "WebFetch": return "Fetching web page...";
    case "TodoRead": case "TodoWrite": return "Managing tasks...";
    case "EnterPlanMode": return "Entering plan mode...";
    case "ExitPlanMode": return "Exiting plan mode...";
    default:
      if (toolName.startsWith("mcp__")) {
        // mcp__server__tool → "Running tool (server)..."
        const parts = toolName.split("__");
        const server = parts[1] ?? "mcp";
        const tool = parts.slice(2).join("_") || "tool";
        return `Running ${tool} (${server})...`;
      }
      return `Running ${toolName}...`;
  }
}

/** Build a contextual label based on active sub-agents for a session. */
function subAgentActivityLabel(sessionId: string): string {
  const agents = useSessionStore.getState().activeSubAgents.get(sessionId);
  if (!agents || agents.length === 0) return "Thinking...";
  if (agents.length === 1) {
    const a = agents[0];
    const typeTag = a.subagentType !== "general-purpose" ? `[${a.subagentType}] ` : "";
    return `Agent: ${typeTag}${a.description}`;
  }
  // Group by type for a compact summary
  const types = new Map<string, number>();
  for (const a of agents) {
    types.set(a.subagentType, (types.get(a.subagentType) ?? 0) + 1);
  }
  if (types.size === 1) {
    const [type, count] = [...types.entries()][0];
    const label = type !== "general-purpose" ? type : "sub-agent";
    return `Running ${count} ${label} agents...`;
  }
  return `Running ${agents.length} sub-agents...`;
}

let messageCounter = 0;

// Cache file content before Write/Edit tools run, keyed by tool_use_id
const preEditContentCache = new Map<string, string>();

// Track tool calls per turn for context window estimation (fallback only).
// When usage_update events are available (modern CLI), context is updated
// in real-time per API call. This counter is only used as a fallback for
// older CLI versions that don't emit usage_update events.
const turnToolCallCount = new Map<string, number>();
/** Tool IDs for mode-control tools (ExitPlanMode/EnterPlanMode) — skipped in activity feed */
const modeControlToolIds = new Set<string>();

function nextMessageId(): string {
  return `msg-${++messageCounter}`;
}

// Streaming buffer: batches rapid text_delta events and flushes at ~60fps
const streamingBuffers = new Map<string, string>();
const pendingFrames = new Map<string, number>();

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

export function handleChatEvent(sessionId: string, event: FrontendEvent): void {
  console.log("[chat-event]", sessionId, event.type, event);
  const store = useSessionStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "session_init":
      if (event.model) {
        store.updateModel(sessionId, event.model);
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

    case "text_delta": {
      store.touchLastEvent(sessionId);
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
      break;
    }

    case "text_complete": {
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
      break;
    }

    case "turn_complete": {
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
          store.updateContext(sessionId, estimatedContext, 200000);
        }
      }
      // Reset tool call counter for next turn
      turnToolCallCount.delete(sessionId);

      // Finalize session stats: add cost + turn count, and if no incremental
      // usage_update events were received (older CLI), add aggregate tokens.
      const turnStats: import("../types/session").TurnStats = {
        durationMs: event.duration_ms,
        costUsd: event.cost_usd,
        inputTokens: event.usage?.input_tokens ?? 0,
        outputTokens: event.usage?.output_tokens ?? 0,
        cacheCreationTokens: event.usage?.cache_creation_input_tokens ?? 0,
        cacheReadTokens: event.usage?.cache_read_input_tokens ?? 0,
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
      break;
    }

    case "process_error": {
      store.setSessionBusy(sessionId, false);
      const streaming = store.sessionStreaming.get(sessionId);
      if (streaming?.isStreaming) {
        store.finalizeStreaming(sessionId);
      }
      const errorMsgId = nextMessageId();
      store.addMessage(sessionId, {
        id: errorMsgId,
        role: "assistant",
        content: `**Error:** ${event.error}`,
        timestamp: now,
        activityIds: [],
        isStreaming: false,
      });
      break;
    }

    case "process_exited": {
      // Safety net: if turn_complete already cleared busy/streaming, this is a no-op.
      // Only act if the session is still stuck (e.g., process crashed before emitting result).
      const wasBusy = store.sessionBusy.get(sessionId) ?? false;
      const wasStreaming = store.sessionStreaming.get(sessionId)?.isStreaming ?? false;

      if (wasBusy || wasStreaming) {
        console.warn("[process_exited] Session still busy/streaming — recovering:", sessionId);
        store.setSessionBusy(sessionId, false);
        if (wasStreaming) {
          store.finalizeStreaming(sessionId);
        }
      }
      store.updateSessionStatus(sessionId, "idle");

      // Auth failure heuristic: quick exit + auth keywords in stderr
      const AUTH_KEYWORDS = [
        "auth", "login", "token", "expired", "unauthorized",
        "401", "403", "credential", "sign in", "not logged in",
        "authentication", "unauthenticated",
      ];
      const stderrLower = (event.stderr_tail ?? "").toLowerCase();
      const isAuthFailure =
        event.elapsed_ms < 5000 &&
        event.exit_code !== 0 &&
        AUTH_KEYWORDS.some((kw) => stderrLower.includes(kw));

      // Rate limit detection
      const RATE_LIMIT_KEYWORDS = ["rate limit", "429", "too many requests", "rate_limit"];
      const isRateLimit =
        event.exit_code !== 0 &&
        RATE_LIMIT_KEYWORDS.some((kw) => stderrLower.includes(kw));

      if (isAuthFailure) {
        store.addMessage(sessionId, {
          id: nextMessageId(),
          role: "assistant",
          content:
            "**Authentication failed.** Your Claude session may have expired.\n\n" +
            "To fix this, open a terminal and run:\n\n```\nclaude login\n```\n\n" +
            "Then start a new session in CodeMantis.",
          timestamp: now,
          activityIds: [],
          isStreaming: false,
          restartable: true,
        });
        showToast("Authentication failed — run 'claude login' in a terminal", "error", 12000);
      } else if (isRateLimit) {
        // Auto-retry with exponential backoff
        const retryState = store.sessionRetry.get(sessionId);
        const attempt = (retryState?.retryAttempt ?? 0) + 1;
        const delays = [30, 60, 120];
        const delaySec = delays[Math.min(attempt - 1, delays.length - 1)];

        store.addMessage(sessionId, {
          id: nextMessageId(),
          role: "assistant",
          content:
            `**Rate limited.** Retrying in ${delaySec}s (attempt ${attempt}/3)...\n\n` +
            `The API returned a rate limit error. Auto-retrying with exponential backoff.`,
          timestamp: now,
          activityIds: [],
          isStreaming: false,
          restartable: attempt >= 3,
        });
        showToast(`Rate limited — retrying in ${delaySec}s`, "info", delaySec * 1000);

        if (attempt <= 3) {
          const retryAt = Date.now() + delaySec * 1000;
          const timerId = setTimeout(() => {
            // Re-send the last user message
            const messages = store.sessionMessages.get(sessionId) ?? [];
            let lastUserPrompt = "";
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === "user") {
                lastUserPrompt = messages[i].content;
                break;
              }
            }
            store.clearRetry(sessionId);
            if (lastUserPrompt) {
              import("./tauri-commands").then(({ sendMessage }) => {
                store.setSessionBusy(sessionId, true);
                sendMessage(sessionId, lastUserPrompt).catch((e: unknown) => {
                  console.error("Rate limit retry failed:", e);
                  store.setSessionBusy(sessionId, false);
                });
              });
            }
          }, delaySec * 1000);

          store.setRetryState(sessionId, {
            isRetrying: true,
            retryAttempt: attempt,
            retryAt,
            retryTimerId: timerId,
          });
        }
      } else if (event.exit_code !== 0) {
        const stderrInfo = event.stderr_tail
          ? `\n\n**stderr:**\n\`\`\`\n${event.stderr_tail}\n\`\`\``
          : "";
        store.addMessage(sessionId, {
          id: nextMessageId(),
          role: "assistant",
          content:
            `**Process exited** with code ${event.exit_code ?? "unknown"} ` +
            `after ${Math.round(event.elapsed_ms / 1000)}s.${stderrInfo}`,
          timestamp: now,
          activityIds: [],
          isStreaming: false,
          restartable: true,
        });
      }
      // Clean exit (code 0): no message needed
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
      store.setRateLimitUtilization(sessionId, event.utilization);
      const pct = Math.round(event.utilization * 100);
      if (event.utilization >= 0.9) {
        showToast(`Rate limit ${pct}% utilized — requests may be throttled soon`, "error", 10000);
      } else if (event.utilization >= 0.7) {
        showToast(`Rate limit ${pct}% utilized`, "info", 6000);
      }
      break;
    }

    case "usage_update": {
      store.touchLastEvent(sessionId);
      // Per-API-call usage from assistant events — accumulate incrementally
      store.accumulateUsage(
        sessionId,
        event.usage.input_tokens ?? 0,
        event.usage.output_tokens ?? 0,
        event.usage.cache_creation_input_tokens ?? 0,
        event.usage.cache_read_input_tokens ?? 0,
      );
      // Real-time context update: each usage_update represents a single API
      // call, so the total tokens IS the context window size at that point.
      const callContext =
        (event.usage.input_tokens ?? 0) +
        (event.usage.cache_creation_input_tokens ?? 0) +
        (event.usage.cache_read_input_tokens ?? 0) +
        (event.usage.output_tokens ?? 0);
      if (callContext > 0) {
        store.updateContext(sessionId, callContext, 200000);
        checkContextThresholds(sessionId);
      }
      break;
    }

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

export function handleActivityEvent(sessionId: string, event: FrontendEvent): void {
  console.log("[activity-event]", sessionId, event.type, event);
  const activityStore = useActivityStore.getState();
  const sessionStore = useSessionStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "tool_use_start": {
      useSessionStore.getState().touchLastEvent(sessionId);
      // Track tool calls per turn for context estimation
      turnToolCallCount.set(sessionId, (turnToolCallCount.get(sessionId) ?? 0) + 1);

      // Track sub-agents when Agent tool starts
      if (event.tool_name === "Agent") {
        const agentInfo = extractSubAgentInfo(event.tool_use_id, event.tool_input, now);
        sessionStore.addSubAgent(sessionId, agentInfo);
      }

      // Update activity label to reflect what tool is running
      const filePath = (event.tool_input?.file_path as string) ?? null;
      const label = event.tool_name === "Agent"
        ? subAgentActivityLabel(sessionId)
        : toolActivityLabel(event.tool_name);
      sessionStore.setSessionActivity(sessionId, {
        label,
        toolName: event.tool_name,
        toolElapsed: 0,
        filePath,
      });

      // Mode-control tools: sync session mode and skip activity feed
      if (event.tool_name === "ExitPlanMode" || event.tool_name === "EnterPlanMode") {
        modeControlToolIds.add(event.tool_use_id);
        const newMode: SessionMode = event.tool_name === "EnterPlanMode" ? "plan" : "normal";
        sessionStore.setSessionMode(sessionId, newMode);
        import("./tauri-commands").then(({ syncSessionMode }) => {
          syncSessionMode(sessionId, newMode).catch(console.error);
        });
        return; // Don't add to activity feed — mode badge already reflects the change
      }

      // Check main session store first, then assistant store for the streaming messageId
      let currentMessageId = sessionStore.sessionStreaming.get(sessionId)?.currentMessageId;
      if (!currentMessageId) {
        currentMessageId = useAssistantStore.getState().streaming.get(sessionId)?.currentMessageId;
      }
      const entry: ActivityEntry = {
        id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolUseId: event.tool_use_id,
        toolName: event.tool_name,
        toolInput: event.tool_input,
        status: "running",
        timestamp: now,
        messageId: currentMessageId ?? "",
        isError: false,
        sessionId,
      };
      activityStore.addEntry(sessionId, entry);

      // Cache file content before Write/Edit runs (for diff view)
      if ((event.tool_name === "Write" || event.tool_name === "Edit") && event.tool_input?.file_path) {
        const editFilePath = event.tool_input.file_path as string;
        import("./tauri-commands").then(({ readFileContent }) => {
          readFileContent(editFilePath)
            .then((content) => preEditContentCache.set(event.tool_use_id, content))
            .catch(() => preEditContentCache.set(event.tool_use_id, "")); // new file
        });
      }
      break;
    }

    case "tool_progress": {
      useSessionStore.getState().touchLastEvent(sessionId);
      const currentActivity = sessionStore.sessionActivity.get(sessionId);

      // Update sub-agent elapsed time
      if (event.tool_name === "Agent") {
        sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
          elapsed: event.elapsed_seconds,
        });
      }

      const label = event.tool_name === "Agent"
        ? subAgentActivityLabel(sessionId)
        : toolActivityLabel(event.tool_name);
      sessionStore.setSessionActivity(sessionId, {
        label,
        toolName: event.tool_name,
        toolElapsed: event.elapsed_seconds,
        filePath: currentActivity?.filePath ?? null,
      });
      break;
    }

    case "tool_result": {
      // Mode-control tools were not added to the activity feed — skip their results
      if (modeControlToolIds.has(event.tool_use_id)) {
        modeControlToolIds.delete(event.tool_use_id);
        return;
      }

      // Check if a sub-agent just completed
      const completingAgents = sessionStore.activeSubAgents.get(sessionId);
      const completingAgent = completingAgents?.find((a) => a.toolUseId === event.tool_use_id);
      if (completingAgent) {
        // Capture final tool count on the Agent's activity entry before removing it
        if (completingAgent.toolCount != null && completingAgent.toolCount > 0) {
          activityStore.updateEntryExtra(sessionId, event.tool_use_id, {
            agentFinalToolCount: completingAgent.toolCount,
          });
        }
        sessionStore.completeSubAgent(sessionId, event.tool_use_id);
      }

      // If other agents are still running, keep the agent label
      const remainingAgents = sessionStore.activeSubAgents.get(sessionId);
      if (remainingAgents && remainingAgents.length > 0) {
        sessionStore.setSessionActivity(sessionId, {
          label: subAgentActivityLabel(sessionId),
          toolName: "Agent",
          toolElapsed: 0,
          filePath: null,
        });
      } else {
        sessionStore.setSessionActivity(sessionId, { label: "Thinking...", toolName: null, toolElapsed: 0, filePath: null });
      }
      activityStore.updateEntryStatus(
        sessionId,
        event.tool_use_id,
        event.is_error ? "error" : "done",
        event.content ?? undefined,
        event.is_error
      );

      // Refresh file tree after mutating tools complete
      if (!event.is_error) {
        const allEntries = activityStore.getActiveEntries(sessionId);
        const toolEntry = allEntries.find((e) => e.toolUseId === event.tool_use_id);
        if (toolEntry && MUTATING_TOOLS.has(toolEntry.toolName)) {
          useUiStore.getState().triggerFileTreeRefresh();
        }
      }

      // Auto-open file when Write or Edit tool completes successfully
      // Only auto-switch tab for the active session's project
      if (!event.is_error && useSettingsStore.getState().settings.autoOpenFiles) {
        const isActiveSession = sessionId === sessionStore.activeSessionId;
        const isMainSession = sessionStore.sessions.has(sessionId);
        const session = sessionStore.sessions.get(sessionId);
        const projectPath = session?.project_path;
        const entries = activityStore.getActiveEntries(sessionId);
        const entry = entries.find((e) => e.toolUseId === event.tool_use_id);
        if (entry && projectPath) {
          const toolName = entry.toolName;
          const filePath = entry.toolInput.file_path as string | undefined;
          if (filePath && (toolName === "Write" || toolName === "Edit")) {
            const fileName = filePath.split("/").pop() ?? filePath;
            const language = getLanguageFromPath(filePath);
            const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
            const cachedOldContent = preEditContentCache.get(event.tool_use_id);
            // Read the file content asynchronously for auto-open
            import("./tauri-commands").then(({ readFileContent }) => {
              readFileContent(filePath).then((content) => {
                const hasDiffData = cachedOldContent !== undefined;
                useFileViewerStore.getState().openFile(projectPath, {
                  filePath,
                  fileName,
                  language,
                  extension,
                  fileSize: new Blob([content]).size,
                  content,
                  isDiff: hasDiffData,
                  oldContent: hasDiffData ? cachedOldContent : undefined,
                  newContent: hasDiffData ? content : undefined,
                });
                if (isMainSession && isActiveSession) {
                  useUiStore.getState().setRightTab("files");
                }
              }).catch(() => {
                // File may not exist yet or be unreadable — ignore
              });
            });
          }
        }
      }
      // Cleanup pre-edit cache for this tool call
      preEditContentCache.delete(event.tool_use_id);
      break;
    }

    case "subagent_started": {
      // Phase 2: CLI emitted task_started — update agent info if not already tracked
      const existing = sessionStore.activeSubAgents.get(sessionId);
      const alreadyTracked = existing?.some((a) => a.toolUseId === event.tool_use_id);
      if (!alreadyTracked) {
        sessionStore.addSubAgent(sessionId, {
          toolUseId: event.tool_use_id,
          description: event.description,
          subagentType: event.subagent_type,
          isBackground: false,
          startedAt: now,
          elapsed: 0,
          status: "running",
        });
      }
      sessionStore.setSessionActivity(sessionId, {
        label: subAgentActivityLabel(sessionId),
        toolName: "Agent",
        toolElapsed: 0,
        filePath: null,
      });
      break;
    }

    case "subagent_progress": {
      sessionStore.touchLastEvent(sessionId);
      sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
        toolCount: event.tool_count ?? undefined,
        tokenCount: event.token_count ?? undefined,
        currentActivity: event.current_activity ?? undefined,
      });
      sessionStore.setSessionActivity(sessionId, {
        label: subAgentActivityLabel(sessionId),
        toolName: "Agent",
        toolElapsed: 0,
        filePath: null,
      });
      break;
    }

    case "subagent_complete": {
      sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
        status: "done",
        toolCount: event.tool_count ?? undefined,
        tokenCount: event.token_count ?? undefined,
      });
      break;
    }
  }
}

function checkContextThresholds(sessionId: string): void {
  const store = useSessionStore.getState();
  const ctx = store.sessionContext.get(sessionId);
  if (!ctx || ctx.max === 0) return;

  const pct = ctx.used / ctx.max;
  const fired = store.contextToastFired.get(sessionId) ?? new Set();

  if (pct >= 0.95 && !fired.has(95)) {
    store.markContextToastFired(sessionId, 95);
    showToast(
      "Context window is 95% full. Run /compact to free space before the session stalls.",
      "error",
      15000
    );
  } else if (pct >= 0.80 && !fired.has(80)) {
    store.markContextToastFired(sessionId, 80);
    showToast(
      "Context window is 80% full. Consider running /compact to free space.",
      "info",
      10000
    );
  }
}

// ── Stale connection detection (progressive) ──
// Monitors for silent sessions and provides escalating feedback.
// Thresholds: 120s (first warning), 300s (second), 600s (third with action).
const staleTimers = new Map<string, ReturnType<typeof setInterval>>();
const staleWarningCount = new Map<string, number>();

export function startStaleDetection(sessionId: string): void {
  stopStaleDetection(sessionId);
  const store = useSessionStore.getState();
  store.touchLastEvent(sessionId);
  staleWarningCount.set(sessionId, 0);

  const timer = setInterval(async () => {
    const s = useSessionStore.getState();
    const isBusy = s.sessionBusy.get(sessionId) ?? false;
    if (!isBusy) {
      staleWarningCount.set(sessionId, 0);
      return;
    }

    const lastTs = s.lastEventTimestamp.get(sessionId) ?? 0;
    const elapsed = Date.now() - lastTs;

    // Only check if truly silent for >120s and not streaming text
    if (elapsed <= 120_000) return;
    const streaming = s.sessionStreaming.get(sessionId);
    if (streaming?.isStreaming) return;

    // Check if the process is actually still alive
    try {
      const { checkProcessAlive } = await import("./tauri-commands");
      const alive = await checkProcessAlive(sessionId);

      if (!alive) {
        const now = new Date().toISOString();
        s.setSessionBusy(sessionId, false);
        if (s.sessionStreaming.get(sessionId)?.isStreaming) {
          s.finalizeStreaming(sessionId);
        }
        s.addMessage(sessionId, {
          id: `recovered-${Date.now()}`,
          role: "assistant",
          content:
            "**Session ended.** The Claude Code process exited without a completion signal.\n\n" +
            "Your work is saved. You can send a new message to continue.",
          timestamp: now,
          activityIds: [],
          isStreaming: false,
          restartable: true,
        });
        showToast("Session recovered — process had ended", "info", 6000);
        staleWarningCount.set(sessionId, 0);
        return;
      }
    } catch (e) {
      console.error("[stale-detection] Failed to check process health:", e);
    }

    // Process is alive — progressive warnings
    const count = (staleWarningCount.get(sessionId) ?? 0) + 1;
    staleWarningCount.set(sessionId, count);

    const elapsedMin = Math.round(elapsed / 60_000);
    if (count === 1) {
      showToast(`No events for ${elapsedMin}m — Claude may be working on a complex task`, "info", 10000);
    } else if (count === 2) {
      showToast(`Still no events after ${elapsedMin}m — process is alive, likely deep in analysis`, "info", 10000);
    } else if (count % 3 === 0) {
      // Every 3rd check (~45s intervals after first), remind the user
      showToast(`No events for ${elapsedMin}m — process still running`, "info", 8000);
    }

    // Don't reset timestamp — let elapsed accumulate for accurate reporting
  }, 15_000);

  staleTimers.set(sessionId, timer);
}

export function stopStaleDetection(sessionId: string): void {
  const timer = staleTimers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    staleTimers.delete(sessionId);
  }
}

function maybeGenerateChangelog(sessionId: string): void {
  const settings = useSettingsStore.getState().settings;
  if (!settings.changelogEnabled) return;

  const activityEntries = useActivityStore.getState().getActiveEntries(sessionId);
  const messages = useSessionStore.getState().sessionMessages.get(sessionId) ?? [];

  // Check if any mutating tools were used in this turn
  const hasMutatingTool = activityEntries.some((e) => MUTATING_TOOLS.has(e.toolName));
  if (!hasMutatingTool) return;

  // Get the last user prompt
  let userPrompt = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userPrompt = messages[i].content.slice(0, 200);
      break;
    }
  }

  // Get last assistant message text
  let assistantSummary = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].content.length > 50) {
      assistantSummary = messages[i].content.slice(0, 300);
      break;
    }
  }
  if (!assistantSummary) return;

  // Collect tool operations as "ToolName: file_path" strings
  const toolsUsed = activityEntries
    .filter((e) => MUTATING_TOOLS.has(e.toolName))
    .map((e) => {
      const filePath = (e.toolInput?.file_path as string) ?? (e.toolInput?.command as string) ?? "";
      return `${e.toolName}: ${filePath}`.slice(0, 100);
    });

  // Get current session mode (normal, auto-accept, plan)
  const sessionMode = useSessionStore.getState().sessionModes.get(sessionId) ?? "normal";

  // Fire and forget — non-blocking
  const changelogStore = useChangelogStore.getState();
  changelogStore.setGenerating(sessionId, true);

  import("./tauri-commands").then(({ generateChangelogEntry }) => {
    generateChangelogEntry(sessionId, userPrompt, assistantSummary, toolsUsed, sessionMode)
      .then((entry) => {
        useChangelogStore.getState().addEntry(sessionId, entry);
      })
      .catch((e) => {
        console.error("Failed to generate changelog entry:", e);
      })
      .finally(() => {
        useChangelogStore.getState().setGenerating(sessionId, false);
      });
  });
}

