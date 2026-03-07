import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./sessionStore";

describe("sessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: null,
      messages: [],
      isStreaming: false,
      streamingContent: "",
      currentMessageId: null,
    });
  });

  it("starts with null session and empty messages", () => {
    const state = useSessionStore.getState();
    expect(state.session).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.isStreaming).toBe(false);
    expect(state.streamingContent).toBe("");
  });

  it("setSession stores session info", () => {
    const session = {
      id: "s1",
      name: "Test",
      project_path: "/tmp/test",
      status: "connected" as const,
      created_at: "2026-01-01T00:00:00Z",
      model: "sonnet",
    };
    useSessionStore.getState().setSession(session);
    expect(useSessionStore.getState().session).toEqual(session);
  });

  it("setSession can clear session to null", () => {
    useSessionStore.getState().setSession({
      id: "s1",
      name: "Test",
      project_path: "/tmp",
      status: "connected",
      created_at: "",
      model: null,
    });
    useSessionStore.getState().setSession(null);
    expect(useSessionStore.getState().session).toBeNull();
  });

  it("addMessage appends to messages array", () => {
    const msg = {
      id: "m1",
      role: "user" as const,
      content: "Hello",
      timestamp: "2026-01-01T00:00:00Z",
      activityIds: [],
      isStreaming: false,
    };
    useSessionStore.getState().addMessage(msg);
    expect(useSessionStore.getState().messages).toHaveLength(1);
    expect(useSessionStore.getState().messages[0].content).toBe("Hello");
  });

  it("addMessage preserves existing messages", () => {
    useSessionStore.getState().addMessage({
      id: "m1",
      role: "user",
      content: "First",
      timestamp: "",
      activityIds: [],
      isStreaming: false,
    });
    useSessionStore.getState().addMessage({
      id: "m2",
      role: "assistant",
      content: "Second",
      timestamp: "",
      activityIds: [],
      isStreaming: false,
    });
    expect(useSessionStore.getState().messages).toHaveLength(2);
    expect(useSessionStore.getState().messages[0].content).toBe("First");
    expect(useSessionStore.getState().messages[1].content).toBe("Second");
  });

  it("startStreaming sets streaming state", () => {
    useSessionStore.getState().startStreaming("m1");
    const state = useSessionStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.streamingContent).toBe("");
    expect(state.currentMessageId).toBe("m1");
  });

  it("appendStreamingContent accumulates text", () => {
    useSessionStore.getState().startStreaming("m1");
    useSessionStore.getState().appendStreamingContent("Hello");
    useSessionStore.getState().appendStreamingContent(" world");
    expect(useSessionStore.getState().streamingContent).toBe("Hello world");
  });

  it("finalizeStreaming updates message content and clears streaming", () => {
    // Add a streaming message first
    useSessionStore.getState().addMessage({
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: "",
      activityIds: [],
      isStreaming: true,
    });
    useSessionStore.getState().startStreaming("m1");
    useSessionStore.getState().appendStreamingContent("Hello world");
    useSessionStore.getState().finalizeStreaming();

    const state = useSessionStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.streamingContent).toBe("");
    expect(state.currentMessageId).toBeNull();
    expect(state.messages[0].content).toBe("Hello world");
    expect(state.messages[0].isStreaming).toBe(false);
  });

  it("finalizeStreaming with fullText uses provided text", () => {
    useSessionStore.getState().addMessage({
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: "",
      activityIds: [],
      isStreaming: true,
    });
    useSessionStore.getState().startStreaming("m1");
    useSessionStore.getState().appendStreamingContent("partial");
    useSessionStore.getState().finalizeStreaming("Complete text here");

    expect(useSessionStore.getState().messages[0].content).toBe(
      "Complete text here"
    );
  });

  it("finalizeStreaming with no currentMessageId is safe", () => {
    useSessionStore.getState().finalizeStreaming();
    expect(useSessionStore.getState().isStreaming).toBe(false);
  });

  it("updateModel updates session model", () => {
    useSessionStore.getState().setSession({
      id: "s1",
      name: "Test",
      project_path: "/tmp",
      status: "connected",
      created_at: "",
      model: null,
    });
    useSessionStore.getState().updateModel("claude-opus-4-6");
    expect(useSessionStore.getState().session?.model).toBe("claude-opus-4-6");
  });

  it("updateModel with no session does nothing", () => {
    useSessionStore.getState().updateModel("opus");
    expect(useSessionStore.getState().session).toBeNull();
  });

  it("clearMessages resets all message state", () => {
    useSessionStore.getState().addMessage({
      id: "m1",
      role: "user",
      content: "Hello",
      timestamp: "",
      activityIds: [],
      isStreaming: false,
    });
    useSessionStore.getState().startStreaming("m2");
    useSessionStore.getState().appendStreamingContent("partial");
    useSessionStore.getState().clearMessages();

    const state = useSessionStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.streamingContent).toBe("");
    expect(state.isStreaming).toBe(false);
  });
});
