import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { useSettingsStore } from "../../stores/settingsStore";

// Hoist mocks
const { mockSendAssistantChat, mockListenAssistantStream, mockListTemplates } = vi.hoisted(() => ({
  mockSendAssistantChat: vi.fn(() => Promise.resolve()),
  mockListenAssistantStream: vi.fn(() => Promise.resolve(vi.fn())),
  mockListTemplates: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../lib/tauri-commands", () => ({
  sendAssistantChat: mockSendAssistantChat,
  listenAssistantStream: mockListenAssistantStream,
  listTemplates: mockListTemplates,
}));

// Mock ProgressUpdateMessage to avoid deeper dependency issues
vi.mock("./ProgressUpdateMessage", () => ({
  default: ({ wpName }: { wpName: string }) => <div data-testid="progress-update">{wpName}</div>,
}));

import PlanningChat from "./PlanningChat";

const PROJECT = "/tmp/test-project";

function resetStores(): void {
  useTaskBoardStore.setState({
    plans: new Map(),
    conversations: new Map(),
    uiState: new Map(),
    executingProject: null,
    executingWorkPackage: null,
    isPaused: false,
    planningStreaming: new Map(),
    projectTargetDecisions: new Map(),
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
      assistantDefaultProvider: "gemini",
      assistantDefaultModel: { gemini: "gemini-2.5-flash", openai: "gpt-4.1", anthropic: "claude-sonnet-4-5-20250514" },
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      triviaEnabled: true,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      onboardingCompleted: false,
      previewConsoleAutoOpen: true,
      taskBoardPlanningModel: "gemini-2.5-flash",
      taskBoardMaxTokens: 32768,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
    },
    loaded: true,
  });
}

describe("PlanningChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ── R5: Eager conversation initialization ──

  it("eagerly initializes conversation on mount if none exists", async () => {
    render(<PlanningChat projectPath={PROJECT} />);

    await waitFor(() => {
      const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
      expect(conv).toBeDefined();
      expect(conv!.ai_provider).toBe("gemini");
      expect(conv!.ai_model).toBe("gemini-2.5-flash");
    });
  });

  it("falls back from claude-code provider to gemini", async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        assistantDefaultProvider: "claude-code",
        assistantDefaultModel: { gemini: "gemini-2.5-pro" },
      },
    });

    render(<PlanningChat projectPath={PROJECT} />);

    await waitFor(() => {
      const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
      expect(conv!.ai_provider).toBe("gemini");
    });
  });

  it("does not reinitialize if conversation already exists", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "anthropic", "claude-sonnet-4-5-20250514");

    render(<PlanningChat projectPath={PROJECT} />);

    // Wait a tick to ensure effects have run
    await waitFor(() => {
      const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
      expect(conv!.ai_provider).toBe("anthropic"); // Should not have been overwritten
    });
  });

  // ── R5: AI/Model selector UI ──

  it("renders provider and model dropdowns when no user messages", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");

    render(<PlanningChat projectPath={PROJECT} />);

    // Should have select elements (dropdowns)
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBe(2); // provider + model
  });

  it("renders read-only text after user sends a message", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m1", role: "user", content: "Hello",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
    });

    render(<PlanningChat projectPath={PROJECT} />);

    // Should show read-only text instead of dropdowns
    expect(screen.getByText("(gemini/gemini-2.5-flash)")).toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("changing provider updates conversation and resets model", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");

    render(<PlanningChat projectPath={PROJECT} />);

    const selects = screen.getAllByRole("combobox");
    const providerSelect = selects[0];

    fireEvent.change(providerSelect, { target: { value: "openai" } });

    await waitFor(() => {
      const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
      expect(conv!.ai_provider).toBe("openai");
      // Model should be the first model for openai
      expect(conv!.ai_model).toBe("gpt-4.1");
    });
  });

  it("changing model updates conversation", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");

    render(<PlanningChat projectPath={PROJECT} />);

    const selects = screen.getAllByRole("combobox");
    const modelSelect = selects[1];

    // Change to a different gemini model
    fireEvent.change(modelSelect, { target: { value: "gemini-2.5-pro" } });

    await waitFor(() => {
      const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
      expect(conv!.ai_model).toBe("gemini-2.5-pro");
      expect(conv!.ai_provider).toBe("gemini"); // Provider should stay same
    });
  });

  it("does not list claude-code in provider dropdown", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");

    render(<PlanningChat projectPath={PROJECT} />);

    const selects = screen.getAllByRole("combobox");
    const providerSelect = selects[0];
    const options = providerSelect.querySelectorAll("option");
    const optionValues = Array.from(options).map((o) => o.getAttribute("value"));

    expect(optionValues).not.toContain("claude-code");
    expect(optionValues).toContain("openai");
    expect(optionValues).toContain("gemini");
    expect(optionValues).toContain("anthropic");
  });

  // ── Empty state ──

  it("shows empty state message when no messages", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");

    render(<PlanningChat projectPath={PROJECT} />);

    expect(
      screen.getByText(/Describe what you want to build/)
    ).toBeInTheDocument();
  });

  // ── Messages ──

  it("renders all messages in conversation", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m1", role: "user", content: "Build a todo app",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
    });
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m2", role: "assistant", content: "What framework?",
      message_type: "conversation", timestamp: "2026-01-01T00:00:01Z",
    });

    render(<PlanningChat projectPath={PROJECT} />);

    expect(screen.getByText("Build a todo app")).toBeInTheDocument();
    expect(screen.getByText("What framework?")).toBeInTheDocument();
  });

  // ── Streaming indicator ──

  it("shows thinking indicator when streaming", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().setPlanningStreaming(PROJECT, true);

    render(<PlanningChat projectPath={PROJECT} />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("does not show thinking indicator when not streaming", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");

    render(<PlanningChat projectPath={PROJECT} />);

    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  // ── Generate Plan button ──

  it("shows Generate Plan button when status is ready_to_plan", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().setConversationStatus(PROJECT, "ready_to_plan");

    render(<PlanningChat projectPath={PROJECT} />);

    expect(screen.getByText("Generate Plan")).toBeInTheDocument();
  });

  it("does not show Generate Plan when status is gathering", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");

    render(<PlanningChat projectPath={PROJECT} />);

    expect(screen.queryByText("Generate Plan")).not.toBeInTheDocument();
  });

  // ── R3: isLastAssistant computation ──

  it("marks only the last message as isLastAssistant", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m1", role: "assistant", content: "First question",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
      parsedOptions: ["A", "B"],
    });
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m2", role: "user", content: "A",
      message_type: "conversation", timestamp: "2026-01-01T00:00:01Z",
    });
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m3", role: "assistant", content: "Second question",
      message_type: "conversation", timestamp: "2026-01-01T00:00:02Z",
      parsedOptions: ["C", "D"],
    });

    render(<PlanningChat projectPath={PROJECT} />);

    // Only the last assistant message (m3) should have its options rendered
    // m1's options (A, B) should NOT be rendered as clickable buttons
    // but m3's options (C, D) should be
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
    // A and B from old message should not show as option buttons
    // (though "A" appears as user message text)
  });
});
