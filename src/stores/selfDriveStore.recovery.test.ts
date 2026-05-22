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
  mockListen: vi.fn((_channel: string, _handler: (e: { payload: unknown }) => void) => Promise.resolve(vi.fn())),
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
  saveSelfDriveState: vi.fn(() => Promise.resolve()),
  loadSelfDriveState: vi.fn(() => Promise.resolve(null)),
  listSelfDriveStates: vi.fn(() => Promise.resolve([])),
  deleteSelfDriveState: vi.fn(() => Promise.resolve()),

  // v1.4.1 Phase A.1: mirror production listenChatEvents dual-channel
  // subscribe via mockListen so existing assertions still observe the
  // listener channels.
  listenChatEvents: vi.fn((sessionId: string, callback: (e: unknown) => void) => {
    const handler = (e: { payload: unknown }): void => callback(e.payload);
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
  getCurrentSessionPlan: mockGetCurrentSessionPlan,
  getProjectTechStack: vi.fn(() => "React + TypeScript"),
  getBuildCommand: vi.fn(() => "pnpm tsc --noEmit"),
  getTestCommand: vi.fn(() => "pnpm test"),
}));

import { useSelfDriveStore, validateRecoveryResolution, isAcceptAndProceedResolution, handleAdvanceRecovery } from "./selfDriveStore";
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
    // Partial test fixture — only the fields Self-Drive reads matter here.
    // Double-cast via unknown since the full AppSettings shape has 30+
    // unrelated fields we don't need to stub.
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
    } as unknown as ReturnType<typeof useSettingsStore.getState>["settings"],
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
  // Pinned state (sessionId + guide) must be populated — Self-Drive refuses
  // to operate without them now that UI-active reads have been eliminated.
  useSelfDriveStore.setState({
    status: "paused",
    projectPath: PROJECT,
    sessionId: SESSION_ID,
    guide: makeGuide(),
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

  it("rejects bare verdicts that lack any evidence", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "resolved",
      confidence: "high",
    });
    expect(err).toContain("lacks evidence citation");
  });

  it("rejects short summaries even with structural punctuation", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "ok: done",
      confidence: "high",
    });
    expect(err).toContain("lacks evidence citation");
  });

  it("rejects long summaries without any structural marker", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "looks fine to me probably should be okay now I think",
      confidence: "high",
    });
    expect(err).toContain("lacks evidence citation");
  });

  it("rejects low-confidence verdicts", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "resolved: quoted output shows rows for 2026 migration",
      confidence: "low",
    });
    expect(err).toContain("low-confidence");
  });

  it("accepts a colon-separated evidence summary", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "Blocker resolved: schema_migrations now contains 20260418120000",
      confidence: "high",
    });
    expect(err).toBeNull();
  });

  // Regression: real Sonnet output from a stuck recovery loop. Uses
  // semicolons + digits + parentheses as evidence — must NOT be rejected
  // by the punctuation gate.
  it("accepts a semicolon-separated multi-clause evidence summary", () => {
    const err = validateRecoveryResolution(makeBlocker(), {
      action: "advance_recovery",
      summary: "idb-keyval Promise mock fix applied; pnpm test exits 0 on two consecutive runs (2707 passed each), pnpm tsc clean.",
      confidence: "high",
    });
    expect(err).toBeNull();
  });
});

describe("isAcceptAndProceedResolution", () => {
  it("matches the exact phrase from the stuck-loop incident", () => {
    expect(
      isAcceptAndProceedResolution("Accept the flake as pre-existing and proceed to verification phase"),
    ).toBe(true);
  });

  it("matches common accept-pattern verbs", () => {
    expect(isAcceptAndProceedResolution("Accept and continue")).toBe(true);
    expect(isAcceptAndProceedResolution("Skip this for now")).toBe(true);
    expect(isAcceptAndProceedResolution("Ignore the flake")).toBe(true);
    expect(isAcceptAndProceedResolution("Proceed without the fix")).toBe(true);
    expect(isAcceptAndProceedResolution("Override and continue")).toBe(true);
    expect(isAcceptAndProceedResolution("  Move on  ")).toBe(true);
  });

  it("does NOT match resolutions that propose a real fix", () => {
    expect(isAcceptAndProceedResolution("Run migration repair")).toBe(false);
    expect(isAcceptAndProceedResolution("Two separate commits please")).toBe(false);
    expect(isAcceptAndProceedResolution("Rename local timestamps")).toBe(false);
    expect(isAcceptAndProceedResolution("Use approach B")).toBe(false);
  });

  it("rejects empty / null input", () => {
    expect(isAcceptAndProceedResolution("")).toBe(false);
    expect(isAcceptAndProceedResolution(null)).toBe(false);
    expect(isAcceptAndProceedResolution(undefined)).toBe(false);
  });
});

describe("resume() with accept-and-proceed override (kind: unknown)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("short-circuits recovery: marks blocker resolved without sending a Claude turn", async () => {
    setup();
    seedPaused(
      makeBlocker({
        kind: "unknown",
        status: "user-decided",
        userResolution: "Accept the flake as pre-existing and proceed to verification phase",
        // Pinned guide's session at index 1 has status active + verifyRequested true,
        // so post-recovery should call handleVerify (which sends the verify prompt).
      }),
    );

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    // Blocker is resolved without ever entering "recovering" phase.
    expect(state.activeBlocker).toBeNull();
    expect(state.currentPhase).not.toBe("recovering");
    expect(state.blockerHistory).toHaveLength(1);
    expect(state.blockerHistory[0].status).toBe("resolved");

    // Activity feed records the override.
    const phases = state.runLog.map((e) => e.phase);
    expect(phases).toContain("blocker-resolved");
    const overrideEntry = state.runLog.find((e) => e.phase === "blocker-resolved");
    expect(overrideEntry?.summary).toContain("User override accepted");

    // Critically: the recovery prompt was NOT sent to Claude Code.
    // (handleVerify will send a verify prompt, but it must NOT contain
    // "RECOVERY-PROMPT" — that's the marker our mock uses.)
    const recoveryCalls = mockSendMessage.mock.calls.filter((c) =>
      String((c as unknown[])[1]).includes("RECOVERY-PROMPT"),
    );
    expect(recoveryCalls).toHaveLength(0);
  });

  it("does NOT short-circuit when the user picked a real fix option", async () => {
    setup();
    seedPaused(
      makeBlocker({
        kind: "unknown",
        status: "user-decided",
        userResolution: "Run migration repair",
      }),
    );

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    // Normal recovery path — phase is "recovering" and a recovery prompt was sent.
    expect(state.currentPhase).toBe("recovering");
    expect(state.activeBlocker?.status).toBe("verifying");
    const firstArgs = mockSendMessage.mock.calls[0] as unknown as [string, string];
    expect(firstArgs[1]).toContain("RECOVERY-PROMPT");
  });

  it("does NOT short-circuit when blocker.kind is structured (e.g. infra-state-drift)", async () => {
    setup();
    // Even with an "accept" resolution, structured kinds get the
    // recovery round-trip — they need re-verification of live state.
    seedPaused(
      makeBlocker({
        kind: "infra-state-drift",
        status: "user-decided",
        userResolution: "Accept the current migration state as the source of truth",
      }),
    );

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    expect(state.currentPhase).toBe("recovering");
    expect(state.activeBlocker?.status).toBe("verifying");
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
    const firstArgs = mockSendMessage.mock.calls[0] as unknown as [string, string];
    const firstMessage = firstArgs[1];
    expect(firstMessage).toContain("RECOVERY-PROMPT");
    expect(firstMessage).toContain("kind=infra-state-drift");
  });

  it("BLOCKS resume when an 'open' blocker has no userResolution and no chat since pause", async () => {
    setup();
    seedPaused(makeBlocker({ status: "open", prePauseLastMessageId: null }));

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    // Phase-1.5 contract: Resume is not a silent wish — require an answer.
    expect(state.status).toBe("paused");
    expect(state.currentPhase).not.toBe("recovering");
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(state.pauseReason).toContain("Answer in chat or pick an option");
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

// ── Phase-1.5: chat-aware resume + one-click option path ──────────────

describe("pickBlockerOption (Path A — one click)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("records the picked option, injects a chat marker, and triggers resume", async () => {
    setup();
    seedPaused(makeBlocker({ status: "open" }));

    await useSelfDriveStore.getState().pickBlockerOption("Run migration repair");

    // userResolution captured + recovery path taken.
    const state = useSelfDriveStore.getState();
    expect(state.activeBlocker?.userResolution).toContain("Run migration repair");
    expect(state.currentPhase).toBe("recovering");

    // Chat got a visible "Picked option" marker (isSelfDrive so it won't
    // double-count as chat-since-pause).
    const msgs = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    const marker = msgs.find((m) => m.content.includes("Picked option"));
    expect(marker).toBeDefined();
    expect(marker!.isSelfDrive).toBe(true);

    // Recovery prompt went to Claude Code.
    expect(mockSendMessage).toHaveBeenCalled();
    const firstArgs = mockSendMessage.mock.calls[0] as unknown as [string, string];
    expect(firstArgs[1]).toContain("RECOVERY-PROMPT");
  });

  it("is a no-op when no blocker is active", async () => {
    setup();
    // Not paused, no blocker.
    await useSelfDriveStore.getState().pickBlockerOption("anything");
    expect(useSelfDriveStore.getState().activeBlocker).toBeNull();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe("Path B — free-form chat since pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("picks up a user message that arrived AFTER the pause boundary and uses it as the resolution", async () => {
    setup();

    // Seed chat history: one pre-pause message, one post-pause user answer.
    const preId = "m-pre-1";
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: preId,
      role: "assistant",
      content: "Claude: I've finished Session 2. How should I commit?",
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    seedPaused(makeBlocker({ status: "open", prePauseLastMessageId: preId }));
    // User answers in main chat AFTER pause — no userResolution set.
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: "m-user-1",
      role: "user",
      content: "Two separate commits please.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    expect(state.currentPhase).toBe("recovering");
    expect(state.activeBlocker?.userResolution).toContain("Two separate commits please.");

    // Recovery prompt includes the user's chat answer.
    const firstArgs = mockSendMessage.mock.calls[0] as unknown as [string, string];
    expect(firstArgs[1]).toContain("RECOVERY-PROMPT");
    expect(firstArgs[1]).toContain("Two separate commits please.");
  });

  it("ignores self-drive-injected messages when deciding if the user answered", async () => {
    setup();
    const preId = "m-pre-2";
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: preId,
      role: "assistant",
      content: "Claude last message",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    seedPaused(makeBlocker({ status: "open", prePauseLastMessageId: preId }));
    // Only a self-drive system message arrives — must NOT unblock Resume.
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: "m-sd-1",
      role: "assistant",
      content: "Self-Drive: status update",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
      isSelfDrive: true,
    });

    await useSelfDriveStore.getState().resume();

    // Still paused — no real user answer.
    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("paused");
    expect(state.currentPhase).not.toBe("recovering");
  });

  it("combines userResolution AND chat-since-pause when both exist", async () => {
    setup();
    const preId = "m-pre-3";
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: preId,
      role: "assistant",
      content: "anchor",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    seedPaused(
      makeBlocker({
        status: "user-decided",
        userResolution: "Picked option 1",
        prePauseLastMessageId: preId,
      }),
    );
    useSessionStore.getState().addMessage(SESSION_ID, {
      id: "m-follow-up",
      role: "user",
      content: "Actually, also rename the files.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });

    await useSelfDriveStore.getState().resume();

    const state = useSelfDriveStore.getState();
    expect(state.activeBlocker?.userResolution).toContain("Picked option 1");
    expect(state.activeBlocker?.userResolution).toContain("Actually, also rename the files.");
  });
});

describe("useBlockerHasResolution helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("returns true when no blocker is active (no constraint)", () => {
    setup();
    expect(useSelfDriveStore.getState().activeBlocker).toBeNull();
    // We can't call hooks outside React, but we can exercise the same
    // logic through resume() — a null blocker must not block resume.
  });

  it("blocks resume with a clear pauseReason when nothing resolves", async () => {
    setup();
    seedPaused(makeBlocker({ status: "open", prePauseLastMessageId: null }));
    await useSelfDriveStore.getState().resume();
    const state = useSelfDriveStore.getState();
    expect(state.pauseReason).toContain("Answer in chat or pick an option");
    // A "paused" log entry explains why to the user.
    const explain = state.runLog.find((e) => e.summary.includes("Resume blocked"));
    expect(explain).toBeDefined();
  });
});

// ── handleAdvanceRecovery: parity-recovery short-circuit ───────────────
//
// Regression: 2026-05-15 incident. When a parity-recovery turn completed
// and the orchestrator emitted `advance_recovery`, the store routed it
// through handleAdvanceRecovery, which requires `state.activeBlocker` to
// be non-null. Parity-recovery never sets activeBlocker (it's a
// deterministic file-system gate, not a real blocker), so the session
// paused with "Recovery rejected: no active blocker to resolve" even
// though the parity gate had been satisfied.

describe("handleAdvanceRecovery — parity-recovery short-circuit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  function seedRunningAfterParityRecovery(): void {
    setup();
    // Mark the verify check on the seeded session as already checked, so
    // attemptMarkSessionComplete won't reject for "checks-incomplete" when
    // the short-circuit delegates to handleAdvance.
    const guide = makeGuide();
    guide.sessions[0].verifyChecks = [{ id: "v-1-0", label: "Check A", checked: true }];
    useGuideStore.setState({ guide, loading: false });
    useSelfDriveStore.setState({
      status: "running",
      projectPath: PROJECT,
      sessionId: SESSION_ID,
      guide,
      currentSessionIndex: 1,
      currentPhase: "fixing",
      fixAttempt: 1,
      maxFixAttempts: 3,
      previousFixPrompts: [],
      lowConfidenceCount: 0,
      runLog: [],
      startedAt: Date.now(),
      sessionStartedAt: Date.now(),
      pauseReason: null,
      activeBlocker: null,
      blockerHistory: [],
      recentPauseSummaries: [],
      lastSelfDrivePromptInjection: "parity-recovery",
    });
  }

  it("does NOT pause when advance_recovery arrives with no active blocker after parity-recovery", async () => {
    seedRunningAfterParityRecovery();

    await handleAdvanceRecovery({
      action: "advance_recovery",
      summary: "Parity gap closed: job_type now at intent_extraction.py lines 4,13",
      confidence: "high",
    });

    const state = useSelfDriveStore.getState();
    // The bug was: pauseReason set to "Recovery rejected: no active blocker to resolve".
    // Fix: short-circuit delegates to handleAdvance instead → no pause with that reason.
    expect(state.pauseReason ?? "").not.toContain("Recovery rejected");
    expect(state.pauseReason ?? "").not.toContain("no active blocker");

    // Log entry confirms the short-circuit ran rather than silent fall-through.
    const reroute = state.runLog.find((e) => e.summary.includes("Re-running parity gate"));
    expect(reroute).toBeDefined();
  });

  it("still pauses with a diagnostic when advance_recovery arrives with no active blocker AND no parity-recovery injection", async () => {
    setup();
    // Same shape as above but injection is null — the structural bug
    // (`advance_recovery` with no blocker from a non-parity context) still
    // pauses, but with an improved diagnostic message naming the injection.
    useSelfDriveStore.setState({
      status: "running",
      projectPath: PROJECT,
      sessionId: SESSION_ID,
      guide: makeGuide(),
      currentSessionIndex: 1,
      currentPhase: "verifying",
      fixAttempt: 0,
      maxFixAttempts: 3,
      previousFixPrompts: [],
      lowConfidenceCount: 0,
      runLog: [],
      startedAt: Date.now(),
      sessionStartedAt: Date.now(),
      pauseReason: null,
      activeBlocker: null,
      blockerHistory: [],
      recentPauseSummaries: [],
      lastSelfDrivePromptInjection: null,
    });

    await handleAdvanceRecovery({
      action: "advance_recovery",
      summary: "Some evidence: digits 123 and quoted output",
      confidence: "high",
    });

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("paused");
    expect(state.pauseReason).toContain("Recovery rejected");
    expect(state.pauseReason).toContain("no active blocker");
    // Improved diagnostic names the injection so future incidents are easier to triage.
    expect(state.pauseReason).toContain("injection=unknown");
    expect(state.pauseReason).toContain("verdict=advance_recovery");
  });

  it("still pauses when advance_recovery is malformed (low confidence) even if a blocker is active", async () => {
    // Sanity: existing validateRecoveryResolution path is unaffected by the new branch.
    setup();
    useSelfDriveStore.setState({
      status: "running",
      projectPath: PROJECT,
      sessionId: SESSION_ID,
      guide: makeGuide(),
      currentSessionIndex: 1,
      currentPhase: "recovering",
      fixAttempt: 0,
      maxFixAttempts: 3,
      previousFixPrompts: [],
      lowConfidenceCount: 0,
      runLog: [],
      startedAt: Date.now(),
      sessionStartedAt: Date.now(),
      pauseReason: null,
      activeBlocker: makeBlocker({ status: "verifying" }),
      blockerHistory: [],
      recentPauseSummaries: [],
      lastSelfDrivePromptInjection: "recovery",
    });

    await handleAdvanceRecovery({
      action: "advance_recovery",
      summary: "fixed: command ran with quoted output showing rows",
      confidence: "low",
    });

    const state = useSelfDriveStore.getState();
    expect(state.status).toBe("paused");
    expect(state.pauseReason).toContain("low-confidence");
  });
});
