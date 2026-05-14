// ═══════════════════════════════════════════════════════════════════════
// Spec Audit Patch — splice coverage-recheck output into an existing spec.
//
// The auto-recheck loop in useSpecConversation prompts the model to reply
// with a `<!-- AUDIT-PATCH -->` envelope containing one or more structured
// patch ops:
//
//   <!-- patch:replace-section heading="§4.1 _STAGE_REGISTRY" -->
//   ## §4.1 _STAGE_REGISTRY
//   ...new full section body...
//   <!-- /patch -->
//
//   <!-- patch:insert-after heading="§4.2" -->
//   ## §4.3 New Section
//   ...content...
//   <!-- /patch -->
//
//   <!-- patch:append-section -->
//   ## §X New trailing section
//   <!-- /patch -->
//
// `parseAuditPatch` lexes the envelope, `applyAuditPatch` merges the ops
// into the original spec. Both fail-closed: any malformed input or failing
// validation gate aborts the merge so the caller can keep the original
// spec intact.
// ═══════════════════════════════════════════════════════════════════════

export type PatchOpKind = 'replace-section' | 'insert-after' | 'append-section';

export interface PatchOp {
  kind: PatchOpKind;
  /** Required for `replace-section` and `insert-after`. */
  heading?: string;
  /** Body content between the open and close comment tags, with leading/trailing blank lines trimmed. */
  body: string;
}

export interface ParseResult {
  ops: PatchOp[];
  warnings: string[];
}

export interface ApplyResult {
  /** The merged spec, or null if any validation gate failed. */
  merged: string | null;
  warnings: string[];
  errors: string[];
  /** Op kinds that were applied, in order. Useful for the system message summary. */
  appliedOps: PatchOpKind[];
}

const MARKER = '<!-- AUDIT-PATCH -->';
const PATCH_OPEN_RE = /<!--\s*patch:(replace-section|insert-after|append-section)([^>]*?)-->/g;
const PATCH_CLOSE_TAG = '<!-- /patch -->';
const HEADING_ATTR_RE = /heading\s*=\s*"([^"]*)"/;

/**
 * Tolerant heading normalization. Folds:
 *   - leading `#` markers and whitespace
 *   - optional `§` prefix
 *   - optional dotted numeric prefix (`4.1`, `4.1.`, `4.1 `)
 *   - case
 *   - punctuation / non-alphanumeric runs (collapsed to single space)
 */
function normalizeHeading(raw: string): string {
  return raw
    .replace(/^#+\s+/, '')
    .replace(/^§\s*/, '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strip leading/trailing blank lines but keep internal whitespace. */
function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:[ \t]*\r?\n)+$/, '');
}

// ─────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────

/**
 * Lex the model reply into structured patch ops. Anything outside well-formed
 * `<!-- patch:OP --> ... <!-- /patch -->` blocks is treated as narration and
 * surfaced via `warnings` (the merger ignores it).
 */
export function parseAuditPatch(text: string): ParseResult {
  const warnings: string[] = [];
  const ops: PatchOp[] = [];

  if (!text.includes(MARKER)) {
    warnings.push('no-marker: response did not begin with <!-- AUDIT-PATCH -->');
    return { ops, warnings };
  }

  // Strip everything up to and including the marker so narration before it
  // doesn't confuse the lexer.
  const afterMarker = text.slice(text.indexOf(MARKER) + MARKER.length);

  PATCH_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let droppedNarration = 0;

  while ((match = PATCH_OPEN_RE.exec(afterMarker)) !== null) {
    const opStart = match.index;
    const opKind = match[1] as PatchOpKind;
    const attrs = match[2] ?? '';
    const headingMatch = HEADING_ATTR_RE.exec(attrs);
    const heading = headingMatch ? headingMatch[1].trim() : undefined;

    const bodyStart = opStart + match[0].length;
    const closeIdx = afterMarker.indexOf(PATCH_CLOSE_TAG, bodyStart);
    if (closeIdx === -1) {
      warnings.push(`unbalanced: ${opKind} block opened at offset ${opStart} has no <!-- /patch --> close`);
      break;
    }

    // Reject nested opens — lex them as malformed rather than silently re-parsing.
    const nestedOpenRe = /<!--\s*patch:(?:replace-section|insert-after|append-section)/g;
    nestedOpenRe.lastIndex = bodyStart;
    const nestedMatch = nestedOpenRe.exec(afterMarker);
    if (nestedMatch && nestedMatch.index < closeIdx) {
      warnings.push(`nested: ${opKind} block contains another patch open before its close — skipping`);
      // Skip past the malformed open to avoid infinite loop, but don't try to recover further.
      PATCH_OPEN_RE.lastIndex = closeIdx + PATCH_CLOSE_TAG.length;
      continue;
    }

    if (opStart > cursor) {
      const between = afterMarker.slice(cursor, opStart).trim();
      if (between.length > 0) droppedNarration += between.length;
    }

    const body = trimBlankLines(afterMarker.slice(bodyStart, closeIdx));

    if ((opKind === 'replace-section' || opKind === 'insert-after') && !heading) {
      warnings.push(`missing-heading: ${opKind} block is missing required heading="..." attribute`);
    } else if (body.length === 0 && opKind !== 'replace-section') {
      // replace-section CAN legitimately have empty body if the model wants to delete
      // a section, though we lock that down via the no-shrinking gate.
      warnings.push(`empty-body: ${opKind} block has no content`);
    } else {
      ops.push({ kind: opKind, heading, body });
    }

    cursor = closeIdx + PATCH_CLOSE_TAG.length;
    PATCH_OPEN_RE.lastIndex = cursor;
  }

  // Trailing narration after the last close tag.
  if (cursor < afterMarker.length) {
    const tail = afterMarker.slice(cursor).trim();
    if (tail.length > 0) droppedNarration += tail.length;
  }

  if (droppedNarration > 0) {
    warnings.push(`narration-dropped: ${droppedNarration} char(s) of prose outside patch blocks were ignored`);
  }

  if (ops.length === 0) {
    warnings.push('no-ops: AUDIT-PATCH envelope contained no recognizable patch blocks');
  }

  return { ops, warnings };
}

// ─────────────────────────────────────────────────────────────────────
// Section walker
// ─────────────────────────────────────────────────────────────────────

interface Section {
  /** 1-based heading level (H1-H6). */
  level: number;
  /** Raw heading text after the `#` markers. */
  rawTitle: string;
  /** Normalized title for tolerant matching. */
  normalized: string;
  /** Index of the heading line in `lines`. */
  startLine: number;
  /** Index just past the last line of the section (exclusive); equals `lines.length` for the final section. */
  endLine: number;
}

/**
 * Walk the spec and emit every H1–H6, fence-aware. A section ends when the
 * next heading of the same or lower level (numerically) is encountered, or at
 * end of document.
 */
function walkSections(spec: string): { lines: string[]; sections: Section[] } {
  const lines = spec.split('\n');
  const sections: Section[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    sections.push({
      level: m[1].length,
      rawTitle: m[2],
      normalized: normalizeHeading(line),
      startLine: i,
      endLine: lines.length,
    });
  }
  // Compute endLine for each section as the start of the next section of the
  // same or shallower level.
  for (let i = 0; i < sections.length; i++) {
    const cur = sections[i];
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].level <= cur.level) {
        cur.endLine = sections[j].startLine;
        break;
      }
    }
  }
  return { lines, sections };
}

function findSection(sections: Section[], heading: string): Section | null {
  const target = normalizeHeading(heading);
  if (!target) return null;
  // Exact normalized match first.
  for (const s of sections) {
    if (s.normalized === target) return s;
  }
  // Fallback: the user might pass just the numeric ref ("§4.1") and the heading
  // includes a title — match if the target is a prefix of the section's
  // normalized title and that prefix is followed by a word boundary.
  for (const s of sections) {
    if (s.normalized.startsWith(target + ' ') || s.normalized === target) return s;
  }
  // Or the other direction: the model gave the full title but the spec uses
  // just the numeric prefix.
  for (const s of sections) {
    if (target.startsWith(s.normalized + ' ')) return s;
  }
  return null;
}

/**
 * Rank candidate headings by similarity to the target. Used to produce
 * "Did you mean: …" suggestions when `findSection` fails — gives the next
 * recheck attempt a concrete target to retry against.
 *
 * Uses character-bigram overlap (Dice coefficient) so close-but-not-exact
 * matches like `createActivityForm` ↔ `createActivity(payload)` rank above
 * unrelated sections.
 */
function suggestHeadings(sections: Section[], heading: string, limit = 3): string[] {
  const target = normalizeHeading(heading).replace(/\s+/g, '');
  if (!target || sections.length === 0) return [];
  const targetBigrams = bigrams(target);
  if (targetBigrams.size === 0) return [];
  const scored = sections.map((s) => {
    const sNorm = s.normalized.replace(/\s+/g, '');
    const sBigrams = bigrams(sNorm);
    let overlap = 0;
    for (const b of sBigrams) if (targetBigrams.has(b)) overlap += 1;
    const denom = targetBigrams.size + sBigrams.size;
    return { section: s, score: denom === 0 ? 0 : (2 * overlap) / denom };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((x) => x.score > 0.2)
    .slice(0, limit)
    .map((x) => `${'#'.repeat(x.section.level)} ${x.section.rawTitle}`);
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function formatSuggestionTail(sections: Section[], heading: string): string {
  const suggestions = suggestHeadings(sections, heading);
  if (suggestions.length === 0) return '';
  return `. Did you mean: ${suggestions.map((s) => `"${s}"`).join(', ')}?`;
}

// ─────────────────────────────────────────────────────────────────────
// Applier
// ─────────────────────────────────────────────────────────────────────

interface PlannedEdit {
  op: PatchOpKind;
  startLine: number;
  endLine: number;
  /** Lines to splice into [startLine, endLine). */
  replacement: string[];
  /** For replace-section: the section's normalized heading (so we can validate the inventory). */
  targetNormalized?: string;
}

/**
 * Apply a list of patch ops to the original spec. Fails closed: any error
 * leaves the merge unsubmitted and `merged` is null.
 *
 * Validation gates (all must pass):
 *   1. Every replace-section / insert-after must resolve to an existing heading.
 *   2. The H1 line must survive the merge unchanged.
 *   3. Merged size must not collapse below 60% of original (catches accidental
 *      whole-doc replace).
 *   4. Every original H2-H6 must still exist in the merged output unless it
 *      was the target of a replace-section.
 *   5. No two consecutive identical headings (catches double-application).
 */
export function applyAuditPatch(originalSpec: string, ops: PatchOp[]): ApplyResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const appliedOps: PatchOpKind[] = [];

  if (originalSpec.length === 0) {
    errors.push('original-spec-empty: cannot apply patch to an empty spec');
    return { merged: null, warnings, errors, appliedOps };
  }
  if (ops.length === 0) {
    errors.push('no-ops: nothing to apply');
    return { merged: null, warnings, errors, appliedOps };
  }

  const { lines, sections } = walkSections(originalSpec);

  // Plan all edits first against the original line array so we can validate
  // up-front and apply atomically (no partial application on failure).
  const planned: PlannedEdit[] = [];

  for (const op of ops) {
    if (op.kind === 'replace-section') {
      if (!op.heading) {
        errors.push(`replace-section: missing heading attribute`);
        continue;
      }
      const target = findSection(sections, op.heading);
      if (!target) {
        errors.push(
          `replace-section: heading "${op.heading}" not found in original spec${formatSuggestionTail(sections, op.heading)}`,
        );
        continue;
      }
      planned.push({
        op: op.kind,
        startLine: target.startLine,
        endLine: target.endLine,
        replacement: ensureTrailingBlank(op.body.split('\n')),
        targetNormalized: target.normalized,
      });
      appliedOps.push(op.kind);
    } else if (op.kind === 'insert-after') {
      if (!op.heading) {
        errors.push(`insert-after: missing heading attribute`);
        continue;
      }
      const anchor = findSection(sections, op.heading);
      if (!anchor) {
        errors.push(
          `insert-after: heading "${op.heading}" not found in original spec${formatSuggestionTail(sections, op.heading)}`,
        );
        continue;
      }
      planned.push({
        op: op.kind,
        startLine: anchor.endLine,
        endLine: anchor.endLine,
        replacement: ensureTrailingBlank(op.body.split('\n')),
      });
      appliedOps.push(op.kind);
    } else if (op.kind === 'append-section') {
      planned.push({
        op: op.kind,
        startLine: lines.length,
        endLine: lines.length,
        replacement: ensureTrailingBlank(op.body.split('\n')),
      });
      appliedOps.push(op.kind);
    }
  }

  if (errors.length > 0) {
    return { merged: null, warnings, errors, appliedOps: [] };
  }

  // Detect overlapping replace-section / insert-after spans — the splicer
  // doesn't support overlap and silently picking one would corrupt the doc.
  const sortedForOverlap = [...planned].sort((a, b) => a.startLine - b.startLine);
  for (let i = 1; i < sortedForOverlap.length; i++) {
    const prev = sortedForOverlap[i - 1];
    const cur = sortedForOverlap[i];
    if (prev.op === 'append-section' || cur.op === 'append-section') continue;
    if (cur.startLine < prev.endLine) {
      errors.push(
        `overlap: ${prev.op} at line ${prev.startLine} and ${cur.op} at line ${cur.startLine} overlap — refusing to merge`,
      );
    }
  }
  if (errors.length > 0) {
    return { merged: null, warnings, errors, appliedOps: [] };
  }

  // Apply edits in reverse order so earlier line indices remain valid.
  const merged = [...lines];
  const reverse = [...planned].sort((a, b) => b.startLine - a.startLine);
  for (const edit of reverse) {
    merged.splice(edit.startLine, edit.endLine - edit.startLine, ...edit.replacement);
  }

  const mergedText = merged.join('\n');

  // ─── Validation gates ───
  const originalH1 = (originalSpec.match(/^#\s+.+$/m) ?? [])[0] ?? null;
  const mergedH1 = (mergedText.match(/^#\s+.+$/m) ?? [])[0] ?? null;
  if (originalH1 && mergedH1 !== originalH1) {
    errors.push('h1-changed: merged output dropped or altered the H1 title');
  }

  if (mergedText.length < originalSpec.length * 0.6) {
    errors.push(
      `size-collapse: merged output is ${mergedText.length} chars vs ${originalSpec.length} original (< 60% floor)`,
    );
  }

  // Heading-inventory: every original H2-H6 should still be present unless it
  // was the target of a replace-section op.
  const replacedTargets = new Set(
    planned.filter((p) => p.op === 'replace-section').map((p) => p.targetNormalized),
  );
  const mergedWalk = walkSections(mergedText);
  const mergedNormalized = new Set(mergedWalk.sections.map((s) => s.normalized));
  for (const orig of sections) {
    if (orig.level === 1) continue; // H1 is checked separately above
    if (replacedTargets.has(orig.normalized)) continue;
    if (!mergedNormalized.has(orig.normalized)) {
      errors.push(`heading-lost: original section "${orig.rawTitle}" is missing from merged output`);
    }
  }

  // Duplicate-consecutive check.
  const mergedHeadings = mergedWalk.sections.map((s) => s.normalized);
  for (let i = 1; i < mergedHeadings.length; i++) {
    if (mergedHeadings[i] === mergedHeadings[i - 1] && mergedHeadings[i].length > 0) {
      errors.push(`duplicate-heading: "${mergedWalk.sections[i].rawTitle}" appears twice in a row in merged output`);
    }
  }

  if (errors.length > 0) {
    return { merged: null, warnings, errors, appliedOps: [] };
  }

  return { merged: mergedText, warnings, errors, appliedOps };
}

/** Make sure the inserted body ends with a blank line so the next section starts cleanly. */
function ensureTrailingBlank(body: string[]): string[] {
  const out = [...body];
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  out.push('', '');
  return out;
}

/** Pretty one-line summary for the assistant chat surface. */
export function summarizePatchApplication(result: ApplyResult): string {
  if (result.merged === null) {
    return `Coverage repair could not be applied — original spec preserved. Reasons: ${
      result.errors.join('; ') || 'unknown'
    }`;
  }
  const counts = new Map<PatchOpKind, number>();
  for (const k of result.appliedOps) counts.set(k, (counts.get(k) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${n}× ${k}`);
  const tail = result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : '';
  return `Coverage repair applied: ${parts.join(', ')}${tail}.`;
}
