import {
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import { highlightText } from "./highlight-text";

export interface HighlightCounter {
  i: number;
}

/**
 * Recursively walks ReactNode children and replaces every string leaf with
 * highlighted output from `highlightText`. The `counter` is mutated so that
 * match indices stay monotonically increasing across the whole tree.
 *
 * Skips <code> and <pre> elements — code highlighting is handled by
 * CodeBlock so we don't accidentally inject <mark> into a syntax-tokenized
 * code block.
 */
export function highlightChildren(
  children: ReactNode,
  query: string,
  counter: HighlightCounter
): ReactNode {
  if (!query) return children;

  if (typeof children === "string") {
    const { nodes, nextIndex } = highlightText(children, query, counter.i);
    counter.i = nextIndex;
    return nodes;
  }

  if (typeof children === "number" || typeof children === "boolean" || children == null) {
    return children;
  }

  if (Array.isArray(children)) {
    return children.map((child, idx) => {
      const out = highlightChildren(child, query, counter);
      if (isValidElement(out) && out.key == null) {
        return cloneElement(out, { key: `hc-${idx}` });
      }
      return out;
    });
  }

  if (isValidElement(children)) {
    if (children.type === "code" || children.type === "pre") {
      return children;
    }
    const props = children.props as { children?: ReactNode };
    const inner = props.children;
    if (inner == null) return children;
    return cloneElement(
      children,
      undefined,
      highlightChildren(inner, query, counter)
    );
  }

  return children;
}
