import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { useToastStore } from "../stores/toastStore";
import type { SlashCommand } from "../types/slash-commands";
import type { AgentId } from "../types/agent-events";

// Hoist mock functions so they're available in vi.mock factories
const {
  mockSendMessage,
  mockCloseSession,
  mockRenameSession,
  mockExpandSkill,
  mockPauseSessionProcess,
  mockResumeSessionProcess,
  mockSendMessageCmd,
} = vi.hoisted(() => ({
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockCloseSession: vi.fn(() => Promise.resolve()),
  mockRenameSession: vi.fn(() => Promise.resolve()),
  mockExpandSkill: vi.fn(() =>
    Promise.resolve({ prompt: "expanded skill prompt", allowed_tools: null, model: null, context_fork: false })
  ),
  mockPauseSessionProcess: vi.fn(() => Promise.resolve()),
  mockResumeSessionProcess: vi.fn(() => Promise.resolve()),
  mockSendMessageCmd: vi.fn(() => Promise.resolve()),
}));

// Mock useClaudeSession
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
vi.mock("../lib/tauri-commands", () => ({
  expandSkill: mockExpandSkill,
  pauseSessionProcess: mockPauseSessionProcess,
  resumeSessionProcess: mockResumeSessionProcess,
  sendMessage: mockSendMessageCmd,
}));

import { useCommandExecution, codexDispatchKind } from "./useCommandExecution";

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

function setupActiveSession(agentId?: AgentId): void {
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
        ...(agentId ? { agent_id: agentId } : {}),
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
      cliOverlayCodexMode: null,
      showCodexPanel: false,
      codexPanelSessionId: null,
      codexPanelTab: "config",
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

  it("/clear: clears session data and approval state, but preserves activity entries", async () => {
    setupActiveSession();
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: "msg-1",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    // Add activity entries and approval state before clearing
    useActivityStore.getState().addEntry(SESSION_ID, {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: { file_path: "src/main.rs" },
      status: "done", timestamp: "2026-01-01T00:00:00Z", messageId: "msg-1", isError: false,
    });
    useActivityStore.getState().addEntry(SESSION_ID, {
      id: "a2", toolUseId: "t2", toolName: "Write", toolInput: { file_path: "src/lib.rs" },
      status: "done", timestamp: "2026-01-01T00:01:00Z", messageId: "msg-1", isError: false,
    });
    useActivityStore.getState().enqueueApproval({
      requestId: "r3", toolUseId: "t3", toolName: "Bash", toolInput: { command: "cargo build" },
      sessionId: SESSION_ID, timestamp: "2026-01-01T00:02:00Z",
    });
    useActivityStore.getState().addAlwaysAllowedTool(SESSION_ID, "Read");

    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(makeCommand({ name: "clear" }), "");
    });

    expect(mockPauseSessionProcess).toHaveBeenCalledWith(SESSION_ID);
    expect(mockResumeSessionProcess).toHaveBeenCalledWith(SESSION_ID);
    // Session messages should be cleared
    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(0);
    // Activity entries must be preserved
    const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
    expect(entries).toHaveLength(2);
    expect(entries[0].toolName).toBe("Read");
    expect(entries[1].toolName).toBe("Write");
    // Approval state must be cleared
    expect(useActivityStore.getState().approvalQueue).toHaveLength(0);
    expect(useActivityStore.getState().isToolAlwaysAllowed(SESSION_ID, "Read")).toBe(false);
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
        apiCallCount: 0, totalReasoningOutputTokens: 0,
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

  it("cli-only (Claude): leaves cliOverlayCodexMode null", async () => {
    setupActiveSession(); // no agent_id → Claude
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(
        makeCommand({ name: "model", category: "cli-only" }),
        ""
      );
    });

    expect(useUiStore.getState().showCliOverlay).toBe(true);
    expect(useUiStore.getState().cliOverlayCodexMode).toBeNull();
  });

  it("cli-only (Codex /plan): opens overlay in resume-tui mode", async () => {
    setupActiveSession("codex");
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(
        makeCommand({ name: "plan", category: "cli-only" }),
        ""
      );
    });

    expect(useUiStore.getState().showCliOverlay).toBe(true);
    expect(useUiStore.getState().cliOverlayInitialInput).toBe("/plan");
    expect(useUiStore.getState().cliOverlayCodexMode).toBe("resume-tui");
    // resume-tui commands must NOT open the management panel
    expect(useUiStore.getState().showCodexPanel).toBe(false);
  });

  it("cli-only (Codex /login): opens overlay in subcommand mode", async () => {
    setupActiveSession("codex");
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(
        makeCommand({ name: "login", category: "cli-only" }),
        ""
      );
    });

    expect(useUiStore.getState().showCliOverlay).toBe(true);
    expect(useUiStore.getState().cliOverlayCodexMode).toBe("subcommand");
  });

  it("cli-only (Codex /config): opens management panel, not the overlay", async () => {
    setupActiveSession("codex");
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(
        makeCommand({ name: "config", category: "cli-only" }),
        ""
      );
    });

    expect(useUiStore.getState().showCodexPanel).toBe(true);
    expect(useUiStore.getState().codexPanelTab).toBe("config");
    expect(useUiStore.getState().showCliOverlay).toBe(false);
  });

  it("cli-only (Codex /mcp): opens management panel on the mcp tab", async () => {
    setupActiveSession("codex");
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(
        makeCommand({ name: "mcp", category: "cli-only" }),
        ""
      );
    });

    expect(useUiStore.getState().showCodexPanel).toBe(true);
    expect(useUiStore.getState().codexPanelTab).toBe("mcp");
    expect(useUiStore.getState().showCliOverlay).toBe(false);
  });
});

describe("codexDispatchKind", () => {
  it("routes config and mcp to the management panel", () => {
    expect(codexDispatchKind("config")).toBe("panel");
    expect(codexDispatchKind("mcp")).toBe("panel");
  });

  it("routes interactive TUI commands to resume-tui", () => {
    for (const name of ["plan", "model", "approvals", "review", "status", "diff"]) {
      expect(codexDispatchKind(name)).toBe("resume-tui");
    }
  });

  it("routes one-shot subcommands to subcommand", () => {
    for (const name of ["login", "logout", "update", "fork", "resume", "apply"]) {
      expect(codexDispatchKind(name)).toBe("subcommand");
    }
  });

  it("falls back to subcommand for unknown commands", () => {
    expect(codexDispatchKind("totally-unknown")).toBe("subcommand");
  });
});
