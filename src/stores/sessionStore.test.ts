import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./sessionStore";
import type { Session } from "../types/session";

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
    useSessionStore.getState().updateModel("s1", "claude-opus-4-6");
    expect(useSessionStore.getState().sessions.get("s1")?.model).toBe("claude-opus-4-6");
  });

  it("updateContext sets context for session", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useSessionStore.getState().updateContext("s1", 5000, 200000);
    expect(useSessionStore.getState().sessionContext.get("s1")).toEqual({ used: 5000, max: 200000 });
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
});
