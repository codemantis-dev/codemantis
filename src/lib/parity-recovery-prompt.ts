// ═══════════════════════════════════════════════════════════════════════
// Parity-recovery prompt builder + DEFERRED parser
//
// The cross-system action parity gate used to halt Self-Drive whenever it
// couldn't find an action/wire string in the session's caller files. That
// produced false positives almost every session (the spec's action label
// often differs from the on-the-wire identifier; the call site frequently
// lives in a sibling directory the gate didn't scan). This module gives
// the gate a 1-3 attempt recovery loop instead: when parity FAILs, we ask
// Claude Code to either fix the call site, fix the spec's `wire:` field,
// or explicitly DEFER the row — same envelope as the existing fix loop.
// ═══════════════════════════════════════════════════════════════════════

import type { ActionParityResult } from "./tauri-commands";
import type { CrossSystemAction } from "../types/implementation-guide";

export interface ParityRecoveryInput {
  failed: ActionParityResult[];
  callerPaths: string[];
  actions: CrossSystemAction[];
}

/**
 * Build the recovery prompt sent to Claude Code when the parity gate
 * FAILs. The prompt names every failing row with its scanned paths and
 * search needle so the recipient has enough context to fix the call site,
 * correct the spec, or emit a DEFERRED line — no guessing required.
 */
export function buildParityRecoveryPrompt(input: ParityRecoveryInput): string {
  const { failed, callerPaths, actions } = input;
  const actionByName = new Map(actions.map((a) => [a.action, a]));

  const rows = failed.map((r) => {
    const meta = actionByName.get(r.action);
    const wire = meta?.wire?.trim();
    const needle = wire && wire.length > 0 ? wire : r.action;
    const wireLabel = wire && wire.length > 0 ? wire : r.action;
    return [
      `  - action: ${r.action}  (wire: ${wireLabel})`,
      `    scanned: ${callerPaths.join(", ")}`,
      `    searched for literal: "${needle}"`,
      `    detail: ${r.detail}`,
    ].join("\n");
  });

  return [
    "Self-Drive's parity check did not find the wire identifier in the session's caller files.",
    "",
    "For each row below, EITHER add the literal wire string to the actual call site in one of the caller files (typical: as the value of an `action` / `type` / URL-segment field in the request), OR — if the wire identifier is intentionally different from what the spec declares — update the spec's `**Cross-system actions introduced:**` block to reflect the real wire (use the optional `(wire: \\`x\\`)` field).",
    "",
    rows.join("\n\n"),
    "",
    "If a row is a known false-positive that genuinely cannot be resolved this session (the wire is built dynamically, the call site lives in a generated file, etc.), reply with a single line of the form:",
    "  DEFERRED: <action> — <one-sentence reason>",
    "…and the parity gate will respect that deferral for the row.",
    "",
    "Do NOT change the spec just to silence the gate. Either fix the call site, fix the spec to declare the real wire, or DEFER with a real reason.",
  ].join("\n");
}

/**
 * Extract action names from `DEFERRED:` lines in a Claude Code response.
 * Recognized forms (case-insensitive on the keyword, any dash / hyphen
 * variant for the separator):
 *
 *   DEFERRED: resolve_checkpoint — wire is generated at runtime
 *   DEFERRED: insert_note - handler-only session
 *   DEFERRED: emit_audit_log
 *
 * The action name is the first whitespace- or dash-delimited token after
 * the keyword. Returns a set so the caller can do O(1) `has(action)`
 * lookups when filtering failing rows.
 */
export function parseDeferredParityRows(response: string): Set<string> {
  const deferred = new Set<string>();
  if (!response) return deferred;
  const re = /^\s*DEFERRED\s*:\s*([^\s—–-]+)/gim;
  for (const m of response.matchAll(re)) {
    const name = m[1].trim().replace(/[`'"]/g, "");
    if (name) deferred.add(name);
  }
  return deferred;
}
