import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DuoDashboard from "./DuoDashboard";
import { useDuoStore, emptyDuoMetrics } from "../../stores/duoStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { DuoAnalystReport, DuoConfig } from "../../types/duo";

const CONFIG: DuoConfig = {
  primary: { agentId: "codex", model: "gpt-5.5" },
  duo: { agentId: "claude_code", model: "opus" },
  tieBreakPolicy: "pause",
  maxDialogueRounds: 3,
  severeDriftNudgeEnabled: true,
  severeDriftSensitivity: "conservative",
  analystEnabled: true,
  analystProvider: "gemini",
  analystModel: "gemini-2.5-flash-lite",
  budgetUsdCap: null,
  budgetTokenCap: null,
};

const REPORT: DuoAnalystReport = {
  schemaVersion: 1,
  headline: "Steady progress with minor rework",
  narrative: "The primary implemented the feature; the mentor caught a missing test.",
  phaseAssessment: { currentFocus: "logout", momentum: "steady", momentumRationale: "one clean round" },
  collaborationHealth: { score: 78, trend: "improving", summary: "low friction", frictionPoints: [] },
  qualityAssessment: {
    score: 64,
    trajectory: "improving",
    strengths: ["tests added"],
    risks: [{ severity: "medium", description: "no e2e coverage", evidence: "no e2e events" }],
  },
  repairAnalysis: { summary: "one repair", rootCausePatterns: ["missing tests"], mentorEffectiveness: "high", mentorEffectivenessRationale: "fast" },
  improvementAnalysis: { summary: "coverage up", delivered: ["unit test"], preventedIssues: [] },
  decisions: [],
  recommendations: [{ priority: "medium", action: "add an e2e test", audience: "primary" }],
  watchItems: ["repeated test gaps"],
  confidence: 65,
};

function runningState(): void {
  // runId omitted (null) so control actions don't touch the Tauri IPC boundary.
  useDuoStore.setState({
    status: "running",
    phase: "reviewing",
    config: CONFIG,
    startedAt: Date.now(),
    metrics: { ...emptyDuoMetrics(), reviews: 2, agreements: 1, disagreements: 1, repairs: 1, costUsd: 0.12, agreementRate: 0.5 },
  });
}

describe("DuoDashboard", () => {
  beforeEach(() => resetAllStores());

  it("shows the idle empty state and a configure affordance", () => {
    const onConfigure = vi.fn();
    render(<DuoDashboard onConfigure={onConfigure} />);
    expect(screen.getByText(/Pair a primary coding agent/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Configure a Duo run"));
    expect(onConfigure).toHaveBeenCalled();
  });

  it("renders status, agent chips, metrics, and run controls when running", () => {
    runningState();
    render(<DuoDashboard />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/codex\/gpt-5.5/)).toBeInTheDocument();
    expect(screen.getByText("agreements")).toBeInTheDocument();
    expect(screen.getByText("$0.12")).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("shows the analyst warming-up placeholder until a snapshot arrives", () => {
    runningState();
    render(<DuoDashboard />);
    expect(screen.getByText(/Analyst warming up/i)).toBeInTheDocument();
  });

  it("renders the analyst report (headline, gauges, risks, recommendations)", () => {
    runningState();
    useDuoStore.setState({ analystSnapshot: { narrative: REPORT.narrative, report: REPORT, series: [] } });
    render(<DuoDashboard />);
    expect(screen.getByText("Steady progress with minor rework")).toBeInTheDocument();
    expect(screen.getByText("78")).toBeInTheDocument(); // collaboration health gauge
    expect(screen.getByText("no e2e coverage")).toBeInTheDocument();
    expect(screen.getByText(/add an e2e test/)).toBeInTheDocument();
    expect(screen.getByText("repeated test gaps", { exact: false })).toBeInTheDocument();
  });

  it("renders the Conversation section with the timeline and a summary line", () => {
    runningState();
    useDuoStore.setState({
      dialogue: [
        { id: "1", round: 1, author: "primary", stance: "work", text: "Implemented the feature", ts: 1 },
        {
          id: "2", round: 1, author: "duo", stance: "review", text: "Looks good", ts: 2,
          verdict: { stance: "agree", severity: "nit", confidence: 0.9, ranBuild: true, ranTests: true },
        },
        { id: "3", round: 1, author: "system", stance: "resolve", text: "Agreement reached — primary's work accepted.", ts: 3 },
      ],
    });
    render(<DuoDashboard />);
    expect(screen.getByText("Conversation")).toBeInTheDocument();
    expect(screen.getByText("Implemented the feature")).toBeInTheDocument();
    // Summary line counts agent exchanges (system markers excluded) + last outcome.
    expect(screen.getByText(/2 exchanges/)).toBeInTheDocument();
    expect(screen.getByText(/last outcome: Agreement reached/)).toBeInTheDocument();
  });

  it("Pause toggles the run to paused", () => {
    runningState();
    render(<DuoDashboard />);
    fireEvent.click(screen.getByText("Pause"));
    expect(useDuoStore.getState().status).toBe("paused");
  });

  it("Stop requires a two-step confirm and then completes the run", () => {
    runningState();
    render(<DuoDashboard />);
    fireEvent.click(screen.getByText("Stop"));
    expect(screen.getByText("Confirm stop?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm stop?"));
    expect(useDuoStore.getState().status).toBe("completed");
  });
});
