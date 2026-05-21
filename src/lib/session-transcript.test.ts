import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { resetAllStores } from "../test/helpers/store-reset";
import { mockInvoke } from "../test/helpers/tauri-mock-factory";
import type { Session, Message } from "../types/session";
import {
  scheduleFlushTranscript,
  __cancelAllFlushesForTests,
  __FLUSH_DEBOUNCE_MS_FOR_TESTS,
} from "./session-transcript";

function makeSession(id: string, projectPath: string, name = id): Session {
  return {
    id,
    name,
    project_path: projectPath,
    status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    model: null,
    icon_index: 0,
  };
}

function makeMessage(id: string, content: string): Message {
  return {
    id,
    role: "user",
    content,
    timestamp: "2026-01-01T00:00:00Z",
    activityIds: [],
    isStreaming: false,
  };
}

describe("scheduleFlushTranscript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllStores();
    __cancelAllFlushesForTests();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        sessionLogsEnabled: true,
      },
    });
    mockInvoke({ save_session_messages: () => undefined });
  });

  it("flushes once after the debounce window", async () => {
    const saveCalls: Array<{ sessionId: string; count: number }> = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        const a = args as { sessionId: string; messages: unknown[] };
        saveCalls.push({ sessionId: a.sessionId, count: a.messages.length });
        return undefined;
      },
    });
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    useSessionStore.getState().addMessage("s1", makeMessage("m1", "hi"));

    scheduleFlushTranscript("s1");

    // Before the debounce elapses, nothing has fired.
    await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS - 50);
    expect(saveCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(saveCalls).toEqual([{ sessionId: "s1", count: 1 }]);
  });

  it("coalesces rapid calls into a single save", async () => {
    const saveCalls: string[] = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        saveCalls.push((args as { sessionId: string }).sessionId);
        return undefined;
      },
    });
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    useSessionStore.getState().addMessage("s1", makeMessage("m1", "a"));

    scheduleFlushTranscript("s1");
    await vi.advanceTimersByTimeAsync(100);
    scheduleFlushTranscript("s1");
    await vi.advanceTimersByTimeAsync(100);
    useSessionStore.getState().addMessage("s1", makeMessage("m2", "b"));
    scheduleFlushTranscript("s1");

    await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);
    expect(saveCalls).toEqual(["s1"]);
  });

  it("does nothing when sessionLogsEnabled is false", async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        sessionLogsEnabled: false,
      },
    });
    const saveCalls: string[] = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        saveCalls.push((args as { sessionId: string }).sessionId);
        return undefined;
      },
    });
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    useSessionStore.getState().addMessage("s1", makeMessage("m1", "hi"));

    scheduleFlushTranscript("s1");
    await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);

    expect(saveCalls).toHaveLength(0);
  });

  it("does nothing when message list is empty", async () => {
    const saveCalls: string[] = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        saveCalls.push((args as { sessionId: string }).sessionId);
        return undefined;
      },
    });
    useSessionStore.getState().addSession(makeSession("s1", "/p"));

    scheduleFlushTranscript("s1");
    await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);

    expect(saveCalls).toHaveLength(0);
  });

  it("skips paused-recovered sessions", async () => {
    const saveCalls: string[] = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        saveCalls.push((args as { sessionId: string }).sessionId);
        return undefined;
      },
    });
    const recovered: Session = {
      ...makeSession("recovered", "/p"),
      status: "paused-recovered",
    };
    useSessionStore.getState().addSession(recovered);
    useSessionStore.getState().addMessage("recovered", makeMessage("m1", "old"));

    scheduleFlushTranscript("recovered");
    await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);

    expect(saveCalls).toHaveLength(0);
  });

  it("flushes per-session independently", async () => {
    const saveCalls: string[] = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        saveCalls.push((args as { sessionId: string }).sessionId);
        return undefined;
      },
    });
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    useSessionStore.getState().addSession(makeSession("s2", "/p"));
    useSessionStore.getState().addMessage("s1", makeMessage("m1", "x"));
    useSessionStore.getState().addMessage("s2", makeMessage("m2", "y"));

    scheduleFlushTranscript("s1");
    scheduleFlushTranscript("s2");

    await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);

    expect(saveCalls.sort()).toEqual(["s1", "s2"]);
  });
});
