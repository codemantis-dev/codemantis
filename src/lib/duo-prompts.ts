/**
 * duo-prompts — the prompts the orchestrator injects into the two CLI sessions.
 *
 * - Review/dialogue prompts go to the READ-ONLY mentor; they always demand a
 *   fenced `duo-verdict` block (parsed by `duo-verdict.ts`) and insist the
 *   mentor run the build/tests ITSELF rather than trust the primary (the core
 *   anti-fabrication rule).
 * - Repair prompts go to the PRIMARY (sole writer); the mentor never edits.
 *
 * Agent-aware: a small Codex vocabulary clarifier is prepended for Codex, the
 * same approach as `build-mode-preamble.ts`.
 */

import type { AgentId } from "../types/agent-events";

export interface ReviewPromptArgs {
  /** The original user task the primary is working on. */
  task: string;
  /** Everything the primary said in its last turn. */
  primaryResponse: string;
  /** Git diff (or numstat summary) of the working tree since the last review. */
  diff: string;
  /** Tool operations the primary performed this turn (Activity Feed labels). */
  toolsUsed: string[];
  /** The mentor's agent kind, for vocabulary. */
  agentId: AgentId;
}

export interface RepairPromptArgs {
  repairTask: string;
  rationale: string;
  agentId: AgentId;
}

export interface DialogueToPrimaryArgs {
  concern: string;
  rationale: string;
  round: number;
  agentId: AgentId;
}

export interface DialogueToDuoArgs {
  primaryResponse: string;
  round: number;
  agentId: AgentId;
}

const CODEX_CLARIFIER =
  "(Note: in this app, your replies stream to a reviewer dashboard. Use plain prose plus the requested fenced block.)\n\n";

/** Shared description of the required verdict block — kept in lockstep with `parseDuoVerdict`. */
export const VERDICT_FORMAT_INSTRUCTION = `End your reply with EXACTLY this fenced block (no prose after it):

\`\`\`duo-verdict
{
  "stance": "agree" | "concern" | "disagree",
  "severity": "blocking" | "advisory" | "nit",
  "summary": "<one sentence>",
  "rationale": "<why>",
  "repairTask": "<concrete fix instructions, omit if stance=agree>",
  "confidence": 0.0,
  "ranBuild": true | false,
  "ranTests": true | false,
  "checkResults": "<what the build/tests actually printed>",
  "citedFiles": ["path/one.ts"]
}
\`\`\`

Severity guidance: "blocking" = must fix before this work is acceptable; "advisory" = worth improving but not urgent; "nit" = trivial. Only "blocking" concerns/disagreements interrupt the primary.`;

function clarifier(agentId: AgentId): string {
  return agentId === "codex" ? CODEX_CLARIFIER : "";
}

/** Review prompt for the mentor after a primary turn. */
export function buildReviewPrompt(args: ReviewPromptArgs): string {
  const tools = args.toolsUsed.length
    ? args.toolsUsed.join(", ")
    : "(none reported)";
  const diff = args.diff.trim() || "(no changes detected in the working tree)";
  return `${clarifier(args.agentId)}You are the MENTOR in a Duo-Coding pair. You are READ-ONLY: never edit files. Your job is to independently verify the PRIMARY agent's latest work and decide whether it is acceptable.

ORIGINAL TASK:
${args.task}

WHAT THE PRIMARY SAID THIS TURN:
${args.primaryResponse}

TOOLS THE PRIMARY USED: ${tools}

DIFF OF THE WORKING TREE SINCE THE LAST REVIEW:
${diff}

Do NOT take the primary's claims at face value. Open the changed files yourself, reason about correctness/edge-cases/security, and RUN the build and tests yourself to confirm they actually pass. Base your verdict on what you observe, not on what the primary asserts.

${VERDICT_FORMAT_INSTRUCTION}`;
}

/** Repair directive injected into the PRIMARY when the mentor flags a blocking issue. */
export function buildRepairPrompt(args: RepairPromptArgs): string {
  return `${clarifier(args.agentId)}Your Duo mentor reviewed your last turn and flagged a blocking issue you need to fix now.

ISSUE: ${args.rationale}

REQUESTED FIX:
${args.repairTask}

Apply the fix, then briefly explain what you changed and confirm the build/tests pass.`;
}

/** Mentor's concern, injected into the PRIMARY to open/continue a dialogue round. */
export function buildDialogueToPrimaryPrompt(args: DialogueToPrimaryArgs): string {
  return `${clarifier(args.agentId)}Your Duo mentor (round ${args.round}) raised a concern about your approach:

CONCERN: ${args.concern}
REASONING: ${args.rationale}

Either address it, or explain why your current approach is correct. Be specific and concise.`;
}

/** Primary's reply, injected back into the MENTOR to continue the dialogue. */
export function buildDialogueToDuoPrompt(args: DialogueToDuoArgs): string {
  return `${clarifier(args.agentId)}Dialogue round ${args.round}. The PRIMARY responded to your concern:

${args.primaryResponse}

Decide whether this resolves your concern. If it does, set stance to "agree". If not, restate the concern with a concrete repairTask. Re-run any checks needed to be sure.

${VERDICT_FORMAT_INSTRUCTION}`;
}

/** Re-ask used once when the mentor's response had no parseable verdict block. */
export function buildReAskPrompt(): string {
  return `Your previous reply did not include a valid duo-verdict block, so it could not be processed. Please re-send ONLY your verdict.

${VERDICT_FORMAT_INSTRUCTION}`;
}
