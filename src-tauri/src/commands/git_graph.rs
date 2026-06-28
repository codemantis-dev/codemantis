//! Branch Map — read side.
//!
//! Supplies the rich, render-ready branch graph the frontend swim-lane view
//! draws. Everything shells out to the `git` CLI through the shared
//! [`run_git`](crate::commands::git::run_git) /
//! [`run_git_capture`](crate::commands::git::run_git_capture) helpers — no
//! `git2`/libgit2 dependency, matching the rest of `commands::git`.
//!
//! Lane assignment (the swim-lane index each commit rides on) is computed here
//! in Rust via a deterministic DAG walk so the React layer stays a pure view.
//!
//! NOTE on serde naming: every struct in this module uses
//! `#[serde(rename_all = "camelCase")]` (like the existing `GitDiffResult`).
//! The legacy `GitStatusInfo`/`GitCommit` in `commands::git` are snake_case and
//! are intentionally left untouched.

use crate::commands::git::{run_git, run_git_capture};
use serde::Serialize;

/// Hard cap on how many commits the graph walks. Larger than the 50-commit log
/// cap (a graph wants more history) but bounded so large repos stay responsive —
/// the whole walk is two `git` spawns regardless of repo size.
const MAX_GRAPH_COMMITS: u32 = 200;

/// One commit in the branch graph, with everything the renderer needs.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    /// Full 40-char SHA — the stable key.
    pub hash: String,
    /// Abbreviated hash (`%h`) for display.
    pub short_hash: String,
    /// Full parent SHAs. 0 = root, 1 = normal, 2+ = merge commit.
    pub parents: Vec<String>,
    /// Commit subject (`%s`).
    pub subject: String,
    pub author: String,
    /// ISO-8601 committer date (`%cI`).
    pub timestamp: String,
    /// Branch/tag names pointing at this commit (from `%D` decorations).
    pub refs: Vec<String>,
    /// True when this is the commit `HEAD` currently points at.
    pub is_head: bool,
    /// True when this commit has 2+ parents (a merge join point).
    pub is_merge: bool,
    /// Computed swim-lane index. Lane 0 is the trunk (rendered at the bottom).
    pub lane: u32,
}

/// A branch (or remote-tracking branch) with upstream tracking info.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchRef {
    /// Short name, e.g. `main` or `origin/main`.
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    /// Upstream short name, e.g. `origin/main`, if one is configured.
    pub upstream: Option<String>,
    /// Commits this branch is ahead of its upstream.
    pub ahead: u32,
    /// Commits this branch is behind its upstream.
    pub behind: u32,
    /// Full SHA the branch tip points at.
    pub tip: String,
    /// Lane of the branch tip within the returned commit window (0 if the tip
    /// fell outside the window, e.g. on a truncated graph).
    pub lane: u32,
}

/// The full branch graph for a project.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchGraph {
    pub is_git_repo: bool,
    /// Current branch name, or `None` when detached.
    pub head: Option<String>,
    pub detached: bool,
    /// Newest-first, capped at [`MAX_GRAPH_COMMITS`].
    pub commits: Vec<GraphCommit>,
    pub branches: Vec<BranchRef>,
    pub tags: Vec<String>,
    /// True when the history hit the commit cap (older commits omitted).
    pub truncated: bool,
    /// Number of lanes the renderer must allocate vertical space for.
    pub lane_count: u32,
}

impl BranchGraph {
    fn not_a_repo() -> Self {
        BranchGraph {
            is_git_repo: false,
            head: None,
            detached: false,
            commits: Vec::new(),
            branches: Vec::new(),
            tags: Vec::new(),
            truncated: false,
            lane_count: 0,
        }
    }
}

/// Upstream sync status for the current branch — powers the Sync button copy.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamStatus {
    pub has_upstream: bool,
    pub upstream_name: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Whether the repo has any remote configured at all.
    pub remote_exists: bool,
}

/// In-progress merge/pull conflict state — drives the conflict-resolution UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictState {
    /// True when a merge/pull is paused mid-conflict (`.git/MERGE_HEAD` exists).
    pub in_progress: bool,
    /// `"merge"` while paused, otherwise `"none"`.
    pub kind: String,
    /// Files with unresolved conflict markers.
    pub conflicted_files: Vec<String>,
}

fn is_git_repo(project_path: &str) -> bool {
    run_git(project_path, &["rev-parse", "--is-inside-work-tree"])
        .map(|v| v == "true")
        .unwrap_or(false)
}

/// Parse `git log` `%D` decorations like `HEAD -> main, origin/main, tag: v1.0`.
/// Returns `(refs, is_head, tags)`.
fn parse_decorations(deco: &str) -> (Vec<String>, bool, Vec<String>) {
    let mut refs = Vec::new();
    let mut tags = Vec::new();
    let mut is_head = false;
    for token in deco.split(',') {
        let t = token.trim();
        if t.is_empty() {
            continue;
        }
        if t == "HEAD" {
            // Detached HEAD decoration with no branch.
            is_head = true;
        } else if let Some(branch) = t.strip_prefix("HEAD -> ") {
            is_head = true;
            refs.push(branch.to_string());
        } else if let Some(tag) = t.strip_prefix("tag: ") {
            tags.push(tag.to_string());
        } else {
            refs.push(t.to_string());
        }
    }
    (refs, is_head, tags)
}

/// Assign a swim-lane index to every commit (already newest-first).
///
/// Walks newest→oldest keeping `active[lane] = Some(sha)` for the commit each
/// lane next expects. The first parent continues a commit's lane; extra parents
/// (merges) claim or allocate additional lanes. Returns the lane-count
/// high-water mark. O(commits × lanes).
fn assign_lanes(commits: &mut [GraphCommit]) -> u32 {
    // Reserved successor SHA per lane; `None` = free.
    let mut active: Vec<Option<String>> = Vec::new();
    let mut high_water = 0usize;

    for commit in commits.iter_mut() {
        // Every lane currently reserving this commit's SHA.
        let reserving: Vec<usize> = active
            .iter()
            .enumerate()
            .filter(|(_, s)| s.as_deref() == Some(commit.hash.as_str()))
            .map(|(i, _)| i)
            .collect();

        let lane = if let Some(&first) = reserving.first() {
            // Free the other lanes that converged here (their children merge in).
            for &extra in &reserving[1..] {
                active[extra] = None;
            }
            first
        } else {
            // A branch tip nobody reserved — take the lowest free lane.
            match active.iter().position(|s| s.is_none()) {
                Some(i) => i,
                None => {
                    active.push(None);
                    active.len() - 1
                }
            }
        };

        commit.lane = lane as u32;

        // Reserve lanes for this commit's parents.
        match commit.parents.split_first() {
            None => {
                // Root commit — the lane ends here.
                active[lane] = None;
            }
            Some((first_parent, rest)) => {
                active[lane] = Some(first_parent.clone());
                for parent in rest {
                    let already = active.iter().any(|s| s.as_deref() == Some(parent.as_str()));
                    if !already {
                        match active.iter().position(|s| s.is_none()) {
                            Some(i) => active[i] = Some(parent.clone()),
                            None => active.push(Some(parent.clone())),
                        }
                    }
                }
            }
        }

        high_water = high_water.max(active.iter().filter(|s| s.is_some()).count());
        high_water = high_water.max(lane + 1);
    }

    high_water as u32
}

/// Build the branch graph for a project: commits (with parents, refs, lanes),
/// branches (with ahead/behind), tags, and HEAD.
#[tauri::command]
pub fn get_branch_graph(project_path: String, max_commits: u32) -> BranchGraph {
    if !is_git_repo(&project_path) {
        return BranchGraph::not_a_repo();
    }

    let cap = max_commits.clamp(1, MAX_GRAPH_COMMITS);
    let max_arg = format!("--max-count={}", cap);

    // One spawn: every commit across all refs, newest-first, with parents + refs.
    // Fields separated by US (\x1f): full hash, short hash, parents, subject,
    // author, ISO date, decorations.
    let raw = run_git_capture(
        &project_path,
        &[
            "log",
            "--all",
            "--date-order",
            &max_arg,
            "--pretty=format:%H\x1f%h\x1f%P\x1f%s\x1f%an\x1f%cI\x1f%D",
        ],
    )
    .unwrap_or_default();

    let mut tags: Vec<String> = Vec::new();
    let mut head_branch: Option<String> = None;
    let mut commits: Vec<GraphCommit> = Vec::new();

    for line in raw.lines().filter(|l| !l.is_empty()) {
        let parts: Vec<&str> = line.splitn(7, '\x1f').collect();
        if parts.len() < 7 {
            continue;
        }
        let parents: Vec<String> = parts[2]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        let (refs, is_head, mut commit_tags) = parse_decorations(parts[6]);
        if is_head {
            // First branch decoration on the HEAD commit names the current branch.
            head_branch = refs.first().cloned().or(head_branch);
        }
        tags.append(&mut commit_tags);
        let is_merge = parents.len() >= 2;
        commits.push(GraphCommit {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            parents,
            subject: parts[3].to_string(),
            author: parts[4].to_string(),
            timestamp: parts[5].to_string(),
            refs,
            is_head,
            is_merge,
            lane: 0,
        });
    }

    let truncated = commits.len() as u32 >= cap;
    let lane_count = assign_lanes(&mut commits);

    // Detached HEAD: symbolic-ref fails when HEAD isn't on a branch.
    let symbolic = run_git(&project_path, &["symbolic-ref", "-q", "--short", "HEAD"]);
    let detached = symbolic.is_none();
    let head = if detached { None } else { symbolic.or(head_branch) };

    let branches = collect_branches(&project_path, &commits);

    tags.sort();
    tags.dedup();

    BranchGraph {
        is_git_repo: true,
        head,
        detached,
        commits,
        branches,
        tags,
        truncated,
        lane_count,
    }
}

/// Parse `git for-each-ref` rows into [`BranchRef`]s, resolving each tip's lane
/// from the already-laid-out commit window.
fn collect_branches(project_path: &str, commits: &[GraphCommit]) -> Vec<BranchRef> {
    let raw = run_git_capture(
        project_path,
        &[
            "for-each-ref",
            "--format=%(refname)\x1f%(refname:short)\x1f%(upstream:short)\x1f%(upstream:track)\x1f%(objectname)\x1f%(HEAD)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .unwrap_or_default();

    let lane_of = |sha: &str| -> u32 {
        commits
            .iter()
            .find(|c| c.hash == sha)
            .map(|c| c.lane)
            .unwrap_or(0)
    };

    raw.lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(6, '\x1f').collect();
            if parts.len() < 6 {
                return None;
            }
            let full_ref = parts[0];
            // Skip the symbolic `origin/HEAD -> origin/main` pointer.
            if full_ref.ends_with("/HEAD") {
                return None;
            }
            let name = parts[1].to_string();
            let upstream = if parts[2].is_empty() {
                None
            } else {
                Some(parts[2].to_string())
            };
            let (ahead, behind) = parse_track(parts[3]);
            let tip = parts[4].to_string();
            let lane = lane_of(&tip);
            Some(BranchRef {
                name,
                is_current: parts[5] == "*",
                is_remote: full_ref.starts_with("refs/remotes/"),
                upstream,
                ahead,
                behind,
                tip,
                lane,
            })
        })
        .collect()
}

/// Parse `%(upstream:track)` like `[ahead 2, behind 1]` / `[ahead 3]` /
/// `[behind 4]` / `[gone]` / empty into `(ahead, behind)`.
fn parse_track(track: &str) -> (u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;
    let inner = track.trim().trim_start_matches('[').trim_end_matches(']');
    for part in inner.split(',') {
        let p = part.trim();
        if let Some(n) = p.strip_prefix("ahead ") {
            ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = p.strip_prefix("behind ") {
            behind = n.trim().parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

/// List branches (local + remote-tracking) with upstream/ahead/behind.
#[tauri::command]
pub fn list_branches(project_path: String) -> Vec<BranchRef> {
    if !is_git_repo(&project_path) {
        return Vec::new();
    }
    // No commit window here, so tip lanes default to 0 (callers wanting lanes
    // use get_branch_graph). Pass an empty slice.
    collect_branches(&project_path, &[])
}

/// Upstream sync status for the current branch.
#[tauri::command]
pub fn get_upstream_status(project_path: String) -> UpstreamStatus {
    let remote_exists = run_git(&project_path, &["remote"]).is_some();

    let upstream_name = run_git(
        &project_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    );

    let (ahead, behind) = if upstream_name.is_some() {
        run_git(
            &project_path,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        )
        .map(|s| {
            let mut cols = s.split_whitespace();
            let a = cols.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let b = cols.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            (a, b)
        })
        .unwrap_or((0, 0))
    } else {
        (0, 0)
    };

    UpstreamStatus {
        has_upstream: upstream_name.is_some(),
        upstream_name,
        ahead,
        behind,
        remote_exists,
    }
}

/// Detect an in-progress merge/pull conflict and list the conflicted files.
#[tauri::command]
pub fn get_conflict_state(project_path: String) -> ConflictState {
    let in_progress = run_git(&project_path, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_some();

    let conflicted_files = if in_progress {
        run_git_capture(
            &project_path,
            &["diff", "--name-only", "--diff-filter=U"],
        )
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.to_string())
        .collect()
    } else {
        Vec::new()
    };

    ConflictState {
        kind: if in_progress { "merge".to_string() } else { "none".to_string() },
        in_progress,
        conflicted_files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(cwd: &str, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git failed to start");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_str().unwrap();
        git(p, &["init"]);
        git(p, &["config", "user.email", "test@test.com"]);
        git(p, &["config", "user.name", "Test User"]);
        // Force a stable default branch name across git versions.
        git(p, &["checkout", "-b", "main"]);
        dir
    }

    fn commit_file(dir: &tempfile::TempDir, name: &str, content: &str, msg: &str) {
        let p = dir.path().to_str().unwrap();
        fs::write(dir.path().join(name), content).unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-m", msg]);
    }

    /// Linear repo with `n` commits on `main`.
    fn linear_repo(n: usize) -> tempfile::TempDir {
        let dir = init_repo();
        for i in 1..=n {
            commit_file(&dir, &format!("f{}.txt", i), &format!("c{}", i), &format!("commit {}", i));
        }
        dir
    }

    /// main with a feature branch that branches off and merges back.
    fn branch_and_merge_repo() -> tempfile::TempDir {
        let dir = init_repo();
        commit_file(&dir, "base.txt", "base", "base");
        let p = dir.path().to_str().unwrap();
        git(p, &["checkout", "-b", "feature"]);
        commit_file(&dir, "feat.txt", "feat", "feature work");
        git(p, &["checkout", "main"]);
        commit_file(&dir, "main2.txt", "main2", "main progress");
        git(p, &["merge", "--no-ff", "feature", "-m", "merge feature"]);
        dir
    }

    // ── get_branch_graph ──

    #[test]
    fn graph_non_repo_reports_not_a_repo() {
        let dir = tempfile::tempdir().unwrap();
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 50);
        assert!(!g.is_git_repo);
        assert!(g.commits.is_empty());
        assert_eq!(g.lane_count, 0);
    }

    #[test]
    fn graph_empty_repo_no_panic() {
        let dir = init_repo();
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 50);
        assert!(g.is_git_repo);
        assert!(g.commits.is_empty());
    }

    #[test]
    fn graph_linear_history_all_lane_zero() {
        let dir = linear_repo(4);
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 50);
        assert_eq!(g.commits.len(), 4);
        assert!(g.commits.iter().all(|c| c.lane == 0), "linear history is single-lane");
        assert_eq!(g.lane_count, 1);
        // Newest first.
        assert_eq!(g.commits[0].subject, "commit 4");
        assert!(g.commits[0].is_head);
        assert_eq!(g.head.as_deref(), Some("main"));
        assert!(!g.detached);
    }

    #[test]
    fn graph_parents_populated() {
        let dir = linear_repo(3);
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 50);
        // Newest commit has exactly one parent; the root has none.
        assert_eq!(g.commits[0].parents.len(), 1);
        assert_eq!(g.commits[0].parents[0], g.commits[1].hash);
        assert!(g.commits[2].parents.is_empty(), "root has no parents");
    }

    #[test]
    fn graph_merge_commit_has_two_parents_and_extra_lane() {
        let dir = branch_and_merge_repo();
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 50);
        let merge = g.commits.iter().find(|c| c.is_merge).expect("merge commit present");
        assert_eq!(merge.parents.len(), 2);
        assert!(merge.is_merge);
        // A branch+merge needs at least two lanes.
        assert!(g.lane_count >= 2, "expected >=2 lanes, got {}", g.lane_count);
        assert!(g.commits.iter().any(|c| c.lane >= 1), "feature commit on a non-zero lane");
    }

    #[test]
    fn graph_all_includes_unchecked_out_branch() {
        let dir = init_repo();
        commit_file(&dir, "base.txt", "base", "base");
        let p = dir.path().to_str().unwrap();
        // Create a branch with a commit, then switch away from it.
        git(p, &["checkout", "-b", "sidebranch"]);
        commit_file(&dir, "side.txt", "side", "side-only commit");
        git(p, &["checkout", "main"]);
        let g = get_branch_graph(p.to_string(), 50);
        // --all means the side-only commit is still in the graph.
        assert!(
            g.commits.iter().any(|c| c.subject == "side-only commit"),
            "--all should include commits on non-checked-out branches"
        );
    }

    #[test]
    fn graph_refs_and_head_decorations_parsed() {
        let dir = linear_repo(2);
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 50);
        let head = &g.commits[0];
        assert!(head.refs.iter().any(|r| r == "main"));
        assert!(head.is_head);
    }

    #[test]
    fn graph_truncated_flag_when_capped() {
        let dir = linear_repo(5);
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 3);
        assert_eq!(g.commits.len(), 3);
        assert!(g.truncated);
    }

    #[test]
    fn graph_not_truncated_when_under_cap() {
        let dir = linear_repo(3);
        let g = get_branch_graph(dir.path().to_str().unwrap().to_string(), 50);
        assert!(!g.truncated);
    }

    // ── tags ──

    #[test]
    fn graph_reports_tags() {
        let dir = linear_repo(1);
        let p = dir.path().to_str().unwrap();
        git(p, &["tag", "v1.0"]);
        let g = get_branch_graph(p.to_string(), 50);
        assert!(g.tags.iter().any(|t| t == "v1.0"));
    }

    // ── list_branches ──

    #[test]
    fn list_branches_reports_current() {
        let dir = branch_and_merge_repo();
        let branches = list_branches(dir.path().to_str().unwrap().to_string());
        let main = branches.iter().find(|b| b.name == "main").expect("main present");
        assert!(main.is_current);
        assert!(!main.is_remote);
        assert!(branches.iter().any(|b| b.name == "feature"));
    }

    #[test]
    fn list_branches_non_repo_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_branches(dir.path().to_str().unwrap().to_string()).is_empty());
    }

    // ── parse_track ──

    #[test]
    fn parse_track_ahead_and_behind() {
        assert_eq!(parse_track("[ahead 2, behind 1]"), (2, 1));
        assert_eq!(parse_track("[ahead 3]"), (3, 0));
        assert_eq!(parse_track("[behind 4]"), (0, 4));
        assert_eq!(parse_track("[gone]"), (0, 0));
        assert_eq!(parse_track(""), (0, 0));
    }

    // ── parse_decorations ──

    #[test]
    fn parse_decorations_head_branch_tag() {
        let (refs, is_head, tags) = parse_decorations("HEAD -> main, origin/main, tag: v1.0");
        assert!(is_head);
        assert!(refs.contains(&"main".to_string()));
        assert!(refs.contains(&"origin/main".to_string()));
        assert_eq!(tags, vec!["v1.0".to_string()]);
    }

    #[test]
    fn parse_decorations_empty() {
        let (refs, is_head, tags) = parse_decorations("");
        assert!(refs.is_empty());
        assert!(!is_head);
        assert!(tags.is_empty());
    }

    // ── get_upstream_status ──

    #[test]
    fn upstream_status_no_remote() {
        let dir = linear_repo(1);
        let s = get_upstream_status(dir.path().to_str().unwrap().to_string());
        assert!(!s.remote_exists);
        assert!(!s.has_upstream);
        assert_eq!((s.ahead, s.behind), (0, 0));
    }

    #[test]
    fn upstream_status_ahead_after_local_commit() {
        // Clone a repo so an upstream exists, then commit locally to go ahead.
        let origin = linear_repo(1);
        let origin_p = origin.path().to_str().unwrap();
        let clone_dir = tempfile::tempdir().unwrap();
        let clone_p = clone_dir.path().to_str().unwrap();
        git(".", &["clone", origin_p, clone_p]);
        git(clone_p, &["config", "user.email", "t@t.com"]);
        git(clone_p, &["config", "user.name", "T"]);
        fs::write(clone_dir.path().join("local.txt"), "x").unwrap();
        git(clone_p, &["add", "."]);
        git(clone_p, &["commit", "-m", "local ahead"]);

        let s = get_upstream_status(clone_p.to_string());
        assert!(s.remote_exists);
        assert!(s.has_upstream);
        assert_eq!(s.ahead, 1, "one local commit ahead of origin");
        assert_eq!(s.behind, 0);
    }

    // ── get_conflict_state ──

    #[test]
    fn conflict_state_clean_repo() {
        let dir = linear_repo(2);
        let c = get_conflict_state(dir.path().to_str().unwrap().to_string());
        assert!(!c.in_progress);
        assert_eq!(c.kind, "none");
        assert!(c.conflicted_files.is_empty());
    }

    #[test]
    fn conflict_state_detects_in_progress_merge() {
        let dir = init_repo();
        commit_file(&dir, "shared.txt", "base\n", "base");
        let p = dir.path().to_str().unwrap();
        git(p, &["checkout", "-b", "other"]);
        fs::write(dir.path().join("shared.txt"), "other change\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-m", "other"]);
        git(p, &["checkout", "main"]);
        fs::write(dir.path().join("shared.txt"), "main change\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-m", "main"]);
        // This merge conflicts; it returns non-zero, so don't assert success.
        let _ = Command::new("git")
            .args(["merge", "other"])
            .current_dir(p)
            .output()
            .unwrap();

        let c = get_conflict_state(p.to_string());
        assert!(c.in_progress, "merge should be paused mid-conflict");
        assert_eq!(c.kind, "merge");
        assert!(
            c.conflicted_files.iter().any(|f| f == "shared.txt"),
            "shared.txt should be conflicted, got {:?}",
            c.conflicted_files
        );
    }

    // ── assign_lanes (direct) ──

    #[test]
    fn assign_lanes_empty() {
        let mut commits: Vec<GraphCommit> = Vec::new();
        assert_eq!(assign_lanes(&mut commits), 0);
    }
}
