use tauri::Manager;

#[tauri::command]
pub fn read_user_guide(app_handle: tauri::AppHandle) -> Result<String, String> {
    let resource_path = app_handle
        .path()
        .resolve("resources/user-guide.md", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve user guide path: {}", e))?;

    std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read user guide: {}", e))
}
