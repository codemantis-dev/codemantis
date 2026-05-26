/**
 * Integration test: Self-Drive navigation safety
 *
 * The user requirement: Self-Drive must keep working correctly when the
 * user switches CodeMantis project tabs OR switches sub-sessions inside
 * a project. Historically Self-Drive:
 *   - paused with "Project switched" when the UI-facing guideStore flipped;
 *   - read a module-level `activeSessionId` that could be overwritten by
 *     `resume()` using `projectActiveSession.get(...)` — a sub-tab flip
 *     then made Self-Drive target the wrong Claude Code session.
 *
 * These tests reproduce both scenarios against the REAL selfDriveStore.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import type { ImplementationGuide, OrchestratorInput, OrchestratorDecision } from "../../types/implementation-guide";
import type { Session } from "../../types/session";
import type { FrontendEvent } from "../../types/claude-events";

// ── Hoisted mocks ────────────────────────────────────────────────────────

const { mockShowToast, mockSendMessage, mockSyncSessionMode, mockCallOrchestrator, mockListen } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockSyncSessionMode: vi.fn(() => Promise.resolve()),
  mockCallOrchestrator: vi.fn<(i: OrchestratorInput, p: string, k: string, m: string) => Promise<OrchestratorDecision>>(
    async () => ({ action: "pause", summary: "paused", confidence: "high" })
  ),
  mockListen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

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
  // selfDriveStore.start() subscribes to chat events via this helper
  // (instead of calling the raw `listen()` directly). Route the
  // payload-shaped callback through `mockListen` so the existing
  // `rigListen` / `capturedHandler` test machinery still works — the
  // mock receives a `{ payload }`-shaped wrapper just like the real
  // tauri `listen()` would.
  listenChatEvents: vi.fn(async (sessionId: string, cb: (p: unknown) => void) => {
    await mockListen(`claude-chat-${sessionId}`, (e: { payload: unknown }) => cb(e.payload));
    return () => {};
  }),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: mockShowToast,
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/self-drive-orchestrator", () => ({
  callOrchestrator: mockCallOrchestrator,
}));

vi.mock("../../lib/guide-verify-prompt", () => ({
  buildSessionVerifyPrompt: vi.fn(() => "Verify prompt"),
}));

// Use the real self-drive-utils here — the whole point is testing
// extractToolsFromTurn + getCurrentSessionPlan with the pinned state.

vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

import { useSelfDriveStore } from "../../stores/selfDriveStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useGuideStore } from "../../stores/guideStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useActivityStore } from "../../stores/activityStore";

// ── Helpers ──────────────────────────────────────────────────────────────

const PROJECT_A = "/tmp/sd-proj-A";
const PROJECT_B = "/tmp/sd-proj-B";
const SESSION_A1 = "sess-A-1";
const SESSION_A2 = "sess-A-2"; // sub-tab in same project A

function sessionFixture(id: string, project: string): Session {
  return {
    id,
    name: `Claude ${id}`,
    project_path: project,
    status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    model: "claude-sonnet-4-20250514",
    icon_index: 0,
  };
}

function guideFor(project: string): ImplementationGuide {
  return {
    id: `guide-${project}`,
    projectPath: project,
    specFilename: "spec.md",
    auditFilename: null,
    title: `Guide for ${project}`,
    sessions: [
      {
        index: 1,
        name: "Foundation",
        scope: "Phase 1",
        readSections: "Section 1",
        files: ["src/a.ts"],
        prompt: "Build foundation.",
        verifyChecks: [{ id: "v-1-0", label: "Check A", checked: false }],
        status: "active",
        promptSent: false,
        verifyRequested: false,
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
  };
}

// Capture the latest handler passed to listen(`claude-chat-...`) so we can
// emit events into Self-Drive's listener at will.
let capturedHandler: ((e: { payload: FrontendEvent }) => void) | null = null;
function rigListen(): void {
  capturedHandler = null;
  mockListen.mockImplementation(
    async (_channel: string, handler: (e: { payload: FrontendEvent }) => void) => {
      capturedHandler = handler;
      return vi.fn(); // unlisten
    },
  );
}

function emitTurnComplete(): void {
  if (!capturedHandler) throw new Error("no listener captured");
  capturedHandler({
    payload: {
      type: "turn_complete",
      duration_ms: 1000,
    } as FrontendEvent,
  });
}

function setupReady(startingProject: string, startingSession: string): void {
  // Settings with API key.
  useSettingsStore.setState({
    settings: {
      apiKeys: { anthropic: "sk-test" },
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
    } as unknown as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });

  // Session store: put the starting session as the UI-active one for its project.
  useSessionStore.getState().addSession(sessionFixture(startingSession, startingProject));
  useSessionStore.setState({
    activeSessionId: startingSession,
    activeProjectPath: startingProject,
  });

  // Guide store loaded with the starting project's guide.
  useGuideStore.setState({ guide: guideFor(startingProject), loading: false });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Self-Drive navigation safety (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    rigListen();
    // Default: orchestrator pauses so we don't cascade into further turns.
    mockCallOrchestrator.mockResolvedValue({
      action: "pause",
      pauseReason: "test pause",
      summary: "paused",
      confidence: "high",
    });
  });

  it("keeps running on its pinned guide when the user switches project tabs", async () => {
    setupReady(PROJECT_A, SESSION_A1);
    await useSelfDriveStore.getState().start();
    expect(useSelfDriveStore.getState().status).toBe("running");
    expect(useSelfDriveStore.getState().guide?.projectPath).toBe(PROJECT_A);

    // User switches to a different project — guideStore reloads to that
    // project's guide; activeProjectPath flips. Self-Drive MUST continue.
    useGuideStore.setState({ guide: guideFor(PROJECT_B) });
    useSessionStore.setState({ activeProjectPath: PROJECT_B });

    emitTurnComplete();

    // The orchestrator is invoked for project A's turn (not paused away).
    await vi.waitFor(() => {
      expect(mockCallOrchestrator).toHaveBeenCalled();
    });
    const call = mockCallOrchestrator.mock.calls[0][0];
    // The orchestrator received project A's spec, not project B's.
    expect(call.specFilename).toBe("spec.md");
    // Self-Drive's pinned guide is still project A.
    expect(useSelfDriveStore.getState().guide?.projectPath).toBe(PROJECT_A);
  });

  it("keeps sending to the pinned session when the user switches sub-tabs inside the same project", async () => {
    setupReady(PROJECT_A, SESSION_A1);
    await useSelfDriveStore.getState().start();
    // First send went to session A1 (the build prompt).
    const firstCall = mockSendMessage.mock.calls[0] as unknown as [string, string] | undefined;
    expect(firstCall?.[0]).toBe(SESSION_A1);

    // User opens a second sub-tab in project A and clicks it.
    useSessionStore.getState().addSession(sessionFixture(SESSION_A2, PROJECT_A));
    useSessionStore.setState({ activeSessionId: SESSION_A2 });
    useSessionStore.getState().projectActiveSession.set(PROJECT_A, SESSION_A2);

    // Pause + resume (simulating any orchestrator pause/resume cycle).
    useSelfDriveStore.getState().pause();
    expect(useSelfDriveStore.getState().status).toBe("paused");
    await useSelfDriveStore.getState().resume();

    // Self-Drive's pinned session must still be SESSION_A1.
    expect(useSelfDriveStore.getState().sessionId).toBe(SESSION_A1);
  });

  it("extractToolsFromTurn pulls from activityStore even when the user is viewing a different project", async () => {
    setupReady(PROJECT_A, SESSION_A1);
    await useSelfDriveStore.getState().start();

    // Seed: Claude Code in session A1 actually used tools during the turn.
    // Activities are tagged to an assistant message the session will emit.
    const assistantMsgId = "assistant-msg-1";
    useSessionStore.getState().addMessage(SESSION_A1, {
      id: assistantMsgId,
      role: "assistant",
      content: "Done.", // Terse reply — regex fallback would find nothing.
      timestamp: new Date().toISOString(),
      activityIds: [], // always empty in production
      isStreaming: false,
    });
    useActivityStore.getState().addEntry(SESSION_A1, {
      id: "a-1",
      toolUseId: "tu-1",
      toolName: "Write",
      toolInput: {},
      status: "done",
      timestamp: new Date().toISOString(),
      isError: false,
      messageId: assistantMsgId,
    });
    useActivityStore.getState().addEntry(SESSION_A1, {
      id: "a-2",
      toolUseId: "tu-2",
      toolName: "Bash",
      toolInput: {},
      status: "done",
      timestamp: new Date().toISOString(),
      isError: false,
      messageId: assistantMsgId,
    });

    // User navigates to project B.
    useGuideStore.setState({ guide: guideFor(PROJECT_B) });
    useSessionStore.setState({ activeProjectPath: PROJECT_B });

    emitTurnComplete();

    await vi.waitFor(() => {
      expect(mockCallOrchestrator).toHaveBeenCalled();
    });
    const call = mockCallOrchestrator.mock.calls[0][0];
    // Tools come from activityStore — NOT from msg.activityIds, NOT from
    // the regex fallback (message content was just "Done.").
    expect(call.claudeCodeToolsUsed).toContain("Write");
    expect(call.claudeCodeToolsUsed).toContain("Bash");
  });
});
