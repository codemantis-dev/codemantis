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
    turnTokensUsed: 8_000,
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

  // The persona contract — the orchestrator now opens with adversarial-
  // reviewer framing rather than neutral evaluator wording. Tone shapes
  // verdicts; this test pins the wording so a future edit can't quietly
  // soften the stance back to "evaluate what Claude Code did."
  it("opens with skeptical-senior-reviewer persona, not neutral evaluator", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    expect(systemPrompt).toContain("skeptical senior reviewer");
    expect(systemPrompt).toContain("default verdict is FAIL");
    expect(systemPrompt).toContain("narrative reads better than its evidence");
    // The Senior-Engineer Quality Contract on the executor side must be
    // referenced so the orchestrator knows what bar Claude Code is held to.
    expect(systemPrompt).toContain("Senior-Engineer Quality Contract");
    expect(systemPrompt).toContain("DEFERRED:");
  });

  // Regression: 2026-05-15 — parity-recovery turns produced advance_recovery
  // verdicts that dead-ended in handleAdvanceRecovery (no activeBlocker).
  // The prompt now tells the orchestrator to emit `advance` (or `fix`) after
  // a parity-recovery turn, never `advance_recovery`.
  it("includes parity-recovery routing rules that forbid advance_recovery", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    expect(systemPrompt).toContain('AFTER A PARITY-RECOVERY TURN');
    expect(systemPrompt).toContain('LAST TURN INJECTION = "parity-recovery"');
    expect(systemPrompt).toContain('NEVER emit "advance_recovery"');
    // The correct verdict is `advance` — the parity gate re-runs on advance.
    expect(systemPrompt).toContain('Parity gap closed');
    expect(systemPrompt).toContain('DEFERRED:');
  });

  it("includes WORKAROUND DETECTION block with banned phrases and a redo template", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    expect(systemPrompt).toContain("WORKAROUND DETECTION");
    // Each phrase from the plan must appear so the orchestrator catches
    // the same wording Claude Code used in the original incident.
    expect(systemPrompt).toContain("working around");
    expect(systemPrompt).toContain("local type extension");
    expect(systemPrompt).toContain("to avoid modifying");
    expect(systemPrompt).toContain("@ts-ignore");
    expect(systemPrompt).toContain("band-aid");
    expect(systemPrompt).toContain("disabled the test");
    // Fabrication signal — claims of success without evidence
    expect(systemPrompt).toContain("the build should pass");
    // Redo prompt template must reference both escape hatches
    expect(systemPrompt).toContain("DEFERRED: line");
    expect(systemPrompt).toContain("structured blocker");
  });

  it("includes ACTIVITY-EVIDENCE DETECTION cross-checking tools-used and duration", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;

    expect(systemPrompt).toContain("ACTIVITY-EVIDENCE DETECTION");
    expect(systemPrompt).toContain("TOOLS USED THIS TURN");
    expect(systemPrompt).toContain("TURN DURATION");
    // The detector must require Edit/Write tool use when completion is claimed
    expect(systemPrompt).toContain("Edit, Write");
    // The "<30s multi-file change" heuristic
    expect(systemPrompt).toMatch(/30\s*s/);
    // A fixing turn that did no Read/Grep/Glob is a guess
    expect(systemPrompt).toContain("Read/Grep/Glob");
  });

  // The retry path appends a corrective addendum so the second call isn't
  // a deterministic repeat of the first. Without this, a model that
  // returned a wrapper-shape JSON on attempt 1 returns the same wrapper-
  // shape JSON on the retry and Self-Drive pauses on a recoverable error.
  it("does NOT include the retry addendum on first call (no retryHint)", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;
    expect(systemPrompt).not.toContain("RETRY");
  });

  it("appends a corrective addendum when retryHint is provided", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const promise = callOrchestrator(
      makeInput(),
      "openai",
      "sk-test",
      "gpt-4o",
      "Could not parse AI response: Missing or invalid 'action' field",
    );
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const systemPrompt: string = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;
    expect(systemPrompt).toContain("RETRY");
    expect(systemPrompt).toContain("Missing or invalid 'action' field");
    expect(systemPrompt).toContain("TOP LEVEL");
    expect(systemPrompt).toContain("Do NOT wrap it in any container object");
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

  it("includes previous fix prompts at full length", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const longPrompt = "A".repeat(300);
    const input = makeInput({ previousFixPrompts: [longPrompt] });

    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;

    expect(userMessage).toContain(longPrompt);
    expect(userMessage).toContain("PREVIOUS FIX PROMPTS ALREADY TRIED");
  });

  it("includes LAST TURN INJECTION when system-injected (Phase A.2)", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const input = makeInput({ lastTurnInjection: "test-gate" } as Partial<OrchestratorInput>);
    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain("LAST TURN INJECTION: test-gate");
  });

  it("includes USER INTERJECTIONS block when interjections are present (Phase D.2)", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const input = makeInput({
      userInterjections: [
        { ts: 1_700_000_000_000, text: "We use MCP, not psql." },
        { ts: 1_700_000_060_000, text: "Stop demanding DATABASE_URL." },
      ],
    } as Partial<OrchestratorInput>);
    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain("USER INTERJECTIONS");
    expect(userMessage).toContain("We use MCP, not psql.");
    expect(userMessage).toContain("Stop demanding DATABASE_URL.");
  });

  it("omits USER INTERJECTIONS block when no interjections (Phase D.2)", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const input = makeInput();
    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;
    expect(userMessage).not.toContain("USER INTERJECTIONS");
  });

  it("emits LAST TURN INJECTION: none when the worker authored the turn (Phase A.2)", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");

    const input = makeInput();
    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain("LAST TURN INJECTION: none");
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

  // ── Wrapper-key recovery & raw-content preview ────────────────────────
  // Recurring failure: some models wrap the decision in a container key
  // like {"decision":{...}} or {"reasoning":"...","output":{...}}. The
  // top-level object has no `action`, the old code threw
  // "Missing or invalid 'action' field" and Self-Drive paused. The parser
  // now scans one level down for a child object with an action field and
  // unwraps it. See plan: ~/.claude/plans/image-4-still-unsolved-whimsical-map.md
  it("recovers from a single-key wrapper like {\"decision\":{...}}", async () => {
    const decision = await callAndResolveWith(
      JSON.stringify({
        decision: { action: "advance", summary: "All good.", confidence: "high" },
      }),
    );
    expect(decision.action).toBe("advance");
    expect(decision.summary).toBe("All good.");
    expect(decision.confidence).toBe("high");
  });

  it("recovers from a {\"reasoning\":\"...\",\"output\":{...}} wrapper", async () => {
    const decision = await callAndResolveWith(
      JSON.stringify({
        reasoning: "The verifier produced clean evidence for all 5 checks.",
        output: { action: "advance", summary: "Session done.", confidence: "high" },
      }),
    );
    expect(decision.action).toBe("advance");
    expect(decision.summary).toBe("Session done.");
  });

  it("still fails when no nested child has an action field", async () => {
    // No top-level action, no nested object with an action either.
    // Must still throw so the store's retry trigger fires on the
    // pauseReason substring "Could not parse AI response".
    const decision = await callAndResolveWith(
      JSON.stringify({ reasoning: "I cannot decide.", confidence: "low" }),
    );
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("Could not parse AI response");
    expect(decision.pauseReason).toContain("Missing or invalid 'action' field");
  });

  it("includes a short preview of the raw response in pauseReason on parse failure", async () => {
    // Diagnostic: every parse failure must carry a preview of what the
    // model actually returned so the user can see the offending shape in
    // the UI without devtools. This is the missing diagnostic that made
    // previous failure investigations speculative.
    const malformed = '{"summary":"no action here","confidence":"high","irrelevant":"x".repeat(400)}';
    const decision = await callAndResolveWith(malformed);
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("Could not parse AI response");
    expect(decision.pauseReason).toContain("preview:");
    expect(decision.pauseReason).toContain("summary");
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

  it("coerces blocker kind 'unknown' to 'orchestrator-uncertain' with canonical options (Phase D.1)", async () => {
    const decision = await callAndResolveWith(
      JSON.stringify({
        action: "pause",
        pauseReason: "couldn't classify",
        summary: "Self-Drive uncertain",
        confidence: "low",
        blocker: {
          kind: "unknown",
          summary: "Something is off",
          optionsOffered: [],
          resolutionCriteria: "ls -la src/foo.ts shows the file",
        },
      }),
    );
    expect(decision.blocker?.kind).toBe("orchestrator-uncertain");
    expect(decision.blocker?.optionsOffered.length).toBeGreaterThanOrEqual(3);
    expect(decision.blocker?.orchestratorReasoning).toBeTruthy();
  });

  it("preserves explicit reasoning string from orchestrator blocker (Phase D.1)", async () => {
    const decision = await callAndResolveWith(
      JSON.stringify({
        action: "pause",
        summary: "Stuck",
        confidence: "low",
        blocker: {
          kind: "infra-state-drift",
          summary: "Migration mismatch",
          optionsOffered: ["repair", "ignore"],
          resolutionCriteria: "supabase migration list shows alignment",
          orchestratorReasoning: "Local file 0042 exists but remote has 0043 with same name; suggesting rename to align.",
        },
      }),
    );
    expect(decision.blocker?.kind).toBe("infra-state-drift");
    expect(decision.blocker?.orchestratorReasoning).toMatch(/suggesting rename to align/);
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

  // ── Truncation handling (the "Expected ']'" incident) ─────────────────

  it("detects truncated JSON and reports a diagnostic reason", async () => {
    // This is the exact shape of the failure the user hit: the
    // verification decision ran out of maxTokens partway through
    // checkResults, so the response opens `{…[…` and never closes.
    // Previously: regex `/\{[\s\S]*\}/` returned an unbalanced slice and
    // JSON.parse threw "Expected ']'". Now: we detect truncation and say so.
    const truncated = String.raw`{"action":"advance","summary":"Session 1 verified","confidence":"high","checkResults":[{"label":"Migration files present","passed":true,"evidence":"supabase/migrations/:1 — \`20260420072452_...sql\`"},{"label":"Tables exist","passed":true,"evidence":"$ list_tables → \`public.imple`;

    const decision = await callAndResolveWith(truncated);
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("Could not parse AI response");
    // Either diagnostic path is acceptable — the key invariant is that
    // the message helps a future maintainer diagnose it as truncation.
    expect(decision.pauseReason).toMatch(/truncated|maxTokens/i);
  });

  it("parses a response whose string values contain literal braces and brackets", async () => {
    // Evidence strings routinely contain `{file}:{lines}` or `[…]`
    // placeholders that the model quotes from the verifier. The balanced-
    // brace extractor must treat them as string content, not structure.
    const payload = JSON.stringify({
      action: "advance",
      summary: "ok",
      confidence: "high",
      checkResults: [
        {
          label: "Check A",
          passed: true,
          evidence:
            "src/a.ts:1 — `export const tpl = \"{name}:{port}\"` · form matches `[kind]`",
        },
      ],
    });
    const decision = await callAndResolveWith(payload);
    expect(decision.action).toBe("advance");
    expect(decision.checkResults).toHaveLength(1);
    expect(decision.checkResults?.[0].evidence).toContain("{name}:{port}");
  });

  // ── request_recheck parsing ──────────────────────────────────────────

  it("accepts a well-formed request_recheck decision", async () => {
    const payload = JSON.stringify({
      action: "request_recheck",
      summary: "Two items need re-statement",
      confidence: "high",
      recheckItems: ["Pytest passes for src/helpers/", "No helper imports from pipeline/"],
      recheckPrompt:
        "Re-state item 1 as `$ pytest src/helpers/ -v → \"<first pass line>\" · mocks=<list>` and item 2 as `$ rg 'from pipeline' src/helpers/ → \"<output>\"`. Do not re-do other items.",
      checkResults: [
        { label: "Pytest passes for src/helpers/", passed: false, reason: "no $ cmd in evidence" },
      ],
    });
    const decision = await callAndResolveWith(payload);
    expect(decision.action).toBe("request_recheck");
    expect(decision.recheckItems).toEqual([
      "Pytest passes for src/helpers/",
      "No helper imports from pipeline/",
    ]);
    expect(decision.recheckPrompt).toContain("Re-state item 1");
    expect(decision.checkResults).toHaveLength(1);
  });

  it("demotes request_recheck with empty recheckItems to pause (does NOT throw)", async () => {
    const payload = JSON.stringify({
      action: "request_recheck",
      summary: "no items",
      confidence: "medium",
      recheckItems: [],
      recheckPrompt: "please re-state",
    });
    const decision = await callAndResolveWith(payload);
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("recheckItems is empty");
    expect(decision.recheckItems).toBeUndefined();
  });

  it("demotes request_recheck with empty recheckPrompt to pause", async () => {
    const payload = JSON.stringify({
      action: "request_recheck",
      summary: "no prompt",
      confidence: "medium",
      recheckItems: ["X"],
      recheckPrompt: "   ",
    });
    const decision = await callAndResolveWith(payload);
    expect(decision.action).toBe("pause");
    expect(decision.pauseReason).toContain("recheckPrompt is empty");
    expect(decision.recheckPrompt).toBeUndefined();
  });

  it("caps recheckPrompt at 2000 characters", async () => {
    const bigPrompt = "x".repeat(5000);
    const payload = JSON.stringify({
      action: "request_recheck",
      summary: "oversized",
      confidence: "medium",
      recheckItems: ["A"],
      recheckPrompt: bigPrompt,
    });
    const decision = await callAndResolveWith(payload);
    expect(decision.action).toBe("request_recheck");
    expect(decision.recheckPrompt).toHaveLength(2000);
  });

  it("drops non-string entries from recheckItems", async () => {
    const payload = JSON.stringify({
      action: "request_recheck",
      summary: "dirty list",
      confidence: "medium",
      recheckItems: ["A", 7, null, "", "  ", "B"],
      recheckPrompt: "re-state A and B",
    });
    const decision = await callAndResolveWith(payload);
    expect(decision.action).toBe("request_recheck");
    expect(decision.recheckItems).toEqual(["A", "B"]);
  });

  it("drops recheck fields when action is not request_recheck", async () => {
    const payload = JSON.stringify({
      action: "advance",
      summary: "ok",
      confidence: "high",
      recheckItems: ["oops"],
      recheckPrompt: "should not be here",
    });
    const decision = await callAndResolveWith(payload);
    expect(decision.action).toBe("advance");
    expect(decision.recheckItems).toBeUndefined();
    expect(decision.recheckPrompt).toBeUndefined();
  });

  // ── System prompt teaches the new action ──────────────────────────────

  it("system prompt teaches the request_recheck action with a decision tree", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const promise = callOrchestrator(makeInput(), "anthropic", "sk-ant-key", "claude-sonnet-4-20250514");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;

    const sp = vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;
    expect(sp).toContain("request_recheck");
    // Decision tree order (fix → request_recheck → pause)
    expect(sp).toContain("THREE-WAY DECISION TREE");
    // Must name the required fields
    expect(sp).toContain("recheckItems");
    expect(sp).toContain("recheckPrompt");
    // Must teach "prefer recheck over pause on format-only misses"
    expect(sp).toMatch(/PREFER "request_recheck"|PREFERENCE ORDER/);
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
    // Must be large enough to fit a verification decision with 8+
    // checkResults whose `evidence` strings carry [integration]/[behavioral]
    // proof forms (100–300 chars each). See the ORCHESTRATOR_MAX_TOKENS
    // comment in self-drive-orchestrator.ts for the reasoning.
    expect(call.maxTokens).toBeGreaterThanOrEqual(4096);
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

// ═══════════════════════════════════════════════════════════════════════════
// Regression-proofing: false-positive floor + co-pilot character
// (Layers 2–7 of the May 2026 Self-Drive overhaul.)
//
// These tests pin the prompt against drift back into the pre-fix behavior
// where (a) the detector flagged real long-running work as fabrication,
// (b) recovery demanded impossible per-turn Edit/Write proof, and (c) the
// orchestrator preferred `pause + Blocker` over diagnostic `fix` prompts.
// ═══════════════════════════════════════════════════════════════════════════

async function getSystemPromptOnce(): Promise<string> {
  const { sendAssistantChat } = await import("./tauri-commands");
  const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
  await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
  capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
  await promise;
  return vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt;
}

describe("co-pilot identity (Layer 7)", () => {
  it("system prompt frames the orchestrator as a CO-PILOT, not just a gatekeeper", async () => {
    const sp = await getSystemPromptOnce();
    expect(sp).toContain("CO-PILOT");
    expect(sp).toContain("DRIVE THE SESSION FORWARD");
    expect(sp).toContain("CATCH FABRICATION");
    expect(sp).toContain("path forward");
    expect(sp).toContain("Detection without guidance is half a feature");
  });

  it("system prompt encodes the action preference order with pause as last resort", async () => {
    const sp = await getSystemPromptOnce();
    expect(sp).toContain("ACTION PREFERENCE ORDER");
    expect(sp).toContain("advance > advance_recovery > request_recheck > fix > pause");
    expect(sp).toMatch(/pause.*last resort/);
  });

  it("system prompt provides co-pilot fix-prompt templates with diagnosis + suggested next step", async () => {
    const sp = await getSystemPromptOnce();
    expect(sp).toContain("CO-PILOT FIX-PROMPT TEMPLATES");
    expect(sp).toContain("Most likely cause");
    expect(sp).toContain("Suggested next step");
    expect(sp).toMatch(/Quote the result/);
  });

  it("system prompt encodes repeat-pattern enforcement as a PRE-EMIT SELF-CHECK gate over PREVIOUS FIX PROMPTS", async () => {
    const sp = await getSystemPromptOnce();
    // The rule is now phrased as a mandatory pre-emit gate (was: REPEAT-PATTERN ESCALATION).
    // The new phrasing is harder for Sonnet-grade orchestrators to treat as advisory.
    expect(sp).toContain("PRE-EMIT SELF-CHECK on repeat-pattern");
    expect(sp).toContain("PREVIOUS FIX PROMPTS ALREADY TRIED");
    expect(sp).toMatch(/MANDATORY GATE/);
    // Three routes — accept, switch diagnostic, pause with satisfiable blocker.
    expect(sp).toMatch(/\(a\) ACCEPT AND PASS/);
    expect(sp).toMatch(/\(b\) SWITCH the diagnostic/);
    expect(sp).toMatch(/\(c\) PAUSE with a structured blocker/);
    // The "third-shape-identical" trip-wire and the explicit "accept and move on" guidance
    // for when the verifier already provided the evidence in another location.
    expect(sp).toMatch(/third-shape-identical/);
    expect(sp).toMatch(/accept and move on/);
  });

  it("system prompt warns to prefer fix over pause for ambiguity", async () => {
    const sp = await getSystemPromptOnce();
    // The old "If the response is ambiguous → set confidence to 'low' and prefer 'pause'"
    // has been replaced with the co-pilot version that prefers fix-with-diagnostic.
    expect(sp).toMatch(/PREFER "fix"/);
    expect(sp).not.toMatch(/ambiguous.*prefer "pause"/);
  });
});

describe("ACTIVITY-EVIDENCE DETECTION refinements (Layers 2-4)", () => {
  it("system prompt requires sanity bounds (duration AND tokens) before flagging fabrication", async () => {
    const sp = await getSystemPromptOnce();
    // Detector A's fourth condition: short turn OR low token count
    expect(sp).toMatch(/TURN DURATION.*<\s*60s/);
    expect(sp).toMatch(/TURN TOKENS USED.*<\s*50,?000/);
    // Long turns get the benefit of the doubt explicitly
    expect(sp).toMatch(/benefit of the doubt/);
  });

  it("system prompt distinguishes file-change verbs from generic completion verbs", async () => {
    const sp = await getSystemPromptOnce();
    // File-change verbs that DO trigger the rule
    expect(sp).toContain("created file");
    expect(sp).toContain("wrote file");
    expect(sp).toContain("added test");
    expect(sp).toContain("added migration");
    // Generic verbs that do NOT trigger it (the legitimate non-edit work)
    expect(sp).toContain("deployed");
    expect(sp).toContain("verified");
    expect(sp).toContain("memory updated");
    expect(sp).toMatch(/do NOT trigger this rule/);
  });

  it("system prompt routes detected fabrication through a SOFT verify-evidence prompt, not a Blocker", async () => {
    const sp = await getSystemPromptOnce();
    expect(sp).toMatch(/SOFT verify-evidence prompt/);
    expect(sp).toMatch(/action: ?"fix"/);
    expect(sp).toMatch(/not a Blocker, not a pause/);
    // Two-paths-forward template — collaborative
    expect(sp).toContain("Two paths forward");
    expect(sp).toContain("git status --porcelain");
  });

  it("CONTEXT block surfaces TURN TOKENS USED to the orchestrator", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const input = makeInput({ turnTokensUsed: 1_234_567 });
    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;
    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain("TURN TOKENS USED:");
    expect(userMessage).toContain("1,234,567");
  });

  it("CONTEXT block reports 'unknown' when token count is zero", async () => {
    const { sendAssistantChat } = await import("./tauri-commands");
    const input = makeInput({ turnTokensUsed: 0 });
    const promise = callOrchestrator(input, "openai", "sk-test", "gpt-4o");
    await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
    capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
    await promise;
    const userMessage = vi.mocked(sendAssistantChat).mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain("TURN TOKENS USED: unknown");
  });
});

describe("Recovery-phase escape hatch (Layers 5-6)", () => {
  it("system prompt declares filesystem evidence as GROUND TRUTH in recovery", async () => {
    const sp = await getSystemPromptOnce();
    expect(sp).toContain("FILESYSTEM EVIDENCE IS GROUND TRUTH");
    // Specific commands that count as primary evidence
    expect(sp).toContain("ls -la");
    expect(sp).toContain("git status --porcelain");
    expect(sp).toContain("git diff --stat");
    expect(sp).toContain("pnpm tsc --noEmit");
    // The explicit anti-Edit/Write-requirement clause
    expect(sp).toMatch(/regardless of whether Edit\/Write tool calls were recorded/);
  });

  it("system prompt has an ANTI-LOOP guard that breaks the recovery cycle", async () => {
    const sp = await getSystemPromptOnce();
    expect(sp).toContain("ANTI-LOOP GUARD");
    expect(sp).toMatch(/2nd or later recovery turn/);
    expect(sp).toMatch(/advance_recovery/);
    expect(sp).toMatch(/impossible criterion|infinite Blocker loop/);
  });

  it("system prompt forbids resolutionCriteria that demand re-Editing already-correct files", async () => {
    const sp = await getSystemPromptOnce();
    expect(sp).toContain("SATISFIABILITY CONSTRAINT");
    // The exact failure mode from images 5-6 is called out by name
    expect(sp).toContain('"TOOLS USED THIS TURN must contain at least one Edit or Write call per deliverable file"');
    expect(sp).toMatch(/destructive|permanent Blocker loop/);
    // The proper criterion shape is filesystem verification
    expect(sp).toMatch(/proper criterion for "deliverables present" is FILESYSTEM VERIFICATION/);
  });
});

describe("build-mode preamble sync (Layer 6 sync)", () => {
  it("preamble explains the file-change vs generic-verb distinction to Claude Code", async () => {
    const { BUILD_MODE_PREAMBLE, FIX_MODE_PREAMBLE } = await import("./build-mode-preamble");
    for (const text of [BUILD_MODE_PREAMBLE, FIX_MODE_PREAMBLE]) {
      expect(text).toContain("REPORT NON-EDIT WORK PLAINLY");
      expect(text).toContain("created file");
      expect(text).toContain("deployed");
      expect(text).toMatch(/false[- ]positive/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Verification-phase contract: anti-loop fixes for the
// "consolidated-evidence false-FAIL → triple recheck → USER-DECISION pause"
// failure mode that hit users running Sonnet-grade orchestrators on
// otherwise-valid verification reports.
// ═══════════════════════════════════════════════════════════════════════════

async function captureSystemPrompt(): Promise<string> {
  const { sendAssistantChat } = await import("./tauri-commands");
  const promise = callOrchestrator(makeInput(), "openai", "sk-test", "gpt-4o");
  await vi.waitFor(() => { if (!capturedStreamHandler) throw new Error("waiting"); });
  capturedStreamHandler!({ type: "done", content: '{"action":"advance","summary":"ok","confidence":"high"}' });
  await promise;
  return vi.mocked(sendAssistantChat).mock.calls[0][0].systemPrompt as string;
}

describe("verification-phase anti-loop rules", () => {
  it("includes a CROSS-ITEM EVIDENCE CREDIT rule that allows consolidated test runs to satisfy multiple items", async () => {
    const sp = await captureSystemPrompt();
    expect(sp).toContain("CROSS-ITEM EVIDENCE CREDIT");
    expect(sp).toMatch(/consolidated command/i);
    expect(sp).toContain("vitest run");
    expect(sp).toMatch(/lift the relevant snippet into EACH covered item/);
    expect(sp).toMatch(/even when the snippet is physically printed under a different item number/i);
    expect(sp).toMatch(/Reject ONLY when no relevant evidence appears anywhere in the turn/);
  });

  it("includes an [integration] COMPLETENESS RULE forbidding stacked evidence requirements", async () => {
    const sp = await captureSystemPrompt();
    expect(sp).toContain("COMPLETENESS RULE");
    expect(sp).toMatch(/all three parts present\s+and non-empty/);
    expect(sp).toMatch(/no companion vitest\s+pass-count/);
    expect(sp).toMatch(/Stacking unrelated evidence\s+requirements onto an \[integration\] item is a contract violation/);
    expect(sp).toMatch(/mark such an item passed:true on the integration\s+triple alone/);
  });

  it("converts repeat-pattern guidance into a PRE-EMIT SELF-CHECK gate with three explicit routes", async () => {
    const sp = await captureSystemPrompt();
    expect(sp).toContain("PRE-EMIT SELF-CHECK on repeat-pattern");
    expect(sp).toMatch(/MANDATORY GATE/);
    expect(sp).toMatch(/\(a\) ACCEPT AND PASS the item if the verifier provided the same evidence twice/);
    expect(sp).toMatch(/\(b\) SWITCH the diagnostic — ask for a \*different\* concrete output/);
    expect(sp).toMatch(/\(c\) PAUSE with a structured blocker/);
    expect(sp).toMatch(/Never \(b\) repeated as paraphrase/);
    expect(sp).toMatch(/the verifier produced the evidence, you didn't recognize it, accept and move on/);
  });

  it("includes a FILESYSTEM-BLINDNESS clarification that bars fabricated DEFERRED criteria", async () => {
    const sp = await captureSystemPrompt();
    expect(sp).toContain("FILESYSTEM-BLINDNESS");
    expect(sp).toMatch(/you evaluate the verifier's TEXT ONLY/);
    expect(sp).toMatch(/cannot read source files/);
    // The exact failure-mode phrase from the production incident must be
    // called out by name so future edits can't silently re-allow it.
    expect(sp).toContain('OR explicit DEFERRED lines in audit doc');
    expect(sp).toMatch(/never write a Blocker whose resolution is a workflow you cannot verify/);
  });
});
