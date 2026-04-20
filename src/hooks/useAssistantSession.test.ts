import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAssistantStore } from "../stores/assistantStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { Session } from "../types/session";

// Hoist mock functions so they're available in vi.mock factories
const {
  mockHandleAssistantChatEvent,
  mockHandleActivityEvent,
  mockFileToBase64,
  mockIsTextMime,
  mockReadFileContentSafe,
  mockCreateSession,
  mockSendMessage,
  mockCloseSession,
  mockListenChatEvents,
  mockListenActivityEvents,
  mockSendAssistantChat,
  mockListenAssistantStream,
} = vi.hoisted(() => ({
  mockHandleAssistantChatEvent: vi.fn(),
  mockHandleActivityEvent: vi.fn(),
  mockFileToBase64: vi.fn(() =>
    Promise.resolve({ data: "base64data", mimeType: "image/png" })
  ),
  mockIsTextMime: vi.fn((mime: string) => mime.startsWith("text/")),
  mockReadFileContentSafe: vi.fn(() => Promise.resolve("file content here")),
  mockCreateSession: vi.fn<(...args: unknown[]) => Promise<Session>>(),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockCloseSession: vi.fn(() => Promise.resolve()),
  mockListenChatEvents: vi.fn(() => Promise.resolve(vi.fn())),
  mockListenActivityEvents: vi.fn(() => Promise.resolve(vi.fn())),
  mockSendAssistantChat: vi.fn(() => Promise.resolve()),
  mockListenAssistantStream: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../lib/assistant-event-handler", () => ({
  handleAssistantChatEvent: mockHandleAssistantChatEvent,
  cleanupAssistantBuffers: vi.fn(),
}));

vi.mock("../lib/event-classifier", () => ({
  handleActivityEvent: mockHandleActivityEvent,
}));

vi.mock("../lib/file-utils", () => ({
  fileToBase64: mockFileToBase64,
  isTextMime: mockIsTextMime,
  readFileContentSafe: mockReadFileContentSafe,
}));

vi.mock("../lib/input-drafts", () => ({
  assistantInputDrafts: new Map(),
}));

vi.mock("../lib/tauri-commands", () => ({
  createSession: mockCreateSession,
  sendMessage: mockSendMessage,
  closeSession: mockCloseSession,
  listenChatEvents: mockListenChatEvents,
  listenActivityEvents: mockListenActivityEvents,
  sendAssistantChat: mockSendAssistantChat,
  listenAssistantStream: mockListenAssistantStream,
}));

// Mock showToast
vi.mock("../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

import { useAssistantSession } from "./useAssistantSession";

const PROJECT_PATH = "/tmp/project";

function makeSession(id: string): Session {
  return {
    id,
    name: "Test",
    project_path: PROJECT_PATH,
    status: "connected",
    created_at: "",
    model: "sonnet",
    icon_index: 0,
  };
}

function resetStores(): void {
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
  useSettingsStore.setState({
    settings: {
      theme: "midnight",
      fontSize: 13,
      sendShortcut: "cmd+enter",
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: { openai: "sk-test", gemini: "gm-test", anthropic: "ant-test" },
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini",
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "claude-code",
      assistantDefaultModel: { gemini: "gemini-2.5-pro" },
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      triviaEnabled: true,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      claudeBinaryOverride: null,
      onboardingCompleted: false,
      apiKeyBannerDismissed: false,
      lastCloneDirectory: null,
      previewConsoleAutoOpen: true,
      previewLastUrls: {},
      taskBoardPlanningModel: "gemini-3-flash-preview",
      taskBoardMaxTokens: 64000,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
      sessionLogsEnabled: true,
      sessionLogsRetentionDays: 30,
      superBroEnabled: true,
      superBroProvider: "auto",
      superBroModel: "auto",
      selfDriveProvider: "anthropic",
      selfDriveModel: "claude-haiku-4-5",
      selfDriveMaxFixAttempts: 3,
      selfDriveRunBuildCheck: true,
      selfDriveRunTests: true,
selfDriveAutoCommit: false,
      selfDriveEnableRecheckLoop: true,
    },
    loaded: true,
  });
}

describe("useAssistantSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mockCreateSession.mockResolvedValue(makeSession("asst-1"));
  });

  it("createAssistant with claude-code creates CLI session", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let id: string = "";
    await act(async () => {
      id = await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    expect(id).toBe("asst-1");
    expect(mockCreateSession).toHaveBeenCalledWith(PROJECT_PATH, "Claude 1");
    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].provider).toBe("claude-code");
    expect(assistants[0].parentSessionId).toBe("main-s1");
  });

  it("createAssistant with claude-code registers listeners", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    expect(mockListenChatEvents).toHaveBeenCalledWith("asst-1", expect.any(Function));
    expect(mockListenActivityEvents).toHaveBeenCalledWith("asst-1", expect.any(Function));
  });

  it("createAssistant throws at MAX_ASSISTANTS (6)", async () => {
    // Add 6 assistants
    for (let i = 0; i < 6; i++) {
      useAssistantStore.getState().addAssistant(PROJECT_PATH, {
        id: `a${i}`,
        projectPath: PROJECT_PATH,
        parentSessionId: "main-s1",
        name: `Asst ${i}`,
        provider: "openai",
        model: "gpt-4.1",
        sortOrder: i,
        createdAt: new Date().toISOString(),
      });
    }

    const { result } = renderHook(() => useAssistantSession());

    await expect(
      act(async () => {
        await result.current.createAssistant(PROJECT_PATH, "main-s1", "openai");
      })
    ).rejects.toThrow("Maximum 6 assistants allowed");
  });

  it("createAssistant with openai creates API session (no CLI)", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let id: string = "";
    await act(async () => {
      id = await result.current.createAssistant(PROJECT_PATH, "main-s1", "openai");
    });

    expect(id).toMatch(/^api-asst-/);
    expect(mockCreateSession).not.toHaveBeenCalled();
    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].provider).toBe("openai");
    // Should use first model in catalog since no default model for openai
    expect(assistants[0].model).toBe("gpt-4.1");
  });

  it("createAssistant with gemini resolves model from settings", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "gemini");
    });

    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants[0].model).toBe("gemini-2.5-pro");
  });

  it("createAssistant generates sequential names (GPT 1, GPT 2...)", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "openai");
    });

    // Mock a different returned session for the second call
    mockCreateSession.mockResolvedValue(makeSession("asst-2"));

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "openai");
    });

    const assistants = useAssistantStore.getState().getAssistants(PROJECT_PATH);
    expect(assistants[0].name).toBe("GPT 1");
    expect(assistants[1].name).toBe("GPT 2");
  });

  it("sendMessage for claude-code sends via CLI", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    act(() => {
      result.current.sendMessage("asst-1", "Hello");
    });

    // Allow async sendMessageCmd to be called
    await vi.waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith("asst-1", "Hello");
    });
  });

  it("sendMessage for claude-code prepends file refs for attachments", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    const attachments = [
      { id: "a1", filePath: "/tmp/file.ts", fileName: "file.ts", fileSize: 100, mimeType: "text/plain", isImage: false },
    ];

    act(() => {
      result.current.sendMessage("asst-1", "Review this", attachments);
    });

    await vi.waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        "asst-1",
        expect.stringContaining("--- file.ts ---")
      );
    });
  });

  it("sendMessage for API provider calls sendAssistantChat", async () => {
    const { result } = renderHook(() => useAssistantSession());

    let id: string = "";
    await act(async () => {
      id = await result.current.createAssistant(PROJECT_PATH, "main-s1", "openai", "gpt-4.1");
    });

    act(() => {
      result.current.sendMessage(id, "Hello API");
    });

    // sendAssistantChat is called asynchronously inside sendApiMessage
    await vi.waitFor(() => {
      expect(mockSendAssistantChat).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantId: id,
          provider: "openai",
          model: "gpt-4.1",
        })
      );
    });
  });

  it("sendMessage adds user message to store", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    act(() => {
      result.current.sendMessage("asst-1", "Hello");
    });

    const messages = useAssistantStore.getState().messages.get("asst-1") ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
  });

  it("sendMessage sets busy state", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    act(() => {
      result.current.sendMessage("asst-1", "test");
    });

    expect(useAssistantStore.getState().busy.get("asst-1")).toBe(true);
  });

  it("closeAssistant for claude-code closes CLI session", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    await act(async () => {
      await result.current.closeAssistant(PROJECT_PATH, "asst-1");
    });

    expect(mockCloseSession).toHaveBeenCalledWith("asst-1");
  });

  it("closeAssistant removes from store", async () => {
    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    expect(useAssistantStore.getState().getAssistants(PROJECT_PATH)).toHaveLength(1);

    await act(async () => {
      await result.current.closeAssistant(PROJECT_PATH, "asst-1");
    });

    expect(useAssistantStore.getState().getAssistants(PROJECT_PATH)).toHaveLength(0);
  });

  it("closeAssistant cleans up listeners", async () => {
    const mockUnlisten = vi.fn();
    mockListenChatEvents.mockResolvedValue(mockUnlisten);
    mockListenActivityEvents.mockResolvedValue(mockUnlisten);

    const { result } = renderHook(() => useAssistantSession());

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    await act(async () => {
      await result.current.closeAssistant(PROJECT_PATH, "asst-1");
    });

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("closeAllAssistants closes all for project", async () => {
    const { result } = renderHook(() => useAssistantSession());

    mockCreateSession
      .mockResolvedValueOnce(makeSession("asst-1"))
      .mockResolvedValueOnce(makeSession("asst-2"));

    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });
    await act(async () => {
      await result.current.createAssistant(PROJECT_PATH, "main-s1", "claude-code");
    });

    expect(useAssistantStore.getState().getAssistants(PROJECT_PATH)).toHaveLength(2);

    await act(async () => {
      await result.current.closeAllAssistants(PROJECT_PATH);
    });

    expect(useAssistantStore.getState().getAssistants(PROJECT_PATH)).toHaveLength(0);
    // Both CLI sessions should have been closed
    expect(mockCloseSession).toHaveBeenCalledTimes(2);
  });
});
