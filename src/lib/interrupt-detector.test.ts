import { describe, it, expect } from "vitest";
import {
  isInterruptCancellation,
  CLI_INTERRUPT_REJECTION_PREFIX,
} from "./interrupt-detector";

describe("isInterruptCancellation", () => {
  it("matches the CLI's full canned interrupt/rejection artifact", () => {
    const content =
      "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
    expect(isInterruptCancellation(content)).toBe(true);
  });

  it("matches the bare prefix (forward-compatible with copy tweaks)", () => {
    expect(isInterruptCancellation(CLI_INTERRUPT_REJECTION_PREFIX)).toBe(true);
  });

  it("tolerates leading whitespace", () => {
    expect(
      isInterruptCancellation("\n  " + CLI_INTERRUPT_REJECTION_PREFIX + " …")
    ).toBe(true);
  });

  it("does NOT match a reasoned host deny", () => {
    expect(isInterruptCancellation("Approval timed out")).toBe(false);
    expect(isInterruptCancellation("CodeMantis approval server unavailable")).toBe(false);
  });

  it("does NOT match a normal tool error", () => {
    expect(isInterruptCancellation("command not found")).toBe(false);
  });

  it("handles null/undefined/empty safely", () => {
    expect(isInterruptCancellation(null)).toBe(false);
    expect(isInterruptCancellation(undefined)).toBe(false);
    expect(isInterruptCancellation("")).toBe(false);
  });
});
