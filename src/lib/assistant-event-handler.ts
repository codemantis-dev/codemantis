import type { FrontendEvent } from "../types/claude-events";
import { useAssistantStore } from "../stores/assistantStore";

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
  console.log("[assistant-chat]", sessionId, event.type);
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
  }
}
