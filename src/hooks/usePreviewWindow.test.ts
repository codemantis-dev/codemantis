import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoist mock functions so they're available in vi.mock factories
const {
  mockOpenPreviewWindow,
  mockClosePreviewWindow,
  mockNavigatePreview,
  mockRefreshPreview,
  mockFocusPreviewWindow,
  mockUnlisten,
} = vi.hoisted(() => ({
  mockOpenPreviewWindow: vi.fn<(url: string, projectName: string) => Promise<void>>(),
  mockClosePreviewWindow: vi.fn<() => Promise<void>>(),
  mockNavigatePreview: vi.fn<(url: string) => Promise<void>>(),
  mockRefreshPreview: vi.fn<() => Promise<void>>(),
  mockFocusPreviewWindow: vi.fn<() => Promise<boolean>>(),
  mockUnlisten: vi.fn(),
}));

vi.mock("../lib/tauri-commands", () => ({
  openPreviewWindow: mockOpenPreviewWindow,
  closePreviewWindow: mockClosePreviewWindow,
  navigatePreview: mockNavigatePreview,
  refreshPreview: mockRefreshPreview,
  focusPreviewWindow: mockFocusPreviewWindow,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_eventName: string, _cb: (event: unknown) => void) => {
    return Promise.resolve(mockUnlisten);
  }),
}));

import { usePreviewWindow } from "./usePreviewWindow";
import { useSessionStore } from "../stores/sessionStore";
import { usePreviewStore } from "../stores/previewStore";

describe("usePreviewWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
      "project"
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
      "project"
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
      "project"
    );
    expect(usePreviewStore.getState().previewOpen.get("/test/project")).toBe(true);
  });
});
