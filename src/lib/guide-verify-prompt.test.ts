import { describe, it, expect } from "vitest";
import {
  buildSessionVerifyPrompt,
  buildGuideCompleteVerifyPrompt,
} from "./guide-verify-prompt";

describe("buildSessionVerifyPrompt", () => {
  it("produces the correct template for a session with checks", () => {
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

    expect(result).toContain("Session 2: Data Collection Overhaul");
    expect(result).toContain("docs/specs/ai-potential-analysis.md");
    expect(result).toContain("- Rating buttons render as 5 clickable buttons");
    expect(result).toContain("- TypeScript compiles: `pnpm tsc --noEmit`");
    expect(result).toContain("PASS or FAIL");
    expect(result).not.toContain("Verification Audit");
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
  });

  it("handles session with no checks", () => {
    const result = buildSessionVerifyPrompt(
      { index: 3, name: "Polish", verifyChecks: [] },
      "spec.md",
      null,
    );

    expect(result).toContain("Session 3: Polish");
    expect(result).toContain("docs/specs/spec.md");
  });

  it("prefers verificationPrompt over checklist when available", () => {
    const result = buildSessionVerifyPrompt(
      {
        index: 1,
        name: "Database Schema",
        verifyChecks: [{ label: "TypeScript compiles" }],
        verificationPrompt:
          "Open src/models/user.ts.\nVERIFY: User model exists.",
      },
      "test.md",
      null,
    );

    expect(result).toContain("Open src/models/user.ts");
    expect(result).toContain("VERIFY: User model exists");
    expect(result).not.toContain("Check each of the following");
    // Since no checklist fallback is produced, verifyChecks must not leak in
    expect(result).not.toContain("- TypeScript compiles");
  });

  it("falls back to checklist when verificationPrompt is null", () => {
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

    expect(result).toContain("Check each of the following");
    expect(result).toContain("- TypeScript compiles");
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

  it("groups checks by session header", () => {
    const result = buildGuideCompleteVerifyPrompt(sessions, "my-spec.md", null);

    expect(result).toContain("Session 1: Backend Setup");
    expect(result).toContain("- DB migrations run");
    expect(result).toContain("- API endpoints respond");
    expect(result).toContain("Session 2: Frontend UI");
    expect(result).toContain("- Components render correctly");
    expect(result).toContain("- TypeScript compiles");
    expect(result).toContain("complete implementation");
    expect(result).toContain("docs/specs/my-spec.md");
  });

  it("includes audit line when auditFilename provided", () => {
    const result = buildGuideCompleteVerifyPrompt(
      sessions,
      "spec.md",
      "spec.audit.md",
    );

    expect(result).toContain("Verification Audit at docs/specs/spec.audit.md");
  });

  it("omits audit line when auditFilename is null", () => {
    const result = buildGuideCompleteVerifyPrompt(sessions, "spec.md", null);

    expect(result).not.toContain("Verification Audit");
  });

  it("skips sessions with no verify checks", () => {
    const mixedSessions = [
      { index: 1, name: "Infra", verifyChecks: [] },
      { index: 2, name: "API", verifyChecks: [{ label: "Tests pass" }] },
    ];

    const result = buildGuideCompleteVerifyPrompt(mixedSessions, "s.md", null);

    expect(result).not.toContain("Session 1: Infra");
    expect(result).toContain("Session 2: API");
    expect(result).toContain("- Tests pass");
  });

  it("returns fallback prompt when all sessions have empty checks", () => {
    const emptySessions = [
      { index: 1, name: "A", verifyChecks: [] },
      { index: 2, name: "B", verifyChecks: [] },
    ];

    const result = buildGuideCompleteVerifyPrompt(emptySessions, "s.md", null);

    expect(result).toContain("docs/specs/s.md");
    expect(result).toContain("pnpm tsc --noEmit");
  });
});
