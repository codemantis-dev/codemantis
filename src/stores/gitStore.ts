// Branch Map state. A pure UI cache keyed by project path — everything here is
// rederivable from the backend git commands, so it can always be refreshed.
//
// Read path lands first (Phase 1–4); mutating actions (create/switch/merge/…)
// are added in Phase 5 alongside the guardrail dialogs.

import { create } from "zustand";
import type { BranchGraph, ConflictState, UndoToken } from "../types/branch-graph";
import { isGitOpError } from "../types/branch-graph";
import type { GitStatusInfo } from "../types/git";
import {
  getBranchGraph,
  getGitStatus,
  getConflictState,
  createBranch as createBranchCmd,
  switchBranch as switchBranchCmd,
  gitCommit as gitCommitCmd,
  deleteBranch as deleteBranchCmd,
  mergeBranch as mergeBranchCmd,
  gitPull as gitPullCmd,
  gitPush as gitPushCmd,
  publishBranch as publishBranchCmd,
  abortMerge as abortMergeCmd,
  undoGitOp as undoGitOpCmd,
} from "../lib/tauri-commands";
import { showToast } from "./toastStore";

/** Which mutating op (if any) is currently running — disables action buttons. */
export type GitOpKind =
  | "create"
  | "switch"
  | "commit"
  | "delete"
  | "merge"
  | "pull"
  | "push"
  | "publish"
  | "abort"
  | "undo"
  | null;

/** How many commits the graph requests (backend hard-caps at 200). */
export const BRANCH_GRAPH_LIMIT = 200;

export interface GitProjectState {
  graph: BranchGraph | null;
  status: GitStatusInfo | null;
  conflict: ConflictState | null;
  /** Last successful refresh, ms epoch (0 = never). */
  fetchedAt: number;
  /** Last refresh error message, if the most recent refresh threw. */
  error: string | null;
}

interface GitState {
  byProject: Map<string, GitProjectState>;
  loadingByProject: Map<string, boolean>;
  /** Mutating op in flight (global — only one project is active at a time). */
  opInProgress: GitOpKind;

  /** Re-fetch graph + status + conflict state for a project, in parallel. */
  refresh: (projectPath: string) => Promise<void>;
  /** Drop a project's cached state (e.g. on project close). */
  clearProject: (projectPath: string) => void;

  // Mutating ops — each refreshes on success and shows a toast (with Undo
  // where the op is reversible). Returns true on success, false on failure.
  createBranch: (
    projectPath: string,
    name: string,
    fromRef: string | null,
    checkout: boolean,
  ) => Promise<boolean>;
  switchBranch: (projectPath: string, name: string) => Promise<boolean>;
  commit: (projectPath: string, message: string) => Promise<boolean>;
  deleteBranch: (projectPath: string, name: string, force: boolean) => Promise<boolean>;
  merge: (projectPath: string, source: string) => Promise<boolean>;
  pull: (projectPath: string) => Promise<boolean>;
  push: (projectPath: string) => Promise<boolean>;
  publish: (projectPath: string) => Promise<boolean>;
  abortMerge: (projectPath: string) => Promise<boolean>;
  undo: (projectPath: string, token: UndoToken) => Promise<boolean>;
}

export const useGitStore = create<GitState>((set, get) => ({
  byProject: new Map(),
  loadingByProject: new Map(),
  opInProgress: null,

  refresh: async (projectPath) => {
    set((state) => {
      const loadingByProject = new Map(state.loadingByProject);
      loadingByProject.set(projectPath, true);
      return { loadingByProject };
    });

    try {
      const [graph, status, conflict] = await Promise.all([
        getBranchGraph(projectPath, BRANCH_GRAPH_LIMIT),
        getGitStatus(projectPath),
        getConflictState(projectPath),
      ]);
      set((state) => {
        const byProject = new Map(state.byProject);
        byProject.set(projectPath, {
          graph,
          status,
          conflict,
          fetchedAt: Date.now(),
          error: null,
        });
        const loadingByProject = new Map(state.loadingByProject);
        loadingByProject.set(projectPath, false);
        return { byProject, loadingByProject };
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set((state) => {
        const byProject = new Map(state.byProject);
        const prev = byProject.get(projectPath);
        byProject.set(projectPath, {
          graph: prev?.graph ?? null,
          status: prev?.status ?? null,
          conflict: prev?.conflict ?? null,
          fetchedAt: prev?.fetchedAt ?? 0,
          error: message,
        });
        const loadingByProject = new Map(state.loadingByProject);
        loadingByProject.set(projectPath, false);
        return { byProject, loadingByProject };
      });
    }
  },

  clearProject: (projectPath) =>
    set((state) => {
      const byProject = new Map(state.byProject);
      byProject.delete(projectPath);
      const loadingByProject = new Map(state.loadingByProject);
      loadingByProject.delete(projectPath);
      return { byProject, loadingByProject };
    }),

  createBranch: (projectPath, name, fromRef, checkout) =>
    runMutation(set, get, projectPath, "create", () =>
      createBranchCmd(projectPath, name, fromRef, checkout),
    ),

  switchBranch: (projectPath, name) =>
    runMutation(set, get, projectPath, "switch", () => switchBranchCmd(projectPath, name)),

  commit: (projectPath, message) =>
    runMutation(set, get, projectPath, "commit", () => gitCommitCmd(projectPath, message)),

  deleteBranch: (projectPath, name, force) =>
    runMutation(set, get, projectPath, "delete", () => deleteBranchCmd(projectPath, name, force)),

  merge: (projectPath, source) =>
    runMutation(set, get, projectPath, "merge", () => mergeBranchCmd(projectPath, source)),

  pull: (projectPath) =>
    runMutation(set, get, projectPath, "pull", () => gitPullCmd(projectPath)),

  push: (projectPath) =>
    runMutation(set, get, projectPath, "push", () => gitPushCmd(projectPath)),

  publish: (projectPath) =>
    runMutation(set, get, projectPath, "publish", () => publishBranchCmd(projectPath)),

  abortMerge: (projectPath) =>
    runMutation(set, get, projectPath, "abort", () => abortMergeCmd(projectPath), {
      withUndoToast: false,
    }),

  undo: (projectPath, token) =>
    runMutation(set, get, projectPath, "undo", () => undoGitOpCmd(projectPath, token), {
      withUndoToast: false,
    }),
}));

type SetFn = (partial: Partial<GitState>) => void;
type GetFn = () => GitState;

/**
 * Shared wrapper for every mutating op: flips `opInProgress`, runs the command,
 * refreshes the project on success, and shows a toast — with a one-click Undo
 * action when the result is reversible. Errors surface as an error toast.
 */
async function runMutation(
  set: SetFn,
  get: GetFn,
  projectPath: string,
  kind: GitOpKind,
  command: () => Promise<import("../types/branch-graph").GitOpResult>,
  opts: { withUndoToast?: boolean } = {},
): Promise<boolean> {
  const { withUndoToast = true } = opts;
  set({ opInProgress: kind });
  try {
    const result = await command();
    await get().refresh(projectPath);
    const undoToken = result.undo;
    const action =
      withUndoToast && undoToken && undoToken.undoable
        ? { label: "Undo", onClick: () => void get().undo(projectPath, undoToken) }
        : undefined;
    showToast(result.message, "success", undefined, action);
    return true;
  } catch (e) {
    const message = isGitOpError(e) ? e.message : e instanceof Error ? e.message : String(e);
    showToast(message, "error");
    return false;
  } finally {
    set({ opInProgress: null });
  }
}

/** Whether a project is mid-refresh (no entry → not loading). */
export function isGitLoading(state: GitState, projectPath: string): boolean {
  return state.loadingByProject.get(projectPath) ?? false;
}
