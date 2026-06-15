/**
 * Integration test: the chat-input ModelSelector + EffortSelector must keep
 * showing the *detailed* live model list and the effort bars even after the
 * session momentarily loses its live capabilities.
 *
 * Pipeline under test (CLI event → stores → both pickers):
 *
 *   1. A Claude Code session emits `capabilities_discovered` with the detailed
 *      `model/list` payload (incl. supportsEffort / supportedEffortLevels).
 *      `handleChatEvent` stores it in BOTH `sessionCapabilities[sessionId]`
 *      (per-session) and `cliModelCacheStore.models.claude_code` (per-agent
 *      last-known-good).
 *   2. ModelSelector renders the detailed entries; EffortSelector renders bars.
 *   3. `/clear` calls `clearSessionData` — which must NOT drop the caps (the
 *      respawned CLI is unchanged). Pickers stay detailed.
 *   4. Even if the per-session caps are lost entirely (a resume/respawn path
 *      that never re-runs the initialize handshake), both pickers fall back to
 *      the per-agent cache instead of the reduced hardcoded list / hiding.
 *
 * Regression scope: the "model picker shows the reduced list and the
 * thinking/effort bars disappear in many cases" report. Don't loosen these —
 * they encode that capability loss no longer degrades the pickers.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { simulateCLIEvent } from "../helpers/event-simulator";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import ModelSelector from "../../components/input/ModelSelector";
import EffortSelector from "../../components/input/EffortSelector";
import type { Session } from "../../types/session";
import type { CapabilitiesDiscoveredEvent, CliModelInfo } from "../../types/agent-events";

const SESSION_ID = "s-claude-1";

const SESSION: Session = {
  id: SESSION_ID,
  name: "Test",
  project_path: "/tmp",
  status: "connected",
  created_at: "",
  model: "claude-opus-4-8[1m]",
  icon_index: 0,
};

const DETAILED_MODELS: CliModelInfo[] = [
  {
    value: "default",
    displayName: "Default",
    description: "Opus 4.8 with 1M context · Best for everyday, complex tasks",
    isDefault: true,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet[1m]",
    displayName: "Sonnet (1M context)",
    description: "Sonnet 4.6 with 1M context · Draws from usage credits · $3/$15 per Mtok",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
  { value: "haiku", displayName: "Haiku", description: "Haiku 4.5 · Fastest for quick answers" },
];

function capsEvent(): CapabilitiesDiscoveredEvent {
  return {
    type: "capabilities_discovered",
    agent_id: "claude_code",
    session_id: SESSION_ID,
    models: DETAILED_MODELS,
    commands: [],
    agents: [],
    account: null,
    output_styles: [],
  };
}

function seedActiveSession(): void {
  useSessionStore.setState({
    sessions: new Map([[SESSION_ID, SESSION]]),
    activeSessionId: SESSION_ID,
    sessionEffort: new Map([[SESSION_ID, "high"]]),
    sessionBusy: new Map([[SESSION_ID, false]]),
    sessionStreaming: new Map(),
    tabOrder: [SESSION_ID],
  });
}

beforeEach(() => {
  resetAllStores();
  seedActiveSession();
});

describe("model/effort picker resilience to capability loss", () => {
  it("shows the detailed model list and effort bars once capabilities arrive", () => {
    simulateCLIEvent(SESSION_ID, capsEvent());

    render(
      <>
        <ModelSelector />
        <EffortSelector />
      </>,
    );

    // Effort bars visible (running level "high").
    expect(screen.getByText("High")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Opus 4.8[1m]")); // formatted session.model label
    expect(
      screen.getByText("Sonnet 4.6 with 1M context · Draws from usage credits · $3/$15 per Mtok"),
    ).toBeInTheDocument();
  });

  it("keeps the detailed list + effort bars after /clear (clearSessionData preserves caps)", () => {
    simulateCLIEvent(SESSION_ID, capsEvent());
    // Simulate the /clear command's store mutation.
    useSessionStore.getState().clearSessionData(SESSION_ID);

    render(
      <>
        <ModelSelector />
        <EffortSelector />
      </>,
    );

    // Effort selector still visible — clearSessionData wiped the running
    // effort so the badge falls to levels[0] ("Low"), but it is NOT hidden.
    expect(screen.getByText("Low")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Opus 4.8[1m]"));
    expect(
      screen.getByText("Opus 4.8 with 1M context · Best for everyday, complex tasks"),
    ).toBeInTheDocument();
    // The reduced hardcoded descriptions must NOT be what we see.
    expect(screen.queryByText("Account default")).not.toBeInTheDocument();
  });

  it("falls back to the per-agent cache when the session caps are lost entirely (resume/respawn)", () => {
    simulateCLIEvent(SESSION_ID, capsEvent());
    // Hard-drop the per-session caps to mimic a respawn that never re-ran the
    // initialize handshake. The per-agent cache (populated by the event above)
    // must carry the pickers.
    useSessionStore.setState((state) => {
      const sessionCapabilities = new Map(state.sessionCapabilities);
      sessionCapabilities.delete(SESSION_ID);
      return { sessionCapabilities };
    });
    expect(useSessionStore.getState().sessionCapabilities.get(SESSION_ID)).toBeUndefined();

    render(
      <>
        <ModelSelector />
        <EffortSelector />
      </>,
    );

    // Effort selector still rendered from the cache (running level "high").
    expect(screen.getByText("High")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Opus 4.8[1m]"));
    expect(
      screen.getByText("Sonnet 4.6 with 1M context · Draws from usage credits · $3/$15 per Mtok"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Extended context")).not.toBeInTheDocument();
  });
});
