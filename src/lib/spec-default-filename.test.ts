import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  deriveDefaultSpecFilename,
  extractSelfReferencedSpecStem,
  extractTitleStem,
} from "./spec-default-filename";

describe("extractSelfReferencedSpecStem", () => {
  it("returns the most-frequent non-generic stem", () => {
    const body = [
      "Read docs/specs/spec-forge-project-pipeline-dag.md — sections 1, 2.",
      "Also read docs/specs/spec-forge-project-pipeline-dag.md sections 3.",
      "And docs/specs/some-other-thing.md once.",
    ].join("\n");
    expect(extractSelfReferencedSpecStem(body)).toBe(
      "spec-forge-project-pipeline-dag",
    );
  });

  it("ignores .audit.md paths", () => {
    const body = "See docs/specs/foo-bar.audit.md for the audit.";
    expect(extractSelfReferencedSpecStem(body)).toBeNull();
  });

  it("rejects generic stems like `spec` and `specification`", () => {
    const body = [
      "docs/specs/spec.md",
      "docs/specs/specification.md",
      "docs/specs/audit.md",
    ].join("\n");
    expect(extractSelfReferencedSpecStem(body)).toBeNull();
  });

  it("returns null when no docs/specs reference is present", () => {
    expect(extractSelfReferencedSpecStem("nothing to see here")).toBeNull();
  });

  it("breaks frequency ties by first occurrence", () => {
    const body = [
      "docs/specs/alpha-feature.md",
      "docs/specs/beta-feature.md",
    ].join("\n");
    expect(extractSelfReferencedSpecStem(body)).toBe("alpha-feature");
  });
});

describe("extractTitleStem", () => {
  it("captures the part before an em-dash subtitle", () => {
    expect(
      extractTitleStem("# My Feature — Requirements Specification\n\nBody"),
    ).toBe("my-feature");
  });

  it("captures the part before an en-dash subtitle", () => {
    expect(
      extractTitleStem("# My Feature – Requirements Specification\n\nBody"),
    ).toBe("my-feature");
  });

  it("does NOT split on plain hyphen-minus inside compound words", () => {
    // Regression: the previous regex `[—-]` treated U+002D as a separator
    // and captured only "Spec" from this title.
    expect(
      extractTitleStem(
        "# Spec-Forge Project Pipeline DAG — Requirements Specification\n",
      ),
    ).toBe("spec-forge-project-pipeline-dag");
  });

  it("returns null when the only candidate is generic", () => {
    expect(extractTitleStem("# Spec\n\nBody")).toBeNull();
    expect(
      extractTitleStem("# Specification — Subtitle\n\nBody"),
    ).toBeNull();
  });

  it("returns null when there is no H1", () => {
    expect(extractTitleStem("just a paragraph")).toBeNull();
  });
});

describe("deriveDefaultSpecFilename", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers the spec body's self-reference over the H1", () => {
    const content = [
      "# Spec — Requirements Specification",
      "",
      "Read docs/specs/spec-forge-project-pipeline-dag.md sections 3, 7, 8.",
    ].join("\n");
    expect(deriveDefaultSpecFilename(content, false)).toBe(
      "spec-forge-project-pipeline-dag.md",
    );
  });

  it("falls back to the H1 when there is no self-reference", () => {
    expect(
      deriveDefaultSpecFilename(
        "# Spec-Forge Project Pipeline DAG — Subtitle\n\nNothing else.",
        false,
      ),
    ).toBe("spec-forge-project-pipeline-dag.md");
  });

  it("falls back to a timestamp when both self-ref and H1 are unusable", () => {
    const out = deriveDefaultSpecFilename("# Spec\n\nBody.", false);
    expect(out).toMatch(/^spec-\d+\.md$/);
  });

  it("audit mode: appends .audit.md to a self-reference", () => {
    const content = [
      "# Verification Audit",
      "",
      "**Companion to:** `docs/specs/gradum-public-site.md`",
    ].join("\n");
    expect(deriveDefaultSpecFilename(content, true)).toBe(
      "gradum-public-site.audit.md",
    );
  });

  it("audit mode: timestamp fallback uses the audit prefix", () => {
    const out = deriveDefaultSpecFilename("# Audit\n\nBody.", true);
    expect(out).toMatch(/^audit-\d+\.audit\.md$/);
  });

  it("audit mode: falls back to H1 when there is no self-reference", () => {
    expect(
      deriveDefaultSpecFilename(
        "# Dashboard — Verification Audit\n\nContent",
        true,
      ),
    ).toBe("dashboard.audit.md");
  });
});
