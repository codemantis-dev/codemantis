/**
 * Derive the default filename pre-filled into the Save Specification dialog.
 *
 * Two sources, in priority order:
 *
 * 1. The spec body's own `docs/specs/<stem>.md` self-references. SpecWriter's
 *    LLM bakes a chosen filename into every Session Plan prompt, and
 *    `normalizeSpecSelfReferences` rewrites the body to that exact filename
 *    on save. Treating it as the dialog default keeps the dialog, the saved
 *    file, the parsed guide, and Self-Drive verification in agreement.
 *
 * 2. The H1 heading. The separator class is em-dash + en-dash only — plain
 *    hyphen-minus is left out because compound words ("Spec-Forge") use it.
 *    A regex that included U+002D would split `# Spec-Forge … — Subtitle`
 *    at the first hyphen and yield `spec.md`.
 *
 * If both fail (no usable self-reference, generic or missing H1), fall back
 * to a timestamp so the dialog never silently suggests a stem like `spec`.
 */

const GENERIC_STEMS = new Set([
  "spec",
  "specs",
  "specification",
  "specifications",
  "audit",
  "audits",
  "verification",
  "doc",
  "docs",
  "document",
  "documentation",
  "untitled",
  "readme",
  "notes",
]);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function extractSelfReferencedSpecStem(
  specContent: string,
): string | null {
  // Same stem shape as `spec-self-reference.ts` — letters, digits, `_`, `-`,
  // no dots — so `.audit.md` paths cannot match this regex.
  const re = /docs\/specs\/([\w-]+)\.md/g;
  const counts = new Map<string, number>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(specContent)) !== null) {
    const stem = match[1];
    if (GENERIC_STEMS.has(stem.toLowerCase())) continue;
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  // Map preserves insertion order; ties resolve to the first-seen stem.
  let best: string | null = null;
  let bestCount = 0;
  for (const [stem, count] of counts) {
    if (count > bestCount) {
      best = stem;
      bestCount = count;
    }
  }
  return best;
}

export function extractTitleStem(specContent: string): string | null {
  // Em-dash (U+2014) and en-dash (U+2013) only. Hyphen-minus (U+002D) is
  // excluded so compound words in the title survive intact.
  const titleMatch = specContent.match(
    /^#\s+(.+?)(?:\s*[—–]\s*.+)?$/m,
  );
  if (!titleMatch) return null;
  const stem = slugify(titleMatch[1]);
  if (!stem || GENERIC_STEMS.has(stem)) return null;
  return stem;
}

export function deriveDefaultSpecFilename(
  specContent: string,
  isAudit: boolean,
): string {
  const suffix = isAudit ? ".audit.md" : ".md";

  const fromBody = extractSelfReferencedSpecStem(specContent);
  if (fromBody) return `${fromBody}${suffix}`;

  const fromTitle = extractTitleStem(specContent);
  if (fromTitle) return `${fromTitle}${suffix}`;

  const fallbackPrefix = isAudit ? "audit" : "spec";
  return `${fallbackPrefix}-${Date.now()}${suffix}`;
}
