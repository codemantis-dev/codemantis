//! SpecWriter `AGENTS.md` ephemeral working directory.
//!
//! Codex has no analog to Claude's `--append-system-prompt` flag — it
//! discovers project instructions by walking the directory tree from the
//! Git root down to `cwd`, picking up `AGENTS.override.md` / `AGENTS.md`
//! along the way (spec §2.5). To deliver the SpecWriter system prompt
//! *without* mutating the user's repo, we spawn each Codex SpecWriter
//! session with:
//!
//!   * `cwd` set to an ephemeral directory under
//!     `~/.codemantis/specwriter-sessions/<session_id>/`
//!   * a single `AGENTS.override.md` file in that directory containing the
//!     prompt
//!   * `--add-dir <user_project_path>` so Codex can read/write the user's
//!     actual project even though `cwd` is elsewhere
//!
//! Cleanup runs on graceful close (handle in `spawn.rs` calls
//! [`EphemeralAgentsDir::remove`]); a startup GC sweep (S8) catches any
//! crashes. Until the GC ships, leftover directories are harmless — Codex
//! never auto-reads them because they're outside any session's `cwd`.
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §2.5 (the AGENTS.md strategy) and §10.1 (SpecWriter capability dispatch).

#![allow(dead_code)] // Consumed by spawn.rs (S4) + commands::specwriter (S5).

use std::path::{Path, PathBuf};

/// Cap per Codex's `project_doc_max_bytes` default. Anything longer is
/// truncated at write time to avoid silent loss inside Codex itself.
pub const AGENTS_MAX_BYTES: usize = 32 * 1024;

/// Owned handle to a SpecWriter ephemeral working dir. Dropping or
/// calling [`Self::remove`] cleans up the directory + its contents.
#[derive(Debug)]
pub struct EphemeralAgentsDir {
    path: PathBuf,
    cleaned: bool,
}

impl EphemeralAgentsDir {
    /// Resolve the ephemeral root: `~/.codemantis/specwriter-sessions/`.
    /// Configurable via `$CODEMANTIS_HOME` for tests.
    pub fn root() -> PathBuf {
        if let Ok(custom) = std::env::var("CODEMANTIS_HOME") {
            return PathBuf::from(custom).join("specwriter-sessions");
        }
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        home.join(".codemantis").join("specwriter-sessions")
    }

    /// Create the per-session dir + write `AGENTS.override.md`. Truncates
    /// the prompt at [`AGENTS_MAX_BYTES`] (with a trailing comment marker)
    /// so Codex never silently swallows the tail.
    pub fn create(session_id: &str, system_prompt: &str) -> std::io::Result<Self> {
        let path = Self::root().join(session_id);
        std::fs::create_dir_all(&path)?;
        let mut content = system_prompt.to_string();
        if content.len() > AGENTS_MAX_BYTES {
            let cutoff = floor_char_boundary(&content, AGENTS_MAX_BYTES.saturating_sub(120));
            content.truncate(cutoff);
            content.push_str(
                "\n\n<!-- CodeMantis: prompt truncated at 32 KiB to fit Codex's \
                 project_doc_max_bytes limit -->\n",
            );
        }
        let file = path.join("AGENTS.override.md");
        std::fs::write(&file, content)?;
        Ok(Self {
            path,
            cleaned: false,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Explicit cleanup. Safe to call multiple times — second call is a
    /// no-op. The Drop impl calls this if you forget.
    pub fn remove(&mut self) {
        if self.cleaned {
            return;
        }
        let _ = std::fs::remove_dir_all(&self.path);
        self.cleaned = true;
    }
}

impl Drop for EphemeralAgentsDir {
    fn drop(&mut self) {
        // Best-effort: a stale directory is harmless (no session ever
        // references it again) but tests still want determinism.
        self.remove();
    }
}

/// `String::floor_char_boundary` equivalent for stable Rust — finds the
/// largest valid UTF-8 boundary `<= idx` so we don't slice through a
/// codepoint when truncating.
fn floor_char_boundary(s: &str, idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    let mut i = idx;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn with_isolated_home<T>(f: impl FnOnce() -> T) -> T {
        let tmp = tempfile::tempdir().unwrap();
        let prev = std::env::var("CODEMANTIS_HOME").ok();
        std::env::set_var("CODEMANTIS_HOME", tmp.path());
        let result = f();
        match prev {
            Some(p) => std::env::set_var("CODEMANTIS_HOME", p),
            None => std::env::remove_var("CODEMANTIS_HOME"),
        }
        result
    }

    #[test]
    fn root_honors_codemantis_home_env() {
        with_isolated_home(|| {
            let r = EphemeralAgentsDir::root();
            assert!(
                r.to_string_lossy().ends_with("specwriter-sessions"),
                "got: {}",
                r.display()
            );
            assert!(r.starts_with(std::env::var("CODEMANTIS_HOME").unwrap()));
        });
    }

    #[test]
    fn create_writes_override_file_and_returns_path() {
        with_isolated_home(|| {
            let dir = EphemeralAgentsDir::create("sess-1", "You are a senior advisor.").unwrap();
            let agents_md = dir.path().join("AGENTS.override.md");
            assert!(agents_md.exists(), "AGENTS.override.md not created");
            let content = std::fs::read_to_string(&agents_md).unwrap();
            assert!(content.contains("senior advisor"));
        });
    }

    #[test]
    fn create_truncates_oversize_prompt_at_32kib_with_marker() {
        with_isolated_home(|| {
            // Build a 40 KiB prompt; result must be ≤ 32 KiB *and* end with
            // the truncation marker so a downstream reader can detect it.
            let big = "x".repeat(40 * 1024);
            let dir = EphemeralAgentsDir::create("sess-big", &big).unwrap();
            let content = std::fs::read_to_string(dir.path().join("AGENTS.override.md")).unwrap();
            assert!(
                content.len() <= AGENTS_MAX_BYTES,
                "content is {}, expected <= {AGENTS_MAX_BYTES}",
                content.len()
            );
            assert!(content.contains("truncated at 32 KiB"));
        });
    }

    #[test]
    fn create_handles_unicode_at_truncation_boundary() {
        with_isolated_home(|| {
            // Pad with multi-byte chars so the truncation point lands inside
            // a codepoint; floor_char_boundary must keep the slice valid.
            let big: String = "🦀".repeat(20_000);
            assert!(big.len() > AGENTS_MAX_BYTES);
            let dir = EphemeralAgentsDir::create("sess-u", &big).unwrap();
            // The mere fact create() returned Ok means the slice operation
            // didn't panic at an invalid UTF-8 boundary.
            let content = std::fs::read_to_string(dir.path().join("AGENTS.override.md")).unwrap();
            assert!(content.len() <= AGENTS_MAX_BYTES);
        });
    }

    #[test]
    fn drop_cleans_up_the_directory() {
        with_isolated_home(|| {
            let path = {
                let dir = EphemeralAgentsDir::create("sess-drop", "prompt").unwrap();
                dir.path().to_path_buf()
            }; // Drop fires here.
            assert!(!path.exists(), "ephemeral dir should be gone after Drop");
        });
    }

    #[test]
    fn explicit_remove_is_idempotent() {
        with_isolated_home(|| {
            let mut dir = EphemeralAgentsDir::create("sess-rm", "prompt").unwrap();
            let path = dir.path().to_path_buf();
            dir.remove();
            assert!(!path.exists());
            // Second remove() must not panic; it's a no-op.
            dir.remove();
        });
    }
}
