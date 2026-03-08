use crate::claude::event_types::{ContentBlock, FrontendEvent, RawStreamEvent, StreamDelta};
use log::debug;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

const AUTO_APPROVED_TOOLS: &[&str] = &["Read", "Glob", "Grep"];

pub async fn route_events(
    app_handle: AppHandle,
    session_id: String,
    mut receiver: mpsc::UnboundedReceiver<RawStreamEvent>,
) {
    let chat_event = format!("claude-chat-{}", session_id);
    let activity_event = format!("claude-activity-{}", session_id);
    let _approval_event = format!("claude-approval-{}", session_id);

    let mut accumulated_text = String::new();

    while let Some(event) = receiver.recv().await {
        match event {
            RawStreamEvent::System {
                model, subtype, ..
            } => {
                if subtype.as_deref() == Some("init") {
                    let fe = FrontendEvent::SessionInit {
                        session_id: session_id.clone(),
                        model,
                    };
                    let _ = app_handle.emit(&chat_event, &fe);
                }
            }

            RawStreamEvent::Assistant { message, .. } => {
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
                                let fe = FrontendEvent::ToolUseStart {
                                    session_id: session_id.clone(),
                                    tool_use_id: id.clone(),
                                    tool_name: name.clone(),
                                    tool_input: input.clone(),
                                };
                                let _ = app_handle.emit(&activity_event, &fe);

                                if !AUTO_APPROVED_TOOLS.contains(&name.as_str()) {
                                    let approval_fe = FrontendEvent::ToolUseStart {
                                        session_id: session_id.clone(),
                                        tool_use_id: id.clone(),
                                        tool_name: name.clone(),
                                        tool_input: input.clone(),
                                    };
                                    let _ = app_handle
                                        .emit(&_approval_event, &approval_fe);
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

            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                if let Some(StreamDelta::TextDelta { text }) = delta {
                    accumulated_text.push_str(&text);
                    let fe = FrontendEvent::TextDelta {
                        session_id: session_id.clone(),
                        text,
                    };
                    let _ = app_handle.emit(&chat_event, &fe);
                }
            }

            RawStreamEvent::ContentBlockStart { content_block, .. } => {
                if let Some(block) = content_block {
                    match block {
                        ContentBlock::ToolUse { id, name, input } => {
                            let fe = FrontendEvent::ToolUseStart {
                                session_id: session_id.clone(),
                                tool_use_id: id.clone(),
                                tool_name: name.clone(),
                                tool_input: input.clone(),
                            };
                            let _ = app_handle.emit(&activity_event, &fe);

                            if !AUTO_APPROVED_TOOLS.contains(&name.as_str()) {
                                let _ = app_handle.emit(&_approval_event, &fe);
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

            RawStreamEvent::ContentBlockStop { .. } => {}

            RawStreamEvent::Result {
                duration_ms,
                usage,
                cost_usd,
                is_error,
                result,
                ..
            } => {
                if is_error == Some(true) {
                    let error_msg = result.unwrap_or_else(|| "Unknown error".to_string());
                    let fe = FrontendEvent::ProcessError {
                        session_id: session_id.clone(),
                        error: error_msg,
                    };
                    let _ = app_handle.emit(&chat_event, &fe);
                } else {
                    let fe = FrontendEvent::TurnComplete {
                        session_id: session_id.clone(),
                        duration_ms,
                        usage,
                        cost_usd,
                    };
                    let _ = app_handle.emit(&chat_event, &fe);
                }
                accumulated_text.clear();
            }

            RawStreamEvent::MessageStart { .. }
            | RawStreamEvent::MessageDelta { .. }
            | RawStreamEvent::MessageStop { .. }
            | RawStreamEvent::RateLimitEvent { .. } => {}

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

            RawStreamEvent::Unknown => {
                debug!("Received unhandled event type (message_start/delta/stop)");
            }
        }
    }

    debug!("Message router: channel closed for session {}", session_id);
}
