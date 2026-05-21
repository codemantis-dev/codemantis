import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildClaudeCodePrompt,
  SPEC_READY_PATTERNS,
  SPEC_START_PATTERN,
  AUDIT_START_PATTERN,
  AUDIT_FILE_PATTERN,
  FILE_REQUEST_PATTERN,
  isLikelySpecDocument,
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

  it("feature mode contains CODEBASE NAVIGATION rules", () => {
    const result = buildSystemPrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("CODEBASE NAVIGATION");
    expect(result).toContain("NEVER ask the user to identify file locations");
  });

  it("feature mode contains route-first file request instruction", () => {
    const result = buildSystemPrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("FIRST file request MUST include the routing file");
  });

  it("new_application mode contains QUESTION SCOPE RULE", () => {
    const result = buildSystemPrompt("new_application", templateCatalog, "");
    expect(result).toContain("QUESTION SCOPE RULE");
    expect(result).toContain("The user describes the product. You make the technical decisions.");
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

  it("matches 'Implementation & Testing Plan' heading", () => {
    expect(SPEC_START_PATTERN.test("# MyFeature — Implementation & Testing Plan")).toBe(true);
  });

  it("matches 'Technical Specification' heading", () => {
    expect(SPEC_START_PATTERN.test("# Dashboard — Technical Specification")).toBe(true);
  });

  it("matches 'Design Document' heading", () => {
    expect(SPEC_START_PATTERN.test("# Auth Flow — Design Document")).toBe(true);
  });

  it("matches 'System Blueprint' heading", () => {
    expect(SPEC_START_PATTERN.test("# Payment System - System Blueprint")).toBe(true);
  });

  it("matches shortened 'Spec' heading", () => {
    expect(SPEC_START_PATTERN.test("# My App — Spec")).toBe(true);
  });

  it("matches 'Comprehensive Repair' style heading", () => {
    expect(SPEC_START_PATTERN.test("# SpecLoom Comprehensive Repair — Requirements Specification")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(SPEC_START_PATTERN.test("# My App — feature specification")).toBe(true);
  });

  it("matches within multi-line content", () => {
    const content = "Some preamble\n\n# My App — Implementation Plan\n\n## 1. Overview";
    expect(SPEC_START_PATTERN.test(content)).toBe(true);
  });

  it("does not match regular headings without dash separator", () => {
    expect(SPEC_START_PATTERN.test("# Introduction")).toBe(false);
    expect(SPEC_START_PATTERN.test("## Some Section")).toBe(false);
  });

  it("does not match headings with dash but no document-type noun", () => {
    expect(SPEC_START_PATTERN.test("# Just a heading - nothing special")).toBe(false);
  });
});

describe("isLikelySpecDocument", () => {
  it("returns false for short content", () => {
    expect(isLikelySpecDocument("# Hello\n\nShort message")).toBe(false);
  });

  it("returns false for content not starting with --- or #", () => {
    const content = "Some text\n" + "## Section\n".repeat(10) + "a".repeat(2000);
    expect(isLikelySpecDocument(content)).toBe(false);
  });

  it("returns true for document with 3+ numbered H2 sections", () => {
    const spec = "---\n\n# App — Custom Title\n\n" +
      "## 1. Overview\nSome overview text about the application.\n\n" +
      "## 2. Data Model\nEntity definitions and relationships.\n\n" +
      "## 3. API Design\nEndpoints and routes.\n\n" +
      "## 4. UI Components\nComponent hierarchy.\n\n" +
      "x".repeat(1500);
    expect(isLikelySpecDocument(spec)).toBe(true);
  });

  it("returns true for document starting with # and having numbered sections", () => {
    const spec = "# My Feature Plan\n\n" +
      "## 1. Overview\nApplication overview.\n\n" +
      "## 2. Requirements\nRequirements list.\n\n" +
      "## 3. Implementation\nImplementation approach.\n\n" +
      "x".repeat(1500);
    expect(isLikelySpecDocument(spec)).toBe(true);
  });

  it("returns true for document with 5+ H2s and spec keywords", () => {
    const spec = "# My Feature\n\n" +
      "## Overview\nApplication overview and architecture.\n\n" +
      "## Requirements\nFunctional requirements list.\n\n" +
      "## Implementation\nImplementation approach.\n\n" +
      "## Components\nUI component structure.\n\n" +
      "## API Routes\nAPI route design.\n\n" +
      "## Checklist\nImplementation checklist.\n\n" +
      "x".repeat(1500);
    expect(isLikelySpecDocument(spec)).toBe(true);
  });

  it("returns false for conversational response with few sections", () => {
    const chat = "# Question\n\n## Answer\nHere is what I think.\n\n## Follow-up\nAnything else?\n" + "x".repeat(2000);
    expect(isLikelySpecDocument(chat)).toBe(false);
  });

  it("returns false for content under 1500 characters even with structure", () => {
    const short = "---\n\n# App\n\n## 1. A\nText\n\n## 2. B\nText\n\n## 3. C\nText";
    expect(short.length).toBeLessThan(1500);
    expect(isLikelySpecDocument(short)).toBe(false);
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

describe("AUDIT_FILE_PATTERN", () => {
  it("matches relative audit file paths", () => {
    const match = "saved to docs/specs/ai-potential-analysis.audit.md".match(AUDIT_FILE_PATTERN);
    expect(match?.[1]).toBe("docs/specs/ai-potential-analysis.audit.md");
  });

  it("matches absolute audit file paths", () => {
    const match = "saved to /Users/dev/project/my-feature.audit.md".match(AUDIT_FILE_PATTERN);
    expect(match?.[1]).toBe("/Users/dev/project/my-feature.audit.md");
  });

  it("matches audit path with 'It's at:' prefix", () => {
    const match = "It's at: docs/specs/feature.audit.md".match(AUDIT_FILE_PATTERN);
    expect(match?.[1]).toBe("docs/specs/feature.audit.md");
  });

  it("does not match regular .md files", () => {
    expect("docs/specs/feature.md".match(AUDIT_FILE_PATTERN)).toBeNull();
  });

  it("does not match partial audit extensions", () => {
    expect("file.audit.txt".match(AUDIT_FILE_PATTERN)).toBeNull();
  });

  it("extracts path from multi-line response", () => {
    const response = "The Verification Audit has been saved to docs/specs/app.audit.md .\n\n115 VERIFY directives covering:";
    const match = response.match(AUDIT_FILE_PATTERN);
    expect(match?.[1]).toBe("docs/specs/app.audit.md");
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

  // ── Anti-skim contract (Parts B + C) ───────────────────────────────────

  it("audit template includes the Contract for the Verifier section", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("## Contract for the Verifier");
      expect(prompt).toContain("Skimming = FAIL");
      expect(prompt).toContain("Reporting PASS without having opened the file is a contract violation");
    }
  });

  it("audit template requires batching of 20 items per batch", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("batches of 20");
    }
  });

  it("audit template lists forbidden batch-PASS phrases", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("all remaining items pass");
      expect(prompt).toContain("the rest look correct");
      expect(prompt).toContain("LGTM");
    }
  });

  it("audit template requires the structured VERIFY-N output format (rule 15)", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("VERIFIER OUTPUT FORMAT");
      expect(prompt).toContain("VERIFY-N — PASS|FAIL|SKIPPED");
      expect(prompt).toContain("Free-form paragraphs describing what was verified are forbidden");
    }
  });

  it("audit template mandates the required final accounting line", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("REQUIRED FINAL LINE");
      expect(prompt).toContain("Verified X/Y items | PASS: a | FAIL: b | SKIPPED: c | MISSING: d");
    }
  });

  it("verification prompt is mandatory for every session (not optional)", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("MANDATORY — VERIFICATION PROMPT (every session, without exception)");
      expect(prompt).toContain("No session may omit the Verification Prompt block");
      // The old OPTIONAL header must be gone.
      expect(prompt).not.toContain("OPTIONAL — VERIFICATION PROMPT (for complex sessions):");
    }
  });

  it("verification prompt rules cover both simple and complex session forms", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("SIMPLE SESSION FORM");
      expect(prompt).toContain("COMPLEX SESSION FORM");
      // Rules require quoted-code evidence and final accounting line.
      expect(prompt).toContain("Every check expects QUOTED CODE as evidence");
      expect(prompt).toContain("Verified X/Y | PASS n · FAIL n · SKIPPED n");
    }
  });

  // ── Dual-side handshake rules (the mock-only-PASS fix) ────────────────

  it("session plan rules describe the [integration] kind", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("[integration]");
      // Both sides must be implemented
      expect(prompt).toMatch(/caller AND the handler/);
      // The failure mode this exists to prevent
      expect(prompt).toContain('"mocked green, production broken"');
    }
  });

  it("session plan rules mandate the Cross-system actions introduced block", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("**Cross-system actions introduced:**");
      expect(prompt).toMatch(/action:\s*`[^`]+`\s*→\s*handler:/);
      // The runtime enforcement (may wrap across lines in the prompt text).
      expect(prompt).toMatch(/ripgrep-based parity\s+check/);
      // The gate now has a recovery loop instead of an immediate halt —
      // the prompt explains the loop so authors know FAILs aren't fatal.
      expect(prompt).toMatch(/parity-recovery loop/);
      expect(prompt).toContain("DEFERRED:");
    }
  });

  it("session plan rules document the optional (wire: `x`) field", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      // Mention the syntax and explain when to use it.
      expect(prompt).toMatch(/\(wire:\s*\\`x\\`\)/);
      expect(prompt).toContain("on-the-wire identifier");
      // Concrete example with the resolve_checkpoint/hitl-respond pair.
      expect(prompt).toMatch(/wire:\s*`hitl-respond`/);
    }
  });

  it("audit template includes the Dual-Side Implementation Verification section", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("Dual-Side Implementation Verification");
      expect(prompt).toContain("VERIFY caller");
      expect(prompt).toContain("VERIFY handler");
      expect(prompt).toContain("VERIFY handshake parity");
      expect(prompt).toContain("VERIFY real invocation");
      expect(prompt).toContain("handshake-parity.sh");
      // Tests-passing-on-mocks does not override a failure here
      expect(prompt).toContain("Tests passing on mocks do NOT override");
    }
  });

  it("audit pre-flight includes the stub scan", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("Stub scan");
      expect(prompt).toContain("until then");
      expect(prompt).toContain("NotImplementedError");
      expect(prompt).toContain("unknown action");
      expect(prompt).toContain("AUTOMATIC\n  FAIL");
    }
  });

  it("Phase 4 checklist includes the mock-disclosure rule", () => {
    for (const prompt of [NEW_APP_PROMPT, FEATURE_MODE_PROMPT]) {
      expect(prompt).toContain("MOCK DISCLOSURE");
      expect(prompt).toContain("NON-mocked integration test");
      expect(prompt).toContain("Mocked tests are NOT sufficient evidence");
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
    expect(result).toContain("Do NOT use Write, Edit, Bash, NotebookEdit, or any file-modifying tool");
  });

  it("contains hard constraint about not running bash", () => {
    const result = buildClaudeCodePrompt("new_application", templateCatalog, "");
    expect(result).toContain("Do NOT run bash commands");
  });

  it("contains hard constraint about being a spec writer not implementer", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("You are a specification writer,\nnot an implementer");
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
    expect(result).toContain("IMMEDIATELY read structural files to understand the codebase using the Read tool");
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

  it("contains CODEBASE NAVIGATION rules in the wrapper", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("CODEBASE NAVIGATION");
    expect(result).toContain("NEVER ask the user to identify file locations");
  });

  it("contains HARD CONSTRAINTS section from the wrapper", () => {
    const result = buildClaudeCodePrompt("feature", templateCatalog, projectContext);
    expect(result).toContain("HARD CONSTRAINTS — INFRASTRUCTURE-ENFORCED:");
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

describe("renderEnvironmentPreamble (via buildClaudeCodePrompt)", () => {
  const templateCatalog = "t1: Next.js";
  const projectContext = "Demo project";

  function cap(id: string, status: "verified" | "absent" | "claimed-unverified"): import("../types/spec-writer").ProbedCapability {
    return {
      id,
      status,
      discoveredBy: "passive-probe",
      evidence: `synthetic ${id}`,
      lastVerifiedAt: "2026-05-19T00:00:00Z",
      verifyMethod: null,
      expires: null,
    };
  }
  function record(caps: import("../types/spec-writer").ProbedCapability[]): import("../types/spec-writer").ProjectCapabilitiesRecord {
    return {
      schemaVersion: 1,
      probedAt: "2026-05-19T00:00:00Z",
      probedByCliVersion: null,
      probedBySpecWriterVersion: null,
      capabilities: caps,
      stalenessWindow: "PT24H",
    };
  }

  it("emits a prefer/avoid section for cloud-only Supabase projects", () => {
    const result = buildClaudeCodePrompt(
      "feature",
      templateCatalog,
      projectContext,
      record([
        cap("db.supabase.local-stack", "absent"),
        cap("db.supabase-anon", "verified"),
      ]),
    );
    expect(result).toContain("Project environment");
    // Prefer side
    expect(result).toContain("supabase db push");
    // Avoid side — the Atikon-failure commands
    expect(result).toContain("supabase db reset");
    expect(result).toContain("psql -h localhost");
    expect(result).toContain("localhost:54322");
  });

  it("does not list 'avoid local commands' when local stack is present", () => {
    const result = buildClaudeCodePrompt(
      "feature",
      templateCatalog,
      projectContext,
      record([
        cap("db.supabase.local-stack", "verified"),
        cap("db.supabase-anon", "verified"),
      ]),
    );
    expect(result).toContain("Project environment");
    // No "avoid" section for local-stack commands when it's available.
    expect(result).not.toMatch(/Avoid \(local stack is NOT available/);
  });

  it("guides toward BrowserMCP when test runners are absent and BrowserMCP is verified", () => {
    const result = buildClaudeCodePrompt(
      "feature",
      templateCatalog,
      projectContext,
      record([
        cap("test-runner.any", "absent"),
        cap("browser-mcp", "verified"),
      ]),
    );
    expect(result).toContain("Test runners");
    expect(result).toContain("BrowserMCP");
    expect(result).toContain("browser_navigate");
  });

  it("suggests static evidence or DEFERRED when neither test runners nor BrowserMCP are available", () => {
    const result = buildClaudeCodePrompt(
      "feature",
      templateCatalog,
      projectContext,
      record([
        cap("test-runner.any", "absent"),
        cap("browser-mcp", "absent"),
      ]),
    );
    expect(result).toContain("Static evidence");
    expect(result).toContain("DEFERRED");
    // Avoid section listing the unavailable runners.
    expect(result).toMatch(/vitest.*jest.*playwright.*cypress|none of these/);
  });

  it("mentions the finalize safety net so the LLM knows missing tags will be inferred", () => {
    const result = buildClaudeCodePrompt(
      "feature",
      templateCatalog,
      projectContext,
      record([cap("db.supabase-anon", "verified")]),
    );
    expect(result).toContain("finalize pass");
  });

  it("omits the preamble when there are no capabilities", () => {
    const result = buildClaudeCodePrompt(
      "feature",
      templateCatalog,
      projectContext,
      null,
    );
    expect(result).not.toContain("Project environment");
  });
});
