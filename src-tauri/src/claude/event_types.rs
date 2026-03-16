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
