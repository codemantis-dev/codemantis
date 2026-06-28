import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { cmd } = vi.hoisted(() => ({
  cmd: {
    getBranchGraph: vi.fn(),
    getGitStatus: vi.fn(),
    getConflictState: vi.fn(),
    gitPush: vi.fn(),
    gitPull: vi.fn(),
    publishBranch: vi.fn(),
    gitPushPreview: vi.fn(),
    undoGitOp: vi.fn(),
  },
}));
vi.mock("../../lib/tauri-commands", () => cmd);

import SyncDialog from "./SyncDialog";
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

describe("SyncDialog", () => {
  it("offers 'Back it up online' and pushes when ahead", async () => {
    cmd.gitPushPreview.mockResolvedValue({
      remoteExists: true,
      hasUpstream: true,
      ahead: 3,
      behind: 0,
      wouldReject: false,
    });
    cmd.gitPush.mockResolvedValue({ message: "backed up", undo: null, newSha: null, branch: "main" });
    render(<SyncDialog open projectPath={PROJECT} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/3 checkpoints to back up online/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Back it up online/i }));
    await waitFor(() => expect(cmd.gitPush).toHaveBeenCalledWith(PROJECT));
  });

  it("offers publish when the branch has no upstream", async () => {
    cmd.gitPushPreview.mockResolvedValue({
      remoteExists: true,
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      wouldReject: false,
    });
    cmd.publishBranch.mockResolvedValue({ message: "published", undo: null, newSha: null, branch: "main" });
    render(<SyncDialog open projectPath={PROJECT} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/isn't backed up online yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Back it up online/i }));
    await waitFor(() => expect(cmd.publishBranch).toHaveBeenCalledWith(PROJECT));
  });

  it("shows 'in sync' and no push button when up to date", async () => {
    cmd.gitPushPreview.mockResolvedValue({
      remoteExists: true,
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      wouldReject: false,
    });
    render(<SyncDialog open projectPath={PROJECT} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Everything's in sync/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Back it up online/i })).not.toBeInTheDocument();
  });

  it("explains when there's no online backup connected", async () => {
    cmd.gitPushPreview.mockResolvedValue({
      remoteExists: false,
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      wouldReject: false,
    });
    render(<SyncDialog open projectPath={PROJECT} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No online backup is connected/i)).toBeInTheDocument());
  });

  it("blocks push and tells you to pull first when behind", async () => {
    cmd.gitPushPreview.mockResolvedValue({
      remoteExists: true,
      hasUpstream: true,
      ahead: 1,
      behind: 2,
      wouldReject: true,
    });
    render(<SyncDialog open projectPath={PROJECT} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Get the latest first/i)).toBeInTheDocument());
    // The push button is disabled while behind.
    expect(screen.getByRole("button", { name: /Back it up online/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Get latest/i })).toBeInTheDocument();
  });
});
