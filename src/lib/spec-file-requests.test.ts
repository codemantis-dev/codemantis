import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileReadResult } from "../types/spec-writer";

const { mockReadProjectFiles } = vi.hoisted(() => ({
  mockReadProjectFiles: vi.fn<(...args: unknown[]) => Promise<FileReadResult[]>>(),
}));

vi.mock("./tauri-commands", () => ({
  readProjectFiles: mockReadProjectFiles,
}));

import {
  extractFileRequests,
  buildFileContextMessage,
  buildFileContextUserDisplay,
  handleFileRequests,
} from "./spec-file-requests";

describe("extractFileRequests", () => {
  it("extracts file paths from REQUEST_FILES markers", () => {
    const text = "Let me check that.\n📂 REQUEST_FILES: src/app/layout.tsx\nSome other text";
    expect(extractFileRequests(text)).toEqual(["src/app/layout.tsx"]);
  });

  it("returns empty array when no markers are present", () => {
    const text = "No file request here, just plain text.";
    expect(extractFileRequests(text)).toEqual([]);
  });

  it("handles multiple file requests in a single marker", () => {
    const text = "📂 REQUEST_FILES: src/a.ts, src/b.ts, src/c.ts";
    expect(extractFileRequests(text)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("handles multiple markers across the text", () => {
    const text =
      "📂 REQUEST_FILES: src/a.ts\nSome text\n📂 REQUEST_FILES: src/b.ts";
    expect(extractFileRequests(text)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("deduplicates file paths", () => {
    const text = "📂 REQUEST_FILES: src/a.ts, src/a.ts";
    expect(extractFileRequests(text)).toEqual(["src/a.ts"]);
  });

  it("limits to 5 files maximum", () => {
    const text =
      "📂 REQUEST_FILES: a.ts, b.ts, c.ts, d.ts, e.ts, f.ts, g.ts";
    expect(extractFileRequests(text)).toHaveLength(5);
  });

  it("strips trailing periods and colons from paths", () => {
    const text = "📂 REQUEST_FILES: src/a.ts., src/b.ts:";
    expect(extractFileRequests(text)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("buildFileContextMessage", () => {
  it("formats found file content correctly", () => {
    const results: FileReadResult[] = [
      {
        path: "src/index.ts",
        found: true,
        content: "console.log('hello');",
        totalLines: 1,
        truncated: false,
      },
    ];
    const msg = buildFileContextMessage(results);
    expect(msg).toContain("--- Requested files loaded ---");
    expect(msg).toContain("=== src/index.ts (1 lines) ===");
    expect(msg).toContain("console.log('hello');");
  });

  it("formats not-found files correctly", () => {
    const results: FileReadResult[] = [
      { path: "missing.ts", found: false, content: null, totalLines: 0, truncated: false },
    ];
    const msg = buildFileContextMessage(results);
    expect(msg).toContain("=== missing.ts (NOT FOUND) ===");
  });

  it("shows truncation note for truncated files", () => {
    const results: FileReadResult[] = [
      {
        path: "big.ts",
        found: true,
        content: "// ...",
        totalLines: 500,
        truncated: true,
      },
    ];
    const msg = buildFileContextMessage(results);
    expect(msg).toContain("(showing first 150 of 500 lines)");
  });
});

describe("buildFileContextUserDisplay", () => {
  it("creates abbreviated display for found files", () => {
    const results = [
      { path: "src/a.ts", found: true, totalLines: 42, truncated: false },
    ];
    const display = buildFileContextUserDisplay(results);
    expect(display).toContain("📂 Files loaded:");
    expect(display).toContain("src/a.ts (42 lines)");
  });

  it("shows not-found message for missing files", () => {
    const results = [
      { path: "missing.ts", found: false, totalLines: 0, truncated: false },
    ];
    const display = buildFileContextUserDisplay(results);
    expect(display).toContain("missing.ts — not found");
  });

  it("shows truncation info for truncated files", () => {
    const results = [
      { path: "big.ts", found: true, totalLines: 300, truncated: true },
    ];
    const display = buildFileContextUserDisplay(results);
    expect(display).toContain("(first 150 of 300 lines)");
  });
});

describe("handleFileRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no file markers in content", async () => {
    const result = await handleFileRequests("/project", "No markers here");
    expect(result).toBeNull();
    expect(mockReadProjectFiles).not.toHaveBeenCalled();
  });

  it("reads files and returns context data when markers present", async () => {
    const mockResults: FileReadResult[] = [
      {
        path: "src/app.ts",
        found: true,
        content: "export default App;",
        totalLines: 1,
        truncated: false,
      },
    ];
    mockReadProjectFiles.mockResolvedValue(mockResults);

    const result = await handleFileRequests(
      "/project",
      "📂 REQUEST_FILES: src/app.ts"
    );

    expect(mockReadProjectFiles).toHaveBeenCalledWith("/project", ["src/app.ts"]);
    expect(result).not.toBeNull();
    expect(result!.fullContent).toContain("=== src/app.ts (1 lines) ===");
    expect(result!.displayContent).toContain("📂 Files loaded:");
    expect(result!.displayContent).toContain("src/app.ts (1 lines)");
  });
});
