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
    AgentProcessHandle, CodexApproval, CodexSandbox, CodexSessionPolicy,
    ControlRequestPayload, NormalizedEvent, SessionConfig, SessionMode,
};
use crate::utils::paths::login_shell_path;

use async_trait::async_trait;
use tauri::{AppHandle, Emitter, Manager};

/// How long to wait for Codex's `turn/interrupt` acknowledgement before we
/// stop blocking on it. Must be bounded: `interrupt_session` holds the
/// global `processes` lock across this await, and a wedged Codex app-server
/// may never reply — an unbounded wait would deadlock every later command
/// and leave the session permanently dead. See the `Interrupt` branch.
const CODEX_INTERRUPT_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

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
    /// Active sandbox + approval policy. Defaults to (workspace-write,
    /// on-request) per spec §2.3 ("Auto" preset). Updated by
    /// `set_codex_policy` and applied on the next `turn/start`.
    current_policy: Mutex<CodexSessionPolicy>,
    /// CodeMantis-native "plan mode". When `true`, the next `turn/start`
    /// forces a read-only sandbox and prepends a planning preamble to the
    /// user input so Codex plans (over the full prior thread context)
    /// without editing. Toggled by `set_codex_plan_mode`. Codex 0.139.0
    /// exposes no settable `collaborationMode`, so this is an approximation.
    plan_mode: Mutex<bool>,
    app_handle: AppHandle,
}

/// Preamble prepended to the turn input when plan mode is on. Worded to use
/// the ENTIRE prior conversation in this thread (which `turn/start` preserves
/// by reusing the same `threadId`), and to plan only — no file edits.
pub(crate) const CODEX_PLAN_MODE_PREAMBLE: &str = "\
[Plan mode] You are in planning mode. Take the ENTIRE preceding conversation \
in this thread into account. Investigate as needed (read-only), then produce a \
clear, step-by-step implementation plan. Do NOT edit files, create/delete files, \
or run mutating commands — the sandbox is read-only. Present the plan for review.\n\n";

/// Apply native plan-mode overrides to a turn's `(policy, input_text)`. When
/// plan mode is on: force a read-only sandbox (real enforcement), disable
/// network access, and prepend the planning preamble. Pure — unit-testable
/// without a live handle. Off → returns the policy and text unchanged.
pub(crate) fn apply_plan_mode(
    mut policy: CodexSessionPolicy,
    plan_mode: bool,
    text: &str,
) -> (CodexSessionPolicy, String) {
    if plan_mode {
        policy.sandbox = CodexSandbox::ReadOnly;
        policy.network_access = false;
        (policy, format!("{CODEX_PLAN_MODE_PREAMBLE}{text}"))
    } else {
        (policy, text.to_string())
    }
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

        // Native plan mode: force a read-only sandbox (the real enforcement —
        // Codex literally can't edit) and prepend the planning preamble. The
        // same `threadId` is reused below, so Codex still sees the full prior
        // conversation. Approval policy is left untouched (read-only already
        // blocks mutations).
        let base_policy = *self.current_policy.lock().await;
        let plan_mode = *self.plan_mode.lock().await;
        let (policy, input_text) = apply_plan_mode(base_policy, plan_mode, text);
        // turn/start uses `sandboxPolicy` (an OBJECT, camelCase type tag),
        // NOT `sandbox` (the SandboxMode string thread/start takes). Sending
        // `sandbox` here is silently ignored by Codex 0.137, so per-turn
        // sandbox overrides from the Policy pill were a no-op before this.
        let mut params = json!({
            "threadId": thread_id,
            "input": [{"type": "text", "text": input_text}],
            "sandboxPolicy": policy.as_turn_sandbox_policy(),
            "approvalPolicy": policy.approval.as_codex_wire(),
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
                interrupt_turn(
                    &self.client,
                    &self.session_id,
                    &thread_id,
                    &turn_id,
                    CODEX_INTERRUPT_ACK_TIMEOUT,
                )
                .await?;
                // No CLI-side request_id for Codex — fabricate one for the
                // pending-control-requests map's bookkeeping. The
                // interrupted-state event comes through turn/completed.
                Ok(format!("codex-interrupt-{}", uuid::Uuid::new_v4().simple()))
            }
            ControlRequestPayload::SetModel { model } => {
                // Codex applies `model` per-turn (turn/start), so SetModel
                // just updates the per-handle default. Unlike Claude, there
                // is no echo-back from the CLI — emit ModelChanged here so
                // chat.ts can update `session.model` and the ModelSelector
                // shows the new pick. Without this, the UI shows "Model ▼"
                // forever even after a successful select (the bug that
                // motivated this fix).
                *self.current_model.lock().await = Some(model.clone());
                emit_event_for(
                    &self.app_handle,
                    &NormalizedEvent::ModelChanged {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        model,
                        success: true,
                        error: None,
                    },
                );
                Ok(format!("codex-setmodel-{}", uuid::Uuid::new_v4().simple()))
            }
            ControlRequestPayload::Initialize => {
                // Refresh capabilities live by re-running `model/list`
                // and re-emitting CapabilitiesDiscovered. Without this,
                // a session spawned against an older binary that didn't
                // populate `supportedReasoningEfforts` would have stale
                // caps forever — the EffortSelector would stay hidden
                // even after the binary was upgraded. Now the frontend
                // can call `initialize_session` to refresh on demand.
                discover_capabilities(&self.client, &self.app_handle, &self.session_id).await;
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

    async fn set_effort(&self, effort: String) -> Result<(), AgentError> {
        // Codex applies effort per turn (turn/start), so this is just a
        // mutex swap + an EffortChanged emit so chat.ts can update
        // sessionEffort. Mirrors the hotfix-#10 ModelChanged pattern —
        // without the explicit emit the frontend never confirms the
        // switch and EffortSelector falls back to its stale display.
        *self.current_effort.lock().await = Some(effort.clone());
        emit_event_for(
            &self.app_handle,
            &NormalizedEvent::EffortChanged {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                effort,
                success: true,
                error: None,
            },
        );
        Ok(())
    }

    async fn respond_to_approval(
        &self,
        request_id: &str,
        approved: bool,
        content: Option<Value>,
    ) -> Result<bool, AgentError> {
        let Some(kind) = self.state.take_server_request(request_id).await else {
            // request_id not on this handle — caller may try another
            // session. Returning Ok(false) avoids surfacing a hard error
            // for what is really a "not mine" outcome.
            return Ok(false);
        };
        let decision = super::approvals::ApprovalDecision::from_bool(approved);
        let resp = super::approvals::build_response(&kind, decision, content);
        self.client
            .respond(resp.rpc_id, resp.result)
            .map_err(|e| AgentError::SendFailed(e.to_string()))?;
        Ok(true)
    }

    async fn set_codex_policy(
        &self,
        policy: CodexSessionPolicy,
    ) -> Result<(), AgentError> {
        *self.current_policy.lock().await = policy;
        Ok(())
    }

    async fn set_codex_plan_mode(&self, enabled: bool) -> Result<(), AgentError> {
        *self.plan_mode.lock().await = enabled;
        // Echo back so the frontend confirms the toggle (mirrors the
        // ModelChanged / EffortChanged pattern — Codex never echoes these
        // itself). chat.ts flips SessionMode::Plan on / off from this.
        emit_event_for(
            &self.app_handle,
            &NormalizedEvent::CodexPlanModeChanged {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                enabled,
            },
        );
        Ok(())
    }

    async fn codex_rpc(
        &self,
        method: String,
        params: Value,
    ) -> Result<Value, AgentError> {
        self.client
            .send_request(&method, params)
            .await
            .map_err(|e| map_management_error(&method, e))
    }

    async fn reset_thread(&self) -> Result<String, AgentError> {
        // Reuse the spawn-time base params (cwd / policy / model / …) captured
        // in ThreadState so the fresh thread matches the session's shape. The
        // active per-turn policy is re-applied on the next `turn/start`, so we
        // don't need the *current* policy here.
        let params = self
            .state
            .start_params
            .lock()
            .await
            .clone()
            .ok_or_else(|| {
                AgentError::ProtocolError(
                    "no start params captured for this session — cannot reset thread".into(),
                )
            })?;

        // Best-effort: abandon any in-flight turn (typically the wedged
        // compaction that triggered recovery) before starting the fresh
        // thread, so the new thread isn't racing a dying turn. Bounded by
        // CODEX_INTERRUPT_ACK_TIMEOUT; errors (e.g. no active turn) are
        // expected and ignored.
        let _ = self
            .send_control_request(ControlRequestPayload::Interrupt)
            .await;

        // Fresh thread/start on the still-alive app-server. Empty context →
        // breaks the un-compactable-context loop without a respawn.
        let new_id = send_thread_start(&self.client, &self.session_id, params)
            .await?
            .ok_or_else(|| {
                AgentError::ProtocolError(
                    "thread/start returned no thread id on reset".into(),
                )
            })?;

        // Swap the live thread id and clear the stale turn so the next
        // send_user_message targets the fresh thread.
        self.state.set_thread_id(new_id.clone()).await;
        self.state.set_current_turn(None).await;

        // Persist + cache the new id (so crash recovery resumes the FRESH
        // thread, not the broken one) and emit CliSessionId so the frontend
        // tracks the swap — mirrors the spawn-time persistence path.
        store_codex_cli_session_id(&self.app_handle, &self.session_id, &new_id).await;
        emit_event_for(
            &self.app_handle,
            &NormalizedEvent::CliSessionId {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                cli_session_id: new_id.clone(),
            },
        );

        info!(
            "[codex {}] reset to fresh thread {} (compaction-failure recovery)",
            self.session_id, new_id
        );
        Ok(new_id)
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

/// Build the JSON-RPC error to send back to Codex when we couldn't
/// deliver `tool-approval-request` to the UI. Extracted so the unit
/// test can pin the exact wording — Codex shows this in its own UI as
/// the cause of the rolled-back turn, so it needs to be actionable.
fn emit_failure_rpc_error(method: &str) -> RpcError {
    RpcError {
        code: -32603,
        message: format!(
            "CodeMantis lost the approval event for `{method}` \
             (could not deliver tool-approval-request to the UI). \
             Please retry."
        ),
        data: None,
    }
}

/// Build the chat-channel toast we surface on emit failure. Same
/// extraction rationale as [`emit_failure_rpc_error`].
fn emit_failure_chat_event(session_id: &str, method: &str) -> NormalizedEvent {
    NormalizedEvent::ProcessError {
        agent_id: AgentId::Codex,
        session_id: session_id.to_string(),
        error: format!(
            "CodeMantis couldn't show an approval prompt for `{method}`. \
             The Codex turn was rolled back — please try again."
        ),
    }
}

/// Build the argv that launches `codex app-server`.
///
/// Centralised so a unit test can pin the exact shape (notably the
/// `shell_environment_policy.inherit=all` override that keeps host tools
/// like docker/gh/aws/ssh working — see Entitlements.plist for why we
/// don't double-restrict the sub-shell).
///
/// `extra_dir`, if `Some`, is appended as `--add-dir <path>` (SpecWriter
/// mode: the project path is exposed to Codex even though cwd is the
/// ephemeral AGENTS.override.md tree).
fn build_app_server_args(extra_dir: Option<&str>) -> Vec<String> {
    let mut argv = vec![
        "-c".to_string(),
        "shell_environment_policy.inherit=all".to_string(),
        "app-server".to_string(),
        "--listen".to_string(),
        "stdio://".to_string(),
    ];
    if let Some(p) = extra_dir {
        argv.push("--add-dir".to_string());
        argv.push(p.to_string());
    }
    argv
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
    // See `build_app_server_args` — the `-c shell_environment_policy.inherit=all`
    // override is the reason host tools (docker/gh/aws/ssh) work inside
    // Codex sessions; without it Codex strips HOME/DOCKER_HOST/etc. from
    // sub-shells and tools silently fail with EACCES.
    let extra_dir = agents_md_dir.as_ref().map(|_| config.project_path.as_str());
    cmd.args(build_app_server_args(extra_dir));
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

    // Optional raw-wire logger (both directions + stderr → per-session NDJSON).
    // Enabled by the `codexDebugLoggingEnabled` setting or `CM_CODEX_WIRE_LOG=1`.
    // The diagnostic of record for compaction stalls — the harness proves the
    // protocol completes at every context size, so a real stall must be captured
    // from the user's actual session.
    let wire_log = if super::wire_log::WireLog::is_enabled_by_config() {
        let wl = super::wire_log::WireLog::open(
            &config.session_id,
            chrono::Utc::now().timestamp_millis(),
        );
        if let Some(p) = wl.path() {
            info!("[codex {}] wire logging → {}", config.session_id, p.display());
        }
        wl
    } else {
        super::wire_log::WireLog::disabled()
    };

    // 3. Outbound channel + stdin writer task.
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<String>();
    let sid_for_writer = config.session_id.clone();
    let wire_writer = wire_log.clone();
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(line) = outbound_rx.recv().await {
            wire_writer.record("send", &line);
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
        let wire_stderr = wire_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                wire_stderr.record("stderr", &line);
                debug!("[codex {} stderr] {}", sid, line);
            }
        });
    }

    // 4. Build the JSON-RPC client + handlers.
    let thread_state = Arc::new(ThreadState::new());
    let translator = Translator::new(config.session_id.clone(), thread_state.clone());

    let on_notif = make_notification_handler(
        app_handle.clone(),
        config.session_id.clone(),
        translator.clone(),
    );
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
    let wire_reader = wire_log.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            wire_reader.record("recv", &line);
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

    // Discover capabilities (model/list → CapabilitiesDiscovered).
    // Pulled into a helper so the Initialize control request can re-fire
    // it on a live session — necessary for refreshing caps without
    // close+reopen when (e.g.) the user wants the EffortSelector to
    // re-appear after a binary upgrade that added new fields.
    discover_capabilities(&client, &app_handle, &config.session_id).await;

    // 7. thread/start or thread/resume — uses the "Auto" preset from
    // spec §2.3 (workspace-write × on-request). Phase 2 §6.1's Policy
    // pill mutates this via set_codex_policy after spawn.
    //
    // v1.3.1: build params dynamically so we (a) never send `"model":
    // null` for unspecified-model sessions (Codex 0.130.0 rejects with
    // -32600), and (b) only attach `personality` / `serviceName` when
    // documented. If Codex returns Invalid Request, dump the full
    // response so the user has a diagnostic instead of "unknown ...".
    let initial_policy = CodexSessionPolicy {
        sandbox: CodexSandbox::WorkspaceWrite,
        approval: CodexApproval::OnRequest,
        network_access: false,
    };
    // Schema source of truth: `codex app-server generate-json-schema`
    // emits v2/ThreadStartParams.json + v2/ThreadResumeParams.json.
    // Both accept the same shape; only `threadId` is required (resume)
    // — `cwd` is optional. We send kebab-case enum values (fixed in
    // hotfix #6 — earlier code sent camelCase and got rpc -32600).
    let mut params = serde_json::Map::new();
    params.insert(
        "cwd".into(),
        Value::String(cwd.to_string_lossy().into_owned()),
    );
    params.insert(
        "approvalPolicy".into(),
        Value::String(initial_policy.approval.as_codex_wire().into()),
    );
    params.insert(
        "sandbox".into(),
        Value::String(initial_policy.sandbox.as_codex_wire().into()),
    );
    // Personality + serviceName ARE in v2/ThreadStartParams.json. The
    // v1.3.1 #5 commit wrongly dropped them suspecting they caused
    // -32600; the real culprit was the camelCase enum values. Restored
    // here — they're useful metrics (serviceName tags this app in
    // Codex's analytics, personality picks the assistant style).
    params.insert("personality".into(), Value::String("pragmatic".into()));
    params.insert("serviceName".into(), Value::String("codemantis".into()));
    if let Some(model) = config.model_override.as_deref() {
        if !model.is_empty() {
            params.insert("model".into(), Value::String(model.to_string()));
        }
    }

    // Capture the base params (no threadId) so `reset_thread` can later mint
    // a fresh thread on this same live app-server — the escape hatch for an
    // un-compactable context (compaction-failure recovery).
    thread_state.set_start_params(params.clone()).await;

    // Resilient start/resume: if a resume is requested but the rollout is
    // gone (archived/GC'd/stale id), fall back to a fresh thread/start
    // instead of killing the session with "no rollout found". (`params`
    // here is the shared base — threadId is added inside for resume.)
    let started_thread_id =
        start_or_resume_thread(&client, &app_handle, &config, params).await?;

    // Set the thread id synchronously from the start/resume RESPONSE
    // (`thread.id`, a required field) BEFORE the handle is usable. We used
    // to rely solely on the `thread/started` *notification* to populate
    // `thread_state.thread_id`, but `thread/resume` doesn't emit that
    // notification — so after a pause+resume (e.g. `/clear`, or the
    // stuck-banner hard restart) the thread id stayed `None` and the very
    // next send_user_message died with "no thread/started yet", killing the
    // session. Reading it from the response fixes resume *and* removes the
    // spawn-time race on fresh starts. Idempotent with the notification
    // handler (same id), and we persist here too so resume sessions that
    // skip the notification still survive a crash/restart.
    if let Some(tid) = started_thread_id {
        thread_state.set_thread_id(tid.clone()).await;
        store_codex_cli_session_id(&app_handle, &config.session_id, &tid).await;
    }

    Ok(Box::new(CodexProcessHandle {
        session_id: config.session_id,
        pid,
        child: Arc::new(Mutex::new(Some(child))),
        client,
        state: thread_state,
        agents_md_dir: Mutex::new(agents_md_dir),
        current_model: Mutex::new(config.model_override),
        current_effort: Mutex::new(config.effort_override),
        current_policy: Mutex::new(initial_policy),
        plan_mode: Mutex::new(false),
        app_handle,
    }))
}

/// Start a fresh thread or resume an existing one, falling back to a
/// fresh `thread/start` when a requested resume can't find its rollout.
///
/// `base_params` is the shared param map (cwd / approvalPolicy / sandbox /
/// personality / serviceName / model) WITHOUT `threadId`; the resume path
/// clones it and adds `threadId`.
async fn start_or_resume_thread(
    client: &CodexClient,
    app_handle: &AppHandle,
    config: &SessionConfig,
    base_params: serde_json::Map<String, Value>,
) -> Result<Option<String>, AgentError> {
    let Some(thread_id) = config.resume_token.as_deref().filter(|s| !s.is_empty()) else {
        return send_thread_start(client, &config.session_id, base_params).await;
    };

    // Pre-flight: skip a doomed resume if no rollout exists on disk.
    if !super::rollout::rollout_exists(thread_id) {
        log::info!(
            "[codex {}] no rollout on disk for thread {} — starting a fresh thread",
            config.session_id, thread_id
        );
        emit_resume_fallback_notice(app_handle, &config.session_id);
        return send_thread_start(client, &config.session_id, base_params).await;
    }

    let mut resume_params = base_params.clone();
    resume_params.insert("threadId".into(), Value::String(thread_id.to_string()));
    debug!(
        "[codex {}] sending thread/resume with params: {}",
        config.session_id,
        serde_json::to_string(&resume_params).unwrap_or_default()
    );
    match client
        .send_request("thread/resume", Value::Object(resume_params))
        .await
    {
        // Pull `thread.id` straight from the resume response — resume emits
        // no `thread/started` notification, so this is the ONLY place the
        // thread id surfaces for a resumed session.
        Ok(resp) => Ok(thread_id_from_response(&resp)),
        Err(e) if should_fallback_to_start(&e) => {
            // The rollout vanished out from under us (race with archive/GC,
            // or a stale id). Don't strand the session — start fresh.
            log::warn!(
                "[codex {}] thread/resume failed ({e}) — starting a fresh thread",
                config.session_id
            );
            emit_resume_fallback_notice(app_handle, &config.session_id);
            send_thread_start(client, &config.session_id, base_params).await
        }
        Err(e) => {
            log::error!(
                "[codex {}] thread/resume failed fatally: {e} — check Codex CLI version + wire format",
                config.session_id
            );
            Err(AgentError::ProtocolError(format!("thread/resume failed: {e}")))
        }
    }
}

/// Send `thread/start` with the given params; map failure to a clear
/// ProtocolError with the full (untruncated) Codex error in the log.
/// Returns the new thread id from the response (`thread.id`) so the caller
/// can populate `thread_state` synchronously rather than waiting on the
/// (separately-spawned) `thread/started` notification handler.
async fn send_thread_start(
    client: &CodexClient,
    session_id: &str,
    params: serde_json::Map<String, Value>,
) -> Result<Option<String>, AgentError> {
    debug!(
        "[codex {session_id}] sending thread/start with params: {}",
        serde_json::to_string(&params).unwrap_or_default()
    );
    client
        .send_request("thread/start", Value::Object(params))
        .await
        .map(|resp| thread_id_from_response(&resp))
        .map_err(|e| {
            log::error!(
                "[codex {session_id}] thread/start failed: {e} — check Codex CLI version + wire format"
            );
            AgentError::ProtocolError(format!("thread/start failed: {e}"))
        })
}

/// Dispatch `turn/interrupt` and wait — bounded — for Codex's ack.
///
/// `turn/interrupt` is a JSON-RPC *request*, so [`CodexClient::send_request`]
/// blocks on the response. The interrupt line is already queued to stdin the
/// instant send_request fires; what we wait on is only the *ack*. A wedged
/// app-server may never ack, and `interrupt_session` holds the global
/// `processes` lock across this await — an unbounded wait deadlocks every
/// later command (send/pause/close/stop) and kills the session for good (the
/// "Stop doesn't work in Codex" bug). So on timeout we return `Ok`: the
/// interrupt was dispatched, we just stop *waiting* and release the lock. A
/// truly hung process is recovered by the stuck-banner hard kill+resume path.
///
/// Extracted as a free fn (timeout injectable) so the bounded-wait guarantee
/// is unit-testable without a live `AppHandle`.
async fn interrupt_turn(
    client: &CodexClient,
    session_id: &str,
    thread_id: &str,
    turn_id: &str,
    ack_timeout: std::time::Duration,
) -> Result<(), AgentError> {
    match tokio::time::timeout(
        ack_timeout,
        client.send_request(
            "turn/interrupt",
            json!({"threadId": thread_id, "turnId": turn_id}),
        ),
    )
    .await
    {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) => Err(AgentError::SendFailed(e.to_string())),
        Err(_elapsed) => {
            warn!(
                "[codex {session_id}] turn/interrupt ack timed out after {ack_timeout:?} — \
                 interrupt was dispatched; not holding the session lock for a wedged app-server"
            );
            Ok(())
        }
    }
}

/// Pull the thread id out of a `thread/start` / `thread/resume` response.
/// Both responses carry a required `thread` object with an `id` field
/// (schema: v2/ThreadStartResponse.json, v2/ThreadResumeResponse.json).
/// Pure + unit-tested so the resume-after-/clear fix has explicit coverage.
fn thread_id_from_response(resp: &Value) -> Option<String> {
    resp.get("thread")
        .and_then(|t| t.get("id"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// Should a failed `thread/resume` fall back to a fresh `thread/start`
/// rather than killing the session? True ONLY for the "no rollout found"
/// class (`-32600`, or the message naming a missing rollout). Pure +
/// unit-testable so the error code our resilience depends on is pinned.
pub fn should_fallback_to_start(err: &ClientError) -> bool {
    match err {
        ClientError::Rpc { code, message, .. } => {
            *code == -32600 || message.to_lowercase().contains("no rollout")
        }
        _ => false,
    }
}

/// Map a management JSON-RPC error to an `AgentError`. A `-32601` (method
/// not found) means this Codex binary doesn't implement the method —
/// translate to `CapabilityNotSupported` so the command layer degrades to
/// the config.toml fallback instead of surfacing a raw protocol error.
pub fn map_management_error(method: &str, err: ClientError) -> AgentError {
    match err {
        ClientError::Rpc { code: -32601, .. } => AgentError::CapabilityNotSupported(
            AgentId::Codex,
            // Leaked to get a 'static str; method names are a small bounded
            // set so this is acceptable for an error-path diagnostic.
            Box::leak(format!("codex method `{method}` not supported by this CLI version").into_boxed_str()),
        ),
        other => AgentError::SendFailed(other.to_string()),
    }
}

/// Build `config/value/write` params. Pure + unit-tested — `keyPath`,
/// `mergeStrategy`, and `value` are all required by the schema; an empty
/// `expected_version` is omitted (optimistic-concurrency token).
pub fn build_config_write_params(
    key_path: &str,
    value: Value,
    merge_strategy: &str,
    expected_version: Option<&str>,
) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("keyPath".into(), Value::String(key_path.to_string()));
    m.insert("mergeStrategy".into(), Value::String(merge_strategy.to_string()));
    m.insert("value".into(), value);
    if let Some(v) = expected_version.filter(|s| !s.is_empty()) {
        m.insert("expectedVersion".into(), Value::String(v.to_string()));
    }
    Value::Object(m)
}

/// Build `config/read` params.
pub fn build_config_read_params(cwd: Option<&str>, include_layers: bool) -> Value {
    let mut m = serde_json::Map::new();
    if let Some(c) = cwd.filter(|s| !s.is_empty()) {
        m.insert("cwd".into(), Value::String(c.to_string()));
    }
    m.insert("includeLayers".into(), Value::Bool(include_layers));
    Value::Object(m)
}

/// Build `mcpServerStatus/list` params (full detail).
pub fn build_mcp_status_params() -> Value {
    json!({ "detail": "full" })
}

/// Emit a non-alarming info notice that we started a fresh Codex thread
/// because the previous one's rollout was gone.
fn emit_resume_fallback_notice(app_handle: &AppHandle, session_id: &str) {
    emit_event_for(
        app_handle,
        &NormalizedEvent::SessionNotice {
            agent_id: AgentId::Codex,
            session_id: session_id.to_string(),
            message: "The previous Codex conversation couldn't be restored (its rollout file is \
                      gone). Started a fresh thread — your earlier messages are still shown above."
                .to_string(),
        },
    );
}

fn make_notification_handler(
    app_handle: AppHandle,
    session_id: String,
    translator: Translator,
) -> NotificationHandler {
    Arc::new(move |method: String, params: Value| {
        let app_handle = app_handle.clone();
        let session_id = session_id.clone();
        let translator = translator.clone();
        tokio::spawn(async move {
            let events = translator.on_notification(&method, params).await;
            for ev in events {
                // Persist the Codex thread id the moment `thread/started`
                // surfaces it, BEFORE emitting — crash recovery filters on
                // `cli_session_id IS NOT NULL`, so without this Codex
                // sessions can never be resumed after a restart (parity
                // with Claude's message_router).
                if let Some(tid) = thread_id_from_event(&ev) {
                    store_codex_cli_session_id(&app_handle, &session_id, tid).await;
                }
                emit_event_for(&app_handle, &ev);
            }
        });
    })
}

/// Pull the Codex thread id out of a `CliSessionId` event. Pure +
/// unit-testable so the persistence trigger has explicit coverage.
fn thread_id_from_event(ev: &NormalizedEvent) -> Option<&str> {
    match ev {
        NormalizedEvent::CliSessionId { cli_session_id, .. } => Some(cli_session_id.as_str()),
        _ => None,
    }
}

/// Persist the Codex thread id to `AppState.cli_session_ids` + SQLite so
/// the session survives a force-quit/restart. Mirrors Claude's
/// `message_router::store_cli_session_id` exactly — reuses the same DB
/// method and in-memory map. Idempotent (UPDATE), so re-persisting on a
/// fallback-to-start that mints a new thread id self-heals the row.
async fn store_codex_cli_session_id(app_handle: &AppHandle, session_id: &str, thread_id: &str) {
    use crate::agents::claude_code::session::AppState;
    if let Some(state) = app_handle.try_state::<AppState>() {
        {
            let mut ids = state.cli_session_ids.lock().await;
            ids.insert(session_id.to_string(), thread_id.to_string());
        }
        if let Err(e) = state.database.set_cli_session_id(session_id, thread_id) {
            warn!(
                "[codex] Failed to persist cli_session_id for {}: {}",
                session_id, e
            );
        }
    }
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
            // ── Early-branch graceful-deny paths (v1.4.1 Phase A) ──
            //
            // For methods CodeMantis doesn't yet implement, we respond
            // with a structured JSON-RPC error / result so Codex doesn't
            // hang. Each one emits a NormalizedEvent first so the chat
            // handler can surface a user-facing toast explaining what
            // happened.

            // A.3 — `account/chatgptAuthTokens/refresh`: Codex hit a 401
            // and is asking us to refresh the ChatGPT auth token. We
            // don't yet implement the OAuth handoff, so we toast and
            // return -32603 (internal error) with an actionable message.
            // Schema: ChatgptAuthTokensRefreshParams.json
            if method == "account/chatgptAuthTokens/refresh" {
                let previous_account_id = params
                    .get("previousAccountId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let reason = params
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unauthorized")
                    .to_string();
                emit_event_for(
                    &app_handle,
                    &NormalizedEvent::AuthTokenRefreshRequested {
                        agent_id: AgentId::Codex,
                        session_id: session_id.clone(),
                        previous_account_id,
                        reason,
                    },
                );
                if let Some(client) = client_holder.lock().await.as_ref() {
                    let _ = client.respond_error(
                        rpc_id,
                        RpcError {
                            code: -32603,
                            message:
                                "CodeMantis cannot refresh ChatGPT tokens yet — \
                                 please run `codex login` in a terminal and reopen the session"
                                    .to_string(),
                            data: None,
                        },
                    );
                }
                return;
            }

            // A.6 — `item/tool/call`: Codex is asking the client to
            // execute an arbitrary tool by name. We don't have a
            // client-side tool registry, so we respond with
            // `{success: false, contentItems: [...]}` — Codex's
            // documented "client cannot execute" shape. Toast names the
            // tool so users see the gap honestly.
            // Schema: DynamicToolCallParams.json / DynamicToolCallResponse.json
            if method == "item/tool/call" {
                let tool = params
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?")
                    .to_string();
                let namespace = params
                    .get("namespace")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                emit_event_for(
                    &app_handle,
                    &NormalizedEvent::DynamicToolCallDenied {
                        agent_id: AgentId::Codex,
                        session_id: session_id.clone(),
                        tool: tool.clone(),
                        namespace: namespace.clone(),
                    },
                );
                if let Some(client) = client_holder.lock().await.as_ref() {
                    let ns_prefix = namespace
                        .as_deref()
                        .map(|n| format!("{n}."))
                        .unwrap_or_default();
                    let _ = client.respond(
                        rpc_id,
                        json!({
                            "success": false,
                            "contentItems": [{
                                "type": "inputText",
                                "text": format!(
                                    "CodeMantis does not implement client-side dynamic tool execution. \
                                     The tool '{ns_prefix}{tool}' was not run."
                                ),
                            }],
                        }),
                    );
                }
                return;
            }

            // ── Regular classify path ──
            //
            // Every branch below MUST either (a) successfully emit
            // `tool-approval-request` so the modal opens, or (b) send a
            // structured JSON-RPC error back to Codex. The previous
            // implementation could silently drop on emit failure and
            // leave Codex blocked forever (defect #1 of the Codex-stuck
            // bug). Tracing at every branch lets us trace lost approvals
            // in the log without needing to repro live.
            info!(
                "[codex {} server-request] received method=`{}`",
                session_id, method
            );
            match classify_server_request(&state, &session_id, rpc_id.clone(), &method, params)
                .await
            {
                Some(req) => {
                    let request_id = req.request_id.clone();
                    let tool_name = req.tool_name.clone();
                    match app_handle.emit("tool-approval-request", &req) {
                        Ok(()) => {
                            info!(
                                "[codex {} server-request] emitted tool-approval-request \
                                 request_id={} tool={} method=`{}`",
                                session_id, request_id, tool_name, method
                            );
                        }
                        Err(e) => {
                            // Emit failed. The pending registration in
                            // ThreadState is now orphaned — Codex is
                            // waiting on a JSON-RPC response that no
                            // modal will ever produce. Take it back out
                            // so a future stale-id resolve doesn't trip
                            // on it, send a structured error back to
                            // Codex so the turn unblocks, and surface a
                            // toast so the user knows what just
                            // happened.
                            log::error!(
                                "[codex {} server-request] emit failed for request_id={} \
                                 tool={} method=`{}`: {} — unblocking Codex with -32603",
                                session_id, request_id, tool_name, method, e
                            );
                            let _ = state.take_server_request(&request_id).await;
                            if let Some(client) = client_holder.lock().await.as_ref() {
                                if let Err(send_err) =
                                    client.respond_error(rpc_id, emit_failure_rpc_error(&method))
                                {
                                    log::error!(
                                        "[codex {} server-request] respond_error also failed: {:?}",
                                        session_id, send_err
                                    );
                                }
                            }
                            emit_event_for(
                                &app_handle,
                                &emit_failure_chat_event(&session_id, &method),
                            );
                        }
                    }
                }
                None => {
                    // Unknown method. Respond -32601 so Codex moves on
                    // (and pings us with the next message). This is the
                    // intended behaviour for protocol-drift safety —
                    // versions can add new server-initiated methods and
                    // we should fail gracefully, not hang.
                    warn!(
                        "[codex {} server-request] unknown method `{}` — replying -32601",
                        session_id, method
                    );
                    if let Some(client) = client_holder.lock().await.as_ref() {
                        if let Err(e) = client.respond_error(
                            rpc_id,
                            RpcError {
                                code: -32601,
                                message: format!("method not found: {method}"),
                                data: None,
                            },
                        ) {
                            log::error!(
                                "[codex {} server-request] respond_error for unknown method failed: {:?}",
                                session_id, e
                            );
                        }
                    }
                }
            }
        });
    })
}

/// Pick chat vs. activity channel and emit. Pure plumbing — the routing
/// logic lives in `agents::is_activity_event` so adding a new variant
/// only touches one place.
/// Call `model/list` and emit a `CapabilitiesDiscovered` event on the
/// chat channel. Used by `spawn_session` on initial handshake and by
/// `send_control_request(Initialize)` to refresh caps on a live session
/// without close+reopen.
///
/// Shape per v2/ModelListResponse.json (verified live against
/// codex-cli 0.130.0, 2026-05-22; re-verified against 0.137.0 by
/// codex_protocol_smoke::s03_model_list, 2026-06-08):
///   { data: [{ id, model, displayName, description, isDefault, hidden,
///              defaultReasoningEffort,
///              supportedReasoningEfforts: [{reasoningEffort, …}], … }] }
///
/// Best-effort: if `model/list` fails (transport hiccup, server
/// overload), we log + skip emitting; the selector falls back to its
/// static manifest.
async fn discover_capabilities(
    client: &super::client::CodexClient,
    app_handle: &AppHandle,
    session_id: &str,
) {
    match client.send_request("model/list", json!({})).await {
        Ok(list) => {
            let models_array = list
                .get("data")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let transformed: Vec<Value> = models_array
                .iter()
                .filter(|m| !m.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false))
                .map(|m| {
                    // Codex uses `model` as the wire id (e.g. "gpt-5.5");
                    // `displayName` is the user-facing string.
                    let value = m
                        .get("model")
                        .or_else(|| m.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let display = m
                        .get("displayName")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&value)
                        .to_string();
                    let description = m
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let is_default = m
                        .get("isDefault")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    // Codex's model/list returns supportedReasoningEfforts
                    // as an array of objects `{ reasoningEffort: "low" }`
                    // etc. Empirically (cli 0.130.0) every shipped model
                    // supports [low, medium, high, xhigh]; older / hidden
                    // models may add `none` / `minimal`. The frontend's
                    // EffortSelector hides itself when this list is empty.
                    let supported_efforts: Vec<String> = m
                        .get("supportedReasoningEfforts")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|e| {
                                    e.get("reasoningEffort")
                                        .and_then(|v| v.as_str())
                                        .map(str::to_string)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let default_effort = m
                        .get("defaultReasoningEffort")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    let supports_effort = !supported_efforts.is_empty();
                    json!({
                        "value": value,
                        "displayName": display,
                        "description": description,
                        "isDefault": is_default,
                        "supportsEffort": supports_effort,
                        "supportedEffortLevels": supported_efforts,
                        "defaultEffort": default_effort,
                    })
                })
                .collect();
            emit_event_for(
                app_handle,
                &NormalizedEvent::CapabilitiesDiscovered {
                    agent_id: AgentId::Codex,
                    session_id: session_id.to_string(),
                    models: Value::Array(transformed),
                    commands: Value::Null,
                    agents: Value::Null,
                    account: Value::Null,
                    output_styles: Value::Null,
                },
            );
        }
        Err(e) => {
            log::warn!(
                "[codex {session_id}] model/list failed ({e}); selector will fall back to static manifest"
            );
        }
    }
}

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
        NormalizedEvent::SessionNotice { .. } => "SessionNotice",
        NormalizedEvent::ProcessExited { .. } => "ProcessExited",
        NormalizedEvent::ProtectedPathDeny { .. } => "ProtectedPathDeny",
        NormalizedEvent::CompactingStatus { .. } => "CompactingStatus",
        NormalizedEvent::CompactComplete { .. } => "CompactComplete",
        NormalizedEvent::RateLimitWarning { .. } => "RateLimitWarning",
        NormalizedEvent::UsageUpdate { .. } => "UsageUpdate",
        NormalizedEvent::InterruptResult { .. } => "InterruptResult",
        NormalizedEvent::ModelChanged { .. } => "ModelChanged",
        NormalizedEvent::EffortChanged { .. } => "EffortChanged",
        NormalizedEvent::ReviewModeEntered { .. } => "ReviewModeEntered",
        NormalizedEvent::ReviewModeExited { .. } => "ReviewModeExited",
        NormalizedEvent::CodexPlanModeChanged { .. } => "CodexPlanModeChanged",
        NormalizedEvent::HookPrompt { .. } => "HookPrompt",
        NormalizedEvent::HookStatus { .. } => "HookStatus",
        NormalizedEvent::AuthTokenRefreshRequested { .. } => "AuthTokenRefreshRequested",
        NormalizedEvent::DynamicToolCallDenied { .. } => "DynamicToolCallDenied",
        NormalizedEvent::McpStartupStatus { .. } => "McpStartupStatus",
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

    fn auto_policy() -> CodexSessionPolicy {
        CodexSessionPolicy {
            sandbox: CodexSandbox::WorkspaceWrite,
            approval: CodexApproval::OnRequest,
            network_access: true,
        }
    }

    #[test]
    fn apply_plan_mode_off_is_passthrough() {
        let (policy, text) = apply_plan_mode(auto_policy(), false, "hello");
        assert_eq!(policy.sandbox, CodexSandbox::WorkspaceWrite);
        assert!(policy.network_access);
        assert_eq!(text, "hello");
    }

    #[test]
    fn apply_plan_mode_on_forces_readonly_and_prepends_preamble() {
        let (policy, text) = apply_plan_mode(auto_policy(), true, "build a feature");
        // Read-only sandbox is the real enforcement; network disabled.
        assert_eq!(policy.sandbox, CodexSandbox::ReadOnly);
        assert!(!policy.network_access);
        // Approval policy is untouched.
        assert_eq!(policy.approval, CodexApproval::OnRequest);
        // The original prompt survives, prefixed by the planning preamble.
        assert!(text.starts_with(CODEX_PLAN_MODE_PREAMBLE));
        assert!(text.ends_with("build a feature"));
    }

    #[test]
    fn plan_mode_preamble_instructs_full_context_and_no_edits() {
        // R1: the preamble must steer Codex to use the whole prior thread.
        assert!(CODEX_PLAN_MODE_PREAMBLE.contains("ENTIRE preceding conversation"));
        // And it must forbid edits (read-only intent reinforced in text).
        assert!(CODEX_PLAN_MODE_PREAMBLE.contains("Do NOT edit files"));
    }

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

    #[test]
    fn build_app_server_args_includes_env_policy_override() {
        // Bug fix: without `-c shell_environment_policy.inherit=all`, Codex
        // strips HOME/DOCKER_HOST/SSH_AUTH_SOCK/etc. from spawned sub-shells
        // and host tools fail with EACCES even on `danger-full-access`.
        // Asserting exact shape so a refactor that drops the override fails
        // loudly here instead of silently breaking docker/gh/aws inside
        // Codex sessions.
        let argv = build_app_server_args(None);
        assert_eq!(
            argv,
            vec![
                "-c".to_string(),
                "shell_environment_policy.inherit=all".to_string(),
                "app-server".to_string(),
                "--listen".to_string(),
                "stdio://".to_string(),
            ]
        );
        // The override must precede the subcommand: clap accepts both
        // positions, but the documented form in `codex --help` puts global
        // options before the subcommand.
        let env_idx = argv.iter().position(|a| a == "-c").unwrap();
        let sub_idx = argv.iter().position(|a| a == "app-server").unwrap();
        assert!(env_idx < sub_idx);
        // Override appears exactly once.
        assert_eq!(argv.iter().filter(|a| a.as_str() == "-c").count(), 1);
    }

    #[test]
    fn emit_failure_rpc_error_carries_method_and_actionable_text() {
        // Codex displays this message verbatim when it rolls back the
        // turn. It must (a) name the method so users searching logs can
        // correlate, (b) say "retry" so they know they're not stuck.
        let err = emit_failure_rpc_error("execCommandApproval");
        assert_eq!(err.code, -32603);
        assert!(err.message.contains("execCommandApproval"));
        assert!(err.message.contains("retry"));
        assert!(err.data.is_none());
    }

    #[test]
    fn emit_failure_chat_event_surfaces_session_and_method() {
        let ev = emit_failure_chat_event("sid-1", "applyPatchApproval");
        match ev {
            NormalizedEvent::ProcessError {
                agent_id,
                session_id,
                error,
            } => {
                assert!(matches!(agent_id, AgentId::Codex));
                assert_eq!(session_id, "sid-1");
                assert!(error.contains("applyPatchApproval"));
                assert!(error.contains("rolled back"));
            }
            other => panic!("expected ProcessError, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn take_server_request_cleans_up_when_emit_fails() {
        // Defect #1 of the Codex-stuck bug: if app_handle.emit returned
        // Err, the pending registration stayed in ThreadState forever
        // and the modal-resolve path would later trip on a stale id.
        // The fix calls take_server_request to evict the entry; this
        // pin asserts the eviction is observable (the second take
        // returns None).
        use super::super::thread_state::{ServerRequestKind, ThreadState};
        let state = ThreadState::new();
        state
            .register_server_request(
                "req-1".to_string(),
                ServerRequestKind::ExecCommandApproval {
                    rpc_id: super::super::jsonrpc::Id::Number(7),
                    call_id: "call-1".to_string(),
                },
            )
            .await;
        let first = state.take_server_request("req-1").await;
        assert!(first.is_some(), "first take should yield the registered kind");
        let second = state.take_server_request("req-1").await;
        assert!(
            second.is_none(),
            "after eviction, a later resolve must not find the id"
        );
    }

    #[test]
    fn should_fallback_to_start_matrix() {
        // -32600 → fall back to a fresh thread (the "no rollout" class).
        assert!(should_fallback_to_start(&ClientError::Rpc {
            code: -32600,
            message: "no rollout found for thread id 019e...".into(),
            data: None,
        }));
        // Message-only signal (defensive secondary guard) even if the code
        // ever changes.
        assert!(should_fallback_to_start(&ClientError::Rpc {
            code: -32000,
            message: "No rollout found".into(),
            data: None,
        }));
        // Method-not-found / other RPC errors stay fatal.
        assert!(!should_fallback_to_start(&ClientError::Rpc {
            code: -32601,
            message: "method not found".into(),
            data: None,
        }));
        // Server-overloaded is retryable elsewhere, not a resume fallback.
        assert!(!should_fallback_to_start(&ClientError::Rpc {
            code: RpcError::SERVER_OVERLOADED,
            message: "overloaded".into(),
            data: None,
        }));
    }

    #[test]
    fn build_config_write_params_shape() {
        // keyPath/mergeStrategy/value required; expectedVersion omitted when empty.
        let p = build_config_write_params("model", json!("gpt-5.5"), "replace", None);
        assert_eq!(p["keyPath"], json!("model"));
        assert_eq!(p["mergeStrategy"], json!("replace"));
        assert_eq!(p["value"], json!("gpt-5.5"));
        assert!(p.get("expectedVersion").is_none());

        let p2 = build_config_write_params("a.b", json!({"x": 1}), "upsert", Some("v7"));
        assert_eq!(p2["mergeStrategy"], json!("upsert"));
        assert_eq!(p2["expectedVersion"], json!("v7"));
        // Empty version is treated as absent.
        let p3 = build_config_write_params("a", json!(true), "replace", Some(""));
        assert!(p3.get("expectedVersion").is_none());
    }

    #[test]
    fn build_config_read_and_mcp_status_params_shape() {
        let r = build_config_read_params(None, true);
        assert_eq!(r["includeLayers"], json!(true));
        assert!(r.get("cwd").is_none());
        let r2 = build_config_read_params(Some("/proj"), false);
        assert_eq!(r2["cwd"], json!("/proj"));
        assert_eq!(build_mcp_status_params(), json!({"detail": "full"}));
    }

    #[test]
    fn map_management_error_method_not_found_is_capability_not_supported() {
        let e = map_management_error(
            "config/read",
            ClientError::Rpc { code: -32601, message: "method not found".into(), data: None },
        );
        assert!(matches!(e, AgentError::CapabilityNotSupported(AgentId::Codex, _)));
        // Other errors map to SendFailed (surfaced normally).
        let e2 = map_management_error(
            "config/read",
            ClientError::Rpc { code: -32000, message: "boom".into(), data: None },
        );
        assert!(matches!(e2, AgentError::SendFailed(_)));
    }

    #[test]
    fn thread_id_from_event_extracts_only_cli_session_id() {
        // The persistence hook fires on exactly one variant — pin that so
        // a refactor that renames CliSessionId can't silently stop Codex
        // sessions from being persisted (the crash-recovery regression).
        let ev = NormalizedEvent::CliSessionId {
            agent_id: AgentId::Codex,
            session_id: "sid".into(),
            cli_session_id: "019e66e0-0712-7f13-b94c-c1dfb199f475".into(),
        };
        assert_eq!(
            thread_id_from_event(&ev),
            Some("019e66e0-0712-7f13-b94c-c1dfb199f475")
        );

        // Any other variant must NOT trigger persistence.
        let other = NormalizedEvent::TextDelta {
            agent_id: AgentId::Codex,
            session_id: "sid".into(),
            text: "hi".into(),
        };
        assert_eq!(thread_id_from_event(&other), None);
    }

    #[test]
    fn thread_id_from_response_extracts_thread_dot_id() {
        // thread/start + thread/resume both return a required `thread`
        // object carrying `id`. This is the synchronous source of truth
        // for the resumed thread id — resume emits no thread/started
        // notification, so without this the /clear path strands the
        // session on "no thread/started yet".
        let resp = json!({
            "thread": { "id": "019e66e0-0712-7f13-b94c-c1dfb199f475", "status": "idle" },
            "model": "gpt-5.5",
        });
        assert_eq!(
            thread_id_from_response(&resp).as_deref(),
            Some("019e66e0-0712-7f13-b94c-c1dfb199f475")
        );
        // Missing / malformed shapes degrade to None rather than panicking.
        assert_eq!(thread_id_from_response(&json!({})), None);
        assert_eq!(thread_id_from_response(&json!({"thread": {}})), None);
        assert_eq!(
            thread_id_from_response(&json!({"thread": {"id": 7}})),
            None
        );
    }

    #[tokio::test]
    async fn interrupt_turn_returns_ok_when_ack_succeeds() {
        // Happy path: Codex acks the interrupt → Ok.
        use super::super::client::{CodexClient, NotificationHandler, ServerRequestHandler};
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let notif: NotificationHandler = Arc::new(|_m, _p| {});
        let server_req: ServerRequestHandler = Arc::new(|_i, _m, _p| {});
        let client = CodexClient::new(tx, 0, notif, server_req);

        let c2 = client.clone();
        let fut = tokio::spawn(async move {
            interrupt_turn(
                &c2,
                "sid",
                "thr_1",
                "turn_1",
                std::time::Duration::from_secs(5),
            )
            .await
        });

        // Observe the dispatched line, then synthesise the ack.
        let line = rx.recv().await.unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["method"], "turn/interrupt");
        assert_eq!(parsed["params"]["threadId"], "thr_1");
        assert_eq!(parsed["params"]["turnId"], "turn_1");
        client
            .handle_incoming_line(r#"{"id":0,"result":{}}"#)
            .await
            .unwrap();

        assert!(fut.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn interrupt_turn_returns_ok_on_ack_timeout_not_hang() {
        // Regression for the deadlock: a wedged Codex never acks
        // turn/interrupt. `interrupt_turn` MUST return (Ok) within the
        // bounded timeout instead of blocking forever — otherwise the
        // global `processes` lock is held indefinitely and every later
        // command (Stop / Stop session / send / close) deadlocks.
        use super::super::client::{CodexClient, NotificationHandler, ServerRequestHandler};
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let notif: NotificationHandler = Arc::new(|_m, _p| {});
        let server_req: ServerRequestHandler = Arc::new(|_i, _m, _p| {});
        let client = CodexClient::new(tx, 0, notif, server_req);

        // No response is ever fed in. With a tiny timeout this must resolve
        // quickly; without the timeout it would hang the test forever.
        let res = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            interrupt_turn(
                &client,
                "sid",
                "thr_1",
                "turn_1",
                std::time::Duration::from_millis(50),
            ),
        )
        .await;
        assert!(res.is_ok(), "interrupt_turn did not return within bound — would deadlock");
        assert!(res.unwrap().is_ok(), "timeout path should yield Ok (interrupt was dispatched)");
    }

    #[test]
    fn build_app_server_args_appends_add_dir_when_specwriter_mode() {
        let argv = build_app_server_args(Some("/Users/hr/project"));
        assert_eq!(
            argv,
            vec![
                "-c".to_string(),
                "shell_environment_policy.inherit=all".to_string(),
                "app-server".to_string(),
                "--listen".to_string(),
                "stdio://".to_string(),
                "--add-dir".to_string(),
                "/Users/hr/project".to_string(),
            ]
        );
    }
}
