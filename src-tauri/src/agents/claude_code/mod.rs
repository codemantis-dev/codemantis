//! Claude Code adapter.
//!
//! Phase 1 Session 2 was a near-mechanical move of the former
//! `crate::claude::*` module plus the Claude-specific CLI helpers from
//! `crate::utils::*`. The behaviour is byte-identical to v1.1.11 — the only
//! change is the module path and the addition of the [`ClaudeCodeAdapter`]
//! wrapper that exposes the existing [`ClaudeProcess`] through the
//! [`AgentAdapter`] / [`AgentProcessHandle`] traits.
//!
//! Sessions 2–4 kept a `src/claude/mod.rs` re-export shim for back-compat;
//! Session 5 migrated every caller to `crate::agents::claude_code::*` and
//! deleted the shim. This is now the single home for the Claude path.
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase1-AgentAdapter-Refactor-v1.2.md`
//! §3.1, §3.3.

pub mod approval_server;
pub mod claude_detection;
pub mod cli_handshake_probe;
pub mod cli_version;
pub mod event_types;
pub mod message_router;
pub mod process;
pub mod session;
pub mod stream_parser;

#[cfg(test)]
mod tests;

use async_trait::async_trait;
use tauri::AppHandle;

use crate::agents::{
    AgentAdapter, AgentCapabilitySet, AgentError, AgentId, AgentProcessHandle,
    ControlRequestPayload, SessionConfig, SessionMode,
};

use process::ClaudeProcess;

/// Maps a normalized [`SessionMode`] to the Claude CLI `--permission-mode`
/// string. Wire format is camelCase (matches the CLI's `--permission-mode`
/// choices). Do **not** rely on serde for this direction — the kebab-case
/// serde repr does not match what the CLI expects (`DontAsk` would serialize
/// as `"dont-ask"` but the CLI wants `"dontAsk"`).
///
/// Spec §3.3: `session_mode_to_cli` lives here as a `pub(crate)` translator.
/// (The legacy copy in `commands/session.rs`, which operates on the soon-to-be
/// retired `session::SessionMode`, is removed in Session 3.)
pub(crate) fn session_mode_to_cli(mode: SessionMode) -> &'static str {
    match mode {
        SessionMode::Normal => "default",
        SessionMode::AutoAccept => "acceptEdits",
        SessionMode::Plan => "plan",
        SessionMode::Auto => "auto",
        SessionMode::DontAsk => "dontAsk",
        SessionMode::BypassPermissions => "bypassPermissions",
    }
}

/// Convert the agent-agnostic control payload into the Claude-native stdin
/// shape. Structurally 1:1; the two enums are kept distinct so the Claude
/// wire serialization (which the capture harness pins) is never perturbed by
/// a change to the generic vocabulary.
fn to_native_control(
    payload: ControlRequestPayload,
) -> event_types::ControlRequestPayload {
    match payload {
        ControlRequestPayload::Interrupt => {
            event_types::ControlRequestPayload::Interrupt
        }
        ControlRequestPayload::SetModel { model } => {
            event_types::ControlRequestPayload::SetModel { model }
        }
        ControlRequestPayload::Initialize => {
            event_types::ControlRequestPayload::Initialize
        }
        ControlRequestPayload::SetPermissionMode { mode } => {
            event_types::ControlRequestPayload::SetPermissionMode { mode }
        }
    }
}

/// The Claude Code [`AgentAdapter`]. Stateless — one instance lives in the
/// registry. All per-session state is in the [`ClaudeCodeProcessHandle`] it
/// returns.
pub struct ClaudeCodeAdapter {
    // Read via `capabilities()`; that trait method is first consumed by the
    // Phase 2 capability-driven UI (provider picker / feature gating).
    #[allow(dead_code)]
    capabilities: AgentCapabilitySet,
}

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        Self {
            capabilities: AgentCapabilitySet {
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
                // Phase 2 capability axis (spec §4.2):
                supports_project_doc_injection: false,    // uses --append-system-prompt instead
                supports_sandbox_modes: false,            // sandbox/approval are Codex-only axes
                supports_approval_policy: false,
                supports_session_mode: true,              // 6-mode SessionMode taxonomy
                supports_mcp_management: true,            // ~/.claude.json
                supports_in_app_login: false,             // user runs `claude login` in a terminal
                supports_audit_patch_role: true,          // can splice spec fixes via AUDIT-PATCH
            },
        }
    }
}

impl Default for ClaudeCodeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-session handle wrapping the existing [`ClaudeProcess`]. The wrapped
/// process keeps doing exactly what it did in v1.1.11; this type only adapts
/// its API surface to [`AgentProcessHandle`].
pub struct ClaudeCodeProcessHandle {
    inner: ClaudeProcess,
    // Returned by `session_id()`; that accessor is first consumed in Phase 2
    // when the command layer routes by handle identity rather than map key.
    #[allow(dead_code)]
    session_id: String,
}

#[async_trait]
impl AgentProcessHandle for ClaudeCodeProcessHandle {
    fn agent_id(&self) -> AgentId {
        AgentId::ClaudeCode
    }

    fn session_id(&self) -> &str {
        &self.session_id
    }

    fn is_running(&self) -> bool {
        self.inner.is_running()
    }

    async fn send_user_message(&self, text: &str) -> Result<(), AgentError> {
        self.inner
            .send_message(text)
            .map_err(|e| AgentError::SendFailed(e.to_string()))
    }

    async fn send_tool_result(
        &self,
        _tool_use_id: &str,
        _approved: bool,
    ) -> Result<(), AgentError> {
        // Claude Code gates tools via the PreToolUse hook + the approval HTTP
        // server, not via a stdin tool_result message. The legacy
        // `StdinMessage::ToolResult` path is unused in the hook approach.
        Err(AgentError::CapabilityNotSupported(
            AgentId::ClaudeCode,
            "send_tool_result (Claude uses the PreToolUse approval server)",
        ))
    }

    async fn send_control_request(
        &self,
        payload: ControlRequestPayload,
    ) -> Result<String, AgentError> {
        self.inner
            .send_control_request(to_native_control(payload))
            .map_err(|e| AgentError::SendFailed(e.to_string()))
    }

    async fn apply_mode(&self, mode: SessionMode) -> Result<(), AgentError> {
        // Plan-mode pitfall (spec §2.2 / capture S06): the CLI silently
        // overrides `--permission-mode` when `--dangerously-skip-permissions`
        // is set, so mode is *only* ever applied at runtime via this
        // control_request, never at spawn.
        self.send_control_request(ControlRequestPayload::SetPermissionMode {
            mode: session_mode_to_cli(mode).to_string(),
        })
        .await
        .map(|_| ())
    }

    async fn cancel_turn(&self) -> Result<(), AgentError> {
        self.send_control_request(ControlRequestPayload::Interrupt)
            .await
            .map(|_| ())
    }

    async fn shutdown(self: Box<Self>) {
        let mut me = *self;
        me.inner.shutdown().await;
    }
}

#[async_trait]
impl AgentAdapter for ClaudeCodeAdapter {
    fn agent_id(&self) -> AgentId {
        AgentId::ClaudeCode
    }

    fn capabilities(&self) -> &AgentCapabilitySet {
        &self.capabilities
    }

    async fn detect_binary(&self) -> Result<String, AgentError> {
        let status = claude_detection::detect_claude();
        match status.binary_path {
            Some(path) => Ok(path),
            None => Err(AgentError::BinaryNotFound(
                "Claude Code CLI not found. Install with: \
                 npm install -g @anthropic-ai/claude-code"
                    .to_string(),
            )),
        }
    }

    async fn spawn_session(
        &self,
        app_handle: AppHandle,
        binary_path: &str,
        approval_server_port: Option<u16>,
        config: SessionConfig,
    ) -> Result<Box<dyn AgentProcessHandle>, AgentError> {
        let proc = ClaudeProcess::spawn(
            app_handle,
            config.session_id.clone(),
            &config.project_path,
            binary_path,
            config.resume_token.as_deref(),
            approval_server_port,
            config.model_override.as_deref(),
            config.append_system_prompt.as_deref(),
            config.session_name.as_deref(),
            config.effort_override.as_deref(),
        )
        .await
        .map_err(|e| AgentError::SpawnFailed(e.to_string()))?;

        Ok(Box::new(ClaudeCodeProcessHandle {
            inner: proc,
            session_id: config.session_id,
        }))
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;

    #[test]
    fn adapter_reports_claude_code_identity() {
        let a = ClaudeCodeAdapter::new();
        assert_eq!(a.agent_id(), AgentId::ClaudeCode);
        assert_eq!(a.capabilities().display_name, "Claude Code");
    }

    #[test]
    fn claude_code_advertises_full_control_protocol() {
        let caps = ClaudeCodeAdapter::new().capabilities().clone();
        assert!(caps.supports_interrupt);
        assert!(caps.supports_set_model);
        assert!(caps.supports_initialize);
        assert!(caps.supports_set_permission_mode);
        assert!(caps.supports_external_approval_hook);
        assert!(caps.supports_thinking_blocks);
        assert!(caps.supports_subagents);
        assert!(caps.supports_tasks_protocol);
    }

    #[test]
    fn session_mode_to_cli_uses_camelcase_wire_values() {
        // Pinned: these are the exact strings the CLI's --permission-mode
        // accepts. DontAsk must be "dontAsk", not the serde "dont-ask".
        assert_eq!(session_mode_to_cli(SessionMode::Normal), "default");
        assert_eq!(session_mode_to_cli(SessionMode::AutoAccept), "acceptEdits");
        assert_eq!(session_mode_to_cli(SessionMode::Plan), "plan");
        assert_eq!(session_mode_to_cli(SessionMode::Auto), "auto");
        assert_eq!(session_mode_to_cli(SessionMode::DontAsk), "dontAsk");
        assert_eq!(
            session_mode_to_cli(SessionMode::BypassPermissions),
            "bypassPermissions"
        );
    }

    #[test]
    fn to_native_control_is_one_to_one() {
        use event_types::ControlRequestPayload as Native;
        assert!(matches!(
            to_native_control(ControlRequestPayload::Interrupt),
            Native::Interrupt
        ));
        assert!(matches!(
            to_native_control(ControlRequestPayload::Initialize),
            Native::Initialize
        ));
        match to_native_control(ControlRequestPayload::SetModel {
            model: "claude-opus-4-7".into(),
        }) {
            Native::SetModel { model } => assert_eq!(model, "claude-opus-4-7"),
            _ => panic!("expected SetModel"),
        }
        match to_native_control(ControlRequestPayload::SetPermissionMode {
            mode: "plan".into(),
        }) {
            Native::SetPermissionMode { mode } => assert_eq!(mode, "plan"),
            _ => panic!("expected SetPermissionMode"),
        }
    }
}
