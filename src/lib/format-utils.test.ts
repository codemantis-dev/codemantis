import { describe, it, expect } from "vitest";
import {
  formatTokens,
  formatCost,
  formatDuration,
  formatSecondsElapsed,
  formatModelName,
} from "./format-utils";

describe("formatTokens", () => {
  it("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("formatCost", () => {
  it("label style: shows < prefix for tiny costs", () => {
    expect(formatCost(0.0001, "label")).toBe("<$0.001");
    expect(formatCost(0.005, "label")).toBe("$0.0050");
    expect(formatCost(0.05, "label")).toBe("$0.050");
  });

  it("compact style: empty string for tiny costs", () => {
    expect(formatCost(0.0001, "compact")).toBe("");
    expect(formatCost(0.005, "compact")).toBe("$0.0050");
    expect(formatCost(0.05, "compact")).toBe("$0.050");
  });

  it("explicit style: shows $0 for zero", () => {
    expect(formatCost(0, "explicit")).toBe("$0");
    expect(formatCost(0.005, "explicit")).toBe("$0.0050");
    expect(formatCost(0.05, "explicit")).toBe("$0.05");
  });

  it("defaults to label style", () => {
    expect(formatCost(0.0001)).toBe("<$0.001");
  });
});

describe("formatDuration", () => {
  it("short style: ms and seconds", () => {
    expect(formatDuration(500, "short")).toBe("500ms");
    expect(formatDuration(1500, "short")).toBe("1.5s");
  });

  it("medium style: includes minutes", () => {
    expect(formatDuration(500, "medium")).toBe("500ms");
    expect(formatDuration(1500, "medium")).toBe("1.5s");
    expect(formatDuration(90000, "medium")).toBe("1m 30s");
  });

  it("elapsed style: clock format", () => {
    expect(formatDuration(30000, "elapsed")).toBe("30s");
    expect(formatDuration(90000, "elapsed")).toBe("1:30");
    expect(formatDuration(3661000, "elapsed")).toBe("1:01:01");
  });

  it("human style: natural language", () => {
    expect(formatDuration(30000, "human")).toBe("30s");
    expect(formatDuration(90000, "human")).toBe("1m 30s");
    expect(formatDuration(3661000, "human")).toBe("1h 01m");
  });

  it("defaults to short style", () => {
    expect(formatDuration(500)).toBe("500ms");
  });
});

describe("formatSecondsElapsed", () => {
  it("formats seconds", () => {
    expect(formatSecondsElapsed(30)).toBe("30s");
  });

  it("formats minutes and seconds", () => {
    expect(formatSecondsElapsed(90)).toBe("1m 30s");
  });
});

describe("formatModelName", () => {
  it("returns null for null/undefined", () => {
    expect(formatModelName(null)).toBeNull();
    expect(formatModelName(undefined)).toBeNull();
  });

  it("extracts Claude model family and version", () => {
    expect(formatModelName("claude-opus-4-8-20250101")).toBe("Opus 4.8");
    expect(formatModelName("claude-sonnet-4-20250101")).toBe("Sonnet 4");
    expect(formatModelName("claude-haiku-4-5-20250101")).toBe("Haiku 4.5");
  });

  it("handles model names without dates", () => {
    expect(formatModelName("opus")).toBe("Opus");
    expect(formatModelName("sonnet")).toBe("Sonnet");
  });

  it("formats Codex / OpenAI gpt-* models with uppercased prefix", () => {
    // Regression: the chat ModelSelector showed lowercase "gpt-5.5" for
    // Codex sessions even though the rest of the UI uses Title Case.
    expect(formatModelName("gpt-5.5")).toBe("GPT-5.5");
    expect(formatModelName("gpt-5.4-mini")).toBe("GPT-5.4-Mini");
    expect(formatModelName("gpt-5.3-codex")).toBe("GPT-5.3-Codex");
    expect(formatModelName("gpt-4o")).toBe("GPT-4o");
  });

  it("formats Claude's 'default' sentinel", () => {
    expect(formatModelName("default")).toBe("Default");
  });

  it("returns raw name for genuinely unknown models", () => {
    expect(formatModelName("some-future-model-x9")).toBe("some-future-model-x9");
  });
});
