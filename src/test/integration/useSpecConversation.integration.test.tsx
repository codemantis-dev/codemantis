/**
 * Integration test: useSpecConversation hook
 *
 * Tests the spec-writer conversation lifecycle using REAL Zustand stores.
 * Only the Tauri IPC boundary (tauri-commands) and toastStore are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSettingsStore } from "../../stores/settingsStore";

// ── Mock Tauri IPC ──────────────────────────────────────────────────────────

vi.mock("../../lib/tauri-commands", () => ({
  sendAssistantChat: vi.fn().mockResolvedValue(undefined),
  listenAssistantStream: vi.fn(async (id: string, handler: (event: { type: string; text?: string; content?: string; message?: string }) => void) => {
    // Track per-assistantId handlers so tests can drive concurrent streams.
    _streamHandlersById.set(id, handler);
    _streamHandler = handler;
    return () => {
      _streamHandlersById.delete(id);
    };
  }),
  cancelAssistantChat: vi.fn().mockResolvedValue(undefined),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue("project context data"),
  readFileContent: vi.fn().mockResolvedValue(""),
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/spec-prompts", () => ({
  SPEC_READY_PATTERNS: [/READY_TO_WRITE/],
  SPEC_START_PATTERN: /^# Specification/m,
  AUDIT_START_PATTERN: /^# Verification Audit/m,
  AUDIT_FILE_PATTERN: /audit saved to: (.+)/i,
  isLikelySpecDocument: vi.fn().mockReturnValue(false),
  buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
}));

vi.mock("../../lib/spec-option-parser", () => ({
  parseSelectableOptions: vi.fn().mockReturnValue(null),
}));

vi.mock("../../lib/spec-file-requests", () => ({
  handleFileRequests: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/file-utils", () => ({
  fileToBase64: vi.fn().mockResolvedValue({ data: "", mimeType: "text/plain" }),
  isTextMime: vi.fn().mockReturnValue(true),
}));

import { cancelAssistantChat, gatherSpecContext, sendAssistantChat } from "../../lib/tauri-commands";
import { useSpecConversation } from "../../hooks/useSpecConversation";

// Stream handler reference for simulating events (assigned by mock, read by tests)
// @ts-expect-error — write-only in this file but needed for mock capture
let _streamHandler: ((event: { type: string; text?: string; content?: string; message?: string }) => void) | null = null;
const _streamHandlersById: Map<string, (event: { type: string; text?: string; content?: string; message?: string }) => void> = new Map();
const assistantIdFor = (projectPath: string): string => `spec-${projectPath.replace(/[^a-zA-Z0-9]/g, "_")}`;

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_PATH = "/tmp/test-spec-project";

function setupSettings(): void {
  useSettingsStore.setState({
    settings: {
      theme: "sand" as const,
      fontSize: 13,
      sendShortcut: "enter" as const,
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: {
        gemini: "test-gemini-key",
      },
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
      taskBoardPlanningModel: "gemini-2.5-flash",
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
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useSpecConversation (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
    _streamHandler = null;
    _streamHandlersById.clear();
  });

  // ─── sendMessage ──────────────────────────────────────────────────────

  it("sendMessage adds user message to specWriterStore", async () => {
    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Build a todo app with React");
    });

    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH);
    expect(conv).toBeDefined();

    // Should have user message + assistant placeholder
    const userMessages = conv!.messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe("Build a todo app with React");
  });

  it("sendMessage adds assistant placeholder", async () => {
    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Build a todo app");
    });

    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH);
    expect(conv).toBeDefined();

    const assistantMessages = conv!.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).toBe("");
  });

  it("sendMessage sets planningStreaming true", async () => {
    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Build a todo app");
    });

    const streaming = useSpecWriterStore.getState().planningStreaming.get(PROJECT_PATH);
    expect(streaming).toBe(true);
  });

  // ─── cancelStream ─────────────────────────────────────────────────────

  it("cancelStream calls cancelAssistantChat", async () => {
    const { result } = renderHook(() => useSpecConversation());

    // First send a message so there's a stream to cancel
    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Build a todo app");
    });

    act(() => {
      result.current.cancelStream(PROJECT_PATH);
    });

    const expectedAssistantId = `spec-${PROJECT_PATH.replace(/[^a-zA-Z0-9]/g, "_")}`;
    expect(cancelAssistantChat).toHaveBeenCalledWith(expectedAssistantId);
  });

  // ─── loadContext ──────────────────────────────────────────────────────

  it("loadContext gathers and stores project context", async () => {
    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.loadContext(PROJECT_PATH);
    });

    expect(gatherSpecContext).toHaveBeenCalledWith(PROJECT_PATH);

    const context = useSpecWriterStore.getState().projectContext.get(PROJECT_PATH);
    expect(context).toBe("project context data");

    // contextLoaded should be set — check via conversation if initialized
    // (loadContext sets contextLoaded on the store directly, not on conversation)
  });

  // ─── Conversation initialization ──────────────────────────────────────

  it("conversation initializes with correct mode", async () => {
    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Plan my project");
    });

    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH);
    expect(conv).toBeDefined();
    expect(conv!.mode).toBe("feature");
    expect(conv!.ai_provider).toBe("gemini");
    expect(conv!.ai_model).toBe("gemini-2.5-flash");
    expect(conv!.status).toBe("gathering");
  });

  // ─── Error handling ───────────────────────────────────────────────────

  it("handles API error gracefully", async () => {
    // Make sendAssistantChat throw an error
    vi.mocked(sendAssistantChat).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Build an app");
    });

    // planningStreaming should be cleared on error
    const streaming = useSpecWriterStore.getState().planningStreaming.get(PROJECT_PATH);
    expect(streaming).toBe(false);

    // An error message should have been added
    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH);
    expect(conv).toBeDefined();
    const errorMessages = conv!.messages.filter(
      (m) => m.role === "system" && m.content.includes("Failed to send message")
    );
    expect(errorMessages).toHaveLength(1);
  });

  // ─── clearConversation ────────────────────────────────────────────────

  it("clearConversation resets store for project", async () => {
    const { result } = renderHook(() => useSpecConversation());

    // First create a conversation
    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Build a todo app");
    });

    expect(useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH)).toBeDefined();

    // Clear the conversation using the store action
    act(() => {
      useSpecWriterStore.getState().clearConversation(PROJECT_PATH);
    });

    expect(useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH)).toBeUndefined();
  });

  // ─── Cross-project ref isolation (regression for the "audit replaces spec" bug) ───

  it("interleaved streams across two projects do not corrupt each other's content slots", async () => {
    const PROJECT_A = "/tmp/project-a";
    const PROJECT_B = "/tmp/project-b";
    const { result } = renderHook(() => useSpecConversation());

    // Project A starts a stream first.
    await act(async () => {
      await result.current.sendMessage(PROJECT_A, "Spec for A");
    });
    const handlerA = _streamHandlersById.get(assistantIdFor(PROJECT_A));
    expect(handlerA).toBeDefined();

    // Project B starts its own stream while A is still in flight.
    await act(async () => {
      await result.current.sendMessage(PROJECT_B, "Spec for B");
    });
    const handlerB = _streamHandlersById.get(assistantIdFor(PROJECT_B));
    expect(handlerB).toBeDefined();

    // Project A's stream produces an audit document; project B's stream
    // produces a spec document. With the pre-fix shared refs, A's "preStream
    // spec" would land in project B's slot. With per-project state, each
    // project's content lives in its own slot.
    act(() => {
      handlerA!({ type: "delta", text: "# Verification Audit\n\nA contents" });
      handlerB!({ type: "delta", text: "# Specification\n\nB contents" });
    });

    // Wait for the requestAnimationFrame-batched flush.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    const stateMid = useSpecWriterStore.getState();
    expect(stateMid.currentAuditContent.get(PROJECT_A)).toContain("Verification Audit");
    expect(stateMid.currentSpecContent.get(PROJECT_B)).toContain("Specification");
    // Project A must NOT have a spec (it's an audit stream).
    expect(stateMid.currentSpecContent.get(PROJECT_A)).toBeUndefined();
    // Project B must NOT have an audit.
    expect(stateMid.currentAuditContent.get(PROJECT_B)).toBeUndefined();

    // Both streams end.
    act(() => {
      handlerA!({ type: "done" });
      handlerB!({ type: "done" });
    });

    const stateEnd = useSpecWriterStore.getState();
    expect(stateEnd.currentAuditContent.get(PROJECT_A)).toContain("Verification Audit");
    expect(stateEnd.currentSpecContent.get(PROJECT_B)).toContain("Specification");
    // No cross-pollination.
    expect(stateEnd.currentSpecContent.get(PROJECT_A)).toBeUndefined();
    expect(stateEnd.currentAuditContent.get(PROJECT_B)).toBeUndefined();
  });

  // ─── auditPending lifecycle ───────────────────────────────────────────

  it("generateAudit sets auditPending=true and clears it on done", async () => {
    const { result } = renderHook(() => useSpecConversation());

    // Initialize a conversation so the audit-generation message has somewhere to go.
    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Initial message");
    });

    // Click Generate Audit.
    act(() => {
      result.current.generateAudit(PROJECT_PATH);
    });

    expect(useSpecWriterStore.getState().auditPending.get(PROJECT_PATH)).toBe(true);

    // Stream finishes for the audit request — auditPending must clear.
    const handler = _streamHandlersById.get(assistantIdFor(PROJECT_PATH));
    expect(handler).toBeDefined();
    act(() => {
      handler!({ type: "done" });
    });

    expect(useSpecWriterStore.getState().auditPending.get(PROJECT_PATH)).toBeUndefined();
  });

  it("auditPending clears when the stream is cancelled", async () => {
    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, "Initial message");
    });

    act(() => {
      result.current.generateAudit(PROJECT_PATH);
    });
    expect(useSpecWriterStore.getState().auditPending.get(PROJECT_PATH)).toBe(true);

    const handler = _streamHandlersById.get(assistantIdFor(PROJECT_PATH));
    act(() => {
      handler!({ type: "cancelled" });
    });

    expect(useSpecWriterStore.getState().auditPending.get(PROJECT_PATH)).toBeUndefined();
  });
});
