use crate::claude::session::AppState;
use crate::commands::settings::get_settings;
use crate::utils::claude_detection::{detect_claude, validate_claude_binary, ClaudeStatus};
use tauri::State;

#[tauri::command]
pub async fn check_claude_status(state: State<'_, AppState>) -> Result<ClaudeStatus, String> {
    // Check for a user-configured override first
    if let Ok(settings) = get_settings() {
        if let Some(ref override_path) = settings.claude_binary_override {
            if let Some(status) = validate_claude_binary(override_path) {
                let mut binary = state.claude_binary.lock().await;
                *binary = status.binary_path.clone();
                return Ok(status);
            }
        }
    }

    let status = detect_claude();

    if status.installed {
        let mut binary = state.claude_binary.lock().await;
        *binary = status.binary_path.clone();
    }

    Ok(status)
}

#[tauri::command]
pub async fn set_claude_binary_override(
    path: String,
    state: State<'_, AppState>,
) -> Result<ClaudeStatus, String> {
    // Validate the binary at the given path
    let status = validate_claude_binary(&path)
        .ok_or_else(|| format!("No valid Claude binary found at: {}", path))?;

    // Save override to settings
    let mut settings = get_settings().map_err(|e| e.to_string())?;
    settings.claude_binary_override = Some(path);
    crate::commands::settings::update_settings(settings).map_err(|e| e.to_string())?;

    // Update the cached binary path in AppState
    let mut binary = state.claude_binary.lock().await;
    *binary = status.binary_path.clone();

    Ok(status)
}
