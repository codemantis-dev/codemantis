import { describe, it, expect } from "vitest";
import { isGuideStarted } from "./guide-helpers";
import type { ImplementationGuide, GuideSession } from "../types/implementation-guide";

function makeSession(overrides?: Partial<GuideSession>): GuideSession {
  return {
    index: 1,
    name: "Foundation",
    scope: "Phase 1",
    readSections: "Sections 1",
    files: ["src/db.ts"],
    prompt: "Build it.",
    verifyChecks: [
      { id: "verify-1-0", label: "TypeScript compiles", checked: false },
    ],
    status: "active",
    promptSent: false,
    verifyRequested: false,
    ...overrides,
  };
}

function makeGuide(sessions?: GuideSession[]): ImplementationGuide {
  return {
    id: "guide-1",
    projectPath: "/test",
    specFilename: "spec.md",
    auditFilename: null,
    title: "Test Guide",
    sessions: sessions ?? [makeSession()],
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
  };
}

describe("isGuideStarted", () => {
  it("returns false for a fresh guide", () => {
    expect(isGuideStarted(makeGuide())).toBe(false);
  });

  it("returns true when a session has status 'done'", () => {
    const guide = makeGuide([
      makeSession({ status: "done" }),
      makeSession({ index: 2, status: "active" }),
    ]);
    expect(isGuideStarted(guide)).toBe(true);
  });

  it("returns true when promptSent is true", () => {
    const guide = makeGuide([makeSession({ promptSent: true })]);
    expect(isGuideStarted(guide)).toBe(true);
  });

  it("returns true when verifyRequested is true", () => {
    const guide = makeGuide([makeSession({ verifyRequested: true })]);
    expect(isGuideStarted(guide)).toBe(true);
  });

  it("returns true when any verify check is checked", () => {
    const guide = makeGuide([
      makeSession({
        verifyChecks: [
          { id: "v-1", label: "Check 1", checked: true },
          { id: "v-2", label: "Check 2", checked: false },
        ],
      }),
    ]);
    expect(isGuideStarted(guide)).toBe(true);
  });

  it("returns false when all verify checks are unchecked", () => {
    const guide = makeGuide([
      makeSession({
        verifyChecks: [
          { id: "v-1", label: "Check 1", checked: false },
          { id: "v-2", label: "Check 2", checked: false },
        ],
      }),
    ]);
    expect(isGuideStarted(guide)).toBe(false);
  });

  it("returns false when session has no verify checks and no progress flags", () => {
    const guide = makeGuide([makeSession({ verifyChecks: [] })]);
    expect(isGuideStarted(guide)).toBe(false);
  });

  it("detects progress in a later session (not just the first)", () => {
    const guide = makeGuide([
      makeSession({ index: 1, status: "active" }),
      makeSession({ index: 2, status: "pending", promptSent: true }),
    ]);
    expect(isGuideStarted(guide)).toBe(true);
  });
});
