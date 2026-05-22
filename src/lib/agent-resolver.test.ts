import { describe, it, expect } from "vitest";
import {
  resolveAgentForTask,
  otherAgent,
  type AgentInstallState,
} from "./agent-resolver";

const BOTH_INSTALLED: AgentInstallState = { claude_code: true, codex: true };
const ONLY_CLAUDE: AgentInstallState = { claude_code: true, codex: false };
const ONLY_CODEX: AgentInstallState = { claude_code: false, codex: true };
const NEITHER: AgentInstallState = { claude_code: false, codex: false };

describe("resolveAgentForTask", () => {
  it("returns the per-task override when set and installed", () => {
    const r = resolveAgentForTask(
      "spec_writer",
      { defaultAgentByTask: { spec_writer: "codex" } },
      "claude_code",
      BOTH_INSTALLED,
    );
    expect(r).toBe("codex");
  });

  it("falls through to the primary agent when no override is set", () => {
    const r = resolveAgentForTask(
      "main_chat",
      { defaultAgentByTask: {} },
      "codex",
      BOTH_INSTALLED,
    );
    expect(r).toBe("codex");
  });

  it("primary is used per-category — an override on one category does not affect another", () => {
    const settings = { defaultAgentByTask: { spec_writer: "codex" as const } };
    expect(
      resolveAgentForTask("spec_writer", settings, "claude_code", BOTH_INSTALLED),
    ).toBe("codex");
    expect(
      resolveAgentForTask("main_chat", settings, "claude_code", BOTH_INSTALLED),
    ).toBe("claude_code");
  });

  it("falls back to the other agent when the chosen one is not installed", () => {
    // Override says codex, but codex isn't installed → fall back to claude.
    const r = resolveAgentForTask(
      "help",
      { defaultAgentByTask: { help: "codex" } },
      "codex",
      ONLY_CLAUDE,
    );
    expect(r).toBe("claude_code");
  });

  it("falls back the other direction too (primary claude, only codex installed)", () => {
    const r = resolveAgentForTask(
      "main_chat",
      { defaultAgentByTask: {} },
      "claude_code",
      ONLY_CODEX,
    );
    expect(r).toBe("codex");
  });

  it("returns claude_code as the canonical default when neither CLI is installed", () => {
    // Degenerate state — the app can't really run, but the resolver
    // must still return a concrete agent so callers have no nulls.
    const r = resolveAgentForTask(
      "assistant",
      { defaultAgentByTask: { assistant: "codex" } },
      "codex",
      NEITHER,
    );
    expect(r).toBe("claude_code");
  });

  it("an installed override is honoured even when it differs from primary", () => {
    const r = resolveAgentForTask(
      "assistant",
      { defaultAgentByTask: { assistant: "claude_code" } },
      "codex",
      BOTH_INSTALLED,
    );
    expect(r).toBe("claude_code");
  });

  it("every task category resolves to an installed agent", () => {
    for (const task of ["main_chat", "assistant", "spec_writer", "help"] as const) {
      const r = resolveAgentForTask(
        task,
        { defaultAgentByTask: {} },
        "claude_code",
        ONLY_CLAUDE,
      );
      expect(r).toBe("claude_code");
    }
  });
});

describe("otherAgent", () => {
  it("flips codex → claude_code", () => {
    expect(otherAgent("codex")).toBe("claude_code");
  });
  it("flips claude_code → codex", () => {
    expect(otherAgent("claude_code")).toBe("codex");
  });
});
