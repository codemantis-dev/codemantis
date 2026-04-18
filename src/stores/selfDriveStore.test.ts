import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FrontendEvent, TurnCompleteEvent, ProcessExitedEvent } from "../types/claude-events";
import type { ImplementationGuide, OrchestratorDecision, OrchestratorInput } from "../types/implementation-guide";

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
  mockSendMessage: vi.fn(() => Promise.resolve()),
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

vi.mock("../lib/tauri-commands", () => ({
  sendMessage: mockSendMessage,
  syncSessionMode: mockSyncSessionMode,
  // guideStore persistence needs these
  saveGuide: vi.fn(() => Promise.resolve("guide-1")),
  loadGuide: vi.fn(() => Promise.resolve(null)),
  updateGuideData: vi.fn(() => Promise.resolve()),
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
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
  truncateResponse: vi.fn((s: string) => s),
  getCurrentSessionPlan: mockGetCurrentSessionPlan,
  getProjectTechStack: vi.fn(() => "React + TypeScript"),
  getBuildCommand: vi.fn(() => "pnpm tsc --noEmit"),
  getTestCommand: vi.fn(() => "pnpm test"),
}));

import { useSelfDriveStore, validateVerifyAdvance } from "./selfDriveStore";
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
      expect(mockSendMessage).toHaveBeenCalledWith(SESSION_ID, "Build foundation.");
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
    it("rejects advance from verify phase when orchestrator verdict has unknown labels and no evidence", async () => {
      setupReadyState();
      // Session 1 has checks "Check A" and "Check B", both unchecked.
      // The orchestrator returns a verdict that doesn't match — this is the
      // exact skim-PASS failure mode the gate exists to prevent.
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
        // Gate must pause Self-Drive rather than blanket-mark checks.
        expect(useSelfDriveStore.getState().status).toBe("paused");
      });

      // Checks stay unchecked. Session stays active.
      const guide = useGuideStore.getState().guide!;
      const session1 = guide.sessions[0];
      expect(session1.verifyChecks[0].checked).toBe(false);
      expect(session1.verifyChecks[1].checked).toBe(false);
      expect(session1.status).toBe("active");
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

      // Session 2 prompt should be sent
      expect(mockSendMessage).toHaveBeenCalledWith(SESSION_ID, "Build features.");

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

      // Should send the creation prompt
      expect(mockSendMessage).toHaveBeenCalledWith(SESSION_ID, "Build foundation.");
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

    // Should have at least one user message with the build prompt
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    expect(userMessages[userMessages.length - 1].content).toBe("Build foundation.");
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
// validateVerifyAdvance — the gate that prevents skim-PASS autonomous advances
// ═══════════════════════════════════════════════════════════════════════════

describe("validateVerifyAdvance", () => {
  const session = {
    verifyChecks: [
      { label: "Check A" },
      { label: "Check B" },
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

  it("accepts a verdict with full coverage and file:line evidence for every PASS", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:12 — `export const A = 1`" },
        { label: "Check B", passed: true, evidence: "src/b.ts:5-7 — `function b() {}`" },
      ],
    });
    expect(validateVerifyAdvance(session, decision)).toBeNull();
  });

  it("accepts a verdict with passed:false entries that carry a reason", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:12 — `export const A = 1`" },
        { label: "Check B", passed: false, reason: "symbol not found in src/b.ts" },
      ],
    });
    // validateVerifyAdvance returns null regardless of passed:false — it only
    // checks STRUCTURE. The caller decides whether to advance (requires all true).
    expect(validateVerifyAdvance(session, decision)).toBeNull();
  });

  it("rejects when checkResults is missing entirely", () => {
    const decision = makeDecision({});
    expect(validateVerifyAdvance(session, decision)).toContain("no checkResults");
  });

  it("rejects when checkResults is empty", () => {
    const decision = makeDecision({ checkResults: [] });
    expect(validateVerifyAdvance(session, decision)).toContain("no checkResults");
  });

  it("rejects when some session checks are missing from the verdict", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
      ],
    });
    const reason = validateVerifyAdvance(session, decision);
    expect(reason).toContain("1 checks missing");
  });

  it("rejects when a passed:true entry lacks evidence", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
        { label: "Check B", passed: true }, // no evidence
      ],
    });
    const reason = validateVerifyAdvance(session, decision);
    expect(reason).toContain("1 PASS entries lack file:line evidence");
  });

  it("rejects when evidence is present but has no file:line separator", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
        { label: "Check B", passed: true, evidence: "looks correct" }, // no ":"
      ],
    });
    const reason = validateVerifyAdvance(session, decision);
    expect(reason).toContain("1 PASS entries lack file:line evidence");
  });

  it("rejects when verdict contains labels not present in the session", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true, evidence: "src/a.ts:1 — `x`" },
        { label: "Check B", passed: true, evidence: "src/b.ts:1 — `y`" },
        { label: "Fabricated check", passed: true, evidence: "src/c.ts:1 — `z`" },
      ],
    });
    const reason = validateVerifyAdvance(session, decision);
    expect(reason).toContain("1 unknown labels");
  });

  it("combines multiple violations into one reason string", () => {
    const decision = makeDecision({
      checkResults: [
        { label: "Check A", passed: true }, // no evidence (violation 1)
        { label: "Fabricated", passed: true, evidence: "src/x.ts:1 — `x`" }, // unknown label (violation 2)
        // Check B is missing entirely (violation 3)
      ],
    });
    const reason = validateVerifyAdvance(session, decision);
    expect(reason).toContain("1 checks missing");
    expect(reason).toContain("1 PASS entries lack file:line evidence");
    expect(reason).toContain("1 unknown labels");
  });
});
