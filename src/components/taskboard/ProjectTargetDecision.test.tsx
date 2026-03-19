import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import type { TaskPlan } from "../../types/task-board";

import type { FileNode } from "../../types/file-tree";

// Hoist mocks
const { mockReadFileTree } = vi.hoisted(() => ({
  mockReadFileTree: vi.fn<(rootPath: string) => Promise<FileNode[]>>(() => Promise.resolve([])),
}));

vi.mock("../../lib/tauri-commands", () => ({
  readFileTree: mockReadFileTree,
  listTemplates: vi.fn(() => Promise.resolve([])),
  scaffoldFromTemplate: vi.fn(),
  scaffoldFromCli: vi.fn(),
  listenScaffoldProgress: vi.fn(() => Promise.resolve(() => {})),
}));

import ProjectTargetDecision from "./ProjectTargetDecision";

const PROJECT = "/tmp/test-project";

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    id: "plan-1",
    name: "Test Plan",
    description: "",
    template_recommendation: null,
    work_packages: [],
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
    pendingUserAction: new Map(),
    projectTargetDecisions: new Map(),
  });
}

describe("ProjectTargetDecision", () => {
  const onSwitchProject = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // -- Basic rendering --

  it("renders choosing mode with two options", () => {
    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    expect(screen.getByText("Use Current Project")).toBeInTheDocument();
    expect(screen.getByText("Create New Project")).toBeInTheDocument();
    expect(screen.getByText("Where should this plan execute?")).toBeInTheDocument();
  });

  it("shows project basename", () => {
    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    expect(screen.getByText("test-project")).toBeInTheDocument();
  });

  it("shows template recommendation when set on plan", () => {
    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan({ template_recommendation: "vite-react" })}
        onSwitchProject={onSwitchProject}
      />
    );

    expect(screen.getByText("vite-react")).toBeInTheDocument();
  });

  // -- R1: Existing project warning --

  it("proceeds directly when no project markers are found", async () => {
    mockReadFileTree.mockResolvedValueOnce([
      { name: "README.md", path: `${PROJECT}/README.md`, is_dir: false },
      { name: ".gitignore", path: `${PROJECT}/.gitignore`, is_dir: false },
    ]);

    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Use Current Project"));

    await waitFor(() => {
      const decision = useTaskBoardStore.getState().projectTargetDecisions.get(PROJECT);
      expect(decision).toEqual({ type: "current_project" });
    });
  });

  it("shows warning when package.json is found", async () => {
    mockReadFileTree.mockResolvedValueOnce([
      { name: "package.json", path: `${PROJECT}/package.json`, is_dir: false },
      { name: "src", path: `${PROJECT}/src`, is_dir: true },
    ]);

    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Use Current Project"));

    await waitFor(() => {
      expect(screen.getByText("This folder already contains a project")).toBeInTheDocument();
    });
    expect(screen.getByText(/Found: package\.json/)).toBeInTheDocument();
    expect(screen.getByText("Continue Anyway")).toBeInTheDocument();
    expect(screen.getByText("Choose Different Folder")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("shows warning listing multiple markers", async () => {
    mockReadFileTree.mockResolvedValueOnce([
      { name: "package.json", path: `${PROJECT}/package.json`, is_dir: false },
      { name: "Cargo.toml", path: `${PROJECT}/Cargo.toml`, is_dir: false },
      { name: "src", path: `${PROJECT}/src`, is_dir: true },
    ]);

    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Use Current Project"));

    await waitFor(() => {
      expect(screen.getByText(/Found: package\.json, Cargo\.toml/)).toBeInTheDocument();
    });
  });

  it("Continue Anyway sets project target to current_project", async () => {
    mockReadFileTree.mockResolvedValueOnce([
      { name: "package.json", path: `${PROJECT}/package.json`, is_dir: false },
    ]);

    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Use Current Project"));

    await waitFor(() => {
      expect(screen.getByText("Continue Anyway")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Continue Anyway"));

    const decision = useTaskBoardStore.getState().projectTargetDecisions.get(PROJECT);
    expect(decision).toEqual({ type: "current_project" });
  });

  it("Choose Different Folder switches to template picker", async () => {
    mockReadFileTree.mockResolvedValueOnce([
      { name: "pyproject.toml", path: `${PROJECT}/pyproject.toml`, is_dir: false },
    ]);

    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Use Current Project"));

    await waitFor(() => {
      expect(screen.getByText("Choose Different Folder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Choose Different Folder"));

    // Should switch to template picker
    expect(screen.getByText("Pick a template")).toBeInTheDocument();
  });

  it("Cancel returns to choosing mode", async () => {
    mockReadFileTree.mockResolvedValueOnce([
      { name: "go.mod", path: `${PROJECT}/go.mod`, is_dir: false },
    ]);

    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Use Current Project"));

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Cancel"));

    // Should be back to choosing mode
    expect(screen.getByText("Where should this plan execute?")).toBeInTheDocument();
    expect(screen.getByText("Use Current Project")).toBeInTheDocument();
  });

  it("proceeds if readFileTree throws", async () => {
    mockReadFileTree.mockRejectedValueOnce(new Error("Permission denied"));

    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Use Current Project"));

    await waitFor(() => {
      const decision = useTaskBoardStore.getState().projectTargetDecisions.get(PROJECT);
      expect(decision).toEqual({ type: "current_project" });
    });
  });

  it("detects all supported project markers", async () => {
    // Test a subset of less common markers
    const markers = ["Gemfile", "composer.json", "mix.exs"];

    for (const marker of markers) {
      resetStore();
      mockReadFileTree.mockResolvedValueOnce([
        { name: marker, path: `${PROJECT}/${marker}`, is_dir: false },
      ]);

      const { unmount } = render(
        <ProjectTargetDecision
          projectPath={PROJECT}
          plan={makePlan()}
          onSwitchProject={onSwitchProject}
        />
      );

      fireEvent.click(screen.getByText("Use Current Project"));

      await waitFor(() => {
        expect(screen.getByText(`Found: ${marker}`)).toBeInTheDocument();
      });

      unmount();
    }
  });

  // -- Mode switching --

  it("switches to template picker mode", () => {
    render(
      <ProjectTargetDecision
        projectPath={PROJECT}
        plan={makePlan()}
        onSwitchProject={onSwitchProject}
      />
    );

    fireEvent.click(screen.getByText("Create New Project"));
    expect(screen.getByText("Pick a template")).toBeInTheDocument();
  });
});
