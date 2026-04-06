import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSettingsStore } from "../stores/settingsStore";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock factories reference them
// ---------------------------------------------------------------------------
const {
  mockCreateSpecwriterSession,
  mockCloseSpecwriterSession,
  mockSendMessage,
  mockInterruptSession,
  mockListenChatEvents,
  mockListTemplates,
  mockGatherSpecContext,
  mockReadFileContent,
} = vi.hoisted(() => ({
  mockCreateSpecwriterSession: vi.fn<(...args: unknown[]) => Promise<string>>(),
  mockCloseSpecwriterSession: vi.fn(() => Promise.resolve()),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockInterruptSession: vi.fn(() => Promise.resolve()),
  mockListenChatEvents: vi.fn(() => Promise.resolve(vi.fn())),
  mockListTemplates: vi.fn(() => Promise.resolve([])),
  mockGatherSpecContext: vi.fn(() => Promise.resolve("Project context text")),
  mockReadFileContent: vi.fn(() => Promise.resolve("")),
}));

vi.mock("../lib/tauri-commands", () => ({
  createSpecwriterSession: mockCreateSpecwriterSession,
  closeSpecwriterSession: mockCloseSpecwriterSession,
  sendMessage: mockSendMessage,
  interruptSession: mockInterruptSession,
  listenChatEvents: mockListenChatEvents,
  listTemplates: mockListTemplates,
  gatherSpecContext: mockGatherSpecContext,
  readFileContent: mockReadFileContent,
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/spec-option-parser", () => ({
  parseSelectableOptions: vi.fn(() => null),
}));

import { useSpecConversationClaude } from "./useSpecConversationClaude";

const PROJECT = "/tmp/test-project";

function resetStores(): void {
  useSpecWriterStore.setState({
    conversations: new Map(),
    uiState: new Map(),
    planningStreaming: new Map(),
    currentSpecContent: new Map(),
    currentAuditContent: new Map(),
    savedSpecs: new Map(),
    fileRequestsPending: new Map(),
    projectContext: new Map(),
    draftText: new Map(),
    draftAttachments: new Map(),
    cliSessionIds: new Map(),
  });
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      taskBoardPlanningModel: "claude-sonnet-4-6",
    },
  });
}

beforeEach(() => {
  resetStores();
  vi.clearAllMocks();
  mockCreateSpecwriterSession.mockResolvedValue("cli-session-123");
});

describe("useSpecConversationClaude", () => {
  // -----------------------------------------------------------------------
  // loadContext
  // -----------------------------------------------------------------------
  describe("loadContext", () => {
    it("calls gatherSpecContext and updates store", async () => {
      mockGatherSpecContext.mockResolvedValue("src/ has 20 files...");

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.loadContext(PROJECT);
      });

      expect(mockGatherSpecContext).toHaveBeenCalledWith(PROJECT);
      const store = useSpecWriterStore.getState();
      expect(store.projectContext.get(PROJECT)).toBe("src/ has 20 files...");
    });

    it("sets contextLoaded to true on success", async () => {
      // Need a conversation to store context_loaded on
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.loadContext(PROJECT);
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv?.context_loaded).toBe(true);
    });

    it("handles error gracefully and sets contextLoaded to false", async () => {
      mockGatherSpecContext.mockRejectedValue(new Error("disk full"));

      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.loadContext(PROJECT);
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv?.context_loaded).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // ensureSession (tested indirectly via sendMessage)
  // -----------------------------------------------------------------------
  describe("ensureSession", () => {
    it("creates CLI session lazily on first use", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hello");
      });

      expect(mockCreateSpecwriterSession).toHaveBeenCalledTimes(1);
      expect(mockCreateSpecwriterSession).toHaveBeenCalledWith(
        PROJECT,
        "claude-sonnet-4-6",
        expect.any(String), // system prompt
      );
    });

    it("reuses existing session on subsequent calls", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );
      // Pre-set a CLI session ID
      useSpecWriterStore.getState().setCliSessionId(PROJECT, "existing-session");

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hello again");
      });

      // Should NOT create a new session since one already exists
      expect(mockCreateSpecwriterSession).not.toHaveBeenCalled();
      expect(mockListenChatEvents).toHaveBeenCalledWith(
        "existing-session",
        expect.any(Function),
      );
    });
  });

  // -----------------------------------------------------------------------
  // sendMessage
  // -----------------------------------------------------------------------
  describe("sendMessage", () => {
    it("initializes conversation if none exists", async () => {
      // No conversation pre-initialized
      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Build me an app");
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv).toBeDefined();
      expect(conv!.ai_provider).toBe("claude-code");
      expect(conv!.mode).toBe("feature");
    });

    it("adds user and assistant placeholder messages", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Describe the feature");
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv!.messages.length).toBeGreaterThanOrEqual(2);

      const userMsg = conv!.messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe("Describe the feature");

      const assistantMsg = conv!.messages.find((m) => m.role === "assistant");
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe(""); // placeholder
    });

    it("sets planningStreaming to true", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Go");
      });

      // planningStreaming is set to true during send (before turn_complete resets it)
      // Since our mocked listenChatEvents doesn't fire turn_complete, it stays true
      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(true);
    });

    it("inlines text content from attachments", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      const attachments = [
        {
          id: "att-1",
          type: "document" as const,
          name: "readme.md",
          size: 100,
          mime_type: "text/markdown",
          text_content: "# My Project\nSome docs",
          file_path: "/tmp/readme.md",
        },
      ];

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Review this", attachments);
      });

      // The prompt sent to CLI should contain the inlined file content
      expect(mockSendMessage).toHaveBeenCalledWith(
        "cli-session-123",
        expect.stringContaining("--- readme.md ---"),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        "cli-session-123",
        expect.stringContaining("# My Project"),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        "cli-session-123",
        expect.stringContaining("Review this"),
      );
    });

    it("adds description text for image attachments", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      const attachments = [
        {
          id: "att-2",
          type: "image" as const,
          name: "screenshot.png",
          size: 5000,
          mime_type: "image/png",
          file_path: "/tmp/screenshot.png",
        },
      ];

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Look at this", attachments);
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        "cli-session-123",
        expect.stringContaining("[Attached image: /tmp/screenshot.png]"),
      );
    });

    it("handles session creation failure gracefully", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );
      mockCreateSpecwriterSession.mockRejectedValue(new Error("CLI not found"));

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hello");
      });

      // Should add an error system message
      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const errorMsg = conv!.messages.find(
        (m) => m.role === "system" && m.content.includes("Failed to start"),
      );
      expect(errorMsg).toBeDefined();

      // Streaming should be turned off
      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(false);
    });

    it("calls sendMessage command with session ID and prompt", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "What should I build?");
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        "cli-session-123",
        "What should I build?",
      );
    });

    it("sets up event listener via listenChatEvents", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hi");
      });

      expect(mockListenChatEvents).toHaveBeenCalledWith(
        "cli-session-123",
        expect.any(Function),
      );
    });
  });

  // -----------------------------------------------------------------------
  // cancelStream
  // -----------------------------------------------------------------------
  describe("cancelStream", () => {
    it("calls interruptSession on CLI session", () => {
      useSpecWriterStore.getState().setCliSessionId(PROJECT, "session-to-cancel");

      const { result } = renderHook(() => useSpecConversationClaude());

      act(() => {
        result.current.cancelStream(PROJECT);
      });

      expect(mockInterruptSession).toHaveBeenCalledWith("session-to-cancel");
    });

    it("does nothing when no CLI session exists", () => {
      const { result } = renderHook(() => useSpecConversationClaude());

      act(() => {
        result.current.cancelStream(PROJECT);
      });

      expect(mockInterruptSession).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // changeModel
  // -----------------------------------------------------------------------
  describe("changeModel", () => {
    it("closes old session and clears CLI session ID", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );
      useSpecWriterStore.getState().setCliSessionId(PROJECT, "old-session");

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.changeModel(PROJECT, "claude-opus-4-6");
      });

      expect(mockCloseSpecwriterSession).toHaveBeenCalledWith("old-session");
      expect(useSpecWriterStore.getState().cliSessionIds.get(PROJECT)).toBeUndefined();
    });

    it("updates conversation provider and model", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.changeModel(PROJECT, "claude-opus-4-6");
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv!.ai_model).toBe("claude-opus-4-6");
      expect(conv!.ai_provider).toBe("claude-code");
    });

    it("works even when no old session exists", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.changeModel(PROJECT, "claude-opus-4-6");
      });

      // Should not throw; closeSpecwriterSession should not be called
      expect(mockCloseSpecwriterSession).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // writeSpec
  // -----------------------------------------------------------------------
  describe("writeSpec", () => {
    it("sends spec trigger message and sets status to writing", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        result.current.writeSpec(PROJECT);
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv!.status).toBe("writing");

      // Should find the trigger message among user messages
      const triggerMsg = conv!.messages.find(
        (m) => m.role === "user" && m.content.includes("write the specification"),
      );
      expect(triggerMsg).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // generateAudit
  // -----------------------------------------------------------------------
  describe("generateAudit", () => {
    it("sends audit generation prompt", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        result.current.generateAudit(PROJECT);
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const auditMsg = conv!.messages.find(
        (m) => m.role === "user" && m.content.includes("Verification Audit"),
      );
      expect(auditMsg).toBeDefined();
    });

    it("instructs to output document directly, not save to file", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        result.current.generateAudit(PROJECT);
      });

      // The prompt should include the instruction to not save to file
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("do NOT save it to a file"),
      );
    });
  });
});
