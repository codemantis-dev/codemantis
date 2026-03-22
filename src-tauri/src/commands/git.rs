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
    let limit = max_commits.min(50).max(1);
    let max_arg = format!("--max-count={}", limit);
    // NUL-separated fields: abbreviated hash, subject, author name, ISO date
    let output = run_git(
        &project_path,
        &["log", &max_arg, "--format=%h\x00%s\x00%an\x00%cI"],
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
