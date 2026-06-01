//! Harvester pipeline (RECALL-SPEC §7).
//!
//! Six steps:
//! 1. **collect**   — `git show` parsed into a [`CommitInfo`]
//! 2. **classify**  — skip rules + type inference
//! 3. **generate**  — LLM note synthesis (diff-anchored claims)
//! 4. **fidelity**  — diff-token verification (downgrades trust)
//! 5. **dedupe**    — supersede vs `prior_occurrences[]` vs new
//! 6. **journal**   — append entry under `<vault>/journal/YYYY-MM-DD.md`
//!
//! Plus the [`git_watcher`] polling loop that drives `harvest_commit`
//! from filesystem state.

pub mod classify;
pub mod dedupe;
pub mod fidelity;
pub mod generate;
pub mod git_watcher;
pub mod journal;

use std::path::Path;

use chrono::Utc;
use serde::Serialize;

use crate::recall::config::RecallConfig;
use crate::recall::git::{show_commit, CommitInfo};
use crate::recall::index::ingest::ingest_note;
use crate::recall::index::ensure_vault_row;
use crate::recall::llm_client::LlmClient;
use crate::recall::vault::{Trust, Vault};
use crate::recall::RecallError;
use crate::storage::Database;

pub use classify::{Classification, SkipReason};
pub use dedupe::DedupeAction;
pub use fidelity::FidelityStatus;
pub use journal::HarvestAction;

/// Final outcome of one `harvest_commit` call. Used by the audit log
/// (`recall_harvests`) and the sidebar feed.
#[derive(Debug, Clone, Serialize)]
pub struct HarvestResult {
    pub commit_hash: String,
    /// Skipped: only `skip_reason` is set; `note_id`, `action`, and
    /// fidelity are absent. Harvested: all fields populated.
    pub skipped: bool,
    pub skip_reason: Option<String>,
    pub note_id: Option<String>,
    pub action: Option<String>,
    pub fidelity_status: Option<String>,
    pub flagged_tokens: Vec<String>,
    pub model_used: Option<String>,
    pub cost_usd: f64,
}

/// Harvest one commit. The single end-to-end entry point; tests +
/// the git_watcher background task both call this. The eight
/// parameters thread db + vault + repo + project + config + LLM +
/// key + commit; bundling them into a struct adds plumbing without
/// reducing coupling (every field is required) so the lint is
/// allowed locally.
#[allow(clippy::too_many_arguments)]
pub async fn harvest_commit(
    db: &Database,
    vault: &Vault,
    repo_root: &Path,
    project_path: &Path,
    config: &RecallConfig,
    llm: &dyn LlmClient,
    api_key: &str,
    commit_hash: &str,
) -> Result<HarvestResult, RecallError> {
    // 1) Collect.
    let commit = show_commit(repo_root, commit_hash)?;
    // Defensive: if we've already harvested this commit (de-dup by
    // hash in recall_harvests), bail with a skipped result.
    if already_harvested(db, project_path, commit_hash)? {
        return Ok(skipped_result(commit_hash, "duplicate"));
    }

    // 2) Classify.
    let classification = classify::classify(&commit);
    let note_type = match classification {
        Classification::Skip(reason) => {
            let result = skipped_result(commit_hash, reason.as_str());
            log_harvest(db, project_path, &result, None);
            return Ok(result);
        }
        Classification::Harvest(t) => t,
    };

    // 3) Generate.
    let generated = generate::generate(llm, api_key, config, &commit, note_type).await?;
    let mut note = generated.note;
    let usage = generated.usage;

    // 4) Fidelity.
    let fidelity_report = fidelity::check(&note.body, &commit);
    if fidelity_report.status == FidelityStatus::Flagged {
        note.trust = Trust::Medium;
    }

    // Ensure the vault is registered in recall_vaults before any
    // dedupe SQL runs (the path-overlap query joins on vault_id).
    let vault_id = ensure_vault_row(db, project_path, vault.root(), false)?;

    // 5) Dedupe.
    let location = derive_location(&commit);
    let dedupe_action =
        dedupe::decide(db, vault, vault_id, &note, &commit.hash, &location)?;

    let (stored_note, action_label, journal_action) = match dedupe_action {
        DedupeAction::Fresh => {
            // Ensure the slug is unique under this vault.
            note.id = make_unique_slug(db, vault_id, &note.id)?;
            let written_path = vault.write_note(&note)?;
            let rel = written_path
                .strip_prefix(vault.root())
                .map(|p| p.to_path_buf())
                .unwrap_or(written_path);
            ingest_note(db, vault_id, &note, &rel)?;
            (note, "created", HarvestAction::Created)
        }
        DedupeAction::Recurrence { existing_note_id, new_occurrence, bump_to_recurring } => {
            let updated = dedupe::apply_recurrence(
                vault,
                &existing_note_id,
                note_type,
                new_occurrence,
                bump_to_recurring,
            )?;
            let rel = std::path::PathBuf::from(note_type.vault_subdir())
                .join(format!("{}.md", updated.id));
            ingest_note(db, vault_id, &updated, &rel)?;
            (updated, "recurrence", HarvestAction::Recurrence)
        }
        DedupeAction::Supersede { existing_note_id } => {
            let _superseded = dedupe::apply_supersede(vault, &existing_note_id, note_type)?;
            // Re-ingest the superseded one so its status='superseded' is in the index.
            let rel_old = std::path::PathBuf::from(note_type.vault_subdir())
                .join(format!("{}.md", existing_note_id));
            let outcome = vault.read_note(&rel_old)?;
            ingest_note(db, vault_id, &outcome.note, &rel_old)?;
            // Add a link in the new note to the superseded one.
            note.links.push(format!("[[{}]]", existing_note_id));
            // Persist new note.
            note.id = make_unique_slug(db, vault_id, &note.id)?;
            let written_path = vault.write_note(&note)?;
            let rel = written_path
                .strip_prefix(vault.root())
                .map(|p| p.to_path_buf())
                .unwrap_or(written_path);
            ingest_note(db, vault_id, &note, &rel)?;
            (note, "superseded", HarvestAction::Superseded)
        }
    };

    // 6) Journal.
    let _ = journal::append(
        vault,
        Utc::now().date_naive(),
        &short_hash(commit_hash),
        &stored_note,
        journal_action,
    );

    let result = HarvestResult {
        commit_hash: commit_hash.to_string(),
        skipped: false,
        skip_reason: None,
        note_id: Some(stored_note.id.clone()),
        action: Some(action_label.to_string()),
        fidelity_status: Some(if fidelity_report.status == FidelityStatus::Clean {
            "clean".to_string()
        } else {
            "flagged".to_string()
        }),
        flagged_tokens: fidelity_report.flagged_tokens,
        model_used: Some(usage.model.clone()),
        cost_usd: usage.cost_usd,
    };
    log_harvest(db, project_path, &result, Some(stored_note.id.as_str()));
    Ok(result)
}

fn skipped_result(commit_hash: &str, reason: &str) -> HarvestResult {
    HarvestResult {
        commit_hash: commit_hash.to_string(),
        skipped: true,
        skip_reason: Some(reason.to_string()),
        note_id: None,
        action: None,
        fidelity_status: None,
        flagged_tokens: vec![],
        model_used: None,
        cost_usd: 0.0,
    }
}

fn already_harvested(
    db: &Database,
    project_path: &Path,
    commit_hash: &str,
) -> Result<bool, RecallError> {
    let project_str = project_path.to_string_lossy().to_string();
    let guard = db.conn().lock().unwrap();
    let count: i64 = guard.query_row(
        "SELECT COUNT(*) FROM recall_harvests WHERE project_path = ?1 AND commit_hash = ?2",
        rusqlite::params![project_str, commit_hash],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

fn log_harvest(
    db: &Database,
    project_path: &Path,
    result: &HarvestResult,
    note_id_text: Option<&str>,
) {
    // Look up the recall_notes.id by note_id slug, if any.
    let project_str = project_path.to_string_lossy().to_string();
    let now = Utc::now().to_rfc3339();
    let flagged_json = serde_json::to_string(&result.flagged_tokens)
        .unwrap_or_else(|_| "[]".to_string());

    let mut row_id: Option<i64> = None;
    if let Some(slug) = note_id_text {
        let guard = db.conn().lock().unwrap();
        row_id = guard
            .query_row(
                "SELECT n.id FROM recall_notes n
                   JOIN recall_vaults v ON v.id = n.vault_id
                  WHERE v.project_path = ?1 AND n.note_id = ?2",
                rusqlite::params![project_str, slug],
                |r| r.get::<_, i64>(0),
            )
            .ok();
    }

    let guard = db.conn().lock().unwrap();
    if let Err(e) = guard.execute(
        "INSERT INTO recall_harvests
            (project_path, session_id, commit_hash, occurred_at, note_id,
             fidelity_status, flagged_tokens, model_used, cost_usd)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            project_str,
            result.commit_hash,
            now,
            row_id,
            result.fidelity_status.as_deref().or(result.skip_reason.as_deref()),
            flagged_json,
            result.model_used,
            result.cost_usd,
        ],
    ) {
        log::warn!("[recall.harvest] failed to log harvest row: {}", e);
    }
}

fn derive_location(commit: &CommitInfo) -> String {
    // First touched file path is a reasonable proxy for "where this
    // landed" when no finer-grained location is available. The
    // harvester's prior_occurrences[] uses this as the human-readable
    // label.
    commit
        .files
        .first()
        .map(|f| f.path.clone())
        .unwrap_or_else(|| commit.subject.clone())
}

fn short_hash(hash: &str) -> String {
    let len = hash.len().min(7);
    hash[..len].to_string()
}

/// If `slug` is already used by a note in this vault, suffix it with
/// a short hash derived from the current time so the UNIQUE
/// constraint on `(vault_id, note_id)` doesn't reject our insert.
fn make_unique_slug(db: &Database, vault_id: i64, slug: &str) -> Result<String, RecallError> {
    let exists: i64 = {
        let guard = db.conn().lock().unwrap();
        guard.query_row(
            "SELECT COUNT(*) FROM recall_notes WHERE vault_id = ?1 AND note_id = ?2",
            rusqlite::params![vault_id, slug],
            |r| r.get(0),
        )?
    };
    if exists == 0 {
        return Ok(slug.to_string());
    }
    // Collision — append timestamp suffix.
    let suffix = Utc::now().format("%Y%m%d%H%M%S").to_string();
    Ok(format!("{}-{}", slug, suffix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::llm_client::MockLlmClient;
    use crate::recall::vault::Vault;
    use std::path::PathBuf;
    use std::process::Command as PCommand;
    use tempfile::TempDir;

    fn cfg() -> RecallConfig {
        RecallConfig {
            enabled: true,
            ..RecallConfig::default()
        }
    }

    fn fresh_db() -> std::sync::Arc<crate::storage::Database> {
        let tmp = tempfile::Builder::new()
            .prefix("recall-h-")
            .suffix(".db")
            .tempfile()
            .unwrap();
        let path = tmp.path().to_string_lossy().to_string();
        std::mem::forget(tmp);
        std::sync::Arc::new(crate::storage::Database::new(&path).unwrap())
    }

    fn make_repo(commit_message: &str, files: &[(&str, &str)]) -> (TempDir, PathBuf, String) {
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
        run(&["config", "user.name", "Tester"]);
        for (f, body) in files {
            let full = path.join(f);
            if let Some(p) = full.parent() {
                std::fs::create_dir_all(p).unwrap();
            }
            std::fs::write(&full, body).unwrap();
        }
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", commit_message]);
        let head = PCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&path)
            .output()
            .unwrap();
        let hash = String::from_utf8_lossy(&head.stdout).trim().to_string();
        (tmp, path, hash)
    }

    fn ok_response_for(slug: &str, title: &str) -> String {
        format!(
            r###"{{"title":"{}","id_slug":"{}","body":"## What changed\nadded {}.\n\n## Why\nfix","tags":["test"]}}"###,
            title, slug, slug
        )
    }

    #[tokio::test]
    async fn skipped_commit_does_not_invoke_llm() {
        let db = fresh_db();
        let (_repo, repo_path, hash) =
            make_repo("chore: bump version [no-recall]", &[("v.txt", "1\n")]);
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new(); // no responses → would panic if called
        let result = harvest_commit(&db, &vault, &repo_path, &repo_path, &cfg(), &llm, "k", &hash)
            .await
            .unwrap();
        assert!(result.skipped);
        assert_eq!(result.skip_reason.as_deref(), Some("no-recall-marker"));
        assert!(llm.calls().is_empty());
    }

    #[tokio::test]
    async fn fix_commit_produces_a_landmine_note() {
        let db = fresh_db();
        let (_repo, repo_path, hash) = make_repo(
            "fix(auth): handle empty session",
            &[("src/auth.rs", "fn handle() {}\n")],
        );
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        llm.enqueue_ok(ok_response_for("empty-session-handler", "empty session handler"), 200, 80);

        let result = harvest_commit(&db, &vault, &repo_path, &repo_path, &cfg(), &llm, "k", &hash)
            .await
            .unwrap();
        assert!(!result.skipped);
        assert_eq!(result.action.as_deref(), Some("created"));
        assert!(result.note_id.is_some());

        // Note file exists on disk under the landmine subdir.
        let note_path = vault_tmp.path().join("notes/landmines").join(format!(
            "{}.md",
            result.note_id.as_ref().unwrap()
        ));
        assert!(note_path.exists(), "expected note at {}", note_path.display());

        // Audit row in recall_harvests.
        let guard = db.conn().lock().unwrap();
        let row_count: i64 = guard
            .query_row("SELECT COUNT(*) FROM recall_harvests", [], |r| r.get(0))
            .unwrap();
        assert_eq!(row_count, 1);
    }

    #[tokio::test]
    async fn duplicate_commit_is_skipped() {
        let db = fresh_db();
        let (_repo, repo_path, hash) = make_repo(
            "feat: add it",
            &[("src/x.rs", "fn x() {}\n")],
        );
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        llm.enqueue_ok(ok_response_for("the-thing", "the thing"), 100, 30);

        let first = harvest_commit(&db, &vault, &repo_path, &repo_path, &cfg(), &llm, "k", &hash)
            .await
            .unwrap();
        assert!(!first.skipped);

        // Second call with the same hash should short-circuit.
        let second = harvest_commit(&db, &vault, &repo_path, &repo_path, &cfg(), &llm, "k", &hash)
            .await
            .unwrap();
        assert!(second.skipped);
        assert_eq!(second.skip_reason.as_deref(), Some("duplicate"));
    }

    #[tokio::test]
    async fn fidelity_failure_downgrades_trust_in_stored_note() {
        let db = fresh_db();
        let (_repo, repo_path, hash) = make_repo(
            "fix(auth): real symbol",
            &[("src/auth.rs", "fn real_fn() {}\n")],
        );
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        // Note body references a symbol that does NOT appear in the diff.
        llm.enqueue_ok(
            r###"{"title":"Bad","id_slug":"bad","body":"changed `fictional_invented_symbol` in src/auth.rs","tags":[]}"###,
            100,
            30,
        );
        let result = harvest_commit(&db, &vault, &repo_path, &repo_path, &cfg(), &llm, "k", &hash)
            .await
            .unwrap();
        assert!(!result.skipped);
        assert_eq!(result.fidelity_status.as_deref(), Some("flagged"));
        assert!(!result.flagged_tokens.is_empty());

        // The persisted note has trust:medium.
        let slug = result.note_id.unwrap();
        let path = vault_tmp.path().join(format!("notes/landmines/{}.md", slug));
        let body = std::fs::read_to_string(path).unwrap();
        assert!(body.contains("trust: medium"));
    }

    #[tokio::test]
    async fn recurring_commit_appends_prior_occurrence() {
        let db = fresh_db();
        let (_repo, repo_path, hash) = make_repo(
            "fix(creds): pgcrypto search path",
            &[("src/credentials.rs", "fn x() {}\n")],
        );
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        // Two calls produce notes with similar titles → recurrence on the 2nd.
        llm.enqueue_ok(
            ok_response_for("pgcrypto-search-path-landmine", "pgcrypto search path landmine"),
            100,
            30,
        );

        let _first = harvest_commit(&db, &vault, &repo_path, &repo_path, &cfg(), &llm, "k", &hash)
            .await
            .unwrap();

        // Second commit hitting the same file with a similar title.
        std::fs::write(repo_path.join("src/credentials.rs"), "fn x() {} // change\n").unwrap();
        PCommand::new("git")
            .args(["commit", "-q", "-am", "fix(creds): pgcrypto search path again"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        let new_head = PCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        let new_hash = String::from_utf8_lossy(&new_head.stdout).trim().to_string();

        llm.enqueue_ok(
            ok_response_for("pgcrypto-search-path-redux", "pgcrypto search path issue"),
            100,
            30,
        );

        let second = harvest_commit(
            &db,
            &vault,
            &repo_path,
            &repo_path,
            &cfg(),
            &llm,
            "k",
            &new_hash,
        )
        .await
        .unwrap();
        assert!(!second.skipped);
        assert_eq!(second.action.as_deref(), Some("recurrence"));

        // The existing note now has 1 prior_occurrence.
        let path = vault_tmp.path().join("notes/landmines/pgcrypto-search-path-landmine.md");
        let body = std::fs::read_to_string(path).unwrap();
        assert!(body.contains("prior_occurrences:"));
        assert!(body.contains(&new_hash[..7]));
    }

    #[tokio::test]
    async fn locales_only_commit_is_skipped() {
        let db = fresh_db();
        let (_repo, repo_path, hash) = make_repo(
            "feat: translate",
            &[("src/locales/en.json", "{}\n")],
        );
        let vault_tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
        let llm = MockLlmClient::new();
        let result = harvest_commit(&db, &vault, &repo_path, &repo_path, &cfg(), &llm, "k", &hash)
            .await
            .unwrap();
        assert!(result.skipped);
        assert_eq!(result.skip_reason.as_deref(), Some("i18n-only"));
    }

    #[test]
    fn short_hash_truncates_to_seven() {
        assert_eq!(short_hash("abcdef1234567890"), "abcdef1");
        assert_eq!(short_hash("ab"), "ab"); // shorter than 7 — unchanged
    }
}
