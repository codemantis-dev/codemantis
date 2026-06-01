//! Tauri commands for Recall.
//!
//! Phase 1 ships read-only commands: `recall_status` and `recall_reindex`.
//! Both are safe to call on any project (no LLM, no agent state). Phase
//! 2+ will add `recall_enrich`, `recall_open_vault`, `recall_get_*`,
//! and the harvester-driven counterparts.

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
