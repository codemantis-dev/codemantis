import type { FrontendEvent } from "../types/claude-events";
import type { ActivityEntry } from "../types/activity";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";

let messageCounter = 0;

function nextMessageId(): string {
  return `msg-${++messageCounter}`;
}

export function handleChatEvent(event: FrontendEvent): void {
  console.log("[chat-event]", event.type, event);
  const sessionStore = useSessionStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "session_init":
      if (event.model) {
        sessionStore.updateModel(event.model);
      }
      break;

    case "text_delta":
      if (!sessionStore.isStreaming) {
        const msgId = nextMessageId();
        sessionStore.addMessage({
          id: msgId,
          role: "assistant",
          content: "",
          timestamp: now,
          activityIds: [],
          isStreaming: true,
        });
        sessionStore.startStreaming(msgId);
      }
      sessionStore.appendStreamingContent(event.text);
      break;

    case "text_complete":
      if (!sessionStore.isStreaming) {
        const msgId = nextMessageId();
        sessionStore.addMessage({
          id: msgId,
          role: "assistant",
          content: event.full_text,
          timestamp: now,
          activityIds: [],
          isStreaming: false,
        });
      } else {
        sessionStore.finalizeStreaming(event.full_text);
      }
      break;

    case "turn_complete":
      if (sessionStore.isStreaming) {
        sessionStore.finalizeStreaming();
      }
      break;

    case "process_error": {
      if (sessionStore.isStreaming) {
        sessionStore.finalizeStreaming();
      }
      const errorMsgId = nextMessageId();
      sessionStore.addMessage({
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

export function handleActivityEvent(event: FrontendEvent): void {
  console.log("[activity-event]", event.type, event);
  const activityStore = useActivityStore.getState();
  const sessionStore = useSessionStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "tool_use_start": {
      const entry: ActivityEntry = {
        id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolUseId: event.tool_use_id,
        toolName: event.tool_name,
        toolInput: event.tool_input,
        status: "running",
        timestamp: now,
        messageId: sessionStore.currentMessageId ?? "",
        isError: false,
      };
      activityStore.addEntry(entry);
      break;
    }

    case "tool_result": {
      activityStore.updateEntryStatus(
        event.tool_use_id,
        event.is_error ? "error" : "done",
        event.content ?? undefined,
        event.is_error
      );
      break;
    }
  }
}

export function handleApprovalEvent(event: FrontendEvent): void {
  console.log("[approval-event]", event.type, event);
  if (event.type === "tool_use_start") {
    const activityStore = useActivityStore.getState();
    const uiStore = useUiStore.getState();

    activityStore.setPendingApproval({
      toolUseId: event.tool_use_id,
      toolName: event.tool_name,
      toolInput: event.tool_input,
    });
    uiStore.setShowApprovalModal(true);
  }
}
