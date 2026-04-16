use serde::{Deserialize, Serialize};

// --- Incoming events from CLI stdout (NDJSON) ---
// These structs capture all JSON fields from the Claude CLI stream.
// Many fields are only needed for deserialization (serde flatten/catch-all).

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum RawStreamEvent {
    #[serde(rename = "system")]
    System {
        subtype: Option<String>,
        session_id: Option<String>,
        model: Option<String>,
        tools: Option<Vec<serde_json::Value>>,
        mcp_servers: Option<Vec<serde_json::Value>>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "assistant")]
    Assistant {
        message: AssistantMessage,
        session_id: Option<String>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "content_block_start")]
    ContentBlockStart {
        index: Option<u32>,
        content_block: Option<ContentBlock>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "content_block_delta")]
    ContentBlockDelta {
        index: Option<u32>,
        delta: Option<StreamDelta>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "content_block_stop")]
    ContentBlockStop {
        index: Option<u32>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "result")]
    Result {
        subtype: Option<String>,
        duration_ms: Option<u64>,
        session_id: Option<String>,
        result: Option<String>,
        #[serde(alias = "total_cost_usd")]
        cost_usd: Option<f64>,
        is_error: Option<bool>,
        usage: Option<UsageInfo>,
        num_turns: Option<u32>,
        duration_api_ms: Option<u64>,
        stop_reason: Option<String>,
        terminal_reason: Option<String>,
        #[serde(rename = "modelUsage")]
        model_usage: Option<serde_json::Value>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    // Anthropic API message-level events
    #[serde(rename = "message_start")]
    MessageStart {
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "message_delta")]
    MessageDelta {
        delta: Option<serde_json::Value>,
        usage: Option<UsageInfo>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "message_stop")]
    MessageStop {
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "rate_limit_event")]
    RateLimitEvent {
        rate_limit_info: Option<RateLimitInfo>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "tool_progress")]
    ToolProgress {
        tool_use_id: Option<String>,
        tool_name: Option<String>,
        elapsed_time_seconds: Option<f64>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "user")]
    User {
        message: Option<AssistantMessage>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(rename = "control_response")]
    ControlResponse {
        response: Option<serde_json::Value>,
        #[serde(flatten)]
        extra: serde_json::Value,
    },

    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct AssistantMessage {
    pub role: Option<String>,
    pub content: Option<Vec<ContentBlock>>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    pub usage: Option<UsageInfo>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text {
        text: String,
    },

    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: Option<serde_json::Value>,
        is_error: Option<bool>,
    },

    #[serde(rename = "thinking")]
    Thinking {
        #[serde(default)]
        thinking: String,
    },

    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum StreamDelta {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },

    #[serde(rename = "input_json_delta")]
    InputJsonDelta {
        partial_json: Option<String>,
    },

    #[serde(rename = "thinking_delta")]
    ThinkingDelta { thinking: String },

    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageInfo {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub service_tier: Option<String>,
    pub server_tool_use: Option<ServerToolUse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations: Option<Vec<UsageIteration>>,
}

/// Per-iteration token breakdown added in CLI v2.1.97+.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageIteration {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(rename = "type")]
    pub iteration_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerToolUse {
    pub web_search_requests: Option<u32>,
    pub web_fetch_requests: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitInfo {
    pub status: Option<String>,
    #[serde(rename = "resetsAt")]
    pub resets_at: Option<f64>,
    pub utilization: Option<f64>,
    #[serde(rename = "rateLimitType")]
    pub rate_limit_type: Option<String>,
    #[serde(rename = "overageStatus")]
    pub overage_status: Option<String>,
    #[serde(rename = "overageDisabledReason")]
    pub overage_disabled_reason: Option<String>,
    #[serde(rename = "isUsingOverage")]
    pub is_using_overage: Option<bool>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

// --- Outgoing events to the frontend ---

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum FrontendEvent {
    #[serde(rename = "session_init")]
    SessionInit {
        session_id: String,
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        thinking_effort: Option<String>,
    },

    #[serde(rename = "text_delta")]
    TextDelta {
        session_id: String,
        text: String,
    },

    #[serde(rename = "text_complete")]
    TextComplete {
        session_id: String,
        full_text: String,
    },

    #[serde(rename = "tool_use_start")]
    ToolUseStart {
        session_id: String,
        tool_use_id: String,
        tool_name: String,
        tool_input: serde_json::Value,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        session_id: String,
        tool_use_id: String,
        content: Option<String>,
        is_error: bool,
    },

    #[serde(rename = "turn_complete")]
    TurnComplete {
        session_id: String,
        duration_ms: Option<u64>,
        usage: Option<UsageInfo>,
        cost_usd: Option<f64>,
        duration_api_ms: Option<u64>,
        num_turns: Option<u32>,
        stop_reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        terminal_reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_name: Option<String>,
        context_window: Option<u64>,
        max_output_tokens: Option<u64>,
    },

    #[serde(rename = "cli_session_id")]
    CliSessionId {
        session_id: String,
        cli_session_id: String,
    },

    #[serde(rename = "process_error")]
    ProcessError {
        session_id: String,
        error: String,
    },

    #[serde(rename = "process_exited")]
    ProcessExited {
        session_id: String,
        exit_code: Option<i32>,
        stderr_tail: Option<String>,
        elapsed_ms: u64,
    },

    #[serde(rename = "compacting_status")]
    CompactingStatus {
        session_id: String,
        is_compacting: bool,
    },

    #[serde(rename = "compact_complete")]
    CompactComplete {
        session_id: String,
        trigger: String,
        pre_tokens: Option<u64>,
    },

    #[serde(rename = "tool_progress")]
    ToolProgress {
        session_id: String,
        tool_use_id: String,
        tool_name: String,
        elapsed_seconds: f64,
    },

    #[serde(rename = "rate_limit_warning")]
    RateLimitWarning {
        session_id: String,
        utilization: f64,
        resets_at: Option<f64>,
        rate_limit_type: Option<String>,
        overage_status: Option<String>,
        is_using_overage: Option<bool>,
    },

    /// Per-API-call usage emitted from `message_delta` events (authoritative final token counts).
    #[serde(rename = "usage_update")]
    UsageUpdate {
        session_id: String,
        usage: UsageInfo,
    },

    #[serde(rename = "interrupt_result")]
    InterruptResult {
        session_id: String,
        success: bool,
        error: Option<String>,
    },

    #[serde(rename = "model_changed")]
    ModelChanged {
        session_id: String,
        model: String,
        success: bool,
        error: Option<String>,
    },

    #[serde(rename = "capabilities_discovered")]
    CapabilitiesDiscovered {
        session_id: String,
        models: serde_json::Value,
        commands: serde_json::Value,
        agents: serde_json::Value,
        account: serde_json::Value,
        output_styles: serde_json::Value,
    },

    #[serde(rename = "agent_preparing")]
    AgentPreparing {
        session_id: String,
        tool_use_id: String,
    },

    #[serde(rename = "subagent_started")]
    SubAgentStarted {
        session_id: String,
        tool_use_id: String,
        description: String,
        subagent_type: String,
    },

    #[serde(rename = "subagent_progress")]
    SubAgentProgress {
        session_id: String,
        tool_use_id: String,
        tool_count: Option<u32>,
        token_count: Option<u32>,
        current_activity: Option<String>,
    },

    #[serde(rename = "subagent_complete")]
    SubAgentComplete {
        session_id: String,
        tool_use_id: String,
        tool_count: Option<u32>,
        token_count: Option<u32>,
    },

    #[serde(rename = "thinking_delta")]
    ThinkingDelta {
        session_id: String,
        thinking: String,
    },

    #[serde(rename = "thinking_complete")]
    ThinkingComplete {
        session_id: String,
        full_thinking: String,
    },
}

// --- Stdin messages to CLI ---

#[derive(Debug, Serialize)]
#[serde(tag = "subtype")]
pub enum ControlRequestPayload {
    #[serde(rename = "interrupt")]
    Interrupt,
    #[serde(rename = "set_model")]
    SetModel { model: String },
    #[serde(rename = "initialize")]
    Initialize,
    #[serde(rename = "set_permission_mode")]
    SetPermissionMode { mode: String },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum StdinMessage {
    #[serde(rename = "user")]
    User { message: StdinUserMessage },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        approved: bool,
    },
    #[serde(rename = "control_request")]
    ControlRequest {
        request_id: String,
        request: ControlRequestPayload,
    },
}

#[derive(Debug, Serialize)]
pub struct StdinUserMessage {
    pub role: String,
    pub content: String,
}

#[allow(dead_code)]
impl StdinMessage {
    pub fn new_user_message(content: &str) -> Self {
        StdinMessage::User {
            message: StdinUserMessage {
                role: "user".to_string(),
                content: content.to_string(),
            },
        }
    }

    pub fn new_tool_response(tool_use_id: &str, approved: bool) -> Self {
        StdinMessage::ToolResult {
            tool_use_id: tool_use_id.to_string(),
            approved,
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ──────────────────────────────────────────────────────────
    // RawStreamEvent DESERIALIZATION
    // ──────────────────────────────────────────────────────────

    #[test]
    fn deser_system_event_full() {
        let json = r#"{
            "type": "system",
            "subtype": "init",
            "session_id": "sess-42",
            "model": "claude-opus-4-7",
            "tools": [{"name": "Read"}, {"name": "Write"}],
            "mcp_servers": [{"name": "context7"}]
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::System {
                subtype,
                session_id,
                model,
                tools,
                mcp_servers,
                ..
            } => {
                assert_eq!(subtype.as_deref(), Some("init"));
                assert_eq!(session_id.as_deref(), Some("sess-42"));
                assert_eq!(model.as_deref(), Some("claude-opus-4-7"));
                assert_eq!(tools.unwrap().len(), 2);
                assert_eq!(mcp_servers.unwrap().len(), 1);
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn deser_system_event_minimal() {
        let json = r#"{"type": "system"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::System {
                subtype,
                session_id,
                model,
                tools,
                mcp_servers,
                ..
            } => {
                assert!(subtype.is_none());
                assert!(session_id.is_none());
                assert!(model.is_none());
                assert!(tools.is_none());
                assert!(mcp_servers.is_none());
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn deser_assistant_event_with_text() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Hello!"}],
                "model": "sonnet",
                "stop_reason": "end_turn"
            },
            "session_id": "s1"
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant {
                message,
                session_id,
                ..
            } => {
                assert_eq!(session_id.as_deref(), Some("s1"));
                assert_eq!(message.role.as_deref(), Some("assistant"));
                assert_eq!(message.model.as_deref(), Some("sonnet"));
                assert_eq!(message.stop_reason.as_deref(), Some("end_turn"));
                let blocks = message.content.unwrap();
                assert_eq!(blocks.len(), 1);
                match &blocks[0] {
                    ContentBlock::Text { text } => assert_eq!(text, "Hello!"),
                    other => panic!("Expected Text, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn deser_assistant_event_with_usage() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [],
                "usage": {"input_tokens": 500, "output_tokens": 120}
            }
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let u = message.usage.unwrap();
                assert_eq!(u.input_tokens, Some(500));
                assert_eq!(u.output_tokens, Some(120));
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_start_text() {
        let json = r#"{"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockStart {
                index,
                content_block,
                ..
            } => {
                assert_eq!(index, Some(0));
                match content_block.unwrap() {
                    ContentBlock::Text { text } => assert_eq!(text, ""),
                    other => panic!("Expected Text, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockStart, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_start_tool_use() {
        let json = r#"{
            "type": "content_block_start",
            "index": 1,
            "content_block": {"type": "tool_use", "id": "toolu_abc", "name": "Bash", "input": {}}
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockStart {
                index,
                content_block,
                ..
            } => {
                assert_eq!(index, Some(1));
                match content_block.unwrap() {
                    ContentBlock::ToolUse { id, name, input } => {
                        assert_eq!(id, "toolu_abc");
                        assert_eq!(name, "Bash");
                        assert!(input.is_object());
                    }
                    other => panic!("Expected ToolUse, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockStart, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_start_without_block() {
        let json = r#"{"type": "content_block_start", "index": 0}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockStart {
                content_block, ..
            } => {
                assert!(content_block.is_none());
            }
            other => panic!("Expected ContentBlockStart, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_delta_text_delta() {
        let json = r#"{"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "world"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { index, delta, .. } => {
                assert_eq!(index, Some(0));
                match delta.unwrap() {
                    StreamDelta::TextDelta { text } => assert_eq!(text, "world"),
                    other => panic!("Expected TextDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_delta_input_json_delta() {
        let json = r#"{"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"key\":"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                match delta.unwrap() {
                    StreamDelta::InputJsonDelta { partial_json } => {
                        assert_eq!(partial_json.as_deref(), Some("{\"key\":"));
                    }
                    other => panic!("Expected InputJsonDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_delta_input_json_delta_null_partial() {
        let json = r#"{"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                match delta.unwrap() {
                    StreamDelta::InputJsonDelta { partial_json } => {
                        assert!(partial_json.is_none());
                    }
                    other => panic!("Expected InputJsonDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_delta_thinking_delta() {
        let json = r#"{"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Let me consider..."}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                match delta.unwrap() {
                    StreamDelta::ThinkingDelta { thinking } => {
                        assert_eq!(thinking, "Let me consider...");
                    }
                    other => panic!("Expected ThinkingDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_delta_unknown_delta_type() {
        let json = r#"{"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "abc"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                assert!(matches!(delta, Some(StreamDelta::Unknown)));
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_delta_without_delta() {
        let json = r#"{"type": "content_block_delta", "index": 0}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                assert!(delta.is_none());
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_stop() {
        let json = r#"{"type": "content_block_stop", "index": 2}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockStop { index, .. } => {
                assert_eq!(index, Some(2));
            }
            other => panic!("Expected ContentBlockStop, got {:?}", other),
        }
    }

    #[test]
    fn deser_result_success_with_cost_usd() {
        let json = r#"{
            "type": "result",
            "subtype": "success",
            "duration_ms": 5000,
            "session_id": "sess-1",
            "result": "Task completed",
            "cost_usd": 0.0125,
            "is_error": false,
            "usage": {"input_tokens": 1000, "output_tokens": 500},
            "num_turns": 2,
            "duration_api_ms": 3000,
            "stop_reason": "end_turn"
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result {
                subtype,
                duration_ms,
                session_id,
                result,
                cost_usd,
                is_error,
                usage,
                num_turns,
                duration_api_ms,
                stop_reason,
                ..
            } => {
                assert_eq!(subtype.as_deref(), Some("success"));
                assert_eq!(duration_ms, Some(5000));
                assert_eq!(session_id.as_deref(), Some("sess-1"));
                assert_eq!(result.as_deref(), Some("Task completed"));
                assert!((cost_usd.unwrap() - 0.0125).abs() < f64::EPSILON);
                assert_eq!(is_error, Some(false));
                assert_eq!(usage.unwrap().input_tokens, Some(1000));
                assert_eq!(num_turns, Some(2));
                assert_eq!(duration_api_ms, Some(3000));
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn deser_result_total_cost_usd_alias() {
        // The CLI may send "total_cost_usd" instead of "cost_usd" — the serde alias handles this
        let json = r#"{"type": "result", "total_cost_usd": 0.042, "duration_ms": 100}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result { cost_usd, .. } => {
                assert!((cost_usd.unwrap() - 0.042).abs() < f64::EPSILON);
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn deser_result_error() {
        let json = r#"{"type": "result", "subtype": "error", "is_error": true, "result": "Rate limit exceeded"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result {
                is_error, result, ..
            } => {
                assert_eq!(is_error, Some(true));
                assert_eq!(result.as_deref(), Some("Rate limit exceeded"));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn deser_result_with_model_usage() {
        let json = r#"{
            "type": "result",
            "modelUsage": {
                "claude-sonnet-4-20250514": {
                    "contextWindow": 200000,
                    "maxOutputTokens": 16384,
                    "costUSD": 0.05
                }
            }
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result { model_usage, .. } => {
                let mu = model_usage.unwrap();
                let sonnet = mu.get("claude-sonnet-4-20250514").unwrap();
                assert_eq!(sonnet["contextWindow"], 200000);
                assert_eq!(sonnet["maxOutputTokens"], 16384);
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn deser_result_minimal() {
        let json = r#"{"type": "result"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result {
                subtype,
                duration_ms,
                session_id,
                result,
                cost_usd,
                is_error,
                usage,
                num_turns,
                duration_api_ms,
                stop_reason,
                model_usage,
                ..
            } => {
                assert!(subtype.is_none());
                assert!(duration_ms.is_none());
                assert!(session_id.is_none());
                assert!(result.is_none());
                assert!(cost_usd.is_none());
                assert!(is_error.is_none());
                assert!(usage.is_none());
                assert!(num_turns.is_none());
                assert!(duration_api_ms.is_none());
                assert!(stop_reason.is_none());
                assert!(model_usage.is_none());
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn deser_message_start() {
        let json = r#"{"type": "message_start", "message": {"id": "msg_abc"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::MessageStart { extra } => {
                assert_eq!(extra["message"]["id"], "msg_abc");
            }
            other => panic!("Expected MessageStart, got {:?}", other),
        }
    }

    #[test]
    fn deser_message_delta_with_usage() {
        let json = r#"{
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn"},
            "usage": {"input_tokens": 10, "output_tokens": 50}
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::MessageDelta { delta, usage, .. } => {
                let d = delta.unwrap();
                assert_eq!(d["stop_reason"], "end_turn");
                let u = usage.unwrap();
                assert_eq!(u.input_tokens, Some(10));
                assert_eq!(u.output_tokens, Some(50));
            }
            other => panic!("Expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_message_delta_without_usage() {
        let json = r#"{"type": "message_delta", "delta": {"stop_reason": "max_tokens"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::MessageDelta { usage, .. } => {
                assert!(usage.is_none());
            }
            other => panic!("Expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn deser_message_stop() {
        let json = r#"{"type": "message_stop"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, RawStreamEvent::MessageStop { .. }));
    }

    #[test]
    fn deser_rate_limit_event_full() {
        let json = r#"{
            "type": "rate_limit_event",
            "rate_limit_info": {
                "status": "allowed_warning",
                "resetsAt": 1741800000.0,
                "utilization": 0.85,
                "rateLimitType": "five_hour",
                "overageStatus": "allowed",
                "overageDisabledReason": null,
                "isUsingOverage": true
            }
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::RateLimitEvent {
                rate_limit_info, ..
            } => {
                let info = rate_limit_info.unwrap();
                assert_eq!(info.status.as_deref(), Some("allowed_warning"));
                assert!((info.resets_at.unwrap() - 1741800000.0).abs() < f64::EPSILON);
                assert!((info.utilization.unwrap() - 0.85).abs() < f64::EPSILON);
                assert_eq!(info.rate_limit_type.as_deref(), Some("five_hour"));
                assert_eq!(info.overage_status.as_deref(), Some("allowed"));
                assert!(info.overage_disabled_reason.is_none());
                assert_eq!(info.is_using_overage, Some(true));
            }
            other => panic!("Expected RateLimitEvent, got {:?}", other),
        }
    }

    #[test]
    fn deser_rate_limit_event_null_info() {
        let json = r#"{"type": "rate_limit_event", "rate_limit_info": null}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::RateLimitEvent {
                rate_limit_info, ..
            } => {
                assert!(rate_limit_info.is_none());
            }
            other => panic!("Expected RateLimitEvent, got {:?}", other),
        }
    }

    #[test]
    fn deser_rate_limit_event_missing_info() {
        let json = r#"{"type": "rate_limit_event"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::RateLimitEvent {
                rate_limit_info, ..
            } => {
                assert!(rate_limit_info.is_none());
            }
            other => panic!("Expected RateLimitEvent, got {:?}", other),
        }
    }

    #[test]
    fn deser_tool_progress() {
        let json = r#"{
            "type": "tool_progress",
            "tool_use_id": "toolu_123",
            "tool_name": "Bash",
            "elapsed_time_seconds": 12.5
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ToolProgress {
                tool_use_id,
                tool_name,
                elapsed_time_seconds,
                ..
            } => {
                assert_eq!(tool_use_id.as_deref(), Some("toolu_123"));
                assert_eq!(tool_name.as_deref(), Some("Bash"));
                assert!((elapsed_time_seconds.unwrap() - 12.5).abs() < f64::EPSILON);
            }
            other => panic!("Expected ToolProgress, got {:?}", other),
        }
    }

    #[test]
    fn deser_tool_progress_minimal() {
        let json = r#"{"type": "tool_progress"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ToolProgress {
                tool_use_id,
                tool_name,
                elapsed_time_seconds,
                ..
            } => {
                assert!(tool_use_id.is_none());
                assert!(tool_name.is_none());
                assert!(elapsed_time_seconds.is_none());
            }
            other => panic!("Expected ToolProgress, got {:?}", other),
        }
    }

    #[test]
    fn deser_user_event() {
        let json = r#"{
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "Hello from user"}]
            }
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::User { message, .. } => {
                let msg = message.unwrap();
                assert_eq!(msg.role.as_deref(), Some("user"));
                let blocks = msg.content.unwrap();
                match &blocks[0] {
                    ContentBlock::Text { text } => assert_eq!(text, "Hello from user"),
                    other => panic!("Expected Text, got {:?}", other),
                }
            }
            other => panic!("Expected User, got {:?}", other),
        }
    }

    #[test]
    fn deser_user_event_null_message() {
        let json = r#"{"type": "user", "message": null}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::User { message, .. } => {
                assert!(message.is_none());
            }
            other => panic!("Expected User, got {:?}", other),
        }
    }

    #[test]
    fn deser_control_response() {
        let json = r#"{
            "type": "control_response",
            "response": {"subtype": "success", "request_id": "req_1", "data": [1, 2, 3]}
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ControlResponse { response, .. } => {
                let resp = response.unwrap();
                assert_eq!(resp["subtype"], "success");
                assert_eq!(resp["request_id"], "req_1");
                assert_eq!(resp["data"][0], 1);
            }
            other => panic!("Expected ControlResponse, got {:?}", other),
        }
    }

    #[test]
    fn deser_control_response_null() {
        let json = r#"{"type": "control_response", "response": null}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ControlResponse { response, .. } => {
                assert!(response.is_none());
            }
            other => panic!("Expected ControlResponse, got {:?}", other),
        }
    }

    #[test]
    fn deser_unknown_event_type() {
        let json = r#"{"type": "future_event_v99", "payload": "whatever"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, RawStreamEvent::Unknown));
    }

    #[test]
    fn deser_extra_fields_are_captured_in_flatten() {
        let json = r#"{"type": "system", "subtype": "init", "model": "opus", "future_field": 42, "another": true}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::System { extra, .. } => {
                assert_eq!(extra["future_field"], 42);
                assert_eq!(extra["another"], true);
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    // ──────────────────────────────────────────────────────────
    // ContentBlock DESERIALIZATION + SERIALIZATION
    // ──────────────────────────────────────────────────────────

    #[test]
    fn deser_content_block_text() {
        let json = r#"{"type": "text", "text": "Hello, world!"}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        match block {
            ContentBlock::Text { text } => assert_eq!(text, "Hello, world!"),
            other => panic!("Expected Text, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_tool_use() {
        let json = r#"{"type": "tool_use", "id": "toolu_xyz", "name": "Write", "input": {"file_path": "/tmp/foo", "content": "bar"}}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        match block {
            ContentBlock::ToolUse { id, name, input } => {
                assert_eq!(id, "toolu_xyz");
                assert_eq!(name, "Write");
                assert_eq!(input["file_path"], "/tmp/foo");
                assert_eq!(input["content"], "bar");
            }
            other => panic!("Expected ToolUse, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_tool_result() {
        let json = r#"{"type": "tool_result", "tool_use_id": "toolu_01", "content": "result text", "is_error": false}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        match block {
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                assert_eq!(tool_use_id, "toolu_01");
                assert_eq!(
                    content.unwrap(),
                    serde_json::Value::String("result text".into())
                );
                assert_eq!(is_error, Some(false));
            }
            other => panic!("Expected ToolResult, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_tool_result_error() {
        let json = r#"{"type": "tool_result", "tool_use_id": "toolu_02", "is_error": true}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        match block {
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                assert_eq!(tool_use_id, "toolu_02");
                assert!(content.is_none());
                assert_eq!(is_error, Some(true));
            }
            other => panic!("Expected ToolResult, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_thinking() {
        let json = r#"{"type": "thinking", "thinking": "Let me analyze..."}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        match block {
            ContentBlock::Thinking { thinking } => assert_eq!(thinking, "Let me analyze..."),
            other => panic!("Expected Thinking, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_thinking_default_empty() {
        // The "thinking" field has #[serde(default)], so it should default to ""
        let json = r#"{"type": "thinking"}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        match block {
            ContentBlock::Thinking { thinking } => assert_eq!(thinking, ""),
            other => panic!("Expected Thinking, got {:?}", other),
        }
    }

    #[test]
    fn deser_content_block_unknown_type() {
        let json = r#"{"type": "citations", "data": [1, 2]}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        assert!(matches!(block, ContentBlock::Unknown));
    }

    #[test]
    fn ser_content_block_text() {
        let block = ContentBlock::Text {
            text: "Hello!".into(),
        };
        let val = serde_json::to_value(&block).unwrap();
        assert_eq!(val["type"], "text");
        assert_eq!(val["text"], "Hello!");
    }

    #[test]
    fn ser_content_block_tool_use() {
        let block = ContentBlock::ToolUse {
            id: "toolu_x".into(),
            name: "Read".into(),
            input: json!({"file_path": "main.rs"}),
        };
        let val = serde_json::to_value(&block).unwrap();
        assert_eq!(val["type"], "tool_use");
        assert_eq!(val["id"], "toolu_x");
        assert_eq!(val["name"], "Read");
        assert_eq!(val["input"]["file_path"], "main.rs");
    }

    #[test]
    fn ser_content_block_tool_result() {
        let block = ContentBlock::ToolResult {
            tool_use_id: "toolu_y".into(),
            content: Some(json!("output data")),
            is_error: Some(false),
        };
        let val = serde_json::to_value(&block).unwrap();
        assert_eq!(val["type"], "tool_result");
        assert_eq!(val["tool_use_id"], "toolu_y");
        assert_eq!(val["content"], "output data");
        assert_eq!(val["is_error"], false);
    }

    #[test]
    fn content_block_roundtrip_text() {
        let original = ContentBlock::Text {
            text: "roundtrip test".into(),
        };
        let json_str = serde_json::to_string(&original).unwrap();
        let deserialized: ContentBlock = serde_json::from_str(&json_str).unwrap();
        match deserialized {
            ContentBlock::Text { text } => assert_eq!(text, "roundtrip test"),
            other => panic!("Expected Text, got {:?}", other),
        }
    }

    #[test]
    fn content_block_roundtrip_tool_use() {
        let original = ContentBlock::ToolUse {
            id: "toolu_rt".into(),
            name: "Bash".into(),
            input: json!({"command": "ls -la"}),
        };
        let json_str = serde_json::to_string(&original).unwrap();
        let deserialized: ContentBlock = serde_json::from_str(&json_str).unwrap();
        match deserialized {
            ContentBlock::ToolUse { id, name, input } => {
                assert_eq!(id, "toolu_rt");
                assert_eq!(name, "Bash");
                assert_eq!(input["command"], "ls -la");
            }
            other => panic!("Expected ToolUse, got {:?}", other),
        }
    }

    // ──────────────────────────────────────────────────────────
    // UsageInfo DESERIALIZATION
    // ──────────────────────────────────────────────────────────

    #[test]
    fn deser_usage_info_full() {
        let json = r#"{
            "input_tokens": 1500,
            "output_tokens": 800,
            "cache_creation_input_tokens": 200,
            "cache_read_input_tokens": 1000,
            "service_tier": "standard",
            "server_tool_use": {
                "web_search_requests": 3,
                "web_fetch_requests": 1
            }
        }"#;
        let usage: UsageInfo = serde_json::from_str(json).unwrap();
        assert_eq!(usage.input_tokens, Some(1500));
        assert_eq!(usage.output_tokens, Some(800));
        assert_eq!(usage.cache_creation_input_tokens, Some(200));
        assert_eq!(usage.cache_read_input_tokens, Some(1000));
        assert_eq!(usage.service_tier.as_deref(), Some("standard"));
        let stu = usage.server_tool_use.unwrap();
        assert_eq!(stu.web_search_requests, Some(3));
        assert_eq!(stu.web_fetch_requests, Some(1));
    }

    #[test]
    fn deser_usage_info_minimal() {
        let json = r#"{}"#;
        let usage: UsageInfo = serde_json::from_str(json).unwrap();
        assert!(usage.input_tokens.is_none());
        assert!(usage.output_tokens.is_none());
        assert!(usage.cache_creation_input_tokens.is_none());
        assert!(usage.cache_read_input_tokens.is_none());
        assert!(usage.service_tier.is_none());
        assert!(usage.server_tool_use.is_none());
    }

    #[test]
    fn deser_usage_info_with_null_fields() {
        let json = r#"{
            "input_tokens": 100,
            "output_tokens": null,
            "cache_creation_input_tokens": null,
            "cache_read_input_tokens": null,
            "service_tier": null,
            "server_tool_use": null
        }"#;
        let usage: UsageInfo = serde_json::from_str(json).unwrap();
        assert_eq!(usage.input_tokens, Some(100));
        assert!(usage.output_tokens.is_none());
        assert!(usage.cache_creation_input_tokens.is_none());
        assert!(usage.service_tier.is_none());
        assert!(usage.server_tool_use.is_none());
    }

    #[test]
    fn ser_usage_info_roundtrip() {
        let original = UsageInfo {
            input_tokens: Some(500),
            output_tokens: Some(200),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: Some(300),
            service_tier: Some("premium".into()),
            server_tool_use: Some(ServerToolUse {
                web_search_requests: Some(1),
                web_fetch_requests: None,
            }),
            iterations: None,
        };
        let json_str = serde_json::to_string(&original).unwrap();
        let deserialized: UsageInfo = serde_json::from_str(&json_str).unwrap();
        assert_eq!(deserialized.input_tokens, Some(500));
        assert_eq!(deserialized.output_tokens, Some(200));
        assert!(deserialized.cache_creation_input_tokens.is_none());
        assert_eq!(deserialized.cache_read_input_tokens, Some(300));
        assert_eq!(deserialized.service_tier.as_deref(), Some("premium"));
        let stu = deserialized.server_tool_use.unwrap();
        assert_eq!(stu.web_search_requests, Some(1));
        assert!(stu.web_fetch_requests.is_none());
    }

    // ──────────────────────────────────────────────────────────
    // RateLimitInfo DESERIALIZATION (camelCase renames)
    // ──────────────────────────────────────────────────────────

    #[test]
    fn deser_rate_limit_info_camel_case_fields() {
        let json = r#"{
            "status": "rate_limited",
            "resetsAt": 1741800000.0,
            "utilization": 1.0,
            "rateLimitType": "daily",
            "overageStatus": "rejected",
            "overageDisabledReason": "out_of_credits",
            "isUsingOverage": false
        }"#;
        let info: RateLimitInfo = serde_json::from_str(json).unwrap();
        assert_eq!(info.status.as_deref(), Some("rate_limited"));
        assert!((info.resets_at.unwrap() - 1741800000.0).abs() < f64::EPSILON);
        assert!((info.utilization.unwrap() - 1.0).abs() < f64::EPSILON);
        assert_eq!(info.rate_limit_type.as_deref(), Some("daily"));
        assert_eq!(info.overage_status.as_deref(), Some("rejected"));
        assert_eq!(
            info.overage_disabled_reason.as_deref(),
            Some("out_of_credits")
        );
        assert_eq!(info.is_using_overage, Some(false));
    }

    #[test]
    fn deser_rate_limit_info_minimal() {
        let json = r#"{}"#;
        let info: RateLimitInfo = serde_json::from_str(json).unwrap();
        assert!(info.status.is_none());
        assert!(info.resets_at.is_none());
        assert!(info.utilization.is_none());
        assert!(info.rate_limit_type.is_none());
        assert!(info.overage_status.is_none());
        assert!(info.overage_disabled_reason.is_none());
        assert!(info.is_using_overage.is_none());
    }

    #[test]
    fn deser_rate_limit_info_extra_fields() {
        let json = r#"{"status": "ok", "newFutureField": 42}"#;
        let info: RateLimitInfo = serde_json::from_str(json).unwrap();
        assert_eq!(info.status.as_deref(), Some("ok"));
        assert_eq!(info.extra["newFutureField"], 42);
    }

    // ──────────────────────────────────────────────────────────
    // FrontendEvent SERIALIZATION
    // ──────────────────────────────────────────────────────────

    #[test]
    fn ser_frontend_session_init() {
        let fe = FrontendEvent::SessionInit {
            session_id: "s1".into(),
            model: Some("opus".into()),
            thinking_effort: None,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "session_init");
        assert_eq!(val["session_id"], "s1");
        assert_eq!(val["model"], "opus");
        // thinking_effort should be absent (skip_serializing_if)
        assert!(val.get("thinking_effort").is_none());
    }

    #[test]
    fn ser_frontend_session_init_with_thinking_effort() {
        let fe = FrontendEvent::SessionInit {
            session_id: "s1".into(),
            model: None,
            thinking_effort: Some("high".into()),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "session_init");
        assert!(val["model"].is_null());
        assert_eq!(val["thinking_effort"], "high");
    }

    #[test]
    fn ser_frontend_text_delta() {
        let fe = FrontendEvent::TextDelta {
            session_id: "s2".into(),
            text: "chunk".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "text_delta");
        assert_eq!(val["session_id"], "s2");
        assert_eq!(val["text"], "chunk");
    }

    #[test]
    fn ser_frontend_text_complete() {
        let fe = FrontendEvent::TextComplete {
            session_id: "s1".into(),
            full_text: "The complete response text.".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "text_complete");
        assert_eq!(val["full_text"], "The complete response text.");
    }

    #[test]
    fn ser_frontend_tool_use_start() {
        let fe = FrontendEvent::ToolUseStart {
            session_id: "s1".into(),
            tool_use_id: "toolu_99".into(),
            tool_name: "Edit".into(),
            tool_input: json!({"file_path": "src/main.rs", "old_string": "a", "new_string": "b"}),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "tool_use_start");
        assert_eq!(val["tool_use_id"], "toolu_99");
        assert_eq!(val["tool_name"], "Edit");
        assert_eq!(val["tool_input"]["file_path"], "src/main.rs");
    }

    #[test]
    fn ser_frontend_tool_result() {
        let fe = FrontendEvent::ToolResult {
            session_id: "s1".into(),
            tool_use_id: "toolu_01".into(),
            content: Some("file contents here".into()),
            is_error: false,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "tool_result");
        assert_eq!(val["tool_use_id"], "toolu_01");
        assert_eq!(val["content"], "file contents here");
        assert_eq!(val["is_error"], false);
    }

    #[test]
    fn ser_frontend_tool_result_error() {
        let fe = FrontendEvent::ToolResult {
            session_id: "s1".into(),
            tool_use_id: "toolu_02".into(),
            content: None,
            is_error: true,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "tool_result");
        assert_eq!(val["is_error"], true);
        assert!(val["content"].is_null());
    }

    #[test]
    fn ser_frontend_turn_complete() {
        let fe = FrontendEvent::TurnComplete {
            session_id: "s1".into(),
            duration_ms: Some(3000),
            usage: Some(UsageInfo {
                input_tokens: Some(500),
                output_tokens: Some(200),
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
                service_tier: None,
                server_tool_use: None,
                iterations: None,
            }),
            cost_usd: Some(0.01),
            duration_api_ms: Some(2500),
            num_turns: Some(1),
            stop_reason: Some("end_turn".into()),
            terminal_reason: Some("completed".into()),
            model_name: Some("sonnet".into()),
            context_window: Some(200000),
            max_output_tokens: Some(16384),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "turn_complete");
        assert_eq!(val["duration_ms"], 3000);
        assert_eq!(val["usage"]["input_tokens"], 500);
        assert_eq!(val["usage"]["output_tokens"], 200);
        assert_eq!(val["cost_usd"], 0.01);
        assert_eq!(val["duration_api_ms"], 2500);
        assert_eq!(val["num_turns"], 1);
        assert_eq!(val["stop_reason"], "end_turn");
        assert_eq!(val["terminal_reason"], "completed");
        assert_eq!(val["model_name"], "sonnet");
        assert_eq!(val["context_window"], 200000);
        assert_eq!(val["max_output_tokens"], 16384);
    }

    #[test]
    fn ser_frontend_turn_complete_minimal() {
        let fe = FrontendEvent::TurnComplete {
            session_id: "s1".into(),
            duration_ms: None,
            usage: None,
            cost_usd: None,
            duration_api_ms: None,
            num_turns: None,
            stop_reason: None,
            terminal_reason: None,
            model_name: None,
            context_window: None,
            max_output_tokens: None,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "turn_complete");
        assert!(val["duration_ms"].is_null());
        assert!(val["usage"].is_null());
        // model_name and terminal_reason have skip_serializing_if, so they should be absent
        assert!(val.get("model_name").is_none());
        assert!(val.get("terminal_reason").is_none());
    }

    #[test]
    fn ser_frontend_cli_session_id() {
        let fe = FrontendEvent::CliSessionId {
            session_id: "s1".into(),
            cli_session_id: "cli-sess-abc".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "cli_session_id");
        assert_eq!(val["session_id"], "s1");
        assert_eq!(val["cli_session_id"], "cli-sess-abc");
    }

    #[test]
    fn ser_frontend_process_error() {
        let fe = FrontendEvent::ProcessError {
            session_id: "s1".into(),
            error: "Segfault in CLI".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "process_error");
        assert_eq!(val["error"], "Segfault in CLI");
    }

    #[test]
    fn ser_frontend_process_exited() {
        let fe = FrontendEvent::ProcessExited {
            session_id: "s1".into(),
            exit_code: Some(0),
            stderr_tail: Some("All done".into()),
            elapsed_ms: 15000,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "process_exited");
        assert_eq!(val["exit_code"], 0);
        assert_eq!(val["stderr_tail"], "All done");
        assert_eq!(val["elapsed_ms"], 15000);
    }

    #[test]
    fn ser_frontend_process_exited_abnormal() {
        let fe = FrontendEvent::ProcessExited {
            session_id: "s1".into(),
            exit_code: Some(1),
            stderr_tail: None,
            elapsed_ms: 500,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "process_exited");
        assert_eq!(val["exit_code"], 1);
        assert!(val["stderr_tail"].is_null());
        assert_eq!(val["elapsed_ms"], 500);
    }

    #[test]
    fn ser_frontend_process_exited_no_exit_code() {
        let fe = FrontendEvent::ProcessExited {
            session_id: "s1".into(),
            exit_code: None,
            stderr_tail: None,
            elapsed_ms: 0,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert!(val["exit_code"].is_null());
    }

    #[test]
    fn ser_frontend_compacting_status() {
        let fe = FrontendEvent::CompactingStatus {
            session_id: "s1".into(),
            is_compacting: true,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "compacting_status");
        assert_eq!(val["is_compacting"], true);
    }

    #[test]
    fn ser_frontend_compact_complete() {
        let fe = FrontendEvent::CompactComplete {
            session_id: "s1".into(),
            trigger: "auto".into(),
            pre_tokens: Some(150000),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "compact_complete");
        assert_eq!(val["trigger"], "auto");
        assert_eq!(val["pre_tokens"], 150000);
    }

    #[test]
    fn ser_frontend_tool_progress() {
        let fe = FrontendEvent::ToolProgress {
            session_id: "s1".into(),
            tool_use_id: "toolu_tp".into(),
            tool_name: "Bash".into(),
            elapsed_seconds: 8.5,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "tool_progress");
        assert_eq!(val["tool_use_id"], "toolu_tp");
        assert_eq!(val["tool_name"], "Bash");
        assert_eq!(val["elapsed_seconds"], 8.5);
    }

    #[test]
    fn ser_frontend_rate_limit_warning() {
        let fe = FrontendEvent::RateLimitWarning {
            session_id: "s1".into(),
            utilization: 0.95,
            resets_at: Some(1741800000.0),
            rate_limit_type: Some("five_hour".into()),
            overage_status: Some("allowed".into()),
            is_using_overage: Some(true),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "rate_limit_warning");
        assert_eq!(val["utilization"], 0.95);
        assert_eq!(val["resets_at"], 1741800000.0);
        assert_eq!(val["rate_limit_type"], "five_hour");
        assert_eq!(val["overage_status"], "allowed");
        assert_eq!(val["is_using_overage"], true);
    }

    #[test]
    fn ser_frontend_usage_update() {
        let fe = FrontendEvent::UsageUpdate {
            session_id: "s1".into(),
            usage: UsageInfo {
                input_tokens: Some(1000),
                output_tokens: Some(400),
                cache_creation_input_tokens: Some(100),
                cache_read_input_tokens: Some(800),
                service_tier: Some("standard".into()),
                server_tool_use: None,
                iterations: None,
            },
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "usage_update");
        assert_eq!(val["usage"]["input_tokens"], 1000);
        assert_eq!(val["usage"]["output_tokens"], 400);
        assert_eq!(val["usage"]["cache_creation_input_tokens"], 100);
        assert_eq!(val["usage"]["cache_read_input_tokens"], 800);
        assert_eq!(val["usage"]["service_tier"], "standard");
    }

    #[test]
    fn ser_frontend_interrupt_result() {
        let fe = FrontendEvent::InterruptResult {
            session_id: "s1".into(),
            success: true,
            error: None,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "interrupt_result");
        assert_eq!(val["success"], true);
        assert!(val["error"].is_null());
    }

    #[test]
    fn ser_frontend_interrupt_result_failure() {
        let fe = FrontendEvent::InterruptResult {
            session_id: "s1".into(),
            success: false,
            error: Some("Process not running".into()),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["success"], false);
        assert_eq!(val["error"], "Process not running");
    }

    #[test]
    fn ser_frontend_model_changed() {
        let fe = FrontendEvent::ModelChanged {
            session_id: "s1".into(),
            model: "haiku".into(),
            success: true,
            error: None,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "model_changed");
        assert_eq!(val["model"], "haiku");
        assert_eq!(val["success"], true);
    }

    #[test]
    fn ser_frontend_capabilities_discovered() {
        let fe = FrontendEvent::CapabilitiesDiscovered {
            session_id: "s1".into(),
            models: json!([{"value": "sonnet"}]),
            commands: json!([{"name": "compact"}]),
            agents: json!([]),
            account: json!({"tier": "max"}),
            output_styles: json!(["text", "json"]),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "capabilities_discovered");
        assert_eq!(val["models"][0]["value"], "sonnet");
        assert_eq!(val["commands"][0]["name"], "compact");
        assert_eq!(val["account"]["tier"], "max");
    }

    #[test]
    fn ser_frontend_agent_preparing() {
        let fe = FrontendEvent::AgentPreparing {
            session_id: "s1".into(),
            tool_use_id: "toolu_agent".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "agent_preparing");
        assert_eq!(val["tool_use_id"], "toolu_agent");
    }

    #[test]
    fn ser_frontend_subagent_started() {
        let fe = FrontendEvent::SubAgentStarted {
            session_id: "s1".into(),
            tool_use_id: "toolu_sub".into(),
            description: "Searching codebase".into(),
            subagent_type: "search".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "subagent_started");
        assert_eq!(val["tool_use_id"], "toolu_sub");
        assert_eq!(val["description"], "Searching codebase");
        assert_eq!(val["subagent_type"], "search");
    }

    #[test]
    fn ser_frontend_subagent_progress() {
        let fe = FrontendEvent::SubAgentProgress {
            session_id: "s1".into(),
            tool_use_id: "toolu_sub".into(),
            tool_count: Some(5),
            token_count: Some(2000),
            current_activity: Some("Reading files".into()),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "subagent_progress");
        assert_eq!(val["tool_count"], 5);
        assert_eq!(val["token_count"], 2000);
        assert_eq!(val["current_activity"], "Reading files");
    }

    #[test]
    fn ser_frontend_subagent_progress_minimal() {
        let fe = FrontendEvent::SubAgentProgress {
            session_id: "s1".into(),
            tool_use_id: "toolu_sub".into(),
            tool_count: None,
            token_count: None,
            current_activity: None,
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "subagent_progress");
        assert!(val["tool_count"].is_null());
        assert!(val["token_count"].is_null());
        assert!(val["current_activity"].is_null());
    }

    #[test]
    fn ser_frontend_subagent_complete() {
        let fe = FrontendEvent::SubAgentComplete {
            session_id: "s1".into(),
            tool_use_id: "toolu_sub".into(),
            tool_count: Some(10),
            token_count: Some(5000),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "subagent_complete");
        assert_eq!(val["tool_count"], 10);
        assert_eq!(val["token_count"], 5000);
    }

    #[test]
    fn ser_frontend_thinking_delta() {
        let fe = FrontendEvent::ThinkingDelta {
            session_id: "s1".into(),
            thinking: "step 1...".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "thinking_delta");
        assert_eq!(val["thinking"], "step 1...");
    }

    #[test]
    fn ser_frontend_thinking_complete() {
        let fe = FrontendEvent::ThinkingComplete {
            session_id: "s1".into(),
            full_thinking: "The full chain of thought.".into(),
        };
        let val = serde_json::to_value(&fe).unwrap();
        assert_eq!(val["type"], "thinking_complete");
        assert_eq!(val["full_thinking"], "The full chain of thought.");
    }

    // ──────────────────────────────────────────────────────────
    // StdinMessage + ControlRequestPayload SERIALIZATION
    // ──────────────────────────────────────────────────────────

    #[test]
    fn ser_stdin_user_message() {
        let msg = StdinMessage::new_user_message("Hello Claude");
        let val = serde_json::to_value(&msg).unwrap();
        assert_eq!(val["type"], "user");
        assert_eq!(val["message"]["role"], "user");
        assert_eq!(val["message"]["content"], "Hello Claude");
    }

    #[test]
    fn ser_stdin_tool_response_approved() {
        let msg = StdinMessage::new_tool_response("toolu_abc", true);
        let val = serde_json::to_value(&msg).unwrap();
        assert_eq!(val["type"], "tool_result");
        assert_eq!(val["tool_use_id"], "toolu_abc");
        assert_eq!(val["approved"], true);
    }

    #[test]
    fn ser_stdin_tool_response_denied() {
        let msg = StdinMessage::new_tool_response("toolu_xyz", false);
        let val = serde_json::to_value(&msg).unwrap();
        assert_eq!(val["type"], "tool_result");
        assert_eq!(val["tool_use_id"], "toolu_xyz");
        assert_eq!(val["approved"], false);
    }

    #[test]
    fn ser_control_request_interrupt() {
        let msg = StdinMessage::ControlRequest {
            request_id: "req_int".into(),
            request: ControlRequestPayload::Interrupt,
        };
        let val = serde_json::to_value(&msg).unwrap();
        assert_eq!(val["type"], "control_request");
        assert_eq!(val["request_id"], "req_int");
        assert_eq!(val["request"]["subtype"], "interrupt");
    }

    #[test]
    fn ser_control_request_set_model() {
        let msg = StdinMessage::ControlRequest {
            request_id: "req_sm".into(),
            request: ControlRequestPayload::SetModel {
                model: "opus".into(),
            },
        };
        let val = serde_json::to_value(&msg).unwrap();
        assert_eq!(val["type"], "control_request");
        assert_eq!(val["request"]["subtype"], "set_model");
        assert_eq!(val["request"]["model"], "opus");
    }

    #[test]
    fn ser_control_request_initialize() {
        let msg = StdinMessage::ControlRequest {
            request_id: "req_init".into(),
            request: ControlRequestPayload::Initialize,
        };
        let val = serde_json::to_value(&msg).unwrap();
        assert_eq!(val["type"], "control_request");
        assert_eq!(val["request"]["subtype"], "initialize");
    }

    #[test]
    fn ser_control_request_set_permission_mode() {
        let msg = StdinMessage::ControlRequest {
            request_id: "req_pm".into(),
            request: ControlRequestPayload::SetPermissionMode {
                mode: "plan".into(),
            },
        };
        let val = serde_json::to_value(&msg).unwrap();
        assert_eq!(val["type"], "control_request");
        assert_eq!(val["request"]["subtype"], "set_permission_mode");
        assert_eq!(val["request"]["mode"], "plan");
    }

    // ──────────────────────────────────────────────────────────
    // EDGE CASES
    // ──────────────────────────────────────────────────────────

    #[test]
    fn deser_empty_string_is_invalid() {
        let result = serde_json::from_str::<RawStreamEvent>("");
        assert!(result.is_err());
    }

    #[test]
    fn deser_malformed_json_is_invalid() {
        let result = serde_json::from_str::<RawStreamEvent>("{broken json");
        assert!(result.is_err());
    }

    #[test]
    fn deser_json_without_type_field_is_invalid() {
        let result = serde_json::from_str::<RawStreamEvent>(r#"{"data": "no type"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn deser_assistant_mixed_content_blocks() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "Planning..."},
                    {"type": "text", "text": "Here is the plan."},
                    {"type": "tool_use", "id": "toolu_m1", "name": "Bash", "input": {"command": "ls"}},
                    {"type": "tool_result", "tool_use_id": "toolu_m1", "content": "file1.txt\nfile2.txt"},
                    {"type": "unknown_future_type"}
                ]
            }
        }"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let blocks = message.content.unwrap();
                assert_eq!(blocks.len(), 5);
                assert!(matches!(&blocks[0], ContentBlock::Thinking { thinking } if thinking == "Planning..."));
                assert!(matches!(&blocks[1], ContentBlock::Text { text } if text == "Here is the plan."));
                assert!(matches!(&blocks[2], ContentBlock::ToolUse { name, .. } if name == "Bash"));
                assert!(matches!(&blocks[3], ContentBlock::ToolResult { tool_use_id, .. } if tool_use_id == "toolu_m1"));
                assert!(matches!(&blocks[4], ContentBlock::Unknown));
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn deser_assistant_empty_content() {
        let json = r#"{"type": "assistant", "message": {"role": "assistant", "content": []}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                assert!(message.content.unwrap().is_empty());
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn deser_assistant_null_content() {
        let json = r#"{"type": "assistant", "message": {"role": "assistant", "content": null}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                assert!(message.content.is_none());
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn deser_unicode_text_content() {
        let json = r#"{"type": "text", "text": "Hello \u00e9\u00e8\u00ea \u4f60\u597d \ud83d\ude00"}"#;
        let block: ContentBlock = serde_json::from_str(json).unwrap();
        match block {
            ContentBlock::Text { text } => {
                assert!(text.contains('\u{00e9}')); // e-acute
                assert!(text.contains('\u{4f60}')); // Chinese character
            }
            other => panic!("Expected Text, got {:?}", other),
        }
    }

    #[test]
    fn deser_server_tool_use_partial() {
        let json = r#"{"web_search_requests": 5}"#;
        let stu: ServerToolUse = serde_json::from_str(json).unwrap();
        assert_eq!(stu.web_search_requests, Some(5));
        assert!(stu.web_fetch_requests.is_none());
    }

    #[test]
    fn deser_server_tool_use_empty() {
        let json = r#"{}"#;
        let stu: ServerToolUse = serde_json::from_str(json).unwrap();
        assert!(stu.web_search_requests.is_none());
        assert!(stu.web_fetch_requests.is_none());
    }

    #[test]
    fn ser_server_tool_use_roundtrip() {
        let original = ServerToolUse {
            web_search_requests: Some(3),
            web_fetch_requests: Some(2),
        };
        let json_str = serde_json::to_string(&original).unwrap();
        let deserialized: ServerToolUse = serde_json::from_str(&json_str).unwrap();
        assert_eq!(deserialized.web_search_requests, Some(3));
        assert_eq!(deserialized.web_fetch_requests, Some(2));
    }

    #[test]
    fn deser_assistant_message_extra_fields_captured() {
        let json = r#"{
            "role": "assistant",
            "content": [],
            "model": "opus",
            "some_new_field": "hello",
            "another_field": 42
        }"#;
        let msg: AssistantMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.role.as_deref(), Some("assistant"));
        assert_eq!(msg.model.as_deref(), Some("opus"));
        assert_eq!(msg.extra["some_new_field"], "hello");
        assert_eq!(msg.extra["another_field"], 42);
    }
}
