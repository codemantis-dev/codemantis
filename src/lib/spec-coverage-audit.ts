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
    'Coverage audit on the spec you just wrote — the following items from the input are missing or were silently changed. ' +
      'Please supply ONLY the missing/corrected content, matching the structure you used above. ' +
      'Begin your reply with the marker `<!-- AUDIT-PATCH -->` so the system can splice it in.',
    '',
  );

  if (missingSections.length > 0) {
    lines.push('Missing input sections (reproduce each as its own H2 with full content from the input):');
    for (const f of missingSections.slice(0, 25)) {
      lines.push(`- ${f.inputRef} ${f.title} (from \`${f.source}\`)`);
    }
    if (missingSections.length > 25) {
      lines.push(`- …and ${missingSections.length - 25} more`);
    }
    lines.push('');
  }

  if (unmapped.length > 0) {
    lines.push('Coverage map rows claim these output sections exist but I cannot find them:');
    for (const f of unmapped.slice(0, 15)) {
      lines.push(`- ${f.inputRef} → ${f.title}`);
    }
    lines.push('');
  }

  if (renames.length > 0) {
    lines.push(
      'Schema rewrites — the following table names from the input do NOT appear in your output. ' +
        'Either restore the original name OR add an explicit DEVIATION block explaining the rename:',
    );
    for (const f of renames.slice(0, 25)) {
      lines.push(`- \`${f.inputName}\``);
    }
    lines.push('');
  }

  if (drift.length > 0) {
    lines.push('Verbatim-fidelity zones missing from the output — reproduce the input exactly:');
    for (const f of drift.slice(0, 25)) {
      const z = f.zone;
      lines.push(`- ${z.label ?? `${z.kind}: ${z.signature}`} (from \`${z.source}\`)`);
    }
    lines.push('');
  }

  if (numerics.length > 0) {
    lines.push('Numeric facts (cost figures) from the input not present in the output — preserve every value:');
    for (const f of numerics.slice(0, 25)) {
      lines.push(`- ${f.what}: ${f.sample}`);
    }
    lines.push('');
  }

  if (trunc) {
    lines.push(
      `The spec output appears truncated — the last heading was "${trunc.lastHeading}" and it ended at "${trunc.tail}". ` +
        'Please continue from where it stopped, completing the truncated section AND every section after it.',
      '',
    );
  }

  if (placeholders.length > 0) {
    lines.push(`A placeholder leaked into the output: "${placeholders[0].quote}". Replace it with concrete content.`, '');
  }

  if (ratio) {
    lines.push(
      `Output is too compressed — current ratio ${(ratio.ratio * 100).toFixed(0)}% of input ` +
        `(floor ${(ratio.floor * 100).toFixed(0)}%). Sections may have been summarized when they should have been transcribed verbatim. ` +
        'Re-expand any over-compressed sections.',
      '',
    );
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
    }
  }
  return c;
}
