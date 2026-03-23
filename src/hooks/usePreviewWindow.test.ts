import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoist mock functions so they're available in vi.mock factories
const {
  mockOpenPreviewWindow,
  mockClosePreviewWindow,
  mockNavigatePreview,
  mockRefreshPreview,
  mockFocusPreviewWindow,
  mockStopDevServer,
  mockUnlisten,
} = vi.hoisted(() => ({
  mockOpenPreviewWindow: vi.fn<(url: string, projectName: string, projectPath: string) => Promise<void>>(),
  mockClosePreviewWindow: vi.fn<() => Promise<void>>(),
  mockNavigatePreview: vi.fn<(url: string) => Promise<void>>(),
  mockRefreshPreview: vi.fn<() => Promise<void>>(),
  mockFocusPreviewWindow: vi.fn<() => Promise<boolean>>(),
  mockStopDevServer: vi.fn<(projectPath: string) => Promise<void>>(),
  mockUnlisten: vi.fn(),
}));

vi.mock("../lib/tauri-commands", () => ({
  openPreviewWindow: mockOpenPreviewWindow,
  closePreviewWindow: mockClosePreviewWindow,
  navigatePreview: mockNavigatePreview,
  refreshPreview: mockRefreshPreview,
  focusPreviewWindow: mockFocusPreviewWindow,
  stopDevServer: mockStopDevServer,
  readFileBytes: vi.fn(),
}));

// Capture listener callbacks so we can simulate events in tests
const eventListeners = new Map<string, (event: unknown) => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, cb: (event: unknown) => void) => {
    eventListeners.set(eventName, cb);
    return Promise.resolve(mockUnlisten);
  }),
}));

import { usePreviewWindow } from "./usePreviewWindow";
import { useSessionStore } from "../stores/sessionStore";
import { usePreviewStore } from "../stores/previewStore";

describe("usePreviewWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventListeners.clear();

    // Set up session store with active project
    useSessionStore.setState({
      activeProjectPath: "/test/project",
      sessions: new Map(),
      activeSessionId: null,
    });

    // Reset preview store
    usePreviewStore.setState({
      devServer: new Map(),
      previewOpen: new Map(),
      consoleLogs: new Map(),
      consoleDrawerOpen: false,
      viewportPreset: "desktop",
      unreadErrors: new Map(),
    });
  });

  it("openPreview calls openPreviewWindow with URL and sets store open", async () => {
    mockOpenPreviewWindow.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.openPreview("http://localhost:5173");
    });

    expect(mockOpenPreviewWindow).toHaveBeenCalledWith(
      "http://localhost:5173",
      "project",
      "/test/project"
    );
    expect(usePreviewStore.getState().previewOpen.get("/test/project")).toBe(true);
  });

  it("openPreview uses localhost:3000 as default URL", async () => {
    mockOpenPreviewWindow.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.openPreview();
    });

    expect(mockOpenPreviewWindow).toHaveBeenCalledWith(
      "http://localhost:3000",
      "project",
      "/test/project"
    );
  });

  it("openPreview does nothing if no activeProjectPath", async () => {
    useSessionStore.setState({ activeProjectPath: null });

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.openPreview("http://localhost:3000");
    });

    expect(mockOpenPreviewWindow).not.toHaveBeenCalled();
  });

  it("closePreview calls closePreviewWindow and sets store closed", async () => {
    // Set preview as open first
    usePreviewStore.getState().setPreviewOpen("/test/project", true);
    mockClosePreviewWindow.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.closePreview();
    });

    expect(mockClosePreviewWindow).toHaveBeenCalled();
    expect(usePreviewStore.getState().previewOpen.get("/test/project")).toBe(false);
  });

  it("navigateTo delegates to navigatePreview", async () => {
    mockNavigatePreview.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.navigateTo("http://localhost:3000/about");
    });

    expect(mockNavigatePreview).toHaveBeenCalledWith("http://localhost:3000/about");
  });

  it("refresh delegates to refreshPreview", async () => {
    mockRefreshPreview.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockRefreshPreview).toHaveBeenCalled();
  });

  it("togglePreview focuses if already open", async () => {
    usePreviewStore.getState().setPreviewOpen("/test/project", true);
    mockFocusPreviewWindow.mockResolvedValueOnce(true);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.togglePreview();
    });

    expect(mockFocusPreviewWindow).toHaveBeenCalled();
    // Still open since focus succeeded
    expect(usePreviewStore.getState().previewOpen.get("/test/project")).toBe(true);
  });

  it("togglePreview opens with dev server URL if closed", async () => {
    usePreviewStore.getState().setDevServer("/test/project", {
      url: "http://localhost:5173",
      port: 5173,
      status: "running",
      terminalId: "term-1",
    });
    mockOpenPreviewWindow.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.togglePreview();
    });

    expect(mockOpenPreviewWindow).toHaveBeenCalledWith(
      "http://localhost:5173",
      "project",
      "/test/project"
    );
    expect(usePreviewStore.getState().previewOpen.get("/test/project")).toBe(true);
  });

  it("togglePreview syncs state when focus fails (stale previewOpen)", async () => {
    // State says open but the actual window is gone
    usePreviewStore.getState().setPreviewOpen("/test/project", true);
    mockFocusPreviewWindow.mockResolvedValueOnce(false);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.togglePreview();
    });

    // Should have synced previewOpen to false since focus returned false
    expect(usePreviewStore.getState().previewOpen.get("/test/project")).toBe(false);
  });

  // ── Close event listener tests ──

  it("close event with project path marks correct project as closed", async () => {
    usePreviewStore.getState().setPreviewOpen("/project-a", true);

    // Render hook to register the listener
    renderHook(() => usePreviewWindow());
    // Wait for the listen promise to resolve and register the callback
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const closeListener = eventListeners.get("preview-window-closed");
    expect(closeListener).toBeDefined();

    // Simulate Rust emitting close event with project path payload
    await act(async () => {
      closeListener!({ payload: "/project-a" });
    });

    expect(usePreviewStore.getState().previewOpen.get("/project-a")).toBe(false);
  });

  it("close event marks payload project, not active project", async () => {
    // Active project is B, but the close event is for project A
    useSessionStore.setState({ activeProjectPath: "/project-b" });
    usePreviewStore.getState().setPreviewOpen("/project-a", true);
    usePreviewStore.getState().setPreviewOpen("/project-b", true);

    renderHook(() => usePreviewWindow());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const closeListener = eventListeners.get("preview-window-closed");

    // Close event arrives for project A (from old polling task)
    await act(async () => {
      closeListener!({ payload: "/project-a" });
    });

    // Project A should be marked closed
    expect(usePreviewStore.getState().previewOpen.get("/project-a")).toBe(false);
    // Project B should remain open — this is the critical race condition fix
    expect(usePreviewStore.getState().previewOpen.get("/project-b")).toBe(true);
  });

  it("close event stops dev server for the correct project", async () => {
    mockStopDevServer.mockResolvedValueOnce(undefined);

    usePreviewStore.getState().setPreviewOpen("/project-a", true);
    usePreviewStore.getState().setDevServer("/project-a", {
      url: "http://localhost:3000",
      port: 3000,
      status: "running",
      terminalId: "term-1",
    });

    // Active project is B
    useSessionStore.setState({ activeProjectPath: "/project-b" });

    renderHook(() => usePreviewWindow());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const closeListener = eventListeners.get("preview-window-closed");

    await act(async () => {
      closeListener!({ payload: "/project-a" });
    });

    // Should stop dev server for project A, not project B
    expect(mockStopDevServer).toHaveBeenCalledWith("/project-a");
  });

  it("close event falls back to active project if payload is empty", async () => {
    usePreviewStore.getState().setPreviewOpen("/test/project", true);

    renderHook(() => usePreviewWindow());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const closeListener = eventListeners.get("preview-window-closed");

    // Simulate legacy event with empty payload (backwards compatibility)
    await act(async () => {
      closeListener!({ payload: "" });
    });

    // Should fall back to activeProjectPath ("/test/project")
    expect(usePreviewStore.getState().previewOpen.get("/test/project")).toBe(false);
  });
});
