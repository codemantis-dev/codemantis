// ═══════════════════════════════════════════════════════════════════════
// Spec Writer — Selectable option parser (primary ?> + fallback formats)
// ═══════════════════════════════════════════════════════════════════════

/** Primary marker pattern: `?> Option text` */
const OPTION_MARKER = /^\s*\?>\s*(.+)$/gm;

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

function parsePrimaryMarkers(content: string): ParseResult | null {
  const options: string[] = [];
  // Reset lastIndex for safety (global regex)
  OPTION_MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPTION_MARKER.exec(content)) !== null) {
    options.push(m[1].trim());
  }
  if (options.length === 0) return null;

  const cleanContent = content.replace(/^\s*\?>\s*.+$/gm, '').trim();
  return { options, cleanContent };
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

  // Collect consecutive matching items (allow single blank lines between items)
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
      // Allow one blank line inside the list (models sometimes space out items)
      if (i + 1 < lines.length && pattern.test(lines[i + 1])) {
        i++;
      } else {
        break;
      }
    } else {
      break;
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
