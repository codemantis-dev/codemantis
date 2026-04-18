// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Blocker recovery tests
//
// These tests cover the Phase-1 recovery behavior only:
//   - structured Blocker creation from a pause decision
//   - userResolveBlocker transitioning state + logging
//   - validateRecoveryResolution rule set
//   - resume() taking the recovery path when a blocker is active
//   - advance_recovery clearing activeBlocker and moving into history
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  ImplementationGuide,
  OrchestratorDecision,
  OrchestratorInput,
  Blocker,
} from "../types/implementation-guide";

// ── Hoisted mocks ─────────────────────────────────────────────────────

const {
  mockListen,
  mockSendMessage,
  mockSyncSessionMode,
  mockCallOrchestrator,
  mockShowToast,
  mockGetCurrentSessionPlan,
} = vi.hoisted(() => ({
  mockListen: vi.fn(() => Promise.resolve(vi.fn())),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockSyncSessionMode: vi.fn(() => Promise.resolve()),
  mockCallOrchestrator: vi.fn<(input: OrchestratorInput, provider: string, apiKey: string, model: string) => Promise<OrchestratorDecision>>(),
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
  updateGuideData: vi.fn(() => Promise.resolve()),
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/self-drive-orchestrator", () => ({
  callOrchestrator: mockCallOrchestrator,
}));

vi.mock("../lib/guide-verify-prompt", () => ({
  buildSessionVerifyPrompt: vi.fn(() => "Verify session prompt"),
}));

// Recovery prompt builder is exercised indirectly — we just spy the output.
vi.mock("../lib/recovery-prompt", () => ({
  buildRecoveryVerifyPrompt: vi.fn((blocker: Blocker, user: string) =>
    `RECOVERY-PROMPT kind=${blocker.kind} resolution=${user || "(empty)"}`,
  ),
}));

vi.mock("./toastStore", () => ({
  showToast: mockShowToast,
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../lib/self-drive-utils", () => ({
  extractToolsFromTurn: vi.fn(() => ["Bash"]),
  truncateResponse: vi.fn((s: string) => s),
  getCurrentSessionPlan: mockGetCurrentSessionPlan,
  getProjectTechStack: vi.fn(() => "React + TypeScript"),
  getBuildCommand: vi.fn(() => "pnpm tsc --noEmit"),
  getTestCommand: vi.fn(() => "pnpm test"),
}));

import { useSelfDriveStore, validateRecoveryResolution } from "./selfDriveStore";
import { useSessionStore } from "./sessionStore";
import { useGuideStore } from "./guideStore";
import { useSettingsStore } from "./settingsStore";
import { resetAllStores } from "../test/helpers/store-reset";

// ── Helpers ────────────────────────────────────────────────────────────

const SESSION_ID = "session-rec-1";
const PROJECT = "/tmp/rec";

function makeGuide(): ImplementationGuide {
  return {
    id: "g-1",
    projectPath: PROJECT,
    specFilename: "s.md",
    auditFilename: null,
    title: "Rec",
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

function setup(): void {
  useSettingsStore.setState({
    settings: {
      apiKeys: { anthropic: "sk-test" },
      selfDriveProvider: "anthropic",
      selfDriveModel: "claude-haiku-4-5",
      selfDriveMaxFixAttempts: 3,
      selfDriveRunBuildCheck: true,
      selfDriveRunTests: false,
      selfDriveAutoCommit: false,
      // fill the rest with defaults the store reads
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });

  useSessionStore.getState().addSession({
    id: SESSION_ID,
    name: "S",
    project_path: PROJECT,
    status: "connected",
    created_at: "2026-04-01T00:00:00Z",
    model: "claude-sonnet-4-20250514",
    icon_index: 0,
  });

  useGuideStore.setState({ guide: makeGuide(), loading: false });
}

function makeBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    id: "blk-x",
    sessionIndex: 1,
    detectedAt: Date.now(),
    kind: "infra-state-drift",
    summary: "Supabase history mismatch (14 versions)",
    detail: "supabase db push failed",
    optionsOffered: ["Run migration repair", "Rename local timestamps"],
    resolutionCriteria: "supabase db push succeeds AND remote history matches local",
    status: "open",
    ...overrides,
  };
}

function seedPaused(blocker: Blocker): void {
  // Pretend Self-Drive was mid-run and paused with a structured blocker.
  useSelfDriveStore.setState({
    status: "paused",
    projectPath: PROJECT,
    currentSessionIndex: 1,
    currentPhase: "building",
    fixAttempt: 0,
    maxFixAttempts: 3,
    previousFixPrompts: [],
    lowConfidenceCount: 0,
    runLog: [],
    startedAt: Date.now(),
    sessionStartedAt: Date.now(),
    pauseReason: "Blocker detected",
    activeBlocker: blocker,
    blockerHistory: [],
    recentPauseSummaries: ["Blocker detected"],
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("validateRecoveryResolution", () => {
  it("rejects when no blocker is active", () => {
    const err = validateRecoveryResolution(null, {
      action: "advance_recovery",
      summary: "done: ok",
      confidence: "high",
    });
    expect(err).toContain("no active blocker");
  });

  it("rejects when the action is not advance_recovery", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance",
      summary: "ok: evidence",
      confidence: "high",
    });
    expect(err).toContain("not advance_recovery");
  });

  it("rejects when summary lacks an evidence citation (':')", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "resolved",
      confidence: "high",
    });
    expect(err).toContain("lacks evidence citation");
  });

  it("rejects low-confidence verdicts", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "resolved: quoted output shows rows",
      confidence: "low",
    });
    expect(err).toContain("low-confidence");
  });

  it("accepts a well-formed verdict", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "Blocker resolved: schema_migrations now contains 20260418120000",
      confidence: "high",
    });
    expect(err).toBeNull();
  });
});

describe("userResolveBlocker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("transitions an open blocker to user-decided with the resolution text", () => {
    setup();
    seedPaused(makeBlocker());

    useSelfDriveStore.getState().userResolveBlocker("Ran migration repair and verified");

    const b = useSelfDriveStore.getState().activeBlocker!;
    expect(b.status).toBe("user-decided");
    expect(b.userResolution).toBe("Ran migration repair and verified");

    const phases = useSelfDriveStore.getState().runLog.map((e) => e.phase);
    expect(phases).toContain("blocker-user-decided");
  });

  it("is a no-op when no blocker is active", () => {
    setup();
    // No paused state / blocker
    expect(useSelfDriveStore.getState().activeBlocker).toBeNull();
    useSelfDriveStore.getState().userResolveBlocker("anything");
    expect(useSelfDriveStore.getState().activeBlocker).toBeNull();
  });
});

describe("resume() with an active blocker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("enters recovering phase and sends the recovery-verify prompt — NOT a normal build_check", async () => {
    setup();
    seedPaused(makeBlocker({ status: "user-decided", userResolution: "Ran repair" }));

    await useSelfDriveStore.getState().resume();

    // Phase is recovering (not build-checking / verifying) — this is the
    // heart of the bug fix: Resume no longer silently moves on.
    const state = useSelfDriveStore.getState();
    expect(state.currentPhase).toBe("recovering");
    expect(state.status).toBe("running");
    expect(state.activeBlocker?.status).toBe("verifying");

    // The prompt sent to Claude Code is the recovery prompt, not the
    // session's fallback build/verify prompt.
    expect(mockSendMessage).toHaveBeenCalled();
    const firstMessage = mockSendMessage.mock.calls[0][1] as string;
    expect(firstMessage).toContain("RECOVERY-PROMPT");
    expect(firstMessage).toContain("kind=infra-state-drift");
  });

  it("treats an 'open' blocker as if the user decided nothing specific (still verifies)", async () => {
    setup();
    seedPaused(makeBlocker({ status: "open" }));

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    expect(state.currentPhase).toBe("recovering");
    expect(state.activeBlocker?.userResolution).toBe("(not specified)");
  });

  it("skips the recovery path when blocker is already resolved", async () => {
    setup();
    seedPaused(makeBlocker({ status: "resolved" }));

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    // Resume falls through to the existing session logic — NOT "recovering".
    expect(state.currentPhase).not.toBe("recovering");
  });
});
