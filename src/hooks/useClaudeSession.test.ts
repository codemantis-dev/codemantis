import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useChangelogStore } from "../stores/changelogStore";
import { useAttachmentStore } from "../stores/attachmentStore";
import { useAssistantStore } from "../stores/assistantStore";
import type { Session, SessionHistoryEntry } from "../types/session";

// Hoist mock functions so they're available in vi.mock factories
const {
  mockHandleChatEvent,
  mockHandleActivityEvent,
  mockStartStaleDetection,
  mockCleanupSession,
  mockCreateSession,
  mockSendMessage,
  mockCloseSession,
  mockRenameSession,
  mockListenChatEvents,
  mockListenActivityEvents,
  mockCloseTerminal,
  mockInitializeSession,
  mockSaveSessionMessages,
  mockLoadSessionMessages,
} = vi.hoisted(() => ({
  mockHandleChatEvent: vi.fn(),
  mockHandleActivityEvent: vi.fn(),
  mockStartStaleDetection: vi.fn(),
  mockCleanupSession: vi.fn(),
  mockCreateSession: vi.fn<(...args: unknown[]) => Promise<Session>>(),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockCloseSession: vi.fn(() => Promise.resolve()),
  mockRenameSession: vi.fn(() => Promise.resolve()),
  mockListenChatEvents: vi.fn(() => Promise.resolve(vi.fn())),
  mockListenActivityEvents: vi.fn(() => Promise.resolve(vi.fn())),
  mockCloseTerminal: vi.fn(() => Promise.resolve()),
  mockInitializeSession: vi.fn(() => Promise.resolve()),
  mockSaveSessionMessages: vi.fn(() => Promise.resolve()),
  mockLoadSessionMessages: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
}));

vi.mock("../lib/event-classifier", () => ({
  handleChatEvent: mockHandleChatEvent,
  handleActivityEvent: mockHandleActivityEvent,
  startStaleDetection: mockStartStaleDetection,
  cleanupSession: mockCleanupSession,
}));

// Mock useAssistantSession
vi.mock("./useAssistantSession", () => ({
  getAssistantListeners: () => new Map(),
}));

vi.mock("../lib/tauri-commands", () => ({
  createSession: mockCreateSession,
  sendMessage: mockSendMessage,
  closeSession: mockCloseSession,
  renameSession: mockRenameSession,
  listenChatEvents: mockListenChatEvents,
  listenActivityEvents: mockListenActivityEvents,
  closeTerminal: mockCloseTerminal,
  initializeSession: mockInitializeSession,
  saveSessionMessages: mockSaveSessionMessages,
  loadSessionMessages: mockLoadSessionMessages,
}));

// Mock input-drafts
vi.mock("../lib/input-drafts", () => ({
  inputDrafts: new Map(),
}));

// Mock showToast
vi.mock("../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

import { useSettingsStore } from "../stores/settingsStore";
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
    expect(mockCreateSession).toHaveBeenCalledWith(
      PROJECT_PATH,
      undefined,
      undefined,
      "claude_code",
    );
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

    expect(mockCreateSession).toHaveBeenCalledWith(
      PROJECT_PATH,
      undefined,
      undefined,
      "claude_code",
    );
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
    expect(mockCleanupSession).toHaveBeenCalledWith("s1");
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
      sessionId = await result.current.resumeFromHistory(
        PROJECT_PATH, "cli-abc-123", "Old Session", undefined, undefined, "codex",
      );
    });

    expect(sessionId).toBe("s1");
    // Regression: the resume token is agent-specific (here a Codex thread
    // id), so the originating agent MUST be forwarded to create_session —
    // otherwise the Rust backend defaults to ClaudeCode and rejects it with
    // "No conversation found with session ID".
    expect(mockCreateSession).toHaveBeenCalledWith(PROJECT_PATH, "Old Session", "cli-abc-123", "codex");
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

  it("resumeFromHistory loads stored messages regardless of sessionLogsEnabled", async () => {
    // Disable session logs — loading should STILL work
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, sessionLogsEnabled: false },
    });

    mockCreateSession.mockResolvedValueOnce(makeSession("new-s1", { id: "new-s1" }));
    mockLoadSessionMessages.mockResolvedValueOnce([
      { id: "m1", role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z", thinkingContent: null, sortOrder: 0 },
      { id: "m2", role: "assistant", content: "Hi back", timestamp: "2026-01-01T00:01:00Z", thinkingContent: null, sortOrder: 1 },
    ]);

    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.resumeFromHistory(PROJECT_PATH, "cli-abc", "Old Session", "orig-session-id");
    });

    // loadSessionMessages should be called with the original session ID
    expect(mockLoadSessionMessages).toHaveBeenCalledWith("orig-session-id");

    // Messages should be set on the NEW session
    const messages = useSessionStore.getState().sessionMessages.get("new-s1") ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello");
    expect(messages[0].isRestored).toBe(true);
    expect(messages[1].content).toBe("Hi back");
  });

  it("resumeFromHistory handles empty stored messages gracefully", async () => {
    mockCreateSession.mockResolvedValueOnce(makeSession("new-s1", { id: "new-s1" }));
    mockLoadSessionMessages.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.resumeFromHistory(PROJECT_PATH, "cli-abc", "Old Session", "orig-session-id");
    });

    expect(mockLoadSessionMessages).toHaveBeenCalledWith("orig-session-id");
    // Session messages should be the initial empty array from addSession
    const messages = useSessionStore.getState().sessionMessages.get("new-s1") ?? [];
    expect(messages).toHaveLength(0);
  });

  it("closeSession saves messages when sessionLogsEnabled is true", async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, sessionLogsEnabled: true },
    });

    useSessionStore.getState().addSession(makeSession("s1"));
    // Add some messages to the session
    useSessionStore.getState().addMessage("s1", {
      id: "msg-1", role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z",
      activityIds: [], isStreaming: false,
    });
    useSessionStore.getState().addMessage("s1", {
      id: "msg-2", role: "assistant", content: "Hi", timestamp: "2026-01-01T00:01:00Z",
      activityIds: [], isStreaming: false,
    });

    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.closeSession("s1");
    });

    expect(mockSaveSessionMessages).toHaveBeenCalledWith("s1", expect.arrayContaining([
      expect.objectContaining({ id: "msg-1", role: "user", content: "Hello" }),
      expect.objectContaining({ id: "msg-2", role: "assistant", content: "Hi" }),
    ]));
  });

  it("closeSession does NOT save messages when sessionLogsEnabled is false", async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, sessionLogsEnabled: false },
    });

    useSessionStore.getState().addSession(makeSession("s1"));
    useSessionStore.getState().addMessage("s1", {
      id: "msg-1", role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z",
      activityIds: [], isStreaming: false,
    });

    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.closeSession("s1");
    });

    expect(mockSaveSessionMessages).not.toHaveBeenCalled();
  });

  it("restorePausedSession adds a tab in paused-recovered status and loads stored messages", async () => {
    mockLoadSessionMessages.mockResolvedValueOnce([
      { id: "m1", role: "user", content: "from before crash", timestamp: "2026-01-01T00:00:00Z", thinkingContent: null, sortOrder: 0 },
    ]);
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.restorePausedSession({
        session_id: "crashed-1",
        name: "Crashed Tab",
        project_path: PROJECT_PATH,
        model: "sonnet",
        closed_at: "2026-01-01T00:00:00Z",
        cli_session_id: "cli-old",
        icon_index: 3,
        recent_headlines: [],
        has_stored_messages: true,
        agent_id: "claude_code",
      });
    });

    const session = useSessionStore.getState().sessions.get("crashed-1");
    expect(session).toBeDefined();
    expect(session!.status).toBe("paused-recovered");
    expect(session!.cli_session_id).toBe("cli-old");

    // CLI must NOT be spawned for paused tabs
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockListenChatEvents).not.toHaveBeenCalled();

    const messages = useSessionStore.getState().sessionMessages.get("crashed-1") ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("from before crash");
    expect(messages[0].isRestored).toBe(true);
  });

  it("restorePausedSession is idempotent for the same session id", async () => {
    mockLoadSessionMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useClaudeSession());
    const entry: SessionHistoryEntry = {
      session_id: "crashed-1",
      name: "C",
      project_path: PROJECT_PATH,
      model: null,
      closed_at: "2026-01-01T00:00:00Z",
      cli_session_id: "cli-old",
      icon_index: 0,
      recent_headlines: [],
      has_stored_messages: false,
      agent_id: "claude_code",
    };

    await act(async () => {
      await result.current.restorePausedSession(entry);
      await result.current.restorePausedSession(entry); // second call should no-op
    });

    expect(useSessionStore.getState().tabOrder.filter((id) => id === "crashed-1")).toHaveLength(1);
  });

  it("resumeRecoveredSession spawns CLI via resumeFromHistory and preserves tab position", async () => {
    // Set up a workspace with a live tab, a paused tab, and another live tab.
    mockLoadSessionMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useClaudeSession());

    useSessionStore.getState().addSession(makeSession("live-a"));
    await act(async () => {
      await result.current.restorePausedSession({
        session_id: "crashed-mid",
        name: "Mid",
        project_path: PROJECT_PATH,
        model: null,
        closed_at: "2026-01-01T00:00:00Z",
        cli_session_id: "cli-mid",
        icon_index: 0,
        recent_headlines: [],
        has_stored_messages: false,
        agent_id: "codex",
      });
    });
    useSessionStore.getState().addSession(makeSession("live-b"));

    expect(useSessionStore.getState().tabOrder).toEqual(["live-a", "crashed-mid", "live-b"]);

    // Now resume — createSession returns the new session ID
    mockCreateSession.mockResolvedValueOnce(makeSession("new-mid", { id: "new-mid" }));
    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.resumeRecoveredSession("crashed-mid");
    });

    expect(returned).toBe("new-mid");
    // resumeFromHistory invokes createSession with the stored cli_session_id
    // AND the paused tab's agent ("codex" here) — a recovered Codex session
    // must re-spawn Codex, not default to Claude (regression: "No
    // conversation found with session ID").
    expect(mockCreateSession).toHaveBeenCalledWith(PROJECT_PATH, "Mid", "cli-mid", "codex");
    // Tab position preserved (index 1 between live-a and live-b)
    expect(useSessionStore.getState().tabOrder).toEqual(["live-a", "new-mid", "live-b"]);
    // Old paused entry is gone
    expect(useSessionStore.getState().sessions.has("crashed-mid")).toBe(false);
  });

  it("resumeRecoveredSession is a no-op for non-paused sessions", async () => {
    useSessionStore.getState().addSession(makeSession("live-a"));
    const { result } = renderHook(() => useClaudeSession());
    let returned: string | null = "init";
    await act(async () => {
      returned = await result.current.resumeRecoveredSession("live-a");
    });
    expect(returned).toBeNull();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
