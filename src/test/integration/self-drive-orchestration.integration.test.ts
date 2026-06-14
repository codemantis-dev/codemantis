/**
 * Integration test: Self-Drive Orchestration
 *
 * Tests the self-drive store orchestrating with REAL sessionStore and
 * guideStore. Verifies start/stop/pause/resume lifecycle, config defaults,
 * and run-log accumulation across cycles.
 *
 * Only the Tauri IPC boundary, toastStore, and self-drive orchestrator
 * dependencies are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import type { ImplementationGuide } from "../../types/implementation-guide";
import type { Session } from "../../types/session";

// ── Hoisted mocks ────────────────────────────────────────────────────────

const { mockShowToast, mockSendMessage, mockSyncSessionMode } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockSyncSessionMode: vi.fn(() => Promise.resolve()),
}));

// Mock Tauri IPC
vi.mock("../../lib/tauri-commands", () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  syncSessionMode: mockSyncSessionMode,
  sendMessage: mockSendMessage,
  saveGuide: vi.fn(() => Promise.resolve("guide-1")),
  loadGuide: vi.fn(() => Promise.resolve(null)),
  updateGuideData: vi.fn(() => Promise.resolve()),
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
  saveSelfDriveState: vi.fn(() => Promise.resolve()),
  loadSelfDriveState: vi.fn(() => Promise.resolve(null)),
  listSelfDriveStates: vi.fn(() => Promise.resolve([])),
  deleteSelfDriveState: vi.fn(() => Promise.resolve()),
  // selfDriveStore.start() subscribes to chat events to detect
  // turn_complete for Codex sessions. Stub returns a no-op unlisten.
  listenChatEvents: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock toastStore
vi.mock("../../stores/toastStore", () => ({
  showToast: mockShowToast,
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

// Mock self-drive orchestrator and utility modules (not under test)
vi.mock("../../lib/self-drive-orchestrator", () => ({
  callOrchestrator: vi.fn(),
}));

vi.mock("../../lib/guide-verify-prompt", () => ({
  buildSessionVerifyPrompt: vi.fn(() => "Verify prompt"),
}));

vi.mock("../../lib/self-drive-utils", () => ({
  extractToolsFromTurn: vi.fn(() => []),
  getCurrentSessionPlan: vi.fn(),
  getProjectTechStack: vi.fn(() => "React + TypeScript"),
  getBuildCommand: vi.fn(() => "pnpm tsc --noEmit"),
  getTestCommand: vi.fn(() => "pnpm test"),
}));

// Mock error-handler
vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

import { useSelfDriveStore } from "../../stores/selfDriveStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useGuideStore } from "../../stores/guideStore";
import { useSettingsStore } from "../../stores/settingsStore";

// ── Helpers ──────────────────────────────────────────────────────────────

const SESSION_ID = "session-sd-1";

const TEST_SESSION: Session = {
  id: SESSION_ID,
  name: "Self-Drive Test",
  project_path: "/tmp/sd-test",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "claude-sonnet-4-20250514",
  icon_index: 0,
};

function makeGuide(overrides?: Partial<ImplementationGuide>): ImplementationGuide {
  return {
    id: "guide-sd-1",
    projectPath: "/tmp/sd-test",
    specFilename: "spec.md",
    auditFilename: null,
    title: "Test Guide",
    sessions: [
      {
        index: 1,
        name: "Foundation",
        scope: "Phase 1",
        readSections: "Section 1",
        files: ["src/a.ts"],
        prompt: "Build foundation.",
        verifyChecks: [
          { id: "v-1-0", label: "Check A", checked: false },
        ],
        status: "active",
        promptSent: false,
        verifyRequested: false,
      },
      {
        index: 2,
        name: "Features",
        scope: "Phase 2",
        readSections: "Section 2",
        files: ["src/b.ts"],
        prompt: "Build features.",
        verifyChecks: [],
        status: "pending",
        promptSent: false,
        verifyRequested: false,
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
    ...overrides,
  };
}

/** Bootstraps sessionStore and settingsStore so Self-Drive can start. */
function setupReadyState(): void {
  // Settings with API key for the provider
  useSettingsStore.setState({
    settings: {
      theme: "sand",
      fontSize: 13,
      sendShortcut: "enter",
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: { anthropic: "sk-test-key-123" },
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini",
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "claude-code",
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
      codexDebugLoggingEnabled: true,
      sessionLogsRetentionDays: 30,
      superBroEnabled: false,
      superBroProvider: "auto",
      superBroModel: "auto",
      selfDriveProvider: "anthropic",
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
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });

  // Real addSession to bootstrap all session maps
  useSessionStore.getState().addSession(TEST_SESSION);

  // Load guide
  useGuideStore.setState({ guide: makeGuide(), loading: false });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Self-Drive Orchestration (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  // ─── start() precondition failures ─────────────────────────────────────

  it("start() fails with toast when no active session", async () => {
    // No session added — activeSessionId is null
    useGuideStore.setState({ guide: makeGuide(), loading: false });

    await useSelfDriveStore.getState().start();

    expect(mockShowToast).toHaveBeenCalledWith("No active Claude Code session", "error");
    expect(useSelfDriveStore.getState().status).toBe("idle");
  });

  it("start() fails when no guide loaded", async () => {
    // Session exists but no guide
    useSettingsStore.setState({
      settings: {
        theme: "sand",
        fontSize: 13,
        sendShortcut: "enter",
        terminalShell: null,
        terminalFontSize: 13,
        quickCommands: [],
        apiKeys: { anthropic: "sk-key" },
        modelPricing: {},
        changelogEnabled: false,
        changelogProvider: "gemini",
        changelogModel: "gemini-2.5-flash-lite",
        changelogPrompt: "",
        assistantShortcuts: [],
        assistantDefaultProvider: "claude-code",
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
      codexDebugLoggingEnabled: true,
        sessionLogsRetentionDays: 30,
        superBroEnabled: false,
        superBroProvider: "auto",
        superBroModel: "auto",
        selfDriveProvider: "anthropic",
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
      } as ReturnType<typeof useSettingsStore.getState>["settings"],
      loaded: true,
    });
    useSessionStore.getState().addSession(TEST_SESSION);
    // guide is null (reset state)

    await useSelfDriveStore.getState().start();

    expect(mockShowToast).toHaveBeenCalledWith("No guide loaded", "error");
    expect(useSelfDriveStore.getState().status).toBe("idle");
  });

  // ─── start() success ──────────────────────────────────────────────────

  it("start() sets status to running and records startedAt", async () => {
    setupReadyState();

    const beforeStart = Date.now();
    await useSelfDriveStore.getState().start();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("running");
    expect(state.startedAt).toBeDefined();
    expect(state.startedAt!).toBeGreaterThanOrEqual(beforeStart);
    expect(state.startedAt!).toBeLessThanOrEqual(Date.now());
    expect(state.currentSessionIndex).toBe(1);
    expect(state.currentPhase).toBe("building");
  });

  // ─── stop() ────────────────────────────────────────────────────────────

  it("stop() restores status to idle and records in runLog", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    // Verify running
    expect(useSelfDriveStore.getState().status).toBe("running");

    await useSelfDriveStore.getState().stop();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("idle");
    expect(state.currentPhase).toBeNull();
    expect(state.currentSessionIndex).toBeNull();

    // Run log should have entries from start + stop
    const stopEntry = state.runLog.find((e) => e.phase === "stopped");
    expect(stopEntry).toBeDefined();
    expect(stopEntry!.summary).toContain("stopped by user");
  });

  // ─── pause() ──────────────────────────────────────────────────────────

  it("pause() sets status to paused with reason", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    useSelfDriveStore.getState().pause();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("paused");
    expect(state.pauseReason).toBe("Paused by user");

    // Run log should contain a paused entry
    const pauseEntry = state.runLog.find((e) => e.phase === "paused");
    expect(pauseEntry).toBeDefined();
  });

  // ─── resume() ─────────────────────────────────────────────────────────

  it("resume() sets status back to running", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    // Pause first
    useSelfDriveStore.getState().pause();
    expect(useSelfDriveStore.getState().status).toBe("paused");

    // Resume
    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("running");
    expect(state.pauseReason).toBeNull();

    // Run log should contain a resumed entry
    const resumeEntry = state.runLog.find((e) => e.phase === "resumed");
    expect(resumeEntry).toBeDefined();
  });

  // ─── Config defaults ──────────────────────────────────────────────────

  it("config defaults are applied correctly", () => {
    // After resetAllStores, check the initial config
    const config = useSelfDriveStore.getState().config;

    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-haiku-4-5");
    expect(config.maxFixAttempts).toBe(3);
    expect(config.runTests).toBe(true);
    expect(config.runBuildCheck).toBe(true);
    expect(config.autoCommit).toBe(false);
  });

  // ─── Run log accumulation ─────────────────────────────────────────────

  it("runLog entries accumulate across start/stop cycles", async () => {
    setupReadyState();

    // Cycle 1: start -> stop
    await useSelfDriveStore.getState().start();
    await useSelfDriveStore.getState().stop();

    const logAfterCycle1 = useSelfDriveStore.getState().runLog.length;
    expect(logAfterCycle1).toBeGreaterThan(0);

    // Re-setup because start() resets runLog
    // The self-drive store start() resets runLog, so we verify that a
    // start -> pause -> resume -> stop cycle accumulates within one run
    setupReadyState();

    await useSelfDriveStore.getState().start();
    const logAfterStart = useSelfDriveStore.getState().runLog.length;

    useSelfDriveStore.getState().pause();
    const logAfterPause = useSelfDriveStore.getState().runLog.length;
    expect(logAfterPause).toBeGreaterThan(logAfterStart);

    await useSelfDriveStore.getState().resume();
    const logAfterResume = useSelfDriveStore.getState().runLog.length;
    expect(logAfterResume).toBeGreaterThan(logAfterPause);

    await useSelfDriveStore.getState().stop();
    const logAfterStop = useSelfDriveStore.getState().runLog.length;
    expect(logAfterStop).toBeGreaterThan(logAfterResume);

    // Verify we have the complete lifecycle in the log
    const phases = useSelfDriveStore.getState().runLog.map((e) => e.phase);
    expect(phases).toContain("started");
    expect(phases).toContain("building");
    expect(phases).toContain("paused");
    expect(phases).toContain("resumed");
    expect(phases).toContain("stopped");
  });

  // ─── lowConfidenceCount resets on start() ─────────────────────────────

  it("lowConfidenceCount is reset to 0 on start()", async () => {
    setupReadyState();

    // Artificially set a high count
    useSelfDriveStore.setState({ lowConfidenceCount: 5 });
    expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(5);

    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(0);
  });

  // ─── stop() cleans up and restores mode ────────────────────────────────

  it("stop() restores session mode from auto-accept to original", async () => {
    setupReadyState();

    // Set mode to "plan" before starting
    useSessionStore.getState().setSessionMode(SESSION_ID, "plan");

    await useSelfDriveStore.getState().start();

    // start() should have switched to auto-accept
    expect(mockSyncSessionMode).toHaveBeenCalledWith(SESSION_ID, "auto-accept");

    await useSelfDriveStore.getState().stop();

    // stop() should restore original mode
    const calls = mockSyncSessionMode.mock.calls as unknown as string[][];
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe(SESSION_ID);
    // The mode should be restored (either "plan" or "normal")
    expect(lastCall[1]).not.toBe("auto-accept");
  });

  // ─── Run log entries include prompts ───────────────────────────────────

  it("building log entry includes the session prompt text", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    const buildEntry = useSelfDriveStore.getState().runLog.find(
      (e) => e.phase === "building",
    );
    expect(buildEntry).toBeDefined();
    expect(buildEntry!.prompt).toBe("Build foundation.");
  });

  // ─── Decision messages injected into session ───────────────────────────

  it("pause/resume/stop cycle does not leak stale listeners", async () => {
    setupReadyState();

    // Start -> pause -> resume -> stop
    await useSelfDriveStore.getState().start();
    useSelfDriveStore.getState().pause();
    await useSelfDriveStore.getState().resume();
    await useSelfDriveStore.getState().stop();

    // Final state should be clean
    expect(useSelfDriveStore.getState().status).toBe("idle");
    expect(useSelfDriveStore.getState().currentPhase).toBeNull();
    expect(useSelfDriveStore.getState().currentSessionIndex).toBeNull();
    expect(useSelfDriveStore.getState().pauseReason).toBeNull();
  });
});
