import type { FrontendEvent } from "../types/claude-events";
import type { ActivityEntry } from "../types/activity";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { useFileViewerStore, getLanguageFromPath } from "../stores/fileViewerStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useChangelogStore } from "../stores/changelogStore";
import { useAssistantStore } from "../stores/assistantStore";

// Tools that indicate actual changes were made (not just reads)
const MUTATING_TOOLS = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);

let messageCounter = 0;

// Track tool calls per turn for context window estimation.
// The CLI result event aggregates usage across all API calls in a turn
// (each tool use triggers a new API call), so we divide by call count
// to estimate the actual context window usage.
const turnToolCallCount = new Map<string, number>();

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
        // Context window estimation:
        // input_tokens = non-cached input only; cache_creation and cache_read
        // are SEPARATE categories (not subsets). Total input sent to the model
        // = input_tokens + cache_creation + cache_read.
        //
        // The result event aggregates usage across ALL API calls in a turn
        // (each tool use triggers a new call). Divide by call count to
        // estimate the per-call context, which reflects actual window usage.
        const totalInput =
          (event.usage.input_tokens ?? 0) +
          (event.usage.cache_creation_input_tokens ?? 0) +
          (event.usage.cache_read_input_tokens ?? 0);
        const totalOutput = event.usage.output_tokens ?? 0;

        const toolCalls = turnToolCallCount.get(sessionId) ?? 0;
        const apiCalls = Math.max(toolCalls, 1);
        const estimatedContext = Math.round((totalInput + totalOutput) / apiCalls);
        store.updateContext(sessionId, estimatedContext, 200000);
      }
      // Reset tool call counter for next turn
      turnToolCallCount.delete(sessionId);

      // Attach turn stats to the completed assistant message
      const targetMsgId = completedMessageId ?? (() => {
        const msgs = store.sessionMessages.get(sessionId) ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === "assistant") return msgs[i].id;
        }
        return null;
      })();

      if (targetMsgId) {
        store.setTurnStats(sessionId, targetMsgId, {
          durationMs: event.duration_ms,
          costUsd: event.cost_usd,
          inputTokens: event.usage?.input_tokens ?? 0,
          outputTokens: event.usage?.output_tokens ?? 0,
          cacheCreationTokens: event.usage?.cache_creation_input_tokens ?? 0,
          cacheReadTokens: event.usage?.cache_read_input_tokens ?? 0,
        });
      }

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
  }
}

export function handleActivityEvent(sessionId: string, event: FrontendEvent): void {
  console.log("[activity-event]", sessionId, event.type, event);
  const activityStore = useActivityStore.getState();
  const sessionStore = useSessionStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "tool_use_start": {
      // Track tool calls per turn for context estimation
      turnToolCallCount.set(sessionId, (turnToolCallCount.get(sessionId) ?? 0) + 1);

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
      break;
    }

    case "tool_result": {
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
      // Only auto-switch tab for main sessions, not assistant sessions
      if (!event.is_error) {
        const isMainSession = sessionStore.sessions.has(sessionId);
        const entries = activityStore.getActiveEntries(sessionId);
        const entry = entries.find((e) => e.toolUseId === event.tool_use_id);
        if (entry) {
          const toolName = entry.toolName;
          const filePath = entry.toolInput.file_path as string | undefined;
          if (filePath && (toolName === "Write" || toolName === "Edit")) {
            const fileName = filePath.split("/").pop() ?? filePath;
            const language = getLanguageFromPath(filePath);
            const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
            // Read the file content asynchronously for auto-open
            import("./tauri-commands").then(({ readFileContent }) => {
              readFileContent(filePath).then((content) => {
                useFileViewerStore.getState().openFile({
                  filePath,
                  fileName,
                  language,
                  extension,
                  fileSize: new Blob([content]).size,
                  content,
                  isDiff: false,
                });
                if (isMainSession) {
                  useUiStore.getState().setRightTab("files");
                }
              }).catch(() => {
                // File may not exist yet or be unreadable — ignore
              });
            });
          }
        }
      }
      break;
    }
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

