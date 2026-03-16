import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useChangelogStore } from "../stores/changelogStore";
import { useAttachmentStore } from "../stores/attachmentStore";
import { useAssistantStore } from "../stores/assistantStore";
import type { Session } from "../types/session";

// Mock event-classifier
const mockHandleChatEvent = vi.fn();
const mockHandleActivityEvent = vi.fn();
const mockStartStaleDetection = vi.fn();
const mockStopStaleDetection = vi.fn();

vi.mock("../lib/event-classifier", () => ({
  handleChatEvent: (...args: unknown[]) => mockHandleChatEvent(...args),
  handleActivityEvent: (...args: unknown[]) => mockHandleActivityEvent(...args),
  startStaleDetection: (...args: unknown[]) => mockStartStaleDetection(...args),
  stopStaleDetection: (...args: unknown[]) => mockStopStaleDetection(...args),
}));

// Mock useAssistantSession
vi.mock("./useAssistantSession", () => ({
  getAssistantListeners: () => new Map(),
}));

// Mock tauri-commands
const mockCreateSession = vi.fn<(...args: unknown[]) => Promise<Session>>();
const mockSendMessage = vi.fn(() => Promise.resolve());
const mockCloseSession = vi.fn(() => Promise.resolve());
const mockRenameSession = vi.fn(() => Promise.resolve());
const mockListenChatEvents = vi.fn(() => Promise.resolve(vi.fn()));
const mockListenActivityEvents = vi.fn(() => Promise.resolve(vi.fn()));
const mockCloseTerminal = vi.fn(() => Promise.resolve());
const mockInitializeSession = vi.fn(() => Promise.resolve());

vi.mock("../lib/tauri-commands", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
  renameSession: (...args: unknown[]) => mockRenameSession(...args),
  listenChatEvents: (...args: unknown[]) => mockListenChatEvents(...args),
  listenActivityEvents: (...args: unknown[]) => mockListenActivityEvents(...args),
  closeTerminal: (...args: unknown[]) => mockCloseTerminal(...args),
  initializeSession: (...args: unknown[]) => mockInitializeSession(...args),
}));

// Mock input-drafts
vi.mock("../lib/input-drafts", () => ({
  inputDrafts: new Map(),
}));

// Mock showToast
vi.mock("../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

import { useClaudeSession } from "./useClaudeSession";

const PROJECT_PATH = "/tmp/project";

function makeSession(id: string, overrides?: Partial<Session>): Session {
  return {
    id,
    name: "Test",
    project_path: PROJECT_PATH,
    status: "connected",
    created_at: "",
    model: "sonnet",
    icon_index: 0,
    ...overrides,
  };
}

function resetStores(): void {
  useSessionStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    activeProjectPath: null,
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    sessionStats: new Map(),
    sessionModes: new Map(),
    sessionBusy: new Map(),
    sessionEffort: new Map(),
    sessionRetry: new Map(),
    lastEventTimestamp: new Map(),
    contextToastFired: new Map(),
    sessionActivity: new Map(),
    sessionCompacting: new Map(),
    busySince: new Map(),
    rateLimitUtilization: new Map(),
    sessionCapabilities: new Map(),
    activeSubAgents: new Map(),
    tabOrder: [],
    projectOrder: [],
    projectActiveSession: new Map(),
  });
  useActivityStore.setState({
    sessionEntries: new Map(),
    sessionQuestions: new Map(),
    alwaysAllowedTools: new Map(),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
  });
  useTerminalStore.setState({
    sessionTerminals: new Map(),
    activeTerminalId: new Map(),
    detectedDevServers: new Map(),
  });
  useChangelogStore.setState({
    sessionEntries: new Map(),
    generating: new Map(),
    projectEntries: new Map(),
  });
  useAttachmentStore.setState({
    attachments: new Map(),
  });
  useAssistantStore.setState({
    projectAssistants: new Map(),
    activeAssistantId: new Map(),
    messages: new Map(),
    streaming: new Map(),
    busy: new Map(),
    sessionCost: new Map(),
    attachments: new Map(),
    cliSessionIds: new Map(),
  });
}

describe("useClaudeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mockCreateSession.mockResolvedValue(makeSession("s1"));
  });

  it("startSession creates session and adds to store", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string = "";
    await act(async () => {
      sessionId = await result.current.startSession(PROJECT_PATH);
    });

    expect(sessionId).toBe("s1");
    expect(mockCreateSession).toHaveBeenCalledWith(PROJECT_PATH);
    expect(useSessionStore.getState().sessions.has("s1")).toBe(true);
  });

  it("startSession registers event listeners", async () => {
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });

    expect(mockListenChatEvents).toHaveBeenCalledWith("s1", expect.any(Function));
    expect(mockListenActivityEvents).toHaveBeenCalledWith("s1", expect.any(Function));
  });

  it("startSession throws at MAX_SESSIONS (10)", async () => {
    // Fill 10 sessions
    const sessions = new Map<string, Session>();
    const tabOrder: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `s${i}`;
      sessions.set(id, makeSession(id));
      tabOrder.push(id);
    }
    useSessionStore.setState({ sessions, tabOrder });

    const { result } = renderHook(() => useClaudeSession());

    await expect(
      act(async () => {
        await result.current.startSession(PROJECT_PATH);
      })
    ).rejects.toThrow("Maximum 10 sessions allowed");
  });

  it("startSession calls initializeSession", async () => {
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });

    expect(mockInitializeSession).toHaveBeenCalledWith("s1");
  });

  it("addSessionToProject creates session in active project", async () => {
    useSessionStore.setState({ activeProjectPath: PROJECT_PATH });
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.addSessionToProject();
    });

    expect(mockCreateSession).toHaveBeenCalledWith(PROJECT_PATH);
  });

  it("sendMessage adds user message and calls backend", async () => {
    // Add session to store first
    useSessionStore.getState().addSession(makeSession("s1"));
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.sendMessage("s1", "Hello world");
    });

    const messages = useSessionStore.getState().sessionMessages.get("s1") ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello world");
    expect(mockSendMessage).toHaveBeenCalledWith("s1", "Hello world");
  });

  it("sendMessage sets busy state", async () => {
    useSessionStore.getState().addSession(makeSession("s1"));
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.sendMessage("s1", "test");
    });

    expect(useSessionStore.getState().sessionBusy.get("s1")).toBe(true);
  });

  it("closeSession unlists listeners and removes from all stores", async () => {
    const mockUnlisten = vi.fn();
    mockListenChatEvents.mockResolvedValue(mockUnlisten);
    mockListenActivityEvents.mockResolvedValue(mockUnlisten);

    const { result } = renderHook(() => useClaudeSession());

    // Start a session first to register listeners
    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });

    await act(async () => {
      await result.current.closeSession("s1");
    });

    expect(mockUnlisten).toHaveBeenCalled();
    expect(mockStopStaleDetection).toHaveBeenCalledWith("s1");
    expect(mockCloseSession).toHaveBeenCalledWith("s1");
    expect(useSessionStore.getState().sessions.has("s1")).toBe(false);
  });

  it("closeSession closes terminals", async () => {
    useSessionStore.getState().addSession(makeSession("s1"));
    useTerminalStore.getState().addTerminal("s1", {
      id: "term-1",
      sessionId: "s1",
      name: "Terminal 1",
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      isRunning: true,
      kind: "shell",
    });

    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.closeSession("s1");
    });

    expect(mockCloseTerminal).toHaveBeenCalledWith("term-1");
    expect(useTerminalStore.getState().getTerminals("s1")).toHaveLength(0);
  });

  it("closeSession clears input drafts", async () => {
    const { inputDrafts } = await import("../lib/input-drafts");
    inputDrafts.set("s1", "draft text");
    useSessionStore.getState().addSession(makeSession("s1"));

    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.closeSession("s1");
    });

    expect(inputDrafts.has("s1")).toBe(false);
  });

  it("closeAllSessionsInProject closes all sessions for given path", async () => {
    // Create two sessions in the same project
    mockCreateSession
      .mockResolvedValueOnce(makeSession("s1"))
      .mockResolvedValueOnce(makeSession("s2", { id: "s2" }));

    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });
    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });

    expect(useSessionStore.getState().tabOrder).toHaveLength(2);

    await act(async () => {
      await result.current.closeAllSessionsInProject(PROJECT_PATH);
    });

    expect(useSessionStore.getState().tabOrder).toHaveLength(0);
  });

  it("switchSession sets active session", () => {
    useSessionStore.getState().addSession(makeSession("s1"));
    useSessionStore.getState().addSession(makeSession("s2", { id: "s2" }));

    const { result } = renderHook(() => useClaudeSession());

    act(() => {
      result.current.switchSession("s1");
    });

    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("renameSession updates store and calls backend", async () => {
    useSessionStore.getState().addSession(makeSession("s1"));
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.renameSession("s1", "New Name");
    });

    const session = useSessionStore.getState().sessions.get("s1");
    expect(session!.name).toBe("New Name");
    expect(mockRenameSession).toHaveBeenCalledWith("s1", "New Name");
  });

  it("resumeFromHistory creates session with CLI session ID", async () => {
    mockCreateSession.mockResolvedValueOnce(makeSession("s1"));

    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string = "";
    await act(async () => {
      sessionId = await result.current.resumeFromHistory(PROJECT_PATH, "cli-abc-123", "Old Session");
    });

    expect(sessionId).toBe("s1");
    expect(mockCreateSession).toHaveBeenCalledWith(PROJECT_PATH, "Old Session", "cli-abc-123");
    expect(mockListenChatEvents).toHaveBeenCalled();
    expect(mockStartStaleDetection).toHaveBeenCalledWith("s1");
  });

  it("resumeFromHistory throws at MAX_SESSIONS", async () => {
    const sessions = new Map<string, Session>();
    const tabOrder: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `s${i}`;
      sessions.set(id, makeSession(id));
      tabOrder.push(id);
    }
    useSessionStore.setState({ sessions, tabOrder });

    const { result } = renderHook(() => useClaudeSession());

    await expect(
      act(async () => {
        await result.current.resumeFromHistory(PROJECT_PATH, "cli-abc", "Old");
      })
    ).rejects.toThrow("Maximum 10 sessions allowed");
  });
});
