import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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
    compactionInfo: new Map(),
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
        // v1.4.1 Phase B.1: hook now passes agent_id so backend can
        // dispatch local-CLI provider correctly. "claude_code" for
        // Claude conversations.
        "claude_code",
      );
    });

    it("passes agent_id=codex when the conversation provider is codex (v1.4.1 Phase B.1)", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "codex", "", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hello");
      });

      expect(mockCreateSpecwriterSession).toHaveBeenCalledTimes(1);
      expect(mockCreateSpecwriterSession).toHaveBeenCalledWith(
        PROJECT,
        "", // Codex picks its own default
        expect.any(String),
        "codex",
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

    it("emits a reference block for project-ref attachments and does not inline content", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      const attachments = [
        {
          id: "ref-1",
          type: "project-ref" as const,
          name: "App.tsx",
          size: 0,
          mime_type: "text/plain",
          file_path: "src/App.tsx",
        },
        {
          id: "ref-2",
          type: "project-ref" as const,
          name: "store.ts",
          size: 0,
          mime_type: "text/plain",
          file_path: "src/stores/store.ts",
        },
      ];

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Explain these", attachments);
      });

      const calls = mockSendMessage.mock.calls as unknown as string[][];
      const sentPrompt = calls[0][1];
      expect(sentPrompt).toContain("[Referenced project files");
      expect(sentPrompt).toContain("- src/App.tsx");
      expect(sentPrompt).toContain("- src/stores/store.ts");
      expect(sentPrompt).toContain("Explain these");
      // project-ref content must NOT be inlined as a document
      expect(sentPrompt).not.toContain("--- App.tsx ---");
      expect(sentPrompt).not.toContain("--- store.ts ---");
    });

    it("places the reference block before any inlined document content", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      const attachments = [
        {
          id: "doc-1",
          type: "document" as const,
          name: "notes.md",
          size: 100,
          mime_type: "text/markdown",
          text_content: "# Notes",
          file_path: "/tmp/notes.md",
        },
        {
          id: "ref-1",
          type: "project-ref" as const,
          name: "App.tsx",
          size: 0,
          mime_type: "text/plain",
          file_path: "src/App.tsx",
        },
      ];

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Look at these", attachments);
      });

      const calls = mockSendMessage.mock.calls as unknown as string[][];
      const sentPrompt = calls[0][1];
      const refIdx = sentPrompt.indexOf("[Referenced project files");
      const docIdx = sentPrompt.indexOf("--- notes.md ---");
      expect(refIdx).toBeGreaterThanOrEqual(0);
      expect(docIdx).toBeGreaterThan(refIdx);
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

    it("clears planningStreaming synchronously (optimistic stop)", async () => {
      // Regression: Stop was dead for Codex because cancelStream only fired
      // interruptSession and waited for a terminal event that Codex may never
      // emit. The spinner must clear immediately, regardless of the interrupt
      // round-trip.
      useSpecWriterStore.getState().initConversation(
        PROJECT, "codex", "", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Go");
      });
      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(true);

      act(() => {
        result.current.cancelStream(PROJECT);
      });

      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(false);
      expect(mockInterruptSession).toHaveBeenCalledWith("cli-session-123");
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
        await result.current.changeModel(PROJECT, "claude-opus-4-8");
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
        await result.current.changeModel(PROJECT, "claude-opus-4-8");
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv!.ai_model).toBe("claude-opus-4-8");
      expect(conv!.ai_provider).toBe("claude-code");
    });

    it("works even when no old session exists", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const { result } = renderHook(() => useSpecConversationClaude());

      await act(async () => {
        await result.current.changeModel(PROJECT, "claude-opus-4-8");
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

  // -----------------------------------------------------------------------
  // Claude Code auto-compaction surfacing
  // -----------------------------------------------------------------------
  describe("compaction surfacing", () => {
    /** Capture the event callback handed to listenChatEvents by the hook. */
    async function sendAndGetEventCallback(): Promise<(e: unknown) => void> {
      const { result } = renderHook(() => useSpecConversationClaude());
      await act(async () => {
        await result.current.sendMessage(PROJECT, "Design a feature");
      });
      const calls = mockListenChatEvents.mock.calls as unknown as Array<[string, (e: unknown) => void]>;
      const call = calls[calls.length - 1];
      return call[1];
    }

    it("records compactionInfo and appends a warning message on compact_complete", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const onEvent = await sendAndGetEventCallback();

      act(() => {
        onEvent({
          type: "compact_complete",
          session_id: "cli-session-123",
          trigger: "auto",
          pre_tokens: 186_000,
        });
      });

      const info = useSpecWriterStore.getState().compactionInfo.get(PROJECT);
      expect(info).toBeDefined();
      expect(info!.trigger).toBe("auto");
      expect(info!.preTokens).toBe(186_000);

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const warning = conv!.messages.find(
        (m) => m.role === "system" && m.content.includes("auto-compacted"),
      );
      expect(warning).toBeDefined();
      expect(warning!.content).toContain("~186K tokens");
      expect(warning!.content).toContain("Opus 4.8");
    });

    it("handles null pre_tokens gracefully", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const onEvent = await sendAndGetEventCallback();

      act(() => {
        onEvent({
          type: "compact_complete",
          session_id: "cli-session-123",
          trigger: "auto",
          pre_tokens: null,
        });
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const warning = conv!.messages.find(
        (m) => m.role === "system" && m.content.includes("auto-compacted"),
      );
      expect(warning).toBeDefined();
      expect(warning!.content).toContain("unknown token count");
      expect(useSpecWriterStore.getState().compactionInfo.get(PROJECT)!.preTokens).toBeNull();
    });

    it("labels manual compactions distinctly", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const onEvent = await sendAndGetEventCallback();

      act(() => {
        onEvent({
          type: "compact_complete",
          session_id: "cli-session-123",
          trigger: "manual",
          pre_tokens: 120_000,
        });
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const warning = conv!.messages.find(
        (m) => m.role === "system" && m.content.includes("manually compacted"),
      );
      expect(warning).toBeDefined();
    });

    it("adds a notice when compacting_status fires with is_compacting=true", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const onEvent = await sendAndGetEventCallback();

      act(() => {
        onEvent({
          type: "compacting_status",
          session_id: "cli-session-123",
          is_compacting: true,
        });
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const notice = conv!.messages.find(
        (m) => m.role === "system" && m.content.includes("compacting this session"),
      );
      expect(notice).toBeDefined();
    });

    it("ignores compacting_status with is_compacting=false", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const onEvent = await sendAndGetEventCallback();

      act(() => {
        onEvent({
          type: "compacting_status",
          session_id: "cli-session-123",
          is_compacting: false,
        });
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const notice = conv!.messages.find(
        (m) => m.role === "system" && m.content.includes("compacting this session"),
      );
      expect(notice).toBeUndefined();
    });

    it("clears compactionInfo at the start of a new user-initiated turn", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );
      // Seed stale compaction info from a previous run
      useSpecWriterStore.getState().setCompactionInfo(PROJECT, {
        trigger: "auto",
        preTokens: 180_000,
        at: new Date(0).toISOString(),
      });

      const { result } = renderHook(() => useSpecConversationClaude());
      await act(async () => {
        await result.current.sendMessage(PROJECT, "A new question");
      });

      expect(useSpecWriterStore.getState().compactionInfo.has(PROJECT)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Codex finalization via text_complete
  //
  // Regression: the hook used to finalize ONLY on turn_complete /
  // process_exited / process_error. Codex's long-lived app-server delivers its
  // reliable end-of-message signal as text_complete and never emits a per-turn
  // process_exited safety net, so a turn whose terminal turn_complete didn't
  // reach the listener left "Thinking…" stuck forever.
  // -----------------------------------------------------------------------
  describe("Codex finalization (text_complete)", () => {
    async function sendAndGetEventCallback(provider: "codex" | "claude-code" = "codex"): Promise<(e: unknown) => void> {
      useSpecWriterStore.getState().initConversation(
        PROJECT, provider, provider === "codex" ? "" : "claude-sonnet-4-6", "feature",
      );
      const { result } = renderHook(() => useSpecConversationClaude());
      await act(async () => {
        await result.current.sendMessage(PROJECT, "Design a feature");
      });
      const calls = mockListenChatEvents.mock.calls as unknown as Array<[string, (e: unknown) => void]>;
      return calls[calls.length - 1][1];
    }

    it("clears planningStreaming and commits content on text_complete with NO turn_complete", async () => {
      const onEvent = await sendAndGetEventCallback();

      act(() => {
        onEvent({ type: "text_delta", session_id: "cli-session-123", text: "Here is " });
        onEvent({ type: "text_delta", session_id: "cli-session-123", text: "my answer." });
        onEvent({ type: "text_complete", session_id: "cli-session-123", full_text: "Here is my answer." });
      });

      // Spinner cleared — the core fix.
      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(false);

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const assistantMsg = [...conv!.messages].reverse().find((m) => m.role === "assistant");
      expect(assistantMsg!.content).toBe("Here is my answer.");
    });

    it("adopts full_text as authoritative when deltas never arrived", async () => {
      const onEvent = await sendAndGetEventCallback();

      // Codex may deliver the agent message only via item/completed (no deltas).
      act(() => {
        onEvent({ type: "text_complete", session_id: "cli-session-123", full_text: "Full message body." });
      });

      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(false);
      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const assistantMsg = [...conv!.messages].reverse().find((m) => m.role === "assistant");
      expect(assistantMsg!.content).toBe("Full message body.");
    });

    it("finalizes exactly once when text_complete is followed by a late turn_complete", async () => {
      const onEvent = await sendAndGetEventCallback();

      // A spec document triggers the one-shot audit-offer side effect, which we
      // count to prove finalizeTurn is idempotent (guarded by state.finalized).
      const spec = "# My Feature — Specification\n\nBody.";

      act(() => {
        onEvent({ type: "text_complete", session_id: "cli-session-123", full_text: spec });
      });
      act(() => {
        // Late turn_complete must be a no-op.
        onEvent({ type: "turn_complete", session_id: "cli-session-123" });
      });

      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const auditOffers = conv!.messages.filter(
        (m) => m.role === "system" && m.content.includes("Generate a Verification Audit"),
      );
      expect(auditOffers).toHaveLength(1);
      expect(useSpecWriterStore.getState().currentSpecContent.get(PROJECT)).toBe(spec);
    });

    it("still finalizes on turn_complete alone (Claude path unchanged)", async () => {
      const onEvent = await sendAndGetEventCallback("claude-code");

      act(() => {
        onEvent({ type: "text_delta", session_id: "cli-session-123", text: "Claude reply." });
        onEvent({ type: "turn_complete", session_id: "cli-session-123" });
      });

      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(false);
      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      const assistantMsg = [...conv!.messages].reverse().find((m) => m.role === "assistant");
      expect(assistantMsg!.content).toBe("Claude reply.");
    });
  });

  // -----------------------------------------------------------------------
  // recoverGuideViaCli — in-band, key-free guide recovery
  //
  // Recognize Guide on the CLI path: a recovery prompt is sent INTO the live
  // session and the reply is captured for the Recognize-Guide flow without
  // ever landing in the chat or touching the spec. Mirrors the AUDIT-PATCH
  // mechanism. See plan again-specwriter-creates-a-humble-scone.
  // -----------------------------------------------------------------------
  describe("recoverGuideViaCli", () => {
    /** Fire the recovery turn, drive its event callback, await the reply. */
    async function runRecovery(
      drive: (onEvent: (e: unknown) => void) => void,
    ): Promise<string> {
      const { result } = renderHook(() => useSpecConversationClaude());
      let recovered = "";
      await act(async () => {
        const p = result.current.recoverGuideViaCli(PROJECT, "Repair this spec into a guide");
        // Wait until sendMessage has registered the chat-event listener.
        await waitFor(() => expect(mockListenChatEvents).toHaveBeenCalled());
        const calls = mockListenChatEvents.mock.calls as unknown as Array<[string, (e: unknown) => void]>;
        drive(calls[calls.length - 1][1]);
        recovered = await p;
      });
      return recovered;
    }

    it("resolves with the model's raw reply on turn_complete", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );
      // Seed an existing spec so we can prove recovery never mutates it.
      useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Existing spec");

      const recovered = await runRecovery((onEvent) => {
        onEvent({ type: "text_delta", session_id: "cli-session-123", text: "<!-- SESSION-PLAN-JSON -->\n" });
        onEvent({ type: "text_delta", session_id: "cli-session-123", text: '{"sessions":[]}' });
        onEvent({ type: "turn_complete", session_id: "cli-session-123" });
      });

      expect(recovered).toContain("SESSION-PLAN-JSON");
      expect(recovered).toContain('{"sessions":[]}');

      // The recovery prompt + reply NEVER appear in the conversation, and the
      // spec is untouched — it's an out-of-band repair, not a chat turn.
      const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
      expect(conv!.messages.length).toBe(0);
      expect(useSpecWriterStore.getState().currentSpecContent.get(PROJECT)).toBe("# Existing spec");
      // Spinner cleared.
      expect(useSpecWriterStore.getState().planningStreaming.get(PROJECT)).toBe(false);
      // The recovery prompt was actually sent to the CLI.
      expect(mockSendMessage).toHaveBeenCalledWith(
        "cli-session-123",
        "Repair this spec into a guide",
      );
    });

    it("resolves with empty string when the process errors mid-recovery (degrades, never hangs)", async () => {
      useSpecWriterStore.getState().initConversation(
        PROJECT, "claude-code", "claude-sonnet-4-6", "feature",
      );

      const recovered = await runRecovery((onEvent) => {
        onEvent({ type: "process_error", session_id: "cli-session-123", error: "boom" });
      });

      expect(recovered).toBe("");
    });
  });
});
