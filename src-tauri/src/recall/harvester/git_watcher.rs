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

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::watch;
use tokio::time::sleep;

use crate::commands::settings::ModelPricing;
use crate::recall::config::RecallConfig;
use crate::recall::llm_client::{LlmClient, RealLlmClient};
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

/// A live per-project harvest watcher plus the count of open sessions
/// keeping it alive. Stored in `AppState.harvest_watchers`, keyed by
/// project path. The watcher is spawned when the first session for a
/// project opens and cancelled when the last one closes.
pub struct HarvestWatcher {
    /// Cancellation handle — `send(true)` (or drop) stops the loop.
    pub cancel: watch::Sender<bool>,
    /// Number of open sessions for this project. The watcher is shared
    /// across them; cancelled only when this reaches zero.
    pub refcount: usize,
}

/// Ensure a harvest watcher is running for `project_path`, reference
/// counted by open sessions. Spawns a new watcher on the first call for
/// a project and just bumps the refcount on subsequent calls. A failure
/// to open the vault is logged and swallowed — harvesting must never
/// block or fail session creation.
///
/// The caller is responsible for the `recall.enabled && mode != Off`
/// gate (see `ensure_harvest_watcher` in `commands::session`); this
/// function takes config explicitly so it stays free of global settings
/// reads and is unit-testable.
#[allow(clippy::too_many_arguments)]
pub fn start_harvest_watcher(
    watchers: &mut HashMap<String, HarvestWatcher>,
    db: Arc<Database>,
    project_path: &str,
    config: &RecallConfig,
    api_key: String,
    pricing: HashMap<String, ModelPricing>,
    poll_interval: Duration,
) {
    if let Some(existing) = watchers.get_mut(project_path) {
        existing.refcount += 1;
        return;
    }
    let vault_path = PathBuf::from(project_path).join(".recall");
    let vault = match Vault::open_or_create(&vault_path) {
        Ok(v) => Arc::new(v),
        Err(e) => {
            log::warn!(
                "[recall.watcher] vault open failed for {}: {}; harvester not started",
                project_path,
                e
            );
            return;
        }
    };
    let llm: Arc<dyn LlmClient + Send + Sync> = Arc::new(RealLlmClient::new(pricing));
    let cancel = spawn_watch_loop(
        db,
        vault,
        PathBuf::from(project_path),
        PathBuf::from(project_path),
        Arc::new(config.clone()),
        llm,
        api_key,
        poll_interval,
    );
    watchers.insert(project_path.to_string(), HarvestWatcher { cancel, refcount: 1 });
}

/// Release one session's hold on a project's harvest watcher. The
/// watcher is cancelled and removed only when the last session closes.
/// A no-op when no watcher exists for the project (e.g. Recall was off
/// at session creation).
pub fn stop_harvest_watcher(
    watchers: &mut HashMap<String, HarvestWatcher>,
    project_path: &str,
) {
    if let Some(existing) = watchers.get_mut(project_path) {
        if existing.refcount > 1 {
            existing.refcount -= 1;
        } else {
            let _ = existing.cancel.send(true);
            watchers.remove(project_path);
        }
    }
}

/// Cancel every running harvest watcher (app shutdown). Drains the map.
pub fn stop_all_harvest_watchers(watchers: &mut HashMap<String, HarvestWatcher>) {
    for (_, watcher) in watchers.drain() {
        let _ = watcher.cancel.send(true);
    }
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

    #[tokio::test]
    async fn start_harvest_watcher_refcounts_and_cancels() {
        let db = fresh_db();
        // A non-git directory: the loop just no-ops (Unreadable) so no
        // real LLM call is made — we're testing the refcount lifecycle.
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_string_lossy().to_string();
        let mut watchers: HashMap<String, HarvestWatcher> = HashMap::new();

        start_harvest_watcher(
            &mut watchers,
            db.clone(),
            &project,
            &cfg(),
            "k".to_string(),
            HashMap::new(),
            Duration::from_secs(60),
        );
        assert_eq!(watchers.len(), 1);
        assert_eq!(watchers.get(&project).unwrap().refcount, 1);

        // A second session for the same project bumps the refcount;
        // it must NOT spawn a second watcher.
        start_harvest_watcher(
            &mut watchers,
            db.clone(),
            &project,
            &cfg(),
            "k".to_string(),
            HashMap::new(),
            Duration::from_secs(60),
        );
        assert_eq!(watchers.len(), 1);
        assert_eq!(watchers.get(&project).unwrap().refcount, 2);

        // Subscribe so we can observe the cancel signal.
        let rx = watchers.get(&project).unwrap().cancel.subscribe();

        // First release: still held by one session.
        stop_harvest_watcher(&mut watchers, &project);
        assert_eq!(watchers.get(&project).unwrap().refcount, 1);
        assert!(!*rx.borrow(), "not cancelled while a session still holds it");

        // Last release: cancelled and removed.
        stop_harvest_watcher(&mut watchers, &project);
        assert!(watchers.is_empty());
        assert!(*rx.borrow(), "cancel signal fired when the last session closed");
    }

    #[tokio::test]
    async fn stop_harvest_watcher_is_noop_for_unknown_project() {
        let mut watchers: HashMap<String, HarvestWatcher> = HashMap::new();
        // No panic, no change — Recall may have been off at session open.
        stop_harvest_watcher(&mut watchers, "/no/such/project");
        assert!(watchers.is_empty());
    }

    #[tokio::test]
    async fn stop_all_harvest_watchers_cancels_every_watcher() {
        let db = fresh_db();
        let tmp_a = TempDir::new().unwrap();
        let tmp_b = TempDir::new().unwrap();
        let proj_a = tmp_a.path().to_string_lossy().to_string();
        let proj_b = tmp_b.path().to_string_lossy().to_string();
        let mut watchers: HashMap<String, HarvestWatcher> = HashMap::new();
        for p in [&proj_a, &proj_b] {
            start_harvest_watcher(
                &mut watchers,
                db.clone(),
                p,
                &cfg(),
                "k".to_string(),
                HashMap::new(),
                Duration::from_secs(60),
            );
        }
        assert_eq!(watchers.len(), 2);
        let rx_a = watchers.get(&proj_a).unwrap().cancel.subscribe();
        let rx_b = watchers.get(&proj_b).unwrap().cancel.subscribe();

        stop_all_harvest_watchers(&mut watchers);
        assert!(watchers.is_empty());
        assert!(*rx_a.borrow());
        assert!(*rx_b.borrow());
    }

    #[tokio::test]
    async fn watch_loop_harvests_new_commit_then_stops() {
        // End-to-end proof that the wired loop produces a harvest row —
        // i.e. "Harvests logged" moves off zero once a watcher runs.
        let db = fresh_db();
        let (_tmp, path, _hash) = make_repo("feat: thing");
        let vault_tmp = TempDir::new().unwrap();
        let vault = Arc::new(Vault::open_or_create(vault_tmp.path()).unwrap());
        let llm = Arc::new(MockLlmClient::new());
        llm.enqueue_ok(
            r###"{"title":"t","id_slug":"t-slug","body":"## What\nfn x","tags":[]}"###,
            100,
            30,
        );
        let cancel = spawn_watch_loop(
            db.clone(),
            vault,
            path.clone(),
            path.clone(),
            Arc::new(cfg()),
            llm.clone() as Arc<dyn LlmClient + Send + Sync>,
            "k".to_string(),
            Duration::from_millis(20),
        );

        // Poll for the harvest row (cap ~2s so the test never hangs).
        let mut harvested = false;
        for _ in 0..100 {
            sleep(Duration::from_millis(20)).await;
            let count: i64 = db
                .conn()
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM recall_harvests", [], |r| r.get(0))
                .unwrap();
            if count >= 1 {
                harvested = true;
                break;
            }
        }
        let _ = cancel.send(true);
        assert!(harvested, "the watch loop harvested the HEAD commit");
    }
}
