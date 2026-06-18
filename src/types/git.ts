export interface GitStatusInfo {
  is_git_repo: boolean;
  branch: string | null;
  uncommitted_changes: number;
  last_commit_time: string | null;
  last_push_time: string | null;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
}

/** Working-tree diff vs HEAD + numstat counts (camelCase from the Rust `GitDiffResult`). */
export interface GitDiffResult {
  isGitRepo: boolean;
  diff: string;
  added: number;
  removed: number;
  files: number;
  truncated: boolean;
}
