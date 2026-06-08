import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverSessionPlan } from "./recover-session-plan";

// Mock the Tauri invoke surface so these tests stay pure.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

function session(num: number, title: string, withPrompt = true): string {
  let s = `### Session ${num}: ${title} (~1 files)
**Scope:** Do thing ${num}.
**Read sections:** §${num}
**Files:**
- \`file${num}.ts\` (create)

`;
  if (withPrompt) {
    s += `**Prompt for Claude Code:**
\`\`\`
Implement session ${num}.
\`\`\`

`;
  }
  s += `**Verify before next session:**
- [ ] file${num}.ts compiles
`;
  return s;
}

// Helper — builds a minimal spec whose Session Plan parses cleanly.
function validSpec(): string {
  return `# Demo Spec

## 10. Session Plan

${session(1, "First")}
${session(2, "Second")}
${session(3, "Third")}
`;
}

// Helper — builds a spec where Session 1 is missing its Prompt for Claude
// Code fence (mirrors the webcreator-v2 regression). Three sessions total
// so the diagnose code hits the "Session N is the offender" branch rather
// than the catch-all "only one usable session" branch.
function brokenSpec(): string {
  return `# Demo Spec

## 10. Session Plan

${session(1, "First", false)}
${session(2, "Second")}
${session(3, "Third")}
`;
}

describe("recoverSessionPlan — refuses without an API path", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("refuses when provider is claude-code (CLI, no API key)", async () => {
    const result = await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "claude-code",
      model: "claude-opus-4-8",
      apiKey: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.recoveryReason).toMatch(/API provider/i);
      expect(result.originalDiagnosis).toMatch(/Session 1/);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses when provider is codex (CLI, no API key)", async () => {
    const result = await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "codex",
      model: "gpt-5",
      apiKey: "",
    });
    expect(result.ok).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses when API key is empty for an API provider", async () => {
    const result = await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKey: "   ",
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.recoveryReason).toMatch(/No API key/i);
      expect(result.recoveryReason).toMatch(/anthropic/);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses when model name is missing", async () => {
    const result = await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "anthropic",
      model: "",
      apiKey: "sk-test",
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.recoveryReason).toMatch(/No model configured/i);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("recoverSessionPlan — happy path", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns ok=true with the parsed plan when the AI returns a parseable spec", async () => {
    invokeMock.mockResolvedValueOnce({
      recoveredMarkdown: validSpec(),
      provider: "anthropic",
      model: "claude-opus-4-8",
    });

    const result = await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKey: "sk-test",
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(
      "recover_session_plan",
      expect.objectContaining({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-opus-4-8",
        filename: "demo.md",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.sessions).toHaveLength(3);
      expect(result.provider).toBe("anthropic");
      expect(result.originalDiagnosis).toMatch(/Session 1/);
    }
  });

  it("passes the parser's diagnosis through to the backend so the prompt is targeted", async () => {
    invokeMock.mockResolvedValueOnce({
      recoveredMarkdown: validSpec(),
      provider: "openai",
      model: "gpt-5",
    });

    await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "openai",
      model: "gpt-5",
      apiKey: "sk-test",
    });

    const [, args] = invokeMock.mock.calls[0];
    const typed = args as { diagnosis: string };
    expect(typed.diagnosis).toMatch(/Session 1/);
    expect(typed.diagnosis).toMatch(/Prompt for Claude Code/);
  });
});

describe("recoverSessionPlan — recovery failures", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns ok=false when the backend invoke rejects", async () => {
    invokeMock.mockRejectedValueOnce("Anthropic API error 401: invalid key");

    const result = await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKey: "sk-bad",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.recoveryReason).toMatch(/Anthropic API error 401/);
      // Original diagnosis is still surfaced so the user sees both layers.
      expect(result.originalDiagnosis).toMatch(/Session 1/);
    }
  });

  it("returns ok=false when the AI returned text that still doesn't parse", async () => {
    // The AI did something, but didn't actually fix the Session 1 prompt block.
    invokeMock.mockResolvedValueOnce({
      recoveredMarkdown: brokenSpec(), // unchanged!
      provider: "anthropic",
      model: "claude-opus-4-8",
    });

    const result = await recoverSessionPlan({
      specMarkdown: brokenSpec(),
      filename: "demo.md",
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.recoveryReason).toMatch(/result still does not parse/);
      expect(result.recoveryReason).toMatch(/Session 1/);
    }
  });
});
