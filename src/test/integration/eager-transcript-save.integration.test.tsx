/**
 * Integration test: eager per-message transcript persistence.
 *
 * Crash-recovery only works if `session_messages` rows exist in SQLite at the
 * moment of the crash. The 60s safety-net snapshot leaves a 60s gap. This
 * test exercises the eager path: a user-prompt submit and an assistant
 * turn_complete event both trigger a debounced flush via
 * `scheduleFlushTranscript`.
 *
 * Only the Tauri IPC boundary is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session, SessionMessagePayload } from "../../types/session";
import type { TurnCompleteEvent } from "../../types/agent-events";
import { __cancelAllFlushesForTests, __FLUSH_DEBOUNCE_MS_FOR_TESTS } from "../../lib/session-transcript";

const {
  saveSessionMessagesMock,
  sendMessageMock,
} = vi.hoisted(() => ({
  saveSessionMessagesMock: vi.fn<(sessionId: string, messages: SessionMessagePayload[]) => Promise<void>>(),
  sendMessageMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock("../../lib/tauri-commands", () => ({
  saveSessionMessages: saveSessionMessagesMock,
  sendMessage: sendMessageMock,
  createSession: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => {}),
  listenActivityEvents: vi.fn().mockResolvedValue(() => {}),
  initializeSession: vi.fn().mockResolvedValue(undefined),
  loadSessionMessages: vi.fn().mockResolvedValue([]),
  closeTerminal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/event-classifier", () => ({
  handleChatEvent: vi.fn(),
  handleActivityEvent: vi.fn(),
  startStaleDetection: vi.fn(),
  cleanupSession: vi.fn(),
}));

vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

vi.mock("../../lib/error-messages", () => ({
  translateErrorForToast: vi.fn((m: string) => m),
  translateError: vi.fn(() => ({ title: "Error", details: "test" })),
}));

import { useClaudeSession } from "../../hooks/useClaudeSession";
import { handleChatEvent as realHandleChatEvent } from "../../lib/event-handlers/chat";

function makeSession(id: string, projectPath: string): Session {
  return {
    id,
    name: id,
    project_path: projectPath,
    status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    model: null,
    icon_index: 0,
  };
}

describe("eager transcript save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllStores();
    __cancelAllFlushesForTests();
    saveSessionMessagesMock.mockReset().mockResolvedValue(undefined);
    sendMessageMock.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        sessionLogsEnabled: true,
      },
    });
  });

  it("sendMessage persists the user prompt within the debounce window", async () => {
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.sendMessage("s1", "hello claude");
    });

    // Before debounce elapses, no save yet.
    expect(saveSessionMessagesMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);
    });

    expect(saveSessionMessagesMock).toHaveBeenCalledTimes(1);
    const [sessionId, payloads] = saveSessionMessagesMock.mock.calls[0];
    expect(sessionId).toBe("s1");
    expect(payloads).toHaveLength(1);
    expect(payloads[0].role).toBe("user");
    expect(payloads[0].content).toBe("hello claude");
  });

  it("turn_complete event persists the full transcript", async () => {
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    useSessionStore.getState().addMessage("s1", {
      id: "u1",
      role: "user",
      content: "hi",
      timestamp: "2026-01-01T00:00:00Z",
      activityIds: [],
      isStreaming: false,
    });
    useSessionStore.getState().addMessage("s1", {
      id: "a1",
      role: "assistant",
      content: "hello back",
      timestamp: "2026-01-01T00:00:01Z",
      activityIds: [],
      isStreaming: false,
    });

    const turnComplete: TurnCompleteEvent = {
      type: "turn_complete",
      session_id: "s1",
      duration_ms: 1000,
      cost_usd: 0.001,
      num_turns: 1,
      stop_reason: "end_turn",
      context_window: 200000,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as TurnCompleteEvent;

    act(() => {
      realHandleChatEvent("s1", turnComplete);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);
    });

    expect(saveSessionMessagesMock).toHaveBeenCalled();
    const calls = saveSessionMessagesMock.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe("s1");
    expect(lastCall[1].map((m: SessionMessagePayload) => m.role)).toEqual(["user", "assistant"]);
  });

  it("rapid user prompts coalesce into one flush", async () => {
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.sendMessage("s1", "one");
      await result.current.sendMessage("s1", "two");
      await result.current.sendMessage("s1", "three");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(__FLUSH_DEBOUNCE_MS_FOR_TESTS + 50);
    });

    expect(saveSessionMessagesMock).toHaveBeenCalledTimes(1);
    const [, payloads] = saveSessionMessagesMock.mock.calls[0];
    expect(payloads.map((m: SessionMessagePayload) => m.content)).toEqual(["one", "two", "three"]);
  });
});
