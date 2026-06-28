import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { cmd } = vi.hoisted(() => ({
  cmd: {
    getBranchGraph: vi.fn(),
    getGitStatus: vi.fn(),
    getConflictState: vi.fn(),
    mergeBranch: vi.fn(),
    mergeBranchPreview: vi.fn(),
    abortMerge: vi.fn(),
    gitPull: vi.fn(),
    undoGitOp: vi.fn(),
  },
}));
vi.mock("../../lib/tauri-commands", () => cmd);

import MergeConfirmDialog from "./MergeConfirmDialog";
import ConflictBanner from "./ConflictBanner";
import { useGitStore } from "../../stores/gitStore";

const PROJECT = "/tmp/p";

beforeEach(() => {
  vi.clearAllMocks();
  cmd.getBranchGraph.mockResolvedValue({
    isGitRepo: true,
    head: "main",
    detached: false,
    commits: [],
    branches: [],
    tags: [],
    truncated: false,
    laneCount: 0,
  });
  cmd.getGitStatus.mockResolvedValue({
    is_git_repo: true,
    branch: "main",
    uncommitted_changes: 0,
    last_commit_time: null,
    last_push_time: null,
  });
  cmd.getConflictState.mockResolvedValue({ inProgress: false, kind: "none", conflictedFiles: [] });
  useGitStore.setState({ byProject: new Map(), loadingByProject: new Map(), opInProgress: null });
});

describe("MergeConfirmDialog", () => {
  it("shows a clean preview and merges into main", async () => {
    cmd.mergeBranchPreview.mockResolvedValue({
      fastForward: false,
      willConflict: false,
      conflictFiles: [],
      commitsBrought: 4,
      filesChanged: 6,
      upToDate: false,
    });
    cmd.mergeBranch.mockResolvedValue({ message: "merged", undo: null, newSha: "s", branch: "main" });
    const onClose = vi.fn();
    render(
      <MergeConfirmDialog
        open
        projectPath={PROJECT}
        source="feature/login"
        currentBranch="main"
        onClose={onClose}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Brings 4 changes into main/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/No conflicts expected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Make it official/i }));
    await waitFor(() => expect(cmd.mergeBranch).toHaveBeenCalledWith(PROJECT, "feature/login"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("warns when the preview predicts conflicts", async () => {
    cmd.mergeBranchPreview.mockResolvedValue({
      fastForward: false,
      willConflict: true,
      conflictFiles: ["src/app.ts", "src/util.ts"],
      commitsBrought: 2,
      filesChanged: 3,
      upToDate: false,
    });
    render(
      <MergeConfirmDialog
        open
        projectPath={PROJECT}
        source="feature"
        currentBranch="main"
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/2 files overlap and need a careful merge/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("app.ts")).toBeInTheDocument();
  });

  it("disables merge when already up to date", async () => {
    cmd.mergeBranchPreview.mockResolvedValue({
      fastForward: false,
      willConflict: false,
      conflictFiles: [],
      commitsBrought: 0,
      filesChanged: 0,
      upToDate: true,
    });
    render(
      <MergeConfirmDialog
        open
        projectPath={PROJECT}
        source="feature"
        currentBranch="main"
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/already part of main/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Make it official/i })).toBeDisabled();
  });
});

describe("ConflictBanner", () => {
  const conflict = { inProgress: true, kind: "merge", conflictedFiles: ["src/a.ts", "src/b.ts"] };

  it("lists conflicted files and aborts on click", async () => {
    cmd.abortMerge.mockResolvedValue({ message: "aborted", undo: null, newSha: null, branch: "main" });
    render(<ConflictBanner projectPath={PROJECT} conflict={conflict} />);
    expect(screen.getByTestId("conflict-banner")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Undo this merge/i }));
    await waitFor(() => expect(cmd.abortMerge).toHaveBeenCalledWith(PROJECT));
  });

  it("renders nothing when no conflict is in progress", () => {
    const { container } = render(
      <ConflictBanner
        projectPath={PROJECT}
        conflict={{ inProgress: false, kind: "none", conflictedFiles: [] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
