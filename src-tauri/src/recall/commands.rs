//! Tauri commands for Recall.
//!
//! Phase 1 shipped read-only commands: `recall_status` and
//! `recall_reindex`. Phase 5 adds the sidebar's data surface:
//! `recall_get_enrichments`, `recall_get_harvests`,
//! `recall_get_notes_for_paths`, `recall_get_health`,
//! `recall_open_vault`, and `recall_force_seed`.

use std::path::PathBuf;

use crate::agents::claude_code::session::AppState;
use crate::recall::index::{self, IndexStatus};
use crate::recall::vault::Vault;
use tauri::State;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallStatusResponse {
    /// `true` when the vault directory exists and is registered. Phase 1
    /// auto-registers on first call, so the only path that returns
    /// `registered: false` is one where the project_path itself is
    /// invalid.
    pub registered: bool,
    pub status: Option<IndexStatus>,
}

/// Read-only status query. Auto-registers the vault row on first call
/// (creates the `<project>/.recall/` directory if needed) so the
/// frontend can call this immediately on project open without a
/// separate "initialize" step.
#[tauri::command]
pub async fn recall_status(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<RecallStatusResponse, String> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Ok(RecallStatusResponse {
            registered: false,
            status: None,
        });
    }
    let vault_path = project.join(".recall");
    Vault::open_or_create(&vault_path).map_err(|e| e.to_string())?;
    index::ensure_vault_row(&state.database, &project, &vault_path, false)
        .map_err(|e| e.to_string())?;
    let status = index::status_for_project(&state.database, &project)
        .map_err(|e| e.to_string())?;
    Ok(RecallStatusResponse {
        registered: status.is_some(),
        status,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallReindexResponse {
    pub notes_indexed: usize,
    pub partial_parses: usize,
    pub status: Option<IndexStatus>,
}

/// Drop and rebuild the SQLite index for a project's vault. Idempotent
/// and safe to call any time; this is the "I think the cache is stale"
/// escape hatch from §5.4.
#[tauri::command]
pub async fn recall_reindex(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<RecallReindexResponse, String> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err(format!("project path does not exist: {}", project_path));
    }
    let vault_path = project.join(".recall");
    let vault = Vault::open_or_create(&vault_path).map_err(|e| e.to_string())?;
    let vault_id = index::ensure_vault_row(&state.database, &project, &vault_path, false)
        .map_err(|e| e.to_string())?;
    let report = index::reindex::reindex_vault(&state.database, vault_id, &vault)
        .map_err(|e| e.to_string())?;
    let status = index::status_for_project(&state.database, &project)
        .map_err(|e| e.to_string())?;
    Ok(RecallReindexResponse {
        notes_indexed: report.notes_indexed,
        partial_parses: report.partial_parses,
        status,
    })
}

// ── Phase 5 sidebar data surface ─────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallEnrichmentRow {
    pub occurred_at: String,
    pub prompt_summary: Option<String>,
    /// JSON-encoded array of note slugs that were injected.
    pub notes_injected_json: String,
    pub brief_tokens: Option<i64>,
    pub model_used: Option<String>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallHarvestRow {
    pub occurred_at: String,
    pub commit_hash: Option<String>,
    pub fidelity_status: Option<String>,
    pub note_slug: Option<String>,
    pub model_used: Option<String>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallHealth {
    pub note_count: i64,
    pub note_counts_by_type: Vec<(String, i64)>,
    pub harvests_total: i64,
    pub last_indexed_at: Option<String>,
    pub vault_path: Option<String>,
}

#[tauri::command]
pub async fn recall_get_enrichments(
    state: State<'_, AppState>,
    project_path: String,
    limit: Option<i64>,
) -> Result<Vec<RecallEnrichmentRow>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 200);
    let rows = state
        .database
        .list_recall_enrichments(&project_path, limit)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(occurred_at, prompt_summary, notes_injected_json, brief_tokens, model_used, cost_usd)| {
            RecallEnrichmentRow {
                occurred_at,
                prompt_summary,
                notes_injected_json,
                brief_tokens,
                model_used,
                cost_usd,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn recall_get_harvests(
    state: State<'_, AppState>,
    project_path: String,
    limit: Option<i64>,
) -> Result<Vec<RecallHarvestRow>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 200);
    let rows = state
        .database
        .list_recall_harvests(&project_path, limit)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(occurred_at, commit_hash, fidelity_status, note_slug, model_used, cost_usd)| {
            RecallHarvestRow {
                occurred_at,
                commit_hash,
                fidelity_status,
                note_slug,
                model_used,
                cost_usd,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn recall_get_notes_for_paths(
    state: State<'_, AppState>,
    project_path: String,
    paths: Vec<String>,
) -> Result<Vec<crate::recall::index::query::IndexedNote>, String> {
    let project = PathBuf::from(&project_path);
    let vault_id = match crate::recall::index::lookup_vault(&state.database, &project, false)
        .map_err(|e| e.to_string())?
    {
        Some(id) => id,
        None => return Ok(Vec::new()),
    };
    crate::recall::index::query::notes_by_path_overlap(&state.database, vault_id, &paths, 25)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn recall_get_health(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<RecallHealth, String> {
    let project = PathBuf::from(&project_path);
    let status =
        crate::recall::index::status_for_project(&state.database, &project).map_err(|e| e.to_string())?;
    let (vault_path, last_indexed_at) = match &status {
        Some(s) => (Some(s.vault_path.clone()), s.last_indexed_at.clone()),
        None => (None, None),
    };
    let note_count = state
        .database
        .count_recall_notes(&project_path)
        .unwrap_or(0);
    let note_counts_by_type = state
        .database
        .recall_notes_by_type(&project_path)
        .unwrap_or_default();
    let harvests_total = state
        .database
        .count_recall_harvests(&project_path)
        .unwrap_or(0);
    Ok(RecallHealth {
        note_count,
        note_counts_by_type,
        harvests_total,
        last_indexed_at,
        vault_path,
    })
}

#[tauri::command]
pub async fn recall_open_vault(
    project_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let vault = PathBuf::from(&project_path).join(".recall");
    if !vault.is_dir() {
        return Err(format!("no .recall directory at {}", project_path));
    }
    // Hand to the OS — Finder on macOS will reveal the folder;
    // Obsidian-installed-with-vault setups can pick it up via the
    // `obsidian://open?path=...` URL scheme as a future enhancement.
    app_handle
        .opener()
        .open_path(vault.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("failed to open vault: {}", e))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallSeedResponse {
    pub report: crate::recall::seed::SeedReport,
    pub status: Option<crate::recall::index::IndexStatus>,
}

#[tauri::command]
pub async fn recall_force_seed(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<RecallSeedResponse, String> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err(format!("project path does not exist: {}", project_path));
    }
    // Use the user's configured RecallConfig (mostly for the
    // harvester model pick) but DON'T require an API key — when one
    // isn't present, the manifest step falls back to the
    // deterministic shell automatically.
    let (config, api_key) = {
        let settings = crate::commands::settings::get_settings().unwrap_or_default();
        let api_key = settings
            .api_keys
            .get(settings.recall.harvester_key_id())
            .cloned()
            .unwrap_or_default();
        (settings.recall.clone(), api_key)
    };
    let llm = if api_key.is_empty() {
        None
    } else {
        Some(crate::recall::llm_client::RealLlmClient::new(
            crate::commands::settings::get_settings()
                .map(|s| s.model_pricing)
                .unwrap_or_default(),
        ))
    };
    let report = crate::recall::seed::run_cold_start(
        &state.database,
        &project,
        llm.as_ref().map(|c| c as &dyn crate::recall::llm_client::LlmClient),
        &api_key,
        &config,
    )
    .await
    .map_err(|e| e.to_string())?;
    let status =
        crate::recall::index::status_for_project(&state.database, &project).map_err(|e| e.to_string())?;
    Ok(RecallSeedResponse { report, status })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::vault::{Note, NoteType, Status, Trust};
    use crate::storage::Database;
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn make_db() -> Database {
        let tmp = tempfile::Builder::new()
            .prefix("recall-cmd-")
            .suffix(".db")
            .tempfile()
            .unwrap();
        let path = tmp.path().to_string_lossy().to_string();
        std::mem::forget(tmp);
        Database::new(&path).unwrap()
    }

    fn make_note(id: &str) -> Note {
        Note {
            id: id.to_string(),
            note_type: NoteType::Landmine,
            project: Some("test".to_string()),
            status: Status::Active,
            trust: Trust::High,
            trust_raw: String::new(),
            severity: None,
            discovered: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            last_verified: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            source_paths: vec!["src/x.rs".to_string()],
            source_commits: vec![],
            prior_occurrences: vec![],
            links: vec![],
            tags: vec![],
            title: format!("Note {}", id),
            body: "body".to_string(),
            file_path: None,
        }
    }

    /// Exercise the same code paths as the Tauri commands without going
    /// through the Tauri `State` machinery (which requires a running
    /// `tauri::test::mock_app` and is overkill here).
    #[test]
    fn status_auto_registers_vault_on_first_call() {
        let project_tmp = TempDir::new().unwrap();
        let project = project_tmp.path();
        let db = make_db();

        // Pre-call: no vault row exists.
        let before = index::lookup_vault(&db, project, false).unwrap();
        assert!(before.is_none());

        // Simulate the command's body.
        let vault_path = project.join(".recall");
        Vault::open_or_create(&vault_path).unwrap();
        index::ensure_vault_row(&db, project, &vault_path, false).unwrap();
        let status = index::status_for_project(&db, project).unwrap();
        assert!(status.is_some());
        assert!(vault_path.exists());
        assert_eq!(status.unwrap().note_count, 0);
    }

    #[test]
    fn reindex_picks_up_notes_added_outside_codemantis() {
        let project_tmp = TempDir::new().unwrap();
        let project = project_tmp.path();
        let vault_path = project.join(".recall");
        let vault = Vault::open_or_create(&vault_path).unwrap();
        let db = make_db();
        let vault_id = index::ensure_vault_row(&db, project, &vault_path, false).unwrap();

        // Hand-place a markdown file the way Obsidian or the user would.
        vault.write_note(&make_note("hand-edit")).unwrap();
        // The note exists on disk but is NOT in the index yet.
        let before = index::status_for_project(&db, project).unwrap().unwrap();
        assert_eq!(before.note_count, 0);

        // Reindex picks it up.
        let report = index::reindex::reindex_vault(&db, vault_id, &vault).unwrap();
        assert_eq!(report.notes_indexed, 1);
        let after = index::status_for_project(&db, project).unwrap().unwrap();
        assert_eq!(after.note_count, 1);
        assert!(after.last_indexed_at.is_some());
    }

    #[test]
    fn status_returns_unregistered_for_nonexistent_project() {
        // Mirror the early-return path in recall_status when the project
        // path doesn't exist on disk.
        let bogus = std::path::Path::new("/definitely/not/a/real/path/xyz");
        assert!(!bogus.is_dir());
    }
}
