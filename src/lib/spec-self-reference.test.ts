import { describe, it, expect } from "vitest";
import { normalizeSpecSelfReferences } from "./spec-self-reference";

describe("normalizeSpecSelfReferences", () => {
  it("rewrites a single plain spec reference", () => {
    const body = "Read docs/specs/old-name.md to start.";
    const result = normalizeSpecSelfReferences(body, "new-name.md");
    expect(result).toBe("Read docs/specs/new-name.md to start.");
  });

  it("rewrites a single audit reference using the derived audit filename", () => {
    const body = "See docs/specs/old-name.audit.md for the verification.";
    const result = normalizeSpecSelfReferences(body, "new-name.md");
    expect(result).toBe(
      "See docs/specs/new-name.audit.md for the verification.",
    );
  });

  it("rewrites both spec and audit references in the same body", () => {
    const body = `Step 1: Read docs/specs/old-name.md sections 1-3.
Step 2: Run docs/specs/old-name.audit.md and report PASS/FAIL.`;
    const result = normalizeSpecSelfReferences(body, "new-name.md");
    expect(result).toBe(
      `Step 1: Read docs/specs/new-name.md sections 1-3.
Step 2: Run docs/specs/new-name.audit.md and report PASS/FAIL.`,
    );
  });

  it("does not double-rewrite an audit reference as a plain spec reference", () => {
    // Regression: a naive two-pass replace where the second pass also
    // matched dotted stems would turn `foo.audit.md` into just `foo.md`.
    const body = "Audit at docs/specs/saas-multi.audit.md is the source.";
    const result = normalizeSpecSelfReferences(body, "specloom-saas.md");
    expect(result).toContain("docs/specs/specloom-saas.audit.md");
    expect(result).not.toContain("docs/specs/specloom-saas.md is");
  });

  it("rewrites multiple occurrences of the same reference", () => {
    const body = `docs/specs/foo.md
docs/specs/foo.md
docs/specs/foo.md`;
    const result = normalizeSpecSelfReferences(body, "bar.md");
    expect(result).toBe(`docs/specs/bar.md
docs/specs/bar.md
docs/specs/bar.md`);
  });

  it("rewrites references inside backticks", () => {
    const body = "Open `docs/specs/old.md` and `docs/specs/old.audit.md`.";
    const result = normalizeSpecSelfReferences(body, "new.md");
    expect(result).toBe(
      "Open `docs/specs/new.md` and `docs/specs/new.audit.md`.",
    );
  });

  it("leaves bodies with no references unchanged", () => {
    const body = "Read sections 1-3 from the spec.\nNo paths here.";
    const result = normalizeSpecSelfReferences(body, "new.md");
    expect(result).toBe(body);
  });

  it("is idempotent — running twice gives the same result", () => {
    const body = `Read docs/specs/old.md and docs/specs/old.audit.md.`;
    const once = normalizeSpecSelfReferences(body, "new.md");
    const twice = normalizeSpecSelfReferences(once, "new.md");
    expect(twice).toBe(once);
  });

  it("ignores paths that are not under docs/specs/", () => {
    const body = "Read src/foo.md and other/specs/bar.md and docs/specs/x.md";
    const result = normalizeSpecSelfReferences(body, "new.md");
    expect(result).toBe(
      "Read src/foo.md and other/specs/bar.md and docs/specs/new.md",
    );
  });

  it("handles stems with hyphens and underscores", () => {
    const body =
      "Refs: docs/specs/multi_word_stem.md and docs/specs/dash-stem.md";
    const result = normalizeSpecSelfReferences(body, "renamed.md");
    expect(result).toBe(
      "Refs: docs/specs/renamed.md and docs/specs/renamed.md",
    );
  });

  it("rewrites the specloom-saas-multi.md fixture pattern correctly", () => {
    // Verbatim shape of what _examples/specloom-saas-multi.md contains:
    // 8 plain Session Plan refs + 1 audit ref in Session 9.
    const body = `### Session 1
\`\`\`
Read docs/specs/saas-multitenancy.md — but ONLY these sections:
\`\`\`

### Session 9
\`\`\`
Read docs/specs/saas-multitenancy.audit.md and run the full
verification audit.
\`\`\``;
    const result = normalizeSpecSelfReferences(body, "specloom-saas-multi.md");
    expect(result).toContain("docs/specs/specloom-saas-multi.md");
    expect(result).toContain("docs/specs/specloom-saas-multi.audit.md");
    expect(result).not.toContain("saas-multitenancy");
  });
});
