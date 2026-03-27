import { describe, it, expect } from "vitest";
import { parseSuperBroResponse } from "./super-bro-parser";

describe("parseSuperBroResponse", () => {
  // ── 1. NOTHING_TO_REPORT detection ────────────────────────────────
  it("returns isNothingToReport: true for exact NOTHING_TO_REPORT", () => {
    const result = parseSuperBroResponse("NOTHING_TO_REPORT");
    expect(result).toEqual({
      guidance: "",
      suggestedPrompt: null,
      fileCheckRequest: null,
      observations: [],
      isNothingToReport: true,
    });
  });

  // ── 2. Pure guidance text (no tags) ───────────────────────────────
  it("returns guidance with no tags extracted", () => {
    const text = "Consider using a more descriptive variable name here.";
    const result = parseSuperBroResponse(text);

    expect(result.guidance).toBe(text);
    expect(result.suggestedPrompt).toBeNull();
    expect(result.fileCheckRequest).toBeNull();
    expect(result.observations).toEqual([]);
    expect(result.isNothingToReport).toBe(false);
  });

  // ── 3. Guidance with <suggested-prompt> tag ───────────────────────
  it("extracts suggested prompt and cleans guidance text", () => {
    const text =
      "You might want to refactor this function.\n<suggested-prompt>Refactor the handleClick function to use useCallback</suggested-prompt>";
    const result = parseSuperBroResponse(text);

    expect(result.suggestedPrompt).toBe(
      "Refactor the handleClick function to use useCallback",
    );
    expect(result.guidance).toBe("You might want to refactor this function.");
    expect(result.fileCheckRequest).toBeNull();
    expect(result.observations).toEqual([]);
    expect(result.isNothingToReport).toBe(false);
  });

  // ── 4. Guidance with <check-file> tag ─────────────────────────────
  it("extracts file check request and cleans guidance text", () => {
    const text =
      'The config file might have a conflict.\n<check-file>src/config/app.ts</check-file>';
    const result = parseSuperBroResponse(text);

    expect(result.fileCheckRequest).toBe("src/config/app.ts");
    expect(result.guidance).toBe("The config file might have a conflict.");
    expect(result.suggestedPrompt).toBeNull();
    expect(result.isNothingToReport).toBe(false);
  });

  // ── 5. Multiple <observation> tags ────────────────────────────────
  it("extracts multiple observations with correct categories", () => {
    const text = [
      "Some guidance here.",
      '<observation category="pattern">User prefers functional components</observation>',
      '<observation category="preference">Tailwind over CSS modules</observation>',
      '<observation category="issue">Missing error boundary in App</observation>',
      '<observation category="project_note">Uses Zustand for state management</observation>',
    ].join("\n");

    const result = parseSuperBroResponse(text);

    expect(result.observations).toHaveLength(4);

    expect(result.observations[0].text).toBe(
      "User prefers functional components",
    );
    expect(result.observations[0].category).toBe("pattern");
    expect(result.observations[0].id).toMatch(/^obs-/);
    expect(result.observations[0].createdAt).toBeTruthy();
    expect(result.observations[0].lastReferencedAt).toBeTruthy();

    expect(result.observations[1].text).toBe("Tailwind over CSS modules");
    expect(result.observations[1].category).toBe("preference");

    expect(result.observations[2].text).toBe(
      "Missing error boundary in App",
    );
    expect(result.observations[2].category).toBe("issue");

    expect(result.observations[3].text).toBe(
      "Uses Zustand for state management",
    );
    expect(result.observations[3].category).toBe("project_note");

    expect(result.guidance).toBe("Some guidance here.");
  });

  // ── 6. Single observation tag ─────────────────────────────────────
  it("extracts a single observation correctly", () => {
    const text =
      'Looks good overall.\n<observation category="pattern">Prefers named exports</observation>';
    const result = parseSuperBroResponse(text);

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].text).toBe("Prefers named exports");
    expect(result.observations[0].category).toBe("pattern");
    expect(result.guidance).toBe("Looks good overall.");
  });

  // ── 7. All tags combined ──────────────────────────────────────────
  it("extracts everything from a response with all tag types", () => {
    const text = [
      "I noticed a potential issue with the session store.",
      '<suggested-prompt>Fix the race condition in useClaudeSession hook</suggested-prompt>',
      "<check-file>src/hooks/useClaudeSession.ts</check-file>",
      '<observation category="issue">Race condition in session initialization</observation>',
      '<observation category="pattern">Uses async/await consistently</observation>',
    ].join("\n");

    const result = parseSuperBroResponse(text);

    expect(result.guidance).toBe(
      "I noticed a potential issue with the session store.",
    );
    expect(result.suggestedPrompt).toBe(
      "Fix the race condition in useClaudeSession hook",
    );
    expect(result.fileCheckRequest).toBe("src/hooks/useClaudeSession.ts");
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].text).toBe(
      "Race condition in session initialization",
    );
    expect(result.observations[0].category).toBe("issue");
    expect(result.observations[1].text).toBe(
      "Uses async/await consistently",
    );
    expect(result.observations[1].category).toBe("pattern");
    expect(result.isNothingToReport).toBe(false);
  });

  // ── 8. Empty suggested-prompt tag ─────────────────────────────────
  it("returns empty string for empty suggested-prompt tag", () => {
    const text =
      "Some guidance.\n<suggested-prompt></suggested-prompt>";
    const result = parseSuperBroResponse(text);

    // The regex captures empty group, trim yields "", and `"" ?? null` still
    // returns "" because "" is not nullish. So we check for empty string.
    // However, `promptMatch?.[1]?.trim()` on an empty capture returns "",
    // and `"" ?? null` returns "" (empty string is not nullish).
    expect(result.suggestedPrompt).toBe("");
  });

  // ── 9. Whitespace handling ────────────────────────────────────────
  it("trims whitespace inside tags", () => {
    const text = [
      "Guidance text.",
      "<suggested-prompt>   Run the linter   </suggested-prompt>",
      "<check-file>   src/lib/utils.ts   </check-file>",
      '<observation category="preference">   Spaces around operators   </observation>',
    ].join("\n");

    const result = parseSuperBroResponse(text);

    expect(result.suggestedPrompt).toBe("Run the linter");
    expect(result.fileCheckRequest).toBe("src/lib/utils.ts");
    expect(result.observations[0].text).toBe("Spaces around operators");
  });

  // ── 10. NOTHING_TO_REPORT with extra whitespace ───────────────────
  it("detects NOTHING_TO_REPORT when surrounded by whitespace", () => {
    const result = parseSuperBroResponse("  NOTHING_TO_REPORT  \n");
    expect(result.isNothingToReport).toBe(true);
    expect(result.guidance).toBe("");
    expect(result.suggestedPrompt).toBeNull();
    expect(result.fileCheckRequest).toBeNull();
    expect(result.observations).toEqual([]);
  });

  it("detects NOTHING_TO_REPORT with leading newlines and tabs", () => {
    const result = parseSuperBroResponse("\n\t  NOTHING_TO_REPORT  \t\n");
    expect(result.isNothingToReport).toBe(true);
  });

  // ── 11. Response with only tags (no guidance text outside tags) ───
  it("returns empty guidance when response contains only tags", () => {
    const text = [
      '<suggested-prompt>Add error handling to the fetch call</suggested-prompt>',
      "<check-file>src/api/client.ts</check-file>",
      '<observation category="issue">No error handling on network requests</observation>',
    ].join("\n");

    const result = parseSuperBroResponse(text);

    expect(result.guidance).toBe("");
    expect(result.suggestedPrompt).toBe(
      "Add error handling to the fetch call",
    );
    expect(result.fileCheckRequest).toBe("src/api/client.ts");
    expect(result.observations).toHaveLength(1);
    expect(result.isNothingToReport).toBe(false);
  });

  // ── Additional edge cases ─────────────────────────────────────────
  it("handles multiline content inside tags", () => {
    const text = [
      "Check this out.",
      "<suggested-prompt>",
      "Refactor the component to split",
      "rendering logic from data fetching",
      "</suggested-prompt>",
    ].join("\n");

    const result = parseSuperBroResponse(text);

    expect(result.suggestedPrompt).toBe(
      "Refactor the component to split\nrendering logic from data fetching",
    );
    expect(result.guidance).toBe("Check this out.");
  });

  it("generates unique ids for each observation", () => {
    const text = [
      '<observation category="pattern">First observation</observation>',
      '<observation category="pattern">Second observation</observation>',
    ].join("\n");

    const result = parseSuperBroResponse(text);

    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].id).not.toBe(result.observations[1].id);
  });

  it("sets createdAt and lastReferencedAt to the same ISO string", () => {
    const text =
      '<observation category="preference">Likes dark mode</observation>';
    const result = parseSuperBroResponse(text);

    const obs = result.observations[0];
    expect(obs.createdAt).toBe(obs.lastReferencedAt);
    // Verify it is a valid ISO date
    expect(new Date(obs.createdAt).toISOString()).toBe(obs.createdAt);
  });

  it("handles completely empty input", () => {
    const result = parseSuperBroResponse("");
    expect(result.guidance).toBe("");
    expect(result.suggestedPrompt).toBeNull();
    expect(result.fileCheckRequest).toBeNull();
    expect(result.observations).toEqual([]);
    expect(result.isNothingToReport).toBe(false);
  });

  it("ignores observation tags with invalid category values", () => {
    const text =
      '<observation category="unknown">Should be ignored</observation>\n<observation category="pattern">Should be kept</observation>';
    const result = parseSuperBroResponse(text);

    // The regex only matches the four valid categories, so "unknown" is not captured
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].text).toBe("Should be kept");
    expect(result.observations[0].category).toBe("pattern");
  });
});
