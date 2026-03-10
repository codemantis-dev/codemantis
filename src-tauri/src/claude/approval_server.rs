use axum::{extract::State as AxumState, http::StatusCode, routing::post, Json, Router};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

use crate::claude::session::SessionMode;

/// Tools that are auto-approved without asking the user (read-only tools).
const AUTO_APPROVED_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "ListDirectory",
    "LS",
    "TodoRead",
];

/// Tools that are allowed in plan mode (read-only / informational only).
const PLAN_MODE_ALLOWED_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "AskUserQuestion",
    "ListDirectory",
    "LS",
    "TodoRead",
    "WebSearch",
    "WebFetch",
];

/// JSON payload received from the PreToolUse hook (via the CLI).
#[derive(Debug, Clone, Deserialize)]
pub struct HookInput {
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    // Catch-all for other fields
    #[serde(flatten)]
    pub _extra: serde_json::Value,
}

/// JSON response sent back to the hook.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookResponse {
    pub hook_specific_output: HookSpecificOutput,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookSpecificOutput {
    pub hook_event_name: String,
    pub permission_decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_decision_reason: Option<String>,
}

impl HookResponse {
    fn allow() -> Self {
        Self {
            hook_specific_output: HookSpecificOutput {
                hook_event_name: "PreToolUse".to_string(),
                permission_decision: "allow".to_string(),
                permission_decision_reason: None,
            },
        }
    }

    fn deny(reason: Option<String>) -> Self {
        Self {
            hook_specific_output: HookSpecificOutput {
                hook_event_name: "PreToolUse".to_string(),
                permission_decision: "deny".to_string(),
                permission_decision_reason: reason,
            },
        }
    }
}

/// Event emitted to the frontend when a tool needs approval.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolApprovalRequest {
    pub request_id: String,
    pub forge_session_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
}

/// The user's decision from the frontend.
pub struct ApprovalDecision {
    pub approved: bool,
    pub reason: Option<String>,
}

/// Shared state for the approval HTTP server.
pub struct ApprovalServerState {
    pending: Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>,
    app_handle: Mutex<Option<AppHandle>>,
}

impl ApprovalServerState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            app_handle: Mutex::new(None),
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        let mut h = self.app_handle.lock().await;
        *h = Some(handle);
    }

    /// Resolve a pending approval by request ID.
    pub async fn resolve(&self, request_id: &str, approved: bool, reason: Option<String>) -> bool {
        let mut pending = self.pending.lock().await;
        if let Some(tx) = pending.remove(request_id) {
            let _ = tx.send(ApprovalDecision { approved, reason });
            true
        } else {
            warn!("No pending approval for request_id: {}", request_id);
            false
        }
    }

    /// Deny all pending approvals (used on shutdown).
    #[allow(dead_code)]
    pub async fn deny_all(&self) {
        let mut pending = self.pending.lock().await;
        for (id, tx) in pending.drain() {
            debug!("Denying pending approval on shutdown: {}", id);
            let _ = tx.send(ApprovalDecision {
                approved: false,
                reason: Some("Application shutting down".to_string()),
            });
        }
    }
}

/// Look up CodeMantis session ID from the CLI's session_id or cwd.
async fn find_forge_session_id(
    app_handle: &AppHandle,
    cli_session_id: Option<&str>,
    cwd: Option<&str>,
) -> Option<String> {
    use crate::claude::session::AppState;

    if let Some(state) = app_handle.try_state::<AppState>() {
        // Try reverse lookup: CLI session ID → Forge session ID
        if let Some(cli_sid) = cli_session_id {
            let cli_ids: tokio::sync::MutexGuard<'_, HashMap<String, String>> =
                state.cli_session_ids.lock().await;
            for (forge_id, stored_cli_id) in cli_ids.iter() {
                if stored_cli_id == cli_sid {
                    return Some(forge_id.clone());
                }
            }
        }

        // Fallback: match by project_path (cwd)
        if let Some(cwd_path) = cwd {
            let sessions = state.sessions.lock().await;
            // Find the most recently active session in this project
            for (id, info) in sessions.iter() {
                if info.project_path == cwd_path {
                    let result: String = id.clone();
                    return Some(result);
                }
            }
        }
    }

    None
}

/// HTTP handler for POST /tool-approval
async fn handle_tool_approval(
    AxumState(state): AxumState<Arc<ApprovalServerState>>,
    Json(input): Json<HookInput>,
) -> (StatusCode, Json<HookResponse>) {
    let tool_name = input.tool_name.as_deref().unwrap_or("Unknown");

    // Auto-approve safe tools immediately
    if AUTO_APPROVED_TOOLS.contains(&tool_name) {
        debug!("[approval-server] Auto-approving tool: {}", tool_name);
        return (StatusCode::OK, Json(HookResponse::allow()));
    }

    debug!(
        "[approval-server] Tool needs approval: {} (session: {:?})",
        tool_name, input.session_id
    );

    let app_handle = {
        let h = state.app_handle.lock().await;
        match h.as_ref() {
            Some(handle) => handle.clone(),
            None => {
                error!("[approval-server] No app handle available");
                return (
                    StatusCode::OK,
                    Json(HookResponse::deny(Some(
                        "CodeMantis not ready".to_string(),
                    ))),
                );
            }
        }
    };

    // Find the CodeMantis session ID
    let forge_session_id = find_forge_session_id(
        &app_handle,
        input.session_id.as_deref(),
        input.cwd.as_deref(),
    )
    .await
    .unwrap_or_else(|| "unknown".to_string());

    // ── Enforce session mode at the Rust level ──
    if let Some(app_state) = app_handle.try_state::<crate::claude::session::AppState>() {
        let modes = app_state.session_modes.lock().await;
        if let Some(mode) = modes.get(&forge_session_id) {
            match mode {
                SessionMode::AutoAccept => {
                    info!(
                        "[approval-server] Auto-approving tool {} (auto-accept mode, session: {})",
                        tool_name, forge_session_id
                    );
                    return (StatusCode::OK, Json(HookResponse::allow()));
                }
                SessionMode::Plan => {
                    if !PLAN_MODE_ALLOWED_TOOLS.contains(&tool_name) {
                        info!(
                            "[approval-server] Denying tool {} in plan mode (session: {})",
                            tool_name, forge_session_id
                        );
                        return (
                            StatusCode::OK,
                            Json(HookResponse::deny(Some(
                                "Plan mode: only read-only tools are allowed. Switch to Normal mode to make changes.".to_string(),
                            ))),
                        );
                    }
                }
                SessionMode::Normal => {
                    // Fall through to normal approval flow
                }
            }
        }
    }

    // Create a oneshot channel for the user's decision
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<ApprovalDecision>();

    {
        let mut pending = state.pending.lock().await;
        pending.insert(request_id.clone(), tx);
    }

    // Emit event to frontend
    let event = ToolApprovalRequest {
        request_id: request_id.clone(),
        forge_session_id: forge_session_id.clone(),
        tool_name: tool_name.to_string(),
        tool_input: input.tool_input.unwrap_or(serde_json::Value::Null),
    };

    if let Err(e) = app_handle.emit("tool-approval-request", &event) {
        error!("[approval-server] Failed to emit event: {}", e);
        let mut pending = state.pending.lock().await;
        pending.remove(&request_id);
        return (
            StatusCode::OK,
            Json(HookResponse::deny(Some(
                "Failed to show approval dialog".to_string(),
            ))),
        );
    }

    // Wait for the user's decision with a timeout (5 minutes)
    let decision = tokio::time::timeout(std::time::Duration::from_secs(300), rx).await;

    // Clean up if still pending (timeout or channel dropped)
    {
        let mut pending = state.pending.lock().await;
        pending.remove(&request_id);
    }

    match decision {
        Ok(Ok(d)) => {
            info!(
                "[approval-server] Tool {} {} by user (session: {})",
                tool_name,
                if d.approved { "approved" } else { "denied" },
                forge_session_id
            );
            if d.approved {
                (StatusCode::OK, Json(HookResponse::allow()))
            } else {
                (StatusCode::OK, Json(HookResponse::deny(d.reason)))
            }
        }
        Ok(Err(_)) => {
            warn!("[approval-server] Approval channel dropped for {}", tool_name);
            (
                StatusCode::OK,
                Json(HookResponse::deny(Some("Approval cancelled".to_string()))),
            )
        }
        Err(_) => {
            warn!("[approval-server] Approval timed out for {}", tool_name);
            (
                StatusCode::OK,
                Json(HookResponse::deny(Some("Approval timed out".to_string()))),
            )
        }
    }
}

/// Start the approval HTTP server on a random available port.
/// Returns the port number.
pub async fn start_approval_server(approval_state: Arc<ApprovalServerState>) -> u16 {
    let app = Router::new()
        .route("/tool-approval", post(handle_tool_approval))
        .with_state(approval_state);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind approval server");
    let port = listener.local_addr().unwrap().port();

    info!("[approval-server] Listening on 127.0.0.1:{}", port);

    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("Approval server failed");
    });

    port
}
