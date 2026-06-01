// ═══════════════════════════════════════════════════════════════════════
// Recognize Guide — AI-powered recovery layer
//
// When `parseSessionPlan` fails, this module attempts to repair the spec
// by handing it back to the user's configured SpecWriter LLM with a tight
// "make this parseable, do not invent" prompt. The Rust command does the
// HTTP heavy lifting; this wrapper:
//   1. Decides whether recovery is possible from the current session state
//      (provider configured? API key present? not on the CLI-only path?).
//   2. Calls the command.
//   3. Re-runs `parseSessionPlan` on the result so the caller gets either
//      a fully-resolved ParsedSessionPlan or a clean failure reason.
//
// The caller in `useSpecWriterActions.handleRecognizeGuide` is the only
// consumer. Keeping this logic out of the hook keeps the hook readable and
// keeps the recovery path independently testable.
// ═══════════════════════════════════════════════════════════════════════
import { invoke } from "@tauri-apps/api/core";
import { parseSessionPlan, diagnoseSessionPlanFailure } from "./parse-session-plan";
import type { ParsedSessionPlan } from "./parse-session-plan";

export interface RecoveryContext {
  /** Spec markdown that failed to parse. */
  specMarkdown: string;
  /** Filename (no path) — embedded into synthesized Read instructions. */
  filename: string;
  /** Provider configured on the active SpecWriter conversation. */
  provider: string;
  /** Model configured on the active SpecWriter conversation. */
  model: string;
  /**
   * API key for the provider. Empty string is treated as "no key" — the
   * recovery refuses with a friendly hint rather than calling.
   */
  apiKey: string;
}

export interface RecoverySuccess {
  ok: true;
  /** Recovered (canonicalized) spec markdown — full document, not just the section. */
  recoveredMarkdown: string;
  /** Re-parsed plan; guaranteed non-null when ok=true. */
  parsed: ParsedSessionPlan;
  /** Provider/model that actually performed the recovery — surfaced in the toast. */
  provider: string;
  model: string;
  /** Reason the original parse failed — surfaced to the user for transparency. */
  originalDiagnosis: string;
}

export interface RecoveryFailure {
  ok: false;
  /** Original parser diagnosis — what tripped the regex. */
  originalDiagnosis: string;
  /**
   * Why recovery itself failed. Surfaced to the user in the red error toast
   * alongside the original diagnosis so they understand both layers.
   */
  recoveryReason: string;
}

export type RecoveryResult = RecoverySuccess | RecoveryFailure;

interface RecoverSessionPlanResponse {
  recoveredMarkdown: string;
  provider: string;
  model: string;
}

/**
 * Providers that have no API key path because the user is on a CLI-based
 * spec writer. Recovery refuses up-front rather than calling an empty key
 * through to the backend.
 */
const CLI_ONLY_PROVIDERS = new Set(["claude-code", "codex"]);

/**
 * Attempt to recover a spec whose Session Plan failed strict regex parsing.
 *
 * Always re-parses the recovered text before declaring success — a "200 OK"
 * from the model that still doesn't parse is treated as a failure, with the
 * post-recovery diagnosis surfaced as the reason.
 */
export async function recoverSessionPlan(
  ctx: RecoveryContext,
): Promise<RecoveryResult> {
  const originalDiagnosis = diagnoseSessionPlanFailure(ctx.specMarkdown);

  if (CLI_ONLY_PROVIDERS.has(ctx.provider)) {
    return {
      ok: false,
      originalDiagnosis,
      recoveryReason:
        "Auto-recovery needs an API provider (Anthropic / OpenAI / Gemini / OpenRouter). " +
        "Your SpecWriter is currently using the CLI, which has no key to call. " +
        "Configure an API key in Settings → AI Providers, or fix the spec manually.",
    };
  }
  if (!ctx.apiKey.trim()) {
    return {
      ok: false,
      originalDiagnosis,
      recoveryReason:
        `No API key configured for provider "${ctx.provider}". ` +
        "Add one in Settings → AI Providers to enable guide auto-recovery.",
    };
  }
  if (!ctx.model.trim()) {
    return {
      ok: false,
      originalDiagnosis,
      recoveryReason: `No model configured for provider "${ctx.provider}".`,
    };
  }

  let resp: RecoverSessionPlanResponse;
  try {
    resp = await invoke<RecoverSessionPlanResponse>("recover_session_plan", {
      specMarkdown: ctx.specMarkdown,
      diagnosis: originalDiagnosis,
      provider: ctx.provider,
      apiKey: ctx.apiKey,
      model: ctx.model,
      filename: ctx.filename,
    });
  } catch (e) {
    return {
      ok: false,
      originalDiagnosis,
      recoveryReason: e instanceof Error ? e.message : String(e),
    };
  }

  const parsed = parseSessionPlan(resp.recoveredMarkdown);
  if (!parsed) {
    // The recovery call returned text but it still doesn't parse. The
    // post-recovery diagnosis tells the user precisely what the AI got
    // wrong — much more useful than a generic "recovery failed".
    return {
      ok: false,
      originalDiagnosis,
      recoveryReason:
        `${resp.provider} returned a response but the result still does not parse: ` +
        diagnoseSessionPlanFailure(resp.recoveredMarkdown),
    };
  }

  return {
    ok: true,
    recoveredMarkdown: resp.recoveredMarkdown,
    parsed,
    provider: resp.provider,
    model: resp.model,
    originalDiagnosis,
  };
}
