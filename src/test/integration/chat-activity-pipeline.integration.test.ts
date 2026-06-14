/**
 * Integration test: Chat-Activity Event Pipeline
 *
 * Tests the CRITICAL PATH: CLI events flow through the real event pipeline
 * (event-classifier -> event-handlers -> real Zustand stores).
 *
 * Unlike unit tests which mock stores, these use REAL stores to catch
 * integration bugs at the seams. Only the Tauri IPC boundary is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import { simulateEventStream } from "../helpers/event-simulator";
import {
  createTextDeltaEvent,
  createTextCompleteEvent,
  createTurnCompleteEvent,
  createToolUseStartEvent,
  createToolResultEvent,
  createProcessErrorEvent,
  createProcessExitedEvent,
  createSessionInitEvent,
  createCompactingStatusEvent,
  createModelChangedEvent,
  createUsageUpdateEvent,
  createAgentPreparingEvent,
  createSubAgentStartedEvent,
  createSubAgentCompleteEvent,
  createSimpleTurnSequence,
  TEST_SESSION_ID,
} from "../helpers/event-fixtures";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { flushStreamingBuffer } from "../../lib/event-handlers/chat";
import type { Session } from "../../types/session";

// Mock ONLY the Tauri IPC boundary
vi.mock("../../lib/tauri-commands", () => ({
  readFileContent: vi.fn().mockResolvedValue(""),
  syncSessionMode: vi.fn().mockResolvedValue(undefined),
  generateChangelogEntry: vi.fn().mockResolvedValue({}),
  checkProcessAlive: vi.fn().mockResolvedValue(true),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock toastStore for toast assertions
vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

import { showToast } from "../../stores/toastStore";

const SID = TEST_SESSION_ID;

const TEST_SESSION: Session = {
  id: SID,
  name: "Test Session",
  project_path: "/tmp/test-project",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "claude-sonnet-4-20250514",
  icon_index: 0,
};

function setupSession(): void {
  // Ensure settings are loaded before addSession (it reads defaultContextWindow)
  useSettingsStore.setState({
    settings: {
      theme: "sand" as const,
      fontSize: 13,
      sendShortcut: "enter" as const,
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: {},
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini" as const,
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "claude-code" as const,
      assistantDefaultModel: {},
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      previewConsoleAutoOpen: true,
      previewLastUrls: {},
      taskBoardPlanningModel: "gemini-3.5-flash",
      taskBoardMaxTokens: 64000,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
      triviaEnabled: false,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      claudeBinaryOverride: null,
      onboardingCompleted: false,
      apiKeyBannerDismissed: false,
      lastCloneDirectory: null,
      sessionLogsEnabled: false,
      codexDebugLoggingEnabled: true,
      sessionLogsRetentionDays: 30,
      superBroEnabled: false,
      superBroProvider: "auto" as const,
      superBroModel: "auto",
      selfDriveProvider: "anthropic" as const,
      selfDriveModel: "claude-haiku-4-5",
      selfDriveMaxFixAttempts: 3,
      selfDriveRunBuildCheck: true,
      selfDriveRunTests: true,
      selfDriveAutoCommit: false,
      selfDriveEnableRecheckLoop: true,
      selfDriveConfirmCapabilities: true,
      defaultThinkingEffort: null,
      defaultAgentByTask: {},
      secondOpinionPrivacyAcknowledged: false,
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });

  // Use the real addSession to bootstrap all session maps correctly
  useSessionStore.getState().addSession(TEST_SESSION);
}

describe("Chat-Activity Event Pipeline (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSession();
  });

  // ─── Simple turn lifecycle ───────────────────────────────────────────

  describe("Simple turn lifecycle", () => {
    it("text_delta events create streaming message and set busy", () => {
      simulateEventStream(SID, [
        createTextDeltaEvent("Hello, ", SID),
        createTextDeltaEvent("world!", SID),
      ]);
      // Flush the streaming buffer (no rAF in test env, but be explicit)
      flushStreamingBuffer(SID);

      const streaming = useSessionStore.getState().sessionStreaming.get(SID);
      expect(streaming?.isStreaming).toBe(true);

      const busy = useSessionStore.getState().sessionBusy.get(SID);
      expect(busy).toBe(true);

      const messages = useSessionStore.getState().sessionMessages.get(SID) ?? [];
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].isStreaming).toBe(true);
    });

    it("text_complete finalizes streaming message with full_text", () => {
      simulateEventStream(SID, [
        createTextDeltaEvent("Hello, ", SID),
        createTextCompleteEvent("Hello, world!", SID),
      ]);

      const messages = useSessionStore.getState().sessionMessages.get(SID) ?? [];
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("Hello, world!");
      expect(messages[0].isStreaming).toBe(false);

      const streaming = useSessionStore.getState().sessionStreaming.get(SID);
      expect(streaming?.isStreaming).toBe(false);
    });

    it("turn_complete clears busy state and sets turn stats", () => {
      simulateEventStream(SID, [
        createTextDeltaEvent("Hello", SID),
        createTextCompleteEvent("Hello", SID),
        createTurnCompleteEvent({
          session_id: SID,
          duration_ms: 3000,
          cost_usd: 0.02,
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        }),
      ]);

      const busy = useSessionStore.getState().sessionBusy.get(SID);
      expect(busy).toBe(false);

      const messages = useSessionStore.getState().sessionMessages.get(SID) ?? [];
      expect(messages.length).toBe(1);
      expect(messages[0].turnStats).toBeDefined();
      expect(messages[0].turnStats?.durationMs).toBe(3000);
      expect(messages[0].turnStats?.costUsd).toBe(0.02);
    });

    it("full simple turn: delta -> complete -> turn_complete", () => {
      simulateEventStream(SID, createSimpleTurnSequence(SID));

      const state = useSessionStore.getState();
      const messages = state.sessionMessages.get(SID) ?? [];

      // 1 assistant message, finalized
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].content).toBe("Hello, world!");
      expect(messages[0].isStreaming).toBe(false);

      // Not busy
      expect(state.sessionBusy.get(SID)).toBe(false);

      // Turn stats present
      expect(messages[0].turnStats).toBeDefined();

      // Context updated
      const ctx = state.sessionContext.get(SID);
      expect(ctx).toBeDefined();
      expect(ctx!.used).toBeGreaterThan(0);
    });
  });

  // ─── Tool use turn ──────────────────────────────────────────────────

  describe("Tool use turn", () => {
    it("tool_use_start creates activity entry in activityStore", () => {
      const toolId = "tool-write-1";
      simulateEventStream(SID, [
        createTextDeltaEvent("Let me write that.", SID),
        createTextCompleteEvent("Let me write that.", SID),
        createToolUseStartEvent("Write", { file_path: "src/main.ts", content: "export {}" }, {
          session_id: SID,
          tool_use_id: toolId,
        }),
      ]);

      const entries = useActivityStore.getState().getActiveEntries(SID);
      expect(entries.length).toBe(1);
      expect(entries[0].toolName).toBe("Write");
      expect(entries[0].status).toBe("running");
      expect(entries[0].toolUseId).toBe(toolId);
    });

    it("tool_result updates activity entry status to done", () => {
      const toolId = "tool-read-1";
      simulateEventStream(SID, [
        createToolUseStartEvent("Read", { file_path: "src/app.ts" }, {
          session_id: SID,
          tool_use_id: toolId,
        }),
        createToolResultEvent(toolId, "file content here", false, SID),
      ]);

      const entries = useActivityStore.getState().getActiveEntries(SID);
      expect(entries.length).toBe(1);
      expect(entries[0].status).toBe("done");
      expect(entries[0].isError).toBe(false);
    });

    it("tool_result with is_error sets entry status to error", () => {
      const toolId = "tool-bash-fail";
      simulateEventStream(SID, [
        createToolUseStartEvent("Bash", { command: "rm -rf /" }, {
          session_id: SID,
          tool_use_id: toolId,
        }),
        createToolResultEvent(toolId, "Permission denied", true, SID),
      ]);

      const entries = useActivityStore.getState().getActiveEntries(SID);
      expect(entries.length).toBe(1);
      expect(entries[0].status).toBe("error");
      expect(entries[0].isError).toBe(true);
    });

    it("mutating tool triggers file tree refresh in uiStore", () => {
      const toolId = "tool-write-refresh";
      const initialTrigger = useUiStore.getState().fileTreeRefreshTrigger;

      simulateEventStream(SID, [
        createToolUseStartEvent("Write", { file_path: "src/new.ts", content: "// new" }, {
          session_id: SID,
          tool_use_id: toolId,
        }),
        createToolResultEvent(toolId, "File written successfully", false, SID),
      ]);

      expect(useUiStore.getState().fileTreeRefreshTrigger).toBe(initialTrigger + 1);
    });

    it("non-mutating tool does NOT trigger file tree refresh", () => {
      const toolId = "tool-read-no-refresh";
      const initialTrigger = useUiStore.getState().fileTreeRefreshTrigger;

      simulateEventStream(SID, [
        createToolUseStartEvent("Read", { file_path: "src/app.ts" }, {
          session_id: SID,
          tool_use_id: toolId,
        }),
        createToolResultEvent(toolId, "file contents", false, SID),
      ]);

      expect(useUiStore.getState().fileTreeRefreshTrigger).toBe(initialTrigger);
    });
  });

  // ─── Context tracking ───────────────────────────────────────────────

  describe("Context tracking", () => {
    it("turn_complete updates context from usage tokens", () => {
      simulateEventStream(SID, [
        createTextDeltaEvent("Reply", SID),
        createTextCompleteEvent("Reply", SID),
        createTurnCompleteEvent({
          session_id: SID,
          usage: {
            input_tokens: 8000,
            output_tokens: 2000,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
          context_window: 200000,
        }),
      ]);

      const ctx = useSessionStore.getState().sessionContext.get(SID);
      expect(ctx).toBeDefined();
      expect(ctx!.used).toBeGreaterThan(0);
      expect(ctx!.max).toBeGreaterThanOrEqual(200000);
    });

    it("usage_update events accumulate tokens incrementally", () => {
      simulateEventStream(SID, [
        createTextDeltaEvent("Working...", SID),
        createUsageUpdateEvent(
          {
            input_tokens: 3000,
            output_tokens: 1000,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
          SID
        ),
        createUsageUpdateEvent(
          {
            input_tokens: 5000,
            output_tokens: 2000,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
          SID
        ),
        createTextCompleteEvent("Working...", SID),
        createTurnCompleteEvent({
          session_id: SID,
          usage: {
            input_tokens: 8000,
            output_tokens: 3000,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        }),
      ]);

      const stats = useSessionStore.getState().sessionStats.get(SID);
      expect(stats).toBeDefined();
      // Two usage_update events should have accumulated
      // input: 3000 + 5000 = 8000, output: 1000 + 2000 = 3000
      expect(stats!.totalInputTokens).toBe(8000);
      expect(stats!.totalOutputTokens).toBe(3000);

      // Context should reflect the latest usage_update (the largest single API call)
      const ctx = useSessionStore.getState().sessionContext.get(SID);
      expect(ctx).toBeDefined();
      expect(ctx!.used).toBe(5000 + 2000); // latest usage_update: input + output
    });
  });

  // ─── Error handling ─────────────────────────────────────────────────

  describe("Error handling", () => {
    it("process_error finalizes streaming and adds error message", () => {
      simulateEventStream(SID, [
        createTextDeltaEvent("I will help with", SID),
        createProcessErrorEvent("Connection lost", SID),
      ]);

      const state = useSessionStore.getState();

      // Streaming should be finalized
      const streaming = state.sessionStreaming.get(SID);
      expect(streaming?.isStreaming).toBe(false);

      // Busy should be cleared
      expect(state.sessionBusy.get(SID)).toBe(false);

      // Should have 2 messages: the finalized streaming one + the error message
      const messages = state.sessionMessages.get(SID) ?? [];
      expect(messages.length).toBe(2);
      // The error message should contain translated error content
      const errorMsg = messages[1];
      expect(errorMsg.role).toBe("assistant");
      expect(errorMsg.isStreaming).toBe(false);
    });

    it("process_exited with auth failure adds restartable message", () => {
      // First make session busy so the exited handler actually processes it
      simulateEventStream(SID, [
        createTextDeltaEvent("Starting...", SID),
      ]);

      // Now simulate process exit with auth failure
      simulateEventStream(SID, [
        createProcessExitedEvent(1, "auth token expired", SID, 2000),
      ]);

      const messages = useSessionStore.getState().sessionMessages.get(SID) ?? [];
      // Should have the streamed message + auth failure message
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.restartable).toBe(true);
      expect(lastMsg.content).toContain("Authentication");
    });
  });

  // ─── System events ──────────────────────────────────────────────────

  describe("System events", () => {
    it("session_init updates model in session", () => {
      simulateEventStream(SID, [
        createSessionInitEvent({
          session_id: SID,
          model: "claude-opus-4-20250514",
        }),
      ]);

      const session = useSessionStore.getState().sessions.get(SID);
      expect(session?.model).toBe("claude-opus-4-20250514");
    });

    it("compacting_status toggles compacting state", () => {
      simulateEventStream(SID, [
        createCompactingStatusEvent(true, SID),
      ]);
      expect(useSessionStore.getState().sessionCompacting.get(SID)).toBe(true);

      simulateEventStream(SID, [
        createCompactingStatusEvent(false, SID),
      ]);
      expect(useSessionStore.getState().sessionCompacting.get(SID)).toBe(false);
    });

    it("model_changed updates model and context", () => {
      simulateEventStream(SID, [
        createModelChangedEvent("claude-opus-4-20250514", true, SID),
      ]);

      const session = useSessionStore.getState().sessions.get(SID);
      expect(session?.model).toBe("claude-opus-4-20250514");

      const ctx = useSessionStore.getState().sessionContext.get(SID);
      expect(ctx).toBeDefined();
      expect(ctx!.max).toBeGreaterThanOrEqual(200000);

      // Should have shown a toast
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining("claude-opus-4-20250514"),
        "info",
        3000
      );
    });
  });

  // ─── Sub-agent tracking ─────────────────────────────────────────────

  describe("Sub-agent tracking", () => {
    it("agent_preparing -> tool_use_start(Agent) -> subagent_started tracks sub-agent lifecycle", () => {
      const agentToolId = "tool-agent-1";

      // Phase 1: agent_preparing creates placeholder
      simulateEventStream(SID, [
        createAgentPreparingEvent(agentToolId, SID),
      ]);

      let agents = useSessionStore.getState().activeSubAgents.get(SID) ?? [];
      expect(agents.length).toBe(1);
      expect(agents[0].toolUseId).toBe(agentToolId);
      expect(agents[0].status).toBe("preparing");

      // Phase 2: tool_use_start upgrades placeholder
      simulateEventStream(SID, [
        createToolUseStartEvent("Agent", { description: "Research API docs" }, {
          session_id: SID,
          tool_use_id: agentToolId,
        }),
      ]);

      agents = useSessionStore.getState().activeSubAgents.get(SID) ?? [];
      expect(agents.length).toBe(1);
      expect(agents[0].status).toBe("running");
      expect(agents[0].description).toBe("Research API docs");

      // Phase 3: subagent_started enriches data
      simulateEventStream(SID, [
        createSubAgentStartedEvent(agentToolId, "Research API docs", SID),
      ]);

      agents = useSessionStore.getState().activeSubAgents.get(SID) ?? [];
      expect(agents.length).toBe(1);
      expect(agents[0].description).toBe("Research API docs");
    });

    it("subagent_complete marks agent as done", () => {
      const agentToolId = "tool-agent-done";

      // Setup: create the agent
      simulateEventStream(SID, [
        createAgentPreparingEvent(agentToolId, SID),
        createToolUseStartEvent("Agent", { description: "Fix tests" }, {
          session_id: SID,
          tool_use_id: agentToolId,
        }),
      ]);

      // Mark complete via subagent_complete
      simulateEventStream(SID, [
        createSubAgentCompleteEvent(agentToolId, SID, 5, 10000),
      ]);

      const agents = useSessionStore.getState().activeSubAgents.get(SID) ?? [];
      // After subagent_complete, the agent should be marked done
      // (still in the list until tool_result removes it)
      const agent = agents.find((a) => a.toolUseId === agentToolId);
      if (agent) {
        expect(agent.status).toBe("done");
        expect(agent.toolCount).toBe(5);
        expect(agent.tokenCount).toBe(10000);
      }

      // tool_result removes it from active list
      simulateEventStream(SID, [
        createToolResultEvent(agentToolId, "Agent completed successfully", false, SID),
      ]);

      const agentsAfterResult = useSessionStore.getState().activeSubAgents.get(SID) ?? [];
      const removed = agentsAfterResult.find((a) => a.toolUseId === agentToolId);
      expect(removed).toBeUndefined();
    });
  });

  // ─── Mode control ──────────────────────────────────────────────────

  describe("Mode control", () => {
    it("ExitPlanMode tool shows PlanCompleteModal for active session", () => {
      // Ensure this session is the active one
      expect(useSessionStore.getState().activeSessionId).toBe(SID);

      const toolId = "tool-exit-plan";
      simulateEventStream(SID, [
        createToolUseStartEvent("ExitPlanMode", {}, {
          session_id: SID,
          tool_use_id: toolId,
        }),
      ]);

      const uiState = useUiStore.getState();
      expect(uiState.showPlanCompleteModal).toBe(true);
      expect(uiState.planCompleteSessionId).toBe(SID);
    });

    it("ExitPlanMode with realistic 2.1.126 tool_input captures plan content (S06 shape)", () => {
      // Real shape captured from CLI 2.1.126 harness scenario S06:
      // tool_input contains only `plan` (markdown text) — no planFilePath.
      const planMarkdown = "## Hello-World React Component\n\n1. **Create** the component\n2. **Wire** it in";
      const toolId = "toolu_015KUFYf1aDUxp42MiYsYXEg";
      simulateEventStream(SID, [
        createToolUseStartEvent(
          "ExitPlanMode",
          { plan: planMarkdown },
          { session_id: SID, tool_use_id: toolId },
        ),
      ]);

      const uiState = useUiStore.getState();
      expect(uiState.showPlanCompleteModal).toBe(true);
      expect(uiState.planCompleteSessionId).toBe(SID);
      expect(uiState.pendingPlanSessionId).toBe(SID);
      expect(uiState.planCompleteContent).toBe(planMarkdown);
      // No planFilePath in 2.1.126 input → file path stays at whatever was
      // there before (null in this fresh fixture).
      expect(uiState.planCompleteFilePath).toBeNull();
    });

    it("ExitPlanMode for INACTIVE session captures pendingPlanSessionId so banner can offer Review on return", () => {
      // Set up a second session and make IT active — ExitPlanMode then
      // arrives for the original session (the agent finished planning while
      // the user was on a different tab). Without state capture, returning
      // to the planning session would show no UI affordance and the plan
      // would be lost.
      const OTHER_SID = "test-session-other";
      useSessionStore.setState({
        sessions: new Map([
          [SID, useSessionStore.getState().sessions.get(SID)!],
          [OTHER_SID, { ...useSessionStore.getState().sessions.get(SID)!, id: OTHER_SID }],
        ]),
        activeSessionId: OTHER_SID,
      });

      const planMarkdown = "## Inactive plan\n\n1. Step";
      const toolId = "tool-exit-plan-inactive";
      simulateEventStream(SID, [
        createToolUseStartEvent(
          "ExitPlanMode",
          { plan: planMarkdown },
          { session_id: SID, tool_use_id: toolId },
        ),
      ]);

      const uiState = useUiStore.getState();
      // Modal must NOT pop up — user is looking at OTHER_SID.
      expect(uiState.showPlanCompleteModal).toBe(false);
      // BUT state must be captured so the banner shows on return.
      expect(uiState.pendingPlanSessionId).toBe(SID);
      expect(uiState.planCompleteSessionId).toBe(SID);
      expect(uiState.planCompleteContent).toBe(planMarkdown);
    });

    it("ExitPlanMode tool is excluded from activity feed", () => {
      const toolId = "tool-exit-plan-no-feed";
      simulateEventStream(SID, [
        createToolUseStartEvent("ExitPlanMode", {}, {
          session_id: SID,
          tool_use_id: toolId,
        }),
      ]);

      const entries = useActivityStore.getState().getActiveEntries(SID);
      expect(entries.length).toBe(0);
    });
  });

  // ─── Multi-turn flow ────────────────────────────────────────────────

  describe("Multi-turn flow", () => {
    it("two consecutive turns maintain correct message order", () => {
      // Turn 1
      simulateEventStream(SID, [
        createTextDeltaEvent("First response", SID),
        createTextCompleteEvent("First response", SID),
        createTurnCompleteEvent({ session_id: SID }),
      ]);

      // Turn 2
      simulateEventStream(SID, [
        createTextDeltaEvent("Second response", SID),
        createTextCompleteEvent("Second response", SID),
        createTurnCompleteEvent({ session_id: SID }),
      ]);

      const messages = useSessionStore.getState().sessionMessages.get(SID) ?? [];
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe("First response");
      expect(messages[1].content).toBe("Second response");
      expect(messages[0].role).toBe("assistant");
      expect(messages[1].role).toBe("assistant");

      // Both should have turn stats
      expect(messages[0].turnStats).toBeDefined();
      expect(messages[1].turnStats).toBeDefined();
    });

    it("tool use across turns: activity entries track per-turn", () => {
      const writeId = "tool-write-turn1";
      const readId = "tool-read-turn2";

      // Turn 1: Write
      simulateEventStream(SID, [
        createTextDeltaEvent("Writing file...", SID),
        createTextCompleteEvent("Writing file...", SID),
        createToolUseStartEvent("Write", { file_path: "src/foo.ts", content: "code" }, {
          session_id: SID,
          tool_use_id: writeId,
        }),
        createToolResultEvent(writeId, "Written", false, SID),
        createTextDeltaEvent("Done writing.", SID),
        createTextCompleteEvent("Done writing.", SID),
        createTurnCompleteEvent({ session_id: SID }),
      ]);

      // Turn 2: Read
      simulateEventStream(SID, [
        createTextDeltaEvent("Reading file...", SID),
        createTextCompleteEvent("Reading file...", SID),
        createToolUseStartEvent("Read", { file_path: "src/bar.ts" }, {
          session_id: SID,
          tool_use_id: readId,
        }),
        createToolResultEvent(readId, "content", false, SID),
        createTextDeltaEvent("Done reading.", SID),
        createTextCompleteEvent("Done reading.", SID),
        createTurnCompleteEvent({ session_id: SID }),
      ]);

      const entries = useActivityStore.getState().getActiveEntries(SID);
      expect(entries.length).toBe(2);

      const writeEntry = entries.find((e) => e.toolUseId === writeId);
      const readEntry = entries.find((e) => e.toolUseId === readId);

      expect(writeEntry).toBeDefined();
      expect(writeEntry!.toolName).toBe("Write");
      expect(writeEntry!.status).toBe("done");

      expect(readEntry).toBeDefined();
      expect(readEntry!.toolName).toBe("Read");
      expect(readEntry!.status).toBe("done");
    });
  });
});
