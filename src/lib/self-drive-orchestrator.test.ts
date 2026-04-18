import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OrchestratorInput, OrchestratorDecision } from "../types/implementation-guide";
import type { AssistantStreamEvent } from "./tauri-commands";

// ---------------------------------------------------------------------------
// Mock tauri-commands — capture the handler passed to listenAssistantStream
// so tests can simulate streaming events.
// ---------------------------------------------------------------------------

let capturedStreamHandler: ((event: AssistantStreamEvent) => void) | null = null;
const mockUnlisten = vi.fn();

vi.mock("./tauri-commands", () => ({
  sendAssistantChat: vi.fn(() => Promise.resolve()),
  listenAssistantStream: vi.fn((_id: string, handler: (e: AssistantStreamEvent) => void) => {
    capturedStreamHandler = handler;
    return Promise.resolve(mockUnlisten);
  }),
  cancelAssistantChat: vi.fn(() => Promise.resolve()),
}));

// Import after mocks are wired up
import { callOrchestrator } from "./self-drive-orchestrator";

// We need to access the non-exported pure functions for thorough testing.
// Re-import the module source and extract them via a second dynamic import.
// Vitest allows importing the module directly — the pure functions are tested
// indirectly through callOrchestrator, but we also use a workaround below.

// ---------------------------------------------------------------------------
// Because buildSystemPrompt, buildUserMessage, parseOrchestratorResponse are
// NOT exported, we test them indirectly:
//   - buildSystemPrompt / buildUserMessage: validated via callOrchestrator's
//     outgoing sendAssistantChat call args.
//   - parseOrchestratorResponse: validated by feeding different "done" events
//     through the streaming handler and inspecting callOrchestrator's result.
// ---------------------------------------------------------------------------

// --- Helpers ---------------------------------------------------------------

function makeInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    currentPhase: "building",
    sessionPlan: {
      index: 1,
      name: "Foundation",
      scope: "Set up project structure",
      prompt: "Build the foundation",
      verifyChecks: [{ label: "TypeScript compiles" }, { label: "Tests pass" }],
      isLastSession: false,
      hasAuditDocument: true,
    },
    claudeCodeResponse: "I created the files successfully.",
    claudeCodeToolsUsed: ["Write", "Bash"],
    turnDurationMs: 12_000,
    fixAttempt: 0,
    maxFixAttempts: 3,
    previousFixPrompts: [],
    techStack: "React + TypeScript + Vite",
    testCommand: "pnpm test",
    buildCommand: "pnpm tsc --noEmit",
    specFilename: "spec.md",
    auditFilename: "audit.md",
    activeBlocker: null,
    recentPauseSummaries: [],
    ...overrides,
  };
}

/**
 * Helper: call the orchestrator and immediately emit a "done" event with
 * the given content so the promise resolves.
 */
async function callAndResolveWith(content: string, input?: OrchestratorInput): Promise<OrchestratorDecision> {
  const promise = callOrchestrator(input ?? makeInput(), "openai", "sk-test", "gpt-4o");

  // listenAssistantStream is async — wait a tick for it to resolve and
  // capture the handler, then fire the "done" event.
  await vi.waitFor(() => {
    if (!capturedStreamHandler) throw new Error("handler not captured yet");
  });

  capturedStreamHandler!({ type: "done", content });
  return promise;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedStreamHandler = null;
});

// ═══════════════════════════════════════════════════════════════════════════
// buildSystemPrompt (tested indirectly via sendAssistantChat args)
// ═══════════════════════════════════════════════════════════════════════════

describe("buildSystemPrompt", () => {
  it("includes decision rules for each phase", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const call = vi.mocked(sendAssistantChat).mock.calls[0][0];
    const systemPrompt: string = call.systemPrompt;

    // Every phase should be referenced in the decision rules
    expect(systemPrompt).toContain('currentPhase = "building"');
    expect(systemPrompt).toContain('currentPhase = "build-checking"');
    expect(systemPrompt).toContain('currentPhase = "verifying"');
    expect(systemPrompt).toContain('currentPhase = "fixing"');
    expect(systemPrompt).toContain('currentPhase = "testing"');
    expect(systemPrompt).toContain('currentPhase = "committing"');
  });

  it("includes valid action values", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    expect(systemPrompt).toContain('"action": "advance"');
    expect(systemPrompt).toContain('"action": "fix"');
    expect(systemPrompt).toContain('"action": "build_check"');
    expect(systemPrompt).toContain('"action": "verify"');
    expect(systemPrompt).toContain('"action": "pause"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildUserMessage (tested indirectly via sendAssistantChat args)
// ═══════════════════════════════════════════════════════════════════════════

describe("buildUserMessage", () => {
  it("includes session plan and tools used", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const input = makeInput();
    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;

    expect(userMessage).toContain("Phase: building");
    expect(userMessage).toContain("Session: 1 — Foundation");
    expect(userMessage).toContain("Scope: Set up project structure");
    expect(userMessage).toContain("Write, Bash");
    expect(userMessage).toContain("- TypeScript compiles");
    expect(userMessage).toContain("- Tests pass");
  });

  it("truncates previous fix prompts at 200 chars", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const longPrompt = "A".repeat(300);
    const input = makeInput({ previousFixPrompts: [longPrompt] });

    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;

    // The fix prompt should be truncated — it must NOT contain the full 300-char string
    expect(userMessage).not.toContain(longPrompt);
    // But it should contain the first 200 characters
    expect(userMessage).toContain("A".repeat(200));
    expect(userMessage).toContain("PREVIOUS FIX PROMPTS ALREADY TRIED");
  });

  it("includes techStack, buildCommand, testCommand", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const input = makeInput({
      techStack: "Rust + Tauri",
      buildCommand: "cargo build",
      testCommand: "cargo test",
    });

    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;

    expect(userMessage).toContain("Tech stack: Rust + Tauri");
    expect(userMessage).toContain("Build command: cargo build");
    expect(userMessage).toContain("Test command: cargo test");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseOrchestratorResponse (tested through the streaming done event)
// ═══════════════════════════════════════════════════════════════════════════

describe("parseOrchestratorResponse", () => {
  it("parses valid JSON response", async () => {
    const decision = await callAndResolveWith(
      '{"action":"advance","summary":"All good.","confidence":"high"}',
    );
    expect(decision.action).toBe("advance");
    expect(decision.summary).toBe("All good.");
    expect(decision.confidence).toBe("high");
  });

  it("strips markdown code fences from response", async () => {
    const decision = await callAndResolveWith(
      '```json\n{"action":"fix","fixPrompt":"Fix the error","summary":"Build failed.","confidence":"high"}\n```',
    );
    expect(decision.action).toBe("fix");
    expect(decision.fixPrompt).toBe("Fix the error");
  });

  it("extracts JSON from mixed text response", async () => {
    const decision = await callAndResolveWith(
      'Here is my analysis:\n\n{"action":"verify","summary":"Ready to verify.","confidence":"medium"}\n\nLet me know if you need more info.',
    );
    expect(decision.action).toBe("verify");
    expect(decision.summary).toBe("Ready to verify.");
  });

  it("validates required 'action' field", async () => {
    const decision = await callAndResolveWith(
      '{"summary":"No action here","confidence":"high"}',
    );
    // Should fall back to pause due to parse error
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("Could not parse AI response");
  });

  it("rejects invalid action values", async () => {
    const decision = await callAndResolveWith(
      '{"action":"fly_to_moon","summary":"invalid","confidence":"high"}',
    );
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("Could not parse AI response");
    expect(decision.pauseReason).toContain("Invalid action");
  });

  it("defaults confidence to 'medium' when missing", async () => {
    const decision = await callAndResolveWith(
      '{"action":"advance","summary":"Done."}',
    );
    expect(decision.action).toBe("advance");
    expect(decision.confidence).toBe("medium");
  });

  it("defaults summary when missing", async () => {
    const decision = await callAndResolveWith(
      '{"action":"pause","pauseReason":"need input"}',
    );
    expect(decision.action).toBe("pause");
    expect(decision.summary).toContain("pause");
    expect(decision.summary).toContain("no summary provided");
  });

  it("handles all 8 valid actions", async () => {
    const validActions = ["advance", "verify", "fix", "build_check", "test", "commit", "pause", "abort"] as const;

    for (const action of validActions) {
      vi.clearAllMocks();
      capturedStreamHandler = null;

      const decision = await callAndResolveWith(
        JSON.stringify({ action, summary: `${action} action`, confidence: "high" }),
      );
      expect(decision.action).toBe(action);
    }
  });

  it("throws on empty response", async () => {
    const decision = await callAndResolveWith("");
    // Empty string has no JSON object → parse error → fallback pause
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("Could not parse AI response");
  });

  it("throws on invalid JSON", async () => {
    const decision = await callAndResolveWith("{action: not-valid-json}");
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("Could not parse AI response");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// callOrchestrator — async / streaming behavior
// ═══════════════════════════════════════════════════════════════════════════

describe("callOrchestrator", () => {
  it("returns parsed decision on successful response", async () => {
    const decision = await callAndResolveWith(
      '{"action":"build_check","buildCommand":"pnpm tsc --noEmit","summary":"Build completed. Checking types.","confidence":"high"}',
    );

    expect(decision).toEqual({
      action: "build_check",
      buildCommand: "pnpm tsc --noEmit",
      summary: "Build completed. Checking types.",
      confidence: "high",
    });
  });

  it("rejects on API error", async () => {
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");

    await vi.waitFor(() => {
      if (!capturedStreamHandler) throw new Error("waiting");
    });

    capturedStreamHandler!({ type: "error", message: "Rate limit exceeded" });

    await expect(promise).rejects.toThrow("Rate limit exceeded");
  });

  it("accumulates delta events and uses full content on done", async () => {
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");

    await vi.waitFor(() => {
      if (!capturedStreamHandler) throw new Error("waiting");
    });

    // Simulate streaming deltas followed by a done event WITHOUT content
    // (so it falls back to accumulated fullContent)
    capturedStreamHandler!({ type: "delta", text: '{"action":' });
    capturedStreamHandler!({ type: "delta", text: '"advance",' });
    capturedStreamHandler!({ type: "delta", text: '"summary":"Streamed.",' });
    capturedStreamHandler!({ type: "delta", text: '"confidence":"high"}' });
    capturedStreamHandler!({ type: "done" }); // no content field → uses accumulated

    const decision = await promise;
    expect(decision.action).toBe("advance");
    expect(decision.summary).toBe("Streamed.");
  });

  it("resolves with pause on cancellation", async () => {
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");

    await vi.waitFor(() => {
      if (!capturedStreamHandler) throw new Error("waiting");
    });

    capturedStreamHandler!({ type: "cancelled" });

    const decision = await promise;
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("cancelled");
  });

  it("passes correct provider, apiKey, and model to sendAssistantChat", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const promise = callOrchestrator(makeInput(), "anthropic", "sk-ant-key", "claude-sonnet-4-20250514");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const call = vi.mocked(sendAssistantChat).mock.calls[0][0];
    expect(call.provider).toBe("anthropic");
    expect(call.apiKey).toBe("sk-ant-key");
    expect(call.model).toBe("claude-sonnet-4-20250514");
    expect(call.maxTokens).toBe(1024);
  });

  it("system prompt requires per-check evidence with file:lines citations for advance", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    // Evidence contract for the verifying phase.
    expect(systemPrompt).toContain("{file}:{lines}");
    expect(systemPrompt).toContain("quoted code");
    // Advance requires full per-check coverage.
    expect(systemPrompt).toContain("full per-check coverage");
    // "advance" is no longer a plain trust signal.
    expect(systemPrompt).toContain("NOT a trust signal");
  });

  it("parses a structured blocker alongside a pause action", async () => {
    const decision = await callAndResolveWith(
      JSON.stringify({
        action: "pause",
        pauseReason: "Supabase migration history mismatch",
        summary: "Blocked on migration history",
        confidence: "high",
        blocker: {
          kind: "infra-state-drift",
          summary: "14 mismatched migration versions",
          optionsOffered: ["Run migration repair", "Rename local timestamps"],
          resolutionCriteria: "supabase db push succeeds AND schema_migrations contains 20260418120000",
        },
      }),
    );

    expect(decision.action).toBe("pause");
    expect(decision.blocker).toBeDefined();
    expect(decision.blocker!.kind).toBe("infra-state-drift");
    expect(decision.blocker!.optionsOffered).toHaveLength(2);
    expect(decision.blocker!.resolutionCriteria).toContain("schema_migrations");
  });

  it("drops a malformed blocker object instead of failing the whole decision", async () => {
    const decision = await callAndResolveWith(
      JSON.stringify({
        action: "pause",
        pauseReason: "something went wrong",
        summary: "pause",
        confidence: "high",
        blocker: {
          // missing kind + resolutionCriteria → invalid
          summary: "half-baked",
        },
      }),
    );

    expect(decision.action).toBe("pause");
    expect(decision.blocker).toBeUndefined();
  });

  it("accepts the new advance_recovery action", async () => {
    const decision = await callAndResolveWith(
      JSON.stringify({
        action: "advance_recovery",
        summary: "Blocker resolved: $ supabase db push OK",
        confidence: "high",
      }),
    );
    expect(decision.action).toBe("advance_recovery");
  });

  it("system prompt instructs orchestrator to emit a structured blocker on pause", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    expect(systemPrompt).toContain("BLOCKER CLASSIFICATION");
    expect(systemPrompt).toContain("infra-state-drift");
    expect(systemPrompt).toContain("resolutionCriteria");
    expect(systemPrompt).toContain("AFTER A RECOVERY PHASE");
    expect(systemPrompt).toContain("advance_recovery");
  });

  it("system prompt instructs skim-language detection and forbidden phrases", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    expect(systemPrompt).toContain("SKIMMING DETECTION");
    expect(systemPrompt).toContain("all remaining items pass");
    expect(systemPrompt).toContain("LGTM");
    expect(systemPrompt).toContain("batch-PASS language without evidence");
  });
});
