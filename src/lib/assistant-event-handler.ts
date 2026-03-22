import type { FrontendEvent } from "../types/claude-events";
import { useAssistantStore } from "../stores/assistantStore";
import { translateError } from "./error-messages";

let messageCounter = 0;

function nextAssistantMessageId(): string {
  return `asst-msg-${++messageCounter}`;
}

// Streaming buffer for assistant (same approach as main event-classifier)
const streamingBuffers = new Map<string, string>();
const pendingFrames = new Map<string, number>();

function flushBuffer(sessionId: string): void {
  const buffered = streamingBuffers.get(sessionId);
  if (buffered) {
    useAssistantStore.getState().appendStreamingContent(sessionId, buffered);
    streamingBuffers.set(sessionId, "");
  }
  pendingFrames.delete(sessionId);
}

function bufferText(sessionId: string, text: string): void {
  const current = streamingBuffers.get(sessionId) ?? "";
  streamingBuffers.set(sessionId, current + text);

  if (typeof requestAnimationFrame === "function") {
    if (!pendingFrames.has(sessionId)) {
      const frame = requestAnimationFrame(() => flushBuffer(sessionId));
      pendingFrames.set(sessionId, frame);
    }
  } else {
    flushBuffer(sessionId);
  }
}

export function handleAssistantChatEvent(sessionId: string, event: FrontendEvent): void {
  const store = useAssistantStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "session_init":
      break;

    case "cli_session_id":
      store.setCliSessionId(sessionId, event.cli_session_id);
      break;

    case "text_delta": {
      const streaming = store.streaming.get(sessionId);
      if (!streaming?.isStreaming) {
        const msgId = nextAssistantMessageId();
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
      bufferText(sessionId, event.text);
      break;
    }

    case "text_complete": {
      const pendingFrame = pendingFrames.get(sessionId);
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      flushBuffer(sessionId);

      const streaming = store.streaming.get(sessionId);
      if (!streaming?.isStreaming) {
        const msgId = nextAssistantMessageId();
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
      store.setBusy(sessionId, false);
      const turnFrame = pendingFrames.get(sessionId);
      if (turnFrame) cancelAnimationFrame(turnFrame);
      flushBuffer(sessionId);

      const streaming = store.streaming.get(sessionId);
      if (streaming?.isStreaming) {
        store.finalizeStreaming(sessionId);
      }
      break;
    }

    case "process_error": {
      store.setBusy(sessionId, false);
      const streaming = store.streaming.get(sessionId);
      if (streaming?.isStreaming) {
        store.finalizeStreaming(sessionId);
      }
      const errorMsgId = nextAssistantMessageId();
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
      const wasBusy = store.busy.get(sessionId) ?? false;
      const wasStreaming = store.streaming.get(sessionId)?.isStreaming ?? false;

      if (wasBusy || wasStreaming) {
        console.warn("[assistant:process_exited] Session still busy/streaming — recovering:", sessionId);
        store.setBusy(sessionId, false);
        const exitFrame = pendingFrames.get(sessionId);
        if (exitFrame) cancelAnimationFrame(exitFrame);
        flushBuffer(sessionId);
        if (wasStreaming) {
          store.finalizeStreaming(sessionId);
        }
      }

      // Non-zero exit: add a user-friendly error so the user knows what happened
      if (event.exit_code !== 0) {
        const stderrSummary = event.stderr_tail ?? "";
        const userError = translateError(
          stderrSummary || `Process exited with code ${event.exit_code}`
        );
        const stderrBlock = event.stderr_tail
          ? `\n\n**Details:**\n\`\`\`\n${event.stderr_tail}\n\`\`\``
          : "";
        store.addMessage(sessionId, {
          id: nextAssistantMessageId(),
          role: "assistant",
          content:
            `**${userError.title}**\n\n${userError.message}` +
            (userError.remediation ? `\n\n**How to fix:** ${userError.remediation}` : "") +
            stderrBlock,
          timestamp: now,
          activityIds: [],
          isStreaming: false,
        });
      }
      break;
    }
  }
}

/** Clean up streaming buffers for an assistant session (cancel pending RAF frames, delete entries). */
export function cleanupAssistantBuffers(sessionId: string): void {
  const frame = pendingFrames.get(sessionId);
  if (frame) cancelAnimationFrame(frame);
  pendingFrames.delete(sessionId);
  streamingBuffers.delete(sessionId);
}
