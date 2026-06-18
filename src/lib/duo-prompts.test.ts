import { describe, it, expect } from "vitest";
import {
  buildReviewPrompt,
  buildRepairPrompt,
  buildDialogueToPrimaryPrompt,
  buildDialogueToDuoPrompt,
  buildReAskPrompt,
  VERDICT_FORMAT_INSTRUCTION,
} from "./duo-prompts";

describe("buildReviewPrompt", () => {
  it("includes task, response, tools, diff, and the verdict format", () => {
    const p = buildReviewPrompt({
      task: "Add a logout button",
      primaryResponse: "I added the button to TitleBar.",
      diff: "+ <button>Logout</button>",
      toolsUsed: ["Edit src/TitleBar.tsx", "Bash pnpm test"],
      agentId: "claude_code",
    });
    expect(p).toContain("Add a logout button");
    expect(p).toContain("I added the button");
    expect(p).toContain("Edit src/TitleBar.tsx");
    expect(p).toContain("+ <button>Logout</button>");
    expect(p).toContain("READ-ONLY");
    expect(p).toContain("```duo-verdict");
  });

  it("falls back gracefully when tools/diff are empty", () => {
    const p = buildReviewPrompt({
      task: "t", primaryResponse: "r", diff: "   ", toolsUsed: [], agentId: "claude_code",
    });
    expect(p).toContain("(none reported)");
    expect(p).toContain("(no changes detected");
  });

  it("prepends the Codex clarifier only for codex", () => {
    const claude = buildReviewPrompt({ task: "t", primaryResponse: "r", diff: "d", toolsUsed: [], agentId: "claude_code" });
    const codex = buildReviewPrompt({ task: "t", primaryResponse: "r", diff: "d", toolsUsed: [], agentId: "codex" });
    expect(claude).not.toContain("reviewer dashboard");
    expect(codex).toContain("reviewer dashboard");
  });
});

describe("buildRepairPrompt", () => {
  it("frames the mentor's repair task as a directive to the primary", () => {
    const p = buildRepairPrompt({
      repairTask: "Wrap fetch in try/catch", rationale: "fetch can reject", agentId: "claude_code",
    });
    expect(p).toContain("blocking issue");
    expect(p).toContain("Wrap fetch in try/catch");
    expect(p).toContain("fetch can reject");
    // The primary fixes; no verdict block requested from it.
    expect(p).not.toContain("```duo-verdict");
  });
});

describe("dialogue prompts", () => {
  it("buildDialogueToPrimaryPrompt carries the round and concern, no verdict block", () => {
    const p = buildDialogueToPrimaryPrompt({ concern: "no tests", rationale: "coverage gap", round: 2, agentId: "claude_code" });
    expect(p).toContain("round 2");
    expect(p).toContain("no tests");
    expect(p).not.toContain("```duo-verdict");
  });

  it("buildDialogueToDuoPrompt asks the mentor to re-verdict", () => {
    const p = buildDialogueToDuoPrompt({ primaryResponse: "I added tests", round: 2, agentId: "codex" });
    expect(p).toContain("round 2");
    expect(p).toContain("I added tests");
    expect(p).toContain("```duo-verdict");
  });
});

describe("buildReAskPrompt", () => {
  it("requests only the verdict block", () => {
    const p = buildReAskPrompt();
    expect(p).toContain("did not include a valid duo-verdict block");
    expect(p).toContain(VERDICT_FORMAT_INSTRUCTION);
  });
});
