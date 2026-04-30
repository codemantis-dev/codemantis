import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { highlightChildren, type HighlightCounter } from "./highlight-children";

function render(node: unknown): string {
  return renderToStaticMarkup(<>{node as React.ReactNode}</>);
}

describe("highlightChildren", () => {
  it("returns children unchanged when query is empty", () => {
    const counter: HighlightCounter = { i: 0 };
    const out = highlightChildren("hello world", "", counter);
    expect(out).toBe("hello world");
    expect(counter.i).toBe(0);
  });

  it("highlights a string leaf and bumps the counter", () => {
    const counter: HighlightCounter = { i: 0 };
    const out = highlightChildren("hello world", "world", counter);
    const html = render(out);
    expect(html).toContain('<mark data-search-match-index="0"');
    expect(counter.i).toBe(1);
  });

  it("walks into nested elements and continues numbering across siblings", () => {
    const counter: HighlightCounter = { i: 0 };
    const tree = (
      <p>
        foo bar foo
        <span>more foo here</span>
      </p>
    );
    const out = highlightChildren(tree, "foo", counter);
    const html = render(out);
    const matches = html.match(/data-search-match-index="(\d+)"/g) ?? [];
    expect(matches).toHaveLength(3);
    expect(matches[0]).toContain('"0"');
    expect(matches[1]).toContain('"1"');
    expect(matches[2]).toContain('"2"');
    expect(counter.i).toBe(3);
  });

  it("skips <code> and <pre> elements", () => {
    const counter: HighlightCounter = { i: 0 };
    const tree = (
      <p>
        foo
        <code>foo</code>
        <pre>foo</pre>
        foo
      </p>
    );
    const out = highlightChildren(tree, "foo", counter);
    const html = render(out);
    const marks = html.match(/<mark /g) ?? [];
    expect(marks).toHaveLength(2);
    expect(counter.i).toBe(2);
  });

  it("handles arrays of mixed node types", () => {
    const counter: HighlightCounter = { i: 0 };
    const arr = ["foo ", <span key="x">bar foo</span>, " foo"];
    const out = highlightChildren(arr, "foo", counter);
    const html = render(out);
    const marks = html.match(/<mark /g) ?? [];
    expect(marks).toHaveLength(3);
    expect(counter.i).toBe(3);
  });

  it("returns numbers/booleans/null untouched", () => {
    const counter: HighlightCounter = { i: 0 };
    expect(highlightChildren(42, "x", counter)).toBe(42);
    expect(highlightChildren(false, "x", counter)).toBe(false);
    expect(highlightChildren(null, "x", counter)).toBe(null);
    expect(counter.i).toBe(0);
  });
});
