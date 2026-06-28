//! Branch Map — write side.
//!
//! Guarded branch operations for vibe coders: create / switch / save (commit) /
//! delete, each with a dirty-tree guard where relevant, structured errors the
//! UI turns into plain-language guidance, and an [`UndoToken`] the UI can replay
//! through [`undo_git_op`] for one-click undo.
//!
//! Merge / pull / push live in later phases (`git_write` keeps growing).
//!
//! All shells out to the `git` CLI; all structs are camelCase.

use crate::commands::git::{run_git, run_git_capture};
use serde::{Deserialize, Serialize};
use std::process::Command;

/// Result of running git when we need the exit status + stderr regardless of
/// whether stdout was empty (unlike `run_git`, which collapses empty → None).
pub(crate) struct GitRun {
    pub ok: bool,
    /// Read by merge/push previews in later phases (merge-tree, push --dry-run).
    #[allow(dead_code)]
    pub stdout: String,
    pub stderr: String,
}

pub(crate) fn run_git_full(cwd: &str, args: &[&str]) -> GitRun {
    match Command::new("git").args(args).current_dir(cwd).output() {
        Ok(output) => GitRun {
            ok: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        },
        Err(e) => GitRun {
            ok: false,
            stdout: String::new(),
            stderr: format!("failed to run git: {}", e),
        },
    }
}

/// Categorized failure, so the frontend can show the right plain-language
/// guidance and pick the right affordance.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GitErrorKind {
    DirtyTree,
    NoUpstream,
    DetachedHead,
    MergeConflict,
    NonFastForward,
    NothingToCommit,
    NoRemote,
    BranchExists,
    BranchNotFound,
    NotARepo,
    ProtectedBranch,
    InvalidName,
    UnmergedBranch,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitOpError {
    pub kind: GitErrorKind,
    /// Plain-language, user-facing message.
    pub message: String,
    /// Raw git stderr, for diagnostics (not shown prominently).
    pub raw: String,
    /// Optional extra context the UI can use (e.g. conflicted/changed files).
    #[serde(default)]
    pub files: Vec<String>,
}

impl GitOpError {
    fn new(kind: GitErrorKind, message: impl Into<String>, raw: impl Into<String>) -> Self {
        GitOpError {
            kind,
            message: message.into(),
            raw: raw.into(),
            files: Vec::new(),
        }
    }
    fn with_files(mut self, files: Vec<String>) -> Self {
        self.files = files;
        self
    }
}

/// Everything needed to reverse a completed op via [`undo_git_op`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoToken {
    /// One of: `createBranch`, `switch`, `commit`, `deleteBranch`.
    pub op: String,
    pub prev_branch: Option<String>,
    /// Prior HEAD sha (commit/switch) or deleted branch tip (deleteBranch).
    pub prev_sha: String,
    /// Branch involved (created branch to delete, or deleted branch to recreate).
    pub branch_name: Option<String>,
    pub undoable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitOpResult {
    pub message: String,
    pub undo: Option<UndoToken>,
    pub new_sha: Option<String>,
    pub branch: Option<String>,
}

// ── shared helpers ──

fn is_git_repo(p: &str) -> bool {
    run_git(p, &["rev-parse", "--is-inside-work-tree"])
        .map(|v| v == "true")
        .unwrap_or(false)
}

fn current_branch(p: &str) -> Option<String> {
    run_git(p, &["symbolic-ref", "-q", "--short", "HEAD"])
}

fn head_sha(p: &str) -> Option<String> {
    run_git(p, &["rev-parse", "HEAD"])
}

fn dirty_files(p: &str) -> Vec<String> {
    run_git(p, &["status", "--porcelain"])
        .map(|s| {
            s.lines()
                .filter(|l| !l.trim().is_empty())
                // porcelain lines are "XY <path>"; keep the path part.
                .map(|l| l.get(3..).unwrap_or(l).trim().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn branch_exists(p: &str, name: &str) -> bool {
    run_git(
        p,
        &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{}", name)],
    )
    .is_some()
}

fn not_a_repo_err() -> GitOpError {
    GitOpError::new(
        GitErrorKind::NotARepo,
        "This folder isn't tracking changes yet.",
        "",
    )
}

// ── create_branch ──

#[tauri::command]
pub fn create_branch(
    project_path: String,
    name: String,
    from_ref: Option<String>,
    checkout: bool,
) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(GitOpError::new(
            GitErrorKind::InvalidName,
            "Give your new safe space a name.",
            "",
        ));
    }
    // Validate the name is a legal git branch ref.
    let check = run_git_full(&project_path, &["check-ref-format", &format!("refs/heads/{}", name)]);
    if !check.ok {
        return Err(GitOpError::new(
            GitErrorKind::InvalidName,
            "That name won't work — avoid spaces and symbols like ~ ^ : ? *.",
            check.stderr,
        ));
    }
    if branch_exists(&project_path, &name) {
        return Err(GitOpError::new(
            GitErrorKind::BranchExists,
            format!("A safe space called \"{}\" already exists.", name),
            "",
        ));
    }

    let prev_branch = current_branch(&project_path);

    // Create the branch (optionally from a given ref, else current HEAD).
    let mut args = vec!["branch", &name];
    if let Some(f) = from_ref.as_deref() {
        args.push(f);
    }
    let created = run_git_full(&project_path, &args);
    if !created.ok {
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            "Couldn't create the new safe space.",
            created.stderr,
        ));
    }

    let mut current = prev_branch.clone();
    if checkout {
        let sw = run_git_full(&project_path, &["switch", &name]);
        if !sw.ok {
            // Branch was created but we couldn't switch (likely a dirty tree
            // vs a different start point). Leave the branch; report cleanly.
            return Err(GitOpError::new(
                GitErrorKind::DirtyTree,
                "Created the space, but couldn't switch into it — save or undo your current changes first.",
                sw.stderr,
            )
            .with_files(dirty_files(&project_path)));
        }
        current = Some(name.clone());
    }

    Ok(GitOpResult {
        message: format!("Created a new safe space \"{}\".", name),
        undo: Some(UndoToken {
            op: "createBranch".to_string(),
            prev_branch,
            prev_sha: head_sha(&project_path).unwrap_or_default(),
            branch_name: Some(name),
            undoable: true,
        }),
        new_sha: None,
        branch: current,
    })
}

// ── switch_branch ──

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchPreview {
    pub dirty: bool,
    pub dirty_files: Vec<String>,
    /// Files that look different between HEAD and the target branch.
    pub will_change_files: Vec<String>,
}

#[tauri::command]
pub fn switch_branch_preview(project_path: String, name: String) -> SwitchPreview {
    let dirty_files = dirty_files(&project_path);
    let will_change_files = run_git(&project_path, &["diff", "--name-only", "HEAD", &name])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).map(|l| l.to_string()).collect())
        .unwrap_or_default();
    SwitchPreview {
        dirty: !dirty_files.is_empty(),
        dirty_files,
        will_change_files,
    }
}

#[tauri::command]
pub fn switch_branch(project_path: String, name: String) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    // Refuse on a dirty tree — never force or auto-stash.
    let dirty = dirty_files(&project_path);
    if !dirty.is_empty() {
        return Err(GitOpError::new(
            GitErrorKind::DirtyTree,
            "You have unsaved changes. Save a checkpoint (or undo them) before switching.",
            "",
        )
        .with_files(dirty));
    }

    let prev_branch = current_branch(&project_path);
    let prev_sha = head_sha(&project_path).unwrap_or_default();

    let sw = run_git_full(&project_path, &["switch", &name]);
    if !sw.ok {
        let kind = if sw.stderr.contains("invalid reference") || sw.stderr.contains("unknown") {
            GitErrorKind::BranchNotFound
        } else {
            GitErrorKind::Unknown
        };
        return Err(GitOpError::new(
            kind,
            format!("Couldn't switch to \"{}\".", name),
            sw.stderr,
        ));
    }

    Ok(GitOpResult {
        message: format!("Switched to \"{}\".", name),
        undo: prev_branch.as_ref().map(|pb| UndoToken {
            op: "switch".to_string(),
            prev_branch: Some(pb.clone()),
            prev_sha,
            branch_name: None,
            undoable: true,
        }),
        new_sha: None,
        branch: Some(name),
    })
}

// ── git_commit (save a checkpoint) ──

#[tauri::command]
pub fn git_commit(project_path: String, message: String) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err(GitOpError::new(
            GitErrorKind::InvalidName,
            "Add a short note about what you changed.",
            "",
        ));
    }
    if dirty_files(&project_path).is_empty() {
        return Err(GitOpError::new(
            GitErrorKind::NothingToCommit,
            "There's nothing new to save yet.",
            "",
        ));
    }

    let prev_sha = head_sha(&project_path).unwrap_or_default();

    let add = run_git_full(&project_path, &["add", "-A"]);
    if !add.ok {
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            "Couldn't stage your changes.",
            add.stderr,
        ));
    }
    let commit = run_git_full(&project_path, &["commit", "-m", &message]);
    if !commit.ok {
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            "Couldn't save the checkpoint.",
            commit.stderr,
        ));
    }

    // `prev_sha` empty means this was the first-ever commit — undo (reset to a
    // parent) isn't possible, so flag it not-undoable.
    let undoable = !prev_sha.is_empty();
    Ok(GitOpResult {
        message: "Checkpoint saved.".to_string(),
        undo: Some(UndoToken {
            op: "commit".to_string(),
            prev_branch: current_branch(&project_path),
            prev_sha,
            branch_name: None,
            undoable,
        }),
        new_sha: head_sha(&project_path),
        branch: current_branch(&project_path),
    })
}

// ── delete_branch ──

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeletePreview {
    pub is_current: bool,
    pub is_merged: bool,
    /// Checkpoints on this branch that aren't in your current branch.
    pub unmerged_commits: u32,
}

#[tauri::command]
pub fn delete_branch_preview(project_path: String, name: String) -> DeletePreview {
    let is_current = current_branch(&project_path).as_deref() == Some(name.as_str());
    let unmerged_commits = run_git(
        &project_path,
        &["rev-list", "--count", &format!("HEAD..{}", name)],
    )
    .and_then(|s| s.trim().parse::<u32>().ok())
    .unwrap_or(0);
    DeletePreview {
        is_current,
        is_merged: unmerged_commits == 0,
        unmerged_commits,
    }
}

#[tauri::command]
pub fn delete_branch(
    project_path: String,
    name: String,
    force: bool,
) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    if current_branch(&project_path).as_deref() == Some(name.as_str()) {
        return Err(GitOpError::new(
            GitErrorKind::ProtectedBranch,
            "You're currently in this space. Switch to another one first.",
            "",
        ));
    }

    // Capture the tip so we can recreate it on undo.
    let tip = run_git(&project_path, &["rev-parse", &name]).unwrap_or_default();

    let flag = if force { "-D" } else { "-d" };
    let del = run_git_full(&project_path, &["branch", flag, &name]);
    if !del.ok {
        if del.stderr.contains("not fully merged") {
            return Err(GitOpError::new(
                GitErrorKind::UnmergedBranch,
                "This space has checkpoints that aren't in your current branch — deleting loses them.",
                del.stderr,
            ));
        }
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            format!("Couldn't delete \"{}\".", name),
            del.stderr,
        ));
    }

    Ok(GitOpResult {
        message: format!("Deleted the space \"{}\".", name),
        undo: Some(UndoToken {
            op: "deleteBranch".to_string(),
            prev_branch: None,
            prev_sha: tip,
            branch_name: Some(name),
            undoable: true,
        }),
        new_sha: None,
        branch: current_branch(&project_path),
    })
}

// ── undo ──

#[tauri::command]
pub fn undo_git_op(project_path: String, token: UndoToken) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    if !token.undoable {
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            "This action can't be undone.",
            "",
        ));
    }

    match token.op.as_str() {
        "createBranch" => {
            // Switch back first (if we had checked out the new branch), then delete it.
            if let Some(prev) = token.prev_branch.as_deref() {
                let _ = run_git_full(&project_path, &["switch", prev]);
            }
            if let Some(branch) = token.branch_name.as_deref() {
                let del = run_git_full(&project_path, &["branch", "-D", branch]);
                if !del.ok {
                    return Err(GitOpError::new(
                        GitErrorKind::Unknown,
                        "Couldn't undo creating the space.",
                        del.stderr,
                    ));
                }
            }
            Ok(GitOpResult {
                message: "Undone.".to_string(),
                undo: None,
                new_sha: None,
                branch: current_branch(&project_path),
            })
        }
        "switch" => {
            let target = token.prev_branch.as_deref().ok_or_else(|| {
                GitOpError::new(GitErrorKind::Unknown, "Nothing to switch back to.", "")
            })?;
            let sw = run_git_full(&project_path, &["switch", target]);
            if !sw.ok {
                return Err(GitOpError::new(
                    GitErrorKind::Unknown,
                    "Couldn't switch back.",
                    sw.stderr,
                ));
            }
            Ok(GitOpResult {
                message: format!("Switched back to \"{}\".", target),
                undo: None,
                new_sha: None,
                branch: Some(target.to_string()),
            })
        }
        "commit" => {
            let reset = run_git_full(&project_path, &["reset", "--soft", "HEAD~1"]);
            if !reset.ok {
                return Err(GitOpError::new(
                    GitErrorKind::Unknown,
                    "Couldn't undo the checkpoint.",
                    reset.stderr,
                ));
            }
            Ok(GitOpResult {
                message: "Checkpoint undone — your changes are kept.".to_string(),
                undo: None,
                new_sha: head_sha(&project_path),
                branch: current_branch(&project_path),
            })
        }
        "merge" | "pull" => {
            // Roll HEAD back to before the merge/pull. The tree was clean going
            // in (we guard on dirty), so a hard reset is safe.
            if token.prev_sha.is_empty() {
                return Err(GitOpError::new(GitErrorKind::Unknown, "Nothing to undo.", ""));
            }
            let reset = run_git_full(&project_path, &["reset", "--hard", &token.prev_sha]);
            if !reset.ok {
                return Err(GitOpError::new(
                    GitErrorKind::Unknown,
                    "Couldn't undo that.",
                    reset.stderr,
                ));
            }
            Ok(GitOpResult {
                message: "Undone — back to where you were.".to_string(),
                undo: None,
                new_sha: head_sha(&project_path),
                branch: current_branch(&project_path),
            })
        }
        "deleteBranch" => {
            let branch = token.branch_name.as_deref().ok_or_else(|| {
                GitOpError::new(GitErrorKind::Unknown, "Nothing to restore.", "")
            })?;
            if token.prev_sha.is_empty() {
                return Err(GitOpError::new(
                    GitErrorKind::Unknown,
                    "Couldn't restore the space.",
                    "",
                ));
            }
            let recreate = run_git_full(&project_path, &["branch", branch, &token.prev_sha]);
            if !recreate.ok {
                return Err(GitOpError::new(
                    GitErrorKind::Unknown,
                    "Couldn't restore the space.",
                    recreate.stderr,
                ));
            }
            Ok(GitOpResult {
                message: format!("Restored the space \"{}\".", branch),
                undo: None,
                new_sha: None,
                branch: current_branch(&project_path),
            })
        }
        other => Err(GitOpError::new(
            GitErrorKind::Unknown,
            "Don't know how to undo that.",
            other.to_string(),
        )),
    }
}

// ── merge ──

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    /// True when the merge would just fast-forward (no real combining needed).
    pub fast_forward: bool,
    pub will_conflict: bool,
    pub conflict_files: Vec<String>,
    /// Checkpoints the source brings in that the current branch doesn't have.
    pub commits_brought: u32,
    pub files_changed: u32,
    /// True when there's nothing to bring in (already up to date).
    pub up_to_date: bool,
}

#[tauri::command]
pub fn merge_branch_preview(project_path: String, source: String) -> MergePreview {
    let commits_brought = run_git(
        &project_path,
        &["rev-list", "--count", &format!("HEAD..{}", source)],
    )
    .and_then(|s| s.trim().parse::<u32>().ok())
    .unwrap_or(0);

    let files_changed = run_git(&project_path, &["diff", "--name-only", "HEAD", &source])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);

    // FF possible when HEAD is an ancestor of source.
    let fast_forward = run_git_full(
        &project_path,
        &["merge-base", "--is-ancestor", "HEAD", &source],
    )
    .ok;

    // Detect conflicts WITHOUT touching the working tree (git ≥ 2.38).
    let mt = run_git_full(
        &project_path,
        &["merge-tree", "--write-tree", "--name-only", "HEAD", &source],
    );
    // Exit 0 = clean merge tree, 1 = conflicts, other = unsupported/error.
    let will_conflict = !mt.ok && !mt.stdout.is_empty();
    let conflict_files = if will_conflict {
        // Output: <tree-oid> line, then conflicted paths.
        mt.stdout
            .lines()
            .skip(1)
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect()
    } else {
        Vec::new()
    };

    MergePreview {
        fast_forward,
        will_conflict,
        conflict_files,
        commits_brought,
        files_changed,
        up_to_date: commits_brought == 0,
    }
}

#[tauri::command]
pub fn merge_branch(project_path: String, source: String) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    // Never merge into a dirty tree.
    let dirty = dirty_files(&project_path);
    if !dirty.is_empty() {
        return Err(GitOpError::new(
            GitErrorKind::DirtyTree,
            "Save a checkpoint (or undo your changes) before bringing in another space.",
            "",
        )
        .with_files(dirty));
    }

    let brought = run_git(
        &project_path,
        &["rev-list", "--count", &format!("HEAD..{}", source)],
    )
    .and_then(|s| s.trim().parse::<u32>().ok())
    .unwrap_or(0);
    if brought == 0 {
        return Ok(GitOpResult {
            message: format!("\"{}\" is already part of this branch — nothing to bring in.", source),
            undo: None,
            new_sha: None,
            branch: current_branch(&project_path),
        });
    }

    let prev_sha = head_sha(&project_path).unwrap_or_default();

    // Always create a merge commit so the whole merge is one undoable unit.
    let merge = run_git_full(&project_path, &["merge", "--no-ff", &source]);
    if !merge.ok {
        // Conflict? Leave the repo mid-merge (do NOT auto-abort) so the user
        // can choose to undo or have the agent resolve it.
        let conflicted: Vec<String> =
            run_git_capture(&project_path, &["diff", "--name-only", "--diff-filter=U"])
                .unwrap_or_default()
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| l.to_string())
                .collect();
        if !conflicted.is_empty() {
            return Err(GitOpError::new(
                GitErrorKind::MergeConflict,
                "Some changes overlap and need a careful merge.",
                merge.stderr,
            )
            .with_files(conflicted));
        }
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            format!("Couldn't bring in \"{}\".", source),
            merge.stderr,
        ));
    }

    Ok(GitOpResult {
        message: format!("\"{}\" is now part of this branch.", source),
        undo: Some(UndoToken {
            op: "merge".to_string(),
            prev_branch: current_branch(&project_path),
            prev_sha,
            branch_name: None,
            undoable: true,
        }),
        new_sha: head_sha(&project_path),
        branch: current_branch(&project_path),
    })
}

/// Abort an in-progress (conflicted) merge or pull, returning to safety.
#[tauri::command]
pub fn abort_merge(project_path: String) -> Result<GitOpResult, GitOpError> {
    let abort = run_git_full(&project_path, &["merge", "--abort"]);
    if !abort.ok {
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            "Couldn't undo the merge.",
            abort.stderr,
        ));
    }
    Ok(GitOpResult {
        message: "Merge undone — back to where you were.".to_string(),
        undo: None,
        new_sha: None,
        branch: current_branch(&project_path),
    })
}

// ── pull (get latest) ──

#[tauri::command]
pub fn git_pull(project_path: String) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    if run_git(&project_path, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_none() {
        return Err(GitOpError::new(
            GitErrorKind::NoUpstream,
            "This branch isn't backed up online yet, so there's nothing to pull.",
            "",
        ));
    }
    let dirty = dirty_files(&project_path);
    if !dirty.is_empty() {
        return Err(GitOpError::new(
            GitErrorKind::DirtyTree,
            "Save a checkpoint before getting the latest from online.",
            "",
        )
        .with_files(dirty));
    }

    let prev_sha = head_sha(&project_path).unwrap_or_default();
    // Fast-forward only: clean, no surprise merge commits.
    let pull = run_git_full(&project_path, &["pull", "--ff-only"]);
    if !pull.ok {
        let kind = if pull.stderr.contains("Not possible to fast-forward")
            || pull.stderr.contains("diverging")
            || pull.stderr.contains("non-fast-forward")
        {
            GitErrorKind::NonFastForward
        } else {
            GitErrorKind::Unknown
        };
        return Err(GitOpError::new(
            kind,
            "The online version has changes that need to be combined with yours.",
            pull.stderr,
        ));
    }

    let after = head_sha(&project_path).unwrap_or_default();
    let changed = after != prev_sha;
    Ok(GitOpResult {
        message: if changed {
            "Got the latest from online.".to_string()
        } else {
            "Already up to date with online.".to_string()
        },
        undo: if changed && !prev_sha.is_empty() {
            Some(UndoToken {
                op: "pull".to_string(),
                prev_branch: current_branch(&project_path),
                prev_sha,
                branch_name: None,
                undoable: true,
            })
        } else {
            None
        },
        new_sha: Some(after),
        branch: current_branch(&project_path),
    })
}

// ── push / publish (back it up online) ──

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushPreview {
    pub remote_exists: bool,
    pub has_upstream: bool,
    /// Checkpoints to send up (ahead of online).
    pub ahead: u32,
    /// Checkpoints to bring down (behind online).
    pub behind: u32,
    /// True when online has changes that would reject a plain push.
    pub would_reject: bool,
}

fn ahead_behind(project_path: &str) -> (u32, u32) {
    run_git(
        project_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .map(|s| {
        let mut cols = s.split_whitespace();
        let a = cols.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        let b = cols.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        (a, b)
    })
    .unwrap_or((0, 0))
}

#[tauri::command]
pub fn git_push_preview(project_path: String) -> PushPreview {
    let remote_exists = run_git(&project_path, &["remote"]).is_some();
    let has_upstream =
        run_git(&project_path, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_some();
    let (ahead, behind) = if has_upstream {
        ahead_behind(&project_path)
    } else {
        (0, 0)
    };
    // A plain push is rejected when online has commits we don't (behind > 0).
    let would_reject = has_upstream && behind > 0;
    PushPreview {
        remote_exists,
        has_upstream,
        ahead,
        behind,
        would_reject,
    }
}

#[tauri::command]
pub fn git_push(project_path: String) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    if run_git(&project_path, &["remote"]).is_none() {
        return Err(GitOpError::new(
            GitErrorKind::NoRemote,
            "No online backup is connected to this project yet.",
            "",
        ));
    }
    if run_git(&project_path, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_none() {
        return Err(GitOpError::new(
            GitErrorKind::NoUpstream,
            "This branch isn't backed up online yet — publish it first.",
            "",
        ));
    }

    let push = run_git_full(&project_path, &["push"]);
    if !push.ok {
        let kind = if push.stderr.contains("rejected") || push.stderr.contains("non-fast-forward") {
            GitErrorKind::NonFastForward
        } else {
            GitErrorKind::Unknown
        };
        let message = if kind == GitErrorKind::NonFastForward {
            "Online has changes you don't have yet. Get the latest first, then back up."
        } else {
            "Couldn't back up online."
        };
        return Err(GitOpError::new(kind, message, push.stderr));
    }

    // Pushing is published — there's no safe undo. The preview/confirm is the guard.
    Ok(GitOpResult {
        message: "Backed up online.".to_string(),
        undo: None,
        new_sha: None,
        branch: current_branch(&project_path),
    })
}

/// Publish the current branch online for the first time (`push -u origin`).
#[tauri::command]
pub fn publish_branch(project_path: String) -> Result<GitOpResult, GitOpError> {
    if !is_git_repo(&project_path) {
        return Err(not_a_repo_err());
    }
    let branch = current_branch(&project_path).ok_or_else(|| {
        GitOpError::new(
            GitErrorKind::DetachedHead,
            "Switch to a branch before publishing it online.",
            "",
        )
    })?;
    if run_git(&project_path, &["remote"]).is_none() {
        return Err(GitOpError::new(
            GitErrorKind::NoRemote,
            "No online backup is connected to this project yet.",
            "",
        ));
    }

    let push = run_git_full(&project_path, &["push", "-u", "origin", &branch]);
    if !push.ok {
        return Err(GitOpError::new(
            GitErrorKind::Unknown,
            "Couldn't publish this branch online.",
            push.stderr,
        ));
    }
    Ok(GitOpResult {
        message: format!("Published \"{}\" online — changes back up here from now on.", branch),
        undo: None,
        new_sha: None,
        branch: Some(branch),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn git(cwd: &str, args: &[&str]) {
        let out = Command::new("git").args(args).current_dir(cwd).output().expect("git start");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_str().unwrap();
        git(p, &["init"]);
        git(p, &["config", "user.email", "t@t.com"]);
        git(p, &["config", "user.name", "T"]);
        git(p, &["checkout", "-b", "main"]);
        fs::write(dir.path().join("a.txt"), "1\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-m", "base"]);
        dir
    }

    fn write(dir: &tempfile::TempDir, name: &str, content: &str) {
        fs::write(dir.path().join(name), content).unwrap();
    }

    fn path(dir: &tempfile::TempDir) -> String {
        dir.path().to_str().unwrap().to_string()
    }

    // ── create_branch ──

    #[test]
    fn create_branch_creates_and_checks_out() {
        let dir = repo();
        let r = create_branch(path(&dir), "feature".into(), None, true).unwrap();
        assert_eq!(r.branch.as_deref(), Some("feature"));
        assert!(branch_exists(&path(&dir), "feature"));
        assert!(r.undo.is_some());
    }

    #[test]
    fn create_branch_no_checkout_stays_put() {
        let dir = repo();
        let r = create_branch(path(&dir), "feature".into(), None, false).unwrap();
        assert_eq!(r.branch.as_deref(), Some("main"));
        assert_eq!(current_branch(&path(&dir)).as_deref(), Some("main"));
    }

    #[test]
    fn create_branch_rejects_duplicate() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, false).unwrap();
        let err = create_branch(path(&dir), "feature".into(), None, false).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::BranchExists);
    }

    #[test]
    fn create_branch_rejects_invalid_name() {
        let dir = repo();
        let err = create_branch(path(&dir), "bad name~".into(), None, false).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::InvalidName);
    }

    #[test]
    fn create_branch_rejects_empty_name() {
        let dir = repo();
        let err = create_branch(path(&dir), "   ".into(), None, false).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::InvalidName);
    }

    // ── switch_branch ──

    #[test]
    fn switch_branch_moves_and_offers_undo() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, false).unwrap();
        let r = switch_branch(path(&dir), "feature".into()).unwrap();
        assert_eq!(r.branch.as_deref(), Some("feature"));
        assert_eq!(r.undo.as_ref().unwrap().prev_branch.as_deref(), Some("main"));
    }

    #[test]
    fn switch_branch_refuses_on_dirty_tree() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, false).unwrap();
        write(&dir, "a.txt", "changed\n"); // unsaved change
        let err = switch_branch(path(&dir), "feature".into()).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::DirtyTree);
        // The branch must NOT have changed.
        assert_eq!(current_branch(&path(&dir)).as_deref(), Some("main"));
        assert!(!err.files.is_empty());
    }

    #[test]
    fn switch_branch_preview_reports_dirty() {
        let dir = repo();
        write(&dir, "a.txt", "changed\n");
        let p = switch_branch_preview(path(&dir), "main".into());
        assert!(p.dirty);
        assert!(!p.dirty_files.is_empty());
    }

    // ── git_commit ──

    #[test]
    fn git_commit_saves_dirty_tree_with_undo() {
        let dir = repo();
        write(&dir, "b.txt", "new\n");
        let r = git_commit(path(&dir), "added b".into()).unwrap();
        assert!(r.new_sha.is_some());
        let undo = r.undo.unwrap();
        assert!(undo.undoable);
        assert_eq!(undo.op, "commit");
    }

    #[test]
    fn git_commit_nothing_to_commit() {
        let dir = repo();
        let err = git_commit(path(&dir), "x".into()).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::NothingToCommit);
    }

    #[test]
    fn git_commit_requires_message() {
        let dir = repo();
        write(&dir, "b.txt", "new\n");
        let err = git_commit(path(&dir), "  ".into()).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::InvalidName);
    }

    #[test]
    fn git_commit_undo_resets_soft_keeping_changes() {
        let dir = repo();
        write(&dir, "b.txt", "new\n");
        let before = head_sha(&path(&dir)).unwrap();
        let r = git_commit(path(&dir), "added b".into()).unwrap();
        let after = head_sha(&path(&dir)).unwrap();
        assert_ne!(before, after);
        undo_git_op(path(&dir), r.undo.unwrap()).unwrap();
        // HEAD is back, and the change is still on disk (uncommitted).
        assert_eq!(head_sha(&path(&dir)).unwrap(), before);
        assert!(!dirty_files(&path(&dir)).is_empty());
    }

    // ── delete_branch ──

    #[test]
    fn delete_branch_removes_merged_branch_and_can_restore() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, false).unwrap();
        let r = delete_branch(path(&dir), "feature".into(), false).unwrap();
        assert!(!branch_exists(&path(&dir), "feature"));
        // Undo recreates it at the saved tip.
        undo_git_op(path(&dir), r.undo.unwrap()).unwrap();
        assert!(branch_exists(&path(&dir), "feature"));
    }

    #[test]
    fn delete_branch_protects_current() {
        let dir = repo();
        let err = delete_branch(path(&dir), "main".into(), false).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::ProtectedBranch);
    }

    #[test]
    fn delete_branch_refuses_unmerged_without_force() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, true).unwrap();
        write(&dir, "c.txt", "feat\n");
        git_commit(path(&dir), "feature work".into()).unwrap();
        switch_branch(path(&dir), "main".into()).unwrap();
        let err = delete_branch(path(&dir), "feature".into(), false).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::UnmergedBranch);
        // Force deletes it.
        let r = delete_branch(path(&dir), "feature".into(), true).unwrap();
        assert!(!branch_exists(&path(&dir), "feature"));
        assert!(r.undo.is_some());
    }

    #[test]
    fn delete_branch_preview_counts_unmerged() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, true).unwrap();
        write(&dir, "c.txt", "feat\n");
        git_commit(path(&dir), "feature work".into()).unwrap();
        switch_branch(path(&dir), "main".into()).unwrap();
        let p = delete_branch_preview(path(&dir), "feature".into());
        assert!(!p.is_current);
        assert!(!p.is_merged);
        assert_eq!(p.unmerged_commits, 1);
    }

    // ── undo switch / create ──

    #[test]
    fn undo_switch_returns_to_previous_branch() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, false).unwrap();
        let r = switch_branch(path(&dir), "feature".into()).unwrap();
        undo_git_op(path(&dir), r.undo.unwrap()).unwrap();
        assert_eq!(current_branch(&path(&dir)).as_deref(), Some("main"));
    }

    #[test]
    fn undo_create_deletes_branch_and_switches_back() {
        let dir = repo();
        let r = create_branch(path(&dir), "feature".into(), None, true).unwrap();
        assert_eq!(current_branch(&path(&dir)).as_deref(), Some("feature"));
        undo_git_op(path(&dir), r.undo.unwrap()).unwrap();
        assert_eq!(current_branch(&path(&dir)).as_deref(), Some("main"));
        assert!(!branch_exists(&path(&dir), "feature"));
    }

    #[test]
    fn undo_rejects_non_undoable_token() {
        let dir = repo();
        let token = UndoToken {
            op: "commit".into(),
            prev_branch: None,
            prev_sha: "x".into(),
            branch_name: None,
            undoable: false,
        };
        assert!(undo_git_op(path(&dir), token).is_err());
    }

    // ── merge ──

    /// main and `feature` each change a different file (clean merge).
    fn clean_divergence() -> tempfile::TempDir {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, true).unwrap();
        write(&dir, "feat.txt", "feature\n");
        git_commit(path(&dir), "feature work".into()).unwrap();
        switch_branch(path(&dir), "main".into()).unwrap();
        write(&dir, "main.txt", "main\n");
        git_commit(path(&dir), "main work".into()).unwrap();
        dir
    }

    /// main and `feature` both change the SAME file's same region (conflict).
    fn conflicting_divergence() -> tempfile::TempDir {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, true).unwrap();
        write(&dir, "a.txt", "feature change\n");
        git_commit(path(&dir), "feature edit".into()).unwrap();
        switch_branch(path(&dir), "main".into()).unwrap();
        write(&dir, "a.txt", "main change\n");
        git_commit(path(&dir), "main edit".into()).unwrap();
        dir
    }

    #[test]
    fn merge_preview_clean_has_no_conflicts() {
        let dir = clean_divergence();
        let p = merge_branch_preview(path(&dir), "feature".into());
        assert!(!p.will_conflict);
        assert!(p.conflict_files.is_empty());
        assert_eq!(p.commits_brought, 1);
        assert!(!p.up_to_date);
    }

    #[test]
    fn merge_preview_detects_conflict_without_touching_tree() {
        let dir = conflicting_divergence();
        let head_before = head_sha(&path(&dir)).unwrap();
        let p = merge_branch_preview(path(&dir), "feature".into());
        assert!(p.will_conflict);
        assert!(p.conflict_files.iter().any(|f| f == "a.txt"));
        // The load-bearing safety property: preview changed NOTHING.
        assert_eq!(head_sha(&path(&dir)).unwrap(), head_before);
        assert!(dirty_files(&path(&dir)).is_empty());
        // And no merge is in progress.
        assert!(run_git(&path(&dir), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_none());
    }

    #[test]
    fn merge_clean_creates_commit_and_undoes() {
        let dir = clean_divergence();
        let before = head_sha(&path(&dir)).unwrap();
        let r = merge_branch(path(&dir), "feature".into()).unwrap();
        let after = head_sha(&path(&dir)).unwrap();
        assert_ne!(before, after);
        // feat.txt now exists on main.
        assert!(dir.path().join("feat.txt").exists());
        // Undo (reset --hard) restores the pre-merge HEAD.
        undo_git_op(path(&dir), r.undo.unwrap()).unwrap();
        assert_eq!(head_sha(&path(&dir)).unwrap(), before);
    }

    #[test]
    fn merge_conflict_returns_error_and_leaves_repo_mid_merge() {
        let dir = conflicting_divergence();
        let err = merge_branch(path(&dir), "feature".into()).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::MergeConflict);
        assert!(err.files.iter().any(|f| f == "a.txt"));
        // NOT auto-aborted — the repo is paused mid-merge so the user can choose.
        assert!(run_git(&path(&dir), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_some());
        // abort_merge returns to safety.
        abort_merge(path(&dir)).unwrap();
        assert!(run_git(&path(&dir), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_none());
    }

    #[test]
    fn merge_up_to_date_is_a_noop() {
        let dir = repo();
        create_branch(path(&dir), "feature".into(), None, false).unwrap();
        // feature == main, nothing to bring in.
        let r = merge_branch(path(&dir), "feature".into()).unwrap();
        assert!(r.undo.is_none());
        assert!(r.message.contains("nothing to bring in"));
    }

    #[test]
    fn merge_refuses_dirty_tree() {
        let dir = clean_divergence();
        write(&dir, "main.txt", "uncommitted\n");
        let err = merge_branch(path(&dir), "feature".into()).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::DirtyTree);
    }

    // ── pull ──

    #[test]
    fn pull_without_upstream_reports_no_upstream() {
        let dir = repo();
        let err = git_pull(path(&dir)).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::NoUpstream);
    }

    #[test]
    fn pull_fast_forwards_from_origin() {
        // origin gets a new commit; a clone pulls it (ff-only).
        let origin = repo();
        let origin_p = path(&origin);
        let clone_dir = tempfile::tempdir().unwrap();
        let clone_p = clone_dir.path().to_str().unwrap().to_string();
        git(".", &["clone", &origin_p, &clone_p]);
        git(&clone_p, &["config", "user.email", "t@t.com"]);
        git(&clone_p, &["config", "user.name", "T"]);
        // Advance origin.
        fs::write(origin.path().join("new.txt"), "x\n").unwrap();
        git(&origin_p, &["add", "."]);
        git(&origin_p, &["commit", "-m", "origin advance"]);

        let before = head_sha(&clone_p).unwrap();
        let r = git_pull(clone_p.clone()).unwrap();
        let after = head_sha(&clone_p).unwrap();
        assert_ne!(before, after);
        assert!(clone_dir.path().join("new.txt").exists());
        // Undo restores the pre-pull HEAD.
        undo_git_op(clone_p.clone(), r.undo.unwrap()).unwrap();
        assert_eq!(head_sha(&clone_p).unwrap(), before);
    }

    // ── push / publish ──

    /// A bare origin plus a working clone with `origin/main` upstream set.
    fn clone_with_origin() -> (tempfile::TempDir, tempfile::TempDir, String) {
        let source = repo();
        let source_p = path(&source);
        let bare = tempfile::tempdir().unwrap();
        let bare_p = bare.path().to_str().unwrap().to_string();
        git(".", &["clone", "--bare", &source_p, &bare_p]);
        let work = tempfile::tempdir().unwrap();
        let work_p = work.path().to_str().unwrap().to_string();
        git(".", &["clone", &bare_p, &work_p]);
        git(&work_p, &["config", "user.email", "t@t.com"]);
        git(&work_p, &["config", "user.name", "T"]);
        // Keep `source` alive via leak so the bytes stay valid for the test.
        std::mem::forget(source);
        (work, bare, work_p)
    }

    #[test]
    fn push_without_remote_reports_no_remote() {
        let dir = repo();
        let err = git_push(path(&dir)).unwrap_err();
        assert_eq!(err.kind, GitErrorKind::NoRemote);
    }

    #[test]
    fn push_preview_reports_ahead_after_local_commit() {
        let (work, _bare, work_p) = clone_with_origin();
        fs::write(work.path().join("local.txt"), "x\n").unwrap();
        git(&work_p, &["add", "."]);
        git(&work_p, &["commit", "-m", "local"]);
        let p = git_push_preview(work_p.clone());
        assert!(p.remote_exists);
        assert!(p.has_upstream);
        assert_eq!(p.ahead, 1);
        assert!(!p.would_reject);
    }

    #[test]
    fn push_sends_commits_to_origin() {
        let (work, bare, work_p) = clone_with_origin();
        fs::write(work.path().join("local.txt"), "x\n").unwrap();
        git(&work_p, &["add", "."]);
        git(&work_p, &["commit", "-m", "local"]);
        let local_head = head_sha(&work_p).unwrap();

        let r = git_push(work_p.clone()).unwrap();
        assert!(r.undo.is_none(), "push is not undoable");

        // The bare origin now has our commit.
        let bare_p = bare.path().to_str().unwrap();
        let origin_head = run_git(bare_p, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(origin_head, local_head);
    }

    #[test]
    fn publish_branch_sets_upstream_and_pushes() {
        let (work, bare, work_p) = clone_with_origin();
        // A brand-new local branch has no upstream yet.
        create_branch(work_p.clone(), "experiment".into(), None, true).unwrap();
        fs::write(work.path().join("e.txt"), "e\n").unwrap();
        git(&work_p, &["add", "."]);
        git(&work_p, &["commit", "-m", "exp"]);
        // Plain push has no upstream → NoUpstream.
        assert_eq!(git_push(work_p.clone()).unwrap_err().kind, GitErrorKind::NoUpstream);
        // Publish sets it and pushes.
        publish_branch(work_p.clone()).unwrap();
        let bare_p = bare.path().to_str().unwrap();
        assert!(run_git(bare_p, &["rev-parse", "experiment"]).is_some());
    }

    #[test]
    fn write_ops_reject_non_repo() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_str().unwrap().to_string();
        assert_eq!(
            create_branch(p.clone(), "x".into(), None, false).unwrap_err().kind,
            GitErrorKind::NotARepo
        );
        assert_eq!(
            switch_branch(p.clone(), "x".into()).unwrap_err().kind,
            GitErrorKind::NotARepo
        );
        assert_eq!(
            git_commit(p, "x".into()).unwrap_err().kind,
            GitErrorKind::NotARepo
        );
    }
}
