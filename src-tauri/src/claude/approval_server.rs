use axum::{extract::State as AxumState, http::StatusCode, routing::{options, post}, Json, Router};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

use crate::claude::session::SessionMode;
use crate::commands::preview::capture_screenshot_inner;

/// Tools that are auto-approved without asking the user (read-only tools).
const AUTO_APPROVED_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "ListDirectory",
    "LS",
    "TodoRead",
];


/// JSON payload received from the PreToolUse hook (via the CLI).
#[derive(Debug, Clone, Deserialize)]
pub struct HookInput {
    /// Injected by the hook script from CODEMANTIS_SESSION_ID env var.
    /// Guaranteed unique per CLI process — highest priority for routing.
    pub forge_session_id: Option<String>,
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

    pub async fn app_handle(&self) -> Option<AppHandle> {
        self.app_handle.lock().await.clone()
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

/// Look up CodeMantis session ID using a 3-tier priority system:
/// 1. Direct match from `forge_session_id` (injected by hook script via env var)
/// 2. Reverse lookup: CLI `session_id` → forge session ID
/// 3. CWD fallback: only when exactly one session matches the path
async fn find_forge_session_id(
    app_handle: &AppHandle,
    forge_session_id_hint: Option<&str>,
    cli_session_id: Option<&str>,
    cwd: Option<&str>,
) -> Option<String> {
    use crate::claude::session::AppState;

    // Tier 1: Direct match from env var (guaranteed unique per CLI process)
    if let Some(hint) = forge_session_id_hint {
        if let Some(state) = app_handle.try_state::<AppState>() {
            let sessions = state.sessions.lock().await;
            if sessions.contains_key(hint) {
                return Some(hint.to_string());
            }
        }
    }

    if let Some(state) = app_handle.try_state::<AppState>() {
        // Tier 2: Reverse lookup — CLI session ID → Forge session ID
        if let Some(cli_sid) = cli_session_id {
            let cli_ids: tokio::sync::MutexGuard<'_, HashMap<String, String>> =
                state.cli_session_ids.lock().await;
            for (forge_id, stored_cli_id) in cli_ids.iter() {
                if stored_cli_id == cli_sid {
                    return Some(forge_id.clone());
                }
            }
        }

        // Tier 3: CWD fallback — only when exactly one session matches
        if let Some(cwd_path) = cwd {
            let sessions = state.sessions.lock().await;
            let matches: Vec<&String> = sessions
                .iter()
                .filter(|(_, info)| info.project_path == cwd_path)
                .map(|(id, _)| id)
                .collect();
            if matches.len() == 1 {
                return Some(matches[0].clone());
            }
            if matches.len() > 1 {
                warn!(
                    "[approval-server] Ambiguous CWD match: {} sessions share path {}",
                    matches.len(),
                    cwd_path
                );
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

    // Mode-control tools: auto-approve and update session mode
    if tool_name == "ExitPlanMode" || tool_name == "EnterPlanMode" {
        let new_mode = if tool_name == "EnterPlanMode" {
            SessionMode::Plan
        } else {
            SessionMode::Normal
        };

        let app_handle = {
            let h = state.app_handle.lock().await;
            match h.as_ref() {
                Some(handle) => handle.clone(),
                None => {
                    info!(
                        "[approval-server] Auto-approving {} (no app handle for mode update)",
                        tool_name
                    );
                    return (StatusCode::OK, Json(HookResponse::allow()));
                }
            }
        };

        let forge_session_id = find_forge_session_id(
            &app_handle,
            input.forge_session_id.as_deref(),
            input.session_id.as_deref(),
            input.cwd.as_deref(),
        )
        .await;

        if let Some(ref sid) = forge_session_id {
            if let Some(app_state) = app_handle.try_state::<crate::claude::session::AppState>() {
                let mut modes = app_state.session_modes.lock().await;
                info!(
                    "[approval-server] {} → switching session {} to {:?}",
                    tool_name, sid, new_mode
                );
                modes.insert(sid.clone(), new_mode.clone());
            }
            let _ = app_handle.emit(
                "session-mode-changed",
                serde_json::json!({
                    "sessionId": sid,
                    "mode": new_mode
                }),
            );
        } else {
            warn!(
                "[approval-server] {} approved but session not found — mode not updated",
                tool_name
            );
        }

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
        input.forge_session_id.as_deref(),
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
                    // The CLI itself enforces plan mode restrictions
                    // (permissionMode="plan"). No additional tool blocking here —
                    // fall through to normal approval flow.
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

// ── Preview callback handlers ───────────────────────────────────────────
// The preview WebView loads external URLs, where document.title changes
// are NOT reflected back to Rust via window.title() (WKWebView limitation).
// Instead, the preview toolbar's JS buttons call fetch() to these endpoints.

/// CORS preflight — allows cross-origin fetch from preview page (e.g. http://localhost:3000).
async fn preview_cors_preflight() -> (StatusCode, [(&'static str, &'static str); 3]) {
    (
        StatusCode::NO_CONTENT,
        [
            ("access-control-allow-origin", "*"),
            ("access-control-allow-methods", "POST, OPTIONS"),
            ("access-control-allow-headers", "content-type"),
        ],
    )
}

#[derive(Deserialize)]
struct OpenBrowserRequest {
    url: String,
}

async fn handle_preview_screenshot(
    AxumState(state): AxumState<Arc<ApprovalServerState>>,
) -> (StatusCode, [(&'static str, &'static str); 1]) {
    let cors = [("access-control-allow-origin", "*")];
    let Some(app_handle) = state.app_handle().await else {
        warn!("[preview-callback] No app handle available for screenshot");
        return (StatusCode::INTERNAL_SERVER_ERROR, cors);
    };
    match capture_screenshot_inner(&app_handle) {
        Ok(path) => {
            info!("[preview-callback] Screenshot captured: {}", path);
            let _ = app_handle.emit("preview-screenshot-taken", path);
            (StatusCode::OK, cors)
        }
        Err(e) => {
            warn!("[preview-callback] Screenshot failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, cors)
        }
    }
}

async fn handle_preview_open_browser(
    Json(body): Json<OpenBrowserRequest>,
) -> (StatusCode, [(&'static str, &'static str); 1]) {
    info!("[preview-callback] Opening in browser: {}", body.url);
    let _ = std::process::Command::new("open").arg(&body.url).spawn();
    (StatusCode::OK, [("access-control-allow-origin", "*")])
}

async fn handle_preview_close(
    AxumState(state): AxumState<Arc<ApprovalServerState>>,
) -> (StatusCode, [(&'static str, &'static str); 1]) {
    let cors = [("access-control-allow-origin", "*")];
    let Some(app_handle) = state.app_handle().await else {
        return (StatusCode::INTERNAL_SERVER_ERROR, cors);
    };
    if let Some(window) = app_handle.get_webview_window("preview") {
        let _ = window.close();
    }
    (StatusCode::OK, cors)
}

/// Start the approval HTTP server on a random available port.
/// Returns the port number.
pub async fn start_approval_server(approval_state: Arc<ApprovalServerState>) -> Result<u16, String> {
    let app = Router::new()
        .route("/tool-approval", post(handle_tool_approval))
        .route("/screenshot", post(handle_preview_screenshot))
        .route("/screenshot", options(preview_cors_preflight))
        .route("/open", post(handle_preview_open_browser))
        .route("/open", options(preview_cors_preflight))
        .route("/close", post(handle_preview_close))
        .route("/close", options(preview_cors_preflight))
        .with_state(approval_state);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind approval server: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get approval server address: {}", e))?
        .port();

    info!("[approval-server] Listening on 127.0.0.1:{}", port);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error!("[approval-server] Server failed: {}", e);
        }
    });

    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_input_deserializes_with_forge_session_id() {
        let json = r#"{
            "forge_session_id": "abc-123",
            "session_id": "cli-456",
            "cwd": "/tmp/project",
            "tool_name": "Edit",
            "tool_input": {"file": "main.rs"}
        }"#;
        let input: HookInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.forge_session_id.as_deref(), Some("abc-123"));
        assert_eq!(input.session_id.as_deref(), Some("cli-456"));
        assert_eq!(input.tool_name.as_deref(), Some("Edit"));
    }

    #[test]
    fn hook_input_deserializes_without_forge_session_id() {
        let json = r#"{
            "session_id": "cli-456",
            "cwd": "/tmp/project",
            "tool_name": "Write"
        }"#;
        let input: HookInput = serde_json::from_str(json).unwrap();
        assert!(input.forge_session_id.is_none());
        assert_eq!(input.session_id.as_deref(), Some("cli-456"));
        assert_eq!(input.tool_name.as_deref(), Some("Write"));
    }

    #[test]
    fn hook_input_deserializes_minimal() {
        let json = r#"{}"#;
        let input: HookInput = serde_json::from_str(json).unwrap();
        assert!(input.forge_session_id.is_none());
        assert!(input.session_id.is_none());
        assert!(input.tool_name.is_none());
    }
}
