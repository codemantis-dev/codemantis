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
