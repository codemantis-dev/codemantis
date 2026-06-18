/**
 * duo-verdict — parse the structured verdict the read-only mentor emits at the
 * end of a review/dialogue turn.
 *
 * CLI agents emit free text, so the review prompt instructs the mentor to end
 * its response with a fenced block:
 *
 *   ```duo-verdict
 *   { "stance": "concern", "severity": "blocking", ... }
 *   ```
 *
 * We extract the LAST such block (the mentor may reason in earlier prose), parse
 * + validate it, and on failure return a typed reason so the orchestrator can
 * re-ask once before degrading to `needs-clarification`. Pure + fully testable.
 */

import type {
  DuoVerdict,
  DuoVerdictParse,
  DuoStance,
  DuoSeverity,
} from "../types/duo";

const FENCE_RE = /```duo-verdict\s*\n([\s\S]*?)```/gi;

const STANCES: readonly DuoStance[] = ["agree", "concern", "disagree"];
const SEVERITIES: readonly DuoSeverity[] = ["blocking", "advisory", "nit"];

function lastFencedBlock(raw: string): string | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(raw)) !== null) {
    last = match[1];
  }
  return last;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Parse a mentor response into a `DuoVerdict`. Returns a discriminated result —
 * never throws.
 */
export function parseDuoVerdict(raw: string): DuoVerdictParse {
  const block = lastFencedBlock(raw);
  if (block === null) {
    return { ok: false, reason: "no-block", raw };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.trim());
  } catch {
    return { ok: false, reason: "invalid-json", raw };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "schema-mismatch", raw };
  }

  const obj = parsed as Record<string, unknown>;
  const stance = obj.stance;
  const severity = obj.severity;

  if (typeof stance !== "string" || !STANCES.includes(stance as DuoStance)) {
    return { ok: false, reason: "schema-mismatch", raw };
  }
  if (
    typeof severity !== "string" ||
    !SEVERITIES.includes(severity as DuoSeverity)
  ) {
    return { ok: false, reason: "schema-mismatch", raw };
  }
  if (typeof obj.summary !== "string" || obj.summary.trim() === "") {
    return { ok: false, reason: "schema-mismatch", raw };
  }

  const repairTask =
    typeof obj.repairTask === "string" && obj.repairTask.trim() !== ""
      ? obj.repairTask
      : undefined;

  const verdict: DuoVerdict = {
    stance: stance as DuoStance,
    severity: severity as DuoSeverity,
    summary: obj.summary,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    repairTask,
    confidence: clampConfidence(obj.confidence),
    ranBuild: obj.ranBuild === true,
    ranTests: obj.ranTests === true,
    checkResults:
      typeof obj.checkResults === "string" ? obj.checkResults : undefined,
    citedFiles: asStringArray(obj.citedFiles),
  };

  return { ok: true, verdict };
}

/**
 * Whether a parsed verdict should trigger an intervention NOW. Advisory/nit
 * concerns are logged but batched; only blocking concerns/disagreements act.
 */
export function isBlockingVerdict(verdict: DuoVerdict): boolean {
  return (
    (verdict.stance === "concern" || verdict.stance === "disagree") &&
    verdict.severity === "blocking"
  );
}

/** A sentinel verdict used when the mentor's response can't be parsed even after a re-ask. */
export function needsClarificationVerdict(raw: string): DuoVerdict {
  return {
    stance: "concern",
    severity: "advisory",
    summary: "Mentor verdict could not be parsed",
    rationale: raw.slice(0, 500),
    confidence: 0,
    ranBuild: false,
    ranTests: false,
    citedFiles: [],
  };
}
