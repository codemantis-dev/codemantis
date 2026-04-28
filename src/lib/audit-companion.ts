/**
 * Normalize the audit body so it references the actual saved spec filename.
 *
 * The LLM produces audits from a system prompt template that includes
 * `**Companion to:** \`docs/specs/<SPEC_FILENAME>\``. Sometimes the LLM also
 * hallucinates its own filename ("docs/specs/foo-nextjs.md") even when given
 * the token. Either way, the spec file the user actually saves is the source
 * of truth — substitute the token and rewrite any hallucinated path so the
 * audit document, the Implementation Guide, and Self-Drive verification
 * prompts all agree.
 */
export function normalizeAuditCompanion(auditContent: string, specFilename: string): string {
  let result = auditContent;
  // 1) Token swap: <SPEC_FILENAME> → actual filename.
  result = result.replace(/<SPEC_FILENAME>/g, specFilename);
  // 2) Safety net: any other `**Companion to:** \`docs/specs/<...>.md\``
  //    line that doesn't already point at the saved spec gets corrected.
  result = result.replace(
    /(\*\*Companion to:\*\*\s*`docs\/specs\/)([\w.-]+\.md)(`)/g,
    (_match, prefix, _existing, suffix) => `${prefix}${specFilename}${suffix}`,
  );
  return result;
}
