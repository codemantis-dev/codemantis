import { describe, it, expect, beforeEach } from "vitest";
import {
  handleChatEvent,
  handleActivityEvent,
} from "./event-classifier";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";

const SESSION_ID = "transparency-test";

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
    sessionStats: new Map([[SESSION_ID, { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, turnCount: 0, apiCallCount: 0 }]]),
    sessionBusy: new Map([[SESSION_ID, true]]),
    sessionActivity: new Map(),
    sessionCompacting: new Map(),
    busySince: new Map([[SESSION_ID, Date.now()]]),
    rateLimitUtilization: new Map(),
    tabOrder: [SESSION_ID],
  });

  useActivityStore.setState({
    sessionEntries: new Map([[SESSION_ID, []]]),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
    alwaysAllowedTools: new Map(),
  });
}

describe("Transparency: Activity Labels", () => {
  beforeEach(resetStores);

  it("text_delta sets activity to 'Generating response...'", () => {
    handleChatEvent(SESSION_ID, {
      type: "text_delta",
      session_id: SESSION_ID,
      text: "Hello",
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Generating response...");
  });

  it("tool_use_start sets contextual activity label for Read tool", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-1",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test.ts" },
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Reading file...");
    expect(activity?.toolName).toBe("Read");
    expect(activity?.filePath).toBe("/tmp/test.ts");
  });

  it("tool_use_start sets contextual activity label for Edit tool", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-2",
      tool_name: "Edit",
      tool_input: { file_path: "/tmp/test.ts" },
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Editing code...");
    expect(activity?.filePath).toBe("/tmp/test.ts");
  });

  it("tool_use_start sets contextual activity label for Bash tool", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-3",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Running command...");
    expect(activity?.filePath).toBeNull();
  });

  it("tool_use_start sets contextual activity label for Agent tool", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-4",
      tool_name: "Agent",
      tool_input: { description: "Security audit scan", subagent_type: "Explore" },
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Agent: [Explore] Security audit scan");
    expect(activity?.filePath).toBeNull();

    // Clean up: complete the agent so it doesn't affect later tests
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "tool-4",
      content: "done",
      is_error: false,
    });
  });

  it("tool_use_start sets contextual activity label for Grep tool", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-5",
      tool_name: "Grep",
      tool_input: {},
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Searching code...");
    expect(activity?.filePath).toBeNull();
  });

  it("tool_result resets activity back to 'Thinking...'", () => {
    // First set to a tool activity
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-6",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/foo.ts" },
    });
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.label).toBe("Reading file...");
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.filePath).toBe("/tmp/foo.ts");

    // Then complete the tool
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "tool-6",
      content: "file contents",
      is_error: false,
    });
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.label).toBe("Thinking...");
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.filePath).toBeNull();
  });
});

describe("Transparency: Tool Progress (Heartbeat)", () => {
  beforeEach(resetStores);

  it("tool_progress updates activity label and elapsed time", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_progress",
      session_id: SESSION_ID,
      tool_use_id: "tool-7",
      tool_name: "Bash",
      elapsed_seconds: 45.2,
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Running command...");
    expect(activity?.toolName).toBe("Bash");
    expect(activity?.toolElapsed).toBe(45.2);
  });

  it("tool_progress touches lastEventTimestamp (stale detection heartbeat)", () => {
    const before = useSessionStore.getState().lastEventTimestamp.get(SESSION_ID) ?? 0;
    handleActivityEvent(SESSION_ID, {
      type: "tool_progress",
      session_id: SESSION_ID,
      tool_use_id: "tool-8",
      tool_name: "Agent",
      elapsed_seconds: 120,
    });
    const after = useSessionStore.getState().lastEventTimestamp.get(SESSION_ID) ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("Transparency: Compaction Events", () => {
  beforeEach(resetStores);

  it("compacting_status sets compacting state and activity label", () => {
    handleChatEvent(SESSION_ID, {
      type: "compacting_status",
      session_id: SESSION_ID,
      is_compacting: true,
    });
    expect(useSessionStore.getState().sessionCompacting.get(SESSION_ID)).toBe(true);
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Compacting context...");
  });

  it("compacting_status clears compacting state when done", () => {
    // Set compacting
    handleChatEvent(SESSION_ID, {
      type: "compacting_status",
      session_id: SESSION_ID,
      is_compacting: true,
    });
    expect(useSessionStore.getState().sessionCompacting.get(SESSION_ID)).toBe(true);

    // Clear compacting
    handleChatEvent(SESSION_ID, {
      type: "compacting_status",
      session_id: SESSION_ID,
      is_compacting: false,
    });
    expect(useSessionStore.getState().sessionCompacting.get(SESSION_ID)).toBe(false);
  });

  it("compact_complete touches lastEventTimestamp", () => {
    handleChatEvent(SESSION_ID, {
      type: "compact_complete",
      session_id: SESSION_ID,
      trigger: "auto",
      pre_tokens: 180000,
    });
    const ts = useSessionStore.getState().lastEventTimestamp.get(SESSION_ID) ?? 0;
    expect(ts).toBeGreaterThan(0);
  });

  it("compact_complete clears compacting state", () => {
    useSessionStore.getState().setSessionCompacting(SESSION_ID, true);
    handleChatEvent(SESSION_ID, {
      type: "compact_complete",
      session_id: SESSION_ID,
      trigger: "manual",
      pre_tokens: 150000,
    });
    expect(useSessionStore.getState().sessionCompacting.get(SESSION_ID)).toBe(false);
  });
});

describe("Transparency: Rate Limit Warning", () => {
  beforeEach(resetStores);

  it("rate_limit_warning updates utilization state", () => {
    handleChatEvent(SESSION_ID, {
      type: "rate_limit_warning",
      session_id: SESSION_ID,
      utilization: 0.85,
      resets_at: null,
    });
    expect(useSessionStore.getState().rateLimitUtilization.get(SESSION_ID)).toBe(0.85);
  });

  it("rate_limit_warning at high utilization stores value", () => {
    handleChatEvent(SESSION_ID, {
      type: "rate_limit_warning",
      session_id: SESSION_ID,
      utilization: 0.95,
      resets_at: 1741800000,
    });
    expect(useSessionStore.getState().rateLimitUtilization.get(SESSION_ID)).toBe(0.95);
  });
});

describe("Transparency: Live Token Usage (usage_update)", () => {
  beforeEach(resetStores);

  it("usage_update accumulates tokens incrementally", () => {
    // First API call (initial response)
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 1000, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 500 },
    });
    let stats = useSessionStore.getState().sessionStats.get(SESSION_ID);
    expect(stats?.totalInputTokens).toBe(1000);
    expect(stats?.totalOutputTokens).toBe(50);
    expect(stats?.apiCallCount).toBe(1);

    // Second API call (after tool result)
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 1700 },
    });
    stats = useSessionStore.getState().sessionStats.get(SESSION_ID);
    expect(stats?.totalInputTokens).toBe(2200);
    expect(stats?.totalOutputTokens).toBe(130);
    expect(stats?.totalCacheReadTokens).toBe(2200);
    expect(stats?.apiCallCount).toBe(2);
  });

  it("turn_complete does not double-count tokens when usage_update was received", () => {
    // Simulate usage_update during turn
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    // Then turn_complete with aggregated totals (same tokens)
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 3000,
      usage: { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      cost_usd: 0.01,
    });
    const stats = useSessionStore.getState().sessionStats.get(SESSION_ID);
    // Should NOT be 1000 (double-counted) — should stay at 500
    expect(stats?.totalInputTokens).toBe(500);
    expect(stats?.totalOutputTokens).toBe(100);
    expect(stats?.totalCostUsd).toBe(0.01);
    expect(stats?.turnCount).toBe(1);
    // apiCallCount reset after turn
    expect(stats?.apiCallCount).toBe(0);
  });

  it("turn_complete falls back to token accumulation when no usage_update was received", () => {
    // No usage_update — simulate older CLI that doesn't emit them
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 2000,
      usage: { input_tokens: 800, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: 300 },
      cost_usd: 0.005,
    });
    const stats = useSessionStore.getState().sessionStats.get(SESSION_ID);
    expect(stats?.totalInputTokens).toBe(800);
    expect(stats?.totalOutputTokens).toBe(200);
    expect(stats?.totalCostUsd).toBe(0.005);
  });

  it("usage_update touches lastEventTimestamp", () => {
    const before = useSessionStore.getState().lastEventTimestamp.get(SESSION_ID) ?? 0;
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
    const after = useSessionStore.getState().lastEventTimestamp.get(SESSION_ID) ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("Transparency: Real-time Context Updates", () => {
  beforeEach(resetStores);

  it("usage_update sets context in real-time", () => {
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 5000, output_tokens: 500, cache_creation_input_tokens: 1000, cache_read_input_tokens: 3000 },
    });
    const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
    // 5000 + 1000 + 3000 + 500 = 9500
    expect(ctx?.used).toBe(9500);
    expect(ctx?.max).toBe(200000);
  });

  it("context grows with each successive usage_update", () => {
    // First API call — small context
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 5000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    const ctx1 = useSessionStore.getState().sessionContext.get(SESSION_ID);
    expect(ctx1?.used).toBe(5200);

    // Second API call — context grew (more input from tool results)
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 8000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 5000 },
    });
    const ctx2 = useSessionStore.getState().sessionContext.get(SESSION_ID);
    expect(ctx2?.used).toBe(13300);
    expect(ctx2!.used).toBeGreaterThan(ctx1!.used);
  });

  it("turn_complete does NOT overwrite context when usage_update was received", () => {
    // usage_update sets context to 15000
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 10000, output_tokens: 5000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    expect(useSessionStore.getState().sessionContext.get(SESSION_ID)?.used).toBe(15000);

    // turn_complete with aggregate totals — should NOT overwrite
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 5000,
      usage: { input_tokens: 20000, output_tokens: 10000, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      cost_usd: 0.05,
    });
    // Context should still be 15000 (from usage_update), not 30000 (from aggregate)
    expect(useSessionStore.getState().sessionContext.get(SESSION_ID)?.used).toBe(15000);
  });

  it("turn_complete DOES set context when no usage_update arrived (fallback)", () => {
    // No usage_update — simulate older CLI
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 3000,
      usage: { input_tokens: 8000, output_tokens: 2000, cache_creation_input_tokens: 500, cache_read_input_tokens: 4000 },
      cost_usd: 0.02,
    });
    // 8000 + 500 + 4000 + 2000 = 14500, no tool calls so apiCalls=1
    expect(useSessionStore.getState().sessionContext.get(SESSION_ID)?.used).toBe(14500);
  });
});

describe("Transparency: Sub-Agent Tool Attribution", () => {
  beforeEach(resetStores);

  it("tool calls without active sub-agents have no attribution", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "read-solo",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/solo.ts" },
    });

    const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
    const readEntry = entries.find((e) => e.toolUseId === "read-solo");
    expect(readEntry?.parentAgentToolUseId).toBeUndefined();
    expect(readEntry?.parentAgentDescription).toBeUndefined();
  });

  it("agent completion without tool calls does not set agentFinalToolCount", () => {
    // Start and immediately complete agent (no child tool calls)
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "agent-empty",
      tool_name: "Agent",
      tool_input: { description: "Quick check", subagent_type: "general-purpose" },
    });
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "agent-empty",
      content: "done",
      is_error: false,
    });

    const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
    const agentEntry = entries.find((e) => e.toolUseId === "agent-empty");
    expect(agentEntry?.agentFinalToolCount).toBeUndefined();
  });
});

describe("Transparency: Busy State Tracking", () => {
  beforeEach(resetStores);

  it("setSessionBusy(true) records busySince timestamp", () => {
    const store = useSessionStore.getState();
    store.setSessionBusy(SESSION_ID, false); // reset
    store.setSessionBusy(SESSION_ID, true);
    const busySince = useSessionStore.getState().busySince.get(SESSION_ID);
    expect(busySince).toBeGreaterThan(0);
  });

  it("setSessionBusy(false) clears busySince and activity", () => {
    const store = useSessionStore.getState();
    // First set busy with activity
    store.setSessionBusy(SESSION_ID, true);
    store.setSessionActivity(SESSION_ID, { label: "Editing code...", toolName: "Edit", toolElapsed: 0, filePath: null });
    expect(useSessionStore.getState().busySince.get(SESSION_ID)).toBeGreaterThan(0);
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.label).toBe("Editing code...");

    // Then clear busy
    store.setSessionBusy(SESSION_ID, false);
    expect(useSessionStore.getState().busySince.get(SESSION_ID)).toBeUndefined();
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)).toBeUndefined();
  });

  it("setSessionBusy(true) resets lastEventTimestamp to prevent false stale warnings", () => {
    const store = useSessionStore.getState();
    // Simulate old timestamp from a previous turn (e.g. 5 minutes ago)
    const fiveMinutesAgo = Date.now() - 300_000;
    useSessionStore.setState((s) => {
      const lastEventTimestamp = new Map(s.lastEventTimestamp);
      lastEventTimestamp.set(SESSION_ID, fiveMinutesAgo);
      return { lastEventTimestamp };
    });
    expect(useSessionStore.getState().lastEventTimestamp.get(SESSION_ID)).toBe(fiveMinutesAgo);

    // When user sends a new message (setSessionBusy(true)), the stale clock must reset
    store.setSessionBusy(SESSION_ID, true);
    const newTs = useSessionStore.getState().lastEventTimestamp.get(SESSION_ID)!;
    // Should be recent (within last second), not the old 5-minute-ago timestamp
    expect(Date.now() - newTs).toBeLessThan(1000);
  });

  it("turn_complete clears busy state and activity", () => {
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 5000,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      cost_usd: 0.001,
    });
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(false);
    expect(useSessionStore.getState().busySince.get(SESSION_ID)).toBeUndefined();
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)).toBeUndefined();
  });
});
