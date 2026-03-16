import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAssistantStore } from "../stores/assistantStore";
import { handleAssistantChatEvent } from "./assistant-event-handler";
import type { FrontendEvent } from "../types/claude-events";

// Mock requestAnimationFrame / cancelAnimationFrame to flush synchronously
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

const SESSION_ID = "asst-test-1";

function resetStore(): void {
  useAssistantStore.setState({
    messages: new Map(),
    streaming: new Map(),
    busy: new Map(),
    cliSessionIds: new Map(),
    sessionCost: new Map(),
    attachments: new Map(),
    projectAssistants: new Map(),
    activeAssistantId: new Map(),
  });
}

function getMessages(): ReturnType<typeof useAssistantStore.getState>["messages"] extends Map<string, infer V> ? V : never {
  return useAssistantStore.getState().messages.get(SESSION_ID) ?? [];
}

function getStreaming(): ReturnType<typeof useAssistantStore.getState>["streaming"] extends Map<string, infer V> ? V : never {
  return useAssistantStore.getState().streaming.get(SESSION_ID) ?? {
    isStreaming: false,
    streamingContent: "",
    currentMessageId: null,
  };
}

describe("handleAssistantChatEvent", () => {
  beforeEach(() => {
    resetStore();
  });

  it("session_init is a no-op (doesn't crash)", () => {
    const event: FrontendEvent = {
      type: "session_init",
      session_id: SESSION_ID,
      model: "sonnet",
    };
    expect(() => handleAssistantChatEvent(SESSION_ID, event)).not.toThrow();
    expect(getMessages()).toHaveLength(0);
  });

  it("cli_session_id calls setCliSessionId", () => {
    const event: FrontendEvent = {
      type: "cli_session_id",
      session_id: SESSION_ID,
      cli_session_id: "cli-abc-123",
    };
    handleAssistantChatEvent(SESSION_ID, event);
    expect(useAssistantStore.getState().cliSessionIds.get(SESSION_ID)).toBe("cli-abc-123");
  });

  it("text_delta creates a new streaming assistant message on first delta", () => {
    const event: FrontendEvent = {
      type: "text_delta",
      session_id: SESSION_ID,
      text: "Hello",
    };
    handleAssistantChatEvent(SESSION_ID, event);

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].isStreaming).toBe(true);

    const streaming = getStreaming();
    expect(streaming.isStreaming).toBe(true);
  });

  it("text_delta accumulates content via buffer", () => {
    const delta1: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "Hello " };
    const delta2: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "world" };

    handleAssistantChatEvent(SESSION_ID, delta1);
    handleAssistantChatEvent(SESSION_ID, delta2);

    // Only one message should exist (not two)
    expect(getMessages()).toHaveLength(1);

    // Verify accumulation by finalizing with text_complete which forces a flush
    const complete: FrontendEvent = {
      type: "text_complete",
      session_id: SESSION_ID,
      full_text: "Hello world",
    };
    handleAssistantChatEvent(SESSION_ID, complete);

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Hello world");
    expect(msgs[0].isStreaming).toBe(false);
  });

  it("text_complete without streaming creates standalone message", () => {
    const event: FrontendEvent = {
      type: "text_complete",
      session_id: SESSION_ID,
      full_text: "Complete response",
    };
    handleAssistantChatEvent(SESSION_ID, event);

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Complete response");
    expect(msgs[0].isStreaming).toBe(false);
  });

  it("text_complete during streaming finalizes message", () => {
    // Start streaming
    const delta: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "partial" };
    handleAssistantChatEvent(SESSION_ID, delta);
    expect(getStreaming().isStreaming).toBe(true);

    // Complete
    const complete: FrontendEvent = {
      type: "text_complete",
      session_id: SESSION_ID,
      full_text: "full response text",
    };
    handleAssistantChatEvent(SESSION_ID, complete);

    const streaming = getStreaming();
    expect(streaming.isStreaming).toBe(false);
    expect(streaming.currentMessageId).toBeNull();

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("full response text");
    expect(msgs[0].isStreaming).toBe(false);
  });

  it("turn_complete sets busy to false and finalizes streaming", () => {
    useAssistantStore.getState().setBusy(SESSION_ID, true);

    // Start streaming
    const delta: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "data" };
    handleAssistantChatEvent(SESSION_ID, delta);

    const turnComplete: FrontendEvent = {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 1000,
      usage: null,
      cost_usd: null,
    };
    handleAssistantChatEvent(SESSION_ID, turnComplete);

    expect(useAssistantStore.getState().busy.get(SESSION_ID)).toBe(false);
    expect(getStreaming().isStreaming).toBe(false);
  });

  it("turn_complete without streaming is safe", () => {
    useAssistantStore.getState().setBusy(SESSION_ID, true);
    const event: FrontendEvent = {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 500,
      usage: null,
      cost_usd: null,
    };
    expect(() => handleAssistantChatEvent(SESSION_ID, event)).not.toThrow();
    expect(useAssistantStore.getState().busy.get(SESSION_ID)).toBe(false);
  });

  it("process_error sets busy to false and adds error message", () => {
    useAssistantStore.getState().setBusy(SESSION_ID, true);
    const event: FrontendEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Something went wrong",
    };
    handleAssistantChatEvent(SESSION_ID, event);

    expect(useAssistantStore.getState().busy.get(SESSION_ID)).toBe(false);
    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("Something went wrong");
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].isStreaming).toBe(false);
  });

  it("process_error during streaming finalizes first, then adds error", () => {
    // Start streaming
    const delta: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "partial" };
    handleAssistantChatEvent(SESSION_ID, delta);
    expect(getStreaming().isStreaming).toBe(true);

    useAssistantStore.getState().setBusy(SESSION_ID, true);

    const error: FrontendEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Connection lost",
    };
    handleAssistantChatEvent(SESSION_ID, error);

    // Streaming should be finalized
    expect(getStreaming().isStreaming).toBe(false);

    // Should have 2 messages: finalized streaming + error
    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].isStreaming).toBe(false);
    expect(msgs[1].content).toContain("Connection lost");
  });

  it("multiple rapid text_deltas buffer correctly", () => {
    const texts = ["A", "B", "C", "D", "E"];
    for (const text of texts) {
      const event: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text };
      handleAssistantChatEvent(SESSION_ID, event);
    }

    // Should still have only one message (no duplicates)
    expect(getMessages()).toHaveLength(1);
    expect(getMessages()[0].role).toBe("assistant");
    expect(getMessages()[0].isStreaming).toBe(true);

    // Verify all deltas were buffered by finalizing via text_complete
    const complete: FrontendEvent = {
      type: "text_complete",
      session_id: SESSION_ID,
      full_text: "ABCDE",
    };
    handleAssistantChatEvent(SESSION_ID, complete);

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("ABCDE");
    expect(msgs[0].isStreaming).toBe(false);
  });
});
