import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { highlightText } from "./highlight-text";

interface MarkProps {
  "data-search-match-index": number;
  className: string;
  children: string;
}

function isMark(node: unknown): node is ReactElement<MarkProps> {
  return isValidElement(node) && node.type === "mark";
}

describe("highlightText", () => {
  it("returns the original text unchanged when query is empty", () => {
    const r = highlightText("hello world", "", 0);
    expect(r.nodes).toEqual(["hello world"]);
    expect(r.nextIndex).toBe(0);
  });

  it("wraps a single match", () => {
    const r = highlightText("hello world", "world", 0);
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes[0]).toBe("hello ");
    expect(isMark(r.nodes[1])).toBe(true);
    if (isMark(r.nodes[1])) {
      expect(r.nodes[1].props["data-search-match-index"]).toBe(0);
      expect(r.nodes[1].props.children).toBe("world");
    }
    expect(r.nextIndex).toBe(1);
  });

  it("wraps multiple matches and increments indices", () => {
    const r = highlightText("foo bar foo baz foo", "foo", 0);
    const marks = r.nodes.filter(isMark);
    expect(marks).toHaveLength(3);
    expect(marks[0].props["data-search-match-index"]).toBe(0);
    expect(marks[1].props["data-search-match-index"]).toBe(1);
    expect(marks[2].props["data-search-match-index"]).toBe(2);
    expect(r.nextIndex).toBe(3);
  });

  it("is case-insensitive but preserves the original casing in the mark", () => {
    const r = highlightText("Hello WORLD world WoRlD", "world", 0);
    const marks = r.nodes.filter(isMark);
    expect(marks).toHaveLength(3);
    expect(marks[0].props.children).toBe("WORLD");
    expect(marks[1].props.children).toBe("world");
    expect(marks[2].props.children).toBe("WoRlD");
  });

  it("treats the query as a literal — special regex chars are not interpreted", () => {
    const r = highlightText("a.b a*b a.b", ".", 0);
    const marks = r.nodes.filter(isMark);
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => m.props.children === ".")).toBe(true);
  });

  it("continues numbering from startIndex", () => {
    const r = highlightText("aa", "a", 7);
    const marks = r.nodes.filter(isMark);
    expect(marks).toHaveLength(2);
    expect(marks[0].props["data-search-match-index"]).toBe(7);
    expect(marks[1].props["data-search-match-index"]).toBe(8);
    expect(r.nextIndex).toBe(9);
  });

  it("returns the unchanged string when query has no match", () => {
    const r = highlightText("hello", "zzz", 0);
    expect(r.nodes).toEqual(["hello"]);
    expect(r.nextIndex).toBe(0);
  });

  it("handles match at start and end", () => {
    const r = highlightText("ababa", "a", 0);
    const marks = r.nodes.filter(isMark);
    expect(marks).toHaveLength(3);
    expect(r.nextIndex).toBe(3);
  });
});
