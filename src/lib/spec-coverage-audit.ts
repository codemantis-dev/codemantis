// ═══════════════════════════════════════════════════════════════════════
// Spec Coverage Audit — Stage 1 of the SpecWriter quality enhancement.
//
// Pure-TypeScript checker that compares a SpecWriter output against the
// input document(s) the user attached. Detects:
//   1. missing input sections
//   2. unmapped sections in the coverage map
//   3. verbatim-fidelity drift (SQL/code/copy/$-figures/model names)
//   4. silent schema renames (table names from input absent in output)
//   5. enum value loss
//   6. cost-figure loss
//   7. model-name loss
//   8. truncation (output ended mid-fence / mid-sentence)
//   9. leaked placeholders ("TBD", "<insert>", trailing "...")
//  10. byte-ratio floor (output too short relative to input)
//
// On failure, builds recheck prompts that ask the model to supply ONLY the
// missing pieces — used by the request_recheck loop in useSpecConversation.
// ═══════════════════════════════════════════════════════════════════════

import type {
  AuditFailure,
  CoverageAuditOptions,
  CoverageAuditReport,
  FidelityZoneRef,
  InputDocSummary,
  InputSectionRef,
  SpecMessage,
} from '../types/spec-writer';

/** One input document to audit against. */
export interface InputDoc {
  /** Display name (filename, or `pasted-message-N`). */
  name: string;
  /** Raw text content. */
  content: string;
}

/** Minimum body length for a pasted message to be considered a "spec input doc" rather than chat noise. */
const MIN_PASTED_INPUT_BYTES = 1500;

// ─── Session-size thresholds (see ui-session-too-large failure) ───────
//
// These map to the prompt-template guidance in
// `src/lib/spec-prompts/{new-app-mode,feature-mode}.ts`. If you change them
// here, update the prompt copy too — otherwise the audit will keep flagging
// sessions the model thought were within bounds, and the recheck loop will
// burn rounds without converging.
export const MAX_WORK_ITEMS_PER_SESSION = 12;
export const MAX_FILES_PER_SESSION = 10;
export const MAX_PHASES_REFERENCED = 2;
export const MAX_SURFACES_PER_SESSION = 2;

/**
 * Extract InputDocs from the conversation history. Input docs are:
 *   1. user-message attachments with `text_content` (markdown, txt, pdf-extracted)
 *   2. user messages whose body is large and document-shaped (looks like a spec)
 *
 * Pasted text messages are only counted when long AND they look document-like
 * (start with `#` heading or contain multiple `## ` headings). This avoids
 * treating ordinary chat replies as spec input.
 */
export function extractInputDocs(messages: SpecMessage[]): InputDoc[] {
  const docs: InputDoc[] = [];
  let pastedCounter = 0;
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.text_content && att.text_content.length > 0) {
          docs.push({ name: att.name, content: att.text_content });
        }
      }
    }
    if (msg.content && msg.content.length >= MIN_PASTED_INPUT_BYTES && looksLikeDocument(msg.content)) {
      pastedCounter++;
      docs.push({ name: `pasted-message-${pastedCounter}`, content: msg.content });
    }
  }
  return docs;
}

function looksLikeDocument(text: string): boolean {
  if (/^#\s+/m.test(text.slice(0, 500))) return true;
  const h2Count = (text.match(/^##\s+/gm) ?? []).length;
  return h2Count >= 3;
}

const DEFAULT_BYTE_RATIO_FLOOR = 0.6;
const TRUNCATION_TAIL_CHARS = 80;

// ─────────────────────────────────────────────────────────────────────
// Section parsing
// ─────────────────────────────────────────────────────────────────────

/** Pull H1/H2 headings out of a markdown doc. */
export function parseSections(content: string): InputSectionRef[] {
  const lines = content.split('\n');
  const sections: InputSectionRef[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length === 1 ? 1 : 2;
    const title = m[2];
    // Try to extract a section number ("3.1", "16", "0") from the start of the title.
    const numMatch = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/.exec(title);
    const ref = numMatch ? `§${numMatch[1]}` : title;
    sections.push({ ref, title, level: level as 1 | 2, line: i });
  }
  return sections;
}

/**
 * Strip headings down to a normalized comparable form.
 * Removes leading "§N", "##" markers, and lowercases.
 */
function normalizeRef(ref: string): string {
  return ref.replace(/^§/, '').toLowerCase().trim();
}

function normalizeTitle(title: string): string {
  return title
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────
// Fidelity-zone extraction (run on input docs)
// ─────────────────────────────────────────────────────────────────────

const SQL_TABLE_RE = /(?:CREATE|ALTER)\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?[`"]?(\w+)[`"]?/gi;
const ENUM_VALUE_RE = /'([a-z][a-z0-9_]*)'/g;
const COST_RE = /\$\s?\d+(?:\.\d+)+/g;
const MODEL_RE = /\b(?:gpt|claude|gemini|grok|llama|mistral|opus|sonnet|haiku)[-\w.]+/gi;

/** Scan input docs and return verbatim-fidelity zones the audit will enforce. */
export function extractFidelityZones(docs: InputDoc[]): FidelityZoneRef[] {
  const zones: FidelityZoneRef[] = [];
  const seen = new Set<string>();
  const push = (zone: FidelityZoneRef): void => {
    const key = `${zone.kind}:${zone.signature}`;
    if (seen.has(key)) return;
    seen.add(key);
    zones.push(zone);
  };
  for (const doc of docs) {
    // Table names from CREATE/ALTER TABLE statements.
    for (const m of doc.content.matchAll(SQL_TABLE_RE)) {
      push({ kind: 'table-name', source: doc.name, signature: m[1], label: `table \`${m[1]}\`` });
    }
    // Cost figures.
    for (const m of doc.content.matchAll(COST_RE)) {
      push({ kind: 'cost-figure', source: doc.name, signature: m[0].replace(/\s+/g, '') });
    }
    // Model names.
    for (const m of doc.content.matchAll(MODEL_RE)) {
      // Only keep names that look version-tagged (have a digit) to avoid false positives like "claude" alone.
      if (!/\d/.test(m[0])) continue;
      push({ kind: 'model-name', source: doc.name, signature: m[0] });
    }
    // Enum values inside CHECK / IN clauses (heuristic: lines containing "CHECK" or "IN (" plus the value list).
    const enumLines = doc.content.match(/CHECK\s*\([^)]+\)|IN\s*\([^)]+\)/gi) ?? [];
    for (const line of enumLines) {
      for (const m of line.matchAll(ENUM_VALUE_RE)) {
        push({ kind: 'enum-value', source: doc.name, signature: m[1] });
      }
    }
  }
  return zones;
}

// ─────────────────────────────────────────────────────────────────────
// Coverage map parsing (output)
// ─────────────────────────────────────────────────────────────────────

interface CoverageRow {
  inputRef: string;
  outputRef: string;
  status: string;
}

/**
 * Find the Input→Output coverage map table at the top of the output spec.
 * Looks for a markdown table whose header row contains "Input" and "Output" (case-insensitive).
 * Returns the rows, or [] if no map is present.
 */
export function parseCoverageMap(output: string): CoverageRow[] {
  const lines = output.split('\n');
  // Find the header
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.startsWith('|')) continue;
    const lower = l.toLowerCase();
    if (lower.includes('input') && lower.includes('output')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  // Skip the divider row, parse rows until the table ends
  const rows: CoverageRow[] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const l = lines[i];
    if (!l.startsWith('|')) break;
    if (/^\|\s*-+/.test(l)) continue;
    const cells = l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    rows.push({
      inputRef: cells[0],
      outputRef: cells[cells.length - 2],
      status: cells[cells.length - 1].toLowerCase(),
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────
// Output structural analysis
// ─────────────────────────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bTBD\b/,
  /\bTBC\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /<insert\s+[^>]*>/i,
  /<\s*placeholder\s*>/i,
  /\.\.\.\s*$/m,
];

interface TruncationSignal {
  truncated: boolean;
  lastHeading: string;
  tail: string;
}

function detectTruncation(output: string): TruncationSignal {
  const trimmed = output.trimEnd();
  if (!trimmed) return { truncated: true, lastHeading: '', tail: '' };

  // Mismatched code fence: odd number of ``` lines.
  const fenceCount = (trimmed.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 !== 0) {
    return {
      truncated: true,
      lastHeading: lastHeadingBefore(output, output.length),
      tail: trimmed.slice(-TRUNCATION_TAIL_CHARS),
    };
  }

  // Trailing ellipsis ("..." or "…") on the final line.
  const lastLine = trimmed.split('\n').pop()!.trim();
  if (/(\.\.\.|…)$/.test(lastLine)) {
    return {
      truncated: true,
      lastHeading: lastHeadingBefore(output, output.length),
      tail: trimmed.slice(-TRUNCATION_TAIL_CHARS),
    };
  }

  // Mid-sentence end: doesn't end in markdown punctuation, list marker, fence, or table row.
  const cleanEnders = /[.!?:;>)\]"`]$|^\|.*\|$|^[-*+]\s.*$|^\d+\.\s.*$|^```$/;
  if (!cleanEnders.test(lastLine)) {
    return {
      truncated: true,
      lastHeading: lastHeadingBefore(output, output.length),
      tail: trimmed.slice(-TRUNCATION_TAIL_CHARS),
    };
  }

  return { truncated: false, lastHeading: '', tail: '' };
}

function lastHeadingBefore(text: string, end: number): string {
  const slice = text.slice(0, end);
  const matches = [...slice.matchAll(/^#{1,3}\s+(.+)$/gm)];
  return matches.length > 0 ? matches[matches.length - 1][1] : '';
}

// ─────────────────────────────────────────────────────────────────────
// UI-completeness checks (run regardless of input docs)
//
// Hybrid strictness:
//   - Strict (labeled-field) checks: every entity H3 in §Data Model has
//     `Screens:`; every endpoint H3 in §API has `Triggered by:`; every
//     session in §Session Plan has `User-visible outcome:` (plus
//     `Foundation justification:` when tagged (foundation)).
//   - Prose checks: §Error Handling contains at least one UI-surface
//     keyword; forms have validation language; lists have state language.
// ─────────────────────────────────────────────────────────────────────

const UI_SURFACE_KEYWORDS = /\b(toast|banner|inline|modal|full[- ]page)\b/i;

/**
 * Locate an H2 section by predicate and return its body line range plus the
 * absolute starting line index. Returns null when no matching section exists.
 */
function findH2Section(
  output: string,
  matcher: (title: string) => boolean,
): { body: string[]; startLine: number } | null {
  const sections = parseSections(output);
  const lines = output.split('\n');
  const idx = sections.findIndex((s) => s.level === 2 && matcher(s.title));
  if (idx < 0) return null;
  const start = sections[idx].line + 1;
  const next = sections.slice(idx + 1).find((s) => s.level === 2);
  const end = next ? next.line : lines.length;
  return { body: lines.slice(start, end), startLine: start };
}

/** Split a section body into its H3 sub-sections (entities, endpoints, etc.). */
function splitH3SubSections(
  body: string[],
): Array<{ title: string; body: string[] }> {
  const result: Array<{ title: string; body: string[] }> = [];
  const indices: Array<{ line: number; title: string }> = [];
  let inFence = false;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    indices.push({ line: i, title: m[1] });
  }
  for (let k = 0; k < indices.length; k++) {
    const { line, title } = indices[k];
    const nextLine = k + 1 < indices.length ? indices[k + 1].line : body.length;
    result.push({ title, body: body.slice(line + 1, nextLine) });
  }
  return result;
}

/** Split the Session Plan body into its individual session blocks. */
function splitSessionPlanBlocks(
  body: string[],
): Array<{ title: string; body: string[] }> {
  const result: Array<{ title: string; body: string[] }> = [];
  const indices: Array<{ line: number; title: string }> = [];
  let inFence = false;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^###\s+(Session\s+\d+[^\n]*)$/.exec(line.trim());
    if (!m) continue;
    indices.push({ line: i, title: m[1].trim() });
  }
  for (let k = 0; k < indices.length; k++) {
    const { line, title } = indices[k];
    const nextLine = k + 1 < indices.length ? indices[k + 1].line : body.length;
    result.push({ title, body: body.slice(line + 1, nextLine) });
  }
  return result;
}

/** Check: every H3 entity in §Data Model has a `Screens:` labeled field. */
function checkOrphanEntities(output: string): AuditFailure[] {
  const dm = findH2Section(
    output,
    (t) => /data model(\s+changes)?/i.test(t) && !/api|endpoints/i.test(t),
  );
  if (!dm) return [];
  const entities = splitH3SubSections(dm.body);
  const failures: AuditFailure[] = [];
  for (const e of entities) {
    const hasScreens = e.body.some((l) => /\bScreens:\s*\S/i.test(l));
    if (!hasScreens) {
      failures.push({ kind: 'ui-orphan-entity', entity: e.title });
    }
  }
  return failures;
}

/** Check: every H3 endpoint in §API has a `Triggered by:` labeled field. */
function checkUntriggeredEndpoints(output: string): AuditFailure[] {
  const api = findH2Section(
    output,
    (t) =>
      (/\bapi\b/i.test(t) || /data layer/i.test(t)) && !/pages|routes/i.test(t),
  );
  if (!api) return [];
  const endpoints = splitH3SubSections(api.body);
  const failures: AuditFailure[] = [];
  for (const e of endpoints) {
    const hasTrigger = e.body.some((l) => /\bTriggered by:\s*\S/i.test(l));
    if (!hasTrigger) {
      failures.push({ kind: 'ui-untriggered-endpoint', endpoint: e.title });
    }
  }
  return failures;
}

/** Check: §Error Handling mentions at least one UI surface keyword. */
function checkInvisibleErrors(output: string): AuditFailure[] {
  const err = findH2Section(output, (t) => /error handling/i.test(t));
  if (!err) return [];
  const text = err.body.join('\n');
  // Only flag if the section has substantive content (avoid noise on empty sections).
  if (text.trim().length < 40) return [];
  if (UI_SURFACE_KEYWORDS.test(text)) return [];
  return [{ kind: 'ui-invisible-errors' }];
}

/**
 * Check session-plan blocks for User-visible outcome / Foundation justification.
 * Foundation sessions must be contiguous from the first session.
 */
function checkSessionOutcomes(output: string): AuditFailure[] {
  const sp = findH2Section(output, (t) => /session plan/i.test(t));
  if (!sp) return [];
  const sessions = splitSessionPlanBlocks(sp.body);
  if (sessions.length === 0) return [];

  const failures: AuditFailure[] = [];
  let foundationContiguityBroken = false;
  let sawNonFoundation = false;

  for (const s of sessions) {
    const outcomeLine = s.body.find((l) =>
      /\*\*\s*User[- ]visible outcome:\s*\*\*/i.test(l),
    );
    if (!outcomeLine) {
      failures.push({ kind: 'ui-session-no-outcome', session: s.title });
      continue;
    }

    const outcomeValue = outcomeLine
      .replace(/^[^*]*\*\*\s*User[- ]visible outcome:\s*\*\*\s*/i, '')
      .trim();
    const isFoundation = /^\(foundation\)/i.test(outcomeValue);

    if (isFoundation) {
      if (sawNonFoundation && !foundationContiguityBroken) {
        failures.push({ kind: 'ui-foundation-non-contiguous', session: s.title });
        foundationContiguityBroken = true;
      }
      const justificationLine = s.body.find((l) =>
        /\*\*\s*Foundation justification:\s*\*\*/i.test(l),
      );
      const hasJustification =
        !!justificationLine &&
        justificationLine
          .replace(/^[^*]*\*\*\s*Foundation justification:\s*\*\*\s*/i, '')
          .trim().length > 0;
      if (!hasJustification) {
        failures.push({
          kind: 'ui-foundation-missing-justification',
          session: s.title,
        });
      }
    } else if (outcomeValue.length > 0) {
      sawNonFoundation = true;
    } else {
      // Field present but empty — treat as missing outcome.
      failures.push({ kind: 'ui-session-no-outcome', session: s.title });
    }
  }

  return failures;
}

/** Remove fenced code blocks so SQL/code keywords don't trip prose checks. */
function stripFencedBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/**
 * The prose checks (forms/lists) only make sense for UI-bearing specs.
 * A spec without any §Pages / §Routes / §Components H2 is either a
 * minimal fixture or a backend-only spec — skip rather than over-flag.
 */
function hasUISection(output: string): boolean {
  const sections = parseSections(output);
  return sections.some(
    (s) => s.level === 2 && /\b(pages|routes|components|ui\/ux)\b/i.test(s.title),
  );
}

/**
 * Prose check: if the spec mentions forms but contains no validation
 * language, flag once. Only runs on UI-bearing specs.
 */
function checkFormValidation(output: string): AuditFailure[] {
  if (!hasUISection(output)) return [];
  const prose = stripFencedBlocks(output);
  const mentionsForm =
    /\bforms?\b/i.test(prose) ||
    /\bform\s+fields?\b/i.test(prose) ||
    /\b[A-Z]\w*Form\b/.test(prose);
  if (!mentionsForm) return [];
  const hasValidation = /\bvalidat(ion|e|ed)\b/i.test(prose);
  if (hasValidation) return [];
  return [{ kind: 'ui-form-no-validation' }];
}

/**
 * Prose check: if the spec describes a UI list/table view but is missing
 * empty/loading/error state language, flag once. UI-specific phrasing is
 * required to avoid matching `CREATE TABLE` in SQL or "a list of items"
 * in prose. Only runs on UI-bearing specs.
 */
function checkListStates(output: string): AuditFailure[] {
  if (!hasUISection(output)) return [];
  const prose = stripFencedBlocks(output);
  const mentionsList =
    /\b(list|table)\s+(view|page|component|grid)\b/i.test(prose) ||
    /\bdata\s+table\b/i.test(prose) ||
    /\b[A-Z]\w*(List|Table)\w*\b/.test(prose);
  if (!mentionsList) return [];
  const hasEmpty =
    /\bempty[- ]state\b/i.test(prose) ||
    /\bno (data|items|results)\b/i.test(prose);
  const hasLoading = /\bloading\b/i.test(prose);
  const hasError = /\berror[- ](state|handling|display|banner|message)\b/i.test(prose);
  if (hasEmpty && hasLoading && hasError) return [];
  return [{ kind: 'ui-list-no-states' }];
}

/**
 * Aggregate weight metrics for a single session block, used by
 * `checkSessionSizes`. Counts everything OUTSIDE fenced code so a long SQL
 * fence inside a session doesn't inflate the work-item or file count.
 *
 * Counters:
 *  - `workItems` — checkboxes (`- [ ]`) + numbered (`1.` / `1)`) + bulleted
 *    items inside a `Deliverables:` / `Tasks:` / `Implementation Checklist:`
 *    / `Prompt for Claude Code:` block. A bullet in a `Files:` block is NOT
 *    a work item (we count it separately).
 *  - `files` — files in a structured `Files:` block PLUS files mentioned
 *    inline in prose (paths matching a recognized extension), deduped.
 *  - `phases` — distinct `Section 9, Phase N` references.
 *  - `surfaces` — distinct production surfaces touched (`worker`, `edge-fn`,
 *    `frontend`, `migration`, `deploy`).
 *  - `hasDeployStep` — true when a top-level deliverable line begins with
 *    "Deploy". Inline mentions like "after deploy you should…" do NOT count.
 *  - `sqlFenceRatio` — bytes inside ```sql fences over total body bytes;
 *    drives the migration-session carve-out.
 *  - `hasIndivisibleMarker` — `**Indivisible:** {reason}` in body → model
 *    explicitly declined a split; suppresses the flag.
 */
interface SessionWeight {
  workItems: number;
  files: number;
  phases: number;
  surfaces: string[];
  hasDeployStep: boolean;
  sqlFenceRatio: number;
  hasIndivisibleMarker: boolean;
}

const KNOWN_FILE_EXTS = /\.(?:py|ts|tsx|js|jsx|sql|md|rs|toml|yaml|yml|json|css|html|sh)\b/;
const PROSE_FILE_PATTERN = new RegExp(
  `\\b([\\w./-]+${KNOWN_FILE_EXTS.source})`,
  'g',
);

/**
 * Section-block-aware bulleted-item counter. A `- foo` bullet only counts
 * as a work item when it lives inside one of the deliverable block headers
 * below; under `Files:` (file list) or `Read sections:` (just a list of
 * reading targets) it does NOT.
 */
const DELIVERABLE_BLOCK_HEADERS = [
  /^\s*\*\*\s*Implementation Checklist:\s*\*\*/i,
  /^\s*\*\*\s*Deliverables:\s*\*\*/i,
  /^\s*\*\*\s*Tasks:\s*\*\*/i,
  /^\s*\*\*\s*Prompt(?:\s+for\s+Claude\s+Code)?:\s*\*\*/i,
  /^\s*\*\*\s*Steps:\s*\*\*/i,
];
const FILES_BLOCK_HEADER = /^\s*\*\*\s*Files:\s*\*\*/i;
const ANY_LABELED_BLOCK_HEADER = /^\s*\*\*\s*[A-Z][\w -]+:\s*\*\*/;

export function countSessionWeight(body: string[]): SessionWeight {
  // Build a parallel "in-fence" mask so all regex passes share fence state.
  const inFence: boolean[] = [];
  let fenceState = false;
  let fenceTag = '';
  let sqlFenceBytes = 0;
  let totalBytes = 0;
  for (const line of body) {
    if (/^\s*```/.test(line)) {
      if (!fenceState) {
        // opening fence
        fenceState = true;
        fenceTag = line.trim().replace(/^```/, '').trim().toLowerCase();
      } else {
        // closing fence
        fenceState = false;
        fenceTag = '';
      }
      inFence.push(true);
      continue;
    }
    inFence.push(fenceState);
    totalBytes += line.length + 1;
    if (fenceState && (fenceTag === 'sql' || fenceTag.startsWith('sql'))) {
      sqlFenceBytes += line.length + 1;
    }
  }

  // Track which deliverable-block (or other) we're currently inside. A new
  // `**Header:**` line switches context; a blank line ends the block.
  let currentBlock: 'deliverable' | 'files' | 'other' | 'none' = 'none';
  const checkboxLines = new Set<number>();
  const numberedLines = new Set<number>();
  const bulletDeliverableLines = new Set<number>();
  let hasDeployStep = false;
  let hasIndivisibleMarker = false;

  for (let i = 0; i < body.length; i++) {
    if (inFence[i]) continue;
    const line = body[i];

    // Indivisible waiver — checked first so the line's header status doesn't
    // short-circuit the rest of the loop without us noticing the marker.
    if (/\*\*\s*Indivisible:\s*\*\*/i.test(line)) {
      hasIndivisibleMarker = true;
    }

    // Block-context tracking. A blank line ends a block (back to `none`).
    if (line.trim().length === 0) {
      currentBlock = 'none';
      continue;
    }
    if (DELIVERABLE_BLOCK_HEADERS.some((re) => re.test(line))) {
      currentBlock = 'deliverable';
      continue;
    }
    if (FILES_BLOCK_HEADER.test(line)) {
      currentBlock = 'files';
      continue;
    }
    if (ANY_LABELED_BLOCK_HEADER.test(line)) {
      currentBlock = 'other';
      continue;
    }

    if (/^\s*-\s*\[\s*[ xX]?\s*\]/.test(line)) {
      checkboxLines.add(i);
    } else if (/^\s*\d+[.)]\s+\S/.test(line)) {
      // Numbered items are always work items — they only show up in
      // deliverable contexts in practice (or as a numbered Session Plan
      // itself, which we never count here because we're already inside
      // a single session body).
      numberedLines.add(i);
    } else if (
      currentBlock === 'deliverable' &&
      /^\s*[-*]\s+\S/.test(line)
    ) {
      bulletDeliverableLines.add(i);
    }

    // Deploy-step detection: top-level deliverable line whose first word is
    // "Deploy". Must be either a numbered or bulleted top-level item, not a
    // sub-bullet (so we require <=2 leading spaces).
    if (/^[ ]{0,2}(?:\d+[.)]|[-*])\s+Deploy\b/i.test(line)) {
      hasDeployStep = true;
    }
  }

  const workItems =
    checkboxLines.size + numberedLines.size + bulletDeliverableLines.size;

  // File counting — structured (Files: block) + prose mentions, deduped.
  // The structured pass uses `currentBlock` to know when we're in a Files: block.
  // The prose pass runs on EVERY non-fenced line (including labeled-header lines
  // like `**Scope:** Touches a.py and b.py`) so files mentioned inline are picked up.
  const fileSet = new Set<string>();
  currentBlock = 'none';
  for (let i = 0; i < body.length; i++) {
    if (inFence[i]) continue;
    const line = body[i];

    // Block-context tracking for the structured matcher only.
    if (line.trim().length === 0) {
      currentBlock = 'none';
    } else if (FILES_BLOCK_HEADER.test(line)) {
      currentBlock = 'files';
      // The Files: line itself usually has no content after the `:`, but if
      // it does (e.g. `**Files:** worker/foo.py`) we still want the prose
      // scan below to pick it up.
    } else if (ANY_LABELED_BLOCK_HEADER.test(line)) {
      currentBlock = 'other';
    }

    // Structured: ``- `path/to/file.ts` (create)`` inside a Files: block.
    if (currentBlock === 'files') {
      const m = /^\s*[-*]\s*`([^`]+)`/.exec(line);
      if (m) {
        fileSet.add(m[1].trim());
        // Still fall through to prose scan — harmless, dedupes via Set.
      }
    }

    // Prose: anything that looks like a file path. Strip backticks first to
    // dedupe with the structured matches (which kept the path verbatim).
    const proseClean = line.replace(/`([^`]+)`/g, '$1');
    let match: RegExpExecArray | null;
    PROSE_FILE_PATTERN.lastIndex = 0;
    while ((match = PROSE_FILE_PATTERN.exec(proseClean)) !== null) {
      const candidate = match[1].trim();
      // Skip URLs, version strings, and bare extension matches (".py").
      if (/^https?:\/\//.test(candidate)) continue;
      if (/^\d/.test(candidate)) continue;
      if (candidate.startsWith('.')) continue;
      fileSet.add(candidate);
    }
  }
  const files = fileSet.size;

  // Phases — distinct N from "Section 9, Phase N" references.
  const phaseSet = new Set<string>();
  for (let i = 0; i < body.length; i++) {
    if (inFence[i]) continue;
    const phaseRe = /Section\s*9,?\s*Phase\s*(\d+)/gi;
    let m: RegExpExecArray | null;
    while ((m = phaseRe.exec(body[i])) !== null) {
      phaseSet.add(m[1]);
    }
  }
  const phases = phaseSet.size;

  // Surfaces — detect by keyword groups, outside fenced code. "deploy" is
  // tracked separately via hasDeployStep and counted as its own surface.
  const surfaceHits = new Set<string>();
  const proseOutsideFence = body
    .filter((_, i) => !inFence[i])
    .join('\n');
  if (/\bworker\b/i.test(proseOutsideFence) || /\.py\b/.test(proseOutsideFence)) {
    surfaceHits.add('worker');
  }
  if (
    /\bedge\s*(?:function|fn)\b/i.test(proseOutsideFence) ||
    /\bEF\b/.test(proseOutsideFence) ||
    /supabase\/functions\//.test(proseOutsideFence)
  ) {
    surfaceHits.add('edge-fn');
  }
  if (
    /\b(?:component|page|hook|route)\b/i.test(proseOutsideFence) ||
    /\.(?:tsx|jsx)\b/.test(proseOutsideFence)
  ) {
    surfaceHits.add('frontend');
  }
  if (
    /\bmigration\b/i.test(proseOutsideFence) ||
    /\.sql\b/.test(proseOutsideFence) ||
    /\bCREATE\s+(?:TABLE|INDEX)/i.test(proseOutsideFence)
  ) {
    surfaceHits.add('migration');
  }
  if (hasDeployStep) {
    surfaceHits.add('deploy');
  }

  return {
    workItems,
    files,
    phases,
    surfaces: [...surfaceHits].sort(),
    hasDeployStep,
    sqlFenceRatio: totalBytes > 0 ? sqlFenceBytes / totalBytes : 0,
    hasIndivisibleMarker,
  };
}

/**
 * Check: every session in §Session Plan must fit inside one Claude Code run.
 * See `countSessionWeight` for axis definitions and the carve-outs.
 */
function checkSessionSizes(output: string): AuditFailure[] {
  const sp = findH2Section(output, (t) => /session plan/i.test(t));
  if (!sp) return [];
  const sessions = splitSessionPlanBlocks(sp.body);
  if (sessions.length === 0) return [];

  const failures: AuditFailure[] = [];
  for (const s of sessions) {
    const w = countSessionWeight(s.body);

    // Explicit waiver from the model — skip.
    if (w.hasIndivisibleMarker) continue;

    // Atomic-migration carve-out — a session that's mostly SQL with ≤3 files
    // and only the `migration` surface (or `migration`+`deploy`) is allowed.
    const onlyMigrationSurfaces =
      w.surfaces.every((s_) => s_ === 'migration' || s_ === 'deploy');
    if (
      w.sqlFenceRatio > 0.5 &&
      w.files <= 3 &&
      onlyMigrationSurfaces &&
      !w.hasDeployStep
    ) {
      continue;
    }

    const reasons: Array<
      'work-items' | 'files' | 'phases' | 'surfaces' | 'deploy-step'
    > = [];
    if (w.workItems > MAX_WORK_ITEMS_PER_SESSION) reasons.push('work-items');
    if (w.files > MAX_FILES_PER_SESSION) reasons.push('files');
    if (w.phases >= MAX_PHASES_REFERENCED + 1) reasons.push('phases');
    if (w.surfaces.length >= MAX_SURFACES_PER_SESSION + 1) reasons.push('surfaces');
    if (w.hasDeployStep) reasons.push('deploy-step');

    if (reasons.length === 0) continue;

    failures.push({
      kind: 'ui-session-too-large',
      session: s.title,
      workItems: w.workItems,
      files: w.files,
      phases: w.phases,
      surfaces: w.surfaces,
      hasDeployStep: w.hasDeployStep,
      reasons,
    });
  }

  return failures;
}

/** Run every UI-completeness check and return aggregated failures. */
export function runUICompletenessChecks(
  output: string,
  options: { skipSessionSizeCheck?: boolean } = {},
): AuditFailure[] {
  return [
    ...checkOrphanEntities(output),
    ...checkUntriggeredEndpoints(output),
    ...checkInvisibleErrors(output),
    ...checkSessionOutcomes(output),
    ...(options.skipSessionSizeCheck ? [] : checkSessionSizes(output)),
    ...checkFormValidation(output),
    ...checkListStates(output),
  ];
}

// ─────────────────────────────────────────────────────────────────────
// The audit
// ─────────────────────────────────────────────────────────────────────

export function summarizeInput(doc: InputDoc): InputDocSummary {
  return {
    name: doc.name,
    bytes: doc.content.length,
    sections: parseSections(doc.content),
  };
}

export function auditCoverage(
  inputs: InputDoc[],
  output: string,
  options: CoverageAuditOptions = {},
): CoverageAuditReport {
  const byteRatioFloor = options.byteRatioFloor ?? DEFAULT_BYTE_RATIO_FLOOR;
  const skipForNewApp = options.skipForNewApp ?? false;

  const summaries = inputs.map(summarizeInput);
  const inputBytes = summaries.reduce((acc, s) => acc + s.bytes, 0);
  const inputSectionCount = summaries.reduce(
    (acc, s) => acc + s.sections.filter((sec) => sec.level === 2).length,
    0,
  );
  const outputBytes = output.length;
  const outputSections = parseSections(output);
  const outputH2Count = outputSections.filter((s) => s.level === 2).length;

  const ratios = {
    byteRatio: inputBytes === 0 ? 1 : outputBytes / inputBytes,
    sectionRatio: inputSectionCount === 0 ? 1 : outputH2Count / inputSectionCount,
  };

  const report: CoverageAuditReport = {
    status: 'pass',
    inputDocs: summaries,
    output: { sections: outputH2Count, bytes: outputBytes },
    ratios,
    failures: [],
    recheckPrompts: [],
  };

  // Skip the input-comparison checks for new-app mode (there's no doc to compare against).
  if (skipForNewApp || inputs.length === 0 || inputBytes === 0) {
    // Still run the structural checks below.
  } else {
    // Check 1: every input H2 should appear in the coverage map OR (fallback) in the output sections.
    const coverageMap = parseCoverageMap(output);
    const coveredRefs = new Set(coverageMap.map((r) => normalizeRef(r.inputRef)));
    const outputTitleSet = new Set(outputSections.map((s) => normalizeTitle(s.title)));
    for (const summary of summaries) {
      for (const sec of summary.sections.filter((s) => s.level === 2)) {
        const refKey = normalizeRef(sec.ref);
        const titleKey = normalizeTitle(sec.title);
        const inMap = coveredRefs.has(refKey);
        const inOutput = outputTitleSet.has(titleKey);
        if (!inMap && !inOutput) {
          report.failures.push({
            kind: 'missing-section',
            inputRef: sec.ref,
            title: sec.title,
            source: summary.name,
          });
        }
      }
    }

    // Check 2: a coverage-map row marked "covered" must point at a non-empty output section.
    for (const row of coverageMap) {
      if (!/covered|verbatim/.test(row.status)) continue;
      // Look for the output ref (e.g. "§3.10", "Appendix A") as a heading in the output.
      const wanted = row.outputRef.replace(/^§/, '').trim();
      if (!wanted) continue;
      const found = outputSections.some(
        (s) => s.title.includes(wanted) || s.ref.replace(/^§/, '') === wanted,
      );
      if (!found) {
        report.failures.push({
          kind: 'unmapped-section',
          inputRef: row.inputRef,
          title: row.outputRef,
          source: 'coverage-map',
        });
      }
    }

    // Check 3-7: verbatim-fidelity zones from the input must appear in the output.
    const zones = extractFidelityZones(inputs);
    for (const zone of zones) {
      if (zone.kind === 'table-name') {
        // Table name should appear in output (as `name`, "name", or in CREATE TABLE).
        const re = new RegExp(`\\b${escapeRegExp(zone.signature)}\\b`);
        if (!re.test(output)) {
          report.failures.push({ kind: 'schema-rename', inputName: zone.signature });
        }
      } else if (zone.kind === 'cost-figure') {
        if (!output.replace(/\s+/g, '').includes(zone.signature)) {
          report.failures.push({
            kind: 'missing-numeric',
            what: 'cost',
            sample: zone.signature,
          });
        }
      } else if (zone.kind === 'model-name') {
        if (!output.includes(zone.signature)) {
          report.failures.push({ kind: 'fidelity-drift', zone });
        }
      } else if (zone.kind === 'enum-value') {
        // Enum values are fuzzier — only flag a few common ones to avoid noise.
        // We enforce presence only for values that look like distinctive identifiers (>=4 chars).
        if (zone.signature.length < 4) continue;
        const re = new RegExp(`['"\`]${escapeRegExp(zone.signature)}['"\`]`);
        if (!re.test(output)) {
          report.failures.push({ kind: 'fidelity-drift', zone });
        }
      } else {
        // Other zones reuse the simple substring check.
        if (!output.includes(zone.signature)) {
          report.failures.push({ kind: 'fidelity-drift', zone });
        }
      }
    }
  }

  // Check 8: truncation.
  const trunc = detectTruncation(output);
  if (trunc.truncated) {
    report.failures.push({
      kind: 'truncation',
      lastHeading: trunc.lastHeading,
      tail: trunc.tail,
    });
  }

  // Check 9: leaked placeholders.
  for (const pat of PLACEHOLDER_PATTERNS) {
    const m = pat.exec(output);
    if (m) {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(output.length, m.index + m[0].length + 20);
      report.failures.push({
        kind: 'placeholder-leaked',
        quote: output.slice(start, end).replace(/\s+/g, ' ').trim(),
      });
      break; // one placeholder failure is enough — don't spam.
    }
  }

  // Check 10: byte-ratio floor (only when comparing against an input).
  if (!skipForNewApp && inputs.length > 0 && byteRatioFloor > 0) {
    if (ratios.byteRatio < byteRatioFloor) {
      report.failures.push({
        kind: 'byte-ratio-low',
        ratio: ratios.byteRatio,
        floor: byteRatioFloor,
      });
    }
  }

  // UI-completeness checks (run in both modes unless explicitly disabled).
  if (!options.skipUIChecks) {
    report.failures.push(
      ...runUICompletenessChecks(output, {
        skipSessionSizeCheck: options.skipSessionSizeCheck,
      }),
    );
  }

  if (report.failures.length > 0) {
    report.status = 'fail';
    report.recheckPrompts = buildRecheckPrompts(report.failures);
  }

  return report;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────
// Recheck prompt builder
// ─────────────────────────────────────────────────────────────────────

/**
 * Produce one or more follow-up prompts that ask the model to supply ONLY
 * the missing pieces. Designed to be sent as a user message in the existing
 * conversation, riding on the same prompt context.
 */
export function buildRecheckPrompts(failures: AuditFailure[]): string[] {
  if (failures.length === 0) return [];
  const lines: string[] = [];
  const missingSections = failures.filter(isMissingSection);
  const unmapped = failures.filter(isUnmapped);
  const drift = failures.filter(isDrift);
  const renames = failures.filter(isSchemaRename);
  const numerics = failures.filter(isMissingNumeric);
  const trunc = failures.find(isTruncation);
  const placeholders = failures.filter(isPlaceholder);
  const ratio = failures.find(isByteRatio);

  lines.push(
    'Coverage audit on the spec you just wrote — the following items from the input are missing or were silently changed.',
    '',
    'Reply ONLY with a structured patch envelope. The system splices the patch into your existing spec — your reply must NOT be a new full spec.',
    '',
    'FORMAT (strict):',
    '  Begin your reply with the literal marker:  `<!-- AUDIT-PATCH -->`',
    '  Then emit one or more patch blocks. Three operations are supported — anything outside this grammar is ignored:',
    '',
    '    `<!-- patch:replace-section heading="EXACT_HEADING" -->`',
    '      …new full body of that section, INCLUDING its `## ` or `### ` heading line on the first line…',
    '    `<!-- /patch -->`',
    '',
    '    `<!-- patch:insert-after heading="EXACT_HEADING" -->`',
    '      …new section to splice in immediately after the named anchor section…',
    '    `<!-- /patch -->`',
    '',
    '    `<!-- patch:append-section -->`',
    '      …new section to append at the end of the spec…',
    '    `<!-- /patch -->`',
    '',
    'Heading attribute rules:',
    '  - `heading="…"` MUST match a heading that already exists in the spec (e.g. `heading="§4.1 _STAGE_REGISTRY"`).',
    '  - For `replace-section`, the body MUST keep every existing sub-heading (H3) of the targeted section unless you are deliberately removing it. Dropping a sub-heading without an explicit removal will cause the splice to be rejected and the spec rolled back.',
    '  - Do NOT include the H1 title line. Do not redefine `# ` headings.',
    '',
    'Now emit the patches. Each item below corresponds to one `replace-section` / `insert-after` / `append-section` block:',
    '',
  );

  if (missingSections.length > 0) {
    lines.push('Missing input sections — emit ONE `<!-- patch:append-section -->` block per item, each containing a fresh H2 with full content from the input:');
    for (const f of missingSections.slice(0, 25)) {
      lines.push(`- ${f.inputRef} ${f.title} (from \`${f.source}\`)`);
    }
    if (missingSections.length > 25) {
      lines.push(`- …and ${missingSections.length - 25} more`);
    }
    lines.push('');
  }

  if (unmapped.length > 0) {
    lines.push('Coverage map rows claim these output sections exist but I cannot find them — emit ONE `<!-- patch:replace-section heading="…" -->` block per item that adds the missing body, OR remove the claim from the coverage map via a `<!-- patch:replace-section heading="Coverage Map" -->` block:');
    for (const f of unmapped.slice(0, 15)) {
      lines.push(`- ${f.inputRef} → ${f.title}`);
    }
    lines.push('');
  }

  if (renames.length > 0) {
    lines.push(
      'Schema rewrites — the following table names from the input do NOT appear in your output. ' +
        'Emit a `<!-- patch:replace-section heading="…" -->` block on the affected schema/data-model section that either restores the original name or adds an explicit DEVIATION block explaining the rename:',
    );
    for (const f of renames.slice(0, 25)) {
      lines.push(`- \`${f.inputName}\``);
    }
    lines.push('');
  }

  if (drift.length > 0) {
    lines.push('Verbatim-fidelity zones missing from the output — emit `<!-- patch:replace-section heading="…" -->` blocks on the section(s) that should contain these, reproducing the input exactly:');
    for (const f of drift.slice(0, 25)) {
      const z = f.zone;
      lines.push(`- ${z.label ?? `${z.kind}: ${z.signature}`} (from \`${z.source}\`)`);
    }
    lines.push('');
  }

  if (numerics.length > 0) {
    lines.push('Numeric facts (cost figures) from the input not present in the output — emit `<!-- patch:replace-section heading="…" -->` blocks restoring every value verbatim:');
    for (const f of numerics.slice(0, 25)) {
      lines.push(`- ${f.what}: ${f.sample}`);
    }
    lines.push('');
  }

  if (trunc) {
    lines.push(
      `The spec output appears truncated — the last heading was "${trunc.lastHeading}" and it ended at "${trunc.tail}". ` +
        'Emit a `<!-- patch:replace-section heading="' + trunc.lastHeading + '" -->` block restoring that section in full, plus `<!-- patch:append-section -->` blocks for every section that was supposed to follow it.',
      '',
    );
  }

  if (placeholders.length > 0) {
    lines.push(
      `A placeholder leaked into the output: "${placeholders[0].quote}". Emit a \`<!-- patch:replace-section heading="…" -->\` block on the affected section, replacing the placeholder with concrete content.`,
      '',
    );
  }

  if (ratio) {
    lines.push(
      `Output is too compressed — current ratio ${(ratio.ratio * 100).toFixed(0)}% of input ` +
        `(floor ${(ratio.floor * 100).toFixed(0)}%). Sections may have been summarized when they should have been transcribed verbatim. ` +
        'Emit `<!-- patch:replace-section heading="…" -->` blocks on each over-compressed section, re-expanding to verbatim transcription.',
      '',
    );
  }

  const orphanEntities = failures.filter(isOrphanEntity);
  if (orphanEntities.length > 0) {
    lines.push(
      'Orphan entities — these entities in §Data Model have no `Screens:` field, so no UI surfaces them. Emit a `<!-- patch:replace-section heading="### {EntityName}" -->` block per entity (or one block on the parent §Data Model section) that adds a `Screens: ScreenA, ScreenB` labeled field naming the screens that create/view/edit/delete the entity. If the entity is intentionally backend-only, declare `Screens: (backend-only — {reason})`:',
    );
    for (const f of orphanEntities.slice(0, 25)) {
      lines.push(`- \`${f.entity}\``);
    }
    lines.push('');
  }

  const untriggered = failures.filter(isUntriggeredEndpoint);
  if (untriggered.length > 0) {
    lines.push(
      'Untriggered endpoints — these endpoints in §API have no `Triggered by:` field, so it is unclear what UI element fires them. Emit a `<!-- patch:replace-section heading="### {endpoint}" -->` block per endpoint adding a `Triggered by: {UI element}` line. For system-only endpoints (cron / webhook / worker), declare `Triggered by: (system — {reason})`:',
    );
    for (const f of untriggered.slice(0, 25)) {
      lines.push(`- \`${f.endpoint}\``);
    }
    lines.push('');
  }

  if (failures.some(isInvisibleErrors)) {
    lines.push(
      'Error Handling section names no UI surface — every error class must declare where it appears using one of `toast`, `banner`, `inline`, `modal`, `full-page`. Emit a `<!-- patch:replace-section heading="…Error Handling…" -->` block where each error uses the format `Error: <class> → Surface: <keyword> → Copy: "<text>" → Recovery: <action>`.',
      '',
    );
  }

  const noOutcome = failures.filter(isSessionNoOutcome);
  if (noOutcome.length > 0) {
    lines.push(
      'Sessions missing `User-visible outcome:` — every session in §Session Plan must declare what the user can see and do after the session. Emit a `<!-- patch:replace-section heading="### {Session N: ...}" -->` block per session adding the field. If the session is a true foundation phase, declare `User-visible outcome: (foundation)` plus `Foundation justification: {reason}`:',
    );
    for (const f of noOutcome.slice(0, 25)) {
      lines.push(`- \`${f.session}\``);
    }
    lines.push('');
  }

  const noJustification = failures.filter(isFoundationMissingJustification);
  if (noJustification.length > 0) {
    lines.push(
      'Foundation sessions missing justification — sessions tagged `(foundation)` must include a non-empty `Foundation justification:` line. Emit `<!-- patch:replace-section heading="### {Session N: ...}" -->` blocks adding the justification:',
    );
    for (const f of noJustification.slice(0, 25)) {
      lines.push(`- \`${f.session}\``);
    }
    lines.push('');
  }

  const nonContiguous = failures.filter(isFoundationNonContiguous);
  if (nonContiguous.length > 0) {
    lines.push(
      'Foundation sessions out of order — `(foundation)` sessions must be contiguous from Session 1. These sessions are tagged foundation but appear after a user-visible session. Emit `<!-- patch:replace-section heading="### {Session N: ...}" -->` blocks that either give the session a real `User-visible outcome:` value or reorganize the session plan so foundation sessions run first:',
    );
    for (const f of nonContiguous.slice(0, 25)) {
      lines.push(`- \`${f.session}\``);
    }
    lines.push('');
  }

  if (failures.some(isFormNoValidation)) {
    lines.push(
      'Forms mentioned but no validation specs — every form must specify validation rules + error display. Emit `<!-- patch:replace-section heading="…" -->` blocks on the sections that introduce forms, adding per-field validation rules, exact error messages, and the timing (blur / submit).',
      '',
    );
  }

  if (failures.some(isListNoStates)) {
    lines.push(
      'List/table mentioned without complete state coverage — every list must specify empty state (with CTA), loading state, and error state. Emit `<!-- patch:replace-section heading="…" -->` blocks on the sections that introduce lists/tables, adding all three states with exact copy.',
      '',
    );
  }

  const oversizedSessions = failures.filter(isSessionTooLarge);
  if (oversizedSessions.length > 0) {
    lines.push(
      'Sessions too large for one Claude Code run — these sessions exceed the per-session size limits ' +
        `(max ${MAX_WORK_ITEMS_PER_SESSION} work items, ${MAX_FILES_PER_SESSION} files, ${MAX_PHASES_REFERENCED} phases, ${MAX_SURFACES_PER_SESSION} surfaces; deploy steps must live in their own session).`,
      'Emit a `<!-- patch:replace-section heading="### {Session N: …}" -->` block per oversized session that REPLACES it with 2–4 sibling H3 sessions using **suffix numbering** (`### Session {N}a: …`, `### Session {N}b: …`). Do NOT renumber later sessions — leave `### Session {N+1}` and downstream untouched so the heading-inventory gate passes.',
      'Each sub-session must keep the full Session Plan template (Scope / Read sections / Files / User-visible outcome / Prompt for Claude Code / Verify before next session / NOT).',
      'Splitting boundary priority: (1) user-visible outcome — one outcome per sub-session, (2) production surface — never mix worker code + edge-fn + frontend in one sub-session, (3) deploy steps always get their own sub-session, (4) file-group fallback (frontend vs API vs migration).',
      'If a session truly cannot be split (e.g., a single atomic migration), reply with a `replace-section` that keeps the heading and adds a `**Indivisible:** {reason}` line in the body — the auditor accepts that as an explicit waiver.',
      '',
    );
    for (const f of oversizedSessions.slice(0, 25)) {
      const bits: string[] = [];
      if (f.reasons.includes('work-items')) bits.push(`${f.workItems} work items`);
      if (f.reasons.includes('files')) bits.push(`${f.files} files`);
      if (f.reasons.includes('phases')) bits.push(`${f.phases} phases`);
      if (f.reasons.includes('surfaces'))
        bits.push(`${f.surfaces.length} surfaces (${f.surfaces.join(', ')})`);
      if (f.reasons.includes('deploy-step')) bits.push('contains a Deploy step');
      lines.push(`- \`${f.session}\` — ${bits.join('; ')}`);
    }
    lines.push('');
  }

  return [lines.join('\n').trimEnd()];
}

// ─────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────

function isMissingSection(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'missing-section' }> {
  return f.kind === 'missing-section';
}
function isUnmapped(f: AuditFailure): f is Extract<AuditFailure, { kind: 'unmapped-section' }> {
  return f.kind === 'unmapped-section';
}
function isDrift(f: AuditFailure): f is Extract<AuditFailure, { kind: 'fidelity-drift' }> {
  return f.kind === 'fidelity-drift';
}
function isSchemaRename(f: AuditFailure): f is Extract<AuditFailure, { kind: 'schema-rename' }> {
  return f.kind === 'schema-rename';
}
function isMissingNumeric(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'missing-numeric' }> {
  return f.kind === 'missing-numeric';
}
function isTruncation(f: AuditFailure): f is Extract<AuditFailure, { kind: 'truncation' }> {
  return f.kind === 'truncation';
}
function isPlaceholder(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'placeholder-leaked' }> {
  return f.kind === 'placeholder-leaked';
}
function isByteRatio(f: AuditFailure): f is Extract<AuditFailure, { kind: 'byte-ratio-low' }> {
  return f.kind === 'byte-ratio-low';
}
function isOrphanEntity(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-orphan-entity' }> {
  return f.kind === 'ui-orphan-entity';
}
function isUntriggeredEndpoint(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-untriggered-endpoint' }> {
  return f.kind === 'ui-untriggered-endpoint';
}
function isInvisibleErrors(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-invisible-errors' }> {
  return f.kind === 'ui-invisible-errors';
}
function isSessionNoOutcome(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-session-no-outcome' }> {
  return f.kind === 'ui-session-no-outcome';
}
function isFoundationMissingJustification(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-foundation-missing-justification' }> {
  return f.kind === 'ui-foundation-missing-justification';
}
function isFoundationNonContiguous(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-foundation-non-contiguous' }> {
  return f.kind === 'ui-foundation-non-contiguous';
}
function isFormNoValidation(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-form-no-validation' }> {
  return f.kind === 'ui-form-no-validation';
}
function isListNoStates(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-list-no-states' }> {
  return f.kind === 'ui-list-no-states';
}
function isSessionTooLarge(
  f: AuditFailure,
): f is Extract<AuditFailure, { kind: 'ui-session-too-large' }> {
  return f.kind === 'ui-session-too-large';
}

// ─────────────────────────────────────────────────────────────────────
// Human-readable summary (for the inline assistant message after audit)
// ─────────────────────────────────────────────────────────────────────

/** One-line description of a single failure. Used in the fallback assistant message. */
export function describeFailure(f: AuditFailure): string {
  switch (f.kind) {
    case 'missing-section':
      return `missing section ${f.inputRef} ${f.title} (from ${f.source})`;
    case 'unmapped-section':
      return `coverage map row ${f.inputRef} points to ${f.title} but it is not in the output`;
    case 'schema-rename':
      return `schema rename: input table \`${f.inputName}\` is absent from the output`;
    case 'fidelity-drift':
      return `verbatim drift: ${f.zone.label ?? `${f.zone.kind} ${f.zone.signature}`}`;
    case 'missing-numeric':
      return `missing ${f.what} value ${f.sample}`;
    case 'truncation':
      return `output truncated after "${f.lastHeading}"`;
    case 'placeholder-leaked':
      return `placeholder leaked: "${f.quote}"`;
    case 'byte-ratio-low':
      return `byte ratio ${(f.ratio * 100).toFixed(0)}% below floor ${(f.floor * 100).toFixed(0)}%`;
    case 'ui-orphan-entity':
      return `orphan entity: \`${f.entity}\` has no \`Screens:\` field — no screen surfaces this entity`;
    case 'ui-untriggered-endpoint':
      return `untriggered endpoint: \`${f.endpoint}\` has no \`Triggered by:\` field — no UI element fires this`;
    case 'ui-invisible-errors':
      return `error handling section names no UI surface (toast / banner / inline / modal / full-page)`;
    case 'ui-session-no-outcome':
      return `session \`${f.session}\` missing \`User-visible outcome:\` field`;
    case 'ui-foundation-missing-justification':
      return `session \`${f.session}\` tagged (foundation) but \`Foundation justification:\` is missing or empty`;
    case 'ui-foundation-non-contiguous':
      return `session \`${f.session}\` is tagged (foundation) but appears after a session with user-visible work`;
    case 'ui-form-no-validation':
      return `spec mentions forms but contains no validation specifications`;
    case 'ui-list-no-states':
      return `spec mentions a list/table but is missing empty / loading / error state coverage`;
    case 'ui-session-too-large': {
      const bits: string[] = [];
      if (f.reasons.includes('work-items')) bits.push(`${f.workItems} work items`);
      if (f.reasons.includes('files')) bits.push(`${f.files} files`);
      if (f.reasons.includes('phases')) bits.push(`${f.phases} phases`);
      if (f.reasons.includes('surfaces'))
        bits.push(`${f.surfaces.length} surfaces (${f.surfaces.join(', ')})`);
      if (f.reasons.includes('deploy-step')) bits.push('contains a Deploy step');
      return `session \`${f.session}\` is too large for a single Claude Code run — ${bits.join('; ')}`;
    }
  }
}

export function summarizeReport(report: CoverageAuditReport): string {
  if (report.status === 'pass') {
    return (
      `Coverage audit: PASS. ` +
      `Output is ${(report.ratios.byteRatio * 100).toFixed(0)}% of input by bytes, ` +
      `covers ${report.output.sections} H2 sections.`
    );
  }
  const counts = countFailures(report.failures);
  const parts: string[] = [];
  if (counts.missingSection > 0) parts.push(`${counts.missingSection} missing section(s)`);
  if (counts.unmapped > 0) parts.push(`${counts.unmapped} unmapped row(s)`);
  if (counts.schemaRename > 0) parts.push(`${counts.schemaRename} schema rename(s)`);
  if (counts.drift > 0) parts.push(`${counts.drift} verbatim drift(s)`);
  if (counts.missingNumeric > 0) parts.push(`${counts.missingNumeric} missing cost/numeric value(s)`);
  if (counts.truncation > 0) parts.push('output appears truncated');
  if (counts.placeholder > 0) parts.push('placeholder leaked');
  if (counts.byteRatio > 0)
    parts.push(`byte ratio ${(report.ratios.byteRatio * 100).toFixed(0)}% < floor`);
  if (counts.uiOrphanEntity > 0)
    parts.push(`${counts.uiOrphanEntity} orphan entity(ies) without Screens:`);
  if (counts.uiUntriggeredEndpoint > 0)
    parts.push(`${counts.uiUntriggeredEndpoint} endpoint(s) without Triggered by:`);
  if (counts.uiInvisibleErrors > 0) parts.push('error section names no UI surface');
  if (counts.uiSessionNoOutcome > 0)
    parts.push(`${counts.uiSessionNoOutcome} session(s) without User-visible outcome:`);
  if (counts.uiFoundationMissingJustification > 0)
    parts.push(
      `${counts.uiFoundationMissingJustification} foundation session(s) without justification`,
    );
  if (counts.uiFoundationNonContiguous > 0)
    parts.push(
      `${counts.uiFoundationNonContiguous} non-contiguous foundation session(s)`,
    );
  if (counts.uiFormNoValidation > 0) parts.push('forms mentioned without validation');
  if (counts.uiListNoStates > 0) parts.push('list/table mentioned without empty/loading/error states');
  if (counts.uiSessionTooLarge > 0)
    parts.push(
      `${counts.uiSessionTooLarge} session(s) too large for one Claude Code run`,
    );
  return `Coverage audit: FAIL — ${parts.join(', ')}.`;
}

interface FailureCounts {
  missingSection: number;
  unmapped: number;
  schemaRename: number;
  drift: number;
  missingNumeric: number;
  truncation: number;
  placeholder: number;
  byteRatio: number;
  uiOrphanEntity: number;
  uiUntriggeredEndpoint: number;
  uiInvisibleErrors: number;
  uiSessionNoOutcome: number;
  uiFoundationMissingJustification: number;
  uiFoundationNonContiguous: number;
  uiFormNoValidation: number;
  uiListNoStates: number;
  uiSessionTooLarge: number;
}

function countFailures(failures: AuditFailure[]): FailureCounts {
  const c: FailureCounts = {
    missingSection: 0,
    unmapped: 0,
    schemaRename: 0,
    drift: 0,
    missingNumeric: 0,
    truncation: 0,
    placeholder: 0,
    byteRatio: 0,
    uiOrphanEntity: 0,
    uiUntriggeredEndpoint: 0,
    uiInvisibleErrors: 0,
    uiSessionNoOutcome: 0,
    uiFoundationMissingJustification: 0,
    uiFoundationNonContiguous: 0,
    uiFormNoValidation: 0,
    uiListNoStates: 0,
    uiSessionTooLarge: 0,
  };
  for (const f of failures) {
    switch (f.kind) {
      case 'missing-section':
        c.missingSection++;
        break;
      case 'unmapped-section':
        c.unmapped++;
        break;
      case 'schema-rename':
        c.schemaRename++;
        break;
      case 'fidelity-drift':
        c.drift++;
        break;
      case 'missing-numeric':
        c.missingNumeric++;
        break;
      case 'truncation':
        c.truncation++;
        break;
      case 'placeholder-leaked':
        c.placeholder++;
        break;
      case 'byte-ratio-low':
        c.byteRatio++;
        break;
      case 'ui-orphan-entity':
        c.uiOrphanEntity++;
        break;
      case 'ui-untriggered-endpoint':
        c.uiUntriggeredEndpoint++;
        break;
      case 'ui-invisible-errors':
        c.uiInvisibleErrors++;
        break;
      case 'ui-session-no-outcome':
        c.uiSessionNoOutcome++;
        break;
      case 'ui-foundation-missing-justification':
        c.uiFoundationMissingJustification++;
        break;
      case 'ui-foundation-non-contiguous':
        c.uiFoundationNonContiguous++;
        break;
      case 'ui-form-no-validation':
        c.uiFormNoValidation++;
        break;
      case 'ui-list-no-states':
        c.uiListNoStates++;
        break;
      case 'ui-session-too-large':
        c.uiSessionTooLarge++;
        break;
    }
  }
  return c;
}
