import { describe, it, expect } from "vitest";
import { formatActivityDetail } from "./activity-summary";
import type { SessionActivityInfo } from "../stores/sessionStore";

function activity(overrides: Partial<SessionActivityInfo>): SessionActivityInfo {
  return { label: "Thinking...", toolName: null, toolElapsed: 0, filePath: null, ...overrides };
}

describe("formatActivityDetail", () => {
  it("returns null when there is no active tool", () => {
    expect(formatActivityDetail(undefined, 0)).toBeNull();
    expect(formatActivityDetail(activity({ toolName: null }), 0)).toBeNull();
  });

  it("formats a file-based tool as '<verb> <filename>'", () => {
    const result = formatActivityDetail(
      activity({ label: "Editing code...", toolName: "Edit", filePath: "/repo/src/settings.ts" }),
      0,
    );
    expect(result).toBe("Editing settings.ts");
  });

  it("falls back to the raw path when it has no separator", () => {
    const result = formatActivityDetail(
      activity({ label: "Reading file...", toolName: "Read", filePath: "README.md" }),
      0,
    );
    expect(result).toBe("Reading README.md");
  });

  it("returns the plain label for a non-file tool", () => {
    const result = formatActivityDetail(
      activity({ label: "Running command...", toolName: "Bash" }),
      0,
    );
    expect(result).toBe("Running command...");
  });

  it("shows the agent count when multiple sub-agents are running", () => {
    const result = formatActivityDetail(activity({ label: "Agent: refactor", toolName: "Agent" }), 3);
    expect(result).toBe("3 agents");
  });

  it("uses the single-agent label when only one sub-agent runs", () => {
    const result = formatActivityDetail(activity({ label: "Agent: refactor", toolName: "Agent" }), 1);
    expect(result).toBe("Agent: refactor");
  });
});
