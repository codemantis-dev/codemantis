use crate::claude::event_types::ControlRequestPayload;
use crate::claude::process::ClaudeProcess;
use crate::claude::session::{AppState, ControlRequestKind, SessionInfo, SessionMode, SessionStatus};
use crate::errors::AppError;
use crate::storage::database::PersistedSession;
use crate::terminal::pty_manager::TerminalPool;
use chrono::Utc;
use log::{info, warn};
use serde::Serialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct SessionHistoryEntry {
    pub session_id: String,
    pub name: String,
    pub model: Option<String>,
    pub closed_at: String,
    pub cli_session_id: String,
    pub icon_index: i32,
    pub recent_headlines: Vec<String>,
}

#[tauri::command]
pub async fn create_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    project_path: String,
    name: Option<String>,
    resume_cli_session_id: Option<String>,
) -> Result<SessionInfo, String> {
    let session_id = Uuid::new_v4().to_string();

    let claude_binary = {
        let binary = state.claude_binary.lock().await;
        binary.clone().ok_or_else(|| "Claude CLI not found".to_string())?
    };

    let session_name = if let Some(n) = name {
        n
    } else {
        let base = std::path::Path::new(&project_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "New Session".to_string());
        // Count existing sessions for this project to auto-number
        let sessions = state.sessions.lock().await;
        let existing_count = sessions
            .values()
            .filter(|s| s.project_path == project_path)
            .count();
        drop(sessions);
        if existing_count == 0 {
            base
        } else {
            format!("{} {}", base, existing_count + 1)
        }
    };

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

    // Get approval server port
    let approval_port = {
        let port = state.approval_server_port.lock().await;
        *port
    };

    // Spawn the CLI process
    let process = ClaudeProcess::spawn(
        app_handle,
        session_id.clone(),
        &project_path,
        &claude_binary,
        resume_cli_session_id.as_deref(),
        approval_port,
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
    sessions
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Session not found after connection".to_string())
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

    // Use frontend-provided CLI session ID, or fall back to backend-stored one
    let effective_cli_session_id = match &cli_session_id {
        Some(id) => Some(id.clone()),
        None => {
            let cli_ids = state.cli_session_ids.lock().await;
            cli_ids.get(&session_id).cloned()
        }
    };

    // Get approval server port
    let approval_port = {
        let port = state.approval_server_port.lock().await;
        *port
    };

    let process = ClaudeProcess::spawn(
        app_handle,
        session_id.clone(),
        &project_path,
        &claude_binary,
        effective_cli_session_id.as_deref(),
        approval_port,
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
pub async fn set_session_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: SessionMode,
) -> Result<(), String> {
    info!(
        "[set_session_mode] session_id={}, mode={:?}",
        session_id, mode
    );

    // Update backend state (approval server enforcement)
    {
        let mut modes = state.session_modes.lock().await;
        modes.insert(session_id.clone(), mode.clone());
    }

    // Map CodeMantis mode to CLI permission_mode string
    let cli_mode = match &mode {
        SessionMode::Normal => "default",
        SessionMode::AutoAccept => "acceptEdits",
        SessionMode::Plan => "plan",
    };

    // Best-effort: send control request to CLI to sync permission mode
    let processes = state.processes.lock().await;
    if let Some(process) = processes.get(&session_id) {
        if process.is_running() {
            match process.send_control_request(ControlRequestPayload::SetPermissionMode {
                mode: cli_mode.to_string(),
            }) {
                Ok(request_id) => {
                    let mut pending = state.pending_control_requests.lock().await;
                    pending.insert(
                        request_id,
                        (session_id.clone(), ControlRequestKind::SetPermissionMode(cli_mode.to_string())),
                    );
                    info!("[set_session_mode] Sent set_permission_mode={} to CLI", cli_mode);
                }
                Err(e) => {
                    warn!("[set_session_mode] Failed to send set_permission_mode to CLI: {}", e);
                }
            }
        }
    }

    Ok(())
}

/// Updates only the backend session mode (approval server) without sending
/// a control request to the CLI. Used when the frontend detects a CLI-initiated
/// mode change (ExitPlanMode/EnterPlanMode) — the CLI already changed, so we
/// only need to sync the backend.
#[tauri::command]
pub async fn sync_session_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: SessionMode,
) -> Result<(), String> {
    info!(
        "[sync_session_mode] session_id={}, mode={:?}",
        session_id, mode
    );
    let mut modes = state.session_modes.lock().await;
    modes.insert(session_id, mode);
    Ok(())
}

#[tauri::command]
pub async fn resolve_tool_approval(
    state: State<'_, AppState>,
    request_id: String,
    approved: bool,
    reason: Option<String>,
) -> Result<(), String> {
    info!(
        "[resolve_tool_approval] request_id={}, approved={}, reason={:?}",
        request_id, approved, reason
    );
    let resolved = state
        .approval_state
        .resolve(&request_id, approved, reason)
        .await;
    if resolved {
        Ok(())
    } else {
        Err(format!(
            "No pending approval found for request_id: {}",
            request_id
        ))
    }
}

#[tauri::command]
pub async fn close_session(
    state: State<'_, AppState>,
    terminal_pool: State<'_, TerminalPool>,
    session_id: String,
) -> Result<(), String> {
    // Read cli_session_id and model before shutting down
    let cli_sid = {
        let cli_ids = state.cli_session_ids.lock().await;
        cli_ids.get(&session_id).cloned()
    };
    let model = {
        let sessions = state.sessions.lock().await;
        sessions.get(&session_id).and_then(|s| s.model.clone())
    };

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

    // Persist with CLI session ID, model, and closed_at timestamp
    let closed_at = Utc::now().to_rfc3339();
    let _ = state.database.close_session_with_details(
        &session_id,
        cli_sid.as_deref(),
        model.as_deref(),
        &closed_at,
    );

    // Clean up cli_session_ids entry
    {
        let mut cli_ids = state.cli_session_ids.lock().await;
        cli_ids.remove(&session_id);
    }

    // Clean up any pending control requests for this session
    {
        let mut pending = state.pending_control_requests.lock().await;
        pending.retain(|_, (sid, _)| sid != &session_id);
    }

    Ok(())
}

/// Checks whether the CLI process for a session is still alive.
/// Returns true if the process exists and appears to be running.
#[tauri::command]
pub async fn check_process_alive(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    let processes = state.processes.lock().await;
    match processes.get(&session_id) {
        Some(process) => Ok(process.is_running()),
        None => Ok(false),
    }
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

#[tauri::command]
pub async fn list_session_history(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<SessionHistoryEntry>, String> {
    let closed = state
        .database
        .list_closed_sessions_for_project(&project_path, 20)
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for session in closed {
        let headlines: Vec<String> = state
            .database
            .list_changelog_entries(&session.id)
            .unwrap_or_default()
            .into_iter()
            .take(3)
            .map(|e| e.headline)
            .collect();

        if let (Some(cli_sid), Some(closed_at)) = (session.cli_session_id, session.closed_at) {
            entries.push(SessionHistoryEntry {
                session_id: session.id,
                name: session.name,
                model: session.model,
                closed_at,
                cli_session_id: cli_sid,
                icon_index: session.icon_index,
                recent_headlines: headlines,
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn interrupt_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let request_id = process
        .send_control_request(ControlRequestPayload::Interrupt)
        .map_err(|e| e.to_string())?;

    let mut pending = state.pending_control_requests.lock().await;
    pending.insert(
        request_id,
        (session_id, ControlRequestKind::Interrupt),
    );

    Ok(())
}

#[tauri::command]
pub async fn set_session_model(
    state: State<'_, AppState>,
    session_id: String,
    model: String,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let request_id = process
        .send_control_request(ControlRequestPayload::SetModel {
            model: model.clone(),
        })
        .map_err(|e| e.to_string())?;

    let mut pending = state.pending_control_requests.lock().await;
    pending.insert(
        request_id,
        (session_id, ControlRequestKind::SetModel(model)),
    );

    Ok(())
}

#[tauri::command]
pub async fn initialize_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let request_id = process
        .send_control_request(ControlRequestPayload::Initialize)
        .map_err(|e| e.to_string())?;

    let mut pending = state.pending_control_requests.lock().await;
    pending.insert(
        request_id,
        (session_id, ControlRequestKind::Initialize),
    );

    Ok(())
}
