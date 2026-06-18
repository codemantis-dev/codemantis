import { describe, it, expect, beforeEach } from "vitest";
import {
  useDuoStore,
  buildDuoConfig,
  resolveDuoSettings,
  emptyDuoMetrics,
  collectResponseSince,
} from "./duoStore";
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
