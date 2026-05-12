import { describe, it, expect } from "vitest";
import type { OrchestratorInput, OrchestratorDecision } from "../types/implementation-guide";
import {
  measureEvidenceCoverage,
  isFabricationDetectorFix,
  isSkippedCommandsRejection,
  applyDetectorSuppressors,
} from "./self-drive-detector-suppressors";

function makeInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    currentPhase: "verifying",
    sessionPlan: {
      index: 1,
      name: "Foundation",
      scope: "Set up project structure",
      prompt: "Build foundation",
      verifyChecks: [
        { label: "Migrations applied", kind: "side-effect" },
        { label: "Tables exist", kind: "side-effect" },
        { label: "Enum values exist", kind: "side-effect" },
        { label: "Typecheck passes", kind: "behavioral" },
        { label: "Lint passes", kind: "behavioral" },
      ],
      isLastSession: false,
      hasAuditDocument: false,
    },
    claudeCodeResponse: "",
    claudeCodeToolsUsed: [],
    turnDurationMs: 60_000,
    turnTokensUsed: 100_000,
    fixAttempt: 0,
    maxFixAttempts: 3,
    previousFixPrompts: [],
    techStack: "TypeScript",
    testCommand: "pnpm test",
    buildCommand: "pnpm tsc --noEmit",
    specFilename: "spec.md",
    auditFilename: null,
    activeBlocker: null,
    recentPauseSummaries: [],
    ...overrides,
  };
}

describe("measureEvidenceCoverage", () => {
  it("counts shell command lines", () => {
    const text = "$ supabase migration list\nout\n$ pnpm tsc --noEmit\nclean\n";
    const c = measureEvidenceCoverage(text, []);
    expect(c.shellCommandBlocks).toBe(2);
  });

  it("counts fenced code blocks", () => {
    const text = "```\na\n```\n```ts\nb\n```\n";
    const c = measureEvidenceCoverage(text, []);
    expect(c.fencedCodeBlocks).toBe(4); // 2 opens + 2 closes
  });

  it("counts file:line citations", () => {
    const text = "see src/foo.ts:42 and src-tauri/lib.rs:100 plus deep/path/x.tsx:7";
    const c = measureEvidenceCoverage(text, []);
    expect(c.fileLineCitations).toBe(3);
  });

  it("matches labels by first words", () => {
    const text = "Migrations applied — PASS, Tables exist — PASS, others not mentioned";
    const c = measureEvidenceCoverage(text, [
      "Migrations applied",
      "Tables exist",
      "Enum values exist",
    ]);
    expect(c.labelMentions).toBe(2);
    expect(c.totalLabels).toBe(3);
    expect(c.labelCoverage).toBeCloseTo(2 / 3, 2);
  });

  it("returns zero coverage on empty input", () => {
    const c = measureEvidenceCoverage("", ["A", "B"]);
    expect(c.totalEvidenceSignals).toBe(0);
    expect(c.labelMentions).toBe(0);
  });
});

describe("isFabricationDetectorFix", () => {
  it("detects soft verify-evidence templates", () => {
    const d: OrchestratorDecision = {
      action: "fix",
      summary: "ok",
      confidence: "high",
      fixPrompt: "Your turn claimed work. Two paths forward, pick the one that matches reality...",
    };
    expect(isFabricationDetectorFix(d)).toBe(true);
  });

  it("does not flag a regular fix prompt", () => {
    const d: OrchestratorDecision = {
      action: "fix",
      summary: "ok",
      confidence: "high",
      fixPrompt: "TypeScript error at src/foo.ts:10 — TS2304: Cannot find name. Fix the import.",
    };
    expect(isFabricationDetectorFix(d)).toBe(false);
  });

  it("does not flag advance/pause/recheck decisions", () => {
    expect(isFabricationDetectorFix({
      action: "advance", summary: "", confidence: "high",
    })).toBe(false);
    expect(isFabricationDetectorFix({
      action: "pause",
      summary: "",
      confidence: "high",
      pauseReason: "Two paths forward, pick the one that matches reality",
    })).toBe(false);
  });
});

describe("isSkippedCommandsRejection", () => {
  it("detects 'ran X instead of evidence commands' phrasings", () => {
    const d: OrchestratorDecision = {
      action: "pause",
      summary: "Claude Code ran full pnpm test instead of the five targeted evidence commands",
      confidence: "high",
    };
    expect(isSkippedCommandsRejection(d)).toBe(true);
  });

  it("does not flag legit pauses", () => {
    expect(isSkippedCommandsRejection({
      action: "pause",
      summary: "Missing credentials for deploy",
      pauseReason: "Need DATABASE_URL",
      confidence: "high",
    })).toBe(false);
  });
});

describe("applyDetectorSuppressors", () => {
  it("downgrades fabrication-fix when worker provided substantial evidence", () => {
    const input = makeInput({
      claudeCodeResponse: [
        "Migrations applied — PASS — $ supabase migration list",
        "$ supabase functions list",
        "$ pnpm tsc --noEmit",
        "Tables exist — PASS — see src/db.ts:1",
        "```\nresult: clean\n```",
        "Typecheck passes — clean",
        "Enum values exist — present",
        "Lint passes — 0 errors",
      ].join("\n"),
    });
    const decision: OrchestratorDecision = {
      action: "fix",
      summary: "claim without evidence",
      confidence: "high",
      fixPrompt: "Your turn claimed Verified 5/5. Two paths forward, pick the one that matches reality.",
    };

    const result = applyDetectorSuppressors(decision, input);
    expect(result.suppressorsApplied).toContain("fabrication-detector");
    expect(result.decision.action).toBe("request_recheck");
    expect(result.decision.recheckPrompt).toContain("evidence signals");
    expect(result.decision.fixPrompt).toBeUndefined();
  });

  it("downgrades a 'skipped commands' pause when evidence is present (the screenshot case)", () => {
    const input = makeInput({
      claudeCodeResponse: [
        "Migrations applied — PASS — $ supabase migration list",
        "$ supabase functions list",
        "Tables exist — PASS — src/db.ts:1",
        "$ pnpm tsc --noEmit",
        "Typecheck passes — clean",
        "Enum values exist — three new",
        "Lint passes — 0 errors",
      ].join("\n"),
    });
    const decision: OrchestratorDecision = {
      action: "pause",
      summary: "Claude Code ran full pnpm test instead of the five targeted evidence commands",
      confidence: "medium",
      pauseReason: "skipped all 5 targeted evidence commands",
      blocker: {
        kind: "unknown",
        summary: "skipped commands",
        optionsOffered: ["paste evidence", "override"],
        resolutionCriteria: "evidence quoted verbatim",
      },
    };

    const result = applyDetectorSuppressors(decision, input);
    expect(result.suppressorsApplied).toContain("skipped-commands");
    expect(result.decision.action).toBe("request_recheck");
    expect(result.decision.blocker).toBeUndefined();
    expect(result.decision.pauseReason).toBeUndefined();
  });

  it("passes through a legitimate fix when evidence is sparse", () => {
    const input = makeInput({
      claudeCodeResponse: "Verified 5/5 items, looks good", // no $ blocks, no code, no labels
    });
    const decision: OrchestratorDecision = {
      action: "fix",
      summary: "no evidence",
      confidence: "high",
      fixPrompt: "Your turn claimed Verified 5/5. Two paths forward, pick the one that matches reality.",
    };

    const result = applyDetectorSuppressors(decision, input);
    expect(result.suppressorsApplied).toHaveLength(0);
    expect(result.decision.action).toBe("fix");
  });

  it("never touches plain advance decisions", () => {
    const input = makeInput({ claudeCodeResponse: "$ pnpm test\nall green" });
    const decision: OrchestratorDecision = {
      action: "advance",
      summary: "tests pass",
      confidence: "high",
    };
    const result = applyDetectorSuppressors(decision, input);
    expect(result.suppressorsApplied).toHaveLength(0);
    expect(result.decision).toBe(decision);
  });

  it("never touches a real test-failure fix", () => {
    const input = makeInput({
      claudeCodeResponse: [
        "FAIL src/foo.test.ts:42",
        "$ pnpm test",
        "1 failed",
      ].join("\n"),
    });
    const decision: OrchestratorDecision = {
      action: "fix",
      summary: "test failing",
      confidence: "high",
      fixPrompt: "Test src/foo.test.ts:42 is failing with `expected 1 got 2`. Fix the implementation.",
    };
    const result = applyDetectorSuppressors(decision, input);
    expect(result.suppressorsApplied).toHaveLength(0);
    expect(result.decision.action).toBe("fix");
    expect(result.decision.fixPrompt).toBe(decision.fixPrompt);
  });
});
