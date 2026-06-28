import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./sessionStore";
import { useSelfDriveStore } from "./selfDriveStore";
import type { Session } from "../types/session";
import type { CapabilitiesDiscoveredEvent } from "../types/claude-events";

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
    activeSubAgents: new Map(),
    sessionThinking: new Map(),
    tabOrder: [],
  });
}

describe("sessionStore", () => {
  beforeEach(resetStore);

  it("starts with no sessions", () => {
    const state = useSessionStore.getState();
    expect(state.sessions.size).toBe(0);
    expect(state.activeSessionId).toBeNull();
    expect(state.tabOrder).toEqual([]);
  });

  it("addSession stores session and sets it active", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    const state = useSessionStore.getState();
    expect(state.sessions.get("s1")).toEqual(TEST_SESSION);
    expect(state.activeSessionId).toBe("s1");
    expect(state.tabOrder).toEqual(["s1"]);
    expect(state.sessionMessages.get("s1")).toEqual([]);
  });

  it("registerBackgroundSession adds to sessions WITHOUT touching tabOrder or activeSessionId", () => {
    const duo: Session = { ...TEST_SESSION, id: "duo-1", duoRole: "primary" };
    useSessionStore.getState().registerBackgroundSession(duo);
    const state = useSessionStore.getState();
    expect(state.sessions.get("duo-1")?.duoRole).toBe("primary");
    expect(state.sessionMessages.get("duo-1")).toEqual([]);
    expect(state.sessionStreaming.get("duo-1")).toBeDefined();
    // The key invariant: no tab, no focus steal.
    expect(state.tabOrder).toEqual([]);
    expect(state.activeSessionId).toBeNull();
  });

  it("registerBackgroundSession does not disturb the active session", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().registerBackgroundSession({ ...TEST_SESSION, id: "duo-1", duoRole: "mentor" });
    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe("s1"); // unchanged
    expect(state.tabOrder).toEqual(["s1"]); // duo-1 absent
    expect(state.sessions.has("duo-1")).toBe(true);
  });

  it("removeBackgroundSession clears its per-id state", () => {
    useSessionStore.getState().registerBackgroundSession({ ...TEST_SESSION, id: "duo-1", duoRole: "primary" });
    useSessionStore.getState().removeBackgroundSession("duo-1");
    const state = useSessionStore.getState();
    expect(state.sessions.has("duo-1")).toBe(false);
    expect(state.sessionMessages.has("duo-1")).toBe(false);
    expect(state.sessionStreaming.has("duo-1")).toBe(false);
  });

  it("removeSession clears data and selects adjacent tab", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addSession({ ...TEST_SESSION, id: "s2", name: "Test2" });
    useSessionStore.getState().setActiveSession("s1");
    useSessionStore.getState().removeSession("s1");
    const state = useSessionStore.getState();
    expect(state.sessions.has("s1")).toBe(false);
    expect(state.activeSessionId).toBe("s2");
    expect(state.tabOrder).toEqual(["s2"]);
  });

  it("removeSession sets null when last session removed", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().removeSession("s1");
    expect(useSessionStore.getState().activeSessionId).toBeNull();
    expect(useSessionStore.getState().tabOrder).toEqual([]);
  });

  it("renameSession updates session name", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().renameSession("s1", "Renamed");
    expect(useSessionStore.getState().sessions.get("s1")?.name).toBe("Renamed");
  });

  it("addMessage appends to session messages", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addMessage("s1", {
      id: "m1",
      role: "user",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00Z",
      activityIds: [],
      isStreaming: false,
    });
    expect(useSessionStore.getState().sessionMessages.get("s1")?.length).toBe(1);
    expect(useSessionStore.getState().sessionMessages.get("s1")?.[0].content).toBe("Hello");
  });

  it("addMessage preserves existing messages", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addMessage("s1", {
      id: "m1", role: "user", content: "First", timestamp: "", activityIds: [], isStreaming: false,
    });
    useSessionStore.getState().addMessage("s1", {
      id: "m2", role: "assistant", content: "Second", timestamp: "", activityIds: [], isStreaming: false,
    });
    const msgs = useSessionStore.getState().sessionMessages.get("s1") ?? [];
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe("First");
    expect(msgs[1].content).toBe("Second");
  });

  it("startStreaming sets streaming state for session", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().startStreaming("s1", "m1");
    const streaming = useSessionStore.getState().sessionStreaming.get("s1");
    expect(streaming?.isStreaming).toBe(true);
    expect(streaming?.streamingContent).toBe("");
    expect(streaming?.currentMessageId).toBe("m1");
  });

  it("appendStreamingContent accumulates text", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().startStreaming("s1", "m1");
    useSessionStore.getState().appendStreamingContent("s1", "Hello");
    useSessionStore.getState().appendStreamingContent("s1", " world");
    expect(useSessionStore.getState().sessionStreaming.get("s1")?.streamingContent).toBe("Hello world");
  });

  it("finalizeStreaming updates message and clears streaming", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addMessage("s1", {
      id: "m1", role: "assistant", content: "", timestamp: "", activityIds: [], isStreaming: true,
    });
    useSessionStore.getState().startStreaming("s1", "m1");
    useSessionStore.getState().appendStreamingContent("s1", "Hello world");
    useSessionStore.getState().finalizeStreaming("s1");
    const streaming = useSessionStore.getState().sessionStreaming.get("s1");
    expect(streaming?.isStreaming).toBe(false);
    expect(streaming?.streamingContent).toBe("");
    const msgs = useSessionStore.getState().sessionMessages.get("s1") ?? [];
    expect(msgs[0].content).toBe("Hello world");
    expect(msgs[0].isStreaming).toBe(false);
  });

  it("finalizeStreaming with fullText uses provided text", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addMessage("s1", {
      id: "m1", role: "assistant", content: "", timestamp: "", activityIds: [], isStreaming: true,
    });
    useSessionStore.getState().startStreaming("s1", "m1");
    useSessionStore.getState().appendStreamingContent("s1", "partial");
    useSessionStore.getState().finalizeStreaming("s1", "Complete text");
    const msgs = useSessionStore.getState().sessionMessages.get("s1") ?? [];
    expect(msgs[0].content).toBe("Complete text");
  });

  it("finalizeStreaming with no currentMessageId is safe", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().finalizeStreaming("s1");
    const streaming = useSessionStore.getState().sessionStreaming.get("s1");
    expect(streaming?.isStreaming).toBe(false);
  });

  it("updateModel updates session model", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().updateModel("s1", "claude-opus-4-8");
    expect(useSessionStore.getState().sessions.get("s1")?.model).toBe("claude-opus-4-8");
  });

  it("updateContext sets context for session", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().updateContext("s1", 5000, 200000);
    expect(useSessionStore.getState().sessionContext.get("s1")).toEqual({ used: 5000, max: 200000 });
  });

  describe("markContextCompacted", () => {
    it("sets a pending post-compaction value, preserving max", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().updateContext("s1", 973000, 1_000_000);
      useSessionStore.getState().markContextCompacted("s1", 3367);
      expect(useSessionStore.getState().sessionContext.get("s1")).toEqual({
        used: 3367,
        max: 1_000_000,
        pending: true,
      });
    });

    it("keeps prior used (still pending) when postTokens is null", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().updateContext("s1", 50000, 200000);
      useSessionStore.getState().markContextCompacted("s1", null);
      expect(useSessionStore.getState().sessionContext.get("s1")).toEqual({
        used: 50000,
        max: 200000,
        pending: true,
      });
    });

    it("updateContext clears the pending flag", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().markContextCompacted("s1", 3367);
      expect(useSessionStore.getState().sessionContext.get("s1")?.pending).toBe(true);
      useSessionStore.getState().updateContext("s1", 23558, 1_000_000);
      expect(useSessionStore.getState().sessionContext.get("s1")?.pending).toBeUndefined();
    });
  });

  it("resetContextToastFired clears the fired-threshold set", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().markContextToastFired("s1", 80);
    expect(useSessionStore.getState().contextToastFired.get("s1")?.has(80)).toBe(true);
    useSessionStore.getState().resetContextToastFired("s1");
    expect(useSessionStore.getState().contextToastFired.get("s1")?.size).toBe(0);
  });

  it("clearSessionData resets messages/streaming/context", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addMessage("s1", {
      id: "m1", role: "user", content: "Hello", timestamp: "", activityIds: [], isStreaming: false,
    });
    useSessionStore.getState().startStreaming("s1", "m2");
    useSessionStore.getState().clearSessionData("s1");
    expect(useSessionStore.getState().sessionMessages.get("s1")).toEqual([]);
    expect(useSessionStore.getState().sessionStreaming.get("s1")?.isStreaming).toBe(false);
  });

  it("setSessionCapabilities stores and retrieves capabilities", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    const caps: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s1",
      models: [{ value: "sonnet", displayName: "Sonnet", description: "Fast" }],
      commands: [{ name: "compact", description: "Compact" }],
      agents: [],
      account: null,
      output_styles: ["text"],
    };
    useSessionStore.getState().setSessionCapabilities("s1", caps);
    const stored = useSessionStore.getState().sessionCapabilities.get("s1");
    expect(stored).toBeDefined();
    expect(stored?.models).toHaveLength(1);
    expect(stored?.models[0].value).toBe("sonnet");
    expect(stored?.commands[0].name).toBe("compact");
    expect(stored?.output_styles).toEqual(["text"]);
  });

  it("setSessionCapabilities overwrites previous value", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    const caps1: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s1",
      models: [{ value: "sonnet", displayName: "Sonnet", description: "Fast" }],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    useSessionStore.getState().setSessionCapabilities("s1", caps1);
    expect(useSessionStore.getState().sessionCapabilities.get("s1")?.models).toHaveLength(1);

    const caps2: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s1",
      models: [
        { value: "sonnet", displayName: "Sonnet", description: "Fast" },
        { value: "opus", displayName: "Opus", description: "Smart" },
      ],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    useSessionStore.getState().setSessionCapabilities("s1", caps2);
    expect(useSessionStore.getState().sessionCapabilities.get("s1")?.models).toHaveLength(2);
  });

  it("clearSessionData preserves capabilities (the CLI is respawned, not changed)", () => {
    // `/clear` clears the conversation and respawns the SAME CLI process via
    // pause+resume — which does not re-run the initialize handshake. The live
    // model list and effort levels are therefore unchanged and must survive,
    // or ModelSelector reverts to its reduced hardcoded list and EffortSelector
    // hides entirely after every `/clear`.
    useSessionStore.getState().addSession(TEST_SESSION);
    const caps: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s1",
      models: [{ value: "sonnet", displayName: "Sonnet", description: "Fast" }],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    useSessionStore.getState().setSessionCapabilities("s1", caps);
    useSessionStore.getState().addMessage("s1", {
      id: "m1", role: "user", content: "Hello", timestamp: "", activityIds: [], isStreaming: false,
    });
    useSessionStore.getState().clearSessionData("s1");
    // Conversation cleared…
    expect(useSessionStore.getState().sessionMessages.get("s1")).toEqual([]);
    // …but capabilities retained.
    expect(useSessionStore.getState().sessionCapabilities.get("s1")?.models[0].value).toBe("sonnet");
  });

  it("capabilities are isolated between sessions", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addSession({ ...TEST_SESSION, id: "s2", name: "Test2" });
    const caps1: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s1",
      models: [{ value: "sonnet", displayName: "Sonnet", description: "" }],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    const caps2: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s2",
      models: [{ value: "opus", displayName: "Opus", description: "" }],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    useSessionStore.getState().setSessionCapabilities("s1", caps1);
    useSessionStore.getState().setSessionCapabilities("s2", caps2);
    expect(useSessionStore.getState().sessionCapabilities.get("s1")?.models[0].value).toBe("sonnet");
    expect(useSessionStore.getState().sessionCapabilities.get("s2")?.models[0].value).toBe("opus");
  });

  describe("incrementSubAgentToolCount", () => {
    it("increments toolCount on matching agent", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().addSubAgent("s1", {
        toolUseId: "agent-1",
        description: "Search codebase",
        subagentType: "Explore",
        isBackground: false,
        startedAt: "2026-01-01T00:00:00Z",
        elapsed: 0,
        status: "running",
      });

      useSessionStore.getState().incrementSubAgentToolCount("s1", "agent-1");
      const agents = useSessionStore.getState().activeSubAgents.get("s1") ?? [];
      expect(agents[0].toolCount).toBe(1);

      useSessionStore.getState().incrementSubAgentToolCount("s1", "agent-1");
      const agents2 = useSessionStore.getState().activeSubAgents.get("s1") ?? [];
      expect(agents2[0].toolCount).toBe(2);
    });

    it("initializes toolCount from undefined to 1", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().addSubAgent("s1", {
        toolUseId: "agent-1",
        description: "Test",
        subagentType: "general-purpose",
        isBackground: false,
        startedAt: "2026-01-01T00:00:00Z",
        elapsed: 0,
        status: "running",
      });

      // toolCount starts undefined
      expect(useSessionStore.getState().activeSubAgents.get("s1")?.[0].toolCount).toBeUndefined();

      useSessionStore.getState().incrementSubAgentToolCount("s1", "agent-1");
      expect(useSessionStore.getState().activeSubAgents.get("s1")?.[0].toolCount).toBe(1);
    });

    it("does not affect other agents in same session", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().addSubAgent("s1", {
        toolUseId: "agent-1", description: "First", subagentType: "general-purpose",
        isBackground: false, startedAt: "2026-01-01T00:00:00Z", elapsed: 0, status: "running",
      });
      useSessionStore.getState().addSubAgent("s1", {
        toolUseId: "agent-2", description: "Second", subagentType: "general-purpose",
        isBackground: false, startedAt: "2026-01-01T00:00:01Z", elapsed: 0, status: "running",
      });

      useSessionStore.getState().incrementSubAgentToolCount("s1", "agent-1");
      const agents = useSessionStore.getState().activeSubAgents.get("s1") ?? [];
      expect(agents[0].toolCount).toBe(1);
      expect(agents[1].toolCount).toBeUndefined();
    });

    it("no-ops when session has no agents", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      // Should not throw
      useSessionStore.getState().incrementSubAgentToolCount("s1", "nonexistent");
      expect(useSessionStore.getState().activeSubAgents.get("s1")).toBeUndefined();
    });
  });

  describe("thinking actions", () => {
    it("startThinking sets isThinking and clears content", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.isThinking).toBe(true);
      expect(thinking?.content).toBe("");
    });

    it("appendThinkingContent accumulates text", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "First ");
      useSessionStore.getState().appendThinkingContent("s1", "second.");
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.content).toBe("First second.");
      expect(thinking?.isThinking).toBe(true);
    });

    it("appendThinkingContent works without prior startThinking", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().appendThinkingContent("s1", "Hello");
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.content).toBe("Hello");
      expect(thinking?.isThinking).toBe(true);
    });

    it("finalizeThinking sets isThinking false and preserves content", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "Reasoning...");
      useSessionStore.getState().finalizeThinking("s1");
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.isThinking).toBe(false);
      expect(thinking?.content).toBe("Reasoning...");
    });

    it("finalizeThinking with fullText overrides accumulated content", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "partial");
      useSessionStore.getState().finalizeThinking("s1", "Complete thinking text");
      const thinking = useSessionStore.getState().sessionThinking.get("s1");
      expect(thinking?.content).toBe("Complete thinking text");
    });

    it("finalizeThinking attaches thinkingContent to current streaming message", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().addMessage("s1", {
        id: "m1", role: "assistant", content: "", timestamp: "", activityIds: [], isStreaming: true,
      });
      useSessionStore.getState().startStreaming("s1", "m1");
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "My reasoning");
      useSessionStore.getState().finalizeThinking("s1");
      const msgs = useSessionStore.getState().sessionMessages.get("s1") ?? [];
      expect(msgs[0].thinkingContent).toBe("My reasoning");
    });

    it("finalizeThinking does not crash when no streaming message exists", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "text");
      // Should not throw
      useSessionStore.getState().finalizeThinking("s1");
      expect(useSessionStore.getState().sessionThinking.get("s1")?.isThinking).toBe(false);
    });

    it("startThinking clears previous thinking content", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "old thinking");
      useSessionStore.getState().startThinking("s1");
      expect(useSessionStore.getState().sessionThinking.get("s1")?.content).toBe("");
    });

    it("removeSession cleans up sessionThinking", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "text");
      useSessionStore.getState().removeSession("s1");
      expect(useSessionStore.getState().sessionThinking.get("s1")).toBeUndefined();
    });

    it("clearSessionData cleans up sessionThinking", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "text");
      useSessionStore.getState().clearSessionData("s1");
      expect(useSessionStore.getState().sessionThinking.get("s1")).toBeUndefined();
    });

    it("thinking is isolated between sessions", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().addSession({ ...TEST_SESSION, id: "s2", name: "Test2" });
      useSessionStore.getState().startThinking("s1");
      useSessionStore.getState().appendThinkingContent("s1", "Session 1 thinking");
      useSessionStore.getState().startThinking("s2");
      useSessionStore.getState().appendThinkingContent("s2", "Session 2 thinking");
      expect(useSessionStore.getState().sessionThinking.get("s1")?.content).toBe("Session 1 thinking");
      expect(useSessionStore.getState().sessionThinking.get("s2")?.content).toBe("Session 2 thinking");
    });
  });

  it("multi-session isolation", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().addSession({ ...TEST_SESSION, id: "s2", name: "Test2" });
    useSessionStore.getState().addMessage("s1", {
      id: "m1", role: "user", content: "Session1", timestamp: "", activityIds: [], isStreaming: false,
    });
    useSessionStore.getState().addMessage("s2", {
      id: "m2", role: "user", content: "Session2", timestamp: "", activityIds: [], isStreaming: false,
    });
    expect(useSessionStore.getState().sessionMessages.get("s1")?.length).toBe(1);
    expect(useSessionStore.getState().sessionMessages.get("s2")?.length).toBe(1);
    expect(useSessionStore.getState().sessionMessages.get("s1")?.[0].content).toBe("Session1");
    expect(useSessionStore.getState().sessionMessages.get("s2")?.[0].content).toBe("Session2");
  });

  describe("pendingInterruptNote (interrupt-cancel clarification)", () => {
    it("flagInterruptNote sets and clearInterruptNote removes the flag", () => {
      const store = useSessionStore.getState();
      store.flagInterruptNote("s1");
      expect(useSessionStore.getState().pendingInterruptNote.get("s1")).toBe(true);
      store.clearInterruptNote("s1");
      expect(useSessionStore.getState().pendingInterruptNote.has("s1")).toBe(false);
    });

    it("removeSession evicts the pending interrupt note", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().flagInterruptNote("s1");
      useSessionStore.getState().removeSession("s1");
      expect(useSessionStore.getState().pendingInterruptNote.has("s1")).toBe(false);
    });
  });

  describe("pendingRecapPrefix (Codex recover)", () => {
    it("setRecapPrefix stores and clearRecapPrefix removes the recap", () => {
      const store = useSessionStore.getState();
      store.setRecapPrefix("s1", "recap text");
      expect(useSessionStore.getState().pendingRecapPrefix.get("s1")).toBe("recap text");
      store.clearRecapPrefix("s1");
      expect(useSessionStore.getState().pendingRecapPrefix.has("s1")).toBe(false);
    });

    it("removeSession evicts the pending recap prefix", () => {
      useSessionStore.getState().addSession(TEST_SESSION);
      useSessionStore.getState().setRecapPrefix("s1", "recap");
      useSessionStore.getState().removeSession("s1");
      expect(useSessionStore.getState().pendingRecapPrefix.has("s1")).toBe(false);
    });
  });
});

// Auto-clear stale Self-Drive state when its owning project is evicted.
// Regression for "Self-Drive is already paused for another project" toast
// firing after the owning project had already been closed.
describe("sessionStore — removes Self-Drive ownership when last session of a project is gone", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      activeSubAgents: new Map(),
      sessionThinking: new Map(),
      tabOrder: [],
      projectOrder: [],
      projectActiveSession: new Map(),
      activeProjectPath: null,
    });
    useSelfDriveStore.setState({
      status: "idle",
      projectPath: null,
      sessionId: null,
      needsSessionAttach: false,
      pauseReason: null,
    });
  });

  it("force-resets Self-Drive when its owning project is fully removed", async () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    // Pretend Self-Drive is paused for this project (post-restart rehydration
    // shape).
    useSelfDriveStore.setState({
      status: "paused",
      projectPath: TEST_SESSION.project_path,
      sessionId: "dead-session",
      needsSessionAttach: true,
      pauseReason: "Restart detected",
    });

    useSessionStore.getState().removeSession(TEST_SESSION.id);
    // The cleanup uses a dynamic import + forceReset (which awaits the
    // mocked listSelfDriveStates invoke). Flush the macrotask queue so
    // those microtasks run before we assert.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const sd = useSelfDriveStore.getState();
    expect(sd.status).toBe("idle");
    expect(sd.projectPath).toBeNull();
    expect(sd.sessionId).toBeNull();
    expect(sd.needsSessionAttach).toBe(false);
  });

  it("leaves Self-Drive state alone when a session is removed but the project still has other sessions", async () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore
      .getState()
      .addSession({ ...TEST_SESSION, id: "s2", name: "Test2" });
    useSelfDriveStore.setState({
      status: "paused",
      projectPath: TEST_SESSION.project_path,
      sessionId: "live-session",
      needsSessionAttach: false,
    });

    useSessionStore.getState().removeSession(TEST_SESSION.id);
    await new Promise((r) => setTimeout(r, 0));

    // Project still has s2 → Self-Drive ownership must be preserved.
    const sd = useSelfDriveStore.getState();
    expect(sd.projectPath).toBe(TEST_SESSION.project_path);
    expect(sd.status).toBe("paused");
  });

  it("does not touch Self-Drive state when the removed project is not the owner", async () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSelfDriveStore.setState({
      status: "paused",
      projectPath: "/somewhere/else",
      sessionId: "other-session",
      needsSessionAttach: true,
    });

    useSessionStore.getState().removeSession(TEST_SESSION.id);
    await new Promise((r) => setTimeout(r, 0));

    const sd = useSelfDriveStore.getState();
    expect(sd.projectPath).toBe("/somewhere/else");
    expect(sd.status).toBe("paused");
  });
});
