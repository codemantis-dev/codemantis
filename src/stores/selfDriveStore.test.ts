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
  mockFindCheckByLabel,
  mockGetCurrentSessionPlan,
} = vi.hoisted(() => ({
  mockListen: vi.fn<(channel: string, handler: (event: { payload: FrontendEvent }) => void) => Promise<() => void>>(() => Promise.resolve(vi.fn())),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockSyncSessionMode: vi.fn(() => Promise.resolve()),
  mockCallOrchestrator: vi.fn<(input: OrchestratorInput, provider: string, apiKey: string, model: string) => Promise<OrchestratorDecision>>(),
  mockBuildSessionVerifyPrompt: vi.fn(() => "Verify session prompt"),
  mockShowToast: vi.fn(),
  mockFindCheckByLabel: vi.fn(),
  mockGetCurrentSessionPlan: vi.fn((sessionIndex: number) => ({
    index: sessionIndex,
    name: `Session ${sessionIndex}`,
    scope: "Phase",
    prompt: "Build something",
    verifyChecks: ["Check A", "Check B"],
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
  findCheckByLabel: mockFindCheckByLabel,
  getCurrentSessionPlan: mockGetCurrentSessionPlan,
  getProjectTechStack: vi.fn(() => "React + TypeScript"),
  getBuildCommand: vi.fn(() => "pnpm tsc --noEmit"),
  getTestCommand: vi.fn(() => "pnpm test"),
}));

import { useSelfDriveStore } from "./selfDriveStore";
import { useSessionStore } from "./sessionStore";
import { useGuideStore } from "./guideStore";
import { useSettingsStore } from "./settingsStore";

// Configure findCheckByLabel to look up checks from the actual guide store.
// Must be done after imports so useGuideStore is available.
mockFindCheckByLabel.mockImplementation((sessionIndex: number, label: string) => {
  const guide = useGuideStore.getState().guide;
  if (!guide) return null;
  const session = guide.sessions.find((s: { index: number }) => s.index === sessionIndex);
  if (!session) return null;
  return session.verifyChecks.find(
    (c: { label: string }) => c.label.toLowerCase() === label.toLowerCase(),
  ) || null;
});

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
    sessions: new Map(),
    sessionMessages: new Map(),
    sessionBusy: new Map(),
    sessionModes: new Map(),
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
    useSessionStore.setState({ activeSessionId: SESSION_ID });
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
          { label: "Check A", passed: true },
          { label: "Check B", passed: true },
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
    it("pauses when markSessionComplete fails and session is not done", async () => {
      setupReadyState();
      // Session 1 checks are NOT checked — markSessionComplete will return false
      // and the orchestrator doesn't provide matching checkResults
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
        expect(useSelfDriveStore.getState().pauseReason).toContain("verify checks");
      });
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

    it("toggles verify checks from orchestrator checkResults", async () => {
      setupReadyState();

      mockCallOrchestrator.mockResolvedValue({
        action: "advance",
        summary: "All pass",
        confidence: "high",
        checkResults: [
          { label: "Check A", passed: true },
          { label: "Check B", passed: true },
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
          { label: "Check A", passed: true },
          { label: "Check B", passed: true },
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
        checkResults: [{ label: "Polish check", passed: true }],
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
              { label: "Check A", passed: true },
              { label: "Check B", passed: true },
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
          { label: "Check A", passed: true },
          { label: "Check B", passed: true },
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
              { label: "Check A", passed: true },
              { label: "Check B", passed: true },
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
          checkResults: input.sessionPlan.verifyChecks.map((label: string) => ({
            label,
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
