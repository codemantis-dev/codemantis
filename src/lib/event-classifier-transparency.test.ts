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
  });

  it("tool_use_start sets contextual activity label for Agent tool", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-4",
      tool_name: "Agent",
      tool_input: {},
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Running sub-agent...");
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
  });

  it("tool_result resets activity back to 'Thinking...'", () => {
    // First set to a tool activity
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "tool-6",
      tool_name: "Read",
      tool_input: {},
    });
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.label).toBe("Reading file...");

    // Then complete the tool
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "tool-6",
      content: "file contents",
      is_error: false,
    });
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.label).toBe("Thinking...");
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
    store.setSessionActivity(SESSION_ID, { label: "Editing code...", toolName: "Edit", toolElapsed: 0 });
    expect(useSessionStore.getState().busySince.get(SESSION_ID)).toBeGreaterThan(0);
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)?.label).toBe("Editing code...");

    // Then clear busy
    store.setSessionBusy(SESSION_ID, false);
    expect(useSessionStore.getState().busySince.get(SESSION_ID)).toBeUndefined();
    expect(useSessionStore.getState().sessionActivity.get(SESSION_ID)).toBeUndefined();
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
