/**
 * Parsed form of a clickable file link emitted by an agent in chat/markdown.
 * Agents (Codex, Claude) cite files as `path:line` or `path:line:col`
 * (e.g. `/repo/src/foo.ts:48`, `/repo/notes.md:1:3`). The trailing numeric
 * suffix must be stripped before the path is handed to the filesystem.
 */
export interface ParsedFileLink {
  path: string;
  line?: number;
  column?: number;
}

/**
 * Split a clicked file link into its filesystem path and an optional 1-based
 * line/column citation suffix.
 *
 * Safety of the suffix match:
 * - Only a purely numeric trailing `:<n>` / `:<n>:<n>` is stripped — real
 *   line/column citations always are.
 * - The non-greedy `(.*?)` anchored with `$` leaves `file://…` URLs and a bare
 *   Windows drive (`C:\x\y.ts`) untouched, while `C:\x\y.ts:3` strips only `:3`.
 * - The `m[1].length > 0` guard prevents eating a bare `:5` (no path part).
 */
export function parseFileLink(href: string): ParsedFileLink {
  const m = href.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (m && m[1].length > 0) {
    return {
      path: m[1],
      line: Number(m[2]),
      column: m[3] !== undefined ? Number(m[3]) : undefined,
    };
  }
  return { path: href };
}
