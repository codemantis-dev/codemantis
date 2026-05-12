// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Blocker Satisfiability Validator
// ═══════════════════════════════════════════════════════════════════════
//
// The orchestrator's system prompt contains a `SATISFIABILITY CONSTRAINT`
// rule: every blocker's `resolutionCriteria` must be satisfiable by ONE
// Claude Code turn producing concrete evidence. The rule is enforced in
// prose — meaning Sonnet-as-orchestrator can drift and still emit
// unsatisfiable criteria like:
//
//   "TOOLS USED THIS TURN must contain at least one Edit/Write call per
//    deliverable file"
//
// That criterion is destructive (re-Write complete files just to please
// the tool log) and creates a permanent blocker loop, exactly the failure
// mode the user reported.
//
// This module is a deterministic post-parse validator: every blocker that
// reaches Self-Drive state is run through `validateBlockerSatisfiability()`
// FIRST. Bad criteria are rewritten to the equivalent filesystem-evidence
// form. Multi-step criteria are split (we keep only the first checkable
// step). Criteria referencing commands that the project doesn't provide
// (per the evidence vocab in Phase C.1) get swapped to the vocab's
// equivalent — that hook is left as a parameter the caller can fill in.

import type { Blocker } from "../types/implementation-guide";

export interface ValidatorOptions {
  /**
   * Optional substitution map: each entry is a needle (regex or string) and
   * a replacement. Used to swap unavailable commands for project-specific
   * equivalents (e.g. `psql` → `supabase db query --linked`). Populated
   * from the evidence vocab in Phase C.1.
   */
  vocabSubstitutions?: Array<{ needle: RegExp; replacement: string }>;
}

export interface ValidationReport {
  ok: boolean;
  rewrittenCriteria?: string;
  /** Codes of the rewrites that fired, for logging / UI. */
  rewriteCodes: string[];
}

/**
 * Patterns that indicate a destructive / unsatisfiable criterion phrasing
 * referencing tool-log requirements. When matched, the criterion is
 * rewritten to filesystem-evidence form.
 */
const TOOL_LOG_PHRASES: Array<{ needle: RegExp; reason: string }> = [
  { needle: /\btools?\s+used\b/i, reason: "tool-log-required" },
  { needle: /\btool\s+log\b/i, reason: "tool-log-required" },
  { needle: /\b(?:must\s+)?contain\s+(?:at\s+least\s+)?(?:one|an?)\s+(?:Edit|Write|MultiEdit|NotebookEdit)\b/i, reason: "edit-write-call-required" },
  { needle: /\b(?:Edit|Write)\s+tool\s+call\b/i, reason: "edit-write-call-required" },
  { needle: /\brecord(?:ed)?\s+in\s+the\s+tool\s+log\b/i, reason: "tool-log-required" },
];

/**
 * The replacement template used when a tool-log criterion is detected.
 * Phrased around filesystem ground truth, satisfiable by Bash commands.
 */
function buildFilesystemReplacement(): string {
  return (
    "filesystem verification: `ls -la <paths>` shows the expected files " +
    "with non-zero size AND `git status --porcelain` lists them AND " +
    "`pnpm tsc --noEmit` returns exit 0 (deliverables present; build clean)"
  );
}

/**
 * Patterns flagging a multi-step criterion that can't be checked in one
 * turn ("and then deploy and then run X"). When detected we keep the
 * first clause and append a follow-up note.
 */
const MULTI_STEP_SPLIT = /\b(?:and\s+then|then\s+also|followed\s+by|after\s+which|next,\s+)/i;

/**
 * Run the validator. Returns either `{ ok: true }` (criterion was
 * satisfiable as-is) or `{ ok: false, rewrittenCriteria }` — in the
 * latter case the caller should replace the blocker's resolutionCriteria
 * with the rewritten string.
 */
export function validateBlockerSatisfiability(
  blocker: Pick<Blocker, "resolutionCriteria">,
  options: ValidatorOptions = {},
): ValidationReport {
  const codes: string[] = [];
  let criteria = blocker.resolutionCriteria ?? "";

  if (criteria.trim() === "") {
    // Empty criteria → ask for a basic filesystem proof.
    return {
      ok: false,
      rewrittenCriteria: buildFilesystemReplacement(),
      rewriteCodes: ["empty-criteria"],
    };
  }

  // 1. Tool-log / Edit-Write-call phrasings → filesystem replacement.
  const toolLogHit = TOOL_LOG_PHRASES.find((p) => p.needle.test(criteria));
  if (toolLogHit) {
    codes.push(toolLogHit.reason);
    criteria = buildFilesystemReplacement();
  }

  // 2. Multi-step criterion → keep only the first clause + note.
  if (MULTI_STEP_SPLIT.test(criteria)) {
    codes.push("multi-step-split");
    const firstClause = criteria.split(MULTI_STEP_SPLIT)[0].trim().replace(/[,;:]$/, "");
    criteria = `${firstClause} (follow-up steps to be checked in a separate criterion)`;
  }

  // 3. Apply vocab substitutions (Phase C.1 hook). Each substitution is
  //    a regex needle + replacement. If no substitutions are configured
  //    this is a no-op.
  if (options.vocabSubstitutions) {
    for (const { needle, replacement } of options.vocabSubstitutions) {
      if (needle.test(criteria)) {
        codes.push("vocab-substitution");
        criteria = criteria.replace(needle, replacement);
      }
    }
  }

  if (codes.length === 0) {
    return { ok: true, rewriteCodes: [] };
  }
  return {
    ok: false,
    rewrittenCriteria: criteria,
    rewriteCodes: codes,
  };
}

/**
 * Convenience: apply the validator and return a new blocker with
 * rewritten criteria (if any). The original is preserved in
 * `_originalCriteria` (non-typed property) for debugging — see Phase D.3.
 */
export function rewriteBlockerIfNeeded<T extends Pick<Blocker, "resolutionCriteria">>(
  blocker: T,
  options: ValidatorOptions = {},
): { blocker: T; report: ValidationReport } {
  const report = validateBlockerSatisfiability(blocker, options);
  if (report.ok) return { blocker, report };
  return {
    blocker: {
      ...blocker,
      resolutionCriteria: report.rewrittenCriteria ?? blocker.resolutionCriteria,
    },
    report,
  };
}
