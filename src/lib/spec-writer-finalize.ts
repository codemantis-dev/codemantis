// ═══════════════════════════════════════════════════════════════════════
// SpecWriter — Post-LLM Finalize Pass (capability-aware soft validator)
// ═══════════════════════════════════════════════════════════════════════
//
// SpecWriter is a senior advisor, not a gatekeeper. This pass runs once
// on the final spec markdown, after the LLM streams it out, and before
// it is persisted / audited. It tightens the capability contract without
// blocking the user:
//
//   1. Auto-tag — items shaped `[behavioral|integration|side-effect] …`
//      missing a `capability=<id>` tag get one inferred from the line text
//      (e.g. "supabase db reset" → `db.supabase.local-stack`).
//
//   2. Substitute — when the (inferred or pre-existing) capability is
//      `absent` in the project record, the line is rewritten to use the
//      project's actual evidence vocabulary (cloud Supabase, MCP Supabase,
//      etc.) instead of being silently dropped.
//
//   3. Warn — items that resist both inference and substitution survive,
//      tagged with an inline note so verify-mode treats them as advisory.
//
// Every adjustment lands in a structured log so the user sees exactly
// what changed and can override.

import type { ProjectCapabilitiesRecord } from "../types/spec-writer";
import { findCapability, extractCapabilityRef } from "./capability-gating";
import {
  inferVocab,
  type EvidenceVocab,
} from "./self-drive-evidence-vocab";

/**
 * One change the finalize pass made to the spec. `kind` is the *strongest*
 * action taken on the line — substitution beats inference beats warning.
 */
export interface FinalizeAdjustment {
  kind: "inferred-tag" | "substituted" | "deferred" | "warned";
  original: string;
  replacement: string;
  capabilityId: string | null;
  reason: string;
}

export interface FinalizeResult {
  /** The (possibly-rewritten) spec markdown, ready to persist. */
  content: string;
  /** Ordered log of every line-level adjustment. Empty when the LLM was already careful. */
  adjustments: FinalizeAdjustment[];
}

// ── Inference rules ─────────────────────────────────────────────────────
//
// Each rule maps a regex over the evidence text (everything after the
// `[kind]` bracket) to a capability id. First match wins. Order matters:
// more-specific patterns first.

interface InferenceRule {
  pattern: RegExp;
  capabilityId: string;
}

const INFERENCE_RULES: InferenceRule[] = [
  // Local Supabase stack — these commands require a running local stack.
  {
    pattern: /\bsupabase\s+(?:db\s+reset|start|stop)\b/i,
    capabilityId: "db.supabase.local-stack",
  },
  { pattern: /\bpsql\s+-h\s+localhost\b/i, capabilityId: "db.supabase.local-stack" },
  { pattern: /\blocalhost:54322\b/i, capabilityId: "db.supabase.local-stack" },
  { pattern: /\$\{?DATABASE_URL\}?/, capabilityId: "db.supabase.local-stack" },
  // Cloud Supabase (linked CLI / MCP) commands.
  {
    pattern: /\bsupabase\s+(?:db\s+push|db\s+query\s+--linked|migration\s+(?:list|repair))\b/i,
    capabilityId: "db.supabase-anon",
  },
  {
    pattern: /\bmcp__supabase__execute_sql\b/,
    capabilityId: "db.supabase-anon",
  },
  // Test runners.
  {
    pattern: /\b(?:vitest|jest|playwright|cypress|pnpm\s+test|npm\s+test|yarn\s+test|bun\s+test)\b/i,
    capabilityId: "test-runner.any",
  },
  // BrowserMCP.
  {
    pattern: /\bbrowser_(?:navigate|click|type|snapshot|hover|press_key|select_option|wait)\b/,
    capabilityId: "browser-mcp",
  },
  // LLM-key live calls.
  { pattern: /\banthropic\.com\/v1\/messages\b/, capabilityId: "llm-key.anthropic" },
  { pattern: /\bopenai\.com\/v1\b/, capabilityId: "llm-key.openai" },
  { pattern: /\bgenerativelanguage\.googleapis\.com\b/, capabilityId: "llm-key.gemini" },
];

function inferCapability(evidence: string): string | null {
  for (const rule of INFERENCE_RULES) {
    if (rule.pattern.test(evidence)) return rule.capabilityId;
  }
  return null;
}

// ── Substitution rules ──────────────────────────────────────────────────
//
// When the inferred capability is `absent`, swap the offending command for
// the project's actual evidence vocabulary. Each substitution is paired with
// the absent capability id it triggers on.

interface SubstitutionRule {
  /** When this id is absent, run the substitution. */
  absentCapabilityId: string;
  /** Pattern in the evidence text that gets rewritten. */
  needle: RegExp;
  /** Build the replacement string from the project's vocab. */
  buildReplacement: (vocab: EvidenceVocab) => string;
}

const LOCAL_STACK_SUBSTITUTIONS: SubstitutionRule[] = [
  {
    absentCapabilityId: "db.supabase.local-stack",
    needle: /\bsupabase\s+db\s+reset(?:\s+\S+)?/gi,
    buildReplacement: (v) =>
      `${v.applyMigrationsCommand} succeeds and \`${v.listMigrationsCommand}\` shows the new migration`,
  },
  {
    absentCapabilityId: "db.supabase.local-stack",
    needle: /\bsupabase\s+start\b/gi,
    buildReplacement: (v) =>
      `(local stack not available — use \`${v.sqlCommandTemplate.replace("{QUERY}", "<SQL>")}\` for any DB evidence)`,
  },
  {
    absentCapabilityId: "db.supabase.local-stack",
    needle: /\bpsql\s+-h\s+localhost(?:\s+-p\s+\d+)?(?:\s+-U\s+\S+)?(?:\s+-c\s+["'][^"']+["'])?/gi,
    buildReplacement: (v) => v.sqlCommandTemplate.replace("{QUERY}", "<SQL>"),
  },
  {
    absentCapabilityId: "db.supabase.local-stack",
    needle: /\bpsql\s+\$\{?DATABASE_URL\}?(?:\s+-c\s+["'][^"']+["'])?/gi,
    buildReplacement: (v) => v.sqlCommandTemplate.replace("{QUERY}", "<SQL>"),
  },
];

function applySubstitutions(
  text: string,
  vocab: EvidenceVocab,
  record: ProjectCapabilitiesRecord | null | undefined,
): { text: string; substituted: boolean; reasons: string[] } {
  let out = text;
  let substituted = false;
  const reasons: string[] = [];
  for (const rule of LOCAL_STACK_SUBSTITUTIONS) {
    const cap = findCapability(record, rule.absentCapabilityId);
    if (!cap || cap.status !== "absent") continue;
    if (rule.needle.test(out)) {
      // Reset lastIndex — `g` flag carries state across .test/.replace.
      rule.needle.lastIndex = 0;
      const replacement = rule.buildReplacement(vocab);
      out = out.replace(rule.needle, replacement);
      substituted = true;
      reasons.push(
        `\`${rule.absentCapabilityId}\` absent → substituted to project vocab (${vocab.sqlTransport})`,
      );
    }
  }
  return { text: out, substituted, reasons };
}

// ── The pass ────────────────────────────────────────────────────────────

const ITEM_LINE = /^(\s*[-*]\s*(?:\[\s\]\s*)?)\[(behavioral|integration|side-effect)([^\]]*)\]\s*(.*)$/i;

/**
 * Run the finalize pass over a spec's markdown body.
 *
 * - Untouched lines are passed through unchanged.
 * - Lines with `[behavioral|integration|side-effect]` shape get inference +
 *   substitution + warning applied. Each rewrite is logged.
 * - The function NEVER throws and NEVER refuses — at worst, items survive
 *   with a `warned` adjustment so verify-mode can mark them advisory.
 */
export function finalizeSpecForCapabilities(
  content: string,
  record: ProjectCapabilitiesRecord | null | undefined,
  vocab: EvidenceVocab,
): FinalizeResult {
  const adjustments: FinalizeAdjustment[] = [];
  const lines = content.split("\n");
  const outLines = lines.map((rawLine) => {
    const m = rawLine.match(ITEM_LINE);
    if (!m) return rawLine;
    const [, prefix, kind, tagPart, evidenceRaw] = m;
    const original = rawLine;

    const existingCapability = extractCapabilityRef(tagPart) ?? extractCapabilityRef(evidenceRaw);
    const inferredCapability = existingCapability ?? inferCapability(evidenceRaw);

    // Step 1 — apply substitutions when the *applicable* capability is
    // absent. We run substitutions before tag-fixup so the rewritten
    // evidence text may itself need a different tag (e.g. local-stack →
    // cloud-Supabase command after substitution).
    let evidence = evidenceRaw;
    const subResult = applySubstitutions(evidence, vocab, record);
    let substituted = false;
    if (subResult.substituted) {
      evidence = subResult.text;
      substituted = true;
    }

    // Re-derive the effective capability after possible substitution. If
    // substitution happened, the new evidence likely points to a different
    // capability (cloud-side). Prefer fresh inference over the stale one.
    const effectiveCapability = substituted
      ? inferCapability(evidence) ?? existingCapability
      : inferredCapability;

    // Step 2 — DEFERRED path: capability is absent and we couldn't
    // substitute. Keep the line but rewrite it as `DEFERRED: …` so the
    // user knows it's not actionable in this environment.
    let deferred = false;
    if (!substituted && effectiveCapability) {
      const cap = findCapability(record, effectiveCapability);
      if (cap && cap.status === "absent") {
        evidence =
          `DEFERRED: capability \`${effectiveCapability}\` absent — ` +
          `original criterion: ${evidence.trim()}`;
        deferred = true;
      }
    }

    // Step 3 — auto-tag when there's no existing tag and we inferred one.
    // Deferred items also get tagged so verify-mode's auto-N/A gate (which
    // keys on `capability=<id>`) can pick them up downstream.
    let tagOut = tagPart;
    let inferredTagApplied = false;
    if (!existingCapability && effectiveCapability) {
      tagOut = ` capability=${effectiveCapability}`;
      inferredTagApplied = !deferred;
    } else if (substituted && effectiveCapability && extractCapabilityRef(tagPart) !== effectiveCapability) {
      // Substitution changed the underlying capability. Update the tag too.
      tagOut = ` capability=${effectiveCapability}`;
    }

    const rebuilt = `${prefix}[${kind}${tagOut}] ${evidence}`;

    // Step 4 — record the adjustment (strongest action wins).
    if (substituted) {
      adjustments.push({
        kind: "substituted",
        original,
        replacement: rebuilt,
        capabilityId: effectiveCapability,
        reason: subResult.reasons.join("; "),
      });
    } else if (deferred) {
      adjustments.push({
        kind: "deferred",
        original,
        replacement: rebuilt,
        capabilityId: effectiveCapability,
        reason: `capability \`${effectiveCapability}\` is absent and no substitution applies`,
      });
    } else if (inferredTagApplied) {
      adjustments.push({
        kind: "inferred-tag",
        original,
        replacement: rebuilt,
        capabilityId: effectiveCapability,
        reason: `inferred capability tag from evidence text`,
      });
    } else if (!existingCapability && !effectiveCapability) {
      // Couldn't infer or substitute. Survive as advisory.
      adjustments.push({
        kind: "warned",
        original,
        replacement: rebuilt,
        capabilityId: null,
        reason:
          `no \`capability=\` tag and none could be inferred — verify-mode will treat this item as advisory-only`,
      });
    }

    return rebuilt;
  });

  return { content: outLines.join("\n"), adjustments };
}

/**
 * Derive an `EvidenceVocab` directly from the project capability record.
 *
 * This is the convenience entry point for callers (SpecWriter's persist
 * path) that already have a `ProjectCapabilitiesRecord` and want to run
 * `finalizeSpecForCapabilities` without duplicating the per-project
 * detection that lives in `selfDriveStore`. The mapping is intentionally
 * conservative: only signals encoded in the capability record drive the
 * vocab choice. MCP-server and CLI-linked signals are not (yet) probed at
 * capability level, so the inference falls through to the CLI vocab for
 * cloud Supabase projects — the right default for that case.
 */
export function vocabFromCapabilities(
  record: ProjectCapabilitiesRecord | null | undefined,
): EvidenceVocab {
  const has = (id: string): boolean => {
    const c = record?.capabilities.find((c) => c.id === id);
    return c !== undefined && (c.status === "verified" || c.status === "claimed-unverified");
  };
  return inferVocab({
    hasSupabaseCloudUrl: has("db.supabase-anon") || has("db.supabase-service-role"),
    hasLocalSupabaseConfig: has("db.supabase.local-stack"),
    hasDatabaseUrl: false,
    hasMcpSupabase: false,
    supabaseCliLinked: false,
  });
}

/**
 * Render the adjustment log as a markdown system message — the format the
 * SpecWriter conversation surface expects.
 */
export function renderAdjustmentsMessage(adjustments: FinalizeAdjustment[]): string | null {
  if (adjustments.length === 0) return null;
  const buckets = {
    substituted: adjustments.filter((a) => a.kind === "substituted"),
    deferred: adjustments.filter((a) => a.kind === "deferred"),
    "inferred-tag": adjustments.filter((a) => a.kind === "inferred-tag"),
    warned: adjustments.filter((a) => a.kind === "warned"),
  };
  const lines: string[] = ["**SpecWriter finalize pass — adjustments applied:**"];
  if (buckets.substituted.length > 0) {
    lines.push(
      `\n_Substituted (${buckets.substituted.length}):_ command was rewritten to match this project's evidence vocabulary.`,
    );
    for (const a of buckets.substituted) {
      lines.push(`- \`${a.original.trim()}\``);
      lines.push(`  → \`${a.replacement.trim()}\``);
      lines.push(`  Reason: ${a.reason}`);
    }
  }
  if (buckets.deferred.length > 0) {
    lines.push(
      `\n_Deferred (${buckets.deferred.length}):_ capability is absent in this project; item kept but marked DEFERRED.`,
    );
    for (const a of buckets.deferred) {
      lines.push(`- ${a.replacement.trim()}`);
    }
  }
  if (buckets["inferred-tag"].length > 0) {
    lines.push(
      `\n_Auto-tagged (${buckets["inferred-tag"].length}):_ inferred \`capability=\` tag from the evidence text.`,
    );
    for (const a of buckets["inferred-tag"]) {
      lines.push(
        `- \`${(a.capabilityId ?? "?")}\` — ${a.original.trim().slice(0, 100)}`,
      );
    }
  }
  if (buckets.warned.length > 0) {
    lines.push(
      `\n_Advisory-only (${buckets.warned.length}):_ couldn't infer a capability; verify-mode will skip-grade these.`,
    );
    for (const a of buckets.warned) {
      lines.push(`- ${a.original.trim().slice(0, 120)}`);
    }
  }
  lines.push("\nEdit the spec or add explicit `capability=<id>` tags if you want different behavior.");
  return lines.join("\n");
}
