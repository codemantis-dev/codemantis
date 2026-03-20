import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleChatEvent,
  handleActivityEvent,
  flushStreamingBuffer,
} from "./event-classifier";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";

// Mock tauri-commands so dynamic imports inside event-classifier resolve
vi.mock("./tauri-commands", () => ({
  readFileContent: vi.fn(() => Promise.resolve("")),
  syncSessionMode: vi.fn(() => Promise.resolve()),
}));

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
    sessionContext: new Map([[SESSION_ID, { used: 0, max: 1000000 }]]),
    sessionModes: new Map([[SESSION_ID, "normal"]]),
    tabOrder: [SESSION_ID],
  });

  useActivityStore.setState({
    sessionEntries: new Map([[SESSION_ID, []]]),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
    alwaysAllowedTools: new Map(),
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

    it("turn_complete updates context with all token types (non-cached + cached)", () => {
      handleChatEvent(SESSION_ID, {
        type: "turn_complete",
        session_id: SESSION_ID,
        duration_ms: 5000,
        usage: {
          input_tokens: 5000,
          output_tokens: 2000,
          cache_creation_input_tokens: 10000,
          cache_read_input_tokens: 150000,
        },
        cost_usd: 1.5,
      });

      const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
      // Total = (5000 + 10000 + 150000 + 2000) / 1 api call = 167000
      expect(ctx?.used).toBe(167000);
      expect(ctx?.max).toBe(1000000);
    });

    it("turn_complete divides by api call count when tool calls occurred", () => {
      // Simulate 3 tool calls during the turn
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        tool_name: "Read",
        tool_input: {},
      });
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t2",
        tool_name: "Edit",
        tool_input: {},
      });
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t3",
        tool_name: "Read",
        tool_input: {},
      });

      // Aggregated usage across 3 tool calls (4 API calls)
      handleChatEvent(SESSION_ID, {
        type: "turn_complete",
        session_id: SESSION_ID,
        duration_ms: 10000,
        usage: {
          input_tokens: 20000,
          output_tokens: 8000,
          cache_creation_input_tokens: 40000,
          cache_read_input_tokens: 600000,
        },
        cost_usd: 5.0,
      });

      const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
      // Total = (20000 + 40000 + 600000 + 8000) / 3 tool calls = 222667
      expect(ctx?.used).toBe(Math.round(668000 / 3));
    });

    it("turn_complete resets tool call counter for next turn", () => {
      // First turn with 2 tool calls
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t1",
        tool_name: "Read",
        tool_input: {},
      });
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t2",
        tool_name: "Read",
        tool_input: {},
      });
      handleChatEvent(SESSION_ID, {
        type: "turn_complete",
        session_id: SESSION_ID,
        duration_ms: 5000,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 100000,
        },
        cost_usd: 1.0,
      });

      // Second turn with NO tool calls
      handleChatEvent(SESSION_ID, {
        type: "turn_complete",
        session_id: SESSION_ID,
        duration_ms: 2000,
        usage: {
          input_tokens: 2000,
          output_tokens: 1000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 160000,
        },
        cost_usd: 0.5,
      });

      const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
      // Second turn: no tool calls, so apiCalls=1, total = (2000+0+160000+1000)/1 = 163000
      expect(ctx?.used).toBe(163000);
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

    it("ExitPlanMode sets session mode to normal", async () => {
      // Start in plan mode
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t-exit",
        tool_name: "ExitPlanMode",
        tool_input: {},
      });

      expect(useSessionStore.getState().sessionModes.get(SESSION_ID)).toBe("normal");

      // Verify syncSessionMode was called via dynamic import
      const { syncSessionMode } = await import("./tauri-commands");
      await vi.waitFor(() => {
        expect(syncSessionMode).toHaveBeenCalledWith(SESSION_ID, "normal");
      });
    });

    it("EnterPlanMode sets session mode to plan", async () => {
      expect(useSessionStore.getState().sessionModes.get(SESSION_ID)).toBe("normal");

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t-enter",
        tool_name: "EnterPlanMode",
        tool_input: {},
      });

      expect(useSessionStore.getState().sessionModes.get(SESSION_ID)).toBe("plan");

      const { syncSessionMode } = await import("./tauri-commands");
      await vi.waitFor(() => {
        expect(syncSessionMode).toHaveBeenCalledWith(SESSION_ID, "plan");
      });
    });

    it("ExitPlanMode does not add an activity entry", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t-exit-2",
        tool_name: "ExitPlanMode",
        tool_input: {},
      });

      const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
      expect(entries.find((e) => e.toolName === "ExitPlanMode")).toBeUndefined();
    });

    it("EnterPlanMode does not add an activity entry", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t-enter-2",
        tool_name: "EnterPlanMode",
        tool_input: {},
      });

      const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
      expect(entries.find((e) => e.toolName === "EnterPlanMode")).toBeUndefined();
    });

    it("ExitPlanMode tool_result is silently skipped", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      // Send tool_use_start (registers the ID for skipping)
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t-exit-3",
        tool_name: "ExitPlanMode",
        tool_input: {},
      });

      // Send tool_result — should not create an error entry
      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "t-exit-3",
        content: "Exit plan mode?",
        is_error: true,
      });

      const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
      expect(entries).toHaveLength(0);
    });

    it("non-mode-control tool_result with is_error still shows as error", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "t-bash",
        tool_name: "Bash",
        tool_input: {},
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "t-bash",
        content: "command not found",
        is_error: true,
      });

      const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
      expect(entry.status).toBe("error");
      expect(entry.isError).toBe(true);
    });
  });

});
