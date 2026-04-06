import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useActivityStore } from "../../stores/activityStore";
import { useChangelogStore } from "../../stores/changelogStore";
import { useToastStore } from "../../stores/toastStore";
import type { Session } from "../../types/session";
import type { UsageUpdateEvent } from "../../types/claude-events";
import type { ActivityEntry } from "../../types/activity";
import {
  handleUsageUpdate,
  checkContextThresholds,
  maybeGenerateChangelog,
  cleanupSession,
} from "./lifecycle";
import { streamingBuffers, pendingFrames } from "./chat";
import { turnToolCallCount } from "./activity";

// --- Mock siblings ---

vi.mock("./process", () => ({
  stopStaleDetection: vi.fn(),
}));

vi.mock("../model-context", () => ({
  getContextWindowForModel: vi.fn(() => 200_000),
}));

vi.mock("../tauri-commands", () => ({
  generateChangelogEntry: vi.fn(() =>
    Promise.resolve({
      id: "cl-1",
      summary: "Test changelog",
      timestamp: "2026-04-05T00:00:00Z",
      tools_used: ["Write"],
      session_mode: "normal",
    })
  ),
}));

// --- Helpers ---

const TEST_SESSION: Session = {
  id: "s1",
  name: "Test",
  project_path: "/tmp/test",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "sonnet",
  icon_index: 0,
};

function resetAllStores(): void {
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

  useToastStore.setState({ toasts: [] });
  useChangelogStore.setState({
    sessionEntries: new Map(),
    generating: new Map(),
    projectEntries: new Map(),
  });
  useActivityStore.setState({
    sessionEntries: new Map(),
    sessionQuestions: new Map(),
    alwaysAllowedTools: new Map(),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
  });
}

function setupSession(): void {
  useSessionStore.getState().addSession(TEST_SESSION);
}

function makeUsageEvent(overrides: Partial<UsageUpdateEvent["usage"]> = {}): UsageUpdateEvent {
  return {
    type: "usage_update",
    session_id: "s1",
    usage: {
      input_tokens: overrides.input_tokens ?? 0,
      output_tokens: overrides.output_tokens ?? 0,
      cache_creation_input_tokens: overrides.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: overrides.cache_read_input_tokens ?? 0,
    },
  };
}

function makeActivityEntry(toolName: string, toolInput: Record<string, unknown> = {}): ActivityEntry {
  return {
    id: `act-${Math.random().toString(36).slice(2)}`,
    toolUseId: `tu-${Math.random().toString(36).slice(2)}`,
    toolName,
    toolInput,
    status: "done",
    timestamp: new Date().toISOString(),
    messageId: "msg-1",
    isError: false,
  };
}

// ============================================================
// Tests
// ============================================================

describe("handleUsageUpdate", () => {
  beforeEach(() => {
    resetAllStores();
    setupSession();
  });

  it("accumulates usage tokens in sessionStore", () => {
    const store = useSessionStore.getState();
    const accumulateSpy = vi.spyOn(store, "accumulateUsage");

    const event = makeUsageEvent({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 10,
    });

    handleUsageUpdate("s1", event, store);

    expect(accumulateSpy).toHaveBeenCalledWith("s1", 100, 50, 20, 10);

    // Verify the stats are actually updated in the store
    const stats = useSessionStore.getState().sessionStats.get("s1");
    expect(stats).toBeDefined();
    expect(stats!.totalInputTokens).toBe(100);
    expect(stats!.totalOutputTokens).toBe(50);
    expect(stats!.totalCacheCreationTokens).toBe(20);
    expect(stats!.totalCacheReadTokens).toBe(10);
    expect(stats!.apiCallCount).toBe(1);

    accumulateSpy.mockRestore();
  });

  it("updates context from per-call tokens", () => {
    const store = useSessionStore.getState();
    const updateContextSpy = vi.spyOn(store, "updateContext");

    const event = makeUsageEvent({
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 100,
    });

    handleUsageUpdate("s1", event, store);

    // callContext = input + cache_creation + cache_read + output = 1000 + 200 + 100 + 500 = 1800
    expect(updateContextSpy).toHaveBeenCalledWith("s1", 1800, expect.any(Number));
    // max should be at least 200_000 (from the mocked getContextWindowForModel)
    expect(updateContextSpy.mock.calls[0][2]).toBeGreaterThanOrEqual(200_000);

    updateContextSpy.mockRestore();
  });

  it("skips context update when all tokens are zero", () => {
    const store = useSessionStore.getState();
    const updateContextSpy = vi.spyOn(store, "updateContext");

    const event = makeUsageEvent({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    handleUsageUpdate("s1", event, store);

    expect(updateContextSpy).not.toHaveBeenCalled();

    updateContextSpy.mockRestore();
  });
});

describe("checkContextThresholds", () => {
  beforeEach(() => {
    resetAllStores();
    setupSession();
    // Clear toasts that may have been created by addSession
    useToastStore.setState({ toasts: [] });
  });

  it("fires 80% toast once", () => {
    // Set context to 81% of max
    useSessionStore.getState().updateContext("s1", 162_000, 200_000);

    checkContextThresholds("s1");

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toContain("80% full");
    expect(toasts[0].type).toBe("info");

    // Verify threshold was recorded
    const fired = useSessionStore.getState().contextToastFired.get("s1");
    expect(fired).toBeDefined();
    expect(fired!.has(80)).toBe(true);

    // Call again — should NOT fire a second toast
    checkContextThresholds("s1");
    const toastsAfter = useToastStore.getState().toasts;
    expect(toastsAfter.length).toBe(1);
  });

  it("fires 95% toast once", () => {
    // Pre-fire the 80% threshold so it doesn't also trigger when
    // checkContextThresholds falls through the else-if branch on the second call.
    useSessionStore.getState().markContextToastFired("s1", 80);

    // Set context to 96% of max
    useSessionStore.getState().updateContext("s1", 192_000, 200_000);

    checkContextThresholds("s1");

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toContain("95% full");
    expect(toasts[0].type).toBe("error");

    // Verify threshold was recorded
    const fired = useSessionStore.getState().contextToastFired.get("s1");
    expect(fired).toBeDefined();
    expect(fired!.has(95)).toBe(true);

    // Call again — should NOT fire a second 95% toast
    checkContextThresholds("s1");
    const toastsAfterSecond = useToastStore.getState().toasts;
    expect(toastsAfterSecond.length).toBe(1);
  });

  it("does nothing below 80%", () => {
    // Set context to 50% of max
    useSessionStore.getState().updateContext("s1", 100_000, 200_000);

    checkContextThresholds("s1");

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(0);

    const fired = useSessionStore.getState().contextToastFired.get("s1");
    // Either undefined or empty set
    expect(fired === undefined || fired.size === 0).toBe(true);
  });
});

describe("maybeGenerateChangelog", () => {
  beforeEach(async () => {
    resetAllStores();
    setupSession();

    // Reset the dynamic import mock between tests
    const tauriCommands = await import("../tauri-commands");
    (tauriCommands.generateChangelogEntry as Mock).mockClear();
    (tauriCommands.generateChangelogEntry as Mock).mockResolvedValue({
      id: "cl-1",
      summary: "Test changelog",
      timestamp: "2026-04-05T00:00:00Z",
      tools_used: ["Write"],
      session_mode: "normal",
    });
  });

  it("generates changelog when enabled and mutating tools used", async () => {
    // Enable changelog
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, changelogEnabled: true },
    });

    // Add a mutating activity entry (Write)
    const writeEntry = makeActivityEntry("Write", { file_path: "/tmp/test/foo.ts", content: "hello\nworld" });
    useActivityStore.getState().addEntry("s1", writeEntry);

    // Add user and assistant messages
    useSessionStore.getState().addMessage("s1", {
      id: "msg-u1",
      role: "user",
      content: "Please create foo.ts",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    useSessionStore.getState().addMessage("s1", {
      id: "msg-a1",
      role: "assistant",
      content: "I have created foo.ts with the requested content. The file contains two lines of text.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    maybeGenerateChangelog("s1");

    // setGenerating should be true immediately
    expect(useChangelogStore.getState().generating.get("s1")).toBe(true);

    // Wait for the async dynamic import + promise chain to resolve
    await vi.waitFor(async () => {
      const tauriCommands = await import("../tauri-commands");
      expect(tauriCommands.generateChangelogEntry).toHaveBeenCalledWith(
        "s1",
        expect.stringContaining("Please create foo.ts"),
        expect.stringContaining("I have created foo.ts"),
        expect.arrayContaining([expect.stringContaining("Write")]),
        "normal",
      );
    });

    // Wait for the entry to be added and generating to be cleared
    await vi.waitFor(() => {
      expect(useChangelogStore.getState().generating.get("s1")).toBe(false);
      const entries = useChangelogStore.getState().sessionEntries.get("s1") ?? [];
      expect(entries.length).toBe(1);
    });
  });

  it("skips when changelog disabled", async () => {
    // Ensure changelog is disabled (default)
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, changelogEnabled: false },
    });

    // Add a mutating activity entry
    useActivityStore.getState().addEntry("s1", makeActivityEntry("Write", { file_path: "/tmp/test/foo.ts" }));

    // Add messages
    useSessionStore.getState().addMessage("s1", {
      id: "msg-u1",
      role: "user",
      content: "Create foo",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    useSessionStore.getState().addMessage("s1", {
      id: "msg-a1",
      role: "assistant",
      content: "Done, I created the file with the requested content and structure.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    maybeGenerateChangelog("s1");

    const tauriCommands = await import("../tauri-commands");
    expect(tauriCommands.generateChangelogEntry).not.toHaveBeenCalled();
    expect(useChangelogStore.getState().generating.get("s1")).toBeUndefined();
  });

  it("skips when no mutating tools used", async () => {
    // Enable changelog
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, changelogEnabled: true },
    });

    // Add only Read entries (non-mutating)
    useActivityStore.getState().addEntry("s1", makeActivityEntry("Read", { file_path: "/tmp/test/bar.ts" }));
    useActivityStore.getState().addEntry("s1", makeActivityEntry("Glob", { pattern: "*.ts" }));

    // Add messages
    useSessionStore.getState().addMessage("s1", {
      id: "msg-u1",
      role: "user",
      content: "Read bar.ts",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    useSessionStore.getState().addMessage("s1", {
      id: "msg-a1",
      role: "assistant",
      content: "Here is the content of bar.ts. It contains several functions for data processing.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    maybeGenerateChangelog("s1");

    const tauriCommands = await import("../tauri-commands");
    expect(tauriCommands.generateChangelogEntry).not.toHaveBeenCalled();
  });
});

describe("cleanupSession", () => {
  beforeEach(() => {
    resetAllStores();
    streamingBuffers.clear();
    pendingFrames.clear();
    turnToolCallCount.clear();
  });

  it("cleans up all module-level state for session", async () => {
    const { stopStaleDetection } = await import("./process");

    // Populate module-level maps with test data
    streamingBuffers.set("s1", "partial text content");
    pendingFrames.set("s1", 42);
    turnToolCallCount.set("s1", 7);

    // Also add data for a different session to ensure it is NOT deleted
    streamingBuffers.set("s2", "other session buffer");
    pendingFrames.set("s2", 99);
    turnToolCallCount.set("s2", 3);

    cleanupSession("s1");

    // Verify s1 data is cleaned up
    expect(streamingBuffers.has("s1")).toBe(false);
    expect(pendingFrames.has("s1")).toBe(false);
    expect(turnToolCallCount.has("s1")).toBe(false);

    // Verify s2 data is untouched
    expect(streamingBuffers.get("s2")).toBe("other session buffer");
    expect(pendingFrames.get("s2")).toBe(99);
    expect(turnToolCallCount.get("s2")).toBe(3);

    // Verify stopStaleDetection was called for this session
    expect(stopStaleDetection).toHaveBeenCalledWith("s1");
  });
});
