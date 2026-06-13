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
    /// Which agent adapter the session ran under. Required so the recovery
    /// path can rehydrate the right agent_id on the restored `Session` —
    /// without it, `StuckActivityBanner` and other agent-aware UI would
    /// mislabel recovered sessions.
    pub agent_id: String,
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

/// How often the Recall harvest watcher polls git HEAD for new commits.
/// 30s harvest lag is acceptable for a memory layer (see `git_watcher`).
const HARVEST_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

/// Start (or refcount-bump) the Recall harvest watcher for a project when
/// a session opens. Reads the live settings, applies the Recall gate, and
/// delegates to the unit-testable `start_harvest_watcher`. Never fails or
/// blocks session creation — any error is logged and swallowed.
async fn ensure_harvest_watcher(state: &AppState, project_path: &str) {
    let settings = crate::commands::settings::get_settings().unwrap_or_default();
    if !settings.recall.enabled || settings.recall.mode == crate::recall::config::RecallMode::Off {
        return;
    }
    let api_key = settings
        .api_keys
        .get(settings.recall.harvester_key_id())
        .cloned()
        .unwrap_or_default();
    let mut watchers = state.harvest_watchers.lock().await;
    crate::recall::harvester::git_watcher::start_harvest_watcher(
        &mut watchers,
        state.database.clone(),
        project_path,
        &settings.recall,
        api_key,
        settings.model_pricing.clone(),
        HARVEST_POLL_INTERVAL,
    );
}

/// Release one session's hold on a project's harvest watcher when the
/// session closes; cancels the watcher when the last session for the
/// project is gone.
async fn release_harvest_watcher(state: &AppState, project_path: &str) {
    let mut watchers = state.harvest_watchers.lock().await;
    crate::recall::harvester::git_watcher::stop_harvest_watcher(&mut watchers, project_path);
}

#[tauri::command]
pub async fn create_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    project_path: String,
    name: Option<String>,
    resume_cli_session_id: Option<String>,
    // Phase 2 §5: optional agent picker. `None` keeps the v1.2.0 default
    // (`claude_code`) so existing frontend callers compile unchanged.
    agent_id: Option<AgentId>,
) -> Result<SessionInfo, String> {
    let session_id = Uuid::new_v4().to_string();
    let agent_id = agent_id.unwrap_or(AgentId::ClaudeCode);

    log::info!(
        "[create_session] received agent={:?} name={:?} project_path={:?} resume_cli_session_id={:?}",
        agent_id, name, project_path, resume_cli_session_id
    );

    // Adapter lookup happens first so we fail fast with a clear error
    // (and don't write a session row that the adapter can't honour).
    let adapter = registry::get(agent_id)
        .ok_or_else(|| format!("{agent_id:?} adapter not registered"))?;
    // Each adapter handles its own binary discovery + auth probe.
    let binary = adapter.detect_binary().await.map_err(|e| e.to_string())?;

    let session_name = if let Some(n) = name {
        log::info!("[create_session] using provided name={:?}", n);
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
        let derived = format_session_name(&base, existing_count);
        log::info!(
            "[create_session] no name provided — derived={:?} base={:?} existing_count={}",
            derived, base, existing_count
        );
        derived
    };

    let icon_index = state.database.get_next_icon_index().unwrap_or(0);

    let session_info = SessionInfo {
        id: session_id.clone(),
        agent_id,
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

    // Persist to SQLite (agent_id stamped so crash recovery knows which
    // adapter to dispatch to on next launch).
    if let Err(e) = state.database.insert_session(
        &session_info.id,
        &session_info.name,
        &session_info.project_path,
        "starting",
        &session_info.created_at.to_rfc3339(),
        None,
        session_info.icon_index,
        agent_id.as_str(),
    ) {
        log::error!("Failed to persist session to database: {}", e);
    }

    // Crash-recovery flag: this session is now open. Cleared on close or graceful exit;
    // anything still set on next launch indicates the prior shutdown was unclean.
    if let Err(e) = state.database.set_session_was_open(&session_info.id, true) {
        log::warn!("Failed to set was_open flag: {}", e);
    }

    // Resume sessions: persist the inbound `resume_cli_session_id` immediately
    // so the row is recoverable BEFORE the CLI's first System/init reaches us.
    // Without this, a crash between spawn and the init event would leave the
    // sessions row with cli_session_id=NULL forever — and the Resume Session
    // tab filters on `cli_session_id IS NOT NULL`, so the session becomes
    // invisible despite its messages being preserved. Regression for the
    // "Spec-Forge 4 lost after dev crash" incident (2026-05-26).
    //
    // The CLI may report a different cli_session_id back in its init event
    // (especially on resume — Claude can mint a fresh forked id); the normal
    // message-router path will overwrite this value if so, which is fine.
    // What we MUST avoid is leaving the row unmarked when we already know the
    // resume token.
    if let Some(ref resume_id) = resume_cli_session_id {
        if let Err(e) = state.database.set_cli_session_id(&session_info.id, resume_id) {
            log::warn!(
                "[create_session] Failed to persist resume cli_session_id for {}: {} \
                 (session will still spawn but may not surface in Resume on next crash)",
                session_info.id, e
            );
        } else {
            log::info!(
                "[create_session] Persisted resume cli_session_id={} for new session {}",
                resume_id, session_info.id
            );
        }
    }

    // Get approval server port (Claude only — Codex ignores this).
    let approval_port = {
        let port = state.approval_server_port.lock().await;
        *port
    };

    let effort_override = state.thinking_effort_override(&project_path).await;

    let handle = adapter
        .spawn_session(
            app_handle,
            &binary,
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

    // Start the Recall harvest watcher for this project (no-op when Recall
    // is disabled or a watcher is already running for the project).
    ensure_harvest_watcher(&state, &project_path).await;

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
    // Crash-recovery branching: read agent_id off the SessionInfo we
    // restored from SQLite, then route to the right adapter. `cli_session_id`
    // is the adapter-defined resume token (CLI session UUID for Claude;
    // thread id `thr_…` for Codex).
    let (project_path, session_name, agent_id) = {
        let sessions = state.sessions.lock().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        (
            session.project_path.clone(),
            session.name.clone(),
            session.agent_id,
        )
    };

    let adapter = registry::get(agent_id)
        .ok_or_else(|| format!("{agent_id:?} adapter not registered"))?;
    let binary = adapter.detect_binary().await.map_err(|e| e.to_string())?;

    // Resolve the resume token with a 3-tier fallback:
    //   1. frontend-provided arg
    //   2. in-memory AppState map (live session, e.g. wake recovery)
    //   3. SQLite row (the ONLY place it survives a hard crash/restart —
    //      the in-memory map is empty after relaunch, so without this
    //      Codex/Claude sessions couldn't be resumed cold).
    let effective_cli_session_id = match &cli_session_id {
        Some(id) => Some(id.clone()),
        None => {
            let from_mem = {
                let cli_ids = state.cli_session_ids.lock().await;
                cli_ids.get(&session_id).cloned()
            };
            match from_mem {
                Some(id) => Some(id),
                None => state.database.get_cli_session_id(&session_id).unwrap_or_else(|e| {
                    log::warn!(
                        "[resume_session_process] DB cli_session_id lookup failed for {}: {}",
                        session_id, e
                    );
                    None
                }),
            }
        }
    };

    let approval_port = {
        let port = state.approval_server_port.lock().await;
        *port
    };
    let effort_override = state.thinking_effort_override(&project_path).await;

    let handle = adapter
        .spawn_session(
            app_handle,
            &binary,
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

    // Recall enrichment (Phase 2). No-op when `recall.enabled = false`
    // (default). On any failure inside the enricher we ship the
    // original prompt verbatim — see `enrich_if_enabled` for the
    // mode-dependent policy.
    let final_prompt = {
        let project_path = {
            let sessions = state.sessions.lock().await;
            sessions
                .get(&session_id)
                .map(|s| s.project_path.clone())
        };
        match project_path {
            Some(project) => {
                let settings = crate::commands::settings::get_settings().unwrap_or_default();
                if settings.recall.enabled && settings.recall.mode != crate::recall::config::RecallMode::Off {
                    let api_key = settings
                        .api_keys
                        .get(settings.recall.enricher_key_id())
                        .cloned()
                        .unwrap_or_default();
                    let pricing = settings.model_pricing.clone();
                    let llm = crate::recall::llm_client::RealLlmClient::new(pricing.clone());
                    crate::recall::enricher::enrich_if_enabled(
                        &state.database,
                        &settings.recall,
                        &api_key,
                        &pricing,
                        &llm,
                        std::path::Path::new(&project),
                        &prompt,
                        Some(&session_id),
                    )
                    .await
                } else {
                    prompt.clone()
                }
            }
            None => prompt.clone(),
        }
    };

    process
        .send_user_message(&final_prompt)
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

// `rename_all = "camelCase"` makes Tauri rename the Rust `request_id` arg
// to `requestId` for IPC matching, accepting the frontend's camelCase
// payload. v1.3.1: a Codex approval flow was getting "invalid args
// `requestId`" without this — the default arg-name policy in this
// Tauri version doesn't auto-convert. Being explicit removes the
// ambiguity.
#[tauri::command(rename_all = "camelCase")]
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

    // Try Claude's HTTP approval server first — that's the v1.2.0 path
    // and it knows for certain when a request_id is its own. If it
    // returns false we fall through to per-Codex-session lookup.
    let resolved = state
        .approval_state
        .resolve(&request_id, approved, reason)
        .await;
    if resolved {
        return Ok(());
    }

    // Codex sessions register request_ids in their own per-session
    // pending_server_requests map. We don't track which session owns
    // which uuid at the AppState level (Phase 2 §3.1 #3: kept session-
    // local) — so probe every active handle. A given uuid resolves on
    // at most one session.
    let processes = state.processes.lock().await;
    for (sid, handle) in processes.iter() {
        if handle.agent_id() != AgentId::Codex {
            continue;
        }
        match handle.respond_to_approval(&request_id, approved, None).await {
            Ok(true) => {
                info!(
                    "[resolve_tool_approval] resolved on Codex session {}",
                    sid
                );
                return Ok(());
            }
            Ok(false) => continue,
            Err(e) => {
                log::warn!(
                    "[resolve_tool_approval] Codex session {} respond_to_approval errored: {}",
                    sid, e
                );
            }
        }
    }

    Err(format!(
        "No pending approval found for request_id: {}",
        request_id
    ))
}

/// Apply a Codex sandbox + approval policy to a live session. Takes effect
/// on the next `turn/start`. Spec §6.1 / §14 Session 5: the Policy pill
/// calls this from the frontend instead of `set_session_mode` when the
/// active session's agent is Codex.
#[tauri::command]
pub async fn set_codex_policy(
    state: State<'_, AppState>,
    session_id: String,
    policy: crate::agents::CodexSessionPolicy,
) -> Result<(), String> {
    info!(
        "[set_codex_policy] session_id={} sandbox={:?} approval={:?} network={}",
        session_id, policy.sandbox, policy.approval, policy.network_access
    );
    let processes = state.processes.lock().await;
    let handle = processes
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    if handle.agent_id() != AgentId::Codex {
        return Err(format!(
            "set_codex_policy is only valid on Codex sessions; \
             session {session_id} is {:?}",
            handle.agent_id()
        ));
    }
    handle
        .set_codex_policy(policy)
        .await
        .map_err(|e| e.to_string())
}

/// Toggle CodeMantis-native Codex "plan mode" on a live session. Takes effect
/// on the next `turn/start` (read-only sandbox + planning preamble). The Plan
/// pill in the Codex toolbar calls this. Codex-only — Claude has real plan
/// mode via `set_session_mode`.
#[tauri::command]
pub async fn set_codex_plan_mode(
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> Result<(), String> {
    info!("[set_codex_plan_mode] session_id={session_id} enabled={enabled}");
    let processes = state.processes.lock().await;
    let handle = processes
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    if handle.agent_id() != AgentId::Codex {
        return Err(format!(
            "set_codex_plan_mode is only valid on Codex sessions; \
             session {session_id} is {:?}",
            handle.agent_id()
        ));
    }
    handle
        .set_codex_plan_mode(enabled)
        .await
        .map_err(|e| e.to_string())
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
#[tauri::command(rename_all = "camelCase")]
pub async fn submit_question_answer(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
    answer: String,
    // Optional Codex-only payload (v1.4.1 Phase A.5). The QuestionModal
    // passes a `Record<questionId, string[]>` map when the
    // PendingQuestion came from Codex's `item/tool/requestUserInput`.
    // Claude sessions leave this `None` and the existing chat-message
    // injection path runs.
    structured_answers: Option<serde_json::Value>,
) -> Result<(), String> {
    info!(
        "[submit_question_answer] session_id={}, request_id={}, answer_len={}, has_structured={}",
        session_id,
        request_id,
        answer.len(),
        structured_answers.is_some(),
    );

    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()).to_string())?;
    if !process.is_running() {
        return Err(AppError::ProcessNotRunning(session_id).to_string());
    }

    // Codex path: structured answers reach Codex via the JSON-RPC
    // response on the pending server request. The CodexProcessHandle's
    // `respond_to_approval` looks up the registered ServerRequestKind
    // by request_id; for `ToolRequestUserInput` it builds the
    // `{ answers: { [id]: { answers: [...] } } }` shape via
    // approvals.rs::build_response.
    if let Some(answers) = structured_answers {
        // Wrap each answer array in the per-question
        // `{ answers: string[] }` envelope the Codex schema requires.
        // The frontend sends `Record<id, string[]>`; we lift each into
        // `{ [id]: { answers: string[] } }`.
        let wrapped = if let serde_json::Value::Object(map) = &answers {
            let mut out = serde_json::Map::new();
            for (id, arr) in map {
                out.insert(id.clone(), serde_json::json!({ "answers": arr }));
            }
            serde_json::Value::Object(out)
        } else {
            answers
        };
        match process
            .respond_to_approval(&request_id, true, Some(wrapped))
            .await
        {
            Ok(true) => return Ok(()),
            Ok(false) => {
                warn!(
                    "[submit_question_answer] structured-answer request_id={} not on Codex handle — falling through to Claude path",
                    request_id
                );
                // Fall through: maybe a Claude session was misclassified.
            }
            Err(e) => {
                return Err(format!("respond_to_approval failed: {e}"));
            }
        }
    }

    // Claude path — original behaviour. Step 1: release the
    // still-blocked PreToolUse hook so the CLI can continue its turn.
    // Step 2: inject the answer as a regular user message.
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
    let (model, project_path) = {
        let sessions = state.sessions.lock().await;
        match sessions.get(&session_id) {
            Some(s) => (s.model.clone(), Some(s.project_path.clone())),
            None => (None, None),
        }
    };

    // Release this session's hold on the project's harvest watcher.
    if let Some(project) = project_path.as_deref() {
        release_harvest_watcher(&state, project).await;
    }

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
                agent_id: session.agent_id,
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
                agent_id: session.agent_id,
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
///
/// Empty placeholders (`has_stored_messages=false`) are also skipped and have
/// their `was_open` flag cleared inline — they contribute nothing to recovery
/// and previously polluted the Resume list once auto-ack promoted them to
/// `status='closed'`.
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
        if !session.has_stored_messages {
            // Empty placeholder — never used. Clear was_open so it doesn't
            // keep surfacing on every restart, but DO NOT promote to 'closed'
            // (that would put it in the Resume list).
            if let Err(e) = state.database.set_session_was_open(&session.id, false) {
                log::warn!(
                    "[list_crashed_sessions] failed to clear was_open for empty placeholder {}: {}",
                    session.id, e
                );
            } else {
                log::info!(
                    "[list_crashed_sessions] skipping + cleaning empty placeholder id={} name={:?}",
                    session.id, session.name
                );
            }
            continue;
        }

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
            log::info!(
                "[list_crashed_sessions] entry id={} name={:?} project_path={:?} cli_session_id={} has_stored_messages={}",
                session.id, session.name, session.project_path, cli_sid, session.has_stored_messages
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
                agent_id: session.agent_id,
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
    // Stagger closed_at by 1ms per entry so the Resume list (which orders by
    // closed_at DESC) has a stable, predictable order even when the entire
    // batch is acknowledged in one tick. Without this, every row received the
    // same RFC3339 second and SQLite's natural row order broke the tie —
    // interleaving real sessions with empty placeholders unpredictably.
    let base = Utc::now();
    for (i, id) in session_ids.iter().enumerate() {
        let ts = (base + chrono::Duration::milliseconds(i as i64)).to_rfc3339();
        match state.database.mark_session_closed_if_stale(id, &ts) {
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

/// Read-once: returns `true` if the wake observer set the recovery flag
/// before its last-resort `WebviewWindow::reload()`, then clears it. The
/// frontend calls this exactly once during boot to decide between the
/// crashed-sessions Resume flow and the re-attach-live-sessions flow.
///
/// `swap` is `SeqCst` so a second caller during the same boot will
/// observe `false` — re-attach happens once per reload, full stop.
#[tauri::command]
pub fn consume_wake_recovery_flag(state: State<'_, AppState>) -> bool {
    state
        .wake_recovery_reload
        .swap(false, std::sync::atomic::Ordering::SeqCst)
}

/// Returns the `SessionInfo` for every session whose CLI subprocess is
/// **still alive** in `AppState.processes`. Used post-wake-recovery-reload
/// so the frontend can re-attach event listeners (events are session-id
/// keyed via `claude-chat-<id>` / `codex-chat-<id>`) without re-spawning
/// the CLI via `--resume`.
///
/// Sessions whose entry exists in `processes` but whose `is_running()`
/// returns `false` (process crashed while we weren't watching) are
/// filtered out — the caller will pick them up via `list_crashed_sessions`
/// instead.
#[tauri::command]
pub async fn list_live_sessions(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, String> {
    let processes = state.processes.lock().await;
    let live_ids: Vec<String> = processes
        .iter()
        .filter_map(|(id, p)| if p.is_running() { Some(id.clone()) } else { None })
        .collect();
    drop(processes);

    let sessions = state.sessions.lock().await;
    let mut out: Vec<SessionInfo> = Vec::with_capacity(live_ids.len());
    for id in live_ids {
        if let Some(info) = sessions.get(&id) {
            out.push(info.clone());
        }
    }
    Ok(out)
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

/// Update the reasoning effort for a live session.
/// For Codex sessions, applies on the next turn (mutex update + emit).
/// For Claude sessions, returns an error — Claude's `--effort` is
/// spawn-time only. The frontend's EffortSelector handles Claude via
/// pause + resume (config-rebuild path) and only invokes this command
/// for Codex sessions.
#[tauri::command(rename_all = "camelCase")]
pub async fn set_session_effort(
    state: State<'_, AppState>,
    session_id: String,
    effort: String,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    process
        .set_effort(effort)
        .await
        .map_err(|e| e.to_string())
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
    // Phase 2 §10.1: SpecWriter is capability-dispatched. `None` picks the
    // historic Claude path; passing `Codex` routes through the ephemeral
    // AGENTS.override.md strategy (spec §2.5). Both adapters carry the
    // system prompt via `SessionConfig.append_system_prompt`; the Codex
    // adapter translates it into AGENTS.override.md inside spawn_session.
    agent_id: Option<AgentId>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let agent_id = agent_id.unwrap_or(AgentId::ClaudeCode);

    let adapter = registry::get(agent_id)
        .ok_or_else(|| format!("{agent_id:?} adapter not registered"))?;
    // Capability gate: either adapter must offer *some* way to inject a
    // system prompt. Phase 2 §10.1 — Claude via --append-system-prompt,
    // Codex via AGENTS.override.md. If neither, refuse rather than spawn
    // a session that ignores the SpecWriter prompt.
    let caps = adapter.capabilities();
    if !caps.supports_append_system_prompt && !caps.supports_project_doc_injection {
        return Err(format!(
            "{agent_id:?} cannot host a SpecWriter session — neither \
             append_system_prompt nor project_doc_injection is supported"
        ));
    }
    let binary = adapter.detect_binary().await.map_err(|e| e.to_string())?;

    let approval_port = {
        let port = state.approval_server_port.lock().await;
        *port
    };

    let handle = adapter
        .spawn_session(
            app_handle,
            &binary,
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
            agent_id: "claude_code".to_string(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["session_id"], "abc-123");
        assert_eq!(json["name"], "Test Session");
        assert_eq!(json["project_path"], "/Users/hr/proj");
        assert_eq!(json["model"], "claude-sonnet-4-6");
        assert_eq!(json["icon_index"], 3);
        assert_eq!(json["recent_headlines"].as_array().unwrap().len(), 2);
        assert_eq!(json["has_stored_messages"], true);
        assert_eq!(json["agent_id"], "claude_code");
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
            agent_id: "codex".to_string(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert!(json["model"].is_null());
        assert!(json["recent_headlines"].as_array().unwrap().is_empty());
        assert_eq!(json["has_stored_messages"], false);
        assert_eq!(json["agent_id"], "codex");
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
