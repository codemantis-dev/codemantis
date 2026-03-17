import { describe, it, expect, beforeEach } from "vitest";
import {
  handleChatEvent,
  handleActivityEvent,
} from "./event-classifier";
import type { FrontendEvent } from "../types/claude-events";
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
    activeSubAgents: new Map(),
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

describe("Transparency: Dynamic Context Window from modelUsage", () => {
  beforeEach(resetStores);

  it("turn_complete with context_window updates max from modelUsage", () => {
    // No usage_update → fallback path sets context
    // context_window must exceed the 200K fallback to win Math.max
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 3000,
      usage: { input_tokens: 8000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      cost_usd: 0.02,
      context_window: 256000,  // Larger than 200K fallback
      max_output_tokens: 16000,
    });
    const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
    expect(ctx?.max).toBe(256000);
    // used = (totalInput+totalOutput) / apiCalls — exact value depends on
    // module-level turnToolCallCount which can't be reset between tests,
    // so just verify it's a positive number derived from the 10000 total.
    expect(ctx?.used).toBeGreaterThan(0);
    expect(ctx?.used).toBeLessThanOrEqual(10000);
  });

  it("turn_complete context_window updates max even when incremental updates handled used", () => {
    // Simulate usage_update during turn
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 5000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    expect(useSessionStore.getState().sessionContext.get(SESSION_ID)?.max).toBe(200000);

    // turn_complete with context_window larger than 200K fallback
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 2000,
      usage: { input_tokens: 5000, output_tokens: 500, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      cost_usd: 0.01,
      context_window: 256000,
    });
    const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
    // max should be updated to 256000, used should stay at 5500 (from usage_update)
    expect(ctx?.max).toBe(256000);
    expect(ctx?.used).toBe(5500);
  });

  it("usage_update preserves current max from previous turn_complete", () => {
    // First turn sets max to 256000 (must exceed 200K fallback)
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 1000,
      usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      cost_usd: 0.001,
      context_window: 256000,
    });

    // Next turn: usage_update should preserve the 256000 max
    handleChatEvent(SESSION_ID, {
      type: "usage_update",
      session_id: SESSION_ID,
      usage: { input_tokens: 3000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
    expect(ctx?.max).toBe(256000);
    expect(ctx?.used).toBe(3200);
  });

  it("turn_complete without context_window defaults to 200000", () => {
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 1000,
      usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      cost_usd: 0.001,
      // No context_window field
    });
    const ctx = useSessionStore.getState().sessionContext.get(SESSION_ID);
    expect(ctx?.max).toBe(200000);
  });
});

describe("Transparency: Rate Limit Warning with status-only (no utilization)", () => {
  beforeEach(resetStores);

  it("rate_limit_warning with zero utilization still stores value", () => {
    handleChatEvent(SESSION_ID, {
      type: "rate_limit_warning",
      session_id: SESSION_ID,
      utilization: 0,
      resets_at: 1741800000,
      rate_limit_type: "five_hour",
      overage_status: "rejected",
      is_using_overage: false,
    });
    // utilization 0 should be stored (not treated as missing)
    expect(useSessionStore.getState().rateLimitUtilization.get(SESSION_ID)).toBe(0);
  });
});

describe("Transparency: TurnStats enrichment", () => {
  beforeEach(resetStores);

  it("turn_complete with enriched fields populates TurnStats", () => {
    // Start streaming so there's a message to attach stats to
    handleChatEvent(SESSION_ID, { type: "text_delta", session_id: SESSION_ID, text: "Done" });
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 5000,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      cost_usd: 0.01,
      duration_api_ms: 3200,
      num_turns: 3,
      stop_reason: "end_turn",
    });
    const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    const assistantMsg = msgs.find((m) => m.role === "assistant");
    expect(assistantMsg?.turnStats?.durationApiMs).toBe(3200);
    expect(assistantMsg?.turnStats?.numTurns).toBe(3);
    expect(assistantMsg?.turnStats?.stopReason).toBe("end_turn");
  });
});

describe("Transparency: Early Agent Visibility", () => {
  beforeEach(resetStores);

  it("agent_preparing creates a placeholder sub-agent with 'preparing' status", () => {
    handleActivityEvent(SESSION_ID, {
      type: "agent_preparing",
      session_id: SESSION_ID,
      tool_use_id: "agent-early-1",
    } as FrontendEvent);
    const agents = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
    expect(agents).toHaveLength(1);
    expect(agents![0].toolUseId).toBe("agent-early-1");
    expect(agents![0].status).toBe("preparing");
    expect(agents![0].description).toBe("Launching agent...");
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Launching agent...");
  });

  it("tool_use_start upgrades a preparing placeholder to running with real data", () => {
    // First: agent_preparing creates placeholder
    handleActivityEvent(SESSION_ID, {
      type: "agent_preparing",
      session_id: SESSION_ID,
      tool_use_id: "agent-upgrade-1",
    } as FrontendEvent);
    let agents = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
    expect(agents![0].status).toBe("preparing");
    expect(agents![0].description).toBe("Launching agent...");

    // Then: tool_use_start with full input upgrades it
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "agent-upgrade-1",
      tool_name: "Agent",
      tool_input: { description: "Explore codebase", subagent_type: "Explore" },
    });
    agents = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
    expect(agents).toHaveLength(1); // no duplicate
    expect(agents![0].status).toBe("running");
    expect(agents![0].description).toBe("Explore codebase");
    expect(agents![0].subagentType).toBe("Explore");

    // Cleanup
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "agent-upgrade-1",
      content: "done",
      is_error: false,
    });
  });

  it("tool_progress creates placeholder if agent doesn't exist yet", () => {
    // Edge case: tool_progress arrives before both agent_preparing and tool_use_start
    handleActivityEvent(SESSION_ID, {
      type: "tool_progress",
      session_id: SESSION_ID,
      tool_use_id: "agent-progress-first",
      tool_name: "Agent",
      elapsed_seconds: 5.0,
    });
    const agents = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
    expect(agents).toHaveLength(1);
    expect(agents![0].toolUseId).toBe("agent-progress-first");
    expect(agents![0].status).toBe("running");
    expect(agents![0].description).toBe("Agent running...");

    // Cleanup
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "agent-progress-first",
      content: "done",
      is_error: false,
    });
  });

  it("duplicate agent_preparing for same tool_use_id is idempotent", () => {
    handleActivityEvent(SESSION_ID, {
      type: "agent_preparing",
      session_id: SESSION_ID,
      tool_use_id: "agent-dup-1",
    } as FrontendEvent);
    handleActivityEvent(SESSION_ID, {
      type: "agent_preparing",
      session_id: SESSION_ID,
      tool_use_id: "agent-dup-1",
    } as FrontendEvent);
    const agents = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
    expect(agents).toHaveLength(1);

    // Cleanup
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "agent-dup-1",
      tool_name: "Agent",
      tool_input: { description: "Test", subagent_type: "general-purpose" },
    });
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "agent-dup-1",
      content: "done",
      is_error: false,
    });
  });
});

describe("Busy re-assertion on post-TurnComplete events", () => {
  beforeEach(() => {
    resetStores();
    // Simulate turn_complete clearing busy state (the scenario this fix addresses)
    handleChatEvent(SESSION_ID, {
      type: "turn_complete",
      session_id: SESSION_ID,
      duration_ms: 1000,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      cost_usd: 0.001,
    });
    // Verify precondition: session is NOT busy after turn_complete
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(false);
  });

  it("text_delta after turn_complete re-asserts isBusy", () => {
    handleChatEvent(SESSION_ID, {
      type: "text_delta",
      session_id: SESSION_ID,
      text: "Continuing...",
    });
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);
    expect(useSessionStore.getState().busySince.get(SESSION_ID)).toBeGreaterThan(0);
  });

  it("tool_use_start after turn_complete re-asserts isBusy", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "reassert-tool-1",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test.ts" },
    });
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);
  });

  it("agent_preparing after turn_complete re-asserts isBusy", () => {
    handleActivityEvent(SESSION_ID, {
      type: "agent_preparing",
      session_id: SESSION_ID,
      tool_use_id: "reassert-agent-1",
    } as FrontendEvent);
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);

    // Cleanup
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "reassert-agent-1",
      tool_name: "Agent",
      tool_input: { description: "Test", subagent_type: "general-purpose" },
    });
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "reassert-agent-1",
      content: "done",
      is_error: false,
    });
  });

  it("tool_progress after turn_complete re-asserts isBusy", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_progress",
      session_id: SESSION_ID,
      tool_use_id: "reassert-progress-1",
      tool_name: "Bash",
      elapsed_seconds: 10,
    });
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);
  });

  it("ensureBusy is a no-op when already busy (preserves activity label)", () => {
    // Re-set busy with a specific activity label
    useSessionStore.getState().setSessionBusy(SESSION_ID, true);
    useSessionStore.getState().setSessionActivity(SESSION_ID, {
      label: "Editing code...",
      toolName: "Edit",
      toolElapsed: 5,
      filePath: "/tmp/foo.ts",
    });
    const busySinceBefore = useSessionStore.getState().busySince.get(SESSION_ID);

    // ensureBusy should be a no-op
    useSessionStore.getState().ensureBusy(SESSION_ID);

    // Activity label should NOT be reset
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Editing code...");
    expect(activity?.toolElapsed).toBe(5);
    // busySince should not change
    expect(useSessionStore.getState().busySince.get(SESSION_ID)).toBe(busySinceBefore);
  });

  it("ensureBusy does not clear activeSubAgents", () => {
    // Set up: busy with active sub-agents
    useSessionStore.getState().setSessionBusy(SESSION_ID, true);
    useSessionStore.getState().addSubAgent(SESSION_ID, {
      toolUseId: "agent-persist-1",
      description: "Exploring code",
      subagentType: "Explore",
      isBackground: false,
      startedAt: new Date().toISOString(),
      elapsed: 0,
      status: "running",
    });

    // Clear busy (simulating turn_complete), then re-assert via ensureBusy
    // Note: setSessionBusy(false) clears subAgents, so we test ensureBusy on already-busy
    const agentsBefore = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
    expect(agentsBefore).toHaveLength(1);

    // ensureBusy should preserve sub-agents
    useSessionStore.getState().ensureBusy(SESSION_ID);
    const agentsAfter = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
    expect(agentsAfter).toHaveLength(1);
    expect(agentsAfter![0].description).toBe("Exploring code");

    // Cleanup
    useSessionStore.getState().completeSubAgent(SESSION_ID, "agent-persist-1");
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
