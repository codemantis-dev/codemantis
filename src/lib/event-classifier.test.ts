import { describe, it, expect, beforeEach } from "vitest";
import {
  handleChatEvent,
  handleActivityEvent,
  handleApprovalEvent,
} from "./event-classifier";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";

describe("event-classifier", () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: {
        id: "s1",
        name: "Test",
        project_path: "/tmp",
        status: "connected",
        created_at: "",
        model: null,
      },
      messages: [],
      isStreaming: false,
      streamingContent: "",
      currentMessageId: null,
    });
    useActivityStore.setState({
      entries: [],
      pendingApproval: null,
    });
    useUiStore.setState({
      sidebarWidth: 220,
      rightPanelWidth: 360,
      rightTab: "activity",
      showApprovalModal: false,
    });
  });

  describe("handleChatEvent", () => {
    it("session_init updates model", () => {
      handleChatEvent({
        type: "session_init",
        session_id: "s1",
        model: "claude-sonnet-4-20250514",
      });
      expect(useSessionStore.getState().session?.model).toBe(
        "claude-sonnet-4-20250514"
      );
    });

    it("session_init with null model does not crash", () => {
      handleChatEvent({
        type: "session_init",
        session_id: "s1",
        model: null,
      });
      expect(useSessionStore.getState().session?.model).toBeNull();
    });

    it("text_delta starts streaming on first delta", () => {
      handleChatEvent({
        type: "text_delta",
        session_id: "s1",
        text: "Hello",
      });

      const state = useSessionStore.getState();
      expect(state.isStreaming).toBe(true);
      expect(state.streamingContent).toBe("Hello");
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe("assistant");
      expect(state.messages[0].isStreaming).toBe(true);
    });

    it("text_delta accumulates on subsequent deltas", () => {
      handleChatEvent({ type: "text_delta", session_id: "s1", text: "Hello" });
      handleChatEvent({
        type: "text_delta",
        session_id: "s1",
        text: " world",
      });

      const state = useSessionStore.getState();
      expect(state.streamingContent).toBe("Hello world");
      // Should NOT add another message
      expect(state.messages).toHaveLength(1);
    });

    it("text_complete without streaming creates standalone message", () => {
      handleChatEvent({
        type: "text_complete",
        session_id: "s1",
        full_text: "Complete response",
      });

      const state = useSessionStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toBe("Complete response");
      expect(state.messages[0].isStreaming).toBe(false);
    });

    it("text_complete during streaming finalizes message", () => {
      handleChatEvent({ type: "text_delta", session_id: "s1", text: "Hi" });
      handleChatEvent({
        type: "text_complete",
        session_id: "s1",
        full_text: "Hi there!",
      });

      const state = useSessionStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toBe("Hi there!");
      expect(state.messages[0].isStreaming).toBe(false);
    });

    it("turn_complete finalizes streaming", () => {
      handleChatEvent({ type: "text_delta", session_id: "s1", text: "Done" });
      handleChatEvent({
        type: "turn_complete",
        session_id: "s1",
        duration_ms: 1000,
        usage: null,
        cost_usd: null,
      });

      expect(useSessionStore.getState().isStreaming).toBe(false);
    });

    it("turn_complete without streaming is safe", () => {
      handleChatEvent({
        type: "turn_complete",
        session_id: "s1",
        duration_ms: null,
        usage: null,
        cost_usd: null,
      });
      expect(useSessionStore.getState().isStreaming).toBe(false);
    });

    it("process_error adds error message", () => {
      handleChatEvent({
        type: "process_error",
        session_id: "s1",
        error: "Rate limit exceeded",
      });

      const msgs = useSessionStore.getState().messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toContain("Rate limit exceeded");
      expect(msgs[0].role).toBe("assistant");
    });

    it("process_error during streaming finalizes then adds error", () => {
      handleChatEvent({ type: "text_delta", session_id: "s1", text: "partial" });
      handleChatEvent({
        type: "process_error",
        session_id: "s1",
        error: "Connection lost",
      });

      const state = useSessionStore.getState();
      expect(state.isStreaming).toBe(false);
      // The streaming message + the error message
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1].content).toContain("Connection lost");
    });
  });

  describe("handleActivityEvent", () => {
    it("tool_use_start adds activity entry", () => {
      handleActivityEvent({
        type: "tool_use_start",
        session_id: "s1",
        tool_use_id: "t1",
        tool_name: "Read",
        tool_input: { file_path: "src/main.rs" },
      });

      const entries = useActivityStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].toolName).toBe("Read");
      expect(entries[0].status).toBe("running");
      expect(entries[0].toolInput).toEqual({ file_path: "src/main.rs" });
    });

    it("tool_result updates entry to done", () => {
      handleActivityEvent({
        type: "tool_use_start",
        session_id: "s1",
        tool_use_id: "t1",
        tool_name: "Read",
        tool_input: {},
      });
      handleActivityEvent({
        type: "tool_result",
        session_id: "s1",
        tool_use_id: "t1",
        content: "186 lines",
        is_error: false,
      });

      const entry = useActivityStore.getState().entries[0];
      expect(entry.status).toBe("done");
      expect(entry.result).toBe("186 lines");
      expect(entry.isError).toBe(false);
    });

    it("tool_result with error marks entry as error", () => {
      handleActivityEvent({
        type: "tool_use_start",
        session_id: "s1",
        tool_use_id: "t1",
        tool_name: "Bash",
        tool_input: {},
      });
      handleActivityEvent({
        type: "tool_result",
        session_id: "s1",
        tool_use_id: "t1",
        content: "command not found",
        is_error: true,
      });

      const entry = useActivityStore.getState().entries[0];
      expect(entry.status).toBe("error");
      expect(entry.isError).toBe(true);
    });

    it("tool_result with null content is handled", () => {
      handleActivityEvent({
        type: "tool_use_start",
        session_id: "s1",
        tool_use_id: "t1",
        tool_name: "Write",
        tool_input: {},
      });
      handleActivityEvent({
        type: "tool_result",
        session_id: "s1",
        tool_use_id: "t1",
        content: null,
        is_error: false,
      });

      const entry = useActivityStore.getState().entries[0];
      expect(entry.status).toBe("done");
      expect(entry.result).toBeUndefined();
    });
  });

  describe("handleApprovalEvent", () => {
    it("tool_use_start sets pending approval and shows modal", () => {
      handleApprovalEvent({
        type: "tool_use_start",
        session_id: "s1",
        tool_use_id: "t1",
        tool_name: "Bash",
        tool_input: { command: "npm install" },
      });

      const approval = useActivityStore.getState().pendingApproval;
      expect(approval).not.toBeNull();
      expect(approval?.toolName).toBe("Bash");
      expect(approval?.toolInput).toEqual({ command: "npm install" });
      expect(useUiStore.getState().showApprovalModal).toBe(true);
    });

    it("non tool_use_start events are ignored", () => {
      handleApprovalEvent({
        type: "tool_result",
        session_id: "s1",
        tool_use_id: "t1",
        content: null,
        is_error: false,
      });

      expect(useActivityStore.getState().pendingApproval).toBeNull();
      expect(useUiStore.getState().showApprovalModal).toBe(false);
    });
  });
});
