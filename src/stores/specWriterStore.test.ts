import { describe, it, expect, beforeEach } from "vitest";
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
});
