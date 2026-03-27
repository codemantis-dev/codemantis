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
