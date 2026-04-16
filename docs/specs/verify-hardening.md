# SpecWriter Verify Hardening — Requirements Specification

**Mode:** Feature (retrofit of an existing SpecWriter / Implementation-Guide feature)
**Intended audience:** an AI (or engineer) applying the same hardening to a separate project that already implements a SpecWriter-like feature.
**Reference implementation:** CodeMantis (Tauri v2 + React + TypeScript + Rust). Concrete file paths in this document refer to CodeMantis and are labeled as REFERENCE — the target project should map each archetype to the equivalent file in its own codebase.

---

## 1. Overview

### 1.1 Problem

A SpecWriter feature produces two artifacts per user request:
- an implementation spec (with a session plan that decomposes the work into Claude Code sessions), and
- a companion "Verification Audit" document (often 100–300 enumerated VERIFY directives) that Claude Code is supposed to run after implementation.

Observed failure mode: after a long implementation run, the verifier model (Claude Code) reports "Implementation complete" and claims PASS on ~95% of audit items without opening the referenced files. When pressed, it admits: *"I skimmed large sections ... assumed PASS without opening files."*

Root cause is prompt design, not model misalignment:
1. The generic fallback verify prompt says "open the relevant files" in unscoped prose — no per-item evidence requirement, no output schema, no pacing.
2. The per-session `**Verification Prompt:**` block in SpecWriter's generator is marked OPTIONAL, so most sessions fall back to the weak generic prompt.
3. The audit doc template tells the verifier to "Report PASS, FAIL, or MISSING" but does not demand quoted-code evidence, does not forbid skimming language, does not enforce batching, and does not require a final accounting line.
4. The autonomous-run orchestrator (if present) blanket-marks every checklist item as PASS whenever it decides to "advance," regardless of whether the verifier actually produced evidence.

### 1.2 Solution

Four coordinated prompt-engineering and gate-logic changes. All are surgical — mostly string edits plus one small type field and one gate function.

- **Part A — Runtime verify-prompt preamble (highest leverage).** Every verify prompt the system emits is prefixed with a non-negotiable `VERIFICATION MODE` contract that forces file opens, quoted-code evidence, batching, forbidden-phrase list, and a mandatory final accounting line. Because this runs at every verify invocation, it retroactively applies to guides already stored in the database whose per-session `verificationPrompt` text was written under the old weak rules.
- **Part B — Audit template hardening.** The SpecWriter generator now emits audit documents that open with a `## Contract for the Verifier` section restating the same rules at the document level, plus a new FORMAT RULE that mandates a structured `VERIFY-N — PASS|FAIL|SKIPPED — {file}:{lines} — \`{quoted code}\`` output line per item.
- **Part C — Mandatory per-session Verification Prompt.** The SpecWriter generator's "OPTIONAL — only for complex sessions" rule is replaced with "MANDATORY — every session, without exception." Simple sessions get a short form (3–5 steps); complex sessions get the full form with NOT EXPECTED and TRACE directives.
- **Part D — Self-Drive evidence gate.** The autonomous orchestrator's verify-phase system prompt now requires per-check evidence with file:lines citations. The "advance" handler in the guide/session store validates this evidence before completing the session — no evidence, no advance; the system pauses with a clear run-log reason. Evidence is logged (not persisted in the guide schema).

### 1.3 Success Criteria

- A verifier run emits per-item structured lines in the format `{N}. {item} — PASS|FAIL|SKIPPED — {file}:{lines} — {evidence}`.
- A verifier that tries to batch-PASS self-corrects or emits honest `SKIPPED — {reason}` instead.
- Every new session plan SpecWriter produces contains a `**Verification Prompt:**` block.
- In autonomous mode, a weak or skimmed verifier response causes the orchestrator/gate to pause the run with a human-readable reason — it does NOT mark checks as passed without evidence.
- Existing stored session prompts (pre-retrofit) automatically benefit from the new contract on their next verify-click, with zero data migration.

---

## 2. Affected Components

The target project must have (or have equivalents for) each of these archetypes. Where CodeMantis paths are shown, they are REFERENCE examples.

| # | Archetype | CodeMantis reference | What it does |
|---|-----------|----------------------|---|
| A | Verify-prompt builder module | `src/lib/guide-verify-prompt.ts` | Pure module that produces the text sent to the verifier for a single session (`buildSessionVerifyPrompt`) and for the whole guide (`buildGuideCompleteVerifyPrompt`). Called by the "Verify" UI button and by the autonomous orchestrator before each verify turn. |
| B | SpecWriter system prompt(s) | `src/lib/spec-prompts.ts` (exports `NEW_APP_PROMPT`, `FEATURE_MODE_PROMPT`) | The big system prompts that teach the LLM how to write specs and audit docs. If you have separate "new app" and "existing feature" modes, both need the same edits. |
| C | Session-plan parser | `src/lib/parse-session-plan.ts` | Parses SpecWriter output markdown into structured `GuideSession` records. Must accept the `**Verification Prompt:**` fenced block. Usually no change needed — an existing optional regex handles the new mandatory form. |
| D | Orchestrator system prompt | `src/lib/self-drive-orchestrator.ts` (function `buildSystemPrompt`) | System prompt for the separate AI call that decides "advance / fix / pause" after each verifier turn. |
| E | Advance handler | `src/stores/selfDriveStore.ts`, function `handleAdvance` | The store action that marks checks passed and transitions to the next session when the orchestrator says "advance." This is where the evidence gate lives. |
| F | Orchestrator decision type | `src/types/implementation-guide.ts`, interface `OrchestratorDecision.checkResults` | Minimal type change: add one optional field. |

If the target project does not have archetype D/E (no autonomous mode), skip Part D — Parts A/B/C stand alone.

---

## 3. Type / Data Model Changes

Exactly one type change across the whole feature. No database schema changes, no settings/toggles.

### 3.1 `OrchestratorDecision.checkResults[]`

Add one optional field per entry:

```ts
// before
checkResults?: { label: string; passed: boolean; reason?: string }[];

// after
checkResults?: { label: string; passed: boolean; reason?: string; evidence?: string }[];
```

- `evidence` is a short string containing a `file:lines` citation plus a quoted code excerpt. Example: `"src/models/user.ts:42-48 — \`export interface User { id: string }\`"`.
- The field is optional — older orchestrator responses (without `evidence`) continue to parse. The gate (§6) is what enforces presence when it matters.

[ASSUMPTION: the target project stores this as a TypeScript interface. If the schema lives in a protobuf/JSON-Schema/Rust struct, add the field in the equivalent shape.]

No other type changes. `VerifyCheck` stays `{ id, label, checked }` — evidence is logged in the run-log, not persisted on the check itself.

---

## 4. The Verification Contract (the canonical preamble text)

This is the single most important artifact in the feature. It is emitted at the top of every verify prompt (see §5.1). The exact text matters — the forbidden-phrase list, output format, and final-accounting line are what let downstream code spot skimming.

### 4.1 Required content

The preamble MUST contain, in order:

1. **Header** — a visual delimiter plus the title `VERIFICATION MODE — READ BEFORE DOING ANYTHING`.
2. **Mode statement** — "You are now in verification mode, not implementation mode. Your job is to OPEN FILES and REPORT EVIDENCE — not to fix things, not to summarize, not to infer."
3. **The contract** — a bulleted list of hard rules:
   - Every item requires a file open (Read tool) before the verifier reports on it.
   - Every PASS must cite `path:line_range` and quote the exact code line(s).
   - Every FAIL must cite `path:line_range` and quote the code that proves it fails.
   - The verifier may NEVER emit "all X pass", "looks fine", "should work", "everything checks out", "LGTM", or any batch-assurance language.
   - If an item cannot be verified (file unreadable, scope unclear, too expensive), emit `SKIPPED — {one-line reason}`. Skipping honestly is GOOD. Faking PASS is a contract violation.
   - No fixes during verification. Report first. Fix second.
4. **Output format** — one line per item, exact shape:
   ```
   {N}. {item label} — PASS|FAIL|SKIPPED|N/A — {file}:{lines} — {quoted evidence or reason}
   ```
5. **Pacing** — process items in BATCHES OF 10. After each batch emit a tally:
   ```
   --- Batch {k} complete: PASS n · FAIL n · SKIPPED n · remaining n ---
   ```
   Continue to the next batch in the same response. Explicit self-check clause: "If you catch yourself wanting to emit 'the rest all pass' or merge multiple items into one line — STOP. That is the failure mode this preamble exists to prevent."
6. **Forbidden phrases** (verbatim, as a list):
   - "all the remaining items pass"
   - "the rest look correct"
   - "based on the code I've already seen"
   - "I'll assume the pattern holds"
   - "LGTM" / "looks good" / "should work"
   Label them "FORBIDDEN PHRASES (their presence means you skimmed — retract and redo)".
7. **Final line** (always emitted last):
   ```
   Verified X/Y items | PASS: a | FAIL: b | SKIPPED: c | N/A: d
   ```
   If `X != Y`, the verifier must explain the delta in one sentence.

### 4.2 Export shape

The preamble MUST be exported as a single named constant from the verify-prompt builder module. REFERENCE: `export const VERIFY_MODE_PREAMBLE = "..."` in `src/lib/guide-verify-prompt.ts`. Tests import it directly to assert structural properties.

### 4.3 Why it lives in the runtime builder (not in the SpecWriter generator)

The preamble is prepended at verify-click time, not baked into the stored `verificationPrompt` text. This is deliberate: it means guides already saved in the database under the OLD rules retroactively receive the NEW contract the next time the user clicks Verify. No migration, no data rewrite. The only copy of the contract is in the builder module, so there is no drift between emitted text and the rules the SpecWriter teaches.

---

## 5. Prompt-Generation Changes

### 5.1 Verify-prompt builder (Part A)

REFERENCE: `src/lib/guide-verify-prompt.ts`.

The module exports two functions (single-session + full-guide). Both MUST:

- Always prepend `VERIFY_MODE_PREAMBLE` — regardless of whether the session has a stored `verificationPrompt` or falls back to a generated checklist.
- Keep the existing audit-filename handoff: when an audit document exists, append a line like `"Also read the Verification Audit at {path}. Every VERIFY directive in it is subject to the same evidence contract above."`
- Number items globally within the emitted prompt (so the final tally is unambiguous).

#### `buildSessionVerifyPrompt(session, specFilename, auditFilename)`

Three branches, in order:
1. If `session.verificationPrompt` is non-empty: return `PREAMBLE + "\n" + verificationPrompt + auditLine`. (This is the retrofit path.)
2. Else if `session.verifyChecks.length === 0`: return `PREAMBLE` plus a short body explaining that no explicit checks exist, instructing the verifier to run the project's typecheck/test command and quote the output as evidence.
3. Else: return `PREAMBLE` plus a body that numbers every check (`1. {label}\n2. {label}\n...`), states the total count, and restates the per-item format + batching + final-accounting requirements.

#### `buildGuideCompleteVerifyPrompt(sessions, specFilename, auditFilename)`

- Filter to sessions with non-empty `verifyChecks`.
- Number items globally across sessions: `1. [S1] {label}`, `2. [S1] {label}`, `3. [S2] {label}`, ...
- State the total count.
- If an audit filename is present, instruct the verifier to continue numbering from `total + 1` for audit directives.
- If no session has any checks, return `PREAMBLE` + a minimal "run typecheck and quote the output" body.

### 5.2 Audit-template contract (Part B)

REFERENCE: both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT` in `src/lib/spec-prompts.ts`.

Both prompts teach the LLM to emit a Verification Audit document. They MUST be edited symmetrically.

#### 5.2.1 Replace the "How to use" lines with a `## Contract for the Verifier` section.

Before: three sentences telling the verifier to "open the actual file" and "Report PASS, FAIL, or MISSING."

After: a numbered six-point contract (see §4.1 for the content shape — the audit-document version is worded in the imperative second person and uses batches of **20**, not 10, since audit docs are longer than per-session verify runs).

The six points are:
1. Every VERIFY directive requires a file open.
2. Every PASS requires quoted evidence in the format `VERIFY-N — PASS — {file}:{lines} — \`{quoted code}\``.
3. Skimming = FAIL. Do the next item properly or mark it SKIPPED with a reason.
4. Batching is mandatory (batches of 20 with a running tally line between batches).
5. Forbidden phrases — presence means retract and redo.
6. Final accounting line is mandatory: `Verified X/Y items | PASS: a | FAIL: b | SKIPPED: c | MISSING: d`.

Close with a "How to use each VERIFY directive" block: open the file with Read, compare against Expected, check for Not expected, follow Trace step-by-step, emit one structured line per rule 2.

#### 5.2.2 Add a new FORMAT RULE at the end of the numbered rules list.

The SpecWriter audit template already has 14 numbered format rules. Add rule 15:

```
15. VERIFIER OUTPUT FORMAT (enforced at runtime — not optional):
    Every VERIFY directive in the verifier's run output MUST be a
    single structured line of this exact shape:
      VERIFY-N — PASS|FAIL|SKIPPED — {file}:{lines} — `{quoted code or reason}`
    Free-form paragraphs describing what was verified are forbidden.
    One structured line per item. A PASS without a file:line citation
    and quoted code is not a PASS — it's a contract violation.
```

#### 5.2.3 Append a REQUIRED FINAL LINE block to the Final Audit Summary instructions.

After the existing "Total items / PASS / FAIL / MISSING / CRITICAL / IMPORTANT / POLISH" block in the summary template, insert:

```
**REQUIRED FINAL LINE** (the verifier MUST emit this as the last line
of its output — not optional, not a summary paragraph):
  Verified X/Y items | PASS: a | FAIL: b | SKIPPED: c | MISSING: d
If X != Y, the verifier explains the delta in one sentence on the
following line.
```

### 5.3 Mandatory per-session Verification Prompt (Part C)

REFERENCE: both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT` in `src/lib/spec-prompts.ts`, in the Session Plan teaching block (the part that teaches the LLM how to write a session's `**Verification Prompt:**` fenced code block).

#### 5.3.1 Replace the "OPTIONAL" header.

Before: `OPTIONAL — VERIFICATION PROMPT (for complex sessions):` followed by a rule that says only sessions with 5+ verify items get a dedicated prompt.

After: `MANDATORY — VERIFICATION PROMPT (every session, without exception):` followed by a short justification:

> Every session MUST include a `**Verification Prompt:**` block. Simple sessions get the SIMPLE SESSION FORM (3–5 steps). Complex sessions (state machines, auth middleware, integration error handling, 5+ verify items) get the COMPLEX SESSION FORM.
>
> Why mandatory: the generic fallback prompt built from the checklist alone allows the verifier to batch-assume PASS. A dedicated prompt naming specific files and patterns forces file-opens.

#### 5.3.2 Add the SIMPLE SESSION FORM template.

Present BEFORE the existing complex example. Exact content:

````
SIMPLE SESSION FORM (sessions with 2–4 verify items, no complex logic):

**Verification Prompt:**
```
Verify Session {N}: {title}.

For each step, open the ACTUAL file with the Read tool and quote the
specific line(s) that prove PASS or FAIL. One line per step.

1. Open `{file_path}` — VERIFY `{exact symbol/pattern}` exists
2. Open `{file_path}` — VERIFY `{exact symbol/pattern}` exists
3. Run `{test_command}` — VERIFY all tests pass

If you cannot open a file or the check is ambiguous, mark the step
SKIPPED with a one-line reason. Do NOT assume PASS without evidence.
End with: Verified X/Y | PASS n · FAIL n · SKIPPED n.
```
````

Keep the existing COMPLEX SESSION FORM template (with "Open ... VERIFY: ... NOT EXPECTED: ... TRACE:") under a `COMPLEX SESSION FORM (sessions with 5+ verify items or complex logic):` heading.

#### 5.3.3 Replace the trailing "RULES for Verification Prompts" block.

Before: five bullets ending with "Verification prompts are OPTIONAL — only for sessions with 5+ items or complex logic. Simple sessions use the manual checklist only."

After:

```
RULES for Verification Prompts (MANDATORY EVERY SESSION):
- Every check starts with "Open `{file_path}`" — forces file reading
- Every check has "VERIFY:" with a specific expected outcome
- Every check expects QUOTED CODE as evidence, not "looks correct"
- Include "NOT EXPECTED:" for common mistakes when applicable
- Include "TRACE:" for logic chains that span multiple functions
- End with the final accounting line:
  "Verified X/Y | PASS n · FAIL n · SKIPPED n"
- No session may omit the Verification Prompt block. Simple sessions
  use the SIMPLE SESSION FORM; complex ones use the COMPLEX SESSION FORM.
```

### 5.4 Parser (no change expected)

The existing regex that extracts `**Verification Prompt:**` fenced blocks already treats the block as optional and captures whatever text is inside. Making the block mandatory in the generator does not require a parser change — but the target project MUST verify its parser accepts both the SIMPLE and COMPLEX forms. See §8 for the regression test.

---

## 6. Orchestrator & Gate Logic (Part D)

Skip this section if the target project has no autonomous / "Self-Drive" mode.

### 6.1 Orchestrator system prompt

REFERENCE: `src/lib/self-drive-orchestrator.ts`, function `buildSystemPrompt()`. This is the prompt for the separate LLM call (typically a small model like gpt-4o or Haiku) that decides the next action after each Claude Code turn.

Replace the "AFTER A VERIFICATION PHASE" block (the rules that fire when `currentPhase === "verifying"`) with:

```
AFTER A VERIFICATION PHASE (currentPhase = "verifying"):
- Parse Claude Code's response line by line. Do NOT infer, summarize, or trust claims without evidence.
- For EACH VerifyCheck in the session, emit EXACTLY ONE checkResults entry matching by "label" verbatim.
- Each entry must be one of:
  - { label, passed: true, evidence: "{file}:{lines} — {quoted code}" }
    — requires a file:lines citation AND a quoted code snippet lifted from
    Claude Code's response. The evidence string MUST contain a ":" between
    file and line range. No citation or no quoted code → NOT passed.
  - { label, passed: false, reason: "{short reason}" }
    — including when evidence is missing, file wasn't opened, the check
    clearly fails, or the verifier used batch-PASS language.
- SKIMMING DETECTION: if Claude Code's response contains any of these
  phrases covering unverified items, mark those items
  { passed: false, reason: "verifier used batch-PASS language without evidence" }:
  - "all remaining items pass"
  - "the rest look correct"
  - "based on what I've seen"
  - "I'll assume the pattern holds"
  - "LGTM" / "looks good" / "should work"
- DECISION:
  - action: "advance" is allowed ONLY when checkResults.length equals the
    number of VerifyCheck labels AND every entry is either passed:true
    (with evidence) or passed:false (with reason). Use "advance" only when
    EVERY entry is passed:true.
  - If any entry is passed:false AND fixAttempt < maxFixAttempts → action: "fix"
    with a fixPrompt that lists each failed label + its reason.
  - If any entry is passed:false AND fixAttempt >= maxFixAttempts → action: "pause"
    with pauseReason summarizing the remaining failures.
  - If you cannot produce a complete per-check verdict (coverage < full) →
    action: "pause" with pauseReason "orchestrator could not produce per-check
    evidence for all items" and confidence: "low".
- "advance" is NOT a trust signal — it is a structured assertion that every
  check is confirmed with evidence. The system validates your checkResults
  and will reject "advance" if any passed:true entry lacks evidence.
```

Also append one line to the general RULES block that lists advance/pause/etc. rules:

```
- For verification phases, "passed: true" REQUIRES an "evidence" field
  containing "file:lines — quoted code". Advancing is forbidden without
  full per-check coverage — the system will pause Self-Drive if you try.
```

### 6.2 Advance-handler evidence gate

REFERENCE: `src/stores/selfDriveStore.ts`, function `handleAdvance(decision, previousPhase)`.

Two changes:

#### 6.2.1 Remove the blanket "mark all checks as passed" block.

Before: unconditionally toggled every unchecked `VerifyCheck` to checked when the orchestrator said "advance." This was the bug.

Remove the block. Replace with the gate from 6.2.2 (applied only when `previousPhase === "verifying"`).

#### 6.2.2 Add a validated, selective-mark gate.

Apply ONLY when `previousPhase === "verifying"`. For advances from test/commit phases, the checks were already marked during the preceding verify phase — the gate must not re-run.

Algorithm:

1. Call a pure validation helper (§6.3) passing the session and the decision. If it returns a non-null reason string, log `"Advance rejected: {reason}"` to the run-log and transition Self-Drive to `paused` with a human-readable message. Return — do NOT mark checks, do NOT complete the session.
2. If validation passes: iterate the session's `verifyChecks`. For each check whose label appears in `decision.checkResults` with `passed: true`, toggle it to checked. Leave other checks unchecked (they are `passed: false` and represent real failures — but the orchestrator should have returned `action: "fix"` instead of `"advance"` in that case; the validator would have caught it).
3. Defense-in-depth: re-read the session after toggling. If any check remains unchecked, pause with a diagnostic — the orchestrator produced an internally inconsistent verdict.
4. Only after steps 1–3 succeed, proceed to `markSessionComplete` and the existing post-advance flow (optional test phase, optional commit phase, next-session transition).

#### 6.2.3 Extend the run-log output.

When logging `checkResults`, include the evidence string on pass and the reason on fail:

```
PASS: {label} [{evidence}]; FAIL: {label} ({reason}); ...
```

This makes the run-log UI useful for reviewing why Self-Drive advanced or paused.

### 6.3 The `validateVerifyAdvance` helper

A pure function, exported from the same module as `handleAdvance` (so tests can exercise it directly). Signature:

```ts
validateVerifyAdvance(
  session: { verifyChecks: { label: string }[] },
  decision: OrchestratorDecision,
): string | null;
```

Returns `null` when the verdict is acceptable, or a short reason string composed of one or more of:
- `"{n} checks missing from verdict"` — session has labels the decision does not cover.
- `"{n} PASS entries lack file:line evidence"` — `passed: true` entries whose `evidence` is absent or does not contain a `:` (loose check — we accept `file.ts:42`, `file.ts:42-48`, and even `file.ts: ...`).
- `"{n} unknown labels in verdict"` — decision names labels that are not in the session.

If multiple violations apply, join them with `"; "`.

If `checkResults` is missing or empty, return `"no checkResults in advance verdict"`.

The function MUST be pure (no I/O, no store reads) so it can be unit-tested without mocking.

---

## 7. Error Handling & Edge Cases

- **Verifier omits the final accounting line.** Acceptable in the short term — the log-level summary in Part D shows the verdict regardless. Long-term, the orchestrator should treat its absence as a skimming signal.
- **Verifier cites a line range that doesn't exist.** The gate's evidence check is loose — it only looks for a `:` in the evidence string. A fake citation passes the gate. The user-facing run-log surfaces the evidence strings so humans can spot hallucinations. This is a known trade-off (§11).
- **Session has zero verify checks.** `buildSessionVerifyPrompt` falls through to a short body instructing the verifier to run `tsc --noEmit` (or the project's equivalent) and quote the final compiler output as evidence.
- **No audit document.** The verify prompts omit the audit-filename line gracefully. Everything else works identically.
- **Advance from a non-verifying phase (test / commit / direct).** The gate does not fire. Instead, the system relies on `markSessionComplete` rejecting the advance when checks are not fully marked (this is an existing behavior of the guide store — the target project must verify it behaves this way). A prior verify phase must have already marked the checks.
- **Orchestrator returns `checkResults` with fewer entries than the session has.** Validator catches it as "{n} checks missing from verdict" → pause.
- **Orchestrator returns `checkResults` with labels that do not exist in the session (fabrication).** Validator catches it as "{n} unknown labels in verdict" → pause.
- **Orchestrator returns `passed: true` without evidence.** Validator catches it as "{n} PASS entries lack file:line evidence" → pause.
- **Orchestrator returns `checkResults: []`.** Validator returns "no checkResults in advance verdict" → pause.
- **The verifier uses a forbidden phrase but still provides all evidence.** Acceptable — the phrase is a warning signal, not a hard reject. The orchestrator's SKIMMING DETECTION clause only applies to items the phrase is COVERING (i.e., the phrase is used to justify skipping evidence).

---

## 8. UI / UX Specifications

Minimal UI changes.

### 8.1 Run-log display

The run-log (or autonomous-mode activity feed) MUST show the full `PASS: {label} [{evidence}]; FAIL: {label} ({reason})` summary when Self-Drive advances. This is the only place a human sees the orchestrator's evidence — critical for catching hallucinated citations.

### 8.2 Pause notification

When the gate pauses Self-Drive, the pause reason shown to the user MUST be specific — e.g. "Self-Drive halted: verifier/orchestrator did not produce evidence for all checks (3 checks missing from verdict; 2 PASS entries lack file:line evidence). Review the run log and continue manually."

Do NOT show a generic "orchestrator requested pause" — the user needs to know it was the GATE, not the orchestrator itself, and why.

### 8.3 No new settings or toggles

The behavior is the new default. There is no "strict verification mode" setting. A toggle defeats the purpose: the failure mode is a skimming verifier, and a skimming model will flip any toggle that lets it skim.

---

## 9. Implementation Checklist

Enumerate EVERY item individually. Do NOT group. Do NOT summarize. Check off one at a time.

### 9.1 Phase 0 — Discovery (target project)

- [ ] Locate the equivalent of `src/lib/guide-verify-prompt.ts` — the module that builds verify prompts at runtime.
- [ ] Locate the equivalent of `src/lib/spec-prompts.ts` — the SpecWriter system prompt(s).
- [ ] Confirm whether the project has one spec-prompt or multiple (new-app vs. feature). If multiple, every edit in §5 must be applied symmetrically.
- [ ] Locate the equivalent of `src/lib/parse-session-plan.ts`. Confirm the regex accepts `**Verification Prompt:**` fenced blocks with arbitrary body text.
- [ ] Determine whether the project has an autonomous orchestrator (Part D). If not, scope shrinks to A+B+C.
- [ ] If Part D is in scope: locate `OrchestratorDecision` type, orchestrator system prompt builder, and advance handler.
- [ ] Determine the typecheck command, test command, and lint command for the project (needed for fallback verify prompts and the Implementation Checklist below).

### 9.2 Phase 1 — Part A (Runtime preamble)

- [ ] Add a named constant `VERIFY_MODE_PREAMBLE` to the verify-prompt builder module. Content MUST match §4.1 structure.
- [ ] Export `VERIFY_MODE_PREAMBLE` so tests can import it.
- [ ] Rewrite `buildSessionVerifyPrompt` per §5.1 — three branches (stored prompt / no-checks fallback / numbered checklist), all prepending the preamble.
- [ ] Rewrite `buildGuideCompleteVerifyPrompt` per §5.1 — preamble, globally-numbered items, continue-numbering instruction for the audit doc.
- [ ] Test: assert preamble is present in all output branches.
- [ ] Test: assert preamble wraps stored `verificationPrompt` (retrofit behavior) — preamble index < stored-text index in the output string.
- [ ] Test: assert forbidden-phrase list appears verbatim in the preamble body (used as forbidden-examples, not emitted in output).
- [ ] Test: assert "final accounting line" and "batches of 10" instructions appear.
- [ ] Test: assert global numbering in `buildGuideCompleteVerifyPrompt` produces `[S1]`, `[S2]` prefixes with sequential numbers.
- [ ] Test: assert "continue numbering from N+1" instruction appears when audit filename is provided.
- [ ] Test: update any pre-existing tests that asserted old prose like "Check each of the following" (that string no longer appears).

### 9.3 Phase 2 — Part B (Audit template)

- [ ] Replace the "How to use" block in the SpecWriter audit template with the `## Contract for the Verifier` section (§5.2.1). If the project has both new-app and feature prompts, replace in both.
- [ ] Append new FORMAT RULE 15 per §5.2.2 to both prompts.
- [ ] Append the REQUIRED FINAL LINE block to the Final Audit Summary section per §5.2.3 to both prompts.
- [ ] Test: assert `## Contract for the Verifier` appears in both prompts.
- [ ] Test: assert `Skimming = FAIL` and `Reporting PASS without having opened the file is a contract violation` appear in both prompts.
- [ ] Test: assert `batches of 20` appears in both prompts (note: 20 for audit, 10 for per-session verify).
- [ ] Test: assert the forbidden-phrase list appears in both prompts (at least 3 sample phrases).
- [ ] Test: assert `VERIFY-N — PASS|FAIL|SKIPPED` appears in both prompts.
- [ ] Test: assert `REQUIRED FINAL LINE` and `Verified X/Y items | PASS: a | FAIL: b | SKIPPED: c | MISSING: d` appear in both prompts.

### 9.4 Phase 3 — Part C (Mandatory VP)

- [ ] Replace `OPTIONAL — VERIFICATION PROMPT (for complex sessions):` header with `MANDATORY — VERIFICATION PROMPT (every session, without exception):` and the justification paragraph per §5.3.1.
- [ ] Insert the SIMPLE SESSION FORM template per §5.3.2 above the existing complex template. Label it `SIMPLE SESSION FORM (sessions with 2–4 verify items, no complex logic):`.
- [ ] Label the existing complex template `COMPLEX SESSION FORM (sessions with 5+ verify items or complex logic):`.
- [ ] Replace the trailing "RULES for Verification Prompts" block per §5.3.3 — mandatory rules, QUOTED CODE as evidence, end with accounting line.
- [ ] Mirror all three edits in both the new-app and feature SpecWriter prompts, if both exist.
- [ ] Test: assert `MANDATORY — VERIFICATION PROMPT (every session, without exception)` appears; old `OPTIONAL — VERIFICATION PROMPT (for complex sessions):` does NOT.
- [ ] Test: assert `SIMPLE SESSION FORM` and `COMPLEX SESSION FORM` both appear.
- [ ] Test: assert `No session may omit the Verification Prompt block` appears.
- [ ] Test: assert `Every check expects QUOTED CODE as evidence` appears.
- [ ] Test: assert the accounting line `Verified X/Y | PASS n · FAIL n · SKIPPED n` appears in the rules block.
- [ ] Test (parser regression): feed a synthetic session-plan markdown with both a SIMPLE and a COMPLEX Verification Prompt; assert the parser round-trips both into structured `session.verificationPrompt` strings.

### 9.5 Phase 4 — Part D (Self-Drive gate)

Skip this entire phase if the target project has no autonomous mode.

- [ ] Add optional `evidence?: string` field to `OrchestratorDecision.checkResults[]` per §3.1.
- [ ] Replace the AFTER A VERIFICATION PHASE block in the orchestrator system prompt per §6.1.
- [ ] Append the evidence requirement to the general RULES block per §6.1 last paragraph.
- [ ] Add and export the pure helper `validateVerifyAdvance(session, decision)` per §6.3 in the advance-handler's module.
- [ ] Update `handleAdvance` (or the equivalent): when `previousPhase === "verifying"`, run the validator first, pause on any violation, then selectively toggle only checks with `passed: true` per §6.2.2.
- [ ] Add defense-in-depth: after selective toggling, re-read the session and pause if any check remains unchecked.
- [ ] Extend the checkResults log-entry to include evidence/reason detail per §6.2.3.
- [ ] Test: orchestrator system prompt contains `{file}:{lines}`, `quoted code`, `full per-check coverage`, `NOT a trust signal`.
- [ ] Test: orchestrator system prompt contains `SKIMMING DETECTION`, all the forbidden phrases, `batch-PASS language without evidence`.
- [ ] Test (`validateVerifyAdvance`): accepts full coverage + evidence per PASS → returns null.
- [ ] Test (`validateVerifyAdvance`): accepts passed:false entries with reason → returns null (structure OK).
- [ ] Test (`validateVerifyAdvance`): rejects when `checkResults` is missing → "no checkResults".
- [ ] Test (`validateVerifyAdvance`): rejects when `checkResults` is empty → "no checkResults".
- [ ] Test (`validateVerifyAdvance`): rejects when some session checks are missing from verdict → "{n} checks missing".
- [ ] Test (`validateVerifyAdvance`): rejects `passed:true` without evidence → "{n} PASS entries lack file:line evidence".
- [ ] Test (`validateVerifyAdvance`): rejects evidence string with no `:` separator → same message.
- [ ] Test (`validateVerifyAdvance`): rejects when verdict names labels not in session → "{n} unknown labels".
- [ ] Test (`validateVerifyAdvance`): combines multiple violations in one string.
- [ ] Test (store integration): decision with unknown labels from verifying phase → Self-Drive paused; checks stay unchecked; session stays active.
- [ ] Test (store integration): decision with full evidence from verifying phase → session advances; checks marked; guide progresses.
- [ ] Test (store integration): update existing tests that used blanket-mark behavior to include evidence in their `checkResults` fixtures.
- [ ] Test (store integration): an advance with `previousPhase !== "verifying"` (e.g. from test/commit) does NOT invoke the gate — it relies on checks being pre-marked.

### 9.6 Phase 5 — Quality gates

- [ ] Typecheck clean (`pnpm tsc --noEmit` in the reference project; use the target project's equivalent).
- [ ] Lint clean.
- [ ] All unit tests pass.
- [ ] All integration tests pass (if present).
- [ ] Rust/backend tests pass (if present).
- [ ] Manual smoke test — retrofit: open an existing guide whose session has a stored `verificationPrompt`, click Verify; confirm `VERIFICATION MODE — READ BEFORE DOING ANYTHING` appears above the stored prompt.
- [ ] Manual smoke test — fallback: open a guide whose session has only a checklist; confirm the preamble + numbered items + final-accounting instruction appear.
- [ ] Manual smoke test — new spec: generate a spec via SpecWriter with 3–4 sessions; confirm every session contains a `**Verification Prompt:**` block (SIMPLE or COMPLEX form).
- [ ] Manual smoke test — new audit: generate the companion audit; confirm `## Contract for the Verifier` appears.
- [ ] Manual smoke test — end-to-end skim test: have the verifier try to batch-PASS; confirm it self-corrects or emits honest `SKIPPED`.
- [ ] Manual smoke test — Self-Drive gate (if Part D in scope): run Self-Drive end-to-end, confirm run-log shows evidence strings per check, and a weak verifier response pauses with a clear reason.

---

## 10. Session Plan

Four sessions. Each has a mandatory Verification Prompt per Part C of this very spec. If the target project has no autonomous mode, drop Session 4.

### Session 1: Runtime verify-prompt preamble

**Scope:** add `VERIFY_MODE_PREAMBLE` constant and rewrite both builder functions in the verify-prompt module.
**Read sections:** §1, §4, §5.1 of this spec.
**Files:** the equivalent of `src/lib/guide-verify-prompt.ts` (+ its test file).

**Prompt for Claude Code:**
```
Read docs/specs/verify-hardening.md — but ONLY sections 1, 4, and 5.1.
IGNORE all other sections.

1. Open the verify-prompt builder module (the equivalent of
   `src/lib/guide-verify-prompt.ts` in the reference project).
2. Add an exported constant VERIFY_MODE_PREAMBLE containing the
   contract per §4.1. Put it near the top of the file, before the
   exported functions. Wrap the body in the format the module uses
   (template literal in TypeScript).
3. Rewrite buildSessionVerifyPrompt (or the equivalent) to always
   prepend the preamble in all three branches: stored verificationPrompt,
   no-checks fallback, and numbered-checklist fallback.
4. Rewrite buildGuideCompleteVerifyPrompt (or the equivalent) to
   prepend the preamble, number items globally with a session-id prefix
   like "[S1]", and when an audit filename is present instruct the
   verifier to continue numbering from N+1.
5. Update the builder's test file: add assertions for every bullet in
   §9.2 of the spec. Update any pre-existing assertion that still
   expects pre-change wording.
6. Run the test suite.

Do NOT touch any other files.
```

**Verification Prompt:**
```
Verify Session 1: Runtime verify-prompt preamble.

For each step, open the ACTUAL file with the Read tool and quote the
specific line(s) that prove PASS or FAIL. One line per step.

1. Open `{verify-prompt-builder-module}` — VERIFY `VERIFY_MODE_PREAMBLE`
   is exported and its body contains the header "VERIFICATION MODE —
   READ BEFORE DOING ANYTHING".
2. Open `{verify-prompt-builder-module}` — VERIFY the constant body
   contains "all the remaining items pass" (as a forbidden-example
   string, not as output), "LGTM", "batches of 10", and "Verified X/Y".
3. Open `{verify-prompt-builder-module}` — VERIFY buildSessionVerifyPrompt
   has three branches and each returns a string that begins with
   VERIFY_MODE_PREAMBLE (trace the control flow).
4. Open `{verify-prompt-builder-module}` — VERIFY
   buildGuideCompleteVerifyPrompt numbers items globally across sessions
   (look for "[S${s.index}]" or equivalent).
5. Open `{verify-prompt-builder-test-file}` — VERIFY new assertions exist
   for: preamble prepending, retrofit behavior, forbidden phrases, batching,
   final-accounting line, global numbering.
6. Run `{test_command}` — VERIFY all tests pass including the new ones.

End with: Verified X/Y | PASS n · FAIL n · SKIPPED n.
```

### Session 2: Audit template contract

**Scope:** add `## Contract for the Verifier` + new FORMAT RULE 15 + REQUIRED FINAL LINE to the SpecWriter audit template (both variants if present).
**Read sections:** §1, §5.2 of this spec.
**Files:** the equivalent of `src/lib/spec-prompts.ts` (+ test file).

**Prompt for Claude Code:**
```
Read docs/specs/verify-hardening.md — but ONLY sections 1 and 5.2.
IGNORE all other sections.

1. Open the SpecWriter system prompt module (the equivalent of
   `src/lib/spec-prompts.ts`).
2. Find the "How to use" preamble block inside the VERIFICATION AUDIT
   generation section. Replace it with the `## Contract for the Verifier`
   section per §5.2.1 (six numbered rules + How-to-use block at the end).
3. If the module has both a new-app and a feature SpecWriter prompt,
   apply the replacement to BOTH. The text must be identical — a
   replace_all-style edit is fine.
4. Append new FORMAT RULE 15 per §5.2.2 at the end of the numbered
   format-rules list. Apply to both prompts.
5. Append the REQUIRED FINAL LINE block per §5.2.3 immediately after
   the existing "Total items / PASS / FAIL / MISSING / CRITICAL /
   IMPORTANT / POLISH" template in the Final Audit Summary. Apply to
   both prompts.
6. Update the SpecWriter prompt's test file: add the assertions per
   §9.3.
7. Run the test suite.

Do NOT modify files from Session 1 beyond confirming they still pass.
```

**Verification Prompt:**
```
Verify Session 2: Audit template contract.

For each step, open the ACTUAL file with the Read tool and quote the
specific line(s) that prove PASS or FAIL. One line per step.

1. Open `{spec-prompts-module}` — VERIFY `## Contract for the Verifier`
   appears exactly twice (once per prompt variant; only once if the
   project has a single prompt).
2. Open `{spec-prompts-module}` — VERIFY `Skimming = FAIL` appears in
   both prompt variants.
3. Open `{spec-prompts-module}` — VERIFY `batches of 20` (audit uses 20,
   per-session verify uses 10 — do not confuse them) and the forbidden
   phrase list appear in both variants.
4. Open `{spec-prompts-module}` — VERIFY FORMAT RULE 15 exists with the
   string `VERIFY-N — PASS|FAIL|SKIPPED` in both variants.
5. Open `{spec-prompts-module}` — VERIFY the REQUIRED FINAL LINE block
   with `Verified X/Y items | PASS: a | FAIL: b | SKIPPED: c | MISSING: d`
   appears in both variants.
6. Open `{spec-prompts-test-file}` — VERIFY new assertions cover all
   five of the above for both prompt variants.
7. Run `{test_command}` — VERIFY all tests pass including new ones.

End with: Verified X/Y | PASS n · FAIL n · SKIPPED n.
```

### Session 3: Mandatory per-session Verification Prompt

**Scope:** swap the OPTIONAL header for MANDATORY, add the SIMPLE SESSION FORM template, rewrite the RULES block. Regression-test the parser.
**Read sections:** §1, §5.3, §5.4 of this spec.
**Files:** the equivalent of `src/lib/spec-prompts.ts` (+ test files for spec-prompts and session-plan parser).

**Prompt for Claude Code:**
```
Read docs/specs/verify-hardening.md — but ONLY sections 1, 5.3, and 5.4.
IGNORE all other sections.

1. Open the SpecWriter system prompt module.
2. Find the `OPTIONAL — VERIFICATION PROMPT (for complex sessions):`
   header inside the Session Plan teaching block. Replace with
   `MANDATORY — VERIFICATION PROMPT (every session, without exception):`
   plus the justification paragraph per §5.3.1.
3. Insert the SIMPLE SESSION FORM template per §5.3.2 above the existing
   complex-form example. Label the existing complex-form example
   `COMPLEX SESSION FORM (sessions with 5+ verify items or complex logic):`.
4. Replace the trailing `RULES for Verification Prompts` block per
   §5.3.3 — mandatory wording, QUOTED CODE requirement, accounting-line
   requirement.
5. Mirror all three edits across every SpecWriter prompt variant.
6. Do NOT modify the session-plan parser. The existing regex that extracts
   fenced `**Verification Prompt:**` blocks should accept both simple and
   complex forms unchanged.
7. Update the SpecWriter test file with assertions per §9.4.
8. Add a parser regression test: feed a synthetic session-plan markdown
   containing both a SIMPLE and a COMPLEX `**Verification Prompt:**`
   block; assert the parser round-trips both into structured
   session.verificationPrompt strings.
9. Run the test suite.

Do NOT modify files from earlier sessions beyond confirming they still pass.
```

**Verification Prompt:**
```
Verify Session 3: Mandatory per-session Verification Prompt.

For each step, open the ACTUAL file with the Read tool and quote the
specific line(s) that prove PASS or FAIL. One line per step.

1. Open `{spec-prompts-module}` — VERIFY
   `MANDATORY — VERIFICATION PROMPT (every session, without exception)`
   appears (once per prompt variant).
   NOT EXPECTED: the old `OPTIONAL — VERIFICATION PROMPT (for complex sessions):`
   header to remain anywhere in the file.
2. Open `{spec-prompts-module}` — VERIFY both `SIMPLE SESSION FORM` and
   `COMPLEX SESSION FORM` labels exist in both prompt variants.
3. Open `{spec-prompts-module}` — VERIFY the rules block contains
   `Every check expects QUOTED CODE as evidence` and
   `No session may omit the Verification Prompt block`.
4. Open `{parser-module}` — VERIFY the regex that extracts
   `**Verification Prompt:**` blocks is unchanged (or still accepts
   both forms).
5. Open `{parser-test-file}` — VERIFY the regression test exists and
   covers both SIMPLE and COMPLEX fenced blocks.
6. Open `{spec-prompts-test-file}` — VERIFY new assertions cover
   MANDATORY wording, both forms, and the rules block.
7. Run `{test_command}` — VERIFY all tests pass including new ones.

End with: Verified X/Y | PASS n · FAIL n · SKIPPED n.
```

### Session 4: Self-Drive evidence gate

**Scope:** type field addition + orchestrator system prompt rewrite + `validateVerifyAdvance` helper + gated `handleAdvance`.
**Skip this session entirely if the target project has no autonomous mode.**
**Read sections:** §1, §3, §6 of this spec.
**Files:** the equivalents of `src/types/implementation-guide.ts`, `src/lib/self-drive-orchestrator.ts`, `src/stores/selfDriveStore.ts` (+ test files).

**Prompt for Claude Code:**
```
Read docs/specs/verify-hardening.md — but ONLY sections 1, 3, and 6.
IGNORE all other sections.

1. Open the types module that defines OrchestratorDecision.
   Add one optional field `evidence?: string` to each entry of
   `checkResults[]` per §3.1. No other type changes.
2. Open the orchestrator system-prompt builder module.
   Replace the AFTER A VERIFICATION PHASE block with the content in §6.1.
   Append the evidence-requirement line to the general RULES block.
3. Open the store module that handles the advance action.
   Add and export a pure helper `validateVerifyAdvance(session, decision)`
   with the signature and rules from §6.3. Place it near the top of the
   handlers block so tests can import it.
4. Rewrite the handleAdvance function per §6.2:
   - Remove the unconditional blanket "mark ALL checks as passed" block.
   - When previousPhase === "verifying", run validateVerifyAdvance first.
     If it returns a non-null reason, log "Advance rejected: {reason}" to
     the run-log and transition Self-Drive to paused with a specific
     pause reason. Return — do not mark checks or complete the session.
   - On success, iterate the session's checks and selectively toggle
     only those whose label appears with passed:true in
     decision.checkResults.
   - Defense-in-depth: re-read the session after toggling. If any check
     remains unchecked, pause with a diagnostic.
   - Only after steps pass, call markSessionComplete as before.
5. Extend the checkResults log-entry formatter to include
   `[{evidence}]` for passes and `({reason})` for fails per §6.2.3.
6. Update the orchestrator test file with assertions per §9.5 for the
   system-prompt strings.
7. Update the store test file:
   - Add validateVerifyAdvance unit tests covering every branch per §9.5.
   - Update existing handleAdvance tests whose fixtures used plain
     `{ label, passed: true }` — they must now include `evidence: "file:line — code"`.
   - Rewrite any test whose name or behavior asserts blanket-mark —
     it must now assert the GATE pauses on weak verdicts.
8. Run the test suite AND the typecheck command.

Do NOT modify files from earlier sessions beyond confirming they still pass.
```

**Verification Prompt:**
```
Verify Session 4: Self-Drive evidence gate.

For each step, open the ACTUAL file with the Read tool and quote the
specific line(s) that prove PASS or FAIL. One line per step.

1. Open `{types-module}` — VERIFY OrchestratorDecision.checkResults[]
   has an optional `evidence?: string` field.
2. Open `{orchestrator-module}` — VERIFY the system prompt contains
   `{file}:{lines}`, `quoted code`, `full per-check coverage`, and
   `NOT a trust signal`.
3. Open `{orchestrator-module}` — VERIFY the system prompt contains
   `SKIMMING DETECTION`, at least three forbidden phrases
   ("all remaining items pass", "LGTM", "looks good"), and
   `batch-PASS language without evidence`.
4. Open `{store-module}` — VERIFY `validateVerifyAdvance` is exported
   and its body:
     - returns "no checkResults in advance verdict" when checkResults is
       missing/empty.
     - joins missing/unknown/no-evidence violations with "; ".
     - loosely checks evidence via `.includes(":")`.
   TRACE: read the handleAdvance function — confirm it calls
   validateVerifyAdvance ONLY when previousPhase === "verifying", then
   selectively toggles checks on passed:true, then has a
   defense-in-depth re-read.
5. Open `{store-module}` — VERIFY the blanket "mark ALL checks"
   for-loop no longer exists outside the verify-gate branch.
6. Open `{store-module}` — VERIFY the checkResults log-entry formatter
   emits `[{evidence}]` for pass and `({reason})` for fail.
7. Open `{store-test-file}` — VERIFY validateVerifyAdvance unit tests
   cover: full coverage accepted; missing checkResults rejected;
   missing labels rejected; passed:true without evidence rejected;
   unknown labels rejected; combined violations joined.
8. Open `{store-test-file}` — VERIFY the store-integration test for
   "skim rejected" exists: decision with unknown labels from verify
   phase → Self-Drive paused AND checks stay unchecked AND session
   stays active.
9. Run `{test_command}` — VERIFY all tests pass.
10. Run `{typecheck_command}` — VERIFY zero type errors.

End with: Verified X/Y | PASS n · FAIL n · SKIPPED n.
```

**Verify (full audit):**
```
Read docs/specs/verify-hardening.md — run the full verification checklist
in §9. For each VERIFY directive across all four sessions, open the
actual file and check the code. Report PASS/FAIL for every item. Fix all
failures before saying "Implementation complete."
```

---

## 11. Open Questions & Assumptions

- [❓ ASSUMED] The target project has a SpecWriter-like feature that produces session-plan markdown with `**Verification Prompt:**` fenced blocks already parseable by its session-plan parser. If not, Session 3 expands to include a parser addition.
- [❓ ASSUMED] The target project has an advance-handler that calls `markSessionComplete` (or equivalent), and `markSessionComplete` already refuses to complete a session when verify checks are unchecked. If not, Part D must add this guard in `markSessionComplete` itself.
- [❓ ASSUMED] The target project has ONE copy of the SpecWriter system prompt, or at most two (new-app + feature). If more variants exist, every edit in §5.2 and §5.3 must be applied to each.
- [⚠️ INFERRED] The orchestrator model used for Self-Drive in the target project is capable of parsing a verifier response line by line and producing per-check `{label, passed, evidence}` triples. A weak orchestrator model (tiny Haiku / Gemini-Flash tier) may fabricate evidence. The gate's `:` check is a loose regex — it catches missing citations but not hallucinated ones. Mitigation: the run-log UI shows evidence strings so humans can spot hallucinations after the fact. If this becomes a problem in practice, tighten the evidence check to a real file-exists + line-range validation.
- [⚠️ INFERRED] The target project emits verify prompts via a single function the UI calls on Verify-button click. If instead the UI constructs the prompt inline, the preamble must be added wherever that construction happens (and ideally refactored to a shared module).
- [❓ ASSUMED] The target project does not have a "strict mode" toggle for verification. This spec forbids adding one — the failure mode is a skimming verifier, and a toggle would let that same skimming model flip verification off. If the target project's users demand a toggle, revisit the trade-off.
- [⚠️ INFERRED] The preamble text in §4 is optimized for Claude models. If the target project uses a different family (GPT-4o, Gemini, local models), the forbidden-phrase list and contract wording may need tuning based on observed skim patterns.
- [❓ ASSUMED] The target project's test framework can assert on the content of exported string constants (for verifying the preamble body). Vitest/Jest/Node test can; some others cannot. If not, the assertions in §9 become smoke checks rather than unit tests.

---

## Appendix A — Glossary

- **Verifier** — the Claude Code instance (or equivalent LLM) that implements the spec and then runs the verify prompt.
- **Orchestrator** — a separate, smaller LLM call that reads the verifier's response and decides the next autonomous-mode action ("advance", "fix", "pause").
- **Gate** — the client-side validation (`validateVerifyAdvance`) that rejects an orchestrator "advance" verdict when per-check evidence is missing or malformed.
- **Preamble** — the non-negotiable VERIFICATION MODE contract prepended to every verify prompt at runtime.
- **Retrofit** — because the preamble is prepended at runtime (not baked into stored data), guides saved before this change automatically receive the new contract on their next verify click.
- **Checklist** vs. **Audit** — the implementation checklist is a TODO list embedded in the spec (for building); the verification audit is a companion document (for reviewing after building). Both receive the new contract; the audit's contract section is worded more strongly because audit docs are typically 5–10× larger than per-session verify lists.
