import type { ReactNode } from "react";

export interface HighlightResult {
  nodes: ReactNode[];
  nextIndex: number;
}

/**
 * Splits `text` on case-insensitive occurrences of `query` and wraps each
 * match in a <mark> element. `startIndex` is the running counter the caller
 * passes in so match indices stay monotonically increasing across multiple
 * invocations within the same message tree.
 *
 * Returns the original text untouched when `query` is empty — callers should
 * still feed this through their normal render path so highlighting is a
 * no-op when search isn't active.
 */
export function highlightText(text: string, query: string, startIndex: number): HighlightResult {
  if (!query) {
    return { nodes: [text], nextIndex: startIndex };
  }

  const nodes: ReactNode[] = [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const needleLen = needle.length;
  let cursor = 0;
  let matchCounter = startIndex;
  let segmentKey = 0;

  while (cursor < text.length) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (hit > cursor) {
      nodes.push(text.slice(cursor, hit));
    }
    const matched = text.slice(hit, hit + needleLen);
    const idx = matchCounter;
    nodes.push(
      <mark
        key={`m-${idx}-${segmentKey++}`}
        data-search-match-index={idx}
        className="cm-search-hit"
      >
        {matched}
      </mark>
    );
    matchCounter += 1;
    cursor = hit + needleLen;
  }

  return { nodes, nextIndex: matchCounter };
}
