import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStuckActivityWatchdog } from "./useStuckActivityWatchdog";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { resetAllStores } from "../test/helpers/store-reset";

const SID = "s-watchdog";

describe("useStuckActivityWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags a busy session as no-progress after 30s of silence", async () => {
    const store = useSessionStore.getState();
    store.setSessionBusy(SID, true);
    // Touch the lastEventTimestamp to a stale value (40s in the past).
    useSessionStore.setState({
      lastEventTimestamp: new Map([[SID, Date.now() - 40_000]]),
    });

    const { unmount } = renderHook(() => useStuckActivityWatchdog());

    // First tick fires at 5s; advance past it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    const stuck = useSessionStore.getState().sessionStuck.get(SID);
    expect(stuck?.reason).toBe("no-progress");
    unmount();
  });

  it("does NOT flag a session whose lastEventTimestamp is recent", async () => {
    const store = useSessionStore.getState();
    store.setSessionBusy(SID, true);
    useSessionStore.setState({
      lastEventTimestamp: new Map([[SID, Date.now() - 5_000]]),
    });

    const { unmount } = renderHook(() => useStuckActivityWatchdog());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    expect(useSessionStore.getState().sessionStuck.get(SID)).toBeUndefined();
    unmount();
  });

  it("flags pending-approval-not-shown immediately when queue has entries and modal is closed", async () => {
    useSessionStore.getState().setSessionBusy(SID, true);
    // Approval queued, no stale lastEventTimestamp needed — the
    // pending-approval branch fires regardless of the 30s threshold
    // so the user is unblocked fast.
    useActivityStore.getState().enqueueApproval({
      requestId: "req-1",
      toolUseId: "req-1",
      toolName: "Bash",
      toolInput: { command: "echo hi" },
      sessionId: SID,
      timestamp: new Date().toISOString(),
    });
    useUiStore.getState().setShowApprovalModal(false);

    const { unmount } = renderHook(() => useStuckActivityWatchdog());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    const stuck = useSessionStore.getState().sessionStuck.get(SID);
    expect(stuck?.reason).toBe("pending-approval-not-shown");
    unmount();
  });

  it("does NOT flag pending-approval when the modal is already open", async () => {
    useSessionStore.getState().setSessionBusy(SID, true);
    useActivityStore.getState().enqueueApproval({
      requestId: "req-1",
      toolUseId: "req-1",
      toolName: "Bash",
      toolInput: { command: "echo hi" },
      sessionId: SID,
      timestamp: new Date().toISOString(),
    });
    useUiStore.getState().setShowApprovalModal(true);

    const { unmount } = renderHook(() => useStuckActivityWatchdog());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    expect(useSessionStore.getState().sessionStuck.get(SID)).toBeUndefined();
    unmount();
  });

  it("clears stuck state once a new event arrives", async () => {
    useSessionStore.getState().setSessionBusy(SID, true);
    useSessionStore.setState({
      lastEventTimestamp: new Map([[SID, Date.now() - 40_000]]),
    });

    const { unmount } = renderHook(() => useStuckActivityWatchdog());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    expect(useSessionStore.getState().sessionStuck.get(SID)?.reason).toBe("no-progress");

    // Simulate fresh event — lastEventTimestamp moves forward.
    useSessionStore.setState({
      lastEventTimestamp: new Map([[SID, Date.now()]]),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    expect(useSessionStore.getState().sessionStuck.get(SID)).toBeUndefined();
    unmount();
  });

  it("clears stuck state when the session becomes not-busy", async () => {
    useSessionStore.getState().setSessionBusy(SID, true);
    useSessionStore.setState({
      lastEventTimestamp: new Map([[SID, Date.now() - 40_000]]),
    });

    const { unmount } = renderHook(() => useStuckActivityWatchdog());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    expect(useSessionStore.getState().sessionStuck.has(SID)).toBe(true);

    useSessionStore.getState().setSessionBusy(SID, false);
    // setSessionBusy(false) already clears, but the next tick's
    // defensive sweep should also be a no-op (no error / no thrash).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    expect(useSessionStore.getState().sessionStuck.has(SID)).toBe(false);
    unmount();
  });
});
