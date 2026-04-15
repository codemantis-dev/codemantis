import { describe, it, expect } from "vitest";
import { parseSessionPlan } from "./parse-session-plan";

// ── Helpers ──────────────────────────────────────────────────────────

function makeSpec(sessionPlanContent: string, title = "Gradum Model Studio"): string {
  return `# ${title} — Requirements Specification

## 1. Overview
This is a test spec.

## 9. Implementation Checklist
- [ ] Item 1

## 10. Session Plan
${sessionPlanContent}

## 11. Open Questions & Assumptions
None.
`;
}

function makeSession(index: number, opts: {
  name?: string;
  scope?: string;
  readSections?: string;
  files?: string[];
  prompt?: string;
  verifyChecks?: string[];
} = {}): string {
  const name = opts.name ?? `Session ${index} Feature`;
  const scope = opts.scope ?? `Phase ${index}`;
  const readSections = opts.readSections ?? `Sections ${index}, ${index + 1}`;
  const files = opts.files ?? [`src/file${index}.ts`];
  const prompt = opts.prompt ?? `Implement phase ${index} of the spec.`;
  const verifyChecks = opts.verifyChecks ?? [`pnpm tsc --noEmit passes`, `Tests pass`];

  let s = `### Session ${index}: ${name} (~${files.length} files)\n`;
  s += `**Scope:** ${scope}\n`;
  s += `**Read sections:** ${readSections}\n`;
  s += `**Files:**\n`;
  for (const f of files) {
    s += `- \`${f}\` (create)\n`;
  }
  s += `\n**Prompt for Claude Code:**\n`;
  s += "```\n";
  s += prompt + "\n";
  s += "```\n";
  s += `\n**Verify before next session:**\n`;
  for (const c of verifyChecks) {
    s += `- [ ] ${c}\n`;
  }
  return s;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("parseSessionPlan", () => {
  it("parses a well-formed 5-session plan with all fields", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession(i + 1, {
        name: `Feature ${i + 1}`,
        files: [`src/a${i}.ts`, `src/b${i}.ts`],
      }),
    );
    const spec = makeSpec(sessions.join("\n"));
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Gradum Model Studio");
    expect(result!.sessions).toHaveLength(5);

    const s1 = result!.sessions[0];
    expect(s1.index).toBe(1);
    expect(s1.name).toBe("Feature 1");
    expect(s1.scope).toBe("Phase 1");
    expect(s1.readSections).toBe("Sections 1, 2");
    expect(s1.files).toEqual(["src/a0.ts", "src/b0.ts"]);
    expect(s1.prompt).toBe("Implement phase 1 of the spec.");
    expect(s1.verifyChecks).toEqual(["pnpm tsc --noEmit passes", "Tests pass"]);
  });

  it("parses a minimal plan with only prompts (soft fields missing)", () => {
    const content = `
### Session 1: Foundation
**Prompt for Claude Code:**
\`\`\`
Do step 1.
\`\`\`

### Session 2: Features
**Prompt for Claude Code:**
\`\`\`
Do step 2.
\`\`\`
`;
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].name).toBe("Foundation");
    expect(result!.sessions[0].scope).toBe("");
    expect(result!.sessions[0].readSections).toBe("");
    expect(result!.sessions[0].files).toEqual([]);
    expect(result!.sessions[0].prompt).toBe("Do step 1.");
    expect(result!.sessions[0].verifyChecks).toEqual([]);
  });

  it("returns null when prompt block is missing from session 3", () => {
    const s1 = makeSession(1);
    const s2 = makeSession(2);
    // Session 3 has no prompt block
    const s3 = `### Session 3: Broken Session
**Scope:** Phase 3
**Verify before next session:**
- [ ] Something
`;
    const spec = makeSpec(s1 + s2 + s3);
    const result = parseSessionPlan(spec);

    expect(result).toBeNull();
  });

  it("returns null when there is no Session Plan section", () => {
    const spec = `# My App — Requirements Specification

## 1. Overview
This is a test spec.

## 9. Implementation Checklist
- [ ] Build it

## 10. Open Questions
None.
`;
    const result = parseSessionPlan(spec);
    expect(result).toBeNull();
  });

  it("returns null for malformed spec title heading", () => {
    const spec = `# Just A Title

## Session Plan
${makeSession(1)}
${makeSession(2)}
`;
    const result = parseSessionPlan(spec);
    expect(result).toBeNull();
  });

  it("returns null for a single-session plan", () => {
    const spec = makeSpec(makeSession(1));
    const result = parseSessionPlan(spec);
    expect(result).toBeNull();
  });

  it("handles extra whitespace and missing (~N files) in heading", () => {
    const content = `
### Session 1:   Database Setup
**Scope:** Phase 1
**Prompt for Claude Code:**
\`\`\`
Set up the database.
\`\`\`

### Session 2: API Layer
**Prompt for Claude Code:**
\`\`\`
Build the API.
\`\`\`
`;
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions[0].name).toBe("Database Setup");
    expect(result!.sessions[1].name).toBe("API Layer");
  });

  it("handles Session Plan section without numbered prefix", () => {
    const spec = `# Cool App — Requirements Specification

## Overview
Stuff.

## Session Plan
${makeSession(1)}
${makeSession(2)}

## Open Questions
None.
`;
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
  });

  it("extracts files without backticks and with (modify) suffix", () => {
    const content = `
### Session 1: Setup
**Files:**
- \`src/app.ts\` (create)
- src/config.ts (modify)
- \`src/utils.ts\`

**Prompt for Claude Code:**
\`\`\`
Do things.
\`\`\`

### Session 2: More
**Prompt for Claude Code:**
\`\`\`
More things.
\`\`\`
`;
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions[0].files).toEqual([
      "src/app.ts",
      "src/config.ts",
      "src/utils.ts",
    ]);
  });

  it("handles multi-line prompt in fenced code block", () => {
    const content = `
### Session 1: Foundation
**Prompt for Claude Code:**
\`\`\`
Implement the database layer:
- Create the schema in src/db/schema.ts
- Add migration in src/db/migrations/001.ts
- Write seed data in src/db/seed.ts

Do NOT proceed to the API layer.
\`\`\`

### Session 2: API
**Prompt for Claude Code:**
\`\`\`
Build API.
\`\`\`
`;
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions[0].prompt).toContain("Implement the database layer:");
    expect(result!.sessions[0].prompt).toContain("Do NOT proceed to the API layer.");
  });

  it("handles audit-style verify block in last session", () => {
    const s1 = makeSession(1);
    const s2 = `### Session 2: Polish
**Prompt for Claude Code:**
\`\`\`
Polish everything.
\`\`\`

**Verify (full audit):**
\`\`\`
Run the full verification audit against the spec.
Check all error states and loading states.
\`\`\`
`;
    const spec = makeSpec(s1 + s2);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions[1].verifyChecks).toHaveLength(1);
    expect(result!.sessions[1].verifyChecks[0]).toContain("Run Verification Audit:");
  });

  it("handles Feature Specification title format", () => {
    const spec = `# User Authentication — Feature Specification

## 9. Implementation Checklist
- [ ] Do things

## 10. Session Plan
${makeSession(1, { name: "Auth Setup" })}
${makeSession(2, { name: "Auth UI" })}
`;
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.title).toBe("User Authentication");
  });

  it("handles Implementation Plan title format", () => {
    const spec = `# Multi-Step Document Generation — Implementation Plan

## 10. Session Plan
${makeSession(1, { name: "Database Schema" })}
${makeSession(2, { name: "Edge Functions" })}
`;
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Multi-Step Document Generation");
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].name).toBe("Database Schema");
  });

  it("handles Implementation Specification title format", () => {
    const spec = `# Auth Overhaul — Implementation Specification

## Session Plan
${makeSession(1, { name: "Phase 1" })}
${makeSession(2, { name: "Phase 2" })}
`;
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Auth Overhaul");
  });

  it("finds sessions without a ## Session Plan wrapper heading", () => {
    const spec = `# Pipeline Upgrade — Implementation Plan

## Architecture Overview
Some context about the architecture.

## Data Layer Contract
Some data layer details.

### Session 1: Database Schema
**Scope:** Create tables
**Read sections:** Section 3
**Files:**
- \`migrations/001.sql\` (create)

**Prompt for Claude Code:**
\`\`\`
Create the migration files.
\`\`\`

**Verify before next session:**
- [ ] Tables exist

### Session 2: Edge Functions
**Scope:** Extend APIs
**Files:**
- \`functions/read.ts\` (modify)

**Prompt for Claude Code:**
\`\`\`
Add new actions to the edge functions.
\`\`\`

### Session 3: Worker Code
**Scope:** Implement pipeline
**Files:**
- \`worker/pipeline.py\` (modify)

**Prompt for Claude Code:**
\`\`\`
Implement the multi-step pipeline.
\`\`\`
`;
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Pipeline Upgrade");
    expect(result!.sessions).toHaveLength(3);
    expect(result!.sessions[0].name).toBe("Database Schema");
    expect(result!.sessions[0].scope).toBe("Create tables");
    expect(result!.sessions[0].files).toEqual(["migrations/001.sql"]);
    expect(result!.sessions[1].name).toBe("Edge Functions");
    expect(result!.sessions[2].name).toBe("Worker Code");
  });

  it("handles prompt with language-tagged fenced code block", () => {
    const content = `
### Session 1: Setup
**Prompt for Claude Code:**
\`\`\`text
Set up the project foundation.
\`\`\`

### Session 2: Build
**Prompt for Claude Code:**
\`\`\`markdown
Build the features.
\`\`\`
`;
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions[0].prompt).toBe("Set up the project foundation.");
    expect(result!.sessions[1].prompt).toBe("Build the features.");
  });

  it("extracts optional verification prompt from a session", () => {
    const content = `
### Session 1: Database Schema (~3 files)
**Scope:** Create entity tables
**Read sections:** Section 2
**Files:**
- \`src/models/user.ts\` (create)

**Prompt for Claude Code:**
\`\`\`
Create the User model with name, email, role fields.
\`\`\`

**Verification Prompt:**
\`\`\`
Verify Session 1: Database Schema.

1. Open \`src/models/user.ts\`
   - VERIFY: User model exports interface with name, email, role
   - NOT EXPECTED: role is plain string (should be enum)

2. Run \`pnpm tsc --noEmit\`
   - VERIFY: Zero type errors
\`\`\`

**Verify before next session:**
- [ ] User model exists with correct fields
- [ ] TypeScript compiles

### Session 2: API Routes (~2 files)
**Scope:** Create REST endpoints
**Files:**
- \`src/routes/users.ts\` (create)

**Prompt for Claude Code:**
\`\`\`
Create CRUD routes for User.
\`\`\`

**Verify before next session:**
- [ ] Routes respond correctly
`;
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);

    // Session 1 has a verification prompt
    expect(result!.sessions[0].verificationPrompt).not.toBeNull();
    expect(result!.sessions[0].verificationPrompt).toContain(
      "VERIFY: User model exports",
    );
    expect(result!.sessions[0].verificationPrompt).toContain("NOT EXPECTED:");
    // The existing manual verify checklist is still parsed
    expect(result!.sessions[0].verifyChecks).toContain(
      "User model exists with correct fields",
    );

    // Session 2 does not
    expect(result!.sessions[1].verificationPrompt).toBeNull();
  });

  it("parses sessions correctly when no verification prompts exist (backward compat)", () => {
    const content = Array.from({ length: 3 }, (_, i) =>
      makeSession(i + 1),
    ).join("\n\n");
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(3);

    for (const session of result!.sessions) {
      expect(session.verificationPrompt).toBeNull();
    }
  });

  it("extracts verification prompt with language-tagged fence", () => {
    const content = `
### Session 1: Setup
**Prompt for Claude Code:**
\`\`\`
Do setup.
\`\`\`

**Verification Prompt:**
\`\`\`text
Verify Session 1.

1. Open \`src/app.ts\`
   - VERIFY: app boots
\`\`\`

**Verify before next session:**
- [ ] App runs

### Session 2: Build
**Prompt for Claude Code:**
\`\`\`
Build feature.
\`\`\`
`;
    const spec = makeSpec(content);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    expect(result!.sessions[0].verificationPrompt).toContain(
      "Verify Session 1.",
    );
    expect(result!.sessions[0].verificationPrompt).toContain(
      "VERIFY: app boots",
    );
    expect(result!.sessions[1].verificationPrompt).toBeNull();
  });
});
