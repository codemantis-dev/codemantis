import { describe, it, expect, beforeEach } from "vitest";
import { useAssistantStore } from "./assistantStore";
import type { AssistantInstance } from "./assistantStore";

function resetStore(): void {
  useAssistantStore.setState({
    projectAssistants: new Map(),
    activeAssistantId: new Map(),
    messages: new Map(),
    streaming: new Map(),
    busy: new Map(),
    sessionCost: new Map(),
  });
}

function makeInstance(overrides?: Partial<AssistantInstance>): AssistantInstance {
  return {
    id: "s1",
    projectPath: "/tmp/project",
    name: "Claude 1",
    provider: "claude-code",
    model: null,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("assistantStore", () => {
  beforeEach(resetStore);

  it("starts empty", () => {
    const state = useAssistantStore.getState();
    expect(state.projectAssistants.size).toBe(0);
    expect(state.activeAssistantId.size).toBe(0);
  });

  it("addAssistant adds instance and sets active", () => {
    const store = useAssistantStore.getState();
    const instance = makeInstance();
    store.addAssistant("/tmp/project", instance);

    expect(store.getAssistants("/tmp/project")).toHaveLength(1);
    expect(store.getActiveAssistantId("/tmp/project")).toBe("s1");
    expect(store.getTokenUsage("s1")).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("addAssistant supports multiple instances per project", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance({ id: "s1" }));
    store.addAssistant("/tmp/project", makeInstance({ id: "s2", name: "GPT 2", provider: "openai", model: "gpt-4.1", sortOrder: 2 }));

    expect(store.getAssistants("/tmp/project")).toHaveLength(2);
    // Last added becomes active
    expect(store.getActiveAssistantId("/tmp/project")).toBe("s2");
  });

  it("removeAssistant removes instance and updates active", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance({ id: "s1" }));
    store.addAssistant("/tmp/project", makeInstance({ id: "s2", sortOrder: 2 }));

    store.removeAssistant("/tmp/project", "s2");

    expect(store.getAssistants("/tmp/project")).toHaveLength(1);
    expect(store.getActiveAssistantId("/tmp/project")).toBe("s1");
  });

  it("removeAssistant cleans up session data", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance({ id: "s1" }));
    store.addMessage("s1", {
      id: "m1", role: "user", content: "hello", timestamp: "", activityIds: [], isStreaming: false,
    });
    store.addTokenUsage("s1", 100, 50);

    store.removeAssistant("/tmp/project", "s1");

    const state = useAssistantStore.getState();
    expect(state.messages.has("s1")).toBe(false);
    expect(state.streaming.has("s1")).toBe(false);
    expect(state.busy.has("s1")).toBe(false);
    expect(state.sessionCost.has("s1")).toBe(false);
  });

  it("setActiveAssistant updates active ID", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance({ id: "s1" }));
    store.addAssistant("/tmp/project", makeInstance({ id: "s2", sortOrder: 2 }));
    store.setActiveAssistant("/tmp/project", "s1");

    expect(store.getActiveAssistantId("/tmp/project")).toBe("s1");
  });

  it("addMessage stores messages per session", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance());

    store.addMessage("s1", {
      id: "m1", role: "user", content: "hello", timestamp: "", activityIds: [], isStreaming: false,
    });
    store.addMessage("s1", {
      id: "m2", role: "assistant", content: "hi", timestamp: "", activityIds: [], isStreaming: false,
    });

    const state = useAssistantStore.getState();
    expect(state.messages.get("s1")).toHaveLength(2);
  });

  it("streaming lifecycle works", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance());
    store.addMessage("s1", {
      id: "m1", role: "assistant", content: "", timestamp: "", activityIds: [], isStreaming: true,
    });

    store.startStreaming("s1", "m1");
    let state = useAssistantStore.getState();
    expect(state.streaming.get("s1")?.isStreaming).toBe(true);
    expect(state.streaming.get("s1")?.currentMessageId).toBe("m1");

    store.appendStreamingContent("s1", "Hello ");
    store.appendStreamingContent("s1", "world");
    state = useAssistantStore.getState();
    expect(state.streaming.get("s1")?.streamingContent).toBe("Hello world");

    store.finalizeStreaming("s1", "Hello world!");
    state = useAssistantStore.getState();
    expect(state.streaming.get("s1")?.isStreaming).toBe(false);
    const msgs = state.messages.get("s1") ?? [];
    expect(msgs[0].content).toBe("Hello world!");
    expect(msgs[0].isStreaming).toBe(false);
  });

  it("setBusy toggles busy state", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance());

    store.setBusy("s1", true);
    expect(useAssistantStore.getState().busy.get("s1")).toBe(true);

    store.setBusy("s1", false);
    expect(useAssistantStore.getState().busy.get("s1")).toBe(false);
  });

  it("clearMessages resets messages and streaming", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance());
    store.addMessage("s1", {
      id: "m1", role: "user", content: "hello", timestamp: "", activityIds: [], isStreaming: false,
    });
    store.startStreaming("s1", "m-stream");

    store.clearMessages("s1");
    const state = useAssistantStore.getState();
    expect(state.messages.get("s1")).toEqual([]);
    expect(state.streaming.get("s1")?.isStreaming).toBe(false);
  });

  it("addTokenUsage accumulates tokens", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance());

    store.addTokenUsage("s1", 100, 50);
    store.addTokenUsage("s1", 200, 100);

    expect(store.getTokenUsage("s1")).toEqual({ inputTokens: 300, outputTokens: 150 });
  });

  it("getTokenUsage returns zero for unknown session", () => {
    const store = useAssistantStore.getState();
    expect(store.getTokenUsage("unknown")).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("findAssistantInstance finds across projects", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance({ id: "s1" }));
    store.addAssistant("/tmp/other", makeInstance({ id: "s2", projectPath: "/tmp/other", provider: "openai", model: "gpt-4.1" }));

    const found = store.findAssistantInstance("s2");
    expect(found).toBeDefined();
    expect(found?.provider).toBe("openai");
    expect(found?.model).toBe("gpt-4.1");
  });

  it("findAssistantInstance returns undefined for missing", () => {
    expect(useAssistantStore.getState().findAssistantInstance("nope")).toBeUndefined();
  });

  it("clearProject removes all data for a project", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp/project", makeInstance({ id: "s1" }));
    store.addAssistant("/tmp/project", makeInstance({ id: "s2", sortOrder: 2 }));
    store.addMessage("s1", {
      id: "m1", role: "user", content: "hello", timestamp: "", activityIds: [], isStreaming: false,
    });
    store.addTokenUsage("s1", 100, 50);

    store.clearProject("/tmp/project");

    const state = useAssistantStore.getState();
    expect(state.projectAssistants.has("/tmp/project")).toBe(false);
    expect(state.messages.has("s1")).toBe(false);
    expect(state.sessionCost.has("s1")).toBe(false);
  });

  it("multi-project isolation", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/a", makeInstance({ id: "s1", projectPath: "/a" }));
    store.addAssistant("/b", makeInstance({ id: "s2", projectPath: "/b" }));

    expect(store.getAssistants("/a")).toHaveLength(1);
    expect(store.getAssistants("/b")).toHaveLength(1);
    expect(store.getAssistants("/c")).toHaveLength(0);
  });

  it("getAllSessionIds returns all IDs for project", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp", makeInstance({ id: "s1", projectPath: "/tmp" }));
    store.addAssistant("/tmp", makeInstance({ id: "s2", projectPath: "/tmp", sortOrder: 2 }));

    expect(store.getAllSessionIds("/tmp")).toEqual(["s1", "s2"]);
    expect(store.getAllSessionIds("/other")).toEqual([]);
  });

  it("provider and model are stored on instance", () => {
    const store = useAssistantStore.getState();
    store.addAssistant("/tmp", makeInstance({
      id: "api-1",
      provider: "openai",
      model: "gpt-4.1",
      name: "GPT 1",
    }));

    const instances = store.getAssistants("/tmp");
    expect(instances[0].provider).toBe("openai");
    expect(instances[0].model).toBe("gpt-4.1");
  });
});
