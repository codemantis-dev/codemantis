import { describe, it, expect } from "vitest";
import { classifyDrift, normalizeConcern, type ToolOp } from "./duo-drift";

const bash = (command: string): ToolOp => ({ toolName: "Bash", input: { command } });
const edit = (file_path: string): ToolOp => ({ toolName: "Edit", input: { file_path } });

describe("classifyDrift — destructive commands (all sensitivities)", () => {
  it("flags rm -rf", () => {
    expect(classifyDrift([bash("rm -rf node_modules")]).severe).toBe(true);
  });

  it("flags git reset --hard", () => {
    const sig = classifyDrift([bash("git reset --hard HEAD~3")]);
    expect(sig.severe).toBe(true);
    expect(sig.reason).toContain("Destructive");
  });

  it("flags git checkout .", () => {
    expect(classifyDrift([bash("git checkout .")]).severe).toBe(true);
  });

  it("does not flag a benign command", () => {
    expect(classifyDrift([bash("pnpm test")]).severe).toBe(false);
  });
});

describe("classifyDrift — deleting tests", () => {
  it("flags rm of a test file", () => {
    const sig = classifyDrift([bash("rm src/foo.test.ts")]);
    expect(sig.severe).toBe(true);
    expect(sig.reason).toContain("test");
  });

  it("flags a delete tool targeting a __tests__ path", () => {
    const sig = classifyDrift([{ toolName: "DeleteFile", input: { path: "src/__tests__/a.ts" } }]);
    expect(sig.severe).toBe(true);
  });

  it("does not flag editing a test file", () => {
    expect(classifyDrift([edit("src/foo.test.ts")]).severe).toBe(false);
  });
});

describe("classifyDrift — mass edits by sensitivity", () => {
  const manyEdits = Array.from({ length: 10 }, (_, i) => edit(`src/file${i}.ts`));

  it("conservative never flags on volume", () => {
    expect(classifyDrift(manyEdits, "conservative").severe).toBe(false);
  });

  it("aggressive flags 10 edits (threshold 8)", () => {
    const sig = classifyDrift(manyEdits, "aggressive");
    expect(sig.severe).toBe(true);
    expect(sig.reason).toContain("10 files");
  });

  it("balanced does not flag 10 edits (threshold 15)", () => {
    expect(classifyDrift(manyEdits, "balanced").severe).toBe(false);
  });

  it("counts distinct files only", () => {
    const dupes = Array.from({ length: 20 }, () => edit("src/same.ts"));
    expect(classifyDrift(dupes, "aggressive").severe).toBe(false);
  });
});

describe("normalizeConcern", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeConcern("Missing  error-handling!!")).toBe("missing error handling");
  });

  it("treats cosmetically different phrasings of the same words as equal", () => {
    expect(normalizeConcern("No tests.")).toBe(normalizeConcern("no   tests"));
  });
});
