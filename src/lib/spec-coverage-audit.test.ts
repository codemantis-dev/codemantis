import { describe, it, expect } from "vitest";
import {
  auditCoverage,
  buildRecheckPrompts,
  describeFailure,
  extractFidelityZones,
  extractInputDocs,
  parseCoverageMap,
  parseSections,
  runUICompletenessChecks,
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

  it("threads affectedHeading verbatim into the placeholder directive", () => {
    const prompts = buildRecheckPrompts([
      {
        kind: "placeholder-leaked",
        quote: 'type-specific fields... }): Promise<void>',
        affectedHeading: '#### `createActivity(payload)`',
      },
    ]);
    expect(prompts).toHaveLength(1);
    const p = prompts[0];
    expect(p).toContain('heading="#### `createActivity(payload)`"');
    expect(p).toMatch(/verbatim/);
  });

  it("falls back to inventory-guided wording when affectedHeading is null", () => {
    const prompts = buildRecheckPrompts([
      { kind: "placeholder-leaked", quote: "TBD", affectedHeading: null },
    ]);
    const p = prompts[0];
    expect(p).toMatch(/Heading inventory/);
    expect(p).not.toContain('heading=""');
  });

  it("appends a heading inventory when output is provided", () => {
    const output = [
      "# Spec",
      "",
      "## 6. API / Data Layer",
      "",
      "### `src/lib/crm/companyDetail.ts`",
      "",
      "#### `createActivity(payload)`",
      "",
      "body",
      "",
    ].join("\n");
    const prompts = buildRecheckPrompts(
      [{ kind: "placeholder-leaked", quote: "TBD", affectedHeading: null }],
      output,
    );
    const p = prompts[0];
    expect(p).toContain("Heading inventory");
    expect(p).toContain("## 6. API / Data Layer");
    expect(p).toContain("### `src/lib/crm/companyDetail.ts`");
    expect(p).toContain("#### `createActivity(payload)`");
  });
});

describe("placeholder detection — affectedHeading capture", () => {
  it("records the enclosing H4 heading when the placeholder is nested deep", () => {
    const input = [
      "# Spec",
      "",
      "## 6. API / Data Layer",
      "",
      "section body padding to satisfy size gates. " + "x".repeat(200),
      "",
      "### `src/lib/crm/companyDetail.ts`",
      "",
      "file overview body. " + "y".repeat(200),
      "",
      "#### `createActivity(payload)`",
      "",
      "function body discussing the call. " + "z".repeat(200),
      "",
    ].join("\n");

    const output = input.replace(
      "function body discussing the call. " + "z".repeat(200),
      // Trailing `...` at end of line — matches PLACEHOLDER_PATTERNS.
      "Concrete fields:\n- foo\n- type-specific fields...",
    );

    const report = auditCoverage([{ name: "spec.md", content: input }], output);
    const ph = report.failures.find(
      (f): f is Extract<typeof report.failures[number], { kind: "placeholder-leaked" }> =>
        f.kind === "placeholder-leaked",
    );
    expect(ph).toBeDefined();
    expect(ph!.affectedHeading).toBe("#### `createActivity(payload)`");
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
    expect(describeFailure({ kind: "placeholder-leaked", quote: "TBD", affectedHeading: null })).toContain("TBD");
    expect(describeFailure({ kind: "byte-ratio-low", ratio: 0.3, floor: 0.6 })).toContain("30%");
    expect(describeFailure({ kind: "ui-orphan-entity", entity: "User" })).toContain("User");
    expect(
      describeFailure({ kind: "ui-untriggered-endpoint", endpoint: "POST /api/x" }),
    ).toContain("POST /api/x");
    expect(describeFailure({ kind: "ui-invisible-errors" })).toMatch(/UI surface/i);
    expect(
      describeFailure({ kind: "ui-session-no-outcome", session: "Session 1: X" }),
    ).toContain("Session 1: X");
    expect(
      describeFailure({
        kind: "ui-foundation-missing-justification",
        session: "Session 1: X",
      }),
    ).toContain("Session 1: X");
    expect(
      describeFailure({
        kind: "ui-foundation-non-contiguous",
        session: "Session 2: X",
      }),
    ).toContain("Session 2: X");
    expect(describeFailure({ kind: "ui-form-no-validation" })).toMatch(/validation/i);
    expect(describeFailure({ kind: "ui-list-no-states" })).toMatch(/empty/i);
  });

  it("buildRecheckPrompts surfaces UI failures with actionable patch guidance", () => {
    const prompts = buildRecheckPrompts([
      { kind: "ui-orphan-entity", entity: "User" },
      { kind: "ui-untriggered-endpoint", endpoint: "POST /api/projects" },
      { kind: "ui-invisible-errors" },
      { kind: "ui-session-no-outcome", session: "Session 1: Scaffold" },
      { kind: "ui-foundation-missing-justification", session: "Session 2: Auth" },
      { kind: "ui-foundation-non-contiguous", session: "Session 3: DB" },
      { kind: "ui-form-no-validation" },
      { kind: "ui-list-no-states" },
    ]);
    expect(prompts).toHaveLength(1);
    const p = prompts[0];
    expect(p).toContain("AUDIT-PATCH");
    expect(p).toContain("User");
    expect(p).toContain("POST /api/projects");
    expect(p).toContain("toast");
    expect(p).toContain("Session 1: Scaffold");
    expect(p).toContain("Session 2: Auth");
    expect(p).toContain("Session 3: DB");
    expect(p).toMatch(/validation/i);
    expect(p).toMatch(/empty/i);
  });
});

// ─── runUICompletenessChecks ──────────────────────────────────────────

describe("runUICompletenessChecks", () => {
  describe("orphan entities", () => {
    it("flags Data Model entities missing the Screens: field", () => {
      const spec = `# Spec\n\n## 2. Data Model\n\n### User\n- id, email, name\n\n### Project\n- id, name\nScreens: ProjectListPage, ProjectDetailPage\n`;
      const failures = runUICompletenessChecks(spec);
      const orphan = failures.filter((f) => f.kind === "ui-orphan-entity");
      expect(orphan).toHaveLength(1);
      expect(orphan[0]).toMatchObject({ kind: "ui-orphan-entity", entity: "User" });
    });

    it("accepts a backend-only declaration", () => {
      const spec = `# Spec\n\n## 2. Data Model\n\n### AuditLog\n- id, event, ts\nScreens: (backend-only — internal audit trail)\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-orphan-entity")).toBe(false);
    });

    it("does not run when Data Model section is absent", () => {
      const spec = `# Spec\n\n## Overview\ntext.\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-orphan-entity")).toBe(false);
    });
  });

  describe("untriggered endpoints", () => {
    it("flags API endpoints missing the Triggered by: field", () => {
      const spec = `# Spec\n\n## 6. API\n\n### POST /api/projects\n- creates a project\n\n### GET /api/projects\n- lists projects\nTriggered by: ProjectListPage on mount\n`;
      const failures = runUICompletenessChecks(spec);
      const ut = failures.filter((f) => f.kind === "ui-untriggered-endpoint");
      expect(ut).toHaveLength(1);
      expect(ut[0]).toMatchObject({
        kind: "ui-untriggered-endpoint",
        endpoint: "POST /api/projects",
      });
    });

    it("accepts a system-only declaration", () => {
      const spec = `# Spec\n\n## 6. API\n\n### POST /api/cron/cleanup\nTriggered by: (system — daily cleanup cron)\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-untriggered-endpoint")).toBe(false);
    });

    it("ignores Pages & Routes section headings (UI section, not API section)", () => {
      const spec = `# Spec\n\n## 3. Pages & Routes\n\n### /dashboard\n- shows the dashboard\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-untriggered-endpoint")).toBe(false);
    });
  });

  describe("invisible errors", () => {
    it("flags an Error Handling section that names no UI surface", () => {
      const spec = `# Spec\n\n## 7. Error Handling & Edge Cases\nWhen the API fails the request fails. The user retries. Errors include 500, 404, network errors, and validation problems.\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-invisible-errors")).toBe(true);
    });

    it("passes when a UI surface keyword appears", () => {
      const spec = `# Spec\n\n## 7. Error Handling\nOn API failure show a toast: "Failed to load lists. Please try again."\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-invisible-errors")).toBe(false);
    });

    it("does not run when Error Handling section is absent", () => {
      const spec = `# Spec\n\n## Overview\ntext.\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-invisible-errors")).toBe(false);
    });
  });

  describe("session outcomes", () => {
    it("flags sessions missing the User-visible outcome: field", () => {
      const spec = `# Spec\n\n## 10. Session Plan\n\n### Session 1: Scaffold\n**Scope:** initial setup\n\n### Session 2: Build the dashboard\n**Scope:** dashboard work\n**User-visible outcome:** user sees /dashboard with a 3-card grid\n`;
      const failures = runUICompletenessChecks(spec);
      const noOutcome = failures.filter((f) => f.kind === "ui-session-no-outcome");
      expect(noOutcome).toHaveLength(1);
      expect(noOutcome[0]).toMatchObject({
        kind: "ui-session-no-outcome",
        session: "Session 1: Scaffold",
      });
    });

    it("accepts (foundation) when paired with Foundation justification:", () => {
      const spec = `# Spec\n\n## 10. Session Plan\n\n### Session 1: Foundation\n**User-visible outcome:** (foundation)\n**Foundation justification:** DB schema + auth scaffolding required before any route is reachable\n\n### Session 2: Dashboard\n**User-visible outcome:** user can navigate to /dashboard and see a card grid\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-session-no-outcome")).toBe(false);
      expect(failures.some((f) => f.kind === "ui-foundation-missing-justification")).toBe(false);
      expect(failures.some((f) => f.kind === "ui-foundation-non-contiguous")).toBe(false);
    });

    it("flags (foundation) without justification", () => {
      const spec = `# Spec\n\n## 10. Session Plan\n\n### Session 1: Foundation\n**User-visible outcome:** (foundation)\n\n### Session 2: Dashboard\n**User-visible outcome:** user sees /dashboard\n`;
      const failures = runUICompletenessChecks(spec);
      expect(
        failures.some(
          (f) =>
            f.kind === "ui-foundation-missing-justification" &&
            f.session === "Session 1: Foundation",
        ),
      ).toBe(true);
    });

    it("flags foundation sessions appearing after user-visible sessions", () => {
      const spec = `# Spec\n\n## 10. Session Plan\n\n### Session 1: Dashboard\n**User-visible outcome:** user sees /dashboard with a card grid\n\n### Session 2: Backend scaffold\n**User-visible outcome:** (foundation)\n**Foundation justification:** internal worker pipeline\n`;
      const failures = runUICompletenessChecks(spec);
      expect(
        failures.some(
          (f) =>
            f.kind === "ui-foundation-non-contiguous" &&
            f.session === "Session 2: Backend scaffold",
        ),
      ).toBe(true);
    });

    it("accepts multiple contiguous foundation sessions when each is justified", () => {
      const spec = `# Spec\n\n## 10. Session Plan\n\n### Session 1: DB schema\n**User-visible outcome:** (foundation)\n**Foundation justification:** schema needed before any UI\n\n### Session 2: Auth scaffold\n**User-visible outcome:** (foundation)\n**Foundation justification:** auth required before protected routes\n\n### Session 3: Dashboard\n**User-visible outcome:** user navigates to /dashboard, sees card grid\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-session-no-outcome")).toBe(false);
      expect(failures.some((f) => f.kind === "ui-foundation-missing-justification")).toBe(false);
      expect(failures.some((f) => f.kind === "ui-foundation-non-contiguous")).toBe(false);
    });

    it("does not run when Session Plan section is absent", () => {
      const spec = `# Spec\n\n## Overview\ntext.\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-session-no-outcome")).toBe(false);
    });
  });

  describe("prose checks (form / list)", () => {
    it("does not run when no UI section is present (minimal spec)", () => {
      const spec = `# Spec\n\n## Overview\nThis app has a form for submitting data and shows a list of results.\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-form-no-validation")).toBe(false);
      expect(failures.some((f) => f.kind === "ui-list-no-states")).toBe(false);
    });

    it("does not match SQL `CREATE TABLE` inside code blocks", () => {
      const spec = `# Spec\n\n## 3. Pages & Routes\n/dashboard with a UserListView\n\n## 2. Data Model\n\`\`\`sql\nCREATE TABLE users (id uuid);\n\`\`\`\n`;
      const failures = runUICompletenessChecks(spec);
      // The only UI element mentioned is UserListView. With no states the check should fire.
      expect(failures.some((f) => f.kind === "ui-list-no-states")).toBe(true);
    });

    it("flags forms without validation language (UI spec)", () => {
      const spec = `# Spec\n\n## 3. Pages & Routes\n/signup page renders a SignupForm.\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-form-no-validation")).toBe(true);
    });

    it("passes when forms have validation specs", () => {
      const spec = `# Spec\n\n## 3. Pages & Routes\n/signup page renders a SignupForm with email and password fields and validation on submit.\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-form-no-validation")).toBe(false);
    });

    it("passes a list view with all three states named", () => {
      const spec = `# Spec\n\n## 3. Pages & Routes\nProjectListView shows projects. Empty state: "No projects yet". Loading skeleton renders 6 cards. Error banner: "Failed to load."\n`;
      const failures = runUICompletenessChecks(spec);
      expect(failures.some((f) => f.kind === "ui-list-no-states")).toBe(false);
    });
  });
});

// ─── auditCoverage UI checks integration ──────────────────────────────

describe("auditCoverage — UI-completeness integration", () => {
  it("includes UI failures in the overall failures list by default", () => {
    const spec = `# Spec\n\n## 2. Data Model\n\n### User\n- id, email\n\n## 3. Pages & Routes\n- /dashboard\n`;
    const report = auditCoverage([], spec, { skipForNewApp: true });
    expect(report.status).toBe("fail");
    expect(report.failures.some((f) => f.kind === "ui-orphan-entity")).toBe(true);
  });

  it("skipUIChecks=true suppresses UI failures", () => {
    const spec = `# Spec\n\n## 2. Data Model\n\n### User\n- id, email\n\n## 3. Pages & Routes\n- /dashboard\n`;
    const report = auditCoverage([], spec, { skipForNewApp: true, skipUIChecks: true });
    expect(report.failures.some((f) => f.kind === "ui-orphan-entity")).toBe(false);
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

// ─── ui-session-too-large ─────────────────────────────────────────────
//
// Every test uses a minimal "## Session Plan" wrapper around one or more
// "### Session N: …" H3 blocks. The audit only fires when `runUICompleteness
// Checks` runs the new `checkSessionSizes` step.

function makeSessionPlanSpec(sessionBlocks: string[]): string {
  return [
    "# Project — Specification",
    "",
    "## Session Plan",
    "",
    ...sessionBlocks,
    "",
  ].join("\n");
}

function findSessionTooLarge(
  failures: ReturnType<typeof runUICompletenessChecks>,
): Array<Extract<typeof failures[number], { kind: "ui-session-too-large" }>> {
  return failures.filter(
    (f): f is Extract<typeof f, { kind: "ui-session-too-large" }> =>
      f.kind === "ui-session-too-large",
  );
}

describe("ui-session-too-large — work-item counting", () => {
  it("counts checkboxes inside a Deliverables block but NOT bullets inside a Files block", () => {
    const session = [
      "### Session 1: Many checkboxes",
      "**Scope:** test",
      "**Files:**",
      "- `a.ts` (modify)",
      "- `b.ts` (modify)",
      "**User-visible outcome:** feature ships.",
      "**Implementation Checklist:**",
      ...Array.from({ length: 13 }, (_, i) => `- [ ] item ${i + 1}`),
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    const tooLarge = findSessionTooLarge(failures);
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0].workItems).toBe(13);
    expect(tooLarge[0].reasons).toContain("work-items");
    expect(tooLarge[0].files).toBe(2); // Files block, not the checkboxes
  });

  it("counts numbered list items as work items even when no checkboxes are present", () => {
    const items = Array.from({ length: 14 }, (_, i) => `${i + 1}. Extend something ${i}`);
    const session = [
      "### Session 7: Numbered deliverables",
      "**Scope:** Session 7 regression case.",
      "**User-visible outcome:** everything happens at once.",
      "**Prompt:**",
      ...items,
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    const tooLarge = findSessionTooLarge(failures);
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0].workItems).toBe(14);
    expect(tooLarge[0].reasons).toContain("work-items");
  });

  it("counts bullets in a Deliverables block but excludes bullets in a Files block", () => {
    const session = [
      "### Session 1: Mixed lists",
      "**Scope:** test",
      "**Deliverables:**",
      ...Array.from({ length: 13 }, (_, i) => `- Deliverable ${i + 1}`),
      "",
      "**Files:**",
      "- `a.ts` (modify)",
      "- `b.ts` (modify)",
      "- `c.ts` (modify)",
      "",
      "**User-visible outcome:** feature ships.",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    const tooLarge = findSessionTooLarge(failures);
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0].workItems).toBe(13);
  });

  it("ignores work-item-shaped lines inside fenced code blocks", () => {
    const items = Array.from({ length: 14 }, (_, i) => `${i + 1}. fake item ${i}`).join("\n");
    const session = [
      "### Session 1: Hidden inside fence",
      "**Scope:** Numbered list fenced — does not count.",
      "**User-visible outcome:** only one real outcome.",
      "**Prompt:**",
      "```",
      items,
      "```",
      "- [ ] just one real item",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    expect(findSessionTooLarge(failures)).toHaveLength(0);
  });

  it("does not flag sessions with zero work items", () => {
    const session = [
      "### Session 1: Skeleton",
      "**Scope:** placeholder",
      "**User-visible outcome:** (foundation)",
      "**Foundation justification:** scaffolding only",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    expect(findSessionTooLarge(failures)).toHaveLength(0);
  });
});

describe("ui-session-too-large — file counting", () => {
  it("counts file mentions in prose even when no Files block exists", () => {
    const filenames = Array.from({ length: 11 }, (_, i) => `mod_${i}.py`);
    const session = [
      "### Session 1: Prose-mentioned files",
      "**Scope:** Touches " + filenames.join(", "),
      "**User-visible outcome:** mass refactor.",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    const tooLarge = findSessionTooLarge(failures);
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0].files).toBeGreaterThanOrEqual(11);
    expect(tooLarge[0].reasons).toContain("files");
  });

  it("dedupes structured Files-block entries against prose mentions", () => {
    const session = [
      "### Session 1: Mixed file mentions",
      "**Scope:** Touches `a.ts` and `b.ts` and `c.ts`.",
      "**Files:**",
      "- `a.ts` (modify)",
      "- `b.ts` (modify)",
      "- `c.ts` (modify)",
      "**User-visible outcome:** stuff.",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    // Three files total — well under the 10-file threshold, so no flag.
    expect(findSessionTooLarge(failures)).toHaveLength(0);
  });
});

describe("ui-session-too-large — surfaces & deploy", () => {
  it("flags a session spanning ≥3 production surfaces", () => {
    const session = [
      "### Session 1: Cross-surface bundle",
      "**Scope:** Touches worker + edge function + frontend.",
      "**Files:**",
      "- `worker/foo.py` (modify)",
      "- `supabase/functions/bar/index.ts` (create)",
      "- `src/components/Baz.tsx` (create)",
      "**User-visible outcome:** several things change.",
      "**Prompt:** Modify the worker, then the edge function, then the frontend route.",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    const tooLarge = findSessionTooLarge(failures);
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0].reasons).toContain("surfaces");
    expect(tooLarge[0].surfaces).toEqual(
      expect.arrayContaining(["worker", "edge-fn", "frontend"]),
    );
  });

  it("flags any top-level `Deploy` deliverable line as a deploy-step", () => {
    const session = [
      "### Session 1: Foo with a deploy step",
      "**Scope:** Update one thing then deploy.",
      "**User-visible outcome:** stuff shipped.",
      "**Prompt:**",
      "1. Touch the worker",
      "2. Deploy worker",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    const tooLarge = findSessionTooLarge(failures);
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0].reasons).toContain("deploy-step");
    expect(tooLarge[0].hasDeployStep).toBe(true);
  });

  it("does NOT flag inline 'after deploy' mentions as a deploy-step", () => {
    const session = [
      "### Session 1: Foo without a deploy step",
      "**Scope:** Only worker changes; after the deploy you should be able to call it.",
      "**Files:**",
      "- `worker/foo.py` (modify)",
      "**User-visible outcome:** worker handles new event.",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    expect(findSessionTooLarge(failures)).toHaveLength(0);
  });
});

describe("ui-session-too-large — Session 7 regression fixture", () => {
  // The real failure case from the user's screenshot: 14 numbered deliverables
  // touching worker + edge functions + frontend + deploys. The fixture trips
  // work-items + surfaces + deploy-step (file-extension mentions in the real
  // case were under the 10-file threshold; the surface spread is what makes
  // the session unimplementable). The recheck prompt must surface all tripped
  // axes so the model can split sensibly.
  it("trips work-items, surfaces, and deploy-step axes together for the Session 7 fixture", () => {
    const session = [
      "### Session 7: Notes-sync surfaces, contradictions, and regeneration",
      "**Scope:** End-to-end notes-sync feature spanning worker + edge + frontend + deploys.",
      "**User-visible outcome:** PM can target notes to surfaces and see regen inbox.",
      "**Prompt for Claude Code:**",
      "1. Extend note_proactive_analysis.py: 2 new contradiction checks (element/rule, element/role).",
      "2. Extend notes_sync_preview.py: compute ui_surface_diff and downstream_impact.",
      "3. Extend notes_sync_apply.py: invoke apply_ui_note_targets_atomic and mark stale rows.",
      "4. Add insert_ui_note_target worker action + matching handler.",
      "5. Create NoteTargetSelector.tsx with the 7-target dropdown.",
      "6. Modify NoteCapturePanel to render NoteTargetSelector.",
      "7. Modify SyncPreviewDialog to show ui_surface_diff section.",
      "8. Create surfaces-regenerate edge function enqueuing processing_jobs for regen.",
      "9. Create RegenerationInbox page + list component + API + hooks.",
      "10. Register /projects/:id/regeneration-inbox route.",
      "11. Tests: contradiction kinds; sync preview UI diff; apply triggers re-derivation.",
      "12. Deploy worker.",
      "13. Deploy edge functions: worker-data-write + notes-sync-preview + notes-sync-apply + surfaces-regenerate.",
      "14. Run `pnpm check:worker-actions`.",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    const tooLarge = findSessionTooLarge(failures);
    expect(tooLarge).toHaveLength(1);
    const f = tooLarge[0];
    expect(f.workItems).toBeGreaterThanOrEqual(14);
    expect(f.reasons).toEqual(
      expect.arrayContaining(["work-items", "surfaces", "deploy-step"]),
    );
    expect(f.surfaces).toEqual(
      expect.arrayContaining(["worker", "edge-fn", "frontend", "deploy"]),
    );
    expect(f.hasDeployStep).toBe(true);
  });
});

describe("ui-session-too-large — carve-outs", () => {
  it("suppresses the flag when the session is mostly a single SQL fence (migration-only)", () => {
    const sqlBody = Array.from({ length: 30 }, (_, i) => `INSERT INTO foo (col) VALUES (${i});`).join("\n");
    const session = [
      "### Session 1: Atomic migration",
      "**Scope:** Apply a single large migration.",
      "**Files:**",
      "- `migrations/001_init.sql` (create)",
      "**User-visible outcome:** schema is in place.",
      "",
      "```sql",
      sqlBody,
      "```",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    expect(findSessionTooLarge(failures)).toHaveLength(0);
  });

  it("respects the **Indivisible:** waiver line", () => {
    const session = [
      "### Session 1: Truly indivisible",
      "**Scope:** Touches worker + edge fn + frontend by design.",
      "**Files:**",
      "- `worker/foo.py` (modify)",
      "- `supabase/functions/bar/index.ts` (create)",
      "- `src/components/Baz.tsx` (create)",
      "**User-visible outcome:** one atomic transition.",
      "**Indivisible:** rolling forward without all three causes data loss.",
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]));
    expect(findSessionTooLarge(failures)).toHaveLength(0);
  });

  it("does not run the check when skipSessionSizeCheck=true is passed", () => {
    const items = Array.from({ length: 20 }, (_, i) => `${i + 1}. item ${i}`);
    const session = [
      "### Session 1: Big",
      "**Scope:** big",
      "**User-visible outcome:** stuff",
      "**Prompt:**",
      ...items,
    ].join("\n");
    const failures = runUICompletenessChecks(makeSessionPlanSpec([session]), {
      skipSessionSizeCheck: true,
    });
    expect(findSessionTooLarge(failures)).toHaveLength(0);
  });
});

describe("buildRecheckPrompts — session-too-large block", () => {
  it("emits a split directive naming the tripped axes + per-session counts", () => {
    const failures: Parameters<typeof buildRecheckPrompts>[0] = [
      {
        kind: "ui-session-too-large",
        session: "Session 7: Notes-sync surfaces",
        workItems: 14,
        files: 9,
        phases: 1,
        surfaces: ["worker", "edge-fn", "frontend", "deploy"],
        hasDeployStep: true,
        reasons: ["work-items", "surfaces", "deploy-step"],
      },
    ];
    const prompts = buildRecheckPrompts(failures);
    expect(prompts).toHaveLength(1);
    const p = prompts[0];
    expect(p).toContain("Sessions too large for one Claude Code run");
    expect(p).toContain("Session 7: Notes-sync surfaces");
    expect(p).toContain("14 work items");
    expect(p).toContain("worker, edge-fn, frontend, deploy");
    expect(p).toContain("contains a Deploy step");
    expect(p).toContain("suffix numbering");
    expect(p).toContain("Indivisible");
    // Heading-inventory contract: NEVER renumber later sessions.
    expect(p).toContain("Do NOT renumber later sessions");
  });
});

describe("describeFailure / summarizeReport — session-too-large", () => {
  it("describes a too-large session with its tripped axes", () => {
    const line = describeFailure({
      kind: "ui-session-too-large",
      session: "Session 7",
      workItems: 14,
      files: 9,
      phases: 1,
      surfaces: ["worker", "frontend"],
      hasDeployStep: true,
      reasons: ["work-items", "deploy-step"],
    });
    expect(line).toContain("too large");
    expect(line).toContain("14 work items");
    expect(line).toContain("Deploy step");
  });

  it("includes too-large counts in summarizeReport", () => {
    const session = [
      "### Session 1: Cross-surface",
      "**Scope:** worker + edge fn + frontend.",
      "**Files:**",
      "- `worker/foo.py` (modify)",
      "- `supabase/functions/bar/index.ts` (create)",
      "- `src/components/Baz.tsx` (create)",
      "**User-visible outcome:** stuff.",
    ].join("\n");
    const report = auditCoverage([], makeSessionPlanSpec([session]), {
      skipForNewApp: true,
    });
    const summary = summarizeReport(report);
    expect(summary).toContain("session(s) too large");
  });
});
