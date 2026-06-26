/**
 * Integration test: Duo-Coding two-session orchestration (Phase 1)
 *
 * Drives the REAL duoStore + sessionStore + settingsStore with a mocked Tauri
 * boundary. Covers the end-to-end turn-boundary loop:
 *   1. start() spawns a primary + a READ-ONLY mentor and pins both sessions.
 *   2. A primary turn → mentor review → AGREEMENT is logged, no repair injected.
 *   3. A blocking mentor verdict → a mentor-directed REPAIR is injected into the
 *      PRIMARY's chat (single-writer model — the mentor never edits).
 *   4. Non-convergence after maxDialogueRounds → tie-break PAUSE (default) with a
 *      `duo-deadlock` blocker; listeners are torn down.
 *   5. The mentor session is locked read-only at start.
 *
 * Turns are simulated by pushing an assistant message into the real sessionStore
 * and firing the captured `turn_complete` callback.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import type { Session, Message } from "../../types/session";
import type { FrontendEvent } from "../../types/agent-events";

// ── Hoisted mocks ────────────────────────────────────────────────────────

const {
  chatCallbacks,
  activityCallbacks,
  snapshotCallbacks,
  mockCreateSession,
  mockSendMessage,
  mockSetSessionMode,
  mockSetCodexPolicy,
  mockGetGitDiff,
  mockDuoStartRun,
  mockDuoRecordEvent,
  mockDuoAnalyze,
} = vi.hoisted(() => ({
  chatCallbacks: new Map<string, (e: FrontendEvent) => void>(),
  activityCallbacks: new Map<string, (e: FrontendEvent) => void>(),
  mockCreateSession: vi.fn(),
  mockSendMessage: vi.fn<(sessionId: string, prompt: string) => Promise<void>>(() => Promise.resolve()),
  mockSetSessionMode: vi.fn(() => Promise.resolve()),
  mockSetCodexPolicy: vi.fn(() => Promise.resolve()),
  mockGetGitDiff: vi.fn(() =>
    Promise.resolve({ isGitRepo: true, diff: "+ changed line", added: 1, removed: 0, files: 1, truncated: false }),
  ),
  mockDuoStartRun: vi.fn(() => Promise.resolve()),
  mockDuoRecordEvent: vi.fn(() => Promise.resolve()),
  mockDuoAnalyze: vi.fn<(runId: string) => Promise<unknown>>(() => Promise.resolve({})),
  snapshotCallbacks: [] as Array<(e: unknown) => void>,
}));

vi.mock("../../lib/tauri-commands", () => ({
  createSession: mockCreateSession,
  sendMessage: mockSendMessage,
  closeSession: vi.fn(() => Promise.resolve()),
  setSessionMode: mockSetSessionMode,
  setCodexPolicy: mockSetCodexPolicy,
  getGitDiff: mockGetGitDiff,
  listenChatEvents: vi.fn(async (sessionId: string, cb: (e: FrontendEvent) => void) => {
    chatCallbacks.set(sessionId, cb);
    return () => chatCallbacks.delete(sessionId);
  }),
  listenActivityEvents: vi.fn(async (sessionId: string, cb: (e: FrontendEvent) => void) => {
    activityCallbacks.set(sessionId, cb);
    return () => activityCallbacks.delete(sessionId);
  }),
  duoStartRun: mockDuoStartRun,
  duoRecordEvent: mockDuoRecordEvent,
  duoCompleteRun: vi.fn(() => Promise.resolve()),
  duoLogCompletion: vi.fn(() => Promise.resolve()),
  duoAnalyze: mockDuoAnalyze,
  listenDuoSnapshot: vi.fn(async (cb: (e: unknown) => void) => {
    snapshotCallbacks.push(cb);
    return () => {
      const i = snapshotCallbacks.indexOf(cb);
      if (i >= 0) snapshotCallbacks.splice(i, 1);
    };
  }),
}));

// Imported AFTER the mock so the store binds to the mocked commands.
import { useDuoStore } from "../../stores/duoStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { DEFAULT_DUO_SETTINGS } from "../../types/settings";

const PRIMARY = "primary-sess";
const DUO = "duo-sess";

let msgSeq = 0;
function assistantMsg(content: string): Message {
  msgSeq += 1;
  return {
    id: `a-${msgSeq}`,
    role: "assistant",
    content,
    timestamp: "",
    activityIds: [],
    isStreaming: false,
  };
}

function verdictBlock(obj: Record<string, unknown>): string {
  return "Reviewed.\n\n```duo-verdict\n" + JSON.stringify(obj) + "\n```";
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

async function primaryTurn(text: string, costUsd = 0): Promise<void> {
  useSessionStore.getState().addMessage(PRIMARY, assistantMsg(text));
  chatCallbacks.get(PRIMARY)?.({
    type: "turn_complete",
    session_id: PRIMARY,
    cost_usd: costUsd,
    usage: null,
  } as unknown as FrontendEvent);
  await flush();
}

function primaryToolOp(toolName: string, input: Record<string, unknown>): void {
  activityCallbacks.get(PRIMARY)?.({
    type: "tool_use_start",
    session_id: PRIMARY,
    tool_use_id: `t-${msgSeq}`,
    tool_name: toolName,
    tool_input: input,
  } as unknown as FrontendEvent);
}

async function mentorTurn(obj: Record<string, unknown>): Promise<void> {
  useSessionStore.getState().addMessage(DUO, assistantMsg(verdictBlock(obj)));
  chatCallbacks.get(DUO)?.({ type: "turn_complete", session_id: DUO } as unknown as FrontendEvent);
  await flush();
}

interface StartOpts {
  maxRounds?: number;
  tieBreakPolicy?: "pause" | "mentorWins" | "primaryWins";
  budgetUsdCap?: number | null;
  severeDriftSensitivity?: "conservative" | "balanced" | "aggressive";
  severeDriftNudgeEnabled?: boolean;
  // Default OFF so the base turn-flow tests exercise build→review directly;
  // the plan-gate / live-review tests opt in explicitly.
  planGateEnabled?: boolean;
  liveReviewEnabled?: boolean;
  liveReviewCadence?: "minimal" | "balanced" | "thorough";
}

async function startRun(opts: StartOpts = {}): Promise<void> {
  useSettingsStore.setState((s) => ({
    settings: {
      ...s.settings,
      duo: {
        ...DEFAULT_DUO_SETTINGS,
        enabled: true,
        maxDialogueRounds: opts.maxRounds ?? 3,
        tieBreakPolicy: opts.tieBreakPolicy ?? "pause",
        budgetUsdCap: opts.budgetUsdCap ?? null,
        severeDriftSensitivity: opts.severeDriftSensitivity ?? "conservative",
        severeDriftNudgeEnabled: opts.severeDriftNudgeEnabled ?? true,
        planGateEnabled: opts.planGateEnabled ?? false,
        liveReviewEnabled: opts.liveReviewEnabled ?? false,
        liveReviewCadence: opts.liveReviewCadence ?? "balanced",
      },
    },
  }));
  mockCreateSession.mockImplementation(async (_path: string, name?: string) => {
    return { id: name === "Duo · Mentor" ? DUO : PRIMARY } as unknown as Session;
  });
  await useDuoStore.getState().start({
    task: "Add a logout button",
    projectPath: "/proj",
    primary: { agentId: "codex" },
    duo: { agentId: "claude_code" },
  });
  await flush();
}

describe("Duo-Coding orchestration", () => {
  beforeEach(() => {
    resetAllStores();
    chatCallbacks.clear();
    activityCallbacks.clear();
    snapshotCallbacks.length = 0;
    msgSeq = 0;
    vi.clearAllMocks();
    mockDuoAnalyze.mockResolvedValue({});
  });

  it("spawns both sessions, locks the mentor read-only, and pins them", async () => {
    await startRun();
    const s = useDuoStore.getState();
    expect(s.status).toBe("running");
    expect(s.primarySessionId).toBe(PRIMARY);
    expect(s.duoSessionId).toBe(DUO);
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    // claude_code mentor → plan mode (read-only).
    expect(mockSetSessionMode).toHaveBeenCalledWith(DUO, "plan");
    // The primary received the task as its first prompt.
    expect(mockSendMessage).toHaveBeenCalledWith(PRIMARY, "Add a logout button");
    // Both agents are registered as background sessions (so their chat renders
    // + the orchestrator can read it) without appearing in the tab bar.
    expect(useSessionStore.getState().sessions.get(PRIMARY)?.duoRole).toBe("primary");
    expect(useSessionStore.getState().sessions.get(DUO)?.duoRole).toBe("mentor");
    expect(useSessionStore.getState().tabOrder).not.toContain(PRIMARY);
  });

  it("routes the primary's chat into sessionStore so it renders AND feeds the orchestrator", async () => {
    await startRun();
    // Fire a REAL text_complete (not a manual addMessage) — the duoStore chat
    // listener routes it through handleChatEvent into sessionStore.
    chatCallbacks.get(PRIMARY)?.({
      type: "text_complete",
      session_id: PRIMARY,
      full_text: "Implemented the logout button.",
    } as unknown as FrontendEvent);
    await flush();
    const msgs = useSessionStore.getState().sessionMessages.get(PRIMARY) ?? [];
    expect(msgs.some((m) => m.role === "assistant" && m.content.includes("Implemented the logout button"))).toBe(true);
  });

  it("completes the run (no stall) and injects no repair when the mentor agrees", async () => {
    await startRun();
    mockSendMessage.mockClear();
    await primaryTurn("I added the logout button and tests pass.");
    // Review prompt went to the mentor.
    expect(mockSendMessage.mock.calls.some(([id]) => id === DUO)).toBe(true);
    mockSendMessage.mockClear();

    await mentorTurn({
      stance: "agree", severity: "nit", summary: "Looks correct", rationale: "tests pass",
      confidence: 0.9, ranBuild: true, ranTests: true, citedFiles: ["src/TitleBar.tsx"],
    });

    const s = useDuoStore.getState();
    expect(s.metrics.agreements).toBe(1);
    expect(s.metrics.reviews).toBe(1);
    expect(s.decisionLog.some((d) => d.kind === "agreement")).toBe(true);
    // agree → autonomous completion (no more "running" forever stall).
    expect(s.status).toBe("completed");
    // No repair injected back into the primary.
    expect(mockSendMessage.mock.calls.some(([id]) => id === PRIMARY)).toBe(false);
    // The conversation captured the primary's work AND the mentor's review verdict.
    expect(s.dialogue.some((t) => t.author === "primary" && t.stance === "work")).toBe(true);
    const review = s.dialogue.find((t) => t.author === "duo" && t.stance === "review");
    expect(review?.verdict?.stance).toBe("agree");
    expect(review?.verdict?.ranTests).toBe(true);
  });

  it("injects a mentor-directed repair into the PRIMARY on a blocking verdict", async () => {
    await startRun();
    await primaryTurn("Done, though I skipped error handling.");
    mockSendMessage.mockClear();

    await mentorTurn({
      stance: "concern", severity: "blocking", summary: "Missing error handling",
      rationale: "the click handler can throw", repairTask: "Wrap the handler in try/catch",
      confidence: 0.8, ranBuild: true, ranTests: false,
    });

    const s = useDuoStore.getState();
    expect(s.metrics.disagreements).toBe(1);
    expect(s.metrics.repairs).toBe(1);
    expect(s.repairAttempts).toBe(1);
    expect(s.phase).toBe("dialoguing");
    expect(s.decisionLog.some((d) => d.kind === "disagreement")).toBe(true);
    // The concern was injected into the PRIMARY (sole writer), carrying the task.
    const primaryInjections = mockSendMessage.mock.calls.filter(([id]) => id === PRIMARY);
    expect(primaryInjections.length).toBe(1);
    expect(String(primaryInjections[0][1])).toContain("Wrap the handler in try/catch");
    // Timeline shows the mentor's blocking review and a "repair directed" outcome marker.
    expect(s.dialogue.some((t) => t.author === "duo" && t.verdict?.severity === "blocking")).toBe(true);
    expect(s.dialogue.some((t) => t.author === "system" && t.stance === "repair")).toBe(true);
  });

  it("pauses on a duo-deadlock when the mentor stays blocking past maxDialogueRounds", async () => {
    await startRun({ maxRounds: 1 }); // one dialogue round allowed
    const blocking = {
      stance: "disagree", severity: "blocking", summary: "Still broken",
      rationale: "the fix is wrong", repairTask: "Do it properly",
      confidence: 0.9, ranBuild: true, ranTests: true,
    } as const;

    await primaryTurn("First attempt.");
    await mentorTurn({ ...blocking }); // attempt 0 < 1 → repair injected, attempts=1
    expect(useDuoStore.getState().repairAttempts).toBe(1);

    await primaryTurn("Second attempt."); // primary's repair turn → re-review
    await mentorTurn({ ...blocking }); // attempts 1 >= 1 → tie-break

    const s = useDuoStore.getState();
    expect(s.status).toBe("paused");
    expect(s.phase).toBe("escalated");
    expect(s.blocker?.kind).toBe("duo-deadlock");
    expect(s.decisionLog.some((d) => d.kind === "escalation")).toBe(true);
    // Listeners torn down on pause — a stray event must not advance the run.
    expect(chatCallbacks.size).toBe(0);
  });

  it("re-asks once when the mentor's verdict can't be parsed, then degrades", async () => {
    await startRun();
    await primaryTurn("Implemented.");
    mockSendMessage.mockClear();

    // First mentor turn has no verdict block → one re-ask to the mentor.
    useSessionStore.getState().addMessage(DUO, assistantMsg("I think it's fine, no block here."));
    chatCallbacks.get(DUO)?.({ type: "turn_complete", session_id: DUO } as unknown as FrontendEvent);
    await flush();
    expect(useDuoStore.getState().awaitingReAsk).toBe(true);
    expect(mockSendMessage.mock.calls.some(([id]) => id === DUO)).toBe(true);

    // Still unparseable → degrade to an advisory concern, which now DRIVES a
    // fix turn to the primary (no stall) rather than idling.
    mockSendMessage.mockClear();
    useSessionStore.getState().addMessage(DUO, assistantMsg("still no block"));
    chatCallbacks.get(DUO)?.({ type: "turn_complete", session_id: DUO } as unknown as FrontendEvent);
    await flush();
    const s = useDuoStore.getState();
    expect(s.metrics.reviews).toBe(1);
    expect(s.status).toBe("running"); // not stalled, not completed — a fix is in flight
    expect(mockSendMessage.mock.calls.some(([id]) => id === PRIMARY)).toBe(true);
  });

  it("converges through a dialogue: concern → primary defends → mentor agrees", async () => {
    await startRun();
    await primaryTurn("Implemented the feature.");
    await mentorTurn({
      stance: "concern", severity: "blocking", summary: "No tests",
      rationale: "the new path is uncovered", repairTask: "Add a unit test",
      confidence: 0.8, ranBuild: true, ranTests: true,
    });
    expect(useDuoStore.getState().phase).toBe("dialoguing");

    // Primary responds in-dialogue → routed back to the mentor (no fresh review).
    await primaryTurn("Added a unit test for the new path.");
    expect(mockSendMessage.mock.calls.some(([id]) => id === DUO)).toBe(true);

    // Mentor now agrees → convergence.
    await mentorTurn({
      stance: "agree", severity: "nit", summary: "Coverage added", rationale: "tests present",
      confidence: 0.9, ranBuild: true, ranTests: true,
    });
    const s = useDuoStore.getState();
    // agree after a dispute → run converges and completes.
    expect(s.status).toBe("completed");
    expect(s.phase).toBe("completed");
    expect(s.metrics.agreements).toBe(1);
    expect(s.repairAttempts).toBe(0); // reset on convergence
    // The dialogue captured both sides AND the resolution outcome.
    expect(s.dialogue.some((t) => t.author === "duo" && t.stance === "review")).toBe(true);
    expect(s.dialogue.some((t) => t.author === "primary" && t.stance === "defend")).toBe(true);
    expect(s.dialogue.some((t) => t.author === "system" && t.stance === "resolve")).toBe(true);
  });

  it("tie-break mentorWins forces a repair instead of pausing", async () => {
    await startRun({ maxRounds: 1, tieBreakPolicy: "mentorWins" });
    const blocking = {
      stance: "disagree", severity: "blocking", summary: "Wrong approach",
      rationale: "use a map", repairTask: "Switch to a Map", confidence: 0.9, ranBuild: true, ranTests: true,
    } as const;
    await primaryTurn("v1");
    await mentorTurn({ ...blocking }); // round 0 → dialogue
    await primaryTurn("defending v1"); // dialogue response
    mockSendMessage.mockClear();
    await mentorTurn({ ...blocking }); // repeat → tie-break (mentorWins)

    const s = useDuoStore.getState();
    expect(s.status).toBe("running");
    expect(s.phase).toBe("repairing");
    expect(s.decisionLog.some((d) => d.summary.includes("mentor wins"))).toBe(true);
    expect(s.dialogue.some((t) => t.author === "system" && t.stance === "decision" && /mentor wins/i.test(t.text))).toBe(true);
    expect(mockSendMessage.mock.calls.some(([id]) => id === PRIMARY)).toBe(true);
  });

  it("tie-break primaryWins lets the primary proceed and logs dissent", async () => {
    await startRun({ maxRounds: 1, tieBreakPolicy: "primaryWins" });
    const blocking = {
      stance: "disagree", severity: "blocking", summary: "Disagree on style",
      rationale: "prefer X", repairTask: "Do X", confidence: 0.9, ranBuild: true, ranTests: true,
    } as const;
    await primaryTurn("v1");
    await mentorTurn({ ...blocking });
    await primaryTurn("defending v1");
    await mentorTurn({ ...blocking }); // repeat → tie-break (primaryWins)

    const s = useDuoStore.getState();
    expect(s.status).toBe("running");
    expect(s.phase).toBe("building");
    expect(s.repairAttempts).toBe(0);
    expect(s.decisionLog.some((d) => d.summary.includes("primary proceeds"))).toBe(true);
    expect(s.dialogue.some((t) => t.author === "system" && t.stance === "decision" && /primary proceeds/i.test(t.text))).toBe(true);
  });

  it("pauses on a budget cap once the run cost exceeds it", async () => {
    await startRun({ budgetUsdCap: 0.01 });
    await primaryTurn("expensive turn", 0.05); // cost accrues, then budget guard pauses
    const s = useDuoStore.getState();
    expect(s.status).toBe("paused");
    expect(s.blocker?.summary).toContain("Budget");
    // No review was injected to the mentor — the run halted first.
    expect(mockSendMessage.mock.calls.some(([id]) => id === DUO)).toBe(false);
  });

  it("nudges the primary on severe mid-turn drift (destructive command)", async () => {
    await startRun(); // conservative sensitivity, nudge enabled
    mockSendMessage.mockClear();
    primaryToolOp("Bash", { command: "rm -rf src" });
    await flush();

    const s = useDuoStore.getState();
    expect(s.metrics.driftIncidents).toBe(1);
    expect(s.decisionLog.some((d) => d.kind === "drift")).toBe(true);
    const nudge = mockSendMessage.mock.calls.find(
      ([id, text]) => id === PRIMARY && /off-track/.test(String(text)),
    );
    expect(nudge).toBeDefined();
  });

  it("does not nudge on benign tool activity", async () => {
    await startRun();
    mockSendMessage.mockClear();
    primaryToolOp("Bash", { command: "pnpm test" });
    primaryToolOp("Edit", { file_path: "src/a.ts" });
    await flush();
    expect(useDuoStore.getState().metrics.driftIncidents).toBe(0);
    expect(mockSendMessage.mock.calls.length).toBe(0);
  });

  it("triggers the analyst after a review and ingests its snapshot", async () => {
    await startRun();
    await primaryTurn("Implemented.");
    await mentorTurn({
      stance: "agree", severity: "nit", summary: "ok", rationale: "fine",
      confidence: 0.9, ranBuild: true, ranTests: true,
    });
    // The store kicked the backend analyst for the active run.
    expect(mockDuoAnalyze).toHaveBeenCalledWith(useDuoStore.getState().runId);

    // A backend snapshot for this run flows into the store.
    const report = {
      schemaVersion: 1, headline: "h", narrative: "good progress",
      phaseAssessment: { currentFocus: "x", momentum: "steady", momentumRationale: "" },
      collaborationHealth: { score: 80, trend: "improving", summary: "", frictionPoints: [] },
      qualityAssessment: { score: 70, trajectory: "improving", strengths: [], risks: [] },
      repairAnalysis: { summary: "", rootCausePatterns: [], mentorEffectiveness: "high", mentorEffectivenessRationale: "" },
      improvementAnalysis: { summary: "", delivered: [], preventedIssues: [] },
      decisions: [], recommendations: [], watchItems: [], confidence: 60,
    };
    snapshotCallbacks.forEach((cb) =>
      cb({ runId: useDuoStore.getState().runId, ts: 1, narrative: "good progress", report, series: [] }),
    );
    const snap = useDuoStore.getState().analystSnapshot;
    expect(snap?.narrative).toBe("good progress");
    expect(snap?.report.collaborationHealth.score).toBe(80);
  });

  it("ignores analyst snapshots for a different run", async () => {
    await startRun();
    const report = { schemaVersion: 1, headline: "", narrative: "stale" } as unknown;
    snapshotCallbacks.forEach((cb) =>
      cb({ runId: "some-other-run", ts: 1, narrative: "stale", report, series: [] }),
    );
    expect(useDuoStore.getState().analystSnapshot).toBeNull();
  });

  it("plan gate: primary plans → mentor approves → primary implements", async () => {
    await startRun({ planGateEnabled: true });
    // start() asks the primary for a PLAN first (not code).
    expect(useDuoStore.getState().phase).toBe("planning");
    const firstToPrimary = mockSendMessage.mock.calls.find(([id]) => id === PRIMARY);
    expect(String(firstToPrimary?.[1])).toMatch(/plan|approach/i);

    // Primary returns a plan → routed to the mentor for plan review.
    mockSendMessage.mockClear();
    await primaryTurn("Plan: change server.js + app.js; add tests; risk: API shape.");
    expect(mockSendMessage.mock.calls.some(([id]) => id === DUO)).toBe(true);

    // Mentor approves the plan → primary told to implement, phase → building.
    mockSendMessage.mockClear();
    await mentorTurn({
      stance: "agree", severity: "nit", summary: "Approach is sound",
      rationale: "covers the right files", confidence: 0.9, ranBuild: false, ranTests: false,
    });
    const s = useDuoStore.getState();
    expect(s.phase).toBe("building");
    expect(s.decisionLog.some((d) => /Plan approved/i.test(d.summary))).toBe(true);
    const implementMsg = mockSendMessage.mock.calls.find(([id]) => id === PRIMARY);
    expect(String(implementMsg?.[1])).toMatch(/implement/i);
  });

  it("plan gate: mentor redirects the plan → primary revises (still no code)", async () => {
    await startRun({ planGateEnabled: true });
    await primaryTurn("Plan: rewrite everything from scratch.");
    mockSendMessage.mockClear();
    await mentorTurn({
      stance: "concern", severity: "blocking", summary: "Don't rewrite",
      rationale: "extend the existing server", repairTask: "Reuse server.js; add an endpoint",
      confidence: 0.8, ranBuild: false, ranTests: false,
    });
    const s = useDuoStore.getState();
    expect(s.phase).toBe("planning"); // still planning — revising, not coding
    const revise = mockSendMessage.mock.calls.find(([id]) => id === PRIMARY);
    expect(String(revise?.[1])).toMatch(/revise|plan/i);
  });

  it("live co-review: edits trigger a mentor review → a clear defect interleaves a nudge", async () => {
    await startRun({ liveReviewEnabled: true });
    expect(useDuoStore.getState().phase).toBe("building");
    mockSendMessage.mockClear();

    // Five mutating edits reach the op threshold → an incremental mentor review.
    for (let i = 0; i < 5; i++) primaryToolOp("Edit", { file_path: `src/file${i}.ts` });
    await flush();
    expect(mockSendMessage.mock.calls.some(([id]) => id === DUO)).toBe(true);

    // Mentor flags a clear defect → a concise nudge is interleaved to the primary
    // WITHOUT starting a dialogue round (live navigator behavior).
    mockSendMessage.mockClear();
    await mentorTurn({
      stance: "concern", severity: "blocking", summary: "Wrong variable",
      rationale: "you used foo, meant bar", repairTask: "Rename foo → bar in file2.ts",
      confidence: 0.9, ranBuild: false, ranTests: false,
    });
    const s = useDuoStore.getState();
    const nudge = mockSendMessage.mock.calls.find(([id]) => id === PRIMARY);
    expect(String(nudge?.[1])).toContain("Rename foo → bar");
    expect(s.repairAttempts).toBe(0); // not a dialogue round
    expect(s.status).toBe("running"); // never completes on a live review
    expect(s.phase).toBe("building"); // primary keeps working
  });

  it("live co-review: an unchanged working tree is not re-reviewed (skip-unchanged)", async () => {
    await startRun({ liveReviewEnabled: true });
    mockSendMessage.mockClear();

    // First checkpoint → a live review of the current diff (mock returns a fixed diff).
    primaryToolOp("Bash", { command: "npm test" });
    await flush();
    expect(mockSendMessage.mock.calls.filter(([id]) => id === DUO).length).toBe(1);

    // Mentor finishes the live review (free again).
    await mentorTurn({
      stance: "agree", severity: "nit", summary: "looks fine so far",
      rationale: "", confidence: 0.9, ranBuild: false, ranTests: false,
    });
    expect(useDuoStore.getState().status).toBe("running"); // live review never completes

    // Second checkpoint with the SAME diff → skipped, no second mentor injection.
    mockSendMessage.mockClear();
    primaryToolOp("Bash", { command: "npm test" });
    await flush();
    expect(mockSendMessage.mock.calls.filter(([id]) => id === DUO).length).toBe(0);
  });

  it("live co-review: a changed diff after a review IS re-reviewed", async () => {
    await startRun({ liveReviewEnabled: true });
    mockSendMessage.mockClear();

    primaryToolOp("Bash", { command: "npm test" });
    await flush();
    expect(mockSendMessage.mock.calls.filter(([id]) => id === DUO).length).toBe(1);
    await mentorTurn({
      stance: "agree", severity: "nit", summary: "ok", rationale: "",
      confidence: 0.9, ranBuild: false, ranTests: false,
    });

    // The working tree changed since the last review → a fresh review fires.
    mockGetGitDiff.mockResolvedValueOnce({
      isGitRepo: true, diff: "+ a different line", added: 1, removed: 0, files: 1, truncated: false,
    });
    mockSendMessage.mockClear();
    primaryToolOp("Bash", { command: "npm test" });
    await flush();
    expect(mockSendMessage.mock.calls.filter(([id]) => id === DUO).length).toBe(1);
  });

  it("heartbeat: a long quiet stretch with no tool activity still triggers a review", async () => {
    vi.useFakeTimers();
    try {
      useSettingsStore.setState((s) => ({
        settings: {
          ...s.settings,
          duo: {
            ...DEFAULT_DUO_SETTINGS,
            enabled: true,
            planGateEnabled: false,
            liveReviewEnabled: true,
            liveReviewCadence: "thorough", // 90s heartbeat
          },
        },
      }));
      mockCreateSession.mockImplementation(async (_path: string, name?: string) => {
        return { id: name === "Duo · Mentor" ? DUO : PRIMARY } as unknown as Session;
      });
      await useDuoStore.getState().start({
        task: "Add a logout button",
        projectPath: "/proj",
        primary: { agentId: "codex" },
        duo: { agentId: "claude_code" },
      });
      expect(useDuoStore.getState().phase).toBe("building");
      mockSendMessage.mockClear();

      // No tool ops at all — the activity-driven triggers never fire. Advance
      // past one heartbeat interval; the time-based trigger must review the diff.
      await vi.advanceTimersByTimeAsync(95_000);
      expect(mockSendMessage.mock.calls.some(([id]) => id === DUO)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cost: reported turn cost accumulates into the total; analyst cost arrives via snapshot", async () => {
    await startRun();

    // Reported agent-turn cost (Claude self-reports; Codex reports none) feeds
    // the run total used for the budget cap.
    useSessionStore.getState().addMessage(PRIMARY, assistantMsg("did the work"));
    chatCallbacks.get(PRIMARY)?.({
      type: "turn_complete", session_id: PRIMARY, cost_usd: 0.1, usage: null,
    } as unknown as FrontendEvent);
    chatCallbacks.get(DUO)?.({
      type: "turn_complete", session_id: DUO, cost_usd: 0.03, usage: null,
    } as unknown as FrontendEvent);
    expect(useDuoStore.getState().metrics.costUsd).toBeCloseTo(0.13);

    // The analyst's cost is surfaced by the snapshot event, not a turn.
    const runId = useDuoStore.getState().runId;
    snapshotCallbacks.forEach((cb) =>
      cb({
        runId,
        ts: 1,
        narrative: "n",
        report: {} as unknown,
        series: [],
        analystCostUsd: 0.002,
      }),
    );
    const m = useDuoStore.getState().metrics;
    expect(m.costAnalystUsd).toBeCloseTo(0.002);
    expect(m.costUsd).toBeCloseTo(0.132);
    await flush();
  });

  it("cadence: the live-review cadence setting flows into the run config", async () => {
    await startRun({ liveReviewCadence: "thorough" });
    expect(useDuoStore.getState().config?.liveReviewCadence).toBe("thorough");
  });

  it("plan-gate metrics: an approved plan counts as a review + agreement", async () => {
    await startRun({ planGateEnabled: true });
    await primaryTurn("Plan: reuse server.js and add an endpoint.");
    await mentorTurn({
      stance: "agree", severity: "nit", summary: "solid plan", rationale: "",
      confidence: 0.9, ranBuild: false, ranTests: false,
    });
    const m = useDuoStore.getState().metrics;
    expect(m.reviews).toBe(1);
    expect(m.agreements).toBe(1);
    expect(m.disagreements).toBe(0);
  });

  it("plan-gate metrics: a plan-change request counts as a review + disagreement", async () => {
    await startRun({ planGateEnabled: true });
    await primaryTurn("Plan: rewrite everything from scratch.");
    await mentorTurn({
      stance: "concern", severity: "blocking", summary: "don't rewrite",
      rationale: "extend the existing server", repairTask: "reuse server.js",
      confidence: 0.8, ranBuild: false, ranTests: false,
    });
    const m = useDuoStore.getState().metrics;
    expect(m.reviews).toBe(1);
    expect(m.disagreements).toBe(1);
    expect(m.dialogueRounds).toBe(1);
    expect(m.agreements).toBe(0);
  });
});
