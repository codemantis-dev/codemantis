import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CoveragePanel from "./CoveragePanel";
import type { CoverageAuditReport, InputAnalysis, StreamStats } from "../../types/spec-writer";

function makeReport(overrides: Partial<CoverageAuditReport> = {}): CoverageAuditReport {
  return {
    status: "fail",
    inputDocs: [
      { name: "spec.md", bytes: 12_345, sections: [] },
    ],
    output: { sections: 7, bytes: 8_000 },
    ratios: { byteRatio: 0.65, sectionRatio: 0.7 },
    failures: [
      { kind: "missing-section", inputRef: "§16", title: "Model Configuration", source: "spec.md" },
      { kind: "schema-rename", inputName: "quick_notes" },
      { kind: "missing-numeric", what: "cost", sample: "$0.05" },
    ],
    recheckPrompts: ["recheck please"],
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<InputAnalysis> = {}): InputAnalysis {
  return {
    docs: [{ name: "spec.md", bytes: 12_345, sections: [] }],
    findings: [
      {
        kind: "doubled-input",
        source: "spec.md",
        duplicateHeading: "Overview",
        occurrences: 2,
        severity: "block",
      },
      {
        kind: "fidelity-zone-summary",
        source: "spec.md",
        counts: { sql: 3, cost: 14, model: 2, enum: 0 },
        severity: "info",
      },
    ],
    clarifications: [],
    report: "...",
    ...overrides,
  };
}

describe("CoveragePanel", () => {
  it("shows the empty state when nothing has been audited yet", () => {
    render(<CoveragePanel report={null} analysis={null} onRecheck={() => {}} />);
    expect(screen.getByText(/Coverage panel/i)).toBeInTheDocument();
    expect(screen.getByText(/spot quality problems/i)).toBeInTheDocument();
  });

  it("renders the failure summary and counts when the report failed", () => {
    render(<CoveragePanel report={makeReport()} analysis={null} onRecheck={() => {}} />);
    expect(screen.getAllByText(/FAIL/).length).toBeGreaterThan(0);
    // The "3 findings" string appears in both the section header and the recheck footer.
    expect(screen.getAllByText(/3 finding/).length).toBeGreaterThan(0);
    // Count badges + detailed-findings list both reference these — assert at least one each.
    expect(screen.getAllByText(/missing section/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/schema rename/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/missing numeric/i).length).toBeGreaterThan(0);
  });

  it("renders a PASS summary without showing the recheck footer", () => {
    const passReport = makeReport({ status: "pass", failures: [], recheckPrompts: [] });
    render(<CoveragePanel report={passReport} analysis={null} onRecheck={() => {}} />);
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
    expect(screen.queryByText(/Run another recheck/)).not.toBeInTheDocument();
  });

  it("calls onRecheck when the recheck button is clicked", () => {
    const spy = vi.fn();
    render(<CoveragePanel report={makeReport()} analysis={null} onRecheck={spy} />);
    fireEvent.click(screen.getByRole("button", { name: /Run another recheck/ }));
    expect(spy).toHaveBeenCalledOnce();
  });

  it("disables the recheck button while recheck is in flight", () => {
    render(
      <CoveragePanel report={makeReport()} analysis={null} onRecheck={() => {}} recheckInFlight />,
    );
    const btn = screen.getByRole("button", { name: /Recheck/ });
    expect(btn).toBeDisabled();
  });

  it("renders input analysis findings + fidelity-zone summary", () => {
    render(<CoveragePanel report={null} analysis={makeAnalysis()} onRecheck={() => {}} />);
    expect(screen.getByText(/Input analysis/)).toBeInTheDocument();
    expect(screen.getByText(/1 doc scanned/)).toBeInTheDocument();
    // spec.md appears in both the doc list and inside the finding descriptions.
    expect(screen.getAllByText(/spec\.md/).length).toBeGreaterThan(0);
    expect(screen.getByText(/doubled input/i)).toBeInTheDocument();
    expect(screen.getByText(/3 SQL table/)).toBeInTheDocument();
  });

  it("renders BOTH input analysis and coverage report side-by-side when present", () => {
    render(
      <CoveragePanel
        report={makeReport()}
        analysis={makeAnalysis()}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByText(/Input analysis/)).toBeInTheDocument();
    expect(screen.getByText(/Coverage audit/)).toBeInTheDocument();
  });

  it("does not show the recheck footer when there are no recheck prompts", () => {
    render(
      <CoveragePanel
        report={makeReport({ recheckPrompts: [] })}
        analysis={null}
        onRecheck={() => {}}
      />,
    );
    expect(screen.queryByText(/Run another recheck/)).not.toBeInTheDocument();
  });

  // ─── Stage 4: stream stats section ─────────────────────────────────

  function makeStats(overrides: Partial<StreamStats> = {}): StreamStats {
    return {
      chunks: 1234,
      bytes: 56_789,
      durationMs: 12_345,
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(12_345).toISOString(),
      status: "ok",
      ...overrides,
    };
  }

  it("renders the stream-stats section with chunks/bytes/duration when status is ok", () => {
    render(<CoveragePanel report={null} analysis={null} streamStats={makeStats()} onRecheck={() => {}} />);
    expect(screen.getByText(/Stream/)).toBeInTheDocument();
    expect(screen.getByText(/OK/)).toBeInTheDocument();
    expect(screen.getByText(/1,234 chunks/)).toBeInTheDocument();
    expect(screen.getByText(/56,789 bytes/)).toBeInTheDocument();
  });

  it("flags a stalled stream prominently", () => {
    render(
      <CoveragePanel
        report={null}
        analysis={null}
        streamStats={makeStats({ status: "stalled" })}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByText(/STALLED/)).toBeInTheDocument();
    expect(screen.getByText(/No deltas arrived for 30/)).toBeInTheDocument();
  });

  it("flags an errored stream with the note", () => {
    render(
      <CoveragePanel
        report={null}
        analysis={null}
        streamStats={makeStats({ status: "errored", note: "model timeout" })}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByText(/ERRORED/)).toBeInTheDocument();
    expect(screen.getByText(/model timeout/)).toBeInTheDocument();
  });

  it("flags a cancelled stream with explanation", () => {
    render(
      <CoveragePanel
        report={null}
        analysis={null}
        streamStats={makeStats({ status: "cancelled" })}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByText(/CANCELLED/)).toBeInTheDocument();
    expect(screen.getByText(/cancelled before completion/)).toBeInTheDocument();
  });

  it("renders the stream-stats section even when there is no audit or analysis", () => {
    render(<CoveragePanel report={null} analysis={null} streamStats={makeStats()} onRecheck={() => {}} />);
    // Empty state should NOT be shown.
    expect(screen.queryByText(/Coverage panel/)).not.toBeInTheDocument();
    expect(screen.getByText(/Stream/)).toBeInTheDocument();
  });
});
