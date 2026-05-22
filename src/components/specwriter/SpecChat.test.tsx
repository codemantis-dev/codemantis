import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSettingsStore } from "../../stores/settingsStore";

vi.mock("../../lib/tauri-commands", () => ({
  sendAssistantChat: vi.fn(),
  listenAssistantStream: vi.fn().mockResolvedValue(() => {}),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue(""),
}));

import SpecChat from "./SpecChat";

const PROJECT = "/tmp/test";

const mockSendMessage = vi.fn();
const mockWriteSpec = vi.fn();
const mockCancelStream = vi.fn();

function renderChat(overrides?: Partial<React.ComponentProps<typeof SpecChat>>) {
  return render(
    <SpecChat
      projectPath={PROJECT}
      sendMessage={mockSendMessage}
      writeSpec={mockWriteSpec}
      cancelStream={mockCancelStream}
      {...overrides}
    />
  );
}

beforeEach(() => {
  useSpecWriterStore.setState({
    conversations: new Map(),
    uiState: new Map(),
    planningStreaming: new Map(),
    currentSpecContent: new Map(),
    currentAuditContent: new Map(),
    savedSpecs: new Map(),
    draftText: new Map(),
    draftAttachments: new Map(),
  });
  // Default: no API keys set
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, apiKeys: {} },
  });
  vi.clearAllMocks();
});

describe("SpecChat", () => {
  it("renders empty state", () => {
    renderChat();
    expect(screen.getByText(/describe what you want to build/i)).toBeTruthy();
  });

  it("renders messages", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3.1-flash-lite-preview", "new_application");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "user",
      content: "Build a dashboard",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    renderChat();
    expect(screen.getByText("Build a dashboard")).toBeTruthy();
  });

  it("shows API key warning banner when API model has no key", () => {
    // Explicitly init with an API provider that has no key
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3.1-flash-lite-preview", "feature");
    // apiKeys is {} — no keys set
    renderChat();
    expect(screen.getByText(/no api key set/i)).toBeTruthy();
  });

  it("hides API key warning when model has a key", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, apiKeys: { gemini: "gm-key-123" } },
    });
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3.1-flash-lite-preview", "feature");
    renderChat();
    expect(screen.queryByText(/no api key set/i)).toBeNull();
  });

  it("calls onOptionAction before sendMessage when option is selected", () => {
    const onOptionAction = vi.fn().mockReturnValue(true);
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3.1-flash-lite-preview", "feature");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: "Pick one",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
      parsedOptions: ["Option A", "Option B"],
    });
    renderChat({ onOptionAction });
    fireEvent.click(screen.getByText("Option A"));
    expect(onOptionAction).toHaveBeenCalledWith("Option A");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("falls through to sendMessage when onOptionAction returns false", () => {
    const onOptionAction = vi.fn().mockReturnValue(false);
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3.1-flash-lite-preview", "feature");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: "Pick one",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
      parsedOptions: ["Regular option"],
    });
    renderChat({ onOptionAction });
    fireEvent.click(screen.getByText("Regular option"));
    expect(onOptionAction).toHaveBeenCalledWith("Regular option");
    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT, "Regular option");
  });

  // ── Provider & model selector tests ──────────────────────────────

  it("defaults to Claude Code when no API keys are configured", () => {
    // No conversation initialized, no API keys → init creates claude-code
    renderChat();
    // The conversation should be initialized with claude-code
    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT);
    expect(conv?.ai_provider).toBe("claude-code");
    expect(conv?.ai_model).toBe("claude-sonnet-4-6");
  });

  it("defaults to Claude Code even when API key is available", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, apiKeys: { gemini: "gm-key" } },
    });
    renderChat();
    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT);
    // Should still default to Claude Code — user must manually switch
    expect(conv?.ai_provider).toBe("claude-code");
    expect(conv?.ai_model).toBe("claude-sonnet-4-6");
  });

  it("does not show API key warning for Claude Code provider", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    renderChat();
    expect(screen.queryByText(/no api key set/i)).toBeNull();
  });

  it("shows weak model warning for lightweight models", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, apiKeys: { gemini: "gm-key" } },
    });
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash-lite", "feature");
    renderChat();
    expect(screen.getByText(/may struggle with complex specifications/i)).toBeTruthy();
  });

  it("does not show weak model warning for strong models", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, apiKeys: { gemini: "gm-key" } },
    });
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3-flash-preview", "feature");
    renderChat();
    expect(screen.queryByText(/may struggle with complex specifications/i)).toBeNull();
  });

  it("shows provider selector before first message", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    renderChat();
    // Should have provider dropdown with "Claude Code" option
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(2); // provider + model
  });

  it("offers Codex (local) as a provider option (v1.4.1 Phase B.1)", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    renderChat();
    // The provider <select> must include a Codex option so users can
    // pick the local Codex CLI for SpecWriter sessions. Backend
    // (createSpecwriterSession with agent_id: "codex") is already
    // wired; this is the UI gate.
    expect(screen.getByText(/codex \(local\)/i)).toBeTruthy();
  });

  it("shows Claude Code models when claude-code is selected", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    renderChat();
    // Should show Claude Code model options
    expect(screen.getByText("Haiku 4.5")).toBeTruthy();
    expect(screen.getByText("Sonnet 4.6")).toBeTruthy();
    expect(screen.getByText("Opus 4.7")).toBeTruthy();
  });

  it("shows API models when API provider is selected", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, apiKeys: { gemini: "gm-key" } },
    });
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3.1-flash-lite-preview", "feature");
    renderChat();
    expect(screen.getByText("Gemini 3.1 Flash Lite")).toBeTruthy();
  });

  it("hides selectors after first user message", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "user",
      content: "Build a dashboard",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    renderChat();
    // After first message, should show model badge, not selectors
    const selects = screen.queryAllByRole("combobox");
    // Mode selector is in the bottom bar, but provider/model selects should be gone
    expect(selects.length).toBeLessThanOrEqual(1); // at most mode selector in footer
  });

  it("shows model label badge after conversation starts with Claude Code", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "user",
      content: "Hello",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    renderChat();
    expect(screen.getByText(/Sonnet 4\.6/)).toBeTruthy();
  });

  // ── Prop-based streaming function tests ──────────────────────

  it("calls writeSpec prop when Generate Spec button is clicked", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    useSpecWriterStore.setState({
      conversations: new Map([[PROJECT, {
        ...useSpecWriterStore.getState().conversations.get(PROJECT)!,
        status: "ready_to_write" as const,
      }]]),
    });
    renderChat();
    const genBtn = screen.getByText("Generate Spec");
    fireEvent.click(genBtn);
    expect(mockWriteSpec).toHaveBeenCalledWith(PROJECT);
  });

  it("shows streaming indicator when isStreaming is true", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT, true]]),
    });
    renderChat();
    expect(screen.getByText("AI is responding...")).toBeTruthy();
  });

  it("shows Thinking indicator during streaming", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT, true]]),
    });
    renderChat();
    expect(screen.getByText("Thinking...")).toBeTruthy();
  });

  it("uses cancelStream prop via child SpecChatInput", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT, true]]),
    });
    renderChat();
    // Click the Stop button (rendered by SpecChatInput, which receives cancelStream prop)
    fireEvent.click(screen.getByTitle("Stop generation (Esc)"));
    expect(mockCancelStream).toHaveBeenCalledWith(PROJECT);
  });

  it("uses sendMessage prop via child SpecChatInput for sending", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
    useSpecWriterStore.getState().setDraftText(PROJECT, "Hello from chat");
    renderChat();
    fireEvent.click(screen.getByTitle("Send (Enter)"));
    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT, "Hello from chat", undefined);
  });

  it("passes sendMessage prop to option handler fallthrough", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-3.1-flash-lite-preview", "feature");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: "Pick one",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
      parsedOptions: ["Custom option"],
    });
    // No onOptionAction → should use sendMessage prop
    renderChat();
    fireEvent.click(screen.getByText("Custom option"));
    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT, "Custom option");
  });
});
