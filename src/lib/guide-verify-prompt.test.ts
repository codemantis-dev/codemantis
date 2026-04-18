import { describe, it, expect } from "vitest";
import {
  buildSessionVerifyPrompt,
  buildGuideCompleteVerifyPrompt,
  VERIFY_MODE_PREAMBLE,
} from "./guide-verify-prompt";

const PREAMBLE_HEADER = "VERIFICATION MODE — READ BEFORE DOING ANYTHING";
const FINAL_ACCOUNTING = "Verified X/Y";
const BATCH_INSTRUCTION = "BATCHES OF 10";
const FORBIDDEN_EXAMPLE = "all the remaining items pass";

describe("VERIFY_MODE_PREAMBLE", () => {
  it("contains the contract header", () => {
    expect(VERIFY_MODE_PREAMBLE).toContain(PREAMBLE_HEADER);
  });

  it("forbids batch-PASS language via explicit forbidden list", () => {
    expect(VERIFY_MODE_PREAMBLE).toContain(FORBIDDEN_EXAMPLE);
    expect(VERIFY_MODE_PREAMBLE).toContain("LGTM");
  });

  it("mandates file opens, quoted evidence, and a final accounting line", () => {
    expect(VERIFY_MODE_PREAMBLE).toContain("Open files with the Read tool");
    // Word wrap may split "quote the exact code" across a newline — match
    // the phrase with a whitespace-tolerant regex instead of a literal.
    expect(VERIFY_MODE_PREAMBLE).toMatch(/quote\s+the\s+exact\s+code/);
    expect(VERIFY_MODE_PREAMBLE).toContain(FINAL_ACCOUNTING);
  });

  it("teaches per-kind evidence (static / side-effect / behavioral)", () => {
    expect(VERIFY_MODE_PREAMBLE).toContain("[static]");
    expect(VERIFY_MODE_PREAMBLE).toContain("[side-effect]");
    expect(VERIFY_MODE_PREAMBLE).toContain("[behavioral]");
    // side-effect rule: file is NOT evidence — must be command output
    expect(VERIFY_MODE_PREAMBLE).toContain("A file is NOT evidence");
  });

  it("specifies batching of 10 items per batch with a running tally", () => {
    expect(VERIFY_MODE_PREAMBLE).toContain(BATCH_INSTRUCTION);
    expect(VERIFY_MODE_PREAMBLE).toContain("running tally");
  });

  it("permits honest SKIPPED as an alternative to faking PASS", () => {
    expect(VERIFY_MODE_PREAMBLE).toContain("SKIPPED");
    expect(VERIFY_MODE_PREAMBLE).toContain("Faking PASS is a contract violation");
  });
});

describe("buildSessionVerifyPrompt", () => {
  it("prepends the preamble and numbers items globally", () => {
    const result = buildSessionVerifyPrompt(
      {
        index: 2,
        name: "Data Collection Overhaul",
        verifyChecks: [
          { label: "Rating buttons render as 5 clickable buttons" },
          { label: "TypeScript compiles: `pnpm tsc --noEmit`" },
        ],
      },
      "ai-potential-analysis.md",
      null,
    );

    expect(result).toContain(PREAMBLE_HEADER);
    expect(result).toContain("Session 2: Data Collection Overhaul");
    expect(result).toContain("docs/specs/ai-potential-analysis.md");
    expect(result).toContain("Items to verify (2 total)");
    expect(result).toContain("1. [static] Rating buttons render as 5 clickable buttons");
    expect(result).toContain("2. [static] TypeScript compiles: `pnpm tsc --noEmit`");
    expect(result).toContain("PASS or FAIL");
    expect(result).toContain(FINAL_ACCOUNTING);
    expect(result).not.toContain("Verification Audit at");
  });

  it("includes audit line when auditFilename is provided", () => {
    const result = buildSessionVerifyPrompt(
      {
        index: 1,
        name: "Setup",
        verifyChecks: [{ label: "DB migrations run" }],
      },
      "my-spec.md",
      "my-spec.audit.md",
    );

    expect(result).toContain("Verification Audit at docs/specs/my-spec.audit.md");
    expect(result).toContain("subject to the same evidence contract");
  });

  it("handles session with no checks (still includes preamble and tsc fallback)", () => {
    const result = buildSessionVerifyPrompt(
      { index: 3, name: "Polish", verifyChecks: [] },
      "spec.md",
      null,
    );

    expect(result).toContain(PREAMBLE_HEADER);
    expect(result).toContain("Session 3: Polish");
    expect(result).toContain("docs/specs/spec.md");
    expect(result).toContain("pnpm tsc --noEmit");
  });

  it("always includes the mandatory checklist alongside a custom verificationPrompt", () => {
    // Regression: prior behavior replaced the checklist when verificationPrompt
    // was set. That silently dropped checks and made the orchestrator pause
    // with "verifier did not produce evidence for all items" on every run.
    // The new contract: verificationPrompt is guidance, checklist is mandatory.
    const result = buildSessionVerifyPrompt(
      {
        index: 1,
        name: "Database Schema",
        verifyChecks: [
          { label: "TypeScript compiles" },
          { label: "Migration applied on remote", kind: "side-effect" },
        ],
        verificationPrompt:
          "Open src/models/user.ts.\nVERIFY: User model exists.",
      },
      "test.md",
      null,
    );

    // Guidance block is included.
    expect(result).toContain("Open src/models/user.ts");
    expect(result).toContain("VERIFY: User model exists");
    // Mandatory checklist is ALSO present (heading form is unique — the
    // GUIDANCE block forward-references "MANDATORY CHECKLIST below").
    expect(result).toContain("MANDATORY CHECKLIST — 2 items");
    expect(result).toContain("1. [static] TypeScript compiles");
    expect(result).toContain("2. [side-effect] Migration applied on remote");
    // Order: user's guidance text appears above the MANDATORY CHECKLIST
    // heading (match the full heading so we don't hit the forward-ref).
    expect(result.indexOf("VERIFY: User model exists")).toBeLessThan(
      result.indexOf("MANDATORY CHECKLIST — 2 items"),
    );
  });

  it("retrofits stored verificationPrompt by prepending the preamble", () => {
    // Critical: old guides in the DB have weak verificationPrompt strings
    // written before the contract existed. The preamble must apply to them
    // too so they don't stay skim-prone forever.
    const result = buildSessionVerifyPrompt(
      {
        index: 1,
        name: "Legacy",
        verifyChecks: [],
        verificationPrompt: "Old weak prompt body here.",
      },
      "test.md",
      null,
    );

    expect(result).toContain(PREAMBLE_HEADER);
    expect(result).toContain("Old weak prompt body here.");
    // Preamble precedes the stored body.
    expect(result.indexOf(PREAMBLE_HEADER)).toBeLessThan(
      result.indexOf("Old weak prompt body here."),
    );
  });

  it("falls back to numbered checklist when verificationPrompt is null", () => {
    const result = buildSessionVerifyPrompt(
      {
        index: 1,
        name: "Database Schema",
        verifyChecks: [{ label: "TypeScript compiles" }],
        verificationPrompt: null,
      },
      "test.md",
      null,
    );

    expect(result).toContain(PREAMBLE_HEADER);
    expect(result).toContain("Items to verify (1 total)");
    expect(result).toContain("1. [static] TypeScript compiles");
  });

  it("appends audit line to verificationPrompt when audit filename provided", () => {
    const result = buildSessionVerifyPrompt(
      {
        index: 2,
        name: "API",
        verifyChecks: [],
        verificationPrompt: "Verify the API routes respond correctly.",
      },
      "spec.md",
      "spec.audit.md",
    );

    expect(result).toContain("Verify the API routes respond correctly.");
    expect(result).toContain(
      "Verification Audit at docs/specs/spec.audit.md",
    );
  });
});

describe("buildGuideCompleteVerifyPrompt", () => {
  const sessions = [
    {
      index: 1,
      name: "Backend Setup",
      verifyChecks: [
        { label: "DB migrations run" },
        { label: "API endpoints respond" },
      ],
    },
    {
      index: 2,
      name: "Frontend UI",
      verifyChecks: [
        { label: "Components render correctly" },
        { label: "TypeScript compiles" },
      ],
    },
  ];

  it("prepends preamble and numbers items globally across sessions", () => {
    const result = buildGuideCompleteVerifyPrompt(sessions, "my-spec.md", null);

    expect(result).toContain(PREAMBLE_HEADER);
    expect(result).toContain("Total items to verify across all sessions: 4");
    expect(result).toContain("### Session 1: Backend Setup");
    expect(result).toContain("1. [S1] [static] DB migrations run");
    expect(result).toContain("2. [S1] [static] API endpoints respond");
    expect(result).toContain("### Session 2: Frontend UI");
    expect(result).toContain("3. [S2] [static] Components render correctly");
    expect(result).toContain("4. [S2] [static] TypeScript compiles");
    expect(result).toContain("complete implementation");
    expect(result).toContain("docs/specs/my-spec.md");
    expect(result).toContain(FINAL_ACCOUNTING);
  });

  it("includes audit line and instructs continuing numbering when auditFilename provided", () => {
    const result = buildGuideCompleteVerifyPrompt(
      sessions,
      "spec.md",
      "spec.audit.md",
    );

    expect(result).toContain("Verification Audit at docs/specs/spec.audit.md");
    expect(result).toContain("continue numbering from 5");
  });

  it("omits audit line when auditFilename is null", () => {
    const result = buildGuideCompleteVerifyPrompt(sessions, "spec.md", null);

    expect(result).not.toContain("Verification Audit at");
  });

  it("skips sessions with no verify checks", () => {
    const mixedSessions = [
      { index: 1, name: "Infra", verifyChecks: [] },
      { index: 2, name: "API", verifyChecks: [{ label: "Tests pass" }] },
    ];

    const result = buildGuideCompleteVerifyPrompt(mixedSessions, "s.md", null);

    expect(result).not.toContain("### Session 1: Infra");
    expect(result).toContain("### Session 2: API");
    expect(result).toContain("1. [S2] [static] Tests pass");
  });

  it("returns fallback prompt (with preamble) when all sessions have empty checks", () => {
    const emptySessions = [
      { index: 1, name: "A", verifyChecks: [] },
      { index: 2, name: "B", verifyChecks: [] },
    ];

    const result = buildGuideCompleteVerifyPrompt(emptySessions, "s.md", null);

    expect(result).toContain(PREAMBLE_HEADER);
    expect(result).toContain("docs/specs/s.md");
    expect(result).toContain("pnpm tsc --noEmit");
  });
});
