// ═══════════════════════════════════════════════════════════════════════
// Shared verify prompt builders for Guide sessions
// Used by GuideSessionCard (single session) and Super-Bro (all sessions)
// ═══════════════════════════════════════════════════════════════════════

interface SessionForVerify {
  index: number;
  name: string;
  verifyChecks: { label: string }[];
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
is to OPEN FILES and REPORT EVIDENCE — not to fix things, not to
summarize, not to infer.

THE CONTRACT:
- Every item requires a file open (Read tool) before you report on it.
- Every PASS must cite path:line_range and quote the exact code line(s).
- Every FAIL must cite path:line_range and quote the code that proves it fails.
- You may NEVER emit "all X pass", "looks fine", "should work",
  "everything checks out", "LGTM", or any batch-assurance language.
- If you cannot verify an item (file unreadable, scope unclear, too
  expensive to check), emit "SKIPPED — {one-line reason}". Skipping
  honestly is GOOD. Faking PASS is a contract violation.
- Do not run fixes during verification. Report first. Fix second.

OUTPUT FORMAT — one line per item, exactly this shape:
  {N}. {item label} — PASS|FAIL|SKIPPED|N/A — {file}:{lines} — {quoted evidence or reason}

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

/**
 * Build a verification prompt for a single guide session.
 * Always prepends VERIFY_MODE_PREAMBLE. Prefers the session's dedicated
 * verification prompt when present; otherwise builds one from the
 * verify checklist.
 */
export function buildSessionVerifyPrompt(
  session: SessionForVerify,
  specFilename: string,
  auditFilename: string | null,
): string {
  const auditLine = auditFilename
    ? `\n\nAlso read the Verification Audit at docs/specs/${auditFilename} and use it as a checklist. Every VERIFY directive in it is subject to the same evidence contract above.`
    : "";

  // Always prepend the preamble — even when using a stored verificationPrompt.
  // This retrofits old DB guides whose stored prompt text predates the contract.
  if (session.verificationPrompt) {
    return `${VERIFY_MODE_PREAMBLE}\n${session.verificationPrompt}${auditLine}`;
  }

  const total = session.verifyChecks.length;

  if (total === 0) {
    return `${VERIFY_MODE_PREAMBLE}
Verify Session ${session.index}: ${session.name} of the spec in docs/specs/${specFilename}.

This session has no explicit verify checks. At minimum:
- Run \`pnpm tsc --noEmit\` and quote the final output line as evidence.
- Run the test suite if one is configured.

End with the final accounting line described in the preamble.${auditLine}`;
  }

  const numbered = session.verifyChecks
    .map((c, i) => `${i + 1}. ${c.label}`)
    .join("\n");

  return `${VERIFY_MODE_PREAMBLE}
Verify the implementation for Session ${session.index}: ${session.name} of the spec in docs/specs/${specFilename}.

Items to verify (${total} total) — report PASS or FAIL for each:
${numbered}

For each numbered item above:
1. Open the file(s) the item refers to (use the Read tool).
2. Read the actual code that implements the item.
3. Emit ONE line in this exact format:
     {N}. {item} — PASS|FAIL|SKIPPED|N/A — {file}:{lines} — {quoted code or reason}
4. After every 10 items, emit the running tally described in the preamble.
5. End with the final accounting line.

Do NOT batch. Do NOT assume. Do NOT summarize instead of verifying.${auditLine}`;
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
          return `${n}. [S${s.index}] ${c.label}`;
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
