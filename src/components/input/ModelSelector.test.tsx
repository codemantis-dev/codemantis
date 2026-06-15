import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ModelSelector from "./ModelSelector";
import { useSessionStore } from "../../stores/sessionStore";
import { useCliModelCacheStore } from "../../stores/cliModelCacheStore";
import type { Session } from "../../types/session";
import type { CapabilitiesDiscoveredEvent, CliModelInfo } from "../../types/agent-events";

const SESSION: Session = {
  id: "s1",
  name: "Test",
  project_path: "/tmp",
  status: "connected",
  created_at: "",
  model: "claude-sonnet-4-6-20250514",
  icon_index: 0,
};

function resetStore(session: Session | null = SESSION): void {
  if (session) {
    useSessionStore.setState({
      sessions: new Map([[session.id, session]]),
      activeSessionId: session.id,
      sessionCapabilities: new Map(),
      tabOrder: [session.id],
    });
  } else {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionCapabilities: new Map(),
      tabOrder: [],
    });
  }
}

const DETAILED_CLAUDE_MODELS: CliModelInfo[] = [
  { value: "default", displayName: "Default", description: "Opus 4.8 with 1M context · Best for everyday, complex tasks", isDefault: true },
  { value: "opus[1m]", displayName: "Opus", description: "Opus 4.8 with 1M context" },
  { value: "sonnet", displayName: "Sonnet", description: "Sonnet 4.6 · Efficient for routine tasks" },
  { value: "sonnet[1m]", displayName: "Sonnet (1M context)", description: "Sonnet 4.6 with 1M context · Draws from usage credits · $3/$15 per Mtok" },
  { value: "haiku", displayName: "Haiku", description: "Haiku 4.5 · Fastest for quick answers" },
];

describe("ModelSelector", () => {
  beforeEach(() => {
    useCliModelCacheStore.getState().clear();
    resetStore();
  });

  it("renders nothing when no session", () => {
    resetStore(null);
    const { container } = render(<ModelSelector />);
    expect(container.innerHTML).toBe("");
  });

  it("renders formatted model name from session", () => {
    render(<ModelSelector />);
    expect(screen.getByText("Sonnet 4.6")).toBeInTheDocument();
  });

  it("shows fallback models in dropdown when no capabilities", () => {
    render(<ModelSelector />);
    fireEvent.click(screen.getByText("Sonnet 4.6"));
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Haiku")).toBeInTheDocument();
    expect(screen.getByText("Opus (1M)")).toBeInTheDocument();
    expect(screen.getByText("Sonnet (1M)")).toBeInTheDocument();
  });

  it("shows capabilities models in dropdown when available", () => {
    const caps: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s1",
      models: [
        { value: "sonnet", displayName: "Sonnet 4.6", description: "Fast and capable" },
        { value: "opus", displayName: "Opus 4.8", description: "Most powerful" },
        { value: "haiku", displayName: "Haiku 4.5", description: "Fastest" },
      ],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    useSessionStore.getState().setSessionCapabilities("s1", caps);

    render(<ModelSelector />);
    fireEvent.click(screen.getByText("Sonnet 4.6"));

    expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
    expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
    expect(screen.getByText("Most powerful")).toBeInTheDocument();
    expect(screen.getByText("Fastest")).toBeInTheDocument();
    // Fallback "Default" should NOT appear
    expect(screen.queryByText("Account default")).not.toBeInTheDocument();
  });

  it("dropdown closes on outside click", () => {
    render(<ModelSelector />);
    fireEvent.click(screen.getByText("Sonnet 4.6"));
    expect(screen.getByText("Default")).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
  });

  it("dropdown closes on model selection", () => {
    render(<ModelSelector />);
    fireEvent.click(screen.getByText("Sonnet 4.6"));
    expect(screen.getByText("Haiku")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Haiku"));
    // Dropdown should be closed
    expect(screen.queryByText("Account default")).not.toBeInTheDocument();
  });

  it("falls back to Claude's 'Default' label when session.model is null", () => {
    // Regression: label used to say "Model" until a model was picked, which
    // looked broken. We now resolve to the agent's default (isDefault flag
    // on the fallback list).
    const noModelSession = { ...SESSION, model: null as string | null };
    resetStore(noModelSession);
    render(<ModelSelector />);
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("falls back to GPT-5.5 for Codex sessions with no model", () => {
    // The headline bug: Codex sessions showed "Model ▼" forever because
    // session.model was never auto-set on spawn. Now the resolved default
    // (gpt-5.5, marked isDefault on CODEX_FALLBACK_MODELS) is rendered.
    const codexSession: Session = {
      ...SESSION,
      model: null,
      agent_id: "codex",
    };
    resetStore(codexSession);
    render(<ModelSelector />);
    expect(screen.getByText("GPT-5.5")).toBeInTheDocument();
  });

  it("formats opus model name correctly", () => {
    resetStore({ ...SESSION, model: "claude-opus-4-20250514" });
    render(<ModelSelector />);
    expect(screen.getByText("Opus 4")).toBeInTheDocument();
  });

  it("formats haiku model name correctly", () => {
    resetStore({ ...SESSION, model: "claude-haiku-4-5-20241022" });
    render(<ModelSelector />);
    expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
  });

  it("formats Codex gpt-5.5 model from session", () => {
    const codexSession: Session = {
      ...SESSION,
      model: "gpt-5.5",
      agent_id: "codex",
    };
    resetStore(codexSession);
    render(<ModelSelector />);
    expect(screen.getByText("GPT-5.5")).toBeInTheDocument();
  });

  it("falls back to the per-agent cached detailed list when session caps are absent", () => {
    // Regression: after `/clear` or a resume/respawn the session loses its
    // live capabilities. Instead of reverting to the reduced hardcoded list,
    // the picker must use the per-agent last-known-good cache (the detailed
    // list any prior session already produced).
    useCliModelCacheStore.getState().setModels("claude_code", DETAILED_CLAUDE_MODELS);
    render(<ModelSelector />);
    fireEvent.click(screen.getByText("Sonnet 4.6"));

    expect(screen.getByText("Sonnet 4.6 · Efficient for routine tasks")).toBeInTheDocument();
    expect(
      screen.getByText("Sonnet 4.6 with 1M context · Draws from usage credits · $3/$15 per Mtok"),
    ).toBeInTheDocument();
    // The reduced hardcoded descriptions must NOT appear.
    expect(screen.queryByText("Account default")).not.toBeInTheDocument();
    expect(screen.queryByText("Extended context")).not.toBeInTheDocument();
  });

  it("prefers live session caps over the per-agent cache", () => {
    useCliModelCacheStore.getState().setModels("claude_code", DETAILED_CLAUDE_MODELS);
    const caps: CapabilitiesDiscoveredEvent = {
      type: "capabilities_discovered",
      session_id: "s1",
      models: [
        { value: "sonnet", displayName: "Sonnet 4.6", description: "Live caps win" },
      ],
      commands: [],
      agents: [],
      account: null,
      output_styles: [],
    };
    useSessionStore.getState().setSessionCapabilities("s1", caps);
    render(<ModelSelector />);
    fireEvent.click(screen.getByText("Sonnet 4.6"));
    expect(screen.getByText("Live caps win")).toBeInTheDocument();
    // Cached detailed description must not leak through when live caps exist.
    expect(screen.queryByText("Sonnet 4.6 · Efficient for routine tasks")).not.toBeInTheDocument();
  });

  it("Codex sessions never show the Claude cache (agent-scoped lookup)", () => {
    // The cache is keyed by agent; a Claude-populated cache must never bleed
    // into a Codex session's picker.
    useCliModelCacheStore.getState().setModels("claude_code", DETAILED_CLAUDE_MODELS);
    const codexSession: Session = { ...SESSION, model: null, agent_id: "codex" };
    resetStore(codexSession);
    render(<ModelSelector />);
    fireEvent.click(screen.getByText("GPT-5.5"));
    // Claude-only detailed entry must not appear in a Codex picker.
    expect(screen.queryByText("Sonnet 4.6 · Efficient for routine tasks")).not.toBeInTheDocument();
  });

  it("still uses the hardcoded fallback when both caps and cache are empty", () => {
    // Cold-start safety net: nothing cached, no live caps.
    render(<ModelSelector />);
    fireEvent.click(screen.getByText("Sonnet 4.6"));
    expect(screen.getByText("Account default")).toBeInTheDocument();
    expect(screen.getByText("Opus (1M)")).toBeInTheDocument();
  });
});
