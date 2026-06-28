// Branch Map types — mirror the Rust structs in
// `src-tauri/src/commands/git_graph.rs` (and later `git_write.rs`).
//
// NOTE: these are camelCase (the Rust structs use
// `#[serde(rename_all = "camelCase")]`), unlike the legacy snake_case
// `GitStatusInfo`/`GitCommit` in `./git.ts`. New git surfaces use camelCase.

/** One commit in the branch graph, with everything the renderer needs. */
export interface GraphCommit {
  /** Full 40-char SHA — the stable key. */
  hash: string;
  /** Abbreviated hash for display. */
  shortHash: string;
  /** Full parent SHAs. 0 = root, 1 = normal, 2+ = merge. */
  parents: string[];
  /** Commit subject line. */
  subject: string;
  author: string;
  /** ISO-8601 committer date. */
  timestamp: string;
  /** Branch/tag names pointing at this commit. */
  refs: string[];
  /** True when HEAD points here. */
  isHead: boolean;
  /** True when this commit has 2+ parents (a merge join). */
  isMerge: boolean;
  /** Swim-lane index. Lane 0 = trunk (rendered at the bottom). */
  lane: number;
}

/** A branch (or remote-tracking branch) with upstream tracking info. */
export interface BranchRef {
  /** Short name, e.g. `main` or `origin/main`. */
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  /** Upstream short name, e.g. `origin/main`, if configured. */
  upstream: string | null;
  /** Commits ahead of upstream. */
  ahead: number;
  /** Commits behind upstream. */
  behind: number;
  /** Full SHA the branch tip points at. */
  tip: string;
  /** Lane of the branch tip within the returned commit window. */
  lane: number;
}

/** The full branch graph for a project. */
export interface BranchGraph {
  isGitRepo: boolean;
  /** Current branch name, or null when detached. */
  head: string | null;
  detached: boolean;
  /** Newest-first, capped. */
  commits: GraphCommit[];
  branches: BranchRef[];
  tags: string[];
  /** True when history hit the cap (older commits omitted). */
  truncated: boolean;
  /** Number of lanes the renderer must allocate vertical space for. */
  laneCount: number;
}

/** Upstream sync status for the current branch. */
export interface UpstreamStatus {
  hasUpstream: boolean;
  upstreamName: string | null;
  ahead: number;
  behind: number;
  /** Whether the repo has any remote configured at all. */
  remoteExists: boolean;
}

/** In-progress merge/pull conflict state. */
export interface ConflictState {
  /** True when a merge/pull is paused mid-conflict. */
  inProgress: boolean;
  /** `"merge"` while paused, otherwise `"none"`. */
  kind: string;
  /** Files with unresolved conflict markers. */
  conflictedFiles: string[];
}

// ── Write ops (mirror git_write.rs) ──

export type GitErrorKind =
  | "dirtyTree"
  | "noUpstream"
  | "detachedHead"
  | "mergeConflict"
  | "nonFastForward"
  | "nothingToCommit"
  | "noRemote"
  | "branchExists"
  | "branchNotFound"
  | "notARepo"
  | "protectedBranch"
  | "invalidName"
  | "unmergedBranch"
  | "unknown";

/** Categorized git-op failure (the Err arm of a write command). */
export interface GitOpError {
  kind: GitErrorKind;
  /** Plain-language, user-facing message. */
  message: string;
  /** Raw git stderr, for diagnostics. */
  raw: string;
  /** Extra context (e.g. dirty/conflicted files). */
  files: string[];
}

/** Everything needed to reverse a completed op via `undoGitOp`. */
export interface UndoToken {
  op: string;
  prevBranch: string | null;
  prevSha: string;
  branchName: string | null;
  undoable: boolean;
}

export interface GitOpResult {
  message: string;
  undo: UndoToken | null;
  newSha: string | null;
  branch: string | null;
}

export interface SwitchPreview {
  dirty: boolean;
  dirtyFiles: string[];
  willChangeFiles: string[];
}

export interface DeletePreview {
  isCurrent: boolean;
  isMerged: boolean;
  unmergedCommits: number;
}

export interface MergePreview {
  fastForward: boolean;
  willConflict: boolean;
  conflictFiles: string[];
  commitsBrought: number;
  filesChanged: number;
  upToDate: boolean;
}

export interface PushPreview {
  remoteExists: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  wouldReject: boolean;
}

/** Narrow an unknown thrown value to a GitOpError shape. */
export function isGitOpError(e: unknown): e is GitOpError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  );
}
