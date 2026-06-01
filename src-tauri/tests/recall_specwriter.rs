//! Integration tests for the Recall ⇄ SpecWriter integration (§9.2).
//!
//! Each test corresponds to one of the §9.2.9 Definition-of-Done
//! criteria added on top of §16. The Tauri command wrappers are not
//! exercised directly here (they require a Tauri State container); we
//! drive the `_impl` halves and the Recall helpers they call, which
//! is the same code path with Recall logic inlined.

use codemantis_lib::commands::specwriter::{
    gather_spec_context_impl, save_spec_document_impl, verify_action_parity_impl,
    ActionParityRequest,
};
use codemantis_lib::recall::index::ensure_vault_row;
use codemantis_lib::recall::index::ingest::ingest_note;
use codemantis_lib::recall::specwriter::{
    context_section, parity_to_landmine, recovery_landmines, spec_to_note,
};
use codemantis_lib::recall::vault::{Note, NoteType, Status, Trust, Vault};
use codemantis_lib::storage::database::Database;
use std::path::Path;
use std::sync::Arc;
use tempfile::TempDir;

fn fresh_db() -> Arc<Database> {
    let tmp = tempfile::Builder::new()
        .prefix("recall-sw-it-")
        .suffix(".db")
        .tempfile()
        .unwrap();
    let path = tmp.path().to_string_lossy().to_string();
    std::mem::forget(tmp);
    Arc::new(Database::new(&path).expect("db init"))
}

fn make_landmine(id: &str, title: &str, paths: &[&str], body: &str) -> Note {
    Note {
        id: id.to_string(),
        note_type: NoteType::Landmine,
        project: None,
        status: Status::Active,
        trust: Trust::High,
        trust_raw: String::new(),
        severity: None,
        discovered: chrono::NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
        last_verified: chrono::NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
        source_paths: paths.iter().map(|s| s.to_string()).collect(),
        source_commits: vec![],
        prior_occurrences: vec![],
        links: vec![],
        tags: vec![],
        title: title.to_string(),
        body: body.to_string(),
        file_path: None,
    }
}

/// Project tempdir with `.recall/` vault registered in the index.
fn project_with_vault(db: &Database) -> (TempDir, std::path::PathBuf, i64) {
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().to_path_buf();
    let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
    let vault_id = ensure_vault_row(db, &project, vault.root(), false).unwrap();
    let _ = vault;
    (tmp, project, vault_id)
}

// ── DoD #7 — gather_spec_context returns a Recall Context section ──

#[tokio::test]
async fn dod7_gather_spec_context_can_have_recall_section_appended() {
    let db = fresh_db();
    let (_tmp, project, vault_id) = project_with_vault(&db);

    // Seed a landmine on a route file.
    let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
    let lm = make_landmine(
        "auth-cookie-only",
        "Auth uses cookie-only sessions",
        &["src/app/api/route.ts"],
        "Bearer tokens are rejected. Cookie-only sessions only.",
    );
    vault.write_note(&lm).unwrap();
    ingest_note(&db, vault_id, &lm, Path::new("notes/landmines/auth-cookie-only.md")).unwrap();

    // Drop in a route file so SpecWriter would consider it relevant.
    std::fs::create_dir_all(project.join("src/app/api")).unwrap();
    std::fs::write(project.join("src/app/api/route.ts"), "export async function GET(){}").unwrap();

    let assembled = gather_spec_context_impl(project.to_string_lossy().to_string())
        .await
        .unwrap();
    // Pretend the SpecWriter caller derived the route path and asks
    // Recall to append.
    let detected = context_section::relevant_paths(&["src/app/api/route.ts".to_string()]);
    let augmented =
        context_section::append_section(&db, &project, &assembled, &detected).unwrap();

    assert!(augmented.starts_with(&assembled), "existing context preserved");
    assert!(augmented.contains("Recall Context"));
    assert!(augmented.contains("Auth uses cookie-only sessions"));
    assert!(augmented.contains("trust: high"));
}

// ── DoD #8 — saving a new spec produces a decision note linked to overlapping landmines ──

#[tokio::test]
async fn dod8_save_spec_creates_decision_note_linked_to_landmines() {
    let db = fresh_db();
    let (_tmp, project, vault_id) = project_with_vault(&db);

    // Pre-seed a landmine covering the path the spec mentions.
    let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
    let lm = make_landmine(
        "pgcrypto-landmine",
        "pgcrypto search path landmine",
        &["src/credentials.ts"],
        "Always schema-qualify pgcrypto.",
    );
    vault.write_note(&lm).unwrap();
    ingest_note(&db, vault_id, &lm, Path::new("notes/landmines/pgcrypto-landmine.md")).unwrap();

    let spec_body = "\
# Add credentials helper

## 1. Why
We need rotation.

## 2. Approach
Introduce TenantKey.

## 3. Files to modify
- `src/credentials.ts` — main helper
- `supabase/migrations/20260601_tenant_keys.sql` — schema add
";

    // The SpecWriter command writes the file (no Recall integration
    // inside the _impl), then the harvest call follows on the Tauri
    // wrapper side. We exercise the harvest directly.
    save_spec_document_impl(
        project.to_string_lossy().to_string(),
        "add-credentials-helper.md".to_string(),
        spec_body.to_string(),
        false,
    )
    .await
    .unwrap();

    let outcome = spec_to_note::harvest(
        &db,
        &project,
        "add-credentials-helper.md",
        spec_body,
    )
    .unwrap();
    let note_id = match outcome {
        spec_to_note::HarvestOutcome::Written { note_id, .. } => note_id,
        other => panic!("expected Written, got {:?}", other),
    };
    assert_eq!(note_id, "add-credentials-helper");

    let note_body = std::fs::read_to_string(
        project
            .join(".recall/notes/decisions")
            .join(format!("{}.md", note_id)),
    )
    .unwrap();
    assert!(note_body.contains("type: decision"));
    assert!(note_body.contains("[[pgcrypto-landmine]]"));
    assert!(note_body.contains("seeded:specwriter"));
}

// ── DoD #9 — Self-Drive prompt contains the Enricher brief ──
//
// Phase 2's `send_message` integration enriches every prompt that flows
// through the agent process. Self-Drive composes its "Prompt for Claude
// Code" on the frontend and sends it through `send_message`, so by
// construction the brief is prepended. The unit-test coverage of
// enrich_if_enabled in Phase 2 (and the recall_enricher integration
// tests) already exercise that path with a fixture vault end to end.
// Here we re-assert the contract from the SpecWriter side: a Self-Drive
// prompt referencing a landmine path receives the brief.

#[tokio::test]
async fn dod9_self_drive_prompt_threaded_through_enricher_picks_up_landmines() {
    use codemantis_lib::recall::config::RecallConfig;
    use codemantis_lib::recall::enricher::enrich_prompt;
    use codemantis_lib::recall::llm_client::MockLlmClient;

    let db = fresh_db();
    let (_tmp, project, vault_id) = project_with_vault(&db);

    let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
    let lm = make_landmine(
        "pgcrypto",
        "pgcrypto search path",
        &["src/credentials.ts"],
        "schema-qualify pgcrypto",
    );
    vault.write_note(&lm).unwrap();
    ingest_note(&db, vault_id, &lm, Path::new("notes/landmines/pgcrypto.md")).unwrap();

    // Simulate Self-Drive's synthesized "Prompt for Claude Code".
    let synthesized = "Read docs/specs/add-credentials-helper.md and edit src/credentials.ts \
                       to add the new TenantKey-aware helper.";
    let cfg = RecallConfig {
        enabled: true,
        ..RecallConfig::default()
    };
    let pricing = std::collections::HashMap::new();
    let llm = MockLlmClient::new(); // landmine is mandatory, LLM not called.

    let result = enrich_prompt(
        &db,
        &vault,
        vault_id,
        &cfg,
        "k",
        &pricing,
        &llm,
        synthesized,
        Some("self-drive-session-1"),
        &project,
    )
    .await
    .unwrap();

    assert!(
        result.brief.injected_note_ids.contains(&"pgcrypto".to_string()),
        "Self-Drive prompt referencing the landmine's path must surface the landmine"
    );
    assert!(result.enriched_prompt.contains("LANDMINES"));
    assert!(
        result.enriched_prompt.ends_with(synthesized),
        "Self-Drive's verbatim prompt must be preserved at the end"
    );
}

// ── DoD #10 — parity FAIL surfaces as landmine in the next gather ──

#[tokio::test]
async fn dod10_parity_fail_landmine_surfaces_in_next_gather() {
    let db = fresh_db();
    let (_tmp, project, _vid) = project_with_vault(&db);

    // Build a fixture project with a caller that references the action
    // and a handler that does NOT — guaranteed FAIL via the existing
    // verify_action_parity_impl.
    std::fs::create_dir_all(project.join("src/api")).unwrap();
    std::fs::create_dir_all(project.join("supabase/functions/handler")).unwrap();
    std::fs::write(
        project.join("src/api/client.ts"),
        "export function call(){ invoke('insert_note_classification', {}); }\n",
    )
    .unwrap();
    std::fs::write(
        project.join("supabase/functions/handler/index.ts"),
        "// TODO: implement\nthrow new Error('NotImplementedError');\n",
    )
    .unwrap();

    let req = ActionParityRequest {
        action: "insert_note_classification".to_string(),
        caller_path: "src/api".to_string(),
        caller_paths: vec![],
        handler_path: "supabase/functions/handler/index.ts".to_string(),
        wire: None,
    };
    let results = verify_action_parity_impl(
        project.to_string_lossy().to_string(),
        vec![req.clone()],
    )
    .await
    .unwrap();
    assert_eq!(results.len(), 1);
    assert_ne!(results[0].status, "PASS", "expected FAIL, got: {}", results[0].detail);

    // Drive the landmine harvest the way the Tauri wrapper does in
    // background after a FAIL.
    let callers = vec![req.caller_path.clone()];
    let fail = parity_to_landmine::ParityFail {
        action: &req.action,
        caller_paths: &callers,
        handler_path: &req.handler_path,
        detail: &results[0].detail,
        spec_note_id: None,
    };
    let outcome = parity_to_landmine::landmine_from_fail(&db, &project, &fail).unwrap();
    let note_id = match outcome {
        parity_to_landmine::LandmineOutcome::Created { note_id } => note_id,
        other => panic!("expected Created, got {:?}", other),
    };

    // Now ask gather_spec_context for the same handler path — the
    // landmine must surface in the Recall Context section.
    let detected = context_section::relevant_paths(std::slice::from_ref(&req.handler_path));
    let augmented = context_section::append_section(&db, &project, "Project: x", &detected).unwrap();
    assert!(
        augmented.contains(&note_id),
        "landmine note_id should appear in the augmented context; got:\n{}",
        augmented
    );
    assert!(augmented.contains("Cross-system action"));
}

// ── DoD #11 — cost ceiling under $0.05 per spec ──
//
// Scaffolded as #[ignore]; the benchmark loop runs against a real
// provider key only when explicitly invoked. Documented in
// recall-qa.md (Phase 5).

#[tokio::test]
#[ignore = "cost instrumentation against real provider — set GEMINI_API_KEY and run manually"]
async fn dod11_cost_per_spec_under_5_cents_real_provider() {
    let key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
    if key.is_empty() {
        return;
    }
    // The actual 5-spec benchmark loop is left for the Phase 5 release
    // gate; this stub keeps the criterion discoverable via
    // `cargo test --ignored`.
}

// ── §9.2.2 third bullet — landmine block flows into the recovery prompt ──

#[tokio::test]
async fn recovery_prompt_receives_landmine_block_when_paths_overlap() {
    let db = fresh_db();
    let (_tmp, project, vault_id) = project_with_vault(&db);

    let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
    let lm = make_landmine(
        "creds",
        "credentials landmine",
        &["src/credentials.ts"],
        "schema-qualify pgcrypto",
    );
    vault.write_note(&lm).unwrap();
    ingest_note(&db, vault_id, &lm, Path::new("notes/landmines/creds.md")).unwrap();

    let spec_mentions = vec!["src/credentials.ts".to_string()];
    let block =
        recovery_landmines::render_landmine_block(&db, &project, &spec_mentions).unwrap();
    assert!(!block.is_empty());
    assert!(block.contains("Recall landmines"));
    assert!(block.contains("[[creds]]"));
}

#[tokio::test]
async fn recovery_prompt_block_is_empty_when_no_overlap() {
    let db = fresh_db();
    let (_tmp, project, _vid) = project_with_vault(&db);
    let block = recovery_landmines::render_landmine_block(
        &db,
        &project,
        &["src/never-mentioned.rs".to_string()],
    )
    .unwrap();
    assert!(block.is_empty());
}
