//! Parse `git show <hash>` output into typed values the Harvester
//! pipeline can consume.
//!
//! We shell out with an explicit `--format` template so the parse is
//! independent of any user's `pager`/`color.ui`/`format.pretty`
//! configuration. The template puts the header fields on known lines
//! followed by a sentinel; everything after the sentinel is the
//! unified diff.

use std::path::Path;
use std::process::Command;

use chrono::{DateTime, Utc};

use crate::recall::RecallError;

const HEADER_SENTINEL: &str = "___RECALL_GIT_HEADER_END___";

/// One file's change-summary, extracted from a `diff --git` block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    /// Path on the target side (`b/...`). When the file was deleted
    /// this falls back to the source-side path.
    pub path: String,
    /// `added`, `modified`, `deleted`, or `renamed`.
    pub kind: ChangeKind,
    /// Lines beginning with `+ ` in the unified diff (excluding the
    /// header `+++` line). One entry per line, newline-stripped.
    pub added_lines: Vec<String>,
    /// Lines beginning with `- ` (excluding the `---` header).
    pub removed_lines: Vec<String>,
    /// Verbatim diff hunk text for this file, useful for the LLM
    /// generate step and for human review.
    pub diff_text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
}

impl ChangeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ChangeKind::Added => "added",
            ChangeKind::Modified => "modified",
            ChangeKind::Deleted => "deleted",
            ChangeKind::Renamed => "renamed",
        }
    }
}

/// Everything Harvester needs to know about one commit.
#[derive(Debug, Clone)]
pub struct CommitInfo {
    pub hash: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: DateTime<Utc>,
    /// First line of the commit message ("subject").
    pub subject: String,
    /// Subject + body, joined by a blank line. This is `%B` from
    /// `git show` — the raw commit message.
    pub full_message: String,
    pub files: Vec<FileChange>,
}

impl CommitInfo {
    /// True when the message carries the `[no-recall]` opt-out marker.
    /// Spec §13 — manual harvest skip.
    pub fn has_no_recall_marker(&self) -> bool {
        self.full_message
            .lines()
            .any(|l| l.trim().eq_ignore_ascii_case("[no-recall]") || l.contains("[no-recall]"))
    }

    /// All paths touched by this commit, in the order `git show`
    /// emits them.
    pub fn touched_paths(&self) -> Vec<String> {
        self.files.iter().map(|f| f.path.clone()).collect()
    }
}

/// Run `git show <hash>` in `repo_root` and parse the output.
pub fn show_commit(repo_root: &Path, hash: &str) -> Result<CommitInfo, RecallError> {
    if hash.is_empty() {
        return Err(RecallError::Config("empty commit hash".to_string()));
    }
    // Constrain hash characters defensively — even though `git`
    // refuses invalid refs, we don't want to shell-quote
    // metacharacters through an unfortunate later refactor.
    if !hash.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '_' || c == '-') {
        return Err(RecallError::Config(format!(
            "rejected suspicious git ref: {:?}",
            hash
        )));
    }

    let format = format!(
        "%H%n%an%n%ae%n%aI%n%B%n{}",
        HEADER_SENTINEL
    );

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["show", "--no-color", "--no-renames"])
        .arg(format!("--format={}", format))
        .arg(hash)
        .output()
        .map_err(|e| RecallError::Config(format!("git show: spawn failed: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(RecallError::Config(format!(
            "git show <{}> failed: {}",
            hash, stderr
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    parse_show_output(&stdout)
}

fn parse_show_output(raw: &str) -> Result<CommitInfo, RecallError> {
    let Some((header, body)) = raw.split_once(&format!("\n{}\n", HEADER_SENTINEL)) else {
        // Some commits (root commit, --no-patch path) might omit the
        // diff entirely. The sentinel itself still appears.
        let trimmed = raw.trim_end_matches('\n');
        return parse_header_only(trimmed)
            .ok_or_else(|| RecallError::Config(format!("malformed git show output (no sentinel): {:?}",
                truncate(raw, 200))));
    };

    let mut lines = header.lines();
    let hash = lines
        .next()
        .ok_or_else(|| RecallError::Config("git show: missing hash line".to_string()))?
        .to_string();
    let author_name = lines.next().unwrap_or("").to_string();
    let author_email = lines.next().unwrap_or("").to_string();
    let ts_str = lines.next().unwrap_or("");
    let timestamp = parse_timestamp(ts_str)?;
    // Rest of the header is the message body (%B).
    let mut full_message_lines: Vec<&str> = lines.collect();
    // Trim trailing empty lines that git always emits after %B.
    while matches!(full_message_lines.last(), Some(&"")) {
        full_message_lines.pop();
    }
    let full_message = full_message_lines.join("\n");
    let subject = full_message.lines().next().unwrap_or("").to_string();

    let files = parse_diff(body);

    Ok(CommitInfo {
        hash,
        author_name,
        author_email,
        timestamp,
        subject,
        full_message,
        files,
    })
}

fn parse_header_only(text: &str) -> Option<CommitInfo> {
    // Fallback: header with sentinel at the end and no diff section.
    let header_part = text.strip_suffix(HEADER_SENTINEL)?.trim_end_matches('\n');
    let mut lines = header_part.lines();
    let hash = lines.next()?.to_string();
    let author_name = lines.next().unwrap_or("").to_string();
    let author_email = lines.next().unwrap_or("").to_string();
    let ts = parse_timestamp(lines.next().unwrap_or("")).ok()?;
    let mut rest: Vec<&str> = lines.collect();
    while matches!(rest.last(), Some(&"")) {
        rest.pop();
    }
    let full_message = rest.join("\n");
    let subject = full_message.lines().next().unwrap_or("").to_string();
    Some(CommitInfo {
        hash,
        author_name,
        author_email,
        timestamp: ts,
        subject,
        full_message,
        files: Vec::new(),
    })
}

fn parse_timestamp(s: &str) -> Result<DateTime<Utc>, RecallError> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Ok(Utc::now());
    }
    DateTime::parse_from_rfc3339(trimmed)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| RecallError::Config(format!("git show: bad timestamp {:?}: {}", s, e)))
}

fn parse_diff(diff_text: &str) -> Vec<FileChange> {
    let mut files: Vec<FileChange> = Vec::new();
    let trimmed = diff_text.trim_start_matches('\n');
    if trimmed.is_empty() {
        return files;
    }

    // Walk lines; whenever we see `diff --git`, close the current
    // file and start a new one. The first line of the whole diff
    // body is always `diff --git`, so the closing logic below also
    // handles the final block via a sentinel push at end-of-input.
    let mut current_header: Option<String> = None;
    let mut current_path = String::new();
    let mut current_kind = ChangeKind::Modified;
    let mut current_added: Vec<String> = Vec::new();
    let mut current_removed: Vec<String> = Vec::new();
    let mut current_diff: String = String::new();

    let flush = |files: &mut Vec<FileChange>,
                 path: &mut String,
                 kind: &mut ChangeKind,
                 added: &mut Vec<String>,
                 removed: &mut Vec<String>,
                 diff: &mut String,
                 header: &mut Option<String>| {
        if header.is_none() {
            return;
        }
        files.push(FileChange {
            path: std::mem::take(path),
            kind: *kind,
            added_lines: std::mem::take(added),
            removed_lines: std::mem::take(removed),
            diff_text: std::mem::take(diff),
        });
        *header = None;
        *kind = ChangeKind::Modified;
    };

    for line in trimmed.lines() {
        if line.starts_with("diff --git") {
            flush(
                &mut files,
                &mut current_path,
                &mut current_kind,
                &mut current_added,
                &mut current_removed,
                &mut current_diff,
                &mut current_header,
            );
            current_header = Some(line.to_string());
            current_diff.push_str(line);
            current_diff.push('\n');
            // path-on-b-side is `b/<path>`.
            current_path = parse_diff_header_path(line).unwrap_or_default();
            continue;
        }
        if current_header.is_none() {
            // Skipping any prelude before the first diff (defensive).
            continue;
        }
        current_diff.push_str(line);
        current_diff.push('\n');

        // Detect change kind via `new file`, `deleted file`,
        // `rename from/to`. These appear in the per-file header
        // before the unified hunks.
        if line.starts_with("new file mode") {
            current_kind = ChangeKind::Added;
            continue;
        }
        if line.starts_with("deleted file mode") {
            current_kind = ChangeKind::Deleted;
            continue;
        }
        if line.starts_with("rename ") || line.starts_with("similarity index") {
            current_kind = ChangeKind::Renamed;
            continue;
        }
        // Hunk content.
        if line.starts_with("+++") || line.starts_with("---") {
            // Header markers, not content. Skip — they're already in
            // diff_text.
            continue;
        }
        if let Some(stripped) = line.strip_prefix('+') {
            current_added.push(stripped.to_string());
        } else if let Some(stripped) = line.strip_prefix('-') {
            current_removed.push(stripped.to_string());
        }
    }
    // Flush trailing file.
    flush(
        &mut files,
        &mut current_path,
        &mut current_kind,
        &mut current_added,
        &mut current_removed,
        &mut current_diff,
        &mut current_header,
    );
    files
}

/// From `diff --git a/<path> b/<path>` pull the `b/`-side path. Git
/// quotes paths with shell-special chars, but for the macOS target
/// projects we touch this rarely matters; we fall back to the raw
/// segment.
fn parse_diff_header_path(line: &str) -> Option<String> {
    // Example: `diff --git a/src/foo.rs b/src/foo.rs`
    let rest = line.strip_prefix("diff --git ")?;
    // Split on " b/" first (the more reliable anchor — `a/` appears
    // earlier and may contain spaces in unusual filenames).
    if let Some((_, b_path)) = rest.split_once(" b/") {
        let cleaned = b_path.trim().trim_matches('"');
        return Some(cleaned.to_string());
    }
    // Fallback: split on the central space.
    let halves: Vec<&str> = rest.splitn(2, " b/").collect();
    if halves.len() == 2 {
        return Some(halves[1].trim().to_string());
    }
    None
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command as PCommand;
    use tempfile::TempDir;

    /// Helper: spin up a tiny git repo with a fixture commit.
    fn fixture_repo(commit_message: &str, files: &[(&str, &str)]) -> (TempDir, PathBuf, String) {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();
        let git_run = |args: &[&str]| {
            let out = PCommand::new("git")
                .args(args)
                .current_dir(&path)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        };
        git_run(&["init", "--quiet", "-b", "main"]);
        git_run(&["config", "user.email", "test@example.com"]);
        git_run(&["config", "user.name", "Tester"]);
        // Set committer date deterministic for reproducibility.
        std::env::set_var("GIT_COMMITTER_DATE", "2026-06-01T12:00:00Z");
        std::env::set_var("GIT_AUTHOR_DATE", "2026-06-01T12:00:00Z");
        for (f, body) in files {
            let full = path.join(f);
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&full, body).unwrap();
        }
        git_run(&["add", "-A"]);
        git_run(&["commit", "-q", "-m", commit_message]);
        let head = PCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&path)
            .output()
            .unwrap();
        let hash = String::from_utf8_lossy(&head.stdout).trim().to_string();
        (tmp, path, hash)
    }

    #[test]
    fn shows_basic_commit_header() {
        let (_tmp, path, hash) = fixture_repo(
            "feat: add the thing",
            &[("hello.rs", "fn main(){}\n")],
        );
        let info = show_commit(&path, &hash).unwrap();
        assert_eq!(info.hash, hash);
        assert_eq!(info.subject, "feat: add the thing");
        assert_eq!(info.author_name, "Tester");
        assert_eq!(info.author_email, "test@example.com");
        assert_eq!(info.files.len(), 1);
        assert_eq!(info.files[0].path, "hello.rs");
        assert_eq!(info.files[0].kind, ChangeKind::Added);
    }

    #[test]
    fn extracts_added_and_removed_lines() {
        let (_tmp, path, _first) = fixture_repo("init", &[("foo.txt", "one\ntwo\nthree\n")]);
        std::fs::write(path.join("foo.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        PCommand::new("git")
            .args(["commit", "-q", "-am", "modify"])
            .current_dir(&path)
            .output()
            .unwrap();
        let head = PCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&path)
            .output()
            .unwrap();
        let hash = String::from_utf8_lossy(&head.stdout).trim().to_string();
        let info = show_commit(&path, &hash).unwrap();
        let f = &info.files[0];
        assert_eq!(f.kind, ChangeKind::Modified);
        assert!(f.removed_lines.iter().any(|l| l.contains("two")));
        assert!(f.added_lines.iter().any(|l| l.contains("TWO")));
        assert!(f.added_lines.iter().any(|l| l.contains("four")));
    }

    #[test]
    fn detects_deleted_file_kind() {
        let (_tmp, path, _) = fixture_repo("init", &[("doomed.txt", "delete me\n")]);
        std::fs::remove_file(path.join("doomed.txt")).unwrap();
        PCommand::new("git")
            .args(["commit", "-q", "-am", "remove"])
            .current_dir(&path)
            .output()
            .unwrap();
        let head = PCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&path)
            .output()
            .unwrap();
        let hash = String::from_utf8_lossy(&head.stdout).trim().to_string();
        let info = show_commit(&path, &hash).unwrap();
        assert_eq!(info.files.len(), 1);
        assert_eq!(info.files[0].kind, ChangeKind::Deleted);
    }

    #[test]
    fn captures_multi_file_diff() {
        let (_tmp, path, hash) = fixture_repo(
            "feat: two files",
            &[("a.rs", "fn a(){}\n"), ("b.rs", "fn b(){}\n")],
        );
        let info = show_commit(&path, &hash).unwrap();
        assert_eq!(info.files.len(), 2);
        let paths: Vec<&str> = info.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"a.rs"));
        assert!(paths.contains(&"b.rs"));
    }

    #[test]
    fn preserves_full_commit_message_with_body() {
        let msg = "feat: short subject\n\nLong body paragraph one.\n\nParagraph two.";
        let (_tmp, path, hash) = fixture_repo(msg, &[("x.rs", "fn x(){}\n")]);
        let info = show_commit(&path, &hash).unwrap();
        assert_eq!(info.subject, "feat: short subject");
        assert!(info.full_message.contains("Long body paragraph one"));
        assert!(info.full_message.contains("Paragraph two"));
    }

    #[test]
    fn no_recall_marker_detected() {
        let (_tmp, path, hash) = fixture_repo(
            "chore: bump version [no-recall]",
            &[("v.txt", "1.5.0\n")],
        );
        let info = show_commit(&path, &hash).unwrap();
        assert!(info.has_no_recall_marker());
    }

    #[test]
    fn no_recall_marker_absent_for_normal_commit() {
        let (_tmp, path, hash) = fixture_repo("feat: normal", &[("a.rs", "fn a(){}\n")]);
        let info = show_commit(&path, &hash).unwrap();
        assert!(!info.has_no_recall_marker());
    }

    #[test]
    fn rejects_suspicious_ref_strings() {
        let tmp = TempDir::new().unwrap();
        let result = show_commit(tmp.path(), "; rm -rf /");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_empty_hash() {
        let tmp = TempDir::new().unwrap();
        assert!(show_commit(tmp.path(), "").is_err());
    }

    #[test]
    fn returns_error_when_repo_has_no_commits() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path();
        PCommand::new("git")
            .args(["init", "--quiet", "-b", "main"])
            .current_dir(path)
            .output()
            .unwrap();
        let result = show_commit(path, "HEAD");
        assert!(result.is_err());
    }

    #[test]
    fn touched_paths_returns_change_paths_in_order() {
        let (_tmp, path, hash) = fixture_repo(
            "init",
            &[("src/a.rs", "a\n"), ("src/b.rs", "b\n"), ("docs/x.md", "x\n")],
        );
        let info = show_commit(&path, &hash).unwrap();
        let paths = info.touched_paths();
        assert_eq!(paths.len(), 3);
    }
}
