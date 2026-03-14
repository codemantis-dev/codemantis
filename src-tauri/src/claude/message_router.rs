use crate::claude::event_types::{ContentBlock, FrontendEvent, RawStreamEvent, StreamDelta};
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

pub async fn route_events(
    app_handle: AppHandle,
    session_id: String,
    mut receiver: mpsc::UnboundedReceiver<RawStreamEvent>,
) {
    let chat_event = format!("claude-chat-{}", session_id);
    let activity_event = format!("claude-activity-{}", session_id);

    let mut accumulated_text = String::new();
    let mut cli_session_id_emitted = false;
    let mut emitted_tool_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Track tool_use blocks being streamed so we can emit with complete input
    let mut pending_tools: HashMap<u32, PendingToolBlock> = HashMap::new();

    while let Some(event) = receiver.recv().await {
        match event {
            RawStreamEvent::System {
                model,
                subtype,
                session_id: cli_sid,
                ref extra,
                ..
            } if subtype.as_deref() == Some("init") => {
                    debug!("System init extra fields: {}", extra);

                    // Store model in SessionInfo so it's available at close time
                    if let Some(ref model_name) = model {
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut sessions = state.sessions.lock().await;
                            if let Some(session) = sessions.get_mut(&session_id) {
                                session.model = Some(model_name.clone());
                            }
                        }
                    }

                    // Try to extract thinking effort from extra fields
                    let thinking_effort = extra
                        .get("thinking")
                        .and_then(|v| v.get("effort"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            extra.get("effort").and_then(|v| v.as_str()).map(|s| s.to_string())
                        })
                        .or_else(|| {
                            extra.get("thinking_effort").and_then(|v| v.as_str()).map(|s| s.to_string())
                        });
                    let fe = FrontendEvent::SessionInit {
                        session_id: session_id.clone(),
                        model,
                        thinking_effort,
                    };
                    let _ = app_handle.emit(&chat_event, &fe);

                    // Emit CLI's own session_id if present and store in AppState
                    if let Some(ref sid) = cli_sid {
                        if !cli_session_id_emitted {
                            cli_session_id_emitted = true;
                            // Store in backend state so it's available even if frontend misses the event
                            if let Some(state) = app_handle.try_state::<AppState>() {
                                let mut cli_ids = state.cli_session_ids.lock().await;
                                cli_ids.insert(session_id.clone(), sid.clone());
                            }
                            let fe = FrontendEvent::CliSessionId {
                                session_id: session_id.clone(),
                                cli_session_id: sid.clone(),
                            };
                            let _ = app_handle.emit(&chat_event, &fe);
                        }
                    }

                    // Sync permissionMode from CLI init event to backend.
                    // The CLI is the source of truth — when it exits plan mode
                    // and starts implementing, the UI badge must update.
                    if let Some(cli_perm_mode) = extra.get("permissionMode").and_then(|v| v.as_str()) {
                        let new_mode = match cli_perm_mode {
                            "plan" => SessionMode::Plan,
                            "acceptEdits" => SessionMode::AutoAccept,
                            _ => SessionMode::Normal,
                        };
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut modes = state.session_modes.lock().await;
                            if modes.get(&session_id) != Some(&new_mode) {
                                info!(
                                    "[message_router] System init: syncing permissionMode '{}' → {:?} for session {}",
                                    cli_perm_mode, new_mode, session_id
                                );
                                modes.insert(session_id.clone(), new_mode.clone());
                                drop(modes);
                                let _ = app_handle.emit(
                                    "session-mode-changed",
                                    serde_json::json!({
                                        "sessionId": session_id,
                                        "mode": new_mode
                                    }),
                                );
                            }
                        }
                    }
            }

            RawStreamEvent::Assistant { message, .. } => {
                // Note: message.usage contains preliminary token counts (often 1 or 19).
                // The authoritative per-API-call usage comes from MessageDelta events.

                if let Some(content_blocks) = &message.content {
                    for block in content_blocks {
                        match block {
                            ContentBlock::Text { text } => {
                                accumulated_text.clone_from(text);
                                let fe = FrontendEvent::TextComplete {
                                    session_id: session_id.clone(),
                                    full_text: text.clone(),
                                };
                                let _ = app_handle.emit(&chat_event, &fe);
                            }
                            ContentBlock::ToolUse { id, name, input } => {
                                // Skip if this tool is still being streamed via
                                // ContentBlockStart/Delta/Stop — its input may be
                                // incomplete. ContentBlockStop will emit with full input.
                                let is_pending = pending_tools.values().any(|p| p.id == *id);
                                if !is_pending && emitted_tool_ids.insert(id.clone()) {
                                    let fe = FrontendEvent::ToolUseStart {
                                        session_id: session_id.clone(),
                                        tool_use_id: id.clone(),
                                        tool_name: name.clone(),
                                        tool_input: input.clone(),
                                    };
                                    let _ = app_handle.emit(&activity_event, &fe);
                                }
                            }
                            ContentBlock::ToolResult {
                                tool_use_id,
                                content,
                                is_error,
                            } => {
                                let content_str = content.as_ref().map(|c| {
                                    match c {
                                        serde_json::Value::String(s) => s.clone(),
                                        other => other.to_string(),
                                    }
                                });
                                let fe = FrontendEvent::ToolResult {
                                    session_id: session_id.clone(),
                                    tool_use_id: tool_use_id.clone(),
                                    content: content_str,
                                    is_error: is_error.unwrap_or(false),
                                };
                                let _ = app_handle.emit(&activity_event, &fe);
                            }
                            ContentBlock::Thinking { .. } => {
                                // Extended thinking — silently skip
                            }
                            ContentBlock::Unknown => {
                                debug!("Unknown content block type");
                            }
                        }
                    }
                }
            }

            RawStreamEvent::ContentBlockDelta { index, delta, .. } => {
                match delta {
                    Some(StreamDelta::TextDelta { text }) => {
                        accumulated_text.push_str(&text);
                        let fe = FrontendEvent::TextDelta {
                            session_id: session_id.clone(),
                            text,
                        };
                        let _ = app_handle.emit(&chat_event, &fe);
                    }
                    Some(StreamDelta::InputJsonDelta { partial_json }) => {
                        // Accumulate tool input JSON fragments
                        if let (Some(idx), Some(fragment)) = (index, partial_json) {
                            if let Some(pending) = pending_tools.get_mut(&idx) {
                                pending.input_json.push_str(&fragment);
                            }
                        }
                    }
                    _ => {}
                }
            }

            RawStreamEvent::ContentBlockStart { index, content_block, .. } => {
                if let Some(block) = content_block {
                    match block {
                        ContentBlock::ToolUse { id, name, .. } => {
                            // Don't emit yet — input is empty. Track the block and
                            // emit from ContentBlockStop once all InputJsonDelta
                            // fragments have been accumulated.
                            if let Some(idx) = index {
                                pending_tools.insert(idx, PendingToolBlock {
                                    id,
                                    name,
                                    input_json: String::new(),
                                });
                            }
                        }
                        ContentBlock::Text { text } => {
                            if !text.is_empty() {
                                accumulated_text.push_str(&text);
                                let fe = FrontendEvent::TextDelta {
                                    session_id: session_id.clone(),
                                    text,
                                };
                                let _ = app_handle.emit(&chat_event, &fe);
                            }
                        }
                        _ => {}
                    }
                }
            }

            RawStreamEvent::ContentBlockStop { index, .. } => {
                // If this was a tool_use block, emit with complete accumulated input
                if let Some(idx) = index {
                    if let Some(pending) = pending_tools.remove(&idx) {
                        let input = serde_json::from_str(&pending.input_json)
                            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                        if emitted_tool_ids.insert(pending.id.clone()) {
                            let fe = FrontendEvent::ToolUseStart {
                                session_id: session_id.clone(),
                                tool_use_id: pending.id,
                                tool_name: pending.name,
                                tool_input: input,
                            };
                            let _ = app_handle.emit(&activity_event, &fe);
                        }
                    }
                }
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
                // Emit CLI session_id if not yet emitted (fallback from Result event)
                if let Some(ref sid) = cli_sid {
                    if !cli_session_id_emitted {
                        cli_session_id_emitted = true;
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut cli_ids = state.cli_session_ids.lock().await;
                            cli_ids.insert(session_id.clone(), sid.clone());
                        }
                        let fe = FrontendEvent::CliSessionId {
                            session_id: session_id.clone(),
                            cli_session_id: sid.clone(),
                        };
                        let _ = app_handle.emit(&chat_event, &fe);
                    }
                }
                if is_error == Some(true) {
                    let error_msg = result.unwrap_or_else(|| "Unknown error".to_string());
                    let fe = FrontendEvent::ProcessError {
                        session_id: session_id.clone(),
                        error: error_msg,
                    };
                    let _ = app_handle.emit(&chat_event, &fe);
                } else {
                    // Extract model name, contextWindow, and maxOutputTokens from modelUsage
                    let (model_name, context_window, max_output_tokens) = model_usage
                        .as_ref()
                        .and_then(|mu| mu.as_object())
                        .and_then(|obj| {
                            // modelUsage is keyed by model name — take the first entry
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
                        .unwrap_or((None, None, None));

                    let fe = FrontendEvent::TurnComplete {
                        session_id: session_id.clone(),
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
                    let _ = app_handle.emit(&chat_event, &fe);
                }
                accumulated_text.clear();
            }

            RawStreamEvent::System {
                subtype,
                ref extra,
                ..
            } if subtype.as_deref() == Some("status") => {
                let status = extra.get("status").and_then(|v| v.as_str());
                let is_compacting = status == Some("compacting");
                let fe = FrontendEvent::CompactingStatus {
                    session_id: session_id.clone(),
                    is_compacting,
                };
                let _ = app_handle.emit(&chat_event, &fe);
            }

            RawStreamEvent::System {
                subtype,
                ref extra,
                ..
            } if subtype.as_deref() == Some("compact_boundary") => {
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
                    session_id: session_id.clone(),
                    trigger,
                    pre_tokens,
                };
                let _ = app_handle.emit(&chat_event, &fe);
            }

            RawStreamEvent::ToolProgress {
                tool_use_id,
                tool_name,
                elapsed_time_seconds,
                ref extra,
            } => {
                if let (Some(ref id), Some(ref name), Some(elapsed)) =
                    (&tool_use_id, &tool_name, elapsed_time_seconds)
                {
                    let fe = FrontendEvent::ToolProgress {
                        session_id: session_id.clone(),
                        tool_use_id: id.clone(),
                        tool_name: name.clone(),
                        elapsed_seconds: elapsed,
                    };
                    let _ = app_handle.emit(&activity_event, &fe);

                    // Extract tool_count/token_count from extra for Agent tools
                    if name == "Agent" {
                        let tool_count = extra.get("tool_count").and_then(|v| v.as_u64()).map(|v| v as u32);
                        let token_count = extra.get("token_count").and_then(|v| v.as_u64()).map(|v| v as u32);
                        if tool_count.is_some() || token_count.is_some() {
                            let fe = FrontendEvent::SubAgentProgress {
                                session_id: session_id.clone(),
                                tool_use_id: id.clone(),
                                tool_count,
                                token_count,
                                current_activity: None,
                            };
                            let _ = app_handle.emit(&activity_event, &fe);
                        }
                    }
                }
            }

            RawStreamEvent::RateLimitEvent { rate_limit_info, .. } => {
                if let Some(info) = rate_limit_info {
                    let utilization = info.utilization.unwrap_or(0.0);
                    // Emit when status is "allowed_warning" OR utilization is high.
                    // The real CLI typically sends status but not utilization, so
                    // the status-based path is the primary trigger.
                    if utilization > 0.7 || info.status.as_deref() == Some("allowed_warning") {
                        let fe = FrontendEvent::RateLimitWarning {
                            session_id: session_id.clone(),
                            utilization,
                            resets_at: info.resets_at,
                            rate_limit_type: info.rate_limit_type,
                            overage_status: info.overage_status,
                            is_using_overage: info.is_using_overage,
                        };
                        let _ = app_handle.emit(&chat_event, &fe);
                    }
                }
            }

            // Sub-agent task lifecycle events
            RawStreamEvent::System {
                subtype,
                ref extra,
                ..
            } if matches!(subtype.as_deref(), Some("task_started") | Some("task_progress") | Some("task_complete")) => {
                let sub = subtype.as_deref().unwrap_or("");
                let tool_use_id = extra.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                debug!(
                    "[message_router] {}: tool_use_id={}, extra_keys={:?}",
                    sub,
                    tool_use_id,
                    extra.as_object().map(|o| o.keys().collect::<Vec<_>>())
                );

                match sub {
                    "task_started" => {
                        let description = extra.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let subagent_type = extra.get("subagent_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let fe = FrontendEvent::SubAgentStarted {
                            session_id: session_id.clone(),
                            tool_use_id,
                            description,
                            subagent_type,
                        };
                        let _ = app_handle.emit(&activity_event, &fe);
                    }
                    "task_progress" => {
                        let tool_count = extra.get("tool_count").and_then(|v| v.as_u64()).map(|v| v as u32);
                        let token_count = extra.get("token_count").and_then(|v| v.as_u64()).map(|v| v as u32);
                        let current_activity = extra.get("current_activity").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let fe = FrontendEvent::SubAgentProgress {
                            session_id: session_id.clone(),
                            tool_use_id,
                            tool_count,
                            token_count,
                            current_activity,
                        };
                        let _ = app_handle.emit(&activity_event, &fe);
                    }
                    "task_complete" => {
                        let tool_count = extra.get("tool_count").and_then(|v| v.as_u64()).map(|v| v as u32);
                        let token_count = extra.get("token_count").and_then(|v| v.as_u64()).map(|v| v as u32);
                        let fe = FrontendEvent::SubAgentComplete {
                            session_id: session_id.clone(),
                            tool_use_id,
                            tool_count,
                            token_count,
                        };
                        let _ = app_handle.emit(&activity_event, &fe);
                    }
                    _ => {}
                }
            }

            // Unhandled System subtypes — log for discovery
            RawStreamEvent::System { subtype, ref extra, .. } => {
                info!(
                    "[message_router] Unhandled system event: subtype={:?}, keys={:?}",
                    subtype,
                    extra.as_object().map(|o| o.keys().collect::<Vec<_>>()).unwrap_or_default()
                );
            }

            RawStreamEvent::MessageDelta { usage, .. } => {
                // Authoritative per-API-call usage (final token counts)
                if let Some(usage) = usage {
                    let fe = FrontendEvent::UsageUpdate {
                        session_id: session_id.clone(),
                        usage: usage.clone(),
                    };
                    let _ = app_handle.emit(&chat_event, &fe);
                }
            }

            RawStreamEvent::MessageStart { .. }
            | RawStreamEvent::MessageStop { .. } => {}

            RawStreamEvent::User { message, .. } => {
                // User events contain tool_result content blocks
                if let Some(msg) = message {
                    if let Some(content_blocks) = &msg.content {
                        for block in content_blocks {
                            if let ContentBlock::ToolResult {
                                tool_use_id,
                                content,
                                is_error,
                            } = block
                            {
                                let content_str = content.as_ref().map(|c| match c {
                                    serde_json::Value::String(s) => s.clone(),
                                    other => other.to_string(),
                                });
                                let fe = FrontendEvent::ToolResult {
                                    session_id: session_id.clone(),
                                    tool_use_id: tool_use_id.clone(),
                                    content: content_str,
                                    is_error: is_error.unwrap_or(false),
                                };
                                let _ = app_handle.emit(&activity_event, &fe);
                            }
                        }
                    }
                }
            }

            RawStreamEvent::ControlResponse { response, .. } => {
                if let Some(resp_val) = response {
                    // resp_val is the top-level response object:
                    //   { "subtype": "success", "request_id": "req_abc", "response": { ... } }
                    // or for error:
                    //   { "subtype": "error", "request_id": "req_abc", "error": "Already initialized" }
                    // subtype and request_id are always at the top level.
                    let subtype = resp_val.get("subtype").and_then(|v| v.as_str());
                    let req_id = resp_val.get("request_id").and_then(|v| v.as_str());

                    if let Some(request_id) = req_id {
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let kind = {
                                let mut pending = state.pending_control_requests.lock().await;
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
                                        session_id: session_id.clone(),
                                        success: is_success,
                                        error: error_msg,
                                    };
                                    let _ = app_handle.emit(&chat_event, &fe);
                                }
                                Some((_, ControlRequestKind::SetModel(model))) => {
                                    if is_success {
                                        let mut sessions = state.sessions.lock().await;
                                        if let Some(session) = sessions.get_mut(&session_id) {
                                            session.model = Some(model.clone());
                                        }
                                    }
                                    let fe = FrontendEvent::ModelChanged {
                                        session_id: session_id.clone(),
                                        model,
                                        success: is_success,
                                        error: error_msg,
                                    };
                                    let _ = app_handle.emit(&chat_event, &fe);
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
                                        // Capabilities data is in resp_val.response (the nested payload)
                                        let caps = resp_val
                                            .get("response")
                                            .cloned()
                                            .unwrap_or(serde_json::Value::Null);
                                        let fe = FrontendEvent::CapabilitiesDiscovered {
                                            session_id: session_id.clone(),
                                            models: caps.get("models").cloned().unwrap_or_default(),
                                            commands: caps.get("commands").cloned().unwrap_or_default(),
                                            agents: caps.get("agents").cloned().unwrap_or_default(),
                                            account: caps.get("account").cloned().unwrap_or_default(),
                                            output_styles: caps
                                                .get("available_output_styles")
                                                .cloned()
                                                .unwrap_or_default(),
                                        };
                                        let _ = app_handle.emit(&chat_event, &fe);
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

            RawStreamEvent::Unknown => {
                debug!("Received unhandled event type (message_start/delta/stop)");
            }
        }
    }

    debug!("Message router: channel closed for session {}", session_id);
}
