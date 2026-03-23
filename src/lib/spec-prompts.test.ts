import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildClaudeCodePrompt,
  SPEC_READY_PATTERNS,
  SPEC_START_PATTERN,
  AUDIT_START_PATTERN,
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

describe("AUDIT_START_PATTERN", () => {
  it("matches audit document headers with em dash", () => {
    expect(AUDIT_START_PATTERN.test("# My App — Verification Audit")).toBe(true);
  });

  it("matches audit document headers with hyphen", () => {
    expect(AUDIT_START_PATTERN.test("# My Feature - Verification Audit")).toBe(true);
  });

  it("matches multi-word feature names", () => {
    expect(AUDIT_START_PATTERN.test("# Subscriber List Management — Verification Audit")).toBe(true);
  });

  it("does not match regular headings", () => {
    expect(AUDIT_START_PATTERN.test("# Introduction")).toBe(false);
    expect(AUDIT_START_PATTERN.test("## Verification")).toBe(false);
  });

  it("does not match specification headers", () => {
    expect(AUDIT_START_PATTERN.test("# My App — Requirements Specification")).toBe(false);
    expect(AUDIT_START_PATTERN.test("# My App — Feature Specification")).toBe(false);
  });

  it("matches within multi-line content", () => {
    const content = "Some preamble text\n\n# Dashboard — Verification Audit\n\n## Pre-Flight Checks";
    expect(AUDIT_START_PATTERN.test(content)).toBe(true);
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

  it("NEW_APP_PROMPT contains verification audit prompt section", () => {
    expect(NEW_APP_PROMPT).toContain("VERIFICATION AUDIT");
    expect(NEW_APP_PROMPT).toContain("Verification Audit");
    expect(NEW_APP_PROMPT).toContain("VERIFY: Open");
    expect(NEW_APP_PROMPT).toContain("CRITICAL");
    expect(NEW_APP_PROMPT).toContain("IMPORTANT");
    expect(NEW_APP_PROMPT).toContain("POLISH");
  });

  it("FEATURE_MODE_PROMPT contains verification audit prompt section", () => {
    expect(FEATURE_MODE_PROMPT).toContain("VERIFICATION AUDIT");
    expect(FEATURE_MODE_PROMPT).toContain("Verification Audit");
    expect(FEATURE_MODE_PROMPT).toContain("VERIFY: Open");
    expect(FEATURE_MODE_PROMPT).toContain("CRITICAL");
    expect(FEATURE_MODE_PROMPT).toContain("IMPORTANT");
    expect(FEATURE_MODE_PROMPT).toContain("POLISH");
  });

  it("verification audit prompt includes all mandatory sections", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("Pre-Flight Checks");
      expect(prompt).toContain("Data Model Verification");
      expect(prompt).toContain("Service/API Layer Verification");
      expect(prompt).toContain("Component Verification");
      expect(prompt).toContain("Integration Verification");
      expect(prompt).toContain("State Transition Verification");
      expect(prompt).toContain("Edge Case Verification");
      expect(prompt).toContain("Validation Verification");
      expect(prompt).toContain("UI Polish Verification");
      expect(prompt).toContain("Full User Journey Trace");
      expect(prompt).toContain("Final Audit Summary");
    }
  });

  it("verification audit prompt includes all format rules", () => {
    // Both prompts share these core format rules (though wording may differ slightly)
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain('EVERY check starts with "VERIFY: Open');
      expect(prompt).toContain("Expected:");
      expect(prompt).toContain("Not expected:");
      expect(prompt).toContain("IF ANY ITEM FAILS");
      expect(prompt).toContain("Full User Journey");
    }
  });
});

describe("buildClaudeCodePrompt", () => {
  const templateCatalog = "template-1: Next.js\ntemplate-2: Vite React";
  const projectContext = "Project has 5 routes and uses Prisma.";

  // ── 1. Returns a string containing the SPECWRITER MODE header ──

  it("returns a string containing the SPECWRITER MODE header", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("CODEMANTIS SPECWRITER MODE — ACTIVE");
  });

  it("feature mode also contains the SPECWRITER MODE header", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("CODEMANTIS SPECWRITER MODE — ACTIVE");
  });

  // ── 2. Contains hard constraints ──

  it("contains hard constraint about not writing files", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("Do NOT write, edit, create, or delete any files");
  });

  it("contains hard constraint about not running bash", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("Do NOT run bash commands");
  });

  it("contains hard constraint about not suggesting code changes", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("Do NOT suggest code changes directly");
  });

  it("contains permission to read project files", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("You CAN and SHOULD read project files");
  });

  // ── 3. Contains ?> marker instructions ──

  it("contains ?> marker instructions for selectable options", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("?> Option A description");
    expect(result).toContain("?> Option B description");
  });

  it("contains instructions that ?> must start at the beginning of the line", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("Each ?> MUST start at the beginning of the line");
  });

  it("contains feature selection instructions with ?> markers", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("FEATURE SELECTION");
    expect(result).toMatch(/\?>\s+★/);
  });

  // ── 4. Contains confidence tag instructions ──

  it("contains confidence tag instructions with all three tag levels", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("CONFIDENCE TAGS");
    expect(result).toContain("✅ VERIFIED");
    expect(result).toContain("⚠️ INFERRED");
    expect(result).toContain("❓ ASSUMED");
  });

  it("contains guidance that most references should be VERIFIED", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("MOST references should be");
    expect(result).toContain("✅ VERIFIED");
  });

  // ── 5. Contains spec document heading detection instructions ──

  it("contains spec document heading detection instructions", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("# {Name} — Requirements Specification");
    expect(result).toContain("# {Name} — Feature Specification");
    expect(result).toContain("spec preview mode");
  });

  it("contains verification audit heading detection instructions", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("# {Name} — Verification Audit");
    expect(result).toContain("audit tab");
  });

  // ── 6. Contains "Ready to write" detection phrases ──

  it("contains 'Ready to write' detection phrase examples", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("I have enough to write the specification");
    expect(result).toContain("Shall I write the specification now?");
    expect(result).toContain("Ready to write");
  });

  it("contains explanation of 'Generate Spec' button trigger", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain('The UI detects these phrases to show the "Generate Spec" button');
  });

  // ── 7. Feature mode with project context ──

  it("feature mode with context contains the project context string", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("Project has 5 routes and uses Prisma.");
  });

  it("feature mode with context contains the template catalog", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("template-1: Next.js");
    expect(result).toContain("template-2: Vite React");
  });

  it("feature mode with context does NOT contain {PROJECT_CONTEXT} placeholder", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).not.toContain("{PROJECT_CONTEXT}");
  });

  it("feature mode with context does NOT contain {TEMPLATE_CATALOG} placeholder", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).not.toContain("{TEMPLATE_CATALOG}");
  });

  it("feature mode with context does NOT contain {MODE_SPECIFIC_PROMPT} placeholder", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).not.toContain("{MODE_SPECIFIC_PROMPT}");
  });

  // ── 8. new_application mode ──

  it("new_application mode contains template catalog", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("template-1: Next.js");
    expect(result).toContain("template-2: Vite React");
  });

  it("new_application mode does NOT contain {TEMPLATE_CATALOG} placeholder", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).not.toContain("{TEMPLATE_CATALOG}");
  });

  it("new_application mode does NOT contain {MODE_SPECIFIC_PROMPT} placeholder", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).not.toContain("{MODE_SPECIFIC_PROMPT}");
  });

  it("new_application mode contains the new_app prompt content", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("senior technical architect and requirements analyst");
  });

  // ── 9. Feature mode without context falls back to new_application prompt ──

  it("feature mode with empty projectContext falls back to new_application prompt", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, "");
    expect(result).toContain("senior technical architect and requirements analyst");
    // Should NOT contain feature-mode-specific markers
    expect(result).not.toContain("FEATURE in an existing project");
  });

  it("feature mode with undefined-like empty string projectContext uses new_app prompt", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, "");
    // New app prompt contains this
    expect(result).toContain("CONVERSATION PHASE (gather requirements before writing ANYTHING)");
  });

  // ── 10. Does NOT contain REQUEST_FILES markers ──

  it("does NOT contain REQUEST_FILES markers in new_application mode", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).not.toMatch(/📂\s*REQUEST_FILES:/);
  });

  it("does NOT contain REQUEST_FILES markers in feature mode", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).not.toMatch(/📂\s*REQUEST_FILES:/);
  });

  it("new_application mode does not contain REQUEST_FILES lines", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    // The new_app prompt doesn't have REQUEST_FILES natively, but verify the output is clean
    const lines = result.split("\n");
    const requestFileLines = lines.filter((l: string) => l.includes("REQUEST_FILES:"));
    expect(requestFileLines).toHaveLength(0);
  });

  it("feature mode strips all REQUEST_FILES lines from the prompt", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    const lines = result.split("\n");
    const requestFileLines = lines.filter((l: string) => l.includes("REQUEST_FILES:"));
    expect(requestFileLines).toHaveLength(0);
  });

  // ── 11. Does NOT contain "FILE ACCESS — YOU CAN REQUEST PROJECT FILES" section header ──

  it("does NOT contain 'FILE ACCESS — YOU CAN REQUEST PROJECT FILES' section in feature mode", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).not.toContain("FILE ACCESS — YOU CAN REQUEST PROJECT FILES");
  });

  it("does NOT contain 'FILE ACCESS — YOU CAN REQUEST PROJECT FILES' section in new_application mode", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).not.toContain("FILE ACCESS — YOU CAN REQUEST PROJECT FILES");
  });

  // ── 12. Contains adapted file access instructions ──

  it("feature mode contains adapted file access instructions mentioning Read tool", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toMatch(/Read tool|read files directly|READ THE FILE directly/);
  });

  it("feature mode adapts file request instructions to use Read tool", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    // The stripRequestFileSections function replaces REQUEST THE FILE with READ THE FILE directly
    expect(result).toContain("READ THE FILE directly using the Read tool");
  });

  it("feature mode adapts 'request files' step to 'read files' in conversation flow", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    // Step 2 should say read instead of request
    expect(result).toContain("IMMEDIATELY read the files you'll need using the Read tool");
  });

  it("feature mode adapts 'final file read' step to use Read tool", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("BEFORE writing, read any component you'll reference using the Read tool");
  });

  it("feature mode contains instruction that most tags should be VERIFIED", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("most tags should be ✅ VERIFIED");
  });

  // ── 13. Contains mode-specific content ──

  it("feature mode with context contains 'FEATURE in an existing project'", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("FEATURE in an existing project");
  });

  it("feature mode with context contains PROJECT CONTEXT section header", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("PROJECT CONTEXT");
  });

  it("new_application mode contains new_app writing phase content", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("WRITING PHASE (produce the specification document)");
  });

  it("feature mode with context contains feature writing phase content", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("WRITING PHASE — FEATURE SPECIFICATION");
  });

  it("feature mode with context contains Affected Files section marker", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("## 2. Affected Files");
  });

  it("new_application mode contains Data Model section marker", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("## 2. Data Model");
  });

  // ── Wrapper integration checks ──

  it("wraps the mode prompt inside the CLAUDE_CODE_SPECWRITER_WRAPPER", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    // The wrapper comes first, then the mode prompt content is embedded
    const headerIndex = result.indexOf("CODEMANTIS SPECWRITER MODE");
    const modeContentIndex = result.indexOf("senior technical architect");
    expect(headerIndex).toBeLessThan(modeContentIndex);
  });

  it("contains CONVERSATION FLOW section from the wrapper", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("CONVERSATION FLOW:");
  });

  it("contains FILE ACCESS ADVANTAGE section from the wrapper", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("FILE ACCESS ADVANTAGE");
    expect(result).toContain("direct access to the");
  });

  it("contains HARD CONSTRAINTS section from the wrapper", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("HARD CONSTRAINTS:");
  });

  it("contains RESPONSE FORMAT section from the wrapper", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("RESPONSE FORMAT — CRITICAL FOR UI INTERACTION");
  });

  it("mentions Read, Glob, Grep tools in the hard constraints", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("Read, Glob, Grep");
  });

  it("contains verification audit section from embedded mode prompt", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("VERIFICATION AUDIT");
    expect(result).toContain("Verification Audit");
  });

  it("contains implementation checklist section from embedded mode prompt", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("Implementation Checklist");
  });
});
