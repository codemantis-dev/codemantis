// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Detector Suppressors
// ═══════════════════════════════════════════════════════════════════════
//
// The orchestrator's ACTIVITY-EVIDENCE detectors (A/B/C) and "skimming /
// fabrication" detectors are heuristics. They can fire on a turn that
// actually contains real evidence — the wording just happened to look
// like a fabrication template to a Sonnet-grade orchestrator.
//
// This module runs AFTER the orchestrator returns a decision and acts as
// a sanity guard: if the decision is a "soft verify-evidence" fix
// (driven by a fabrication/skimming detector) but the worker's response
// actually contains enough concrete evidence to cover the failed checks,
// downgrade the decision so Self-Drive doesn't loop on a false signal.
//
// Conservative by design: we ONLY interfere with the fabrication-style
// fix templates. Legitimate fixes (failing tests, real type errors,
// missing files) pass through untouched.

import type { OrchestratorDecision, OrchestratorInput } from "../types/implementation-guide";

/**
 * Heuristic markers of a fabrication / soft-verify-evidence fix prompt.
 * Matches phrases the orchestrator system prompt uses verbatim in its
 * collaborative redo template.
 */
const FABRICATION_FIX_MARKERS = [
  "Two paths forward, pick the one that matches reality",
  "produce the Edit/Write call now",
  "claimed work without doing the work",
  "no edit tools this turn",
  "tool log shows",
  "the work landed in a prior turn",
  // older phrasings retained for compat
  "Your turn claimed",
];

/**
 * Heuristic markers of a "skipped commands" / "didn't run the requested
 * checks" rejection. These are the family of false positives the user
 * complained about: orchestrator pauses claiming the worker skipped
 * the verification commands, when the worker actually provided them in
 * a slightly different format.
 */
const SKIPPED_COMMANDS_MARKERS = [
  "skipped all",
  "skipped the",
  "did not run",
  "didn't run",
  "ran .* instead of",
  "ran full pnpm test instead",
  "instead of the .* evidence command",
];

export interface EvidenceCoverage {
  /** Count of `$ <command>` style lines in the response. */
  shellCommandBlocks: number;
  /** Count of fenced code blocks (``` … ```). */
  fencedCodeBlocks: number;
  /** Count of inline file:line citations like `src/foo.ts:42`. */
  fileLineCitations: number;
  /** Labels (from the input) that appear verbatim or near-verbatim in the response. */
  labelMentions: number;
  /** Total labels considered. */
  totalLabels: number;
  /** labelMentions / totalLabels (0 when totalLabels is 0). */
  labelCoverage: number;
  /** Sum of all concrete-evidence signals. */
  totalEvidenceSignals: number;
}

/**
 * Count concrete evidence signals in the worker's response. Cheap regex —
 * no AST parsing. Designed to be hard to game but tolerant of varied
 * presentation (markdown table, code block, prose with $ prefix).
 */
export function measureEvidenceCoverage(
  response: string,
  labels: string[],
): EvidenceCoverage {
  // `$ <command>` at line start — captures the canonical side-effect form.
  const shellCommandBlocks =
    (response.match(/^\s*(?:\$|>)\s+\S/gm) ?? []).length;

  // Fenced code blocks. Each opening ``` counts once; divide by 2 isn't
  // necessary because we only count opens.
  const fencedCodeBlocks =
    (response.match(/^```/gm) ?? []).length;

  // file:line citations — broad pattern covering ts/tsx/rs/py/sql/md.
  const fileLineCitations =
    (response.match(/\b[\w./@-]+\.(ts|tsx|rs|py|sql|md|json|yaml|yml|toml):\d+/g) ?? []).length;

  // Label mentions: each label counted at most once. Match label first
  // word or first three words verbatim (case-insensitive) — labels are
  // usually short phrases like "Migrations applied" or "Edge Function
  // deployed".
  const seen = new Set<number>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i].trim();
    if (label.length === 0) continue;
    // First three words (or fewer) of the label.
    const firstWords = label.split(/\s+/).slice(0, 3).join(" ");
    if (firstWords.length < 4) continue;
    const escaped = firstWords.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    if (re.test(response)) seen.add(i);
  }
  const labelMentions = seen.size;
  const totalLabels = labels.length;
  const labelCoverage = totalLabels > 0 ? labelMentions / totalLabels : 0;

  return {
    shellCommandBlocks,
    fencedCodeBlocks,
    fileLineCitations,
    labelMentions,
    totalLabels,
    labelCoverage,
    totalEvidenceSignals:
      shellCommandBlocks + fencedCodeBlocks + fileLineCitations + labelMentions,
  };
}

/**
 * Does the decision's fixPrompt look like a fabrication-detector soft
 * verify-evidence prompt (as opposed to a real "this test is failing,
 * fix it" prompt)?
 */
export function isFabricationDetectorFix(decision: OrchestratorDecision): boolean {
  if (decision.action !== "fix") return false;
  const text = (decision.fixPrompt ?? "") + " " + (decision.summary ?? "");
  return FABRICATION_FIX_MARKERS.some((m) => text.includes(m));
}

/**
 * Does the decision's pauseReason or summary look like a "you skipped
 * the commands" rejection (a near-cousin of fabrication detectors)?
 */
export function isSkippedCommandsRejection(decision: OrchestratorDecision): boolean {
  const text = (decision.pauseReason ?? "") + " " + (decision.summary ?? "") +
    " " + (decision.fixPrompt ?? "");
  return SKIPPED_COMMANDS_MARKERS.some(
    (m) => new RegExp(m, "i").test(text),
  );
}

export interface SuppressionResult {
  /** Possibly-mutated decision (same reference if not suppressed). */
  decision: OrchestratorDecision;
  /** Names of suppressors that fired. */
  suppressorsApplied: string[];
  /** The evidence-coverage report used for the decision. */
  coverage: EvidenceCoverage;
}

/**
 * Apply detector suppressors to an orchestrator decision.
 *
 * The orchestrator emits decisions over the worker's last turn. If a
 * "fabrication detector" or "skipped commands" decision fires while the
 * worker's response contains substantial evidence (commands quoted, code
 * blocks, label mentions covering most of the checklist), the decision is
 * a false positive — the orchestrator just didn't recognize the
 * presentation shape. Downgrade so Self-Drive doesn't loop:
 *
 * - Fabrication fix with high evidence coverage → switch to a SOFT
 *   `request_recheck` for the failed items, OR pass through if no
 *   structural issue. We do NOT auto-`advance` because the orchestrator's
 *   `checkResults` may not be reliable in this state.
 * - Skipped-commands pause/fix with high evidence coverage → strip the
 *   fabricated objection from `pauseReason`/`fixPrompt` and ask the
 *   orchestrator to re-evaluate (via a request_recheck for affected items
 *   when we can identify them, otherwise a more permissive fixPrompt).
 *
 * Threshold: `totalEvidenceSignals >= max(3, ceil(failedItemCount * 0.6))`
 * AND `labelCoverage >= 0.6` if labels were provided. Anything below that
 * passes through.
 */
export function applyDetectorSuppressors(
  decision: OrchestratorDecision,
  input: OrchestratorInput,
): SuppressionResult {
  const suppressors: string[] = [];

  // Pull labels from the session's verify checks AND failed checkResults
  // (if any), so we can credit evidence against both "what's on the
  // checklist" and "what the orchestrator flagged as failing".
  const checklistLabels = input.sessionPlan.verifyChecks.map((c) => c.label);
  const failedLabels = (decision.checkResults ?? [])
    .filter((r) => r.passed === false && r.skipped !== true)
    .map((r) => r.label);

  // Prefer failed labels when present (these are what the decision is
  // arguing about); fall back to checklist labels otherwise.
  const labelsForCoverage = failedLabels.length > 0 ? failedLabels : checklistLabels;

  const coverage = measureEvidenceCoverage(
    input.claudeCodeResponse,
    labelsForCoverage,
  );

  // Thresholds — calibrated so a turn with at least a couple of $ blocks
  // OR a couple of code-fenced outputs naming the failed labels is enough.
  const failedCount = Math.max(failedLabels.length, 1);
  const evidenceFloor = Math.max(3, Math.ceil(failedCount * 0.6));
  const evidenceSufficient = coverage.totalEvidenceSignals >= evidenceFloor;
  const labelsSufficient =
    labelsForCoverage.length === 0 || coverage.labelCoverage >= 0.6;
  const suppressionEligible = evidenceSufficient && labelsSufficient;

  // Fabrication-detector suppressor.
  if (isFabricationDetectorFix(decision) && suppressionEligible) {
    suppressors.push("fabrication-detector");
    // Downgrade to a permissive request_recheck so the worker gets ONE
    // gentle nudge to point out which evidence covers which item, rather
    // than a fresh "produce the Edit/Write call" demand.
    const itemsToRecheck =
      failedLabels.length > 0
        ? failedLabels
        : checklistLabels.slice(0, Math.min(3, checklistLabels.length));
    return {
      decision: {
        ...decision,
        action: "request_recheck",
        recheckItems: itemsToRecheck,
        recheckPrompt:
          `The previous response includes ${coverage.totalEvidenceSignals} concrete evidence ` +
          `signals (${coverage.shellCommandBlocks} command line(s), ${coverage.fencedCodeBlocks} code block(s), ` +
          `${coverage.fileLineCitations} file:line citation(s), ${coverage.labelMentions}/${labelsForCoverage.length} label mention(s)). ` +
          `If those signals already cover items ${itemsToRecheck.join(", ")}, restate which signal covers which item — ` +
          `one line per item. Do NOT re-run the commands; just point at the existing block.`,
        summary: `Suppressed fabrication-fix: ${coverage.totalEvidenceSignals} evidence signals present (was: ${decision.summary})`,
        // Wipe the original fabrication fixPrompt to avoid the next turn
        // seeing it in PREVIOUS FIX PROMPTS and re-asking.
        fixPrompt: undefined,
      },
      suppressorsApplied: suppressors,
      coverage,
    };
  }

  // Skipped-commands rejection suppressor.
  if (isSkippedCommandsRejection(decision) && suppressionEligible) {
    suppressors.push("skipped-commands");
    // For a pause: convert to a request_recheck so the user isn't blocked
    // by a false signal. For a fix: same treatment.
    const itemsToRecheck =
      failedLabels.length > 0
        ? failedLabels
        : checklistLabels.slice(0, Math.min(5, checklistLabels.length));
    return {
      decision: {
        ...decision,
        action: "request_recheck",
        recheckItems: itemsToRecheck,
        recheckPrompt:
          `The previous response includes ${coverage.totalEvidenceSignals} evidence signals ` +
          `covering ${coverage.labelMentions}/${labelsForCoverage.length} labels. ` +
          `Match each existing evidence block to the items ${itemsToRecheck.join(", ")} ` +
          `— one line per item, citing the block's location in your prior reply. ` +
          `Do not re-run the commands.`,
        summary: `Suppressed skipped-commands rejection: evidence present (was: ${decision.summary})`,
        pauseReason: undefined,
        blocker: undefined,
        fixPrompt: undefined,
      },
      suppressorsApplied: suppressors,
      coverage,
    };
  }

  return { decision, suppressorsApplied: suppressors, coverage };
}
