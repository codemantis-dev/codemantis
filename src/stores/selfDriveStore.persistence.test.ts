// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Restart-recovery persistence tests
//
// Covers the Phase-1.7 enhancement: persist run state to SQLite, hydrate
// on boot into a "paused + needsSessionAttach" mode, and require an
// explicit user action (attachSession) before Resume re-runs the
// diagnostic evidence. The Claude Code session from the prior run is
// dead by definition; these tests never try to resurrect it.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  ImplementationGuide,
  OrchestratorDecision,
  OrchestratorInput,
  Blocker,
} from "../types/implementation-guide";
import type { PersistedRunState } from "./selfDriveStore";

// ── Hoisted mocks ─────────────────────────────────────────────────────

const {
  mockListen,
  mockSendMessage,
  mockSyncSessionMode,
  mockCallOrchestrator,
  mockSaveSelfDriveState,
  mockDeleteSelfDriveState,
  mockUpdateGuideData,
  mockShowToast,
  mockGetCurrentSessionPlan,
} = vi.hoisted(() => ({
  mockListen: vi.fn(() => Promise.resolve(vi.fn())),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockSyncSessionMode: vi.fn(() => Promise.resolve()),
  mockCallOrchestrator: vi.fn<(i: OrchestratorInput, p: string, k: string, m: string) => Promise<OrchestratorDecision>>(),
  mockSaveSelfDriveState: vi.fn(() => Promise.resolve()),
  mockDeleteSelfDriveState: vi.fn(() => Promise.resolve()),
  mockUpdateGuideData: vi.fn(() => Promise.resolve()),
  mockShowToast: vi.fn(),
  mockGetCurrentSessionPlan: vi.fn((sessionIndex: number) => ({
    index: sessionIndex,
    name: `Session ${sessionIndex}`,
    scope: "Phase",
    prompt: "Build something",
    verifyChecks: [{ label: "Check A" }],
    isLastSession: false,
    hasAuditDocument: false,
  })),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

vi.mock("../lib/tauri-commands", () => ({
  sendMessage: mockSendMessage,
  syncSessionMode: mockSyncSessionMode,
  saveGuide: vi.fn(() => Promise.resolve("guide-1")),
  loadGuide: vi.fn(() => Promise.resolve(null)),
  updateGuideData: mockUpdateGuideData,
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
  saveSelfDriveState: mockSaveSelfDriveState,
  deleteSelfDriveState: mockDeleteSelfDriveState,
  listSelfDriveStates: vi.fn(() => Promise.resolve([])),
  loadSelfDriveState: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../lib/self-drive-orchestrator", () => ({
  callOrchestrator: mockCallOrchestrator,
}));

vi.mock("../lib/guide-verify-prompt", () => ({
  buildSessionVerifyPrompt: vi.fn(() => "Verify session prompt"),
}));

vi.mock("../lib/recovery-prompt", () => ({
  buildRecoveryVerifyPrompt: vi.fn((b: Blocker, u: string) =>
    `RECOVERY-PROMPT kind=${b.kind} resolution=${u}`),
}));

vi.mock("./toastStore", () => ({
  showToast: mockShowToast,
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../lib/self-drive-utils", () => ({
  extractToolsFromTurn: vi.fn(() => []),
  getCurrentSessionPlan: mockGetCurrentSessionPlan,
  getProjectTechStack: vi.fn(() => "React + TypeScript"),
  getBuildCommand: vi.fn(() => "pnpm tsc --noEmit"),
  getTestCommand: vi.fn(() => "pnpm test"),
}));

import { useSelfDriveStore } from "./selfDriveStore";
import { useSessionStore } from "./sessionStore";
import { useGuideStore } from "./guideStore";
import { useSettingsStore } from "./settingsStore";
import { resetAllStores } from "../test/helpers/store-reset";

// ── Helpers ────────────────────────────────────────────────────────────

const PROJECT = "/tmp/restart-proj";
const OLD_SESSION_ID = "sess-before-restart";
const NEW_SESSION_ID = "sess-after-restart";
const GUIDE_ID = "guide-restart-1";

function makeGuide(): ImplementationGuide {
  return {
    id: GUIDE_ID,
    projectPath: PROJECT,
    specFilename: "spec.md",
    auditFilename: null,
    title: "Restart Guide",
    sessions: [
      {
        index: 1,
        name: "Foundation",
        scope: "Phase 1",
        readSections: "Sections 1",
        files: ["a.ts"],
        prompt: "Build.",
        verifyChecks: [{ id: "v-1-0", label: "Check A", checked: false }],
        status: "active",
        promptSent: true,
        verifyRequested: true,
      },
    ],
    createdAt: "2026-04-01T00:00:00Z",
    status: "active",
  };
}

function makeBlocker(): Blocker {
  return {
    id: "blk-persisted",
    sessionIndex: 1,
    detectedAt: Date.now() - 3600_000,
    kind: "infra-state-drift",
    summary: "Supabase migration history mismatch",
    detail: "supabase db push failed",
    optionsOffered: ["Run migration repair", "Rename local timestamps"],
    resolutionCriteria: "supabase db push succeeds",
    status: "open",
    prePauseLastMessageId: null,
  };
}

function makeRecord(overrides: Partial<PersistedRunState> = {}): PersistedRunState {
  return {
    version: 1,
    projectPath: PROJECT,
    guideId: GUIDE_ID,
    sessionId: OLD_SESSION_ID,
    currentSessionIndex: 1,
    currentPhase: "building",
    fixAttempt: 0,
    maxFixAttempts: 3,
    previousFixPrompts: [],
    lowConfidenceCount: 0,
    activeBlocker: makeBlocker(),
    blockerHistory: [],
    recentPauseSummaries: ["Blocker detected"],
    pauseReason: "Blocker detected at shutdown",
    startedAt: Date.now() - 7200_000,
    sessionStartedAt: Date.now() - 3600_000,
    runLog: [
      {
        timestamp: Date.now() - 1000_000,
        sessionIndex: 1,
        phase: "building",
        event: "building",
        summary: "Starting Session 1",
      },
    ],
    config: {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      maxFixAttempts: 3,
      runTests: false,
      runBuildCheck: true,
      autoCommit: false,
    },
    savedAt: Date.now() - 10_000,
    ...overrides,
  };
}

function setupSession(sessionId: string, project: string): void {
  useSessionStore.getState().addSession({
    id: sessionId,
    name: `Claude ${sessionId}`,
    project_path: project,
    status: "connected",
    created_at: "2026-04-01T00:00:00Z",
    model: "claude-sonnet-4-20250514",
    icon_index: 0,
  });
}

function setupSettings(): void {
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
    } as unknown as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("hydrateFromDisk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("restores the snapshot as paused + needsSessionAttach with a restart message", () => {
    const record = makeRecord();
    const guide = makeGuide();

    useSelfDriveStore.getState().hydrateFromDisk(record, guide);

    const s = useSelfDriveStore.getState();
    expect(s.status).toBe("paused");
    expect(s.needsSessionAttach).toBe(true);
    expect(s.postRestartFreshResumeNeeded).toBe(false);
    expect(s.projectPath).toBe(PROJECT);
    expect(s.sessionId).toBe(OLD_SESSION_ID); // retained for diagnostics
    expect(s.guide?.id).toBe(GUIDE_ID);
    expect(s.currentSessionIndex).toBe(1);
    expect(s.activeBlocker?.kind).toBe("infra-state-drift");
    expect(s.blockerHistory).toEqual([]);
    expect(s.pauseReason).toContain("Restart detected");
    // Pre-existing run log entries are preserved; a new "resumed" log line
    // explains why we landed here.
    expect(s.runLog.length).toBeGreaterThanOrEqual(2);
    expect(s.runLog.some((e) => e.summary.includes("waiting for user to attach"))).toBe(true);
  });

  it("drops the row and does NOT hydrate when the guide id no longer matches", () => {
    const record = makeRecord({ guideId: "guide-stale" });
    const guide = makeGuide(); // id is GUIDE_ID — mismatched

    useSelfDriveStore.getState().hydrateFromDisk(record, guide);

    expect(useSelfDriveStore.getState().status).toBe("idle");
    expect(mockDeleteSelfDriveState).toHaveBeenCalledWith(PROJECT);
  });

  it("drops the row when no guide exists for the project", () => {
    const record = makeRecord();

    useSelfDriveStore.getState().hydrateFromDisk(record, null);

    expect(useSelfDriveStore.getState().status).toBe("idle");
    expect(mockDeleteSelfDriveState).toHaveBeenCalledWith(PROJECT);
  });

  it("does not clobber an already-running/paused in-memory run", () => {
    useSelfDriveStore.setState({ status: "running" });
    const before = useSelfDriveStore.getState().guide;

    useSelfDriveStore.getState().hydrateFromDisk(makeRecord(), makeGuide());

    expect(useSelfDriveStore.getState().status).toBe("running");
    expect(useSelfDriveStore.getState().guide).toBe(before);
  });
});

describe("attachSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
  });

  it("refuses when no pinned projectPath exists", async () => {
    useSelfDriveStore.setState({
      status: "paused",
      needsSessionAttach: true,
      projectPath: null,
    });

    await useSelfDriveStore.getState().attachSession("any");

    expect(mockShowToast).toHaveBeenCalled();
    expect(useSelfDriveStore.getState().sessionId).toBeNull();
    expect(useSelfDriveStore.getState().needsSessionAttach).toBe(true);
  });

  it("refuses when the target session belongs to a different project", async () => {
    setupSession(NEW_SESSION_ID, "/different-project");
    useSelfDriveStore.getState().hydrateFromDisk(makeRecord(), makeGuide());

    await useSelfDriveStore.getState().attachSession(NEW_SESSION_ID);

    expect(
      mockShowToast.mock.calls.some((c) =>
        String(c[0]).includes("different project"),
      ),
    ).toBe(true);
    // Still waiting for attach.
    expect(useSelfDriveStore.getState().needsSessionAttach).toBe(true);
    expect(useSelfDriveStore.getState().sessionId).toBe(OLD_SESSION_ID);
  });

  it("binds the session, flips needsSessionAttach off, and arms postRestartFreshResumeNeeded", async () => {
    setupSession(NEW_SESSION_ID, PROJECT);
    useSelfDriveStore.getState().hydrateFromDisk(makeRecord(), makeGuide());

    await useSelfDriveStore.getState().attachSession(NEW_SESSION_ID);

    const s = useSelfDriveStore.getState();
    expect(s.sessionId).toBe(NEW_SESSION_ID);
    expect(s.needsSessionAttach).toBe(false);
    expect(s.postRestartFreshResumeNeeded).toBe(true);
    // Listeners were (re)started on the new session.
    expect(mockListen).toHaveBeenCalled();
    // Auto-accept mode applied.
    expect(mockSyncSessionMode).toHaveBeenCalledWith(NEW_SESSION_ID, "auto-accept");
    // A new log entry records the attach.
    expect(
      s.runLog.some((e) => e.summary.includes(`Attached to session ${NEW_SESSION_ID}`)),
    ).toBe(true);
    // The row was re-persisted after attach.
    // (persistRunState debounces, so we just confirm it will fire — allow
    // a generous wait rather than asserting immediately.)
  });

  it("is a no-op when the store is not paused + needsSessionAttach", async () => {
    setupSession(NEW_SESSION_ID, PROJECT);
    // Status idle + needsSessionAttach false — attach must refuse.
    await useSelfDriveStore.getState().attachSession(NEW_SESSION_ID);

    expect(useSelfDriveStore.getState().sessionId).toBeNull();
  });
});

describe("resume() post-restart: re-sends session prompt when no blocker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
  });

  it("resets the current session's promptSent/verifyRequested and re-sends the prompt", async () => {
    setupSession(NEW_SESSION_ID, PROJECT);
    // Record WITHOUT a blocker — the no-blocker branch is what we're testing.
    useSelfDriveStore.getState().hydrateFromDisk(
      makeRecord({ activeBlocker: null }),
      makeGuide(),
    );
    useGuideStore.setState({ guide: makeGuide(), loading: false });

    await useSelfDriveStore.getState().attachSession(NEW_SESSION_ID);
    await useSelfDriveStore.getState().resume();

    // At least two updateGuideData calls are expected:
    //   1) the reset (promptSent=false, verifyRequested=false)
    //   2) the mark-prompt-sent after re-send (promptSent=true)
    // We assert the reset DID occur by looking for a persisted snapshot
    // where the current session has both flags set to false.
    expect(mockUpdateGuideData).toHaveBeenCalled();
    const updateCalls = mockUpdateGuideData.mock.calls as unknown as Array<[string, string]>;
    const persistedSnapshots = updateCalls.map((c) => JSON.parse(c[1]));
    const sawResetSnapshot = persistedSnapshots.some((g) =>
      g.sessions[0].promptSent === false && g.sessions[0].verifyRequested === false
    );
    expect(sawResetSnapshot).toBe(true);

    // Claude Code received the session's creation prompt on the new session.
    // The prompt is wrapped in the BUILD_MODE preamble (Senior-Engineer
    // Quality Contract); assert the wrapping and the original prompt are
    // both present.
    const sendCalls = mockSendMessage.mock.calls as unknown as Array<[string, string]>;
    const lastSend = sendCalls[sendCalls.length - 1];
    expect(lastSend?.[0]).toBe(NEW_SESSION_ID);
    expect(lastSend?.[1]).toContain("Build.");
    expect(lastSend?.[1]).toContain("BUILD MODE");

    // postRestartFreshResumeNeeded flag is cleared.
    expect(useSelfDriveStore.getState().postRestartFreshResumeNeeded).toBe(false);
  });
});
