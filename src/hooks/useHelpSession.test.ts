import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useHelpSession, cleanupHelpSession } from "./useHelpSession";
import { useUiStore } from "../stores/uiStore";
import { useSessionStore } from "../stores/sessionStore";

const mockCreateSession = vi.fn();
const mockSendMessage = vi.fn();
const mockSetSessionModel = vi.fn();
const mockSetSessionMode = vi.fn();
const mockInitializeSession = vi.fn();
const mockReadUserGuide = vi.fn();
const mockListenChatEvents = vi.fn();
const mockCloseSession = vi.fn();

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/Users/test"),
}));

vi.mock("../lib/tauri-commands", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  setSessionModel: (...args: unknown[]) => mockSetSessionModel(...args),
  setSessionMode: (...args: unknown[]) => mockSetSessionMode(...args),
  initializeSession: (...args: unknown[]) => mockInitializeSession(...args),
  readUserGuide: () => mockReadUserGuide(),
  listenChatEvents: (...args: unknown[]) => mockListenChatEvents(...args),
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
}));

vi.mock("../lib/event-classifier", () => ({
  handleChatEvent: vi.fn(),
}));

vi.mock("../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

describe("useHelpSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useUiStore.setState({
      helpSessionId: null,
      helpSessionReady: false,
      helpError: null,
      helpPanelOpen: false,
      helpShowWelcome: true,
    });

    useSessionStore.setState({
      activeProjectPath: "/test/project",
      sessionMessages: new Map(),
      sessionBusy: new Map(),
    });

    mockCreateSession.mockResolvedValue({ id: "help-1" });
    mockListenChatEvents.mockResolvedValue(vi.fn());
    mockInitializeSession.mockResolvedValue(undefined);
    mockSetSessionModel.mockResolvedValue(undefined);
    mockSetSessionMode.mockResolvedValue(undefined);
    mockReadUserGuide.mockResolvedValue("Guide content here");
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("returns initHelpSession and sendHelpMessage functions", () => {
    const { result } = renderHook(() => useHelpSession());
    expect(typeof result.current.initHelpSession).toBe("function");
    expect(typeof result.current.sendHelpMessage).toBe("function");
  });

  it("initHelpSession creates a session and sets up listeners", async () => {
    // Pre-populate an assistant message so waitForFirstAssistantMessage resolves
    const { result } = renderHook(() => useHelpSession());

    // Start init - we need the session store to have the assistant message
    const initPromise = act(async () => {
      // Set up messages that will satisfy the wait
      setTimeout(() => {
        useSessionStore.setState({
          sessionMessages: new Map([["help-1", [
            { id: "m1", role: "assistant" as const, content: "Understood", timestamp: "2024-01-01", activityIds: [], isStreaming: false },
          ]]]),
        });
      }, 10);
      await result.current.initHelpSession();
    });

    await initPromise;

    // v1.5.0 Phase 1: Help session spawns via the per-task resolver,
    // passing agent_id (defaults to "claude_code" with no override).
    expect(mockCreateSession).toHaveBeenCalledWith(
      "/test/project",
      "CodeMantis Help",
      undefined,
      "claude_code",
    );
    expect(mockInitializeSession).toHaveBeenCalledWith("help-1");
    expect(mockSetSessionModel).toHaveBeenCalledWith("help-1", "claude-haiku-4-5");
    expect(mockSetSessionMode).toHaveBeenCalledWith("help-1", "plan");
    expect(mockReadUserGuide).toHaveBeenCalled();
  });

  it("initHelpSession does nothing if session already exists", async () => {
    useUiStore.setState({ helpSessionId: "existing-session" });

    const { result } = renderHook(() => useHelpSession());
    await act(async () => {
      await result.current.initHelpSession();
    });

    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("sendHelpMessage adds user message and sends to backend", async () => {
    useUiStore.setState({
      helpSessionId: "help-1",
      helpSessionReady: true,
    });

    // Create a mock addMessage function
    const mockAddMessage = vi.fn();
    const mockSetSessionBusy = vi.fn();
    useSessionStore.setState({
      addMessage: mockAddMessage,
      setSessionBusy: mockSetSessionBusy,
    });

    const { result } = renderHook(() => useHelpSession());

    await act(async () => {
      await result.current.sendHelpMessage("How do I use templates?");
    });

    expect(mockAddMessage).toHaveBeenCalledWith("help-1", expect.objectContaining({
      role: "user",
      content: "How do I use templates?",
    }));
    expect(mockSetSessionBusy).toHaveBeenCalledWith("help-1", true);
    expect(mockSendMessage).toHaveBeenCalledWith("help-1", "How do I use templates?");
  });

  it("sendHelpMessage does nothing when no session ID", async () => {
    useUiStore.setState({ helpSessionId: null });

    const { result } = renderHook(() => useHelpSession());
    await act(async () => {
      await result.current.sendHelpMessage("test");
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("initHelpSession sets error on failure", async () => {
    mockCreateSession.mockRejectedValue(new Error("Failed to create"));

    const { result } = renderHook(() => useHelpSession());
    await act(async () => {
      await result.current.initHelpSession();
    });

    expect(useUiStore.getState().helpError).toBe("Failed to create");
  });
});

describe("cleanupHelpSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseSession.mockResolvedValue(undefined);
  });

  it("cleans up session state in the UI store", () => {
    useUiStore.setState({
      helpSessionId: "help-1",
      helpSessionReady: true,
    });

    cleanupHelpSession();

    expect(useUiStore.getState().helpSessionId).toBeNull();
    expect(useUiStore.getState().helpSessionReady).toBe(false);
  });

  it("calls closeSession for existing help session", () => {
    useUiStore.setState({ helpSessionId: "help-1" });

    cleanupHelpSession();

    expect(mockCloseSession).toHaveBeenCalledWith("help-1");
  });

  it("does nothing if no help session exists", () => {
    useUiStore.setState({ helpSessionId: null });

    cleanupHelpSession();

    expect(mockCloseSession).not.toHaveBeenCalled();
  });
});
