import { describe, it, expect, beforeEach } from "vitest";
import {
  handleChatEvent,
  handleActivityEvent,
  handleApprovalEvent,
  flushStreamingBuffer,
} from "./event-classifier";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";

const SESSION_ID = "s1";

function resetStores(): void {
  const session = {
    id: SESSION_ID,
    name: "Test",
    project_path: "/tmp",
    status: "connected" as const,
    created_at: "",
    model: null,
    icon_index: 0,
  };

  useSessionStore.setState({
    sessions: new Map([[SESSION_ID, session]]),
    activeSessionId: SESSION_ID,
    sessionMessages: new Map([[SESSION_ID, []]]),
    sessionStreaming: new Map([[SESSION_ID, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
    sessionContext: new Map([[SESSION_ID, { used: 0, max: 200000 }]]),
    tabOrder: [SESSION_ID],
  });

  useActivityStore.setState({
    sessionEntries: new Map([[SESSION_ID, []]]),
    sessionApprovals: new Map([[SESSION_ID, null]]),
    alwaysAllowedTools: new Set(),
  });

  useUiStore.setState({
    sidebarWidth: 220,
    rightPanelWidth: 360,
    rightTab: "activity",
    showApprovalModal: false,
    showSettingsModal: false,
    showProjectPicker: false,
  });
}

describe("event-classifier", () => {
  beforeEach(resetStores);

  describe("handleChatEvent", () => {
    it("session_init updates model", () => {
      handleChatEvent(SESSION_ID, {
        type: "session_init",
        session_id: SESSION_ID,
        model: "claude-sonnet-4-20250514",
      });
      expect(useSessionStore.getState().sessions.get(SESSION_ID)?.model).toBe("claude-sonnet-4-20250514");
    });

    it("session_init with null model does not crash", () => {
      handleChatEvent(SESSION_ID, {
        type: "session_init",
        session_id: SESSION_ID,
        model: null,
      });
      expect(useSessionStore.getState().sessions.get(SESSION_ID)?.model).toBeNull();
    });

    it("text_delta starts streaming on first delta", () => {
      handleChatEvent(SESSION_ID, {
        type: "text_delta",
        session_id: SESSION_ID,
        text: "Hello",
      });
      flushStreamingBuffer(SESSION_ID);

      const streaming = useSessionStore.getState().sessionStreaming.get(SESSION_ID);
      expect(streaming?.isStreaming).toBe(true);
      expect(streaming?.streamingContent).toBe("Hello");
      const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("assistant");
      expect(msgs[0].isStreaming).toBe(true);
    });

    it("text_delta accumulates on subsequent deltas", () => {
      handleChatEvent(SESSION_ID, { type: "text_delta", session_id: SESSION_ID, text: "Hello" });
      handleChatEvent(SESSION_ID, { type: "text_delta", session_id: SESSION_ID, text: " world" });
      flushStreamingBuffer(SESSION_ID);

      const streaming = useSessionStore.getState().sessionStreaming.get(SESSION_ID);
      expect(streaming?.streamingContent).toBe("Hello world");
      const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
      expect(msgs).toHaveLength(1);
    });

    it("text_complete without streaming creates standalone message", () => {
      handleChatEvent(SESSION_ID, {
        type: "text_complete",
        session_id: SESSION_ID,
        full_text: "Complete response",
      });

      const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Complete response");
      expect(msgs[0].isStreaming).toBe(false);
    });

    it("text_complete during streaming finalizes message", () => {
      handleChatEvent(SESSION_ID, { type: "text_delta", session_id: SESSION_ID, text: "Hi" });
      handleChatEvent(SESSION_ID, {
        type: "text_complete",
        session_id: SESSION_ID,
        full_text: "Hi there!",
      });

      const streaming = useSessionStore.getState().sessionStreaming.get(SESSION_ID);
      expect(streaming?.isStreaming).toBe(false);
      const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Hi there!");
      expect(msgs[0].isStreaming).toBe(false);
    });

    it("turn_complete finalizes streaming", () => {
      handleChatEvent(SESSION_ID, { type: "text_delta", session_id: SESSION_ID, text: "Done" });
      handleChatEvent(SESSION_ID, {
        type: "turn_complete",
        session_id: SESSION_ID,
        duration_ms: 1000,
        usage: null,
        cost_usd: null,
      });

      expect(useSessionStore.getState().sessionStreaming.get(SESSION_ID)?.isStreaming).toBe(false);
    });

    it("turn_complete without streaming is safe", () => {
      handleChatEvent(SESSION_ID, {
        type: "turn_complete",
        session_id: SESSION_ID,
        duration_ms: null,
        usage: null,
        cost_usd: null,
      });
      expect(useSessionStore.getState().sessionStreaming.get(SESSION_ID)?.isStreaming).toBe(false);
    });

    it("process_error adds error message", () => {
      handleChatEvent(SESSION_ID, {
        type: "process_error",
        session_id: SESSION_ID,
        error: "Rate limit exceeded",
      });

      const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toContain("Rate limit exceeded");
    });

    it("process_error during streaming finalizes then adds error", () => {
      handleChatEvent(SESSION_ID, { type: "text_delta", session_id: SESSION_ID, text: "partial" });
      handleChatEvent(SESSION_ID, {
        type: "process_error",
        session_id: SESSION_ID,
        error: "Connection lost",
      });

      const streaming = useSessionStore.getState().sessionStreaming.get(SESSION_ID);
      expect(streaming?.isStreaming).toBe(false);
      const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
      expect(msgs).toHaveLength(2);
      expect(msgs[1].content).toContain("Connection lost");
    });
  });

  describe("handleActivityEvent", () => {
    it("tool_use_start adds activity entry", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        tool_name: "Read",
        tool_input: { file_path: "src/main.rs" },
      });

      const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
      expect(entries).toHaveLength(1);
      expect(entries[0].toolName).toBe("Read");
      expect(entries[0].status).toBe("running");
    });

    it("tool_result updates entry to done", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        tool_name: "Read",
        tool_input: {},
      });
      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        content: "186 lines",
        is_error: false,
      });

      const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
      expect(entry.status).toBe("done");
      expect(entry.result).toBe("186 lines");
    });

    it("tool_result with error marks entry as error", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        tool_name: "Bash",
        tool_input: {},
      });
      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        content: "command not found",
        is_error: true,
      });

      const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
      expect(entry.status).toBe("error");
      expect(entry.isError).toBe(true);
    });
  });

  describe("handleApprovalEvent", () => {
    it("tool_use_start sets pending approval and shows modal", () => {
      handleApprovalEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        tool_name: "Bash",
        tool_input: { command: "npm install" },
      });

      const approval = useActivityStore.getState().getActivePendingApproval(SESSION_ID);
      expect(approval).not.toBeNull();
      expect(approval?.toolName).toBe("Bash");
      expect(useUiStore.getState().showApprovalModal).toBe(true);
    });

    it("non tool_use_start events are ignored", () => {
      handleApprovalEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        content: null,
        is_error: false,
      });

      expect(useActivityStore.getState().getActivePendingApproval(SESSION_ID)).toBeNull();
      expect(useUiStore.getState().showApprovalModal).toBe(false);
    });
  });
});
