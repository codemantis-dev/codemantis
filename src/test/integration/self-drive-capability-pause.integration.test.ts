/**
 * Integration test: Self-Drive per-session capability gate ↔ Mission Control
 *
 * Covers the cross-module flow that Tier 2 wires up end-to-end:
 *   1. A guide session declares `requires: [<capabilityId>]`.
 *   2. start() runs the REAL selfDriveStore. The whole-project preflight gate
 *      passes (allSatisfied), but the per-session gate catches the missing
 *      capability and pauses on a structured `capability-missing` blocker —
 *      WITHOUT dispatching the build prompt.
 *   3. The AppShell-facing selectors (`selectPausedCapability`,
 *      `selectPausedSessionContext`) — the exact values fed to PreflightTray's
 *      `pausedReason` and the MidRunPauseModal — return the right data.
 *   4. Once the capability is satisfied + the user answers in chat, Resume
 *      re-engages the recovery path (a recovery prompt is dispatched).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import type {
  ImplementationGuide,
  OrchestratorInput,
  OrchestratorDecision,
} from "../../types/implementation-guide";
import type { Session } from "../../types/session";

// ── Hoisted mocks ────────────────────────────────────────────────────────

const {
  mockShowToast,
  mockSendMessage,
  mockSyncSessionMode,
  mockCallOrchestrator,
  mockListen,
  mockPreflightStatus,
} = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockSyncSessionMode: vi.fn(() => Promise.resolve()),
  mockCallOrchestrator: vi.fn<(i: OrchestratorInput, p: string, k: string, m: string) => Promise<OrchestratorDecision>>(
    async () => ({ action: "pause", summary: "paused", confidence: "high" }),
  ),
  mockListen: vi.fn(),
  mockPreflightStatus: vi.fn(),
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
  preflightStatus: mockPreflightStatus,
  verifyActionParity: vi.fn(() => Promise.resolve({ overallStatus: "PASS", calls: [] })),
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

vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

import {
  useSelfDriveStore,
  selectPausedCapability,
  selectPausedSessionContext,
} from "../../stores/selfDriveStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useGuideStore } from "../../stores/guideStore";
import { useSettingsStore } from "../../stores/settingsStore";

// ── Helpers ──────────────────────────────────────────────────────────────

const PROJECT = "/tmp/sd-cap-proj";
const SESSION = "sess-cap-1";

function sessionFixture(): Session {
  return {
    id: SESSION,
    name: `Claude ${SESSION}`,
    project_path: PROJECT,
    status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    model: "claude-sonnet-4-20250514",
    icon_index: 0,
  };
}

function guideWithRequires(requires: string[]): ImplementationGuide {
  return {
    id: `guide-${PROJECT}`,
    projectPath: PROJECT,
    specFilename: "spec.md",
    auditFilename: null,
    title: `Guide for ${PROJECT}`,
    sessions: [
      {
        index: 1,
        name: "Payments",
        scope: "Phase 1",
        readSections: "Section 1",
        files: ["src/a.ts"],
        prompt: "Build payments.",
        verifyChecks: [{ id: "v-1-0", label: "Check A", checked: false }],
        requires,
        status: "active",
        promptSent: false,
        verifyRequested: false,
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
  };
}

function rigListen(): void {
  mockListen.mockImplementation(async () => vi.fn());
}

function setupReady(requires: string[]): void {
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
  useSessionStore.getState().addSession(sessionFixture());
  useSessionStore.setState({ activeSessionId: SESSION, activeProjectPath: PROJECT });
  useGuideStore.setState({ guide: guideWithRequires(requires), loading: false });
}

// A status where the project as a whole is satisfied, but a specific
// capability is missing — only the per-session gate can catch this.
function statusWithMissing(capId: string) {
  return {
    projectId: PROJECT,
    allSatisfied: true,
    blockingCount: 0,
    optionalCount: 0,
    capabilities: [
      {
        projectId: PROJECT,
        capabilityId: capId,
        state: "missing",
        lastChecked: 0,
        userAcknowledgedOptionalSkip: false,
      },
    ],
  };
}

function statusAllSatisfied(capId: string) {
  return {
    projectId: PROJECT,
    allSatisfied: true,
    blockingCount: 0,
    optionalCount: 0,
    capabilities: [
      {
        projectId: PROJECT,
        capabilityId: capId,
        state: "satisfied",
        lastChecked: 0,
        userAcknowledgedOptionalSkip: false,
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Self-Drive capability pause (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    rigListen();
  });

  it("pauses on a missing session capability and exposes it to the AppShell selectors", async () => {
    setupReady(["stripe"]);
    mockPreflightStatus.mockResolvedValue(statusWithMissing("stripe"));

    await useSelfDriveStore.getState().start();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("paused");
    expect(state.activeBlocker?.kind).toBe("capability-missing");
    expect(state.activeBlocker?.capabilityId).toBe("stripe");
    // No build prompt was dispatched — nothing was executed.
    expect(mockSendMessage).not.toHaveBeenCalled();

    // The values AppShell binds to PreflightTray.pausedReason + MidRunPauseModal.
    expect(selectPausedCapability(state)).toEqual({ capabilityName: "stripe" });
    expect(selectPausedSessionContext(state)).toEqual({
      sessionName: "Payments",
      sessionIndex: 1,
    });
  });

  it("does not pause (and dispatches the build prompt) when the capability is satisfied", async () => {
    setupReady(["stripe"]);
    mockPreflightStatus.mockResolvedValue(statusAllSatisfied("stripe"));

    await useSelfDriveStore.getState().start();

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("running");
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    // Nothing to surface to the tray / modal.
    expect(selectPausedCapability(state)).toBeNull();
    expect(selectPausedSessionContext(state)).toBeNull();
  });

  it("re-engages the recovery path on Resume after the capability is fixed", async () => {
    setupReady(["stripe"]);
    mockPreflightStatus.mockResolvedValue(statusWithMissing("stripe"));
    await useSelfDriveStore.getState().start();
    expect(useSelfDriveStore.getState().status).toBe("paused");
    mockSendMessage.mockClear();

    // User fixes the capability (status now satisfied) and answers in chat.
    mockPreflightStatus.mockResolvedValue(statusAllSatisfied("stripe"));
    useSessionStore.getState().addMessage(SESSION, {
      id: "user-fixed-1",
      role: "user",
      content: "I've set up Stripe — please continue.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    await useSelfDriveStore.getState().resume();

    // Recovery engaged: the run left the paused state and a recovery prompt
    // was dispatched to the worker.
    expect(useSelfDriveStore.getState().status).not.toBe("idle");
    expect(mockSendMessage).toHaveBeenCalled();
  });
});
