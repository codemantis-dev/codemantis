import { describe, it, expect, beforeEach } from "vitest";
import {
  useDuoStore,
  buildDuoConfig,
  resolveDuoSettings,
  emptyDuoMetrics,
  collectResponseSince,
  metricsFromEvents,
  timelineFromEvents,
  cadenceParams,
  hashDiff,
} from "./duoStore";
import type { DuoEventRow, DuoRunRow, DuoSnapshotRow } from "../types/duo";
import { useSettingsStore } from "./settingsStore";
import { DEFAULT_DUO_SETTINGS } from "../types/settings";
import { resetAllStores } from "../test/helpers/store-reset";
import type { DuoAgentConfig } from "../types/duo";
import type { Message } from "../types/session";

const PRIMARY: DuoAgentConfig = { agentId: "codex", model: "gpt-5.5", effort: "high" };
const MENTOR: DuoAgentConfig = { agentId: "claude_code", model: "claude-opus-4-8", effort: "high" };

function msg(id: string, role: "user" | "assistant", content: string): Message {
  return { id, role, content, timestamp: "", activityIds: [], isStreaming: false };
}

describe("duoStore helpers", () => {
  beforeEach(() => resetAllStores());

  it("resolveDuoSettings falls back to the opt-out baseline when unset", () => {
    expect(resolveDuoSettings()).toEqual(DEFAULT_DUO_SETTINGS);
  });

  it("resolveDuoSettings reads persisted settings when present", () => {
    useSettingsStore.setState((s) => ({
      settings: {
        ...s.settings,
        duo: { ...DEFAULT_DUO_SETTINGS, enabled: true, tieBreakPolicy: "mentorWins" },
      },
    }));
    expect(resolveDuoSettings().tieBreakPolicy).toBe("mentorWins");
  });

  it("buildDuoConfig merges agent pairing with settings policy/defaults", () => {
    const config = buildDuoConfig(PRIMARY, MENTOR, {
      ...DEFAULT_DUO_SETTINGS,
      maxDialogueRounds: 5,
      tieBreakPolicy: "primaryWins",
    });
    expect(config.primary).toEqual(PRIMARY);
    expect(config.duo).toEqual(MENTOR);
    expect(config.maxDialogueRounds).toBe(5);
    expect(config.tieBreakPolicy).toBe("primaryWins");
    expect(config.analystProvider).toBe(DEFAULT_DUO_SETTINGS.analystProvider);
  });

  it("emptyDuoMetrics is fully zeroed with null precision", () => {
    const m = emptyDuoMetrics();
    expect(m.reviews).toBe(0);
    expect(m.agreementRate).toBe(0);
    expect(m.mentorPrecision).toBeNull();
    expect(m.costUsd).toBe(0);
    expect(m.costAnalystUsd).toBe(0);
  });

  it("buildDuoConfig carries the live-review cadence from settings", () => {
    const config = buildDuoConfig(PRIMARY, MENTOR, {
      ...DEFAULT_DUO_SETTINGS,
      liveReviewCadence: "thorough",
    });
    expect(config.liveReviewCadence).toBe("thorough");
  });
});

describe("cadenceParams", () => {
  it("returns progressively tighter thresholds from minimal → thorough", () => {
    const minimal = cadenceParams("minimal");
    const balanced = cadenceParams("balanced");
    const thorough = cadenceParams("thorough");
    // Higher coverage ⇒ fewer ops before review, shorter debounce/interval/heartbeat.
    expect(minimal.opThreshold).toBeGreaterThan(balanced.opThreshold);
    expect(balanced.opThreshold).toBeGreaterThan(thorough.opThreshold);
    expect(minimal.minIntervalMs).toBeGreaterThan(balanced.minIntervalMs);
    expect(balanced.minIntervalMs).toBeGreaterThan(thorough.minIntervalMs);
    expect(minimal.heartbeatMs).toBeGreaterThan(balanced.heartbeatMs);
    expect(balanced.heartbeatMs).toBeGreaterThan(thorough.heartbeatMs);
  });

  it("defaults unknown cadence to balanced", () => {
    expect(cadenceParams("balanced")).toEqual(
      cadenceParams("nonsense" as "balanced"),
    );
  });
});

describe("hashDiff", () => {
  it("is stable for identical input and differs for changed input", () => {
    const a = "diff --git a/x b/x\n+hello\n";
    expect(hashDiff(a)).toBe(hashDiff(a));
    expect(hashDiff(a)).not.toBe(hashDiff(a + "+world\n"));
  });

  it("returns a compact base36 string for the empty diff", () => {
    expect(hashDiff("")).toMatch(/^[0-9a-z]+$/);
  });
});

describe("collectResponseSince", () => {
  it("returns the last assistant message when no marker is given", () => {
    const messages = [msg("a", "assistant", "first"), msg("b", "assistant", "second")];
    expect(collectResponseSince(messages, null)).toBe("second");
  });

  it("joins all assistant messages after the marker", () => {
    const messages = [
      msg("u1", "user", "do it"),
      msg("a1", "assistant", "one"),
      msg("a2", "assistant", "two"),
    ];
    expect(collectResponseSince(messages, "u1")).toBe("one\n\ntwo");
  });

  it("skips empty assistant messages", () => {
    const messages = [msg("u1", "user", "go"), msg("a1", "assistant", "  "), msg("a2", "assistant", "real")];
    expect(collectResponseSince(messages, "u1")).toBe("real");
  });

  it("falls back to last assistant when the marker is not found", () => {
    const messages = [msg("a1", "assistant", "only")];
    expect(collectResponseSince(messages, "missing")).toBe("only");
  });
});

describe("duoStore lifecycle", () => {
  beforeEach(() => resetAllStores());

  it("starts idle and empty", () => {
    const s = useDuoStore.getState();
    expect(s.status).toBe("idle");
    expect(s.phase).toBeNull();
    expect(s.runId).toBeNull();
    expect(s.dialogue).toEqual([]);
    expect(s.decisionLog).toEqual([]);
  });

  it("reset returns the store to its initial idle state", () => {
    useDuoStore.setState({
      status: "running",
      runId: "r1",
      dialogue: [{ id: "t", round: 1, author: "duo", stance: "concern", text: "x", ts: 1 }],
    });
    useDuoStore.getState().reset();
    const s = useDuoStore.getState();
    expect(s.status).toBe("idle");
    expect(s.runId).toBeNull();
    expect(s.dialogue).toEqual([]);
    expect(s.metrics).toEqual(emptyDuoMetrics());
  });
});

describe("metricsFromEvents", () => {
  const ev = (kind: string): DuoEventRow => ({
    id: `e-${Math.random()}`, runId: "r", ts: 0, kind, actor: "duo", payloadJson: "{}", diffStatsJson: null,
  });

  it("counts reviews/agreements/disagreements/repairs/drift", () => {
    const m = metricsFromEvents([
      ev("agreement"), ev("disagreement"), ev("concern"), ev("repair"), ev("drift"), ev("turn"),
    ]);
    expect(m.agreements).toBe(1);
    expect(m.disagreements).toBe(1);
    expect(m.reviews).toBe(3); // agreement + disagreement + concern
    expect(m.repairs).toBe(1);
    expect(m.driftIncidents).toBe(1);
    expect(m.agreementRate).toBeCloseTo(1 / 3);
  });

  it("returns zeroed metrics for an empty log", () => {
    expect(metricsFromEvents([])).toEqual(emptyDuoMetrics());
  });
});

describe("duoStore.hydrateInterrupted", () => {
  beforeEach(() => resetAllStores());

  it("loads a crash-interrupted run read-only with reconstructed metrics + snapshot", () => {
    const run: DuoRunRow = {
      id: "run-x", primarySessionId: "p", duoSessionId: "d", projectPath: "/proj",
      status: "paused", configJson: JSON.stringify({ primary: { agentId: "codex" }, duo: { agentId: "claude_code" }, task: "Add logout" }),
      outcome: "interrupted-by-restart", createdAt: 1000, completedAt: 2000,
    };
    const report = {
      schemaVersion: 1, headline: "h", narrative: "interrupted run",
      phaseAssessment: { currentFocus: "", momentum: "unknown", momentumRationale: "" },
      collaborationHealth: { score: 50, trend: "unknown", summary: "", frictionPoints: [] },
      qualityAssessment: { score: 50, trajectory: "unknown", strengths: [], risks: [] },
      repairAnalysis: { summary: "", rootCausePatterns: [], mentorEffectiveness: "unknown", mentorEffectivenessRationale: "" },
      improvementAnalysis: { summary: "", delivered: [], preventedIssues: [] },
      decisions: [], recommendations: [], watchItems: [], confidence: 30,
    };
    const snapshot: DuoSnapshotRow = {
      id: "s1", runId: "run-x", ts: 1500, narrative: "interrupted run",
      metricsJson: JSON.stringify(report), seriesJson: "[]",
    };
    const events: DuoEventRow[] = [
      { id: "e1", runId: "run-x", ts: 1, kind: "agreement", actor: "duo", payloadJson: "{}", diffStatsJson: null },
    ];

    useDuoStore.getState().hydrateInterrupted({ run, snapshot, events });
    const s = useDuoStore.getState();
    expect(s.interrupted).toBe(true);
    expect(s.status).toBe("paused");
    expect(s.runId).toBe("run-x");
    expect(s.task).toBe("Add logout");
    expect(s.config?.primary.agentId).toBe("codex");
    expect(s.metrics.agreements).toBe(1);
    expect(s.analystSnapshot?.report.narrative).toBe("interrupted run");
    // Conversation timeline is rebuilt from the event log.
    expect(s.dialogue.length).toBe(1);
    expect(s.dialogue[0].author).toBe("duo");
    expect(s.dialogue[0].stance).toBe("review");
  });
});

describe("timelineFromEvents", () => {
  const ev = (
    kind: string,
    actor: string,
    payload: Record<string, unknown>,
  ): DuoEventRow => ({
    id: `e-${kind}-${Math.random()}`,
    runId: "r",
    ts: 0,
    kind,
    actor,
    payloadJson: JSON.stringify(payload),
    diffStatsJson: null,
  });

  it("maps a primary turn to a work bubble", () => {
    const t = timelineFromEvents([ev("turn", "primary", { summary: "turn", text: "did the work" })]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ author: "primary", stance: "work", text: "did the work" });
  });

  it("maps verdict events to mentor reviews with reconstructed verdict metadata", () => {
    const t = timelineFromEvents([
      ev("disagreement", "duo", {
        summary: "no tests", text: "the path is uncovered",
        stance: "concern", severity: "blocking", confidence: 0.7, ranBuild: true, ranTests: false,
      }),
    ]);
    expect(t[0]).toMatchObject({ author: "duo", stance: "review", text: "the path is uncovered" });
    expect(t[0].verdict).toMatchObject({ stance: "concern", severity: "blocking", ranBuild: true, ranTests: false });
  });

  it("maps system events to outcome markers", () => {
    const t = timelineFromEvents([
      ev("repair", "system", { summary: "Mentor directed a repair (round 1): fix it", round: 1 }),
      ev("decision", "system", { summary: "Agreement reached — primary's work accepted" }),
      ev("decision", "system", { summary: "Tie-break: mentor wins" }),
      ev("drift", "duo", { summary: "rm -rf" }),
      ev("escalation", "system", { summary: "Budget cap reached — run paused" }),
    ]);
    expect(t.map((e) => [e.author, e.stance])).toEqual([
      ["system", "repair"],
      ["system", "resolve"],
      ["system", "decision"],
      ["system", "drift"],
      ["system", "budget"],
    ]);
  });

  it("ignores unknown event kinds", () => {
    expect(timelineFromEvents([ev("verdict", "duo", { summary: "x" })])).toEqual([]);
  });
});
