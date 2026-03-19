import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskBoardStore } from "../stores/taskBoardStore";
import { useSettingsStore } from "../stores/settingsStore";

interface StreamEvent {
  type: string;
  text?: string;
  message?: string;
}

type StreamCb = (event: StreamEvent) => void;

// Hoist mock functions with proper signatures
const {
  mockSendAssistantChat,
  mockListenAssistantStream,
  mockListTemplates,
} = vi.hoisted(() => ({
  mockSendAssistantChat: vi.fn<(opts: {
    assistantId: string;
    provider: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    messages: { role: string; content: string | unknown[] }[];
  }) => Promise<void>>(() => Promise.resolve()),
  mockListenAssistantStream: vi.fn<(id: string, cb: StreamCb) => Promise<() => void>>(
    () => Promise.resolve(vi.fn())
  ),
  mockListTemplates: vi.fn(() => Promise.resolve([
    {
      id: "vite-react",
      name: "React + Vite",
      description: "Vite and React starter",
      category: "frontend",
      tags: ["react", "vite"],
      repo_url: "https://github.com/example/vite-react",
      branch: "main",
      stars: 700,
      license: "MIT",
      install_command: "pnpm install",
      dev_command: "pnpm dev",
      icon: "zap",
      verified: true,
      last_verified: "2026-03-10",
      scaffold_type: "git-clone",
    },
    {
      id: "nextjs-app",
      name: "Next.js Full-Stack",
      description: "Next.js with TypeScript",
      category: "full-stack",
      tags: ["next.js"],
      repo_url: "https://github.com/example/nextjs",
      branch: "main",
      stars: 5000,
      license: "MIT",
      install_command: "npm install",
      dev_command: "npm run dev",
      icon: "triangle",
      verified: true,
      last_verified: "2026-03-10",
      scaffold_type: "git-clone",
    },
  ])),
}));

vi.mock("../lib/tauri-commands", () => ({
  sendAssistantChat: mockSendAssistantChat,
  listenAssistantStream: mockListenAssistantStream,
  listTemplates: mockListTemplates,
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
}));

import { usePlanningConversation } from "./usePlanningConversation";

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
    pendingUserAction: new Map(),
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
      assistantDefaultModel: { gemini: "gemini-2.5-flash" },
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

describe("usePlanningConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ── Conversation initialization ──

  it("sendPlanningMessage creates conversation if none exists", async () => {
    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build a todo app");
    });

    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    expect(conv).toBeDefined();
    expect(conv!.ai_provider).toBe("gemini");
    expect(conv!.ai_model).toBe("gemini-2.5-flash");
  });

  it("uses settings default provider (falls back from claude-code)", async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        assistantDefaultProvider: "claude-code",
        assistantDefaultModel: { gemini: "gemini-2.5-pro" },
      },
    });

    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    expect(conv!.ai_provider).toBe("gemini");
  });

  // ── R2: Template catalog ──

  it("loads template catalog on first message and stores it", async () => {
    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build a web app");
    });

    expect(mockListTemplates).toHaveBeenCalledOnce();
    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    expect(conv!.templateCatalog).toContain("vite-react");
    expect(conv!.templateCatalog).toContain("nextjs-app");
    expect(conv!.templateCatalog).toContain("[frontend]");
    expect(conv!.templateCatalog).toContain("[full-stack]");
  });

  it("template catalog is formatted with ID, name, category, description", async () => {
    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    expect(conv!.templateCatalog).toMatch(/^- vite-react: "React \+ Vite" \[frontend\]/m);
    expect(conv!.templateCatalog).toMatch(/^- nextjs-app: "Next\.js Full-Stack" \[full-stack\]/m);
  });

  it("continues without catalog if listTemplates fails", async () => {
    mockListTemplates.mockRejectedValueOnce(new Error("network error"));
    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    expect(conv!.templateCatalog).toBe("");
  });

  it("system prompt includes template catalog", async () => {
    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build me something");
    });

    expect(mockSendAssistantChat).toHaveBeenCalledOnce();
    const callArgs = mockSendAssistantChat.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("AVAILABLE PROJECT TEMPLATES");
    expect(callArgs.systemPrompt).toContain("vite-react");
    expect(callArgs.systemPrompt).toContain("null: No template (ONLY for modifications");
  });

  it("system prompt requires templates for new projects", async () => {
    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build me something");
    });

    const callArgs = mockSendAssistantChat.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("MUST use one of the templates");
  });

  it("system prompt includes Docker awareness", async () => {
    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build me something");
    });

    const callArgs = mockSendAssistantChat.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("Docker Desktop");
  });

  it("does not reload templates on subsequent messages", async () => {
    // Init conversation with a catalog already
    useTaskBoardStore.getState().initConversation(
      PROJECT, "gemini", "gemini-2.5-flash", "- existing-template: test"
    );
    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build a blog");
    });

    // listTemplates should NOT be called since conversation already exists
    expect(mockListTemplates).not.toHaveBeenCalled();
  });

  // ── R3: Sequential questions / system prompt ──

  it("system prompt instructs ONE question at a time with ?> format", async () => {
    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const callArgs = mockSendAssistantChat.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("Ask ONE clarifying question at a time");
    expect(callArgs.systemPrompt).toContain("?> Option text here");
    expect(callArgs.systemPrompt).toContain("NEVER ask multiple questions in one response");
  });

  it("system prompt no longer instructs 3-5 questions", async () => {
    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const callArgs = mockSendAssistantChat.mock.calls[0][0];
    expect(callArgs.systemPrompt).not.toContain("Ask 3-5 focused clarifying questions");
  });

  // ── R3: Option parsing on stream done ──

  it("parses ?> options from stream and sets them on the message", async () => {
    let streamCallback: StreamCb | null = null;
    mockListenAssistantStream.mockImplementation((_id: string, cb: StreamCb) => {
      streamCallback = cb;
      return Promise.resolve(vi.fn());
    });

    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      const promise = result.current.sendPlanningMessage(PROJECT, "Build a todo app");
      await vi.waitFor(() => expect(streamCallback).not.toBeNull());
      streamCallback!({ type: "delta", text: "What framework?\n?> React\n?> Vue\n?> Svelte" });
      streamCallback!({ type: "done" });
      await promise;
    });

    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    const lastMsg = conv!.messages[conv!.messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.parsedOptions).toEqual(["React", "Vue", "Svelte"]);
    // Content should have ?> lines stripped
    expect(lastMsg.content).not.toContain("?>");
    expect(lastMsg.content).toContain("What framework?");
  });

  it("does not set parsedOptions when no ?> markers are present", async () => {
    let streamCallback: StreamCb | null = null;
    mockListenAssistantStream.mockImplementation((_id: string, cb: StreamCb) => {
      streamCallback = cb;
      return Promise.resolve(vi.fn());
    });

    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      const promise = result.current.sendPlanningMessage(PROJECT, "What should I build?");
      await vi.waitFor(() => expect(streamCallback).not.toBeNull());
      streamCallback!({ type: "delta", text: "Tell me about your project requirements." });
      streamCallback!({ type: "done" });
      await promise;
    });

    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    const lastMsg = conv!.messages[conv!.messages.length - 1];
    expect(lastMsg.parsedOptions).toBeUndefined();
  });

  // ── Message flow ──

  it("adds user message and assistant placeholder", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "");
    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build a blog");
    });

    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Build a blog");
    expect(msgs[1].role).toBe("assistant");
  });

  it("shows error when no API key configured", async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        apiKeys: { openai: "", gemini: "", anthropic: "" },
      },
    });

    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    const systemMsg = msgs.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("No API key configured");
  });

  it("sets streaming state during API call", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "");
    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    expect(mockSendAssistantChat).toHaveBeenCalledOnce();
  });

  it("sends API messages excluding system messages", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "sys-1", role: "system", content: "System note",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
    });

    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Build something");
    });

    const callArgs = mockSendAssistantChat.mock.calls[0][0];
    const apiMessages = callArgs.messages;
    expect(apiMessages.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });

  it("handles sendAssistantChat error gracefully", async () => {
    mockSendAssistantChat.mockRejectedValueOnce(new Error("API error"));
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "");

    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    const errorMsg = msgs.find((m) => m.content.includes("Failed to send message"));
    expect(errorMsg).toBeDefined();
  });

  // ── Plan detection (ready to plan) ──

  it("sets conversation status to ready_to_plan on matching pattern", async () => {
    let streamCallback: StreamCb | null = null;
    mockListenAssistantStream.mockImplementation((_id: string, cb: StreamCb) => {
      streamCallback = cb;
      return Promise.resolve(vi.fn());
    });

    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      const promise = result.current.sendPlanningMessage(PROJECT, "Build an app");
      await vi.waitFor(() => expect(streamCallback).not.toBeNull());
      streamCallback!({ type: "delta", text: "I have enough information. Shall I proceed?" });
      streamCallback!({ type: "done" });
      await promise;
    });

    const conv = useTaskBoardStore.getState().conversations.get(PROJECT);
    expect(conv!.status).toBe("ready_to_plan");
  });

  // ── generatePlan ──

  it("generatePlan sends a confirmation message", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "");
    const { result } = renderHook(() => usePlanningConversation());

    await act(async () => {
      result.current.generatePlan(PROJECT);
    });

    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    expect(msgs[0].content).toBe("Yes, generate the plan now.");
  });

  // ── Stream error handling ──

  it("handles stream error event", async () => {
    let streamCallback: StreamCb | null = null;
    mockListenAssistantStream.mockImplementation((_id: string, cb: StreamCb) => {
      streamCallback = cb;
      return Promise.resolve(vi.fn());
    });

    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      const promise = result.current.sendPlanningMessage(PROJECT, "Hello");
      await vi.waitFor(() => expect(streamCallback).not.toBeNull());
      streamCallback!({ type: "error", message: "Rate limited" });
      await promise;
    });

    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    const errorMsg = msgs.find((m) => m.content.includes("Rate limited"));
    expect(errorMsg).toBeDefined();
    expect(useTaskBoardStore.getState().planningStreaming.get(PROJECT)).toBe(false);
  });

  // ── R5: Uses conversation provider/model for API call ──

  it("uses conversation's provider and model for the API call", async () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "anthropic", "claude-sonnet-4-5-20250514", "");

    const { result } = renderHook(() => usePlanningConversation());
    await act(async () => {
      await result.current.sendPlanningMessage(PROJECT, "Hello");
    });

    const callArgs = mockSendAssistantChat.mock.calls[0][0];
    expect(callArgs.provider).toBe("anthropic");
    expect(callArgs.model).toBe("claude-sonnet-4-5-20250514");
    expect(callArgs.apiKey).toBe("ant-test");
  });
});
