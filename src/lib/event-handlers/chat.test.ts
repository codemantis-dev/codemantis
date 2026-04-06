import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session } from "../../types/session";
import type { FrontendEvent } from "../../types/claude-events";
import {
  handleChatEvent,
  nextMessageId,
  flushThinkingBuffer,
  flushStreamingBuffer,
  thinkingBuffers,
  thinkingFrames,
  streamingBuffers,
  pendingFrames,
} from "./chat";

// Mock tauri-commands (lifecycle and process handlers import from it)
vi.mock("../../lib/tauri-commands", () => ({
  generateChangelogEntry: vi.fn(),
  checkProcessAlive: vi.fn().mockResolvedValue(true),
  sendMessage: vi.fn(),
  readFileContent: vi.fn().mockResolvedValue(""),
  syncSessionMode: vi.fn(),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

import { showToast } from "../../stores/toastStore";

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

// ── Additional chat event handler tests ──

describe("chat event handler — text events", () => {
  beforeEach(() => {
    resetStore();
    setupSession();
    streamingBuffers.clear();
    pendingFrames.clear();
    thinkingBuffers.clear();
    thinkingFrames.clear();
    vi.clearAllMocks();
  });

  describe("text_delta", () => {
    it("creates a new streaming message when none exists", () => {
      handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: "Hello" });
      const messages = useSessionStore.getState().sessionMessages.get("s1");
      expect(messages).toHaveLength(1);
      expect(messages![0].role).toBe("assistant");
      expect(messages![0].isStreaming).toBe(true);
    });

    it("does not create duplicate messages on subsequent deltas", () => {
      handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: "Hello" });
      handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: " world" });
      const messages = useSessionStore.getState().sessionMessages.get("s1");
      expect(messages).toHaveLength(1);
    });

    it("sets session as busy", () => {
      handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: "Hi" });
      expect(useSessionStore.getState().sessionBusy.get("s1")).toBe(true);
    });

    it("sets activity label to 'Generating response...'", () => {
      handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: "Hi" });
      expect(useSessionStore.getState().sessionActivity.get("s1")?.label).toBe("Generating response...");
    });
  });

  describe("text_complete", () => {
    it("finalizes an active streaming message", () => {
      handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: "Hel" });
      handleChatEvent("s1", { type: "text_complete", session_id: "s1", full_text: "Hello world" });
      const streaming = useSessionStore.getState().sessionStreaming.get("s1");
      expect(streaming?.isStreaming).toBeFalsy();
    });

    it("creates standalone message when no streaming was active", () => {
      handleChatEvent("s1", { type: "text_complete", session_id: "s1", full_text: "Full message" });
      const messages = useSessionStore.getState().sessionMessages.get("s1");
      expect(messages).toHaveLength(1);
      expect(messages![0].content).toBe("Full message");
      expect(messages![0].isStreaming).toBe(false);
    });
  });
});

describe("chat event handler — turn_complete", () => {
  beforeEach(() => {
    resetStore();
    setupSession();
    streamingBuffers.clear();
    pendingFrames.clear();
    thinkingBuffers.clear();
    thinkingFrames.clear();
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: { defaultContextWindow: 200000, changelogEnabled: false } as ReturnType<typeof useSettingsStore.getState>["settings"],
      loaded: true,
    });
  });

  it("clears busy state", () => {
    useSessionStore.getState().ensureBusy("s1");
    handleChatEvent("s1", {
      type: "turn_complete", session_id: "s1",
      duration_ms: 5000, usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, cost_usd: 0.01,
    });
    expect(useSessionStore.getState().sessionBusy.get("s1")).toBeFalsy();
  });

  it("finalizes active streaming", () => {
    handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: "Hi" });
    handleChatEvent("s1", {
      type: "turn_complete", session_id: "s1",
      duration_ms: 1000, usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, cost_usd: 0.005,
    });
    expect(useSessionStore.getState().sessionStreaming.get("s1")?.isStreaming).toBeFalsy();
  });

  it("updates context with aggregate estimation when no incremental updates", () => {
    handleChatEvent("s1", {
      type: "turn_complete", session_id: "s1",
      duration_ms: 1000, usage: { input_tokens: 5000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, cost_usd: 0.01,
    });
    const ctx = useSessionStore.getState().sessionContext.get("s1");
    expect(ctx).toBeDefined();
    expect(ctx!.used).toBe(7000); // (5000 + 2000) / max(0, 1)
  });

  it("attaches turn stats to completed assistant message", () => {
    handleChatEvent("s1", { type: "text_delta", session_id: "s1", text: "Response" });
    handleChatEvent("s1", { type: "text_complete", session_id: "s1", full_text: "Response" });
    handleChatEvent("s1", {
      type: "turn_complete", session_id: "s1",
      duration_ms: 3000, usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, cost_usd: 0.02,
    });
    const messages = useSessionStore.getState().sessionMessages.get("s1");
    const assistantMsg = messages?.find((m) => m.role === "assistant");
    expect(assistantMsg?.turnStats).toBeDefined();
    expect(assistantMsg?.turnStats?.costUsd).toBe(0.02);
    expect(assistantMsg?.turnStats?.durationMs).toBe(3000);
  });
});

describe("chat event handler — system events", () => {
  beforeEach(() => {
    resetStore();
    setupSession();
    streamingBuffers.clear();
    pendingFrames.clear();
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: { defaultContextWindow: 200000 } as ReturnType<typeof useSettingsStore.getState>["settings"],
      loaded: true,
    });
  });

  describe("session_init", () => {
    it("updates model in session store", () => {
      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "claude-opus-4-6" });
      expect(useSessionStore.getState().sessions.get("s1")?.model).toBe("claude-opus-4-6");
    });

    it("sets context max based on model", () => {
      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "claude-sonnet-4-20250514" });
      const ctx = useSessionStore.getState().sessionContext.get("s1");
      expect(ctx?.max).toBeGreaterThan(0);
    });

    it("sets thinking effort when provided", () => {
      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "sonnet", thinking_effort: "high" });
      expect(useSessionStore.getState().sessionEffort.get("s1")).toBe("high");
    });

    it("ignores invalid thinking effort values", () => {
      // Ensure no prior effort is set
      const effortMap = new Map(useSessionStore.getState().sessionEffort);
      effortMap.delete("s1");
      useSessionStore.setState({ sessionEffort: effortMap });

      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "sonnet", thinking_effort: "ULTRA" });
      expect(useSessionStore.getState().sessionEffort.get("s1")).toBeUndefined();
    });
  });

  describe("compacting_status", () => {
    it("shows toast when compacting starts", () => {
      handleChatEvent("s1", { type: "compacting_status", session_id: "s1", is_compacting: true });
      expect(useSessionStore.getState().sessionCompacting.get("s1")).toBe(true);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Compacting"), "info", 5000);
    });

    it("does not show toast when compacting ends", () => {
      handleChatEvent("s1", { type: "compacting_status", session_id: "s1", is_compacting: false });
      expect(showToast).not.toHaveBeenCalled();
    });
  });

  describe("compact_complete", () => {
    it("shows toast with token info", () => {
      handleChatEvent("s1", { type: "compact_complete", session_id: "s1", trigger: "auto", pre_tokens: 150000 });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("150K"), "info", 6000);
    });
  });

  describe("rate_limit_warning", () => {
    it("shows error toast at 90%+ utilization", () => {
      handleChatEvent("s1", { type: "rate_limit_warning", session_id: "s1", utilization: 0.95, resets_at: Date.now() + 60000 });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("95%"), "error", 10000);
    });

    it("shows info toast at 70-89% utilization", () => {
      handleChatEvent("s1", { type: "rate_limit_warning", session_id: "s1", utilization: 0.75, resets_at: Date.now() + 60000 });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("75%"), "info", 6000);
    });

    it("stores utilization in session store", () => {
      handleChatEvent("s1", { type: "rate_limit_warning", session_id: "s1", utilization: 0.82, resets_at: Date.now() + 60000 });
      expect(useSessionStore.getState().rateLimitUtilization.get("s1")).toBe(0.82);
    });
  });

  describe("interrupt_result", () => {
    it("sets Stopping activity on success", () => {
      handleChatEvent("s1", { type: "interrupt_result", session_id: "s1", success: true, error: null });
      expect(useSessionStore.getState().sessionActivity.get("s1")?.label).toBe("Stopping...");
    });

    it("shows error toast on failure", () => {
      handleChatEvent("s1", { type: "interrupt_result", session_id: "s1", success: false, error: "not found" });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("not found"), "error");
    });
  });

  describe("model_changed", () => {
    it("updates model and shows toast on success", () => {
      handleChatEvent("s1", { type: "model_changed", session_id: "s1", model: "claude-opus-4-6", success: true, error: null });
      expect(useSessionStore.getState().sessions.get("s1")?.model).toBe("claude-opus-4-6");
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("claude-opus-4-6"), "info", 3000);
    });

    it("shows error toast on failure", () => {
      handleChatEvent("s1", { type: "model_changed", session_id: "s1", model: "bad", success: false, error: "unavailable" });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("unavailable"), "error");
    });
  });

  describe("capabilities_discovered", () => {
    it("stores capabilities", () => {
      handleChatEvent("s1", {
        type: "capabilities_discovered", session_id: "s1",
        models: [{ value: "sonnet", displayName: "Sonnet", description: "Sonnet model" }],
        commands: [{ name: "/help", description: "Show help" }],
        agents: [], account: null, output_styles: [],
      } as FrontendEvent);
      expect(useSessionStore.getState().sessionCapabilities.get("s1")).toBeDefined();
    });
  });
});

describe("streaming buffer utilities", () => {
  beforeEach(() => {
    resetStore();
    setupSession();
    streamingBuffers.clear();
    pendingFrames.clear();
    thinkingBuffers.clear();
    thinkingFrames.clear();
  });

  it("flushStreamingBuffer is no-op when buffer is empty", () => {
    flushStreamingBuffer("s1");
    expect(streamingBuffers.get("s1")).toBeUndefined();
  });

  it("flushThinkingBuffer is no-op when buffer is empty", () => {
    flushThinkingBuffer("s1");
    expect(thinkingBuffers.get("s1")).toBeUndefined();
  });
});
