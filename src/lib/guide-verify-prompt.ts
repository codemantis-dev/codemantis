// ═══════════════════════════════════════════════════════════════════════
// Shared verify prompt builders for Guide sessions
// Used by GuideSessionCard (single session) and Super-Bro (all sessions)
// ═══════════════════════════════════════════════════════════════════════

interface SessionForVerify {
  index: number;
  name: string;
  verifyChecks: {
    label: string;
    kind?: "static" | "side-effect" | "behavioral" | "integration";
  }[];
  verificationPrompt?: string | null;
}

/**
 * Thoroughness enforcement preamble.
 * Prepended to EVERY verify prompt we emit — both dedicated
 * verificationPrompts from the spec AND the fallback checklist form.
 *
 * Lives here (not in spec-prompts.ts) so that guides already stored in
 * the DB with older, weaker verificationPrompt strings get the new
 * contract retroactively on their next verify click — no migration.
 */
export const VERIFY_MODE_PREAMBLE = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERIFICATION MODE — READ BEFORE DOING ANYTHING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are now in verification mode, not implementation mode. Your job
is to OPEN FILES or RUN COMMANDS and REPORT EVIDENCE — not to fix
things, not to summarize, not to infer.

THE CONTRACT (evidence form depends on the item's [kind] tag):
- [static] — default. Every PASS must cite {file}:{lines} AND quote
  the exact code line(s). FAIL must also cite file:lines and quote
  the failing line(s). Open files with the Read tool.
- [side-effect] — effect on an external system (DB, API, deploy, fs
  mutation). A file is NOT evidence — it merely describes the
  intended effect. Evidence must be COMMAND OUTPUT: run the command
  and quote stdout / query result / HTTP status. Use this form:
    $ {command}
    {quoted output lines}
  PASS requires concrete output showing the effect. FAIL quotes the
  error or missing-row result.
- [behavioral] — a passing test or running behavior. Run the test
  and quote the PASS line or assertion. MANDATORY MOCK DISCLOSURE:
  every [behavioral] PASS line MUST append \`· mocks={comma list or
  "none"}\` naming what the test mocks. If any listed mock crosses a
  system boundary (HTTP client, DB client, external API, queue,
  Edge Function dispatcher), this PASS is NOT sufficient on its own —
  a paired [integration] item covering that boundary is required.
  A [behavioral] PASS with a boundary-crossing mock but no paired
  [integration] PASS is a contract violation → mark the item FAIL.
  Example evidence:
    $ pnpm test -- foo.test.ts
    ✓ does the thing (12ms) · mocks=httpClient,fsWrite
- [integration] — a cross-system call proven end-to-end. Evidence MUST
  contain THREE parts on one line: the caller site, the handler site,
  and a real non-mocked invocation with its observable output. Use:
    caller={file}:{lines} · handler={file}:{lines} · $ {real command} → {quoted output}
  The handler MUST exist as real code (not a stub, not a TODO, not
  a "NotImplemented", not an "unknown action" default branch). If
  the handler is missing, or if the handler file contains a marker
  such as "until then … will return an error", the item is FAIL —
  regardless of any passing test. This is the kind that exists to
  catch the "mocked green, production broken" failure mode.

COMMON RULES:
- You may NEVER emit "all X pass", "looks fine", "should work",
  "everything checks out", "LGTM", or any batch-assurance language.
- If you cannot verify an item (file unreadable, command requires
  privileges you don't have, scope unclear), emit
  "SKIPPED — {one-line reason}". Skipping honestly is GOOD.
  Faking PASS is a contract violation.
- Do not run fixes during verification. Report first. Fix second.

OUTPUT FORMAT — one line per item, exactly this shape:
  {N}. {item label} — PASS|FAIL|SKIPPED|N/A — {evidence}
  where {evidence} is either {file}:{lines} — {quoted code}                  (static)
                          OR $ {command} → {quoted output}                    (side-effect)
                          OR {test}:{line} — {quoted assert} · mocks={list}   (behavioral)
                          OR caller={file}:{lines} · handler={file}:{lines} · $ {cmd} → {output}  (integration)

ALTERNATIVE EVIDENCE SHAPES (all accepted — Phase C.2):
The shapes above are CANONICAL but not the only accepted forms. The
verifier (you) may present concrete evidence in ANY of these equivalent
shapes, and the orchestrator will credit them:

  A) Inline form: \`$ {command} → {quoted output}\` on one line.
  B) Code-block form: a fenced \`\`\` block immediately following the item
     line, containing the command (with leading \`$ \` or \`> \`) and its
     output.
  C) Markdown-table form: a small table with columns (command | output)
     when grouping multiple commands for one item.
  D) Prose form: a paragraph that contains BOTH the command (anywhere)
     AND the observable result (anywhere) for the same item. Required
     elements: the literal command string OR a clear reference to it,
     and the output / status / row count.

Whatever shape you use, KEEP the per-item line ("{N}. {label} —
PASS|FAIL|SKIPPED|N/A — …") so the orchestrator can locate each verdict.
The orchestrator's semantic evidence parser scans for command markers,
file:line citations, fenced blocks, and label proximity — it does NOT
require the exact \`$ cmd → output\` literal shape.

PACING (prevents context rushing):
- Process items in BATCHES OF 10.
- After each batch of 10, emit a running tally:
    "--- Batch {k} complete: PASS n · FAIL n · SKIPPED n · remaining n ---"
  then continue to the next batch in the same response.
- If you catch yourself wanting to emit "the rest all pass" or merge
  multiple items into one line — STOP. That is the failure mode this
  preamble exists to prevent. Do one item properly, on its own line,
  then the next.

FORBIDDEN PHRASES (their presence means you skimmed — retract and redo):
- "all the remaining items pass"
- "the rest look correct"
- "based on the code I've already seen"
- "I'll assume the pattern holds"
- "LGTM" / "looks good" / "should work"

FINAL LINE — always emit, always last:
  Verified X/Y items | PASS: a | FAIL: b | SKIPPED: c | N/A: d
  If X != Y, explain the delta in one sentence.

RETROACTIVE NOTICE — applies to guides that were marked PASS under
an older contract that did not enforce mock disclosure or the
[integration] dual-side rule:
  Every [behavioral] and [side-effect] item below must be re-verified
  against THIS contract before its prior PASS is honoured. A prior
  green check built on a mocked boundary is no longer trustworthy.
  Re-run this session's checklist from scratch.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

/**
 * Build a verification prompt for a single guide session.
 *
 * The authoritative list is session.verifyChecks. The orchestrator
 * validates the response against those exact labels, so every check
 * MUST be answered — including when a custom verificationPrompt is set.
 *
 * When session.verificationPrompt is present we include it as extra
 * guidance above the mandatory checklist. It describes *how* to verify;
 * the checklist describes *what* must be answered. Prior behavior
 * replaced the checklist with verificationPrompt, which silently dropped
 * checks and caused the orchestrator to pause with "verifier did not
 * produce evidence for all items" every time the two were out of sync.
 */
export function buildSessionVerifyPrompt(
  session: SessionForVerify,
  specFilename: string,
): string {
  const total = session.verifyChecks.length;

  if (total === 0) {
    // No checklist. Fall back to a dedicated verificationPrompt if any,
    // otherwise the minimal typecheck/tests form.
    if (session.verificationPrompt) {
      return `${VERIFY_MODE_PREAMBLE}\n${session.verificationPrompt}`;
    }
    return `${VERIFY_MODE_PREAMBLE}
Verify Session ${session.index}: ${session.name} of the spec in docs/specs/${specFilename}.

This session has no explicit verify checks. At minimum:
- Run \`pnpm tsc --noEmit\` and quote the final output line as evidence.
- Run the test suite if one is configured.

End with the final accounting line described in the preamble.`;
  }

  const numbered = session.verifyChecks
    .map((c, i) => `${i + 1}. [${c.kind ?? "static"}] ${c.label}`)
    .join("\n");

  // When a custom verificationPrompt is set, include it as guidance above
  // the mandatory checklist. The checklist is never dropped — the
  // orchestrator strictly validates against its labels.
  const guidanceBlock = session.verificationPrompt
    ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GUIDANCE (from the session's verification prompt — describes HOW to verify).
Use it alongside the MANDATORY CHECKLIST below; do NOT stop after
answering only the guidance. Every numbered checklist item must still
receive its own PASS/FAIL/SKIPPED/N/A line.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${session.verificationPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY CHECKLIST — ${total} items. Answer every one below.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
    : "";

  return `${VERIFY_MODE_PREAMBLE}
Verify the implementation for Session ${session.index}: ${session.name} of the spec in docs/specs/${specFilename}.
${guidanceBlock}
Items to verify (${total} total) — report PASS or FAIL for each. The
[kind] tag on each item dictates what kind of evidence is required
(see the preamble):
${numbered}

For each numbered item above:
1. If [static]: open the file(s) referenced and read the code.
   If [side-effect]: run the relevant command (query, HTTP call,
   build/deploy) and capture its OUTPUT. Do not cite a source file.
   If [behavioral]: run the test(s) and capture the PASS/assertion line.
2. Emit ONE line in the format from the preamble matching the kind.
3. After every 10 items, emit the running tally described in the preamble.
4. End with the final accounting line.

Do NOT batch. Do NOT assume. Do NOT summarize instead of verifying.`;
}

/**
 * Build a verification prompt covering all guide sessions at once.
 * Used by Super-Bro when guide_session_complete fires (all sessions done).
 */
export function buildGuideCompleteVerifyPrompt(
  sessions: SessionForVerify[],
  specFilename: string,
  auditFilename: string | null,
): string {
  const sessionsWithChecks = sessions.filter(
    (s) => s.verifyChecks.length > 0,
  );

  if (sessionsWithChecks.length === 0) {
    return `${VERIFY_MODE_PREAMBLE}
Verify the complete implementation of the spec in docs/specs/${specFilename}.
Run \`pnpm tsc --noEmit\` and confirm there are no TypeScript errors.
Quote the final output line of the compiler as evidence.`;
  }

  // Number items globally across sessions so the final tally makes sense.
  let n = 0;
  const sessionBlocks = sessionsWithChecks
    .map((s) => {
      const lines = s.verifyChecks
        .map((c) => {
          n += 1;
          return `${n}. [S${s.index}] [${c.kind ?? "static"}] ${c.label}`;
        })
        .join("\n");
      return `### Session ${s.index}: ${s.name}\n${lines}`;
    })
    .join("\n\n");
  const total = n;

  const auditLine = auditFilename
    ? `\n\nAlso read the Verification Audit at docs/specs/${auditFilename}. Its VERIFY directives are ADDITIONAL items subject to the same contract — continue numbering from ${total + 1}.`
    : "";

  return `${VERIFY_MODE_PREAMBLE}
Verify the complete implementation of the spec in docs/specs/${specFilename}.

Total items to verify across all sessions: ${total}${auditFilename ? " (plus audit directives — see below)" : ""}.

${sessionBlocks}

EXECUTION PLAN:
- Process items in batches of 10.
- For each item: open the referenced file, read the code, emit one
  line in the format from the preamble, then move on.
- After each batch: emit the running tally.
- If you find yourself wanting to batch-PASS a range (e.g. "items
  40–60 all pass"), STOP. That is the exact failure mode forbidden
  above. Do them one by one or mark SKIPPED with a reason.
- End with the final accounting line: Verified X/Y | PASS/FAIL/SKIPPED.${auditLine}`;
}
