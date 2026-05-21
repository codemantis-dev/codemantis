//! Agent adapter layer.
//!
//! The `AgentAdapter` trait is the abstraction over the per-agent CLI (Claude
//! Code today; OpenAI Codex in Phase 2). Each adapter speaks its native wire
//! protocol on stdin/stdout and exposes a normalized event stream + control
//! surface to the rest of the app. The Claude implementation lives in
//! `claude_code` (moved here from the former `crate::claude::*` in Phase 1).
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase1-AgentAdapter-Refactor-v1.2.md`
//! §3.2 (`AgentAdapter` trait) and §3.5 (channel helpers).
//!
//! Phase 1 lands the full adapter trait surface, the NormalizedEvent
//! vocabulary, the generic control-protocol types, and the channel helpers
//! ahead of full consumption (spec §4.1: "compiles but nothing calls them
//! yet"). Claude Code still emits the legacy `claude_code::event_types`
//! FrontendEvent on the wire in Phase 1 (spec §3.5: no wire-format change);
//! Phase 2's Codex adapter is the first consumer of NormalizedEvent and the
//! per-agent channel helpers. The forward-looking items below carry a
//! targeted `#[allow(dead_code)]` with a Phase-2 rationale — applied per item
//! (not module-wide) so real dead code in the moved `claude_code`
//! implementation still warns.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub mod claude_code;
pub mod codex;
pub mod registry;

/// Rollback escape hatch for the Phase 1 adapter refactor (spec §3.7, §5.4).
///
/// The spec envisioned a `#[cfg(feature = "legacy_claude_path")]` *parallel*
/// pre-refactor module, presupposing a copy-based refactor. We did a
/// move-based refactor instead (spec §3.3 itself calls it a "near-mechanical
/// move"): the Claude path moved verbatim into `claude_code` and the adapter
/// is a verified zero-behaviour-change delegating wrapper (Sessions 2–3
/// landed it with the full suite + capture S06 green). There is therefore no
/// behaviourally-distinct legacy path to toggle — the genuine rollback is
/// `git revert` of the Phase 1 commits, which is safe precisely because the
/// wrapper adds no behaviour.
///
/// This flag is retained for the 14-day (compressed: 3–5 day) soak as a
/// **diagnostic indicator**: when `CODEMANTIS_FORCE_LEGACY_CLAUDE=1` is set
/// it is logged at startup and surfaced read-only in Settings → About, so an
/// incident responder can immediately see the build was asked to fall back
/// (and knows to `git revert` + rebuild). Removed entirely in v1.3.0 /
/// Phase 2 per spec §6. The deviation from the literal `#[cfg(feature)]`
/// mechanism is documented in RELEASES.md per spec §8's allowance.
pub fn legacy_claude_path_forced() -> bool {
    std::env::var("CODEMANTIS_FORCE_LEGACY_CLAUDE").as_deref() == Ok("1")
}

// ─────────────────────────────────────────────────────────────────────
// Identity & capabilities
// ─────────────────────────────────────────────────────────────────────

/// Stable discriminator for the underlying coding-agent CLI. Each session is
/// owned by exactly one agent for its lifetime. Phase 2 adds `Codex`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentId {
    ClaudeCode,
    /// OpenAI Codex CLI — uses the `codex app-server --listen stdio://`
    /// JSON-RPC 2.0 protocol (spec Phase 2 §2.4). Bundled with the user's
    /// ChatGPT Plus/Pro/Business subscription, so traffic doesn't draw down
    /// the Anthropic Agent-SDK credit pool. Added in Phase 2 Session 1
    /// (foundation only — the adapter implementation lands in S2–S4).
    Codex,
}

#[allow(dead_code)]
impl AgentId {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentId::ClaudeCode => "claude_code",
            AgentId::Codex => "codex",
        }
    }
}

/// Per-agent feature flags. The frontend and command layer use this to gate
/// UI surfaces and dispatch logic so adapters never have to advertise
/// capabilities they don't support.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AgentCapabilitySet {
    pub agent_id: AgentId,
    pub display_name: &'static str,

    // Control-protocol parity (Claude's control_request subtypes)
    pub supports_interrupt: bool,
    pub supports_set_model: bool,
    pub supports_initialize: bool,
    pub supports_set_permission_mode: bool,

    // Session / spawn semantics
    pub supports_resume_session: bool,
    pub supports_append_system_prompt: bool,

    // Event shapes the frontend can expect
    pub supports_thinking_blocks: bool,
    pub supports_subagents: bool,
    pub supports_tasks_protocol: bool,
    pub supports_external_approval_hook: bool,
    pub supports_protected_path_denials: bool,
    pub supports_raw_stream_log: bool,

    // ── Phase 2 additions (spec §4.2) ──
    //
    // Codex differs from Claude in shape, not just binary. These flags let the
    // UI gate features and the command layer dispatch by capability instead of
    // by `agent_id` match arms.
    /// Project-instruction injection via an on-disk doc (Codex's
    /// `AGENTS.md` / `AGENTS.override.md`) rather than via a CLI flag.
    /// Used by SpecWriter to pick its system-prompt-delivery mechanism.
    pub supports_project_doc_injection: bool,
    /// Sandbox-policy axis (Codex: `read-only` / `workspace-write` /
    /// `danger-full-access`). Claude has no analog.
    pub supports_sandbox_modes: bool,
    /// Approval-policy axis (Codex: `never` / `on-request` / `untrusted`).
    /// Claude has no analog; together with `supports_sandbox_modes` this is
    /// the orthogonal 2-axis replacement for `SessionMode`.
    pub supports_approval_policy: bool,
    /// Six-mode `SessionMode` taxonomy (Claude). Codex sets this to `false`
    /// because sandbox and approval policy are orthogonal axes instead.
    /// The frontend Mode pill ↔ Policy pill swap is gated on this.
    pub supports_session_mode: bool,
    /// MCP server management is per-agent (Claude: `~/.claude.json`;
    /// Codex: `~/.codex/config.toml` via `config/value/write` JSON-RPC).
    pub supports_mcp_management: bool,
    /// In-app browser-OAuth login (Codex's `account/login/start`,
    /// Claude's Welcome-screen install prompt). Deferred to v1.4.0 for
    /// both adapters in v1.3.0 — the user runs `claude login` /
    /// `codex login` in a terminal.
    pub supports_in_app_login: bool,
    /// Whether this adapter can act in the AUDIT-PATCH role (the
    /// spec-splice button in the SpecWriter Coverage panel). Claude:
    /// `true`. Codex: `false` in v1.3.0 — when a Codex session is active,
    /// AUDIT-PATCH either spawns an auxiliary Claude session (if Claude
    /// is installed) or surfaces a tooltip. Generalised in v1.4.0.
    pub supports_audit_patch_role: bool,
}

// ─────────────────────────────────────────────────────────────────────
// Common control-protocol vocabulary (also referenced by NormalizedEvent)
//
// Note: `claude_code::event_types` still defines its own Claude-native
// copies of `UsageInfo` and `PermissionDenial` (pinned by the capture
// harness wire format). Phase 2 converges adapters onto the definitions
// below; Phase 1 keeps both to avoid perturbing the Claude wire.
// ─────────────────────────────────────────────────────────────────────

/// Per-API-call token usage emitted from each agent's message-delta-equivalent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)]
pub struct UsageIteration {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(rename = "type")]
    pub iteration_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)]
pub struct ServerToolUse {
    pub web_search_requests: Option<u32>,
    pub web_fetch_requests: Option<u32>,
}

/// A tool call that was denied (by the agent's guardrail or by the host).
/// The frontend buckets these into protected-path toasts vs. UI-prompt events
/// (ExitPlanMode / AskUserQuestion / EnterPlanMode) — see `chat.ts:213-275`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)]
pub struct PermissionDenial {
    pub tool_name: String,
    pub tool_use_id: String,
    pub tool_input: serde_json::Value,
}

/// Adapter-agnostic shape for a control request. The Claude Code adapter
/// serializes this onto stdin as `{"type":"control_request", ...}`.
#[derive(Debug, Clone, Serialize)]
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

// ─────────────────────────────────────────────────────────────────────
// Session mode (host-owned permission state)
// ─────────────────────────────────────────────────────────────────────

/// Permission mode for an active session. Stored in `AppState.session_modes`
/// and enforced by the host approval surface, not by the agent CLI's view.
///
/// Wire formats:
/// - Rust ↔ TS (Tauri IPC): kebab-case via serde (`normal`, `auto-accept`, …)
/// - CodeMantis → Claude CLI: camelCase via the explicit
///   `agents::claude_code::session_mode_to_cli` translator. Do **not** rely on
///   serde for this direction: `DontAsk` would serialize as `dont-ask` but the
///   CLI wants `dontAsk`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionMode {
    Normal,
    AutoAccept,
    Plan,
    Auto,
    DontAsk,
    BypassPermissions,
}

// ─────────────────────────────────────────────────────────────────────
// Spawn config (agent-agnostic)
// ─────────────────────────────────────────────────────────────────────

/// Per-session spawn config. Holds only fields meaningful to every adapter;
/// adapter-specific concerns (e.g. the Claude `--settings` blob or Codex's
/// `--sandbox/--ask-for-approval`) are built inside the adapter from this
/// plus its own config sources.
#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub session_id: String,
    pub project_path: String,
    pub session_name: Option<String>,
    pub model_override: Option<String>,
    pub append_system_prompt: Option<String>,
    /// Adapter-defined resume token. Claude Code: the CLI's session UUID.
    /// Codex (Phase 2): the thread id (`thr_…`).
    pub resume_token: Option<String>,
    /// Thinking-effort hint. Claude: `low|medium|high|xhigh|max`. Codex
    /// (Phase 2): `minimal|low|medium|high|xhigh`.
    pub effort_override: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────
// NormalizedEvent — the adapter-agnostic event vocabulary
//
// Near-superset of v1.1.11's `claude_code::event_types::FrontendEvent`.
// Every variant carries `agent_id` so the frontend can branch when needed
// (e.g. agent-aware protected-path detection). In Phase 1 the field is
// additive and `claude::event_types::FrontendEvent` is what actually rides
// the wire; Session 2 swaps the wire to `NormalizedEvent`.
// ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum NormalizedEvent {
    #[serde(rename = "session_init")]
    SessionInit {
        agent_id: AgentId,
        session_id: String,
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        thinking_effort: Option<String>,
    },

    #[serde(rename = "cli_session_id")]
    CliSessionId {
        agent_id: AgentId,
        session_id: String,
        cli_session_id: String,
    },

    #[serde(rename = "text_delta")]
    TextDelta {
        agent_id: AgentId,
        session_id: String,
        text: String,
    },

    #[serde(rename = "text_complete")]
    TextComplete {
        agent_id: AgentId,
        session_id: String,
        full_text: String,
    },

    #[serde(rename = "thinking_delta")]
    ThinkingDelta {
        agent_id: AgentId,
        session_id: String,
        thinking: String,
    },

    #[serde(rename = "thinking_complete")]
    ThinkingComplete {
        agent_id: AgentId,
        session_id: String,
        full_thinking: String,
    },

    #[serde(rename = "tool_use_start")]
    ToolUseStart {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
        tool_name: String,
        tool_input: serde_json::Value,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
        content: Option<String>,
        is_error: bool,
    },

    #[serde(rename = "tool_progress")]
    ToolProgress {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
        tool_name: String,
        elapsed_seconds: f64,
    },

    #[serde(rename = "turn_complete")]
    TurnComplete {
        agent_id: AgentId,
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

    #[serde(rename = "process_error")]
    ProcessError {
        agent_id: AgentId,
        session_id: String,
        error: String,
    },

    #[serde(rename = "process_exited")]
    ProcessExited {
        agent_id: AgentId,
        session_id: String,
        exit_code: Option<i32>,
        stderr_tail: Option<String>,
        elapsed_ms: u64,
    },

    #[serde(rename = "protected_path_deny")]
    ProtectedPathDeny {
        agent_id: AgentId,
        session_id: String,
        denials: Vec<PermissionDenial>,
    },

    #[serde(rename = "compacting_status")]
    CompactingStatus {
        agent_id: AgentId,
        session_id: String,
        is_compacting: bool,
    },

    #[serde(rename = "compact_complete")]
    CompactComplete {
        agent_id: AgentId,
        session_id: String,
        trigger: String,
        pre_tokens: Option<u64>,
    },

    #[serde(rename = "rate_limit_warning")]
    RateLimitWarning {
        agent_id: AgentId,
        session_id: String,
        utilization: f64,
        resets_at: Option<f64>,
        rate_limit_type: Option<String>,
        overage_status: Option<String>,
        is_using_overage: Option<bool>,
    },

    #[serde(rename = "usage_update")]
    UsageUpdate {
        agent_id: AgentId,
        session_id: String,
        usage: UsageInfo,
    },

    #[serde(rename = "interrupt_result")]
    InterruptResult {
        agent_id: AgentId,
        session_id: String,
        success: bool,
        error: Option<String>,
    },

    #[serde(rename = "model_changed")]
    ModelChanged {
        agent_id: AgentId,
        session_id: String,
        model: String,
        success: bool,
        error: Option<String>,
    },

    #[serde(rename = "capabilities_discovered")]
    CapabilitiesDiscovered {
        agent_id: AgentId,
        session_id: String,
        models: serde_json::Value,
        commands: serde_json::Value,
        agents: serde_json::Value,
        account: serde_json::Value,
        output_styles: serde_json::Value,
    },

    #[serde(rename = "agent_preparing")]
    AgentPreparing {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
    },

    #[serde(rename = "subagent_started")]
    SubAgentStarted {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
        description: String,
        subagent_type: String,
    },

    #[serde(rename = "subagent_progress")]
    SubAgentProgress {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
        tool_count: Option<u32>,
        token_count: Option<u32>,
        current_activity: Option<String>,
    },

    #[serde(rename = "subagent_complete")]
    SubAgentComplete {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
        tool_count: Option<u32>,
        token_count: Option<u32>,
    },

    #[serde(rename = "task_notification")]
    TaskNotification {
        agent_id: AgentId,
        session_id: String,
        tool_use_id: String,
        task_id: String,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_file: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<UsageInfo>,
    },

    #[serde(rename = "task_updated")]
    TaskUpdated {
        agent_id: AgentId,
        session_id: String,
        task_id: String,
        patch: serde_json::Value,
    },
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum AgentError {
    #[error("Agent binary not found: {0}")]
    BinaryNotFound(String),
    #[error("Spawn failed: {0}")]
    SpawnFailed(String),
    #[error("Send failed: {0}")]
    SendFailed(String),
    #[error("Capability not supported by {0:?}: {1}")]
    CapabilityNotSupported(AgentId, &'static str),
    #[error("Session not found: {0}")]
    SessionNotFound(String),
    #[error("Auth required: {0}")]
    AuthRequired(String),
    #[error("Protocol error: {0}")]
    ProtocolError(String),
}

// ─────────────────────────────────────────────────────────────────────
// Traits
// ─────────────────────────────────────────────────────────────────────

/// The per-session handle owned by `AppState.processes`. Each adapter returns
/// a concrete type that implements this trait; callers see only the trait.
#[async_trait]
#[allow(dead_code)]
pub trait AgentProcessHandle: Send + Sync {
    fn agent_id(&self) -> AgentId;
    fn session_id(&self) -> &str;
    fn is_running(&self) -> bool;

    /// Send a user message into the agent's input stream.
    async fn send_user_message(&self, text: &str) -> Result<(), AgentError>;

    /// Send a tool-result response. The Claude adapter uses this for the
    /// legacy stdin tool-result path; new adapters typically don't need it
    /// (and may return CapabilityNotSupported).
    async fn send_tool_result(
        &self,
        tool_use_id: &str,
        approved: bool,
    ) -> Result<(), AgentError>;

    /// Issue a control request. Returns the allocated request id so the
    /// caller can correlate the eventual response in
    /// `AppState.pending_control_requests`.
    async fn send_control_request(
        &self,
        payload: ControlRequestPayload,
    ) -> Result<String, AgentError>;

    /// Apply a session mode at runtime. Default routes through
    /// `send_control_request(SetPermissionMode { … })` for Claude-style
    /// adapters; adapters with orthogonal sandbox/approval axes override.
    async fn apply_mode(&self, _mode: SessionMode) -> Result<(), AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "apply_mode (default impl)",
        ))
    }

    /// Cancel the in-flight turn. Default routes through
    /// `send_control_request(Interrupt)`.
    async fn cancel_turn(&self) -> Result<(), AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "cancel_turn (default impl)",
        ))
    }

    /// Graceful shutdown. Kills the child process, unregisters the PID, and
    /// drains pending control requests.
    async fn shutdown(self: Box<Self>);
}

/// Stateless factory for one agent kind. Registered in
/// `agents::registry::AGENT_REGISTRY`.
#[async_trait]
#[allow(dead_code)]
pub trait AgentAdapter: Send + Sync {
    fn agent_id(&self) -> AgentId;
    fn capabilities(&self) -> &AgentCapabilitySet;

    /// Locate the agent's CLI binary. Returns the discovered path or an
    /// `AgentError::BinaryNotFound` with user-actionable text the Welcome
    /// screen can surface verbatim.
    async fn detect_binary(&self) -> Result<String, AgentError>;

    /// Spawn a session and return its handle. The adapter:
    ///   * builds the native argv,
    ///   * wires stdin/stdout/stderr,
    ///   * tracks the child PID via `utils::pid_tracker`,
    ///   * emits `NormalizedEvent`s on the Tauri channel pair returned by
    ///     `chat_channel` / `activity_channel`,
    ///   * emits `ProcessExited` 2 s after the child exits (Self-Drive's
    ///     recovery loop depends on draining the stream first).
    async fn spawn_session(
        &self,
        app_handle: AppHandle,
        binary_path: &str,
        approval_server_port: Option<u16>,
        config: SessionConfig,
    ) -> Result<Box<dyn AgentProcessHandle>, AgentError>;
}

// ─────────────────────────────────────────────────────────────────────
// Tauri event channel naming
//
// Claude Code keeps its historical `claude-*` prefix (the frontend
// subscriptions in `src/lib/event-handlers/` predate the trait). Phase 2
// adds the parallel `codex-*` prefix for Codex sessions; the frontend
// subscribes to every known agent's channel template and dispatches via
// `NormalizedEvent.agent_id`. Renaming Claude's prefix is deferred
// indefinitely per Phase 2 spec §6.
// ─────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
pub fn chat_channel(agent_id: AgentId, session_id: &str) -> String {
    match agent_id {
        AgentId::ClaudeCode => format!("claude-chat-{}", session_id),
        AgentId::Codex => format!("codex-chat-{}", session_id),
    }
}

/// Routes a [`NormalizedEvent`] to chat vs. activity per the v1.1.11 split:
/// the Chat panel shows only conversation text + lifecycle envelopes; tool
/// invocations and subagent / task events go to the Activity feed.
/// Mirrors the Claude `route_events` dispatcher (`agents/claude_code/
/// message_router.rs`); adapters that emit `NormalizedEvent` directly use
/// this to pick the right Tauri channel.
#[allow(dead_code)]
pub fn is_activity_event(ev: &NormalizedEvent) -> bool {
    matches!(
        ev,
        NormalizedEvent::ToolUseStart { .. }
            | NormalizedEvent::ToolResult { .. }
            | NormalizedEvent::ToolProgress { .. }
            | NormalizedEvent::AgentPreparing { .. }
            | NormalizedEvent::SubAgentStarted { .. }
            | NormalizedEvent::SubAgentProgress { .. }
            | NormalizedEvent::SubAgentComplete { .. }
            | NormalizedEvent::TaskNotification { .. }
            | NormalizedEvent::TaskUpdated { .. }
    )
}

#[allow(dead_code)]
pub fn activity_channel(agent_id: AgentId, session_id: &str) -> String {
    match agent_id {
        AgentId::ClaudeCode => format!("claude-activity-{}", session_id),
        AgentId::Codex => format!("codex-activity-{}", session_id),
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn agent_id_serializes_snake_case() {
        let id = AgentId::ClaudeCode;
        let s = serde_json::to_string(&id).unwrap();
        assert_eq!(s, "\"claude_code\"");
        assert_eq!(AgentId::ClaudeCode.as_str(), "claude_code");
    }

    #[test]
    fn agent_id_roundtrips_through_serde() {
        let id = AgentId::ClaudeCode;
        let s = serde_json::to_string(&id).unwrap();
        let back: AgentId = serde_json::from_str(&s).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn agent_id_codex_serializes_snake_case() {
        let id = AgentId::Codex;
        let s = serde_json::to_string(&id).unwrap();
        assert_eq!(s, "\"codex\"");
        assert_eq!(AgentId::Codex.as_str(), "codex");
    }

    #[test]
    fn agent_id_codex_roundtrips_through_serde() {
        let id = AgentId::Codex;
        let s = serde_json::to_string(&id).unwrap();
        let back: AgentId = serde_json::from_str(&s).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn agent_ids_are_distinct() {
        assert_ne!(AgentId::ClaudeCode, AgentId::Codex);
        assert_ne!(AgentId::ClaudeCode.as_str(), AgentId::Codex.as_str());
    }

    #[test]
    fn chat_channel_codex_uses_codex_prefix() {
        assert_eq!(chat_channel(AgentId::Codex, "sess-xyz"), "codex-chat-sess-xyz");
    }

    #[test]
    fn activity_channel_codex_uses_codex_prefix() {
        assert_eq!(
            activity_channel(AgentId::Codex, "sess-xyz"),
            "codex-activity-sess-xyz"
        );
    }

    #[test]
    fn is_activity_event_routes_tools_to_activity() {
        let chat_events = [
            NormalizedEvent::TextDelta {
                agent_id: AgentId::Codex,
                session_id: "s".into(),
                text: "".into(),
            },
            NormalizedEvent::TurnComplete {
                agent_id: AgentId::Codex,
                session_id: "s".into(),
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
            },
            NormalizedEvent::CompactingStatus {
                agent_id: AgentId::Codex,
                session_id: "s".into(),
                is_compacting: true,
            },
        ];
        for ev in &chat_events {
            assert!(!is_activity_event(ev), "expected chat for {:?}", ev);
        }

        let activity_events = [
            NormalizedEvent::ToolUseStart {
                agent_id: AgentId::Codex,
                session_id: "s".into(),
                tool_use_id: "x".into(),
                tool_name: "Bash".into(),
                tool_input: serde_json::Value::Null,
            },
            NormalizedEvent::ToolResult {
                agent_id: AgentId::Codex,
                session_id: "s".into(),
                tool_use_id: "x".into(),
                content: None,
                is_error: false,
            },
            NormalizedEvent::ToolProgress {
                agent_id: AgentId::Codex,
                session_id: "s".into(),
                tool_use_id: "x".into(),
                tool_name: "Bash".into(),
                elapsed_seconds: 1.0,
            },
        ];
        for ev in &activity_events {
            assert!(is_activity_event(ev), "expected activity for {:?}", ev);
        }
    }

    #[test]
    fn channels_are_distinct_across_agents() {
        // Two sessions with the same id but different agents must not collide.
        assert_ne!(
            chat_channel(AgentId::ClaudeCode, "s"),
            chat_channel(AgentId::Codex, "s")
        );
        assert_ne!(
            activity_channel(AgentId::ClaudeCode, "s"),
            activity_channel(AgentId::Codex, "s")
        );
    }

    #[test]
    fn chat_channel_uses_legacy_claude_prefix() {
        assert_eq!(
            chat_channel(AgentId::ClaudeCode, "sess-abc"),
            "claude-chat-sess-abc"
        );
    }

    #[test]
    fn activity_channel_uses_legacy_claude_prefix() {
        assert_eq!(
            activity_channel(AgentId::ClaudeCode, "sess-abc"),
            "claude-activity-sess-abc"
        );
    }

    #[test]
    fn chat_and_activity_channels_differ() {
        // Channel split is non-negotiable: chat-only text + tool ops in
        // activity. Mixing them would put tool noise into the chat panel.
        let chat = chat_channel(AgentId::ClaudeCode, "s");
        let activity = activity_channel(AgentId::ClaudeCode, "s");
        assert_ne!(chat, activity);
    }

    #[test]
    fn session_mode_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&SessionMode::AutoAccept).unwrap(),
            "\"auto-accept\""
        );
        assert_eq!(
            serde_json::to_string(&SessionMode::DontAsk).unwrap(),
            "\"dont-ask\""
        );
        assert_eq!(
            serde_json::to_string(&SessionMode::BypassPermissions).unwrap(),
            "\"bypass-permissions\""
        );
    }

    #[test]
    fn session_mode_roundtrips_all_variants() {
        for mode in [
            SessionMode::Normal,
            SessionMode::AutoAccept,
            SessionMode::Plan,
            SessionMode::Auto,
            SessionMode::DontAsk,
            SessionMode::BypassPermissions,
        ] {
            let s = serde_json::to_string(&mode).unwrap();
            let back: SessionMode = serde_json::from_str(&s).unwrap();
            assert_eq!(back, mode);
        }
    }

    #[test]
    fn control_request_payload_tags_subtype() {
        let set_model = ControlRequestPayload::SetModel {
            model: "claude-opus-4-7".into(),
        };
        let s = serde_json::to_value(&set_model).unwrap();
        assert_eq!(s["subtype"], "set_model");
        assert_eq!(s["model"], "claude-opus-4-7");

        let interrupt = ControlRequestPayload::Interrupt;
        let s = serde_json::to_value(&interrupt).unwrap();
        assert_eq!(s["subtype"], "interrupt");

        let set_perm = ControlRequestPayload::SetPermissionMode {
            mode: "plan".into(),
        };
        let s = serde_json::to_value(&set_perm).unwrap();
        assert_eq!(s["subtype"], "set_permission_mode");
        assert_eq!(s["mode"], "plan");
    }

    #[test]
    fn normalized_event_tags_type_and_includes_agent_id() {
        let ev = NormalizedEvent::TextDelta {
            agent_id: AgentId::ClaudeCode,
            session_id: "s".into(),
            text: "hi".into(),
        };
        let value = serde_json::to_value(&ev).unwrap();
        assert_eq!(value["type"], "text_delta");
        assert_eq!(value["agent_id"], "claude_code");
        assert_eq!(value["session_id"], "s");
        assert_eq!(value["text"], "hi");
    }

    #[test]
    fn normalized_event_turn_complete_carries_full_envelope() {
        let ev = NormalizedEvent::TurnComplete {
            agent_id: AgentId::ClaudeCode,
            session_id: "s".into(),
            duration_ms: Some(1234),
            usage: Some(UsageInfo {
                input_tokens: Some(10),
                output_tokens: Some(20),
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
                service_tier: None,
                server_tool_use: None,
                iterations: None,
            }),
            cost_usd: Some(0.01),
            duration_api_ms: Some(900),
            num_turns: Some(1),
            stop_reason: Some("end_turn".into()),
            terminal_reason: None,
            model_name: Some("claude-opus-4-7".into()),
            context_window: Some(200_000),
            max_output_tokens: Some(8_192),
        };
        let value = serde_json::to_value(&ev).unwrap();
        assert_eq!(value["type"], "turn_complete");
        assert_eq!(value["duration_ms"], 1234);
        assert_eq!(value["usage"]["input_tokens"], 10);
        assert_eq!(value["context_window"], 200_000);
    }

    #[test]
    fn normalized_event_protected_path_deny_round_trips_denials() {
        let denial = PermissionDenial {
            tool_name: "Write".into(),
            tool_use_id: "tool-1".into(),
            tool_input: json!({"file_path": ".claude/secret"}),
        };
        let ev = NormalizedEvent::ProtectedPathDeny {
            agent_id: AgentId::ClaudeCode,
            session_id: "s".into(),
            denials: vec![denial],
        };
        let value = serde_json::to_value(&ev).unwrap();
        assert_eq!(value["type"], "protected_path_deny");
        assert_eq!(value["denials"][0]["tool_name"], "Write");
        assert_eq!(value["denials"][0]["tool_input"]["file_path"], ".claude/secret");
    }

    #[test]
    fn agent_error_messages_are_user_actionable() {
        let e = AgentError::BinaryNotFound("Claude Code CLI not found".into());
        let msg = e.to_string();
        assert!(msg.contains("not found"), "got: {msg}");

        let e = AgentError::CapabilityNotSupported(AgentId::ClaudeCode, "set_max_thinking_tokens");
        let msg = e.to_string();
        assert!(msg.contains("ClaudeCode"));
        assert!(msg.contains("set_max_thinking_tokens"));
    }

    #[test]
    fn session_config_holds_only_agent_agnostic_fields() {
        // Compile-time guard: keep SessionConfig free of agent-specific knobs.
        // If you find yourself adding `claude_binary` or `codex_sandbox_mode`
        // here, push it into the adapter's own config layer instead.
        let cfg = SessionConfig {
            session_id: "s".into(),
            project_path: "/p".into(),
            session_name: None,
            model_override: None,
            append_system_prompt: None,
            resume_token: None,
            effort_override: None,
        };
        assert_eq!(cfg.session_id, "s");
    }

    #[test]
    fn capability_set_renders_at_least_one_capability_distinct() {
        let caps = AgentCapabilitySet {
            agent_id: AgentId::ClaudeCode,
            display_name: "Claude Code",
            supports_interrupt: true,
            supports_set_model: true,
            supports_initialize: true,
            supports_set_permission_mode: true,
            supports_resume_session: true,
            supports_append_system_prompt: true,
            supports_thinking_blocks: true,
            supports_subagents: true,
            supports_tasks_protocol: true,
            supports_external_approval_hook: true,
            supports_protected_path_denials: true,
            supports_raw_stream_log: true,
            supports_project_doc_injection: false,
            supports_sandbox_modes: false,
            supports_approval_policy: false,
            supports_session_mode: true,
            supports_mcp_management: true,
            supports_in_app_login: false,
            supports_audit_patch_role: true,
        };
        assert_eq!(caps.display_name, "Claude Code");
        assert!(caps.supports_interrupt);
    }
}
