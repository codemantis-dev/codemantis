// ═══════════════════════════════════════════════════════════════════════
// Recovery Prompt Builder
//
// When Self-Drive pauses on a real blocker (migration mismatch, missing
// credentials, permission denied, …) the next turn after Resume is a
// *recovery verification*: we ask Claude Code to prove the original
// blocker is actually gone — before advancing through the rest of the
// session. Evidence must be command output, not file citations: a file
// that *requests* an effect is not proof the effect happened.
// ═══════════════════════════════════════════════════════════════════════

import type { Blocker, BlockerKind } from "../types/implementation-guide";

/**
 * Shared preamble for every recovery prompt.
 *
 * Enforces the same "no batch-PASS, quoted evidence" contract as
 * VERIFY_MODE_PREAMBLE, but tuned for *side-effect* evidence: the thing
 * we need is command output / query rows, not source code.
 */
export const RECOVERY_MODE_PREAMBLE = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOVERY VERIFICATION — READ BEFORE DOING ANYTHING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Self-Drive paused because of a concrete blocker. Before continuing the
session, your ONLY job is to confirm the blocker is actually resolved.

THE CONTRACT:
- Do NOT run the rest of the session. Do NOT try to advance.
- Do NOT argue that the blocker "probably" no longer applies. Verify.
- Run the specific commands below and QUOTE their output verbatim.
- A source file that *requests* an effect is NOT evidence. Evidence is
  stdout / query rows / HTTP status that prove the effect happened.
- If the blocker is still present, say so plainly and list the exact
  output line(s) that prove it. Do not try to fix it yourself unless
  told to.
- Forbidden: "looks resolved", "should be fine now", "I'll assume",
  "LGTM". If you catch yourself writing that, delete and quote output
  instead.

OUTPUT FORMAT:
  1. Run the listed command(s).
  2. Emit one block per command:
       $ {command}
       {quoted output, trimmed to the few lines that matter}
  3. End with exactly one line:
       RECOVERY STATUS: RESOLVED | NOT-RESOLVED | NEEDS-USER
     and a one-sentence justification that references the quoted output.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

/**
 * Return the kind-specific "what to run, what to quote" body.
 * Exported so tests can snapshot each variant.
 */
export function recoveryBodyForKind(kind: BlockerKind): string {
  switch (kind) {
    case "infra-state-drift":
      return `Check for infrastructure state drift:
- If Supabase: run \`supabase migration list\` AND \`supabase db push --dry-run\`. Quote the header + the relevant rows.
- If a git deploy: run \`git status\` and \`git log --oneline -5\`, quote both.
- If a schema mismatch: run the query that reads the target table / column from the live system and quote the result.
Do not rely on the migration FILE or a local plan — quote the output that shows REMOTE state matches LOCAL state.`;

    case "permissions":
      return `Confirm permissions are now sufficient:
- Re-attempt the operation that previously denied (push, write, deploy).
- Quote the success line, OR quote the current permission-denied error (indicating NOT-RESOLVED).
A "it should work now" without a re-attempt is NOT-RESOLVED.`;

    case "missing-deps":
      return `Confirm the missing dependency is now available:
- Run the tool with \`--version\` AND run a no-op command that previously failed.
- Quote both outputs. Version numbers matter — if the version is still too old, NOT-RESOLVED.`;

    case "credentials":
      return `Confirm credentials work WITHOUT exposing them:
- Make ONE read-only call that requires the credential (e.g. \`gh auth status\`, a \`SELECT 1\` through the client, a safe GET).
- Quote the success response or error. NEVER print the key/token itself.
Missing or wrong key should surface as a clear error in the quoted output.`;

    case "env-config":
      return `Confirm env/config values are present and valid:
- Run \`printenv {VAR}\` (or the equivalent) for each missing variable — quote presence, NOT the value if it's secret.
- For config files, quote the specific line / field that was wrong before.
- Then re-attempt the operation that previously failed and quote its first few output lines.`;

    case "user-decision":
      return `Confirm the user's decision has been applied:
- Echo back the decision as stated (one sentence).
- Run any command / check that proves the decision is in effect (e.g. the new file exists, the flag is set, the chosen approach is wired up). Quote it.
- If the decision requires code changes and those haven't been made yet, that is NOT-RESOLVED.`;

    case "external-failure":
      return `Confirm the external service is reachable again:
- Make ONE minimal request (curl, ping, provider-specific health check).
- Quote the status line / response. Timeouts, 5xx, or rate-limit headers = NOT-RESOLVED.`;

    case "unknown":
    default:
      return `Confirm the blocker is no longer present:
- Re-run the command that failed previously and quote its output.
- If you cannot identify the original failing command, state that plainly — answer NEEDS-USER.
Do not infer resolution from unrelated activity.`;
  }
}

/**
 * Build a recovery-verification prompt sent to Claude Code on Resume.
 *
 * Shape:
 *   [preamble]
 *   Blocker summary + resolution criteria
 *   User's stated resolution (so Claude knows what was attempted)
 *   Kind-specific "what to run, what to quote" body
 *   Final status line requirement
 */
export function buildRecoveryVerifyPrompt(
  blocker: Blocker,
  userResolution: string,
): string {
  const resolutionLine = userResolution.trim().length > 0
    ? userResolution.trim()
    : "(user did not specify — verify the current state anyway)";

  return `${RECOVERY_MODE_PREAMBLE}
BLOCKER (${blocker.kind}): ${blocker.summary}

RESOLUTION CRITERIA (this must be true before continuing):
${blocker.resolutionCriteria}

USER STATES THEY DID:
${resolutionLine}

${recoveryBodyForKind(blocker.kind)}

End your response with the final status line described in the preamble.`;
}
