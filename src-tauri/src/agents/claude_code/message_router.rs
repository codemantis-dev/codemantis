use crate::agents::claude_code::event_types::{ContentBlock, FrontendEvent, RawStreamEvent, RateLimitInfo, StreamDelta};
use crate::agents::claude_code::session::{AppState, ControlRequestKind, SessionMode};
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
///
/// The CLI's wire format is camelCase (`acceptEdits`, `dontAsk`,
/// `bypassPermissions`, `auto`, `plan`, `default`). Unknown strings fall
/// back to `SessionMode::Normal` (safe default — prompt the user).
///
/// Currently only used by the round-trip test in `commands::session` and
/// the per-mode tests below. We intentionally do NOT call it from the
/// `system/init` handler (see `handle_system_init` for why) — `--dangerously
/// -skip-permissions` always forces the CLI's reported mode to
/// `bypassPermissions`, so syncing from there overwrites the user's choice.
#[allow(dead_code)]
pub(crate) fn classify_permission_mode(cli_perm_mode: &str) -> SessionMode {
    match cli_perm_mode {
        "plan" => SessionMode::Plan,
        "acceptEdits" => SessionMode::AutoAccept,
        "auto" => SessionMode::Auto,
        "dontAsk" => SessionMode::DontAsk,
        "bypassPermissions" => SessionMode::BypassPermissions,
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

/// Helper: store the CLI-reported session_id in AppState and persist it to disk.
///
/// Crash-recovery requires `cli_session_id` to survive a force-quit. The
/// in-memory map alone is lost when the app dies, which previously stranded
/// every active session: `list_crashed_sessions` skips rows with NULL
/// `cli_session_id`, and `list_recent_closed_sessions` filters them out too.
/// We persist on first observation so a session that received init becomes
/// resumable from that moment on.
async fn store_cli_session_id(app_handle: &AppHandle, session_id: &str, cli_sid: &str) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        {
            let mut cli_ids = state.cli_session_ids.lock().await;
            cli_ids.insert(session_id.to_string(), cli_sid.to_string());
        }
        if let Err(e) = state.database.set_cli_session_id(session_id, cli_sid) {
            warn!(
                "[message-router] Failed to persist cli_session_id for {}: {}",
                session_id, e
            );
        }
    }
}

// ── Mutable state threaded through the event loop ──

struct RouterState {
    accumulated_text: String,
    accumulated_thinking: String,
    thinking_block_index: Option<u32>,
    cli_session_id_emitted: bool,
    emitted_tool_ids: std::collections::HashSet<String>,
    pending_tools: HashMap<u32, PendingToolBlock>,
    thinking_blocks_this_turn: u32,
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

    // We deliberately do NOT sync our session_mode from `extra.permissionMode`.
    // CodeMantis spawns the CLI with `--dangerously-skip-permissions`, which
    // (per CLI 2.1.126, harness S06) silently overrides any other mode and
    // forces `system/init.permissionMode == "bypassPermissions"`. Syncing
    // would therefore flip every session to Bypass on the first turn,
    // overwriting whatever the user picked in `ModeSelector`. Mode is
    // host-owned: the user's choice (kept in `state.session_modes`) is the
    // source of truth, and the approval-hook server enforces it. Any runtime
    // mode change goes through `set_session_mode` → `set_permission_mode`
    // control_request and emits `session-mode-changed` directly.
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
                    // Diagnostic: trace the modal-open path through Rust→frontend
                    // for the tools that drive UI prompts. Pair with [plan-modal]
                    // logs in src/lib/event-handlers/activity.ts.
                    if matches!(name.as_str(), "ExitPlanMode" | "EnterPlanMode" | "AskUserQuestion") {
                        info!(
                            "[plan-modal] router emitting ToolUseStart from assistant path: tool={} id={} input_keys={:?} session={}",
                            name,
                            id,
                            input.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
                            session_id
                        );
                    }
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
            ContentBlock::Thinking { thinking } => {
                state.thinking_blocks_this_turn = state.thinking_blocks_this_turn.saturating_add(1);
                if !thinking.is_empty() {
                    let fe = FrontendEvent::ThinkingComplete {
                        session_id: session_id.to_string(),
                        full_thinking: thinking.clone(),
                    };
                    emit_or_warn(app_handle, chat_event, &fe, "thinking-complete");
                }
            }
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
        Some(StreamDelta::ThinkingDelta { thinking }) => {
            state.thinking_blocks_this_turn = state.thinking_blocks_this_turn.saturating_add(1);
            state.accumulated_thinking.push_str(&thinking);
            let fe = FrontendEvent::ThinkingDelta {
                session_id: session_id.to_string(),
                thinking,
            };
            emit_or_warn(app_handle, chat_event, &fe, "thinking-delta");
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
            ContentBlock::Text { text }
                if !text.is_empty() => {
                    state.accumulated_text.push_str(&text);
                    let fe = FrontendEvent::TextDelta {
                        session_id: session_id.to_string(),
                        text,
                    };
                    emit_or_warn(app_handle, chat_event, &fe, "text-delta");
            }
            ContentBlock::Thinking { thinking } => {
                state.thinking_block_index = index;
                state.accumulated_thinking.clear();
                state.thinking_blocks_this_turn = state.thinking_blocks_this_turn.saturating_add(1);
                if !thinking.is_empty() {
                    state.accumulated_thinking.push_str(&thinking);
                    let fe = FrontendEvent::ThinkingDelta {
                        session_id: session_id.to_string(),
                        thinking,
                    };
                    emit_or_warn(app_handle, chat_event, &fe, "thinking-delta");
                }
            }
            _ => {}
        }
    }
}

fn handle_content_block_stop(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    activity_event: &str,
    index: Option<u32>,
    state: &mut RouterState,
) {
    if let Some(idx) = index {
        // Emit thinking_complete if this was the thinking block
        if state.thinking_block_index == Some(idx) {
            if !state.accumulated_thinking.is_empty() {
                let fe = FrontendEvent::ThinkingComplete {
                    session_id: session_id.to_string(),
                    full_thinking: state.accumulated_thinking.clone(),
                };
                emit_or_warn(app_handle, chat_event, &fe, "thinking-complete");
            }
            state.thinking_block_index = None;
        }

        if let Some(pending) = state.pending_tools.remove(&idx) {
            let input = serde_json::from_str(&pending.input_json)
                .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
            if state.emitted_tool_ids.insert(pending.id.clone()) {
                // Diagnostic: trace the modal-open path through Rust→frontend
                // for the tools that drive UI prompts. Pair with [plan-modal]
                // logs in src/lib/event-handlers/activity.ts.
                if matches!(pending.name.as_str(), "ExitPlanMode" | "EnterPlanMode" | "AskUserQuestion") {
                    info!(
                        "[plan-modal] router emitting ToolUseStart from content_block_stop path: tool={} id={} input_keys={:?} session={}",
                        pending.name,
                        pending.id,
                        input.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
                        session_id
                    );
                }
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

#[allow(clippy::too_many_arguments)]
async fn handle_result(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    cli_sid: &Option<String>,
    is_error: Option<bool>,
    result: Option<String>,
    duration_ms: Option<u64>,
    usage: Option<crate::agents::claude_code::event_types::UsageInfo>,
    cost_usd: Option<f64>,
    duration_api_ms: Option<u64>,
    num_turns: Option<u32>,
    stop_reason: Option<String>,
    terminal_reason: Option<String>,
    model_usage: &Option<serde_json::Value>,
    permission_denials: Option<Vec<crate::agents::claude_code::event_types::PermissionDenial>>,
    state: &mut RouterState,
) {
    if let Some(sid) = cli_sid {
        maybe_emit_cli_session_id(app_handle, session_id, chat_event, sid, state).await;
    }

    // Surface CLI-internal protected-path denials (e.g. `.claude/` writes that
    // are blocked even with `--dangerously-skip-permissions` per CLI 2.1.78+).
    // The CLI reports these only here, with no inbound `control_request` to
    // ask the host first — so the user sees the agent stall and complain
    // about "permissions" without a UI prompt. This emits a frontend event
    // the chat layer turns into an explanatory toast.
    if let Some(denials) = permission_denials {
        if !denials.is_empty() {
            info!(
                "[message_router] CLI denied {} tool call(s) via protected-path guardrail (session: {})",
                denials.len(),
                session_id
            );
            let fe = FrontendEvent::ProtectedPathDeny {
                session_id: session_id.to_string(),
                denials,
            };
            emit_or_warn(app_handle, chat_event, &fe, "protected-path-deny");
        }
    }

    // CLI v2.1.101+ sets is_error=true for user-initiated interrupts
    // (terminal_reason="aborted_streaming"). Treat these as normal turn
    // completions so the frontend doesn't show a spurious error toast.
    let is_abort = terminal_reason.as_deref() == Some("aborted_streaming");

    if is_error == Some(true) && !is_abort {
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
            terminal_reason,
            model_name,
            context_window,
            max_output_tokens,
        };
        emit_or_warn(app_handle, chat_event, &fe, "turn-complete");
    }
    // Diagnostic: log when a turn completes without any thinking blocks in
    // the stream-json output. Helps diagnose upstream regressions (e.g. CLI
    // v2.1.90 changed thinking-summary defaults, and some Opus 4.x turns
    // return zero thinking blocks even when --settings enables them).
    let (model_name_for_log, _, _) = extract_model_usage_info(model_usage);
    debug!(
        "[message-router] turn complete for session={} model={:?} thinking_blocks={}",
        session_id,
        model_name_for_log,
        state.thinking_blocks_this_turn,
    );

    state.accumulated_text.clear();
    state.accumulated_thinking.clear();
    state.thinking_block_index = None;
    state.thinking_blocks_this_turn = 0;
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
        "task_notification" => {
            let task_id = extra.get("task_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let status = extra.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let summary = extra.get("summary").and_then(|v| v.as_str()).map(|s| s.to_string());
            let output_file = extra.get("output_file").and_then(|v| v.as_str()).map(|s| s.to_string());
            let usage = extra
                .get("usage")
                .and_then(|v| {
                    serde_json::from_value::<crate::agents::claude_code::event_types::UsageInfo>(v.clone()).ok()
                });
            let fe = FrontendEvent::TaskNotification {
                session_id: session_id.to_string(),
                tool_use_id,
                task_id,
                status,
                summary,
                output_file,
                usage,
            };
            emit_or_warn(app_handle, activity_event, &fe, "task-notification");
        }
        "task_updated" => {
            let task_id = extra.get("task_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let patch = extra.get("patch").cloned().unwrap_or(serde_json::Value::Null);
            let fe = FrontendEvent::TaskUpdated {
                session_id: session_id.to_string(),
                task_id,
                patch,
            };
            emit_or_warn(app_handle, activity_event, &fe, "task-updated");
        }
        _ => {}
    }
}

fn handle_message_delta(
    app_handle: &AppHandle,
    session_id: &str,
    chat_event: &str,
    usage: Option<crate::agents::claude_code::event_types::UsageInfo>,
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
    message: &Option<crate::agents::claude_code::event_types::AssistantMessage>,
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
                            // Surface to the user instead of failing silently. An
                            // outdated CLI is the most common cause — the error
                            // catalog (`error-messages.ts`) translates this exact
                            // prefix into the "Outdated CLI" remediation card.
                            let detail = error_msg
                                .as_deref()
                                .unwrap_or("no detail returned by CLI")
                                .to_string();
                            let user_msg = format!(
                                "Initialize handshake failed: {detail}. \
                                 This usually means the installed Claude Code CLI is too old. \
                                 Run `npm install -g @anthropic-ai/claude-code@latest` and restart CodeMantis."
                            );
                            let fe = FrontendEvent::ProcessError {
                                session_id: session_id.to_string(),
                                error: user_msg,
                            };
                            emit_or_warn(app_handle, chat_event, &fe, "process-error");
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
        accumulated_thinking: String::new(),
        thinking_block_index: None,
        cli_session_id_emitted: false,
        emitted_tool_ids: std::collections::HashSet::new(),
        pending_tools: HashMap::new(),
        thinking_blocks_this_turn: 0,
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
                    &app_handle, &session_id, &chat_event, &activity_event,
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
                terminal_reason,
                model_usage,
                permission_denials,
                ..
            } => {
                handle_result(
                    &app_handle, &session_id, &chat_event,
                    &cli_sid, is_error, result, duration_ms, usage, cost_usd,
                    duration_api_ms, num_turns, stop_reason, terminal_reason,
                    &model_usage, permission_denials, &mut state,
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
            } if matches!(
                subtype.as_deref(),
                Some("task_started")
                    | Some("task_progress")
                    | Some("task_complete")
                    | Some("task_notification")
                    | Some("task_updated")
            ) => {
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
    use crate::agents::claude_code::event_types::{
        ContentBlock, RateLimitInfo, RawStreamEvent, StreamDelta,
    };
    use crate::agents::claude_code::session::SessionMode;

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
    fn classify_auto_mode() {
        assert_eq!(classify_permission_mode("auto"), SessionMode::Auto);
    }

    #[test]
    fn classify_dont_ask_mode() {
        assert_eq!(classify_permission_mode("dontAsk"), SessionMode::DontAsk);
    }

    #[test]
    fn classify_bypass_permissions_mode() {
        assert_eq!(
            classify_permission_mode("bypassPermissions"),
            SessionMode::BypassPermissions,
        );
    }

    #[test]
    fn classify_unknown_mode_falls_back_to_normal() {
        // Truly unknown strings — current CLI choices are covered above.
        assert_eq!(classify_permission_mode("some_future_mode"), SessionMode::Normal);
        assert_eq!(classify_permission_mode(""), SessionMode::Normal);
        // Guard against accidental case-insensitive matching.
        assert_eq!(classify_permission_mode("Plan"), SessionMode::Normal);
        assert_eq!(classify_permission_mode("AUTO"), SessionMode::Normal);
    }

    // ── extract_model_usage_info ──

    #[test]
    fn extract_model_usage_full_info() {
        let model_usage = Some(serde_json::json!({
            "claude-opus-4-7": {
                "contextWindow": 200000,
                "maxOutputTokens": 32000,
                "costUSD": 0.05,
                "inputTokens": 100,
                "outputTokens": 200
            }
        }));
        let (name, cw, mot) = extract_model_usage_info(&model_usage);
        assert_eq!(name.as_deref(), Some("claude-opus-4-7"));
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
            extra: Default::default(),
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
            extra: Default::default(),
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
            extra: Default::default(),
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
            extra: Default::default(),
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
            extra: Default::default(),
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
    fn system_task_notification_event_parses_all_fields() {
        let json = r#"{"type":"system","subtype":"task_notification","task_id":"task_42","tool_use_id":"toolu_agent_1","status":"completed","summary":"Found 3 matches","output_file":"/tmp/spool.txt","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":null,"cache_read_input_tokens":null},"uuid":"evt-uuid"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, extra, .. } => {
                assert_eq!(subtype.as_deref(), Some("task_notification"));
                assert_eq!(extra.get("task_id").and_then(|v| v.as_str()), Some("task_42"));
                assert_eq!(extra.get("tool_use_id").and_then(|v| v.as_str()), Some("toolu_agent_1"));
                assert_eq!(extra.get("status").and_then(|v| v.as_str()), Some("completed"));
                assert_eq!(extra.get("summary").and_then(|v| v.as_str()), Some("Found 3 matches"));
                assert_eq!(extra.get("output_file").and_then(|v| v.as_str()), Some("/tmp/spool.txt"));
                let usage = extra
                    .get("usage")
                    .and_then(|v| {
                        serde_json::from_value::<crate::agents::claude_code::event_types::UsageInfo>(v.clone()).ok()
                    })
                    .expect("usage should parse");
                assert_eq!(usage.input_tokens, Some(100));
                assert_eq!(usage.output_tokens, Some(50));
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn system_task_notification_event_tolerates_missing_optionals() {
        // The more common shape in the log omits `usage`.
        let json = r#"{"type":"system","subtype":"task_notification","task_id":"task_9","tool_use_id":"toolu_x","status":"completed","summary":"ok","output_file":"/tmp/o.txt","uuid":"u"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, extra, .. } => {
                assert_eq!(subtype.as_deref(), Some("task_notification"));
                assert!(extra.get("usage").is_none());
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn system_task_updated_event_preserves_patch_verbatim() {
        let json = r#"{"type":"system","subtype":"task_updated","task_id":"task_77","patch":[{"op":"replace","path":"/status","value":"running"}],"uuid":"evt-1"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::System { subtype, extra, .. } => {
                assert_eq!(subtype.as_deref(), Some("task_updated"));
                assert_eq!(extra.get("task_id").and_then(|v| v.as_str()), Some("task_77"));
                let patch = extra.get("patch").expect("patch present");
                assert!(patch.is_array(), "patch should be forwarded as-is");
                assert_eq!(patch[0]["op"], "replace");
                assert_eq!(patch[0]["path"], "/status");
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn task_notification_serializes_with_snake_case_tag() {
        let fe = FrontendEvent::TaskNotification {
            session_id: "s1".into(),
            tool_use_id: "toolu_agent_1".into(),
            task_id: "task_42".into(),
            status: "completed".into(),
            summary: Some("Done".into()),
            output_file: Some("/tmp/o.txt".into()),
            usage: None,
        };
        let v = serde_json::to_value(&fe).unwrap();
        assert_eq!(v["type"], "task_notification");
        assert_eq!(v["session_id"], "s1");
        assert_eq!(v["task_id"], "task_42");
        assert_eq!(v["tool_use_id"], "toolu_agent_1");
        assert_eq!(v["status"], "completed");
        assert_eq!(v["summary"], "Done");
        assert_eq!(v["output_file"], "/tmp/o.txt");
        // `usage: None` should be omitted per skip_serializing_if.
        assert!(v.get("usage").is_none(), "usage should be omitted when None");
    }

    #[test]
    fn task_updated_serializes_with_snake_case_tag() {
        let patch = serde_json::json!([{"op":"add","path":"/todos/-","value":"x"}]);
        let fe = FrontendEvent::TaskUpdated {
            session_id: "s1".into(),
            task_id: "task_77".into(),
            patch: patch.clone(),
        };
        let v = serde_json::to_value(&fe).unwrap();
        assert_eq!(v["type"], "task_updated");
        assert_eq!(v["task_id"], "task_77");
        assert_eq!(v["patch"], patch);
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

    // ── classify_permission_mode additional cases ──

    #[test]
    fn classify_bypass_permissions_mapped_explicitly() {
        // `bypassPermissions` is a real CLI permission-mode value as of
        // Claude Code 2.1.x — it must not fall through to Normal.
        assert_eq!(
            classify_permission_mode("bypassPermissions"),
            SessionMode::BypassPermissions,
        );
    }

    #[test]
    fn classify_case_sensitive() {
        // "Plan" (capitalized) is not the same as "plan"
        assert_eq!(classify_permission_mode("Plan"), SessionMode::Normal);
        assert_eq!(classify_permission_mode("AcceptEdits"), SessionMode::Normal);
    }

    // ── extract_thinking_effort additional cases ──

    #[test]
    fn extract_thinking_effort_non_string_value_returns_none() {
        let extra = serde_json::json!({
            "thinking": { "effort": 42 }
        });
        // effort is a number, not a string — as_str() returns None
        assert!(extract_thinking_effort(&extra).is_none());
    }

    #[test]
    fn extract_thinking_effort_fallback_chain() {
        // Only flat `effort` key present — should use the second fallback
        let extra = serde_json::json!({
            "thinking": { "other": "data" },
            "effort": "medium"
        });
        assert_eq!(extract_thinking_effort(&extra).as_deref(), Some("medium"));

        // Only `thinking_effort` present — should use the third fallback
        let extra2 = serde_json::json!({
            "thinking": { "other": "data" },
            "thinking_effort": "low"
        });
        assert_eq!(extract_thinking_effort(&extra2).as_deref(), Some("low"));
    }

    #[test]
    fn extract_thinking_effort_empty_string_is_some() {
        let extra = serde_json::json!({
            "thinking": { "effort": "" }
        });
        // Empty string is still a valid string
        assert_eq!(extract_thinking_effort(&extra).as_deref(), Some(""));
    }

    // ── should_emit_rate_limit_warning additional cases ──

    #[test]
    fn rate_limit_warning_utilization_none_defaults_to_zero() {
        let info = RateLimitInfo {
            status: None,
            resets_at: None,
            utilization: None, // defaults to 0.0 via unwrap_or
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
            extra: Default::default(),
        };
        assert!(!should_emit_rate_limit_warning(&info));
    }

    #[test]
    fn rate_limit_warning_at_full_utilization() {
        let info = RateLimitInfo {
            status: None,
            resets_at: None,
            utilization: Some(1.0),
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
            extra: Default::default(),
        };
        assert!(should_emit_rate_limit_warning(&info));
    }

    #[test]
    fn rate_limit_warning_status_allowed_is_not_warning() {
        let info = RateLimitInfo {
            status: Some("allowed".to_string()),
            resets_at: None,
            utilization: Some(0.5),
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
            extra: Default::default(),
        };
        assert!(!should_emit_rate_limit_warning(&info));
    }

    #[test]
    fn rate_limit_warning_both_triggers_active() {
        // Both high utilization AND allowed_warning status
        let info = RateLimitInfo {
            status: Some("allowed_warning".to_string()),
            resets_at: None,
            utilization: Some(0.95),
            rate_limit_type: None,
            overage_status: None,
            overage_disabled_reason: None,
            is_using_overage: None,
            extra: Default::default(),
        };
        assert!(should_emit_rate_limit_warning(&info));
    }

    // ── tool_result_content_to_string additional cases ──

    #[test]
    fn tool_result_content_bool() {
        let content = Some(serde_json::json!(true));
        assert_eq!(tool_result_content_to_string(&content).as_deref(), Some("true"));
    }

    #[test]
    fn tool_result_content_null() {
        let content = Some(serde_json::Value::Null);
        assert_eq!(tool_result_content_to_string(&content).as_deref(), Some("null"));
    }

    #[test]
    fn tool_result_content_empty_string() {
        let content = Some(serde_json::Value::String(String::new()));
        assert_eq!(tool_result_content_to_string(&content).as_deref(), Some(""));
    }

    // ── extract_model_usage_info additional cases ──

    #[test]
    fn extract_model_usage_with_multiple_models_uses_first() {
        // HashMap iteration order isn't guaranteed, but the function takes iter().next()
        let model_usage = Some(serde_json::json!({
            "model-a": { "contextWindow": 100000 }
        }));
        let (name, cw, _mot) = extract_model_usage_info(&model_usage);
        assert_eq!(name.as_deref(), Some("model-a"));
        assert_eq!(cw, Some(100000));
    }

    #[test]
    fn extract_model_usage_inner_not_object() {
        // Value is a string instead of an object with context info
        let model_usage = Some(serde_json::json!({
            "sonnet": "not_an_object"
        }));
        let (name, cw, mot) = extract_model_usage_info(&model_usage);
        assert_eq!(name.as_deref(), Some("sonnet"));
        assert!(cw.is_none());
        assert!(mot.is_none());
    }

    // ── terminal_reason & interrupt handling (P0/P2) ──

    #[test]
    fn result_with_terminal_reason_parses() {
        let json = r#"{"type":"result","subtype":"success","duration_ms":5000,"terminal_reason":"completed","stop_reason":"end_turn"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Result { terminal_reason, stop_reason, .. } => {
                assert_eq!(terminal_reason.as_deref(), Some("completed"));
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn interrupted_result_has_aborted_streaming_terminal_reason() {
        // Matches real CLI v2.1.101 interrupt output
        let json = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"terminal_reason":"aborted_streaming","duration_ms":2878,"num_turns":2,"stop_reason":null}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Result { is_error, terminal_reason, stop_reason, .. } => {
                assert_eq!(*is_error, Some(true));
                assert_eq!(terminal_reason.as_deref(), Some("aborted_streaming"));
                assert!(stop_reason.is_none());
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn result_without_terminal_reason_still_parses() {
        // Pre-v2.1.101 result events don't have terminal_reason
        let json = r#"{"type":"result","subtype":"success","duration_ms":1000}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match &event {
            RawStreamEvent::Result { terminal_reason, .. } => {
                assert!(terminal_reason.is_none());
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    // ── UsageInfo iterations (P3a) ──

    #[test]
    fn usage_info_with_iterations_deserializes() {
        let json = r#"{
            "input_tokens": 3,
            "output_tokens": 4,
            "cache_read_input_tokens": 12047,
            "cache_creation_input_tokens": 5146,
            "iterations": [
                {
                    "input_tokens": 3,
                    "output_tokens": 4,
                    "cache_read_input_tokens": 12047,
                    "cache_creation_input_tokens": 5146,
                    "type": "message"
                }
            ]
        }"#;
        let usage: crate::agents::claude_code::event_types::UsageInfo = serde_json::from_str(json).unwrap();
        assert_eq!(usage.input_tokens, Some(3));
        let iters = usage.iterations.unwrap();
        assert_eq!(iters.len(), 1);
        assert_eq!(iters[0].input_tokens, Some(3));
        assert_eq!(iters[0].output_tokens, Some(4));
        assert_eq!(iters[0].iteration_type.as_deref(), Some("message"));
    }

    #[test]
    fn usage_info_without_iterations_deserializes() {
        let json = r#"{"input_tokens": 500, "output_tokens": 200}"#;
        let usage: crate::agents::claude_code::event_types::UsageInfo = serde_json::from_str(json).unwrap();
        assert_eq!(usage.input_tokens, Some(500));
        assert!(usage.iterations.is_none());
    }

    #[test]
    fn usage_info_with_empty_iterations_deserializes() {
        let json = r#"{"input_tokens": 500, "output_tokens": 200, "iterations": []}"#;
        let usage: crate::agents::claude_code::event_types::UsageInfo = serde_json::from_str(json).unwrap();
        let iters = usage.iterations.unwrap();
        assert!(iters.is_empty());
    }

    #[test]
    fn usage_info_iterations_skipped_when_none_in_serialization() {
        let usage = crate::agents::claude_code::event_types::UsageInfo {
            input_tokens: Some(100),
            output_tokens: Some(50),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            service_tier: None,
            server_tool_use: None,
            iterations: None,
        };
        let val = serde_json::to_value(&usage).unwrap();
        assert!(val.get("iterations").is_none(), "iterations should be omitted when None");
    }
}
