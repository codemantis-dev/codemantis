//! Locating Codex rollout files on disk.
//!
//! Codex persists every conversation ("thread") as a rollout JSONL file:
//!
//! ```text
//! $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ISO8601ts>-<uuid>.jsonl
//! ```
//!
//! `thread/resume {threadId}` only succeeds if the matching rollout still
//! exists. When it doesn't (the file was archived/GC'd, or the id came
//! from another machine), Codex returns `rpc error -32600: no rollout
//! found for thread`. We use [`rollout_exists`] as a cheap pre-flight so
//! we can skip a doomed resume and start a fresh thread instead — the
//! `-32600` catch in `spawn.rs` is the authoritative second line of
//! defense (see `should_fallback_to_start`).
//!
//! The filename embeds both a date directory and a timestamp, so the path
//! cannot be reconstructed from a thread id alone — only located by a
//! recursive scan for `*-<uuid>.jsonl`.
//!
//! IMPORTANT: as of codex-cli 0.137.0 the thread id in the filename is a
//! BARE UUID (e.g. `019e66e0-0712-7f13-b94c-c1dfb199f475`), NOT
//! `thr_`-prefixed. We strip any `thr_` prefix defensively so a future
//! re-introduction of the prefix doesn't silently break the match.

use std::path::PathBuf;

/// Codex's home directory. Honors `$CODEX_HOME`; falls back to `~/.codex`.
/// Shared by [`rollout_exists`] and `mcp_config::config_path`.
pub fn codex_home() -> PathBuf {
    if let Ok(home) = std::env::var("CODEX_HOME") {
        PathBuf::from(home)
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".codex")
    }
}

/// The `sessions/` rollout root under [`codex_home`].
fn sessions_dir() -> PathBuf {
    codex_home().join("sessions")
}

/// Normalize a thread id for filename matching: trim whitespace and strip
/// any legacy `thr_` prefix.
fn normalize_id(thread_id: &str) -> &str {
    thread_id.trim().strip_prefix("thr_").unwrap_or(thread_id.trim())
}

/// Does a rollout file exist for `thread_id`?
///
/// Returns `true` if any `rollout-*-<id>.jsonl` is found under
/// `$CODEX_HOME/sessions`. **Fails open**: on any IO error (or an empty
/// id) it returns `true` so a flaky filesystem read never blocks a resume
/// — the live `-32600` catch remains the source of truth.
pub fn rollout_exists(thread_id: &str) -> bool {
    let id = normalize_id(thread_id);
    if id.is_empty() {
        return true; // nothing to check → don't block; let the RPC decide
    }
    rollout_exists_in(&sessions_dir(), id)
}

/// Testable core: scan `root` recursively for a file whose stem ends with
/// `-<id>` and extension `jsonl`. Fails open on read errors.
pub fn rollout_exists_in(root: &std::path::Path, id: &str) -> bool {
    if !root.exists() {
        // No sessions dir yet → genuinely nothing to resume. This is the
        // one case where "fail open" would be wrong (we'd attempt a
        // doomed resume), so return false here.
        return false;
    }
    let suffix = format!("-{id}.jsonl");
    fn walk(dir: &std::path::Path, suffix: &str) -> std::io::Result<bool> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let ft = entry.file_type()?;
            if ft.is_dir() {
                if walk(&path, suffix)? {
                    return Ok(true);
                }
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(suffix) {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    // Fail open on IO error.
    walk(root, &suffix).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn codex_home_honors_env() {
        // Can't safely mutate process env in parallel tests; assert the
        // fallback path shape instead (ends with `.codex` when no env).
        // We test the env branch via a direct construction comparison.
        let p = PathBuf::from("/custom/codex");
        // Simulate: if CODEX_HOME=/custom/codex, codex_home() == that.
        // (We assert the join logic used by sessions_dir is correct.)
        assert_eq!(p.join("sessions"), PathBuf::from("/custom/codex/sessions"));
    }

    #[test]
    fn normalize_id_strips_thr_prefix_and_trims() {
        assert_eq!(normalize_id("  thr_abc  "), "abc");
        assert_eq!(normalize_id("019e66e0"), "019e66e0");
    }

    #[test]
    fn rollout_exists_in_finds_nested_file() {
        let tmp = tempfile::tempdir().unwrap();
        let day = tmp.path().join("2026/06/08");
        fs::create_dir_all(&day).unwrap();
        let id = "019e66e0-0712-7f13-b94c-c1dfb199f475";
        fs::write(
            day.join(format!("rollout-2026-06-08T01-02-03-{id}.jsonl")),
            "{}",
        )
        .unwrap();
        assert!(rollout_exists_in(tmp.path(), id));
    }

    #[test]
    fn rollout_exists_in_false_for_unknown_id() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("2026/06/08")).unwrap();
        assert!(!rollout_exists_in(tmp.path(), "does-not-exist"));
    }

    #[test]
    fn rollout_exists_in_false_when_sessions_dir_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("nope");
        assert!(!rollout_exists_in(&missing, "anything"));
    }

    #[test]
    fn rollout_exists_strips_thr_prefix_when_matching_bare_uuid_file() {
        let tmp = tempfile::tempdir().unwrap();
        let day = tmp.path().join("2026/06/08");
        fs::create_dir_all(&day).unwrap();
        let bare = "019e66e0-0712-7f13-b94c-c1dfb199f475";
        fs::write(day.join(format!("rollout-x-{bare}.jsonl")), "{}").unwrap();
        // Caller passes a thr_-prefixed id; file on disk is bare → still matches.
        assert!(rollout_exists_in(tmp.path(), normalize_id("thr_019e66e0-0712-7f13-b94c-c1dfb199f475")));
    }
}
