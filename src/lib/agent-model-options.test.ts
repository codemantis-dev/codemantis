import { describe, it, expect } from "vitest";
import {
  CLAUDE_FALLBACK_MODELS,
  agentFallbackModels,
  resolveAgentModels,
  effortLevelsForModel,
  findModel,
} from "./agent-model-options";
import { CODEX_FALLBACK_MODELS } from "./codex-models";
import type { CliModelInfo } from "../types/agent-events";

describe("agentFallbackModels", () => {
  it("returns the Codex list for codex and the Claude list otherwise", () => {
    expect(agentFallbackModels("codex")).toBe(CODEX_FALLBACK_MODELS);
    expect(agentFallbackModels("claude_code")).toBe(CLAUDE_FALLBACK_MODELS);
  });
});

describe("resolveAgentModels", () => {
  it("prefers the per-agent cache when populated", () => {
    const cached: CliModelInfo[] = [{ value: "x", displayName: "X", description: "" }];
    expect(resolveAgentModels("codex", { codex: cached })).toBe(cached);
  });

  it("falls back to the cold-start list when the cache is empty/absent", () => {
    expect(resolveAgentModels("codex", {})).toBe(CODEX_FALLBACK_MODELS);
    expect(resolveAgentModels("codex", { codex: [] })).toBe(CODEX_FALLBACK_MODELS);
    expect(resolveAgentModels("claude_code", {})).toBe(CLAUDE_FALLBACK_MODELS);
  });
});

describe("effortLevelsForModel", () => {
  it("returns the model's supported levels", () => {
    expect(
      effortLevelsForModel({ value: "m", displayName: "M", description: "", supportsEffort: true, supportedEffortLevels: ["low", "high"] }),
    ).toEqual(["low", "high"]);
  });

  it("returns [] when effort is unsupported or undefined", () => {
    expect(effortLevelsForModel(undefined)).toEqual([]);
    expect(effortLevelsForModel({ value: "m", displayName: "M", description: "", supportsEffort: false })).toEqual([]);
    expect(effortLevelsForModel({ value: "m", displayName: "M", description: "" })).toEqual([]);
  });
});

describe("findModel", () => {
  it("locates a model by value", () => {
    const list: CliModelInfo[] = [
      { value: "a", displayName: "A", description: "" },
      { value: "b", displayName: "B", description: "" },
    ];
    expect(findModel(list, "b")?.displayName).toBe("B");
    expect(findModel(list, "z")).toBeUndefined();
  });
});
