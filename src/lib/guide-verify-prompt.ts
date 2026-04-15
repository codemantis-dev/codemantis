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
 * Build a verification prompt for a single guide session.
 * Prefers the session's dedicated verification prompt when present,
 * otherwise falls back to building one from the verify checklist.
 */
export function buildSessionVerifyPrompt(
  session: SessionForVerify,
  specFilename: string,
  auditFilename: string | null,
): string {
  const auditLine = auditFilename
    ? `\n\nAlso read the Verification Audit at docs/specs/${auditFilename} and use it as a checklist for thorough verification.`
    : "";

  if (session.verificationPrompt) {
    return session.verificationPrompt + auditLine;
  }

  const checksText = session.verifyChecks
    .map((c) => `- ${c.label}`)
    .join("\n");

  return `Verify the implementation for Session ${session.index}: ${session.name} of the spec in docs/specs/${specFilename}.

Check each of the following items and report PASS or FAIL for each:
${checksText}

For each item, open the relevant files, read the actual code, and verify. Report your findings.${auditLine}`;
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
    return `Verify the complete implementation of the spec in docs/specs/${specFilename}. Run \`pnpm tsc --noEmit\` and confirm there are no TypeScript errors.`;
  }

  const sessionBlocks = sessionsWithChecks
    .map((s) => {
      const checks = s.verifyChecks.map((c) => `- ${c.label}`).join("\n");
      return `Session ${s.index}: ${s.name}\n${checks}`;
    })
    .join("\n\n");

  const auditLine = auditFilename
    ? `\n\nAlso read the Verification Audit at docs/specs/${auditFilename} and use it as a checklist for thorough verification.`
    : "";

  return `Verify the complete implementation of the spec in docs/specs/${specFilename}.

Check each of the following items and report PASS or FAIL for each:

${sessionBlocks}

For each item, open the relevant files, read the actual code, and verify. Report your findings.${auditLine}`;
}
