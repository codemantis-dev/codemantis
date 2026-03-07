use crate::claude::session::AppState;
use crate::utils::claude_detection::{detect_claude, ClaudeStatus};
use tauri::State;

#[tauri::command]
pub async fn check_claude_status(state: State<'_, AppState>) -> Result<ClaudeStatus, String> {
    let status = detect_claude();

    if status.installed {
        let mut binary = state.claude_binary.lock().await;
        *binary = status.binary_path.clone();
    }

    Ok(status)
}
