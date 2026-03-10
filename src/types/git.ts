export interface GitStatusInfo {
  is_git_repo: boolean;
  branch: string | null;
  uncommitted_changes: number;
  last_commit_time: string | null;
  last_push_time: string | null;
}
