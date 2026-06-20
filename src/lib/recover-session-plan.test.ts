import { describe, it, expect, vi } from "vitest";
import { recoverSessionPlan } from "./recover-session-plan";
import type { RecoveryTransport } from "./recover-session-plan";
import { GUIDE_RECOVERY_MARKER } from "./session-plan-envelope";

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

function validSpec(): string {
  return `# Demo Spec

## 10. Session Plan

${session(1, "First")}
${session(2, "Second")}
${session(3, "Third")}
`;
}

// Session 1 is missing its Prompt for Claude Code fence (mirrors webcreator-v2).
function brokenSpec(): string {
  return `# Demo Spec

## 10. Session Plan

${session(1, "First", false)}
${session(2, "Second")}
${session(3, "Third")}
`;
}

const baseCtx = {
  specMarkdown: brokenSpec(),
  filename: "demo.md",
  provider: "claude-code",
  model: "claude-opus-4-8",
};

describe("recoverSessionPlan — transport is invoked with the diagnosis", () => {
  it("passes the spec, filename, and the parser's diagnosis to the transport", async () => {
    const transport = vi.fn<RecoveryTransport>().mockResolvedValue(validSpec());
    await recoverSessionPlan(baseCtx, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    const arg = transport.mock.calls[0][0];
    expect(arg.specMarkdown).toBe(brokenSpec());
    expect(arg.filename).toBe("demo.md");
    expect(arg.diagnosis).toMatch(/Session 1/);
    expect(arg.diagnosis).toMatch(/Prompt for Claude Code/);
  });
});

describe("recoverSessionPlan — structured envelope (CLI in-band shape)", () => {
  it("builds the plan from a JSON envelope, regex-free, with no markdown to save", async () => {
    const envelope = `${GUIDE_RECOVERY_MARKER}
{"title":"Demo","sessions":[
  {"title":"One","prompt":"do one"},
  {"title":"Two","prompt":"do two"}
]}`;
    const transport: RecoveryTransport = async () => envelope;
    const result = await recoverSessionPlan(baseCtx, transport);
    expect(result.degraded).toBe(false);
    expect(result.source).toBe("envelope");
    expect(result.parsed.sessions).toHaveLength(2);
    expect(result.correctedMarkdown).toBeNull();
    expect(result.originalDiagnosis).toMatch(/Session 1/);
    expect(result.provider).toBe("claude-code");
  });
});

describe("recoverSessionPlan — corrected markdown (API shape)", () => {
  it("re-parses corrected markdown and offers it for save-corrected", async () => {
    const transport: RecoveryTransport = async () => validSpec();
    const result = await recoverSessionPlan(
      { ...baseCtx, provider: "anthropic" },
      transport,
    );
    expect(result.degraded).toBe(false);
    expect(result.source).toBe("markdown");
    expect(result.parsed.sessions).toHaveLength(3);
    expect(result.correctedMarkdown).toBe(validSpec());
  });
});

describe("recoverSessionPlan — never hard-fails", () => {
  it("degrades to a single-session plan when the transport returns nothing (no key / CLI)", async () => {
    const transport: RecoveryTransport = async () => "";
    const result = await recoverSessionPlan(baseCtx, transport);
    expect(result.degraded).toBe(true);
    expect(result.source).toBe("degraded");
    expect(result.parsed.sessions).toHaveLength(1);
    // The original parser diagnosis is still surfaced for transparency.
    expect(result.originalDiagnosis).toMatch(/Session 1/);
  });

  it("degrades when the transport throws (HTTP error, cancelled CLI turn)", async () => {
    const transport: RecoveryTransport = async () => {
      throw new Error("Anthropic API error 401: invalid key");
    };
    const result = await recoverSessionPlan(baseCtx, transport);
    expect(result.degraded).toBe(true);
    expect(result.parsed.sessions).toHaveLength(1);
  });

  it("degrades when the model returned text that still doesn't parse", async () => {
    const transport: RecoveryTransport = async () => brokenSpec(); // unchanged
    const result = await recoverSessionPlan(baseCtx, transport);
    expect(result.degraded).toBe(true);
    expect(result.source).toBe("degraded");
  });
});
