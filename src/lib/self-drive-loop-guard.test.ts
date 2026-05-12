import { describe, it, expect } from "vitest";
import { detectEvidenceLoop, classifyRecheckBatch } from "./self-drive-loop-guard";

describe("detectEvidenceLoop", () => {
  it("returns 'fresh' on first ask", () => {
    const r = detectEvidenceLoop({
      label: "Migrations applied",
      priorPrompts: [],
      priorResponses: [],
    });
    expect(r.verdict).toBe("fresh");
    expect(r.askCount).toBe(0);
  });

  it("returns 'fresh' on second ask with no evidence yet", () => {
    const r = detectEvidenceLoop({
      label: "Migrations applied",
      priorPrompts: ["Please run psql for Migrations applied"],
      priorResponses: ["I ran it but you missed the table"],
      currentDraft: "Re-run psql for Migrations applied",
    });
    expect(r.verdict).toBe("fresh");
    expect(r.askCount).toBeGreaterThanOrEqual(2);
  });

  it("returns 'accept' when label asked ≥2 times and evidence shown ≥2 times", () => {
    const r = detectEvidenceLoop({
      label: "Migrations applied",
      priorPrompts: [
        "Run psql for Migrations applied",
        "Quote the SQL for Migrations applied",
      ],
      priorResponses: [
        "Migrations applied — PASS — $ supabase migration list → 7 rows",
        "Migrations applied — PASS — see src/db.ts:1 and ```\noutput\n```",
      ],
    });
    expect(r.verdict).toBe("accept");
    expect(r.evidenceSignalsForLabel).toBe(2);
  });

  it("returns 'pause' on 3rd ask with zero evidence ever", () => {
    const r = detectEvidenceLoop({
      label: "Migrations applied",
      priorPrompts: [
        "Run psql for Migrations applied",
        "Quote SQL for Migrations applied",
      ],
      priorResponses: ["Cannot — no DATABASE_URL", "Still no DATABASE_URL"],
      currentDraft: "Try once more for Migrations applied",
    });
    expect(r.verdict).toBe("pause");
    expect(r.askCount).toBeGreaterThanOrEqual(3);
    expect(r.evidenceSignalsForLabel).toBe(0);
  });

  it("ignores [kind] tag suffixes in label matching", () => {
    const r = detectEvidenceLoop({
      label: "Tables exist [side-effect]",
      priorPrompts: ["Verify Tables exist [side-effect]", "Recheck Tables exist"],
      priorResponses: [
        "Tables exist — $ SELECT FROM table_a → 1\nTables exist — see x.ts:5",
        "Tables exist — ```\nyes\n```",
      ],
    });
    expect(r.verdict).toBe("accept");
  });
});

describe("classifyRecheckBatch", () => {
  it("splits labels into accept/proceed/pause buckets", () => {
    const labels = ["Migrations applied", "Tables exist", "Lint passes"];
    const priorPrompts = [
      // Migrations applied — asked twice, evidenced twice
      "First ask: Migrations applied",
      "Second ask: Migrations applied — please re-quote",
      // Tables exist — asked twice, evidenced zero times (still fresh, one more chance)
      "First ask: Tables exist",
      "Second ask: Tables exist",
      // Lint passes — first ask
      "First ask: Lint passes",
    ];
    const priorResponses = [
      "Migrations applied — PASS — $ supabase migration list",
      "Migrations applied — PASS — ```\ndone\n```",
      // No mentions of Tables or Lint at all
      "(nothing about those)",
    ];

    const out = classifyRecheckBatch(labels, priorPrompts, priorResponses);
    const acceptLabels = out.accept.map((x) => x.label);
    const proceedLabels = out.proceed.map((x) => x.label);

    expect(acceptLabels).toContain("Migrations applied");
    expect(proceedLabels).toContain("Tables exist");
    expect(proceedLabels).toContain("Lint passes");
    expect(out.pause).toHaveLength(0);
  });

  it("surfaces 'pause' when a label has been asked thrice with no evidence", () => {
    const labels = ["Unanswerable check"];
    const priorPrompts = [
      "Ask 1: Unanswerable check",
      "Ask 2: Unanswerable check",
    ];
    const priorResponses = ["No can do", "Still no"];
    const out = classifyRecheckBatch(labels, priorPrompts, priorResponses, "Ask 3: Unanswerable check");
    expect(out.pause.map((x) => x.label)).toContain("Unanswerable check");
  });
});
