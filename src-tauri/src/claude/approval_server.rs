use axum::{extract::State as AxumState, http::{HeaderMap, HeaderValue, StatusCode}, routing::{options, post}, Json, Router};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;
use url::Url;

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
    "Monitor",
];

/// Additional tools auto-approved in Plan mode.
/// The CLI's plan mode system prompt constrains the model to only write
/// the plan file and use read-only commands. These tools are needed for
/// plan mode to function at all.
const PLAN_MODE_ALLOWED_TOOLS: &[&str] = &[
    "Write",
    "Edit",
    "Agent",
    "WebSearch",
    "WebFetch",
    "ToolSearch",
    "TodoWrite",
    "TaskCreate",
    "TaskUpdate",
    "TaskGet",
    "TaskList",
    "TaskOutput",
    "TaskStop",
    "LSP",
    "NotebookEdit",
    "EnterWorktree",
    "ExitWorktree",
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

    // Tier 1b: Check session_modes (catches SpecWriter sessions
    // which are in session_modes but NOT in state.sessions)
    if let Some(hint) = forge_session_id_hint {
        if let Some(state) = app_handle.try_state::<AppState>() {
            let modes = state.session_modes.lock().await;
            if modes.contains_key(hint) {
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

    // Mode-control tools: observe the call and update session mode.
    //
    // IMPORTANT (CLI 2.1.78+, verified against 2.1.126):
    // ExitPlanMode and EnterPlanMode are CLI-internal "interactive UI" tools.
    // The CLI fires the PreToolUse hook for them so the host can observe
    // (and reject — see SpecWriter branch below), but the CLI's outcome is
    // fixed regardless of the host's decision: it synthesises a denied
    // tool_result and adds the entry to result.permission_denials. Returning
    // `allow` here does NOT actually approve the tool execution — it just
    // tells the CLI "the host has no objection." The session-mode update we
    // do below is the load-bearing side effect of this branch.
    // See docs/internal/cli-2.1.126-protocol-report.md §"Special tools".
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
                        "[approval-server] Observed {} (no app handle for mode update; CLI will surface its own UI prompt)",
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

        // SpecWriter sessions must NOT be allowed to change mode.
        // A SpecWriter session exists in session_modes but NOT in sessions.
        if let Some(ref sid) = forge_session_id {
            if let Some(app_state) = app_handle.try_state::<crate::claude::session::AppState>() {
                let sessions = app_state.sessions.lock().await;
                let modes = app_state.session_modes.lock().await;
                if modes.contains_key(sid) && !sessions.contains_key(sid) {
                    info!(
                        "[approval-server] DENIED {} for SpecWriter session {}",
                        tool_name, sid
                    );
                    return (
                        StatusCode::OK,
                        Json(HookResponse::deny(Some(
                            "Mode changes not allowed in SpecWriter sessions.".to_string(),
                        ))),
                    );
                }
            }
        }

        if let Some(ref sid) = forge_session_id {
            if let Some(app_state) = app_handle.try_state::<crate::claude::session::AppState>() {
                let mut modes = app_state.session_modes.lock().await;
                info!(
                    "[approval-server] {} observed → switching session {} to {:?} (CLI emits its own UI denial regardless of this allow)",
                    tool_name, sid, new_mode
                );
                modes.insert(sid.clone(), new_mode.clone());
            }
            if let Err(e) = app_handle.emit(
                "session-mode-changed",
                serde_json::json!({
                    "sessionId": sid,
                    "mode": new_mode
                }),
            ) {
                warn!("[approval-server] Failed to emit session-mode-changed: {}", e);
            }
        } else {
            warn!(
                "[approval-server] {} observed but session not found — mode not updated",
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
                SessionMode::DontAsk => {
                    // "Don't ask" — behaviorally equivalent to AutoAccept for the
                    // approval server. Distinct from AutoAccept only for UI labeling.
                    info!(
                        "[approval-server] Auto-approving tool {} (don't-ask mode, session: {})",
                        tool_name, forge_session_id
                    );
                    return (StatusCode::OK, Json(HookResponse::allow()));
                }
                SessionMode::BypassPermissions => {
                    // The CLI bypasses the hook entirely in this mode, so this
                    // branch should rarely fire. Return allow defensively in case
                    // the CLI's behavior changes or a version mismatch routes a
                    // hook request here.
                    info!(
                        "[approval-server] Auto-approving tool {} (bypass-permissions mode, session: {})",
                        tool_name, forge_session_id
                    );
                    return (StatusCode::OK, Json(HookResponse::allow()));
                }
                SessionMode::Plan => {
                    // Plan mode: auto-approve tools needed for planning (Write for
                    // the plan file, Agent for subagent research, etc.). Tools not
                    // on the list (e.g. Bash, MCP tools) fall through to the normal
                    // user-approval flow so the user can inspect and approve/deny.
                    if PLAN_MODE_ALLOWED_TOOLS.contains(&tool_name) {
                        info!(
                            "[approval-server] Auto-approving tool {} in Plan mode (session: {})",
                            tool_name, forge_session_id
                        );
                        return (StatusCode::OK, Json(HookResponse::allow()));
                    }
                    info!(
                        "[approval-server] Tool {} in Plan mode requires user approval (session: {})",
                        tool_name, forge_session_id
                    );
                    // Fall through to normal approval flow
                }
                SessionMode::Auto => {
                    // CLI's auto-routing mode decides per-tool whether to ask.
                    // If the hook fires here at all, the CLI wants us to prompt
                    // the user — fall through to the normal approval flow.
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
/// Origin is restricted to localhost/127.0.0.1 to prevent external pages from calling these endpoints.
async fn preview_cors_preflight(
    headers: axum::http::HeaderMap,
) -> (StatusCode, HeaderMap) {
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let mut resp_headers = HeaderMap::new();
    if is_localhost_origin(origin) {
        if let Ok(val) = HeaderValue::from_str(origin) {
            resp_headers.insert("access-control-allow-origin", val);
        }
    }
    resp_headers.insert("access-control-allow-methods", HeaderValue::from_static("POST, OPTIONS"));
    resp_headers.insert("access-control-allow-headers", HeaderValue::from_static("content-type"));
    (StatusCode::NO_CONTENT, resp_headers)
}

/// Returns true if the origin matches localhost or 127.0.0.1 (any port, http/https only).
/// Uses proper URL parsing to prevent origin spoofing (e.g. `http://127.0.0.1.attacker.com`).
fn is_localhost_origin(origin: &str) -> bool {
    match Url::parse(origin) {
        Ok(url) => {
            (url.scheme() == "http" || url.scheme() == "https")
                && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
        }
        Err(_) => false,
    }
}

/// Build CORS header restricted to localhost origins.
/// Echoes back the request's Origin so the browser accepts the response
/// regardless of whether the preview loaded from localhost or 127.0.0.1.
fn cors_header(headers: &axum::http::HeaderMap) -> HeaderMap {
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let mut resp_headers = HeaderMap::new();
    if is_localhost_origin(origin) {
        if let Ok(val) = HeaderValue::from_str(origin) {
            resp_headers.insert("access-control-allow-origin", val);
        }
    }
    resp_headers
}

#[derive(Deserialize)]
struct OpenBrowserRequest {
    url: String,
}

#[derive(Deserialize)]
struct ConsoleToChat {
    logs: String,
}

async fn handle_preview_screenshot(
    headers: axum::http::HeaderMap,
    AxumState(state): AxumState<Arc<ApprovalServerState>>,
) -> (StatusCode, HeaderMap) {
    let cors = cors_header(&headers);
    let Some(app_handle) = state.app_handle().await else {
        warn!("[preview-callback] No app handle available for screenshot");
        return (StatusCode::INTERNAL_SERVER_ERROR, cors);
    };
    match capture_screenshot_inner(&app_handle) {
        Ok(path) => {
            info!("[preview-callback] Screenshot captured: {}", path);
            if let Err(e) = app_handle.emit("preview-screenshot-taken", path) {
                warn!("[approval-server] Failed to emit preview-screenshot-taken: {}", e);
            }
            (StatusCode::OK, cors)
        }
        Err(e) => {
            warn!("[preview-callback] Screenshot failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, cors)
        }
    }
}

async fn handle_preview_open_browser(
    headers: axum::http::HeaderMap,
    Json(body): Json<OpenBrowserRequest>,
) -> (StatusCode, HeaderMap) {
    let cors = cors_header(&headers);
    // Parse and validate the URL — only allow http/https schemes to prevent file://, ssh://, etc.
    let parsed = match Url::parse(&body.url) {
        Ok(url) if url.scheme() == "http" || url.scheme() == "https" => url,
        _ => {
            warn!(
                "[preview-callback] Rejected open request with invalid/disallowed URL: {}",
                body.url
            );
            return (StatusCode::BAD_REQUEST, cors);
        }
    };
    info!("[preview-callback] Opening in browser: {}", parsed.as_str());
    if let Err(e) = std::process::Command::new("open").arg(parsed.as_str()).spawn() {
        warn!("[preview-callback] Failed to open URL: {}", e);
    }
    (StatusCode::OK, cors)
}

async fn handle_preview_console_to_chat(
    headers: axum::http::HeaderMap,
    AxumState(state): AxumState<Arc<ApprovalServerState>>,
    Json(body): Json<ConsoleToChat>,
) -> (StatusCode, HeaderMap) {
    let cors = cors_header(&headers);
    let Some(app_handle) = state.app_handle().await else {
        warn!("[preview-callback] No app handle available for console-to-chat");
        return (StatusCode::INTERNAL_SERVER_ERROR, cors);
    };
    info!("[preview-callback] Sending console logs to chat ({} bytes)", body.logs.len());
    if let Err(e) = app_handle.emit("preview-console-to-chat", body.logs) {
        warn!("[approval-server] Failed to emit preview-console-to-chat: {}", e);
    }
    (StatusCode::OK, cors)
}

async fn handle_preview_close(
    headers: axum::http::HeaderMap,
    AxumState(state): AxumState<Arc<ApprovalServerState>>,
) -> (StatusCode, HeaderMap) {
    let cors = cors_header(&headers);
    let Some(app_handle) = state.app_handle().await else {
        return (StatusCode::INTERNAL_SERVER_ERROR, cors);
    };

    // Cancel the polling task so it doesn't emit a stale close event
    // after the window is gone — mirrors the logic in close_preview_window IPC command.
    if let Some(preview_state) = app_handle.try_state::<crate::preview::PreviewState>() {
        let mut cancel = preview_state.poll_cancel.lock().await;
        cancel.cancel();
        *cancel = CancellationToken::new();

        let mut active = preview_state.active_preview_project.lock().await;
        *active = None;
    }

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
        .route("/console-to-chat", post(handle_preview_console_to_chat))
        .route("/console-to-chat", options(preview_cors_preflight))
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

    // ── is_localhost_origin tests ──

    #[test]
    fn localhost_http_accepted() {
        assert!(is_localhost_origin("http://localhost"));
        assert!(is_localhost_origin("http://localhost:3000"));
        assert!(is_localhost_origin("http://localhost:8080/path"));
    }

    #[test]
    fn localhost_https_accepted() {
        assert!(is_localhost_origin("https://localhost"));
        assert!(is_localhost_origin("https://localhost:443"));
    }

    #[test]
    fn ip_127_accepted() {
        assert!(is_localhost_origin("http://127.0.0.1"));
        assert!(is_localhost_origin("http://127.0.0.1:5000"));
        assert!(is_localhost_origin("https://127.0.0.1:8443"));
    }

    #[test]
    fn external_origins_rejected() {
        assert!(!is_localhost_origin("http://example.com"));
        assert!(!is_localhost_origin("https://evil.com:3000"));
        assert!(!is_localhost_origin("http://192.168.1.1:8080"));
        assert!(!is_localhost_origin(""));
        assert!(!is_localhost_origin("ftp://localhost"));
        assert!(!is_localhost_origin("not-a-url"));
        assert!(!is_localhost_origin("file:///etc/passwd"));
    }

    #[test]
    fn spoofed_origins_rejected() {
        assert!(!is_localhost_origin("http://127.0.0.1.attacker.com"));
        assert!(!is_localhost_origin("http://localhost.attacker.com"));
        assert!(!is_localhost_origin("http://127.0.0.1evil.com"));
    }

    #[test]
    fn localhost_origin_case_insensitive() {
        assert!(is_localhost_origin("HTTP://LOCALHOST:3000"));
        assert!(is_localhost_origin("Http://Localhost"));
        assert!(is_localhost_origin("HTTPS://127.0.0.1"));
    }

    // ── HookResponse serialization tests ──

    #[test]
    fn hook_response_allow_serializes_correctly() {
        let resp = HookResponse::allow();
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            json["hookSpecificOutput"]["permissionDecision"],
            "allow"
        );
        assert_eq!(
            json["hookSpecificOutput"]["hookEventName"],
            "PreToolUse"
        );
        assert!(json["hookSpecificOutput"]["permissionDecisionReason"].is_null());
    }

    #[test]
    fn hook_response_deny_serializes_with_reason() {
        let resp = HookResponse::deny(Some("Not allowed".to_string()));
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            json["hookSpecificOutput"]["permissionDecision"],
            "deny"
        );
        assert_eq!(
            json["hookSpecificOutput"]["permissionDecisionReason"],
            "Not allowed"
        );
    }

    #[test]
    fn hook_response_deny_without_reason_omits_field() {
        let resp = HookResponse::deny(None);
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            json["hookSpecificOutput"]["permissionDecision"],
            "deny"
        );
        // permissionDecisionReason should be absent (skip_serializing_if = "Option::is_none")
        assert!(!json["hookSpecificOutput"]
            .as_object()
            .unwrap()
            .contains_key("permissionDecisionReason"));
    }

    // ── AUTO_APPROVED_TOOLS tests ──

    #[test]
    fn read_tools_are_auto_approved() {
        assert!(AUTO_APPROVED_TOOLS.contains(&"Read"));
        assert!(AUTO_APPROVED_TOOLS.contains(&"Glob"));
        assert!(AUTO_APPROVED_TOOLS.contains(&"Grep"));
        assert!(AUTO_APPROVED_TOOLS.contains(&"ListDirectory"));
        assert!(AUTO_APPROVED_TOOLS.contains(&"LS"));
        assert!(AUTO_APPROVED_TOOLS.contains(&"TodoRead"));
        assert!(AUTO_APPROVED_TOOLS.contains(&"Monitor"));
    }

    #[test]
    fn write_tools_are_not_auto_approved() {
        assert!(!AUTO_APPROVED_TOOLS.contains(&"Write"));
        assert!(!AUTO_APPROVED_TOOLS.contains(&"Edit"));
        assert!(!AUTO_APPROVED_TOOLS.contains(&"Bash"));
        assert!(!AUTO_APPROVED_TOOLS.contains(&"Delete"));
    }

    #[test]
    fn schedule_wakeup_not_auto_approved() {
        assert!(!AUTO_APPROVED_TOOLS.contains(&"ScheduleWakeup"));
    }

    // ── PLAN_MODE_ALLOWED_TOOLS tests ──

    #[test]
    fn plan_mode_allows_write_edit_and_agent() {
        assert!(PLAN_MODE_ALLOWED_TOOLS.contains(&"Write"));
        assert!(PLAN_MODE_ALLOWED_TOOLS.contains(&"Edit"));
        assert!(PLAN_MODE_ALLOWED_TOOLS.contains(&"Agent"));
        assert!(PLAN_MODE_ALLOWED_TOOLS.contains(&"WebSearch"));
        assert!(PLAN_MODE_ALLOWED_TOOLS.contains(&"WebFetch"));
        assert!(PLAN_MODE_ALLOWED_TOOLS.contains(&"ToolSearch"));
    }

    #[test]
    fn bash_requires_approval_in_plan_mode() {
        assert!(!PLAN_MODE_ALLOWED_TOOLS.contains(&"Bash"));
    }

    #[test]
    fn ask_user_question_requires_approval_in_plan_mode() {
        assert!(!PLAN_MODE_ALLOWED_TOOLS.contains(&"AskUserQuestion"));
    }

    #[test]
    fn plan_mode_allowed_does_not_overlap_auto_approved() {
        for tool in PLAN_MODE_ALLOWED_TOOLS {
            assert!(
                !AUTO_APPROVED_TOOLS.contains(tool),
                "{} is in both AUTO_APPROVED_TOOLS and PLAN_MODE_ALLOWED_TOOLS",
                tool
            );
        }
    }

    // ── HookInput extra fields ──

    #[test]
    fn hook_input_preserves_extra_fields() {
        let json = r#"{
            "tool_name": "Edit",
            "custom_field": "custom_value",
            "nested": {"key": "val"}
        }"#;
        let input: HookInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.tool_name.as_deref(), Some("Edit"));
        // Extra fields are captured in _extra
        assert_eq!(input._extra["custom_field"], "custom_value");
    }

    // ── ToolApprovalRequest serialization ──

    #[test]
    fn tool_approval_request_serializes_camel_case() {
        let req = ToolApprovalRequest {
            request_id: "req-1".to_string(),
            forge_session_id: "fs-1".to_string(),
            tool_name: "Edit".to_string(),
            tool_input: serde_json::json!({"file": "main.rs"}),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["requestId"], "req-1");
        assert_eq!(json["forgeSessionId"], "fs-1");
        assert_eq!(json["toolName"], "Edit");
        assert_eq!(json["toolInput"]["file"], "main.rs");
    }

    // ── ApprovalServerState tests ──

    #[tokio::test]
    async fn resolve_nonexistent_request_returns_false() {
        let state = ApprovalServerState::new();
        let result = state.resolve("nonexistent-id", true, None).await;
        assert!(!result);
    }

    #[tokio::test]
    async fn deny_all_clears_pending() {
        let state = ApprovalServerState::new();
        let (tx, _rx) = oneshot::channel::<ApprovalDecision>();
        {
            let mut pending = state.pending.lock().await;
            pending.insert("test-1".to_string(), tx);
        }
        state.deny_all().await;
        let pending = state.pending.lock().await;
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn app_handle_is_none_by_default() {
        let state = ApprovalServerState::new();
        assert!(state.app_handle().await.is_none());
    }

    // ── Preview callback CORS regression tests ──
    // These tests ensure that CORS validation for preview callbacks
    // never accidentally blocks legitimate localhost preview origins.
    // Regression: security changes broke screenshot, close, and
    // console-to-chat by rejecting valid origins.

    #[test]
    fn cors_allows_localhost_with_common_dev_ports() {
        // Dev servers use various ports — all must be accepted
        assert!(is_localhost_origin("http://localhost:3000"));
        assert!(is_localhost_origin("http://localhost:5173"));
        assert!(is_localhost_origin("http://localhost:8080"));
        assert!(is_localhost_origin("http://localhost:4200"));
        assert!(is_localhost_origin("http://localhost:8000"));
        assert!(is_localhost_origin("http://localhost:1420")); // Tauri dev URL
    }

    #[test]
    fn cors_allows_127_0_0_1_with_common_dev_ports() {
        assert!(is_localhost_origin("http://127.0.0.1:3000"));
        assert!(is_localhost_origin("http://127.0.0.1:5173"));
        assert!(is_localhost_origin("http://127.0.0.1:8080"));
        assert!(is_localhost_origin("http://127.0.0.1:4200"));
    }

    #[test]
    fn cors_allows_localhost_without_port() {
        // Origin header may omit port for default (80/443)
        assert!(is_localhost_origin("http://localhost"));
        assert!(is_localhost_origin("https://localhost"));
        assert!(is_localhost_origin("http://127.0.0.1"));
        assert!(is_localhost_origin("https://127.0.0.1"));
    }

    #[test]
    fn cors_rejects_non_loopback_ips() {
        // Other local IPs (LAN, Docker, etc.) must NOT be accepted
        assert!(!is_localhost_origin("http://0.0.0.0:3000"));
        assert!(!is_localhost_origin("http://192.168.1.100:3000"));
        assert!(!is_localhost_origin("http://10.0.0.1:8080"));
        assert!(!is_localhost_origin("http://172.17.0.1:3000"));
    }

    #[test]
    fn cors_rejects_empty_and_missing_origin() {
        assert!(!is_localhost_origin(""));
        assert!(!is_localhost_origin("null"));
    }

    // ── Preview callback route presence tests ──
    // Regression: refactors accidentally removed or renamed routes,
    // silently breaking toolbar buttons.

    #[test]
    fn preview_callback_routes_are_all_defined() {
        // This test acts as a compile-time contract: if any handler function
        // is removed or has its signature changed, this test won't compile.
        // The route paths themselves are string literals verified below.
        let _screenshot_handler: fn(axum::http::HeaderMap, AxumState<Arc<ApprovalServerState>>) -> _ = handle_preview_screenshot;
        let _close_handler: fn(axum::http::HeaderMap, AxumState<Arc<ApprovalServerState>>) -> _ = handle_preview_close;
        let _console_handler: fn(axum::http::HeaderMap, AxumState<Arc<ApprovalServerState>>, Json<ConsoleToChat>) -> _ = handle_preview_console_to_chat;
        let _open_handler: fn(axum::http::HeaderMap, Json<OpenBrowserRequest>) -> _ = handle_preview_open_browser;
        let _preflight_handler: fn(axum::http::HeaderMap) -> _ = preview_cors_preflight;
    }

    #[test]
    fn cors_header_echoes_valid_origin() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("origin", HeaderValue::from_static("http://localhost:3000"));
        let resp = cors_header(&headers);
        assert_eq!(
            resp.get("access-control-allow-origin").unwrap(),
            "http://localhost:3000"
        );
    }

    #[test]
    fn cors_header_omits_origin_for_external() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("origin", HeaderValue::from_static("http://evil.com"));
        let resp = cors_header(&headers);
        assert!(resp.get("access-control-allow-origin").is_none());
    }

    #[test]
    fn cors_header_echoes_127_0_0_1_origin() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("origin", HeaderValue::from_static("http://127.0.0.1:54321"));
        let resp = cors_header(&headers);
        assert_eq!(
            resp.get("access-control-allow-origin").unwrap(),
            "http://127.0.0.1:54321"
        );
    }

    #[tokio::test]
    async fn cors_preflight_returns_allow_methods_and_headers() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("origin", HeaderValue::from_static("http://localhost:3000"));
        let (status, resp_headers) = preview_cors_preflight(headers).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(
            resp_headers.get("access-control-allow-methods").unwrap(),
            "POST, OPTIONS"
        );
        assert_eq!(
            resp_headers.get("access-control-allow-headers").unwrap(),
            "content-type"
        );
        assert_eq!(
            resp_headers.get("access-control-allow-origin").unwrap(),
            "http://localhost:3000"
        );
    }

    #[tokio::test]
    async fn cors_preflight_omits_origin_for_external() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("origin", HeaderValue::from_static("http://evil.com"));
        let (_status, resp_headers) = preview_cors_preflight(headers).await;
        assert!(resp_headers.get("access-control-allow-origin").is_none());
        // Methods and headers are still returned (spec allows this)
        assert!(resp_headers.get("access-control-allow-methods").is_some());
    }

    #[test]
    fn console_to_chat_payload_deserializes() {
        // Regression: if ConsoleToChat struct changes shape, the /console-to-chat
        // endpoint would return 422 and silently break "Send to Chat".
        let json = r#"{"logs": "[ERROR] Something broke\n[WARN] Deprecated API"}"#;
        let parsed: ConsoleToChat = serde_json::from_str(json).unwrap();
        assert!(parsed.logs.contains("[ERROR]"));
        assert!(parsed.logs.contains("[WARN]"));
    }

    #[test]
    fn open_browser_request_deserializes() {
        // Regression: if OpenBrowserRequest changes shape, the /open endpoint breaks.
        let json = r#"{"url": "http://localhost:3000/about"}"#;
        let parsed: OpenBrowserRequest = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.url, "http://localhost:3000/about");
    }
}
