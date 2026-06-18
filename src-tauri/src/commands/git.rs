use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitStatusInfo {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub uncommitted_changes: u32,
    pub last_commit_time: Option<String>,
    pub last_push_time: Option<String>,
}

fn run_git(cwd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;

    if output.status.success() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    } else {
        None
    }
}

#[tauri::command]
pub fn get_git_status(project_path: String) -> GitStatusInfo {
    // Check if inside a git repo
    let is_git = run_git(&project_path, &["rev-parse", "--is-inside-work-tree"])
        .map(|v| v == "true")
        .unwrap_or(false);

    if !is_git {
        return GitStatusInfo {
            is_git_repo: false,
            branch: None,
            uncommitted_changes: 0,
            last_commit_time: None,
            last_push_time: None,
        };
    }

    let branch = run_git(&project_path, &["rev-parse", "--abbrev-ref", "HEAD"]);

    let uncommitted_changes = run_git(&project_path, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.is_empty()).count() as u32)
        .unwrap_or(0);

    let last_commit_time = run_git(&project_path, &["log", "-1", "--format=%cI"]);

    let last_push_time = branch.as_ref().and_then(|b| {
        let remote_ref = format!("origin/{}", b);
        run_git(&project_path, &["log", "-1", "--format=%cI", &remote_ref])
    });

    GitStatusInfo {
        is_git_repo: true,
        branch,
        uncommitted_changes,
        last_commit_time,
        last_push_time,
    }
}

#[tauri::command]
pub fn get_git_log(project_path: String, max_commits: u32) -> Vec<GitCommit> {
    let limit = max_commits.clamp(1, 50);
    let max_arg = format!("--max-count={}", limit);
    // NUL-separated fields: abbreviated hash, subject, author name, ISO date
    let output = run_git(
        &project_path,
        &["log", &max_arg, "--format=%h%x00%s%x00%an%x00%cI"],
    );

    let Some(raw) = output else {
        return Vec::new();
    };

    raw.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '\0').collect();
            if parts.len() == 4 {
                Some(GitCommit {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    author: parts[2].to_string(),
                    timestamp: parts[3].to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Max diff payload returned to the frontend, in bytes. The Duo mentor reasons
/// over changed code; a multi-megabyte diff would blow the prompt budget, so we
/// truncate and flag it. The numstat counts are always whole-tree.
const MAX_DIFF_BYTES: usize = 60_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub is_git_repo: bool,
    /// `git diff HEAD` content (tracked working-tree changes vs HEAD), possibly truncated.
    pub diff: String,
    pub added: u32,
    pub removed: u32,
    pub files: u32,
    pub truncated: bool,
}

/// Run git capturing stdout even when it is empty (an empty diff is a valid,
/// meaningful result — unlike `run_git`, which collapses empty to `None`).
fn run_git_capture(cwd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

/// Working-tree diff vs HEAD plus numstat-derived counts. Used by Duo-Coding to
/// give the read-only mentor exactly what the primary changed.
#[tauri::command]
pub fn get_git_diff(project_path: String) -> GitDiffResult {
    let is_git = run_git(&project_path, &["rev-parse", "--is-inside-work-tree"])
        .map(|v| v == "true")
        .unwrap_or(false);
    if !is_git {
        return GitDiffResult {
            is_git_repo: false,
            diff: String::new(),
            added: 0,
            removed: 0,
            files: 0,
            truncated: false,
        };
    }

    let raw_diff = run_git_capture(&project_path, &["diff", "HEAD"]).unwrap_or_default();
    let truncated = raw_diff.len() > MAX_DIFF_BYTES;
    let diff = if truncated {
        // Truncate on a char boundary to keep valid UTF-8.
        let mut end = MAX_DIFF_BYTES;
        while end > 0 && !raw_diff.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n…[diff truncated]…", &raw_diff[..end])
    } else {
        raw_diff
    };

    // numstat: one line per file = "<added>\t<removed>\t<path>" ("-" for binary).
    let numstat = run_git_capture(&project_path, &["diff", "HEAD", "--numstat"]).unwrap_or_default();
    let mut added = 0u32;
    let mut removed = 0u32;
    let mut files = 0u32;
    for line in numstat.lines().filter(|l| !l.trim().is_empty()) {
        files += 1;
        let mut cols = line.split('\t');
        if let Some(a) = cols.next() {
            added += a.trim().parse::<u32>().unwrap_or(0);
        }
        if let Some(r) = cols.next() {
            removed += r.trim().parse::<u32>().unwrap_or(0);
        }
    }

    GitDiffResult {
        is_git_repo: true,
        diff,
        added,
        removed,
        files,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a temp git repo with `n` commits and return the temp dir.
    fn temp_git_repo(n: usize) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("create temp dir");
        let p = dir.path().to_str().unwrap();

        run_git_cmd(p, &["init"]);
        run_git_cmd(p, &["config", "user.email", "test@test.com"]);
        run_git_cmd(p, &["config", "user.name", "Test User"]);

        for i in 1..=n {
            let file = dir.path().join(format!("file{}.txt", i));
            fs::write(&file, format!("content {}", i)).unwrap();
            run_git_cmd(p, &["add", "."]);
            run_git_cmd(p, &["commit", "-m", &format!("commit number {}", i)]);
        }
        dir
    }

    /// Helper that panics on failure (test-only).
    fn run_git_cmd(cwd: &str, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git command failed to start");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    // ── get_git_log ──

    #[test]
    fn git_log_returns_commits() {
        let dir = temp_git_repo(5);
        let path = dir.path().to_str().unwrap().to_string();

        let commits = get_git_log(path, 10);
        assert_eq!(commits.len(), 5);
        // Most recent first
        assert_eq!(commits[0].message, "commit number 5");
        assert_eq!(commits[4].message, "commit number 1");
    }

    #[test]
    fn git_log_respects_max_commits() {
        let dir = temp_git_repo(10);
        let path = dir.path().to_str().unwrap().to_string();

        let commits = get_git_log(path, 3);
        assert_eq!(commits.len(), 3);
        assert_eq!(commits[0].message, "commit number 10");
    }

    #[test]
    fn git_log_clamps_max_to_50() {
        let dir = temp_git_repo(2);
        let path = dir.path().to_str().unwrap().to_string();

        // Requesting 100 should be clamped to 50 — but only 2 exist
        let commits = get_git_log(path, 100);
        assert_eq!(commits.len(), 2);
    }

    #[test]
    fn git_log_fields_are_populated() {
        let dir = temp_git_repo(1);
        let path = dir.path().to_str().unwrap().to_string();

        let commits = get_git_log(path, 1);
        assert_eq!(commits.len(), 1);
        let c = &commits[0];
        assert!(!c.hash.is_empty(), "hash should not be empty");
        assert_eq!(c.message, "commit number 1");
        assert_eq!(c.author, "Test User");
        // ISO 8601 timestamp should contain a 'T'
        assert!(c.timestamp.contains('T'), "timestamp should be ISO 8601: {}", c.timestamp);
    }

    #[test]
    fn git_log_empty_repo_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_str().unwrap();
        run_git_cmd(p, &["init"]);
        // No commits yet
        let commits = get_git_log(p.to_string(), 10);
        assert!(commits.is_empty());
    }

    #[test]
    fn git_log_invalid_path_returns_empty() {
        let commits = get_git_log("/nonexistent/path/xyz".to_string(), 10);
        assert!(commits.is_empty());
    }

    // ── get_git_status ──

    #[test]
    fn git_status_detects_repo() {
        let dir = temp_git_repo(1);
        let path = dir.path().to_str().unwrap().to_string();

        let status = get_git_status(path);
        assert!(status.is_git_repo);
        assert!(status.branch.is_some());
        assert!(status.last_commit_time.is_some());
    }

    #[test]
    fn git_status_non_repo_returns_false() {
        let dir = tempfile::tempdir().unwrap();
        let status = get_git_status(dir.path().to_str().unwrap().to_string());
        assert!(!status.is_git_repo);
        assert!(status.branch.is_none());
    }

    #[test]
    fn git_status_counts_uncommitted_changes() {
        let dir = temp_git_repo(1);
        let path = dir.path().to_str().unwrap().to_string();

        // Create an uncommitted file
        fs::write(dir.path().join("new.txt"), "hello").unwrap();

        let status = get_git_status(path);
        assert!(status.uncommitted_changes >= 1);
    }

    // ── run_git helper ──

    #[test]
    fn run_git_returns_none_for_bad_dir() {
        let result = run_git("/nonexistent/path/xyz", &["status"]);
        assert!(result.is_none());
    }

    #[test]
    fn run_git_returns_none_for_failed_command() {
        let dir = tempfile::tempdir().unwrap();
        // Not a git repo, so rev-parse should fail
        let result = run_git(dir.path().to_str().unwrap(), &["rev-parse", "HEAD"]);
        assert!(result.is_none());
    }

    // ── get_git_diff ──

    #[test]
    fn git_diff_non_repo_reports_not_a_repo() {
        let dir = tempfile::tempdir().unwrap();
        let res = get_git_diff(dir.path().to_str().unwrap().to_string());
        assert!(!res.is_git_repo);
        assert_eq!(res.files, 0);
        assert!(res.diff.is_empty());
    }

    #[test]
    fn git_diff_clean_tree_is_empty() {
        let dir = temp_git_repo(1);
        let res = get_git_diff(dir.path().to_str().unwrap().to_string());
        assert!(res.is_git_repo);
        assert_eq!(res.files, 0);
        assert_eq!(res.added, 0);
        assert_eq!(res.removed, 0);
        assert!(!res.truncated);
    }

    #[test]
    fn git_diff_reports_modified_tracked_file() {
        let dir = temp_git_repo(1);
        let p = dir.path().to_str().unwrap();
        // Modify the committed file: replace "content 1" with two new lines.
        fs::write(dir.path().join("file1.txt"), "line a\nline b\n").unwrap();
        let res = get_git_diff(p.to_string());
        assert!(res.is_git_repo);
        assert_eq!(res.files, 1);
        assert!(res.added >= 2, "expected added lines, got {}", res.added);
        assert!(res.diff.contains("file1.txt"));
        assert!(res.diff.contains("line a"));
    }
}
