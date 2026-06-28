/**
 * Integration test: Branch Map write flow.
 *
 * Exercises the real seam: header button → guardrail dialog → Tauri command →
 * gitStore refresh → toast. Real Zustand stores; only the Tauri IPC boundary is
 * mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import type { BranchGraph } from "../../types/branch-graph";
import type { GitStatusInfo } from "../../types/git";

const { cmd } = vi.hoisted(() => ({
  cmd: {
    getBranchGraph: vi.fn(),
    getGitStatus: vi.fn(),
    getConflictState: vi.fn(),
    getProjectChangelogEntries: vi.fn(),
    createBranch: vi.fn(),
    switchBranch: vi.fn(),
    switchBranchPreview: vi.fn(),
    gitCommit: vi.fn(),
    deleteBranch: vi.fn(),
    deleteBranchPreview: vi.fn(),
    undoGitOp: vi.fn(),
  },
}));

vi.mock("../../lib/tauri-commands", () => cmd);

import BranchMapView from "../../components/branchmap/BranchMapView";

const PROJECT = "/tmp/proj";

const graph: BranchGraph = {
  isGitRepo: true,
  head: "main",
  detached: false,
  commits: [
    {
      hash: "c1",
      shortHash: "c1",
      parents: [],
      subject: "first commit",
      author: "T",
      timestamp: "2026-06-01T12:00:00Z",
      refs: ["main"],
      isHead: true,
      isMerge: false,
      lane: 0,
    },
  ],
  branches: [
    {
      name: "main",
      isCurrent: true,
      isRemote: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      tip: "c1",
      lane: 0,
    },
  ],
  tags: [],
  truncated: false,
  laneCount: 1,
};

const status: GitStatusInfo = {
  is_git_repo: true,
  branch: "main",
  uncommitted_changes: 0,
  last_commit_time: null,
  last_push_time: null,
};

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
  cmd.getBranchGraph.mockResolvedValue(graph);
  cmd.getGitStatus.mockResolvedValue(status);
  cmd.getConflictState.mockResolvedValue({ inProgress: false, kind: "none", conflictedFiles: [] });
  cmd.getProjectChangelogEntries.mockResolvedValue([]);
  cmd.createBranch.mockResolvedValue({
    message: 'Created a new safe space "ideas".',
    undo: { op: "createBranch", prevBranch: "main", prevSha: "c1", branchName: "ideas", undoable: true },
    newSha: null,
    branch: "ideas",
  });
  useSessionStore.setState({ activeProjectPath: PROJECT });
});

describe("Branch Map — create branch flow", () => {
  it("renders the graph then creates a branch end-to-end", async () => {
    render(<BranchMapView />);

    // Graph loads → the "You are here" marker + actions appear.
    await waitFor(() => expect(screen.getByText("You are here")).toBeInTheDocument());
    const newBtn = await screen.findByRole("button", { name: /New safe space/i });

    // Open the dialog, name the branch, confirm.
    fireEvent.click(newBtn);
    const input = await screen.findByPlaceholderText(/new-homepage/i);
    fireEvent.change(input, { target: { value: "ideas" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    // Command fired with the typed name; a refresh follows.
    await waitFor(() =>
      expect(cmd.createBranch).toHaveBeenCalledWith(PROJECT, "ideas", null, true),
    );
    // getBranchGraph called at least twice: initial load + post-op refresh.
    await waitFor(() => expect(cmd.getBranchGraph.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("shows the not-a-repo empty state when the folder isn't tracked", async () => {
    cmd.getGitStatus.mockResolvedValue({ ...status, is_git_repo: false });
    cmd.getBranchGraph.mockResolvedValue({ ...graph, isGitRepo: false, commits: [], branches: [] });
    render(<BranchMapView />);
    await waitFor(() =>
      expect(screen.getByTestId("branch-map-empty")).toHaveAttribute("data-variant", "not-a-repo"),
    );
  });
});
