import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  SPEC_READY_PATTERNS,
  SPEC_START_PATTERN,
  FILE_REQUEST_PATTERN,
  NEW_APP_PROMPT,
  FEATURE_MODE_PROMPT,
} from "./spec-prompts";

describe("buildSystemPrompt", () => {
  const templateCatalog = "template-1: Next.js\ntemplate-2: Vite React";
  const projectContext = "Project has 5 routes and uses Prisma.";

  it("returns NEW_APP_PROMPT with template catalog for new_application mode", () => {
    const result = buildSystemPrompt("new_application", templateCatalog, "");
    expect(result).toContain("template-1: Next.js");
    expect(result).toContain("template-2: Vite React");
    // Should be based on NEW_APP_PROMPT
    expect(result).toContain("senior technical architect and requirements analyst");
    // Should NOT contain feature-mode markers
    expect(result).not.toContain("{PROJECT_CONTEXT}");
    expect(result).not.toContain("{TEMPLATE_CATALOG}");
  });

  it("returns FEATURE_MODE_PROMPT with context for feature mode", () => {
    const result = buildSystemPrompt("feature", templateCatalog, projectContext);
    expect(result).toContain(projectContext);
    expect(result).toContain(templateCatalog);
    // Should be based on FEATURE_MODE_PROMPT
    expect(result).toContain("FEATURE in an existing project");
    expect(result).not.toContain("{PROJECT_CONTEXT}");
    expect(result).not.toContain("{TEMPLATE_CATALOG}");
  });

  it("falls back to NEW_APP_PROMPT for feature mode without projectContext", () => {
    const result = buildSystemPrompt("feature", templateCatalog, "");
    // Empty projectContext means falsy, so falls back to NEW_APP_PROMPT
    expect(result).toContain("senior technical architect and requirements analyst");
  });
});

describe("SPEC_READY_PATTERNS", () => {
  it("is an array of RegExp patterns", () => {
    expect(Array.isArray(SPEC_READY_PATTERNS)).toBe(true);
    expect(SPEC_READY_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of SPEC_READY_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it("matches expected ready phrases", () => {
    expect(SPEC_READY_PATTERNS.some((p) => p.test("I have enough to write the specification"))).toBe(true);
    expect(SPEC_READY_PATTERNS.some((p) => p.test("Ready when you are"))).toBe(true);
    expect(SPEC_READY_PATTERNS.some((p) => p.test("Shall I write the spec?"))).toBe(true);
    expect(SPEC_READY_PATTERNS.some((p) => p.test("I have enough information"))).toBe(true);
    expect(SPEC_READY_PATTERNS.some((p) => p.test("Ready to write"))).toBe(true);
    expect(SPEC_READY_PATTERNS.some((p) => p.test("Shall I proceed"))).toBe(true);
  });
});

describe("SPEC_START_PATTERN", () => {
  it("matches spec document headers with em dash", () => {
    expect(SPEC_START_PATTERN.test("# My App — Requirements Specification")).toBe(true);
  });

  it("matches spec document headers with hyphen", () => {
    expect(SPEC_START_PATTERN.test("# My App - Feature Specification")).toBe(true);
  });

  it("matches simple Specification header", () => {
    expect(SPEC_START_PATTERN.test("# My App — Specification")).toBe(true);
  });

  it("does not match regular headings", () => {
    expect(SPEC_START_PATTERN.test("# Introduction")).toBe(false);
    expect(SPEC_START_PATTERN.test("## Some Section")).toBe(false);
  });
});

describe("FILE_REQUEST_PATTERN", () => {
  it("matches REQUEST_FILES blocks with emoji", () => {
    // Reset lastIndex since it's a global regex
    FILE_REQUEST_PATTERN.lastIndex = 0;
    const match = FILE_REQUEST_PATTERN.exec("📂 REQUEST_FILES: src/app.tsx, src/layout.tsx");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("src/app.tsx, src/layout.tsx");
  });

  it("does not match plain text without the marker", () => {
    FILE_REQUEST_PATTERN.lastIndex = 0;
    const match = FILE_REQUEST_PATTERN.exec("Just some regular text");
    expect(match).toBeNull();
  });
});

describe("prompt constants", () => {
  it("NEW_APP_PROMPT contains template catalog placeholder", () => {
    expect(NEW_APP_PROMPT).toContain("{TEMPLATE_CATALOG}");
  });

  it("FEATURE_MODE_PROMPT contains both placeholders", () => {
    expect(FEATURE_MODE_PROMPT).toContain("{TEMPLATE_CATALOG}");
    expect(FEATURE_MODE_PROMPT).toContain("{PROJECT_CONTEXT}");
  });
});
