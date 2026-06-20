// ═══════════════════════════════════════════════════════════════════════
// Recognize Guide — AI-powered recovery layer
//
// When `parseSessionPlan` fails, this module hands the spec back to the AI
// SpecWriter is already using and turns the reply into a runnable plan. It is
// transport-agnostic on purpose: the caller injects HOW the prompt reaches an
// LLM, so this layer works for BOTH the live CLI session (in-band, no API
// key) and the direct-API command — there is no provider it refuses.
//
// It NEVER hard-fails. `extractRecoveredPlan` always yields a plan (structured
// envelope → corrected markdown → degraded single-session fallback), so the
// caller always gets a usable guide instead of a dead-end. See plan:
//   ~/.claude/plans/again-specwriter-creates-a-humble-scone.md
// ═══════════════════════════════════════════════════════════════════════
import { diagnoseSessionPlanFailure } from "./parse-session-plan";
import type { ParsedSessionPlan } from "./parse-session-plan";
import { extractRecoveredPlan } from "./session-plan-envelope";
import type { RecoverySource } from "./session-plan-envelope";

export interface RecoveryContext {
  /** Spec markdown that failed to parse. */
  specMarkdown: string;
  /** Filename (no path) — embedded into synthesized Read instructions. */
  filename: string;
  /** Provider configured on the active SpecWriter conversation (for the toast). */
  provider: string;
  /** Model configured on the active SpecWriter conversation (for the toast). */
  model: string;
}

/**
 * Delivers the recovery prompt to an LLM and returns its raw reply text. Two
 * implementations exist (see `useSpecWriterActions.handleRecognizeGuide`):
 *   • in-band CLI — sends into the live SpecWriter session (no API key), and
 *   • direct API — invokes the `recover_session_plan` Rust command.
 * A transport that throws or returns "" is fine: recovery degrades to a
 * single-session guide rather than dead-ending.
 */
export type RecoveryTransport = (input: {
  specMarkdown: string;
  diagnosis: string;
  filename: string;
}) => Promise<string>;

export interface RecoveryResult {
  /** Re-built plan — guaranteed non-null (degraded fallback if all else fails). */
  parsed: ParsedSessionPlan;
  /** True when the degraded single-session fallback was used. */
  degraded: boolean;
  /** How the plan was obtained (envelope / markdown / degraded). */
  source: RecoverySource;
  /**
   * Canonical spec markdown to write back — present only when the model
   * returned corrected markdown. Drives the "Save corrected version" action.
   */
  correctedMarkdown: string | null;
  /** Provider/model that performed the recovery — surfaced in the toast. */
  provider: string;
  model: string;
  /** Reason the original parse failed — surfaced to the user for transparency. */
  originalDiagnosis: string;
}

/**
 * Recover a spec whose Session Plan failed strict regex parsing, using the
 * supplied transport to reach an LLM. Always resolves to a usable plan.
 */
export async function recoverSessionPlan(
  ctx: RecoveryContext,
  transport: RecoveryTransport,
): Promise<RecoveryResult> {
  const originalDiagnosis = diagnoseSessionPlanFailure(ctx.specMarkdown);

  let modelText = "";
  try {
    modelText = await transport({
      specMarkdown: ctx.specMarkdown,
      diagnosis: originalDiagnosis,
      filename: ctx.filename,
    });
  } catch {
    // A failed transport (no key, CLI cancelled, HTTP error) is not fatal —
    // `modelText` stays "" and we fall through to the degraded plan so
    // recognition never dead-ends.
  }

  const extracted = extractRecoveredPlan(modelText, ctx.specMarkdown, ctx.filename);
  return {
    parsed: extracted.plan,
    degraded: extracted.degraded,
    source: extracted.source,
    correctedMarkdown: extracted.correctedMarkdown,
    provider: ctx.provider,
    model: ctx.model,
    originalDiagnosis,
  };
}
