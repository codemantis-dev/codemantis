// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Deterministic Loop Guard
// ═══════════════════════════════════════════════════════════════════════
//
// Detects the failure mode where the orchestrator keeps asking for the
// same verify item across rounds, with paraphrased command wording, while
// the worker has already provided concrete evidence for it. The
// orchestrator's prose "repeat-pattern" gate (in self-drive-orchestrator.ts)
// only catches exact command matches; this module looks at the semantics:
//
//   - How many times has this LABEL been demanded across recheck rounds?
//   - How many distinct evidence blocks (command output, code block,
//     file:line citation) has the worker produced that mention this label?
//
// Based on those two numbers it returns one of:
//
//   - "fresh"   — first or second time we've seen this label; let the
//                 normal recheck path run.
//   - "accept"  — label asked ≥2 times AND worker provided evidence ≥2
//                 times. Repeated provision is an implicit "I already
//                 showed you" — credit it and stop looping.
//   - "pause"   — label asked ≥3 times AND worker still hasn't shown
//                 evidence. Genuine impasse; pause with a satisfiable
//                 blocker (the caller composes one).
//
// All inputs are plain data — easy to test and easy to call from
// selfDriveStore.handleRecheck without coupling to Zustand state.

import { measureEvidenceCoverage } from "./self-drive-detector-suppressors";

export type LoopGuardVerdict = "fresh" | "accept" | "pause";

export interface LoopGuardInput {
  /** The verify-check label currently under contention. */
  label: string;
  /**
   * Recheck/fix prompts the orchestrator has previously sent. Newest last.
   * The guard scans these for label fingerprints to count "asks per label".
   */
  priorPrompts: string[];
  /**
   * Worker responses (most recent first OR most recent last — order doesn't
   * matter; we count distinct evidence blocks across all of them).
   */
  priorResponses: string[];
  /** The current draft prompt the orchestrator is about to emit. */
  currentDraft?: string;
}

export interface LoopGuardReport {
  verdict: LoopGuardVerdict;
  /** How many times this label has appeared in the orchestrator's asks. */
  askCount: number;
  /** Concrete evidence signals across all worker responses mentioning this label. */
  evidenceSignalsForLabel: number;
  /** Total evidence blocks (any kind) across all responses. */
  totalEvidenceSignals: number;
  /** A one-line reason that the caller can log / show in UI. */
  reason: string;
}

/**
 * Normalize a label for fuzzy matching. Strips kind suffix tags like
 * "[side-effect]", lowercases, collapses whitespace.
 */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\[[a-z-]+\]/g, "") // strip [side-effect] etc.
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Count how many times the orchestrator has asked about this label across
 * prior prompts plus the current draft. A "mention" is any substring match
 * of the first 3-word prefix of the normalized label OR a regex match of
 * the whole normalized label.
 */
function countAsks(label: string, priorPrompts: string[], currentDraft?: string): number {
  const norm = normalizeLabel(label);
  if (norm.length < 3) return 0;
  const firstThree = norm.split(" ").slice(0, 3).join(" ");
  if (firstThree.length < 3) return 0;
  const escaped = firstThree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "i");

  let count = 0;
  for (const prompt of priorPrompts) {
    if (re.test(prompt)) count++;
  }
  if (currentDraft && re.test(currentDraft)) count++;
  return count;
}

/**
 * Count concrete evidence signals in worker responses that mention this
 * label. We require the label mention AND at least one evidence signal in
 * the same response (not just somewhere in the conversation).
 */
function countEvidenceForLabel(label: string, responses: string[]): {
  forLabel: number;
  total: number;
} {
  const norm = normalizeLabel(label);
  if (norm.length < 3) return { forLabel: 0, total: 0 };
  const firstThree = norm.split(" ").slice(0, 3).join(" ");
  const escaped = firstThree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "i");

  let forLabel = 0;
  let total = 0;
  for (const response of responses) {
    const coverage = measureEvidenceCoverage(response, [label]);
    total += coverage.totalEvidenceSignals;
    if (re.test(response) && coverage.totalEvidenceSignals > 0) {
      forLabel++;
    }
  }
  return { forLabel, total };
}

/**
 * Decide whether Self-Drive is in a recheck loop for this label, and if
 * so what to do. Pure function — caller owns side effects.
 */
export function detectEvidenceLoop(input: LoopGuardInput): LoopGuardReport {
  const askCount = countAsks(input.label, input.priorPrompts, input.currentDraft);
  const { forLabel, total } = countEvidenceForLabel(input.label, input.priorResponses);

  // First / second ask is normal — let the recheck path run.
  if (askCount < 2) {
    return {
      verdict: "fresh",
      askCount,
      evidenceSignalsForLabel: forLabel,
      totalEvidenceSignals: total,
      reason: `First ask for "${input.label}" — let recheck proceed`,
    };
  }

  // Repeated ask + repeated evidence provision → accept. Repeated provision
  // is an implicit "I already showed you" and the cost of accepting once is
  // bounded; the cost of looping is not.
  if (askCount >= 2 && forLabel >= 2) {
    return {
      verdict: "accept",
      askCount,
      evidenceSignalsForLabel: forLabel,
      totalEvidenceSignals: total,
      reason:
        `Label "${input.label}" asked ${askCount} times; worker provided evidence ` +
        `for it in ${forLabel} prior responses. Accepting per loop-guard.`,
    };
  }

  // Asked 3+ times with no concrete evidence: genuine impasse. The
  // orchestrator may be using a phrasing the worker can't satisfy; force a
  // pause so the user can intervene.
  if (askCount >= 3 && forLabel === 0) {
    return {
      verdict: "pause",
      askCount,
      evidenceSignalsForLabel: forLabel,
      totalEvidenceSignals: total,
      reason:
        `Label "${input.label}" asked ${askCount} times; worker has not produced ` +
        `any concrete evidence for it. Pausing for user review.`,
    };
  }

  // Asked 2 times, evidence < 2 — give it one more recheck round, but
  // signal "fresh" so the caller knows we're getting close.
  return {
    verdict: "fresh",
    askCount,
    evidenceSignalsForLabel: forLabel,
    totalEvidenceSignals: total,
    reason:
      `Label "${input.label}" asked ${askCount} times; ${forLabel} evidence ` +
      `provision(s) so far. One more recheck round allowed.`,
  };
}

/**
 * Apply the loop guard across an array of recheck labels. Splits them
 * into three buckets the caller can act on:
 *
 *   - `accept`  — pass these straight to the advance gate as forced-accept
 *                 (mark passed:true with a synthesized evidence string).
 *   - `proceed` — let the normal recheck round run for these.
 *   - `pause`   — abort the recheck and pause; labels here are
 *                 genuinely stuck.
 */
export interface BulkLoopGuardResult {
  accept: Array<{ label: string; report: LoopGuardReport }>;
  proceed: Array<{ label: string; report: LoopGuardReport }>;
  pause: Array<{ label: string; report: LoopGuardReport }>;
}

export function classifyRecheckBatch(
  labels: string[],
  priorPrompts: string[],
  priorResponses: string[],
  currentDraft?: string,
): BulkLoopGuardResult {
  const out: BulkLoopGuardResult = { accept: [], proceed: [], pause: [] };
  for (const label of labels) {
    const report = detectEvidenceLoop({
      label,
      priorPrompts,
      priorResponses,
      currentDraft,
    });
    if (report.verdict === "accept") out.accept.push({ label, report });
    else if (report.verdict === "pause") out.pause.push({ label, report });
    else out.proceed.push({ label, report });
  }
  return out;
}
