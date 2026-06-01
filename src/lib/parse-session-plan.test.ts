import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSessionPlan,
  diagnoseSessionPlanFailure,
  deriveSessionName,
  stripSessionPrefix,
  formatSessionLabel,
  isSelfReferentialName,
} from "./parse-session-plan";

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

  it("leaves `wire` undefined on rows with no wire field — backward compatible", () => {
    const s = `### Session 1: A
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`

**Cross-system actions introduced:**
- action: \`insert_note\` → handler: \`functions/notes.py\`

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
    expect(actions).toHaveLength(1);
    expect(actions![0]).toEqual({
      action: "insert_note",
      handler: "functions/notes.py",
    });
    expect(actions![0].wire).toBeUndefined();
  });

  it("captures the optional inline (wire: `x`) field between action and arrow", () => {
    const s = `### Session 1: A
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`

**Cross-system actions introduced:**
- action: \`resolve_checkpoint\` (wire: \`hitl-respond\`) → handler: \`functions/hitl-respond/index.ts::resolveCheckpoint\`

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
    expect(actions).toHaveLength(1);
    expect(actions![0]).toEqual({
      action: "resolve_checkpoint",
      handler: "functions/hitl-respond/index.ts::resolveCheckpoint",
      wire: "hitl-respond",
    });
  });

  it("ignores a malformed wire token and still parses action + handler", () => {
    // The parenthetical is parsed separately for `wire:`; a malformed
    // token (no colon, no backticked value) degrades gracefully — the row
    // is still captured with wire undefined rather than being dropped.
    const s = `### Session 1: A
**Prompt for Claude Code:**
\`\`\`
Do.
\`\`\`

**Cross-system actions introduced:**
- action: \`foo\` (wire ) → handler: \`bar.ts\`

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
    expect(actions).toHaveLength(1);
    expect(actions![0]).toEqual({ action: "foo", handler: "bar.ts" });
    expect(actions![0].wire).toBeUndefined();
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

  it("accepts any H1 as title when a valid session plan is present", () => {
    const spec = `# Just A Title

## Session Plan
${makeSession(1)}
${makeSession(2)}
`;
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Just A Title");
    expect(result!.sessions).toHaveLength(2);
  });

  it("keeps descriptive em-dash suffix that is not a known kind label", () => {
    // Regression for _examples/specloom-workbench-catch.md — SpecWriter
    // occasionally emits a descriptive suffix instead of "— Specification".
    // The parser must still recognize the spec as a multi-session plan.
    const spec = `# SpecLoom Workbench Catch-up — Unbreak, Close the Loop, Reconcile

## 10. Session Plan
${makeSession(1)}
${makeSession(2)}
${makeSession(3)}
`;
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    expect(result!.title).toBe(
      "SpecLoom Workbench Catch-up — Unbreak, Close the Loop, Reconcile",
    );
    expect(result!.sessions).toHaveLength(3);
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

  // ── Phase-block tolerance (regression for "Could not find a multi-session
  // plan" when the LLM puts substance under ### Phase N: in §9 and reduces
  // ## 10 Session Plan to a Phase→Session reference table) ────────────────

  it("parses ### Phase N: blocks when ## Session Plan is just a reference table", () => {
    const phaseBody = (n: number) => `### Phase ${n}: Feature ${n} (~3 files)
**Scope:** Implementation step ${n}
**Files:**
- \`src/feature${n}.ts\` (create)

**Prompt for Claude Code:**
\`\`\`
Implement feature ${n}.
\`\`\`

**Verify before next session:**
- [ ] feature ${n} works
`;
    const spec = `# Drift Test — Implementation Plan

## 9. Implementation Checklist

${phaseBody(1)}
${phaseBody(2)}
${phaseBody(3)}

## 10. Session Plan

| Session | Phase | ~Files | Key deliverable |
|---|---|---|---|
| 1 | Phase 1 — Feature 1 | 3 | feature 1 |
| 2 | Phase 2 — Feature 2 | 3 | feature 2 |
| 3 | Phase 3 — Feature 3 | 3 | feature 3 |

## 11. Open Questions
None.
`;
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Drift Test");
    expect(result!.sessions).toHaveLength(3);
    expect(result!.sessions[0].name).toBe("Feature 1");
    expect(result!.sessions[0].prompt).toBe("Implement feature 1.");
    expect(result!.sessions[2].files).toEqual(["src/feature3.ts"]);
  });

  it("skips Phase 0 (gate) and [DEFER] phases when scanning ### Phase blocks", () => {
    const spec = `# Defer Test — Implementation Plan

## 9. Implementation Checklist

### Phase 0: Pre-Implementation Verification (GATE — MANDATORY)

Run every check below before starting Phase 1.

- [ ] Confirm A
- [ ] Confirm B

### Phase 1: Foundation (~2 files)
**Files:**
- \`src/a.ts\` (create)

**Prompt for Claude Code:**
\`\`\`
Implement A.
\`\`\`

### Phase 2: Build (~2 files)
**Files:**
- \`src/b.ts\` (create)

**Prompt for Claude Code:**
\`\`\`
Implement B.
\`\`\`

### Phase 3: Polish \`[DEFER]\`

**Scope:** Future polish work, not in current cycle.

## 10. Session Plan

| Session | Phase | Notes |
|---|---|---|
| 1 | Phase 1 | Foundation |
| 2 | Phase 2 | Build |
`;
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    // Phase 0 (gate) and Phase 3 [DEFER] are excluded; only 1, 2 kept.
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].name).toBe("Foundation");
    expect(result!.sessions[1].name).toBe("Build");
    // Indices renumber contiguously (no gaps shown to the user).
    expect(result!.sessions[0].index).toBe(1);
    expect(result!.sessions[1].index).toBe(2);
  });

  it("AFL v2 example regression — parses 6 sessions from Phase blocks (Phase 0 gate + Phase 7 DEFER excluded)", () => {
    const aflPath = resolve(
      __dirname,
      "../../_examples/specloom-active-feedback-loop-afl-v2.md",
    );
    const aflMarkdown = readFileSync(aflPath, "utf8");
    const result = parseSessionPlan(aflMarkdown);

    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(6);
    expect(result!.sessions[0].name).toBe("Identity Foundation");
    expect(result!.sessions[5].name).toContain("Principles");
    // Each kept phase must have a real Prompt for Claude Code.
    for (const s of result!.sessions) {
      expect(s.prompt.length).toBeGreaterThan(50);
    }
  });

  // ── Audit wrap-up tolerance (regression: parser used to abort the entire
  // guide if any single Session lacked a Prompt for Claude Code, even when
  // it was clearly an audit-style wrap-up like Session 9 in
  // _examples/specloom-saas-multi.md) ────────────────────────────────────

  it("skips a final Session that has only a **Verify (full audit):** block (no implementation prompt)", () => {
    const s1 = makeSession(1);
    const s2 = makeSession(2);
    const wrapUp = `### Session 3: Polish + Full Audit (~0 new files)
**Scope:** Full regression sweep, then run the full verification audit.

**Verify (full audit):**
\`\`\`
Read docs/specs/foo.audit.md and run the full audit.
\`\`\`
`;
    const spec = makeSpec(s1 + s2 + wrapUp);
    const result = parseSessionPlan(spec);

    expect(result).not.toBeNull();
    // Sessions 1 & 2 kept; the audit wrap-up is skipped, NOT an abort.
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions.map((s) => s.name)).toEqual([
      "Session 1 Feature",
      "Session 2 Feature",
    ]);
  });

  it("still aborts when a middle Session has neither Prompt nor Verify block", () => {
    const s1 = makeSession(1);
    // Session 2 is genuinely broken: no prompt, no verify.
    const s2 = `### Session 2: Broken Session
**Scope:** Phase 2
`;
    const s3 = makeSession(3);
    const spec = makeSpec(s1 + s2 + s3);
    const result = parseSessionPlan(spec);
    expect(result).toBeNull();
  });

  it("diagnoseSessionPlanFailure names the offending session number", () => {
    const s1 = makeSession(1);
    const s2 = `### Session 2: Broken Session
**Scope:** Phase 2
`;
    const s3 = makeSession(3);
    const spec = makeSpec(s1 + s2 + s3);
    const reason = diagnoseSessionPlanFailure(spec);
    expect(reason).toMatch(/Session 2/);
    expect(reason).toMatch(/Prompt for Claude Code/);
  });

  it("recognizes the exact `## 10. Session Plan — Multi-Session Implementation Breakdown` heading", () => {
    const spec = `# SaaS Multi-Tenancy — Feature Specification

## 1. Overview
Stuff.

## 10. Session Plan — Multi-Session Implementation Breakdown
${makeSession(1)}
${makeSession(2)}

## 11. Open Questions
None.
`;
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("SaaS Multi-Tenancy");
    expect(result!.sessions).toHaveLength(2);
  });

  it("recognizes the specloom-saas-multi.md fixture (8 sessions, audit wrap-up skipped)", () => {
    const fixturePath = resolve(
      __dirname,
      "../../_examples/specloom-saas-multi.md",
    );
    const markdown = readFileSync(fixturePath, "utf8");
    const result = parseSessionPlan(markdown);

    expect(result).not.toBeNull();
    // Section 10 has 9 ### Session blocks; Session 9 is an audit-style
    // wrap-up with no Prompt for Claude Code, so it's skipped.
    expect(result!.sessions).toHaveLength(8);
    expect(result!.sessions[0].name).toBe(
      "Database Foundation",
    );
    // Each kept session has a real implementation prompt.
    for (const s of result!.sessions) {
      expect(s.prompt.length).toBeGreaterThan(50);
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

// ── Session-name fallback derivation ──────────────────────────────────
//
// Regression guard for the "Session N: Session N" bug: when the LLM emits a
// `### Session N` heading without a descriptive title, the parser must derive
// one from Scope / Files / Prompt instead of parroting the index back. The
// UI label, log entries, auto-commit message, and verify prompt all flow off
// of this — so the test surface lives next to the parser.

function makeHeadlessSession(
  index: number,
  body: {
    scope?: string;
    files?: string[];
    prompt?: string;
  },
): string {
  let s = `### Session ${index} (~${(body.files ?? []).length} files)\n`;
  if (body.scope) s += `**Scope:** ${body.scope}\n`;
  if (body.files && body.files.length > 0) {
    s += `**Files:**\n`;
    for (const f of body.files) s += `- \`${f}\` (create)\n`;
  }
  s += `\n**Prompt for Claude Code:**\n`;
  s += "```\n";
  s += (body.prompt ?? `Implement phase ${index}.`) + "\n";
  s += "```\n";
  s += `\n**Verify before next session:**\n`;
  s += `- [ ] pnpm tsc --noEmit passes\n`;
  s += `- [ ] Tests pass\n`;
  return s;
}

describe("parseSessionPlan — session name fallback derivation", () => {
  it("derives the name from **Scope:** when the heading has no title", () => {
    const spec = makeSpec(
      `${makeHeadlessSession(1, {
        scope:
          "Build the dashboard with a placeholder card grid and empty state.",
        files: ["src/pages/Dashboard.tsx"],
      })}\n${makeSession(2, { name: "Auth" })}`,
    );
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    const s1 = result!.sessions[0];
    expect(s1.name.toLowerCase()).toContain("build the dashboard");
    expect(s1.nameIsFallback).toBe(true);
    // Must not be the degenerate "Session 1" placeholder.
    expect(s1.name).not.toMatch(/^session\s*1$/i);
  });

  it("falls back to the first file basename when scope is missing", () => {
    const spec = makeSpec(
      `${makeHeadlessSession(1, {
        files: ["src/edge/tech-stack-edge-function.ts"],
      })}\n${makeSession(2, { name: "Wrap-up" })}`,
    );
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    const s1 = result!.sessions[0];
    expect(s1.name.toLowerCase()).toContain("tech");
    expect(s1.name).not.toMatch(/^session\s*1$/i);
    expect(s1.nameIsFallback).toBe(true);
  });

  it("derives the name from the first prompt line when scope + files are missing", () => {
    const spec = makeSpec(
      `${makeHeadlessSession(1, {
        prompt:
          "Wire up the proposal handoff workflow between worker and orchestrator.",
      })}\n${makeSession(2, { name: "Polish" })}`,
    );
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    const s1 = result!.sessions[0];
    expect(s1.name.toLowerCase()).toContain("proposal handoff");
    expect(s1.nameIsFallback).toBe(true);
  });

  it("treats `### Session N: Session N` as self-referential and re-derives", () => {
    // Build a heading whose title literally repeats the index.
    const body =
      "### Session 7: Session 7 (~1 files)\n" +
      "**Scope:** Add the rate-limiter middleware to the gateway.\n" +
      "**Files:**\n- `src/gateway/rate-limiter.ts` (create)\n\n" +
      "**Prompt for Claude Code:**\n```\nDo it.\n```\n\n" +
      "**Verify before next session:**\n- [ ] tsc passes\n- [ ] tests pass\n";
    const spec = makeSpec(`${body}\n${makeSession(8, { name: "Polish" })}`);
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    const s = result!.sessions[0];
    expect(s.name).not.toMatch(/^session\s*7$/i);
    expect(s.name.toLowerCase()).toContain("rate-limiter");
    expect(s.nameIsFallback).toBe(true);
  });

  it("preserves descriptive names already in the heading", () => {
    const spec = makeSpec(
      `${makeSession(1, { name: "Database Foundation" })}\n${makeSession(2, {
        name: "Auth Setup",
      })}`,
    );
    const result = parseSessionPlan(spec);
    expect(result).not.toBeNull();
    expect(result!.sessions[0].name).toBe("Database Foundation");
    expect(result!.sessions[0].nameIsFallback).toBeUndefined();
    expect(result!.sessions[1].name).toBe("Auth Setup");
  });
});

describe("session-label helpers", () => {
  it("deriveSessionName clamps long scope sentences to a single clause", () => {
    const out = deriveSessionName(
      "Add the tech-stack edge function with get/update_fields/lock/relock actions; also write tests.",
      [],
      "",
    );
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain("tech-stack edge function");
    // Should drop everything after the first `;`.
    expect(out).not.toContain("write tests");
  });

  it("deriveSessionName turns a kebab filename into a Title Case phrase", () => {
    const out = deriveSessionName("", ["src/orchestrator/proposal-trigger.ts"], "");
    expect(out).toBe("Proposal Trigger");
  });

  it("deriveSessionName appends a +N suffix for multi-file sessions", () => {
    const out = deriveSessionName(
      "",
      ["src/worker/proposal-stage.ts", "src/worker/index.ts", "src/types/stage.ts"],
      "",
    );
    expect(out).toMatch(/^Proposal Stage \+2$/);
  });

  it("deriveSessionName returns empty when every source is blank", () => {
    expect(deriveSessionName("", [], "")).toBe("");
  });

  it("stripSessionPrefix peels a `Session N:` self-prefix off a name", () => {
    expect(stripSessionPrefix("Session 5: Session 5", 5)).toBe("");
    expect(stripSessionPrefix("Session 5", 5)).toBe("");
    expect(stripSessionPrefix("Session 5: Database Foundation", 5)).toBe(
      "Database Foundation",
    );
    expect(stripSessionPrefix("Database Foundation", 5)).toBe("Database Foundation");
    expect(stripSessionPrefix("", 5)).toBe("");
    expect(stripSessionPrefix(null, 5)).toBe("");
  });

  it("formatSessionLabel never emits the duplicated `Session N: Session N` form", () => {
    expect(formatSessionLabel(1, "Session 1")).toBe("Session 1");
    expect(formatSessionLabel(1, "Session 1: Session 1")).toBe("Session 1");
    expect(formatSessionLabel(1, "")).toBe("Session 1");
    expect(formatSessionLabel(1, null)).toBe("Session 1");
    expect(formatSessionLabel(7, "Rate Limiter")).toBe("Session 7: Rate Limiter");
    expect(formatSessionLabel(7, "Session 7: Rate Limiter")).toBe(
      "Session 7: Rate Limiter",
    );
  });

  it("isSelfReferentialName flags `Session N`-style placeholders", () => {
    expect(isSelfReferentialName("Session 3", 3)).toBe(true);
    expect(isSelfReferentialName("session 3", 3)).toBe(true);
    expect(isSelfReferentialName("Session 03", 3)).toBe(true);
    expect(isSelfReferentialName("Session 3:", 3)).toBe(true);
    expect(isSelfReferentialName("Session 3: Session 3", 3)).toBe(true);
    expect(isSelfReferentialName("Database Foundation", 3)).toBe(false);
    expect(isSelfReferentialName("", 3)).toBe(true);
    expect(isSelfReferentialName(null, 3)).toBe(true);
  });
});

// ── Resilience: suffix sub-sessions, wrapper headings, fence/casing
// variations — regression for the juliam-twin-v1-2-enhancement.md class
// of spec where `### Session 1:` is a parent wrapper for `### Session 1a:`,
// `### Session 1b:`, `### Session 1c:`. ────────────────────────────────

describe("parseSessionPlan — sub-session suffix resilience", () => {
  it("parses suffix-numbered sub-sessions (1a, 1b, 1c) as independent sessions", () => {
    const content = `
### Session 1a: Migrations
**Prompt for Claude Code:**
\`\`\`
Migrations step.
\`\`\`

### Session 1b: Edge functions
**Prompt for Claude Code:**
\`\`\`
Edge fn step.
\`\`\`

### Session 1c: Deploy
**Prompt for Claude Code:**
\`\`\`
Deploy step.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(3);
    expect(result!.sessions.map((s) => s.name)).toEqual([
      "Migrations",
      "Edge functions",
      "Deploy",
    ]);
    expect(result!.sessions.map((s) => s.prompt)).toEqual([
      "Migrations step.",
      "Edge fn step.",
      "Deploy step.",
    ]);
  });

  it("skips a `### Session N:` wrapper that carries an explicit **Indivisible note:**", () => {
    const content = `
### Session 1: MS365 connection state fix (~7 files)

**Indivisible note:** This session is split into three suffix-numbered sub-sessions (1a / 1b / 1c) per the size ceiling. Sessions 1a–1c collectively deliver C1.

**User-visible outcome:** (foundation)

### Session 1a: Migrations
**Prompt for Claude Code:**
\`\`\`
Migrations step.
\`\`\`

### Session 1b: Functions
**Prompt for Claude Code:**
\`\`\`
Functions step.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].name).toBe("Migrations");
    expect(result!.sessions[1].name).toBe("Functions");
  });

  it("structurally skips a `### Session N:` wrapper followed by `### Session Na:` even WITHOUT the Indivisible-note marker", () => {
    // Resilience case: LLM forgot the marker but the structural pattern
    // is unambiguous — parent w/o prompt immediately shadowed by child 1a.
    const content = `
### Session 1: Wrapper without marker

Just a paragraph here, no prompt block, no Indivisible note line.

### Session 1a: First child
**Prompt for Claude Code:**
\`\`\`
First child work.
\`\`\`

### Session 1b: Second child
**Prompt for Claude Code:**
\`\`\`
Second child work.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].name).toBe("First child");
  });

  it("preserves the spec's full `Na`-style label in the diagnose error message", () => {
    // Sub-session whose own prompt is missing should be named "Session 1b",
    // not "Session 1" (which would point at the wrong block). The fixture
    // needs at least two prompted sessions so we reach the offending-session
    // branch instead of the "only one usable session" early-out.
    const content = `
### Session 1a: First child
**Prompt for Claude Code:**
\`\`\`
First child work.
\`\`\`

### Session 1b: Second child — accidentally has no prompt
**Scope:** Phase 1b

### Session 2: Real session
**Prompt for Claude Code:**
\`\`\`
Real work.
\`\`\`
`;
    const reason = diagnoseSessionPlanFailure(makeSpec(content));
    expect(reason).toMatch(/Session 1b\b/);
    expect(reason).toMatch(/Prompt for Claude Code/);
    expect(reason).toMatch(/Indivisible note/);
  });

  it("parses dotted (1.1) and dashed (1-1) sub-session numbering", () => {
    const content = `
### Session 1.1: Dotted child
**Prompt for Claude Code:**
\`\`\`
Dotted work.
\`\`\`

### Session 1-2: Dashed child
**Prompt for Claude Code:**
\`\`\`
Dashed work.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions.map((s) => s.name)).toEqual([
      "Dotted child",
      "Dashed child",
    ]);
  });

  it("treats `### Session 1:` with its OWN prompt as a real session, not a wrapper, even when 1a follows", () => {
    // Edge case: the parent both has a prompt AND is followed by 1a. The
    // parent stays — only marker-less wrappers without prompts get skipped.
    const content = `
### Session 1: Standalone parent
**Prompt for Claude Code:**
\`\`\`
Parent work.
\`\`\`

### Session 1a: Follow-up
**Prompt for Claude Code:**
\`\`\`
Follow-up work.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].prompt).toBe("Parent work.");
  });
});

describe("parseSessionPlan — fence + casing tolerance", () => {
  it("accepts ~~~ as a fence in addition to ```", () => {
    const content = `
### Session 1: Tilde fence
**Prompt for Claude Code:**
~~~
Tilde-fenced prompt.
~~~

### Session 2: Backtick fence
**Prompt for Claude Code:**
\`\`\`
Backtick-fenced prompt.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].prompt).toBe("Tilde-fenced prompt.");
  });

  it("tolerates blank lines and `**Prompt for Claude Code**:` colon-outside-bold", () => {
    const content = `
### Session 1: Loose label
**Prompt for Claude Code**:

\`\`\`
Loose label still works.
\`\`\`

### Session 2: Tight label
**Prompt for Claude Code:**
\`\`\`
Tight label too.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0].prompt).toBe("Loose label still works.");
  });

  it("accepts H4 (####) Session headings as well as H3", () => {
    const content = `
#### Session 1: H4 heading
**Prompt for Claude Code:**
\`\`\`
H4 work.
\`\`\`

#### Session 2: Another H4
**Prompt for Claude Code:**
\`\`\`
More H4 work.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
  });

  it("accepts zero-padded session numbers (Session 01, Session 02)", () => {
    const content = `
### Session 01: Padded one
**Prompt for Claude Code:**
\`\`\`
First.
\`\`\`

### Session 02: Padded two
**Prompt for Claude Code:**
\`\`\`
Second.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    expect(result!.sessions).toHaveLength(2);
  });
});

describe("parseSessionPlan — juliam-twin-v1-2 wrapper regression", () => {
  it("recognises a Session Plan that mixes wrapper headings, suffix children, audit wrap-up, and indivisible notes", () => {
    // Microcosm of the user's juliam-twin-v1-2-enhancement.md scenario:
    // wrapped Session 1 → 1a/1b/1c; plain Sessions 2 & 3; wrapped Session 4
    // → 4a/4b; final Session 5 is an audit wrap-up.
    const content = `
### Session 1: MS365 connection state fix (~7 files)

**Indivisible note:** Split into 1a / 1b / 1c.

### Session 1a: Migrations
**Prompt for Claude Code:**
\`\`\`
Migrations step.
\`\`\`

### Session 1b: Functions
**Prompt for Claude Code:**
\`\`\`
Functions step.
\`\`\`

### Session 1c: Deploy
**Prompt for Claude Code:**
\`\`\`
Deploy step.
\`\`\`

### Session 2: Onboarding decouple
**Prompt for Claude Code:**
\`\`\`
Onboarding work.
\`\`\`

### Session 3: User-self identity
**Prompt for Claude Code:**
\`\`\`
Identity work.
\`\`\`

### Session 4: Sender intent (~7 files)

**Indivisible note:** Split into 4a / 4b.

### Session 4a: Migration
**Prompt for Claude Code:**
\`\`\`
Migration.
\`\`\`

### Session 4b: UI
**Prompt for Claude Code:**
\`\`\`
UI.
\`\`\`

### Session 5: Full-spec verification audit
**Verify (full audit):**
\`\`\`
Run the full audit.
\`\`\`
`;
    const result = parseSessionPlan(makeSpec(content));
    expect(result).not.toBeNull();
    // 1a, 1b, 1c, 2, 3, 4a, 4b — wrappers skipped, audit wrap-up skipped.
    expect(result!.sessions).toHaveLength(7);
    expect(result!.sessions.map((s) => s.name)).toEqual([
      "Migrations",
      "Functions",
      "Deploy",
      "Onboarding decouple",
      "User-self identity",
      "Migration",
      "UI",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// webcreator-v2 regression: Session 1 is structurally complete (Scope +
// Files + Verification Prompt) but Sonnet forgot the `**Prompt for Claude
// Code:**` fence label. Today the parser aborts the entire 13-session
// guide on this single omission. That hard-reject is the gatekeeper
// behaviour we've sworn off (see feedback_specwriter_senior_advisor in
// memory). Recovery happens one layer up in handleRecognizeGuide; the
// parser's job here is only to *report* the precise failure so the
// recovery prompt can be targeted.
//
// These tests pin the baseline so the AI-recovery integration test has
// something concrete to recover *from*.
// ─────────────────────────────────────────────────────────────────────────
describe("parseSessionPlan — webcreator-v2 missing-prompt baseline", () => {
  const fixturePath = resolve(__dirname, "__fixtures__/webcreator-v2-spec.md");
  const fixtureMarkdown = readFileSync(fixturePath, "utf8");

  it("returns null on the webcreator-v2 fixture (Session 1 has no Prompt for Claude Code fence)", () => {
    expect(parseSessionPlan(fixtureMarkdown)).toBeNull();
  });

  it("diagnose names Session 1 as the offender", () => {
    const reason = diagnoseSessionPlanFailure(fixtureMarkdown);
    expect(reason).toMatch(/Session 1\b/);
    expect(reason).toMatch(/Prompt for Claude Code/);
    // The advice surface mentions the three recovery markers the parser
    // already understands. Keep this assertion to catch accidental changes
    // to the human-facing copy that the toast surfaces.
    expect(reason).toMatch(/Verify \(full audit\)/);
    expect(reason).toMatch(/Indivisible note/);
  });

  it("every other Session in the fixture has a real Prompt for Claude Code", () => {
    // Sanity check: only Session 1 is broken. If a future drift makes
    // Session 2+ also drop their fences, the recovery test needs a
    // different fixture. Surface that immediately.
    const sessionHeadings = fixtureMarkdown.match(/^###\s+Session\s+\d+[a-z]?:/gm) ?? [];
    expect(sessionHeadings.length).toBeGreaterThan(10);
    const promptCount = (fixtureMarkdown.match(/\*\*Prompt for Claude Code:\*\*/g) ?? []).length;
    // 13 declared sessions, minus Session 1 which is missing its prompt,
    // plus the Session 4 wrapper that has a pointer-only prompt = 13 -1 = 12.
    expect(promptCount).toBeGreaterThanOrEqual(11);
  });
});
