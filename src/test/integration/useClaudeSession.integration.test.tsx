/**
 * Integration test: useClaudeSession hook
 *
 * Tests the Claude CLI session lifecycle using REAL Zustand stores.
 * Only the Tauri IPC boundary (tauri-commands) and toastStore are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session } from "../../types/session";

// ── Mock Tauri IPC ──────────────────────────────────────────────────────────

let sessionCounter = 0;

vi.mock("../../lib/tauri-commands", () => ({
  createSession: vi.fn(async (projectPath: string, name?: string) => {
    sessionCounter++;
    return {
      id: `session-${sessionCounter}`,
      name: name ?? `Session ${sessionCounter}`,
      project_path: projectPath,
      status: "connected",
      created_at: new Date().toISOString(),
      model: "claude-sonnet-4-20250514",
      icon_index: 0,
    } satisfies Session;
  }),
  closeSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => {}),
  listenActivityEvents: vi.fn().mockResolvedValue(() => {}),
  initializeSession: vi.fn().mockResolvedValue(undefined),
  saveSessionMessages: vi.fn().mockResolvedValue(undefined),
  loadSessionMessages: vi.fn().mockResolvedValue([]),
  closeTerminal: vi.fn().mockResolvedValue(undefined),
  readFileContent: vi.fn().mockResolvedValue(""),
  syncSessionMode: vi.fn().mockResolvedValue(undefined),
  checkProcessAlive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/event-classifier", () => ({
  handleChatEvent: vi.fn(),
  handleActivityEvent: vi.fn(),
  startStaleDetection: vi.fn(),
  cleanupSession: vi.fn(),
}));

vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

vi.mock("../../lib/error-messages", () => ({
  translateErrorForToast: vi.fn((msg: string) => msg),
}));

import { showToast } from "../../stores/toastStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_PATH = "/tmp/test-project";

function setupSettings(): void {
  useSettingsStore.setState({
    settings: {
      theme: "sand" as const,
      fontSize: 13,
      sendShortcut: "enter" as const,
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: {},
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini" as const,
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "claude-code" as const,
      assistantDefaultModel: {},
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      previewConsoleAutoOpen: true,
      previewLastUrls: {},
      taskBoardPlanningModel: "gemini-3-flash-preview",
      taskBoardMaxTokens: 64000,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
      triviaEnabled: false,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      claudeBinaryOverride: null,
      onboardingCompleted: false,
      apiKeyBannerDismissed: false,
      lastCloneDirectory: null,
      sessionLogsEnabled: false,
      sessionLogsRetentionDays: 30,
      superBroEnabled: false,
      superBroProvider: "auto" as const,
      superBroModel: "auto",
      selfDriveProvider: "anthropic" as const,
      selfDriveModel: "claude-haiku-4-5",
      selfDriveMaxFixAttempts: 3,
      selfDriveRunBuildCheck: true,
      selfDriveRunTests: true,
selfDriveAutoCommit: false,
      selfDriveEnableRecheckLoop: true,
      selfDriveConfirmCapabilities: true,
      defaultThinkingEffort: null,
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useClaudeSession (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
    sessionCounter = 0;
  });

  // ─── startSession ──────────────────────────────────────────────────────

  it("startSession creates session in sessionStore", async () => {
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });

    const sessions = useSessionStore.getState().sessions;
    expect(sessions.size).toBe(1);
    const session = sessions.get("session-1");
    expect(session).toBeDefined();
    expect(session!.project_path).toBe(PROJECT_PATH);
    expect(session!.status).toBe("connected");
  });

  it("startSession sets session as active", async () => {
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });

    expect(useSessionStore.getState().activeSessionId).toBe("session-1");
  });

  it("startSession registers session in tabOrder", async () => {
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.startSession(PROJECT_PATH);
    });

    const { tabOrder } = useSessionStore.getState();
    expect(tabOrder).toContain("session-1");
    expect(tabOrder).toHaveLength(1);
  });

  // ─── sendMessage ───────────────────────────────────────────────────────

  it("sendMessage adds user message to sessionStore", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string;
    await act(async () => {
      sessionId = await result.current.startSession(PROJECT_PATH);
    });

    await act(async () => {
      await result.current.sendMessage(sessionId!, "Hello Claude");
    });

    const messages = useSessionStore.getState().sessionMessages.get(sessionId!) ?? [];
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello Claude");
    expect(messages[0].isStreaming).toBe(false);
  });

  it("sendMessage sets session busy", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string;
    await act(async () => {
      sessionId = await result.current.startSession(PROJECT_PATH);
    });

    await act(async () => {
      await result.current.sendMessage(sessionId!, "Hello Claude");
    });

    expect(useSessionStore.getState().sessionBusy.get(sessionId!)).toBe(true);
  });

  // ─── closeSession ─────────────────────────────────────────────────────

  it("closeSession removes session from store", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string;
    await act(async () => {
      sessionId = await result.current.startSession(PROJECT_PATH);
    });

    expect(useSessionStore.getState().sessions.size).toBe(1);

    await act(async () => {
      await result.current.closeSession(sessionId!);
    });

    expect(useSessionStore.getState().sessions.size).toBe(0);
    expect(useSessionStore.getState().tabOrder).toHaveLength(0);
  });

  it("closeSession cleans up terminal store entries", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string;
    await act(async () => {
      sessionId = await result.current.startSession(PROJECT_PATH);
    });

    // Simulate terminals existing for this session
    useTerminalStore.setState((state) => {
      const sessionTerminals = new Map(state.sessionTerminals);
      sessionTerminals.set(sessionId!, [
        { id: "term-1", sessionId: sessionId!, name: "Terminal 1", sortOrder: 0, createdAt: new Date().toISOString(), isRunning: true },
      ]);
      return { sessionTerminals };
    });

    await act(async () => {
      await result.current.closeSession(sessionId!);
    });

    // Terminal store should be cleared for this session
    const terminals = useTerminalStore.getState().getTerminals(sessionId!);
    expect(terminals).toHaveLength(0);
  });

  // ─── renameSession ────────────────────────────────────────────────────

  it("renameSession updates session name in store", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string;
    await act(async () => {
      sessionId = await result.current.startSession(PROJECT_PATH);
    });

    await act(async () => {
      await result.current.renameSession(sessionId!, "Renamed Session");
    });

    const session = useSessionStore.getState().sessions.get(sessionId!);
    expect(session!.name).toBe("Renamed Session");
  });

  // ─── switchSession ────────────────────────────────────────────────────

  it("switchSession updates activeSessionId", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId1: string;
    let sessionId2: string;
    await act(async () => {
      sessionId1 = await result.current.startSession(PROJECT_PATH);
      sessionId2 = await result.current.startSession(PROJECT_PATH);
    });

    // After creating two sessions, the second one should be active
    expect(useSessionStore.getState().activeSessionId).toBe(sessionId2!);

    act(() => {
      result.current.switchSession(sessionId1!);
    });

    expect(useSessionStore.getState().activeSessionId).toBe(sessionId1!);
  });

  // ─── MAX_SESSIONS limit ──────────────────────────────────────────────

  it("MAX_SESSIONS limit prevents creating more than 10", async () => {
    const { result } = renderHook(() => useClaudeSession());

    // Create 10 sessions (the maximum)
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await result.current.startSession(PROJECT_PATH);
      }
    });

    expect(useSessionStore.getState().tabOrder).toHaveLength(10);

    // The 11th session should throw
    await expect(
      act(async () => {
        await result.current.startSession(PROJECT_PATH);
      })
    ).rejects.toThrow("Maximum 10 sessions allowed");

    expect(showToast).toHaveBeenCalledWith("Maximum 10 sessions allowed", "error");
    expect(useSessionStore.getState().tabOrder).toHaveLength(10);
  });

  // ─── closeSession clears activity entries ─────────────────────────────

  it("closeSession clears activity entries for the session", async () => {
    const { result } = renderHook(() => useClaudeSession());

    let sessionId: string;
    await act(async () => {
      sessionId = await result.current.startSession(PROJECT_PATH);
    });

    // Add activity entries
    useActivityStore.getState().addEntry(sessionId!, {
      id: "entry-1",
      toolUseId: "tool-1",
      toolName: "Read",
      toolInput: {},
      status: "done",
      timestamp: new Date().toISOString(),
      messageId: "msg-1",
      isError: false,
    });

    expect(useActivityStore.getState().getActiveEntries(sessionId!)).toHaveLength(1);

    await act(async () => {
      await result.current.closeSession(sessionId!);
    });

    expect(useActivityStore.getState().getActiveEntries(sessionId!)).toHaveLength(0);
  });
});
