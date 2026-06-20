/**
 * Integration: Recognize Guide auto-recovery (AI fallback).
 *
 * Pins the contract between `handleRecognizeGuide`, AI recovery, the toast
 * surface, and the guide store when the strict regex parser fails on a
 * real-world spec.
 *
 * Fixture: src/lib/__fixtures__/webcreator-v2-spec.md — a 13-session,
 * 135 KB spec where Sonnet forgot the `**Prompt for Claude Code:**` fence
 * label on Session 1. The parser aborts; recovery rescues it.
 *
 * Recovery is now available on EVERY provider and NEVER hard-fails:
 *   • API providers recover via the `recover_session_plan` command,
 *   • CLI providers (claude-code / codex) recover IN-BAND via the live
 *     session (router.recoverGuideViaCli) with NO API key, and
 *   • if neither yields a clean plan, recovery degrades to a single-session
 *     guide instead of dead-ending.
 *
 * Why this lives in /integration: it exercises the parser, the recovery
 * wrapper, the envelope extractor, the settings store, the guide store, the
 * toast store, and the mocked transports in one chain.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, act, waitFor } from "@testing-library/react";

import { resetAllStores } from "../helpers/store-reset";
import { useSpecWriterActions } from "../../hooks/useSpecWriterActions";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useGuideStore } from "../../stores/guideStore";
import { useToastStore } from "../../stores/toastStore";

// ── Mocks ────────────────────────────────────────────────────────────

// Invoke is configured per-test via configureInvoke() below.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

// The in-band CLI recovery transport, exposed by the router. Hoisted so each
// test can drive what the live CLI session "returns" for a recovery turn.
const routerMocks = vi.hoisted(() => ({
  recoverGuideViaCli: vi.fn<(projectPath: string, prompt: string) => Promise<string>>(),
}));

// useSpecWriterActions reaches into several conversation hooks that
// otherwise spin up CLI sessions. We don't need any of that to exercise
// the Recognize Guide flow.
vi.mock("../../hooks/useClaudeSession", () => ({
  useClaudeSession: () => ({ sendMessage: vi.fn() }),
}));
vi.mock("../../hooks/useSpecConversationRouter", () => ({
  useSpecConversationRouter: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
    requestRecheck: vi.fn().mockReturnValue(true),
    recoverGuideViaCli: routerMocks.recoverGuideViaCli,
  }),
}));
vi.mock("../../hooks/useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
    loadContext: vi.fn(),
  }),
}));
vi.mock("../../hooks/useSpecConversationClaude", () => ({
  useSpecConversationClaude: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
    loadContext: vi.fn(),
    changeModel: vi.fn(),
  }),
}));
// The hook calls listSpecDocuments on mount; tauri-commands needs a stub
// for every function we call directly. saveSpecDocument is delegated to
// the invokeMock above (it lives behind invoke under the hood).
vi.mock("../../lib/tauri-commands", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri-commands")>(
    "../../lib/tauri-commands",
  );
  return {
    ...actual,
    listSpecDocuments: vi.fn().mockResolvedValue([]),
    gatherSpecContext: vi.fn().mockResolvedValue("context"),
    saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
    addVerificationWorkflowToClaudeMd: vi.fn().mockResolvedValue("added"),
    loadTaskBoardState: vi.fn().mockResolvedValue(null),
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────

const FIXTURE_PATH = resolve(
  __dirname,
  "../../lib/__fixtures__/webcreator-v2-spec.md",
);
const BROKEN_SPEC = readFileSync(FIXTURE_PATH, "utf8");
const SAVED_FILENAME = "webcreator-lead-discovery-and-extended-research-v2.md";
const PROJECT_PATH = "/tmp/test-project-recovery";

// A "recovered" version of the broken spec: insert a synthesized
// `**Prompt for Claude Code:**` block into Session 1. We re-use the
// fixture's own surrounding context — the helper finds the
// `**Foundation justification:**` line in Session 1 and inserts a prompt
// block immediately after it, before the `**Verification Prompt:**`
// block. This is the SAME transformation a well-behaved repair model
// would perform.
function buildRecoveredFixture(): string {
  const insertAfter =
    "**Foundation justification:** Schema files written but not deployed; no UI, no runtime change.";
  const promptBlock = `

**Prompt for Claude Code:**
\`\`\`
Read docs/specs/${SAVED_FILENAME} — ONLY: §2 Data Model, §9 Phase A.

Author migrations 051 + 052 and update database-types.ts.

Files:
- supabase/migrations/051_lead_discovery_and_extended_research.sql (create)
- supabase/migrations/052_seed_research_assessment_prompt.sql (create)
- packages/db/src/database-types.ts (modify)

Scope = deliverables, not file fences (fix upstream when required, no silent workarounds).
\`\`\``;
  if (!BROKEN_SPEC.includes(insertAfter)) {
    throw new Error(
      "Fixture drift — buildRecoveredFixture expected to find Session 1's foundation-justification line",
    );
  }
  return BROKEN_SPEC.replace(insertAfter, insertAfter + promptBlock);
}

const RECOVERED_SPEC = buildRecoveredFixture();

// ── Setup ────────────────────────────────────────────────────────────

function primeStores(opts: {
  provider?: string;
  model?: string;
  apiKey?: string;
} = {}): void {
  const provider = opts.provider ?? "anthropic";
  const model = opts.model ?? "claude-opus-4-8";

  useSessionStore.setState({
    activeProjectPath: PROJECT_PATH,
    activeSessionId: "session-1",
  });

  useSpecWriterStore.setState({
    conversations: new Map([
      [
        PROJECT_PATH,
        {
          id: "conv-1",
          project_path: PROJECT_PATH,
          messages: [],
          ai_provider: provider,
          ai_model: model,
          status: "done",
          mode: "feature",
          context_loaded: true,
        },
      ],
    ]),
    uiState: new Map([
      [
        PROJECT_PATH,
        {
          is_open: true,
          chat_width: 50,
          current_spec_content: null,
          selected_saved_spec: SAVED_FILENAME,
        },
      ],
    ]),
    currentSpecContent: new Map([[PROJECT_PATH, BROKEN_SPEC]]),
    currentAuditContent: new Map(),
    planningStreaming: new Map(),
    savedSpecs: new Map(),
    projectContext: new Map(),
    draftText: new Map(),
    draftAttachments: new Map(),
  });

  if (opts.apiKey !== undefined) {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        apiKeys: { [provider]: opts.apiKey },
      },
    });
  }
}

beforeEach(() => {
  invokeMock.mockReset();
  routerMocks.recoverGuideViaCli.mockReset();
  resetAllStores();
});

// A structured JSON envelope the live CLI session would return for an in-band
// recovery turn — the regex-free path. Mirrors GUIDE_RECOVERY_MARKER.
function envelopeReply(): string {
  const obj = {
    title: "WebCreator Lead Discovery",
    sessions: Array.from({ length: 12 }, (_, i) => ({
      title: `Session ${i + 1}`,
      prompt: `Implement part ${i + 1} per the spec.`,
      files: [`src/part${i + 1}.ts`],
    })),
  };
  return `<!-- SESSION-PLAN-JSON -->\n${JSON.stringify(obj)}`;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("handleRecognizeGuide — AI recovery path (webcreator-v2 fixture)", () => {
  it("recovers via the configured provider and creates the guide", async () => {
    primeStores({ provider: "anthropic", apiKey: "sk-test-key" });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "recover_session_plan") {
        return Promise.resolve({
          recoveredMarkdown: RECOVERED_SPEC,
          provider: "anthropic",
          model: "claude-opus-4-8",
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleRecognizeGuide();
    });

    // 1. The recovery command was called with the broken markdown and
    //    the user's configured provider/key/model.
    const recoveryCall = invokeMock.mock.calls.find(
      (c) => c[0] === "recover_session_plan",
    );
    expect(recoveryCall).toBeDefined();
    const args = recoveryCall![1] as {
      specMarkdown: string;
      diagnosis: string;
      provider: string;
      apiKey: string;
      model: string;
      filename: string;
    };
    expect(args.provider).toBe("anthropic");
    expect(args.apiKey).toBe("sk-test-key");
    expect(args.model).toBe("claude-opus-4-8");
    expect(args.filename).toBe(SAVED_FILENAME);
    expect(args.diagnosis).toMatch(/Session 1/);

    // 2. The guide was created with the recovered session count.
    await waitFor(() => {
      const guide = useGuideStore.getState().guide;
      expect(guide).not.toBeNull();
    });
    const guide = useGuideStore.getState().guide!;
    expect(guide.specFilename).toBe(SAVED_FILENAME);
    // 13 declared sessions; Session 4 is a wrapper for 4a/4b and Session 13
    // ends with a Verify (full audit) wrap-up. The exact count depends on
    // the recovered structure, but recovery must produce at least the
    // foundation sessions (1-3) plus all user-visible ones.
    expect(guide.sessions.length).toBeGreaterThanOrEqual(10);

    // 3. A WARNING toast was shown (not red) with a Save action button.
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("warning");
    expect(toasts[0].message).toMatch(/auto-recovered/i);
    expect(toasts[0].message).toMatch(/anthropic/);
    expect(toasts[0].action).toBeDefined();
    expect(toasts[0].action?.label).toBe("Save corrected version");
  });

  it("clicking the Save action writes the recovered markdown back via save_spec_document", async () => {
    primeStores({ provider: "anthropic", apiKey: "sk-test-key" });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "recover_session_plan") {
        return Promise.resolve({
          recoveredMarkdown: RECOVERED_SPEC,
          provider: "anthropic",
          model: "claude-opus-4-8",
        });
      }
      if (cmd === "save_spec_document") {
        return Promise.resolve(SAVED_FILENAME);
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleRecognizeGuide();
    });

    const initialToast = useToastStore.getState().toasts[0];
    expect(initialToast.action).toBeDefined();

    // Fire the save button. The handler is fire-and-forget — it returns
    // void synchronously, so we wait for the follow-up toast to confirm
    // the disk write actually happened.
    await act(async () => {
      initialToast.action!.onClick();
    });

    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find(
        (c) => c[0] === "save_spec_document",
      );
      expect(saveCall).toBeDefined();
      const saveArgs = saveCall![1] as {
        projectPath: string;
        filename: string;
        content: string;
        overwrite: boolean;
      };
      expect(saveArgs.projectPath).toBe(PROJECT_PATH);
      expect(saveArgs.filename).toBe(SAVED_FILENAME);
      expect(saveArgs.overwrite).toBe(true);
      expect(saveArgs.content).toBe(RECOVERED_SPEC);
    });

    // The follow-up success toast confirms the write completed.
    await waitFor(() => {
      const messages = useToastStore.getState().toasts.map((t) => t.message);
      expect(messages.some((m) => /Saved corrected version/.test(m))).toBe(true);
    });
  });

  it("recovers IN-BAND via the live CLI session when the provider is claude-code (no API key)", async () => {
    primeStores({ provider: "claude-code", apiKey: "" });
    // The CLI path must NOT touch the API recovery command, and must NOT
    // dead-end asking for an API key — it asks the running agent instead.
    routerMocks.recoverGuideViaCli.mockResolvedValue(envelopeReply());

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleRecognizeGuide();
    });

    // In-band transport was used; the HTTP recovery command was NOT.
    expect(routerMocks.recoverGuideViaCli).toHaveBeenCalledTimes(1);
    const [projectArg, promptArg] = routerMocks.recoverGuideViaCli.mock.calls[0];
    expect(projectArg).toBe(PROJECT_PATH);
    expect(promptArg).toMatch(/SESSION-PLAN-JSON/);
    expect(promptArg).toMatch(/Session 1/); // diagnosis is embedded
    expect(
      invokeMock.mock.calls.find((c) => c[0] === "recover_session_plan"),
    ).toBeUndefined();

    // The guide was created from the structured envelope.
    await waitFor(() => {
      expect(useGuideStore.getState().guide).not.toBeNull();
    });
    expect(useGuideStore.getState().guide!.sessions).toHaveLength(12);

    // No dead-end: the old "configure an API key" error must never appear.
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).not.toBe("error");
    expect(toasts[0].message).not.toMatch(/API provider/i);
    expect(toasts[0].message).not.toMatch(/Configure an API key/i);
    expect(toasts[0].message).toMatch(/auto-recovered/i);
  });

  it("degrades to a runnable single-session guide when the API key is empty (never dead-ends)", async () => {
    primeStores({ provider: "openai", model: "gpt-5", apiKey: "" });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleRecognizeGuide();
    });

    // With no key, the transport returns nothing — the command is never hit.
    expect(
      invokeMock.mock.calls.find((c) => c[0] === "recover_session_plan"),
    ).toBeUndefined();

    // A usable degraded guide is created instead of a red error.
    await waitFor(() => {
      expect(useGuideStore.getState().guide).not.toBeNull();
    });
    expect(useGuideStore.getState().guide!.sessions).toHaveLength(1);

    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].type).not.toBe("error");
    expect(toasts[0].message).toMatch(/single-session guide/i);
  });

  it("degrades to a single-session guide when the AI response still does not parse", async () => {
    primeStores({ provider: "anthropic", apiKey: "sk-test-key" });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "recover_session_plan") {
        // The model returned text, but didn't actually fix Session 1.
        return Promise.resolve({
          recoveredMarkdown: BROKEN_SPEC,
          provider: "anthropic",
          model: "claude-opus-4-8",
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleRecognizeGuide();
    });

    // Never a red error, never a null guide — a runnable guide is produced.
    await waitFor(() => {
      expect(useGuideStore.getState().guide).not.toBeNull();
    });
    expect(useGuideStore.getState().guide!.sessions).toHaveLength(1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].type).not.toBe("error");
    expect(toasts[0].message).toMatch(/single-session guide/i);
  });

  it("degrades (not dead-ends) when even the in-band CLI recovery comes back empty", async () => {
    primeStores({ provider: "claude-code", apiKey: "" });
    routerMocks.recoverGuideViaCli.mockResolvedValue(""); // model produced nothing

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleRecognizeGuide();
    });

    expect(routerMocks.recoverGuideViaCli).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(useGuideStore.getState().guide).not.toBeNull();
    });
    expect(useGuideStore.getState().guide!.sessions).toHaveLength(1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].type).not.toBe("error");
    expect(toasts[0].message).toMatch(/single-session guide/i);
  });
});
