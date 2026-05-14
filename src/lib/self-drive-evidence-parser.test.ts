import { describe, it, expect } from "vitest";
import { parseEvidence, summarizeParsedEvidence } from "./self-drive-evidence-parser";

describe("parseEvidence", () => {
  it("captures verdict, command, and file:line for inline-form evidence", () => {
    const text = [
      "1. Migrations applied — PASS — $ supabase migration list → 7 versions",
      "2. Tables exist — PASS — see src/db.ts:42 and supabase/schema.sql:100",
      "3. Lint passes — SKIPPED — no time",
    ].join("\n");

    const out = parseEvidence(text, [
      "Migrations applied",
      "Tables exist",
      "Lint passes",
    ]);
    expect(out).toHaveLength(3);

    expect(out[0].verdict).toBe("PASS");
    expect(out[0].commandText).toMatch(/supabase migration list/);

    expect(out[1].verdict).toBe("PASS");
    expect(out[1].fileLineCitations).toContain("src/db.ts:42");
    expect(out[1].fileLineCitations).toContain("supabase/schema.sql:100");

    expect(out[2].verdict).toBe("SKIPPED");
  });

  it("captures code block evidence for table-form output", () => {
    const text = [
      "1. Migrations applied — PASS",
      "```",
      "$ supabase migration list",
      "7 versions applied",
      "```",
      "2. Tables exist — PASS — src/db.ts:1",
    ].join("\n");

    const out = parseEvidence(text, ["Migrations applied", "Tables exist"]);
    expect(out[0].codeBlock).toMatch(/7 versions applied/);
  });

  it("captures mocks for behavioral evidence", () => {
    const text = "1. Tests pass — PASS — foo.test.ts:10 — ✓ does the thing · mocks=httpClient,fsWrite";
    const out = parseEvidence(text, ["Tests pass"]);
    expect(out[0].mocks).toEqual(["httpClient", "fsWrite"]);
  });

  it("returns UNKNOWN for a label that doesn't appear in the response", () => {
    const text = "1. Migrations applied — PASS — $ supabase migration list";
    const out = parseEvidence(text, ["Migrations applied", "Not mentioned"]);
    expect(out[0].verdict).toBe("PASS");
    expect(out[1].verdict).toBe("UNKNOWN");
    expect(out[1].verdictLine).toBeNull();
  });

  it("handles empty input gracefully", () => {
    const out = parseEvidence("", ["A", "B"]);
    expect(out.every((e) => e.verdict === "UNKNOWN")).toBe(true);
  });

  it("captures FAIL with file:line citations", () => {
    const text = "1. Tests pass — FAIL — foo.test.ts:42 expected 1 got 2";
    const out = parseEvidence(text, ["Tests pass"]);
    expect(out[0].verdict).toBe("FAIL");
    expect(out[0].fileLineCitations).toContain("foo.test.ts:42");
  });

  it("does not bleed evidence across items when verdicts are close together", () => {
    const text = [
      "1. Migrations applied — PASS — $ supabase migration list → 7",
      "2. Tables exist — FAIL — missing table user_settings",
      "3. Enum values exist — PASS — $ SELECT enum_range",
    ].join("\n");
    const out = parseEvidence(text, [
      "Migrations applied",
      "Tables exist",
      "Enum values exist",
    ]);
    expect(out[0].commandText).toMatch(/supabase migration list/);
    expect(out[1].commandText).toBeNull();
    expect(out[2].commandText).toMatch(/SELECT enum_range/);
  });
});

describe("summarizeParsedEvidence", () => {
  it("counts verdicts and evidence signal types", () => {
    const text = [
      "1. Migrations applied — PASS — $ ls",
      "2. Tables exist — FAIL — missing",
      "3. Lint passes — SKIPPED — n/a",
      "4. Typecheck passes — PASS — see x.ts:1",
    ].join("\n");
    const entries = parseEvidence(text, [
      "Migrations applied",
      "Tables exist",
      "Lint passes",
      "Typecheck passes",
    ]);
    const summary = summarizeParsedEvidence(entries);
    expect(summary).toMatch(/PASS=2/);
    expect(summary).toMatch(/FAIL=1/);
    expect(summary).toMatch(/SKIP=1/);
    expect(summary).toMatch(/cite=1/);
  });

  it("captures browser-action evidence and defaults mocks to ['none']", () => {
    const text = [
      "1. Click ort-field — PASS —",
      "   $ browser_navigate http://localhost:5173/crm-companies/abc → ok",
      "   $ browser_click [data-testid=ort-field] → focus active",
      "   $ browser_type \"Linz\" + Enter → ok",
      "   $ browser_snapshot → DOM contains \"Linz\"",
    ].join("\n");

    const out = parseEvidence(text, ["Click ort-field"]);
    expect(out[0].verdict).toBe("PASS");
    expect(out[0].browserActionCalls.sort()).toEqual(
      ["browser_click", "browser_navigate", "browser_snapshot", "browser_type"].sort(),
    );
    // Browser is real → mocks defaults to none when worker didn't supply tag.
    expect(out[0].mocks).toEqual(["none"]);
  });

  it("recognises mcp__browsermcp__ fully-qualified tool names", () => {
    const text =
      "1. Tab renders — PASS — $ mcp__browsermcp__browser_navigate localhost → snapshot ok";
    const out = parseEvidence(text, ["Tab renders"]);
    expect(out[0].browserActionCalls).toContain("browser_navigate");
  });

  it("respects explicit mocks tag when browser actions are present", () => {
    const text = [
      "1. Combined check — PASS — $ browser_snapshot → ok · mocks=httpClient",
    ].join("\n");
    const out = parseEvidence(text, ["Combined check"]);
    expect(out[0].browserActionCalls).toContain("browser_snapshot");
    // The explicit `mocks=httpClient` tag wins over the implied "none".
    expect(out[0].mocks).toEqual(["httpClient"]);
  });

  it("leaves browserActionCalls empty when no browser_* calls are present", () => {
    const text = "1. Plain check — PASS — $ pnpm tsc → 0 errors";
    const out = parseEvidence(text, ["Plain check"]);
    expect(out[0].browserActionCalls).toEqual([]);
    expect(out[0].mocks).toBeNull();
  });

  it("dedupes repeated browser_* mentions", () => {
    const text =
      "1. Foo — PASS — browser_navigate /a then browser_navigate /b then browser_navigate /c";
    const out = parseEvidence(text, ["Foo"]);
    expect(out[0].browserActionCalls).toEqual(["browser_navigate"]);
  });
});
