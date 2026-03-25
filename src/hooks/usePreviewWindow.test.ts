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
  mockReadFileBytes,
  mockUnlisten,
} = vi.hoisted(() => ({
  mockOpenPreviewWindow: vi.fn<(url: string, projectName: string, projectPath: string) => Promise<void>>(),
  mockClosePreviewWindow: vi.fn<() => Promise<void>>(),
  mockNavigatePreview: vi.fn<(url: string) => Promise<void>>(),
  mockRefreshPreview: vi.fn<() => Promise<void>>(),
  mockFocusPreviewWindow: vi.fn<() => Promise<boolean>>(),
  mockStopDevServer: vi.fn<(projectPath: string) => Promise<void>>(),
  mockReadFileBytes: vi.fn<(path: string) => Promise<number[]>>(),
  mockUnlisten: vi.fn(),
}));

vi.mock("../lib/tauri-commands", () => ({
  openPreviewWindow: mockOpenPreviewWindow,
  closePreviewWindow: mockClosePreviewWindow,
  navigatePreview: mockNavigatePreview,
  refreshPreview: mockRefreshPreview,
  focusPreviewWindow: mockFocusPreviewWindow,
  stopDevServer: mockStopDevServer,
  readFileBytes: mockReadFileBytes,
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

  // ── Screenshot event listener regression tests ──
  // Regression: security changes broke screenshot-taken event handling.
  // The hook must register a listener for "preview-screenshot-taken" and
  // add the screenshot as a chat attachment.

  it("registers listener for preview-screenshot-taken event", async () => {
    renderHook(() => usePreviewWindow());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(eventListeners.has("preview-screenshot-taken")).toBe(true);
  });

  it("screenshot event reads file and adds attachment to store", async () => {
    useSessionStore.setState({
      activeProjectPath: "/test/project",
      activeSessionId: "session-1",
      sessions: new Map(),
    });

    // Mock readFileBytes to return fake PNG data
    const fakePng = [0x89, 0x50, 0x4e, 0x47]; // PNG magic bytes
    mockReadFileBytes.mockResolvedValueOnce(fakePng);

    renderHook(() => usePreviewWindow());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const screenshotListener = eventListeners.get("preview-screenshot-taken");
    expect(screenshotListener).toBeDefined();

    // Simulate Rust emitting screenshot-taken with a file path
    await act(async () => {
      screenshotListener!({ payload: "/tmp/codemantis-screenshot-123.png" });
      // Wait for async readFileBytes
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockReadFileBytes).toHaveBeenCalledWith("/tmp/codemantis-screenshot-123.png");
  });

  it("screenshot event does nothing without active session", async () => {
    useSessionStore.setState({
      activeProjectPath: "/test/project",
      activeSessionId: null,
      sessions: new Map(),
    });

    renderHook(() => usePreviewWindow());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const screenshotListener = eventListeners.get("preview-screenshot-taken");

    await act(async () => {
      screenshotListener!({ payload: "/tmp/screenshot.png" });
      await new Promise((r) => setTimeout(r, 50));
    });

    // readFileBytes should not be called since there's no active session
    expect(mockReadFileBytes).not.toHaveBeenCalled();
  });

  // ── Event listener registration completeness ──
  // Regression: all three preview events must be registered.
  // If any listener registration is accidentally removed, the corresponding
  // toolbar button will silently fail even if the HTTP callback works.

  it("registers both screenshot-taken and window-closed listeners", async () => {
    renderHook(() => usePreviewWindow());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Both events must be registered — if either is missing,
    // the corresponding feature is broken
    expect(eventListeners.has("preview-screenshot-taken")).toBe(true);
    expect(eventListeners.has("preview-window-closed")).toBe(true);
  });

  // ── openPreview includes projectPath (critical for close scoping) ──
  // Regression: security changes added projectPath param to openPreviewWindow.
  // If projectPath is not passed, the close event can't scope to the right project.

  it("openPreview always passes projectPath to openPreviewWindow", async () => {
    useSessionStore.setState({ activeProjectPath: "/my/project" });
    mockOpenPreviewWindow.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.openPreview("http://localhost:8080");
    });

    // Third argument must be the project path
    const call = mockOpenPreviewWindow.mock.calls[0];
    expect(call[0]).toBe("http://localhost:8080"); // url
    expect(call[1]).toBe("project"); // projectName (from path)
    expect(call[2]).toBe("/my/project"); // projectPath — MUST be present
  });

  // ── closePreview also stops dev server ──

  it("closePreview stops running dev server", async () => {
    usePreviewStore.getState().setPreviewOpen("/test/project", true);
    usePreviewStore.getState().setDevServer("/test/project", {
      url: "http://localhost:3000",
      port: 3000,
      status: "running",
      terminalId: "term-1",
    });

    mockClosePreviewWindow.mockResolvedValueOnce(undefined);
    mockStopDevServer.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePreviewWindow());

    await act(async () => {
      await result.current.closePreview();
    });

    expect(mockClosePreviewWindow).toHaveBeenCalled();
    expect(mockStopDevServer).toHaveBeenCalledWith("/test/project");
  });
});
