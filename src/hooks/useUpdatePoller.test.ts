import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Hoist mock functions so they're available in vi.mock factories
const {
  mockCheckForUpdate,
  mockEnableUpdateMenuItem,
  mockListenOpenUpdateModal,
  mockShowToast,
  mockUnlisten,
} = vi.hoisted(() => ({
  mockCheckForUpdate: vi.fn<() => Promise<{ version: string; body: string | null } | null>>(),
  mockEnableUpdateMenuItem: vi.fn<(version: string) => Promise<void>>(),
  mockListenOpenUpdateModal: vi.fn<(cb: () => void) => Promise<() => void>>(),
  mockShowToast: vi.fn(),
  mockUnlisten: vi.fn(),
}));

vi.mock("../lib/update-checker", () => ({
  checkForUpdate: mockCheckForUpdate,
}));

vi.mock("../lib/tauri-commands", () => ({
  enableUpdateMenuItem: mockEnableUpdateMenuItem,
  listenOpenUpdateModal: mockListenOpenUpdateModal,
}));

vi.mock("../stores/toastStore", () => ({
  showToast: mockShowToast,
}));

import { useUpdatePoller } from "./useUpdatePoller";
import { useUiStore } from "../stores/uiStore";

const INITIAL_DELAY_MS = 5_000;
const POLL_INTERVAL_MS = 30 * 60 * 1000;

// Captured menu listener callback
let menuCallback: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  menuCallback = null;

  // Reset the uiStore to default state for update-related fields
  useUiStore.setState({
    updateAvailable: false,
    availableVersion: null,
    availableNotes: null,
    showUpdateModal: false,
    updateVersion: null,
    updateNotes: null,
  });

  // Default: no update available
  mockCheckForUpdate.mockResolvedValue(null);
  mockEnableUpdateMenuItem.mockResolvedValue(undefined);

  // Capture the menu listener callback
  mockListenOpenUpdateModal.mockImplementation(async (cb: () => void) => {
    menuCallback = cb;
    return mockUnlisten;
  });
});

afterEach(() => {
  vi.useRealTimers();

  // Reset startedRef guard by clearing module cache so next renderHook gets a fresh instance
  vi.resetModules();
});

describe("useUpdatePoller", () => {
  it("performs initial check after delay", async () => {
    mockCheckForUpdate.mockResolvedValue(null);

    renderHook(() => useUpdatePoller());

    // Before delay, checkForUpdate should not have been called
    expect(mockCheckForUpdate).not.toHaveBeenCalled();

    // Advance past the initial delay
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
  });

  it("polls on interval after initial check", async () => {
    mockCheckForUpdate.mockResolvedValue(null);

    renderHook(() => useUpdatePoller());

    // Advance past initial delay
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);

    // Advance one full poll interval
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(2);

    // Advance another poll interval
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(3);
  });

  it("sets update info in uiStore when update available", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "2.0.0",
      body: "New features and improvements",
    });

    renderHook(() => useUpdatePoller());

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    const state = useUiStore.getState();
    expect(state.updateAvailable).toBe(true);
    expect(state.availableVersion).toBe("2.0.0");
    expect(state.availableNotes).toBe("New features and improvements");
  });

  it("enables update menu item when update found", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "2.0.0",
      body: null,
    });

    renderHook(() => useUpdatePoller());

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(mockEnableUpdateMenuItem).toHaveBeenCalledWith("2.0.0");
  });

  it("handles check failure gracefully (no crash)", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCheckForUpdate.mockRejectedValue(new Error("Network error"));

    renderHook(() => useUpdatePoller());

    // Should not throw
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[updater] Periodic check failed:",
      expect.any(Error),
    );

    // Store should remain unchanged
    const state = useUiStore.getState();
    expect(state.updateAvailable).toBe(false);
    expect(state.availableVersion).toBeNull();

    consoleSpy.mockRestore();
  });

  it("menu click opens update modal when version is known", async () => {
    // Simulate a known update in the store
    useUiStore.setState({
      updateAvailable: true,
      availableVersion: "3.0.0",
      availableNotes: "Big release",
    });

    renderHook(() => useUpdatePoller());

    // Wait for listenOpenUpdateModal to register
    await vi.advanceTimersByTimeAsync(0);

    expect(menuCallback).not.toBeNull();
    menuCallback!();

    const state = useUiStore.getState();
    expect(state.showUpdateModal).toBe(true);
    expect(state.updateVersion).toBe("3.0.0");
    expect(state.updateNotes).toBe("Big release");
  });

  it("menu click triggers manual check when no version known", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "4.0.0",
      body: "Hot fix",
    });

    renderHook(() => useUpdatePoller());

    // Wait for listener registration
    await vi.advanceTimersByTimeAsync(0);

    expect(menuCallback).not.toBeNull();
    menuCallback!();

    // Let the manual check promise resolve
    await vi.advanceTimersByTimeAsync(0);

    const state = useUiStore.getState();
    expect(state.updateAvailable).toBe(true);
    expect(state.availableVersion).toBe("4.0.0");
    expect(state.showUpdateModal).toBe(true);
    expect(state.updateVersion).toBe("4.0.0");
    expect(state.updateNotes).toBe("Hot fix");
    expect(mockEnableUpdateMenuItem).toHaveBeenCalledWith("4.0.0");
  });

  it("menu click shows 'latest version' toast when no update available", async () => {
    // No version known in store, and checkForUpdate returns null
    mockCheckForUpdate.mockResolvedValue(null);

    renderHook(() => useUpdatePoller());

    // Wait for listener registration
    await vi.advanceTimersByTimeAsync(0);

    expect(menuCallback).not.toBeNull();
    menuCallback!();

    // Let the manual check promise resolve
    await vi.advanceTimersByTimeAsync(0);

    expect(mockShowToast).toHaveBeenCalledWith(
      "You're on the latest version",
      "success",
    );
  });

  it("cleanup cancels timer, interval, and unlisten", async () => {
    mockCheckForUpdate.mockResolvedValue(null);

    const { unmount } = renderHook(() => useUpdatePoller());

    // Let the listener register
    await vi.advanceTimersByTimeAsync(0);

    unmount();

    // After unmount, advancing time should not trigger additional checks
    // (initial delay timer was cleared)
    mockCheckForUpdate.mockClear();

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS + POLL_INTERVAL_MS);

    expect(mockCheckForUpdate).not.toHaveBeenCalled();
    expect(mockUnlisten).toHaveBeenCalled();
  });
});
