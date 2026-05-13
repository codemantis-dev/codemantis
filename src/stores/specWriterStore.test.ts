import { describe, it, expect, beforeEach, vi } from "vitest";

const mockSaveTaskBoardState = vi.fn().mockResolvedValue(undefined);
const mockLoadTaskBoardState = vi.fn().mockResolvedValue(null);

vi.mock("../lib/tauri-commands", () => ({
  saveTaskBoardState: (...args: unknown[]) => mockSaveTaskBoardState(...args),
  loadTaskBoardState: (...args: unknown[]) => mockLoadTaskBoardState(...args),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
}));

import { useSpecWriterStore } from "./specWriterStore";

const PROJECT = "/tmp/test-project";

describe("specWriterStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSpecWriterStore.setState({
      conversations: new Map(),
      uiState: new Map(),
      planningStreaming: new Map(),
      currentSpecContent: new Map(),
      currentAuditContent: new Map(),
      savedSpecs: new Map(),
      fileRequestsPending: new Map(),
      projectContext: new Map(),
      cliSessionIds: new Map(),
      draftText: new Map(),
      draftAttachments: new Map(),
      coverageReports: new Map(),
      lastPatchOutcomes: new Map(),
      creationLogs: new Map(),
      inputAnalysisReports: new Map(),
      streamStats: new Map(),
      compactionInfo: new Map(),
      specPreviewTab: new Map(),
      auditPending: new Map(),
    });
  });

  it("initializes a conversation", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv).toBeDefined();
    expect(conv!.mode).toBe("new_application");
    expect(conv!.status).toBe("gathering");
    expect(conv!.ai_provider).toBe("gemini");
  });

  it("adds a message", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "user",
      content: "Hello",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0].content).toBe("Hello");
  });

  it("updates last assistant message", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: "Hi",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    useSpecWriterStore.getState().updateLastAssistantMessage(PROJECT, "Hello there!");
    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv!.messages[0].content).toBe("Hello there!");
  });

  it("toggles slide-over", () => {
    expect(useSpecWriterStore.getState().getUIState(PROJECT).is_open).toBe(false);
    useSpecWriterStore.getState().toggleSlideOver(PROJECT);
    expect(useSpecWriterStore.getState().getUIState(PROJECT).is_open).toBe(true);
  });

  it("sets current spec content", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Test Spec");
    expect(useSpecWriterStore.getState().currentSpecContent.get(PROJECT)).toBe("# Test Spec");
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, null);
    expect(useSpecWriterStore.getState().currentSpecContent.has(PROJECT)).toBe(false);
  });

  it("clears conversation", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Test");
    useSpecWriterStore.getState().clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().conversations.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().currentSpecContent.has(PROJECT)).toBe(false);
  });

  // ── Audit content tests ──────────────────────────────────────

  it("sets current audit content", () => {
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# Test — Verification Audit");
    expect(useSpecWriterStore.getState().currentAuditContent.get(PROJECT)).toBe("# Test — Verification Audit");
  });

  it("clears audit content when set to null", () => {
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# Audit");
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, null);
    expect(useSpecWriterStore.getState().currentAuditContent.has(PROJECT)).toBe(false);
  });

  it("clears audit content when conversation is cleared", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# Audit");
    useSpecWriterStore.getState().clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().currentAuditContent.has(PROJECT)).toBe(false);
  });

  it("clears audit content on discardAndStartNew", async () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# Audit content");
    await useSpecWriterStore.getState().discardAndStartNew(PROJECT);
    expect(useSpecWriterStore.getState().currentAuditContent.has(PROJECT)).toBe(false);
  });

  it("isolates audit content between projects", () => {
    const PROJECT_2 = "/tmp/other-project";
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# Audit 1");
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT_2, "# Audit 2");
    expect(useSpecWriterStore.getState().currentAuditContent.get(PROJECT)).toBe("# Audit 1");
    expect(useSpecWriterStore.getState().currentAuditContent.get(PROJECT_2)).toBe("# Audit 2");
  });

  // ── CLI session ID tests ──────────────────────────────────────

  it("sets a CLI session ID for a project", () => {
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-abc");
    expect(useSpecWriterStore.getState().cliSessionIds.get(PROJECT)).toBe("cli-session-abc");
  });

  it("overwrites an existing CLI session ID", () => {
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-abc");
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-xyz");
    expect(useSpecWriterStore.getState().cliSessionIds.get(PROJECT)).toBe("cli-session-xyz");
  });

  it("clears CLI session ID when set to null", () => {
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-abc");
    useSpecWriterStore.getState().setCliSessionId(PROJECT, null);
    expect(useSpecWriterStore.getState().cliSessionIds.has(PROJECT)).toBe(false);
  });

  it("getCliSessionId returns undefined for project with no CLI session", () => {
    expect(useSpecWriterStore.getState().getCliSessionId(PROJECT)).toBeUndefined();
  });

  it("getCliSessionId returns session ID for project with CLI session", () => {
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-abc");
    expect(useSpecWriterStore.getState().getCliSessionId(PROJECT)).toBe("cli-session-abc");
  });

  it("clears CLI session ID when conversation is cleared", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-abc");
    useSpecWriterStore.getState().clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().cliSessionIds.has(PROJECT)).toBe(false);
  });

  it("clearConversation works even when no CLI session exists", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    // No CLI session set — should not crash
    useSpecWriterStore.getState().clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().conversations.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().cliSessionIds.has(PROJECT)).toBe(false);
  });

  it("clears CLI session ID on discardAndStartNew", async () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-abc");
    await useSpecWriterStore.getState().discardAndStartNew(PROJECT);
    expect(useSpecWriterStore.getState().cliSessionIds.has(PROJECT)).toBe(false);
  });

  // ── displayContent tests ──────────────────────────────────────

  it("sets displayContent on last assistant message", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: "Full content with options\n?> Option A\n?> Option B",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    useSpecWriterStore.getState().setMessageDisplayContent(PROJECT, "Full content with options");
    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv!.messages[0].displayContent).toBe("Full content with options");
  });

  it("preserves original content when setting displayContent", () => {
    const originalContent = "Questions:\n?> Option A\n?> Option B";
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: originalContent,
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    useSpecWriterStore.getState().setMessageDisplayContent(PROJECT, "Questions:");
    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv!.messages[0].content).toBe(originalContent);
    expect(conv!.messages[0].displayContent).toBe("Questions:");
  });

  it("setMessageDisplayContent only targets assistant messages", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "user",
      content: "User message",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    useSpecWriterStore.getState().setMessageDisplayContent(PROJECT, "Should not apply");
    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv!.messages[0].displayContent).toBeUndefined();
    expect(conv!.messages[0].content).toBe("User message");
  });

  it("setMessageDisplayContent is no-op when no messages exist", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    // Should not throw
    useSpecWriterStore.getState().setMessageDisplayContent(PROJECT, "No target");
    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv!.messages).toHaveLength(0);
  });

  it("setMessageDisplayContent is no-op for unknown project", () => {
    // Should not throw
    useSpecWriterStore.getState().setMessageDisplayContent("/tmp/nonexistent", "No target");
    expect(useSpecWriterStore.getState().conversations.has("/tmp/nonexistent")).toBe(false);
  });

  it("isolates CLI session IDs between projects", () => {
    const PROJECT_2 = "/tmp/other-project";
    useSpecWriterStore.getState().setCliSessionId(PROJECT, "cli-session-1");
    useSpecWriterStore.getState().setCliSessionId(PROJECT_2, "cli-session-2");
    expect(useSpecWriterStore.getState().getCliSessionId(PROJECT)).toBe("cli-session-1");
    expect(useSpecWriterStore.getState().getCliSessionId(PROJECT_2)).toBe("cli-session-2");
    // Clearing one does not affect the other
    useSpecWriterStore.getState().setCliSessionId(PROJECT, null);
    expect(useSpecWriterStore.getState().cliSessionIds.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().getCliSessionId(PROJECT_2)).toBe("cli-session-2");
  });

  // ── Draft text & attachments tests ────────────────────────────

  it("sets and retrieves draft text", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT, "Hello world");
    expect(useSpecWriterStore.getState().draftText.get(PROJECT)).toBe("Hello world");
  });

  it("deletes draft text when set to empty string", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT, "Something");
    useSpecWriterStore.getState().setDraftText(PROJECT, "");
    expect(useSpecWriterStore.getState().draftText.has(PROJECT)).toBe(false);
  });

  it("sets and retrieves draft attachments", () => {
    const att = [{ id: "a1", type: "image" as const, name: "test.png", size: 100, mime_type: "image/png", file_path: "" }];
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, att);
    expect(useSpecWriterStore.getState().draftAttachments.get(PROJECT)).toEqual(att);
  });

  it("deletes draft attachments when set to empty array", () => {
    const att = [{ id: "a1", type: "image" as const, name: "test.png", size: 100, mime_type: "image/png", file_path: "" }];
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, att);
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, []);
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT)).toBe(false);
  });

  it("clearDraft removes both text and attachments", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT, "Draft");
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, [{ id: "a1", type: "image" as const, name: "test.png", size: 100, mime_type: "image/png", file_path: "" }]);
    useSpecWriterStore.getState().clearDraft(PROJECT);
    expect(useSpecWriterStore.getState().draftText.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT)).toBe(false);
  });

  it("clearConversation also clears draft", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().setDraftText(PROJECT, "Draft text");
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, [{ id: "a1", type: "image" as const, name: "test.png", size: 100, mime_type: "image/png", file_path: "" }]);
    useSpecWriterStore.getState().clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().draftText.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT)).toBe(false);
  });

  it("discardAndStartNew also clears draft", async () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    useSpecWriterStore.getState().setDraftText(PROJECT, "Draft text");
    await useSpecWriterStore.getState().discardAndStartNew(PROJECT);
    expect(useSpecWriterStore.getState().draftText.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT)).toBe(false);
  });

  it("isolates draft between projects", () => {
    const PROJECT_2 = "/tmp/other-project";
    useSpecWriterStore.getState().setDraftText(PROJECT, "Draft A");
    useSpecWriterStore.getState().setDraftText(PROJECT_2, "Draft B");
    expect(useSpecWriterStore.getState().draftText.get(PROJECT)).toBe("Draft A");
    expect(useSpecWriterStore.getState().draftText.get(PROJECT_2)).toBe("Draft B");
    useSpecWriterStore.getState().clearDraft(PROJECT);
    expect(useSpecWriterStore.getState().draftText.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().draftText.get(PROJECT_2)).toBe("Draft B");
  });

  it("overwrites existing draft text", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT, "First");
    useSpecWriterStore.getState().setDraftText(PROJECT, "Second");
    expect(useSpecWriterStore.getState().draftText.get(PROJECT)).toBe("Second");
  });

  it("overwrites existing draft attachments", () => {
    const att1 = [{ id: "a1", type: "image" as const, name: "one.png", size: 100, mime_type: "image/png", file_path: "" }];
    const att2 = [{ id: "a2", type: "document" as const, name: "two.md", size: 200, mime_type: "text/markdown", file_path: "" }];
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, att1);
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, att2);
    expect(useSpecWriterStore.getState().draftAttachments.get(PROJECT)).toEqual(att2);
  });

  it("clearDraft is safe on non-existent project", () => {
    // Should not throw and should not create entries
    useSpecWriterStore.getState().clearDraft("/tmp/nonexistent");
    expect(useSpecWriterStore.getState().draftText.has("/tmp/nonexistent")).toBe(false);
    expect(useSpecWriterStore.getState().draftAttachments.has("/tmp/nonexistent")).toBe(false);
  });

  it("isolates draft attachments between projects", () => {
    const PROJECT_2 = "/tmp/other-project";
    const att1 = [{ id: "a1", type: "image" as const, name: "one.png", size: 100, mime_type: "image/png", file_path: "" }];
    const att2 = [{ id: "a2", type: "image" as const, name: "two.png", size: 200, mime_type: "image/png", file_path: "" }];
    useSpecWriterStore.getState().setDraftAttachments(PROJECT, att1);
    useSpecWriterStore.getState().setDraftAttachments(PROJECT_2, att2);
    expect(useSpecWriterStore.getState().draftAttachments.get(PROJECT)).toEqual(att1);
    expect(useSpecWriterStore.getState().draftAttachments.get(PROJECT_2)).toEqual(att2);
    useSpecWriterStore.getState().clearDraft(PROJECT);
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().draftAttachments.get(PROJECT_2)).toEqual(att2);
  });

  // ── Draft persistence tests ──────────────────────────────────

  it("persistState includes draftText in serialized data", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    useSpecWriterStore.getState().setDraftText(PROJECT, "My persisted draft");
    useSpecWriterStore.getState().persistState(PROJECT);
    expect(mockSaveTaskBoardState).toHaveBeenCalledWith(
      PROJECT,
      expect.stringContaining('"draftText":"My persisted draft"')
    );
  });

  it("persistState includes null draftText when no draft", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    useSpecWriterStore.getState().persistState(PROJECT);
    expect(mockSaveTaskBoardState).toHaveBeenCalledWith(
      PROJECT,
      expect.stringContaining('"draftText":null')
    );
  });

  it("persistState does nothing when no conversation exists", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT, "Orphaned draft");
    useSpecWriterStore.getState().persistState(PROJECT);
    expect(mockSaveTaskBoardState).not.toHaveBeenCalled();
  });

  it("loadState restores draftText from persisted data", async () => {
    const persisted = {
      conversation: {
        id: "spec-1",
        project_path: PROJECT,
        messages: [],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "gathering",
        mode: "feature",
        context_loaded: false,
      },
      specContent: null,
      auditContent: null,
      draftText: "Restored draft text",
    };
    mockLoadTaskBoardState.mockResolvedValueOnce(JSON.stringify(persisted));
    const result = await useSpecWriterStore.getState().loadState(PROJECT);
    expect(result).toBe(true);
    expect(useSpecWriterStore.getState().draftText.get(PROJECT)).toBe("Restored draft text");
  });

  it("loadState handles missing draftText gracefully", async () => {
    const persisted = {
      conversation: {
        id: "spec-1",
        project_path: PROJECT,
        messages: [],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "gathering",
        mode: "feature",
        context_loaded: false,
      },
      specContent: null,
      auditContent: null,
      // no draftText field
    };
    mockLoadTaskBoardState.mockResolvedValueOnce(JSON.stringify(persisted));
    const result = await useSpecWriterStore.getState().loadState(PROJECT);
    expect(result).toBe(true);
    expect(useSpecWriterStore.getState().draftText.has(PROJECT)).toBe(false);
  });

  it("loadState handles null draftText gracefully", async () => {
    const persisted = {
      conversation: {
        id: "spec-1",
        project_path: PROJECT,
        messages: [],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "gathering",
        mode: "feature",
        context_loaded: false,
      },
      specContent: null,
      auditContent: null,
      draftText: null,
    };
    mockLoadTaskBoardState.mockResolvedValueOnce(JSON.stringify(persisted));
    const result = await useSpecWriterStore.getState().loadState(PROJECT);
    expect(result).toBe(true);
    expect(useSpecWriterStore.getState().draftText.has(PROJECT)).toBe(false);
  });

  it("loadState does not restore draftAttachments (not persisted)", async () => {
    const persisted = {
      conversation: {
        id: "spec-1",
        project_path: PROJECT,
        messages: [],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "gathering",
        mode: "feature",
        context_loaded: false,
      },
      specContent: null,
      auditContent: null,
      draftText: "Some text",
    };
    mockLoadTaskBoardState.mockResolvedValueOnce(JSON.stringify(persisted));
    await useSpecWriterStore.getState().loadState(PROJECT);
    // Attachments are NOT persisted to DB — only in-memory
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT)).toBe(false);
  });

  // ── promoteMessageToSpec ─────────────────────────────────────────

  it("promoteMessageToSpec sets content, message type, and status", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    store.addMessage(PROJECT, {
      id: "msg-user",
      role: "user",
      content: "Build a dashboard",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    store.addMessage(PROJECT, {
      id: "msg-spec",
      role: "assistant",
      content: "# Dashboard — Implementation Plan\n\n## 1. Overview\nA dashboard...",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });

    store.promoteMessageToSpec(PROJECT, "msg-spec");

    const state = useSpecWriterStore.getState();
    // Spec content is set
    expect(state.currentSpecContent.get(PROJECT)).toBe(
      "# Dashboard — Implementation Plan\n\n## 1. Overview\nA dashboard..."
    );
    // Message type updated
    const conv = state.conversations.get(PROJECT)!;
    const promoted = conv.messages.find((m) => m.id === "msg-spec");
    expect(promoted!.message_type).toBe("spec_document");
    // Conversation status is 'done'
    expect(conv.status).toBe("done");
  });

  it("promoteMessageToSpec adds audit offer when no audit exists", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    store.addMessage(PROJECT, {
      id: "msg-spec",
      role: "assistant",
      content: "# Spec content here",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });

    store.promoteMessageToSpec(PROJECT, "msg-spec");

    const conv = useSpecWriterStore.getState().conversations.get(PROJECT)!;
    const auditOffer = conv.messages.find((m) => m.content.includes("Generate a Verification Audit?"));
    expect(auditOffer).toBeDefined();
    expect(auditOffer!.parsedOptions).toHaveLength(2);
  });

  it("promoteMessageToSpec skips audit offer when audit already exists", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    store.addMessage(PROJECT, {
      id: "msg-spec",
      role: "assistant",
      content: "# Spec content here",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    store.setCurrentAuditContent(PROJECT, "# Audit content");

    store.promoteMessageToSpec(PROJECT, "msg-spec");

    const conv = useSpecWriterStore.getState().conversations.get(PROJECT)!;
    const auditOffer = conv.messages.find((m) => m.content.includes("Generate a Verification Audit?"));
    expect(auditOffer).toBeUndefined();
  });

  it("promoteMessageToSpec ignores non-existent message ID", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");

    store.promoteMessageToSpec(PROJECT, "nonexistent");

    expect(useSpecWriterStore.getState().currentSpecContent.has(PROJECT)).toBe(false);
  });

  it("promoteMessageToSpec ignores non-assistant messages", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    store.addMessage(PROJECT, {
      id: "msg-user",
      role: "user",
      content: "Build something",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });

    store.promoteMessageToSpec(PROJECT, "msg-user");

    expect(useSpecWriterStore.getState().currentSpecContent.has(PROJECT)).toBe(false);
  });

  // ─── Stage 3: coverage report + input analysis storage ─────────────

  it("setCoverageReport stores and overwrites per project", () => {
    const store = useSpecWriterStore.getState();
    const report = {
      status: "fail" as const,
      inputDocs: [],
      output: { sections: 1, bytes: 10 },
      ratios: { byteRatio: 0.5, sectionRatio: 0.5 },
      failures: [],
      recheckPrompts: [],
    };
    store.setCoverageReport(PROJECT, report);
    expect(useSpecWriterStore.getState().coverageReports.get(PROJECT)).toBe(report);

    const next = { ...report, status: "pass" as const };
    store.setCoverageReport(PROJECT, next);
    expect(useSpecWriterStore.getState().coverageReports.get(PROJECT)).toBe(next);
  });

  it("setCoverageReport(null) deletes the entry", () => {
    const store = useSpecWriterStore.getState();
    store.setCoverageReport(PROJECT, {
      status: "pass",
      inputDocs: [],
      output: { sections: 0, bytes: 0 },
      ratios: { byteRatio: 1, sectionRatio: 1 },
      failures: [],
      recheckPrompts: [],
    });
    store.setCoverageReport(PROJECT, null);
    expect(useSpecWriterStore.getState().coverageReports.has(PROJECT)).toBe(false);
  });

  it("setInputAnalysisReport stores and clears", () => {
    const store = useSpecWriterStore.getState();
    const analysis = { docs: [], findings: [], clarifications: [], report: "..." };
    store.setInputAnalysisReport(PROJECT, analysis);
    expect(useSpecWriterStore.getState().inputAnalysisReports.get(PROJECT)).toBe(analysis);
    store.setInputAnalysisReport(PROJECT, null);
    expect(useSpecWriterStore.getState().inputAnalysisReports.has(PROJECT)).toBe(false);
  });

  it("clearConversation also clears the coverage and analysis reports", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    store.setCoverageReport(PROJECT, {
      status: "pass",
      inputDocs: [],
      output: { sections: 0, bytes: 0 },
      ratios: { byteRatio: 1, sectionRatio: 1 },
      failures: [],
      recheckPrompts: [],
    });
    store.setInputAnalysisReport(PROJECT, { docs: [], findings: [], clarifications: [], report: "" });
    store.setLastPatchOutcome(PROJECT, {
      timestamp: new Date().toISOString(),
      status: "applied",
      appliedOps: ["replace-section"],
      warnings: [],
      errors: [],
      remainingFindings: 0,
    });
    store.clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().coverageReports.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().inputAnalysisReports.has(PROJECT)).toBe(false);
    expect(useSpecWriterStore.getState().lastPatchOutcomes.has(PROJECT)).toBe(false);
  });

  it("setLastPatchOutcome stores, overwrites, and clears per project", () => {
    const store = useSpecWriterStore.getState();
    const outcome = {
      timestamp: new Date().toISOString(),
      status: "applied" as const,
      appliedOps: ["replace-section" as const, "append-section" as const],
      warnings: [],
      errors: [],
      remainingFindings: 3,
    };
    store.setLastPatchOutcome(PROJECT, outcome);
    expect(useSpecWriterStore.getState().lastPatchOutcomes.get(PROJECT)).toBe(outcome);

    const next = { ...outcome, status: "failed" as const, appliedOps: [], errors: ["nope"] };
    store.setLastPatchOutcome(PROJECT, next);
    expect(useSpecWriterStore.getState().lastPatchOutcomes.get(PROJECT)).toBe(next);

    store.setLastPatchOutcome(PROJECT, null);
    expect(useSpecWriterStore.getState().lastPatchOutcomes.has(PROJECT)).toBe(false);
  });

  // ─── Stage 4: stream stats storage ─────────────────────────────────

  it("setStreamStats stores and overwrites per project", () => {
    const store = useSpecWriterStore.getState();
    const stats = {
      chunks: 100,
      bytes: 1024,
      durationMs: 5000,
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(5000).toISOString(),
      status: "ok" as const,
    };
    store.setStreamStats(PROJECT, stats);
    expect(useSpecWriterStore.getState().streamStats.get(PROJECT)).toBe(stats);

    const next = { ...stats, status: "stalled" as const, note: "no chunks for 30s" };
    store.setStreamStats(PROJECT, next);
    expect(useSpecWriterStore.getState().streamStats.get(PROJECT)).toBe(next);
  });

  it("setStreamStats(null) deletes the entry", () => {
    const store = useSpecWriterStore.getState();
    store.setStreamStats(PROJECT, {
      chunks: 0,
      bytes: 0,
      durationMs: 0,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: "errored",
    });
    store.setStreamStats(PROJECT, null);
    expect(useSpecWriterStore.getState().streamStats.has(PROJECT)).toBe(false);
  });

  it("clearConversation also clears stream stats", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    store.setStreamStats(PROJECT, {
      chunks: 5,
      bytes: 100,
      durationMs: 1000,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: "ok",
    });
    store.clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().streamStats.has(PROJECT)).toBe(false);
  });

  // ─── Compaction tracking ────────────────────────────────────────────

  it("setCompactionInfo stores and overwrites per project", () => {
    const store = useSpecWriterStore.getState();
    const info = { trigger: "auto", preTokens: 180_000, at: new Date(0).toISOString() };
    store.setCompactionInfo(PROJECT, info);
    expect(useSpecWriterStore.getState().compactionInfo.get(PROJECT)).toBe(info);

    const next = { trigger: "manual", preTokens: 150_000, at: new Date(1000).toISOString() };
    store.setCompactionInfo(PROJECT, next);
    expect(useSpecWriterStore.getState().compactionInfo.get(PROJECT)).toBe(next);
  });

  it("setCompactionInfo(null) deletes the entry", () => {
    const store = useSpecWriterStore.getState();
    store.setCompactionInfo(PROJECT, { trigger: "auto", preTokens: 100_000, at: new Date().toISOString() });
    store.setCompactionInfo(PROJECT, null);
    expect(useSpecWriterStore.getState().compactionInfo.has(PROJECT)).toBe(false);
  });

  it("clearConversation also clears compaction info", () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    store.setCompactionInfo(PROJECT, { trigger: "auto", preTokens: 190_000, at: new Date().toISOString() });
    store.clearConversation(PROJECT);
    expect(useSpecWriterStore.getState().compactionInfo.has(PROJECT)).toBe(false);
  });

  it("discardAndStartNew also clears compaction info", async () => {
    const store = useSpecWriterStore.getState();
    store.initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    store.setCompactionInfo(PROJECT, { trigger: "auto", preTokens: 190_000, at: new Date().toISOString() });
    await store.discardAndStartNew(PROJECT);
    expect(useSpecWriterStore.getState().compactionInfo.has(PROJECT)).toBe(false);
  });

  describe("specPreviewTab", () => {
    it("stores the active tab per project", () => {
      const store = useSpecWriterStore.getState();
      store.setSpecPreviewTab(PROJECT, "audit");
      expect(useSpecWriterStore.getState().specPreviewTab.get(PROJECT)).toBe("audit");
    });

    it("keeps tab choices isolated between projects", () => {
      const store = useSpecWriterStore.getState();
      store.setSpecPreviewTab("/project-a", "audit");
      store.setSpecPreviewTab("/project-b", "spec");
      const state = useSpecWriterStore.getState();
      expect(state.specPreviewTab.get("/project-a")).toBe("audit");
      expect(state.specPreviewTab.get("/project-b")).toBe("spec");
    });
  });

  describe("auditPending", () => {
    it("becomes true when set true", () => {
      useSpecWriterStore.getState().setAuditPending(PROJECT, true);
      expect(useSpecWriterStore.getState().auditPending.get(PROJECT)).toBe(true);
    });

    it("clears the entry when set false", () => {
      const store = useSpecWriterStore.getState();
      store.setAuditPending(PROJECT, true);
      store.setAuditPending(PROJECT, false);
      expect(useSpecWriterStore.getState().auditPending.has(PROJECT)).toBe(false);
    });

    it("keeps pending flags isolated between projects", () => {
      const store = useSpecWriterStore.getState();
      store.setAuditPending("/project-a", true);
      const state = useSpecWriterStore.getState();
      expect(state.auditPending.get("/project-a")).toBe(true);
      expect(state.auditPending.get("/project-b")).toBeUndefined();
    });
  });

  // ─── Creation log (per-section streaming progress) ─────────────────

  describe("creationLogs", () => {
    it("appendCreationEntry adds an entry and seeds the log when none exists", () => {
      const store = useSpecWriterStore.getState();
      store.appendCreationEntry(PROJECT, {
        startedAt: "t0",
        closedAt: null,
        level: 2,
        title: "Overview",
        bytes: 0,
        postCompaction: false,
      });
      const log = useSpecWriterStore.getState().creationLogs.get(PROJECT);
      expect(log).toBeDefined();
      expect(log!.entries).toHaveLength(1);
      expect(log!.entries[0].title).toBe("Overview");
      expect(log!.compactedAt).toBeNull();
    });

    it("markCreationEntryClosed flips closedAt + bytes only on an open entry", () => {
      const store = useSpecWriterStore.getState();
      store.appendCreationEntry(PROJECT, {
        startedAt: "t0",
        closedAt: null,
        level: 1,
        title: "Title",
        bytes: 0,
        postCompaction: false,
      });
      store.markCreationEntryClosed(PROJECT, 0, "t1", 412);
      const e = useSpecWriterStore.getState().creationLogs.get(PROJECT)!.entries[0];
      expect(e.closedAt).toBe("t1");
      expect(e.bytes).toBe(412);

      // Calling again does NOT overwrite a closed entry.
      store.markCreationEntryClosed(PROJECT, 0, "t2", 999);
      const e2 = useSpecWriterStore.getState().creationLogs.get(PROJECT)!.entries[0];
      expect(e2.closedAt).toBe("t1");
      expect(e2.bytes).toBe(412);
    });

    it("markCreationEntryClosed is a no-op when the index is out of range", () => {
      const store = useSpecWriterStore.getState();
      store.markCreationEntryClosed(PROJECT, 0, "t1", 100);
      expect(useSpecWriterStore.getState().creationLogs.has(PROJECT)).toBe(false);
    });

    it("markPostCompactionFromNow stamps compactedAt without touching entries", () => {
      const store = useSpecWriterStore.getState();
      store.appendCreationEntry(PROJECT, {
        startedAt: "t0",
        closedAt: "t1",
        level: 2,
        title: "Before",
        bytes: 100,
        postCompaction: false,
      });
      store.markPostCompactionFromNow(PROJECT, "2026-05-12T11:55:00.000Z");
      const log = useSpecWriterStore.getState().creationLogs.get(PROJECT)!;
      expect(log.compactedAt).toBe("2026-05-12T11:55:00.000Z");
      expect(log.entries[0].postCompaction).toBe(false); // existing entries unchanged
    });

    it("caps the log to the last 100 entries on append", () => {
      const store = useSpecWriterStore.getState();
      // Add 101 entries — oldest should be dropped.
      for (let i = 0; i < 101; i++) {
        store.appendCreationEntry(PROJECT, {
          startedAt: `t${i}`,
          closedAt: `t${i + 1}`,
          level: 2,
          title: `Section ${i}`,
          bytes: 10,
          postCompaction: false,
        });
      }
      const log = useSpecWriterStore.getState().creationLogs.get(PROJECT)!;
      expect(log.entries).toHaveLength(100);
      expect(log.entries[0].title).toBe("Section 1"); // Section 0 dropped
      expect(log.entries[99].title).toBe("Section 100");
    });

    it("clearCreationLog wipes the entry for a project", () => {
      const store = useSpecWriterStore.getState();
      store.appendCreationEntry(PROJECT, {
        startedAt: "t0",
        closedAt: null,
        level: 1,
        title: "Title",
        bytes: 0,
        postCompaction: false,
      });
      store.clearCreationLog(PROJECT);
      expect(useSpecWriterStore.getState().creationLogs.has(PROJECT)).toBe(false);
    });

    it("clearConversation removes the creation log too", () => {
      const store = useSpecWriterStore.getState();
      store.initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
      store.appendCreationEntry(PROJECT, {
        startedAt: "t0",
        closedAt: null,
        level: 1,
        title: "Title",
        bytes: 0,
        postCompaction: false,
      });
      store.clearConversation(PROJECT);
      expect(useSpecWriterStore.getState().creationLogs.has(PROJECT)).toBe(false);
    });
  });
});
