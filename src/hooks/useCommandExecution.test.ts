import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { useToastStore } from "../stores/toastStore";
import type { SlashCommand } from "../types/slash-commands";

// Mock useClaudeSession
const mockSendMessage = vi.fn(() => Promise.resolve());
const mockCloseSession = vi.fn(() => Promise.resolve());
const mockRenameSession = vi.fn(() => Promise.resolve());

vi.mock("./useClaudeSession", () => ({
  useClaudeSession: () => ({
    sendMessage: mockSendMessage,
    closeSession: mockCloseSession,
    renameSession: mockRenameSession,
    startSession: vi.fn(),
    addSessionToProject: vi.fn(),
    closeAllSessionsInProject: vi.fn(),
    switchSession: vi.fn(),
    resumeFromHistory: vi.fn(),
  }),
}));

// Mock tauri-commands
const mockExpandSkill = vi.fn(() =>
  Promise.resolve({ prompt: "expanded skill prompt", allowed_tools: null, model: null, context_fork: false })
);
const mockPauseSessionProcess = vi.fn(() => Promise.resolve());
const mockResumeSessionProcess = vi.fn(() => Promise.resolve());
const mockSendMessageCmd = vi.fn(() => Promise.resolve());

vi.mock("../lib/tauri-commands", () => ({
  expandSkill: (...args: unknown[]) => mockExpandSkill(...args),
  pauseSessionProcess: (...args: unknown[]) => mockPauseSessionProcess(...args),
  resumeSessionProcess: (...args: unknown[]) => mockResumeSessionProcess(...args),
  sendMessage: (...args: unknown[]) => mockSendMessageCmd(...args),
}));

import { useCommandExecution } from "./useCommandExecution";

const SESSION_ID = "s1";
const PROJECT_PATH = "/tmp/project";

function makeCommand(overrides: Partial<SlashCommand>): SlashCommand {
  return {
    name: "test",
    description: "Test command",
    category: "built-in",
    source_path: null,
    argument_hint: null,
    model: null,
    user_invocable: true,
    ...overrides,
  };
}

function setupActiveSession(): void {
  useSessionStore.setState({
    sessions: new Map([
      [SESSION_ID, {
        id: SESSION_ID,
        name: "Test Session",
        project_path: PROJECT_PATH,
        status: "connected",
        created_at: "",
        model: "sonnet",
        icon_index: 0,
        cli_session_id: "cli-123",
      }],
    ]),
    activeSessionId: SESSION_ID,
    activeProjectPath: PROJECT_PATH,
    sessionMessages: new Map([[SESSION_ID, []]]),
    sessionStreaming: new Map([[SESSION_ID, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
    sessionContext: new Map(),
    sessionStats: new Map(),
    sessionModes: new Map(),
    sessionBusy: new Map(),
    tabOrder: [SESSION_ID],
  });
}

describe("useCommandExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      sessionStats: new Map(),
      sessionModes: new Map(),
      sessionBusy: new Map(),
      tabOrder: [],
    });
    useActivityStore.setState({
      sessionEntries: new Map(),
      sessionQuestions: new Map(),
      alwaysAllowedTools: new Map(),
      approvalQueue: [],
      approvalSeenIds: new Set(),
      currentApprovalIndex: 0,
    });
    useUiStore.setState({
      showCliOverlay: false,
      cliOverlayInitialInput: null,
    });
    useToastStore.setState({ toasts: [] });
  });

  it("returns isExecuting: false initially", () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());
    expect(result.current.isExecuting).toBe(false);
  });

  it("shows toast if no active session", async () => {
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "help" }), "");
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message === "No active session")).toBe(true);
  });

  it("shows toast if streaming", async () => {
    setupActiveSession();
    useSessionStore.setState({
      sessionStreaming: new Map([
        [SESSION_ID, { isStreaming: true, streamingContent: "...", currentMessageId: "msg-1" }],
      ]),
    });

    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "help" }), "");
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message.includes("Wait for the current response"))).toBe(true);
  });

  it("/clear: clears session data, activity, pauses/resumes process", async () => {
    setupActiveSession();
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: "msg-1",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "clear" }), "");
    });

    expect(mockPauseSessionProcess).toHaveBeenCalledWith(SESSION_ID);
    expect(mockResumeSessionProcess).toHaveBeenCalledWith(SESSION_ID);
    // Session messages should be cleared
    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(0);
  });

  it("/help: adds system message with help text", async () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "help" }), "");
    });

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("CodeMantis Commands");
  });

  it("/context: shows context usage when available", async () => {
    setupActiveSession();
    useSessionStore.setState({
      sessionContext: new Map([[SESSION_ID, { used: 50000, max: 200000 }]]),
    });

    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "context" }), "");
    });

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("50,000");
    expect(messages[0].content).toContain("25%");
  });

  it("/context: shows 'not available' when no context", async () => {
    setupActiveSession();

    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "context" }), "");
    });

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("not available");
  });

  it("/cost: shows cost stats when available", async () => {
    setupActiveSession();
    useSessionStore.setState({
      sessionStats: new Map([[SESSION_ID, {
        totalCostUsd: 0.0123,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 200,
        turnCount: 3,
        apiCallCount: 0,
      }]]),
    });

    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "cost" }), "");
    });

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("$0.0123");
    expect(messages[0].content).toContain("Turns:** 3");
    expect(messages[0].content).toContain("Cache read");
  });

  it("/cost: shows 'not available' when no stats", async () => {
    setupActiveSession();

    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "cost" }), "");
    });

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("not available");
  });

  it("/compact: sends /compact to CLI", async () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "compact" }), "");
    });

    expect(mockSendMessageCmd).toHaveBeenCalledWith(SESSION_ID, "/compact");
  });

  it("/exit: calls closeSession", async () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "exit" }), "");
    });

    expect(mockCloseSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("/rename: renames session with args", async () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "rename" }), "New Name");
    });

    expect(mockRenameSession).toHaveBeenCalledWith(SESSION_ID, "New Name");
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message.includes("New Name"))).toBe(true);
  });

  it("/rename: shows toast if no args", async () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "rename" }), "");
    });

    expect(mockRenameSession).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message.includes("Usage"))).toBe(true);
  });

  it("skill: expands and sends via sendMessage", async () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(
        makeCommand({
          name: "review",
          category: "skill",
          source_path: "/tmp/project/.claude/commands/review.md",
        }),
        "some args"
      );
    });

    expect(mockExpandSkill).toHaveBeenCalledWith(
      PROJECT_PATH,
      "/tmp/project/.claude/commands/review.md",
      "some args",
      "cli-123"
    );
    expect(mockSendMessage).toHaveBeenCalledWith(SESSION_ID, "expanded skill prompt");
  });

  it("cli-only: sets CLI overlay input and shows overlay", async () => {
    setupActiveSession();
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(
        makeCommand({ name: "config", category: "cli-only" }),
        "some-flag"
      );
    });

    expect(useUiStore.getState().cliOverlayInitialInput).toBe("/config some-flag");
    expect(useUiStore.getState().showCliOverlay).toBe(true);
  });
});
