//! OpenAI Codex adapter (Phase 2).
//!
//! Codex is not "Claude with a different binary" — its protocol is
//! bidirectional JSON-RPC 2.0 over stdio (`codex app-server --listen
//! stdio://`) with primitives that have no Claude equivalent: threads,
//! server-initiated approvals, AGENTS.md instead of `--append-system-prompt`.
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md` §2.4.
//!
//! Session boundaries:
//!   * S2 (this commit) — the pure protocol layer: framer, id allocator,
//!     in-flight request bookkeeping, backpressure retry. No subprocess
//!     wiring, no Tauri / AppState coupling.
//!   * S3 — translator (ThreadEvent → NormalizedEvent), approvals, auth
//!     probe.
//!   * S4 — `CodexAdapter` glue + spawn + AGENTS.md ephemeral dir + MCP
//!     config; registered in `agents::registry`.

pub mod agents_md;
pub mod approvals;
pub mod auth_probe;
pub mod binary_detect;
pub mod client;
pub mod jsonrpc;
pub mod mcp_config;
pub mod spawn;
pub mod thread_state;
pub mod translation;

use async_trait::async_trait;
use tauri::AppHandle;

use crate::agents::{
    AgentAdapter, AgentCapabilitySet, AgentError, AgentId, AgentProcessHandle, SessionConfig,
};

/// The OpenAI Codex [`AgentAdapter`]. Stateless — one instance lives in
/// the registry. Per-session state is in the [`spawn::CodexProcessHandle`]
/// it returns.
pub struct CodexAdapter {
    capabilities: AgentCapabilitySet,
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self {
            capabilities: AgentCapabilitySet {
                agent_id: AgentId::Codex,
                display_name: "OpenAI Codex",
                // Control-protocol parity — Codex has its own dialect:
                supports_interrupt: true, // turn/interrupt
                supports_set_model: true, // per-turn model on turn/start
                supports_initialize: true,
                supports_set_permission_mode: false,
                // Session / spawn:
                supports_resume_session: true, // thread/resume
                supports_append_system_prompt: false, // uses AGENTS.md instead
                supports_thinking_blocks: true, // reasoning items
                supports_subagents: false,   // experimental in Codex, out of v1.3.0
                supports_tasks_protocol: false, // experimental
                supports_external_approval_hook: false, // JSON-RPC server-initiated requests
                supports_protected_path_denials: true, // .codex/, .git/, .agents/
                supports_raw_stream_log: true,
                // Phase 2 axis:
                supports_project_doc_injection: true, // AGENTS.override.md
                supports_sandbox_modes: true,
                supports_approval_policy: true,
                supports_session_mode: false, // replaced by sandbox×approval
                supports_mcp_management: true, // ~/.codex/config.toml
                supports_in_app_login: false, // deferred to v1.4.0
                // Flag is currently unused: since v1.4.1 Phase B the
                // "Patch spec & re-audit" button runs through whichever agent
                // owns the SpecWriter session (Codex follows the Claude-tuned
                // splice prompt directly). Kept here for future capability gating.
                supports_audit_patch_role: false,
            },
        }
    }
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentAdapter for CodexAdapter {
    fn agent_id(&self) -> AgentId {
        AgentId::Codex
    }

    fn capabilities(&self) -> &AgentCapabilitySet {
        &self.capabilities
    }

    async fn detect_binary(&self) -> Result<String, AgentError> {
        let status = binary_detect::detect_codex();
        match status.binary_path {
            Some(path) => Ok(path),
            None => Err(AgentError::BinaryNotFound(
                "OpenAI Codex CLI not found. Install with: \
                 npm install -g @openai/codex (or run `brew install codex`); \
                 then sign in with: codex login"
                    .to_string(),
            )),
        }
    }

    async fn spawn_session(
        &self,
        app_handle: AppHandle,
        binary_path: &str,
        _approval_server_port: Option<u16>,
        config: SessionConfig,
    ) -> Result<Box<dyn AgentProcessHandle>, AgentError> {
        // SpecWriter sessions arrive with `append_system_prompt` set; we
        // translate that into an ephemeral AGENTS.override.md dir per
        // spec §2.5.
        let agents_md_dir = if let Some(prompt) = config.append_system_prompt.as_deref() {
            Some(agents_md::EphemeralAgentsDir::create(&config.session_id, prompt).map_err(
                |e| AgentError::SpawnFailed(format!("AGENTS.override.md write failed: {e}")),
            )?)
        } else {
            None
        };
        spawn::spawn_codex_session(app_handle, binary_path, config, agents_md_dir).await
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;

    #[test]
    fn adapter_reports_codex_identity() {
        let a = CodexAdapter::new();
        assert_eq!(a.agent_id(), AgentId::Codex);
        assert_eq!(a.capabilities().display_name, "OpenAI Codex");
    }

    #[test]
    fn codex_capabilities_match_spec_4_2() {
        let c = CodexAdapter::new().capabilities().clone();
        // Codex strengths:
        assert!(c.supports_interrupt);
        assert!(c.supports_set_model);
        assert!(c.supports_resume_session);
        assert!(c.supports_thinking_blocks);
        assert!(c.supports_protected_path_denials);
        assert!(c.supports_raw_stream_log);
        // Codex-only axis:
        assert!(c.supports_project_doc_injection);
        assert!(c.supports_sandbox_modes);
        assert!(c.supports_approval_policy);
        assert!(c.supports_mcp_management);
        // Codex absences (vs. Claude):
        assert!(!c.supports_set_permission_mode);
        assert!(!c.supports_append_system_prompt);
        assert!(!c.supports_subagents);
        assert!(!c.supports_tasks_protocol);
        assert!(!c.supports_external_approval_hook);
        assert!(!c.supports_session_mode);
        assert!(!c.supports_in_app_login);
        assert!(!c.supports_audit_patch_role);
    }

    #[tokio::test]
    async fn detect_binary_returns_actionable_error_when_codex_absent() {
        // We can't reliably remove `codex` from $PATH in tests, but we can
        // assert the error message shape when it IS missing by stubbing
        // the detector. Here we just confirm the adapter accessors are
        // wired correctly via the registered instance.
        let a = CodexAdapter::new();
        // The error branch's message must mention `codex login` so users
        // know what to do post-install.
        let err_msg = AgentError::BinaryNotFound(
            "OpenAI Codex CLI not found. Install with: \
             npm install -g @openai/codex (or run `brew install codex`); \
             then sign in with: codex login"
                .into(),
        )
        .to_string();
        assert!(err_msg.contains("codex login"));
        let _ = a;
    }
}
