use crate::agents::claude_code::session_mode_to_cli;
use crate::agents::{registry, AgentId, ControlRequestPayload, SessionConfig, SessionMode};
use crate::agents::claude_code::session::{AppState, ControlRequestKind, SessionInfo, SessionStatus};
use crate::errors::AppError;
use crate::storage::database::{PersistedSession, SessionMessageRow, SessionMessageSearchResult};
use crate::terminal::pty_manager::TerminalPool;
use chrono::Utc;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct SessionHistoryEntry {
    pub session_id: String,
    pub name: String,
    pub project_path: String,
    pub model: Option<String>,
    pub closed_at: String,
    pub cli_session_id: String,
    pub icon_index: i32,
    pub recent_headlines: Vec<String>,
    pub has_stored_messages: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessagePayload {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub thinking_content: Option<String>,
    pub sort_order: i32,
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
        let base = derive_session_base_name(&project_path);
        // Count existing sessions for this project to auto-number
        let sessions = state.sessions.lock().await;
        let existing_count = sessions
            .values()
            .filter(|s| s.project_path == project_path)
            .count();
        drop(sessions);
        format_session_name(&base, existing_count)
    };

    let icon_index = state.database.get_next_icon_index().unwrap_or(0);

    let session_info = SessionInfo {
        id: session_id.clone(),
        agent_id: AgentId::ClaudeCode,
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
    if let Err(e) = state.database.insert_session(
        &session_info.id,
        &session_info.name,
        &session_info.project_path,
        "starting",
        &session_info.created_at.to_rfc3339(),
        None,
        session_info.icon_index,
    ) {
        log::error!("Failed to persist session to database: {}", e);
    }

    // Crash-recovery flag: this session is now open. Cleared on close or graceful exit;
    // anything still set on next launch indicates the prior shutdown was unclean.
    if let Err(e) = state.database.set_session_was_open(&session_info.id, true) {
        log::warn!("Failed to set was_open flag: {}", e);
    }

    // Get approval server port
    let approval_port = {
        let port = state.approval_server_port.lock().await;
        *port
    };

    let effort_override = state.thinking_effort_override(&project_path).await;

    // Spawn through the Claude Code adapter (Phase 1 Session 3: routing now
    // goes through the AgentAdapter trait instead of the concrete CLI process).
    let adapter = registry::get(AgentId::ClaudeCode)
        .ok_or_else(|| "Claude Code adapter not registered".to_string())?;
    let handle = adapter
        .spawn_session(
            app_handle,
            &claude_binary,
            approval_port,
            SessionConfig {
                session_id: session_id.clone(),
                project_path: project_path.clone(),
                session_name: Some(session_info.name.clone()),
                model_override: None,
                append_system_prompt: None,
                resume_token: resume_cli_session_id.clone(),
                effort_override: effort_override.clone(),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // Store handle
    {
        let mut processes = state.processes.lock().await;
        processes.insert(session_id.clone(), handle);
    }

    // Update status to connected
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.status = SessionStatus::Connected;
        }
    }
    if let Err(e) = state.database.update_session_status(&session_id, "connected") {
        log::error!("Failed to update session status in database: {}", e);
    }

    info!("Session created: id={}, project={}", session_id, project_path);

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
    let removed = {
        let mut processes = state.processes.lock().await;
        processes.remove(&session_id)
    };
    if let Some(process) = removed {
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

    let (project_path, session_name) = {
        let sessions = state.sessions.lock().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        (session.project_path.clone(), session.name.clone())
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

    let effort_override = state.thinking_effort_override(&project_path).await;

    let adapter = registry::get(AgentId::ClaudeCode)
        .ok_or_else(|| "Claude Code adapter not registered".to_string())?;
    let handle = adapter
        .spawn_session(
            app_handle,
            &claude_binary,
            approval_port,
            SessionConfig {
                session_id: session_id.clone(),
                project_path: project_path.clone(),
                session_name: Some(session_name.clone()),
                model_override: None,
                append_system_prompt: None,
                resume_token: effective_cli_session_id.clone(),
                effort_override: effort_override.clone(),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut processes = state.processes.lock().await;
        processes.insert(session_id.clone(), handle);
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

    process
        .send_user_message(&prompt)
        .await
        .map_err(|e| e.to_string())
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
        modes.insert(session_id.clone(), mode);
    }

    // Map CodeMantis mode to CLI permission_mode string
    let cli_mode = session_mode_to_cli(mode);

    // Best-effort: send control request to CLI to sync permission mode
    let processes = state.processes.lock().await;
    if let Some(process) = processes.get(&session_id) {
        if process.is_running() {
            match process
                .send_control_request(ControlRequestPayload::SetPermissionMode {
                    mode: cli_mode.to_string(),
                })
                .await
            {
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

/// Deliver an `AskUserQuestion` answer to Claude.
///
/// CLI 2.1.126 always synthesises `tool_result(is_error=true,
/// content="Answer questions?")` for AskUserQuestion regardless of the
/// PreToolUse hook's allow/deny decision (see
/// docs/internal/cli-2.1.126-protocol-report.md §S09 — captured response is
/// the literal "It looks like the question prompt was dismissed."). The hook
/// `reason` field never reaches the model, so to actually deliver the user's
/// answer we must:
///   1. resolve the hook (decision is irrelevant — pick `allow` to keep the
///      transcript truthful: the host did not block the tool).
///   2. inject `answer` as a normal user message via the same path
///      `send_message` uses, so Claude sees it on the next turn.
#[tauri::command]
pub async fn submit_question_answer(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
    answer: String,
) -> Result<(), String> {
    info!(
        "[submit_question_answer] session_id={}, request_id={}, answer_len={}",
        session_id,
        request_id,
        answer.len()
    );

    // Step 1 — release the still-blocked PreToolUse hook so the CLI can
    // continue its turn. The CLI will synthesise its own denial regardless;
    // we pick `allow` to truthfully reflect that the host did not block.
    let resolved = state
        .approval_state
        .resolve(&request_id, true, None)
        .await;
    if !resolved {
        warn!(
            "[submit_question_answer] No pending approval for request_id={} (hook may have already timed out)",
            request_id
        );
    }

    // Step 2 — inject the answer as a regular user message.
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()).to_string())?;
    if !process.is_running() {
        return Err(AppError::ProcessNotRunning(session_id).to_string());
    }
    process
        .send_user_message(&answer)
        .await
        .map_err(|e| e.to_string())
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

    // Shutdown the process (drop the map lock before awaiting shutdown)
    let removed = {
        let mut processes = state.processes.lock().await;
        processes.remove(&session_id)
    };
    if let Some(process) = removed {
        process.shutdown().await;
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
    // Check if messages were saved BEFORE we close the session
    let has_msgs_before = state.database.session_has_messages(&session_id).unwrap_or(false);
    if let Err(e) = state.database.close_session_with_details(
        &session_id,
        cli_sid.as_deref(),
        model.as_deref(),
        &closed_at,
    ) {
        error!("Failed to persist session close details to database: {}", e);
    }
    // Crash-recovery flag: explicit close means this session is no longer open.
    if let Err(e) = state.database.set_session_was_open(&session_id, false) {
        warn!("Failed to clear was_open flag on close: {}", e);
    }
    // Check if messages still exist AFTER close
    let has_msgs_after = state.database.session_has_messages(&session_id).unwrap_or(false);

    info!(
        "[close_session] id={} cli_sid={:?} model={:?} has_messages_before={} has_messages_after={}",
        session_id, cli_sid, model, has_msgs_before, has_msgs_after
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
            info!(
                "[list_session_history] session={} name={} has_stored_messages={} closed_at={}",
                session.id, session.name, session.has_stored_messages, closed_at
            );
            entries.push(SessionHistoryEntry {
                session_id: session.id,
                name: session.name,
                project_path: session.project_path,
                model: session.model,
                closed_at,
                cli_session_id: cli_sid,
                icon_index: session.icon_index,
                recent_headlines: headlines,
                has_stored_messages: session.has_stored_messages,
            });
        }
    }

    Ok(entries)
}

/// Returns the N most recently closed sessions across **all** projects.
/// Backs the "Resume Session" tab of the Open Project modal.
#[tauri::command]
pub async fn list_recent_sessions(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<SessionHistoryEntry>, String> {
    let closed = state
        .database
        .list_recent_closed_sessions(limit)
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
                project_path: session.project_path,
                model: session.model,
                closed_at,
                cli_session_id: cli_sid,
                icon_index: session.icon_index,
                recent_headlines: headlines,
                has_stored_messages: session.has_stored_messages,
            });
        }
    }

    Ok(entries)
}

/// Crash recovery: returns all sessions still flagged was_open=1, meaning
/// the previous shutdown didn't run the graceful drain. Each entry carries
/// the cli_session_id needed for `claude --resume` and the icon/name needed
/// to redraw the tab. Sessions without a cli_session_id (CLI never returned
/// System/init) are skipped — they can't be resumed.
#[tauri::command]
pub async fn list_crashed_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionHistoryEntry>, String> {
    let crashed = state
        .database
        .list_crashed_sessions()
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for session in crashed {
        let headlines: Vec<String> = state
            .database
            .list_changelog_entries(&session.id)
            .unwrap_or_default()
            .into_iter()
            .take(3)
            .map(|e| e.headline)
            .collect();

        // closed_at may be NULL (the session never went through close_session);
        // fall back to created_at so the frontend always has a sortable timestamp.
        let closed_at = session.closed_at.unwrap_or_else(|| session.created_at.clone());
        if let Some(cli_sid) = session.cli_session_id {
            entries.push(SessionHistoryEntry {
                session_id: session.id,
                name: session.name,
                project_path: session.project_path,
                model: session.model,
                closed_at,
                cli_session_id: cli_sid,
                icon_index: session.icon_index,
                recent_headlines: headlines,
                has_stored_messages: session.has_stored_messages,
            });
        }
    }

    Ok(entries)
}

/// After the user dismisses the recovery banner (or closes a paused-recovered tab
/// without resuming), clear the was_open flag for these IDs so we don't keep
/// reporting them as crash candidates on subsequent launches.
///
/// Also promote each acknowledged session to `status='closed'` if it was still
/// in a non-terminal state. This makes the recovered session visible in the
/// Resume Session list — the user explicitly chose not to resume right now,
/// but they should still be able to find it later.
#[tauri::command]
pub async fn acknowledge_crashed_sessions(
    state: State<'_, AppState>,
    session_ids: Vec<String>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    for id in &session_ids {
        match state.database.mark_session_closed_if_stale(id, &now) {
            Ok(true) => log::info!(
                "[acknowledge_crashed_sessions] Promoted {} to closed for Resume list",
                id
            ),
            Ok(false) => {}
            Err(e) => log::warn!("Failed to promote stale session {}: {}", id, e),
        }
        if let Err(e) = state.database.set_session_was_open(id, false) {
            log::warn!("Failed to clear was_open for {}: {}", id, e);
        }
    }
    Ok(())
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
        .await
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
        .await
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
        .await
        .map_err(|e| e.to_string())?;

    let mut pending = state.pending_control_requests.lock().await;
    pending.insert(
        request_id,
        (session_id, ControlRequestKind::Initialize),
    );

    Ok(())
}

// ── Pure helper functions (extracted for testability) ──

/// Derives the base session name from a project path.
/// Uses the last path component, or "New Session" as fallback.
pub(crate) fn derive_session_base_name(project_path: &str) -> String {
    Path::new(project_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "New Session".to_string())
}

/// Formats the final session name, appending a number if there are existing sessions.
pub(crate) fn format_session_name(base: &str, existing_count: usize) -> String {
    if existing_count == 0 {
        base.to_string()
    } else {
        format!("{} {}", base, existing_count + 1)
    }
}

// `session_mode_to_cli` moved to `crate::agents::claude_code` in Phase 1
// Session 2 (spec §3.3) and is imported at the top of this file.

// ── Session Messages (Session Logs) ─────────────────────────────────

/// Snapshot-tick reconciliation: promote a "stale-open" session to
/// `status='closed'` so it appears in the Resume Session list.
///
/// The frontend calls this from `useCrashRecoverySnapshot.tick` for any
/// session whose tab has been removed from the workspace but whose row on
/// disk is still in a non-terminal state. Idempotent — already-closed rows
/// are left alone (returns `false`).
#[tauri::command]
pub async fn mark_session_closed_if_stale(
    state: State<'_, AppState>,
    session_id: String,
    closed_at: String,
) -> Result<bool, String> {
    state
        .database
        .mark_session_closed_if_stale(&session_id, &closed_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_session_messages(
    state: State<'_, AppState>,
    session_id: String,
    messages: Vec<SessionMessagePayload>,
) -> Result<(), String> {
    info!(
        "[save_session_messages] Received {} messages for session {}",
        messages.len(),
        session_id
    );
    let rows: Vec<SessionMessageRow> = messages
        .into_iter()
        .map(|m| SessionMessageRow {
            id: m.id,
            session_id: session_id.clone(),
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            thinking_content: m.thinking_content,
            sort_order: m.sort_order,
        })
        .collect();
    match state.database.save_session_messages(&session_id, &rows) {
        Ok(()) => {
            // Verify the save by checking if messages exist now
            let has = state.database.session_has_messages(&session_id);
            info!(
                "[save_session_messages] Saved {} messages for session {} — verified in DB: {:?}",
                rows.len(),
                session_id,
                has
            );
            Ok(())
        }
        Err(e) => {
            error!(
                "[save_session_messages] FAILED to save {} messages for session {}: {}",
                rows.len(),
                session_id,
                e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn load_session_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<SessionMessagePayload>, String> {
    info!("[load_session_messages] Loading messages for session {}", session_id);
    let rows = state
        .database
        .load_session_messages(&session_id)
        .map_err(|e| {
            error!("[load_session_messages] FAILED for session {}: {}", session_id, e);
            e.to_string()
        })?;
    info!("[load_session_messages] Found {} messages for session {}", rows.len(), session_id);
    Ok(rows
        .into_iter()
        .map(|r| SessionMessagePayload {
            id: r.id,
            role: r.role,
            content: r.content,
            timestamp: r.timestamp,
            thinking_content: r.thinking_content,
            sort_order: r.sort_order,
        })
        .collect())
}

#[tauri::command]
pub async fn search_session_messages(
    state: State<'_, AppState>,
    project_path: String,
    query: String,
) -> Result<Vec<SessionMessageSearchResult>, String> {
    state
        .database
        .search_session_messages(&project_path, &query, 100)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_expired_session_logs(
    state: State<'_, AppState>,
    retention_days: u32,
) -> Result<u32, String> {
    state
        .database
        .delete_expired_session_messages(retention_days)
        .map_err(|e| e.to_string())
}

// ── SpecWriter sessions ─────────────────────────────────────────────

/// Create a dedicated SpecWriter CLI session with model override and system prompt.
/// The session is NOT added to the session tab bar or persisted to the database.
#[tauri::command]
pub async fn create_specwriter_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    project_path: String,
    model: String,
    system_prompt: String,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();

    let claude_binary = {
        let binary = state.claude_binary.lock().await;
        binary.clone().ok_or_else(|| "Claude CLI not found".to_string())?
    };

    let approval_port = {
        let port = state.approval_server_port.lock().await;
        *port
    };

    // Phase 1: SpecWriter is hardcoded to Claude Code. Phase 2 picks the
    // adapter by capability (supports_append_system_prompt). Codex has no
    // --append-system-prompt flag and uses an ephemeral AGENTS.override.md
    // instead — the capability layer abstracts the mechanism.
    let adapter = registry::get(AgentId::ClaudeCode)
        .ok_or_else(|| "Claude Code adapter not registered".to_string())?;
    let handle = adapter
        .spawn_session(
            app_handle,
            &claude_binary,
            approval_port,
            SessionConfig {
                session_id: session_id.clone(),
                project_path: project_path.clone(),
                session_name: Some("SpecWriter".to_string()),
                model_override: Some(model.clone()),
                append_system_prompt: Some(system_prompt.clone()),
                resume_token: None,
                // SpecWriter ignores the user's effort choice.
                effort_override: None,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // Store handle (for send_user_message, interrupt, cleanup on exit)
    {
        let mut processes = state.processes.lock().await;
        processes.insert(session_id.clone(), handle);
    }

    // Set Plan mode so the CLI cannot write/edit/create files
    {
        let mut modes = state.session_modes.lock().await;
        modes.insert(session_id.clone(), SessionMode::Plan);
    }

    // Intentionally NOT added to state.sessions (no tab in UI)
    // Intentionally NOT persisted to database

    info!(
        "SpecWriter session created: id={}, model={}, project={}",
        session_id, model, project_path
    );
    Ok(session_id)
}

/// Close a SpecWriter CLI session. Lightweight cleanup — no database, no terminal pool.
#[tauri::command]
pub async fn close_specwriter_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let removed = {
        let mut processes = state.processes.lock().await;
        processes.remove(&session_id)
    };
    if let Some(process) = removed {
        process.shutdown().await;
    }
    {
        let mut modes = state.session_modes.lock().await;
        modes.remove(&session_id);
    }
    {
        let mut pending = state.pending_control_requests.lock().await;
        pending.retain(|_, (sid, _)| sid != &session_id);
    }
    info!("SpecWriter session closed: id={}", session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── derive_session_base_name ──

    #[test]
    fn base_name_from_simple_path() {
        assert_eq!(derive_session_base_name("/Users/hr/projects/my-app"), "my-app");
    }

    #[test]
    fn base_name_from_nested_path() {
        assert_eq!(
            derive_session_base_name("/Users/hr/Dev/CodeMantis/src-tauri"),
            "src-tauri"
        );
    }

    #[test]
    fn base_name_trailing_slash() {
        // Path::file_name returns None for paths ending in "/" on some platforms
        let result = derive_session_base_name("/Users/hr/projects/my-app/");
        assert!(!result.is_empty());
    }

    #[test]
    fn base_name_root_path() {
        assert_eq!(derive_session_base_name("/"), "New Session");
    }

    #[test]
    fn base_name_single_component() {
        assert_eq!(derive_session_base_name("my-project"), "my-project");
    }

    #[test]
    fn base_name_empty_string() {
        assert_eq!(derive_session_base_name(""), "New Session");
    }

    #[test]
    fn base_name_with_spaces() {
        assert_eq!(
            derive_session_base_name("/Users/hr/My Projects/Cool App"),
            "Cool App"
        );
    }

    // ── format_session_name ──

    #[test]
    fn format_name_first_session() {
        assert_eq!(format_session_name("my-app", 0), "my-app");
    }

    #[test]
    fn format_name_second_session() {
        assert_eq!(format_session_name("my-app", 1), "my-app 2");
    }

    #[test]
    fn format_name_tenth_session() {
        assert_eq!(format_session_name("my-app", 9), "my-app 10");
    }

    #[test]
    fn format_name_preserves_base_with_spaces() {
        assert_eq!(format_session_name("Cool App", 2), "Cool App 3");
    }

    // ── session_mode_to_cli ──

    #[test]
    fn mode_normal_maps_to_default() {
        assert_eq!(session_mode_to_cli(SessionMode::Normal), "default");
    }

    #[test]
    fn mode_auto_accept_maps_to_accept_edits() {
        assert_eq!(session_mode_to_cli(SessionMode::AutoAccept), "acceptEdits");
    }

    #[test]
    fn mode_plan_maps_to_plan() {
        assert_eq!(session_mode_to_cli(SessionMode::Plan), "plan");
    }

    #[test]
    fn mode_auto_maps_to_auto() {
        assert_eq!(session_mode_to_cli(SessionMode::Auto), "auto");
    }

    #[test]
    fn mode_dont_ask_maps_to_dont_ask_camel_case() {
        // CLI uses camelCase — do NOT rely on serde kebab-case here.
        assert_eq!(session_mode_to_cli(SessionMode::DontAsk), "dontAsk");
    }

    #[test]
    fn mode_bypass_permissions_maps_to_camel_case() {
        // CLI uses camelCase — do NOT rely on serde kebab-case here.
        assert_eq!(
            session_mode_to_cli(SessionMode::BypassPermissions),
            "bypassPermissions",
        );
    }

    // ── SessionHistoryEntry serialization ──

    #[test]
    fn session_history_entry_serializes_correctly() {
        let entry = SessionHistoryEntry {
            session_id: "abc-123".to_string(),
            name: "Test Session".to_string(),
            project_path: "/Users/hr/proj".to_string(),
            model: Some("claude-sonnet-4-6".to_string()),
            closed_at: "2026-03-20T10:00:00Z".to_string(),
            cli_session_id: "cli-456".to_string(),
            icon_index: 3,
            recent_headlines: vec!["Added login".to_string(), "Fixed bug".to_string()],
            has_stored_messages: true,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["session_id"], "abc-123");
        assert_eq!(json["name"], "Test Session");
        assert_eq!(json["project_path"], "/Users/hr/proj");
        assert_eq!(json["model"], "claude-sonnet-4-6");
        assert_eq!(json["icon_index"], 3);
        assert_eq!(json["recent_headlines"].as_array().unwrap().len(), 2);
        assert_eq!(json["has_stored_messages"], true);
    }

    #[test]
    fn session_history_entry_with_no_model() {
        let entry = SessionHistoryEntry {
            session_id: "abc".to_string(),
            name: "S".to_string(),
            project_path: "/p".to_string(),
            model: None,
            closed_at: "2026-01-01T00:00:00Z".to_string(),
            cli_session_id: "cli".to_string(),
            icon_index: 0,
            recent_headlines: vec![],
            has_stored_messages: false,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert!(json["model"].is_null());
        assert!(json["recent_headlines"].as_array().unwrap().is_empty());
        assert_eq!(json["has_stored_messages"], false);
    }

    #[test]
    fn session_message_payload_roundtrip() {
        let payload = SessionMessagePayload {
            id: "msg-1".to_string(),
            role: "user".to_string(),
            content: "Hello world".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            thinking_content: Some("thinking".to_string()),
            sort_order: 0,
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["id"], "msg-1");
        assert_eq!(json["role"], "user");
        assert_eq!(json["thinkingContent"], "thinking");
        assert_eq!(json["sortOrder"], 0);
        // Roundtrip
        let restored: SessionMessagePayload = serde_json::from_value(json).unwrap();
        assert_eq!(restored.id, "msg-1");
        assert_eq!(restored.thinking_content, Some("thinking".to_string()));
    }

    // ── derive_session_base_name edge cases ──

    #[test]
    fn base_name_from_dot_path() {
        // Relative path "." — function falls back to "New Session" for non-meaningful names
        let result = derive_session_base_name(".");
        assert_eq!(result, "New Session");
    }

    #[test]
    fn base_name_from_home_dir() {
        assert_eq!(derive_session_base_name("/Users/hr"), "hr");
    }

    #[test]
    fn base_name_from_windows_style_path() {
        // On macOS/Linux, backslashes are valid filename chars
        // Path treats the whole thing as a single component
        let result = derive_session_base_name("C:\\Users\\hr\\projects");
        assert!(!result.is_empty());
    }

    #[test]
    fn base_name_unicode_path() {
        assert_eq!(
            derive_session_base_name("/Users/hr/\u{30d7}\u{30ed}\u{30b8}\u{30a7}\u{30af}\u{30c8}"),
            "\u{30d7}\u{30ed}\u{30b8}\u{30a7}\u{30af}\u{30c8}"
        );
    }

    // ── format_session_name edge cases ──

    #[test]
    fn format_name_empty_base() {
        assert_eq!(format_session_name("", 0), "");
        assert_eq!(format_session_name("", 1), " 2");
    }

    #[test]
    fn format_name_large_count() {
        assert_eq!(format_session_name("app", 99), "app 100");
    }

    #[test]
    fn format_name_base_with_existing_number() {
        // If the base already ends with a number, it still appends
        assert_eq!(format_session_name("app 2", 1), "app 2 2");
    }

    // ── session_mode_to_cli exhaustive coverage ──

    #[test]
    fn mode_to_cli_roundtrip_consistency() {
        // Verify all modes map to distinct CLI strings.
        let modes = [
            SessionMode::Normal,
            SessionMode::AutoAccept,
            SessionMode::Plan,
            SessionMode::Auto,
            SessionMode::DontAsk,
            SessionMode::BypassPermissions,
        ];
        let cli_strings: Vec<&str> = modes.iter().copied().map(session_mode_to_cli).collect();
        let unique: std::collections::HashSet<&&str> = cli_strings.iter().collect();
        assert_eq!(
            unique.len(),
            modes.len(),
            "All session modes must map to distinct CLI strings",
        );
    }

    #[test]
    fn mode_to_cli_and_back_is_identity() {
        // Round-trip: SessionMode → CLI string → classify_permission_mode.
        use crate::agents::claude_code::message_router::classify_permission_mode;
        for mode in [
            SessionMode::Normal,
            SessionMode::AutoAccept,
            SessionMode::Plan,
            SessionMode::Auto,
            SessionMode::DontAsk,
            SessionMode::BypassPermissions,
        ] {
            let cli = session_mode_to_cli(mode);
            let roundtripped = classify_permission_mode(cli);
            assert_eq!(
                roundtripped, mode,
                "Round-trip failed for {:?} → {:?} → {:?}",
                mode, cli, roundtripped,
            );
        }
    }

    // ── SessionMessagePayload edge cases ──

    #[test]
    fn session_message_payload_without_thinking() {
        let payload = SessionMessagePayload {
            id: "msg-2".to_string(),
            role: "assistant".to_string(),
            content: "Response".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            thinking_content: None,
            sort_order: 1,
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert!(json["thinkingContent"].is_null());
        let restored: SessionMessagePayload = serde_json::from_value(json).unwrap();
        assert!(restored.thinking_content.is_none());
    }
}
