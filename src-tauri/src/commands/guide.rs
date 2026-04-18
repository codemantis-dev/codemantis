use crate::claude::session::AppState;
use log::info;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidePayload {
    pub id: String,
    pub data_json: String,
}

#[tauri::command]
pub async fn save_guide(
    state: State<'_, AppState>,
    project_path: String,
    data_json: String,
) -> Result<String, String> {
    // Delete any existing guides for this project first (one active guide per project)
    state
        .database
        .delete_guides_for_project(&project_path)
        .map_err(|e| format!("Failed to clear existing guides: {}", e))?;

    let id = format!("guide-{}", chrono::Utc::now().timestamp_millis());
    state
        .database
        .insert_guide(&id, &project_path, &data_json)
        .map_err(|e| format!("Failed to save guide: {}", e))?;

    info!("Saved implementation guide {} for {}", id, project_path);
    Ok(id)
}

#[tauri::command]
pub async fn load_guide(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Option<GuidePayload>, String> {
    let result = state
        .database
        .get_guide_for_project(&project_path)
        .map_err(|e| format!("Failed to load guide: {}", e))?;

    Ok(result.map(|(id, data_json)| GuidePayload { id, data_json }))
}

#[tauri::command]
pub async fn update_guide_data(
    state: State<'_, AppState>,
    guide_id: String,
    data_json: String,
) -> Result<(), String> {
    state
        .database
        .update_guide(&guide_id, &data_json)
        .map_err(|e| format!("Failed to update guide: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_guide_cmd(
    state: State<'_, AppState>,
    guide_id: String,
) -> Result<(), String> {
    state
        .database
        .delete_guide(&guide_id)
        .map_err(|e| format!("Failed to delete guide: {}", e))?;
    info!("Deleted implementation guide {}", guide_id);
    Ok(())
}

#[tauri::command]
pub async fn delete_guides_for_project_cmd(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<(), String> {
    state
        .database
        .delete_guides_for_project(&project_path)
        .map_err(|e| format!("Failed to delete guides for project: {}", e))?;
    info!("Deleted all guides for {}", project_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;

    // ── insert + load ──────────────────────────────────────────────────────

    #[test]
    fn test_insert_guide_and_load_returns_matching_data_json() {
        let db = test_db();
        let data_json = r#"{"name":"My Guide","steps":[]}"#;
        db.insert_guide("guide-1", "/tmp/project-a", data_json).unwrap();

        let result = db.get_guide_for_project("/tmp/project-a").unwrap();
        assert!(result.is_some());
        let (id, loaded_json) = result.unwrap();
        assert_eq!(id, "guide-1");
        assert_eq!(loaded_json, data_json);
    }

    #[test]
    fn test_load_guide_returns_none_when_no_guide_exists_for_project() {
        let db = test_db();
        let result = db.get_guide_for_project("/tmp/no-such-project").unwrap();
        assert!(result.is_none());
    }

    // ── update ─────────────────────────────────────────────────────────────

    #[test]
    fn test_update_guide_data_persists_new_json() {
        let db = test_db();
        db.insert_guide("guide-upd", "/tmp/project-upd", r#"{"v":1}"#).unwrap();
        db.update_guide("guide-upd", r#"{"v":2,"extra":true}"#).unwrap();

        let (_, loaded) = db.get_guide_for_project("/tmp/project-upd").unwrap().unwrap();
        assert_eq!(loaded, r#"{"v":2,"extra":true}"#);
    }

    #[test]
    fn test_update_guide_on_nonexistent_id_does_not_error() {
        let db = test_db();
        // No guide exists; SQLite UPDATE affects 0 rows, which is not an error
        let result = db.update_guide("guide-ghost", r#"{"x":1}"#);
        assert!(result.is_ok());
    }

    // ── delete by ID ───────────────────────────────────────────────────────

    #[test]
    fn test_delete_guide_removes_it_from_database() {
        let db = test_db();
        db.insert_guide("guide-del", "/tmp/project-del", r#"{"y":0}"#).unwrap();
        db.delete_guide("guide-del").unwrap();

        let result = db.get_guide_for_project("/tmp/project-del").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_delete_guide_on_nonexistent_id_does_not_error() {
        let db = test_db();
        let result = db.delete_guide("guide-missing");
        assert!(result.is_ok());
    }

    // ── delete all for project ─────────────────────────────────────────────

    #[test]
    fn test_delete_guides_for_project_only_removes_that_project() {
        let db = test_db();
        db.insert_guide("guide-p1", "/tmp/project-1", r#"{"p":1}"#).unwrap();
        db.insert_guide("guide-p2", "/tmp/project-2", r#"{"p":2}"#).unwrap();

        db.delete_guides_for_project("/tmp/project-1").unwrap();

        // project-1 guide must be gone
        assert!(db.get_guide_for_project("/tmp/project-1").unwrap().is_none());
        // project-2 guide must still exist
        let (id, _) = db.get_guide_for_project("/tmp/project-2").unwrap().unwrap();
        assert_eq!(id, "guide-p2");
    }

    #[test]
    fn test_delete_guides_for_project_on_empty_project_does_not_error() {
        let db = test_db();
        let result = db.delete_guides_for_project("/tmp/empty-project");
        assert!(result.is_ok());
    }

    // ── serde serialization ────────────────────────────────────────────────

    #[test]
    fn test_guide_payload_serializes_with_camel_case_field_names() {
        let payload = GuidePayload {
            id: "guide-1".to_string(),
            data_json: r#"{"steps":[]}"#.to_string(),
        };

        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"dataJson\""), "expected camelCase dataJson");
        assert!(!json.contains("\"data_json\""), "snake_case must not appear");
        assert!(json.contains("\"id\""));
    }
}
