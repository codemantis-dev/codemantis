import { describe, it, expect } from "vitest";
import {
  BUILD_MODE_PREAMBLE,
  FIX_MODE_PREAMBLE,
  wrapBuildPrompt,
} from "./build-mode-preamble";

// The preamble is the persona contract sent to Claude Code at every
// build/fix turn under Self-Drive. Its rules and banned-pattern lists
// are the user-visible spec of what counts as senior-engineer behaviour.
// These tests pin the contract: a future edit that quietly drops a rule
// or banned phrase will fail loudly here.

describe("BUILD_MODE_PREAMBLE", () => {
  it("opens with a clear BUILD MODE header so Claude Code knows the contract is active", () => {
    expect(BUILD_MODE_PREAMBLE).toContain("BUILD MODE");
    expect(BUILD_MODE_PREAMBLE).toContain("READ BEFORE WRITING ANY CODE");
  });

  it("declares Rule 1: scope = deliverables, not file fences", () => {
    expect(BUILD_MODE_PREAMBLE).toContain("FIX ROOT CAUSES");
    expect(BUILD_MODE_PREAMBLE).toMatch(/DELIVERABLES.*not a fence/s);
    // The exact failure mode from the original incident:
    expect(BUILD_MODE_PREAMBLE).toContain("local type extension");
    expect(BUILD_MODE_PREAMBLE).toContain("shadow interface");
    expect(BUILD_MODE_PREAMBLE).toContain("to avoid modifying");
  });

  it("lists every banned shortcut pattern from Rule 1", () => {
    expect(BUILD_MODE_PREAMBLE).toContain("`as any`");
    expect(BUILD_MODE_PREAMBLE).toContain("as unknown as X");
    expect(BUILD_MODE_PREAMBLE).toContain("@ts-ignore");
    expect(BUILD_MODE_PREAMBLE).toContain("@ts-nocheck");
    expect(BUILD_MODE_PREAMBLE).toContain("@ts-expect-error");
    expect(BUILD_MODE_PREAMBLE).toContain("duplicating a function");
    expect(BUILD_MODE_PREAMBLE).toContain(
      "silencing a lint or test instead of fixing what it caught",
    );
  });

  it("warns against the reverse failure mode (speculative scope widening)", () => {
    expect(BUILD_MODE_PREAMBLE).toMatch(/do NOT widen scope speculatively/);
    expect(BUILD_MODE_PREAMBLE).toContain(
      "ONE upstream definition that's actually wrong",
    );
  });

  it("declares Rule 2: migration awareness — grep all consumers before changing shared definitions", () => {
    expect(BUILD_MODE_PREAMBLE).toContain("MIGRATION AWARENESS");
    expect(BUILD_MODE_PREAMBLE).toMatch(/GREP for every\s+call site/);
    expect(BUILD_MODE_PREAMBLE).toContain("Type changes");
    expect(BUILD_MODE_PREAMBLE).toContain("Migration changes");
    expect(BUILD_MODE_PREAMBLE).toContain("Renamed export");
    expect(BUILD_MODE_PREAMBLE).toContain("New required field");
  });

  it("declares Rule 3: no fabrication of test or command output", () => {
    expect(BUILD_MODE_PREAMBLE).toContain("NO FABRICATION");
    expect(BUILD_MODE_PREAMBLE).toContain("the build should pass");
    expect(BUILD_MODE_PREAMBLE).toContain("tests likely succeed");
    expect(BUILD_MODE_PREAMBLE).toContain("I expect this to work");
    expect(BUILD_MODE_PREAMBLE).toContain("this should now compile");
  });

  it("declares Rule 4: test integrity — no skip, no loosened assertions, no stub-asserting tests", () => {
    expect(BUILD_MODE_PREAMBLE).toContain("TEST INTEGRITY");
    expect(BUILD_MODE_PREAMBLE).toContain("show the red, then the green");
    expect(BUILD_MODE_PREAMBLE).toContain(".skip");
    expect(BUILD_MODE_PREAMBLE).toContain("xdescribe");
    expect(BUILD_MODE_PREAMBLE).toContain("#[ignore]");
    expect(BUILD_MODE_PREAMBLE).toContain("loosen an assertion");
    expect(BUILD_MODE_PREAMBLE).toContain(
      "asserts the hardcoded return of a stub",
    );
  });

  it("declares Rule 5: honest blocker over fake progress, with both DEFERRED line and structured pause", () => {
    expect(BUILD_MODE_PREAMBLE).toContain("HONEST BLOCKER");
    // Weak form
    expect(BUILD_MODE_PREAMBLE).toContain("DEFERRED:");
    expect(BUILD_MODE_PREAMBLE).toContain("follow-up:");
    // Strong form references the existing structured-blocker mechanism.
    // The preamble word-wraps "structured blocker" across a line break,
    // so match whitespace-tolerantly.
    expect(BUILD_MODE_PREAMBLE).toMatch(/structured\s+blocker/);
    expect(BUILD_MODE_PREAMBLE).toContain("infra-state-drift");
    expect(BUILD_MODE_PREAMBLE).toContain("permissions");
    expect(BUILD_MODE_PREAMBLE).toContain("missing-deps");
  });

  it("ends with the session-prompt boundary marker so the actual work is clearly delimited", () => {
    expect(BUILD_MODE_PREAMBLE).toContain(
      "SESSION PROMPT (the actual work for this turn",
    );
  });
});

describe("FIX_MODE_PREAMBLE", () => {
  it("opens with FIX MODE header and the state-your-understanding requirement", () => {
    expect(FIX_MODE_PREAMBLE).toContain("FIX MODE");
    expect(FIX_MODE_PREAMBLE).toContain("STATE YOUR UNDERSTANDING");
    expect(FIX_MODE_PREAMBLE).toContain("smallest correct fix");
  });

  it("inherits the full Senior-Engineer Quality Contract (same rules as build mode)", () => {
    expect(FIX_MODE_PREAMBLE).toContain("FIX ROOT CAUSES");
    expect(FIX_MODE_PREAMBLE).toContain("MIGRATION AWARENESS");
    expect(FIX_MODE_PREAMBLE).toContain("NO FABRICATION");
    expect(FIX_MODE_PREAMBLE).toContain("TEST INTEGRITY");
    expect(FIX_MODE_PREAMBLE).toContain("HONEST BLOCKER");
  });

  it("ends with a fix-prompt boundary marker", () => {
    expect(FIX_MODE_PREAMBLE).toContain(
      "FIX PROMPT (the specific failure the orchestrator caught",
    );
  });
});

describe("wrapBuildPrompt", () => {
  const sessionPrompt =
    "Read docs/specs/foo.md sections 3 and 6. Implement the migration.";

  it("prepends BUILD_MODE_PREAMBLE when kind is 'build'", () => {
    const wrapped = wrapBuildPrompt(sessionPrompt, "build");
    expect(wrapped.startsWith(BUILD_MODE_PREAMBLE)).toBe(true);
    expect(wrapped).toContain(sessionPrompt);
  });

  it("prepends FIX_MODE_PREAMBLE when kind is 'fix'", () => {
    const wrapped = wrapBuildPrompt(sessionPrompt, "fix");
    expect(wrapped.startsWith(FIX_MODE_PREAMBLE)).toBe(true);
    expect(wrapped).toContain(sessionPrompt);
  });

  it("does not duplicate the prompt content", () => {
    const wrapped = wrapBuildPrompt(sessionPrompt, "build");
    // The session prompt should appear exactly once in the wrapped output
    const occurrences = wrapped.split(sessionPrompt).length - 1;
    expect(occurrences).toBe(1);
  });

  it("preserves an empty prompt without crashing or padding", () => {
    const wrapped = wrapBuildPrompt("", "build");
    expect(wrapped).toBe(BUILD_MODE_PREAMBLE);
  });
});
