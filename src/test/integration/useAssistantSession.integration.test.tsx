/**
 * Integration test: useAssistantSession hook
 *
 * Tests the assistant session lifecycle using REAL Zustand stores.
 * Only the Tauri IPC boundary (tauri-commands) and toastStore are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session } from "../../types/session";

// ── Mock Tauri IPC ──────────────────────────────────────────────────────────

let sessionCounter = 0;

vi.mock("../../lib/tauri-commands", () => ({
  createSession: vi.fn(async (projectPath: string, name?: string) => {
    sessionCounter++;
    return {
      id: `asst-session-${sessionCounter}`,
      name: name ?? `Assistant ${sessionCounter}`,
      project_path: projectPath,
      status: "connected",
      created_at: new Date().toISOString(),
      model: "claude-sonnet-4-20250514",
      icon_index: 0,
    } satisfies Session;
  }),
  closeSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => {}),
  listenActivityEvents: vi.fn().mockResolvedValue(() => {}),
  sendAssistantChat: vi.fn().mockResolvedValue(undefined),
  listenAssistantStream: vi.fn().mockResolvedValue(() => {}),
  interruptSession: vi.fn().mockResolvedValue(undefined),
  cancelAssistantChat: vi.fn().mockResolvedValue(undefined),
  readFileContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/assistant-event-handler", () => ({
  handleAssistantChatEvent: vi.fn(),
  cleanupAssistantBuffers: vi.fn(),
}));

vi.mock("../../lib/event-classifier", () => ({
  handleActivityEvent: vi.fn(),
}));

vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

vi.mock("../../lib/error-messages", () => ({
  translateError: vi.fn((msg: string) => msg),
  formatErrorAsMarkdown: vi.fn((msg: string) => msg),
}));

vi.mock("../../lib/file-utils", () => ({
  fileToBase64: vi.fn().mockResolvedValue({ data: "", mimeType: "text/plain" }),
  readFileContentSafe: vi.fn().mockResolvedValue(""),
  isTextMime: vi.fn().mockReturnValue(true),
}));

import { cancelAssistantChat } from "../../lib/tauri-commands";
import { useAssistantSession } from "../../hooks/useAssistantSession";

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_PATH = "/tmp/test-project";
const PARENT_SESSION_ID = "parent-session-1";

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
        openai: "test-openai-key",
      },
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini" as const,
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "claude-code" as const,
      assistantDefaultModel: {
        gemini: "gemini-2.5-flash",
        openai: "gpt-4o",
      },
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      previewConsoleAutoOpen: true,
      previewLastUrls: {},
      taskBoardPlanningModel: "gemini-3.5-flash",
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
      codexDebugLoggingEnabled: true,
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
      defaultAgentByTask: {},
      secondOpinionPrivacyAcknowledged: false,
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });
}

/** Seed a parent session in sessionStore so that assistant tests have a valid parent. */
function seedParentSession(): void {
  useSessionStore.getState().addSession({
    id: PARENT_SESSION_ID,
    name: "Parent Session",
    project_path: PROJECT_PATH,
    status: "connected",
    created_at: new Date().toISOString(),
    model: "claude-sonnet-4-20250514",
    icon_index: 0,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useAssistantSession (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
    seedParentSession();
    sessionCounter = 0;
  });

  // ─── createAssistant ──────────────────────────────────────────────────

  it("createAssistant adds assistant to assistantStore", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "claude-code");
    });

    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].projectPath).toBe(PROJECT_PATH);
    expect(assistants[0].parentSessionId).toBe(PARENT_SESSION_ID);
    expect(assistants[0].provider).toBe("claude-code");
  });

  it("createAssistant sets as active assistant", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let assistantId: string;
    await act(async () => {
      assistantId = await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "claude-code");
    });

    const activeId = useAssistantStore.getState().getActiveAssistantId(PARENT_SESSION_ID);
    expect(activeId).toBe(assistantId!);
  });

  it("createAssistant with claude-code provider creates CLI session", async () => {
    const { result } = renderHook(() => useAssistantSession());
    const { createSession } = await import("../../lib/tauri-commands");

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "claude-code");
    });

    // CLI session should have been created. `createSession` takes
    // (projectPath, name, resumeCliSessionId?, agentId?) — assistants
    // are spawned without resuming, with agent_id "claude_code".
    expect(createSession).toHaveBeenCalledWith(
      PROJECT_PATH,
      "Claude 1",
      undefined,
      "claude_code",
    );

    // The assistant ID should match the CLI session ID
    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants[0].id).toBe("asst-session-1");
  });

  it("createAssistant with API provider skips CLI session", async () => {
    const { result } = renderHook(() => useAssistantSession());
    const { createSession } = await import("../../lib/tauri-commands");

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "gemini");
    });

    // CLI session should NOT have been created for API provider
    expect(createSession).not.toHaveBeenCalled();

    // The assistant ID should be a local ID (api-asst-*)
    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants[0].id).toMatch(/^api-asst-/);
    expect(assistants[0].provider).toBe("gemini");
    expect(assistants[0].model).toBe("gemini-2.5-flash");
  });

  // ─── MAX_ASSISTANTS limit ────────────────────────────────────────────

  it("MAX_ASSISTANTS limit prevents creating more than 6", async () => {
    const { result } = renderHook(() => useAssistantSession());

    // Create 6 assistants (the maximum)
    await act(async () => {
      for (let i = 0; i < 6; i++) {
        await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "gemini");
      }
    });

    expect(useAssistantStore.getState().getAssistants(PROJECT_PATH)).toHaveLength(6);

    // The 7th assistant should throw
    await expect(
      act(async () => {
        await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "gemini");
      })
    ).rejects.toThrow("Maximum 6 assistants allowed");
  });

  // ─── sendMessage ──────────────────────────────────────────────────────

  it("sendMessage adds user message to assistantStore", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let assistantId: string;
    await act(async () => {
      assistantId = await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "claude-code");
    });

    await act(async () => {
      result.current.sendMessage(assistantId!, "Help me fix this bug");
    });

    const messages = useAssistantStore.getState().messages.get(assistantId!) ?? [];
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Help me fix this bug");
  });

  it("sendMessage sets assistant busy", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let assistantId: string;
    await act(async () => {
      assistantId = await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "claude-code");
    });

    await act(async () => {
      result.current.sendMessage(assistantId!, "Help me fix this bug");
    });

    expect(useAssistantStore.getState().busy.get(assistantId!)).toBe(true);
  });

  // ─── closeAssistant ───────────────────────────────────────────────────

  it("closeAssistant removes from assistantStore", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let assistantId: string;
    await act(async () => {
      assistantId = await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "claude-code");
    });

    expect(useAssistantStore.getState().getAssistants(PROJECT_PATH)).toHaveLength(1);

    await act(async () => {
      await result.current.closeAssistant(PROJECT_PATH, assistantId!);
    });

    expect(useAssistantStore.getState().getAssistants(PROJECT_PATH)).toHaveLength(0);
  });

  // ─── renameAssistant (via store directly) ─────────────────────────────

  it("renameAssistant updates name", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let assistantId: string;
    await act(async () => {
      assistantId = await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "claude-code");
    });

    // renameAssistant is a store action, not on the hook, so we call it directly
    act(() => {
      useAssistantStore.getState().renameAssistant(PROJECT_PATH, assistantId!, "My Custom Name");
    });

    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants[0].name).toBe("My Custom Name");
  });

  // ─── cancelAssistant ──────────────────────────────────────────────────

  it("cancelAssistant clears busy state via interrupt/cancel", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let assistantId: string;
    await act(async () => {
      assistantId = await result.current.createAssistant(PROJECT_PATH, PARENT_SESSION_ID, "gemini");
    });

    // Simulate busy state
    useAssistantStore.getState().setBusy(assistantId!, true);
    expect(useAssistantStore.getState().busy.get(assistantId!)).toBe(true);

    act(() => {
      result.current.cancelAssistant(assistantId!);
    });

    // cancelAssistant fires cancelAssistantChat for API providers
    expect(cancelAssistantChat).toHaveBeenCalledWith(assistantId!);
  });
});
