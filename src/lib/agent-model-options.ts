/**
 * Shared resolution of the per-agent model list and a model's effort levels.
 *
 * Values are read LIVE (never invented): the resolution order is
 *   live session capabilities → per-agent last-known-good cache → cold-start
 *   fallback. The fallbacks are the same minimal lists ModelSelector uses while
 *   `initialize`/`model/list` capability discovery is still in-flight.
 *
 * Used by surfaces that need to pick a model/effort BEFORE a session exists
 * (e.g. the Duo-Coding setup modal), which can only rely on the cache + fallback.
 */
import type { AgentId, CliModelInfo } from "../types/agent-events";
import { CODEX_FALLBACK_MODELS } from "./codex-models";

/** Claude cold-start fallback (mirrors ModelSelector). Live lists override it. */
export const CLAUDE_FALLBACK_MODELS: CliModelInfo[] = [
  { value: "default", displayName: "Default", description: "Account default", isDefault: true },
  { value: "sonnet", displayName: "Sonnet", description: "Fast and capable" },
  { value: "opus[1m]", displayName: "Opus (1M)", description: "Extended context" },
  { value: "sonnet[1m]", displayName: "Sonnet (1M)", description: "Extended context" },
  { value: "haiku", displayName: "Haiku", description: "Fastest" },
];

export function agentFallbackModels(agent: AgentId): CliModelInfo[] {
  return agent === "codex" ? CODEX_FALLBACK_MODELS : CLAUDE_FALLBACK_MODELS;
}

/** Friendly display name for a coding agent (e.g. shown next to PRIMARY/MENTOR). */
export function agentLabel(agent: AgentId | undefined): string {
  return agent === "codex" ? "Codex" : "Claude Code";
}

/**
 * Best-known model list for an agent from the per-agent cache, falling back to
 * the cold-start list. (Callers with a live session should prefer that
 * session's `caps.models` ahead of this.)
 */
export function resolveAgentModels(
  agent: AgentId,
  cachedModelsByAgent: Partial<Record<AgentId, CliModelInfo[]>>,
): CliModelInfo[] {
  const cached = cachedModelsByAgent[agent];
  return cached && cached.length > 0 ? cached : agentFallbackModels(agent);
}

/** The effort levels the given model supports, or [] if effort isn't applicable. */
export function effortLevelsForModel(model: CliModelInfo | undefined): string[] {
  if (!model || model.supportsEffort === false) return [];
  return model.supportedEffortLevels ?? [];
}

/** Look up a model entry by its `value` within a list. */
export function findModel(
  models: CliModelInfo[],
  value: string,
): CliModelInfo | undefined {
  return models.find((m) => m.value === value);
}
