import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { usePreviewStore } from "../stores/previewStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useSessionStore } from "../stores/sessionStore";
import type { DevServerInfo } from "../lib/tauri-commands";

// Hoist mock functions so they're available in vi.mock factories
const {
  mockStartDevServer,
  mockStopDevServer,
  mockGetDevServerStatus,
  mockOpenPreviewWindow,
  mockClosePreviewWindow,
  mockListenDevServerClosed,
} = vi.hoisted(() => ({
  mockStartDevServer: vi.fn(() => Promise.resolve("term-1")),
  mockStopDevServer: vi.fn(() => Promise.resolve()),
  mockGetDevServerStatus: vi.fn<() => Promise<DevServerInfo | null>>(() => Promise.resolve(null)),
  mockOpenPreviewWindow: vi.fn(() => Promise.resolve()),
  mockClosePreviewWindow: vi.fn(() => Promise.resolve()),
  mockListenDevServerClosed: vi.fn<(cb: (event: { terminalId: string; sessionId: string }) => void) => Promise<() => void>>(() => Promise.resolve(() => {})),
}));

vi.mock("../lib/tauri-commands", () => ({
  startDevServer: mockStartDevServer,
  stopDevServer: mockStopDevServer,
  getDevServerStatus: mockGetDevServerStatus,
  openPreviewWindow: mockOpenPreviewWindow,
  closePreviewWindow: mockClosePreviewWindow,
  listenDevServerClosed: mockListenDevServerClosed,
}));

import { usePreviewServer } from "./usePreviewServer";

const PROJECT = "/tmp/my-project";

describe("usePreviewServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePreviewStore.setState({
      devServer: new Map(),
      previewOpen: new Map(),
      consoleLogs: new Map(),
      consoleDrawerOpen: false,
      viewportPreset: "desktop",
      unreadErrors: new Map(),
      previewUrlPrompt: null,
    });
    useTerminalStore.setState({
      sessionTerminals: new Map(),
      activeTerminalId: new Map(),
      detectedDevServers: new Map(),
    });
    useSessionStore.setState({
      activeProjectPath: PROJECT,
      sessions: new Map(),
      activeSessionId: null,
      tabOrder: [],
      projectOrder: [],
    });
    (listen as Mock).mockImplementation(() => Promise.resolve(() => {}));
  });

  it("startServer sets status to 'starting' then 'scanning'", async () => {
    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.startServer();
    });

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer).toBeDefined();
    expect(devServer!.status).toBe("scanning");
    expect(devServer!.terminalId).toBe("term-1");
  });

  it("startServer creates terminal in terminalStore", async () => {
    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.startServer();
    });

    // The synthetic session ID is based on a hash of the project path
    const allTerminals = useTerminalStore.getState().sessionTerminals;
    let found = false;
    for (const [, terminals] of allTerminals) {
      for (const t of terminals) {
        if (t.id === "term-1" && t.name === "Dev Server") {
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("startServer handles error by setting error status", async () => {
    mockStartDevServer.mockRejectedValueOnce(new Error("Port in use"));

    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.startServer();
    });

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer).toBeDefined();
    expect(devServer!.status).toBe("error");
    expect(devServer!.errorMessage).toBe("Error: Port in use");
  });

  it("startServer does nothing if no projectPath", async () => {
    useSessionStore.setState({ activeProjectPath: null });
    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.startServer();
    });

    expect(mockStartDevServer).not.toHaveBeenCalled();
    expect(usePreviewStore.getState().devServer.size).toBe(0);
  });

  it("stopServer calls stopDevServer and clears store", async () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: 3000,
      url: "http://localhost:3000",
      status: "running",
    });

    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.stopServer();
    });

    expect(mockStopDevServer).toHaveBeenCalledWith(PROJECT);
    expect(usePreviewStore.getState().devServer.has(PROJECT)).toBe(false);
  });

  it("stopServer clears terminal session", async () => {
    const sessionId = "devserver-abc";
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId,
      port: 3000,
      url: "http://localhost:3000",
      status: "running",
    });
    useTerminalStore.getState().addTerminal(sessionId, {
      id: "term-1",
      sessionId,
      name: "Dev Server",
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      isRunning: true,
      kind: "shell",
    });

    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.stopServer();
    });

    expect(useTerminalStore.getState().getTerminals(sessionId)).toHaveLength(0);
  });

  it("checkStatus updates store from backend status", async () => {
    mockGetDevServerStatus.mockResolvedValueOnce({
      terminal_id: "term-2",
      synthetic_session_id: "devserver-xyz",
      port: 5173,
      url: "http://localhost:5173",
      status: "scanning",
    });

    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.checkStatus();
    });

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer).toBeDefined();
    expect(devServer!.status).toBe("scanning");
    expect(devServer!.port).toBe(5173);
    expect(devServer!.terminalId).toBe("term-2");
  });

  it("checkStatus maps 'detected' to 'running'", async () => {
    mockGetDevServerStatus.mockResolvedValueOnce({
      terminal_id: "term-2",
      synthetic_session_id: "devserver-xyz",
      port: 5173,
      url: "http://localhost:5173",
      status: "detected",
    });

    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.checkStatus();
    });

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer!.status).toBe("running");
  });

  it("checkStatus maps 'failed' to 'error'", async () => {
    mockGetDevServerStatus.mockResolvedValueOnce({
      terminal_id: "term-2",
      synthetic_session_id: "devserver-xyz",
      port: null,
      url: null,
      status: "failed",
    });

    const { result } = renderHook(() => usePreviewServer());

    await act(async () => {
      await result.current.checkStatus();
    });

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer!.status).toBe("error");
  });

  it("dev-server-closed (pty_eof) closes preview and sets error status", async () => {
    // Set up a running dev server with preview open
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: 3000,
      url: "http://localhost:3000",
      status: "running",
    });
    usePreviewStore.getState().setPreviewOpen(PROJECT, true);

    // Capture the listenDevServerClosed callback
    type ClosedEvent = {
      terminalId: string;
      sessionId: string;
      reason: "shutdown_requested" | "pty_eof" | "pty_error";
    };
    let closedHandler: ((event: ClosedEvent) => void) | null = null;
    mockListenDevServerClosed.mockImplementation(
      (cb: (event: ClosedEvent) => void) => {
        closedHandler = cb;
        return Promise.resolve(() => {});
      },
    );

    renderHook(() => usePreviewServer());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(closedHandler).not.toBeNull();

    // Simulate a real crash: PTY hit EOF without a shutdown request.
    await act(async () => {
      closedHandler!({
        terminalId: "term-1",
        sessionId: "devserver-abc",
        reason: "pty_eof",
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer!.status).toBe("error");
    expect(devServer!.errorMessage).toContain("exited unexpectedly");
    expect(mockClosePreviewWindow).toHaveBeenCalled();
    expect(usePreviewStore.getState().previewOpen.get(PROJECT)).toBe(false);
  });

  it("dev-server-closed (shutdown_requested) is ignored — does NOT flip status to error", async () => {
    // Regression for the "preview only opens every 2nd time" bug:
    // `start_dev_server` calls `close_all_for_session` to clean up stale
    // PTYs before re-spawning, which fires `dev-server-closed` with
    // `reason: "shutdown_requested"`.  Treating that as a crash used to
    // flip `devServer.status` to "error", which then forced the next
    // Globe click to re-spawn — leaking the actual node child as an
    // orphan that held the user's port.
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: 3000,
      url: "http://localhost:3000",
      status: "running",
    });
    usePreviewStore.getState().setPreviewOpen(PROJECT, true);

    type ClosedEvent = {
      terminalId: string;
      sessionId: string;
      reason: "shutdown_requested" | "pty_eof" | "pty_error";
    };
    let closedHandler: ((event: ClosedEvent) => void) | null = null;
    mockListenDevServerClosed.mockImplementation(
      (cb: (event: ClosedEvent) => void) => {
        closedHandler = cb;
        return Promise.resolve(() => {});
      },
    );

    renderHook(() => usePreviewServer());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(closedHandler).not.toBeNull();

    await act(async () => {
      closedHandler!({
        terminalId: "term-1",
        sessionId: "devserver-abc",
        reason: "shutdown_requested",
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    // Status must remain "running" — this was OUR teardown, not a crash.
    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer!.status).toBe("running");
    expect(mockClosePreviewWindow).not.toHaveBeenCalled();
    expect(usePreviewStore.getState().previewOpen.get(PROJECT)).toBe(true);
  });

  it("dev-server-error event sets previewUrlPrompt for fallback dialog", async () => {
    let errorHandler: ((e: { payload: unknown }) => void) | null = null;
    (listen as Mock).mockImplementation((event: string, handler: (e: { payload: unknown }) => void) => {
      if (event === "dev-server-error") {
        errorHandler = handler;
      }
      return Promise.resolve(() => {});
    });

    renderHook(() => usePreviewServer());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(errorHandler).not.toBeNull();

    await act(async () => {
      errorHandler!({
        payload: {
          message: "Could not detect dev server port.",
          projectPath: PROJECT,
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    const prompt = usePreviewStore.getState().previewUrlPrompt;
    expect(prompt).toEqual({
      projectPath: PROJECT,
      errorMessage: "Could not detect dev server port.",
    });

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer!.status).toBe("error");
  });

  it("dev-server-ready event triggers auto-open preview", async () => {
    // Capture the listen callback for dev-server-ready
    let readyHandler: ((e: { payload: unknown }) => void) | null = null;
    (listen as Mock).mockImplementation((event: string, handler: (e: { payload: unknown }) => void) => {
      if (event === "dev-server-ready") {
        readyHandler = handler;
      }
      return Promise.resolve(() => {});
    });

    renderHook(() => usePreviewServer());

    // Wait for effect to register listeners
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(readyHandler).not.toBeNull();

    // Simulate the event
    await act(async () => {
      readyHandler!({
        payload: {
          port: 3000,
          url: "http://localhost:3000",
          terminalId: "term-1",
          projectPath: PROJECT,
        },
      });
      // Allow the openPreviewWindow promise to resolve
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockOpenPreviewWindow).toHaveBeenCalledWith(
      "http://localhost:3000",
      "my-project",
      PROJECT
    );

    const devServer = usePreviewStore.getState().devServer.get(PROJECT);
    expect(devServer!.status).toBe("running");
    expect(devServer!.port).toBe(3000);
  });
});
