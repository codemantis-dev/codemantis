import { describe, it, expect } from "vitest";
import { detectSettingsCarveout } from "./carveout-detector";

const ERROR =
  "Error: Claude requested permissions to write to /Users/hr/Dev_Projects/Juliam_website/.claude/settings.json, but you haven't granted it yet.";

describe("detectSettingsCarveout", () => {
  it("matches Write to .claude/settings.json with the CLI carve-out error", () => {
    const result = detectSettingsCarveout({
      toolName: "Write",
      toolInput: { file_path: "/Users/hr/Dev_Projects/Juliam_website/.claude/settings.json" },
      errorContent: ERROR,
      isError: true,
    });
    expect(result).not.toBeNull();
    expect(result?.hint).toMatch(/sandbox-escape guard/);
    expect(result?.hint).toMatch(/Bash heredoc/);
  });

  it("matches Write to .claude/settings.local.json", () => {
    const result = detectSettingsCarveout({
      toolName: "Write",
      toolInput: { file_path: "/repo/.claude/settings.local.json" },
      errorContent: ERROR,
      isError: true,
    });
    expect(result).not.toBeNull();
  });

  it("matches Edit on the same protected file", () => {
    const result = detectSettingsCarveout({
      toolName: "Edit",
      toolInput: { file_path: "/repo/.claude/settings.json" },
      errorContent:
        "Error: Claude requested permissions to edit /repo/.claude/settings.json, but you haven't granted it yet.",
      isError: true,
    });
    expect(result).not.toBeNull();
  });

  it("returns null when isError is false", () => {
    const result = detectSettingsCarveout({
      toolName: "Write",
      toolInput: { file_path: "/repo/.claude/settings.json" },
      errorContent: ERROR,
      isError: false,
    });
    expect(result).toBeNull();
  });

  it("returns null for tools that aren't guarded (Bash, Read)", () => {
    expect(
      detectSettingsCarveout({
        toolName: "Bash",
        toolInput: { command: "cat > /repo/.claude/settings.json" },
        errorContent: ERROR,
        isError: true,
      }),
    ).toBeNull();
    expect(
      detectSettingsCarveout({
        toolName: "Read",
        toolInput: { file_path: "/repo/.claude/settings.json" },
        errorContent: ERROR,
        isError: true,
      }),
    ).toBeNull();
  });

  it("returns null when the file path is unrelated", () => {
    const result = detectSettingsCarveout({
      toolName: "Write",
      toolInput: { file_path: "/repo/src/index.ts" },
      errorContent: ERROR,
      isError: true,
    });
    expect(result).toBeNull();
  });

  it("returns null when the error content does not match the carve-out signature", () => {
    const result = detectSettingsCarveout({
      toolName: "Write",
      toolInput: { file_path: "/repo/.claude/settings.json" },
      errorContent: "Error: disk full",
      isError: true,
    });
    expect(result).toBeNull();
  });

  it("returns null when toolInput has no file_path", () => {
    const result = detectSettingsCarveout({
      toolName: "Write",
      toolInput: {},
      errorContent: ERROR,
      isError: true,
    });
    expect(result).toBeNull();
  });

  it("handles missing errorContent gracefully", () => {
    expect(
      detectSettingsCarveout({
        toolName: "Write",
        toolInput: { file_path: "/repo/.claude/settings.json" },
        errorContent: null,
        isError: true,
      }),
    ).toBeNull();
    expect(
      detectSettingsCarveout({
        toolName: "Write",
        toolInput: { file_path: "/repo/.claude/settings.json" },
        errorContent: undefined,
        isError: true,
      }),
    ).toBeNull();
  });

  it("matches NotebookEdit using notebook_path", () => {
    const result = detectSettingsCarveout({
      toolName: "NotebookEdit",
      toolInput: { notebook_path: "/repo/.claude/settings.json" },
      errorContent: ERROR,
      isError: true,
    });
    expect(result).not.toBeNull();
  });

  it("does not match a non-protected nested .claude path (e.g. plans)", () => {
    const result = detectSettingsCarveout({
      toolName: "Write",
      toolInput: { file_path: "/repo/.claude/plans/foo.md" },
      errorContent: ERROR,
      isError: true,
    });
    expect(result).toBeNull();
  });
});
