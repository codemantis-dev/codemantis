// ═══════════════════════════════════════════════════════════════════════
// Spec Input Analyzer — Stage 2 of the SpecWriter quality enhancement.
//
// Runs BEFORE the AI is called, on every user-supplied input doc that has
// not been analyzed yet. Pure TypeScript, no LLM. Detects:
//
//   1. doubled content        — same H1/H2 repeated across the file (the
//                                v3.0 + v3.1 glued-input case)
//   2. truncated input        — file ends mid-fence / mid-sentence /
//                                trailing "…"
//   3. leaked placeholders    — TBD / TODO / FIXME / "..." in the input
//                                itself (so the AI knows not to copy them)
//   4. dangling cross-refs    — §X.Y referenced from the doc but no §X.Y
//                                section exists
//   5. thin promised sections — heading like "## 16. Model Configuration"
//                                with < N words of body (the §16-empty bug)
//   6. fidelity-zone summary  — counts of SQL blocks, prompts, $-figures,
//                                model names so the AI/user know what must
//                                be reproduced verbatim
//
// Output:
//   - `findings: AnalysisFinding[]`        every signal, severity-tagged
//   - `clarifications: AnalyzerClarification[]`  questions to ask the user
//                                                via ?> options
//   - `report: string`        a markdown summary embedded as a
//                             context_summary system message
//
// The hook surfaces clarifications as user-facing assistant messages and
// pauses the AI dispatch until the user answers. The report is sent
// alongside the conversation so the AI sees what the analyzer saw.
// ═══════════════════════════════════════════════════════════════════════

import type {
  AnalysisFinding,
  AnalyzerClarification,
  InputAnalysis,
  InputDocSummary,
  SpecMessage,
} from '../types/spec-writer';
import { extractFidelityZones, extractInputDocs, parseSections, type InputDoc } from './spec-coverage-audit';

const THIN_SECTION_BYTE_FLOOR = 200;
/** Headings whose body MUST contain real content (not just "see §X"). */
const PROMISED_SECTION_KEYWORDS = [
  /\bschema\b/i,
  /\bprompt/i,
  /\btest/i,
  /\bAPI\b/,
  /\bcopy\b/i,
  /\bmodel\s+config/i,
  /\bcost/i,
  /\bdata\s+model\b/i,
];

const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bTBD\b/, label: 'TBD' },
  { re: /\bTBC\b/, label: 'TBC' },
  { re: /\bTODO\b/, label: 'TODO' },
  { re: /\bFIXME\b/, label: 'FIXME' },
  { re: /\bXXX\b/, label: 'XXX' },
  { re: /<insert\s+[^>]*>/i, label: '<insert ...>' },
  { re: /<\s*placeholder\s*>/i, label: '<placeholder>' },
];

// ─────────────────────────────────────────────────────────────────────
// Doubled-input detector
// ─────────────────────────────────────────────────────────────────────

/**
 * Detect when an input doc contains two copies of the same content (the v3.0
 * + v3.1 glued-input case).
 *
 * Heuristic: count exact-match occurrences of every H2 heading in the doc.
 * If 50% or more of the H2s appear more than once, the doc is doubled.
 * We also surface the most-distinctive duplicated heading (typically the
 * first H1) for the resolution prompt.
 */
function detectDoubledInput(content: string): { duplicateHeading: string; occurrences: number } | null {
  const sections = parseSections(content);
  const h2 = sections.filter((s) => s.level === 2);
  if (h2.length < 4) return null;

  const titleCounts = new Map<string, number>();
  for (const s of h2) {
    const key = s.title.trim();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  const duplicates = [...titleCounts.entries()].filter(([, n]) => n > 1);
  // Use duplicates / unique-titles. Robust when one copy is partial / truncated:
  // e.g. v3.0 (25 H2s) + v3.1 (30 H2s) shares 25 titles, total H2s = 55, unique = 30.
  // Duplicates 25 / unique 30 = 0.83 → clearly doubled.
  const uniqueTitles = titleCounts.size;
  if (uniqueTitles === 0) return null;
  if (duplicates.length / uniqueTitles < 0.5) return null;

  // Prefer the H1 if it also duplicates (most-recognizable signal); otherwise the
  // first duplicated H2.
  const h1 = sections.find((s) => s.level === 1);
  if (h1) {
    const h1Lines = content
      .split('\n')
      .filter((l) => l.startsWith('# ') && l.slice(2).trim() === h1.title)
      .length;
    if (h1Lines > 1) {
      return { duplicateHeading: h1.title, occurrences: h1Lines };
    }
  }
  const [title, occurrences] = duplicates[0];
  return { duplicateHeading: title, occurrences };
}

// ─────────────────────────────────────────────────────────────────────
// Truncation detector
// ─────────────────────────────────────────────────────────────────────

function detectTruncation(content: string): { lastHeading: string; tail: string } | null {
  const trimmed = content.trimEnd();
  if (!trimmed) return null;

  const fenceCount = (trimmed.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 !== 0) {
    return { lastHeading: lastHeadingOf(trimmed), tail: trimmed.slice(-80) };
  }

  const lastLine = trimmed.split('\n').pop()!.trim();
  if (/(\.\.\.|…)$/.test(lastLine)) {
    return { lastHeading: lastHeadingOf(trimmed), tail: trimmed.slice(-80) };
  }

  // Trailing line is a heading with no body following it within the file.
  const headingTrailing = /^#{1,3}\s+/.test(lastLine);
  if (headingTrailing) {
    return { lastHeading: lastLine, tail: lastLine };
  }

  return null;
}

function lastHeadingOf(text: string): string {
  const m = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)];
  return m.length > 0 ? m[m.length - 1][1] : '';
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder, dangling-ref, and thin-section detectors
// ─────────────────────────────────────────────────────────────────────

function detectPlaceholders(content: string): Array<{ quote: string; label: string }> {
  const hits: Array<{ quote: string; label: string }> = [];
  const seen = new Set<string>();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, label } of PLACEHOLDER_PATTERNS) {
      if (re.test(line)) {
        const quote = line.trim().slice(0, 120);
        if (seen.has(quote)) continue;
        seen.add(quote);
        hits.push({ quote, label });
        break;
      }
    }
    if (hits.length >= 8) break; // cap noise
  }
  return hits;
}

function detectDanglingRefs(content: string): string[] {
  // Collect existing section refs (e.g. "§1", "§3.2").
  const sections = parseSections(content);
  const known = new Set(sections.map((s) => s.ref.replace(/^§/, '')));
  // Find all §X.Y references in prose.
  const refs = new Set<string>();
  for (const m of content.matchAll(/§(\d+(?:\.\d+)*)/g)) {
    refs.add(m[1]);
  }
  const dangling: string[] = [];
  for (const r of refs) {
    if (!known.has(r) && !known.has(r.split('.')[0])) {
      dangling.push(`§${r}`);
    }
  }
  return dangling.slice(0, 10);
}

function detectThinPromisedSections(
  content: string,
  sections: ReturnType<typeof parseSections>,
): Array<{ ref: string; title: string; bytes: number }> {
  const lines = content.split('\n');
  const h2 = sections.filter((s) => s.level === 2);
  const thin: Array<{ ref: string; title: string; bytes: number }> = [];
  for (let i = 0; i < h2.length; i++) {
    const sec = h2[i];
    const next = h2[i + 1];
    const startLine = sec.line + 1;
    const endLine = next ? next.line : lines.length;
    const body = lines.slice(startLine, endLine).join('\n').trim();
    if (body.length >= THIN_SECTION_BYTE_FLOOR) continue;
    if (!PROMISED_SECTION_KEYWORDS.some((re) => re.test(sec.title))) continue;
    thin.push({ ref: sec.ref, title: sec.title, bytes: body.length });
  }
  return thin;
}

// ─────────────────────────────────────────────────────────────────────
// Per-doc analysis
// ─────────────────────────────────────────────────────────────────────

function analyzeOneDoc(doc: InputDoc): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  const doubled = detectDoubledInput(doc.content);
  if (doubled) {
    findings.push({
      kind: 'doubled-input',
      source: doc.name,
      duplicateHeading: doubled.duplicateHeading,
      occurrences: doubled.occurrences,
      severity: 'block',
    });
  }

  const truncated = detectTruncation(doc.content);
  if (truncated) {
    findings.push({
      kind: 'truncated-input',
      source: doc.name,
      lastHeading: truncated.lastHeading,
      tail: truncated.tail,
      severity: 'warn',
    });
  }

  for (const p of detectPlaceholders(doc.content)) {
    findings.push({
      kind: 'placeholder-in-input',
      source: doc.name,
      quote: p.quote,
      severity: 'warn',
    });
  }

  for (const ref of detectDanglingRefs(doc.content)) {
    findings.push({
      kind: 'dangling-cross-ref',
      source: doc.name,
      ref,
      severity: 'warn',
    });
  }

  const sections = parseSections(doc.content);
  for (const t of detectThinPromisedSections(doc.content, sections)) {
    findings.push({
      kind: 'thin-section',
      source: doc.name,
      ref: t.ref,
      title: t.title,
      bytes: t.bytes,
      severity: 'warn',
    });
  }

  // Fidelity-zone counts (always emitted; severity 'info').
  const zones = extractFidelityZones([doc]);
  const counts = {
    sql: zones.filter((z) => z.kind === 'table-name').length,
    cost: zones.filter((z) => z.kind === 'cost-figure').length,
    model: zones.filter((z) => z.kind === 'model-name').length,
    enum: zones.filter((z) => z.kind === 'enum-value').length,
  };
  if (counts.sql + counts.cost + counts.model + counts.enum > 0) {
    findings.push({
      kind: 'fidelity-zone-summary',
      source: doc.name,
      counts,
      severity: 'info',
    });
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// Clarifications (only generated for `block`-severity findings)
// ─────────────────────────────────────────────────────────────────────

function buildClarifications(findings: AnalysisFinding[]): AnalyzerClarification[] {
  const out: AnalyzerClarification[] = [];
  for (const f of findings) {
    if (f.severity !== 'block') continue;
    if (f.kind === 'doubled-input') {
      out.push({
        id: `doubled-${f.source}`,
        topic: 'Doubled input',
        question:
          `\`${f.source}\` looks like it contains the same spec twice — the heading "${f.duplicateHeading}" appears ${f.occurrences} times. ` +
          'How should I treat it?',
        options: [
          'Use the FIRST copy (assume the second is a duplicate appended by mistake)',
          'Use the SECOND copy (assume the first is an older draft, the second is canonical)',
          'Use BOTH (treat the file as additive, ignore the duplication)',
          'Stop — let me re-upload a clean file',
        ],
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Markdown report (embedded as context_summary message)
// ─────────────────────────────────────────────────────────────────────

function renderReport(docs: InputDocSummary[], findings: AnalysisFinding[]): string {
  const lines: string[] = [];
  lines.push('## SpecWriter input analysis');
  lines.push('');
  lines.push('I scanned the document(s) you attached before drafting the spec. Here is what I found:');
  lines.push('');

  for (const doc of docs) {
    const h2 = doc.sections.filter((s) => s.level === 2).length;
    lines.push(`- **${doc.name}** — ${doc.bytes.toLocaleString()} bytes, ${h2} top-level sections`);
  }
  lines.push('');

  const blocks = findings.filter((f) => f.severity === 'block');
  const warns = findings.filter((f) => f.severity === 'warn');
  const infos = findings.filter((f) => f.severity === 'info');

  if (blocks.length > 0) {
    lines.push('### 🔴 Blocking');
    for (const f of blocks) lines.push(`- ${describeFinding(f)}`);
    lines.push('');
  }
  if (warns.length > 0) {
    lines.push('### 🟡 Warnings');
    for (const f of warns.slice(0, 20)) lines.push(`- ${describeFinding(f)}`);
    if (warns.length > 20) lines.push(`- …and ${warns.length - 20} more`);
    lines.push('');
  }
  if (infos.length > 0) {
    lines.push('### Verbatim-fidelity zones detected');
    for (const f of infos) lines.push(`- ${describeFinding(f)}`);
    lines.push('');
    lines.push(
      'The above zones must be reproduced byte-for-byte in the output. The post-spec coverage audit will fail if any are dropped.',
    );
    lines.push('');
  }

  if (blocks.length === 0 && warns.length === 0 && infos.length === 0) {
    lines.push('No structural problems detected. Proceeding with the spec.');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function describeFinding(f: AnalysisFinding): string {
  switch (f.kind) {
    case 'doubled-input':
      return `\`${f.source}\` contains the same heading "${f.duplicateHeading}" ${f.occurrences} times — likely doubled input.`;
    case 'truncated-input':
      return `\`${f.source}\` appears truncated after "${f.lastHeading}" (ends with "${f.tail.slice(-40)}").`;
    case 'placeholder-in-input':
      return `\`${f.source}\` contains a placeholder: "${f.quote}". Don't carry it into the output.`;
    case 'dangling-cross-ref':
      return `\`${f.source}\` references ${f.ref} but no such section is defined in the doc.`;
    case 'thin-section':
      return `\`${f.source}\` ${f.ref} ${f.title} has only ${f.bytes} bytes of body — content may be missing.`;
    case 'fidelity-zone-summary': {
      const parts = [];
      if (f.counts.sql > 0) parts.push(`${f.counts.sql} SQL table(s)`);
      if (f.counts.cost > 0) parts.push(`${f.counts.cost} cost figure(s)`);
      if (f.counts.model > 0) parts.push(`${f.counts.model} model name(s)`);
      if (f.counts.enum > 0) parts.push(`${f.counts.enum} enum value(s)`);
      return `\`${f.source}\` — ${parts.join(', ')}`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────

/** Analyze a set of input docs. Pure function. */
export function analyzeInput(docs: InputDoc[]): InputAnalysis {
  const findings: AnalysisFinding[] = [];
  for (const doc of docs) {
    findings.push(...analyzeOneDoc(doc));
  }
  // Sort: block → warn → info, then by source name for stability.
  const order = { block: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => {
    const oa = order[a.severity];
    const ob = order[b.severity];
    if (oa !== ob) return oa - ob;
    return a.source.localeCompare(b.source);
  });

  const docSummaries: InputDocSummary[] = docs.map((d) => ({
    name: d.name,
    bytes: d.content.length,
    sections: parseSections(d.content),
  }));
  const clarifications = buildClarifications(findings);
  const report = renderReport(docSummaries, findings);
  return { docs: docSummaries, findings, clarifications, report };
}

/** Convenience: pull input docs from a SpecWriter conversation and analyze them. */
export function analyzeMessages(messages: SpecMessage[]): InputAnalysis {
  return analyzeInput(extractInputDocs(messages));
}

/** Build the user-facing assistant message for one clarification (with ?> options). */
export function renderClarificationMessage(c: AnalyzerClarification): string {
  const lines = [c.question, ''];
  for (const opt of c.options) {
    lines.push(`?> ${opt}`);
  }
  return lines.join('\n');
}
