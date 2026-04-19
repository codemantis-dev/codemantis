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

// ── Kind-suffix parsing ────────────────────────────────────────────────

describe("parseSessionPlan — VerifyCheck kind tags", () => {
  it("parses trailing [side-effect] and [behavioral] tags", () => {
    const s = `### Session 1: Infra
**Prompt for Claude Code:**
\`\`\`
Deploy things.
\`\`\`
**Verify before next session:**
- [ ] notes columns exist in migration file
- [ ] Migration applied on remote [side-effect]
- [ ] Tests pass for notes handler [behavioral]
- [ ] [side-effect] kb_versions backfilled

### Session 2: Polish
**Prompt for Claude Code:**
\`\`\`
Polish.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(s));
    expect(result).not.toBeNull();

    const checks = result!.sessions[0].verifyChecks;
    expect(checks).toHaveLength(4);

    // Plain line — kind undefined (default "static").
    expect(checks[0]).toEqual({ label: "notes columns exist in migration file" });

    // Trailing [side-effect] stripped off label.
    expect(checks[1]).toEqual({ label: "Migration applied on remote", kind: "side-effect" });

    // Trailing [behavioral] stripped off label.
    expect(checks[2]).toEqual({ label: "Tests pass for notes handler", kind: "behavioral" });

    // Leading [side-effect] also works.
    expect(checks[3]).toEqual({ label: "kb_versions backfilled", kind: "side-effect" });
  });

  it("treats explicit [static] tag as default (kind undefined)", () => {
    const s = `### Session 1: Foo
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`
**Verify before next session:**
- [ ] something [static]

### Session 2: Bar
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(s));
    expect(result!.sessions[0].verifyChecks[0]).toEqual({ label: "something" });
  });

  it("case-insensitive tag recognition", () => {
    const s = `### Session 1: Foo
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`
**Verify before next session:**
- [ ] migration deployed [SIDE-EFFECT]
- [ ] suite green [Behavioral]

### Session 2: Bar
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(s));
    expect(result!.sessions[0].verifyChecks[0].kind).toBe("side-effect");
    expect(result!.sessions[0].verifyChecks[1].kind).toBe("behavioral");
  });

  it("parses [integration] kind tags (trailing, leading, case-insensitive)", () => {
    const s = `### Session 1: Cross-system
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`
**Verify before next session:**
- [ ] caller writes action + handler accepts it [integration]
- [ ] [integration] insert_note_probe end-to-end
- [ ] upload pipeline end-to-end [INTEGRATION]

### Session 2: Polish
**Prompt for Claude Code:**
\`\`\`
Polish.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(s));
    expect(result).not.toBeNull();
    const checks = result!.sessions[0].verifyChecks;
    expect(checks).toHaveLength(3);
    expect(checks[0]).toEqual({
      label: "caller writes action + handler accepts it",
      kind: "integration",
    });
    expect(checks[1]).toEqual({
      label: "insert_note_probe end-to-end",
      kind: "integration",
    });
    expect(checks[2].kind).toBe("integration");
  });
});

describe("parseSessionPlan — Cross-system actions block", () => {
  it("parses the **Cross-system actions introduced:** block", () => {
    const s = `### Session 1: Notes pipeline
**Scope:** implement note insert calls
**Files:**
- \`workers/notes/notes_write.py\` (create)

**Cross-system actions introduced:**
- action: \`insert_note_classification\` → handler: \`supabase/functions/worker-data-write/actions/notes.py::handle_insert_note_classification\`
- action: \`insert_note_probe\` → handler: \`supabase/functions/worker-data-write/actions/notes.py\`

**Prompt for Claude Code:**
\`\`\`
Implement writer calls.
\`\`\`

**Verify before next session:**
- [ ] caller + handler present [integration]

### Session 2: Polish
**Prompt for Claude Code:**
\`\`\`
Polish.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(s));
    expect(result).not.toBeNull();

    const actions = result!.sessions[0].crossSystemActions;
    expect(actions).toBeDefined();
    expect(actions).toHaveLength(2);
    expect(actions![0]).toEqual({
      action: "insert_note_classification",
      handler:
        "supabase/functions/worker-data-write/actions/notes.py::handle_insert_note_classification",
    });
    expect(actions![1]).toEqual({
      action: "insert_note_probe",
      handler: "supabase/functions/worker-data-write/actions/notes.py",
    });

    // Absent block on session 2 → undefined (not [])
    expect(result!.sessions[1].crossSystemActions).toBeUndefined();
  });

  it("supports the shorter `action` → `handler` form without labels", () => {
    const s = `### Session 1: Notes
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`

**Cross-system actions introduced:**
- \`emit_audit_log\` → \`services/audit/sink.ts\`
- \`record_metric\` → \`services/metrics/consumer.ts::recordMetric\`

**Verify before next session:**
- [ ] paired [integration]

### Session 2: Polish
**Prompt for Claude Code:**
\`\`\`
Polish.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(s));
    const actions = result!.sessions[0].crossSystemActions;
    expect(actions).toEqual([
      { action: "emit_audit_log", handler: "services/audit/sink.ts" },
      { action: "record_metric", handler: "services/metrics/consumer.ts::recordMetric" },
    ]);
  });
});

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
    expect(s1.verifyChecks).toEqual([
      { label: "pnpm tsc --noEmit passes" },
      { label: "Tests pass" },
    ]);
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
    expect(result!.sessions[1].verifyChecks[0].label).toContain("Run Verification Audit:");
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
    expect(
      result!.sessions[0].verifyChecks.some(
        (c) => c.label === "User model exists with correct fields",
      ),
    ).toBe(true);

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
