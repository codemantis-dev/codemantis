use crate::terminal::pty_manager::TerminalPool;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub session_id: String,
    pub name: String,
}

#[tauri::command]
pub async fn create_terminal(
    app_handle: AppHandle,
    state: State<'_, TerminalPool>,
    session_id: String,
    cwd: String,
    shell: Option<String>,
    name: Option<String>,
    args: Option<Vec<String>>,
) -> Result<TerminalInfo, String> {
    let terminal_name = name.unwrap_or_else(|| "Terminal".to_string());

    let terminal_id = state
        .create_terminal(app_handle, &session_id, &cwd, shell.as_deref(), args)
        .await
        .map_err(|e| e.to_string())?;

    Ok(TerminalInfo {
        id: terminal_id,
        session_id,
        name: terminal_name,
    })
}

#[tauri::command]
pub async fn send_terminal_input(
    state: State<'_, TerminalPool>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    state
        .send_input(&terminal_id, &data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, TerminalPool>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .resize(&terminal_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_terminal(
    state: State<'_, TerminalPool>,
    terminal_id: String,
) -> Result<(), String> {
    state
        .close_terminal(&terminal_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_terminals(
    state: State<'_, TerminalPool>,
    session_id: String,
) -> Result<Vec<String>, String> {
    Ok(state.list_for_session(&session_id).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TerminalInfo struct ───────────────────────────────────────────────────

    #[test]
    fn terminal_info_serializes_with_expected_field_names() {
        let info = TerminalInfo {
            id: "term-abc".to_string(),
            session_id: "sess-123".to_string(),
            name: "My Terminal".to_string(),
        };

        let json = serde_json::to_string(&info).unwrap();

        assert!(
            json.contains("\"id\""),
            "expected \"id\" field, got: {}",
            json
        );
        assert!(
            json.contains("\"session_id\""),
            "expected \"session_id\" field, got: {}",
            json
        );
        assert!(
            json.contains("\"name\""),
            "expected \"name\" field, got: {}",
            json
        );
        // Verify actual values round-trip correctly
        assert!(json.contains("term-abc"));
        assert!(json.contains("sess-123"));
        assert!(json.contains("My Terminal"));
    }

    #[test]
    fn terminal_info_deserializes_from_json() {
        let json = r#"{"id":"t1","session_id":"s1","name":"Shell"}"#;
        let info: TerminalInfo = serde_json::from_str(json).unwrap();

        assert_eq!(info.id, "t1");
        assert_eq!(info.session_id, "s1");
        assert_eq!(info.name, "Shell");
    }

    #[test]
    fn terminal_info_clone_produces_independent_copy() {
        let original = TerminalInfo {
            id: "t-orig".to_string(),
            session_id: "s-orig".to_string(),
            name: "Original".to_string(),
        };

        let cloned = original.clone();

        assert_eq!(cloned.id, original.id);
        assert_eq!(cloned.session_id, original.session_id);
        assert_eq!(cloned.name, original.name);
    }
}
