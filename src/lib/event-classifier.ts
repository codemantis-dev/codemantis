import type { FrontendEvent } from "../types/claude-events";
import type { ActivityEntry } from "../types/activity";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { useFileViewerStore, getLanguageFromPath } from "../stores/fileViewerStore";

let messageCounter = 0;

function nextMessageId(): string {
  return `msg-${++messageCounter}`;
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
      store.appendStreamingContent(sessionId, event.text);
      break;
    }

    case "text_complete": {
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
      const streaming = store.sessionStreaming.get(sessionId);
      if (streaming?.isStreaming) {
        store.finalizeStreaming(sessionId);
      }
      if (event.usage) {
        const currentCtx = store.sessionContext.get(sessionId) ?? { used: 0, max: 200000 };
        const used =
          (event.usage.input_tokens ?? 0) +
          (event.usage.output_tokens ?? 0) +
          (event.usage.cache_creation_input_tokens ?? 0) +
          (event.usage.cache_read_input_tokens ?? 0);
        store.updateContext(sessionId, currentCtx.used + used, currentCtx.max);
      }
      break;
    }

    case "process_error": {
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
      const streaming = sessionStore.sessionStreaming.get(sessionId);
      const entry: ActivityEntry = {
        id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolUseId: event.tool_use_id,
        toolName: event.tool_name,
        toolInput: event.tool_input,
        status: "running",
        timestamp: now,
        messageId: streaming?.currentMessageId ?? "",
        isError: false,
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

      // Auto-open file when Write or Edit tool completes successfully
      if (!event.is_error) {
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
                useFileViewerStore.getState().setOpenFile({
                  filePath,
                  fileName,
                  language,
                  extension,
                  fileSize: new Blob([content]).size,
                  content,
                  isDiff: false,
                });
                useUiStore.getState().setRightTab("files");
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

export function handleApprovalEvent(sessionId: string, event: FrontendEvent): void {
  console.log("[approval-event]", sessionId, event.type, event);
  if (event.type === "tool_use_start") {
    const activityStore = useActivityStore.getState();
    const uiStore = useUiStore.getState();

    // Auto-approve if user previously clicked "Always allow" for this tool
    if (activityStore.isToolAlwaysAllowed(event.tool_name)) {
      console.log("[approval] Auto-approving always-allowed tool:", event.tool_name);
      import("./tauri-commands").then(({ respondToApproval }) => {
        respondToApproval(sessionId, event.tool_use_id, true).catch((e) =>
          console.error("Failed to auto-approve tool:", e)
        );
      });
      return;
    }

    activityStore.setPendingApproval(sessionId, {
      toolUseId: event.tool_use_id,
      toolName: event.tool_name,
      toolInput: event.tool_input,
    });
    uiStore.setShowApprovalModal(true);
  }
}
