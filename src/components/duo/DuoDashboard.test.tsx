import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DuoDashboard from "./DuoDashboard";
import { useDuoStore, emptyDuoMetrics } from "../../stores/duoStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { DuoAnalystReport } from "../../types/duo";

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

describe("DuoDashboard (metadata body)", () => {
  beforeEach(() => resetAllStores());

  it("shows the analyst warming-up placeholder until a snapshot arrives", () => {
    useDuoStore.setState({ metrics: emptyDuoMetrics() });
    render(<DuoDashboard />);
    expect(screen.getByText(/Analyst warming up/i)).toBeInTheDocument();
  });

  it("renders metrics tiles", () => {
    useDuoStore.setState({
      metrics: { ...emptyDuoMetrics(), reviews: 2, agreements: 1, disagreements: 1, repairs: 1, costUsd: 0.12, agreementRate: 0.5 },
    });
    render(<DuoDashboard />);
    expect(screen.getByText("agreements")).toBeInTheDocument();
    expect(screen.getByText("$0.12")).toBeInTheDocument();
  });

  it("renders the analyst report (headline, gauges, risks, recommendations, watch items)", () => {
    useDuoStore.setState({
      metrics: emptyDuoMetrics(),
      analystSnapshot: { narrative: REPORT.narrative, report: REPORT, series: [] },
    });
    render(<DuoDashboard />);
    expect(screen.getByText("Steady progress with minor rework")).toBeInTheDocument();
    expect(screen.getByText("78")).toBeInTheDocument(); // collaboration health gauge
    expect(screen.getByText("no e2e coverage")).toBeInTheDocument();
    expect(screen.getByText(/add an e2e test/)).toBeInTheDocument();
    expect(screen.getByText("repeated test gaps", { exact: false })).toBeInTheDocument();
  });

  it("does NOT render run controls or the conversation (those moved to DuoWorkspace)", () => {
    useDuoStore.setState({ metrics: emptyDuoMetrics() });
    render(<DuoDashboard />);
    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
    expect(screen.queryByText("Stop")).not.toBeInTheDocument();
    expect(screen.queryByText("Conversation")).not.toBeInTheDocument();
  });
});
