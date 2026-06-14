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

// CODEMANTIS_FORCE_LEGACY_CLAUDE removed in v1.3.0 / Phase 2 S8 per
// spec §12. The v1.2.0 soak surfaced no adapter-related regressions, so
// the diagnostic indicator and its IPC wrapper are gone. Rollback for
// the refactor is `git revert` of the Phase 1 commits, exactly as
// RELEASES.md v1.2.0 documented.

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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
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
    /// Codex / OpenAI o-series reasoning tokens. Hidden by the protocol
    /// (the reasoning text is never streamed) but the count is billed
    /// and reported. CodeMantis surfaces this as a "Codex reasoned for
    /// N tokens" chip in the Reasoning panel so users see *that*
    /// reasoning happened even when the content is unavailable.
    /// Field name aliases `reasoningOutputTokens` so Codex's camelCase
    /// notification payload deserialises directly.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "reasoningOutputTokens"
    )]
    pub reasoning_output_tokens: Option<u64>,
    /// Codex-only: the model's real context window (`modelContextWindow`). Lets
    /// the frontend context meter use the authoritative max instead of a guess.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_context_window: Option<u64>,
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

/// A single fragment inside a Codex `hookPrompt` ThreadItem. The CLI
/// can emit multiple fragments per hook run (e.g. when a hook chains
/// multiple `--add-context` calls); each surfaces as its own toast.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HookPromptFragment {
    pub hook_run_id: String,
    pub text: String,
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

    /// Non-alarming, informational session notice. Rendered as an INFO
    /// toast (not a red error) — used e.g. when a Codex `thread/resume`
    /// can't find its rollout and we transparently start a fresh thread
    /// instead of failing the session.
    #[serde(rename = "session_notice")]
    SessionNotice {
        agent_id: AgentId,
        session_id: String,
        message: String,
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

    /// Fired when the per-session reasoning effort changes. Codex emits
    /// this from `CodexProcessHandle::set_effort`; Claude has no runtime
    /// path for effort and never fires this. Mirrors `ModelChanged`.
    #[serde(rename = "effort_changed")]
    EffortChanged {
        agent_id: AgentId,
        session_id: String,
        effort: String,
        success: bool,
        error: Option<String>,
    },

    /// Codex `enteredReviewMode` ThreadItem at item/completed. Carries the
    /// final `review` text — `ReviewModeBanner` reads it from
    /// `sessionReviewContent`. Lifecycle pair with `ReviewModeExited`.
    #[serde(rename = "review_mode_entered")]
    ReviewModeEntered {
        agent_id: AgentId,
        session_id: String,
        item_id: String,
        review: String,
    },

    /// Codex `exitedReviewMode` ThreadItem at item/completed. Carries the
    /// final review text; the banner keeps showing this until the user
    /// dismisses it explicitly.
    #[serde(rename = "review_mode_exited")]
    ReviewModeExited {
        agent_id: AgentId,
        session_id: String,
        item_id: String,
        final_review: String,
    },

    /// CodeMantis-native Codex "plan mode" toggled. Emitted both when the
    /// Plan pill flips `set_codex_plan_mode` (confirming the local change)
    /// and when Codex reports a real `collaborationMode` via
    /// `thread/settings/updated`. `chat.ts` flips the session into / out of
    /// `SessionMode::Plan`, which drives the plan-mode banner above the chat.
    ///
    /// Note: this is NOT Codex's built-in `/plan` — the app-server exposes no
    /// settable `collaborationMode` lever (verified against the 0.139.0
    /// schema), so the native approximation flips the next `turn/start` to a
    /// read-only sandbox + a planning preamble. The `thread/settings/updated`
    /// path future-proofs the indicator for a real plan signal.
    #[serde(rename = "codex_plan_mode_changed")]
    CodexPlanModeChanged {
        agent_id: AgentId,
        session_id: String,
        enabled: bool,
    },

    /// Codex `hookPrompt` ThreadItem at item/completed. Each fragment is
    /// surfaced as an info toast. Distinct from hook lifecycle status
    /// (started/completed) below — `hookPrompt` is hook-emitted content,
    /// not hook-runtime metadata.
    #[serde(rename = "hook_prompt")]
    HookPrompt {
        agent_id: AgentId,
        session_id: String,
        item_id: String,
        fragments: Vec<HookPromptFragment>,
    },

    /// Codex hook lifecycle (HookStarted / HookCompleted RPC
    /// notifications, not ThreadItems). Surfaced as info / warning /
    /// error toasts depending on `status`.
    #[serde(rename = "hook_status")]
    HookStatus {
        agent_id: AgentId,
        session_id: String,
        run_id: String,
        event_name: String,
        kind: String, // "started" | "completed"
        status: String, // running | completed | failed | blocked | stopped
        duration_ms: Option<u64>,
    },

    /// Codex requested a ChatGPT auth-token refresh (`reason: "unauthorized"`).
    /// CodeMantis doesn't yet implement the OAuth handoff, so the spawn
    /// loop emits this event + responds with a structured JSON-RPC error.
    /// The frontend surfaces a toast prompting the user to run
    /// `codex login` in a terminal. Tracked as v1.5.0 work.
    #[serde(rename = "auth_token_refresh_requested")]
    AuthTokenRefreshRequested {
        agent_id: AgentId,
        session_id: String,
        previous_account_id: Option<String>,
        reason: String,
    },

    /// Codex pushed an `item/tool/call` (server-initiated dynamic tool
    /// execution). CodeMantis has no client-side tool registry yet, so
    /// the spawn loop responds with `{success: false, contentItems:[...]}`
    /// and emits this event so the chat handler can toast the user.
    #[serde(rename = "dynamic_tool_call_denied")]
    DynamicToolCallDenied {
        agent_id: AgentId,
        session_id: String,
        tool: String,
        namespace: Option<String>,
    },

    /// Codex `mcpServer/startupStatus/updated` lifecycle. Emitted only
    /// for the meaningful transitions (`failed` / `cancelled`) so the
    /// chat handler can toast users when a Codex MCP server fails to
    /// start. `starting` and `ready` are silent — too noisy otherwise.
    /// Schema:
    /// docs/internal/codex-app-server-schemas/v2/McpServerStatusUpdatedNotification.json
    #[serde(rename = "mcp_startup_status")]
    McpStartupStatus {
        agent_id: AgentId,
        session_id: String,
        name: String,
        status: String,
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
// Codex session policy (sandbox × approval — Phase 2 §6.1)
// ─────────────────────────────────────────────────────────────────────

/// Codex sandbox mode. Wire formats:
/// - Rust ↔ TS (IPC): kebab-case via serde (`read-only`, `workspace-write`,
///   `danger-full-access`).
/// - CodeMantis → Codex JSON-RPC: kebab-case (`read-only`,
///   `workspace-write`, `danger-full-access`) — translated via
///   [`CodexSandbox::as_codex_wire`]. **Verified empirically** against
///   `codex app-server generate-json-schema` (codex-cli 0.130.0,
///   `v2/ThreadStartParams.json` → `SandboxMode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum CodexSandbox {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

impl CodexSandbox {
    /// Codex app-server SandboxMode enum (verified against
    /// `codex app-server generate-json-schema` on codex-cli 0.130.0 —
    /// see `docs/internal/codex-app-server-schemas/v2/ThreadStartParams.json`):
    ///   `"read-only" | "workspace-write" | "danger-full-access"`.
    /// **Kebab-case**, not camelCase — the Phase 2 spec doc was wrong
    /// here and earlier code sent camelCase, producing rpc -32600.
    pub fn as_codex_wire(self) -> &'static str {
        match self {
            CodexSandbox::ReadOnly => "read-only",
            CodexSandbox::WorkspaceWrite => "workspace-write",
            CodexSandbox::DangerFullAccess => "danger-full-access",
        }
    }
}

/// Codex approval policy. Wire formats:
/// - Rust ↔ TS (IPC): kebab-case (`never`, `on-request`, `untrusted`).
/// - CodeMantis → Codex JSON-RPC: kebab-case (`never`, `on-request`,
///   `untrusted`). **Verified empirically** against
///   `codex app-server generate-json-schema` (`AskForApproval`
///   enum). The schema also lists `on-failure` which v1.3.0 doesn't
///   surface in the Policy pill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum CodexApproval {
    Never,
    OnRequest,
    Untrusted,
}

impl CodexApproval {
    /// Codex app-server AskForApproval enum (verified against
    /// `codex app-server generate-json-schema` on codex-cli 0.130.0):
    ///   `"untrusted" | "on-failure" | "on-request" | "never"`.
    /// **Kebab-case**, not camelCase — same lesson as CodexSandbox.
    /// `on-failure` exists in the live binary but isn't surfaced in
    /// the v1.3.0 Policy pill (the three documented in spec §6.1 are
    /// what the UI exposes).
    pub fn as_codex_wire(self) -> &'static str {
        match self {
            CodexApproval::Never => "never",
            CodexApproval::OnRequest => "on-request",
            CodexApproval::Untrusted => "untrusted",
        }
    }
}

/// The user's choice from the Policy pill (Phase 2 §6.1). Mirrors the
/// shape `set_codex_policy` accepts over IPC.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CodexSessionPolicy {
    pub sandbox: CodexSandbox,
    pub approval: CodexApproval,
    /// Whether to allow network access inside `workspace-write` (gated by
    /// the `codex_network_access` Preflight recipe — spec §8). `false` is
    /// the safe default; the frontend Policy pill only enables this when
    /// the user has explicitly opted in via `~/.codex/config.toml`.
    #[serde(default)]
    pub network_access: bool,
}

impl CodexSessionPolicy {
    /// Build the `sandboxPolicy` OBJECT for `turn/start`
    /// (`v2/TurnStartParams.json` → `SandboxPolicy`).
    ///
    /// CRITICAL: this is a DIFFERENT shape AND casing from `thread/start`'s
    /// `sandbox` field. `thread/start` takes a `SandboxMode` STRING in
    /// kebab-case (`workspace-write`); `turn/start` takes a `SandboxPolicy`
    /// OBJECT whose `type` tag is CAMELCASE (`readOnly` / `workspaceWrite`
    /// / `dangerFullAccess`) with `networkAccess` carried on the object.
    ///
    /// Codex 0.137 tolerates unknown params (additionalProperties), so the
    /// previous code that sent the `sandbox` string on `turn/start` was
    /// SILENTLY IGNORED — per-turn sandbox overrides (the Policy pill) were
    /// a no-op until this was wired through.
    pub fn as_turn_sandbox_policy(self) -> serde_json::Value {
        match self.sandbox {
            CodexSandbox::ReadOnly => serde_json::json!({
                "type": "readOnly",
                "networkAccess": self.network_access,
            }),
            CodexSandbox::WorkspaceWrite => serde_json::json!({
                "type": "workspaceWrite",
                "networkAccess": self.network_access,
            }),
            // danger-full-access has no networkAccess knob (everything is allowed).
            CodexSandbox::DangerFullAccess => serde_json::json!({
                "type": "dangerFullAccess",
            }),
        }
    }
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

    /// Update the reasoning effort that will apply on the next turn.
    /// Codex passes `effort` per-turn so this is a cheap mutex update +
    /// `EffortChanged` emit; Claude's `--effort` is spawn-time only and
    /// returns `CapabilityNotSupported` here. UI surfaces (EffortSelector)
    /// already branch on agent and only call this for Codex sessions.
    async fn set_effort(&self, _effort: String) -> Result<(), AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "set_effort (default impl — Claude --effort is spawn-time only)",
        ))
    }

    /// Respond to a previously-routed server-initiated approval. Codex
    /// uses this for its 4 `*/requestApproval` kinds (spec §4.5); Claude's
    /// HTTP approval-server path is unchanged so its impl returns
    /// `CapabilityNotSupported` and the command layer skips this call
    /// when `agent_id == ClaudeCode`.
    ///
    /// Returns `Ok(true)` if the request_id was found and resolved on this
    /// handle, `Ok(false)` if not (so the command layer can try the next
    /// session — request_ids are session-scoped but the IPC doesn't carry
    /// a session id today).
    async fn respond_to_approval(
        &self,
        _request_id: &str,
        _approved: bool,
        _content: Option<serde_json::Value>,
    ) -> Result<bool, AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "respond_to_approval (default impl)",
        ))
    }

    /// Apply a Codex sandbox + approval-policy combination at runtime.
    /// Takes effect on the next `turn/start`. Claude returns
    /// `CapabilityNotSupported` (use `apply_mode` instead).
    async fn set_codex_policy(
        &self,
        _policy: CodexSessionPolicy,
    ) -> Result<(), AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "set_codex_policy (default impl)",
        ))
    }

    /// Toggle CodeMantis-native Codex "plan mode". When enabled, the next
    /// `turn/start` is forced to a read-only sandbox and a planning preamble
    /// is injected so Codex plans (using the full prior thread context)
    /// without editing files. Takes effect on the next `send_user_message`.
    /// Claude returns `CapabilityNotSupported` (it has real plan mode via
    /// `apply_mode` / `set_permission_mode`).
    async fn set_codex_plan_mode(&self, _enabled: bool) -> Result<(), AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "set_codex_plan_mode (default impl — Codex only)",
        ))
    }

    /// Start a fresh thread on the *existing live* app-server, abandoning the
    /// current thread's context. Returns the new thread id so the command
    /// layer can persist it. This is the escape hatch for an un-compactable
    /// context: when Codex's auto-compaction stream drops, the turn dies but
    /// the context isn't shrunk, so every resend re-triggers the same doomed
    /// compaction. A fresh thread (empty context) on the same process breaks
    /// that loop without a respawn — the session tab and transcript are kept.
    /// Codex-only; Claude has no thread concept and returns
    /// `CapabilityNotSupported` so the command layer falls back to a full
    /// session restart.
    async fn reset_thread(&self) -> Result<String, AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "reset_thread (default impl — Codex only)",
        ))
    }

    /// Generic Codex app-server JSON-RPC passthrough for management
    /// methods (`config/read`, `config/value/write`, `mcpServerStatus/list`,
    /// `account/*`, …). Returns the raw response `Value` so callers parse
    /// defensively. The Codex override maps a `-32601` (method not found —
    /// the binary is older/newer than us) to `CapabilityNotSupported` so
    /// the command layer can fall back gracefully (e.g. "open config.toml")
    /// instead of surfacing a raw protocol error.
    ///
    /// This single method is deliberately generic: a new Codex management
    /// method needs only a new Tauri command + frontend wrapper, never a
    /// trait/adapter change — the core of the version-resilience goal.
    /// Claude returns `CapabilityNotSupported`.
    async fn codex_rpc(
        &self,
        _method: String,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, AgentError> {
        Err(AgentError::CapabilityNotSupported(
            self.agent_id(),
            "codex_rpc (default impl — Codex only)",
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
    // EffortChanged / ReviewMode* / HookPrompt / HookStatus are
    // session-lifecycle events (mirror ModelChanged) — chat channel, not
    // activity. Tool / sub-agent variants stay on activity.
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

    /// Minimal handle implementing only the required trait methods so the
    /// default `reset_thread` (and other Codex-only defaults) can be exercised.
    struct DummyHandle;

    #[async_trait]
    impl AgentProcessHandle for DummyHandle {
        fn agent_id(&self) -> AgentId {
            AgentId::ClaudeCode
        }
        fn session_id(&self) -> &str {
            "dummy"
        }
        fn is_running(&self) -> bool {
            true
        }
        async fn send_user_message(&self, _text: &str) -> Result<(), AgentError> {
            Ok(())
        }
        async fn send_tool_result(
            &self,
            _tool_use_id: &str,
            _approved: bool,
        ) -> Result<(), AgentError> {
            Ok(())
        }
        async fn send_control_request(
            &self,
            _payload: ControlRequestPayload,
        ) -> Result<String, AgentError> {
            Ok("req".into())
        }
        async fn shutdown(self: Box<Self>) {}
    }

    #[tokio::test]
    async fn reset_thread_default_impl_is_capability_not_supported() {
        let handle = DummyHandle;
        let err = handle.reset_thread().await.unwrap_err();
        assert!(matches!(
            err,
            AgentError::CapabilityNotSupported(AgentId::ClaudeCode, _)
        ));
    }

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
    fn codex_sandbox_wire_matches_published_schema() {
        // Anchored against v2/ThreadStartParams.json::SandboxMode in
        // docs/internal/codex-app-server-schemas/. If Codex changes
        // these values, re-run `codex app-server generate-json-schema`
        // and update both the schema dump and this test.
        assert_eq!(CodexSandbox::ReadOnly.as_codex_wire(), "read-only");
        assert_eq!(CodexSandbox::WorkspaceWrite.as_codex_wire(), "workspace-write");
        assert_eq!(
            CodexSandbox::DangerFullAccess.as_codex_wire(),
            "danger-full-access"
        );
    }

    #[test]
    fn codex_turn_sandbox_policy_matches_published_schema() {
        // Anchored against v2/TurnStartParams.json::SandboxPolicy. NOTE the
        // CAMELCASE type tags + networkAccess field — distinct from the
        // kebab-case SandboxMode string thread/start uses.
        let ro = CodexSessionPolicy {
            sandbox: CodexSandbox::ReadOnly,
            approval: CodexApproval::Never,
            network_access: false,
        };
        assert_eq!(
            ro.as_turn_sandbox_policy(),
            json!({"type": "readOnly", "networkAccess": false})
        );

        let ww = CodexSessionPolicy {
            sandbox: CodexSandbox::WorkspaceWrite,
            approval: CodexApproval::OnRequest,
            network_access: true,
        };
        assert_eq!(
            ww.as_turn_sandbox_policy(),
            json!({"type": "workspaceWrite", "networkAccess": true})
        );

        let dfa = CodexSessionPolicy {
            sandbox: CodexSandbox::DangerFullAccess,
            approval: CodexApproval::Never,
            network_access: true,
        };
        // danger-full-access carries no networkAccess knob.
        assert_eq!(dfa.as_turn_sandbox_policy(), json!({"type": "dangerFullAccess"}));
    }

    #[test]
    fn codex_approval_wire_matches_published_schema() {
        // Anchored against v2/ThreadStartParams.json::AskForApproval.
        // Note: the schema also lists `on-failure` which the Policy
        // pill doesn't surface in v1.3.0 — that's a UI-scope choice,
        // not a wire-format bug.
        assert_eq!(CodexApproval::Never.as_codex_wire(), "never");
        assert_eq!(CodexApproval::OnRequest.as_codex_wire(), "on-request");
        assert_eq!(CodexApproval::Untrusted.as_codex_wire(), "untrusted");
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
            model: "claude-opus-4-8".into(),
        };
        let s = serde_json::to_value(&set_model).unwrap();
        assert_eq!(s["subtype"], "set_model");
        assert_eq!(s["model"], "claude-opus-4-8");

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
                reasoning_output_tokens: None,
                model_context_window: None,
            }),
            cost_usd: Some(0.01),
            duration_api_ms: Some(900),
            num_turns: Some(1),
            stop_reason: Some("end_turn".into()),
            terminal_reason: None,
            model_name: Some("claude-opus-4-8".into()),
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
