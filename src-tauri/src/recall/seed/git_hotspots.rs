//! §10 step 2 — git-history hotspot + co-change + bugfix-cluster
//! analysis. Pure shell-out to `git log`, no LLM.
//!
//! Outputs three derived bits the orchestrator turns into seed
//! notes:
//! - **Hotspots**: files with the highest commit count. Top N by
//!   default. These don't become notes themselves but they're the
//!   filter for which co-change clusters and bugfix clusters get
//!   surfaced (avoids drowning the vault in noise from low-activity
//!   areas).
//! - **Co-change clusters**: pairs of files committed together at
//!   least `min_cochange` times. Each cluster becomes one
//!   `pattern-cochange-<a>-<b>` seed note tagged `trust: inferred`.
//! - **Bugfix clusters**: hotspot files whose history contains
//!   commits whose subject matches the bug-fix regex. Each becomes
//!   one `landmine-<file-slug>` seed note tagged `trust: inferred`.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;

use crate::recall::RecallError;

#[derive(Debug, Clone)]
pub struct HotspotReport {
    /// File path → total commit count, descending.
    pub hotspots: Vec<(String, u32)>,
    /// Co-change pairs `(a, b, count)` where count ≥ threshold.
    pub cochange_pairs: Vec<(String, String, u32)>,
    /// Hotspot files that appear in bug-fix commits, with the count.
    pub bugfix_clusters: Vec<(String, u32)>,
}

impl HotspotReport {
    pub fn is_empty(&self) -> bool {
        self.hotspots.is_empty()
            && self.cochange_pairs.is_empty()
            && self.bugfix_clusters.is_empty()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct HotspotConfig {
    /// Maximum number of commits to walk back. Older history pays
    /// declining returns; the most recent ~500 commits typically
    /// captures every active hotspot.
    pub max_commits: usize,
    /// Minimum co-commit count for a (file_a, file_b) pair to seed
    /// a cochange pattern note.
    pub min_cochange: u32,
    /// Minimum commit count for a file to count as a "hotspot".
    pub min_hotspot_commits: u32,
    /// Minimum bugfix commit count on a hotspot for a landmine seed.
    pub min_bugfix_count: u32,
    /// Hotspot list is truncated to this many entries.
    pub max_hotspots: usize,
}

impl Default for HotspotConfig {
    fn default() -> Self {
        Self {
            max_commits: 500,
            min_cochange: 5,
            min_hotspot_commits: 3,
            min_bugfix_count: 2,
            max_hotspots: 25,
        }
    }
}

/// Run the analysis. Returns an empty report when the repo has no
/// commits or `git log` isn't available — never errors on those.
pub fn analyze(repo_root: &Path, config: HotspotConfig) -> Result<HotspotReport, RecallError> {
    let commits = collect_commits(repo_root, config.max_commits)?;
    if commits.is_empty() {
        return Ok(HotspotReport {
            hotspots: Vec::new(),
            cochange_pairs: Vec::new(),
            bugfix_clusters: Vec::new(),
        });
    }

    let mut file_counts: HashMap<String, u32> = HashMap::new();
    let mut cochange_counts: HashMap<(String, String), u32> = HashMap::new();
    let mut bugfix_file_counts: HashMap<String, u32> = HashMap::new();

    for commit in &commits {
        let is_bugfix = is_bugfix_subject(&commit.subject);
        for file in &commit.files {
            *file_counts.entry(file.clone()).or_default() += 1;
            if is_bugfix {
                *bugfix_file_counts.entry(file.clone()).or_default() += 1;
            }
        }
        // Co-change: every unordered pair of files in this commit.
        let mut sorted_files: Vec<&String> = commit.files.iter().collect();
        sorted_files.sort();
        sorted_files.dedup();
        // Cap per-commit fan-out: a single massive refactor touching
        // 200 files would produce 19,900 pairs. Skip very large
        // commits for the cochange map (they correlate every file
        // with every file, drowning out real signal).
        if sorted_files.len() > 30 {
            continue;
        }
        for i in 0..sorted_files.len() {
            for j in (i + 1)..sorted_files.len() {
                let a = sorted_files[i].clone();
                let b = sorted_files[j].clone();
                *cochange_counts.entry((a, b)).or_default() += 1;
            }
        }
    }

    let mut hotspots: Vec<(String, u32)> = file_counts
        .into_iter()
        .filter(|(_, c)| *c >= config.min_hotspot_commits)
        .collect();
    hotspots.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    hotspots.truncate(config.max_hotspots);

    let hotspot_set: HashSet<String> = hotspots.iter().map(|(f, _)| f.clone()).collect();

    let mut cochange_pairs: Vec<(String, String, u32)> = cochange_counts
        .into_iter()
        .filter(|((_, _), c)| *c >= config.min_cochange)
        .map(|((a, b), c)| (a, b, c))
        .collect();
    // Sort by count desc, then by name for determinism.
    cochange_pairs.sort_by(|x, y| y.2.cmp(&x.2).then_with(|| x.0.cmp(&y.0)).then_with(|| x.1.cmp(&y.1)));

    let mut bugfix_clusters: Vec<(String, u32)> = bugfix_file_counts
        .into_iter()
        .filter(|(f, c)| *c >= config.min_bugfix_count && hotspot_set.contains(f))
        .collect();
    bugfix_clusters.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    Ok(HotspotReport {
        hotspots,
        cochange_pairs,
        bugfix_clusters,
    })
}

#[derive(Debug, Clone)]
struct CommitInfo {
    subject: String,
    files: Vec<String>,
}

/// `git log --name-only --pretty=format:<sentinel>%H%n%s` parses to
/// alternating `(header, files…)` blocks. Cap by `max_commits` via
/// `-n` so we don't walk the entire history of a long-lived repo.
fn collect_commits(repo_root: &Path, max_commits: usize) -> Result<Vec<CommitInfo>, RecallError> {
    let format_str = "____RECALL_COMMIT____%n%H%n%s";
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["log", "--no-color", "--name-only"])
        .arg(format!("-n{}", max_commits))
        .arg(format!("--pretty=format:{}", format_str))
        .output()
        .map_err(|e| RecallError::Config(format!("git log spawn failed: {}", e)))?;
    if !output.status.success() {
        // Empty repo or `git log` failure — return empty rather than
        // error so the seed orchestrator continues with the other
        // steps.
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(parse_log(&text))
}

fn parse_log(text: &str) -> Vec<CommitInfo> {
    let mut commits = Vec::new();
    let mut current: Option<CommitInfo> = None;
    let mut state = ParseState::ExpectHeader;
    let mut subject_pending = false;

    for line in text.lines() {
        if line == "____RECALL_COMMIT____" {
            if let Some(c) = current.take() {
                commits.push(c);
            }
            current = Some(CommitInfo {
                subject: String::new(),
                files: Vec::new(),
            });
            state = ParseState::ExpectHash;
            subject_pending = false;
            continue;
        }
        match state {
            ParseState::ExpectHeader => continue,
            ParseState::ExpectHash => {
                // We don't need the hash itself — we only consume the
                // line and move to subject. The hash is line 1 of
                // the format template after the sentinel.
                state = ParseState::ExpectSubject;
            }
            ParseState::ExpectSubject => {
                if let Some(c) = current.as_mut() {
                    c.subject = line.to_string();
                }
                state = ParseState::ExpectFiles;
                subject_pending = true;
            }
            ParseState::ExpectFiles => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    // Blank separator between commits or trailing
                    // newline.
                    continue;
                }
                if let Some(c) = current.as_mut() {
                    c.files.push(trimmed.to_string());
                }
            }
        }
    }
    if let Some(c) = current.take() {
        commits.push(c);
    }
    let _ = subject_pending;
    commits
}

#[allow(clippy::enum_variant_names)]
enum ParseState {
    ExpectHeader,
    ExpectHash,
    ExpectSubject,
    ExpectFiles,
}

/// Bugfix-subject regex per spec §10 step 2: `fix|bug|hotfix|revert`.
/// Word-boundary aware so "prefix" / "fixing-something" don't match
/// the bare "fix" trigger but `fix:`, `fix(`, `bug:`, `hotfix:`, and
/// `revert ...` all do.
pub fn is_bugfix_subject(subject: &str) -> bool {
    let lower = subject.to_ascii_lowercase();
    for marker in &["fix:", "fix(", "bug:", "bug(", "hotfix:", "hotfix(", "revert", "bugfix:"] {
        if lower.starts_with(marker) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as PCommand;
    use tempfile::TempDir;

    fn make_repo() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();
        let run = |args: &[&str]| {
            let out = PCommand::new("git").args(args).current_dir(&path).output().unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        };
        std::env::set_var("GIT_COMMITTER_DATE", "2026-06-01T12:00:00Z");
        std::env::set_var("GIT_AUTHOR_DATE", "2026-06-01T12:00:00Z");
        run(&["init", "--quiet", "-b", "main"]);
        run(&["config", "user.email", "t@example.com"]);
        run(&["config", "user.name", "T"]);
        (tmp, path)
    }

    fn commit(path: &Path, files: &[(&str, &str)], msg: &str) {
        for (f, body) in files {
            let full = path.join(f);
            if let Some(p) = full.parent() {
                std::fs::create_dir_all(p).unwrap();
            }
            std::fs::write(&full, body).unwrap();
        }
        PCommand::new("git")
            .args(["add", "-A"])
            .current_dir(path)
            .output()
            .unwrap();
        PCommand::new("git")
            .args(["commit", "-q", "-m", msg])
            .current_dir(path)
            .output()
            .unwrap();
    }

    #[test]
    fn empty_repo_returns_empty_report() {
        let (_tmp, path) = make_repo();
        let report = analyze(&path, HotspotConfig::default()).unwrap();
        assert!(report.is_empty());
    }

    #[test]
    fn hotspot_file_with_multiple_commits_is_detected() {
        let (_tmp, path) = make_repo();
        for i in 0..5 {
            commit(
                &path,
                &[("src/x.rs", &format!("// v{}\n", i))],
                &format!("update {}", i),
            );
        }
        let cfg = HotspotConfig {
            min_hotspot_commits: 3,
            ..HotspotConfig::default()
        };
        let report = analyze(&path, cfg).unwrap();
        assert_eq!(report.hotspots.len(), 1);
        assert_eq!(report.hotspots[0].0, "src/x.rs");
        assert_eq!(report.hotspots[0].1, 5);
    }

    #[test]
    fn cochange_pair_appears_when_files_commit_together_repeatedly() {
        let (_tmp, path) = make_repo();
        for i in 0..6 {
            commit(
                &path,
                &[
                    ("src/a.rs", &format!("// v{}\n", i)),
                    ("src/b.rs", &format!("// v{}\n", i)),
                ],
                &format!("update both {}", i),
            );
        }
        let cfg = HotspotConfig {
            min_cochange: 5,
            ..HotspotConfig::default()
        };
        let report = analyze(&path, cfg).unwrap();
        assert_eq!(report.cochange_pairs.len(), 1);
        let (a, b, count) = &report.cochange_pairs[0];
        assert_eq!((a.as_str(), b.as_str()), ("src/a.rs", "src/b.rs"));
        assert_eq!(*count, 6);
    }

    #[test]
    fn bugfix_cluster_on_hotspot_is_detected() {
        let (_tmp, path) = make_repo();
        // 3 fix commits + 1 plain commit on the same file → hotspot
        // + bugfix cluster.
        for i in 0..3 {
            commit(
                &path,
                &[("src/auth.rs", &format!("// v{}\n", i))],
                &format!("fix(auth): off-by-one {}", i),
            );
        }
        commit(&path, &[("src/auth.rs", "// v3\n")], "feat: refactor");
        let cfg = HotspotConfig {
            min_hotspot_commits: 3,
            min_bugfix_count: 2,
            ..HotspotConfig::default()
        };
        let report = analyze(&path, cfg).unwrap();
        assert_eq!(report.bugfix_clusters.len(), 1);
        assert_eq!(report.bugfix_clusters[0].0, "src/auth.rs");
        assert_eq!(report.bugfix_clusters[0].1, 3);
    }

    #[test]
    fn non_hotspot_file_with_bugfixes_is_excluded() {
        let (_tmp, path) = make_repo();
        // Only one fix commit — below hotspot threshold (3).
        commit(&path, &[("src/lonely.rs", "//\n")], "fix(lonely): edge case");
        let cfg = HotspotConfig {
            min_hotspot_commits: 3,
            min_bugfix_count: 1,
            ..HotspotConfig::default()
        };
        let report = analyze(&path, cfg).unwrap();
        assert!(report.bugfix_clusters.is_empty(), "non-hotspot files are excluded");
    }

    #[test]
    fn co_change_below_threshold_is_excluded() {
        let (_tmp, path) = make_repo();
        for i in 0..3 {
            commit(
                &path,
                &[
                    ("src/c.rs", &format!("//{}\n", i)),
                    ("src/d.rs", &format!("//{}\n", i)),
                ],
                &format!("u{}", i),
            );
        }
        let cfg = HotspotConfig {
            min_cochange: 5,
            ..HotspotConfig::default()
        };
        let report = analyze(&path, cfg).unwrap();
        assert!(report.cochange_pairs.is_empty());
    }

    #[test]
    fn massive_commits_are_skipped_from_cochange_to_avoid_explosion() {
        let (_tmp, path) = make_repo();
        // One commit touching 32 files → would generate 496 pairs.
        // Should be skipped from cochange tracking.
        let mut files: Vec<(String, String)> = Vec::new();
        for i in 0..32 {
            files.push((format!("src/many_{}.rs", i), format!("// {}\n", i)));
        }
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(p, c)| (p.as_str(), c.as_str()))
            .collect();
        commit(&path, &refs, "feat: big refactor");
        let report = analyze(&path, HotspotConfig::default()).unwrap();
        assert!(report.cochange_pairs.is_empty());
    }

    #[test]
    fn bugfix_subject_matchers_cover_common_prefixes() {
        assert!(is_bugfix_subject("fix: off-by-one"));
        assert!(is_bugfix_subject("fix(auth): nil deref"));
        assert!(is_bugfix_subject("bug: regression"));
        assert!(is_bugfix_subject("hotfix: prod fire"));
        assert!(is_bugfix_subject("revert: bad commit"));
        assert!(is_bugfix_subject("bugfix: typo"));
    }

    #[test]
    fn bugfix_subject_does_not_match_partial_words() {
        assert!(!is_bugfix_subject("prefix: not a fix"));
        assert!(!is_bugfix_subject("refactor: rewrite"));
        assert!(!is_bugfix_subject("feat: add bugzilla integration"));
    }

    #[test]
    fn hotspots_truncated_at_max_hotspots() {
        let (_tmp, path) = make_repo();
        // 30 files each with 3 commits → 30 candidates, cap is 25.
        // Distinct content per commit so git doesn't no-op on
        // duplicates.
        for i in 0..30 {
            for j in 0..3 {
                commit(
                    &path,
                    &[(
                        &format!("src/f{}.rs", i),
                        &format!("// file {} version {}\n", i, j),
                    )],
                    "update",
                );
            }
        }
        let cfg = HotspotConfig {
            max_hotspots: 25,
            min_hotspot_commits: 3,
            ..HotspotConfig::default()
        };
        let report = analyze(&path, cfg).unwrap();
        assert_eq!(report.hotspots.len(), 25);
    }

    #[test]
    fn no_git_repo_returns_empty_report() {
        let tmp = TempDir::new().unwrap();
        let report = analyze(tmp.path(), HotspotConfig::default()).unwrap();
        assert!(report.is_empty());
    }
}
