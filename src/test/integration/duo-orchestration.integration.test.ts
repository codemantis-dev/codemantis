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

  it("logs an agreement and injects no repair when the mentor agrees", async () => {
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
    expect(s.status).toBe("running");
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

    // Still unparseable → degrade to a logged advisory concern (no repair).
    mockSendMessage.mockClear();
    useSessionStore.getState().addMessage(DUO, assistantMsg("still no block"));
    chatCallbacks.get(DUO)?.({ type: "turn_complete", session_id: DUO } as unknown as FrontendEvent);
    await flush();
    const s = useDuoStore.getState();
    expect(s.metrics.reviews).toBe(1);
    expect(s.decisionLog.some((d) => d.kind === "concern")).toBe(true);
    expect(mockSendMessage.mock.calls.some(([id]) => id === PRIMARY)).toBe(false);
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
    expect(s.status).toBe("running");
    expect(s.phase).toBe("building");
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
});
