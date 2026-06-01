//! Cold-start seeding orchestrator (RECALL-SPEC §10).
//!
//! Threads the four steps:
//! 1. [`ingest_existing::ingest`] — pull in `.claude/memory/`,
//!    ADRs, and README/CLAUDE section excerpts.
//! 2. [`git_hotspots::analyze`] — derive hotspots, co-change
//!    pairs, and bugfix clusters from `git log`.
//! 3. [`manifest_starter::generate`] — write `MANIFEST.md`
//!    (LLM-driven when configured, deterministic fallback
//!    otherwise).
//! 4. Initial index build — re-ingest the whole vault into SQLite
//!    so the Enricher's first run sees everything.
//!
//! Idempotent: every step skips work that's already been done.
//! Returns a [`SeedReport`] with timings so the orchestrator can
//! surface the §16 DoD #1 ("<10 seconds") signal to the user.

pub mod git_hotspots;
pub mod ingest_existing;
pub mod manifest_starter;

pub use git_hotspots::HotspotConfig;

use std::path::Path;
use std::time::Instant;

use chrono::Utc;
use serde::Serialize;

use crate::recall::config::RecallConfig;
use crate::recall::index::{ensure_vault_row, reindex::reindex_vault};
use crate::recall::llm_client::LlmClient;
use crate::recall::vault::{Note, NoteType, PriorOccurrence, Status, Trust, Vault};
use crate::recall::RecallError;
use crate::storage::Database;

#[derive(Debug, Clone, Serialize)]
pub struct SeedReport {
    pub ingest_existing_memory_files: usize,
    pub ingest_adrs: usize,
    pub seeded_hotspot_landmines: usize,
    pub seeded_cochange_patterns: usize,
    pub manifest_outcome: String,
    pub notes_indexed: usize,
    pub elapsed_ms: u128,
}

/// Run the full cold-start seed for a project. The `llm` argument is
/// optional: when `None` (or when the api_key is empty), the
/// LLM-driven manifest step falls back to a deterministic shell.
///
/// The vault is created if absent. Subsequent calls are safe —
/// existing seeds are not overwritten.
pub async fn run_cold_start(
    db: &Database,
    project_path: &Path,
    llm: Option<&dyn LlmClient>,
    api_key: &str,
    config: &RecallConfig,
) -> Result<SeedReport, RecallError> {
    let start = Instant::now();

    // 0) Open / create the vault and register it in the index.
    let vault_path = project_path.join(".recall");
    let vault = Vault::open_or_create(&vault_path)?;
    let vault_id = ensure_vault_row(db, project_path, &vault_path, false)?;

    // 1) Ingest existing knowledge.
    let ingest_report = ingest_existing::ingest(project_path, &vault)?;

    // 2) Git hotspots → cochange + landmine seed notes.
    let hotspot_config = HotspotConfig::default();
    let hotspots = git_hotspots::analyze(project_path, hotspot_config)?;
    let seeded_cochange = write_cochange_seeds(&vault, &hotspots.cochange_pairs)?;
    let seeded_landmines = write_hotspot_landmine_seeds(&vault, &hotspots.bugfix_clusters)?;

    // 3) MANIFEST.md (LLM when available, fallback otherwise).
    let landmine_titles: Vec<String> = hotspots
        .bugfix_clusters
        .iter()
        .take(5)
        .map(|(p, _)| format!("Recurring bugfixes on `{}`", p))
        .collect();
    let manifest_input = manifest_starter::ManifestInput {
        manifest_seed_sections: ingest_report.manifest_seed_sections.clone(),
        project_manifest_summary: manifest_starter::read_project_manifest_summary(project_path),
        landmine_titles,
    };
    let manifest_outcome = manifest_starter::generate(llm, api_key, config, &vault, &manifest_input)
        .await?;
    let manifest_outcome_label = match &manifest_outcome {
        manifest_starter::GenerateOutcome::LlmWritten { .. } => "llm-written",
        manifest_starter::GenerateOutcome::FallbackWritten { .. } => "fallback-written",
        manifest_starter::GenerateOutcome::AlreadyExists => "already-exists",
        manifest_starter::GenerateOutcome::Skipped { .. } => "skipped",
    };

    // 4) Initial index build (idempotent — incremental ingest would
    // produce the same state but the full reindex is cleaner for the
    // cold-start "blank slate" semantics).
    let reindex_report = reindex_vault(db, vault_id, &vault)?;

    Ok(SeedReport {
        ingest_existing_memory_files: ingest_report.memory_files_ingested,
        ingest_adrs: ingest_report.adrs_ingested,
        seeded_hotspot_landmines: seeded_landmines,
        seeded_cochange_patterns: seeded_cochange,
        manifest_outcome: manifest_outcome_label.to_string(),
        notes_indexed: reindex_report.notes_indexed,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

/// Write one `pattern-cochange-<a>-<b>` seed note per co-change pair.
/// Idempotent (no overwrite of existing notes).
fn write_cochange_seeds(
    vault: &Vault,
    pairs: &[(String, String, u32)],
) -> Result<usize, RecallError> {
    let now = Utc::now().date_naive();
    let mut written = 0usize;
    for (a, b, count) in pairs.iter().take(25) {
        let id = format!("pattern-cochange-{}-{}", slugify(a), slugify(b));
        let note = Note {
            id: id.clone(),
            note_type: NoteType::Pattern,
            project: None,
            status: Status::Active,
            trust: Trust::Inferred,
            trust_raw: "seeded:cochange".to_string(),
            severity: None,
            discovered: now,
            last_verified: now,
            source_paths: vec![a.clone(), b.clone()],
            source_commits: vec![],
            prior_occurrences: vec![],
            links: vec![],
            tags: vec![
                "seed".to_string(),
                "seeded:cochange".to_string(),
                "pattern".to_string(),
            ],
            title: format!("`{}` and `{}` change together", a, b),
            body: format!(
                "## What\n\n`{a}` and `{b}` were committed together **{count}** times in recent \
                 history. Whenever you touch one, check whether the other needs a matching \
                 change.\n\n_This note was seeded automatically from `git log` co-change \
                 analysis (trust: inferred). The Harvester will supersede it when a real \
                 commit produces a more specific note._\n",
                a = a,
                b = b,
                count = count,
            ),
            file_path: None,
        };
        if write_if_absent(vault, &note)? {
            written += 1;
        }
    }
    Ok(written)
}

/// Write one `landmine-<file>` seed note per bugfix-cluster hotspot.
/// Trust is `inferred` because the file *had* bugfixes but we don't
/// know specifically why — the spec says these are inferences, not
/// observations.
fn write_hotspot_landmine_seeds(
    vault: &Vault,
    clusters: &[(String, u32)],
) -> Result<usize, RecallError> {
    let now = Utc::now().date_naive();
    let mut written = 0usize;
    for (path, count) in clusters.iter().take(10) {
        let id = format!("landmine-hotspot-{}", slugify(path));
        let note = Note {
            id,
            note_type: NoteType::Landmine,
            project: None,
            status: Status::Active,
            trust: Trust::Inferred,
            trust_raw: "seeded:hotspot-bugfix".to_string(),
            severity: None,
            discovered: now,
            last_verified: now,
            source_paths: vec![path.clone()],
            source_commits: vec![],
            prior_occurrences: vec![PriorOccurrence {
                commit_hash: format!("seeded-{}", Utc::now().format("%Y%m%d%H%M%S")),
                date: now,
                location: path.clone(),
            }],
            links: vec![],
            tags: vec![
                "seed".to_string(),
                "seeded:hotspot-bugfix".to_string(),
                "landmine".to_string(),
            ],
            title: format!("`{}` is a recurrent bugfix hotspot", path),
            body: format!(
                "## What\n\n`{path}` has received **{count}** bugfix commits in the recent \
                 history walked at seed time. Treat changes here with care; a future spec \
                 touching this path should verify which bug class kept biting.\n\n\
                 _Seeded from `git log` bugfix-cluster analysis (trust: inferred). \
                 Superseded when a real harvest run produces a specific landmine note._\n",
                path = path,
                count = count,
            ),
            file_path: None,
        };
        if write_if_absent(vault, &note)? {
            written += 1;
        }
    }
    Ok(written)
}

fn write_if_absent(vault: &Vault, note: &Note) -> Result<bool, RecallError> {
    let rel = crate::recall::vault::note_relative_path(note)?;
    let abs = vault.resolve(&rel)?;
    if abs.exists() {
        return Ok(false);
    }
    vault.write_note(note)?;
    Ok(true)
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::test_helpers::*;
    use crate::recall::llm_client::MockLlmClient;
    use std::process::Command as PCommand;
    use tempfile::TempDir;

    fn cfg() -> RecallConfig {
        RecallConfig {
            enabled: true,
            ..RecallConfig::default()
        }
    }

    fn make_fixture_repo() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();
        let run = |args: &[&str]| {
            PCommand::new("git").args(args).current_dir(&path).output().unwrap();
        };
        std::env::set_var("GIT_COMMITTER_DATE", "2026-06-01T12:00:00Z");
        std::env::set_var("GIT_AUTHOR_DATE", "2026-06-01T12:00:00Z");
        run(&["init", "--quiet", "-b", "main"]);
        run(&["config", "user.email", "t@example.com"]);
        run(&["config", "user.name", "T"]);
        // Hotspot + bugfix cluster on src/auth.rs (3 fix commits +
        // 1 plain commit → above the default min_hotspot_commits=3
        // and min_bugfix_count=2 thresholds).
        std::fs::create_dir_all(path.join("src")).unwrap();
        for (i, msg) in [
            "fix(auth): off-by-one",
            "fix(auth): nil deref",
            "fix(auth): regression",
            "feat: tweak",
        ]
        .iter()
        .enumerate()
        {
            std::fs::write(
                path.join("src/auth.rs"),
                format!("// v{}\n", i),
            )
            .unwrap();
            run(&["add", "-A"]);
            run(&["commit", "-q", "-m", msg]);
        }
        (tmp, path)
    }

    #[tokio::test]
    async fn empty_project_seeds_nothing_but_writes_fallback_manifest_if_input_present() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_path_buf();
        // No git repo, no existing memory, no ADRs, no README → all
        // inputs empty → manifest skipped.
        let report = run_cold_start(&db, &project, None, "", &cfg()).await.unwrap();
        assert_eq!(report.ingest_existing_memory_files, 0);
        assert_eq!(report.seeded_hotspot_landmines, 0);
        assert_eq!(report.seeded_cochange_patterns, 0);
        assert_eq!(report.manifest_outcome, "skipped");
        assert_eq!(report.notes_indexed, 0);
    }

    #[tokio::test]
    async fn seed_indexes_all_notes_after_writing_them() {
        let db = fresh_db();
        let (_tmp, project) = make_fixture_repo();
        // Drop a .claude/memory note so ingest writes a seed.
        std::fs::create_dir_all(project.join(".claude/memory")).unwrap();
        std::fs::write(
            project.join(".claude/memory/notes.md"),
            "# Notes\n\nseed me",
        )
        .unwrap();
        // README with rules so the manifest input isn't empty.
        std::fs::write(
            project.join("README.md"),
            "# Proj\n\n## Rules\n- be excellent\n",
        )
        .unwrap();

        let report = run_cold_start(&db, &project, None, "", &cfg()).await.unwrap();
        assert_eq!(report.ingest_existing_memory_files, 1);
        assert!(report.seeded_hotspot_landmines >= 1);
        assert_eq!(report.manifest_outcome, "fallback-written");
        // Notes indexed: 1 memory + ≥1 landmine seed.
        assert!(report.notes_indexed >= 2);
    }

    #[tokio::test]
    async fn manifest_uses_llm_when_one_is_provided() {
        let db = fresh_db();
        let (_tmp, project) = make_fixture_repo();
        std::fs::write(
            project.join("README.md"),
            "## Rules\n- always quote pgcrypto",
        )
        .unwrap();
        let llm = MockLlmClient::new();
        llm.enqueue_ok("# Project\n\nRust + Tauri.", 50, 20);
        let report = run_cold_start(&db, &project, Some(&llm), "key", &cfg())
            .await
            .unwrap();
        assert_eq!(report.manifest_outcome, "llm-written");
    }

    #[tokio::test]
    async fn second_run_is_idempotent() {
        let db = fresh_db();
        let (_tmp, project) = make_fixture_repo();
        std::fs::create_dir_all(project.join(".claude/memory")).unwrap();
        std::fs::write(project.join(".claude/memory/n.md"), "# n\n").unwrap();
        std::fs::write(project.join("README.md"), "## Rules\n- one").unwrap();

        let first = run_cold_start(&db, &project, None, "", &cfg()).await.unwrap();
        let second = run_cold_start(&db, &project, None, "", &cfg()).await.unwrap();
        assert_eq!(first.ingest_existing_memory_files, 1);
        assert_eq!(second.ingest_existing_memory_files, 0, "second run skips existing memory seeds");
        assert_eq!(second.manifest_outcome, "already-exists");
    }

    #[tokio::test]
    async fn cold_start_under_10_seconds_on_fixture_repo() {
        // §16 DoD #1 — cold-start must complete in <10s on a fixture
        // project with recurring bugs.
        let db = fresh_db();
        let (_tmp, project) = make_fixture_repo();
        std::fs::create_dir_all(project.join(".claude/memory")).unwrap();
        std::fs::write(project.join(".claude/memory/n.md"), "# n\n").unwrap();
        std::fs::write(project.join("README.md"), "## Rules\n- one\n").unwrap();
        let report = run_cold_start(&db, &project, None, "", &cfg()).await.unwrap();
        assert!(
            report.elapsed_ms < 10_000,
            "seed should run in <10s, got {}ms",
            report.elapsed_ms
        );
    }

    #[tokio::test]
    async fn cochange_pair_produces_pattern_seed_note() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();
        let run = |args: &[&str]| {
            PCommand::new("git").args(args).current_dir(&path).output().unwrap();
        };
        std::env::set_var("GIT_COMMITTER_DATE", "2026-06-01T12:00:00Z");
        std::env::set_var("GIT_AUTHOR_DATE", "2026-06-01T12:00:00Z");
        run(&["init", "--quiet", "-b", "main"]);
        run(&["config", "user.email", "t@example.com"]);
        run(&["config", "user.name", "T"]);
        std::fs::create_dir_all(path.join("src")).unwrap();
        // 6 commits each touching both files → cochange ≥ 5.
        for i in 0..6 {
            std::fs::write(path.join("src/a.rs"), format!("// {}\n", i)).unwrap();
            std::fs::write(path.join("src/b.rs"), format!("// {}\n", i)).unwrap();
            run(&["add", "-A"]);
            run(&["commit", "-q", "-m", &format!("update {}", i)]);
        }
        let report = run_cold_start(&db, &path, None, "", &cfg()).await.unwrap();
        assert!(report.seeded_cochange_patterns >= 1);
        // And on disk:
        let entries: Vec<_> = std::fs::read_dir(path.join(".recall/notes/patterns"))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert!(!entries.is_empty());
    }

    #[tokio::test]
    async fn seed_writes_landmine_with_path_in_source_paths() {
        let db = fresh_db();
        let (_tmp, project) = make_fixture_repo();
        run_cold_start(&db, &project, None, "", &cfg()).await.unwrap();
        let landmine_dir = project.join(".recall/notes/landmines");
        let entries: Vec<_> = std::fs::read_dir(&landmine_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(entries.len(), 1);
        let body = std::fs::read_to_string(entries[0].path()).unwrap();
        assert!(body.contains("src/auth.rs"));
        assert!(body.contains("trust: seeded:hotspot-bugfix"));
    }
}
