//! Polling git watcher (RECALL-SPEC §7.1 + §17 Q2).
//!
//! Phase 3 ships **poll-only** rather than the spec's fs-watch + poll
//! fallback. Rationale:
//! - The poll fallback was always required (`notify` misses commits
//!   from network filesystems and some sandboxed tools).
//! - Adding the `notify` crate doubles the lifecycle complexity for
//!   a memory-layer feature where 30-second harvest lag is acceptable.
//! - Phase 5 (or v1.1) can layer fs-watch on top if real-world lag
//!   data demands lower latency.
//!
//! The watcher is structured as two pieces:
//! - [`tick`] — single-cycle: compare `HEAD` to last-harvested, drive
//!   the harvest, return outcome. Unit-testable.
//! - [`watch_loop`] — async loop that calls `tick` every N seconds
//!   until a cancellation signal fires. Thin wrapper.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::watch;
use tokio::time::sleep;

use crate::recall::config::RecallConfig;
use crate::recall::llm_client::LlmClient;
use crate::recall::vault::Vault;
use crate::recall::RecallError;
use crate::storage::Database;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TickOutcome {
    /// No new commit since the last tick.
    NoChange,
    /// A new commit was detected and harvested (or skipped).
    Harvested { commit_hash: String, action: String },
    /// HEAD couldn't be read (no commits yet, git missing, etc.).
    /// The watcher logs and continues — not an error condition for
    /// the loop.
    Unreadable { reason: String },
}

/// Resolve the current `HEAD` commit hash via `git rev-parse HEAD`.
/// Returns `None` when the repo has no commits yet (rev-parse exits
/// nonzero) or git itself isn't available.
pub fn head_commit(repo_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let trimmed = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Read the last-harvested commit hash for a project. The watcher
/// uses `recall_harvests` itself as the source of truth: the most
/// recent successful harvest row's commit_hash. This means the
/// watcher recovers correctly across restarts without persisting a
/// separate cursor.
pub fn last_harvested_commit(db: &Database, project_path: &Path) -> Option<String> {
    let project_str = project_path.to_string_lossy().to_string();
    let guard = db.conn().lock().unwrap();
    guard
        .query_row(
            "SELECT commit_hash FROM recall_harvests
              WHERE project_path = ?1 AND commit_hash IS NOT NULL
              ORDER BY occurred_at DESC LIMIT 1",
            rusqlite::params![project_str],
            |r| r.get::<_, String>(0),
        )
        .ok()
}

/// One poll cycle. Diff `HEAD` against `last_harvested_commit`; on
/// difference, fire the harvest pipeline.
#[allow(clippy::too_many_arguments)]
pub async fn tick(
    db: &Database,
    vault: &Vault,
    repo_root: &Path,
    project_path: &Path,
    config: &RecallConfig,
    llm: &dyn LlmClient,
    api_key: &str,
) -> Result<TickOutcome, RecallError> {
    let Some(head) = head_commit(repo_root) else {
        return Ok(TickOutcome::Unreadable {
            reason: "git rev-parse HEAD failed".to_string(),
        });
    };
    if Some(&head) == last_harvested_commit(db, project_path).as_ref() {
        return Ok(TickOutcome::NoChange);
    }
    let result = super::harvest_commit(
        db, vault, repo_root, project_path, config, llm, api_key, &head,
    )
    .await?;
    let action = if result.skipped {
        result.skip_reason.unwrap_or_else(|| "skipped".to_string())
    } else {
        result.action.unwrap_or_else(|| "harvested".to_string())
    };
    Ok(TickOutcome::Harvested {
        commit_hash: head,
        action,
    })
}

/// Spawn the poll loop as a background tokio task. Returns the
/// cancellation handle — drop or send `true` to stop. The loop
/// pauses for `poll_interval` between ticks; on tick error the loop
/// logs and continues.
///
/// Phase 5 wires this into AppState startup once the per-project
/// Recall handle is available. The watcher is *not* started
/// automatically in Phase 3.
#[allow(clippy::too_many_arguments)]
pub fn spawn_watch_loop(
    db: Arc<Database>,
    vault: Arc<Vault>,
    repo_root: PathBuf,
    project_path: PathBuf,
    config: Arc<RecallConfig>,
    llm: Arc<dyn LlmClient + Send + Sync>,
    api_key: String,
    poll_interval: Duration,
) -> watch::Sender<bool> {
    let (tx, mut rx) = watch::channel(false);
    tokio::spawn(async move {
        log::info!(
            "[recall.watcher] started for {} (poll {:?})",
            project_path.display(),
            poll_interval
        );
        loop {
            if *rx.borrow() {
                log::info!("[recall.watcher] stop signal received");
                break;
            }
            match tick(
                &db,
                &vault,
                &repo_root,
                &project_path,
                &config,
                llm.as_ref(),
                &api_key,
            )
            .await
            {
                Ok(TickOutcome::NoChange) => {}
                Ok(TickOutcome::Harvested { commit_hash, action }) => {
                    log::info!(
                        "[recall.watcher] {} → {} ({})",
                        &commit_hash[..commit_hash.len().min(7)],
                        action,
                        Utc::now()
                    );
                }
                Ok(TickOutcome::Unreadable { reason }) => {
                    log::debug!("[recall.watcher] unreadable: {}", reason);
                }
                Err(e) => {
                    log::warn!("[recall.watcher] tick failed: {}", e);
                }
            }
            tokio::select! {
                _ = sleep(poll_interval) => {}
                _ = rx.changed() => {}
            }
        }
    });
    tx
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::llm_client::MockLlmClient;
    use std::path::PathBuf;
    use std::process::Command as PCommand;
    use tempfile::TempDir;

    fn fresh_db() -> std::sync::Arc<Database> {
        let tmp = tempfile::Builder::new()
            .prefix("recall-w-")
            .suffix(".db")
            .tempfile()
            .unwrap();
        let path = tmp.path().to_string_lossy().to_string();
        std::mem::forget(tmp);
        std::sync::Arc::new(Database::new(&path).unwrap())
    }

    fn make_repo(message: &str) -> (TempDir, PathBuf, String) {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();
        let run = |args: &[&str]| {
            PCommand::new("git").args(args).current_dir(&path).output().unwrap();
        };
        std::env::set_var("GIT_COMMITTER_DATE", "2026-06-01T12:00:00Z");
        std::env::set_var("GIT_AUTHOR_DATE", "2026-06-01T12:00:00Z");
        run(&["init", "--quiet", "-b", "main"]);
        run(&["config", "user.email", "t@example.com"]);
        run(&["config", "user.name", "Tester"]);
        std::fs::create_dir_all(path.join("src")).unwrap();
        std::fs::write(path.join("src/x.rs"), "fn x() {}\n").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", message]);
        let head = PCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&path)
            .output()
            .unwrap();
        let hash = String::from_utf8_lossy(&head.stdout).trim().to_string();
        (tmp, path, hash)
    }

    fn cfg() -> RecallConfig {
        RecallConfig {
            enabled: true,
            ..RecallConfig::default()
        }
    }

    #[test]
    fn head_commit_returns_hash_for_real_repo() {
        let (_tmp, path, hash) = make_repo("init");
        assert_eq!(head_commit(&path), Some(hash));
    }

    #[test]
    fn head_commit_returns_none_for_empty_repo() {
        let tmp = TempDir::new().unwrap();
        PCommand::new("git")
            .args(["init", "--quiet", "-b", "main"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        assert!(head_commit(tmp.path()).is_none());
    }

    #[test]
    fn head_commit_returns_none_for_non_repo_directory() {
        let tmp = TempDir::new().unwrap();
        assert!(head_commit(tmp.path()).is_none());
    }

    #[test]
    fn last_harvested_returns_none_when_no_rows_yet() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        assert!(last_harvested_commit(&db, tmp.path()).is_none());
    }

    #[tokio::test]
    async fn tick_unreadable_when_repo_is_empty() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        PCommand::new("git")
            .args(["init", "--quiet", "-b", "main"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        let outcome = tick(&db, &vault, tmp.path(), tmp.path(), &cfg(), &llm, "k").await.unwrap();
        assert!(matches!(outcome, TickOutcome::Unreadable { .. }));
    }

    #[tokio::test]
    async fn tick_harvests_when_head_differs_from_last_recorded() {
        let db = fresh_db();
        let (_tmp, path, hash) = make_repo("feat: thing");
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r###"{"title":"t","id_slug":"t-slug","body":"## What\nfn x","tags":[]}"###,
            100,
            30,
        );
        let outcome = tick(&db, &vault, &path, &path, &cfg(), &llm, "k").await.unwrap();
        match outcome {
            TickOutcome::Harvested { commit_hash, action } => {
                assert_eq!(commit_hash, hash);
                assert_eq!(action, "created");
            }
            other => panic!("expected Harvested, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn tick_returns_no_change_when_head_is_already_harvested() {
        let db = fresh_db();
        let (_tmp, path, _hash) = make_repo("feat: thing");
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r###"{"title":"t","id_slug":"t-slug","body":"## What\nfn x","tags":[]}"###,
            100,
            30,
        );
        // First tick: harvest.
        let _ = tick(&db, &vault, &path, &path, &cfg(), &llm, "k").await.unwrap();
        // Second tick: no change.
        let second = tick(&db, &vault, &path, &path, &cfg(), &llm, "k").await.unwrap();
        assert_eq!(second, TickOutcome::NoChange);
    }

    #[tokio::test]
    async fn tick_picks_up_new_commit_after_first_harvest() {
        let db = fresh_db();
        let (_tmp, path, _hash) = make_repo("feat: first");
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r###"{"title":"a","id_slug":"a","body":"## What\nx","tags":[]}"###,
            10,
            5,
        );
        llm.enqueue_ok(
            r###"{"title":"b","id_slug":"b","body":"## What\ny","tags":[]}"###,
            10,
            5,
        );

        let first = tick(&db, &vault, &path, &path, &cfg(), &llm, "k").await.unwrap();
        assert!(matches!(first, TickOutcome::Harvested { .. }));

        // Make a second commit.
        std::fs::write(path.join("src/x.rs"), "fn x() {} // v2\n").unwrap();
        PCommand::new("git")
            .args(["commit", "-q", "-am", "feat: second"])
            .current_dir(&path)
            .output()
            .unwrap();

        let second = tick(&db, &vault, &path, &path, &cfg(), &llm, "k").await.unwrap();
        assert!(matches!(second, TickOutcome::Harvested { .. }));
    }
}
