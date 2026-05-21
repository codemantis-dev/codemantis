//! Codex `ThreadEvent` → [`NormalizedEvent`] translator.
//!
//! The Codex `codex app-server --listen stdio://` protocol streams a mix of
//! JSON-RPC notifications (`turn/started`, `item/*`, `error`) and
//! server-initiated requests (the four `*/requestApproval` kinds). This
//! module owns the **notification** side of that — turning each Codex
//! notification into 0..n [`NormalizedEvent`]s that match what the
//! frontend already knows how to render for Claude.
//!
//! The approval-request side lives in
//! [`crate::agents::codex::approvals`].
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §2.4.4 (item mapping table), §2.4.7 (error mapping).
//!
//! Defensive parsing: every field is fetched with `value.get(…)` rather
//! than struct deserialization so a single missing field (Codex's wire is
//! still evolving) downgrades to a no-op or a `ProcessError` instead of
//! poisoning the whole session.

#![allow(dead_code)] // S4 wires this into the spawn loop.

use std::sync::Arc;

use serde_json::Value;

use super::thread_state::{ItemBuffer, ThreadState};
use crate::agents::{AgentId, NormalizedEvent, PermissionDenial};

/// Translator for one Codex thread. Cheap to clone — every method takes
/// `&self`, mutation is funneled through the inner `ThreadState`.
#[derive(Clone)]
pub struct Translator {
    /// Always [`AgentId::Codex`]. Plumbed for parity with how the Claude
    /// translator carries an `agent_id`.
    pub agent_id: AgentId,
    /// CodeMantis session id (UUID), not Codex's thread id. Stamped onto
    /// every emitted event so the frontend can correlate to a tab.
    pub session_id: String,
    /// Per-thread accumulators (current turn, item buffers, pending
    /// server-initiated approvals).
    pub state: Arc<ThreadState>,
}

impl Translator {
    pub fn new(session_id: String, state: Arc<ThreadState>) -> Self {
        Self {
            agent_id: AgentId::Codex,
            session_id,
            state,
        }
    }

    /// Top-level dispatch. Given a Codex JSON-RPC notification, produce
    /// the zero-or-more frontend events to emit. Returns an empty `Vec` for
    /// uninteresting events (`turn/started`, `userMessage` echo, …) so the
    /// caller can fire-and-forget the result of every notification.
    pub async fn on_notification(&self, method: &str, params: Value) -> Vec<NormalizedEvent> {
        match method {
            "thread/started" => self.on_thread_started(params).await,
            "thread/closed" | "thread/archived" => Vec::new(),
            "turn/started" => self.on_turn_started(params).await,
            "turn/completed" => self.on_turn_completed(params).await,
            "item/started" => self.on_item_started(params).await,
            "item/completed" => self.on_item_completed(params).await,
            // The most common delta channels per spec §2.4.4. Treat anything
            // we don't recognise as a no-op so an upgraded Codex doesn't
            // crash the dispatcher.
            "item/agentMessage/delta" => self.on_agent_message_delta(params).await,
            "item/reasoning/summaryTextDelta"
            | "item/reasoning/textDelta"
            | "item/reasoning/summaryPartAdded" => self.on_reasoning_delta(params).await,
            "item/commandExecution/outputDelta" => self.on_command_output_delta(params).await,
            "error" => self.map_error(params),
            // Unknown notification — log and swallow (S4 wires the logger).
            _ => Vec::new(),
        }
    }

    // ── Lifecycle ──

    async fn on_thread_started(&self, params: Value) -> Vec<NormalizedEvent> {
        let thread = params.get("thread").cloned().unwrap_or(params);
        let Some(tid) = thread
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::to_string)
        else {
            return Vec::new();
        };
        self.state.set_thread_id(tid.clone()).await;
        vec![NormalizedEvent::CliSessionId {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            cli_session_id: tid,
        }]
    }

    async fn on_turn_started(&self, params: Value) -> Vec<NormalizedEvent> {
        // Spec §2.4.4: turn/started carries no UI-relevant payload — its
        // job is just to advance state. Record the active turn id so a
        // later turn/interrupt knows what to cancel.
        let turn_id = params
            .get("turn")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        self.state.set_current_turn(turn_id).await;
        Vec::new()
    }

    async fn on_turn_completed(&self, params: Value) -> Vec<NormalizedEvent> {
        // Always clear the active turn — even if the turn was interrupted
        // or failed, it is no longer the target of turn/interrupt.
        self.state.set_current_turn(None).await;

        let turn = params.get("turn").unwrap_or(&params);
        let status = turn
            .get("status")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        // Surface interrupts as TurnComplete (same as Claude, spec §2.9
        // "Turn-end semantics") with a terminal_reason hint. The frontend
        // turn-complete handler already special-cases the interrupted path.
        let terminal_reason = match status.as_deref() {
            Some("interrupted") => Some("aborted_streaming".to_string()),
            Some("failed") => Some("turn_failed".to_string()),
            _ => None,
        };

        let usage = turn
            .get("usage")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok());

        let duration_ms = turn.get("durationMs").and_then(|v| v.as_u64());
        let duration_api_ms = turn.get("durationApiMs").and_then(|v| v.as_u64());

        vec![NormalizedEvent::TurnComplete {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            duration_ms,
            usage,
            cost_usd: turn.get("costUsd").and_then(|v| v.as_f64()),
            duration_api_ms,
            num_turns: None,
            stop_reason: status,
            terminal_reason,
            model_name: turn
                .get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            context_window: turn.get("contextWindow").and_then(|v| v.as_u64()),
            max_output_tokens: turn.get("maxOutputTokens").and_then(|v| v.as_u64()),
        }]
    }

    // ── Items ──

    async fn on_item_started(&self, params: Value) -> Vec<NormalizedEvent> {
        let item = params.get("item").cloned().unwrap_or(params);
        let Some(item_type) = item.get("type").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };
        let Some(item_id) = item.get("id").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };

        // Buffer the snapshot so item/completed can reference it for
        // streaming items.
        {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.insert(item_id.clone(), ItemBuffer::from_snapshot(item.clone()));
        }

        match item_type.as_str() {
            // Internal echo of the user's input — not surfaced.
            "userMessage" => Vec::new(),
            // Streaming text: no event on start; the delta channel does
            // the work. item/completed emits TextComplete with the final
            // text.
            "agentMessage" | "reasoning" => Vec::new(),

            "commandExecution" => {
                let command = item
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let cwd = item.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: "Bash".to_string(),
                    tool_input: serde_json::json!({"command": command, "cwd": cwd}),
                }]
            }

            "fileChange" => {
                let path = item.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let diff = item.get("diff").cloned().unwrap_or(Value::Null);
                // Codex doesn't distinguish Write vs. Edit at the item
                // level; we use "Edit" as the more common case (matches
                // Claude's Edit tool semantics for incremental changes).
                let tool_name = if item
                    .get("changeKind")
                    .and_then(|v| v.as_str())
                    == Some("create")
                {
                    "Write"
                } else {
                    "Edit"
                };
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: tool_name.to_string(),
                    tool_input: serde_json::json!({"path": path, "diff": diff}),
                }]
            }

            "mcpToolCall" => {
                let server = item.get("serverName").and_then(|v| v.as_str()).unwrap_or("?");
                let tool = item.get("toolName").and_then(|v| v.as_str()).unwrap_or("?");
                let args = item.get("arguments").cloned().unwrap_or(Value::Null);
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: format!("MCP:{server}:{tool}"),
                    tool_input: args,
                }]
            }

            "webSearch" => {
                let query = item.get("query").and_then(|v| v.as_str()).unwrap_or("");
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: "WebSearch".to_string(),
                    tool_input: serde_json::json!({"query": query}),
                }]
            }

            "imageView" => {
                let file = item.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: "Read".to_string(),
                    tool_input: serde_json::json!({"file_path": file}),
                }]
            }

            "contextCompaction" => vec![NormalizedEvent::CompactingStatus {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                is_compacting: true,
            }],

            // Out-of-scope item types per spec §2.4.4 (plan, review modes,
            // collabToolCall) — silently dropped.
            _ => Vec::new(),
        }
    }

    async fn on_item_completed(&self, params: Value) -> Vec<NormalizedEvent> {
        let item = params.get("item").cloned().unwrap_or(params);
        let Some(item_type) = item.get("type").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };
        let Some(item_id) = item.get("id").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };
        let status = item
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("completed")
            .to_string();

        // Pop the buffer so we don't leak memory; for streaming items the
        // accumulated text is the authoritative fallback if the item
        // snapshot lacks a final `text` field.
        let buffer = {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.remove(&item_id)
        };

        match item_type.as_str() {
            "agentMessage" => {
                let full = item
                    .get("text")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| buffer.as_ref().map(|b| b.text.clone()))
                    .unwrap_or_default();
                vec![NormalizedEvent::TextComplete {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    full_text: full,
                }]
            }

            "reasoning" => {
                let full = item
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .or_else(|| item.get("text").and_then(|v| v.as_str()))
                    .map(str::to_string)
                    .or_else(|| buffer.as_ref().map(|b| b.text.clone()))
                    .unwrap_or_default();
                vec![NormalizedEvent::ThinkingComplete {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    full_thinking: full,
                }]
            }

            "commandExecution"
            | "fileChange"
            | "mcpToolCall"
            | "webSearch"
            | "imageView" => {
                let content = item
                    .get("aggregatedOutput")
                    .or_else(|| item.get("output"))
                    .or_else(|| item.get("result"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let is_error = status != "completed";
                vec![NormalizedEvent::ToolResult {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    content,
                    is_error,
                }]
            }

            "contextCompaction" => {
                let pre_tokens = item.get("preTokens").and_then(|v| v.as_u64());
                vec![NormalizedEvent::CompactComplete {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    trigger: "auto".to_string(),
                    pre_tokens,
                }]
            }

            _ => Vec::new(),
        }
    }

    // ── Streaming deltas ──

    async fn on_agent_message_delta(&self, params: Value) -> Vec<NormalizedEvent> {
        let item_id = params
            .get("itemId")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let delta = params
            .get("delta")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if delta.is_empty() {
            return Vec::new();
        }
        if let Some(id) = &item_id {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.entry(id.clone()).or_default().append_delta(&delta);
        }
        vec![NormalizedEvent::TextDelta {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            text: delta,
        }]
    }

    async fn on_reasoning_delta(&self, params: Value) -> Vec<NormalizedEvent> {
        let item_id = params
            .get("itemId")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        // Codex sends one of several delta shapes here; tolerate any of
        // them by trying the documented field names in order.
        let delta = params
            .get("delta")
            .or_else(|| params.get("text"))
            .or_else(|| params.get("summaryPart"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if delta.is_empty() {
            return Vec::new();
        }
        if let Some(id) = &item_id {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.entry(id.clone()).or_default().append_delta(&delta);
        }
        vec![NormalizedEvent::ThinkingDelta {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            thinking: delta,
        }]
    }

    async fn on_command_output_delta(&self, params: Value) -> Vec<NormalizedEvent> {
        let item_id = params
            .get("itemId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let elapsed_seconds = params
            .get("elapsedSeconds")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        vec![NormalizedEvent::ToolProgress {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            tool_use_id: item_id,
            tool_name: "Bash".to_string(),
            elapsed_seconds,
        }]
    }

    // ── Errors (spec §2.4.7) ──

    /// Map a Codex `error` notification onto one or more frontend events.
    /// The classifier is structural: it reads `error.codexErrorInfo.type`
    /// (when present) and falls back to a generic `ProcessError` for
    /// anything unrecognised.
    pub fn map_error(&self, params: Value) -> Vec<NormalizedEvent> {
        let error = params.get("error").unwrap_or(&params);
        let info_type = error
            .get("codexErrorInfo")
            .and_then(|i| i.get("type"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Codex error")
            .to_string();

        match info_type.as_deref() {
            Some("ContextWindowExceeded") | Some("UsageLimitExceeded") => {
                // Reuse the existing context-warning UI: utilization 1.0
                // says "you're out", and the existing toast renders it.
                vec![NormalizedEvent::RateLimitWarning {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    utilization: 1.0,
                    resets_at: None,
                    rate_limit_type: info_type,
                    overage_status: None,
                    is_using_overage: None,
                }]
            }
            Some("Unauthorized") => vec![NormalizedEvent::ProcessError {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                error: format!(
                    "Codex authentication expired. Run `codex login` in a terminal, then retry. ({message})"
                ),
            }],
            Some("SandboxError") => {
                // Synthesize a ProtectedPathDeny so the frontend's
                // protected-path toast (chat.ts:213-275) picks it up.
                let path = error
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                vec![NormalizedEvent::ProtectedPathDeny {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    denials: vec![PermissionDenial {
                        tool_name: "Write".to_string(),
                        tool_use_id: error
                            .get("itemId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        tool_input: serde_json::json!({"file_path": path}),
                    }],
                }]
            }
            _ => vec![NormalizedEvent::ProcessError {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                error: message,
            }],
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn translator() -> Translator {
        Translator::new("s1".into(), Arc::new(ThreadState::new()))
    }

    fn extract_session_id(ev: &NormalizedEvent) -> &str {
        // Helper for tests: every variant carries a session_id; serde to
        // value to extract uniformly.
        let v = serde_json::to_value(ev).unwrap();
        v["session_id"].as_str().unwrap_or("").to_string().leak()
    }

    // ── lifecycle ──

    #[tokio::test]
    async fn thread_started_emits_cli_session_id_and_stores_thread_id() {
        let t = translator();
        let events = t
            .on_notification(
                "thread/started",
                json!({"thread": {"id": "thr_abc", "path": null}}),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::CliSessionId { cli_session_id, agent_id, .. } => {
                assert_eq!(cli_session_id, "thr_abc");
                assert_eq!(*agent_id, AgentId::Codex);
            }
            other => panic!("expected CliSessionId, got {:?}", other),
        }
        assert_eq!(
            t.state.thread_id.lock().await.as_deref(),
            Some("thr_abc")
        );
    }

    #[tokio::test]
    async fn turn_started_records_turn_id_and_emits_nothing() {
        let t = translator();
        let events = t
            .on_notification("turn/started", json!({"turn": {"id": "turn_1"}}))
            .await;
        assert!(events.is_empty());
        assert_eq!(
            t.state.current_turn_id.lock().await.as_deref(),
            Some("turn_1")
        );
    }

    #[tokio::test]
    async fn turn_completed_emits_turn_complete_and_clears_active_turn() {
        let t = translator();
        t.state.set_current_turn(Some("turn_1".into())).await;
        let events = t
            .on_notification(
                "turn/completed",
                json!({"turn": {"id": "turn_1", "status": "completed", "model": "gpt-5.1-codex", "durationMs": 1234}}),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::TurnComplete {
                stop_reason,
                model_name,
                duration_ms,
                terminal_reason,
                ..
            } => {
                assert_eq!(stop_reason.as_deref(), Some("completed"));
                assert_eq!(model_name.as_deref(), Some("gpt-5.1-codex"));
                assert_eq!(*duration_ms, Some(1234));
                assert!(terminal_reason.is_none());
            }
            other => panic!("expected TurnComplete, got {:?}", other),
        }
        assert!(t.state.current_turn_id.lock().await.is_none());
    }

    #[tokio::test]
    async fn interrupted_turn_marks_terminal_reason() {
        let t = translator();
        let events = t
            .on_notification(
                "turn/completed",
                json!({"turn": {"id": "t", "status": "interrupted"}}),
            )
            .await;
        let NormalizedEvent::TurnComplete { terminal_reason, .. } = &events[0] else {
            panic!("not TurnComplete");
        };
        assert_eq!(terminal_reason.as_deref(), Some("aborted_streaming"));
    }

    // ── item/started ──

    #[tokio::test]
    async fn user_message_item_emits_nothing() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "userMessage", "id": "i_1"}}),
            )
            .await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn agent_message_started_buffers_but_emits_nothing() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "agentMessage", "id": "i_2"}}),
            )
            .await;
        assert!(events.is_empty());
        let buffers = t.state.item_buffers.lock().await;
        assert!(buffers.contains_key("i_2"));
    }

    #[tokio::test]
    async fn command_execution_started_emits_bash_tool_use() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "commandExecution",
                    "id": "i_cmd",
                    "command": "ls -la",
                    "cwd": "/tmp"
                }}),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::ToolUseStart {
                tool_name,
                tool_input,
                tool_use_id,
                ..
            } => {
                assert_eq!(tool_name, "Bash");
                assert_eq!(tool_use_id, "i_cmd");
                assert_eq!(tool_input["command"], "ls -la");
                assert_eq!(tool_input["cwd"], "/tmp");
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn file_change_create_uses_write_tool() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "fileChange",
                    "id": "i_fc",
                    "path": "/p/new.rs",
                    "changeKind": "create",
                    "diff": {"added": ["fn main(){}"]},
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } => {
                assert_eq!(tool_name, "Write");
                assert_eq!(tool_input["path"], "/p/new.rs");
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn file_change_default_uses_edit_tool() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "fileChange", "id": "i_e", "path": "/p/x"}}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(tool_name, "Edit");
    }

    #[tokio::test]
    async fn mcp_tool_call_namespaces_tool_name() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "mcpToolCall",
                    "id": "i_m",
                    "serverName": "context7",
                    "toolName": "query-docs",
                    "arguments": {"q": "tauri"}
                }}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(tool_name, "MCP:context7:query-docs");
        assert_eq!(tool_input["q"], "tauri");
    }

    #[tokio::test]
    async fn web_search_emits_websearch_tool_use() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "webSearch", "id": "i_w", "query": "rust async-trait"}}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(tool_name, "WebSearch");
        assert_eq!(tool_input["query"], "rust async-trait");
    }

    #[tokio::test]
    async fn image_view_emits_read_tool_use() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "imageView", "id": "i_iv", "filePath": "/tmp/a.png"}}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(tool_name, "Read");
        assert_eq!(tool_input["file_path"], "/tmp/a.png");
    }

    #[tokio::test]
    async fn context_compaction_started_emits_compacting_status() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "contextCompaction", "id": "i_cc"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::CompactingStatus { is_compacting, .. } => {
                assert!(*is_compacting);
            }
            other => panic!("expected CompactingStatus, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn item_started_unknown_type_is_no_op() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "plan", "id": "i_p"}}),
            )
            .await;
        assert!(events.is_empty());
    }

    // ── deltas ──

    #[tokio::test]
    async fn agent_message_delta_emits_text_delta_and_buffers() {
        let t = translator();
        let events = t
            .on_notification(
                "item/agentMessage/delta",
                json!({"itemId": "i_2", "delta": "hello"}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::TextDelta { text, .. } => assert_eq!(text, "hello"),
            other => panic!("expected TextDelta, got {:?}", other),
        }
        let buffers = t.state.item_buffers.lock().await;
        assert_eq!(buffers.get("i_2").unwrap().text, "hello");
    }

    #[tokio::test]
    async fn empty_delta_is_dropped() {
        let t = translator();
        let events = t
            .on_notification(
                "item/agentMessage/delta",
                json!({"itemId": "i_2", "delta": ""}),
            )
            .await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn reasoning_delta_uses_thinking_delta() {
        let t = translator();
        let events = t
            .on_notification(
                "item/reasoning/summaryTextDelta",
                json!({"itemId": "i_r", "delta": "thought"}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ThinkingDelta { thinking, .. } => assert_eq!(thinking, "thought"),
            other => panic!("expected ThinkingDelta, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn command_output_delta_emits_tool_progress() {
        let t = translator();
        let events = t
            .on_notification(
                "item/commandExecution/outputDelta",
                json!({"itemId": "i_cmd", "elapsedSeconds": 1.5, "chunk": "stdout"}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolProgress {
                tool_use_id,
                tool_name,
                elapsed_seconds,
                ..
            } => {
                assert_eq!(tool_use_id, "i_cmd");
                assert_eq!(tool_name, "Bash");
                assert!((*elapsed_seconds - 1.5).abs() < f64::EPSILON);
            }
            other => panic!("expected ToolProgress, got {:?}", other),
        }
    }

    // ── item/completed ──

    #[tokio::test]
    async fn agent_message_completed_emits_text_complete_with_full_text() {
        let t = translator();
        // Stream three deltas, then complete with explicit final text.
        t.on_notification("item/agentMessage/delta", json!({"itemId": "i_2", "delta": "a"})).await;
        t.on_notification("item/agentMessage/delta", json!({"itemId": "i_2", "delta": "b"})).await;
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {"type": "agentMessage", "id": "i_2", "text": "ab"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::TextComplete { full_text, .. } => assert_eq!(full_text, "ab"),
            other => panic!("expected TextComplete, got {:?}", other),
        }
        // Buffer should be cleared.
        assert!(t.state.item_buffers.lock().await.get("i_2").is_none());
    }

    #[tokio::test]
    async fn agent_message_completed_falls_back_to_buffered_text() {
        let t = translator();
        t.on_notification("item/agentMessage/delta", json!({"itemId": "i_2", "delta": "via-buffer"}))
            .await;
        // Snapshot lacks final `text` field — translator must use the
        // accumulated buffer.
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {"type": "agentMessage", "id": "i_2"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::TextComplete { full_text, .. } => {
                assert_eq!(full_text, "via-buffer")
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn command_execution_completed_marks_is_error_on_non_completed_status() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "commandExecution",
                    "id": "i_cmd",
                    "status": "failed",
                    "aggregatedOutput": "permission denied",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolResult {
                tool_use_id,
                content,
                is_error,
                ..
            } => {
                assert_eq!(tool_use_id, "i_cmd");
                assert_eq!(content.as_deref(), Some("permission denied"));
                assert!(*is_error);
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn command_execution_completed_clear_is_error_on_completed_status() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "commandExecution",
                    "id": "i_ok",
                    "status": "completed",
                    "aggregatedOutput": "total 0",
                }}),
            )
            .await;
        let NormalizedEvent::ToolResult { is_error, .. } = &events[0] else {
            panic!()
        };
        assert!(!*is_error);
    }

    #[tokio::test]
    async fn context_compaction_completed_emits_compact_complete() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {"type": "contextCompaction", "id": "i_cc", "preTokens": 1234}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::CompactComplete {
                trigger,
                pre_tokens,
                ..
            } => {
                assert_eq!(trigger, "auto");
                assert_eq!(*pre_tokens, Some(1234));
            }
            other => panic!("got {:?}", other),
        }
    }

    // ── errors ──

    #[tokio::test]
    async fn error_context_window_exceeded_emits_rate_limit_warning() {
        let t = translator();
        let events = t
            .on_notification(
                "error",
                json!({"error": {
                    "message": "out of context",
                    "codexErrorInfo": {"type": "ContextWindowExceeded"},
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::RateLimitWarning {
                utilization,
                rate_limit_type,
                ..
            } => {
                assert!((utilization - 1.0).abs() < f64::EPSILON);
                assert_eq!(rate_limit_type.as_deref(), Some("ContextWindowExceeded"));
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_unauthorized_emits_process_error_with_login_hint() {
        let t = translator();
        let events = t
            .on_notification(
                "error",
                json!({"error": {
                    "message": "token expired",
                    "codexErrorInfo": {"type": "Unauthorized"},
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ProcessError { error, .. } => {
                assert!(error.contains("codex login"), "got: {error}");
                assert!(error.contains("token expired"));
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_sandbox_synthesises_protected_path_deny() {
        let t = translator();
        let events = t
            .on_notification(
                "error",
                json!({"error": {
                    "message": "blocked",
                    "path": ".codex/forbidden",
                    "itemId": "i_x",
                    "codexErrorInfo": {"type": "SandboxError"},
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ProtectedPathDeny { denials, .. } => {
                assert_eq!(denials.len(), 1);
                assert_eq!(denials[0].tool_name, "Write");
                assert_eq!(denials[0].tool_input["file_path"], ".codex/forbidden");
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_unknown_kind_emits_generic_process_error() {
        let t = translator();
        let events = t
            .on_notification(
                "error",
                json!({"error": {"message": "wat"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ProcessError { error, .. } => assert_eq!(error, "wat"),
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn unknown_notification_method_is_silently_ignored() {
        let t = translator();
        let events = t.on_notification("future/event", json!({})).await;
        assert!(events.is_empty());
    }

    // ── general ──

    #[tokio::test]
    async fn every_emitted_event_carries_codex_agent_id() {
        // Sample one from each emit-path to catch typos in agent_id.
        let t = translator();
        for events in [
            t.on_notification("thread/started", json!({"thread": {"id": "thr_1"}})).await,
            t.on_notification("item/started", json!({"item": {"type": "commandExecution", "id": "i", "command": "x", "cwd": "/"}})).await,
            t.on_notification("item/agentMessage/delta", json!({"itemId": "i", "delta": "y"})).await,
            t.on_notification("error", json!({"error": {"message": "z"}})).await,
        ] {
            for ev in &events {
                let v = serde_json::to_value(ev).unwrap();
                assert_eq!(v["agent_id"], "codex", "wrong agent_id on {:?}", ev);
            }
        }
        let _ = extract_session_id; // silence dead-code lint on the helper
    }
}
