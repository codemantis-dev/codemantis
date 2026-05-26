/**
 * Integration test: violent-shutdown recovery flow.
 *
 * Exercises:
 *   localStorage snapshot + Tauri list_crashed_sessions →
 *   hydratePersistedOpenSessions → useClaudeSession.restorePausedSession →
 *   real sessionStore (paused tabs in correct order, messages restored,
 *   active selection restored) → acknowledge_crashed_sessions called →
 *   localStorage snapshot wiped.
 *
 * Only the Tauri IPC boundary is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session, SessionHistoryEntry } from "../../types/session";

const SNAPSHOT_KEY = "cm:workspace-snapshot";

const {
  listCrashedSessionsMock,
  acknowledgeCrashedSessionsMock,
  loadSessionMessagesMock,
  createSessionMock,
} = vi.hoisted(() => ({
  listCrashedSessionsMock: vi.fn<(...args: unknown[]) => Promise<SessionHistoryEntry[]>>(),
  acknowledgeCrashedSessionsMock: vi.fn<(ids: string[]) => Promise<void>>(),
  loadSessionMessagesMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  createSessionMock: vi.fn<(...args: unknown[]) => Promise<Session>>(),
}));

vi.mock("../../lib/tauri-commands", () => ({
  listCrashedSessions: listCrashedSessionsMock,
  acknowledgeCrashedSessions: acknowledgeCrashedSessionsMock,
  loadSessionMessages: loadSessionMessagesMock,
  createSession: createSessionMock,
  closeSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => {}),
  listenActivityEvents: vi.fn().mockResolvedValue(() => {}),
  initializeSession: vi.fn().mockResolvedValue(undefined),
  saveSessionMessages: vi.fn().mockResolvedValue(undefined),
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

import { hydratePersistedOpenSessions } from "../../lib/crash-recovery";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { __resetCrashRecoverySnapshotMemoForTests } from "../../hooks/useCrashRecoverySnapshot";

function entry(id: string, name: string, projectPath = "/p", cliId = `cli-${id}`): SessionHistoryEntry {
  return {
    session_id: id,
    name,
    project_path: projectPath,
    model: null,
    closed_at: "2026-01-01T00:00:00Z",
    cli_session_id: cliId,
    icon_index: 0,
    recent_headlines: [],
    has_stored_messages: false,
  };
}

describe("crash-recovery hydration", () => {
  beforeEach(() => {
    resetAllStores();
    window.localStorage.clear();
    __resetCrashRecoverySnapshotMemoForTests();
    listCrashedSessionsMock.mockReset();
    acknowledgeCrashedSessionsMock.mockReset().mockResolvedValue(undefined);
    loadSessionMessagesMock.mockReset().mockResolvedValue([]);
    createSessionMock.mockReset();
  });

  it("clean exit (empty crashed list) wipes snapshot and adds no tabs", async () => {
    listCrashedSessionsMock.mockResolvedValue([]);
    window.localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        savedAt: 0,
        tabOrder: ["x"],
        projectOrder: ["/p"],
        activeSessionId: null,
        activeProjectPath: null,
        projectActiveSession: [],
      }),
    );

    const { result } = renderHook(() => useClaudeSession());
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });

    expect(useSessionStore.getState().tabOrder).toEqual([]);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    expect(acknowledgeCrashedSessionsMock).not.toHaveBeenCalled();
  });

  it("restores tabs in snapshot tabOrder when snapshot is present", async () => {
    listCrashedSessionsMock.mockResolvedValue([
      entry("a", "Alpha"),
      entry("b", "Beta"),
      entry("c", "Gamma"),
    ]);
    window.localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        savedAt: 0,
        // Snapshot order differs from list_crashed_sessions order
        tabOrder: ["c", "a", "b"],
        projectOrder: ["/p"],
        activeSessionId: "a",
        activeProjectPath: "/p",
        projectActiveSession: [["/p", "a"]],
      }),
    );

    const { result } = renderHook(() => useClaudeSession());
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });

    expect(useSessionStore.getState().tabOrder).toEqual(["c", "a", "b"]);
    expect(useSessionStore.getState().activeSessionId).toBe("a");
    for (const id of ["a", "b", "c"]) {
      expect(useSessionStore.getState().sessions.get(id)!.status).toBe("paused-recovered");
    }
  });

  it("falls back to crashed-list order when snapshot is missing", async () => {
    listCrashedSessionsMock.mockResolvedValue([
      entry("first", "First"),
      entry("second", "Second"),
    ]);
    // No snapshot in localStorage

    const { result } = renderHook(() => useClaudeSession());
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });

    expect(useSessionStore.getState().tabOrder).toEqual(["first", "second"]);
  });

  it("appends sessions present in crashed list but missing from snapshot", async () => {
    listCrashedSessionsMock.mockResolvedValue([
      entry("known", "Known"),
      entry("orphan", "Orphan"),
    ]);
    window.localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        savedAt: 0,
        tabOrder: ["known"],
        projectOrder: ["/p"],
        activeSessionId: null,
        activeProjectPath: null,
        projectActiveSession: [],
      }),
    );

    const { result } = renderHook(() => useClaudeSession());
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });

    expect(useSessionStore.getState().tabOrder).toEqual(["known", "orphan"]);
  });

  it("calls acknowledge_crashed_sessions with restored ids and wipes snapshot", async () => {
    listCrashedSessionsMock.mockResolvedValue([entry("a", "A"), entry("b", "B")]);
    window.localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        savedAt: 0,
        tabOrder: ["a", "b"],
        projectOrder: ["/p"],
        activeSessionId: null,
        activeProjectPath: null,
        projectActiveSession: [],
      }),
    );

    const { result } = renderHook(() => useClaudeSession());
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });

    expect(acknowledgeCrashedSessionsMock).toHaveBeenCalledWith(["a", "b"]);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it("restored tabs DO NOT spawn CLI processes (createSession not called)", async () => {
    listCrashedSessionsMock.mockResolvedValue([entry("a", "A"), entry("b", "B")]);

    const { result } = renderHook(() => useClaudeSession());
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });

    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("loads stored messages for each restored session", async () => {
    loadSessionMessagesMock.mockImplementation(async (sessionId: unknown) => {
      if (sessionId === "a") {
        return [
          { id: "m1", role: "user", content: "alpha-msg", timestamp: "2026-01-01T00:00:00Z", thinkingContent: null, sortOrder: 0 },
        ];
      }
      return [];
    });
    listCrashedSessionsMock.mockResolvedValue([entry("a", "A"), entry("b", "B")]);

    const { result } = renderHook(() => useClaudeSession());
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });

    const aMsgs = useSessionStore.getState().sessionMessages.get("a") ?? [];
    expect(aMsgs).toHaveLength(1);
    expect(aMsgs[0].content).toBe("alpha-msg");
    expect(aMsgs[0].isRestored).toBe(true);
    expect(useSessionStore.getState().sessionMessages.get("b") ?? []).toHaveLength(0);
  });

  it("hydration failure does not throw (fails silently)", async () => {
    listCrashedSessionsMock.mockRejectedValue(new Error("DB unreachable"));

    const { result } = renderHook(() => useClaudeSession());
    await expect(
      act(async () => {
        await hydratePersistedOpenSessions(result.current.restorePausedSession);
      }),
    ).resolves.not.toThrow();

    expect(useSessionStore.getState().tabOrder).toEqual([]);
  });

  it("resumeRecoveredSession carries paused-tab messages into the new session WITHOUT re-fetching from DB (anti-flicker fix)", async () => {
    // Regression: pre-fix resumeRecoveredSession did
    //   removeSession(pausedId) → createSession → loadSessionMessages → setState
    // The await on loadSessionMessages caused the new tab to render empty
    // before the messages arrived. Users observed "content briefly shows
    // then clears". The fix: capture in-memory messages from the paused tab
    // and pass them to resumeFromHistory as `preloadedMessages` so the new
    // session is populated synchronously after addSession.
    loadSessionMessagesMock.mockImplementation(async (sessionId: unknown) => {
      if (sessionId === "paused-id") {
        return [
          { id: "m1", role: "user", content: "history-line-1", timestamp: "2026-01-01T00:00:00Z", thinkingContent: null, sortOrder: 0 },
          { id: "m2", role: "assistant", content: "history-line-2", timestamp: "2026-01-01T00:00:01Z", thinkingContent: null, sortOrder: 1 },
        ];
      }
      return [];
    });
    listCrashedSessionsMock.mockResolvedValue([entry("paused-id", "Paused tab")]);
    createSessionMock.mockResolvedValue({
      id: "new-id",
      name: "Paused tab",
      project_path: "/p",
      status: "connected",
      created_at: "2026-01-01T00:00:00Z",
      model: null,
      icon_index: 0,
      cli_session_id: "cli-paused-id",
    } as unknown as Session);

    const { result } = renderHook(() => useClaudeSession());

    // First: hydrate so the paused tab exists with messages in the store.
    await act(async () => {
      await hydratePersistedOpenSessions(result.current.restorePausedSession);
    });
    expect(useSessionStore.getState().sessionMessages.get("paused-id") ?? []).toHaveLength(2);

    // Reset the loadSessionMessages mock to verify it isn't called again
    // during the resume — the messages must come from in-memory state.
    loadSessionMessagesMock.mockClear();

    // Now resume the paused tab.
    let newId: string | null = null;
    await act(async () => {
      newId = await result.current.resumeRecoveredSession("paused-id");
    });

    expect(newId).toBe("new-id");
    // The paused tab is gone, the new tab is in place.
    expect(useSessionStore.getState().sessions.has("paused-id")).toBe(false);
    expect(useSessionStore.getState().sessions.has("new-id")).toBe(true);
    // Critically: messages were carried over without a DB round-trip.
    expect(loadSessionMessagesMock).not.toHaveBeenCalled();
    const newMsgs = useSessionStore.getState().sessionMessages.get("new-id") ?? [];
    expect(newMsgs).toHaveLength(2);
    expect(newMsgs.map((m) => m.content)).toEqual(["history-line-1", "history-line-2"]);
    // isRestored is preserved/applied on the new session's messages.
    expect(newMsgs.every((m) => m.isRestored === true)).toBe(true);
  });
});
