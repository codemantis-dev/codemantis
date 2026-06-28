import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BranchGraph, GitOpResult, UndoToken } from "../types/branch-graph";
import type { GitStatusInfo } from "../types/git";

const { cmd, showToast } = vi.hoisted(() => ({
  cmd: {
    getBranchGraph: vi.fn(),
    getGitStatus: vi.fn(),
    getConflictState: vi.fn(),
    createBranch: vi.fn(),
    switchBranch: vi.fn(),
    gitCommit: vi.fn(),
    deleteBranch: vi.fn(),
    mergeBranch: vi.fn(),
    gitPull: vi.fn(),
    gitPush: vi.fn(),
    publishBranch: vi.fn(),
    abortMerge: vi.fn(),
    undoGitOp: vi.fn(),
  },
  showToast: vi.fn(),
}));

vi.mock("../lib/tauri-commands", () => cmd);
vi.mock("./toastStore", () => ({ showToast }));

// Import after mocks are registered.
import { useGitStore } from "./gitStore";

const PROJECT = "/tmp/proj";

const emptyGraph: BranchGraph = {
  isGitRepo: true,
  head: "main",
  detached: false,
  commits: [],
  branches: [],
  tags: [],
  truncated: false,
  laneCount: 0,
};

const cleanStatus: GitStatusInfo = {
  is_git_repo: true,
  branch: "main",
  uncommitted_changes: 0,
  last_commit_time: null,
  last_push_time: null,
};

const noConflict = { inProgress: false, kind: "none", conflictedFiles: [] };

function okResult(over: Partial<GitOpResult> = {}): GitOpResult {
  return { message: "done", undo: null, newSha: null, branch: "main", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  cmd.getBranchGraph.mockResolvedValue(emptyGraph);
  cmd.getGitStatus.mockResolvedValue(cleanStatus);
  cmd.getConflictState.mockResolvedValue(noConflict);
  useGitStore.setState({
    byProject: new Map(),
    loadingByProject: new Map(),
    opInProgress: null,
  });
});

describe("gitStore.refresh", () => {
  it("loads graph + status + conflict into byProject", async () => {
    await useGitStore.getState().refresh(PROJECT);
    const p = useGitStore.getState().byProject.get(PROJECT);
    expect(p?.graph).toEqual(emptyGraph);
    expect(p?.status).toEqual(cleanStatus);
    expect(p?.error).toBeNull();
    expect(p?.fetchedAt).toBeGreaterThan(0);
  });

  it("records an error and keeps prior data on failure", async () => {
    await useGitStore.getState().refresh(PROJECT); // seed
    cmd.getBranchGraph.mockRejectedValueOnce(new Error("boom"));
    await useGitStore.getState().refresh(PROJECT);
    const p = useGitStore.getState().byProject.get(PROJECT);
    expect(p?.error).toBe("boom");
    expect(p?.graph).toEqual(emptyGraph); // prior data retained
  });
});

describe("gitStore mutating ops", () => {
  it("createBranch calls the command, refreshes, toasts, and returns true", async () => {
    cmd.createBranch.mockResolvedValue(okResult({ message: "Created \"x\"." }));
    const ok = await useGitStore.getState().createBranch(PROJECT, "x", null, true);
    expect(ok).toBe(true);
    expect(cmd.createBranch).toHaveBeenCalledWith(PROJECT, "x", null, true);
    expect(cmd.getBranchGraph).toHaveBeenCalled(); // refresh happened
    expect(showToast).toHaveBeenCalledWith("Created \"x\".", "success", undefined, undefined);
    expect(useGitStore.getState().opInProgress).toBeNull();
  });

  it("shows an Undo action when the result is undoable", async () => {
    const undo: UndoToken = {
      op: "switch",
      prevBranch: "main",
      prevSha: "abc",
      branchName: null,
      undoable: true,
    };
    cmd.switchBranch.mockResolvedValue(okResult({ message: "Switched.", undo }));
    cmd.undoGitOp.mockResolvedValue(okResult({ message: "Undone." }));
    await useGitStore.getState().switchBranch(PROJECT, "feature");

    const action = showToast.mock.calls[0][3];
    expect(action?.label).toBe("Undo");
    // Firing the undo action calls the undo command with the token.
    action.onClick();
    await Promise.resolve();
    expect(cmd.undoGitOp).toHaveBeenCalledWith(PROJECT, undo);
  });

  it("surfaces a GitOpError as an error toast and returns false", async () => {
    cmd.gitCommit.mockRejectedValue({
      kind: "nothingToCommit",
      message: "There's nothing new to save yet.",
      raw: "",
      files: [],
    });
    const ok = await useGitStore.getState().commit(PROJECT, "x");
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("There's nothing new to save yet.", "error");
    expect(useGitStore.getState().opInProgress).toBeNull();
  });

  it("flips opInProgress while running", async () => {
    let seen: string | null = "unset";
    cmd.deleteBranch.mockImplementation(async () => {
      seen = useGitStore.getState().opInProgress;
      return okResult();
    });
    await useGitStore.getState().deleteBranch(PROJECT, "old", false);
    expect(seen).toBe("delete");
    expect(useGitStore.getState().opInProgress).toBeNull();
  });

  it("merge runs the command, refreshes, and offers Undo when reversible", async () => {
    cmd.mergeBranch.mockResolvedValue(
      okResult({ message: "merged", undo: { op: "merge", prevBranch: "main", prevSha: "x", branchName: null, undoable: true } }),
    );
    const ok = await useGitStore.getState().merge(PROJECT, "feature");
    expect(ok).toBe(true);
    expect(cmd.mergeBranch).toHaveBeenCalledWith(PROJECT, "feature");
    expect(showToast.mock.calls[0][3]?.label).toBe("Undo");
  });

  it("pull runs the command and refreshes", async () => {
    cmd.gitPull.mockResolvedValue(okResult({ message: "got latest" }));
    const ok = await useGitStore.getState().pull(PROJECT);
    expect(ok).toBe(true);
    expect(cmd.gitPull).toHaveBeenCalledWith(PROJECT);
    expect(cmd.getBranchGraph).toHaveBeenCalled();
  });

  it("push runs the command (no undo toast — irreversible)", async () => {
    cmd.gitPush.mockResolvedValue(okResult({ message: "Backed up online." }));
    const ok = await useGitStore.getState().push(PROJECT);
    expect(ok).toBe(true);
    expect(cmd.gitPush).toHaveBeenCalledWith(PROJECT);
    expect(showToast).toHaveBeenCalledWith("Backed up online.", "success", undefined, undefined);
  });

  it("publish runs the command and refreshes", async () => {
    cmd.publishBranch.mockResolvedValue(okResult({ message: "Published." }));
    const ok = await useGitStore.getState().publish(PROJECT);
    expect(ok).toBe(true);
    expect(cmd.publishBranch).toHaveBeenCalledWith(PROJECT);
    expect(cmd.getBranchGraph).toHaveBeenCalled();
  });

  it("abortMerge runs without an undo toast", async () => {
    cmd.abortMerge.mockResolvedValue(okResult({ message: "Merge undone." }));
    const ok = await useGitStore.getState().abortMerge(PROJECT);
    expect(ok).toBe(true);
    expect(showToast).toHaveBeenCalledWith("Merge undone.", "success", undefined, undefined);
  });

  it("undo does not itself offer an undo toast", async () => {
    cmd.undoGitOp.mockResolvedValue(okResult({ message: "Undone." }));
    await useGitStore.getState().undo(PROJECT, {
      op: "commit",
      prevBranch: "main",
      prevSha: "abc",
      branchName: null,
      undoable: true,
    });
    expect(showToast).toHaveBeenCalledWith("Undone.", "success", undefined, undefined);
  });
});
