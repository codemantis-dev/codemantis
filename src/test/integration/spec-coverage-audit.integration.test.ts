/**
 * Integration regression for the SpecWriter coverage audit.
 *
 * Feeds the real Knowledge Workbench v3.1 input + the real (broken) SpecWriter
 * output from `_examples/` into the audit and asserts that every gap the
 * forensic comparison catalogued (see plans/this-is-a-forensic-logical-iverson.md)
 * is now mechanically detected.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditCoverage } from "../../lib/spec-coverage-audit";

// Examples live at the repo root. Resolve from process.cwd() (which is the
// repo root when vitest runs), not from this test file's location, since the
// transform layer makes import.meta.url awkward to use here.
const EXAMPLES_DIR = join(process.cwd(), "_examples");

function readExample(filename: string): string {
  return readFileSync(join(EXAMPLES_DIR, filename), "utf-8");
}

describe("spec coverage audit — Knowledge Workbench v3.1 regression", () => {
  it("catches the silent rename of `quick_notes` → `notes`", () => {
    const input = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const output = readExample("specloom-knowledge-workbench.md");

    const report = auditCoverage(
      [{ name: "SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md", content: input }],
      output,
      { byteRatioFloor: 0 }, // disable the byte floor so the schema-rename signal is clearly the failure
    );

    expect(report.status).toBe("fail");
    const renames = report.failures.filter((f) => f.kind === "schema-rename");
    const renamedNames = renames.map((f) => (f.kind === "schema-rename" ? f.inputName : ""));
    expect(renamedNames).toContain("quick_notes");
  });

  it("catches missing cost figures from §17", () => {
    const input = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const output = readExample("specloom-knowledge-workbench.md");

    const report = auditCoverage(
      [{ name: "input.md", content: input }],
      output,
      { byteRatioFloor: 0 },
    );

    const missingNumeric = report.failures.filter(
      (f) => f.kind === "missing-numeric" && f.what === "cost",
    );
    // Forensic report counted 0 dollar figures in the output but many in the input.
    expect(missingNumeric.length).toBeGreaterThan(5);
  });

  it("catches missing model names from §16", () => {
    const input = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const output = readExample("specloom-knowledge-workbench.md");

    const report = auditCoverage(
      [{ name: "input.md", content: input }],
      output,
      { byteRatioFloor: 0 },
    );

    const driftHits = report.failures
      .filter((f) => f.kind === "fidelity-drift")
      .filter((f) => f.kind === "fidelity-drift" && f.zone.kind === "model-name");
    // Input mentions grok-4.20-*, gemini-3-flash-preview, claude-sonnet-4-6 — none in output.
    expect(driftHits.length).toBeGreaterThan(2);
  });

  it("flags multiple missing input sections (§16, §17, §20, §23, §25, §29 from forensic report)", () => {
    const input = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const output = readExample("specloom-knowledge-workbench.md");

    const report = auditCoverage(
      [{ name: "input.md", content: input }],
      output,
      { byteRatioFloor: 0 },
    );

    const missing = report.failures.filter((f) => f.kind === "missing-section");
    // We don't assert on exact section numbers (the doubled input + heading detection
    // is heuristic) — instead, assert the audit reports a substantial set of missing
    // sections (forensic report counted at least 6 entirely missing).
    expect(missing.length).toBeGreaterThan(5);
  });

  it("produces a non-empty recheck prompt that mentions the forensic gaps", () => {
    const input = readExample("SpecLoom_Knowledge_Workbench_Feature_Spec_v3.md");
    const output = readExample("specloom-knowledge-workbench.md");

    const report = auditCoverage(
      [{ name: "input.md", content: input }],
      output,
      { byteRatioFloor: 0 },
    );

    expect(report.recheckPrompts).toHaveLength(1);
    const prompt = report.recheckPrompts[0];
    expect(prompt).toContain("AUDIT-PATCH");
    // Schema rename should make it into the recheck prompt.
    expect(prompt).toContain("quick_notes");
  });
});
