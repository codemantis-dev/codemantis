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
    /// Active sandbox + approval policy. Defaults to (workspace-write,
    /// on-request) per spec §2.3 ("Auto" preset). Updated by
    /// `set_codex_policy` and applied on the next `turn/start`.
    current_policy: Mutex<CodexSessionPolicy>,
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

        let policy = *self.current_policy.lock().await;
        let mut params = json!({
            "threadId": thread_id,
            "input": [{"type": "text", "text": text}],
            "sandbox": policy.sandbox.as_codex_wire(),
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

    let thread_method = if let Some(thread_id) = &config.resume_token {
        params.insert("threadId".into(), Value::String(thread_id.clone()));
        "thread/resume"
    } else {
        "thread/start"
    };

    debug!(
        "[codex {}] sending {} with params: {}",
        config.session_id,
        thread_method,
        serde_json::to_string(&params).unwrap_or_default()
    );
    let _ = client
        .send_request(thread_method, Value::Object(params))
        .await
        .map_err(|e| {
            // Codex's "Invalid request: unknown ..." gets truncated in
            // the toast; log the full error here so users can copy-paste
            // it. Most -32600s come from a new field or a renamed key
            // (Codex's wire is still evolving).
            log::error!(
                "[codex {}] {} failed: {} — check Codex CLI version + wire format",
                config.session_id, thread_method, e
            );
            AgentError::ProtocolError(format!("{thread_method} failed: {e}"))
        })?;

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
/// Call `model/list` and emit a `CapabilitiesDiscovered` event on the
/// chat channel. Used by `spawn_session` on initial handshake and by
/// `send_control_request(Initialize)` to refresh caps on a live session
/// without close+reopen.
///
/// Shape per v2/ModelListResponse.json (verified live against
/// codex-cli 0.130.0, 2026-05-22):
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
