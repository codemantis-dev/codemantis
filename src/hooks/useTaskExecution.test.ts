import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskBoardStore } from "../stores/taskBoardStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { TaskPlan } from "../types/task-board";

// Hoist mock functions
const {
  mockCreateSession,
  mockSendMessage,
  mockCloseSession,
  mockListenChatEvents,
  mockGatherProjectSnapshot,
  mockSendAssistantChat,
  mockListenAssistantStream,
  mockInvoke,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(() => Promise.resolve({ id: "session-1", name: "Test", project_path: "/tmp/p", status: "connected", created_at: "", model: "sonnet", icon_index: 0 })),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockCloseSession: vi.fn(() => Promise.resolve()),
  mockListenChatEvents: vi.fn(() => Promise.resolve(vi.fn())),
  mockGatherProjectSnapshot: vi.fn(() => Promise.resolve("{}")),
  mockSendAssistantChat: vi.fn(() => Promise.resolve()),
  mockListenAssistantStream: vi.fn(() => Promise.resolve(vi.fn())),
  mockInvoke: vi.fn(() => Promise.resolve({ passed: true, evidence: "ok", checked_at: "2026-01-01" })),
}));

vi.mock("../lib/tauri-commands", () => ({
  createSession: mockCreateSession,
  sendMessage: mockSendMessage,
  closeSession: mockCloseSession,
  listenChatEvents: mockListenChatEvents,
  gatherProjectSnapshot: mockGatherProjectSnapshot,
  sendAssistantChat: mockSendAssistantChat,
  listenAssistantStream: mockListenAssistantStream,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { useTaskExecution } from "./useTaskExecution";

const PROJECT = "/tmp/test-project";

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    id: "plan-1",
    name: "Test Plan",
    description: "",
    template_recommendation: null,
    work_packages: [
      {
        id: "WP1",
        name: "Setup",
        tasks: [
          {
            id: "T1",
            title: "Create file",
            description: "Create the main file",
            acceptance_criteria: "File exists",
            verification_checks: [
              { type: "file_exists", path: "src/main.ts", description: "main.ts exists" },
            ],
            work_package: "WP1",
            depends_on: [],
            status: "planned",
          },
        ],
        status: "planned",
        session_id: "session-existing",
        retry_count: 0,
      },
      {
        id: "WP2",
        name: "Build",
        tasks: [
          {
            id: "T2",
            title: "Build feature",
            description: "Build the feature",
            acceptance_criteria: "Feature works",
            verification_checks: [],
            work_package: "WP2",
            depends_on: [],
            status: "planned",
          },
        ],
        status: "planned",
        session_id: null,
        retry_count: 0,
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
    status: "executing",
    project_path: PROJECT,
    ...overrides,
  };
}

function resetStores(): void {
  useTaskBoardStore.setState({
    plans: new Map(),
    conversations: new Map(),
    uiState: new Map(),
    executingProject: null,
    executingWorkPackage: null,
    isPaused: false,
    planningStreaming: new Map(),
    projectTargetDecisions: new Map(),
  });
  useSettingsStore.setState({
    settings: {
      theme: "midnight",
      fontSize: 13,
      sendShortcut: "cmd+enter",
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: { openai: "sk-test", gemini: "gm-test", anthropic: "ant-test" },
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini",
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "gemini",
      assistantDefaultModel: { gemini: "gemini-2.5-flash" },
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      triviaEnabled: true,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      onboardingCompleted: false,
      previewConsoleAutoOpen: true,
      taskBoardPlanningModel: "gemini-2.5-flash",
      taskBoardMaxTokens: 32768,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
    },
    loaded: true,
  });
}

describe("useTaskExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ── R4: cancelExecution ──

  describe("cancelExecution", () => {
    it("returns cancelExecution in the hook result", () => {
      const { result } = renderHook(() => useTaskExecution());
      expect(result.current.cancelExecution).toBeTypeOf("function");
    });

    it("sets executionAbort flag and resets executing state", async () => {
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
      useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");
      useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

      const { result } = renderHook(() => useTaskExecution());

      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      const s = useTaskBoardStore.getState();
      expect(s.executingProject).toBeNull();
      expect(s.executingWorkPackage).toBeNull();
      expect(s.isPaused).toBe(false);
    });

    it("resets plan status to ready", async () => {
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
      useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");

      const { result } = renderHook(() => useTaskExecution());
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      expect(useTaskBoardStore.getState().plans.get(PROJECT)!.status).toBe("ready");
    });

    it("resets executing WP status to planned", async () => {
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
      useTaskBoardStore.getState().updateWorkPackageStatus(PROJECT, "WP1", "in_progress");
      useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");

      const { result } = renderHook(() => useTaskExecution());
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      const wp = useTaskBoardStore.getState().plans.get(PROJECT)!.work_packages[0];
      expect(wp.status).toBe("planned");
    });

    it("closes the session associated with the executing WP", async () => {
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
      useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");

      const { result } = renderHook(() => useTaskExecution());
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      expect(mockCloseSession).toHaveBeenCalledWith("session-existing");
    });

    it("does not call closeSession if WP has no session_id", async () => {
      const plan = makePlan();
      plan.work_packages[0].session_id = null;
      useTaskBoardStore.getState().createPlan(PROJECT, plan);
      useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");

      const { result } = renderHook(() => useTaskExecution());
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      expect(mockCloseSession).not.toHaveBeenCalled();
    });

    it("handles closeSession failure gracefully", async () => {
      mockCloseSession.mockRejectedValueOnce(new Error("Session not found"));
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
      useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");

      const { result } = renderHook(() => useTaskExecution());
      // Should not throw
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      // State should still be reset despite session close failure
      expect(useTaskBoardStore.getState().executingProject).toBeNull();
      expect(useTaskBoardStore.getState().plans.get(PROJECT)!.status).toBe("ready");
    });

    it("clears paused state on cancel", async () => {
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
      useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");
      useTaskBoardStore.getState().setPaused(true);

      const { result } = renderHook(() => useTaskExecution());
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      expect(useTaskBoardStore.getState().isPaused).toBe(false);
    });

    it("handles missing plan gracefully", async () => {
      // No plan created, just executing state set
      useTaskBoardStore.setState({ executingProject: PROJECT, executingWorkPackage: "WP1" });

      const { result } = renderHook(() => useTaskExecution());
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      expect(useTaskBoardStore.getState().executingProject).toBeNull();
    });

    it("handles missing executingWorkPackage gracefully", async () => {
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
      // No WP set as executing
      useTaskBoardStore.setState({ executingProject: PROJECT, executingWorkPackage: null });

      const { result } = renderHook(() => useTaskExecution());
      await act(async () => {
        await result.current.cancelExecution(PROJECT);
      });

      // Should not call closeSession
      expect(mockCloseSession).not.toHaveBeenCalled();
      expect(useTaskBoardStore.getState().plans.get(PROJECT)!.status).toBe("ready");
    });
  });

  // ── Pause / Resume ──

  describe("pauseExecution", () => {
    it("sets isPaused to true", () => {
      const { result } = renderHook(() => useTaskExecution());
      act(() => {
        result.current.pauseExecution();
      });
      expect(useTaskBoardStore.getState().isPaused).toBe(true);
    });
  });

  describe("resumeExecution", () => {
    it("sets isPaused to false", () => {
      useTaskBoardStore.getState().setPaused(true);
      // Need plan and decision for executeAllWorkPackages to proceed
      useTaskBoardStore.getState().createPlan(PROJECT, makePlan({ status: "ready" }));
      useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

      const { result } = renderHook(() => useTaskExecution());
      act(() => {
        result.current.resumeExecution(PROJECT);
      });
      expect(useTaskBoardStore.getState().isPaused).toBe(false);
    });
  });

  // ── Hook shape ──

  it("returns all expected methods", () => {
    const { result } = renderHook(() => useTaskExecution());
    expect(result.current.executeWorkPackage).toBeTypeOf("function");
    expect(result.current.executeAllWorkPackages).toBeTypeOf("function");
    expect(result.current.pauseExecution).toBeTypeOf("function");
    expect(result.current.resumeExecution).toBeTypeOf("function");
    expect(result.current.cancelExecution).toBeTypeOf("function");
    expect(result.current.runCodeVerification).toBeTypeOf("function");
  });
});
