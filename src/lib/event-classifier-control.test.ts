import { describe, it, expect, beforeEach } from "vitest";
import { handleChatEvent } from "./event-classifier";
import { useSessionStore } from "../stores/sessionStore";
import type { CapabilitiesDiscoveredEvent } from "../types/claude-events";

const SESSION_ID = "control-test";

function resetStores(): void {
  const session = {
    id: SESSION_ID,
    name: "Test",
    project_path: "/tmp",
    status: "connected" as const,
    created_at: "",
    model: "claude-sonnet-4-20250514",
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
    sessionCapabilities: new Map(),
    tabOrder: [SESSION_ID],
  });
}

describe("Control Protocol: interrupt_result", () => {
  beforeEach(resetStores);

  it("successful interrupt sets activity to 'Stopping...'", () => {
    handleChatEvent(SESSION_ID, {
      type: "interrupt_result",
      session_id: SESSION_ID,
      success: true,
      error: null,
    });
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Stopping...");
    expect(activity?.toolName).toBeNull();
  });

  it("failed interrupt does not change activity", () => {
    // Set an existing activity
    useSessionStore.getState().setSessionActivity(SESSION_ID, {
      label: "Thinking...",
      toolName: null,
      toolElapsed: 0,
      filePath: null,
    });

    handleChatEvent(SESSION_ID, {
      type: "interrupt_result",
      session_id: SESSION_ID,
      success: false,
      error: "not running",
    });
    // Activity should not have changed to "Stopping..."
    const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
    expect(activity?.label).toBe("Thinking...");
  });

  it("successful interrupt does not clear busy state (left for turn_complete)", () => {
    handleChatEvent(SESSION_ID, {
      type: "interrupt_result",
      session_id: SESSION_ID,
      success: true,
      error: null,
    });
    // Busy should still be true — turn_complete will clear it
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);
  });
});

describe("Control Protocol: model_changed", () => {
  beforeEach(resetStores);

  it("successful model change updates session model", () => {
    handleChatEvent(SESSION_ID, {
      type: "model_changed",
      session_id: SESSION_ID,
      model: "haiku",
      success: true,
      error: null,
    });
    const session = useSessionStore.getState().sessions.get(SESSION_ID);
    expect(session?.model).toBe("haiku");
  });

  it("failed model change does not update session model", () => {
    handleChatEvent(SESSION_ID, {
      type: "model_changed",
      session_id: SESSION_ID,
      model: "nonexistent",
      success: false,
      error: "invalid model",
    });
    // Model should remain unchanged
    const session = useSessionStore.getState().sessions.get(SESSION_ID);
    expect(session?.model).toBe("claude-sonnet-4-20250514");
  });

  it("successful model change with opus model", () => {
    handleChatEvent(SESSION_ID, {
      type: "model_changed",
      session_id: SESSION_ID,
      model: "opus[1m]",
      success: true,
      error: null,
    });
    const session = useSessionStore.getState().sessions.get(SESSION_ID);
    expect(session?.model).toBe("opus[1m]");
  });
});

describe("Control Protocol: capabilities_discovered", () => {
  beforeEach(resetStores);

  it("stores capabilities in sessionCapabilities map", () => {
    const capsEvent: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: SESSION_ID,
      models: [
        { value: "sonnet", displayName: "Sonnet", description: "Fast" },
        { value: "opus[1m]", displayName: "Opus (1M)", description: "Extended" },
      ],
      commands: [
        { name: "compact", description: "Compact context" },
      ],
      agents: [],
      account: { email: "test@example.com", organization: "Test Org", subscriptionType: "max" },
      output_styles: ["text", "json"],
    };

    handleChatEvent(SESSION_ID, capsEvent);
    const caps = useSessionStore.getState().sessionCapabilities.get(SESSION_ID);
    expect(caps).toBeDefined();
    expect(caps?.models).toHaveLength(2);
    expect(caps?.models[0].value).toBe("sonnet");
    expect(caps?.commands).toHaveLength(1);
    expect(caps?.account?.email).toBe("test@example.com");
    expect(caps?.output_styles).toEqual(["text", "json"]);
  });

  it("capabilities_discovered with empty arrays", () => {
    handleChatEvent(SESSION_ID, {
      type: "capabilities_discovered",
      session_id: SESSION_ID,
      models: [],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    });
    const caps = useSessionStore.getState().sessionCapabilities.get(SESSION_ID);
    expect(caps).toBeDefined();
    expect(caps?.models).toEqual([]);
    expect(caps?.account).toBeNull();
  });

  it("capabilities_discovered does not affect busy state", () => {
    handleChatEvent(SESSION_ID, {
      type: "capabilities_discovered",
      session_id: SESSION_ID,
      models: [],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    });
    // Should still be busy (capabilities are discovered in background)
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);
  });

  it("capabilities overwrite previous capabilities", () => {
    // First discovery
    handleChatEvent(SESSION_ID, {
      type: "capabilities_discovered",
      session_id: SESSION_ID,
      models: [{ value: "sonnet", displayName: "Sonnet", description: "Fast" }],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    });
    expect(useSessionStore.getState().sessionCapabilities.get(SESSION_ID)?.models).toHaveLength(1);

    // Second discovery (e.g., after resume) overwrites
    handleChatEvent(SESSION_ID, {
      type: "capabilities_discovered",
      session_id: SESSION_ID,
      models: [
        { value: "sonnet", displayName: "Sonnet", description: "Fast" },
        { value: "opus", displayName: "Opus", description: "Powerful" },
        { value: "haiku", displayName: "Haiku", description: "Quick" },
      ],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    });
    expect(useSessionStore.getState().sessionCapabilities.get(SESSION_ID)?.models).toHaveLength(3);
  });
});

describe("Control Protocol: clearSessionData cleans up capabilities", () => {
  beforeEach(resetStores);

  it("clearSessionData removes capabilities", () => {
    handleChatEvent(SESSION_ID, {
      type: "capabilities_discovered",
      session_id: SESSION_ID,
      models: [{ value: "sonnet", displayName: "Sonnet", description: "Fast" }],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    });
    expect(useSessionStore.getState().sessionCapabilities.get(SESSION_ID)).toBeDefined();

    useSessionStore.getState().clearSessionData(SESSION_ID);
    expect(useSessionStore.getState().sessionCapabilities.get(SESSION_ID)).toBeUndefined();
  });
});
