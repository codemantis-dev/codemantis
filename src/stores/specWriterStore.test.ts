import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/tauri-commands", () => ({
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
}));

import { useSpecWriterStore } from "./specWriterStore";

const PROJECT = "/tmp/test-project";

describe("specWriterStore", () => {
  beforeEach(() => {
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
});
