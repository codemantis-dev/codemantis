import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DuoDashboard from "./DuoDashboard";
import { useDuoStore, emptyDuoMetrics } from "../../stores/duoStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { DuoAnalystReport, DuoConfig } from "../../types/duo";
import type { SessionStats } from "../../types/session";

function makeStats(p: Partial<SessionStats>): SessionStats {
  return {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    turnCount: 1,
    apiCallCount: 1,
    totalReasoningOutputTokens: 0,
    ...p,
  };
}

const DUO_CONFIG = {
  primary: { agentId: "codex", model: "gpt-5.5" },
  duo: { agentId: "claude_code", model: "claude-opus-4-8" },
} as unknown as DuoConfig;

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
      metrics: { ...emptyDuoMetrics(), reviews: 2, agreements: 1, disagreements: 1, repairs: 1, agreementRate: 0.5 },
    });
    render(<DuoDashboard />);
    expect(screen.getByText("agreements")).toBeInTheDocument();
    expect(screen.getByText("reviews")).toBeInTheDocument();
  });

  it("renders the per-role cost breakdown: real mentor $, estimated primary $ + tokens, analyst $", () => {
    // Mentor (Claude) self-reports real cost; primary (Codex) reports none, so it
    // is estimated from token usage × pricing; analyst arrives via the snapshot.
    useDuoStore.setState({
      metrics: { ...emptyDuoMetrics(), costAnalystUsd: 0.01 },
      primarySessionId: "p1",
      duoSessionId: "m1",
      config: DUO_CONFIG,
    });
    useSessionStore.setState((s) => {
      const sessionStats = new Map(s.sessionStats);
      sessionStats.set("p1", makeStats({ totalCostUsd: 0, totalInputTokens: 20_000, totalOutputTokens: 0 }));
      sessionStats.set("m1", makeStats({ totalCostUsd: 0.04 }));
      return { sessionStats };
    });
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, modelPricing: { ...s.settings.modelPricing, "gpt-5.5": { input: 5.0, output: 30.0 } } },
    }));

    render(<DuoDashboard />);
    expect(screen.getByText("primary")).toBeInTheDocument();
    expect(screen.getByText("mentor")).toBeInTheDocument();
    expect(screen.getByText("analyst")).toBeInTheDocument();
    // primary: 20K input × $5/1M = $0.10, estimated → "~$0.10 · 20.0K"
    expect(screen.getByText(/~\$0\.10 · 20\.0K/)).toBeInTheDocument();
    expect(screen.getByText("$0.04")).toBeInTheDocument(); // mentor real
    expect(screen.getByText("$0.01")).toBeInTheDocument(); // analyst
    expect(screen.getByText("$0.15")).toBeInTheDocument(); // total
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
