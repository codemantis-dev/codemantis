// ═══════════════════════════════════════════════════════════════════════
// Spec Writer — Selectable option parser (primary ?> + fallback formats)
// ═══════════════════════════════════════════════════════════════════════

/** Markdown checkboxes: `- [ ] Option` or `- [x] Option` */
const CHECKBOX = /^[ \t]*-\s+\[[ xX]\]\s+(.+)$/;

/** Numbered items: `1. Option` or `1) Option` */
const NUMBERED = /^[ \t]*\d+[.)]\s+(.+)$/;

/** Bullet items: `- Option` or `* Option` (negative lookahead prevents double-matching checkboxes) */
const BULLET = /^[ \t]*[-*]\s+(?!\[[ xX]\])(.+)$/;

/**
 * Selection trigger phrases — signals that the upcoming list is meant
 * to be interactive options the user should pick from.
 *
 * Matches phrases like "select which ones to include:",
 * "choose which features:", "here are the options:", etc.
 * Requires the trigger line to end with `:` or `?` (possibly with trailing whitespace).
 */
const SELECTION_TRIGGERS = [
  /select\s+(?:which|the|your|any|all)\b/i,
  /choose\s+(?:which|the|from|your|one|between)\b/i,
  /which\s+(?:ones?|features?|options?)\s+(?:to|do\s+you|would\s+you|should)\b/i,
  /how\s+would\s+you\s+like\s+to\b/i,
  /pick\s+(?:the|which|your)\b/i,
  /here\s+are\s+(?:the|your|some)\s+(?:options|features|choices)\b/i,
  /(?:features?|options?)\s+(?:i'll|i\s+will|to)\s+include\b/i,
  /include\s+(?:for|in)\s+this\b/i,
];

/** Minimum items required for a fallback list to be considered interactive */
const MIN_FALLBACK_OPTIONS = 2;

/** Maximum blank lines between trigger and list start */
const MAX_GAP_LINES = 3;

export interface ParseResult {
  options: string[];
  cleanContent: string;
}

/**
 * Parse selectable options from an AI response.
 *
 * 1. Primary: extract `?>` markers (always preferred).
 * 2. Fallback: if no `?>` found, look for a selection-trigger phrase
 *    followed by a markdown list (checkboxes > numbered > bullets).
 *
 * Returns `null` when no options are detected.
 */
export function parseSelectableOptions(content: string): ParseResult | null {
  // ── Primary: ?> markers ──────────────────────────────────────────
  const primary = parsePrimaryMarkers(content);
  if (primary) return primary;

  // ── Fallback: markdown lists after a selection trigger ───────────
  return parseFallbackList(content);
}

// ── Primary parser ─────────────────────────────────────────────────

/** Single-line ?> pattern (no global flag — used per-line) */
const OPTION_MARKER_LINE = /^\s*\?>\s*(.+)$/;

/**
 * Maximum distance (in lines) between a known option line and a candidate
 * markdown list item for the candidate to be swept into the options set.
 */
const ADJACENCY_RADIUS = 2;

function parsePrimaryMarkers(content: string): ParseResult | null {
  const lines = content.split('\n');

  // Pass 1: collect all ?> lines
  const optionLineIndices = new Set<number>();
  const allOptions: { index: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = OPTION_MARKER_LINE.exec(lines[i]);
    if (m) {
      allOptions.push({ index: i, text: m[1].trim() });
      optionLineIndices.add(i);
    }
  }
  if (allOptions.length === 0) return null;

  // Pass 2: sweep for adjacent markdown list items that the AI formatted
  // without ?> (format drift). Only collect items within ADJACENCY_RADIUS
  // of an existing option line OR contiguous with an already-collected item.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < lines.length; i++) {
      if (optionLineIndices.has(i)) continue;
      const line = lines[i];
      const cbm = CHECKBOX.exec(line) || NUMBERED.exec(line) || BULLET.exec(line);
      if (!cbm) continue;

      const isAdjacent = [...optionLineIndices].some(
        (idx) => Math.abs(idx - i) <= ADJACENCY_RADIUS,
      );
      if (isAdjacent) {
        allOptions.push({ index: i, text: cbm[1].trim() });
        optionLineIndices.add(i);
        changed = true; // re-scan to expand contiguously
      }
    }
  }

  // Sort by line index to preserve original order
  allOptions.sort((a, b) => a.index - b.index);

  // Build clean content by stripping all matched option lines
  const cleanContent = lines
    .filter((_, idx) => !optionLineIndices.has(idx))
    .join('\n')
    .trim();

  return { options: allOptions.map((o) => o.text), cleanContent };
}

// ── Fallback parser ────────────────────────────────────────────────

function parseFallbackList(content: string): ParseResult | null {
  const lines = content.split('\n');

  // Collect all trigger line indices (scan backward so we try latest first)
  const triggerIndices: number[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isSelectionTrigger(lines[i])) {
      triggerIndices.push(i);
    }
  }
  if (triggerIndices.length === 0) return null;

  // Try each trigger — the first one with a valid list after it wins
  for (const triggerLineIdx of triggerIndices) {
    const result = tryListAfterTrigger(lines, triggerLineIdx);
    if (result) return result;
  }

  return null;
}

/** Try to extract a list starting within MAX_GAP_LINES after the given trigger line. */
function tryListAfterTrigger(lines: string[], triggerLineIdx: number): ParseResult | null {
  // Scan forward from the trigger, skipping up to MAX_GAP_LINES blanks
  let listStart = triggerLineIdx + 1;
  let blanks = 0;
  while (listStart < lines.length && !lines[listStart].trim()) {
    blanks++;
    if (blanks > MAX_GAP_LINES) return null;
    listStart++;
  }
  if (listStart >= lines.length) return null;

  // Detect list format from the first non-blank line
  const firstLine = lines[listStart];
  let pattern: RegExp;
  if (CHECKBOX.test(firstLine)) pattern = CHECKBOX;
  else if (NUMBERED.test(firstLine)) pattern = NUMBERED;
  else if (BULLET.test(firstLine)) pattern = BULLET;
  else return null;

  // Collect matching items, tolerating blank lines and up to 1 non-matching
  // interruption (sub-header, annotation) if the list pattern resumes nearby.
  const options: string[] = [];
  const matchedLineIndices = new Set<number>();
  let i = listStart;
  while (i < lines.length) {
    const line = lines[i];
    const match = pattern.exec(line);
    if (match) {
      options.push(match[1].trim());
      matchedLineIndices.add(i);
      i++;
    } else if (!line.trim()) {
      // Blank line — check if list resumes within 2 lines
      const resumesAt1 = i + 1 < lines.length && pattern.test(lines[i + 1]);
      const resumesAt2 = i + 2 < lines.length && !lines[i + 1]?.trim() && pattern.test(lines[i + 2]);
      if (resumesAt1 || resumesAt2) {
        i++;
      } else {
        break;
      }
    } else {
      // Non-matching, non-blank line (sub-header, annotation, etc.)
      // Allow skipping it if the list pattern resumes within 2 lines
      const resumesAt1 = i + 1 < lines.length && pattern.test(lines[i + 1]);
      const resumesAt2 = i + 2 < lines.length && pattern.test(lines[i + 2]);
      if (resumesAt1 || resumesAt2) {
        i++;
      } else {
        break;
      }
    }
  }

  if (options.length < MIN_FALLBACK_OPTIONS) return null;

  // Strip matched list lines from content
  const cleanLines = lines.filter((_, idx) => !matchedLineIndices.has(idx));
  const cleanContent = cleanLines.join('\n').trim();

  return { options, cleanContent };
}

function isSelectionTrigger(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return SELECTION_TRIGGERS.some((re) => re.test(trimmed));
}
