//! Spawn + wire `codex app-server --listen stdio://` for one session.
//!
//! This is the connection point between the pure protocol code in S2/S3
//! (`jsonrpc`, `client`, `translation`, `approvals`) and the Tauri /
//! process plumbing. Everything that needs an `AppHandle`, a real child
//! process, or PID tracking lives here.
//!
//! Lifecycle (spec §4.3):
//!   1. `auth_probe::probe_login_status` — bail with `AuthRequired` if
//!      the user hasn't run `codex login`.
//!   2. `tokio::process::Command::new(binary).args(["app-server",
//!      "--listen", "stdio://"])` with stdin/stdout/stderr piped + the
//!      login-shell PATH so npm-installed Codex finds its node runtime.
//!   3. Stdin writer task drains an `mpsc::UnboundedReceiver<String>`
//!      from `CodexClient`; stdout reader task `BufReader::lines()` →
//!      `client.handle_incoming_line`.
//!   4. `initialize` request → `initialized` notification → emit
//!      `SessionInit` on the chat channel.
//!   5. `thread/start` (fresh) or `thread/resume` (crash recovery).
//!      Subsequent `turn/start`s flow through
//!      `CodexProcessHandle::send_user_message`.
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §4.3 (lifecycle), §4.4 (turn flow), §4.5 (approvals routing).

#![allow(dead_code)] // Command-layer wiring lands in S5.

use std::sync::Arc;

use log::{debug, info, warn};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};

use super::agents_md::EphemeralAgentsDir;
use super::approvals::{classify_server_request, ApprovalDecision, ApprovalResponse};
use super::auth_probe::{probe_login_status, AuthProbeOutcome};
use super::client::{
    ClientError, CodexClient, NotificationHandler, ServerRequestHandler,
};
use super::jsonrpc::{Id as RpcId, RpcError};
use super::thread_state::ThreadState;
use super::translation::Translator;
use crate::agents::{
    activity_channel, chat_channel, is_activity_event, AgentError, AgentId,
    AgentProcessHandle, ControlRequestPayload, NormalizedEvent, SessionConfig, SessionMode,
};
use crate::utils::paths::login_shell_path;

use async_trait::async_trait;
use tauri::{AppHandle, Emitter};

/// The Codex per-session handle. Owns the child process, the JSON-RPC
/// client, and (for SpecWriter sessions) the ephemeral AGENTS.md dir.
pub struct CodexProcessHandle {
    session_id: String,
    pid: Option<u32>,
    child: Arc<Mutex<Option<Child>>>,
    client: CodexClient,
    state: Arc<ThreadState>,
    /// SpecWriter sessions hold their AGENTS.override.md dir here; dropped
    /// on shutdown so cleanup happens whether the handle goes via the
    /// explicit `shutdown` or via Drop on the trait object.
    agents_md_dir: Mutex<Option<EphemeralAgentsDir>>,
    /// Per-turn defaults. The Codex protocol passes `model` / `effort` on
    /// each `turn/start`; updates from `SetModel` control_request land
    /// here and apply on the next `send_user_message`.
    current_model: Mutex<Option<String>>,
    current_effort: Mutex<Option<String>>,
    app_handle: AppHandle,
}

#[async_trait]
impl AgentProcessHandle for CodexProcessHandle {
    fn agent_id(&self) -> AgentId {
        AgentId::Codex
    }

    fn session_id(&self) -> &str {
        &self.session_id
    }

    fn is_running(&self) -> bool {
        // Same convention as the Claude handle: held lock = running.
        match self.child.try_lock() {
            Ok(guard) => guard.is_some(),
            Err(_) => true,
        }
    }

    async fn send_user_message(&self, text: &str) -> Result<(), AgentError> {
        let thread_id = self
            .state
            .thread_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| AgentError::ProtocolError("no thread/started yet".into()))?;

        let mut params = json!({
            "threadId": thread_id,
            "input": [{"type": "text", "text": text}],
        });
        if let Some(model) = self.current_model.lock().await.clone() {
            params["model"] = Value::String(model);
        }
        if let Some(effort) = self.current_effort.lock().await.clone() {
            params["effort"] = Value::String(effort);
        }

        // turn/start returns the new turn id immediately; the
        // notifications drive everything downstream.
        let resp = self
            .client
            .send_request("turn/start", params)
            .await
            .map_err(|e| AgentError::SendFailed(e.to_string()))?;

        if let Some(turn_id) = resp.get("turnId").and_then(|v| v.as_str()) {
            self.state
                .set_current_turn(Some(turn_id.to_string()))
                .await;
        }
        Ok(())
    }

    async fn send_tool_result(
        &self,
        _tool_use_id: &str,
        _approved: bool,
    ) -> Result<(), AgentError> {
        // Codex gates tools via server-initiated requestApproval; the
        // legacy stdin tool_result path doesn't exist.
        Err(AgentError::CapabilityNotSupported(
            AgentId::Codex,
            "send_tool_result (Codex uses server-initiated approvals — \
             see approvals::build_response_for)",
        ))
    }

    async fn send_control_request(
        &self,
        payload: ControlRequestPayload,
    ) -> Result<String, AgentError> {
        match payload {
            ControlRequestPayload::Interrupt => {
                let thread_id = self
                    .state
                    .thread_id
                    .lock()
                    .await
                    .clone()
                    .ok_or_else(|| AgentError::ProtocolError("no thread".into()))?;
                let turn_id = self
                    .state
                    .current_turn_id
                    .lock()
                    .await
                    .clone()
                    .ok_or_else(|| AgentError::ProtocolError("no active turn".into()))?;
                self.client
                    .send_request(
                        "turn/interrupt",
                        json!({"threadId": thread_id, "turnId": turn_id}),
                    )
                    .await
                    .map_err(|e| AgentError::SendFailed(e.to_string()))?;
                // No CLI-side request_id for Codex — fabricate one for the
                // pending-control-requests map's bookkeeping. The
                // interrupted-state event comes through turn/completed.
                Ok(format!("codex-interrupt-{}", uuid::Uuid::new_v4().simple()))
            }
            ControlRequestPayload::SetModel { model } => {
                *self.current_model.lock().await = Some(model);
                Ok(format!("codex-setmodel-{}", uuid::Uuid::new_v4().simple()))
            }
            ControlRequestPayload::Initialize => {
                // Idempotent: emit a CapabilitiesDiscovered with whatever
                // model/list we cached. For now this is a no-op acknowledged
                // request — S6's frontend will treat the absence of a fresh
                // response as "already discovered."
                Ok(format!("codex-init-{}", uuid::Uuid::new_v4().simple()))
            }
            ControlRequestPayload::SetPermissionMode { .. } => {
                // Codex has no equivalent — sandbox + approval-policy are
                // orthogonal axes set on the next turn/start. The
                // command layer (S5) routes the Policy pill through a
                // different code path; this branch shouldn't be reached.
                Err(AgentError::CapabilityNotSupported(
                    AgentId::Codex,
                    "set_permission_mode (use CodexSessionPolicy instead)",
                ))
            }
        }
    }

    async fn apply_mode(&self, _mode: SessionMode) -> Result<(), AgentError> {
        // Same rationale as SetPermissionMode above.
        Err(AgentError::CapabilityNotSupported(
            AgentId::Codex,
            "apply_mode (Codex uses orthogonal sandbox + approval policy)",
        ))
    }

    async fn cancel_turn(&self) -> Result<(), AgentError> {
        self.send_control_request(ControlRequestPayload::Interrupt)
            .await
            .map(|_| ())
    }

    async fn shutdown(self: Box<Self>) {
        info!(
            "[codex] Shutting down session {} (pid {:?})",
            self.session_id, self.pid
        );
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            if let Err(e) = child.kill().await {
                warn!(
                    "[codex] Failed to kill child for session {}: {}",
                    self.session_id, e
                );
            }
            if let Some(pid) = self.pid {
                crate::utils::pid_tracker::unregister_pid(pid);
            }
        }
        // Drop the ephemeral AGENTS.md dir (if any) for cleanup.
        let _ = self.agents_md_dir.lock().await.take();
    }
}

impl Drop for CodexProcessHandle {
    fn drop(&mut self) {
        // Last-resort kill if shutdown() was never called (e.g. panic mid-
        // session). Parallels ClaudeProcess's Drop guard.
        if let Some(pid) = self.pid {
            if let Ok(mut guard) = self.child.try_lock() {
                if guard.take().is_some() {
                    warn!(
                        "[codex] Drop safety net: killing PID {} for session {}",
                        pid, self.session_id
                    );
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGKILL);
                    }
                    crate::utils::pid_tracker::unregister_pid(pid);
                }
            }
        }
    }
}

/// Build + spawn a Codex session. Called by [`super::CodexAdapter::spawn_session`].
pub async fn spawn_codex_session(
    app_handle: AppHandle,
    binary_path: &str,
    config: SessionConfig,
    agents_md_dir: Option<EphemeralAgentsDir>,
) -> Result<Box<dyn AgentProcessHandle>, AgentError> {
    // 1. Auth check — fail fast with a user-actionable error.
    match probe_login_status(binary_path) {
        AuthProbeOutcome::Authenticated => {}
        AuthProbeOutcome::NotAuthenticated => {
            return Err(AgentError::AuthRequired(
                AuthProbeOutcome::NotAuthenticated
                    .actionable_message()
                    .unwrap_or_else(|| "codex login required".into()),
            ));
        }
        AuthProbeOutcome::ProbeFailed(reason) => {
            return Err(AgentError::SpawnFailed(format!(
                "could not probe codex login status: {reason}"
            )));
        }
    }

    // 2. Spawn child. Set cwd to the ephemeral SpecWriter dir if present
    // (Codex needs cwd inside the AGENTS.override.md tree to pick it up);
    // otherwise to the user's project path.
    let cwd = agents_md_dir
        .as_ref()
        .map(|d| d.path().to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from(&config.project_path));

    let mut cmd = Command::new(binary_path);
    cmd.args(["app-server", "--listen", "stdio://"]);
    if agents_md_dir.is_some() {
        // SpecWriter mode: grant Codex access to the user's actual project
        // even though cwd is the ephemeral dir (spec §2.5).
        cmd.args(["--add-dir", &config.project_path]);
    }
    cmd.current_dir(&cwd)
        .env("PATH", login_shell_path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AgentError::SpawnFailed(format!("codex app-server: {e}")))?;
    let pid = child.id();
    if let Some(pid) = pid {
        crate::utils::pid_tracker::register_pid(pid);
    }

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AgentError::SpawnFailed("child stdin not piped".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AgentError::SpawnFailed("child stdout not piped".into()))?;
    let stderr_opt = child.stderr.take();

    // 3. Outbound channel + stdin writer task.
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<String>();
    let sid_for_writer = config.session_id.clone();
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(line) = outbound_rx.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() {
                debug!("[codex {}] stdin write failed — child exited", sid_for_writer);
                break;
            }
            if stdin.flush().await.is_err() {
                break;
            }
        }
    });

    // Best-effort stderr drain (log only — Codex emits its own structured
    // errors via the JSON-RPC `error` notification).
    if let Some(stderr) = stderr_opt {
        let sid = config.session_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                debug!("[codex {} stderr] {}", sid, line);
            }
        });
    }

    // 4. Build the JSON-RPC client + handlers.
    let thread_state = Arc::new(ThreadState::new());
    let translator = Translator::new(config.session_id.clone(), thread_state.clone());

    let on_notif = make_notification_handler(app_handle.clone(), translator.clone());
    // Client-holder lets the server-request handler send error replies for
    // unknown methods without an Arc cycle.
    let client_holder: Arc<Mutex<Option<CodexClient>>> = Arc::new(Mutex::new(None));
    let on_server_req = make_server_request_handler(
        app_handle.clone(),
        config.session_id.clone(),
        thread_state.clone(),
        client_holder.clone(),
    );

    let client = CodexClient::new(outbound_tx, 0, on_notif, on_server_req);
    *client_holder.lock().await = Some(client.clone());

    // 5. Stdout reader task.
    let client_for_reader = client.clone();
    let sid_for_reader = config.session_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Err(e) = client_for_reader.handle_incoming_line(&line).await {
                warn!("[codex {}] parse error: {} (line: {})", sid_for_reader, e, line);
            }
        }
        debug!("[codex {}] stdout EOF — reader task exiting", sid_for_reader);
    });

    // 6. Handshake.
    let init_resp = client
        .send_request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "codemantis",
                    "title": "CodeMantis",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {
                    "experimentalApi": false,
                    "optOutNotificationMethods": [],
                },
            }),
        )
        .await
        .map_err(|e| AgentError::ProtocolError(format!("initialize failed: {e}")))?;
    debug!("[codex {}] initialize response: {}", config.session_id, init_resp);

    client
        .send_notification("initialized", json!({}))
        .map_err(|e| AgentError::ProtocolError(format!("initialized notification failed: {e}")))?;

    // SessionInit on the chat channel so the frontend can render the tab
    // header immediately (parity with Claude's CliSessionId emission).
    emit_event_for(
        &app_handle,
        &NormalizedEvent::SessionInit {
            agent_id: AgentId::Codex,
            session_id: config.session_id.clone(),
            model: config.model_override.clone(),
            thinking_effort: config.effort_override.clone(),
        },
    );

    // 7. thread/start or thread/resume.
    let (thread_method, thread_params) = if let Some(thread_id) = &config.resume_token {
        (
            "thread/resume",
            json!({
                "threadId": thread_id,
                "cwd": cwd.to_string_lossy(),
                "model": config.model_override,
                "approvalPolicy": "onRequest",
                "sandbox": "workspaceWrite",
                "personality": "pragmatic",
                "serviceName": "codemantis",
            }),
        )
    } else {
        (
            "thread/start",
            json!({
                "cwd": cwd.to_string_lossy(),
                "model": config.model_override,
                "approvalPolicy": "onRequest",
                "sandbox": "workspaceWrite",
                "personality": "pragmatic",
                "serviceName": "codemantis",
            }),
        )
    };
    let _ = client
        .send_request(thread_method, thread_params)
        .await
        .map_err(|e| AgentError::ProtocolError(format!("{thread_method} failed: {e}")))?;

    Ok(Box::new(CodexProcessHandle {
        session_id: config.session_id,
        pid,
        child: Arc::new(Mutex::new(Some(child))),
        client,
        state: thread_state,
        agents_md_dir: Mutex::new(agents_md_dir),
        current_model: Mutex::new(config.model_override),
        current_effort: Mutex::new(config.effort_override),
        app_handle,
    }))
}

fn make_notification_handler(
    app_handle: AppHandle,
    translator: Translator,
) -> NotificationHandler {
    Arc::new(move |method: String, params: Value| {
        let app_handle = app_handle.clone();
        let translator = translator.clone();
        tokio::spawn(async move {
            let events = translator.on_notification(&method, params).await;
            for ev in events {
                emit_event_for(&app_handle, &ev);
            }
        });
    })
}

fn make_server_request_handler(
    app_handle: AppHandle,
    session_id: String,
    state: Arc<ThreadState>,
    client_holder: Arc<Mutex<Option<CodexClient>>>,
) -> ServerRequestHandler {
    Arc::new(move |rpc_id: RpcId, method: String, params: Value| {
        let app_handle = app_handle.clone();
        let session_id = session_id.clone();
        let state = state.clone();
        let client_holder = client_holder.clone();
        tokio::spawn(async move {
            match classify_server_request(&state, &session_id, rpc_id.clone(), &method, params)
                .await
            {
                Some(req) => {
                    // Existing modal layer listens on the global
                    // tool-approval-request event.
                    if let Err(e) = app_handle.emit("tool-approval-request", &req) {
                        warn!(
                            "[codex {}] Failed to emit tool-approval-request: {}",
                            session_id, e
                        );
                    }
                }
                None => {
                    warn!(
                        "[codex {}] Unknown server-initiated method `{}` — replying -32601",
                        session_id, method
                    );
                    if let Some(client) = client_holder.lock().await.as_ref() {
                        let _ = client.respond_error(
                            rpc_id,
                            RpcError {
                                code: -32601,
                                message: format!("method not found: {method}"),
                                data: None,
                            },
                        );
                    }
                }
            }
        });
    })
}

/// Pick chat vs. activity channel and emit. Pure plumbing — the routing
/// logic lives in `agents::is_activity_event` so adding a new variant
/// only touches one place.
fn emit_event_for(app_handle: &AppHandle, ev: &NormalizedEvent) {
    let session_id = session_id_of(ev);
    let channel = if is_activity_event(ev) {
        activity_channel(AgentId::Codex, &session_id)
    } else {
        chat_channel(AgentId::Codex, &session_id)
    };
    if let Err(e) = app_handle.emit(&channel, ev) {
        warn!("[codex] Failed to emit {} on {}: {}", short_kind(ev), channel, e);
    }
}

fn session_id_of(ev: &NormalizedEvent) -> String {
    // Every variant carries a `session_id` field — extract via serde
    // rather than 25 match arms.
    serde_json::to_value(ev)
        .ok()
        .and_then(|v| v.get("session_id").and_then(|s| s.as_str()).map(str::to_string))
        .unwrap_or_default()
}

fn short_kind(ev: &NormalizedEvent) -> &'static str {
    match ev {
        NormalizedEvent::SessionInit { .. } => "SessionInit",
        NormalizedEvent::CliSessionId { .. } => "CliSessionId",
        NormalizedEvent::TextDelta { .. } => "TextDelta",
        NormalizedEvent::TextComplete { .. } => "TextComplete",
        NormalizedEvent::ThinkingDelta { .. } => "ThinkingDelta",
        NormalizedEvent::ThinkingComplete { .. } => "ThinkingComplete",
        NormalizedEvent::ToolUseStart { .. } => "ToolUseStart",
        NormalizedEvent::ToolResult { .. } => "ToolResult",
        NormalizedEvent::ToolProgress { .. } => "ToolProgress",
        NormalizedEvent::TurnComplete { .. } => "TurnComplete",
        NormalizedEvent::ProcessError { .. } => "ProcessError",
        NormalizedEvent::ProcessExited { .. } => "ProcessExited",
        NormalizedEvent::ProtectedPathDeny { .. } => "ProtectedPathDeny",
        NormalizedEvent::CompactingStatus { .. } => "CompactingStatus",
        NormalizedEvent::CompactComplete { .. } => "CompactComplete",
        NormalizedEvent::RateLimitWarning { .. } => "RateLimitWarning",
        NormalizedEvent::UsageUpdate { .. } => "UsageUpdate",
        NormalizedEvent::InterruptResult { .. } => "InterruptResult",
        NormalizedEvent::ModelChanged { .. } => "ModelChanged",
        NormalizedEvent::CapabilitiesDiscovered { .. } => "CapabilitiesDiscovered",
        NormalizedEvent::AgentPreparing { .. } => "AgentPreparing",
        NormalizedEvent::SubAgentStarted { .. } => "SubAgentStarted",
        NormalizedEvent::SubAgentProgress { .. } => "SubAgentProgress",
        NormalizedEvent::SubAgentComplete { .. } => "SubAgentComplete",
        NormalizedEvent::TaskNotification { .. } => "TaskNotification",
        NormalizedEvent::TaskUpdated { .. } => "TaskUpdated",
    }
}

/// Bridge for the existing `resolve_tool_approval` Tauri command (Claude's
/// approval path). When `agent_id` is `Codex`, S5's command layer calls
/// this instead of the HTTP-server-backed Claude resolver: it looks up
/// the pending [`super::thread_state::ServerRequestKind`] for this
/// `request_id`, builds the JSON-RPC response via
/// [`super::approvals::build_response`], and writes it back through the
/// client.
///
/// Lives in `spawn.rs` because it needs the live `CodexClient` handle.
#[allow(clippy::too_many_arguments)]
pub async fn resolve_codex_approval(
    handle: &CodexProcessHandle,
    request_id: &str,
    decision: ApprovalDecision,
    content: Option<Value>,
) -> Result<(), AgentError> {
    let Some(kind) = handle.state.take_server_request(request_id).await else {
        return Err(AgentError::ProtocolError(format!(
            "no pending Codex approval for request_id {request_id}"
        )));
    };
    let ApprovalResponse { rpc_id, result } =
        super::approvals::build_response(&kind, decision, content);
    handle
        .client
        .respond(rpc_id, result)
        .map_err(|e: ClientError| AgentError::SendFailed(e.to_string()))
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_of_extracts_from_every_variant_uniformly() {
        // Sample one event of each broad family.
        let evs = [
            NormalizedEvent::SessionInit {
                agent_id: AgentId::Codex,
                session_id: "sid-A".into(),
                model: None,
                thinking_effort: None,
            },
            NormalizedEvent::ToolUseStart {
                agent_id: AgentId::Codex,
                session_id: "sid-B".into(),
                tool_use_id: "x".into(),
                tool_name: "Bash".into(),
                tool_input: Value::Null,
            },
            NormalizedEvent::TurnComplete {
                agent_id: AgentId::Codex,
                session_id: "sid-C".into(),
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
        ];
        assert_eq!(session_id_of(&evs[0]), "sid-A");
        assert_eq!(session_id_of(&evs[1]), "sid-B");
        assert_eq!(session_id_of(&evs[2]), "sid-C");
    }

    #[test]
    fn short_kind_returns_stable_label_per_variant() {
        // Smoke test — a few representatives. Caller uses these in log
        // messages so they must not panic for any variant.
        let ev = NormalizedEvent::TextDelta {
            agent_id: AgentId::Codex,
            session_id: "s".into(),
            text: "x".into(),
        };
        assert_eq!(short_kind(&ev), "TextDelta");
        let ev2 = NormalizedEvent::ProtectedPathDeny {
            agent_id: AgentId::Codex,
            session_id: "s".into(),
            denials: vec![],
        };
        assert_eq!(short_kind(&ev2), "ProtectedPathDeny");
    }
}
