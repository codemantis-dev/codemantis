import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useCrashRecoverySnapshot,
  readWorkspaceSnapshot,
  clearWorkspaceSnapshot,
  __resetCrashRecoverySnapshotMemoForTests,
} from "./useCrashRecoverySnapshot";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { resetAllStores } from "../test/helpers/store-reset";
import { mockInvoke } from "../test/helpers/tauri-mock-factory";
import type { Session, Message } from "../types/session";

const SNAPSHOT_KEY = "cm:workspace-snapshot";

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

describe("useCrashRecoverySnapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    resetAllStores();
    __resetCrashRecoverySnapshotMemoForTests();
    // Default: logs enabled so transcripts get flushed.
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        sessionLogsEnabled: true,
      },
    });
    mockInvoke({ save_session_messages: () => undefined });
  });

  it("first tick after delay writes a snapshot when sessions are open", async () => {
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    const { unmount } = renderHook(() => useCrashRecoverySnapshot());

    // Nothing yet — first tick is gated behind the initial delay.
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.tabOrder).toEqual(["s1"]);
    expect(parsed.activeSessionId).toBe("s1");
    expect(parsed.activeProjectPath).toBe("/p");
    unmount();
  });

  it("ticks again every 60 seconds and reflects updated state", async () => {
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    const { unmount } = renderHook(() => useCrashRecoverySnapshot());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500); // first tick
    });
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!).tabOrder).toEqual(["s1"]);

    useSessionStore.getState().addSession(makeSession("s2", "/p"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!).tabOrder).toEqual(["s1", "s2"]);
    unmount();
  });

  it("clears localStorage when no sessions are open", async () => {
    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    const { unmount } = renderHook(() => useCrashRecoverySnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull();

    useSessionStore.getState().removeSession("s1");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    unmount();
  });

  it("flushes transcripts via save_session_messages", async () => {
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
    useSessionStore.getState().addMessage("s1", makeMessage("m2", "world"));

    const { unmount } = renderHook(() => useCrashRecoverySnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });

    expect(saveCalls.length).toBeGreaterThan(0);
    expect(saveCalls[0]).toEqual({ sessionId: "s1", count: 2 });
    unmount();
  });

  it("does not flush transcripts when sessionLogsEnabled is false", async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        sessionLogsEnabled: false,
      },
    });
    const saveCalls: Array<{ sessionId: string }> = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        saveCalls.push(args as { sessionId: string });
        return undefined;
      },
    });

    useSessionStore.getState().addSession(makeSession("s1", "/p"));
    useSessionStore.getState().addMessage("s1", makeMessage("m1", "hi"));
    const { unmount } = renderHook(() => useCrashRecoverySnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });

    expect(saveCalls).toHaveLength(0);
    // Snapshot still written (UI state is independent of the logs setting)
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull();
    unmount();
  });

  it("skips paused-recovered tabs when flushing transcripts", async () => {
    const saveCalls: Array<{ sessionId: string }> = [];
    mockInvoke({
      save_session_messages: (args: unknown) => {
        saveCalls.push(args as { sessionId: string });
        return undefined;
      },
    });
    const live = makeSession("live", "/p");
    const recovered: Session = { ...makeSession("recovered", "/p"), status: "paused-recovered" };
    useSessionStore.getState().addSession(live);
    useSessionStore.getState().addSession(recovered);
    useSessionStore.getState().addMessage("live", makeMessage("m1", "live msg"));
    useSessionStore.getState().addMessage("recovered", makeMessage("m2", "old msg"));

    const { unmount } = renderHook(() => useCrashRecoverySnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });

    expect(saveCalls.map((c) => c.sessionId)).toEqual(["live"]);
    unmount();
  });

  it("readWorkspaceSnapshot returns null when key is missing", () => {
    window.localStorage.clear();
    expect(readWorkspaceSnapshot()).toBeNull();
  });

  it("readWorkspaceSnapshot returns null on version mismatch", () => {
    window.localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ version: 999, savedAt: 0, tabOrder: [] }),
    );
    expect(readWorkspaceSnapshot()).toBeNull();
  });

  it("clearWorkspaceSnapshot wipes the key", () => {
    window.localStorage.setItem(SNAPSHOT_KEY, "something");
    clearWorkspaceSnapshot();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it("snapshot only contains durable workspace fields", async () => {
    const session = makeSession("s1", "/p");
    useSessionStore.getState().addSession(session);
    // Add ephemeral state that should NOT appear in the snapshot
    useSessionStore.getState().setSessionBusy("s1", true);
    useSessionStore.getState().startStreaming("s1", "msg-id");

    const { unmount } = renderHook(() => useCrashRecoverySnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });

    const parsed = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!);
    // Whitelist of expected keys
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "activeProjectPath",
        "activeSessionId",
        "projectActiveSession",
        "projectOrder",
        "savedAt",
        "tabOrder",
        "version",
      ].sort(),
    );
    unmount();
  });
});
