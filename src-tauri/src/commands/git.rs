use serde::Serialize;
use std::process::Command;

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
