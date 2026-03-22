import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { GitStatusInfo } from "../types/git";

const mockGetGitStatus = vi.fn<(projectPath: string) => Promise<GitStatusInfo>>();

vi.mock("../lib/tauri-commands", () => ({
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...(args as [string])),
}));

import { useGitStatus } from "./useGitStatus";

const cleanStatus: GitStatusInfo = {
  is_git_repo: true,
  branch: "main",
  uncommitted_changes: 0,
  last_commit_time: "2025-01-01T00:00:00Z",
  last_push_time: null,
};

const dirtyStatus: GitStatusInfo = {
  is_git_repo: true,
  branch: "feature",
  uncommitted_changes: 3,
  last_commit_time: "2025-01-01T00:00:00Z",
  last_push_time: null,
};

/**
 * Flush microtasks so resolved promises settle.
 * This does NOT advance fake timers — it just drains the microtask queue.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    // yield to microtask queue
  });
}

describe("useGitStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null initially with null projectPath", () => {
    const { result } = renderHook(() => useGitStatus(null));
    expect(result.current.gitStatus).toBeNull();
    expect(mockGetGitStatus).not.toHaveBeenCalled();
  });

  it("fetches status on mount with valid projectPath", async () => {
    mockGetGitStatus.mockResolvedValue(cleanStatus);

    const { result } = renderHook(() => useGitStatus("/my/project"));

    // Flush the initial fetchStatus() promise
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledWith("/my/project");
    expect(result.current.gitStatus).toEqual(cleanStatus);
  });

  it("polls at POLL_ACTIVE (5000ms) when uncommitted changes > 0", async () => {
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    renderHook(() => useGitStatus("/my/project"));

    // Flush the initial poll — result is dirty, so next poll scheduled at POLL_ACTIVE (5s)
    await flushMicrotasks();
    mockGetGitStatus.mockClear();
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    // Advance 5s — triggers next poll (POLL_ACTIVE)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
    mockGetGitStatus.mockClear();
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    // Second poll also uses POLL_ACTIVE (5s)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it("polls at POLL_CLEAN (10000ms) when working tree clean", async () => {
    mockGetGitStatus.mockResolvedValue(cleanStatus);

    renderHook(() => useGitStatus("/my/project"));

    // Flush initial fetch
    await flushMicrotasks();
    mockGetGitStatus.mockClear();
    mockGetGitStatus.mockResolvedValue(cleanStatus);

    // Advance 5000ms — should NOT trigger a poll (POLL_CLEAN = 10s)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledTimes(0);

    // Advance another 5000ms (total 10s) — should now trigger
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it("refreshes on visibility change to visible", async () => {
    mockGetGitStatus.mockResolvedValue(cleanStatus);

    renderHook(() => useGitStatus("/my/project"));

    // Flush initial fetch
    await flushMicrotasks();
    mockGetGitStatus.mockClear();

    // Simulate tab becoming visible
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it("returns null on error", async () => {
    mockGetGitStatus.mockRejectedValue(new Error("Not a git repo"));

    const { result } = renderHook(() => useGitStatus("/not/a/repo"));

    await flushMicrotasks();

    expect(result.current.gitStatus).toBeNull();
  });

  it("discards stale fetch results when a newer fetch starts", async () => {
    // Slow fetch: resolves after a delay with stale dirty status
    let resolveSlowFetch!: (value: GitStatusInfo) => void;
    const slowFetchPromise = new Promise<GitStatusInfo>((resolve) => {
      resolveSlowFetch = resolve;
    });
    mockGetGitStatus.mockReturnValueOnce(slowFetchPromise);

    const { result } = renderHook(() => useGitStatus("/my/project"));

    // The initial poll starts a slow fetch (in-flight)
    await flushMicrotasks();
    expect(result.current.gitStatus).toBeNull(); // Still waiting

    // Trigger a refresh — starts a second (newer) fetch that resolves immediately
    mockGetGitStatus.mockResolvedValueOnce(cleanStatus);
    await act(async () => {
      result.current.refresh();
    });
    await flushMicrotasks();

    // The newer fetch resolved first with clean status
    expect(result.current.gitStatus).toEqual(cleanStatus);

    // Now the slow fetch finally resolves with dirty (stale) data
    await act(async () => {
      resolveSlowFetch(dirtyStatus);
    });
    await flushMicrotasks();

    // State should STILL show clean — the stale result was discarded
    expect(result.current.gitStatus).toEqual(cleanStatus);
  });

  it("switches from POLL_ACTIVE to POLL_CLEAN after commit clears changes", async () => {
    // Start dirty (the exact reported bug scenario)
    mockGetGitStatus.mockResolvedValue(dirtyStatus);
    renderHook(() => useGitStatus("/my/project"));
    await flushMicrotasks();
    mockGetGitStatus.mockClear();

    // Simulate commit: next fetch returns clean status
    mockGetGitStatus.mockResolvedValue(cleanStatus);

    // After 5s (POLL_ACTIVE), poll fires and gets clean result
    act(() => { vi.advanceTimersByTime(5000); });
    await flushMicrotasks();
    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
    mockGetGitStatus.mockClear();

    // Next poll should now use POLL_CLEAN (10s), NOT POLL_ACTIVE (5s)
    act(() => { vi.advanceTimersByTime(5000); });
    await flushMicrotasks();
    expect(mockGetGitStatus).toHaveBeenCalledTimes(0); // Not yet — only 5s elapsed

    act(() => { vi.advanceTimersByTime(5000); });
    await flushMicrotasks();
    expect(mockGetGitStatus).toHaveBeenCalledTimes(1); // Now at 10s
  });

  it("switches from POLL_CLEAN to POLL_ACTIVE when changes appear", async () => {
    mockGetGitStatus.mockResolvedValue(cleanStatus);
    renderHook(() => useGitStatus("/my/project"));
    await flushMicrotasks();
    mockGetGitStatus.mockClear();

    // Next poll returns dirty status
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    // Advance 10s (POLL_CLEAN) to trigger poll
    act(() => { vi.advanceTimersByTime(10_000); });
    await flushMicrotasks();
    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
    mockGetGitStatus.mockClear();
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    // Now should poll at POLL_ACTIVE (5s)
    act(() => { vi.advanceTimersByTime(5000); });
    await flushMicrotasks();
    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it("handles multiple rapid refreshes — only the last one wins", async () => {
    // Three fetches will be in-flight simultaneously
    let resolve1!: (v: GitStatusInfo) => void;
    let resolve2!: (v: GitStatusInfo) => void;
    let resolve3!: (v: GitStatusInfo) => void;
    mockGetGitStatus
      .mockReturnValueOnce(new Promise<GitStatusInfo>((r) => { resolve1 = r; }))
      .mockReturnValueOnce(new Promise<GitStatusInfo>((r) => { resolve2 = r; }))
      .mockReturnValueOnce(new Promise<GitStatusInfo>((r) => { resolve3 = r; }));

    const { result } = renderHook(() => useGitStatus("/my/project"));
    await flushMicrotasks(); // poll starts fetch #1

    // Fire two more refreshes while #1 is still in-flight
    act(() => { result.current.refresh(); }); // fetch #2
    act(() => { result.current.refresh(); }); // fetch #3

    // Resolve in reverse order: #3 first (the newest)
    const status3: GitStatusInfo = { ...cleanStatus, branch: "third" };
    await act(async () => { resolve3(status3); });
    await flushMicrotasks();
    expect(result.current.gitStatus).toEqual(status3);

    // #2 resolves — should be discarded (stale)
    const status2: GitStatusInfo = { ...dirtyStatus, branch: "second" };
    await act(async () => { resolve2(status2); });
    await flushMicrotasks();
    expect(result.current.gitStatus).toEqual(status3); // unchanged

    // #1 resolves — should also be discarded (stale)
    const status1: GitStatusInfo = { ...dirtyStatus, branch: "first" };
    await act(async () => { resolve1(status1); });
    await flushMicrotasks();
    expect(result.current.gitStatus).toEqual(status3); // still the newest
  });

  it("stale error does not overwrite fresh successful state", async () => {
    // Slow fetch that will error
    let rejectSlowFetch!: (e: Error) => void;
    mockGetGitStatus.mockReturnValueOnce(
      new Promise<GitStatusInfo>((_, reject) => { rejectSlowFetch = reject; })
    );

    const { result } = renderHook(() => useGitStatus("/my/project"));
    await flushMicrotasks();
    expect(result.current.gitStatus).toBeNull();

    // Trigger a fast refresh that succeeds
    mockGetGitStatus.mockResolvedValueOnce(dirtyStatus);
    await act(async () => { result.current.refresh(); });
    await flushMicrotasks();
    expect(result.current.gitStatus).toEqual(dirtyStatus);

    // Now the slow fetch errors — should NOT clear state to null
    await act(async () => { rejectSlowFetch(new Error("timeout")); });
    await flushMicrotasks();
    expect(result.current.gitStatus).toEqual(dirtyStatus);
  });

  it("resets state and restarts polling when projectPath changes", async () => {
    mockGetGitStatus.mockResolvedValue(dirtyStatus);
    const { result, rerender } = renderHook(
      ({ path }) => useGitStatus(path),
      { initialProps: { path: "/project-a" as string | null } },
    );
    await flushMicrotasks();
    expect(result.current.gitStatus).toEqual(dirtyStatus);
    expect(mockGetGitStatus).toHaveBeenCalledWith("/project-a");
    mockGetGitStatus.mockClear();

    // Switch to a different project
    const otherStatus: GitStatusInfo = { ...cleanStatus, branch: "other" };
    mockGetGitStatus.mockResolvedValue(otherStatus);
    rerender({ path: "/project-b" });
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledWith("/project-b");
    expect(result.current.gitStatus).toEqual(otherStatus);
  });

  it("clears state when projectPath becomes null", async () => {
    mockGetGitStatus.mockResolvedValue(dirtyStatus);
    const { result, rerender } = renderHook(
      ({ path }) => useGitStatus(path),
      { initialProps: { path: "/my/project" as string | null } },
    );
    await flushMicrotasks();
    expect(result.current.gitStatus).toEqual(dirtyStatus);

    // Set path to null (no project open)
    rerender({ path: null });
    await flushMicrotasks();

    expect(result.current.gitStatus).toBeNull();
  });

  it("stops polling after unmount", async () => {
    mockGetGitStatus.mockResolvedValue(dirtyStatus);
    const { unmount } = renderHook(() => useGitStatus("/my/project"));
    await flushMicrotasks();
    mockGetGitStatus.mockClear();
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    // Unmount the hook
    unmount();

    // Advance past POLL_ACTIVE — should NOT trigger any fetch
    act(() => { vi.advanceTimersByTime(10_000); });
    await flushMicrotasks();
    expect(mockGetGitStatus).toHaveBeenCalledTimes(0);
  });

  it("manual refresh returns fresh status to caller", async () => {
    mockGetGitStatus.mockResolvedValue(cleanStatus);
    const { result } = renderHook(() => useGitStatus("/my/project"));
    await flushMicrotasks();

    mockGetGitStatus.mockResolvedValueOnce(dirtyStatus);
    let refreshResult: GitStatusInfo | null = null;
    await act(async () => {
      refreshResult = await (result.current.refresh() as unknown as Promise<GitStatusInfo | null>);
    });
    await flushMicrotasks();

    expect(refreshResult).toEqual(dirtyStatus);
    expect(result.current.gitStatus).toEqual(dirtyStatus);
  });
});
