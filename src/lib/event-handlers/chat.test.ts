import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session } from "../../types/session";
import type { FrontendEvent } from "../../types/claude-events";
import {
  handleChatEvent,
  nextMessageId,
  flushThinkingBuffer,
  thinkingBuffers,
  thinkingFrames,
  streamingBuffers,
  pendingFrames,
} from "./chat";

describe("nextMessageId", () => {
  it("generates unique IDs across many calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(nextMessageId());
    }
    expect(ids.size).toBe(1000);
  });

  it("includes an epoch component to prevent cross-restart collisions", () => {
    const id = nextMessageId();
    // Format: msg-{epoch}-{counter} — must have at least two hyphens
    const parts = id.split("-");
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[0]).toBe("msg");
  });
});

const TEST_SESSION: Session = {
  id: "s1",
  name: "Test",
  project_path: "/tmp/test",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "sonnet",
  icon_index: 0,
};

function resetStore(): void {
  useSessionStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    sessionStats: new Map(),
    sessionModes: new Map(),
    sessionBusy: new Map(),
    sessionEffort: new Map(),
    sessionRetry: new Map(),
    lastEventTimestamp: new Map(),
    contextToastFired: new Map(),
    sessionActivity: new Map(),
    sessionCompacting: new Map(),
    busySince: new Map(),
    rateLimitUtilization: new Map(),
    sessionCapabilities: new Map(),
    activeSubAgents: new Map(),
    sessionThinking: new Map(),
    tabOrder: [],
    activeProjectPath: null,
    projectOrder: [],
    projectActiveSession: new Map(),
  });
}

function setupSession(): void {
  useSessionStore.getState().addSession(TEST_SESSION);
}

describe("chat event handler — thinking events", () => {
  beforeEach(() => {
    resetStore();
    // Clear buffers between tests
    streamingBuffers.clear();
    pendingFrames.clear();
    thinkingBuffers.clear();
    thinkingFrames.clear();
  });

  describe("thinking_delta", () => {
    it("starts thinking and buffers content", () => {
      setupSession();
      const event: FrontendEvent = {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "Let me think...",
      };
      handleChatEvent("s1", event);
      // rAF doesn't fire synchronously in jsdom — manually flush
      flushThinkingBuffer("s1");
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.isThinking).toBe(true);
      expect(thinking?.content).toBe("Let me think...");
    });

    it("accumulates multiple thinking deltas", () => {
      setupSession();
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "First ",
      });
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "second.",
      });
      flushThinkingBuffer("s1");
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.content).toBe("First second.");
    });

    it("sets session to busy", () => {
      setupSession();
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "analyzing...",
      });
      expect(useSessionStore.getState().sessionBusy.get("s1")).toBe(true);
    });

    it("updates activity label to 'Reasoning...'", () => {
      setupSession();
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "hmm",
      });
      const activity = useSessionStore.getState().sessionActivity.get("s1");
      expect(activity?.label).toBe("Reasoning...");
    });

    it("touches last event timestamp", () => {
      setupSession();
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "tick",
      });
      expect(useSessionStore.getState().lastEventTimestamp.get("s1")).toBeDefined();
    });
  });

  describe("thinking_complete", () => {
    it("finalizes thinking with full text", () => {
      setupSession();
      // Start thinking first
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "partial",
      });
      // Finalize with full text
      handleChatEvent("s1", {
        type: "thinking_complete",
        session_id: "s1",
        full_thinking: "Complete reasoning text",
      });
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.isThinking).toBe(false);
      expect(thinking?.content).toBe("Complete reasoning text");
    });

    it("works even without prior thinking_delta", () => {
      setupSession();
      handleChatEvent("s1", {
        type: "thinking_complete",
        session_id: "s1",
        full_thinking: "Direct complete",
      });
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.isThinking).toBe(false);
      expect(thinking?.content).toBe("Direct complete");
    });
  });

  describe("turn_complete cleans up thinking", () => {
    it("finalizes active thinking on turn_complete", () => {
      setupSession();
      // Start thinking
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "Still thinking...",
      });
      expect(useSessionStore.getState().sessionThinking.get("s1")?.isThinking).toBe(true);

      // Turn complete should finalize thinking
      handleChatEvent("s1", {
        type: "turn_complete",
        session_id: "s1",
        duration_ms: 1000,
        usage: null,
        cost_usd: null,
      });
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.isThinking).toBe(false);
    });
  });

  describe("thinking → text transition", () => {
    it("thinking completes before text starts streaming", () => {
      setupSession();
      // Thinking phase
      handleChatEvent("s1", {
        type: "thinking_delta",
        session_id: "s1",
        thinking: "Let me analyze...",
      });
      handleChatEvent("s1", {
        type: "thinking_complete",
        session_id: "s1",
        full_thinking: "Let me analyze...",
      });
      expect(useSessionStore.getState().sessionThinking.get("s1")?.isThinking).toBe(false);

      // Text phase starts
      handleChatEvent("s1", {
        type: "text_delta",
        session_id: "s1",
        text: "Here is my answer.",
      });
      // Should have a streaming message now
      const streaming = useSessionStore.getState().sessionStreaming.get("s1");
      expect(streaming?.isStreaming).toBe(true);
    });
  });
});
