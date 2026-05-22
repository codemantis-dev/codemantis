import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FrontendEvent, TurnCompleteEvent, ProcessExitedEvent } from "../types/agent-events";
import type { Blocker, ImplementationGuide, OrchestratorDecision, OrchestratorInput } from "../types/implementation-guide";

// ── Hoisted mocks ─────────────────────────────────────────────────────

const {
  mockListen,
  mockSendMessage,
  mockSyncSessionMode,
  mockCallOrchestrator,
  mockBuildSessionVerifyPrompt,
  mockShowToast,
  mockGetCurrentSessionPlan,
} = vi.hoisted(() => ({
  mockListen: vi.fn<(channel: string, handler: (event: { payload: FrontendEvent }) => void) => Promise<() => void>>(() => Promise.resolve(vi.fn())),
  mockSendMessage: vi.fn<(sessionId: string, prompt: string) => Promise<void>>(() => Promise.resolve()),
  mockSyncSessionMode: vi.fn(() => Promise.resolve()),
  mockCallOrchestrator: vi.fn<(input: OrchestratorInput, provider: string, apiKey: string, model: string) => Promise<OrchestratorDecision>>(),
  mockBuildSessionVerifyPrompt: vi.fn(() => "Verify session prompt"),
  mockShowToast: vi.fn(),
  mockGetCurrentSessionPlan: vi.fn((sessionIndex: number) => ({
    index: sessionIndex,
    name: `Session ${sessionIndex}`,
    scope: "Phase",
    prompt: "Build something",
    verifyChecks: [{ label: "Check A" }, { label: "Check B" }],
    isLastSession: false,
    hasAuditDocument: false,
  })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

interface ParityCallResult {
  action: string;
  callerPresent: boolean;
  handlerPresent: boolean;
  handlerStubFree: boolean;
  status: "PASS" | "FAIL";
  detail: string;
}
interface ParityCallRequest {
  action: string;
  callerPath: string;
  callerPaths?: string[];
  handlerPath: string;
  wire?: string;
}
const mockVerifyActionParity = vi.hoisted(() =>
  vi.fn<
    (root: string, actions: ParityCallRequest[]) => Promise<ParityCallResult[]>
  >(() => Promise.resolve([])),
);

vi.mock("../lib/tauri-commands", () => ({
  sendMessage: mockSendMessage,
  syncSessionMode: mockSyncSessionMode,
  // guideStore persistence needs these
  saveGuide: vi.fn(() => Promise.resolve("guide-1")),
  loadGuide: vi.fn(() => Promise.resolve(null)),
  updateGuideData: vi.fn(() => Promise.resolve()),
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
  // Self-Drive run-state persistence (Phase-1.7)
  saveSelfDriveState: vi.fn(() => Promise.resolve()),
  loadSelfDriveState: vi.fn(() => Promise.resolve(null)),
  listSelfDriveStates: vi.fn(() => Promise.resolve([])),
  deleteSelfDriveState: vi.fn(() => Promise.resolve()),
  // Cross-system action parity gate — used by attemptMarkSessionComplete.
  verifyActionParity: mockVerifyActionParity,

  // Mirror the production listenChatEvents: subscribes to both
  // claude-chat-* and codex-chat-* via the same `listen` mock so the
  // existing `mockListen.mock.calls` assertions still observe the
  // listener channels (now dual). v1.4.1 Phase A.1 — Self-Drive
  // dual-channel subscription.
  listenChatEvents: vi.fn((sessionId: string, callback: (e: FrontendEvent) => void) => {
    const handler = (e: { payload: FrontendEvent }): void => callback(e.payload);
    return Promise.all([
      mockListen(`claude-chat-${sessionId}`, handler),
      mockListen(`codex-chat-${sessionId}`, handler),
    ]).then(([unA, unB]) => () => {
      unA();
      unB();
    });
  }),
}));

vi.mock("../lib/self-drive-orchestrator", () => ({
  callOrchestrator: mockCallOrchestrator,
}));

vi.mock("../lib/guide-verify-prompt", () => ({
  buildSessionVerifyPrompt: mockBuildSessionVerifyPrompt,
}));

vi.mock("./toastStore", () => ({
  showToast: mockShowToast,
}));

// Mock self-drive-utils with controllable return values
vi.mock("../lib/self-drive-utils", () => ({
  extractToolsFromTurn: vi.fn(() => ["Read", "Write"]),
  getCurrentSessionPlan: mockGetCurrentSessionPlan,
  getProjectTechStack: vi.fn(() => "React + TypeScript"),
  getBuildCommand: vi.fn(() => "pnpm tsc --noEmit"),
  getTestCommand: vi.fn(() => "pnpm test"),
}));

import {
  useSelfDriveStore,
  assessVerifyAdvance,
  fuzzyLabelMatch,
  attemptMarkSessionComplete,
  handleVerify,
  isSelfDriveOwningProject,
  toggleVerifyCheckForSession,
  markPromptSentForSession,
  markVerifyRequestedForSession,
  deriveCallerPaths,
} from "./selfDriveStore";
import { useSessionStore } from "./sessionStore";
import { useGuideStore } from "./guideStore";
import { useSettingsStore } from "./settingsStore";

// ── Helpers ────────────────────────────────────────────────────────────

const SESSION_ID = "session-abc";

function makeGuide(overrides?: Partial<ImplementationGuide>): ImplementationGuide {
  return {
    id: "guide-1",
    projectPath: "/test",
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
          { id: "v-1-1", label: "Check B", checked: false },
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
        verifyChecks: [
          { id: "v-2-0", label: "Feature check", checked: false },
        ],
        status: "pending",
        promptSent: false,
        verifyRequested: false,
      },
      {
        index: 3,
        name: "Polish",
        scope: "Phase 3",
        readSections: "Section 3",
        files: ["src/c.ts"],
        prompt: "Polish everything.",
        verifyChecks: [
          { id: "v-3-0", label: "Polish check", checked: false },
        ],
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

function makeTurnCompleteEvent(sessionId: string = SESSION_ID): TurnCompleteEvent {
  return {
    type: "turn_complete",
    session_id: sessionId,
    duration_ms: 5000,
    usage: null,
    cost_usd: 0.01,
  };
}

/** Set up stores to a state where Self-Drive can be started. */
function setupReadyState(): void {
  // Session store: active session with a message
  useSessionStore.setState({
    activeSessionId: SESSION_ID,
    activeProjectPath: "/test",
    projectOrder: ["/test"],
    projectActiveSession: new Map([["/test", SESSION_ID]]),
    sessions: new Map([[SESSION_ID, {
      id: SESSION_ID,
      name: "Test",
      project_path: "/test",
      status: "connected",
      created_at: "",
      model: "sonnet",
      icon_index: 0,
    }]]),
    sessionMessages: new Map([[SESSION_ID, [
      { id: "msg-1", role: "assistant", content: "Done building foundation.", timestamp: "", activityIds: [], isStreaming: false },
    ]]]),
    sessionBusy: new Map(),
    sessionModes: new Map([[SESSION_ID, "normal"]]),
  });

  // Guide store: guide with session 1 active
  useGuideStore.setState({ guide: makeGuide(), loading: false });

  // Settings store: API key configured
  useSettingsStore.setState({
    settings: {
      theme: "midnight",
      fontSize: 13,
      sendShortcut: "cmd+enter",
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: { anthropic: "test-key", openai: "", gemini: "" },
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
      triviaEnabled: true,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      claudeBinaryOverride: null,
      onboardingCompleted: false,
      apiKeyBannerDismissed: false,
      lastCloneDirectory: null,
      previewConsoleAutoOpen: true,
      previewLastUrls: {},
      taskBoardPlanningModel: "gemini-3-flash-preview",
      taskBoardMaxTokens: 64000,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
      sessionLogsEnabled: true,
      sessionLogsRetentionDays: 30,
      superBroEnabled: true,
      superBroProvider: "auto",
      superBroModel: "auto",
      selfDriveProvider: "anthropic",
      selfDriveModel: "claude-haiku-4-5",
      selfDriveMaxFixAttempts: 3,
      selfDriveRunBuildCheck: true,
      selfDriveRunTests: false,
      selfDriveAutoCommit: false,
      selfDriveEnableRecheckLoop: true,
      selfDriveConfirmCapabilities: true,
      defaultThinkingEffort: null,
      defaultAgentByTask: {},
      secondOpinionPrivacyAcknowledged: false,
    },
    loaded: true,
  });
}

/**
 * Capture the event callback registered via listen().
 * Returns a function that can be called to simulate events.
 */
function captureListenCallback(): (event: FrontendEvent) => void {
  const listenCall = mockListen.mock.calls.find(
    (call) => typeof call[0] === "string" && call[0].startsWith("claude-chat-"),
  );
  if (!listenCall) throw new Error("listen was not called with claude-chat-* channel");
  const callback = listenCall[1] as (event: { payload: FrontendEvent }) => void;
  return (payload: FrontendEvent) => callback({ payload });
}

function resetStores(): void {
  useSelfDriveStore.setState({
    status: "idle",
    projectPath: null,
    currentSessionIndex: null,
    currentPhase: null,
    previousSessionMode: null,
    fixAttempt: 0,
    maxFixAttempts: 3,
    previousFixPrompts: [],
    runLog: [],
    startedAt: null,
    sessionStartedAt: null,
    pauseReason: null,
  });
  useSessionStore.setState({
    activeSessionId: null,
    activeProjectPath: null,
    sessions: new Map(),
    sessionMessages: new Map(),
    sessionBusy: new Map(),
    sessionModes: new Map(),
    projectActiveSession: new Map(),
    projectOrder: [],
  });
  useGuideStore.setState({ guide: null, loading: false });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("selfDriveStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ── Initial state ──────────────────────────────────────────────────

  it("starts with idle status", () => {
    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("idle");
    expect(state.currentPhase).toBeNull();
    expect(state.currentSessionIndex).toBeNull();
  });

  // ── Start validation ──────────────────────────────────────────────

  it("start fails without active session", async () => {
    useGuideStore.setState({ guide: makeGuide() });
    await useSelfDriveStore.getState().start();
    expect(mockShowToast).toHaveBeenCalledWith("No active Claude Code session", "error");
    expect(useSelfDriveStore.getState().status).toBe("idle");
  });

  it("start fails without guide", async () => {
    useSessionStore.setState({ activeSessionId: SESSION_ID, activeProjectPath: "/test" });
    await useSelfDriveStore.getState().start();
    expect(mockShowToast).toHaveBeenCalledWith("No guide loaded", "error");
  });

  it("start fails without API key", async () => {
    setupReadyState();
    useSettingsStore.setState((prev) => ({
      settings: { ...prev.settings, apiKeys: { anthropic: "", openai: "", gemini: "" } },
    }));
    await useSelfDriveStore.getState().start();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining("No API key"),
      "error",
    );
  });

  // ── Event listener channel ────────────────────────────────────────

  describe("event listener setup", () => {
    it("listens on claude-chat-{sessionId}, NOT global event names", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();

      // Verify listen was called with the correct session-specific channel
      const listenCalls = mockListen.mock.calls.map((c) => c[0]);
      expect(listenCalls).toContain(`claude-chat-${SESSION_ID}`);

      // Verify it was NOT called with wrong global event names
      expect(listenCalls).not.toContain("turn_complete");
      expect(listenCalls).not.toContain("process_exited");
      expect(listenCalls).not.toContain("compacting_status");
    });

    it("registers exactly one listener (not three separate ones)", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();

      // Should be exactly one listen call for claude-chat-*
      const chatListenCalls = mockListen.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].startsWith("claude-chat-"),
      );
      expect(chatListenCalls).toHaveLength(1);
    });

    it("cleans up listener on stop", async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);
      setupReadyState();

      await useSelfDriveStore.getState().start();
      await useSelfDriveStore.getState().stop();

      expect(mockUnlisten).toHaveBeenCalled();
    });
  });

  // ── Event routing ────────────────────────────────────────────────

  describe("event routing through single listener", () => {
    it("routes turn_complete events to orchestrator", async () => {
      setupReadyState();
      mockCallOrchestrator.mockResolvedValue({
        action: "verify",
        summary: "Proceeding to verify",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      // Simulate turn_complete event
      emit(makeTurnCompleteEvent());

      // Wait for async orchestrator call
      await vi.waitFor(() => {
        expect(mockCallOrchestrator).toHaveBeenCalled();
      });
    });

    it("routes process_exited to crash handler and pauses", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      const exitEvent: ProcessExitedEvent = {
        type: "process_exited",
        session_id: SESSION_ID,
        exit_code: 1,
        stderr_tail: "error",
        elapsed_ms: 1000,
      };
      emit(exitEvent);

      expect(useSelfDriveStore.getState().status).toBe("paused");
      expect(useSelfDriveStore.getState().pauseReason).toContain("process exited");
    });

    it("routes compacting_status to run log", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      emit({
        type: "compacting_status",
        session_id: SESSION_ID,
        is_compacting: true,
      });

      const log = useSelfDriveStore.getState().runLog;
      const compactEntry = log.find((e) => e.summary.includes("compacting"));
      expect(compactEntry).toBeDefined();
    });

    it("rate-limits repeated compacting_status events to one entry per window", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      // Burst: 5 compacting_status events in quick succession.
      for (let i = 0; i < 5; i++) {
        emit({ type: "compacting_status", session_id: SESSION_ID, is_compacting: true });
      }

      const log = useSelfDriveStore.getState().runLog;
      const compactEntries = log.filter((e) => e.summary.includes("compacting"));
      // Only the FIRST burst event is logged; the rest are suppressed.
      expect(compactEntries).toHaveLength(1);
    });

    it("ignores the trailing 'compaction complete' event", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      emit({ type: "compacting_status", session_id: SESSION_ID, is_compacting: false });

      const log = useSelfDriveStore.getState().runLog;
      const compactEntries = log.filter((e) => e.summary.includes("compact"));
      expect(compactEntries).toHaveLength(0);
    });

    it("ignores unrelated event types", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      // text_delta should be silently ignored, no crash
      emit({
        type: "text_delta",
        session_id: SESSION_ID,
        text: "Hello",
      } as FrontendEvent);

      // No crash, state unchanged
      expect(useSelfDriveStore.getState().status).toBe("running");
    });
  });

  // ── Start flow ───────────────────────────────────────────────────

  describe("start", () => {
    it("sets running state and sends first prompt", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();

      expect(useSelfDriveStore.getState().status).toBe("running");
      expect(useSelfDriveStore.getState().currentPhase).toBe("building");
      expect(useSelfDriveStore.getState().currentSessionIndex).toBe(1);
      // Self-Drive wraps the session prompt with the BUILD_MODE preamble
      // (Senior-Engineer Quality Contract) before sending. Assert both the
      // wrapping AND the original prompt are present.
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("Build foundation."),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("BUILD MODE"),
      );
    });

    it("switches to auto-accept mode", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      expect(mockSyncSessionMode).toHaveBeenCalledWith(SESSION_ID, "auto-accept");
    });

    it("saves previous session mode for restoration", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      expect(useSelfDriveStore.getState().previousSessionMode).toBe("normal");
    });
  });

  // ── Orchestrator decision routing ───────────────────────────────

  describe("decision execution", () => {
    async function startAndTriggerTurn(decision: OrchestratorDecision): Promise<void> {
      setupReadyState();
      mockCallOrchestrator.mockResolvedValue(decision);
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());
      await vi.waitFor(() => {
        expect(mockCallOrchestrator).toHaveBeenCalled();
      });
    }

    it("verify decision sends verify prompt", async () => {
      await startAndTriggerTurn({
        action: "verify",
        summary: "Proceeding to verify",
        confidence: "high",
      });

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().currentPhase).toBe("verifying");
      });
      expect(mockBuildSessionVerifyPrompt).toHaveBeenCalled();
    });

    it("build_check decision sends build command", async () => {
      await startAndTriggerTurn({
        action: "build_check",
        summary: "Checking build",
        confidence: "high",
      });

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().currentPhase).toBe("build-checking");
      });
    });

    it("fix decision increments fix attempt", async () => {
      await startAndTriggerTurn({
        action: "fix",
        fixPrompt: "Fix the imports",
        summary: "Fixing imports",
        confidence: "high",
      });

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().fixAttempt).toBe(1);
        expect(useSelfDriveStore.getState().currentPhase).toBe("fixing");
      });
    });

    it("pause decision pauses with reason", async () => {
      await startAndTriggerTurn({
        action: "pause",
        pauseReason: "Need user input",
        summary: "Pausing",
        confidence: "high",
      });

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().status).toBe("paused");
        expect(useSelfDriveStore.getState().pauseReason).toContain("Need user input");
      });
    });

    it("low confidence decision auto-pauses", async () => {
      setupReadyState();
      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Not sure",
        confidence: "low",
      });
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().status).toBe("paused");
        expect(useSelfDriveStore.getState().pauseReason).toContain("uncertain");
      });
    });
  });

  // ── handleAdvance — phase guards ────────────────────────────────

  describe("handleAdvance phase guards", () => {
    /** Helper: set up a guide where session 1 has all checks already checked. */
    function setupWithCheckedSession(): void {
      setupReadyState();
      const guide = makeGuide();
      guide.sessions[0].verifyChecks[0].checked = true;
      guide.sessions[0].verifyChecks[1].checked = true;
      useGuideStore.setState({ guide });
    }

    it("runs tests when previousPhase is 'verifying' and runTests=true", async () => {
      setupWithCheckedSession();
      // Enable runTests
      useSettingsStore.setState((prev) => ({
        settings: { ...prev.settings, selfDriveRunTests: true },
      }));

      // Start, then simulate orchestrator returning advance from verify phase
      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "All checks pass",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:1 — `const a = 1`" },
          { label: "Check B", passed: true, evidence: "src/b.ts:1 — `const b = 2`" },
        ],
      });

      await useSelfDriveStore.getState().start();

      // Force the phase to "verifying" so that when turn_complete fires,
      // the captured pre-phase is "verifying"
      useSelfDriveStore.setState({ currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().currentPhase).toBe("testing");
      });

      // Verify test command was sent
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("pnpm test"),
      );
    });

    it("skips tests when previousPhase is 'testing' (prevents infinite loop)", async () => {
      setupWithCheckedSession();
      useSettingsStore.setState((prev) => ({
        settings: { ...prev.settings, selfDriveRunTests: true },
      }));

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Tests passed",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();

      // Simulate: we're coming from a testing phase
      useSelfDriveStore.setState({ currentPhase: "testing" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      // Should skip tests and go to next session (building), not stay in testing
      await vi.waitFor(() => {
        const phase = useSelfDriveStore.getState().currentPhase;
        expect(phase).not.toBe("testing");
      });
    });

    it("skips inter-session test gate when the session had fix activity (Phase A.1)", async () => {
      setupWithCheckedSession();
      useSettingsStore.setState((prev) => ({
        settings: { ...prev.settings, selfDriveRunTests: true },
      }));

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "All checks pass",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:1 — `const a = 1`" },
          { label: "Check B", passed: true, evidence: "src/b.ts:1 — `const b = 2`" },
        ],
      });

      await useSelfDriveStore.getState().start();

      // Simulate: this session needed a fix to get to advance
      useSelfDriveStore.setState({ currentPhase: "verifying", fixAttempt: 2 });

      // Drop any test-gate messages sent during start()
      mockSendMessage.mockClear();

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        // Should NOT enter testing phase — Claude already validated via fix
        const phase = useSelfDriveStore.getState().currentPhase;
        expect(phase).not.toBe("testing");
      });

      // Confirm no test prompt was injected
      const sentTextWithTest = mockSendMessage.mock.calls.find(
        (c) => typeof c[1] === "string" && c[1].includes("Run the test suite"),
      );
      expect(sentTextWithTest).toBeUndefined();
    });

    it("skips inter-session test gate when the session had recheck activity (Phase A.1)", async () => {
      setupWithCheckedSession();
      useSettingsStore.setState((prev) => ({
        settings: { ...prev.settings, selfDriveRunTests: true },
      }));

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "All checks pass",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:1 — `const a = 1`" },
          { label: "Check B", passed: true, evidence: "src/b.ts:1 — `const b = 2`" },
        ],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "verifying", recheckRoundsUsed: 1 });
      mockSendMessage.mockClear();

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        const phase = useSelfDriveStore.getState().currentPhase;
        expect(phase).not.toBe("testing");
      });

      const sentTextWithTest = mockSendMessage.mock.calls.find(
        (c) => typeof c[1] === "string" && c[1].includes("Run the test suite"),
      );
      expect(sentTextWithTest).toBeUndefined();
    });

    it("skips tests when previousPhase is 'committing'", async () => {
      setupWithCheckedSession();
      useSettingsStore.setState((prev) => ({
        settings: { ...prev.settings, selfDriveRunTests: true },
      }));

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Committed",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "committing" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        const phase = useSelfDriveStore.getState().currentPhase;
        expect(phase).not.toBe("testing");
      });
    });

    it("runs commit after tests when previousPhase is 'testing' and autoCommit=true", async () => {
      setupWithCheckedSession();
      useSettingsStore.setState((prev) => ({
        settings: { ...prev.settings, selfDriveRunTests: true, selfDriveAutoCommit: true },
      }));

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Tests passed",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "testing" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().currentPhase).toBe("committing");
      });
    });

    it("skips commit when previousPhase is 'committing'", async () => {
      setupWithCheckedSession();
      useSettingsStore.setState((prev) => ({
        settings: { ...prev.settings, selfDriveAutoCommit: true },
      }));

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Committed",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "committing" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        const phase = useSelfDriveStore.getState().currentPhase;
        // Should advance to next session, not stay in committing
        expect(phase).toBe("building");
        expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
      });
    });
  });

  // ── handleAdvance — markSessionComplete ─────────────────────────

  describe("handleAdvance markSessionComplete", () => {
    it("rejects advance from verify phase when the orchestrator's verdict is wholly fabricated (≥50% labels unmatched)", async () => {
      setupReadyState();
      // Session 1 has "Check A" and "Check B"; orchestrator reports a
      // completely different label for its one result → 2/2 unmatched →
      // ≥50% → structural integrity pause, no recheck (the orchestrator
      // fabricated the verdict, rechecking is unlikely to help).
      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "All done",
        confidence: "high",
        checkResults: [
          { label: "nonexistent check", passed: true },
        ],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().status).toBe("paused");
      });

      // Checks stay unchecked. Session stays active.
      const guide = useGuideStore.getState().guide!;
      const session1 = guide.sessions[0];
      expect(session1.verifyChecks[0].checked).toBe(false);
      expect(session1.verifyChecks[1].checked).toBe(false);
      expect(session1.status).toBe("active");
      expect(useSelfDriveStore.getState().pauseReason).toMatch(/session labels have no match/);
    });

    it("continues when session is already done (re-advance after test/commit)", async () => {
      setupReadyState();
      // Pre-mark session 1 as done
      const guide = makeGuide();
      guide.sessions[0].status = "done";
      guide.sessions[0].verifyChecks[0].checked = true;
      guide.sessions[0].verifyChecks[1].checked = true;
      guide.sessions[1].status = "active";
      useGuideStore.setState({ guide });

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Tests passed",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();
      // Pretend we're coming from testing phase for an already-done session
      useSelfDriveStore.setState({ currentPhase: "testing", currentSessionIndex: 1 });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        // Should NOT pause — session is already done
        expect(useSelfDriveStore.getState().status).toBe("running");
        // Should advance to next session
        expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
      });
    });

    it("toggles verify checks from orchestrator checkResults with evidence", async () => {
      setupReadyState();

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "All pass",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:5 — `export const a = 1`" },
          { label: "Check B", passed: true, evidence: "src/b.ts:7 — `export const b = 2`" },
        ],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        const guide = useGuideStore.getState().guide!;
        const session1 = guide.sessions[0];
        expect(session1.verifyChecks[0].checked).toBe(true);
        expect(session1.verifyChecks[1].checked).toBe(true);
        expect(session1.status).toBe("done");
      });
    });

    // H2 regression — skipped items advance cleanly.
    // Before the fix, an orchestrator that returned one check as
    // { passed:false, skipped:true } (e.g. optional integration test,
    // no credentials) left the check unticked, which tripped the
    // "stillUnchecked > 0" gate and paused forever. Now skipped items
    // are treated as satisfied.
    it("accepts skipped:true items as satisfied and advances without looping (H2)", async () => {
      setupReadyState();

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "1 check skipped; others pass",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:5 — `export const a = 1`" },
          { label: "Check B", passed: false, skipped: true, reason: "optional — no credentials available" },
        ],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        // Session 1 should be done, Session 2 should be active.
        expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
      });
      const guide = useGuideStore.getState().guide!;
      expect(guide.sessions[0].verifyChecks[0].checked).toBe(true);
      expect(guide.sessions[0].verifyChecks[1].checked).toBe(true);
      expect(guide.sessions[0].status).toBe("done");
      expect(useSelfDriveStore.getState().status).toBe("running");
    });

    // H3 regression — matched-but-failed items auto-request a recheck
    // instead of pausing immediately. Previously only unmatched labels
    // could trigger recheck, so a matched passed:false item skipped
    // straight to pause with no automation recovery.
    it("auto-requests a recheck when the orchestrator emits advance with a matched-but-failed item (H3)", async () => {
      setupReadyState();

      // First orchestrator call: advance with one item passed:false (not
      // skipped, not unmatched). Should trigger recheck, not immediate pause.
      mockCallOrchestrator.mockResolvedValueOnce({
        action: "advance",
        summary: "One item failed",
        confidence: "medium",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:5 — `ok`" },
          { label: "Check B", passed: false, reason: "evidence missing" },
        ],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().currentPhase).toBe("rechecking");
      });

      // Recheck counters advanced — one eligible item.
      const state = useSelfDriveStore.getState();
      expect(state.recheckRoundsUsed).toBe(1);
      expect(state.rechecksPerItem["Check B"]).toBe(1);
      // Did NOT pause.
      expect(state.status).toBe("running");
    });

    // H2 log — skipped items render as SKIP in the summary, not FAIL.
    it("renders skipped items as SKIP in the advance log (H2 cosmetic)", async () => {
      setupReadyState();

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Mix of pass and skip",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:5 — `ok`" },
          { label: "Check B", passed: false, skipped: true, reason: "optional" },
        ],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
      });

      const log = useSelfDriveStore.getState().runLog;
      const advancingEntry = log.find(
        (e) => e.phase === "advancing" && e.summary.includes("SKIP: Check B"),
      );
      expect(advancingEntry).toBeDefined();
    });
  });

  // ── Session transitions ─────────────────────────────────────────

  describe("session transitions", () => {
    it("advances to next session after completing current one", async () => {
      setupReadyState();
      const guide = makeGuide();
      guide.sessions[0].verifyChecks[0].checked = true;
      guide.sessions[0].verifyChecks[1].checked = true;
      useGuideStore.setState({ guide });

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Session 1 complete",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
          { label: "Check B", passed: true, evidence: "src/b.ts:1 — `y`" },
        ],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
        expect(useSelfDriveStore.getState().currentPhase).toBe("building");
      });

      // Session 2 prompt should be sent (wrapped in BUILD_MODE preamble)
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("Build features."),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("BUILD MODE"),
      );

      // Guide state: session 1 done, session 2 active
      const updatedGuide = useGuideStore.getState().guide!;
      expect(updatedGuide.sessions[0].status).toBe("done");
      expect(updatedGuide.sessions[1].status).toBe("active");
      expect(updatedGuide.sessions[2].status).toBe("pending");
    });

    it("completes when all sessions are done", async () => {
      setupReadyState();
      // Set up guide with sessions 1,2 done, session 3 active with check passed
      const guide = makeGuide();
      guide.sessions[0].status = "done";
      guide.sessions[0].verifyChecks.forEach((c) => (c.checked = true));
      guide.sessions[1].status = "done";
      guide.sessions[1].verifyChecks.forEach((c) => (c.checked = true));
      guide.sessions[2].status = "active";
      guide.sessions[2].verifyChecks[0].checked = true;
      useGuideStore.setState({ guide });

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "Last session done",
        confidence: "high",
        checkResults: [{ label: "Polish check", passed: true, evidence: "src/c.ts:1 — `polish`" }],
      });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.setState({ currentSessionIndex: 3, currentPhase: "verifying" });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().status).toBe("completed");
        expect(useSelfDriveStore.getState().currentPhase).toBeNull();
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Self-Drive complete"),
        "success",
      );
    });
  });

  // ── Fix attempts ────────────────────────────────────────────────

  describe("fix attempt tracking", () => {
    it("increments fix attempts on each fix", async () => {
      setupReadyState();
      mockCallOrchestrator.mockResolvedValue({
        action: "fix",
        fixPrompt: "Fix error X",
        summary: "Fixing error",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      emit(makeTurnCompleteEvent());
      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().fixAttempt).toBe(1);
      });

      // Second fix
      mockCallOrchestrator.mockResolvedValue({
        action: "fix",
        fixPrompt: "Fix error Y",
        summary: "Still fixing",
        confidence: "high",
      });

      emit(makeTurnCompleteEvent());
      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().fixAttempt).toBe(2);
      });
    });

    it("pauses when max fix attempts exceeded", async () => {
      setupReadyState();

      mockCallOrchestrator.mockResolvedValue({
        action: "fix",
        fixPrompt: "One more fix",
        summary: "Trying again",
        confidence: "high",
      });

      await useSelfDriveStore.getState().start();

      // Set fixAttempt to max AFTER start (which resets it to 0)
      useSelfDriveStore.setState({ fixAttempt: 3, maxFixAttempts: 3 });

      const emit = captureListenCallback();
      emit(makeTurnCompleteEvent());

      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().status).toBe("paused");
        expect(useSelfDriveStore.getState().pauseReason).toContain("Max fix attempts");
      });
    });
  });

  // ── Stop / Pause ───────────────────────────────────────────────

  describe("stop and pause", () => {
    it("stop resets state and restores session mode", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();

      await useSelfDriveStore.getState().stop();

      expect(useSelfDriveStore.getState().status).toBe("idle");
      expect(useSelfDriveStore.getState().currentPhase).toBeNull();
      expect(useSelfDriveStore.getState().currentSessionIndex).toBeNull();
      // Mode should be restored to "normal"
      expect(mockSyncSessionMode).toHaveBeenCalledWith(SESSION_ID, "normal");
    });

    it("pause sets status to paused with reason", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();

      useSelfDriveStore.getState().pause();

      expect(useSelfDriveStore.getState().status).toBe("paused");
      expect(useSelfDriveStore.getState().pauseReason).toBe("Paused by user");
    });

    it("ignores turn_complete events when not running", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      const emit = captureListenCallback();

      // Pause first
      useSelfDriveStore.getState().pause();

      // Simulate event while paused
      emit(makeTurnCompleteEvent());

      // Orchestrator should NOT be called
      expect(mockCallOrchestrator).not.toHaveBeenCalled();
    });
  });

  // ── Resume ────────────────────────────────────────────────────

  describe("resume", () => {
    it("re-registers listeners on resume", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();
      useSelfDriveStore.getState().pause();

      mockListen.mockClear();
      await useSelfDriveStore.getState().resume();

      // Should re-register listener on correct channel
      const listenCalls = mockListen.mock.calls.map((c) => c[0]);
      expect(listenCalls).toContain(`claude-chat-${SESSION_ID}`);
    });

    it("resume sends build check when promptSent=true but verifyRequested=false", async () => {
      setupReadyState();
      // Mark session as having received prompt but not yet verified
      const guide = useGuideStore.getState().guide!;
      guide.sessions[0].promptSent = true;
      guide.sessions[0].verifyRequested = false;
      useGuideStore.setState({ guide: { ...guide } });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.getState().pause();

      mockSendMessage.mockClear();
      await useSelfDriveStore.getState().resume();

      // Should send build check, not verification
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("tsc --noEmit"),
      );
      expect(mockBuildSessionVerifyPrompt).not.toHaveBeenCalled();
    });

    it("resume sends verify when verifyRequested=true", async () => {
      setupReadyState();
      // Mark session as having received both prompt and verify
      const guide = useGuideStore.getState().guide!;
      guide.sessions[0].promptSent = true;
      guide.sessions[0].verifyRequested = true;
      useGuideStore.setState({ guide: { ...guide } });

      await useSelfDriveStore.getState().start();
      useSelfDriveStore.getState().pause();

      mockBuildSessionVerifyPrompt.mockClear();
      await useSelfDriveStore.getState().resume();

      // Should call verification
      expect(mockBuildSessionVerifyPrompt).toHaveBeenCalled();
    });

    it("resume sends creation prompt when promptSent=false", async () => {
      setupReadyState();

      // Simulate: start() failed to send the prompt (sendMessage threw),
      // so promptSent stayed false and Self-Drive paused itself.
      mockSendMessage.mockRejectedValueOnce(new Error("send failed"));
      await useSelfDriveStore.getState().start();

      // start() should have paused due to the send failure
      expect(useSelfDriveStore.getState().status).toBe("paused");
      // promptSent should still be false
      expect(useGuideStore.getState().guide!.sessions[0].promptSent).toBe(false);

      mockSendMessage.mockClear();
      mockSendMessage.mockResolvedValue(undefined);
      await useSelfDriveStore.getState().resume();

      // Should send the creation prompt (wrapped in BUILD_MODE preamble)
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("Build foundation."),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("BUILD MODE"),
      );
      // Should set phase to building
      expect(useSelfDriveStore.getState().currentPhase).toBe("building");
    });

    it("resume does not jump to verify when paused during fixing phase pre-verify", async () => {
      setupReadyState();
      const guide = useGuideStore.getState().guide!;
      guide.sessions[0].promptSent = true;
      guide.sessions[0].verifyRequested = false;
      useGuideStore.setState({ guide: { ...guide } });

      await useSelfDriveStore.getState().start();
      // Simulate being in fixing phase (from a build failure, not verify failure)
      useSelfDriveStore.setState({ currentPhase: "fixing" });
      useSelfDriveStore.getState().pause();

      mockBuildSessionVerifyPrompt.mockClear();
      await useSelfDriveStore.getState().resume();

      // Should NOT call verification — we haven't passed build check yet
      expect(mockBuildSessionVerifyPrompt).not.toHaveBeenCalled();
    });
  });

  // ── Run log ────────────────────────────────────────────────────

  describe("run log", () => {
    it("logs entries for each phase transition", async () => {
      setupReadyState();
      await useSelfDriveStore.getState().start();

      const log = useSelfDriveStore.getState().runLog;
      expect(log.length).toBeGreaterThanOrEqual(2);
      expect(log.some((e) => e.phase === "started")).toBe(true);
      expect(log.some((e) => e.phase === "building")).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration: Full Self-Drive lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore integration — full lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("completes build → build_check → verify → advance → next session flow", async () => {
    setupReadyState();

    // Step 1: Start — orchestrator will be called after each turn_complete
    let orchestratorCallCount = 0;
    mockCallOrchestrator.mockImplementation(async (input) => {
      orchestratorCallCount++;
      switch (input.currentPhase) {
        case "building":
          return { action: "build_check", summary: "Build done, checking types", confidence: "high" };
        case "build-checking":
          return { action: "verify", summary: "Build clean, verifying", confidence: "high" };
        case "verifying":
          return {
            action: "advance",
            summary: "All checks pass",
            confidence: "high",
            checkResults: [
              { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
              { label: "Check B", passed: true, evidence: "src/b.ts:1 — `y`" },
            ],
          };
        default:
          return { action: "pause", summary: "Unexpected phase", confidence: "low" };
      }
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Verify initial state
    expect(useSelfDriveStore.getState().currentPhase).toBe("building");
    expect(useSelfDriveStore.getState().currentSessionIndex).toBe(1);

    // Step 2: Building complete → orchestrator says build_check
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentPhase).toBe("build-checking");
    });

    // Step 3: Build check complete → orchestrator says verify
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentPhase).toBe("verifying");
    });

    // Step 4: Verify complete → orchestrator says advance → next session
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
      expect(useSelfDriveStore.getState().currentPhase).toBe("building");
    });

    // Verify session 1 is done, session 2 is active
    const guide = useGuideStore.getState().guide!;
    expect(guide.sessions[0].status).toBe("done");
    expect(guide.sessions[1].status).toBe("active");
    expect(orchestratorCallCount).toBe(3);
  });

  it("handles build → verify → fix → verify → advance cycle", async () => {
    setupReadyState();

    let callIndex = 0;
    mockCallOrchestrator.mockImplementation(async (input) => {
      callIndex++;
      if (input.currentPhase === "building") {
        return { action: "verify", summary: "Checking", confidence: "high" };
      }
      if (input.currentPhase === "verifying" && callIndex <= 2) {
        return {
          action: "fix",
          fixPrompt: "Fix the missing import",
          summary: "Verify failed",
          confidence: "high",
        };
      }
      if (input.currentPhase === "fixing") {
        return { action: "verify", summary: "Re-verifying", confidence: "high" };
      }
      // Second verify succeeds
      return {
        action: "advance",
        summary: "All pass now",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
          { label: "Check B", passed: true, evidence: "src/b.ts:1 — `y`" },
        ],
      };
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Build complete → verify
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentPhase).toBe("verifying"));

    // Verify fails → fix
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentPhase).toBe("fixing"));
    expect(useSelfDriveStore.getState().fixAttempt).toBe(1);

    // Fix done → verify again
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentPhase).toBe("verifying"));

    // Verify passes → advance to session 2
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
      expect(useSelfDriveStore.getState().fixAttempt).toBe(0); // reset for new session
    });
  });

  it("advance → test → commit → next session flow (no infinite loop)", async () => {
    setupReadyState();
    // Enable both tests and commits
    useSettingsStore.setState((prev) => ({
      settings: { ...prev.settings, selfDriveRunTests: true, selfDriveAutoCommit: true },
    }));
    // Pre-check session 1 checks
    const guide = makeGuide();
    guide.sessions[0].verifyChecks[0].checked = true;
    guide.sessions[0].verifyChecks[1].checked = true;
    useGuideStore.setState({ guide });

    mockCallOrchestrator.mockImplementation(async (input) => {
      switch (input.currentPhase) {
        case "building":
          return { action: "verify", summary: "Build done", confidence: "high" };
        case "verifying":
          return {
            action: "advance",
            summary: "All pass",
            confidence: "high",
            checkResults: [
              { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
              { label: "Check B", passed: true, evidence: "src/b.ts:1 — `y`" },
            ],
          };
        case "testing":
          return { action: "advance", summary: "Tests pass", confidence: "high" };
        case "committing":
          return { action: "advance", summary: "Committed", confidence: "high" };
        default:
          return { action: "pause", summary: "Unexpected", confidence: "low" };
      }
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Build → verify
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentPhase).toBe("verifying"));

    // Verify → advance → testing (phase guard allows tests from verifying)
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentPhase).toBe("testing"));

    // Testing → advance → committing (phase guard skips tests, allows commit)
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentPhase).toBe("committing"));

    // Committing → advance → next session (phase guard skips both tests and commit)
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2);
      expect(useSelfDriveStore.getState().currentPhase).toBe("building");
    });

    // Verify we did NOT loop back to testing or committing
    const phases = useSelfDriveStore.getState().runLog.map((e) => e.phase);
    const testPhaseCount = phases.filter((p) => p === "testing").length;
    const commitPhaseCount = phases.filter((p) => p === "committing").length;
    expect(testPhaseCount).toBe(1);
    expect(commitPhaseCount).toBe(1);
  });

  it("completes entire guide (3 sessions) end-to-end", async () => {
    setupReadyState();

    // Simple flow: each session goes build → advance
    mockCallOrchestrator.mockImplementation(async (input) => {
      if (input.currentPhase === "building") {
        return {
          action: "advance",
          summary: "Session done",
          confidence: "high",
          checkResults: input.sessionPlan.verifyChecks.map((c) => ({
            label: c.label,
            passed: true,
          })),
        };
      }
      return { action: "pause", summary: "Unexpected", confidence: "low" };
    });

    // Pre-check all verify checks so markSessionComplete succeeds
    const guide = makeGuide();
    for (const session of guide.sessions) {
      for (const check of session.verifyChecks) {
        check.checked = true;
      }
    }
    useGuideStore.setState({ guide });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Session 1 → advance to session 2
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentSessionIndex).toBe(2));

    // Session 2 → advance to session 3
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().currentSessionIndex).toBe(3));

    // Session 3 → all done!
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("completed");
      expect(useSelfDriveStore.getState().currentPhase).toBeNull();
    });

    // Verify all sessions are done
    const finalGuide = useGuideStore.getState().guide!;
    expect(finalGuide.sessions.every((s) => s.status === "done")).toBe(true);
    expect(finalGuide.status).toBe("completed");

    // Verify mode was restored
    expect(mockSyncSessionMode).toHaveBeenLastCalledWith(SESSION_ID, "normal");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Low-confidence handling
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — low-confidence handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("low-confidence fix action proceeds without pausing", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValue({
      action: "fix",
      fixPrompt: "Fix something",
      summary: "Unsure fix",
      confidence: "low",
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      // Should proceed to fixing, not pause
      expect(useSelfDriveStore.getState().currentPhase).toBe("fixing");
      expect(useSelfDriveStore.getState().status).toBe("running");
      expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(1);
    });
  });

  it("low-confidence advance action pauses immediately", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValue({
      action: "advance",
      summary: "Maybe done",
      confidence: "low",
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "verifying" });
    const emit = captureListenCallback();

    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("paused");
      expect(useSelfDriveStore.getState().pauseReason).toContain("advance");
    });
  });

  it("3 consecutive low-confidence decisions trigger pause", async () => {
    setupReadyState();

    let callCount = 0;
    mockCallOrchestrator.mockImplementation(async () => {
      callCount++;
      return {
        action: "build_check",
        summary: `Low confidence call ${callCount}`,
        confidence: "low",
      };
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // First low-confidence: proceeds
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(1));

    // Second low-confidence: proceeds
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(2));

    // Third low-confidence: pauses
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("paused");
      expect(useSelfDriveStore.getState().pauseReason).toContain("3 consecutive");
    });
  });

  it("non-low-confidence decision resets counter", async () => {
    setupReadyState();

    let callCount = 0;
    mockCallOrchestrator.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { action: "build_check", summary: "Low", confidence: "low" };
      }
      return { action: "verify", summary: "High confidence", confidence: "high" };
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Two low-confidence calls
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(1));

    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(2));

    // High-confidence call resets counter
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(0));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Prompt logging in run log
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — prompt logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("building log entry includes the session prompt", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    const buildEntry = useSelfDriveStore.getState().runLog.find(
      (e) => e.phase === "building",
    );
    expect(buildEntry).toBeDefined();
    expect(buildEntry!.prompt).toBe("Build foundation.");
  });

  it("fix log entry includes the fix prompt", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValue({
      action: "fix",
      fixPrompt: "Fix the TypeScript errors in src/main.ts",
      summary: "Fixing errors",
      confidence: "high",
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      const fixEntry = useSelfDriveStore.getState().runLog.find(
        (e) => e.phase === "fixing",
      );
      expect(fixEntry).toBeDefined();
      expect(fixEntry!.prompt).toBe("Fix the TypeScript errors in src/main.ts");
    });
  });

  it("verify log entry includes the verify prompt", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValue({
      action: "verify",
      summary: "Build clean",
      confidence: "high",
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      const verifyEntry = useSelfDriveStore.getState().runLog.find(
        (e) => e.phase === "verifying",
      );
      expect(verifyEntry).toBeDefined();
      expect(verifyEntry!.prompt).toBeDefined();
      expect(verifyEntry!.prompt).toBe("Verify session prompt");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Decision message injection
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — decision message injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("injects a selfDriveEvent message into the session after orchestrator decision", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValue({
      action: "verify",
      summary: "Build clean. Proceeding to verification.",
      confidence: "high",
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
      const sdMessage = messages.find((m) => m.selfDriveEvent !== undefined);
      expect(sdMessage).toBeDefined();
      expect(sdMessage!.selfDriveEvent!.action).toBe("verify");
      expect(sdMessage!.selfDriveEvent!.summary).toBe("Build clean. Proceeding to verification.");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Pause/Stop reliability
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — pause/stop reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("pause prevents handleTurnComplete from calling orchestrator", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Pause
    useSelfDriveStore.getState().pause();
    expect(useSelfDriveStore.getState().status).toBe("paused");

    // Emit turn_complete while paused
    mockCallOrchestrator.mockClear();
    emit(makeTurnCompleteEvent());

    // Give async handler time to run (it should bail early)
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCallOrchestrator).not.toHaveBeenCalled();
  });

  it("stop resets state to idle with null phase and session index", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().status).toBe("running");
    expect(useSelfDriveStore.getState().currentPhase).toBe("building");

    await useSelfDriveStore.getState().stop();

    expect(useSelfDriveStore.getState().status).toBe("idle");
    expect(useSelfDriveStore.getState().currentPhase).toBeNull();
    expect(useSelfDriveStore.getState().currentSessionIndex).toBeNull();
    expect(useSelfDriveStore.getState().pauseReason).toBeNull();
  });

  it("stop restores original session mode", async () => {
    setupReadyState();
    // Set initial mode to "plan"
    useSessionStore.getState().setSessionMode(SESSION_ID, "plan");
    // Start will save "plan" as previousSessionMode
    useSelfDriveStore.setState({ previousSessionMode: null });
    await useSelfDriveStore.getState().start();

    await useSelfDriveStore.getState().stop();

    // Should restore mode — the last call to syncSessionMode should be restoring
    const calls = mockSyncSessionMode.mock.calls as unknown as string[][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0]).toBe(SESSION_ID);
  });

  it("status re-check guard discards late orchestrator decisions after pause", async () => {
    setupReadyState();

    // Make orchestrator slow — it resolves after we pause
    let resolveOrchestrator: ((value: OrchestratorDecision) => void) | null = null;
    mockCallOrchestrator.mockImplementation(() => new Promise<OrchestratorDecision>((resolve) => {
      resolveOrchestrator = resolve;
    }));

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Trigger turn_complete — orchestrator starts awaiting
    emit(makeTurnCompleteEvent());

    // Wait for evaluating phase
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentPhase).toBe("evaluating");
    });

    // Pause while orchestrator is still pending
    useSelfDriveStore.getState().pause();
    expect(useSelfDriveStore.getState().status).toBe("paused");

    // Now resolve the orchestrator — decision should be discarded
    resolveOrchestrator!({
      action: "advance",
      summary: "This should be discarded",
      confidence: "high",
    });

    // Wait for the async handler to process
    await new Promise((r) => setTimeout(r, 100));

    // Should still be paused, not have advanced
    expect(useSelfDriveStore.getState().status).toBe("paused");

    // The run log should contain a "discarded" entry
    const log = useSelfDriveStore.getState().runLog;
    const discardedEntry = log.find((e) => e.summary.includes("discarded"));
    expect(discardedEntry).toBeDefined();
  });

  it("pause then resume re-registers listeners", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    useSelfDriveStore.getState().pause();

    mockListen.mockClear();
    await useSelfDriveStore.getState().resume();

    // Should have re-registered listener
    expect(mockListen).toHaveBeenCalledWith(
      `claude-chat-${SESSION_ID}`,
      expect.any(Function),
    );
  });

  it("lowConfidenceCount is reset on start", async () => {
    setupReadyState();
    useSelfDriveStore.setState({ lowConfidenceCount: 5 });

    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().lowConfidenceCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Orchestrator retry on parse failure
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — orchestrator retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("retries once on parse failure then uses second result", async () => {
    setupReadyState();

    let callCount = 0;
    mockCallOrchestrator.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          action: "pause",
          pauseReason: "Could not parse AI response: No JSON object found",
          summary: "Parse error — pausing",
          confidence: "low",
        };
      }
      return {
        action: "verify",
        summary: "Build clean, verifying",
        confidence: "high",
      };
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      // Second call should succeed — should be in verifying phase
      expect(useSelfDriveStore.getState().currentPhase).toBe("verifying");
      expect(callCount).toBe(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Project-scoping isolation
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — project isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("start() captures projectPath from session store", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().projectPath).toBe("/test");
    expect(useSelfDriveStore.getState().status).toBe("running");
  });

  it("start() rejects if Self-Drive is already running for another project", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    // Switch to a different project
    useSessionStore.setState({
      activeSessionId: "session-xyz",
      activeProjectPath: "/other-project",
      projectActiveSession: new Map([
        ["/test", SESSION_ID],
        ["/other-project", "session-xyz"],
      ]),
    });

    // Try to start Self-Drive again — should be rejected
    await useSelfDriveStore.getState().start();

    expect(mockShowToast).toHaveBeenCalledWith(
      "Self-Drive is already running for another project. Stop it first.",
      "error",
    );
    // Should still be running for the original project
    expect(useSelfDriveStore.getState().projectPath).toBe("/test");
  });

  it("stop() resets projectPath to null", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().projectPath).toBe("/test");

    await useSelfDriveStore.getState().stop();

    expect(useSelfDriveStore.getState().projectPath).toBeNull();
    expect(useSelfDriveStore.getState().status).toBe("idle");
  });

  it("resume() uses Self-Drive project's session, not globally active one", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    useSelfDriveStore.getState().pause();
    expect(useSelfDriveStore.getState().status).toBe("paused");

    // Simulate user switching to a different project
    useSessionStore.setState({
      activeSessionId: "session-xyz",
      activeProjectPath: "/other-project",
      projectActiveSession: new Map([
        ["/test", SESSION_ID],
        ["/other-project", "session-xyz"],
      ]),
    });

    mockListen.mockClear();
    await useSelfDriveStore.getState().resume();

    // Should resume using the ORIGINAL project's session, not the active one
    expect(mockListen).toHaveBeenCalledWith(
      `claude-chat-${SESSION_ID}`,
      expect.any(Function),
    );
    expect(useSelfDriveStore.getState().status).toBe("running");
  });

  it("KEEPS RUNNING when the UI's guide store flips to a different project mid-run", async () => {
    // Regression: Self-Drive USED to pause with "Project switched" when
    // useGuideStore.guide.projectPath stopped matching state.projectPath.
    // That broke the core UX requirement: users expect Self-Drive to keep
    // executing on its own project regardless of which tab they view.
    // The fix pinned the guide into Self-Drive's own state (state.guide),
    // so UI navigation no longer affects the run.
    setupReadyState();

    mockCallOrchestrator.mockResolvedValue({
      action: "verify",
      summary: "Verifying",
      confidence: "high",
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // User navigates to a different project — guideStore reloads to that
    // project's guide. This must NOT affect Self-Drive.
    useGuideStore.setState({
      guide: makeGuide({ projectPath: "/other-project" }),
    });

    emit(makeTurnCompleteEvent());

    // Self-Drive continues running on its pinned guide.
    await vi.waitFor(() => {
      // Orchestrator was still consulted — Self-Drive processed the turn.
      expect(mockCallOrchestrator).toHaveBeenCalled();
    });
    expect(useSelfDriveStore.getState().status).not.toBe("paused");
    // Pinned guide still belongs to the original project.
    expect(useSelfDriveStore.getState().guide?.projectPath).toBe("/test");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Self-Drive prompts visible in chat
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — prompt visibility in chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("start() adds the build prompt as a user message to the session", async () => {
    setupReadyState();
    await useSelfDriveStore.getState().start();

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    const userMessages = messages.filter((m) => m.role === "user");

    // Should have at least one user message with the build prompt.
    // The chat-visible content is the wrapped prompt — preamble first,
    // then the session prompt — so assert both pieces are present.
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    const lastUserContent = userMessages[userMessages.length - 1].content;
    expect(lastUserContent).toContain("Build foundation.");
    expect(lastUserContent).toContain("BUILD MODE");
  });

  it("sendMessageToSession adds prompt as user message before sending", async () => {
    setupReadyState();

    mockCallOrchestrator.mockResolvedValue({
      action: "verify",
      summary: "Build done, verifying",
      confidence: "high",
    });

    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Trigger a turn_complete to cause orchestrator to call verify → sendMessageToSession
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentPhase).toBe("verifying");
    });

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    const userMessages = messages.filter((m) => m.role === "user");

    // Should have the verify prompt added as a user message
    expect(userMessages.length).toBeGreaterThanOrEqual(2); // build prompt + verify prompt
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Auto-commit uses live settings
// ═══════════════════════════════════════════════════════════════════════

describe("selfDriveStore — auto-commit live config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("handleAdvance reads autoCommit from live settings, not cached config", async () => {
    setupReadyState();
    // Pre-mark session 1's verify checks so markSessionComplete succeeds.
    // This test simulates a post-verify advance (checks already confirmed)
    // and isolates the autoCommit live-read behavior.
    const guide = useGuideStore.getState().guide!;
    guide.sessions[0].verifyChecks.forEach((c) => (c.checked = true));
    useGuideStore.setState({ guide });

    // Start with autoCommit OFF
    await useSelfDriveStore.getState().start();
    const emit = captureListenCallback();

    // Cached config has autoCommit: false (from setupReadyState settings)
    expect(useSelfDriveStore.getState().config.autoCommit).toBe(false);

    // Enable autoCommit in settings mid-run
    useSettingsStore.setState((prev) => ({
      settings: { ...prev.settings, selfDriveAutoCommit: true },
    }));

    // Make orchestrator advance → triggers handleAdvance.
    // previousPhase is "building" (from start), so the verify-gate is not
    // invoked — this path exercises the post-test/post-commit advance flow.
    mockCallOrchestrator.mockResolvedValue({
      action: "advance",
      summary: "Session complete",
      confidence: "high",
      checkResults: [],
    });

    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      // Should have sent a commit prompt (phase should be "committing")
      expect(useSelfDriveStore.getState().currentPhase).toBe("committing");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fuzzyLabelMatch + assessVerifyAdvance — the (minimal) client-side gate
//
// The client no longer second-guesses the orchestrator's evidence-format
// judgement (no substring grep for ":", "$ ", "mocks=", "caller=", etc.).
// These tests cover the only things the client still gates on:
//   1. Fuzzy label matching (tolerate whitespace/punct/abbreviation drift).
//   2. Structural integrity (empty verdict, ≥50% fabricated labels, no
//      passed:true on an advance).
// Everything else goes through as a warning and does NOT block.
// ═══════════════════════════════════════════════════════════════════════════

describe("fuzzyLabelMatch", () => {
  it("matches identical labels", () => {
    const r = fuzzyLabelMatch(["A", "B"], ["A", "B"]);
    expect(r.matched.get("A")).toBe("A");
    expect(r.matched.get("B")).toBe("B");
    expect(r.unmatchedSessionLabels).toEqual([]);
    expect(r.unmatchedResultLabels).toEqual([]);
  });

  it("matches when the result strips a leading [kind] prefix", () => {
    const r = fuzzyLabelMatch(
      ["All helper files exist"],
      ["[behavioral] All helper files exist"],
    );
    expect(r.matched.size).toBe(1);
    expect(r.unmatchedSessionLabels).toEqual([]);
  });

  it("matches when the orchestrator dropped a trailing parenthetical", () => {
    const r = fuzzyLabelMatch(
      ["NOT: any helper imports from `pipeline/` (helpers must stay leaf modules)"],
      ["NOT: any helper imports from pipeline/"],
    );
    expect(r.matched.size).toBe(1);
  });

  it("matches when whitespace and punctuation edges differ", () => {
    const r = fuzzyLabelMatch(
      ["  Pytest passes for `src/helpers/` directory "],
      ["Pytest passes for src/helpers/ directory."],
    );
    expect(r.matched.size).toBe(1);
  });

  it("tolerates small typos within the Levenshtein budget", () => {
    // 'boundray' → 'boundary' is 2 edits over 32 chars = 6% — under 20%.
    const r = fuzzyLabelMatch(
      ["No boundary crossing in this check"],
      ["No boundray crossing in this check"],
    );
    expect(r.matched.size).toBe(1);
  });

  it("does NOT match when the labels are semantically different", () => {
    const r = fuzzyLabelMatch(
      ["All helper files exist"],
      ["Database migrations applied"],
    );
    expect(r.matched.size).toBe(0);
    expect(r.unmatchedSessionLabels).toEqual(["All helper files exist"]);
    expect(r.unmatchedResultLabels).toEqual(["Database migrations applied"]);
  });

  it("pairs each result with at most one session label (no double-matching)", () => {
    const r = fuzzyLabelMatch(
      ["Item A", "Item A variant"],
      ["Item A"],
    );
    // Exact match wins first; the variant stays unmatched.
    expect(r.matched.get("Item A")).toBe("Item A");
    expect(r.unmatchedSessionLabels).toContain("Item A variant");
  });
});

describe("assessVerifyAdvance — structural-only gate", () => {
  const session = {
    verifyChecks: [
      { label: "Check A", kind: "static" as const },
      { label: "Check B", kind: "behavioral" as const },
    ],
  };

  function makeDecision(overrides: Partial<OrchestratorDecision>): OrchestratorDecision {
    return {
      action: "advance",
      summary: "ok",
      confidence: "high",
      ...overrides,
    };
  }

  it("accepts any non-empty evidence shape — no substring format gates", () => {
    // The old validator rejected every one of these; the new one accepts
    // them all because shape is the orchestrator's call now.
    const shapes = [
      "files look fine",                               // no `:` (old static reject)
      "Grep for X → No matches",                       // no `:` (old static reject)
      "$ pytest → 31 passed",                          // no mocks= (old behavioral reject)
      "src/a.ts — function foo",                       // no `:` (old static reject)
      "✓ does the thing · mocks=httpClient",           // boundary mock no [integration]
    ];
    for (const evidence of shapes) {
      const decision = makeDecision({
        checkResults: [
          { label: "Check A", passed: true, evidence },
          { label: "Check B", passed: true, evidence },
        ],
      });
      const a = assessVerifyAdvance(session, decision);
      expect(a.structuralError, `evidence: ${evidence}`).toBeNull();
    }
  });

  it("blocks on empty checkResults with advance action", () => {
    const decision = makeDecision({ checkResults: [] });
    const a = assessVerifyAdvance(session, decision);
    expect(a.structuralError).toMatch(/no checkResults/i);
  });

  it("blocks when ≥50% of session labels have no match in the verdict", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Completely Unrelated", passed: true, evidence: "x" },
      ],
    });
    const a = assessVerifyAdvance(session, decision);
    expect(a.structuralError).toMatch(/session labels have no match/i);
  });

  it("blocks when no checkResult is passed:true or skipped:true on an advance", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: false, reason: "x" },
        { label: "Check B", passed: false, reason: "y" },
      ],
    });
    const a = assessVerifyAdvance(session, decision);
    expect(a.structuralError).toMatch(/no checkResults entry is passed:true or skipped:true/i);
  });

  it("accepts an all-skipped verdict as structurally valid (skipped counts as satisfied)", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: false, skipped: true, reason: "optional, no creds" },
        { label: "Check B", passed: false, skipped: true, reason: "optional, no creds" },
      ],
    });
    const a = assessVerifyAdvance(session, decision);
    expect(a.structuralError).toBeNull();
  });

  it("emits advisory warnings for fuzzy-matched drift — does NOT block", () => {
    // 1 result label differs slightly (drops parenthetical) but fuzzy-matches.
    const s = {
      verifyChecks: [
        { label: "Check A", kind: "static" as const },
        { label: "Check B (with parenthetical)", kind: "behavioral" as const },
      ],
    };
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true, evidence: "x" },
        { label: "Check B", passed: true, evidence: "y" },
      ],
    });
    const a = assessVerifyAdvance(s, decision);
    expect(a.structuralError).toBeNull();
    expect(a.warnings.length).toBeGreaterThan(0);
    expect(a.matchedResults.get("Check B (with parenthetical)")?.label).toBe("Check B");
  });

  it("Session 4 regression: 5/5 PASS with 1 label drift + 1 weird-shape + 1 boundary mock — advances cleanly", () => {
    // The exact pattern the user hit repeatedly. Before this rewrite,
    // validateVerifyAdvance paused with:
    //   "1 checks missing; 1 PASS entries lack file:line evidence;
    //    1 unknown labels; 1 [behavioral] PASS mocks a boundary ..."
    // After this rewrite: no structural issues → advances. Any remaining
    // concerns live in the run-log warnings.
    const s = {
      verifyChecks: [
        { label: "Both pipeline modules + both test files exist", kind: "behavioral" as const },
        { label: "Pytest passes for the two test files", kind: "behavioral" as const },
        { label: "All 3 worker actions used here have handlers in worker-data-read/index.ts (handshake parity by grep)", kind: "static" as const },
        { label: 'NOT: any function returns hardcoded fake data ("when LLM is wired up...")', kind: "static" as const },
        { label: "NOT: any soft-fail silently swallow a source file.", kind: "static" as const },
      ],
    };
    const decision = makeDecision({
      checkResults: [
        { label: "Both pipeline modules + both test files exist", passed: true, evidence: '$ pytest --collect-only → "39 tests collected in 0.03s" · mocks=none' },
        // LABEL DRIFT — verifier abbreviated; fuzzy matches.
        { label: "Pytest passes for the two test files", passed: true, evidence: '$ pytest ... → "39 passed in 0.05s" · mocks=get_api_client, ModelSelector (integration deferred to Phase 9 per spec)' },
        { label: "All 3 worker actions used here have handlers in worker-data-read/index.ts (handshake parity by grep)", passed: true, evidence: "worker-data-read/index.ts:1908, :1942, :1984" },
        { label: 'NOT: any function returns hardcoded fake data ("when LLM is wired up...")', passed: true, evidence: '$ grep -i -nE "fake|TODO|hardcoded" ... → "No matches found"' },
        // WEIRD SHAPE for the last one — no `:`, no `$ ` — used to be rejected.
        { label: "NOT: any soft-fail silently swallow a source file.", passed: true, evidence: "guide_session_planning.py lines 104-110 use selector.generate_with_fallback without try/except — provider errors propagate" },
      ],
    });
    const a = assessVerifyAdvance(s, decision);
    expect(a.structuralError).toBeNull();
    // All 5 session labels should have a matched result.
    expect(a.matchedResults.size).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// attemptMarkSessionComplete — the cross-system parity gate
//
// This is the primary defence against the "mocked tests green, handler
// missing" shipping pattern. No matter how many checks are ticked, a
// session that declared cross-system actions CANNOT be marked done if
// the Rust parity check reports any action unpaired.
// ─────────────────────────────────────────────────────────────────────

describe("attemptMarkSessionComplete — cross-system parity gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  function makeSession(overrides: {
    index: number;
    checks: { id: string; label: string; checked: boolean }[];
    status?: "pending" | "active" | "done";
    files?: string[];
    crossSystemActions?: { action: string; handler: string; wire?: string }[];
  }): ImplementationGuide["sessions"][number] {
    return {
      index: overrides.index,
      name: `Session ${overrides.index}`,
      scope: "",
      readSections: "",
      files: overrides.files ?? [],
      prompt: "",
      verifyChecks: overrides.checks,
      status: overrides.status ?? "active",
      promptSent: false,
      verifyRequested: false,
      crossSystemActions: overrides.crossSystemActions,
    };
  }

  function seed(guide: ImplementationGuide, projectPath = "/project"): void {
    useSelfDriveStore.setState({ guide, projectPath });
  }

  it("returns session-not-found when guide is absent", async () => {
    // resetStores doesn't touch selfDriveStore.guide (it's merged, not
    // replaced), so tests that depend on a null guide must clear it
    // explicitly.
    useSelfDriveStore.setState({ guide: null, projectPath: null });
    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome).toEqual({ ok: false, reason: "session-not-found" });
  });

  it("returns checks-incomplete when not all checks are ticked", async () => {
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [
              { id: "a", label: "A", checked: true },
              { id: "b", label: "B", checked: false },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toBe("checks-incomplete");
    expect(mockVerifyActionParity).not.toHaveBeenCalled();
  });

  it("succeeds without invoking parity when no cross-system actions are declared", async () => {
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "A", checked: true }],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(true);
    expect(mockVerifyActionParity).not.toHaveBeenCalled();

    const s1 = useSelfDriveStore.getState().guide!.sessions[0];
    expect(s1.status).toBe("done");
  });

  it("blocks completion when parity check reports FAIL — this is the incident fix", async () => {
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "insert_note_classification",
        callerPresent: true,
        handlerPresent: false,
        handlerStubFree: false,
        status: "FAIL",
        detail:
          "handler path 'worker-data-write/actions/notes.py' does not reference action 'insert_note_classification' — the other side of this call has not been implemented",
      },
    ]);

    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "caller + handler present", checked: true }],
            files: ["workers/notes/notes_write.py"],
            crossSystemActions: [
              {
                action: "insert_note_classification",
                handler: "worker-data-write/actions/notes.py",
              },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toBe("parity-failed");

    // Session stays "active" — NOT flipped to done.
    const s1 = useSelfDriveStore.getState().guide!.sessions[0];
    expect(s1.status).toBe("active");

    // Parity command was invoked with the declared action pair.
    expect(mockVerifyActionParity).toHaveBeenCalledTimes(1);
    const [passedRoot, passedActions] = mockVerifyActionParity.mock.calls[0];
    expect(passedRoot).toBe("/project");
    expect(passedActions).toHaveLength(1);
    expect(passedActions[0].action).toBe("insert_note_classification");
  });

  it("SKIPS the parity check on a handler-authoring session (handler file is in session files)", async () => {
    // Regression for the Session-3-style incident: when the session
    // IMPLEMENTS the handlers (adds action branches to worker-data-write),
    // callers don't exist yet. Running parity produces a wall of false
    // negatives because deriveCallerPath guesses wrong — it picks the
    // first file's directory, which might be a completely different
    // module (e.g. worker-data-read). The gate should skip entirely.
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "all 13 actions present", checked: true }],
            // Session modifies BOTH read and write; write is where the
            // handlers being authored live. files[0] is read/index.ts —
            // the exact ordering that broke deriveCallerPath in the wild.
            files: [
              "supabase/functions/worker-data-read/index.ts",
              "supabase/functions/worker-data-write/index.ts",
            ],
            crossSystemActions: [
              {
                action: "insert_implementation_guide",
                handler: "supabase/functions/worker-data-write/index.ts",
              },
              {
                action: "insert_guide_session",
                handler: "supabase/functions/worker-data-write/index.ts",
              },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(true);
    // Parity command must NOT have been invoked — this is the whole point.
    expect(mockVerifyActionParity).not.toHaveBeenCalled();
    expect(useSelfDriveStore.getState().guide!.sessions[0].status).toBe("done");
  });

  it("still runs parity on a CALLER session (handler file NOT in session files)", async () => {
    // Counterpart to the handler-authoring test — when the session is the
    // caller (handler lives in a different, not-yet-modified file), the
    // gate must still fire. This is the original "mock-only PASS" defence.
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "emit_audit_log",
        callerPresent: true,
        handlerPresent: false,
        handlerStubFree: false,
        status: "FAIL",
        detail: "handler missing",
      },
    ]);
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "caller writes log", checked: true }],
            // Caller side only — handler lives elsewhere.
            files: ["producers/audit.ts"],
            crossSystemActions: [
              { action: "emit_audit_log", handler: "services/audit/sink.ts" },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(false);
    expect(mockVerifyActionParity).toHaveBeenCalledTimes(1);
  });

  it("allows completion when parity check PASSes for all actions", async () => {
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "emit_audit_log",
        callerPresent: true,
        handlerPresent: true,
        handlerStubFree: true,
        status: "PASS",
        detail: "caller + handler both reference 'emit_audit_log'",
      },
    ]);

    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "paired", checked: true }],
            files: ["producers/audit.ts"],
            crossSystemActions: [
              { action: "emit_audit_log", handler: "services/audit/sink.ts" },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(true);
    expect(useSelfDriveStore.getState().guide!.sessions[0].status).toBe("done");
  });

  it("retries once on a parity invocation that throws, and returns 'parity-errored' (not 'parity-failed') after the second throw so the caller can distinguish check-broken from real parity FAIL", async () => {
    mockVerifyActionParity.mockRejectedValueOnce(new Error("rg binary missing"));
    mockVerifyActionParity.mockRejectedValueOnce(new Error("rg binary missing again"));

    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "paired", checked: true }],
            files: ["producers/audit.ts"],
            crossSystemActions: [
              { action: "emit_audit_log", handler: "services/audit/sink.ts" },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toBe("parity-errored");
    // Retried exactly once before giving up.
    expect(mockVerifyActionParity).toHaveBeenCalledTimes(2);
    const results = (outcome as { results: { status: string; detail: string }[] }).results;
    expect(results[0].status).toBe("FAIL");
    expect(results[0].detail).toMatch(/errored twice/i);
  });

  it("recovers when the first parity call throws but the retry succeeds (transient I/O)", async () => {
    mockVerifyActionParity.mockRejectedValueOnce(new Error("transient fs blip"));
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "emit_audit_log",
        callerPresent: true,
        handlerPresent: true,
        handlerStubFree: true,
        status: "PASS",
        detail: "OK",
      },
    ]);

    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "paired", checked: true }],
            files: ["producers/audit.ts"],
            crossSystemActions: [
              { action: "emit_audit_log", handler: "services/audit/sink.ts" },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(true);
    expect(mockVerifyActionParity).toHaveBeenCalledTimes(2);
  });

  it("with skipParityGate=true, completes the session even when parity would FAIL — manual user override", async () => {
    // The exact incident: rg-based parity scan can't reason about a
    // handler declared as "Postgres function in migration SQL" (or any
    // other non-source-code handler) and false-positives every time.
    // The user must always be able to mark a session complete by hand.
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "verified by hand", checked: true }],
            files: ["supabase/migrations/0042_twin.sql"],
            crossSystemActions: [
              {
                action: "twin_recompute_entity_importance()",
                handler: "Postgres function in migration SQL",
              },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1, { skipParityGate: true });
    expect(outcome.ok).toBe(true);
    // Critical: the parity check must NOT have run. Skipping the gate
    // means skipping the rg scan, not just ignoring its result.
    expect(mockVerifyActionParity).not.toHaveBeenCalled();
    expect(useSelfDriveStore.getState().guide!.sessions[0].status).toBe("done");

    // Audit trail: a "decision" log entry must record the bypass so the
    // user can see in the run log which completions were human-overridden.
    const log = useSelfDriveStore.getState().runLog;
    const bypass = log.find((e) => e.summary.includes("parity gate bypassed"));
    expect(bypass).toBeDefined();
    expect(bypass?.phase).toBe("decision");
  });

  it("default opts (skipParityGate omitted) still runs parity and blocks on FAIL — auto-advance regression guard", async () => {
    // handleAdvance() calls attemptMarkSessionComplete(idx) with no opts.
    // The "mocked tests green, handlers missing" guard MUST stay intact
    // for the unattended automation path — the bypass is only for the
    // explicit manual button click.
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "emit_audit_log",
        callerPresent: true,
        handlerPresent: false,
        handlerStubFree: false,
        status: "FAIL",
        detail: "handler missing — incident-pattern regression",
      },
    ]);
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "paired", checked: true }],
            files: ["producers/audit.ts"],
            crossSystemActions: [
              { action: "emit_audit_log", handler: "services/audit/sink.ts" },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toBe("parity-failed");
    expect(mockVerifyActionParity).toHaveBeenCalledTimes(1);
    expect(useSelfDriveStore.getState().guide!.sessions[0].status).toBe("active");
  });

  it("with skipParityGate=true, still rejects when verify checks are incomplete (UI gate is the real safeguard)", async () => {
    // skipParityGate is ONLY for the parity scan. The verify-checks gate
    // (every check ticked) is still the user's deliberate-act surface
    // and must apply even on the manual override path. The button is
    // disabled at the UI level before this code is even reached, but
    // belt-and-braces: the function must reject too.
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [
              { id: "a", label: "A", checked: true },
              { id: "b", label: "B", checked: false },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1, { skipParityGate: true });
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toBe("checks-incomplete");
    expect(mockVerifyActionParity).not.toHaveBeenCalled();
    expect(useSelfDriveStore.getState().guide!.sessions[0].status).toBe("active");
  });

  it("passes every distinct directory from session.files as callerPaths (multi-dir scan)", async () => {
    // Regression for the rustling-wind false-positive: the prior
    // deriveCallerPath used files[0]'s directory only, so callers in any
    // other declared directory got missed. The fix: every distinct dir
    // becomes a callerPath, and Rust unions them.
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "insert_note",
        callerPresent: true,
        handlerPresent: true,
        handlerStubFree: true,
        status: "PASS",
        detail: "ok",
      },
    ]);
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "paired", checked: true }],
            files: [
              "src/components/Foo.tsx",
              "src/components/Bar.tsx", // dedup target — same dir as Foo
              "src/hooks/useFoo.ts",
              "src/lib/api/notes.ts",
            ],
            crossSystemActions: [
              { action: "insert_note", handler: "functions/handler.ts" },
            ],
          }),
        ],
      }),
    );

    const outcome = await attemptMarkSessionComplete(1);
    expect(outcome.ok).toBe(true);
    const [, requests] = mockVerifyActionParity.mock.calls[0];
    expect(requests).toHaveLength(1);
    const req = requests[0] as {
      callerPaths: string[];
      callerPath: string;
      wire?: string;
    };
    // All three distinct dirs collected (Foo + Bar collapse to one)
    expect(req.callerPaths.sort()).toEqual(
      ["src/components", "src/hooks", "src/lib/api"].sort(),
    );
    // Legacy field intentionally empty — Rust unions the two.
    expect(req.callerPath).toBe("");
    expect(req.wire).toBeUndefined();
  });

  it("forwards the action.wire field to verifyActionParity when set on the session", async () => {
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "resolve_checkpoint",
        callerPresent: true,
        handlerPresent: true,
        handlerStubFree: true,
        status: "PASS",
        detail: "ok",
      },
    ]);
    seed(
      makeGuide({
        sessions: [
          makeSession({
            index: 1,
            checks: [{ id: "a", label: "paired", checked: true }],
            files: ["src/hooks/useResolve.ts"],
            crossSystemActions: [
              {
                action: "resolve_checkpoint",
                handler: "functions/hitl-respond/index.ts",
                wire: "hitl-respond",
              },
            ],
          }),
        ],
      }),
    );

    await attemptMarkSessionComplete(1);
    const [, requests] = mockVerifyActionParity.mock.calls[0];
    expect((requests[0] as { wire?: string }).wire).toBe("hitl-respond");
  });
});

describe("deriveCallerPaths", () => {
  it("returns '.' when files list is empty", () => {
    expect(deriveCallerPaths([])).toEqual(["."]);
  });

  it("dedupes overlapping directories", () => {
    expect(
      deriveCallerPaths([
        "src/components/Foo.tsx",
        "src/components/Bar.tsx",
        "src/hooks/useFoo.ts",
      ]),
    ).toEqual(expect.arrayContaining(["src/components", "src/hooks"]));
    expect(
      deriveCallerPaths([
        "src/components/Foo.tsx",
        "src/components/Bar.tsx",
      ]),
    ).toEqual(["src/components"]);
  });

  it("strips leading ./ and skips blank entries", () => {
    expect(
      deriveCallerPaths(["./src/hooks/a.ts", "", "  ", "./src/lib/b.ts"]),
    ).toEqual(expect.arrayContaining(["src/hooks", "src/lib"]));
  });

  it("returns top-level filename when there is no slash", () => {
    expect(deriveCallerPaths(["README.md"])).toEqual(["README.md"]);
  });
});

describe("clearPause action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("transitions paused → idle and clears pauseReason + activeBlocker", () => {
    useSelfDriveStore.setState({
      status: "paused",
      pauseReason: "Self-Drive halted: cross-system action parity check failed.",
      activeBlocker: {
        id: "blk-1",
        sessionIndex: 1,
        detectedAt: Date.now(),
        kind: "user-decision",
        summary: "Parity gate failed",
        detail: "twin_recompute_entity_importance(): handler missing in rg scan",
        optionsOffered: [],
        resolutionCriteria: "User confirms session is complete",
        status: "open",
      } satisfies Blocker,
      currentSessionIndex: 1,
    });

    useSelfDriveStore.getState().clearPause();

    const after = useSelfDriveStore.getState();
    expect(after.status).toBe("idle");
    expect(after.pauseReason).toBeNull();
    expect(after.activeBlocker).toBeNull();
    // Audit trail: log entry recorded so the run log reflects the override.
    const cleared = after.runLog.find((e) =>
      e.summary.includes("Pause cleared by manual session completion"),
    );
    expect(cleared).toBeDefined();
    expect(cleared?.phase).toBe("resumed");
  });

  it("is a no-op when status is not paused", () => {
    useSelfDriveStore.setState({
      status: "running",
      pauseReason: null,
      activeBlocker: null,
      currentSessionIndex: 1,
    });
    const before = useSelfDriveStore.getState().runLog.length;

    useSelfDriveStore.getState().clearPause();

    const after = useSelfDriveStore.getState();
    expect(after.status).toBe("running");
    expect(after.runLog.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleRecheck — request_recheck action drives Claude Code re-statement
//
// The recheck loop is the user-visible fix for "orchestrator pauses on
// format-only evidence misses". These tests drive it end-to-end via
// mockCallOrchestrator returning a request_recheck decision and assert:
//   - sendMessage is called with decision.recheckPrompt
//   - phase transitions to "rechecking"
//   - budget (rounds + per-item) is enforced
//   - feature flag off falls back to pause
// ─────────────────────────────────────────────────────────────────────

describe("handleRecheck — request_recheck loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("sends recheckPrompt to Claude Code and transitions to 'rechecking'", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "request_recheck",
      summary: "Item 1 needs a $ cmd",
      confidence: "high",
      recheckItems: ["Check A"],
      recheckPrompt:
        "Re-state Check A as `$ ls src/helpers/ → \"<output>\"`. Do not re-do other items.",
      checkResults: [
        { label: "Check A", passed: false, reason: "missing $ cmd" },
        { label: "Check B", passed: true, evidence: "src/b.ts:1 — `export const b = 2`" },
      ],
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "verifying" });

    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        SESSION_ID,
        expect.stringContaining("Re-state Check A"),
      );
    });

    const state = useSelfDriveStore.getState();
    expect(state.currentPhase).toBe("rechecking");
    expect(state.recheckRoundsUsed).toBe(1);
    expect(state.rechecksPerItem["Check A"]).toBe(1);
    expect(state.pinnedCheckResults).toHaveLength(2);
    // Not paused — the loop is active.
    expect(state.status).toBe("running");
  });

  it("re-enters 'verifying' when the next turn_complete arrives from 'rechecking'", async () => {
    setupReadyState();
    // 1st call: request_recheck
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "request_recheck",
      summary: "one more time",
      confidence: "high",
      recheckItems: ["Check A"],
      recheckPrompt: "Re-state Check A.",
      checkResults: [{ label: "Check A", passed: false, reason: "fmt" }],
    });
    // 2nd call: after Claude Code re-stated, everything passes
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "All items now have proper evidence",
      confidence: "high",
      checkResults: [
        { label: "Check A", passed: true, evidence: '$ ls → "files"' },
        { label: "Check B", passed: true, evidence: "src/b.ts:1 — `x`" },
      ],
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "verifying" });

    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentPhase).toBe("rechecking");
    });

    // Append a NEW assistant message simulating Claude Code's re-statement,
    // then fire another turn_complete.
    const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID)!;
    useSessionStore.setState({
      sessionMessages: new Map([
        [SESSION_ID, [
          ...msgs,
          {
            id: "msg-recheck",
            role: "assistant",
            content: '$ ls src/helpers/ → "files" (re-stated)',
            timestamp: "",
            activityIds: [],
            isStreaming: false,
          },
        ]],
      ]),
    });
    emit(makeTurnCompleteEvent());

    // Second orchestrator call receives the MERGED response.
    await vi.waitFor(() => {
      expect(mockCallOrchestrator).toHaveBeenCalledTimes(2);
    });
    const secondInput = mockCallOrchestrator.mock.calls[1][0];
    // The merged response includes both the original AND the recheck reply,
    // joined by the separator token.
    expect(secondInput.claudeCodeResponse).toContain("--- RECHECK RESPONSE ---");
    expect(secondInput.claudeCodeResponse).toContain("Done building foundation");
    expect(secondInput.claudeCodeResponse).toContain("(re-stated)");
    // The orchestrator evaluates it under verify rules, not rechecking.
    expect(secondInput.currentPhase).toBe("verifying");
  });

  it("pauses when MAX_RECHECK_ROUNDS (2) is already consumed", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "request_recheck",
      summary: "still unclear",
      confidence: "medium",
      recheckItems: ["Check A"],
      recheckPrompt: "re-state A",
      checkResults: [{ label: "Check A", passed: false, reason: "fmt" }],
    });

    await useSelfDriveStore.getState().start();
    // Simulate we've already burned both rounds.
    useSelfDriveStore.setState({ currentPhase: "verifying", recheckRoundsUsed: 2 });

    const emit = captureListenCallback();
    // Reset the sendMessage mock AFTER start() so we only capture what
    // handleRecheck itself sends (start() emits the initial session prompt).
    mockSendMessage.mockClear();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("paused");
    });
    const reason = useSelfDriveStore.getState().pauseReason ?? "";
    expect(reason).toMatch(/exhausted recheck budget/i);
    // sendMessage must NOT have been called — we short-circuited before send.
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("refuses to recheck the same item twice and pauses if nothing eligible remains", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "request_recheck",
      summary: "same item again",
      confidence: "medium",
      recheckItems: ["Check A"],
      recheckPrompt: "re-state A (again)",
      checkResults: [{ label: "Check A", passed: false, reason: "fmt" }],
    });

    await useSelfDriveStore.getState().start();
    // Simulate Check A has hit the MAX_RECHECKS_PER_ITEM cap (2 after Phase B.2).
    useSelfDriveStore.setState({
      currentPhase: "verifying",
      rechecksPerItem: { "Check A": 2 },
    });

    const emit = captureListenCallback();
    // Reset the sendMessage mock AFTER start() so we only capture what
    // handleRecheck itself sends (start() emits the initial session prompt).
    mockSendMessage.mockClear();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("paused");
    });
    const reason = useSelfDriveStore.getState().pauseReason ?? "";
    expect(reason).toMatch(/already rechecked/i);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("force-accepts an item via loop guard when it has been asked + answered with evidence ≥2 times (Phase B.1/B.2)", async () => {
    setupReadyState();
    // Worker has already provided evidence for "Check A" twice. The
    // orchestrator demands a recheck a third time. The loop guard should
    // intercept and convert the verdict to a forced PASS without sending
    // another recheck prompt.
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "request_recheck",
      summary: "still want Check A",
      confidence: "medium",
      recheckItems: ["Check A"],
      recheckPrompt: "Quote evidence for Check A yet again",
      checkResults: [{ label: "Check A", passed: false, reason: "format" }],
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({
      currentPhase: "verifying",
      // 2 prior prompts naming Check A, 2 prior responses with $ blocks for it
      previousFixPrompts: [
        "Recheck Check A please",
        "Re-quote Check A again",
      ],
      originalVerifierResponse:
        "Check A — PASS — $ ls -la src/a.ts → 100 bytes",
      recheckResponses: [
        "Check A — PASS — ```\nresult: present\n```",
      ],
      lastClaudeResponse:
        "Check A — confirmed — $ cat src/a.ts → content here",
    });

    const emit = captureListenCallback();
    mockSendMessage.mockClear();
    emit(makeTurnCompleteEvent());

    // The loop guard short-circuits to re-evaluation (handleVerify is
    // called). The orchestrator decision contained no genuine recheck
    // worth sending, so sendMessage should not have been called with a
    // recheck prompt.
    await vi.waitFor(() => {
      const state = useSelfDriveStore.getState();
      const forced = state.pinnedCheckResults.find((r) => r.label === "Check A");
      expect(forced).toBeDefined();
      expect(forced?.passed).toBe(true);
      expect(forced?.evidence).toMatch(/loop-guard force-accept/);
    });
    const recheckSent = mockSendMessage.mock.calls.find(
      (c) => typeof c[1] === "string" && c[1].includes("Quote evidence for Check A yet again"),
    );
    expect(recheckSent).toBeUndefined();
  });

  it("falls back to pause when settings.selfDriveEnableRecheckLoop is false", async () => {
    setupReadyState();
    useSettingsStore.setState((prev) => ({
      settings: { ...prev.settings, selfDriveEnableRecheckLoop: false },
    }));
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "request_recheck",
      summary: "would recheck",
      confidence: "high",
      recheckItems: ["Check A"],
      recheckPrompt: "re-state A",
      checkResults: [{ label: "Check A", passed: false, reason: "fmt" }],
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "verifying" });

    const emit = captureListenCallback();
    // Reset the sendMessage mock AFTER start() so we only capture what
    // handleRecheck itself sends (start() emits the initial session prompt).
    mockSendMessage.mockClear();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("paused");
    });
    expect(useSelfDriveStore.getState().pauseReason).toMatch(/disabled in settings/i);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("concatenates ALL assistant messages since the Self-Drive prompt (not just the last)", async () => {
    // Regression for "verifier response truncated — only item 5 visible":
    // Claude Code emits one assistant message per verified item (each
    // wrapped around a tool-use cycle). The orchestrator must see all of
    // them, not just the last fragment.
    setupReadyState();

    // Replace the seeded messages with a user prompt + 5 assistant items.
    // We simulate this BEFORE start() runs its own initial send.
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "All 5 items PASS",
      confidence: "high",
      checkResults: [
        { label: "Check A", passed: true, evidence: '$ ls → "files"' },
        { label: "Check B", passed: true, evidence: "src/b.ts:1 — `x`" },
      ],
    });

    await useSelfDriveStore.getState().start();

    // Stage a user message representing the Self-Drive verify prompt,
    // plus 5 assistant messages (one per verified item) coming after it.
    // The existing store state already has a pre-seeded assistant message
    // — that one sits BEFORE our marker and must not leak into the result.
    const promptId = "sd-user-test-marker";
    const preSeed = useSessionStore.getState().sessionMessages.get(SESSION_ID) || [];
    useSessionStore.setState({
      sessionMessages: new Map([[
        SESSION_ID,
        [
          ...preSeed,
          { id: promptId, role: "user", content: "Verify session 1", timestamp: "", activityIds: [], isStreaming: false, isSelfDrive: true },
          { id: "m1", role: "assistant", content: "Item 1 — PASS — $ ls → files", timestamp: "", activityIds: [], isStreaming: false },
          { id: "m2", role: "assistant", content: "Item 2 — PASS — $ pytest → 31 passed · mocks=none", timestamp: "", activityIds: [], isStreaming: false },
          { id: "m3", role: "assistant", content: "Item 3 — PASS — requirements.txt:16 — `PyYAML>=6.0.1`", timestamp: "", activityIds: [], isStreaming: false },
          { id: "m4", role: "assistant", content: "Item 4 — PASS — grep returned no matches", timestamp: "", activityIds: [], isStreaming: false },
          { id: "m5", role: "assistant", content: "Item 5 — PASS — grep returned no matches\n\nVerified 5/5 | PASS: 5", timestamp: "", activityIds: [], isStreaming: false },
        ],
      ]]),
    });

    useSelfDriveStore.setState({
      currentPhase: "verifying",
      lastSelfDrivePromptMessageId: promptId,
    });

    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(mockCallOrchestrator).toHaveBeenCalled();
    });

    // The orchestrator input should contain ALL 5 items' content,
    // concatenated — not just item 5. And it must NOT contain messages
    // from before the Self-Drive prompt marker.
    const input = mockCallOrchestrator.mock.calls[0][0];
    expect(input.claudeCodeResponse).toContain("Item 1 — PASS");
    expect(input.claudeCodeResponse).toContain("Item 2 — PASS");
    expect(input.claudeCodeResponse).toContain("Item 3 — PASS");
    expect(input.claudeCodeResponse).toContain("Item 4 — PASS");
    expect(input.claudeCodeResponse).toContain("Item 5 — PASS");
    expect(input.claudeCodeResponse).toContain("Verified 5/5");
    // The pre-seeded message ("Done building foundation.") sits BEFORE
    // our marker and must not leak into the orchestrator input.
    expect(input.claudeCodeResponse).not.toContain("Done building foundation");
  });

  it("advances cleanly when the orchestrator's evidence is non-canonical but all labels match (trust-the-orchestrator)", async () => {
    // Previously: the client validator would reject evidence without `:`
    // or `$ ` or `mocks=` and auto-request a recheck. Now: the orchestrator
    // is the judge, so non-canonical evidence on a fully-matched verdict
    // just advances. No recheck, no pause.
    setupReadyState();

    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "All passed (semantic)",
      confidence: "high",
      checkResults: [
        // Evidence without `$ ` or `:` — old validator rejected, new one advances.
        { label: "Check A", passed: true, evidence: "files look fine, all present" },
        { label: "Check B", passed: true, evidence: "tests are green" },
      ],
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "verifying" });
    mockSendMessage.mockClear();

    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    // No recheck prompt, no pause — session advances.
    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentSessionIndex).toBeGreaterThan(1);
    });
    expect(useSelfDriveStore.getState().pauseReason).toBeNull();
    // handleRecheck was not called for a format-only concern.
    const sends = mockSendMessage.mock.calls.filter(
      (c) => (c[1] as string).includes("Re-state ONLY the items below"),
    );
    expect(sends).toHaveLength(0);
  });

  it("auto-requests a recheck when the verdict is a STRUCTURAL near-miss (1 of 3 labels unmatched)", async () => {
    // When the orchestrator skips a minority of session labels (<50%),
    // the client triggers a recheck for the missing ones rather than
    // pausing. This is the only remaining auto-recheck trigger client-side.
    setupReadyState();
    // Give the session 3 checks so 1 unmatched is ~33% (below the 50% structural-fail threshold).
    const guide3 = makeGuide();
    guide3.sessions[0].verifyChecks = [
      { id: "v-1-a", label: "Alpha", checked: false },
      { id: "v-1-b", label: "Beta", checked: false },
      { id: "v-1-c", label: "Gamma", checked: false },
    ];
    useGuideStore.setState({ guide: guide3 });

    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "skipped Gamma",
      confidence: "high",
      checkResults: [
        { label: "Alpha", passed: true, evidence: "x" },
        { label: "Beta", passed: true, evidence: "y" },
        // Gamma missing entirely.
      ],
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "verifying" });
    mockSendMessage.mockClear();

    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });
    const promptSent = mockSendMessage.mock.calls[0]?.[1];
    expect(promptSent).toContain("Re-state ONLY the items below");
    expect(promptSent).toContain("Gamma");
    expect(useSelfDriveStore.getState().currentPhase).toBe("rechecking");
  });

  it("ticks checks and advances when orchestrator returns advance after a recheck round", async () => {
    // Regression for "Could not mark Session 2 complete — unexpected state":
    // After auto-recheck, previousPhase at handleTurnComplete is "rechecking"
    // (not "verifying"). The gate that ticks verify-checks only fired for
    // "verifying", so on the recheck path the checks were never toggled,
    // attemptMarkSessionComplete returned "checks-incomplete", and Self-Drive
    // paused with a confusing "unexpected state" message even though the
    // orchestrator had correctly advanced.
    setupReadyState();

    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "All 2 items now carry proper file:line evidence",
      confidence: "high",
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:1 — `export const A = 1`" },
        { label: "Check B", passed: true, evidence: "src/b.ts:5 — `export function b() {}`" },
      ],
    });

    await useSelfDriveStore.getState().start();
    // Simulate we're coming BACK from a recheck round — this is the exact
    // phase the bug triggered under.
    useSelfDriveStore.setState({
      currentPhase: "rechecking",
      recheckRoundsUsed: 1,
      rechecksPerItem: { "Check A": 1, "Check B": 1 },
    });

    const emit = captureListenCallback();
    mockSendMessage.mockClear();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("running");
      expect(useSelfDriveStore.getState().currentSessionIndex).toBeGreaterThan(1);
    });

    // Session 1 should now be done with every check ticked — the whole
    // point of the gate that the previousPhase="rechecking" case bypassed.
    const s1 = useSelfDriveStore.getState().guide!.sessions[0];
    expect(s1.status).toBe("done");
    expect(s1.verifyChecks.every((c) => c.checked)).toBe(true);
    // And no pause with "unexpected state" language.
    expect(useSelfDriveStore.getState().pauseReason).toBeNull();
  });

  it("pauses when ≥50% of session labels are fabricated or skipped (structural integrity gate)", async () => {
    setupReadyState();
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "claimed done",
      confidence: "high",
      // Session has Check A and Check B (2 labels). Orchestrator only reports
      // something unrelated → 100% unmatched → ≥50% structural error.
      checkResults: [
        { label: "Something Fabricated", passed: true, evidence: "src/x.ts:1 — `x`" },
      ],
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "verifying" });
    mockSendMessage.mockClear();

    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("paused");
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(useSelfDriveStore.getState().pauseReason).toMatch(/session labels have no match/);
  });

  it("ticks checks and advances when orchestrator returns advance after a fix round (Fix #5 — post-fix verify-class)", async () => {
    // Regression for the user-reported "Could not mark Session 3 complete —
    // unexpected state" pause. After a fix round (orchestrator returned
    // action=fix on an earlier turn), the next orchestrator decision arrives
    // with previousPhase="fixing". Without the post-fix verify-class
    // expansion, the auto-tick block was skipped, attemptMarkSessionComplete
    // returned checks-incomplete, and the user saw the catch-all pause
    // immediately after "All checks pass".
    setupReadyState();

    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "All 2 checks pass after fix",
      confidence: "high",
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:1 — `export const A = 1`" },
        { label: "Check B", passed: true, evidence: "src/b.ts:5 — `export function b() {}`" },
      ],
    });

    await useSelfDriveStore.getState().start();
    // The screenshot scenario: previousPhase landed as "fixing" because
    // the orchestrator was invoked to re-evaluate the fix response.
    useSelfDriveStore.setState({ currentPhase: "fixing", fixAttempt: 1 });

    const emit = captureListenCallback();
    mockSendMessage.mockClear();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().status).toBe("running");
      expect(useSelfDriveStore.getState().currentSessionIndex).toBeGreaterThan(1);
    });

    const s1 = useSelfDriveStore.getState().guide!.sessions[0];
    expect(s1.status).toBe("done");
    expect(s1.verifyChecks.every((c) => c.checked)).toBe(true);
    expect(useSelfDriveStore.getState().pauseReason).toBeNull();
  });

  it("surfaces unticked labels and originating phase when checks-incomplete fallback fires (Fix #1)", async () => {
    // Even with Fix #5, the catch-all fallback can still fire from phases
    // that are NOT verify-class (e.g. "building" — orchestrator decides
    // advance without ever evaluating verify checks, or returns no
    // checkResults). In that case the user must see WHICH checks are
    // unticked and WHICH phase produced the bad call — not the historical
    // "unexpected state" string that told them nothing.
    setupReadyState();

    // No checkResults → fromVerifyClass also won't fire (post-fix branch
    // gates on checkResults.length > 0). Orchestrator simply says advance
    // from a non-verify phase.
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "build looks good",
      confidence: "high",
    });

    await useSelfDriveStore.getState().start();
    useSelfDriveStore.setState({ currentPhase: "building" });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emit = captureListenCallback();
    mockSendMessage.mockClear();
    emit(makeTurnCompleteEvent());

    try {
      await vi.waitFor(() => {
        expect(useSelfDriveStore.getState().status).toBe("paused");
      });

      const pauseReason = useSelfDriveStore.getState().pauseReason ?? "";
      // Fix #1: message must name the unticked checks and the phase.
      expect(pauseReason).toMatch(/verify check\(s\) not ticked/);
      expect(pauseReason).toContain("Check A");
      expect(pauseReason).toContain("Check B");
      expect(pauseReason).toContain('phase "building"');
      // And it must NOT be the historical opaque catch-all.
      expect(pauseReason).not.toMatch(/unexpected state/);

      // Fix #3: the pause must be routed through console.warn so it lands
      // in the Tauri app log file.
      const selfDriveWarnCalls = warnSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].startsWith("[selfDrive] pause:"),
      );
      expect(selfDriveWarnCalls.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("resets recheck state when a session advances", async () => {
    setupReadyState();
    // First verifying turn → advance
    mockCallOrchestrator.mockResolvedValueOnce({
      action: "advance",
      summary: "done",
      confidence: "high",
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
        { label: "Check B", passed: true, evidence: "src/b.ts:1 — `y`" },
      ],
    });

    await useSelfDriveStore.getState().start();
    // Seed stale recheck bookkeeping from a prior cycle.
    useSelfDriveStore.setState({
      currentPhase: "verifying",
      recheckRoundsUsed: 1,
      rechecksPerItem: { "Check A": 1 },
      originalVerifierResponse: "stale original",
      recheckResponses: ["stale recheck"],
      pinnedCheckResults: [{ label: "Check A", passed: false, reason: "old" }],
    });

    const emit = captureListenCallback();
    emit(makeTurnCompleteEvent());

    await vi.waitFor(() => {
      expect(useSelfDriveStore.getState().currentSessionIndex).toBeGreaterThan(1);
    });
    const state = useSelfDriveStore.getState();
    expect(state.recheckRoundsUsed).toBe(0);
    expect(state.rechecksPerItem).toEqual({});
    expect(state.originalVerifierResponse).toBeNull();
    expect(state.recheckResponses).toEqual([]);
    expect(state.pinnedCheckResults).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// H4 — handleVerify pauses (instead of silently returning) when the
// pinned guide or session is missing. Before the fix, a missing guide
// caused handleVerify to return with `status:"running"` still set and
// no prompt sent, producing a permanent silent hang with the spinner on.
// ─────────────────────────────────────────────────────────────────────

describe("H4 — handleVerify pauses on missing guide/session instead of silent hang", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockImplementation(() => Promise.resolve(vi.fn()));
    useGuideStore.setState({ guide: null });
    useSelfDriveStore.setState({
      status: "running",
      currentPhase: "verifying",
      currentSessionIndex: 1,
      guide: null,
      projectPath: "/test",
      sessionId: SESSION_ID,
      activeBlocker: null,
      runLog: [],
      recheckRoundsUsed: 0,
      rechecksPerItem: {},
      originalVerifierResponse: null,
      recheckResponses: [],
      pinnedCheckResults: [],
    });
  });

  it("pauses with a clear reason when the pinned guide is null", async () => {
    await handleVerify();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("paused");
    expect(state.pauseReason).toMatch(/pinned guide missing/i);
    // No prompt was sent — silent-hang defence.
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("pauses with a clear reason when the session is not in the pinned guide", async () => {
    useSelfDriveStore.setState({
      guide: makeGuide(),
      currentSessionIndex: 99, // doesn't exist
    });

    await handleVerify();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("paused");
    expect(state.pauseReason).toMatch(/Session 99 not found/i);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// H5 — resume() must NOT re-enter enterRecoveryPhase when the blocker is
// already in "verifying" status. Before the fix, a blocker hydrated from
// disk mid-recovery (e.g. after an app restart) would re-send the
// recovery prompt on every Resume click, flipping state backward.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// H1 — UI helpers (toggleVerifyCheckForSession etc.) mirror mutations
// into BOTH selfDriveStore.guide and useGuideStore.guide when the
// projects match. GuidePanel uses these when Self-Drive owns the active
// project; without them, the pinned guide desyncs and resume() loops.
// ─────────────────────────────────────────────────────────────────────

describe("H1 — Self-Drive guide helpers mirror both stores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockImplementation(() => Promise.resolve(vi.fn()));
  });

  it("isSelfDriveOwningProject returns true only when Self-Drive is running/paused on the given project", () => {
    useSelfDriveStore.setState({
      status: "running",
      projectPath: "/test",
    });
    expect(isSelfDriveOwningProject("/test")).toBe(true);
    expect(isSelfDriveOwningProject("/other")).toBe(false);
    expect(isSelfDriveOwningProject(null)).toBe(false);

    useSelfDriveStore.setState({ status: "paused" });
    expect(isSelfDriveOwningProject("/test")).toBe(true);

    useSelfDriveStore.setState({ status: "idle" });
    expect(isSelfDriveOwningProject("/test")).toBe(false);
  });

  it("toggleVerifyCheckForSession mutates both guideStore AND selfDriveStore when paths match", () => {
    const guide = makeGuide();
    useGuideStore.setState({ guide });
    useSelfDriveStore.setState({ guide, projectPath: "/test" });

    toggleVerifyCheckForSession(1, "v-1-0");

    const sdGuide = useSelfDriveStore.getState().guide!;
    const uiGuide = useGuideStore.getState().guide!;
    expect(sdGuide.sessions[0].verifyChecks[0].checked).toBe(true);
    expect(uiGuide.sessions[0].verifyChecks[0].checked).toBe(true);
    // Same reference — both point at the mutated guide.
    expect(sdGuide).toBe(uiGuide);
  });

  it("markPromptSentForSession flips promptSent in both stores", () => {
    const guide = makeGuide();
    useGuideStore.setState({ guide });
    useSelfDriveStore.setState({ guide, projectPath: "/test" });

    markPromptSentForSession(1);

    expect(useSelfDriveStore.getState().guide!.sessions[0].promptSent).toBe(true);
    expect(useGuideStore.getState().guide!.sessions[0].promptSent).toBe(true);
  });

  it("markVerifyRequestedForSession flips verifyRequested in both stores", () => {
    const guide = makeGuide();
    useGuideStore.setState({ guide });
    useSelfDriveStore.setState({ guide, projectPath: "/test" });

    markVerifyRequestedForSession(1);

    expect(useSelfDriveStore.getState().guide!.sessions[0].verifyRequested).toBe(true);
    expect(useGuideStore.getState().guide!.sessions[0].verifyRequested).toBe(true);
  });

  it("does NOT mirror into guideStore when the UI is looking at a different project", () => {
    const sdGuide = makeGuide({ projectPath: "/test" });
    const uiGuide = makeGuide({ projectPath: "/other", id: "guide-other" });
    useGuideStore.setState({ guide: uiGuide });
    useSelfDriveStore.setState({ guide: sdGuide, projectPath: "/test" });

    toggleVerifyCheckForSession(1, "v-1-0");

    expect(useSelfDriveStore.getState().guide!.sessions[0].verifyChecks[0].checked).toBe(true);
    // UI guide for a different project must NOT be clobbered.
    expect(useGuideStore.getState().guide!.sessions[0].verifyChecks[0].checked).toBe(false);
    expect(useGuideStore.getState().guide!.projectPath).toBe("/other");
  });
});

describe("H5 — resume skips recovery re-entry for 'verifying' blockers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockImplementation(() => Promise.resolve(vi.fn()));
    setupReadyState();
  });

  it("does NOT re-enter enterRecoveryPhase when resuming a blocker already in 'verifying'", async () => {
    // Simulate: previous recovery turn already sent (blocker.status="verifying"),
    // then app paused. Resume click should fall through to normal session
    // flow — NOT re-send the recovery prompt.
    useSelfDriveStore.setState({
      status: "paused",
      currentPhase: "recovering",
      currentSessionIndex: 1,
      projectPath: "/test",
      sessionId: SESSION_ID,
      guide: makeGuide(),
      activeBlocker: {
        id: "b-1",
        sessionIndex: 1,
        detectedAt: Date.now(),
        kind: "credentials",
        summary: "Needs API key",
        detail: "Claude Code asked for a key.",
        optionsOffered: [],
        resolutionCriteria: "User provides key",
        status: "verifying",
        userResolution: "picked option 1",
        prePauseLastMessageId: "msg-0",
      },
    });

    await useSelfDriveStore.getState().resume();

    // No recovery-verification prompt should have been re-sent.
    // Allowed: the normal session-flow re-send (building/verifying), but
    // NOT a recovery prompt. The recovery prompt is what Self-Drive
    // composes in enterRecoveryPhase — assert its signature is absent.
    const recoveryCalls = mockSendMessage.mock.calls.filter(
      ([, prompt]) => typeof prompt === "string" && /evaluate.*blocker|resolution criteria/i.test(prompt),
    );
    expect(recoveryCalls.length).toBe(0);

    // Blocker status should NOT have been bumped back to "user-decided".
    const blockerAfter = useSelfDriveStore.getState().activeBlocker;
    expect(blockerAfter?.status).toBe("verifying");
  });
});
