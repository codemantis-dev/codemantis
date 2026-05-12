import { describe, it, expect } from "vitest";
import {
  validateBlockerSatisfiability,
  rewriteBlockerIfNeeded,
} from "./self-drive-blocker-validator";

describe("validateBlockerSatisfiability", () => {
  it("accepts a filesystem-evidence criterion as-is", () => {
    const r = validateBlockerSatisfiability({
      resolutionCriteria:
        "ls -la src/foo.ts shows non-zero size AND git status --porcelain lists it AND pnpm tsc --noEmit returns exit 0",
    });
    expect(r.ok).toBe(true);
    expect(r.rewriteCodes).toHaveLength(0);
  });

  it("rewrites 'Edit/Write tool call required' to filesystem evidence", () => {
    const r = validateBlockerSatisfiability({
      resolutionCriteria:
        "TOOLS USED THIS TURN must contain at least one Edit or Write call per deliverable file",
    });
    expect(r.ok).toBe(false);
    // The phrasing matches both "TOOLS USED" (tool-log-required) and
    // "contain ... Edit" (edit-write-call-required). Either reason is
    // acceptable — the validator returns on first match by design.
    expect(
      r.rewriteCodes.some(
        (c) => c === "edit-write-call-required" || c === "tool-log-required",
      ),
    ).toBe(true);
    expect(r.rewrittenCriteria).toMatch(/filesystem verification/i);
    expect(r.rewrittenCriteria).toMatch(/ls -la/);
    expect(r.rewrittenCriteria).toMatch(/git status/);
  });

  it("rewrites 'tool log' phrasings to filesystem evidence", () => {
    const r = validateBlockerSatisfiability({
      resolutionCriteria:
        "the Edit tool call must be recorded in the tool log for src/foo.ts",
    });
    expect(r.ok).toBe(false);
    expect(r.rewriteCodes.some((c) => c === "tool-log-required" || c === "edit-write-call-required")).toBe(true);
  });

  it("splits a multi-step criterion to the first clause", () => {
    const r = validateBlockerSatisfiability({
      resolutionCriteria:
        "ls -la shows the file and then deploy the function and then run pnpm test",
    });
    expect(r.ok).toBe(false);
    expect(r.rewriteCodes).toContain("multi-step-split");
    expect(r.rewrittenCriteria).toMatch(/ls -la shows the file/);
    expect(r.rewrittenCriteria).not.toMatch(/and then deploy/i);
    expect(r.rewrittenCriteria).toMatch(/follow-up steps/);
  });

  it("rewrites empty criteria to a filesystem fallback", () => {
    const r = validateBlockerSatisfiability({ resolutionCriteria: "" });
    expect(r.ok).toBe(false);
    expect(r.rewriteCodes).toContain("empty-criteria");
    expect(r.rewrittenCriteria).toMatch(/filesystem verification/i);
  });

  it("applies vocab substitutions when configured", () => {
    const r = validateBlockerSatisfiability(
      {
        resolutionCriteria:
          "psql $DATABASE_URL -c 'SELECT 1' returns 1 row",
      },
      {
        vocabSubstitutions: [
          { needle: /psql \$DATABASE_URL/, replacement: "supabase db query --linked" },
        ],
      },
    );
    expect(r.ok).toBe(false);
    expect(r.rewriteCodes).toContain("vocab-substitution");
    expect(r.rewrittenCriteria).toMatch(/supabase db query --linked/);
    expect(r.rewrittenCriteria).not.toMatch(/psql \$DATABASE_URL/);
  });
});

describe("rewriteBlockerIfNeeded", () => {
  it("returns the same blocker reference when criteria are already OK", () => {
    const blocker = {
      resolutionCriteria: "ls src/foo.ts shows non-zero size",
    };
    const { blocker: out, report } = rewriteBlockerIfNeeded(blocker);
    expect(report.ok).toBe(true);
    expect(out).toBe(blocker);
  });

  it("returns a new blocker with rewritten criteria when needed", () => {
    const blocker = {
      kind: "infra-state-drift" as const,
      resolutionCriteria: "Edit tool call must appear in TOOLS USED THIS TURN for x.ts",
    };
    const { blocker: out, report } = rewriteBlockerIfNeeded(blocker);
    expect(report.ok).toBe(false);
    expect(out).not.toBe(blocker);
    expect(out.resolutionCriteria).toMatch(/filesystem verification/i);
    expect(out.kind).toBe("infra-state-drift"); // preserved
  });
});
