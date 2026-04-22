import { describe, it, expect } from "vitest";
import {
  auditCoverage,
  buildRecheckPrompts,
  describeFailure,
  extractFidelityZones,
  extractInputDocs,
  parseCoverageMap,
  parseSections,
  summarizeReport,
  summarizeInput,
  type InputDoc,
} from "./spec-coverage-audit";
import type { SpecMessage } from "../types/spec-writer";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeInput(name: string, body: string): InputDoc {
  return { name, content: body };
}

function makeMsg(role: SpecMessage["role"], content: string, attachments?: SpecMessage["attachments"]): SpecMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    message_type: "conversation",
    timestamp: new Date().toISOString(),
    attachments,
  };
}

// ─── parseSections ────────────────────────────────────────────────────

describe("parseSections", () => {
  it("collects H1 + H2 with section refs", () => {
    const md = `# Title\n\n## 1. Overview\nbody\n\n## 2. Data Model\nbody`;
    const sections = parseSections(md);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({ level: 1, ref: "Title" });
    expect(sections[1]).toMatchObject({ level: 2, ref: "§1", title: "1. Overview" });
    expect(sections[2]).toMatchObject({ level: 2, ref: "§2", title: "2. Data Model" });
  });

  it("ignores headings inside code fences", () => {
    const md = `## Real Section\n\n\`\`\`\n## Not A Heading\n\`\`\`\n\n## Other Real Section`;
    const sections = parseSections(md);
    expect(sections.map((s) => s.title)).toEqual(["Real Section", "Other Real Section"]);
  });

  it("handles unnumbered titles", () => {
    const md = `## Overview\n\n## Architecture`;
    const sections = parseSections(md);
    expect(sections[0].ref).toBe("Overview");
    expect(sections[1].ref).toBe("Architecture");
  });
});

// ─── parseCoverageMap ─────────────────────────────────────────────────

describe("parseCoverageMap", () => {
  it("parses a 4-column input/output map", () => {
    const output = `
| Input ref | Title | Output § | Status |
|---|---|---|---|
| §1 | Overview | §1 | covered |
| §16 | Model Configuration | §3.10 | verbatim-reproduced |
`;
    const rows = parseCoverageMap(output);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ inputRef: "§1", outputRef: "§1", status: "covered" });
    expect(rows[1]).toMatchObject({ inputRef: "§16", outputRef: "§3.10", status: "verbatim-reproduced" });
  });

  it("returns empty when no map present", () => {
    expect(parseCoverageMap("# Spec\n\n## Overview\nbody")).toEqual([]);
  });
});

// ─── extractFidelityZones ─────────────────────────────────────────────

describe("extractFidelityZones", () => {
  it("captures CREATE TABLE names", () => {
    const docs = [makeInput("spec.md", "CREATE TABLE quick_notes (id uuid);\nCREATE TABLE note_probes (id uuid);")];
    const zones = extractFidelityZones(docs);
    const tables = zones.filter((z) => z.kind === "table-name").map((z) => z.signature);
    expect(tables).toContain("quick_notes");
    expect(tables).toContain("note_probes");
  });

  it("captures cost figures", () => {
    const docs = [makeInput("costs.md", "Per note: $0.001\nPer sync: $0.08")];
    const zones = extractFidelityZones(docs);
    const costs = zones.filter((z) => z.kind === "cost-figure").map((z) => z.signature);
    expect(costs).toEqual(expect.arrayContaining(["$0.001", "$0.08"]));
  });

  it("captures version-tagged model names", () => {
    const docs = [makeInput("models.md", "Use claude-sonnet-4-6 or grok-4.20-reasoning-latest")];
    const zones = extractFidelityZones(docs);
    const models = zones.filter((z) => z.kind === "model-name").map((z) => z.signature);
    expect(models.some((m) => m.includes("claude-sonnet-4-6"))).toBe(true);
    expect(models.some((m) => m.startsWith("grok-4"))).toBe(true);
  });

  it("captures enum values from CHECK clauses", () => {
    const docs = [makeInput("schema.md", "status text CHECK (status IN ('draft', 'active', 'archived'))")];
    const zones = extractFidelityZones(docs);
    const enums = zones.filter((z) => z.kind === "enum-value").map((z) => z.signature);
    expect(enums).toEqual(expect.arrayContaining(["draft", "active", "archived"]));
  });

  it("deduplicates", () => {
    const docs = [makeInput("a.md", "CREATE TABLE notes (id);"), makeInput("b.md", "CREATE TABLE notes (id);")];
    const zones = extractFidelityZones(docs);
    expect(zones.filter((z) => z.kind === "table-name" && z.signature === "notes")).toHaveLength(1);
  });
});

// ─── extractInputDocs ─────────────────────────────────────────────────

describe("extractInputDocs", () => {
  it("pulls attachment text_content", () => {
    const messages: SpecMessage[] = [
      makeMsg("user", "see attachment", [
        {
          id: "a1",
          type: "document",
          name: "spec.md",
          size: 100,
          mime_type: "text/markdown",
          file_path: "/tmp/spec.md",
          text_content: "# Spec\n\n## Overview\nbody",
        },
      ]),
    ];
    const docs = extractInputDocs(messages);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe("spec.md");
    expect(docs[0].content).toContain("# Spec");
  });

  it("treats long pasted document-shaped messages as input docs", () => {
    const longSpec = "# Pasted Spec\n\n## Overview\n" + "x".repeat(2000);
    const messages: SpecMessage[] = [makeMsg("user", longSpec)];
    const docs = extractInputDocs(messages);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toMatch(/^pasted-message-/);
  });

  it("ignores short chat messages", () => {
    const messages: SpecMessage[] = [makeMsg("user", "hi, please write a spec for X")];
    expect(extractInputDocs(messages)).toEqual([]);
  });

  it("ignores assistant + system messages", () => {
    const longish = "# A\n\n## B\n## C\n## D\n" + "x".repeat(2000);
    const messages: SpecMessage[] = [
      makeMsg("assistant", longish),
      makeMsg("system", longish),
    ];
    expect(extractInputDocs(messages)).toEqual([]);
  });
});

// ─── auditCoverage ────────────────────────────────────────────────────

describe("auditCoverage", () => {
  const goodInput = `# Source Spec

## 1. Overview
Body.

## 2. Data Model
\`\`\`sql
CREATE TABLE quick_notes (id uuid PRIMARY KEY);
\`\`\`

## 3. Costs
Per note: $0.001
`;

  const goodOutput = `# Spec

| Input ref | Title | Output § | Status |
|---|---|---|---|
| §1 | Overview | §1 | covered |
| §2 | Data Model | §2 | verbatim-reproduced |
| §3 | Costs | §3 | covered |

## 1. Overview
text.

## 2. Data Model
\`\`\`sql
CREATE TABLE quick_notes (id uuid PRIMARY KEY);
\`\`\`

## 3. Costs
Per note: $0.001 per call.
`;

  it("PASSes when output covers every input section + verbatim zones + numerics", () => {
    const report = auditCoverage([makeInput("spec.md", goodInput)], goodOutput);
    expect(report.status).toBe("pass");
    expect(report.failures).toEqual([]);
    expect(report.recheckPrompts).toEqual([]);
  });

  it("FAILs when an input section is missing from the output", () => {
    const truncatedOutput = `# Spec\n\n## 1. Overview\nbody.\n\n## 2. Data Model\n\`\`\`sql\nCREATE TABLE quick_notes (id uuid);\n\`\`\`\n\nPer note: $0.001 done.`;
    const report = auditCoverage([makeInput("spec.md", goodInput)], truncatedOutput);
    expect(report.status).toBe("fail");
    expect(report.failures.some((f) => f.kind === "missing-section")).toBe(true);
  });

  it("FAILs when a table name is silently renamed (Knowledge Workbench regression)", () => {
    const renamedOutput = `# Spec

| Input ref | Title | Output § | Status |
|---|---|---|---|
| §1 | Overview | §1 | covered |
| §2 | Data Model | §2 | covered |
| §3 | Costs | §3 | covered |

## 1. Overview
text.

## 2. Data Model
\`\`\`sql
CREATE TABLE notes (id uuid);
\`\`\`

## 3. Costs
Per note: $0.001.`;
    const report = auditCoverage([makeInput("spec.md", goodInput)], renamedOutput);
    expect(report.status).toBe("fail");
    expect(report.failures.some((f) => f.kind === "schema-rename" && f.inputName === "quick_notes")).toBe(true);
  });

  it("FAILs when cost figures are dropped", () => {
    const noCostsOutput = `# Spec

| Input ref | Title | Output § | Status |
|---|---|---|---|
| §1 | Overview | §1 | covered |
| §2 | Data Model | §2 | covered |
| §3 | Costs | §3 | covered |

## 1. Overview
text.

## 2. Data Model
\`\`\`sql
CREATE TABLE quick_notes (id uuid);
\`\`\`

## 3. Costs
Costs are negligible.`;
    const report = auditCoverage([makeInput("spec.md", goodInput)], noCostsOutput);
    expect(report.status).toBe("fail");
    expect(report.failures.some((f) => f.kind === "missing-numeric" && f.what === "cost")).toBe(true);
  });

  it("FAILs when output is truncated mid-fence", () => {
    const truncated = `# Spec

| Input ref | Title | Output § | Status |
|---|---|---|---|
| §1 | Overview | §1 | covered |
| §2 | Data Model | §2 | covered |
| §3 | Costs | §3 | covered |

## 1. Overview
text.

## 2. Data Model
\`\`\`sql
CREATE TABLE quick_notes (id uuid);

## 3. Costs
Per note: $0.001`;
    const report = auditCoverage([makeInput("spec.md", goodInput)], truncated);
    expect(report.status).toBe("fail");
    expect(report.failures.some((f) => f.kind === "truncation")).toBe(true);
  });

  it("FAILs when a placeholder leaks", () => {
    const leaky = goodOutput + "\n\n## 4. Future\nTBD";
    const report = auditCoverage([makeInput("spec.md", goodInput + "\n\n## 4. Future\ndetails")], leaky);
    expect(report.failures.some((f) => f.kind === "placeholder-leaked")).toBe(true);
  });

  it("FAILs when byte ratio is below floor", () => {
    const longInput = "# Long\n\n## 1. A\n" + "x".repeat(10000);
    const tinyOutput = "# Spec\n\n## 1. A\nshort.\n";
    const report = auditCoverage([makeInput("long.md", longInput)], tinyOutput);
    expect(report.failures.some((f) => f.kind === "byte-ratio-low")).toBe(true);
  });

  it("PASSes for new-app mode even with no input", () => {
    const report = auditCoverage([], "# Spec\n\n## Overview\ntext.\n", { skipForNewApp: true });
    expect(report.status).toBe("pass");
  });

  it("skips the byte-ratio floor when configured", () => {
    const longInput = "# Long\n\n## 1. A\n" + "x".repeat(10000);
    const tinyOutput = "# Spec\n\n## 1. A\nshort.\n";
    const report = auditCoverage([makeInput("long.md", longInput)], tinyOutput, { byteRatioFloor: 0 });
    expect(report.failures.some((f) => f.kind === "byte-ratio-low")).toBe(false);
  });

  it("flags coverage-map rows that point to absent output sections", () => {
    const inputDoc = "# Spec\n\n## 1. Overview\nbody";
    const output = `# Spec

| Input ref | Title | Output § | Status |
|---|---|---|---|
| §1 | Overview | §99 | covered |

## 1. Overview
body.
`;
    const report = auditCoverage([makeInput("spec.md", inputDoc)], output);
    expect(report.failures.some((f) => f.kind === "unmapped-section")).toBe(true);
  });
});

// ─── buildRecheckPrompts / summarizeReport ────────────────────────────

describe("buildRecheckPrompts", () => {
  it("includes missing sections, schema renames, cost values, drift, and truncation", () => {
    const prompts = buildRecheckPrompts([
      { kind: "missing-section", inputRef: "§16", title: "Model Configuration", source: "spec.md" },
      { kind: "schema-rename", inputName: "quick_notes" },
      { kind: "missing-numeric", what: "cost", sample: "$0.05" },
      {
        kind: "fidelity-drift",
        zone: { kind: "model-name", source: "spec.md", signature: "claude-sonnet-4-6" },
      },
      { kind: "truncation", lastHeading: "Sync", tail: "...something..." },
    ]);
    expect(prompts).toHaveLength(1);
    const p = prompts[0];
    expect(p).toContain("AUDIT-PATCH");
    expect(p).toContain("Model Configuration");
    expect(p).toContain("quick_notes");
    expect(p).toContain("$0.05");
    expect(p).toContain("claude-sonnet-4-6");
    expect(p).toContain("Sync");
  });

  it("returns no prompts when there are no failures", () => {
    expect(buildRecheckPrompts([])).toEqual([]);
  });
});

describe("summarizeReport / describeFailure", () => {
  it("renders a one-line PASS summary", () => {
    const r = auditCoverage([], "# Spec\n\n## A\ntext.", { skipForNewApp: true });
    const s = summarizeReport(r);
    expect(s).toMatch(/PASS/);
  });

  it("renders a counts FAIL summary", () => {
    const s = summarizeReport({
      status: "fail",
      inputDocs: [],
      output: { sections: 0, bytes: 0 },
      ratios: { byteRatio: 0.3, sectionRatio: 0 },
      failures: [
        { kind: "missing-section", inputRef: "§1", title: "X", source: "s.md" },
        { kind: "schema-rename", inputName: "t" },
      ],
      recheckPrompts: [],
    });
    expect(s).toMatch(/FAIL/);
    expect(s).toMatch(/missing section/);
    expect(s).toMatch(/schema rename/);
  });

  it("describeFailure handles all variants", () => {
    expect(describeFailure({ kind: "missing-section", inputRef: "§1", title: "T", source: "s" })).toContain("§1");
    expect(describeFailure({ kind: "unmapped-section", inputRef: "§1", title: "T", source: "s" })).toContain("§1");
    expect(describeFailure({ kind: "schema-rename", inputName: "t" })).toContain("t");
    expect(
      describeFailure({ kind: "fidelity-drift", zone: { kind: "model-name", source: "s", signature: "m" } }),
    ).toMatch(/drift/);
    expect(describeFailure({ kind: "missing-numeric", what: "cost", sample: "$0" })).toContain("$0");
    expect(describeFailure({ kind: "truncation", lastHeading: "H", tail: "" })).toContain("truncated");
    expect(describeFailure({ kind: "placeholder-leaked", quote: "TBD" })).toContain("TBD");
    expect(describeFailure({ kind: "byte-ratio-low", ratio: 0.3, floor: 0.6 })).toContain("30%");
  });
});

// ─── summarizeInput ───────────────────────────────────────────────────

describe("summarizeInput", () => {
  it("returns name, bytes, and section list", () => {
    const summary = summarizeInput(makeInput("spec.md", "# A\n\n## 1. Overview\n## 2. Costs"));
    expect(summary.name).toBe("spec.md");
    expect(summary.bytes).toBeGreaterThan(0);
    expect(summary.sections.filter((s) => s.level === 2)).toHaveLength(2);
  });
});
