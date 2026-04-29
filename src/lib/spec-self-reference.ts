/**
 * Normalize a spec body so every internal `docs/specs/<name>.md` and
 * `docs/specs/<name>.audit.md` reference points at the actual filename the
 * user is saving the spec under (and its companion audit).
 *
 * Why this exists: SpecWriter's LLM bakes a placeholder filename into the
 * spec body — typically used inside Session Plan prompts ("Read
 * docs/specs/foo.md — sections X..."). When the user saves under a
 * different filename, every internal reference becomes a dead link, the
 * Implementation Guide's prompts point at the wrong file, and Self-Drive
 * verification reads the wrong spec. Rewriting at save time keeps the
 * on-disk file, the parsed guide, and the audit companion in agreement.
 *
 * The audit pass runs first so the second (spec) pass cannot double-rewrite
 * a path that has already been corrected.
 */
export function normalizeSpecSelfReferences(
  specBody: string,
  specFilename: string,
): string {
  const auditFilename = specFilename.replace(/\.md$/, ".audit.md");

  // Match `docs/specs/<stem>.audit.md`. The stem allows letters, digits,
  // `_`, and `-` — no dots — so `.audit.md` is anchored unambiguously.
  let result = specBody.replace(
    /docs\/specs\/[\w-]+\.audit\.md/g,
    `docs/specs/${auditFilename}`,
  );

  // Match plain `docs/specs/<stem>.md` (no dots in the stem). Because the
  // stem cannot contain dots, this regex cannot match an audit path like
  // `docs/specs/foo.audit.md` — the `.audit.` segment blocks the match.
  result = result.replace(
    /docs\/specs\/[\w-]+\.md/g,
    `docs/specs/${specFilename}`,
  );

  return result;
}
