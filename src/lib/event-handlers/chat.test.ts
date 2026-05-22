import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session } from "../../types/session";
import type { FrontendEvent } from "../../types/agent-events";
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
      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "claude-opus-4-7" });
      expect(useSessionStore.getState().sessions.get("s1")?.model).toBe("claude-opus-4-7");
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

    it("accepts xhigh as a valid thinking effort", () => {
      const effortMap = new Map(useSessionStore.getState().sessionEffort);
      effortMap.delete("s1");
      useSessionStore.setState({ sessionEffort: effortMap });

      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "sonnet", thinking_effort: "xhigh" });
      expect(useSessionStore.getState().sessionEffort.get("s1")).toBe("xhigh");
    });

    it("accepts whatever effort label the CLI emits — no hardcoded allow-list", () => {
      // Per-model `supportedEffortLevels` is determined by the CLI and
      // changes between releases. The handler must trust whatever the CLI
      // reports (lowercased, trimmed) and let the UI validate against the
      // live capabilities — never against a frozen list.
      const effortMap = new Map(useSessionStore.getState().sessionEffort);
      effortMap.delete("s1");
      useSessionStore.setState({ sessionEffort: effortMap });

      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "sonnet", thinking_effort: "ULTRA" });
      expect(useSessionStore.getState().sessionEffort.get("s1")).toBe("ultra");
    });

    it("ignores empty/whitespace thinking effort values", () => {
      const effortMap = new Map(useSessionStore.getState().sessionEffort);
      effortMap.delete("s1");
      useSessionStore.setState({ sessionEffort: effortMap });

      handleChatEvent("s1", { type: "session_init", session_id: "s1", model: "sonnet", thinking_effort: "   " });
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
      handleChatEvent("s1", { type: "model_changed", session_id: "s1", model: "claude-opus-4-7", success: true, error: null });
      expect(useSessionStore.getState().sessions.get("s1")?.model).toBe("claude-opus-4-7");
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("claude-opus-4-7"), "info", 3000);
    });

    it("shows error toast on failure", () => {
      handleChatEvent("s1", { type: "model_changed", session_id: "s1", model: "bad", success: false, error: "unavailable" });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("unavailable"), "error");
    });
  });

  describe("effort_changed", () => {
    it("updates sessionEffort and shows toast on success", () => {
      handleChatEvent("s1", { type: "effort_changed", session_id: "s1", effort: "high", success: true, error: null });
      expect(useSessionStore.getState().sessionEffort.get("s1")).toBe("high");
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("high"), "info", 2500);
    });

    it("shows error toast on failure", () => {
      handleChatEvent("s1", { type: "effort_changed", session_id: "s1", effort: "high", success: false, error: "rejected" });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("rejected"), "error");
    });
  });

  describe("hook_prompt", () => {
    it("toasts every fragment", () => {
      handleChatEvent("s1", {
        type: "hook_prompt",
        session_id: "s1",
        item_id: "i_hp",
        fragments: [
          { hook_run_id: "r1", text: "extra context A" },
          { hook_run_id: "r2", text: "extra context B" },
        ],
      });
      expect(showToast).toHaveBeenCalledWith("extra context A", "info", 4000);
      expect(showToast).toHaveBeenCalledWith("extra context B", "info", 4000);
    });
  });

  describe("hook_status", () => {
    it("does not toast successful hook completion (would be too noisy)", () => {
      handleChatEvent("s1", {
        type: "hook_status",
        session_id: "s1",
        run_id: "r1",
        event_name: "preToolUse",
        kind: "completed",
        status: "completed",
        duration_ms: 42,
      });
      expect(showToast).not.toHaveBeenCalled();
    });

    it("toasts errors for failed hook runs", () => {
      handleChatEvent("s1", {
        type: "hook_status",
        session_id: "s1",
        run_id: "r1",
        event_name: "preToolUse",
        kind: "completed",
        status: "failed",
        duration_ms: null,
      });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("preToolUse"), "error", 5000);
    });

    it("toasts blocked events as info (toastStore has no warning type)", () => {
      handleChatEvent("s1", {
        type: "hook_status",
        session_id: "s1",
        run_id: "r1",
        event_name: "permissionRequest",
        kind: "completed",
        status: "blocked",
        duration_ms: null,
      });
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining("blocked"),
        "info",
        6000,
      );
    });
  });

  describe("review_mode_entered / exited", () => {
    it("entered flips session into review mode and stores the review text", () => {
      handleChatEvent("s1", {
        type: "review_mode_entered",
        session_id: "s1",
        item_id: "i_er",
        review: "Reviewing changes to foo.rs",
      });
      const store = useSessionStore.getState();
      expect(store.sessionModes.get("s1")).toBe("review");
      expect(store.sessionReviewContent.get("s1")).toBe("Reviewing changes to foo.rs");
    });

    it("exited restores normal mode but keeps the final review for the banner", () => {
      handleChatEvent("s1", {
        type: "review_mode_entered",
        session_id: "s1",
        item_id: "i_er",
        review: "interim",
      });
      handleChatEvent("s1", {
        type: "review_mode_exited",
        session_id: "s1",
        item_id: "i_ex",
        final_review: "Review summary: looks good.",
      });
      const store = useSessionStore.getState();
      expect(store.sessionModes.get("s1")).toBe("normal");
      // Banner keeps showing the final review until the user dismisses
      // it explicitly (handled in ReviewModeBanner.handleDismiss).
      expect(store.sessionReviewContent.get("s1")).toBe("Review summary: looks good.");
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

describe("chat event handler — protected_path_deny", () => {
  beforeEach(() => {
    resetStore();
    setupSession();
    vi.mocked(showToast).mockClear();
  });

  it("emits a protected-path toast naming the denied file path", () => {
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      denials: [
        {
          tool_name: "Write",
          tool_use_id: "toolu_01",
          tool_input: { file_path: "/tmp/x/.claude/skills/foo/SKILL.md", content: "x" },
        },
      ],
    };
    handleChatEvent("s1", event);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [msg, level] = vi.mocked(showToast).mock.calls[0];
    expect(level).toBe("error");
    expect(msg).toContain("Write blocked");
    expect(msg).toContain("/tmp/x/.claude/skills/foo/SKILL.md");
    expect(msg).toContain("Bash heredoc");
  });

  it("summarizes multiple protected-path denials with truncation", () => {
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      denials: [
        { tool_name: "Write", tool_use_id: "t1", tool_input: { file_path: "/p/.claude/a" } },
        { tool_name: "Edit",  tool_use_id: "t2", tool_input: { file_path: "/p/.claude/b" } },
        { tool_name: "Write", tool_use_id: "t3", tool_input: { file_path: "/p/.claude/c" } },
        { tool_name: "Edit",  tool_use_id: "t4", tool_input: { file_path: "/p/.claude/d" } },
      ],
    };
    handleChatEvent("s1", event);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [msg] = vi.mocked(showToast).mock.calls[0];
    expect(msg).toContain("4 writes blocked");
    expect(msg).toContain("Bash heredoc");
    expect(msg).toContain("/p/.claude/a");
    expect(msg).toContain("/p/.claude/c");
    expect(msg).toContain("(+1 more)");
    expect(msg).not.toContain("/p/.claude/d");
  });

  it("Codex agent_id swaps protected-path prefixes to .codex/.agents", () => {
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      agent_id: "codex",
      denials: [
        {
          tool_name: "Write",
          tool_use_id: "t1",
          tool_input: { file_path: "/proj/.codex/forbidden" },
        },
      ],
    };
    handleChatEvent("s1", event);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [msg] = vi.mocked(showToast).mock.calls[0];
    expect(msg).toContain("Write blocked");
    expect(msg).toContain("Codex's sandbox");
    expect(msg).not.toContain("Claude CLI");
    expect(msg).toContain("/proj/.codex/forbidden");
  });

  it("Codex agent_id treats .claude/ writes as plain host-deny (not protected-path)", () => {
    // .claude/ is NOT a protected path under Codex — only .codex/ .git/
    // .agents/ are. The toast must use the generic "Write blocked" form
    // without the Codex-sandbox or Claude-guardrail wording.
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      agent_id: "codex",
      denials: [
        {
          tool_name: "Write",
          tool_use_id: "t1",
          tool_input: { file_path: "/proj/.claude/whatever" },
        },
      ],
    };
    handleChatEvent("s1", event);
    const [msg] = vi.mocked(showToast).mock.calls[0];
    expect(msg).toContain("Write blocked");
    expect(msg).not.toContain("sandbox");
    expect(msg).not.toContain("guardrail");
  });

  it("missing agent_id falls back to Claude prefixes", () => {
    // Phase 1 wire format omits agent_id; the detector must default to
    // Claude so v1.2.0-era events still bucket correctly.
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      denials: [
        {
          tool_name: "Write",
          tool_use_id: "t1",
          tool_input: { file_path: "/p/.claude/x" },
        },
      ],
    };
    handleChatEvent("s1", event);
    const [msg] = vi.mocked(showToast).mock.calls[0];
    expect(msg).toContain("Claude CLI's protected-path guardrail");
  });

  it("uses generic 'Write blocked' wording for non-protected-path host denies (S11 shape)", () => {
    // From harness S11: host hook returns deny for /tmp/cm-harness-S11-b.md.
    // The path is NOT under .claude/.git/.vscode, so the toast must NOT
    // claim "protected-path guardrail" or recommend Bash heredoc.
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      denials: [
        {
          tool_name: "Write",
          tool_use_id: "toolu_01LH",
          tool_input: { file_path: "/tmp/cm-harness-S11-b.md", content: "b" },
        },
      ],
    };
    handleChatEvent("s1", event);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [msg, level] = vi.mocked(showToast).mock.calls[0];
    expect(level).toBe("error");
    expect(msg).toContain("Write blocked");
    expect(msg).toContain("/tmp/cm-harness-S11-b.md");
    expect(msg).not.toContain("protected-path");
    expect(msg).not.toContain("Bash heredoc");
  });

  it("suppresses toast entirely for control-tool denials (S06/S09 shape)", () => {
    // CLI 2.1.126: ExitPlanMode and AskUserQuestion are ALWAYS in
    // permission_denials regardless of host decision — they are UI-prompt
    // signals, not write blocks. PlanCompleteModal / QuestionModal handle
    // them; no toast should fire.
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      denials: [
        {
          tool_name: "ExitPlanMode",
          tool_use_id: "toolu_015KUFYf",
          tool_input: { plan: "1. Step one\n2. Step two" },
        },
        {
          tool_name: "AskUserQuestion",
          tool_use_id: "toolu_0185wYDN",
          tool_input: { questions: [{ question: "Red, green, or blue?" }] },
        },
      ],
    };
    handleChatEvent("s1", event);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("emits ONE toast per non-empty bucket on mixed denials", () => {
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      denials: [
        { tool_name: "ExitPlanMode", tool_use_id: "ec1", tool_input: { plan: "..." } },
        { tool_name: "Write",        tool_use_id: "wr1", tool_input: { file_path: "/p/.claude/x.md" } },
        { tool_name: "Bash",         tool_use_id: "ba1", tool_input: { command: "ls" } },
      ],
    };
    handleChatEvent("s1", event);
    // Two toasts: one writes-bucket (protected-path), one other-bucket (Bash)
    // No toast for ExitPlanMode (control bucket).
    expect(showToast).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(showToast).mock.calls.map(([m]) => m);
    expect(calls.some((m) => m.includes("Write blocked") && m.includes("/p/.claude/x.md"))).toBe(true);
    expect(calls.some((m) => m.includes("Tool call denied") && m.includes("Bash"))).toBe(true);
    expect(calls.some((m) => m.includes("ExitPlanMode"))).toBe(false);
  });

  it("falls back to tool_name when file_path is missing (other bucket)", () => {
    const event: FrontendEvent = {
      type: "protected_path_deny",
      session_id: "s1",
      denials: [
        { tool_name: "WeirdTool", tool_use_id: "t1", tool_input: {} },
      ],
    };
    handleChatEvent("s1", event);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [msg] = vi.mocked(showToast).mock.calls[0];
    expect(msg).toContain("WeirdTool");
    expect(msg).toContain("Tool call denied");
    expect(msg).not.toContain("protected-path");
  });
});
