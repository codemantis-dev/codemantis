import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import type { TaskPlan } from "../../types/task-board";

// Hoist mocks
const {
  mockResumeExecution,
  mockCancelExecution,
  mockPauseExecution,
  mockExecuteAllWorkPackages,
  mockRunCodeVerification,
  mockExecuteWorkPackage,
} = vi.hoisted(() => ({
  mockResumeExecution: vi.fn(),
  mockCancelExecution: vi.fn(() => Promise.resolve()),
  mockPauseExecution: vi.fn(),
  mockExecuteAllWorkPackages: vi.fn(() => Promise.resolve()),
  mockRunCodeVerification: vi.fn(() => Promise.resolve()),
  mockExecuteWorkPackage: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../hooks/useTaskExecution", () => ({
  useTaskExecution: () => ({
    resumeExecution: mockResumeExecution,
    cancelExecution: mockCancelExecution,
    pauseExecution: mockPauseExecution,
    executeAllWorkPackages: mockExecuteAllWorkPackages,
    runCodeVerification: mockRunCodeVerification,
    executeWorkPackage: mockExecuteWorkPackage,
  }),
}));

import WorkPackageList from "./WorkPackageList";

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
            description: "",
            acceptance_criteria: "",
            verification_checks: [],
            work_package: "WP1",
            depends_on: [],
            status: "planned",
          },
        ],
        status: "planned",
        session_id: null,
        retry_count: 0,
      },
      {
        id: "WP2",
        name: "Build",
        tasks: [],
        status: "planned",
        session_id: null,
        retry_count: 0,
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

describe("WorkPackageList", () => {
  const onSwitchProject = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("shows empty state when no plan exists", () => {
    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);
    expect(screen.getByText("No plan yet")).toBeInTheDocument();
  });

  it("renders plan name and progress", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.getByText("Test Plan")).toBeInTheDocument();
    expect(screen.getByText("0/1 tasks")).toBeInTheDocument();
  });

  it("renders work package cards", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("shows decision gate when undecided", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "undecided" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.getByText("Where should this plan execute?")).toBeInTheDocument();
  });

  it("shows migrated banner when plan was migrated", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "migrated", migratedTo: "/tmp/new-project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.getByText("Plan migrated to new-project")).toBeInTheDocument();
    expect(screen.getByText("Switch to project")).toBeInTheDocument();
  });

  // ── R4: Resume banner ──

  it("shows resume banner when plan is executing but no WP is active", () => {
    useTaskBoardStore.getState().createPlan(
      PROJECT,
      makePlan({ status: "executing" })
    );
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });
    // executingWorkPackage is null (e.g., app restarted)

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.getByText(/Execution was interrupted/)).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("does not show resume banner when plan status is ready", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan({ status: "ready" }));
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.queryByText(/Execution was interrupted/)).not.toBeInTheDocument();
  });

  it("does not show resume banner when WP is actively executing", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan({ status: "executing" }));
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });
    useTaskBoardStore.setState({ executingWorkPackage: "WP1" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.queryByText(/Execution was interrupted/)).not.toBeInTheDocument();
  });

  it("clicking Resume resets stuck WP and calls resumeExecution", () => {
    useTaskBoardStore.getState().createPlan(
      PROJECT,
      makePlan({
        status: "executing",
        work_packages: [
          {
            id: "WP1", name: "Setup",
            tasks: [{ id: "T1", title: "Create file", description: "", acceptance_criteria: "", verification_checks: [], work_package: "WP1", depends_on: [], status: "planned" }],
            status: "in_progress", session_id: null, retry_count: 0,
          },
          {
            id: "WP2", name: "Build", tasks: [],
            status: "planned", session_id: null, retry_count: 0,
          },
        ],
      })
    );
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    fireEvent.click(screen.getByText("Resume"));

    // Check that the stuck WP was reset to planned
    const plan = useTaskBoardStore.getState().plans.get(PROJECT)!;
    expect(plan.work_packages[0].status).toBe("planned");
    expect(plan.status).toBe("ready");

    // resumeExecution should have been called
    expect(mockResumeExecution).toHaveBeenCalledWith(PROJECT);
  });

  it("clicking Reset resets stuck WP without resuming", () => {
    useTaskBoardStore.getState().createPlan(
      PROJECT,
      makePlan({
        status: "executing",
        work_packages: [
          {
            id: "WP1", name: "Setup", tasks: [],
            status: "in_progress", session_id: null, retry_count: 0,
          },
        ],
      })
    );
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    fireEvent.click(screen.getByText("Reset"));

    // Plan status should be reset to ready
    const plan = useTaskBoardStore.getState().plans.get(PROJECT)!;
    expect(plan.status).toBe("ready");
    expect(plan.work_packages[0].status).toBe("planned");

    // resumeExecution should NOT have been called
    expect(mockResumeExecution).not.toHaveBeenCalled();
  });

  it("resume banner hides after clicking Resume", () => {
    useTaskBoardStore.getState().createPlan(
      PROJECT,
      makePlan({ status: "executing" })
    );
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.getByText(/Execution was interrupted/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Resume"));

    // Banner should be hidden
    expect(screen.queryByText(/Execution was interrupted/)).not.toBeInTheDocument();
  });

  it("resume banner hides after clicking Reset", () => {
    useTaskBoardStore.getState().createPlan(
      PROJECT,
      makePlan({ status: "executing" })
    );
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    fireEvent.click(screen.getByText("Reset"));
    expect(screen.queryByText(/Execution was interrupted/)).not.toBeInTheDocument();
  });

  // ── Task progress ──

  it("shows correct task progress with done tasks", () => {
    useTaskBoardStore.getState().createPlan(
      PROJECT,
      makePlan({
        work_packages: [
          {
            id: "WP1",
            name: "Setup",
            tasks: [
              { id: "T1", title: "A", description: "", acceptance_criteria: "", verification_checks: [], work_package: "WP1", depends_on: [], status: "done" },
              { id: "T2", title: "B", description: "", acceptance_criteria: "", verification_checks: [], work_package: "WP1", depends_on: [], status: "planned" },
            ],
            status: "in_progress",
            session_id: null,
            retry_count: 0,
          },
        ],
      })
    );
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });

    render(<WorkPackageList projectPath={PROJECT} onSwitchProject={onSwitchProject} />);

    expect(screen.getByText("1/2 tasks")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
