import { describe, it, expect } from "vitest";
import { parseFileLink } from "./file-link";

describe("parseFileLink", () => {
  it("strips a trailing :line from an absolute path", () => {
    expect(parseFileLink("/a/b.ts:48")).toEqual({ path: "/a/b.ts", line: 48 });
  });

  it("strips a trailing :line:column", () => {
    expect(parseFileLink("/a/b.ts:48:5")).toEqual({
      path: "/a/b.ts",
      line: 48,
      column: 5,
    });
  });

  it("returns the path unchanged when there is no suffix", () => {
    expect(parseFileLink("/a/b.ts")).toEqual({ path: "/a/b.ts" });
  });

  it("handles a relative path with a :line", () => {
    expect(parseFileLink("plans/x.md:1")).toEqual({
      path: "plans/x.md",
      line: 1,
    });
  });

  it("leaves a file:// URL untouched", () => {
    expect(parseFileLink("file:///a/b")).toEqual({ path: "file:///a/b" });
  });

  it("leaves a bare Windows drive path untouched", () => {
    expect(parseFileLink("C:\\x\\y.ts")).toEqual({ path: "C:\\x\\y.ts" });
  });

  it("strips only the trailing :line from a Windows path", () => {
    expect(parseFileLink("C:\\x\\y.ts:3")).toEqual({
      path: "C:\\x\\y.ts",
      line: 3,
    });
  });

  it("does not strip a bare :5 with no path part", () => {
    expect(parseFileLink(":5")).toEqual({ path: ":5" });
  });

  it("leaves a bare filename without a suffix unchanged", () => {
    expect(parseFileLink("helvetia-kfz-versicherung.document.json")).toEqual({
      path: "helvetia-kfz-versicherung.document.json",
    });
  });

  // Regression: the exact href from the field-reported bug.
  it("strips the :1 from the reported document link (regression)", () => {
    const href =
      "/Users/hr/Dev_Projects/AIScanningTestbed/output/insurance-normalized-examples/documents/helvetia-kfz-versicherung-application-ef8bc8419f5b.document.json:1";
    expect(parseFileLink(href)).toEqual({
      path: "/Users/hr/Dev_Projects/AIScanningTestbed/output/insurance-normalized-examples/documents/helvetia-kfz-versicherung-application-ef8bc8419f5b.document.json",
      line: 1,
    });
  });
});
