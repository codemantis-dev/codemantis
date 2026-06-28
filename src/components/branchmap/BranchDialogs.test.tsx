import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { cmd } = vi.hoisted(() => ({
  cmd: {
    getBranchGraph: vi.fn(),
    getGitStatus: vi.fn(),
    getConflictState: vi.fn(),
    createBranch: vi.fn(),
    switchBranch: vi.fn(),
    gitCommit: vi.fn(),
    deleteBranch: vi.fn(),
    deleteBranchPreview: vi.fn(),
    undoGitOp: vi.fn(),
  },
}));
vi.mock("../../lib/tauri-commands", () => cmd);

import NewBranchDialog from "./NewBranchDialog";
import CommitDialog from "./CommitDialog";
import DeleteBranchDialog from "./DeleteBranchDialog";
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

describe("NewBranchDialog", () => {
  it("disables Create until a name is typed, then creates", async () => {
    cmd.createBranch.mockResolvedValue({ message: "ok", undo: null, newSha: null, branch: "x" });
    const onClose = vi.fn();
    render(<NewBranchDialog open projectPath={PROJECT} onClose={onClose} />);

    const create = screen.getByRole("button", { name: /^Create$/i });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/new-homepage/i), { target: { value: "x" } });
    expect(create).not.toBeDisabled();
    fireEvent.click(create);

    await waitFor(() => expect(cmd.createBranch).toHaveBeenCalledWith(PROJECT, "x", null, true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("CommitDialog", () => {
  it("prefills the suggestion and saves a checkpoint", async () => {
    cmd.gitCommit.mockResolvedValue({ message: "ok", undo: null, newSha: "s", branch: "main" });
    const onClose = vi.fn();
    render(
      <CommitDialog
        open
        projectPath={PROJECT}
        changedCount={3}
        suggestion="Added sign-in"
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/Saves a snapshot of your 3 changes/i)).toBeInTheDocument();
    const input = screen.getByDisplayValue("Added sign-in");
    expect(input).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save checkpoint/i }));
    await waitFor(() => expect(cmd.gitCommit).toHaveBeenCalledWith(PROJECT, "Added sign-in"));
  });

  it("disables save when the note is empty", () => {
    render(
      <CommitDialog open projectPath={PROJECT} changedCount={1} suggestion="" onClose={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Save checkpoint/i })).toBeDisabled();
  });
});

describe("DeleteBranchDialog", () => {
  it("warns about unmerged checkpoints and force-deletes", async () => {
    cmd.deleteBranchPreview.mockResolvedValue({
      isCurrent: false,
      isMerged: false,
      unmergedCommits: 2,
    });
    cmd.deleteBranch.mockResolvedValue({ message: "deleted", undo: null, newSha: null, branch: "main" });
    const onClose = vi.fn();
    render(<DeleteBranchDialog open projectPath={PROJECT} branch="feature/x" onClose={onClose} />);

    await waitFor(() =>
      expect(screen.getByText(/2 checkpoints that aren't in your current branch/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    // Unmerged → force = true.
    await waitFor(() => expect(cmd.deleteBranch).toHaveBeenCalledWith(PROJECT, "feature/x", true));
  });

  it("reassures when the branch is already merged", async () => {
    cmd.deleteBranchPreview.mockResolvedValue({ isCurrent: false, isMerged: true, unmergedCommits: 0 });
    render(<DeleteBranchDialog open projectPath={PROJECT} branch="old" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument(),
    );
  });
});
