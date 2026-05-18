//! Tauri commands for persisting Self-Drive run state across app restarts.
//!
//! One row per project (keyed by project_path). The frontend serializes a
//! JSON snapshot of the run (pinned guide id, session id, active blocker,
//! blocker history, run log, phase/fix counters, pause reason) and writes
//! it through these commands. On app boot, `list_self_drive_states` returns
//! everything; the frontend hydrates into a "paused + waiting for attach"
//! state so the user can pick a fresh Claude Code session and re-run
//! diagnostic evidence through the normal recovery flow.

use crate::agents::claude_code::session::AppState;
use log::info;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfDriveStatePayload {
    pub project_path: String,
    pub data_json: String,
}

#[tauri::command]
pub async fn save_self_drive_state(
    state: State<'_, AppState>,
    project_path: String,
    data_json: String,
) -> Result<(), String> {
    state
        .database
        .upsert_self_drive_run(&project_path, &data_json)
        .map_err(|e| format!("Failed to save Self-Drive state: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn load_self_drive_state(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Option<String>, String> {
    state
        .database
        .get_self_drive_run(&project_path)
        .map_err(|e| format!("Failed to load Self-Drive state: {}", e))
}

#[tauri::command]
pub async fn list_self_drive_states(
    state: State<'_, AppState>,
) -> Result<Vec<SelfDriveStatePayload>, String> {
    let rows = state
        .database
        .list_self_drive_runs()
        .map_err(|e| format!("Failed to list Self-Drive states: {}", e))?;
    Ok(rows
        .into_iter()
        .map(|(project_path, data_json)| SelfDriveStatePayload { project_path, data_json })
        .collect())
}

#[tauri::command]
pub async fn delete_self_drive_state(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<(), String> {
    state
        .database
        .delete_self_drive_run(&project_path)
        .map_err(|e| format!("Failed to delete Self-Drive state: {}", e))?;
    info!("Deleted Self-Drive run state for {}", project_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_helpers::test_db;

    #[test]
    fn upsert_then_get_returns_saved_json() {
        let db = test_db();
        db.upsert_self_drive_run("/proj/a", r#"{"phase":"building"}"#).unwrap();
        let got = db.get_self_drive_run("/proj/a").unwrap();
        assert_eq!(got, Some(r#"{"phase":"building"}"#.to_string()));
    }

    #[test]
    fn get_returns_none_when_no_row_exists() {
        let db = test_db();
        assert_eq!(db.get_self_drive_run("/proj/missing").unwrap(), None);
    }

    #[test]
    fn upsert_overwrites_existing_row_for_same_project() {
        let db = test_db();
        db.upsert_self_drive_run("/proj/a", r#"{"v":1}"#).unwrap();
        db.upsert_self_drive_run("/proj/a", r#"{"v":2}"#).unwrap();
        let got = db.get_self_drive_run("/proj/a").unwrap();
        assert_eq!(got, Some(r#"{"v":2}"#.to_string()));
    }

    #[test]
    fn list_returns_all_rows_newest_first() {
        let db = test_db();
        db.upsert_self_drive_run("/proj/older", r#"{"a":1}"#).unwrap();
        // Sleep 1ms to ensure distinct updated_at timestamps.
        std::thread::sleep(std::time::Duration::from_millis(5));
        db.upsert_self_drive_run("/proj/newer", r#"{"b":2}"#).unwrap();

        let rows = db.list_self_drive_runs().unwrap();
        assert_eq!(rows.len(), 2);
        // Newer first.
        assert_eq!(rows[0].0, "/proj/newer");
        assert_eq!(rows[1].0, "/proj/older");
    }

    #[test]
    fn delete_removes_row_and_leaves_others_alone() {
        let db = test_db();
        db.upsert_self_drive_run("/proj/a", r#"{"a":1}"#).unwrap();
        db.upsert_self_drive_run("/proj/b", r#"{"b":1}"#).unwrap();

        db.delete_self_drive_run("/proj/a").unwrap();

        assert_eq!(db.get_self_drive_run("/proj/a").unwrap(), None);
        assert_eq!(db.get_self_drive_run("/proj/b").unwrap(), Some(r#"{"b":1}"#.to_string()));
    }

    #[test]
    fn delete_of_missing_row_is_noop() {
        let db = test_db();
        // Must not error.
        db.delete_self_drive_run("/proj/ghost").unwrap();
    }
}
