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

// ── Plan-review gate ─────────────────────────────────────────────────────────

/** First message to the PRIMARY: draft a plan before writing any code. */
export function buildPlanRequestPrompt(task: string, agentId: AgentId): string {
  return `${clarifier(agentId)}You are the PRIMARY in a Duo-Coding pair, working with a read-only mentor who reviews your work.

Before writing ANY code, outline your approach as a short plan so your mentor can sanity-check it:
- The files you expect to change (and roughly what in each)
- The key steps, in order
- Risks, unknowns, or decisions you're unsure about

Do NOT write or edit code yet — just the plan. Keep it concise.

TASK:
${task}`;
}

/** Ask the MENTOR to review the primary's plan (returns a verdict). */
export function buildPlanReviewPrompt(args: {
  task: string;
  plan: string;
  agentId: AgentId;
}): string {
  return `${clarifier(args.agentId)}You are the MENTOR (read-only). The PRIMARY proposed this PLAN before coding. Review the APPROACH — not code (none written yet). Catch wrong directions, missing steps, risky decisions, or a misread of the task NOW, before effort is spent.

ORIGINAL TASK:
${args.task}

PRIMARY'S PROPOSED PLAN:
${args.plan}

If the approach is sound, set stance to "agree". If it needs changes, set stance to "concern"/"disagree" and put concrete plan corrections in repairTask.

${VERDICT_FORMAT_INSTRUCTION}`;
}

/** Tell the PRIMARY the plan is approved — start implementing. */
export function buildImplementPrompt(agentId: AgentId): string {
  return `${clarifier(agentId)}Your mentor approved the plan. Implement it now. Your mentor will review your changes continuously as you work and may send brief course-corrections — incorporate them as you go.`;
}

/** Tell the PRIMARY to revise its plan per the mentor's feedback (still no code). */
export function buildPlanRevisePrompt(args: {
  feedback: string;
  rationale: string;
  agentId: AgentId;
}): string {
  return `${clarifier(args.agentId)}Your mentor reviewed your plan and wants changes before you start coding:

CHANGES REQUESTED: ${args.feedback}
REASONING: ${args.rationale}

Revise your plan accordingly and re-share it. Still do NOT write code yet.`;
}

// ── Continuous (incremental) co-review ───────────────────────────────────────

/** Ask the MENTOR for a quick mid-work review of the diff so far. */
export function buildIncrementalReviewPrompt(args: {
  task: string;
  diff: string;
  agentId: AgentId;
}): string {
  const diff = args.diff.trim() || "(no changes in the working tree yet)";
  return `${clarifier(args.agentId)}You are the MENTOR (read-only), pair-reviewing WHILE the PRIMARY is still actively working — like a navigator watching the driver. This is a quick check, not the final review.

ORIGINAL TASK:
${args.task}

DIFF SO FAR (work in progress):
${diff}

Flag ONLY concrete, already-visible defects worth interrupting for right now — e.g. a wrong variable, a missing/mismatched bracket, an undefined symbol, a clearly wrong API call, or a deviation from the task. Be terse. DEFER style, polish, naming, and "could be improved" notes to the final review (set stance "agree" if there's nothing blocking yet). Open the changed files / run a quick check if useful.

If you see a clear defect, set stance to "concern" (or "disagree") with a ONE-LINE, specific repairTask the primary can act on without stopping.

${VERDICT_FORMAT_INSTRUCTION}`;
}

/** Concise mid-turn nudge injected into the PRIMARY (does not start a new turn). */
export function buildNudgePrompt(repairTask: string, agentId: AgentId): string {
  return `${clarifier(agentId)}⚠️ Mentor (live): ${repairTask}`;
}
