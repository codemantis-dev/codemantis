import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import SessionStatusBar from "./SessionStatusBar";

describe("SessionStatusBar", () => {
  const sessionId = "test-session";

  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map([[sessionId, {
        id: sessionId,
        name: "Test",
        project_path: "/test",
        status: "connected",
        created_at: new Date().toISOString(),
        model: "claude-sonnet-4-6",
        icon_index: 0,
      }]]),
      sessionBusy: new Map(),
      sessionCompacting: new Map(),
      sessionActivity: new Map(),
      busySince: new Map(),
      sessionStats: new Map(),
      sessionContext: new Map(),
      rateLimitUtilization: new Map(),
      activeSubAgents: new Map(),
      sessionModes: new Map(),
    });
  });

  it("shows Idle status when session is not busy", () => {
    render(<SessionStatusBar sessionId={sessionId} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("shows Busy status when session is busy", () => {
    useSessionStore.setState({
      sessionBusy: new Map([[sessionId, true]]),
      busySince: new Map([[sessionId, Date.now()]]),
    });
    render(<SessionStatusBar sessionId={sessionId} />);
    expect(screen.getByText("Busy")).toBeInTheDocument();
  });

  it("shows Compacting status when session is compacting", () => {
    useSessionStore.setState({
      sessionCompacting: new Map([[sessionId, true]]),
    });
    render(<SessionStatusBar sessionId={sessionId} />);
    expect(screen.getByText("Compacting")).toBeInTheDocument();
  });

  it("shows model name from session", () => {
    render(<SessionStatusBar sessionId={sessionId} />);
    // formatModelName should extract a human-friendly name
    const el = screen.getByText(/sonnet/i);
    expect(el).toBeInTheDocument();
  });

  it("shows token count when stats are available", () => {
    useSessionStore.setState({
      sessionStats: new Map([[sessionId, {
        totalCostUsd: 0.05,
        totalInputTokens: 5000,
        totalOutputTokens: 3000,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        turnCount: 3,
        apiCallCount: 3, totalReasoningOutputTokens: 0,
      }]]),
    });
    render(<SessionStatusBar sessionId={sessionId} />);
    expect(screen.getByText(/8\.0K tokens/)).toBeInTheDocument();
    expect(screen.getByText("3 turns")).toBeInTheDocument();
  });

  it("shows context usage percentage", () => {
    useSessionStore.setState({
      sessionContext: new Map([[sessionId, { used: 80000, max: 100000 }]]),
    });
    render(<SessionStatusBar sessionId={sessionId} />);
    expect(screen.getByText("ctx 80%")).toBeInTheDocument();
  });

  it("shows rate limit utilization when above 50%", () => {
    useSessionStore.setState({
      rateLimitUtilization: new Map([[sessionId, 0.75]]),
    });
    render(<SessionStatusBar sessionId={sessionId} />);
    expect(screen.getByText("RL 75%")).toBeInTheDocument();
  });

  it("does not show rate limit when below 50%", () => {
    useSessionStore.setState({
      rateLimitUtilization: new Map([[sessionId, 0.3]]),
    });
    render(<SessionStatusBar sessionId={sessionId} />);
    expect(screen.queryByText(/RL/)).not.toBeInTheDocument();
  });
});
