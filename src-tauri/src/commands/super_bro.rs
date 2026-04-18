use crate::claude::session::AppState;
use crate::storage::database::ObservationRow;
use tauri::Manager;
use tauri::State;

#[tauri::command]
pub async fn save_observation(
    state: State<'_, AppState>,
    id: String,
    project_path: String,
    text: String,
    category: String,
    created_at: String,
    last_referenced_at: String,
) -> Result<(), String> {
    state
        .database
        .insert_observation(&id, &project_path, &text, &category, &created_at, &last_referenced_at)
        .map_err(|e| format!("Failed to save observation: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn load_observations(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<ObservationRow>, String> {
    state
        .database
        .list_observations(&project_path)
        .map_err(|e| format!("Failed to load observations: {}", e))
}

#[tauri::command]
pub async fn delete_observation(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state
        .database
        .delete_observation(&id)
        .map_err(|e| format!("Failed to delete observation: {}", e))
}

#[tauri::command]
pub fn read_super_bro_module(
    app_handle: tauri::AppHandle,
    module_name: String,
) -> Result<String, String> {
    let resource_path = app_handle
        .path()
        .resolve(
            format!("resources/super-bro/{}.md", module_name),
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("Failed to resolve module path: {}", e))?;

    std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Module not found: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;

    fn insert_test_observation(
        db: &crate::storage::Database,
        id: &str,
        project_path: &str,
        text: &str,
        category: &str,
    ) {
        db.insert_observation(
            id,
            project_path,
            text,
            category,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        )
        .expect("insert_observation should succeed");
    }

    // ── save + load ────────────────────────────────────────────────────────

    #[test]
    fn test_save_observation_and_load_returns_all_fields_correctly() {
        let db = test_db();
        db.insert_observation(
            "obs-1",
            "/tmp/proj-a",
            "Always use absolute paths",
            "conventions",
            "2026-01-10T08:00:00Z",
            "2026-01-15T12:00:00Z",
        )
        .unwrap();

        let observations = db.list_observations("/tmp/proj-a").unwrap();
        assert_eq!(observations.len(), 1);
        let obs = &observations[0];
        assert_eq!(obs.id, "obs-1");
        assert_eq!(obs.project_path, "/tmp/proj-a");
        assert_eq!(obs.text, "Always use absolute paths");
        assert_eq!(obs.category, "conventions");
        assert_eq!(obs.created_at, "2026-01-10T08:00:00Z");
        assert_eq!(obs.last_referenced_at, "2026-01-15T12:00:00Z");
    }

    #[test]
    fn test_load_observations_returns_empty_for_unknown_project() {
        let db = test_db();
        let observations = db.list_observations("/tmp/no-such-project").unwrap();
        assert!(observations.is_empty());
    }

    // ── project isolation ──────────────────────────────────────────────────

    #[test]
    fn test_load_observations_returns_only_matching_project_entries() {
        let db = test_db();
        insert_test_observation(&db, "obs-a1", "/tmp/proj-a", "Note for A", "style");
        insert_test_observation(&db, "obs-a2", "/tmp/proj-a", "Another for A", "testing");
        insert_test_observation(&db, "obs-b1", "/tmp/proj-b", "Note for B", "style");

        let project_a = db.list_observations("/tmp/proj-a").unwrap();
        assert_eq!(project_a.len(), 2);
        assert!(project_a.iter().all(|o| o.project_path == "/tmp/proj-a"));

        let project_b = db.list_observations("/tmp/proj-b").unwrap();
        assert_eq!(project_b.len(), 1);
        assert_eq!(project_b[0].id, "obs-b1");
    }

    // ── delete ─────────────────────────────────────────────────────────────

    #[test]
    fn test_delete_observation_removes_it_and_leaves_list_empty() {
        let db = test_db();
        insert_test_observation(&db, "obs-del", "/tmp/proj-del", "Temporary note", "misc");

        db.delete_observation("obs-del").unwrap();

        let observations = db.list_observations("/tmp/proj-del").unwrap();
        assert!(observations.is_empty());
    }

    #[test]
    fn test_delete_observation_only_removes_targeted_entry() {
        let db = test_db();
        insert_test_observation(&db, "obs-keep", "/tmp/proj-multi", "Keep this", "style");
        insert_test_observation(&db, "obs-rm", "/tmp/proj-multi", "Remove this", "style");

        db.delete_observation("obs-rm").unwrap();

        let remaining = db.list_observations("/tmp/proj-multi").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "obs-keep");
    }

    #[test]
    fn test_delete_observation_on_nonexistent_id_does_not_error() {
        let db = test_db();
        let result = db.delete_observation("obs-ghost");
        assert!(result.is_ok());
    }

    // ── upsert behaviour ───────────────────────────────────────────────────

    #[test]
    fn test_insert_or_replace_observation_updates_existing_entry() {
        let db = test_db();
        db.insert_observation("obs-upsert", "/tmp/proj", "Original text", "misc", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").unwrap();
        // INSERT OR REPLACE with same id should overwrite
        db.insert_observation("obs-upsert", "/tmp/proj", "Updated text", "conventions", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z").unwrap();

        let observations = db.list_observations("/tmp/proj").unwrap();
        assert_eq!(observations.len(), 1);
        assert_eq!(observations[0].text, "Updated text");
        assert_eq!(observations[0].category, "conventions");
    }

    // ── serde serialization ────────────────────────────────────────────────

    #[test]
    fn test_observation_row_serializes_with_camel_case_field_names() {
        let row = ObservationRow {
            id: "obs-1".to_string(),
            project_path: "/tmp/proj".to_string(),
            text: "Use snake_case in Rust".to_string(),
            category: "conventions".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_referenced_at: "2026-01-02T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&row).unwrap();
        assert!(json.contains("\"projectPath\""), "expected camelCase projectPath");
        assert!(json.contains("\"createdAt\""), "expected camelCase createdAt");
        assert!(json.contains("\"lastReferencedAt\""), "expected camelCase lastReferencedAt");
        assert!(!json.contains("\"project_path\""), "snake_case must not appear");
        assert!(!json.contains("\"last_referenced_at\""), "snake_case must not appear");
    }
}
