import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAssistantStore } from "../stores/assistantStore";
import { handleAssistantChatEvent, cleanupAssistantBuffers } from "./assistant-event-handler";
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

  // ── process_exited tests ──

  it("process_exited clears busy and streaming when stuck (safety net)", () => {
    useAssistantStore.getState().setBusy(SESSION_ID, true);

    // Start streaming
    const delta: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "partial" };
    handleAssistantChatEvent(SESSION_ID, delta);
    expect(getStreaming().isStreaming).toBe(true);

    const exited: FrontendEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 1,
      stderr_tail: "segfault",
      elapsed_ms: 5000,
    };
    handleAssistantChatEvent(SESSION_ID, exited);

    expect(useAssistantStore.getState().busy.get(SESSION_ID)).toBe(false);
    expect(getStreaming().isStreaming).toBe(false);

    // Should have finalized streaming message + error message
    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].isStreaming).toBe(false); // finalized streaming
    expect(msgs[1].content).toContain("Process exited");
    expect(msgs[1].content).toContain("segfault");
  });

  it("process_exited is a no-op when not busy/streaming (normal exit after turn_complete)", () => {
    // Not busy, not streaming — simulates normal exit after turn_complete already fired
    const exited: FrontendEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 0,
      stderr_tail: null,
      elapsed_ms: 10000,
    };
    handleAssistantChatEvent(SESSION_ID, exited);

    expect(useAssistantStore.getState().busy.get(SESSION_ID)).toBeFalsy();
    expect(getMessages()).toHaveLength(0); // no error message for exit code 0
  });

  it("process_exited with non-zero exit code adds error message even when not busy", () => {
    // Not busy (turn_complete already cleared it), but process crashed with non-zero code
    const exited: FrontendEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 137,
      stderr_tail: "killed",
      elapsed_ms: 3000,
    };
    handleAssistantChatEvent(SESSION_ID, exited);

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("Process exited");
    expect(msgs[0].content).toContain("137");
  });

  it("process_exited clears busy only (no streaming) when only busy is stuck", () => {
    useAssistantStore.getState().setBusy(SESSION_ID, true);
    // busy but not streaming

    const exited: FrontendEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 1,
      stderr_tail: null,
      elapsed_ms: 2000,
    };
    handleAssistantChatEvent(SESSION_ID, exited);

    expect(useAssistantStore.getState().busy.get(SESSION_ID)).toBe(false);
    // Error message for non-zero exit code
    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("Process exited");
  });

  // ── cleanupAssistantBuffers tests ──

  it("cleanupAssistantBuffers cleans up without errors on unknown sessionId", () => {
    expect(() => cleanupAssistantBuffers("nonexistent")).not.toThrow();
  });

  it("cleanupAssistantBuffers removes pending buffers for a session", () => {
    // Buffer some text (creates entries in the internal maps)
    const delta: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "buffered" };
    handleAssistantChatEvent(SESSION_ID, delta);

    // Clean up
    cleanupAssistantBuffers(SESSION_ID);

    // After cleanup, a new text_delta should start fresh (not append to old buffer)
    // We verify by starting a new streaming session and checking the content
    const delta2: FrontendEvent = { type: "text_delta", session_id: SESSION_ID, text: "fresh" };
    handleAssistantChatEvent(SESSION_ID, delta2);

    const complete: FrontendEvent = {
      type: "text_complete",
      session_id: SESSION_ID,
      full_text: "fresh",
    };
    handleAssistantChatEvent(SESSION_ID, complete);

    const msgs = getMessages();
    // Should have 2 messages: the old streaming one + the new one that was finalized
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg.content).toBe("fresh");
    expect(lastMsg.isStreaming).toBe(false);
  });
});
