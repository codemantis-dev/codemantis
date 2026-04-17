import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session } from "../../types/session";

// Mock tauri-commands so dynamic imports resolve
vi.mock("../tauri-commands", () => ({
  readFileContent: vi.fn(() => Promise.resolve("")),
  syncSessionMode: vi.fn(() => Promise.resolve()),
}));

import {
  handleActivityEvent,
  preEditContentCache,
  turnToolCallCount,
  modeControlToolIds,
} from "./activity";

const SESSION_ID = "test-session-1";

const TEST_SESSION: Session = {
  id: SESSION_ID,
  name: "Test Session",
  project_path: "/tmp/test-project",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "claude-sonnet-4-20250514",
  icon_index: 0,
};

function resetStores(): void {
  useSessionStore.setState({
    sessions: new Map([[SESSION_ID, TEST_SESSION]]),
    activeSessionId: SESSION_ID,
    sessionMessages: new Map([[SESSION_ID, []]]),
    sessionStreaming: new Map([
      [SESSION_ID, { isStreaming: true, streamingContent: "", currentMessageId: "msg-123" }],
    ]),
    sessionContext: new Map([[SESSION_ID, { used: 0, max: 1000000 }]]),
    sessionStats: new Map([
      [
        SESSION_ID,
        {
          totalCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          turnCount: 0,
          apiCallCount: 0,
        },
      ],
    ]),
    sessionModes: new Map([[SESSION_ID, "normal"]]),
    sessionBusy: new Map([[SESSION_ID, false]]),
    sessionEffort: new Map([[SESSION_ID, "high"]]),
    sessionRetry: new Map(),
    lastEventTimestamp: new Map(),
    contextToastFired: new Map(),
    sessionActivity: new Map(),
    sessionCompacting: new Map(),
    busySince: new Map(),
    rateLimitUtilization: new Map(),
    sessionCapabilities: new Map(),
    activeSubAgents: new Map(),
    sessionThinking: new Map(),
    tabOrder: [SESSION_ID],
    activeProjectPath: "/tmp/test-project",
    projectOrder: ["/tmp/test-project"],
    projectActiveSession: new Map([["/tmp/test-project", SESSION_ID]]),
  });

  useActivityStore.setState({
    sessionEntries: new Map([[SESSION_ID, []]]),
    sessionQuestions: new Map(),
    alwaysAllowedTools: new Map(),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
  });

  useUiStore.setState({
    showPlanCompleteModal: false,
    planCompleteSessionId: null,
    planCompleteFilePath: null,
    planCompleteContent: null,
    pendingPlanSessionId: null,
    fileTreeRefreshTrigger: 0,
    rightTab: "activity",
  });

  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      autoOpenFiles: false,
    },
  });

  // Clear module-level state
  preEditContentCache.clear();
  turnToolCallCount.clear();
  modeControlToolIds.clear();
}

describe("activity event handler", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────
  // handleToolUseStart
  // ─────────────────────────────────────────────────────
  describe("handleToolUseStart", () => {
    it("creates ActivityEntry with running status for Read tool", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-1",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test-project/src/main.rs" },
      });

      const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
      expect(entries).toHaveLength(1);
      expect(entries[0].toolName).toBe("Read");
      expect(entries[0].toolUseId).toBe("tu-1");
      expect(entries[0].status).toBe("running");
      expect(entries[0].sessionId).toBe(SESSION_ID);
      expect(entries[0].messageId).toBe("msg-123");
      expect(entries[0].isError).toBe(false);
    });

    it("increments turnToolCallCount for session", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-1",
        tool_name: "Read",
        tool_input: {},
      });

      expect(turnToolCallCount.get(SESSION_ID)).toBe(1);

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-2",
        tool_name: "Grep",
        tool_input: {},
      });

      expect(turnToolCallCount.get(SESSION_ID)).toBe(2);
    });

    it("caches pre-edit content for Write tool", async () => {
      const { readFileContent } = await import("../tauri-commands");
      vi.mocked(readFileContent).mockResolvedValue("old content");

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-1",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/test-project/src/foo.ts" },
      });

      // Wait for async dynamic import + readFileContent to resolve
      await vi.waitFor(() => {
        expect(preEditContentCache.get("tu-write-1")).toBe("old content");
      });
    });

    it("caches pre-edit content for Edit tool", async () => {
      const { readFileContent } = await import("../tauri-commands");
      vi.mocked(readFileContent).mockResolvedValue("existing content");

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-edit-1",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/test-project/src/bar.ts" },
      });

      await vi.waitFor(() => {
        expect(preEditContentCache.get("tu-edit-1")).toBe("existing content");
      });
    });

    it("sets empty string in cache when file does not exist", async () => {
      const { readFileContent } = await import("../tauri-commands");
      vi.mocked(readFileContent).mockRejectedValue(new Error("File not found"));

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-new",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/test-project/src/new-file.ts" },
      });

      await vi.waitFor(() => {
        expect(preEditContentCache.get("tu-write-new")).toBe("");
      });
    });

    it("sets session activity label from toolActivityLabel", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-1",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test-project/src/main.rs" },
      });

      const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
      expect(activity?.label).toBe("Reading file...");
      expect(activity?.toolName).toBe("Read");
      expect(activity?.filePath).toBe("/tmp/test-project/src/main.rs");
    });

    it("sets ensureBusy on session", () => {
      // Session starts not busy
      expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(false);

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-1",
        tool_name: "Grep",
        tool_input: {},
      });

      expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);
    });

    it("detects ExitPlanMode tool and shows PlanCompleteModal for active session", async () => {
      // Put session in plan mode
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-exit-plan",
        tool_name: "ExitPlanMode",
        tool_input: {},
      });

      // Session mode should be set to normal
      expect(useSessionStore.getState().sessionModes.get(SESSION_ID)).toBe("normal");

      // PlanCompleteModal should be shown AND pending state set so the
      // banner can reopen the modal after a Later/Reveal dismiss.
      const uiState = useUiStore.getState();
      expect(uiState.showPlanCompleteModal).toBe(true);
      expect(uiState.planCompleteSessionId).toBe(SESSION_ID);
      expect(uiState.pendingPlanSessionId).toBe(SESSION_ID);

      // syncSessionMode should have been called via dynamic import
      const { syncSessionMode } = await import("../tauri-commands");
      await vi.waitFor(() => {
        expect(syncSessionMode).toHaveBeenCalledWith(SESSION_ID, "normal");
      });
    });

    it("reads planFilePath and plan directly from ExitPlanMode input when present", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      const directPath = "/tmp/elsewhere/my-plan.md";
      const directContent = "## Context\nA tiny plan body.\n";

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-exit-plan-direct",
        tool_name: "ExitPlanMode",
        tool_input: {
          plan: directContent,
          planFilePath: directPath,
        },
      });

      const uiState = useUiStore.getState();
      expect(uiState.planCompleteFilePath).toBe(directPath);
      expect(uiState.planCompleteContent).toBe(directContent);
      expect(uiState.showPlanCompleteModal).toBe(true);
    });

    it("direct planFilePath wins over a previously-observed Write path", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });
      // Simulate the Write observer having captured a different path earlier.
      useUiStore.getState().setPlanCompleteFilePath(
        "/Users/hr/.claude/plans/old-observed-plan.md",
      );

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-exit-plan-override",
        tool_name: "ExitPlanMode",
        tool_input: {
          plan: "body",
          planFilePath: "/Users/hr/.claude/plans/new-direct-plan.md",
        },
      });

      expect(useUiStore.getState().planCompleteFilePath).toBe(
        "/Users/hr/.claude/plans/new-direct-plan.md",
      );
    });

    it("falls back to Write-path observer when ExitPlanMode input has no direct fields", async () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });
      // Simulate older CLI: Write observer set the path earlier, ExitPlanMode
      // input is empty (no plan / planFilePath fields).
      useUiStore.getState().setPlanCompleteFilePath(
        "/Users/hr/.claude/plans/observed.md",
      );

      const { readFileContent } = await import("../tauri-commands");
      vi.mocked(readFileContent).mockResolvedValue("## Observed content");

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-exit-plan-fallback",
        tool_name: "ExitPlanMode",
        tool_input: {},
      });

      // Fallback path preserved; no direct content set.
      expect(useUiStore.getState().planCompleteFilePath).toBe(
        "/Users/hr/.claude/plans/observed.md",
      );
      expect(useUiStore.getState().planCompleteContent).toBeNull();
    });

    it("skips ExitPlanMode from activity feed", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-exit-plan-2",
        tool_name: "ExitPlanMode",
        tool_input: {},
      });

      const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
      expect(entries).toHaveLength(0);
      // Confirm the tool ID was registered for mode-control skipping
      expect(modeControlToolIds.has("tu-exit-plan-2")).toBe(true);
    });

    it("tracks sub-agent for Agent tool", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-agent-1",
        tool_name: "Agent",
        tool_input: {
          description: "Refactor the database module",
          subagent_type: "code-review",
          run_in_background: false,
        },
      });

      const agents = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
      expect(agents).toHaveLength(1);
      expect(agents![0].toolUseId).toBe("tu-agent-1");
      expect(agents![0].description).toBe("Refactor the database module");
      expect(agents![0].subagentType).toBe("code-review");
      expect(agents![0].status).toBe("running");
    });
  });

  // ─────────────────────────────────────────────────────
  // handleToolResult
  // ─────────────────────────────────────────────────────
  describe("handleToolResult", () => {
    it("updates entry status to done on success", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-r1",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test-project/src/main.rs" },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-r1",
        content: "186 lines read",
        is_error: false,
      });

      const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
      expect(entry.status).toBe("done");
      expect(entry.result).toBe("186 lines read");
      expect(entry.isError).toBe(false);
    });

    it("updates entry status to error on is_error", () => {
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-bash-err",
        tool_name: "Bash",
        tool_input: { command: "exit 1" },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-bash-err",
        content: "command not found",
        is_error: true,
      });

      const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
      expect(entry.status).toBe("error");
      expect(entry.isError).toBe(true);
      expect(entry.result).toBe("command not found");
    });

    it("skips mode-control tool results", () => {
      // Register a mode-control tool ID (simulates ExitPlanMode having been handled)
      modeControlToolIds.add("tu-mode-ctrl");

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-mode-ctrl",
        content: "mode changed",
        is_error: false,
      });

      // The mode-control ID should have been cleaned up
      expect(modeControlToolIds.has("tu-mode-ctrl")).toBe(false);

      // No entries should have been updated (none exist, and no crash)
      const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
      expect(entries).toHaveLength(0);
    });

    it("triggers file tree refresh for mutating tool success", () => {
      const initialTrigger = useUiStore.getState().fileTreeRefreshTrigger;

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-mut",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/test-project/src/out.ts" },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-mut",
        content: "Written successfully",
        is_error: false,
      });

      expect(useUiStore.getState().fileTreeRefreshTrigger).toBeGreaterThan(initialTrigger);
    });

    it("does NOT trigger file tree refresh for non-mutating tool", () => {
      const initialTrigger = useUiStore.getState().fileTreeRefreshTrigger;

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-read-nm",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test-project/src/main.rs" },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-read-nm",
        content: "file content here",
        is_error: false,
      });

      expect(useUiStore.getState().fileTreeRefreshTrigger).toBe(initialTrigger);
    });

    it("auto-opens file in fileViewerStore when autoOpenFiles enabled", async () => {
      const { readFileContent } = await import("../tauri-commands");
      vi.mocked(readFileContent).mockResolvedValue("new file content");

      useSettingsStore.setState({
        settings: {
          ...useSettingsStore.getState().settings,
          autoOpenFiles: true,
        },
      });

      vi.spyOn(useFileViewerStore.getState(), "openFile");

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-auto",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/test-project/src/auto.ts" },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-auto",
        content: "Written",
        is_error: false,
      });

      await vi.waitFor(() => {
        // openFile is called on the store instance obtained inside the handler,
        // so we check the store state for the opened file instead
        const openFiles = useFileViewerStore.getState().projectOpenFiles.get("/tmp/test-project");
        expect(openFiles).toBeDefined();
        expect(openFiles!.some((f) => f.filePath === "/tmp/test-project/src/auto.ts")).toBe(true);
      });
    });

    it("does NOT auto-open file when autoOpenFiles disabled", async () => {
      const { readFileContent } = await import("../tauri-commands");
      vi.mocked(readFileContent).mockResolvedValue("content");

      // autoOpenFiles is false by default from resetStores
      expect(useSettingsStore.getState().settings.autoOpenFiles).toBe(false);

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-no-auto",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/test-project/src/no-auto.ts" },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-no-auto",
        content: "Written",
        is_error: false,
      });

      // Give time for any async operations to complete
      await new Promise((r) => setTimeout(r, 50));

      const openFiles = useFileViewerStore.getState().projectOpenFiles.get("/tmp/test-project");
      const hasFile = openFiles?.some((f) => f.filePath === "/tmp/test-project/src/no-auto.ts");
      expect(hasFile ?? false).toBe(false);
    });

    it("creates diff view with cached pre-edit content", async () => {
      const { readFileContent } = await import("../tauri-commands");

      // First call (tool_use_start caching) returns old content,
      // second call (tool_result auto-open) returns new content.
      vi.mocked(readFileContent)
        .mockResolvedValueOnce("original content")
        .mockResolvedValueOnce("modified content");

      useSettingsStore.setState({
        settings: {
          ...useSettingsStore.getState().settings,
          autoOpenFiles: true,
        },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-edit-diff",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/test-project/src/diff-test.ts" },
      });

      // Wait for pre-edit cache to be populated
      await vi.waitFor(() => {
        expect(preEditContentCache.get("tu-edit-diff")).toBe("original content");
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-edit-diff",
        content: "Edit applied",
        is_error: false,
      });

      await vi.waitFor(() => {
        const openFiles = useFileViewerStore.getState().projectOpenFiles.get("/tmp/test-project");
        expect(openFiles).toBeDefined();
        const diffTab = openFiles!.find((f) => f.filePath === "/tmp/test-project/src/diff-test.ts");
        expect(diffTab).toBeDefined();
        expect(diffTab!.isDiff).toBe(true);
        expect(diffTab!.oldContent).toBe("original content");
        expect(diffTab!.newContent).toBe("modified content");
      });
    });

    it("cleans up preEditContentCache after completion", async () => {
      preEditContentCache.set("tu-cleanup", "old content");

      // Need readFileContent for the auto-open path (but autoOpenFiles is disabled,
      // so cleanup happens regardless)
      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-cleanup",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/test-project/src/cleanup.ts" },
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_result",
        session_id: SESSION_ID,
        tool_use_id: "tu-cleanup",
        content: "done",
        is_error: false,
      });

      expect(preEditContentCache.has("tu-cleanup")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────
  // Other events
  // ─────────────────────────────────────────────────────
  describe("agent_preparing", () => {
    it("creates placeholder sub-agent", () => {
      handleActivityEvent(SESSION_ID, {
        type: "agent_preparing",
        session_id: SESSION_ID,
        tool_use_id: "tu-agent-prep",
      });

      const agents = useSessionStore.getState().activeSubAgents.get(SESSION_ID);
      expect(agents).toHaveLength(1);
      expect(agents![0].toolUseId).toBe("tu-agent-prep");
      expect(agents![0].description).toBe("Launching agent...");
      expect(agents![0].status).toBe("preparing");
      expect(agents![0].subagentType).toBe("general-purpose");
      expect(agents![0].isBackground).toBe(false);

      // Activity label should reflect launching
      const activity = useSessionStore.getState().sessionActivity.get(SESSION_ID);
      expect(activity?.label).toBe("Launching agent...");
      expect(activity?.toolName).toBe("Agent");
    });
  });

  describe("plan file path tracking", () => {
    it("tracks plan file path when Write targets .claude/plans/*.md in plan mode", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-plan",
        tool_name: "Write",
        tool_input: {
          file_path: "/Users/hr/.claude/plans/jazzy-prancing-wilkes.md",
          content: "# Plan\n\nSome plan content",
        },
      });

      expect(useUiStore.getState().planCompleteFilePath).toBe(
        "/Users/hr/.claude/plans/jazzy-prancing-wilkes.md"
      );
    });

    it("does not track plan file path for Write in normal mode", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "normal"]]),
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-normal",
        tool_name: "Write",
        tool_input: {
          file_path: "/Users/hr/.claude/plans/some-plan.md",
          content: "# Plan",
        },
      });

      expect(useUiStore.getState().planCompleteFilePath).toBeNull();
    });

    it("does not track non-plan file paths in plan mode", () => {
      useSessionStore.setState({
        sessionModes: new Map([[SESSION_ID, "plan"]]),
      });

      handleActivityEvent(SESSION_ID, {
        type: "tool_use_start",
        session_id: SESSION_ID,
        tool_use_id: "tu-write-other",
        tool_name: "Write",
        tool_input: {
          file_path: "/Users/hr/project/src/main.ts",
          content: "const x = 1;",
        },
      });

      expect(useUiStore.getState().planCompleteFilePath).toBeNull();
    });
  });
});
