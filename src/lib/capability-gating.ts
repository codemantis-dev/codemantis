/**
 * Self-Drive verify-mode capability gating.
 *
 * Items in a Guide may be tagged `[kind capability=<id>]`. When the project
 * capability record (`.claude/project-capabilities.json`) lists that
 * capability as `absent`, verify-mode auto-resolves the item to `N/A` —
 * not SKIPPED, not FAIL. This is the mechanism that converts "deferred
 * because no test runner" into structured information instead of repeated
 * recovery cycles. See plan:
 * ~/.claude/plans/analyse-this-why-refactored-yao.md
 *
 * Pure helpers — no I/O, no state. Easy to unit test.
 */

import type {
  ProbedCapability,
  ProjectCapabilitiesRecord,
} from "../types/spec-writer";

/**
 * Extract a `capability=<id>` reference from a guide item's label.
 *
 * Matches inside `[kind capability=...]` brackets (common case) and also
 * the loose form `capability=...` anywhere in the label. Capability ids
 * use dotted namespaces (e.g. `browser-mcp`, `db.supabase-anon`,
 * `llm-key.openai`) — we accept alphanumerics, dots, hyphens, and
 * underscores.
 */
export function extractCapabilityRef(label: string): string | null {
  const m = label.match(/capability\s*=\s*([A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

/**
 * Look up a capability by id in the project's record.
 */
export function findCapability(
  record: ProjectCapabilitiesRecord | null | undefined,
  id: string,
): ProbedCapability | undefined {
  return record?.capabilities.find((c) => c.id === id);
}

/** Verdict to auto-apply when a referenced capability is absent. */
export interface AutoResolution {
  /** True when verify-mode should mark the item N/A without running it. */
  autoNA: boolean;
  /** Suggested evidence string to attach to the auto-N/A line. */
  reason: string;
  /** The capability id that drove the decision (null when no tag). */
  capabilityId: string | null;
}

/**
 * Decide whether a verify item should auto-resolve to N/A based on the
 * capability tag in its label and the current project capability record.
 *
 * - No capability tag → no auto-resolution; verify-mode runs the item normally.
 * - Capability missing from the record → no auto-resolution either; the
 *   orchestrator is responsible for triggering a targeted re-probe (see
 *   `findMissingCapabilities` below) before grading.
 * - Capability present with `status: absent` → autoNA = true.
 * - Capability present with any other status → autoNA = false (verify-mode
 *   demands real evidence shaped by the capability).
 */
export function shouldAutoResolveToNA(
  label: string,
  record: ProjectCapabilitiesRecord | null | undefined,
): AutoResolution {
  const capabilityId = extractCapabilityRef(label);
  if (!capabilityId) {
    return { autoNA: false, reason: "", capabilityId: null };
  }
  const cap = findCapability(record, capabilityId);
  if (!cap) {
    return { autoNA: false, reason: "", capabilityId };
  }
  if (cap.status === "absent") {
    return {
      autoNA: true,
      reason:
        `N/A — capability \`${capabilityId}\` absent at spec-write time ` +
        `(recorded in .claude/project-capabilities.json: ${cap.evidence})`,
      capabilityId,
    };
  }
  return { autoNA: false, reason: "", capabilityId };
}

// ── Staleness handling ──────────────────────────────────────────────────
//
// Verify-mode trusts `status: verified` records up to `stalenessWindow`
// (24h default). After that, the capability is re-fired once before
// crediting evidence. Also: when a Guide references a capability missing
// from the record, the orchestrator triggers a targeted probe to add it.

/**
 * Parse an ISO 8601 duration (subset: `PT<n>H`, `PT<n>M`, `PT<n>S`, `P<n>D`)
 * into milliseconds. Returns null when the input is malformed. We only
 * support the small subset the plan actually uses — anything else returns
 * null and the caller falls back to a conservative default.
 */
export function parseIsoDurationMs(input: string): number | null {
  // Common shapes: PT24H, PT1H30M, PT45M, PT60S, P1D, P7D
  const m = input.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, days, hours, minutes, seconds] = m;
  if (!days && !hours && !minutes && !seconds) return null;
  const d = Number(days ?? 0);
  const h = Number(hours ?? 0);
  const min = Number(minutes ?? 0);
  const s = Number(seconds ?? 0);
  return ((d * 24 + h) * 60 + min) * 60 * 1000 + s * 1000;
}

/**
 * Is this capability's verification older than the staleness window?
 * Capabilities that have never been verified (no `lastVerifiedAt`) are
 * considered stale; capabilities whose status is `absent` or `pending-install`
 * are never stale (re-firing absent is pointless until the user changes
 * something).
 */
export function isCapabilityStale(
  cap: ProbedCapability,
  stalenessWindow: string,
  now: Date = new Date(),
): boolean {
  if (cap.status === "absent" || cap.status === "pending-install") return false;
  if (!cap.lastVerifiedAt) return true;
  const windowMs = parseIsoDurationMs(stalenessWindow);
  if (windowMs == null) {
    // Conservative default when the window is malformed: 24h.
    const fallbackMs = 24 * 60 * 60 * 1000;
    return now.getTime() - new Date(cap.lastVerifiedAt).getTime() > fallbackMs;
  }
  return now.getTime() - new Date(cap.lastVerifiedAt).getTime() > windowMs;
}

/**
 * Return the subset of capability IDs in `record` whose verification is
 * older than the window AND whose status could meaningfully be re-fired
 * (currently `verified` and `claimed-unverified`). The orchestrator passes
 * this list to `liveFireCapabilities` for a targeted refresh.
 */
export function staleCapabilityIds(
  record: ProjectCapabilitiesRecord | null | undefined,
  now: Date = new Date(),
): string[] {
  if (!record) return [];
  return record.capabilities
    .filter((c) => c.status === "verified" || c.status === "claimed-unverified")
    .filter((c) => isCapabilityStale(c, record.stalenessWindow, now))
    .map((c) => c.id);
}

/**
 * Reference-based re-probe — find capability ids referenced in a list of
 * verify-check labels that are NOT present in the current record. The
 * orchestrator triggers a targeted probe for these before grading; this
 * catches the "project gained a new dependency since the last full probe"
 * case described in the plan.
 */
export function findMissingCapabilityRefs(
  labels: string[],
  record: ProjectCapabilitiesRecord | null | undefined,
): string[] {
  const known = new Set(record?.capabilities.map((c) => c.id) ?? []);
  const missing = new Set<string>();
  for (const label of labels) {
    const ref = extractCapabilityRef(label);
    if (ref && !known.has(ref)) missing.add(ref);
  }
  return Array.from(missing);
}
