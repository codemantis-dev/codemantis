/**
 * Integration test for the cross-session CLI model cache pipeline.
 *
 * Pipeline under test (producer → consumer):
 *
 *   1. A Codex CLI session emits a `capabilities_discovered` event with a
 *      real `model/list` payload.
 *   2. `handleChatEvent` (in `lib/event-handlers/chat.ts`) updates BOTH:
 *        a. `sessionStore.sessionCapabilities[sessionId]` — the per-session
 *           cache used by the chat input's ModelSelector.
 *        b. `cliModelCacheStore.models.codex` — the cross-session cache
 *           used by SpecWriter and any future consumer that needs a model
 *           list before owning a live session of its own.
 *   3. The cache survives the session being closed and is keyed per-agent
 *      so a later Claude Code event can't blow away the Codex models.
 *
 * Regression scope: this is the v1.5.1 fix for SpecWriter's "Codex model
 * dropdown is empty" bug. Don't loosen these assertions — they encode the
 * contract that cache-hit consumers depend on.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { simulateCLIEvent } from "../helpers/event-simulator";
import { resetAllStores } from "../helpers/store-reset";
import { useCliModelCacheStore } from "../../stores/cliModelCacheStore";
import { useSessionStore } from "../../stores/sessionStore";
import type {
  CapabilitiesDiscoveredEvent,
  CliModelInfo,
} from "../../types/agent-events";

const codexModels: CliModelInfo[] = [
  {
    value: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Default",
    isDefault: true,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    defaultEffort: "medium",
  },
  { value: "gpt-5.4", displayName: "GPT-5.4", description: "General" },
  { value: "gpt-5.4-mini", displayName: "GPT-5.4-Mini", description: "Smaller" },
];

const claudeModels: CliModelInfo[] = [
  { value: "sonnet", displayName: "Sonnet", description: "Fast", isDefault: true },
];

function codexCapsEvent(
  sessionId: string,
  models: CliModelInfo[] = codexModels,
): CapabilitiesDiscoveredEvent {
  return {
    type: "capabilities_discovered",
    agent_id: "codex",
    session_id: sessionId,
    models,
    commands: [],
    agents: [],
    account: null,
    output_styles: [],
  };
}

function claudeCapsEvent(
  sessionId: string,
  models: CliModelInfo[] = claudeModels,
): CapabilitiesDiscoveredEvent {
  return {
    type: "capabilities_discovered",
    agent_id: "claude_code",
    session_id: sessionId,
    models,
    commands: [],
    agents: [],
    account: null,
    output_styles: [],
  };
}

beforeEach(() => {
  resetAllStores();
});

describe("CLI model cache pipeline", () => {
  it("populates the cross-session cache when a Codex session emits capabilities", () => {
    simulateCLIEvent("session-codex-1", codexCapsEvent("session-codex-1"));

    // Per-session cache (chat ModelSelector path)
    const caps = useSessionStore.getState().sessionCapabilities.get("session-codex-1");
    expect(caps?.models).toEqual(codexModels);

    // Cross-session cache (SpecWriter path) — the new wire
    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(codexModels);
    expect(useCliModelCacheStore.getState().getModels("claude_code")).toBeUndefined();
  });

  it("isolates the cache per agent — Codex and Claude don't overwrite each other", () => {
    simulateCLIEvent("session-codex-1", codexCapsEvent("session-codex-1"));
    simulateCLIEvent("session-claude-1", claudeCapsEvent("session-claude-1"));

    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(codexModels);
    expect(useCliModelCacheStore.getState().getModels("claude_code")).toEqual(claudeModels);
  });

  it("keeps the cache populated after the source session is removed from sessionStore", () => {
    // Spec-writer-style scenario: a chat session populates the cache, the
    // user closes that session, then opens SpecWriter and picks Codex.
    // SpecWriter must still see the models the closed session reported.
    simulateCLIEvent("session-codex-1", codexCapsEvent("session-codex-1"));

    // Manually drop the source session (mirrors what closeSession does).
    useSessionStore.setState((state) => {
      const sessionCapabilities = new Map(state.sessionCapabilities);
      sessionCapabilities.delete("session-codex-1");
      return { sessionCapabilities };
    });

    expect(useSessionStore.getState().sessionCapabilities.get("session-codex-1")).toBeUndefined();
    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(codexModels);
  });

  it("refuses to overwrite a populated cache with an empty models array", () => {
    // Transport hiccup scenario: Codex session A produces a good list,
    // session B emits capabilities with models:[] because model/list
    // timed out. The cache must keep A's list — silently emptying the
    // SpecWriter dropdown would be the worst possible UX regression.
    simulateCLIEvent("session-codex-1", codexCapsEvent("session-codex-1"));
    simulateCLIEvent("session-codex-2", codexCapsEvent("session-codex-2", []));

    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(codexModels);
  });

  it("replaces the cached list when a later session reports different models", () => {
    // Forward compat: when a new Codex CLI version reports a fresh
    // model lineup, the cache should accept it so consumers see the new
    // models without restarting CodeMantis.
    simulateCLIEvent("session-codex-1", codexCapsEvent("session-codex-1"));

    const newer: CliModelInfo[] = [
      { value: "gpt-6", displayName: "GPT-6", description: "New", isDefault: true },
      { value: "gpt-5.5", displayName: "GPT-5.5", description: "Default" },
    ];
    simulateCLIEvent("session-codex-2", codexCapsEvent("session-codex-2", newer));

    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(newer);
  });

  it("defaults missing agent_id to claude_code so legacy events still populate the cache", () => {
    // Older event-stream emitters omit `agent_id`. The handler treats
    // missing as Claude Code (the historical-only agent before v1.4.0).
    // We rely on that default here so legacy capture / replay fixtures
    // don't silently fail to populate the cache.
    const legacy: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "session-legacy-1",
      models: claudeModels,
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    simulateCLIEvent("session-legacy-1", legacy);

    expect(useCliModelCacheStore.getState().getModels("claude_code")).toEqual(claudeModels);
    expect(useCliModelCacheStore.getState().getModels("codex")).toBeUndefined();
  });
});
