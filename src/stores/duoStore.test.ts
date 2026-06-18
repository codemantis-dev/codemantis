import { describe, it, expect, beforeEach } from "vitest";
import {
  useDuoStore,
  buildDuoConfig,
  resolveDuoSettings,
  emptyDuoMetrics,
} from "./duoStore";
import { useSettingsStore } from "./settingsStore";
import { DEFAULT_DUO_SETTINGS } from "../types/settings";
import { resetAllStores } from "../test/helpers/store-reset";
import type { DuoAgentConfig, DuoConfig, DuoDialogueTurn, DuoVerdict } from "../types/duo";

const PRIMARY: DuoAgentConfig = { agentId: "codex", model: "gpt-5.5", effort: "high" };
const MENTOR: DuoAgentConfig = { agentId: "claude_code", model: "claude-opus-4-8", effort: "high" };

function sampleConfig(): DuoConfig {
  return buildDuoConfig(PRIMARY, MENTOR);
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
  });

  it("configure pins both sessions and moves to running/preparing", () => {
    useDuoStore.getState().configure({
      runId: "run-1",
      projectPath: "/proj",
      primarySessionId: "sess-primary",
      duoSessionId: "sess-duo",
      config: sampleConfig(),
    });
    const s = useDuoStore.getState();
    expect(s.runId).toBe("run-1");
    expect(s.primarySessionId).toBe("sess-primary");
    expect(s.duoSessionId).toBe("sess-duo");
    expect(s.status).toBe("running");
    expect(s.phase).toBe("preparing");
  });

  it("setStatus and setPhase update independently", () => {
    const { setStatus, setPhase } = useDuoStore.getState();
    setStatus("paused");
    setPhase("reviewing");
    expect(useDuoStore.getState().status).toBe("paused");
    expect(useDuoStore.getState().phase).toBe("reviewing");
  });

  it("appendDialogueTurn accumulates in order", () => {
    const t1: DuoDialogueTurn = {
      id: "t1", round: 1, author: "duo", stance: "concern", text: "missing error handling", ts: 1,
    };
    const t2: DuoDialogueTurn = {
      id: "t2", round: 1, author: "primary", stance: "defend", text: "it's handled upstream", ts: 2,
    };
    useDuoStore.getState().appendDialogueTurn(t1);
    useDuoStore.getState().appendDialogueTurn(t2);
    const d = useDuoStore.getState().dialogue;
    expect(d.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("setLatestVerdict and setMetrics store their values", () => {
    const verdict: DuoVerdict = {
      stance: "concern", severity: "blocking", summary: "needs tests", rationale: "no coverage",
      confidence: 0.8, ranBuild: true, ranTests: true, citedFiles: ["src/x.ts"],
    };
    useDuoStore.getState().setLatestVerdict(verdict);
    expect(useDuoStore.getState().latestVerdict).toEqual(verdict);

    const metrics = { ...emptyDuoMetrics(), reviews: 3, agreements: 2, agreementRate: 2 / 3 };
    useDuoStore.getState().setMetrics(metrics);
    expect(useDuoStore.getState().metrics.reviews).toBe(3);
  });

  it("setError sets and clears", () => {
    useDuoStore.getState().setError("boom");
    expect(useDuoStore.getState().error).toBe("boom");
    useDuoStore.getState().setError(null);
    expect(useDuoStore.getState().error).toBeNull();
  });

  it("reset returns the store to its initial idle state", () => {
    useDuoStore.getState().configure({
      runId: "run-1", projectPath: "/proj", primarySessionId: "p", duoSessionId: "d", config: sampleConfig(),
    });
    useDuoStore.getState().appendDialogueTurn({
      id: "t", round: 1, author: "duo", stance: "concern", text: "x", ts: 1,
    });
    useDuoStore.getState().reset();
    const s = useDuoStore.getState();
    expect(s.status).toBe("idle");
    expect(s.runId).toBeNull();
    expect(s.dialogue).toEqual([]);
    expect(s.config).toBeNull();
    expect(s.metrics).toEqual(emptyDuoMetrics());
  });
});
