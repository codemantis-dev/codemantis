// Spec/audit detection — patterns and heuristics extracted from spec-prompts.ts.

export const SPEC_READY_PATTERNS = [
  /i have enough to write the specification/i,
  /ready when you are/i,
  /shall i (?:write|generate|create|proceed)/i,
  /i have enough (?:information|details|context)/i,
  /ready to write/i,
  /shall i proceed/i,
];

export const SPEC_START_PATTERN = /^#\s+.+(?:—|-)\s*(?:\S+\s+)*(?:Specification|Spec|Plan|Blueprint|Document)\b/mi;

// Matches an H1 whose text contains a verification/audit title, regardless of
// the separator the model chose. Deliberately permissive: `# Foo — Verification
// Audit`, `# Foo - Verification Audit`, `# Verification Audit for Foo`, `# Foo —
// Verification Checklist`, and `# Foo — Implementation Audit` all match. The `m`
// flag anchors to any line start, so a leading `---` front-matter block before
// the H1 is tolerated. Kept anchored to an H1 (`^#\s+`) to avoid matching a spec
// that merely mentions the words mid-body. Routing is no longer driven by this
// alone (see the `isAudit` intent flag in the conversation hooks) — this is the
// fallback for audits that arrive without an explicit intent.
export const AUDIT_START_PATTERN =
  /^#\s+.*\b(?:Verification\s+(?:Audit|Checklist)|Implementation\s+Audit)\b/im;

/**
 * Structural fallback: detects a spec-like document when the heading pattern
 * doesn't match. Looks for: length, document-style start, multiple H2 sections,
 * and spec-like keywords.
 */
export function isLikelySpecDocument(content: string): boolean {
  // Audits are structurally spec-shaped (long, many H2s, spec keywords), so the
  // heuristic below would happily claim one as a spec and overwrite the real
  // spec slot. Exclude anything that looks like an audit up front — audit
  // detection always wins over the spec fallback.
  if (AUDIT_START_PATTERN.test(content)) return false;

  // Too short to be a spec (specs are typically 2000+ characters)
  if (content.length < 1500) return false;

  // Must start with a --- separator or an H1 heading (within first 50 chars)
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---') && !trimmed.startsWith('# ')) return false;

  // Count numbered H2 sections (e.g., "## 1. Overview", "## 2. Data Model")
  const numberedH2Count = (content.match(/^##\s+\d+\.\s+/gm) ?? []).length;
  if (numberedH2Count >= 3) return true;

  // Count all H2 sections
  const h2Count = (content.match(/^##\s+/gm) ?? []).length;
  if (h2Count < 5) return false;

  // Look for spec-like keywords
  const specKeywords = [
    /\boverview\b/i,
    /\bdata model\b/i,
    /\bimplementation\b/i,
    /\bcomponent/i,
    /\broute/i,
    /\bchecklist\b/i,
    /\brequirement/i,
    /\barchitecture\b/i,
    /\buser (?:flow|story|journey)/i,
    /\bAPI\b/,
    /\bUI\b/,
  ];
  const keywordHits = specKeywords.filter((kw) => kw.test(content)).length;
  return keywordHits >= 3;
}

/** Matches a file path ending in `.audit.md` — fallback when the audit was saved to a file instead of output inline. */
export const AUDIT_FILE_PATTERN = /([^\s"'`]+\.audit\.md)\b/;

export const FILE_REQUEST_PATTERN = /📂\s*REQUEST_FILES:\s*(.+)/g;
