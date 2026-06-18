//! Duo-Coding command layer — thin wrappers over the `duo_*` database
//! accessors. The orchestration state machine lives in the frontend
//! `duoStore`; these commands only persist run/event/snapshot rows so the
//! dashboard, session history, and restart-recovery can read them back.
//!
//! Timestamps are stamped server-side (epoch millis) so persisted ordering
//! never depends on the frontend clock. See `project_duo_coding` plan.

use crate::agents::claude_code::session::AppState;
use crate::storage::database::{DuoEventRow, DuoRunRow, DuoSnapshotRow};
use tauri::State;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[tauri::command]
pub async fn duo_start_run(
    state: State<'_, AppState>,
    id: String,
    primary_session_id: String,
    duo_session_id: String,
    project_path: String,
    config_json: String,
) -> Result<(), String> {
    state
        .database
        .insert_duo_run(
            &id,
            &primary_session_id,
            &duo_session_id,
            &project_path,
            "running",
            &config_json,
            now_ms(),
        )
        .map_err(|e| format!("Failed to start duo run: {}", e))
}

#[tauri::command]
pub async fn duo_complete_run(
    state: State<'_, AppState>,
    id: String,
    status: String,
    outcome: Option<String>,
) -> Result<(), String> {
    state
        .database
        .update_duo_run_status(&id, &status, outcome.as_deref(), Some(now_ms()))
        .map_err(|e| format!("Failed to complete duo run: {}", e))
}

#[tauri::command]
pub async fn duo_get_run(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<DuoRunRow>, String> {
    state
        .database
        .get_duo_run(&id)
        .map_err(|e| format!("Failed to get duo run: {}", e))
}

#[tauri::command]
pub async fn duo_list_runs(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<DuoRunRow>, String> {
    state
        .database
        .list_duo_runs(&project_path)
        .map_err(|e| format!("Failed to list duo runs: {}", e))
}

#[tauri::command]
pub async fn duo_record_event(
    state: State<'_, AppState>,
    id: String,
    run_id: String,
    kind: String,
    actor: String,
    payload_json: String,
    diff_stats_json: Option<String>,
) -> Result<(), String> {
    state
        .database
        .insert_duo_event(
            &id,
            &run_id,
            now_ms(),
            &kind,
            &actor,
            &payload_json,
            diff_stats_json.as_deref(),
        )
        .map_err(|e| format!("Failed to record duo event: {}", e))
}

#[tauri::command]
pub async fn duo_list_events(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<Vec<DuoEventRow>, String> {
    state
        .database
        .list_duo_events(&run_id)
        .map_err(|e| format!("Failed to list duo events: {}", e))
}

#[tauri::command]
pub async fn duo_record_snapshot(
    state: State<'_, AppState>,
    id: String,
    run_id: String,
    narrative: String,
    metrics_json: String,
    series_json: String,
) -> Result<(), String> {
    state
        .database
        .insert_duo_snapshot(&id, &run_id, now_ms(), &narrative, &metrics_json, &series_json)
        .map_err(|e| format!("Failed to record duo snapshot: {}", e))
}

#[tauri::command]
pub async fn duo_latest_snapshot(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<Option<DuoSnapshotRow>, String> {
    state
        .database
        .latest_duo_snapshot(&run_id)
        .map_err(|e| format!("Failed to get latest duo snapshot: {}", e))
}

#[cfg(test)]
mod tests {
    use crate::test_helpers::test_db;

    // The `#[tauri::command]` wrappers are thin pass-throughs over these db
    // accessors (the project convention — see commands/super_bro.rs tests).
    // Each test exercises the success path plus a representative error/empty path.

    #[test]
    fn start_run_then_get_returns_row() {
        let db = test_db();
        db.insert_duo_run("r1", "primary", "duo", "/proj", "running", "{\"enabled\":true}", 10)
            .unwrap();
        let row = db.get_duo_run("r1").unwrap().expect("run exists");
        assert_eq!(row.primary_session_id, "primary");
        assert_eq!(row.status, "running");
    }

    #[test]
    fn get_run_unknown_id_returns_none() {
        let db = test_db();
        assert!(db.get_duo_run("ghost").unwrap().is_none());
    }

    #[test]
    fn complete_run_sets_status_outcome_and_completion() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/proj", "running", "{}", 1).unwrap();
        db.update_duo_run_status("r1", "completed", Some("agreed"), Some(99)).unwrap();
        let row = db.get_duo_run("r1").unwrap().unwrap();
        assert_eq!(row.status, "completed");
        assert_eq!(row.outcome.as_deref(), Some("agreed"));
        assert_eq!(row.completed_at, Some(99));
    }

    #[test]
    fn list_runs_scoped_to_project() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/a", "running", "{}", 1).unwrap();
        db.insert_duo_run("r2", "p", "d", "/b", "running", "{}", 2).unwrap();
        assert_eq!(db.list_duo_runs("/a").unwrap().len(), 1);
        assert!(db.list_duo_runs("/none").unwrap().is_empty());
    }

    #[test]
    fn record_and_list_events_in_order() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/proj", "running", "{}", 1).unwrap();
        db.insert_duo_event("e1", "r1", 10, "turn", "primary", "{}", None).unwrap();
        db.insert_duo_event("e2", "r1", 20, "verdict", "duo", "{\"stance\":\"agree\"}", None).unwrap();
        let events = db.list_duo_events("r1").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "turn");
        assert_eq!(events[1].actor, "duo");
    }

    #[test]
    fn list_events_unknown_run_is_empty() {
        let db = test_db();
        assert!(db.list_duo_events("ghost").unwrap().is_empty());
    }

    #[test]
    fn record_and_fetch_latest_snapshot() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/proj", "running", "{}", 1).unwrap();
        db.insert_duo_snapshot("s1", "r1", 10, "early", "{}", "[]").unwrap();
        db.insert_duo_snapshot("s2", "r1", 20, "late", "{}", "[]").unwrap();
        let snap = db.latest_duo_snapshot("r1").unwrap().unwrap();
        assert_eq!(snap.narrative, "late");
    }

    #[test]
    fn latest_snapshot_unknown_run_is_none() {
        let db = test_db();
        assert!(db.latest_duo_snapshot("ghost").unwrap().is_none());
    }
}
