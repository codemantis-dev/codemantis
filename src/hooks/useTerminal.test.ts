import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TerminalInfo } from "../lib/tauri-commands";

const mockCreateTerminalCmd = vi.fn<
  (sessionId: string, cwd: string, shell?: string, name?: string) => Promise<TerminalInfo>
>();
const mockCloseTerminalCmd = vi.fn<(terminalId: string) => Promise<void>>();
const mockSendInputCmd = vi.fn<(terminalId: string, data: string) => Promise<void>>();
const mockResizeTerminalCmd = vi.fn<(terminalId: string, cols: number, rows: number) => Promise<void>>();

vi.mock("../lib/tauri-commands", () => ({
  createTerminal: (...args: unknown[]) =>
    mockCreateTerminalCmd(...(args as [string, string, string?, string?])),
  closeTerminal: (...args: unknown[]) =>
    mockCloseTerminalCmd(...(args as [string])),
  sendTerminalInput: (...args: unknown[]) =>
    mockSendInputCmd(...(args as [string, string])),
  resizeTerminal: (...args: unknown[]) =>
    mockResizeTerminalCmd(...(args as [string, number, number])),
}));

vi.mock("../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

import { useTerminal } from "./useTerminal";
import { useTerminalStore } from "../stores/terminalStore";
import { useSessionStore } from "../stores/sessionStore";
import { showToast } from "../stores/toastStore";

describe("useTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset terminal store
    useTerminalStore.setState({
      sessionTerminals: new Map(),
      activeTerminalId: new Map(),
      detectedDevServers: new Map(),
    });

    // Set up a test session
    useSessionStore.setState({
      sessions: new Map([
        [
          "s1",
          {
            id: "s1",
            name: "Test Session",
            project_path: "/test/project",
            status: "connected" as const,
            created_at: "",
            model: null,
            icon_index: 0,
          },
        ],
      ]),
      activeSessionId: "s1",
    });
  });

  it("createTerminal calls backend and adds to store", async () => {
    mockCreateTerminalCmd.mockResolvedValueOnce({
      id: "term-1",
      session_id: "s1",
      name: "Terminal 1",
    });

    const { result } = renderHook(() => useTerminal());

    let terminalId: string | null = null;
    await act(async () => {
      terminalId = await result.current.createTerminal("s1");
    });

    expect(terminalId).toBe("term-1");
    expect(mockCreateTerminalCmd).toHaveBeenCalledWith(
      "s1",
      "/test/project",
      undefined,
      "Terminal 1"
    );

    const terminals = useTerminalStore.getState().getTerminals("s1");
    expect(terminals).toHaveLength(1);
    expect(terminals[0].id).toBe("term-1");
    expect(terminals[0].name).toBe("Terminal 1");
  });

  it("createTerminal returns null when MAX_TERMINALS (6) reached", async () => {
    // Pre-fill store with 6 terminals
    const terminals = Array.from({ length: 6 }, (_, i) => ({
      id: `term-${i}`,
      sessionId: "s1",
      name: `Terminal ${i + 1}`,
      sortOrder: i + 1,
      createdAt: new Date().toISOString(),
      isRunning: true,
    }));

    useTerminalStore.setState({
      sessionTerminals: new Map([["s1", terminals]]),
    });

    const { result } = renderHook(() => useTerminal());

    let terminalId: string | null = null;
    await act(async () => {
      terminalId = await result.current.createTerminal("s1");
    });

    expect(terminalId).toBeNull();
    expect(mockCreateTerminalCmd).not.toHaveBeenCalled();
  });

  it("createTerminal returns null for missing session", async () => {
    const { result } = renderHook(() => useTerminal());

    let terminalId: string | null = null;
    await act(async () => {
      terminalId = await result.current.createTerminal("nonexistent");
    });

    expect(terminalId).toBeNull();
    expect(mockCreateTerminalCmd).not.toHaveBeenCalled();
  });

  it("closeTerminal calls backend and removes from store", async () => {
    // Add a terminal first
    useTerminalStore.getState().addTerminal("s1", {
      id: "term-1",
      sessionId: "s1",
      name: "Terminal 1",
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      isRunning: true,
    });

    mockCloseTerminalCmd.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.closeTerminal("s1", "term-1");
    });

    expect(mockCloseTerminalCmd).toHaveBeenCalledWith("term-1");
    expect(useTerminalStore.getState().getTerminals("s1")).toHaveLength(0);
  });

  it("closeTerminal shows toast on error but still removes from store", async () => {
    useTerminalStore.getState().addTerminal("s1", {
      id: "term-1",
      sessionId: "s1",
      name: "Terminal 1",
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      isRunning: true,
    });

    mockCloseTerminalCmd.mockRejectedValueOnce(new Error("PTY error"));

    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.closeTerminal("s1", "term-1");
    });

    expect(showToast).toHaveBeenCalledWith("Failed to close terminal", "error");
    // Still removed from store even after error
    expect(useTerminalStore.getState().getTerminals("s1")).toHaveLength(0);
  });

  it("sendInput delegates to backend command", async () => {
    mockSendInputCmd.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.sendInput("term-1", "ls -la\n");
    });

    expect(mockSendInputCmd).toHaveBeenCalledWith("term-1", "ls -la\n");
  });

  it("resizeTerminal delegates to backend command", async () => {
    mockResizeTerminalCmd.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.resizeTerminal("term-1", 120, 40);
    });

    expect(mockResizeTerminalCmd).toHaveBeenCalledWith("term-1", 120, 40);
  });

  it("createTerminal increments terminal number", async () => {
    // Add one terminal first
    useTerminalStore.getState().addTerminal("s1", {
      id: "term-1",
      sessionId: "s1",
      name: "Terminal 1",
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      isRunning: true,
    });

    mockCreateTerminalCmd.mockResolvedValueOnce({
      id: "term-2",
      session_id: "s1",
      name: "Terminal 2",
    });

    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.createTerminal("s1");
    });

    // The hook passes `Terminal ${termNum}` where termNum = terminals.length + 1
    expect(mockCreateTerminalCmd).toHaveBeenCalledWith(
      "s1",
      "/test/project",
      undefined,
      "Terminal 2"
    );

    const terminals = useTerminalStore.getState().getTerminals("s1");
    expect(terminals).toHaveLength(2);
    expect(terminals[1].sortOrder).toBe(2);
  });
});
