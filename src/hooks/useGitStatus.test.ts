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

    // Flush the initial fetchStatus() — status becomes dirty
    await flushMicrotasks();
    mockGetGitStatus.mockClear();
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    // The first schedule() call sees statusRef.current as null (before fetch resolved),
    // so it uses POLL_CLEAN (10s). Advance 10s to trigger the first poll.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    await flushMicrotasks();

    expect(mockGetGitStatus).toHaveBeenCalledTimes(1);
    mockGetGitStatus.mockClear();
    mockGetGitStatus.mockResolvedValue(dirtyStatus);

    // Now statusRef has dirty status, so next schedule uses POLL_ACTIVE (5s).
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
});
