/**
 * Integration test: useSuperBro hook
 *
 * Tests Super-Bro's store interactions and guard conditions using REAL
 * Zustand stores. The complex AI call logic is not tested here; focus is
 * on the testable store interaction paths and guard conditions.
 *
 * Only the Tauri IPC boundary (tauri-commands) and toastStore are mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSuperBroStore } from "../../stores/superBroStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";

// ── Mock Tauri IPC ──────────────────────────────────────────────────────────

vi.mock("../../lib/tauri-commands", () => ({
  sendAssistantChat: vi.fn().mockResolvedValue(undefined),
  listenAssistantStream: vi.fn().mockResolvedValue(() => {}),
  readFileContent: vi.fn().mockResolvedValue(""),
  getGitStatus: vi.fn().mockResolvedValue({
    branch: "main",
    uncommitted_changes: 0,
    changed_files: [],
  }),
  saveObservation: vi.fn().mockResolvedValue(undefined),
  loadObservations: vi.fn().mockResolvedValue([]),
  deleteObservation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/super-bro-context", () => ({
  buildSuperBroContext: vi.fn().mockReturnValue({}),
  buildSuperBroRequest: vi.fn().mockResolvedValue({
    systemPrompt: "test-system-prompt",
    userMessage: "test-user-message",
  }),
}));

vi.mock("../../lib/super-bro-parser", () => ({
  parseSuperBroResponse: vi.fn().mockReturnValue({
    guidance: "Test guidance",
    suggestedPrompt: null,
    fileCheckRequest: null,
    observations: [],
    isNothingToReport: false,
  }),
}));

vi.mock("../../lib/guide-verify-prompt", () => ({
  buildGuideCompleteVerifyPrompt: vi.fn().mockReturnValue("verify prompt"),
}));

import { useSuperBro } from "../../hooks/useSuperBro";

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_PATH = "/tmp/test-super-bro";
const SESSION_ID = "session-sb-1";

function setupSettings(overrides?: Partial<ReturnType<typeof useSettingsStore.getState>["settings"]>): void {
  useSettingsStore.setState({
    settings: {
      theme: "sand" as const,
      fontSize: 13,
      sendShortcut: "enter" as const,
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: { gemini: "test-key" },
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini" as const,
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "claude-code" as const,
      assistantDefaultModel: {},
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
      sessionLogsRetentionDays: 30,
      superBroEnabled: true,
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
      ...overrides,
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });
}

function seedSession(): void {
  useSessionStore.getState().addSession({
    id: SESSION_ID,
    name: "Test Session",
    project_path: PROJECT_PATH,
    status: "connected",
    created_at: new Date().toISOString(),
    model: "claude-sonnet-4-20250514",
    icon_index: 0,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useSuperBro (Integration)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
    seedSession();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Guard conditions ─────────────────────────────────────────────────

  it("does not fire when superBroEnabled is false", () => {
    setupSettings({ superBroEnabled: false });

    // Render hook with disabled Super-Bro
    renderHook(() => useSuperBro(PROJECT_PATH));

    // Advance past session_start delay (2s) + debounce (500ms)
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // No API calls should have been made (no logs)
    const log = useSuperBroStore.getState().log;
    const apiCalls = log.filter((e) => e.type === "api_call");
    expect(apiCalls).toHaveLength(0);
  });

  it("does not fire when isPaused is true", () => {
    useSuperBroStore.getState().pause();
    expect(useSuperBroStore.getState().isPaused).toBe(true);

    renderHook(() => useSuperBro(PROJECT_PATH));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const log = useSuperBroStore.getState().log;
    const apiCalls = log.filter((e) => e.type === "api_call");
    expect(apiCalls).toHaveLength(0);
  });

  it("does not fire for project with enabledProjects=false", () => {
    // Disable Super-Bro for this specific project
    useSuperBroStore.getState().toggle(PROJECT_PATH);
    // Default is true, so toggling makes it false
    expect(useSuperBroStore.getState().isEnabled(PROJECT_PATH)).toBe(false);

    renderHook(() => useSuperBro(PROJECT_PATH));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const log = useSuperBroStore.getState().log;
    const apiCalls = log.filter((e) => e.type === "api_call");
    expect(apiCalls).toHaveLength(0);
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────

  it("hook registers and unregisters event listener", () => {
    const { unmount } = renderHook(() => useSuperBro(PROJECT_PATH));

    // Hook should have set up store subscriptions (we verify by
    // checking that the hook renders without error and cleans up)
    expect(() => {
      unmount();
    }).not.toThrow();
  });

  // ─── Store interactions ───────────────────────────────────────────────

  it("setMessage stores message in superBroStore", () => {
    renderHook(() => useSuperBro(PROJECT_PATH));

    act(() => {
      useSuperBroStore.getState().setMessage(PROJECT_PATH, {
        id: "sb-test-1",
        guidance: "You should write tests for this.",
        suggestedPrompt: "Write unit tests for the UserService class",
        fileCheckRequest: null,
        trigger: "claude_response",
        timestamp: new Date().toISOString(),
        dismissed: false,
      });
    });

    const message = useSuperBroStore.getState().projectMessages.get(PROJECT_PATH);
    expect(message).toBeDefined();
    expect(message!.guidance).toBe("You should write tests for this.");
    expect(message!.suggestedPrompt).toBe("Write unit tests for the UserService class");
    expect(message!.trigger).toBe("claude_response");
    expect(message!.dismissed).toBe(false);

    // Thinking should be cleared when message is set
    expect(useSuperBroStore.getState().projectThinking.get(PROJECT_PATH)).toBe(false);

    // Message should be in history
    const history = useSuperBroStore.getState().messageHistory;
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("sb-test-1");
  });

  it("dismissMessage clears message from superBroStore", () => {
    renderHook(() => useSuperBro(PROJECT_PATH));

    // Set a message first
    act(() => {
      useSuperBroStore.getState().setMessage(PROJECT_PATH, {
        id: "sb-test-2",
        guidance: "Test guidance",
        suggestedPrompt: null,
        fileCheckRequest: null,
        trigger: "session_start",
        timestamp: new Date().toISOString(),
        dismissed: false,
      });
    });

    expect(useSuperBroStore.getState().projectMessages.get(PROJECT_PATH)).toBeDefined();

    // Dismiss the message
    act(() => {
      useSuperBroStore.getState().dismissMessage(PROJECT_PATH);
    });

    expect(useSuperBroStore.getState().projectMessages.get(PROJECT_PATH)).toBeNull();
  });

  it("toggle enables/disables for project", () => {
    renderHook(() => useSuperBro(PROJECT_PATH));

    // Default: enabled (true)
    expect(useSuperBroStore.getState().isEnabled(PROJECT_PATH)).toBe(true);

    // Toggle off
    act(() => {
      useSuperBroStore.getState().toggle(PROJECT_PATH);
    });
    expect(useSuperBroStore.getState().isEnabled(PROJECT_PATH)).toBe(false);

    // Toggle back on
    act(() => {
      useSuperBroStore.getState().toggle(PROJECT_PATH);
    });
    expect(useSuperBroStore.getState().isEnabled(PROJECT_PATH)).toBe(true);
  });

  it("pause/resume toggles isPaused state", () => {
    renderHook(() => useSuperBro(PROJECT_PATH));

    expect(useSuperBroStore.getState().isPaused).toBe(false);

    act(() => {
      useSuperBroStore.getState().pause();
    });
    expect(useSuperBroStore.getState().isPaused).toBe(true);

    act(() => {
      useSuperBroStore.getState().resume();
    });
    expect(useSuperBroStore.getState().isPaused).toBe(false);
  });
});
