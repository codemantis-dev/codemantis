use crate::claude::process::ClaudeProcess;
use crate::claude::session::{AppState, SessionInfo, SessionStatus};
use crate::errors::AppError;
use chrono::Utc;
use tauri::{AppHandle, State};
use uuid::Uuid;

#[tauri::command]
pub async fn create_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    project_path: String,
    name: Option<String>,
) -> Result<SessionInfo, String> {
    let session_id = Uuid::new_v4().to_string();

    let claude_binary = {
        let binary = state.claude_binary.lock().await;
        binary.clone().ok_or_else(|| "Claude CLI not found".to_string())?
    };

    let session_name = name.unwrap_or_else(|| {
        std::path::Path::new(&project_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "New Session".to_string())
    });

    let session_info = SessionInfo {
        id: session_id.clone(),
        name: session_name,
        project_path: project_path.clone(),
        status: SessionStatus::Starting,
        created_at: Utc::now(),
        model: None,
    };

    // Store session info
    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(session_id.clone(), session_info.clone());
    }

    // Spawn the CLI process
    let process = ClaudeProcess::spawn(
        app_handle,
        session_id.clone(),
        &project_path,
        &claude_binary,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Store process
    {
        let mut processes = state.processes.lock().await;
        processes.insert(session_id.clone(), process);
    }

    // Update status to connected
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.status = SessionStatus::Connected;
        }
    }

    let sessions = state.sessions.lock().await;
    Ok(sessions.get(&session_id).cloned().unwrap())
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()).to_string())?;

    if !process.is_running() {
        return Err(AppError::ProcessNotRunning(session_id).to_string());
    }

    process.send_message(&prompt).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn respond_to_approval(
    state: State<'_, AppState>,
    session_id: String,
    tool_use_id: String,
    approved: bool,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()).to_string())?;

    let response = serde_json::json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "approved": approved,
    });

    process
        .send_raw(&response.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    // Shutdown the process
    {
        let mut processes = state.processes.lock().await;
        if let Some(mut process) = processes.remove(&session_id) {
            process.shutdown().await;
        }
    }

    // Update session status
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.status = SessionStatus::Closed;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let sessions = state.sessions.lock().await;
    sessions
        .get(&session_id)
        .cloned()
        .ok_or_else(|| AppError::SessionNotFound(session_id).to_string())
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, String> {
    let sessions = state.sessions.lock().await;
    Ok(sessions.values().cloned().collect())
}
