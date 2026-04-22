/**
 * Integration regression for the SpecWriter input analyzer (Stage 2).
 *
 * Feeds the real doubled v3.0+v3.1 SpecLoom file from `_examples/` and
 * asserts the analyzer (a) detects the doubled content, (b) emits a
 * blocking clarification with usable resolution options, and (c) reports
 * fidelity-zone counts the user can confirm.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeInput } from "../../lib/spec-input-analyzer";

const EXAMPLES_DIR = join(process.cwd(), "_examples");

function readExample(filename: string): string {
  return readFileSync(join(EXAMPLES_DIR, filename), "utf-8");
}

describe("spec input analyzer — Knowledge Workbench v3.0+v3.1 doubled-input regression", () => {
  it("detects the doubled v3.0+v3.1 input as a blocking finding", () => {
    const content = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const analysis = analyzeInput([
      { name: "SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md", content },
    ]);

    const doubled = analysis.findings.find((f) => f.kind === "doubled-input");
    expect(doubled).toBeDefined();
    if (doubled?.kind === "doubled-input") {
      expect(doubled.severity).toBe("block");
      expect(doubled.occurrences).toBeGreaterThanOrEqual(2);
      // The detector reports the most-distinctive duplicated section title.
      // For this file (where the H1 of the second copy got glued mid-line and
      // doesn't parse as a heading), it falls back to the first duplicate H2,
      // which is "0. What This Document Covers".
      expect(doubled.duplicateHeading).toBeTruthy();
    }
  });

  it("emits a clarifying question with at least 3 resolution options", () => {
    const content = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const analysis = analyzeInput([
      { name: "SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md", content },
    ]);

    expect(analysis.clarifications).toHaveLength(1);
    const clar = analysis.clarifications[0];
    expect(clar.options.length).toBeGreaterThanOrEqual(3);
    // The options should give the user a way to pick one copy or stop.
    const joined = clar.options.join(" ").toLowerCase();
    expect(joined).toContain("first");
    expect(joined).toContain("second");
  });

  it("reports a non-trivial fidelity-zone summary (SQL + costs + models)", () => {
    const content = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const analysis = analyzeInput([
      { name: "SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md", content },
    ]);

    const summary = analysis.findings.find((f) => f.kind === "fidelity-zone-summary");
    expect(summary).toBeDefined();
    if (summary?.kind === "fidelity-zone-summary") {
      // The v3.1 spec defines several SQL tables, dollar figures, and named models.
      expect(summary.counts.sql).toBeGreaterThan(0);
      expect(summary.counts.cost).toBeGreaterThan(0);
      expect(summary.counts.model).toBeGreaterThan(0);
    }
  });

  it("renders a markdown report that mentions the source file and finding categories", () => {
    const content = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const analysis = analyzeInput([
      { name: "SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md", content },
    ]);

    expect(analysis.report).toContain("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    expect(analysis.report).toMatch(/Blocking/i);
    expect(analysis.report).toMatch(/Verbatim-fidelity/i);
  });
});
