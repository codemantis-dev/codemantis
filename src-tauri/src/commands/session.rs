use crate::claude::process::ClaudeProcess;
use crate::claude::session::{AppState, SessionInfo, SessionStatus};
use crate::errors::AppError;
use crate::storage::database::PersistedSession;
use crate::terminal::pty_manager::TerminalPool;
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

    let icon_index = state.database.get_next_icon_index().unwrap_or(0);

    let session_info = SessionInfo {
        id: session_id.clone(),
        name: session_name,
        project_path: project_path.clone(),
        status: SessionStatus::Starting,
        created_at: Utc::now(),
        model: None,
        icon_index,
    };

    // Store session info
    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(session_id.clone(), session_info.clone());
    }

    // Persist to SQLite
    let _ = state.database.insert_session(
        &session_info.id,
        &session_info.name,
        &session_info.project_path,
        "starting",
        &session_info.created_at.to_rfc3339(),
        None,
        session_info.icon_index,
    );

    // Spawn the CLI process
    let process = ClaudeProcess::spawn(
        app_handle,
        session_id.clone(),
        &project_path,
        &claude_binary,
        None,
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
    let _ = state.database.update_session_status(&session_id, "connected");

    let sessions = state.sessions.lock().await;
    Ok(sessions.get(&session_id).cloned().unwrap())
}

/// Pauses the session's CLI process without closing the session.
/// Used before opening the CLI overlay so the interactive process can resume the same conversation.
#[tauri::command]
pub async fn pause_session_process(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut processes = state.processes.lock().await;
    if let Some(mut process) = processes.remove(&session_id) {
        process.shutdown().await;
    }
    let mut sessions = state.sessions.lock().await;
    if let Some(session) = sessions.get_mut(&session_id) {
        session.status = SessionStatus::Idle;
    }
    Ok(())
}

/// Restarts the session's CLI process, optionally resuming a CLI conversation.
/// Used after closing the CLI overlay to return to stream-json mode.
#[tauri::command]
pub async fn resume_session_process(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cli_session_id: Option<String>,
) -> Result<(), String> {
    let claude_binary = {
        let binary = state.claude_binary.lock().await;
        binary.clone().ok_or_else(|| "Claude CLI not found".to_string())?
    };

    let project_path = {
        let sessions = state.sessions.lock().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        session.project_path.clone()
    };

    let process = ClaudeProcess::spawn(
        app_handle,
        session_id.clone(),
        &project_path,
        &claude_binary,
        cli_session_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    {
        let mut processes = state.processes.lock().await;
        processes.insert(session_id.clone(), process);
    }

    {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.status = SessionStatus::Connected;
        }
    }

    Ok(())
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
pub async fn respond_to_question(
    state: State<'_, AppState>,
    session_id: String,
    tool_use_id: String,
    answer: String,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()).to_string())?;

    let response = serde_json::json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": answer,
    });

    process
        .send_raw(&response.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_session(
    state: State<'_, AppState>,
    terminal_pool: State<'_, TerminalPool>,
    session_id: String,
) -> Result<(), String> {
    // Shutdown the process
    {
        let mut processes = state.processes.lock().await;
        if let Some(mut process) = processes.remove(&session_id) {
            process.shutdown().await;
        }
    }

    // Close all terminals for this session
    terminal_pool.close_all_for_session(&session_id).await;

    // Update session status
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.status = SessionStatus::Closed;
        }
    }

    // Persist status
    let _ = state.database.update_session_status(&session_id, "closed");

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

#[tauri::command]
pub async fn rename_session(
    state: State<'_, AppState>,
    session_id: String,
    new_name: String,
) -> Result<(), String> {
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.name = new_name.clone();
        }
    }
    state
        .database
        .rename_session(&session_id, &new_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_persisted_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<PersistedSession>, String> {
    state
        .database
        .list_sessions()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_persisted_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state
        .database
        .delete_session(&session_id)
        .map_err(|e| e.to_string())
}
