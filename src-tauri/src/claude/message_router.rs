use crate::claude::event_types::{ContentBlock, FrontendEvent, RawStreamEvent, RateLimitInfo, StreamDelta};
use crate::claude::session::{AppState, ControlRequestKind, SessionMode};
use log::{debug, info, warn};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

/// Tracks a tool_use content block as its input is streamed via InputJsonDelta.
struct PendingToolBlock {
    id: String,
    name: String,
    input_json: String,
}

// ── Pure helper functions (testable without AppHandle) ──

/// Map a CLI permissionMode string to our SessionMode enum.
pub(crate) fn classify_permission_mode(cli_perm_mode: &str) -> SessionMode {
    match cli_perm_mode {
        "plan" => SessionMode::Plan,
        "acceptEdits" => SessionMode::AutoAccept,
        _ => SessionMode::Normal,
    }
}

/// Extract model name, contextWindow, and maxOutputTokens from the CLI's modelUsage blob.
pub(crate) fn extract_model_usage_info(
    model_usage: &Option<serde_json::Value>,
) -> (Option<String>, Option<u64>, Option<u64>) {
    model_usage
        .as_ref()
        .and_then(|mu| mu.as_object())
        .and_then(|obj| {
            obj.iter().next().map(|(key, val)| (key.clone(), val.as_object()))
        })
        .map(|(name, entry_opt)| {
            let (cw, mot) = entry_opt
                .map(|entry| {
                    let cw = entry.get("contextWindow").and_then(|v| v.as_u64());
                    let mot = entry.get("maxOutputTokens").and_then(|v| v.as_u64());
                    (cw, mot)
                })
                .unwrap_or((None, None));
            (Some(name), cw, mot)
        })
        .unwrap_or((None, None, None))
}

/// Extract thinking effort from the extra fields of a system init event.
/// Checks three possible locations: `extra.thinking.effort`, `extra.effort`, `extra.thinking_effort`.
pub(crate) fn extract_thinking_effort(extra: &serde_json::Value) -> Option<String> {
    extra
        .get("thinking")
        .and_then(|v| v.get("effort"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            extra.get("effort").and_then(|v| v.as_str()).map(|s| s.to_string())
        })
        .or_else(|| {
            extra.get("thinking_effort").and_then(|v| v.as_str()).map(|s| s.to_string())
        })
}

/// Convert a tool result content value to a string representation.
pub(crate) fn tool_result_content_to_string(content: &Option<serde_json::Value>) -> Option<String> {
    content.as_ref().map(|c| match c {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

/// Determine whether a rate_limit_event should trigger a frontend warning.
pub(crate) fn should_emit_rate_limit_warning(info: &RateLimitInfo) -> bool {
    let utilization = info.utilization.unwrap_or(0.0);
    utilization > 0.7 || info.status.as_deref() == Some("allowed_warning")
}

/// Helper: update the model stored in a session's SessionInfo.
async fn update_session_model(app_handle: &AppHandle, session_id: &str, model: &str) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        let mut sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.model = Some(model.to_string());
        }
    }
}

/// Helper: store the CLI-reported session_id in AppState.
async fn store_cli_session_id(app_handle: &AppHandle, session_id: &str, cli_sid: &str) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        let mut cli_ids = state.cli_session_ids.lock().await;
        cli_ids.insert(session_id.to_string(), cli_sid.to_string());
    }
}

/// Helper: sync the CLI permission mode to AppState and emit if changed.
async fn sync_session_mode(
    app_handle: &AppHandle,
    session_id: &str,
    cli_perm_mode: &str,
) {
    let new_mode = classify_permission_mode(cli_perm_mode);
    if let Some(state) = app_handle.try_state::<AppState>() {
        let mut modes = state.session_modes.lock().await;
        if modes.get(session_id) != Some(&new_mode) {
            info!(
                "[message_router] System init: syncing permissionMode '{}' → {:?} for session {}",
                cli_perm_mode, new_mode, session_id
            );
            modes.insert(session_id.to_string(), new_mode.clone());
            drop(modes);
            if let Err(e) = app_handle.emit(
                "session-mode-changed",
                serde_json::json!({
                    "sessionId": session_id,
                    "mode": new_mode
                }),
            ) {
                warn!("[message-router] Failed to emit session-mode-changed: {}", e);
            }
        }
    }
}

// ── Mutable state threaded through the event loop ──

struct RouterState {
    accumulated_text: String,
    cli_session_id_emitted: bool,
    emitted_tool_ids: std::collections::HashSet<String>,
    pending_tools: HashMap<u32, PendingToolBlock>,
}

// ── Emit helper to reduce boilerplate ──

fn emit_or_warn(app_handle: &AppHandle, channel: &str, event: &FrontendEvent, label: &str) {
    if let Err(e) = app_handle.emit(channel, event) {
        warn!("[message-router] Failed to emit {}: {}", label, e);
    }
}

/// Helper: emit CliSessionId if not yet emitted, and store in AppState.
async fn maybe_emit_cli_session_id(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    cli_sid: &str,
    state: &mut RouterState,
) {
    if !state.cli_session_id_emitted {
        state.cli_session_id_emitted = true;
        store_cli_session_id(app_handle, session_id, cli_sid).await;
        let fe = FrontendEvent::CliSessionId {
            session_id: session_id.to_string(),
            cli_session_id: cli_sid.to_string(),
        };
        emit_or_warn(app_handle, chat_event, &fe, "cli-session-id");
    }
}

// ── Extracted handler functions ──

async fn handle_system_init(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    model: &Option<String>,
    cli_sid: &Option<String>,
    extra: &serde_json::Value,
    state: &mut RouterState,
) {
    debug!("System init extra fields: {}", extra);

    if let Some(model_name) = model {
        update_session_model(app_handle, session_id, model_name).await;
    }

    let thinking_effort = extract_thinking_effort(extra);
    let fe = FrontendEvent::SessionInit {
        session_id: session_id.to_string(),
        model: model.clone(),
        thinking_effort,
    };
    emit_or_warn(app_handle, chat_event, &fe, "session-init");

    if let Some(sid) = cli_sid {
        maybe_emit_cli_session_id(app_handle, session_id, chat_event, sid, state).await;
    }

    if let Some(cli_perm_mode) = extra.get("permissionMode").and_then(|v| v.as_str()) {
        sync_session_mode(app_handle, session_id, cli_perm_mode).await;
    }
}

fn handle_assistant_message(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    activity_event: &str,
    content_blocks: &[ContentBlock],
    state: &mut RouterState,
) {
    for block in content_blocks {
        match block {
            ContentBlock::Text { text } => {
                state.accumulated_text.clone_from(text);
                let fe = FrontendEvent::TextComplete {
                    session_id: session_id.to_string(),
                    full_text: text.clone(),
                };
                emit_or_warn(app_handle, chat_event, &fe, "text-complete");
            }
            ContentBlock::ToolUse { id, name, input } => {
                let is_pending = state.pending_tools.values().any(|p| p.id == *id);
                if !is_pending && state.emitted_tool_ids.insert(id.clone()) {
                    let fe = FrontendEvent::ToolUseStart {
                        session_id: session_id.to_string(),
                        tool_use_id: id.clone(),
                        tool_name: name.clone(),
                        tool_input: input.clone(),
                    };
                    emit_or_warn(app_handle, activity_event, &fe, "tool-use-start");
                }
            }
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                let content_str = tool_result_content_to_string(content);
                let fe = FrontendEvent::ToolResult {
                    session_id: session_id.to_string(),
                    tool_use_id: tool_use_id.clone(),
                    content: content_str,
                    is_error: is_error.unwrap_or(false),
                };
                emit_or_warn(app_handle, activity_event, &fe, "tool-result");
            }
            ContentBlock::Thinking { .. } => {}
            ContentBlock::Unknown => {
                debug!("Unknown content block type");
            }
        }
    }
}

fn handle_content_block_delta(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    index: Option<u32>,
    delta: Option<StreamDelta>,
    state: &mut RouterState,
) {
    match delta {
        Some(StreamDelta::TextDelta { text }) => {
            state.accumulated_text.push_str(&text);
            let fe = FrontendEvent::TextDelta {
                session_id: session_id.to_string(),
                text,
            };
            emit_or_warn(app_handle, chat_event, &fe, "text-delta");
        }
        Some(StreamDelta::InputJsonDelta { partial_json }) => {
            if let (Some(idx), Some(fragment)) = (index, partial_json) {
                if let Some(pending) = state.pending_tools.get_mut(&idx) {
                    pending.input_json.push_str(&fragment);
                }
            }
        }
        _ => {}
    }
}

fn handle_content_block_start(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    activity_event: &str,
    index: Option<u32>,
    content_block: Option<ContentBlock>,
    state: &mut RouterState,
) {
    if let Some(block) = content_block {
        match block {
            ContentBlock::ToolUse { id, name, .. } => {
                if let Some(idx) = index {
                    if name == "Agent" {
                        let fe = FrontendEvent::AgentPreparing {
                            session_id: session_id.to_string(),
                            tool_use_id: id.clone(),
                        };
                        emit_or_warn(app_handle, activity_event, &fe, "agent-preparing");
                    }
                    state.pending_tools.insert(idx, PendingToolBlock {
                        id,
                        name,
                        input_json: String::new(),
                    });
                }
            }
            ContentBlock::Text { text } => {
                if !text.is_empty() {
                    state.accumulated_text.push_str(&text);
                    let fe = FrontendEvent::TextDelta {
                        session_id: session_id.to_string(),
                        text,
                    };
                    emit_or_warn(app_handle, chat_event, &fe, "text-delta");
                }
            }
            _ => {}
        }
    }
}

fn handle_content_block_stop(
    app_handle: &AppHandle,
    session_id: &str,
    activity_event: &str,
    index: Option<u32>,
    state: &mut RouterState,
) {
    if let Some(idx) = index {
        if let Some(pending) = state.pending_tools.remove(&idx) {
            let input = serde_json::from_str(&pending.input_json)
                .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
            if state.emitted_tool_ids.insert(pending.id.clone()) {
                let fe = FrontendEvent::ToolUseStart {
                    session_id: session_id.to_string(),
                    tool_use_id: pending.id,
                    tool_name: pending.name,
                    tool_input: input,
                };
                emit_or_warn(app_handle, activity_event, &fe, "tool-use-start");
            }
        }
    }
}

async fn handle_result(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    cli_sid: &Option<String>,
    is_error: Option<bool>,
    result: Option<String>,
    duration_ms: Option<u64>,
    usage: Option<crate::claude::event_types::UsageInfo>,
    cost_usd: Option<f64>,
    duration_api_ms: Option<u64>,
    num_turns: Option<u32>,
    stop_reason: Option<String>,
    model_usage: &Option<serde_json::Value>,
    state: &mut RouterState,
) {
    if let Some(sid) = cli_sid {
        maybe_emit_cli_session_id(app_handle, session_id, chat_event, sid, state).await;
    }

    if is_error == Some(true) {
        let error_msg = result.unwrap_or_else(|| "Unknown error".to_string());
        let fe = FrontendEvent::ProcessError {
            session_id: session_id.to_string(),
            error: error_msg,
        };
        emit_or_warn(app_handle, chat_event, &fe, "process-error");
    } else {
        let (model_name, context_window, max_output_tokens) =
            extract_model_usage_info(model_usage);

        let fe = FrontendEvent::TurnComplete {
            session_id: session_id.to_string(),
            duration_ms,
            usage,
            cost_usd,
            duration_api_ms,
            num_turns,
            stop_reason,
            model_name,
            context_window,
            max_output_tokens,
        };
        emit_or_warn(app_handle, chat_event, &fe, "turn-complete");
    }
    state.accumulated_text.clear();
}

fn handle_system_status(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    extra: &serde_json::Value,
) {
    let status = extra.get("status").and_then(|v| v.as_str());
    let is_compacting = status == Some("compacting");
    let fe = FrontendEvent::CompactingStatus {
        session_id: session_id.to_string(),
        is_compacting,
    };
    emit_or_warn(app_handle, chat_event, &fe, "compacting-status");
}

fn handle_system_compact_boundary(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    extra: &serde_json::Value,
) {
    let metadata = extra.get("compact_metadata");
    let trigger = metadata
        .and_then(|m| m.get("trigger"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let pre_tokens = metadata
        .and_then(|m| m.get("pre_tokens"))
        .and_then(|v| v.as_u64());
    let fe = FrontendEvent::CompactComplete {
        session_id: session_id.to_string(),
        trigger,
        pre_tokens,
    };
    emit_or_warn(app_handle, chat_event, &fe, "compact-complete");
}

fn handle_tool_progress(
    app_handle: &AppHandle,
    session_id: &str,
    activity_event: &str,
    tool_use_id: &Option<String>,
    tool_name: &Option<String>,
    elapsed_time_seconds: Option<f64>,
    extra: &serde_json::Value,
) {
    if let (Some(id), Some(name), Some(elapsed)) =
        (tool_use_id, tool_name, elapsed_time_seconds)
    {
        let fe = FrontendEvent::ToolProgress {
            session_id: session_id.to_string(),
            tool_use_id: id.clone(),
            tool_name: name.clone(),
            elapsed_seconds: elapsed,
        };
        emit_or_warn(app_handle, activity_event, &fe, "tool-progress");

        if name == "Agent" {
            let tool_count = extra.get("tool_count").and_then(|v| v.as_u64()).map(|v| v as u32);
            let token_count = extra.get("token_count").and_then(|v| v.as_u64()).map(|v| v as u32);
            if tool_count.is_some() || token_count.is_some() {
                let fe = FrontendEvent::SubAgentProgress {
                    session_id: session_id.to_string(),
                    tool_use_id: id.clone(),
                    tool_count,
                    token_count,
                    current_activity: None,
                };
                emit_or_warn(app_handle, activity_event, &fe, "sub-agent-progress");
            }
        }
    }
}

fn handle_rate_limit(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    rate_limit_info: Option<RateLimitInfo>,
) {
    if let Some(info) = rate_limit_info {
        let utilization = info.utilization.unwrap_or(0.0);
        if should_emit_rate_limit_warning(&info) {
            let fe = FrontendEvent::RateLimitWarning {
                session_id: session_id.to_string(),
                utilization,
                resets_at: info.resets_at,
                rate_limit_type: info.rate_limit_type,
                overage_status: info.overage_status,
                is_using_overage: info.is_using_overage,
            };
            emit_or_warn(app_handle, chat_event, &fe, "rate-limit-warning");
        }
    }
}

fn handle_system_task_lifecycle(
    app_handle: &AppHandle,
    session_id: &str,
    activity_event: &str,
    subtype: &str,
    extra: &serde_json::Value,
) {
    let tool_use_id = extra.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    debug!(
        "[message_router] {}: tool_use_id={}, extra_keys={:?}",
        subtype,
        tool_use_id,
        extra.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );

    match subtype {
        "task_started" => {
            let description = extra.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let subagent_type = extra.get("subagent_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let fe = FrontendEvent::SubAgentStarted {
                session_id: session_id.to_string(),
                tool_use_id,
                description,
                subagent_type,
            };
            emit_or_warn(app_handle, activity_event, &fe, "sub-agent-started");
        }
        "task_progress" => {
            let tool_count = extra.get("tool_count").and_then(|v| v.as_u64()).map(|v| v as u32);
            let token_count = extra.get("token_count").and_then(|v| v.as_u64()).map(|v| v as u32);
            let current_activity = extra.get("current_activity").and_then(|v| v.as_str()).map(|s| s.to_string());
            let fe = FrontendEvent::SubAgentProgress {
                session_id: session_id.to_string(),
                tool_use_id,
                tool_count,
                token_count,
                current_activity,
            };
            emit_or_warn(app_handle, activity_event, &fe, "sub-agent-progress");
        }
        "task_complete" => {
            let tool_count = extra.get("tool_count").and_then(|v| v.as_u64()).map(|v| v as u32);
            let token_count = extra.get("token_count").and_then(|v| v.as_u64()).map(|v| v as u32);
            let fe = FrontendEvent::SubAgentComplete {
                session_id: session_id.to_string(),
                tool_use_id,
                tool_count,
                token_count,
            };
            emit_or_warn(app_handle, activity_event, &fe, "sub-agent-complete");
        }
        _ => {}
    }
}

fn handle_message_delta(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    usage: Option<crate::claude::event_types::UsageInfo>,
) {
    if let Some(usage) = usage {
        let fe = FrontendEvent::UsageUpdate {
            session_id: session_id.to_string(),
            usage,
        };
        emit_or_warn(app_handle, chat_event, &fe, "usage-update");
    }
}

fn handle_user_event(
    app_handle: &AppHandle,
    session_id: &str,
    activity_event: &str,
    message: &Option<crate::claude::event_types::AssistantMessage>,
) {
    if let Some(msg) = message {
        if let Some(content_blocks) = &msg.content {
            for block in content_blocks {
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } = block
                {
                    let content_str = tool_result_content_to_string(content);
                    let fe = FrontendEvent::ToolResult {
                        session_id: session_id.to_string(),
                        tool_use_id: tool_use_id.clone(),
                        content: content_str,
                        is_error: is_error.unwrap_or(false),
                    };
                    emit_or_warn(app_handle, activity_event, &fe, "tool-result");
                }
            }
        }
    }
}

async fn handle_control_response(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    response: Option<serde_json::Value>,
) {
    if let Some(resp_val) = response {
        let subtype = resp_val.get("subtype").and_then(|v| v.as_str());
        let req_id = resp_val.get("request_id").and_then(|v| v.as_str());

        if let Some(request_id) = req_id {
            if let Some(app_state) = app_handle.try_state::<AppState>() {
                let kind = {
                    let mut pending = app_state.pending_control_requests.lock().await;
                    pending.remove(request_id)
                };

                let is_success = subtype == Some("success");
                let error_msg = resp_val
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                match kind {
                    Some((_, ControlRequestKind::Interrupt)) => {
                        let fe = FrontendEvent::InterruptResult {
                            session_id: session_id.to_string(),
                            success: is_success,
                            error: error_msg,
                        };
                        emit_or_warn(app_handle, chat_event, &fe, "interrupt-result");
                    }
                    Some((_, ControlRequestKind::SetModel(model))) => {
                        if is_success {
                            let mut sessions = app_state.sessions.lock().await;
                            if let Some(session) = sessions.get_mut(session_id) {
                                session.model = Some(model.clone());
                            }
                        }
                        let fe = FrontendEvent::ModelChanged {
                            session_id: session_id.to_string(),
                            model,
                            success: is_success,
                            error: error_msg,
                        };
                        emit_or_warn(app_handle, chat_event, &fe, "model-changed");
                    }
                    Some((_, ControlRequestKind::SetPermissionMode(mode))) => {
                        if is_success {
                            info!("[message_router] set_permission_mode '{}' succeeded", mode);
                        } else {
                            warn!(
                                "[message_router] set_permission_mode '{}' failed: {:?}",
                                mode, error_msg
                            );
                        }
                    }
                    Some((_, ControlRequestKind::Initialize)) => {
                        if is_success {
                            let caps = resp_val
                                .get("response")
                                .cloned()
                                .unwrap_or(serde_json::Value::Null);
                            let fe = FrontendEvent::CapabilitiesDiscovered {
                                session_id: session_id.to_string(),
                                models: caps.get("models").cloned().unwrap_or_default(),
                                commands: caps.get("commands").cloned().unwrap_or_default(),
                                agents: caps.get("agents").cloned().unwrap_or_default(),
                                account: caps.get("account").cloned().unwrap_or_default(),
                                output_styles: caps
                                    .get("available_output_styles")
                                    .cloned()
                                    .unwrap_or_default(),
                            };
                            emit_or_warn(app_handle, chat_event, &fe, "capabilities-discovered");
                        } else {
                            warn!(
                                "[message_router] initialize failed: {:?}",
                                error_msg
                            );
                        }
                    }
                    None => {
                        warn!(
                            "Control response for unknown request_id: {}",
                            request_id
                        );
                    }
                }
            }
        } else {
            debug!("Control response missing request_id");
        }
    }
}

// ── Main event router ──

pub async fn route_events(
    app_handle: AppHandle,
    session_id: String,
    mut receiver: mpsc::Receiver<RawStreamEvent>,
) {
    let chat_event = format!("claude-chat-{}", session_id);
    let activity_event = format!("claude-activity-{}", session_id);

    let mut state = RouterState {
        accumulated_text: String::new(),
        cli_session_id_emitted: false,
        emitted_tool_ids: std::collections::HashSet::new(),
        pending_tools: HashMap::new(),
    };

    while let Some(event) = receiver.recv().await {
        match event {
            RawStreamEvent::System {
                model,
                subtype,
                session_id: cli_sid,
                ref extra,
                ..
            } if subtype.as_deref() == Some("init") => {
                handle_system_init(
                    &app_handle, &session_id, &chat_event,
                    &model, &cli_sid, extra, &mut state,
                ).await;
            }

            RawStreamEvent::Assistant { message, .. } => {
                if let Some(content_blocks) = &message.content {
                    handle_assistant_message(
                        &app_handle, &session_id, &chat_event, &activity_event,
                        content_blocks, &mut state,
                    );
                }
            }

            RawStreamEvent::ContentBlockDelta { index, delta, .. } => {
                handle_content_block_delta(
                    &app_handle, &session_id, &chat_event,
                    index, delta, &mut state,
                );
            }

            RawStreamEvent::ContentBlockStart { index, content_block, .. } => {
                handle_content_block_start(
                    &app_handle, &session_id, &chat_event, &activity_event,
                    index, content_block, &mut state,
                );
            }

            RawStreamEvent::ContentBlockStop { index, .. } => {
                handle_content_block_stop(
                    &app_handle, &session_id, &activity_event,
                    index, &mut state,
                );
            }

            RawStreamEvent::Result {
                duration_ms,
                usage,
                cost_usd,
                is_error,
                result,
                session_id: cli_sid,
                num_turns,
                duration_api_ms,
                stop_reason,
                model_usage,
                ..
            } => {
                handle_result(
                    &app_handle, &session_id, &chat_event,
                    &cli_sid, is_error, result, duration_ms, usage, cost_usd,
                    duration_api_ms, num_turns, stop_reason, &model_usage,
                    &mut state,
                ).await;
            }

            RawStreamEvent::System {
                subtype,
                ref extra,
                ..
            } if subtype.as_deref() == Some("status") => {
                handle_system_status(&app_handle, &session_id, &chat_event, extra);
            }

            RawStreamEvent::System {
                subtype,
                ref extra,
                ..
            } if subtype.as_deref() == Some("compact_boundary") => {
                handle_system_compact_boundary(&app_handle, &session_id, &chat_event, extra);
            }

            RawStreamEvent::ToolProgress {
                tool_use_id,
                tool_name,
                elapsed_time_seconds,
                ref extra,
            } => {
                handle_tool_progress(
                    &app_handle, &session_id, &activity_event,
                    &tool_use_id, &tool_name, elapsed_time_seconds, extra,
                );
            }

            RawStreamEvent::RateLimitEvent { rate_limit_info, .. } => {
                handle_rate_limit(&app_handle, &session_id, &chat_event, rate_limit_info);
            }

            RawStreamEvent::System {
                subtype,
                ref extra,
                ..
            } if matches!(subtype.as_deref(), Some("task_started") | Some("task_progress") | Some("task_complete")) => {
                let sub = subtype.as_deref().unwrap_or("");
                handle_system_task_lifecycle(
                    &app_handle, &session_id, &activity_event, sub, extra,
                );
            }

            RawStreamEvent::System { subtype, ref extra, .. } => {
                info!(
                    "[message_router] Unhandled system event: subtype={:?}, keys={:?}",
                    subtype,
                    extra.as_object().map(|o| o.keys().collect::<Vec<_>>()).unwrap_or_default()
                );
            }

            RawStreamEvent::MessageDelta { usage, .. } => {
                handle_message_delta(&app_handle, &session_id, &chat_event, usage);
            }

            RawStreamEvent::MessageStart { .. }
            | RawStreamEvent::MessageStop { .. } => {}

            RawStreamEvent::User { message, .. } => {
                handle_user_event(&app_handle, &session_id, &activity_event, &message);
            }

            RawStreamEvent::ControlResponse { response, .. } => {
                handle_control_response(&app_handle, &session_id, &chat_event, response).await;
            }

            RawStreamEvent::Unknown => {
                debug!("Received unhandled event type (message_start/delta/stop)");
            }
        }
    }

    debug!("Message router: channel closed for session {}", session_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::event_types::{
        ContentBlock, RateLimitInfo, RawStreamEvent, StreamDelta,
    };
    use crate::claude::session::SessionMode;

    // ── classify_permission_mode ──

    #[test]
    fn classify_plan_mode() {
        assert_eq!(classify_permission_mode("plan"), SessionMode::Plan);
    }

    #[test]
    fn classify_accept_edits_mode() {
        assert_eq!(classify_permission_mode("acceptEdits"), SessionMode::AutoAccept);
    }

    #[test]
    fn classify_default_mode() {
        assert_eq!(classify_permission_mode("default"), SessionMode::Normal);
    }

    #[test]
    fn classify_unknown_mode_falls_back_to_normal() {
        assert_eq!(classify_permission_mode("some_future_mode"), SessionMode::Normal);
        assert_eq!(classify_permission_mode(""), SessionMode::Normal);
    }

    // ── extract_model_usage_info ──

    #[test]
    fn extract_model_usage_full_info() {
        let model_usage = Some(serde_json::json!({
            "claude-opus-4-6": {
                "contextWindow": 200000,
                "maxOutputTokens": 32000,
                "costUSD": 0.05,
                "inputTokens": 100,
                "outputTokens": 200
            }
        }));
        let (name, cw, mot) = extract_model_usage_info(&model_usage);
        assert_eq!(name.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(cw, Some(200000));
        assert_eq!(mot, Some(32000));
    }

    #[test]
    fn extract_model_usage_none() {
        let (name, cw, mot) = extract_model_usage_info(&None);
        assert!(name.is_none());
        assert!(cw.is_none());
        assert!(mot.is_none());
    }

    #[test]
    fn extract_model_usage_empty_object() {
        let model_usage = Some(serde_json::json!({}));
        let (name, cw, mot) = extract_model_usage_info(&model_usage);
        assert!(name.is_none());
        assert!(cw.is_none());
        assert!(mot.is_none());
    }

    #[test]
    fn extract_model_usage_missing_context_window() {
        let model_usage = Some(serde_json::json!({
            "sonnet": {
                "maxOutputTokens": 16000
            }
        }));
        let (name, cw, mot) = extract_model_usage_info(&model_usage);
        assert_eq!(name.as_deref(), Some("sonnet"));
        assert!(cw.is_none());
        assert_eq!(mot, Some(16000));
    }

    #[test]
    fn extract_model_usage_not_an_object() {
        let model_usage = Some(serde_json::json!("not an object"));
        let (name, cw, mot) = extract_model_usage_info(&model_usage);
        assert!(name.is_none());
        assert!(cw.is_none());
        assert!(mot.is_none());
    }

    // ── extract_thinking_effort ──

    #[test]
    fn extract_thinking_effort_nested() {
        let extra = serde_json::json!({
            "thinking": { "effort": "high" }
        });
        assert_eq!(extract_thinking_effort(&extra).as_deref(), Some("high"));
    }

    #[test]
    fn extract_thinking_effort_flat() {
        let extra = serde_json::json!({
            "effort": "medium"
        });
        assert_eq!(extract_thinking_effort(&extra).as_deref(), Some("medium"));
    }

    #[test]
    fn extract_thinking_effort_underscore_key() {
        let extra = serde_json::json!({
            "thinking_effort": "low"
        });
        assert_eq!(extract_thinking_effort(&extra).as_deref(), Some("low"));
    }

    #[test]
    fn extract_thinking_effort_priority_order() {
        // The nested `thinking.effort` should take priority
        let extra = serde_json::json!({
            "thinking": { "effort": "high" },
            "effort": "low",
            "thinking_effort": "medium"
        });
        assert_eq!(extract_thinking_effort(&extra).as_deref(), Some("high"));
    }

    #[test]
    fn extract_thinking_effort_none_when_missing() {
        let extra = serde_json::json!({});
        assert!(extract_thinking_effort(&extra).is_none());
    }

    // ── tool_result_content_to_string ──

    #[test]
    fn tool_result_content_string_value() {
        let content = Some(serde_json::Value::String("file contents here".to_string()));
        assert_eq!(
            tool_result_content_to_string(&content).as_deref(),
            Some("file contents here")
        );
    }

    #[test]
    fn tool_result_content_json_object() {
        let content = Some(serde_json::json!({"error": "not found"}));
        let result = tool_result_content_to_string(&content).unwrap();
        assert!(result.contains("error"));
        assert!(result.contains("not found"));
    }

    #[test]
    fn tool_result_content_none() {
        assert!(tool_result_content_to_string(&None).is_none());
    }

    #[test]
    fn tool_result_content_number() {
        let content = Some(serde_json::json!(42));
        assert_eq!(tool_result_content_to_string(&content).as_deref(), Some("42"));
    }

    #[test]
    fn tool_result_content_array() {
        let content = Some(serde_json::json!([1, 2, 3]));
        assert_eq!(tool_result_content_to_string(&content).as_deref(), Some("[1,2,3]"));
    }

    // ── should_emit_rate_limit_warning ──

    #[test]
    fn rate_limit_warning_on_high_utilization() {
        let info = RateLimitInfo {
            status: None,
            resets_at: None,
            utilization: Some(0.85),
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
        };
        assert!(should_emit_rate_limit_warning(&info));
    }

    #[test]
    fn rate_limit_warning_on_allowed_warning_status() {
        let info = RateLimitInfo {
            status: Some("allowed_warning".to_string()),
            resets_at: None,
            utilization: None, // utilization defaults to 0.0
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
        };
        assert!(should_emit_rate_limit_warning(&info));
    }

    #[test]
    fn rate_limit_no_warning_on_low_utilization() {
        let info = RateLimitInfo {
            status: Some("allowed".to_string()),
            resets_at: None,
            utilization: Some(0.3),
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
        };
        assert!(!should_emit_rate_limit_warning(&info));
    }

    #[test]
    fn rate_limit_no_warning_on_zero_utilization_no_status() {
        let info = RateLimitInfo {
            status: None,
            resets_at: None,
            utilization: Some(0.0),
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
        };
        assert!(!should_emit_rate_limit_warning(&info));
    }

    #[test]
    fn rate_limit_boundary_at_0_7() {
        // Exactly 0.7 should NOT trigger (> 0.7 required)
        let info = RateLimitInfo {
            status: None,
            resets_at: None,
            utilization: Some(0.7),
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
        };
        assert!(!should_emit_rate_limit_warning(&info));

        // Just above 0.7 should trigger
        let info_above = RateLimitInfo {
            utilization: Some(0.701),
            ..info
        };
        assert!(should_emit_rate_limit_warning(&info_above));
    }

    // ── Event deserialization → routing classification ──
    // These verify that real NDJSON payloads parse into the expected RawStreamEvent variants,
    // which is what determines which match arm in route_events handles them.

    #[test]
    fn system_init_event_routes_correctly() {
        let json = r#"{"type":"system","subtype":"init","model":"claude-sonnet-4-20250514","tools":[],"mcp_servers":[],"permissionMode":"plan"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, model, extra, .. } => {
                assert_eq!(subtype.as_deref(), Some("init"));
                assert_eq!(model.as_deref(), Some("claude-sonnet-4-20250514"));
                // permissionMode gets captured in extra via flatten
                assert_eq!(extra.get("permissionMode").and_then(|v| v.as_str()), Some("plan"));
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn assistant_text_event_routes_correctly() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello!"}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Assistant { message, .. } => {
                let blocks = message.content.as_ref().unwrap();
                assert_eq!(blocks.len(), 1);
                match &blocks[0] {
                    ContentBlock::Text { text } => assert_eq!(text, "Hello!"),
                    other => panic!("Expected Text block, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn assistant_tool_use_event_routes_correctly() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_abc","name":"Read","input":{"file_path":"main.rs"}}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Assistant { message, .. } => {
                let blocks = message.content.as_ref().unwrap();
                match &blocks[0] {
                    ContentBlock::ToolUse { id, name, input } => {
                        assert_eq!(id, "toolu_abc");
                        assert_eq!(name, "Read");
                        assert_eq!(input["file_path"], "main.rs");
                    }
                    other => panic!("Expected ToolUse, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn tool_result_event_routes_correctly() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_result","tool_use_id":"toolu_abc","content":"OK","is_error":false}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Assistant { message, .. } => {
                let blocks = message.content.as_ref().unwrap();
                match &blocks[0] {
                    ContentBlock::ToolResult { tool_use_id, content, is_error } => {
                        assert_eq!(tool_use_id, "toolu_abc");
                        assert_eq!(content.as_ref().unwrap(), &serde_json::Value::String("OK".into()));
                        assert_eq!(*is_error, Some(false));
                    }
                    other => panic!("Expected ToolResult, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn result_success_event_routes_correctly() {
        let json = r#"{"type":"result","subtype":"success","duration_ms":5000,"cost_usd":0.01,"usage":{"input_tokens":500,"output_tokens":300},"num_turns":2,"stop_reason":"end_turn","modelUsage":{"sonnet":{"contextWindow":200000,"maxOutputTokens":8192}}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Result { is_error, duration_ms, usage, model_usage, num_turns, stop_reason, .. } => {
                // is_error is None for success (not explicitly set)
                assert!(is_error.is_none() || *is_error == Some(false));
                assert_eq!(*duration_ms, Some(5000));
                assert!(usage.is_some());
                let (name, cw, mot) = extract_model_usage_info(model_usage);
                assert_eq!(name.as_deref(), Some("sonnet"));
                assert_eq!(cw, Some(200000));
                assert_eq!(mot, Some(8192));
                assert_eq!(*num_turns, Some(2));
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn result_error_event_routes_correctly() {
        let json = r#"{"type":"result","is_error":true,"result":"Rate limit exceeded","duration_ms":100}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Result { is_error, result, .. } => {
                assert_eq!(*is_error, Some(true));
                assert_eq!(result.as_deref(), Some("Rate limit exceeded"));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn unknown_event_type_does_not_panic() {
        let json = r#"{"type":"completely_new_event","data":"test"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, RawStreamEvent::Unknown));
    }

    #[test]
    fn content_block_delta_text_routes_correctly() {
        let json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"chunk"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::ContentBlockDelta { index, delta, .. } => {
                assert_eq!(*index, Some(0));
                match delta {
                    Some(StreamDelta::TextDelta { text }) => assert_eq!(text, "chunk"),
                    other => panic!("Expected TextDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn content_block_delta_input_json_routes_correctly() {
        let json = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"cmd\":\"ls\"}"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                match delta {
                    Some(StreamDelta::InputJsonDelta { partial_json }) => {
                        assert!(partial_json.is_some());
                    }
                    other => panic!("Expected InputJsonDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn message_delta_with_usage_routes_correctly() {
        let json = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":50,"output_tokens":100}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::MessageDelta { usage, .. } => {
                let u = usage.as_ref().unwrap();
                assert_eq!(u.input_tokens, Some(50));
                assert_eq!(u.output_tokens, Some(100));
            }
            other => panic!("Expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn rate_limit_event_routes_correctly() {
        let json = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1741800000,"utilization":0.85,"rateLimitType":"five_hour","isUsingOverage":false}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::RateLimitEvent { rate_limit_info, .. } => {
                let info = rate_limit_info.as_ref().unwrap();
                assert!(should_emit_rate_limit_warning(info));
                assert_eq!(info.rate_limit_type.as_deref(), Some("five_hour"));
            }
            other => panic!("Expected RateLimitEvent, got {:?}", other),
        }
    }

    #[test]
    fn system_status_event_routes_differently_from_init() {
        let json = r#"{"type":"system","subtype":"status","status":"compacting"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, extra, .. } => {
                assert_eq!(subtype.as_deref(), Some("status"));
                // In route_events, this hits the `subtype == Some("status")` guard
                let status = extra.get("status").and_then(|v| v.as_str());
                assert_eq!(status, Some("compacting"));
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn system_compact_boundary_event_routes_correctly() {
        let json = r#"{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"auto","pre_tokens":50000}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, extra, .. } => {
                assert_eq!(subtype.as_deref(), Some("compact_boundary"));
                let metadata = extra.get("compact_metadata").unwrap();
                assert_eq!(metadata["trigger"], "auto");
                assert_eq!(metadata["pre_tokens"], 50000);
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn system_task_started_event_routes_correctly() {
        let json = r#"{"type":"system","subtype":"task_started","tool_use_id":"toolu_abc","description":"Analyze code","subagent_type":"analysis"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, extra, .. } => {
                assert_eq!(subtype.as_deref(), Some("task_started"));
                assert_eq!(extra.get("tool_use_id").and_then(|v| v.as_str()), Some("toolu_abc"));
                assert_eq!(extra.get("description").and_then(|v| v.as_str()), Some("Analyze code"));
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn user_event_with_tool_result_routes_correctly() {
        let json = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_xyz","content":"Success","is_error":false}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::User { message, .. } => {
                let msg = message.as_ref().unwrap();
                let blocks = msg.content.as_ref().unwrap();
                match &blocks[0] {
                    ContentBlock::ToolResult { tool_use_id, content, is_error } => {
                        assert_eq!(tool_use_id, "toolu_xyz");
                        assert_eq!(tool_result_content_to_string(content).as_deref(), Some("Success"));
                        assert_eq!(*is_error, Some(false));
                    }
                    other => panic!("Expected ToolResult, got {:?}", other),
                }
            }
            other => panic!("Expected User, got {:?}", other),
        }
    }

    #[test]
    fn tool_progress_event_routes_correctly() {
        let json = r#"{"type":"tool_progress","tool_use_id":"toolu_abc","tool_name":"Bash","elapsed_time_seconds":5.2}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::ToolProgress { tool_use_id, tool_name, elapsed_time_seconds, .. } => {
                assert_eq!(tool_use_id.as_deref(), Some("toolu_abc"));
                assert_eq!(tool_name.as_deref(), Some("Bash"));
                assert!((elapsed_time_seconds.unwrap() - 5.2).abs() < f64::EPSILON);
            }
            other => panic!("Expected ToolProgress, got {:?}", other),
        }
    }

    #[test]
    fn message_start_and_stop_are_passthrough() {
        let start_json = r#"{"type":"message_start","message":{"id":"msg_001"}}"#;
        let stop_json = r#"{"type":"message_stop"}"#;

        let start: RawStreamEvent = serde_json::from_str(start_json).unwrap();
        let stop: RawStreamEvent = serde_json::from_str(stop_json).unwrap();

        assert!(matches!(start, RawStreamEvent::MessageStart { .. }));
        assert!(matches!(stop, RawStreamEvent::MessageStop { .. }));
    }

    // ── PendingToolBlock accumulation logic ──

    #[test]
    fn pending_tool_block_accumulates_json() {
        let mut pending = PendingToolBlock {
            id: "toolu_01".to_string(),
            name: "Bash".to_string(),
            input_json: String::new(),
        };
        pending.input_json.push_str("{\"com");
        pending.input_json.push_str("mand\":");
        pending.input_json.push_str("\"ls -la\"}");

        let parsed: serde_json::Value = serde_json::from_str(&pending.input_json).unwrap();
        assert_eq!(parsed["command"], "ls -la");
    }

    #[test]
    fn pending_tool_block_empty_json_falls_back_to_empty_object() {
        let input = "";
        let parsed: serde_json::Value =
            serde_json::from_str(input).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        assert!(parsed.is_object());
        assert!(parsed.as_object().unwrap().is_empty());
    }

    #[test]
    fn pending_tool_block_malformed_json_falls_back_to_empty_object() {
        let input = "{broken";
        let parsed: serde_json::Value =
            serde_json::from_str(input).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        assert!(parsed.is_object());
        assert!(parsed.as_object().unwrap().is_empty());
    }

    // ── Error handling paths ──

    #[test]
    fn result_error_with_no_result_field_uses_default_message() {
        // When is_error=true but result is None, route_events uses "Unknown error"
        let json = r#"{"type":"result","is_error":true}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result { is_error, result, .. } => {
                assert_eq!(is_error, Some(true));
                let error_msg = result.unwrap_or_else(|| "Unknown error".to_string());
                assert_eq!(error_msg, "Unknown error");
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn control_response_event_routes_correctly() {
        let json = r#"{"type":"control_response","response":{"subtype":"success","request_id":"req_123","response":{"models":[]}}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::ControlResponse { response, .. } => {
                let resp = response.as_ref().unwrap();
                assert_eq!(resp["subtype"], "success");
                assert_eq!(resp["request_id"], "req_123");
            }
            other => panic!("Expected ControlResponse, got {:?}", other),
        }
    }

    #[test]
    fn control_response_error_routes_correctly() {
        let json = r#"{"type":"control_response","response":{"subtype":"error","request_id":"req_456","error":"model not found"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::ControlResponse { response, .. } => {
                let resp = response.as_ref().unwrap();
                assert_eq!(resp["subtype"], "error");
                assert_eq!(resp["error"], "model not found");
            }
            other => panic!("Expected ControlResponse, got {:?}", other),
        }
    }

    #[test]
    fn system_unhandled_subtype_does_not_panic() {
        // A future system subtype that doesn't match any guard
        let json = r#"{"type":"system","subtype":"some_new_feature","data":"test"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, RawStreamEvent::System { .. }));
    }

    #[test]
    fn system_null_subtype_does_not_panic() {
        let json = r#"{"type":"system"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, .. } => {
                assert!(subtype.is_none());
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }
}
