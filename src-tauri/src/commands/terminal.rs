use crate::terminal::pty_manager::TerminalPool;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize)]
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
