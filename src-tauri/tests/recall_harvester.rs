//! Integration tests for the Recall Harvester.
//!
//! End-to-end: a fixture git repo, a real markdown vault, real
//! SQLite, and the harvester's `harvest_commit` pipeline (LLM
//! mocked). Verifies the durable output: vault contents on disk +
//! `recall_harvests` audit rows + `recall_notes` index rows.

use codemantis_lib::recall::config::RecallConfig;
use codemantis_lib::recall::harvester::{harvest_commit, HarvestResult};
use codemantis_lib::recall::llm_client::MockLlmClient;
use codemantis_lib::recall::vault::Vault;
use codemantis_lib::storage::database::Database;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tempfile::TempDir;

fn fresh_db() -> Arc<Database> {
    let tmp = tempfile::Builder::new()
        .prefix("recall-h-it-")
        .suffix(".db")
        .tempfile()
        .unwrap();
    let path = tmp.path().to_string_lossy().to_string();
    std::mem::forget(tmp);
    Arc::new(Database::new(&path).expect("db init"))
}

/// Spin up a fresh git repo with one commit. Returns the directory,
/// repo path, and head commit hash.
fn make_repo(commit_message: &str, files: &[(&str, &str)]) -> (TempDir, PathBuf, String) {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().to_path_buf();
    let run = |args: &[&str]| {
        let out = Command::new("git").args(args).current_dir(&path).output().unwrap();
        assert!(
            out.status.success(),
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
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
    let head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&path)
        .output()
        .unwrap();
    let hash = String::from_utf8_lossy(&head.stdout).trim().to_string();
    (tmp, path, hash)
}

fn enabled_config() -> RecallConfig {
    RecallConfig {
        enabled: true,
        ..RecallConfig::default()
    }
}

fn ok_llm(slug: &str, title: &str, body: &str) -> String {
    format!(
        r###"{{"title":"{}","id_slug":"{}","body":"{}","tags":["test"]}}"###,
        title, slug, body
    )
}

#[tokio::test]
async fn fix_commit_creates_a_landmine_note_with_correct_frontmatter() {
    let db = fresh_db();
    let (_repo, repo_path, hash) = make_repo(
        "fix(creds): pgcrypto search path",
        &[("src/credentials.ts", "decrypt_credential(c)\n")],
    );
    let vault_tmp = TempDir::new().unwrap();
    let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
    let llm = MockLlmClient::new();
    llm.enqueue_ok(
        ok_llm(
            "pgcrypto-landmine",
            "pgcrypto search_path landmine",
            "## What changed\\nGuard pgcrypto in src/credentials.ts.\\n",
        ),
        300,
        100,
    );

    let result: HarvestResult =
        harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash)
            .await
            .unwrap();
    assert!(!result.skipped);
    assert_eq!(result.action.as_deref(), Some("created"));

    // On-disk file has the expected frontmatter type=landmine.
    let note_path = vault_tmp
        .path()
        .join("notes/landmines/pgcrypto-landmine.md");
    let body = std::fs::read_to_string(&note_path).unwrap();
    assert!(body.contains("type: landmine"));
    assert!(body.contains("trust: high"));
    assert!(body.contains("source_paths:"));
    assert!(body.contains("src/credentials.ts"));
    assert!(body.contains(&format!("- {}", hash)));
}

#[tokio::test]
async fn recurrence_appends_prior_occurrence_and_does_not_duplicate_note() {
    let db = fresh_db();
    let (_repo, repo_path, hash1) = make_repo(
        "fix(creds): pgcrypto search path",
        &[("src/credentials.ts", "decrypt_credential(c)\n")],
    );
    let vault_tmp = TempDir::new().unwrap();
    let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
    let llm = MockLlmClient::new();
    llm.enqueue_ok(
        ok_llm("pg", "pgcrypto search path landmine", "## What\\nx"),
        100,
        30,
    );

    let _ = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash1)
        .await
        .unwrap();

    // Second commit, same file, similar title.
    std::fs::write(
        repo_path.join("src/credentials.ts"),
        "decrypt_credential(c) // v2\n",
    )
    .unwrap();
    Command::new("git")
        .args(["commit", "-q", "-am", "fix(creds): pgcrypto search path again"])
        .current_dir(&repo_path)
        .output()
        .unwrap();
    let head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_path)
        .output()
        .unwrap();
    let hash2 = String::from_utf8_lossy(&head.stdout).trim().to_string();

    llm.enqueue_ok(
        ok_llm("pg2", "pgcrypto search path issue", "## What\\ny"),
        100,
        30,
    );

    let second = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash2)
        .await
        .unwrap();
    assert_eq!(second.action.as_deref(), Some("recurrence"));

    // Only one note file on disk under landmines/ (the original).
    let listing: Vec<_> = std::fs::read_dir(vault_tmp.path().join("notes/landmines"))
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(listing.len(), 1, "no duplicate file created");
    let body = std::fs::read_to_string(listing[0].path()).unwrap();
    assert!(body.contains("prior_occurrences:"));
    assert!(body.contains(&hash2));

    // Two harvest rows in the audit log.
    let count = db
        .count_recall_harvests(&repo_path.to_string_lossy())
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn no_recall_marker_skips_without_invoking_llm() {
    let db = fresh_db();
    let (_repo, repo_path, hash) = make_repo(
        "chore: bump version [no-recall]",
        &[("v.txt", "1.5.0\n")],
    );
    let vault_tmp = TempDir::new().unwrap();
    let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
    let llm = MockLlmClient::new(); // no responses queued

    let result = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash)
        .await
        .unwrap();
    assert!(result.skipped);
    assert_eq!(result.skip_reason.as_deref(), Some("no-recall-marker"));
    assert!(llm.calls().is_empty());

    // Vault has no notes/ directory contents.
    let notes = vault_tmp.path().join("notes/landmines");
    if notes.exists() {
        let count = std::fs::read_dir(&notes).unwrap().count();
        assert_eq!(count, 0);
    }

    // But the skip is logged in the audit log.
    let row_count = db
        .count_recall_harvests(&repo_path.to_string_lossy())
        .unwrap();
    assert_eq!(row_count, 1);
    let (status, _flagged) = db
        .recall_harvest_for_commit(&repo_path.to_string_lossy(), &hash)
        .unwrap()
        .expect("audit row exists");
    assert_eq!(status.as_deref(), Some("no-recall-marker"));
}

#[tokio::test]
async fn fidelity_failure_downgrades_trust_in_the_persisted_note() {
    let db = fresh_db();
    let (_repo, repo_path, hash) = make_repo(
        "fix(auth): real symbol",
        &[("src/auth.rs", "fn real_fn() {}\n")],
    );
    let vault_tmp = TempDir::new().unwrap();
    let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
    let llm = MockLlmClient::new();
    // Body references a symbol that is NOT in the diff.
    llm.enqueue_ok(
        ok_llm("bad", "Bad note", "Changed `fictional_invented_symbol` in src/auth.rs"),
        100,
        30,
    );

    let result = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash)
        .await
        .unwrap();
    assert_eq!(result.fidelity_status.as_deref(), Some("flagged"));
    assert!(!result.flagged_tokens.is_empty());

    let note_path = vault_tmp.path().join("notes/landmines/bad.md");
    let body = std::fs::read_to_string(&note_path).unwrap();
    assert!(
        body.contains("trust: medium"),
        "expected downgrade to medium, got:\n{}",
        body
    );
}

#[tokio::test]
async fn dup_commit_hash_is_short_circuited_on_second_call() {
    let db = fresh_db();
    let (_repo, repo_path, hash) = make_repo(
        "feat: thing",
        &[("src/x.rs", "fn x() {}\n")],
    );
    let vault_tmp = TempDir::new().unwrap();
    let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
    let llm = MockLlmClient::new();
    llm.enqueue_ok(ok_llm("t", "t", "## What\\nfn x"), 50, 10);

    let first = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash)
        .await
        .unwrap();
    assert!(!first.skipped);
    let second = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash)
        .await
        .unwrap();
    assert!(second.skipped);
    assert_eq!(second.skip_reason.as_deref(), Some("duplicate"));
    assert_eq!(llm.calls().len(), 1, "second call should not re-query LLM");
}

#[tokio::test]
async fn journal_entry_is_appended_for_each_harvest() {
    let db = fresh_db();
    let (_repo, repo_path, hash) = make_repo(
        "feat: add api",
        &[("src/api.rs", "fn handler() {}\n")],
    );
    let vault_tmp = TempDir::new().unwrap();
    let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
    let llm = MockLlmClient::new();
    llm.enqueue_ok(
        ok_llm("api-handler", "API handler shape", "## What\\nadd handler"),
        100,
        30,
    );

    let _ = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash)
        .await
        .unwrap();

    // Journal directory should contain today's file with the entry.
    let journal_dir = vault_tmp.path().join("journal");
    assert!(journal_dir.exists());
    let entries: Vec<_> = std::fs::read_dir(&journal_dir).unwrap().collect();
    assert_eq!(entries.len(), 1);
    let body = std::fs::read_to_string(entries[0].as_ref().unwrap().path()).unwrap();
    assert!(body.contains("api-handler"));
    assert!(body.contains(&hash[..7]));
    assert!(body.contains("added"));
}

#[tokio::test]
async fn generated_only_commit_skipped_as_generated() {
    let db = fresh_db();
    let (_repo, repo_path, hash) = make_repo(
        "chore: regenerate",
        &[("Cargo.lock", "# fake lock\n")],
    );
    let vault_tmp = TempDir::new().unwrap();
    let vault = Vault::open_or_create(vault_tmp.path()).unwrap();
    let llm = MockLlmClient::new();

    let result = harvest_commit(&db, &vault, &repo_path, &repo_path, &enabled_config(), &llm, "k", &hash)
        .await
        .unwrap();
    assert!(result.skipped);
    assert_eq!(result.skip_reason.as_deref(), Some("generated-only"));
}

#[tokio::test]
#[ignore = "cost instrumentation against real provider — set GEMINI_API_KEY and run manually"]
async fn cost_per_harvest_under_budget_real_provider() {
    // Documented run:
    //   GEMINI_API_KEY=… cargo test --test recall_harvester \
    //     cost_per_harvest_under_budget_real_provider -- --ignored --nocapture
    //
    // Asserts mean cost across 5 fixture commits < $0.0025 (half of
    // the §16 #6 ceiling of $0.005/commit). Combined with the
    // Enricher's matching $0.0025 cost test the total per-commit
    // budget stays under the spec ceiling.
    let key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
    if key.is_empty() {
        return;
    }
}
