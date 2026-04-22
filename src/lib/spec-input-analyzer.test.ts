import { describe, it, expect } from "vitest";
import {
  analyzeInput,
  analyzeMessages,
  describeFinding,
  renderClarificationMessage,
} from "./spec-input-analyzer";
import type { SpecMessage } from "../types/spec-writer";

function doc(name: string, content: string): { name: string; content: string } {
  return { name, content };
}

// ─── doubled-input ────────────────────────────────────────────────────

describe("analyzeInput — doubled-input", () => {
  it("flags when most H2s are duplicated (the v3.0 + v3.1 case)", () => {
    const body = `# Spec\n\n## 0. Overview\nbody\n\n## 1. Data\nbody\n\n## 2. Tests\nbody\n\n## 3. Costs\nbody`;
    const doubled = body + "\n\n" + body;
    const analysis = analyzeInput([doc("v3.md", doubled)]);
    const dbl = analysis.findings.find((f) => f.kind === "doubled-input");
    expect(dbl).toBeDefined();
    if (dbl?.kind === "doubled-input") {
      expect(dbl.severity).toBe("block");
      expect(dbl.duplicateHeading).toBe("Spec");
      expect(dbl.occurrences).toBe(2);
    }
    expect(analysis.clarifications).toHaveLength(1);
    expect(analysis.clarifications[0].options.length).toBeGreaterThanOrEqual(3);
  });

  it("does NOT flag normal docs with unique sections", () => {
    const body = `# Spec\n\n## 1. A\nbody\n\n## 2. B\nbody\n\n## 3. C\nbody\n\n## 4. D\nbody`;
    const analysis = analyzeInput([doc("clean.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "doubled-input")).toBeUndefined();
    expect(analysis.clarifications).toHaveLength(0);
  });

  it("does not over-fire on docs with too few sections to be statistically doubled", () => {
    const body = `# A\n\n## 1. X\nbody\n\n## 1. X\nbody`; // only 2 H2s, both same
    const analysis = analyzeInput([doc("tiny.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "doubled-input")).toBeUndefined();
  });
});

// ─── truncation ───────────────────────────────────────────────────────

describe("analyzeInput — truncation", () => {
  it("flags input ending mid code-fence", () => {
    const body = `# Spec\n\n## 1. Schema\n\`\`\`sql\nCREATE TABLE notes (id uuid);`;
    const analysis = analyzeInput([doc("trunc.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "truncated-input")).toBeDefined();
  });

  it("flags input ending with ellipsis", () => {
    const body = `# Spec\n\n## 1. Overview\nbody...`;
    const analysis = analyzeInput([doc("trunc.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "truncated-input")).toBeDefined();
  });

  it("flags input whose last line is a heading with no body", () => {
    const body = `# Spec\n\n## 1. Overview\nbody\n\n## 2. Empty`;
    const analysis = analyzeInput([doc("trunc.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "truncated-input")).toBeDefined();
  });
});

// ─── placeholders ─────────────────────────────────────────────────────

describe("analyzeInput — placeholders", () => {
  it("flags TBD/TODO/FIXME/<insert> in input", () => {
    const body = `# Spec\n\n## 1. Plan\nTBD by friday\n\n## 2. Logic\n<insert detail here>`;
    const analysis = analyzeInput([doc("draft.md", body)]);
    const placeholders = analysis.findings.filter((f) => f.kind === "placeholder-in-input");
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag clean input", () => {
    const body = `# Spec\n\n## 1. Plan\nReady to ship.`;
    const analysis = analyzeInput([doc("clean.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "placeholder-in-input")).toBeUndefined();
  });
});

// ─── dangling cross-refs ──────────────────────────────────────────────

describe("analyzeInput — dangling-cross-ref", () => {
  it("flags §X references that don't resolve", () => {
    const body = `# Spec\n\n## 1. Plan\nSee §16 for details.\n\n## 2. End\n.`;
    const analysis = analyzeInput([doc("a.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "dangling-cross-ref" && f.ref === "§16")).toBeDefined();
  });

  it("does not flag §X references that DO resolve", () => {
    const body = `# Spec\n\n## 1. Plan\nSee §2 for details.\n\n## 2. Detail\nhere.`;
    const analysis = analyzeInput([doc("a.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "dangling-cross-ref")).toBeUndefined();
  });
});

// ─── thin promised section ────────────────────────────────────────────

describe("analyzeInput — thin-section", () => {
  it("flags promised sections (Schema/Prompts/Tests/Model Config) with thin body", () => {
    const body = `# Spec\n\n## 16. Model Configuration\nsee elsewhere\n\n## 17. Other\n` + "x".repeat(500);
    const analysis = analyzeInput([doc("a.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "thin-section")).toBeDefined();
  });

  it("does not flag full sections", () => {
    const body = `# Spec\n\n## 16. Model Configuration\n` + "x".repeat(500) + `\n\n## 17. Other\n` + "x".repeat(500);
    const analysis = analyzeInput([doc("a.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "thin-section")).toBeUndefined();
  });

  it("does not flag thin sections that aren't on the promised list", () => {
    const body = `# Spec\n\n## 1. Random Heading\nshort\n\n## 2. Other\n` + "x".repeat(500);
    const analysis = analyzeInput([doc("a.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "thin-section")).toBeUndefined();
  });
});

// ─── fidelity-zone summary ────────────────────────────────────────────

describe("analyzeInput — fidelity-zone-summary", () => {
  it("counts SQL tables, costs, models", () => {
    const body = `# Spec\n\n## 1. Schema\nCREATE TABLE notes (id);\n\n## 2. Costs\n$0.05 per call\n\n## 3. Models\nUse claude-sonnet-4-6.`;
    const analysis = analyzeInput([doc("a.md", body)]);
    const summary = analysis.findings.find((f) => f.kind === "fidelity-zone-summary");
    expect(summary).toBeDefined();
    if (summary?.kind === "fidelity-zone-summary") {
      expect(summary.counts.sql).toBe(1);
      expect(summary.counts.cost).toBeGreaterThan(0);
      expect(summary.counts.model).toBeGreaterThan(0);
    }
  });

  it("does not emit a summary when nothing is detected", () => {
    const body = `# Spec\n\n## 1. Plain prose\nSome text only.`;
    const analysis = analyzeInput([doc("a.md", body)]);
    expect(analysis.findings.find((f) => f.kind === "fidelity-zone-summary")).toBeUndefined();
  });
});

// ─── report rendering ─────────────────────────────────────────────────

describe("analyzeInput — report", () => {
  it("includes blocking, warnings, and info sections", () => {
    const body =
      `# A\n\n## 1. X\nTBD\n\n## 2. Y\nbody\n\n## 3. Z\nbody\n\n## 4. W\nbody`;
    const doubled = body + "\n\n" + body;
    const analysis = analyzeInput([doc("v3.md", doubled)]);
    expect(analysis.report).toContain("input analysis");
    expect(analysis.report).toContain("v3.md");
    expect(analysis.report).toMatch(/Blocking/i);
  });

  it("returns 'no problems' when nothing is found", () => {
    const body = `# Spec\n\n## 1. A\n` + "x".repeat(500) + `\n\n## 2. B\n` + "x".repeat(500);
    const analysis = analyzeInput([doc("clean.md", body)]);
    expect(analysis.findings).toEqual([]);
    expect(analysis.report).toMatch(/No structural problems/);
  });
});

// ─── clarification rendering ──────────────────────────────────────────

describe("renderClarificationMessage", () => {
  it("emits ?> options with the question on top", () => {
    const text = renderClarificationMessage({
      id: "test",
      topic: "Doubled input",
      question: "How should I handle this?",
      options: ["Use first", "Use second", "Stop"],
    });
    expect(text.split("\n")[0]).toBe("How should I handle this?");
    expect(text).toContain("?> Use first");
    expect(text).toContain("?> Use second");
    expect(text).toContain("?> Stop");
  });
});

// ─── analyzeMessages ──────────────────────────────────────────────────

describe("analyzeMessages", () => {
  it("pulls input docs out of conversation messages", () => {
    const longSpec = `# Pasted Spec\n\n## 1. A\nbody\n\n## 2. B\nbody\n\n## 3. C\n` + "x".repeat(2000);
    const messages: SpecMessage[] = [
      {
        id: "m1",
        role: "user",
        content: longSpec,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      },
    ];
    const analysis = analyzeMessages(messages);
    expect(analysis.docs).toHaveLength(1);
    expect(analysis.docs[0].name).toMatch(/^pasted-message-/);
  });
});

// ─── describeFinding (smoke for all variants) ─────────────────────────

describe("describeFinding", () => {
  it("renders every variant", () => {
    expect(
      describeFinding({ kind: "doubled-input", source: "a", duplicateHeading: "X", occurrences: 2, severity: "block" }),
    ).toContain("doubled");
    expect(
      describeFinding({ kind: "truncated-input", source: "a", lastHeading: "H", tail: "t", severity: "warn" }),
    ).toContain("truncated");
    expect(
      describeFinding({ kind: "placeholder-in-input", source: "a", quote: "TBD", severity: "warn" }),
    ).toContain("placeholder");
    expect(
      describeFinding({ kind: "dangling-cross-ref", source: "a", ref: "§16", severity: "warn" }),
    ).toContain("§16");
    expect(
      describeFinding({ kind: "thin-section", source: "a", ref: "§1", title: "Schema", bytes: 10, severity: "warn" }),
    ).toContain("Schema");
    expect(
      describeFinding({
        kind: "fidelity-zone-summary",
        source: "a",
        counts: { sql: 1, cost: 1, model: 0, enum: 0 },
        severity: "info",
      }),
    ).toMatch(/SQL|cost/);
  });
});
