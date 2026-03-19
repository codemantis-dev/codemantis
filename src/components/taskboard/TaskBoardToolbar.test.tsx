import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import type { TaskPlan } from "../../types/task-board";

// Hoist mocks
const {
  mockExecuteAllWorkPackages,
  mockPauseExecution,
  mockResumeExecution,
  mockCancelExecution,
  mockRunCodeVerification,
  mockExecuteWorkPackage,
} = vi.hoisted(() => ({
  mockExecuteAllWorkPackages: vi.fn(() => Promise.resolve()),
  mockPauseExecution: vi.fn(),
  mockResumeExecution: vi.fn(),
  mockCancelExecution: vi.fn(() => Promise.resolve()),
  mockRunCodeVerification: vi.fn(() => Promise.resolve()),
  mockExecuteWorkPackage: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../hooks/useTaskExecution", () => ({
  useTaskExecution: () => ({
    executeAllWorkPackages: mockExecuteAllWorkPackages,
    pauseExecution: mockPauseExecution,
    resumeExecution: mockResumeExecution,
    cancelExecution: mockCancelExecution,
    runCodeVerification: mockRunCodeVerification,
    executeWorkPackage: mockExecuteWorkPackage,
  }),
}));

const { mockSendPlanningMessage, mockGeneratePlan } = vi.hoisted(() => ({
  mockSendPlanningMessage: vi.fn(() => Promise.resolve()),
  mockGeneratePlan: vi.fn(),
}));

vi.mock("../../hooks/usePlanningConversation", () => ({
  usePlanningConversation: () => ({
    sendPlanningMessage: mockSendPlanningMessage,
    generatePlan: mockGeneratePlan,
  }),
}));

import TaskBoardToolbar from "./TaskBoardToolbar";

const PROJECT = "/tmp/test-project";

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    id: "plan-1",
    name: "Test Plan",
    description: "",
    template_recommendation: null,
    work_packages: [
      {
        id: "WP1", name: "Setup", tasks: [],
        status: "planned", session_id: null, retry_count: 0,
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
    status: "ready",
    project_path: PROJECT,
    ...overrides,
  };
}

function resetStore(): void {
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
}

describe("TaskBoardToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("returns null when no plan exists", () => {
    const { container } = render(<TaskBoardToolbar projectPath={PROJECT} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Start All button when not executing and not all done", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("Start All")).toBeInTheDocument();
  });

  it("Start All is disabled when project target is undecided", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "undecided" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    const startBtn = screen.getByText("Start All");
    expect(startBtn.closest("button")).toBeDisabled();
  });

  it("renders Pause button when executing", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("Pause")).toBeInTheDocument();
  });

  it("clicking Pause calls pauseExecution", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    fireEvent.click(screen.getByText("Pause"));
    expect(mockPauseExecution).toHaveBeenCalledOnce();
  });

  // ── R4: Cancel button ──

  it("renders Cancel button when executing", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("does not render Cancel when not executing", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  it("clicking Cancel calls cancelExecution with projectPath", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    fireEvent.click(screen.getByText("Cancel"));
    expect(mockCancelExecution).toHaveBeenCalledWith(PROJECT);
  });

  it("Cancel has title attribute for accessibility", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    const cancelBtn = screen.getByText("Cancel").closest("button");
    expect(cancelBtn).toHaveAttribute("title", "Cancel execution");
  });

  it("Cancel and Pause both visible during execution", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  // ── Resume ──

  it("renders Resume button when paused", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setPaused(true);

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("clicking Resume calls resumeExecution", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setPaused(true);

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    fireEvent.click(screen.getByText("Resume"));
    expect(mockResumeExecution).toHaveBeenCalledWith(PROJECT);
  });

  // ── Re-plan ──

  it("renders Re-plan button", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("Re-plan")).toBeInTheDocument();
  });

  it("Re-plan is disabled during execution", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    const replanBtn = screen.getByText("Re-plan").closest("button");
    expect(replanBtn).toBeDisabled();
  });

  // ── Status text ──

  it("shows 'All packages complete' when all WPs done", () => {
    useTaskBoardStore.getState().createPlan(
      PROJECT,
      makePlan({
        work_packages: [
          { id: "WP1", name: "Done WP", tasks: [], status: "done", session_id: null, retry_count: 0 },
        ],
      })
    );

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("All packages complete")).toBeInTheDocument();
  });

  it("shows 'Executing...' during execution", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<TaskBoardToolbar projectPath={PROJECT} />);

    expect(screen.getByText("Executing...")).toBeInTheDocument();
  });
});
