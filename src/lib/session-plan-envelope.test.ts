import { describe, it, expect } from "vitest";
import {
  GUIDE_RECOVERY_MARKER,
  buildRecoveryPrompt,
  buildDegradedPlan,
  extractRecoveredPlan,
} from "./session-plan-envelope";

// A markdown spec whose Session Plan parses cleanly with the strict parser —
// used to prove the "model returned corrected markdown" branch.
function validMarkdownSpec(): string {
  const session = (n: number) => `### Session ${n}: Thing ${n} (~1 files)
**Scope:** Do thing ${n}.
**Files:**
- \`file${n}.ts\` (create)

**Prompt for Claude Code:**
\`\`\`
Implement session ${n}.
\`\`\`

**Verify before next session:**
- [ ] file${n}.ts compiles
`;
  return `# Demo Spec

## 10. Session Plan

${session(1)}
${session(2)}
`;
}

function envelopeReply(opts?: { marker?: boolean; preamble?: string }): string {
  const obj = {
    title: "Video Builder",
    sessions: [
      {
        title: "Backend state",
        prompt: "Implement the workflow state helpers in server.js.",
        scope: "DB init + segment planner",
        readSections: "§3, §6",
        files: ["server.js", "server.test.js"],
        verify: ["npm test passes", "node --check server.js"],
      },
      {
        title: "Grok planning",
        prompt: "Implement buildWorkflowPlanningPayload and the parse helpers.",
        files: ["server.js"],
      },
    ],
  };
  const json = JSON.stringify(obj, null, 2);
  const body = opts?.marker === false ? json : `${GUIDE_RECOVERY_MARKER}\n${json}`;
  const fenced = "```\n" + body + "\n```";
  return (opts?.preamble ?? "") + fenced;
}

describe("buildRecoveryPrompt", () => {
  it("embeds the marker, the diagnosis, the filename, and the spec", () => {
    const prompt = buildRecoveryPrompt("# Spec\nbody", "Session 4 has no prompt", "demo.md");
    expect(prompt).toContain(GUIDE_RECOVERY_MARKER);
    expect(prompt).toContain("Session 4 has no prompt");
    expect(prompt).toContain("demo.md");
    expect(prompt).toContain("# Spec\nbody");
  });
});

describe("extractRecoveredPlan — JSON envelope (regex-free)", () => {
  it("builds the plan directly from a marked, fenced envelope", () => {
    const out = extractRecoveredPlan(envelopeReply(), "# Demo\nbody", "demo.md");
    expect(out.source).toBe("envelope");
    expect(out.degraded).toBe(false);
    expect(out.correctedMarkdown).toBeNull();
    expect(out.plan.title).toBe("Video Builder");
    expect(out.plan.sessions).toHaveLength(2);
    expect(out.plan.sessions[0].index).toBe(1);
    expect(out.plan.sessions[0].prompt).toMatch(/workflow state helpers/);
    expect(out.plan.sessions[0].files).toEqual(["server.js", "server.test.js"]);
    expect(out.plan.sessions[0].verifyChecks.map((v) => v.label)).toContain("npm test passes");
    expect(out.plan.sessions[1].index).toBe(2);
  });

  it("tolerates prose around the envelope and an absent marker (bare JSON)", () => {
    const withPreamble = extractRecoveredPlan(
      envelopeReply({ preamble: "Here is the plan:\n\n" }),
      "# Demo",
      "demo.md",
    );
    expect(withPreamble.source).toBe("envelope");

    const bare = extractRecoveredPlan(envelopeReply({ marker: false }), "# Demo", "demo.md");
    expect(bare.source).toBe("envelope");
    expect(bare.plan.sessions).toHaveLength(2);
  });

  it("does not let braces inside string values truncate the JSON", () => {
    const reply = `${GUIDE_RECOVERY_MARKER}
{"title":"T","sessions":[{"title":"A","prompt":"use a regex like /\\\\{x\\\\}/ and an object {literal}"}]}`;
    const out = extractRecoveredPlan(reply, "# Demo", "demo.md");
    expect(out.source).toBe("envelope");
    expect(out.plan.sessions[0].prompt).toMatch(/\{literal\}/);
  });

  it("drops sessions without a prompt and renumbers the survivors", () => {
    const reply = `${GUIDE_RECOVERY_MARKER}
{"sessions":[{"title":"NoPrompt"},{"title":"Real","prompt":"do it"},{"prompt":"  "}]}`;
    const out = extractRecoveredPlan(reply, "# Spec Title", "demo.md");
    expect(out.source).toBe("envelope");
    expect(out.plan.sessions).toHaveLength(1);
    expect(out.plan.sessions[0].index).toBe(1);
    expect(out.plan.sessions[0].prompt).toBe("do it");
    // Title falls back to the spec H1 when the envelope omits it.
    expect(out.plan.title).toBe("Spec Title");
  });
});

describe("extractRecoveredPlan — corrected markdown fallback", () => {
  it("re-parses corrected markdown when there is no envelope", () => {
    const out = extractRecoveredPlan(validMarkdownSpec(), "# Demo\nbroken", "demo.md");
    expect(out.source).toBe("markdown");
    expect(out.degraded).toBe(false);
    expect(out.plan.sessions).toHaveLength(2);
    // The corrected markdown is offered for "save corrected version".
    expect(out.correctedMarkdown).toBe(validMarkdownSpec());
  });
});

describe("extractRecoveredPlan — degraded fallback (never hard-fail)", () => {
  it("returns a runnable single-session plan for empty replies", () => {
    const out = extractRecoveredPlan("", "# My Spec\nbody", "my-spec.md");
    expect(out.source).toBe("degraded");
    expect(out.degraded).toBe(true);
    expect(out.correctedMarkdown).toBeNull();
    expect(out.plan.title).toBe("My Spec");
    expect(out.plan.sessions).toHaveLength(1);
    expect(out.plan.sessions[0].prompt).toMatch(/my-spec\.md/);
  });

  it("returns degraded for garbage that is neither envelope nor parseable markdown", () => {
    const out = extractRecoveredPlan("sorry, I can't help with that", "# Spec", "s.md");
    expect(out.source).toBe("degraded");
    expect(out.plan.sessions).toHaveLength(1);
  });

  it("returns degraded for a malformed (unparseable) JSON envelope rather than throwing", () => {
    const reply = `${GUIDE_RECOVERY_MARKER}\n{ "sessions": [ {"prompt": "x"`; // truncated
    const out = extractRecoveredPlan(reply, "# Spec", "s.md");
    expect(out.source).toBe("degraded");
  });

  it("returns degraded for a valid envelope object with zero usable sessions", () => {
    const reply = `${GUIDE_RECOVERY_MARKER}\n{"sessions":[]}`;
    const out = extractRecoveredPlan(reply, "# Spec", "s.md");
    expect(out.source).toBe("degraded");
  });
});

describe("buildDegradedPlan", () => {
  it("derives the title from the spec H1 and references the spec file", () => {
    const plan = buildDegradedPlan("# Cool Feature — Specification\n\nstuff", "cool.md");
    expect(plan.title).toBe("Cool Feature — Specification");
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].prompt).toMatch(/cool\.md/);
  });

  it("falls back to a generic title when there is no H1", () => {
    const plan = buildDegradedPlan("no heading here", "x.md");
    expect(plan.title).toBe("Specification");
  });
});
