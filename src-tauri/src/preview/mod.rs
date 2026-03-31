pub mod port_detector;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::EventId;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerInfo {
    pub terminal_id: String,
    pub synthetic_session_id: String,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub status: DevServerStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DevServerStatus {
    Starting,
    Scanning,
    Probing,
    Detected,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleLogEntry {
    pub level: String,
    pub ts: String,
    pub msg: String,
    pub url: String,
    pub stack: Option<String>,
}

pub struct PreviewState {
    pub dev_servers: Arc<Mutex<HashMap<String, DevServerInfo>>>,
    pub console_logs: Arc<Mutex<Vec<ConsoleLogEntry>>>,
    /// Serializes preview window creation to prevent race conditions
    /// where two concurrent calls both find no existing window and both create one.
    pub window_lock: Arc<Mutex<()>>,
    /// Cancellation token for the active console-polling task.
    /// Cancelled when a new preview window is opened or the preview is closed,
    /// preventing orphaned polling tasks from emitting stale events.
    pub poll_cancel: Arc<Mutex<CancellationToken>>,
    /// The project path that currently owns the preview window.
    /// Used to scope close events to the correct project.
    pub active_preview_project: Arc<Mutex<Option<String>>>,
    /// Event listener IDs for IPC-based toolbar actions and console batches.
    /// Cleaned up when the preview window is replaced or closed.
    pub ipc_listener_ids: Arc<Mutex<Vec<EventId>>>,
}

impl PreviewState {
    pub fn new() -> Self {
        Self {
            dev_servers: Arc::new(Mutex::new(HashMap::new())),
            console_logs: Arc::new(Mutex::new(Vec::new())),
            window_lock: Arc::new(Mutex::new(())),
            poll_cancel: Arc::new(Mutex::new(CancellationToken::new())),
            active_preview_project: Arc::new(Mutex::new(None)),
            ipc_listener_ids: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn preview_state_starts_empty() {
        let state = PreviewState::new();
        let servers = state.dev_servers.lock().await;
        assert!(servers.is_empty());
    }

    #[tokio::test]
    async fn insert_and_retrieve_dev_server() {
        let state = PreviewState::new();
        let info = DevServerInfo {
            terminal_id: "term-1".to_string(),
            synthetic_session_id: "devserver-abc123".to_string(),
            port: Some(3000),
            url: Some("http://localhost:3000".to_string()),
            status: DevServerStatus::Detected,
        };

        {
            let mut servers = state.dev_servers.lock().await;
            servers.insert("/test/project".to_string(), info.clone());
        }

        let servers = state.dev_servers.lock().await;
        let retrieved = servers.get("/test/project").unwrap();
        assert_eq!(retrieved.terminal_id, "term-1");
        assert_eq!(retrieved.port, Some(3000));
        assert_eq!(retrieved.status, DevServerStatus::Detected);
    }

    #[tokio::test]
    async fn remove_dev_server() {
        let state = PreviewState::new();
        let info = DevServerInfo {
            terminal_id: "term-1".to_string(),
            synthetic_session_id: "devserver-abc".to_string(),
            port: None,
            url: None,
            status: DevServerStatus::Scanning,
        };

        {
            let mut servers = state.dev_servers.lock().await;
            servers.insert("/test/project".to_string(), info);
        }

        {
            let mut servers = state.dev_servers.lock().await;
            servers.remove("/test/project");
        }

        let servers = state.dev_servers.lock().await;
        assert!(servers.get("/test/project").is_none());
    }

    #[tokio::test]
    async fn multiple_projects_isolated() {
        let state = PreviewState::new();
        let info_a = DevServerInfo {
            terminal_id: "term-a".to_string(),
            synthetic_session_id: "devserver-aaa".to_string(),
            port: Some(3000),
            url: Some("http://localhost:3000".to_string()),
            status: DevServerStatus::Detected,
        };
        let info_b = DevServerInfo {
            terminal_id: "term-b".to_string(),
            synthetic_session_id: "devserver-bbb".to_string(),
            port: Some(5173),
            url: Some("http://localhost:5173".to_string()),
            status: DevServerStatus::Scanning,
        };

        {
            let mut servers = state.dev_servers.lock().await;
            servers.insert("/project-a".to_string(), info_a);
            servers.insert("/project-b".to_string(), info_b);
        }

        let servers = state.dev_servers.lock().await;
        assert_eq!(servers.len(), 2);
        assert_eq!(servers.get("/project-a").unwrap().port, Some(3000));
        assert_eq!(servers.get("/project-b").unwrap().port, Some(5173));
        assert_eq!(
            servers.get("/project-a").unwrap().status,
            DevServerStatus::Detected
        );
        assert_eq!(
            servers.get("/project-b").unwrap().status,
            DevServerStatus::Scanning
        );
    }

    #[tokio::test]
    async fn update_server_status() {
        let state = PreviewState::new();
        let info = DevServerInfo {
            terminal_id: "term-1".to_string(),
            synthetic_session_id: "devserver-abc".to_string(),
            port: None,
            url: None,
            status: DevServerStatus::Starting,
        };

        {
            let mut servers = state.dev_servers.lock().await;
            servers.insert("/test".to_string(), info);
        }

        // Update status to Scanning
        {
            let mut servers = state.dev_servers.lock().await;
            if let Some(s) = servers.get_mut("/test") {
                s.status = DevServerStatus::Scanning;
            }
        }

        // Update to Detected with port
        {
            let mut servers = state.dev_servers.lock().await;
            if let Some(s) = servers.get_mut("/test") {
                s.status = DevServerStatus::Detected;
                s.port = Some(3000);
                s.url = Some("http://localhost:3000".to_string());
            }
        }

        let servers = state.dev_servers.lock().await;
        let s = servers.get("/test").unwrap();
        assert_eq!(s.status, DevServerStatus::Detected);
        assert_eq!(s.port, Some(3000));
        assert_eq!(s.url.as_deref(), Some("http://localhost:3000"));
    }

    #[test]
    fn dev_server_info_serializes_to_camel_case() {
        let info = DevServerInfo {
            terminal_id: "t1".to_string(),
            synthetic_session_id: "devserver-abc".to_string(),
            port: Some(3000),
            url: Some("http://localhost:3000".to_string()),
            status: DevServerStatus::Detected,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"terminalId\""));
        assert!(json.contains("\"syntheticSessionId\""));
        assert!(json.contains("\"detected\""));
        assert!(!json.contains("terminal_id"));
    }

    #[test]
    fn dev_server_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&DevServerStatus::Starting).unwrap(),
            "\"starting\""
        );
        assert_eq!(
            serde_json::to_string(&DevServerStatus::Scanning).unwrap(),
            "\"scanning\""
        );
        assert_eq!(
            serde_json::to_string(&DevServerStatus::Probing).unwrap(),
            "\"probing\""
        );
        assert_eq!(
            serde_json::to_string(&DevServerStatus::Detected).unwrap(),
            "\"detected\""
        );
        assert_eq!(
            serde_json::to_string(&DevServerStatus::Failed).unwrap(),
            "\"failed\""
        );
    }

    #[test]
    fn dev_server_info_clone() {
        let info = DevServerInfo {
            terminal_id: "t1".to_string(),
            synthetic_session_id: "ds-1".to_string(),
            port: Some(5173),
            url: Some("http://localhost:5173".to_string()),
            status: DevServerStatus::Detected,
        };

        let cloned = info.clone();
        assert_eq!(cloned.terminal_id, "t1");
        assert_eq!(cloned.port, Some(5173));
        assert_eq!(cloned.status, DevServerStatus::Detected);
    }

    #[tokio::test]
    async fn arc_allows_shared_access() {
        let state = PreviewState::new();
        let servers_clone = state.dev_servers.clone();

        // Insert via original
        {
            let mut servers = state.dev_servers.lock().await;
            servers.insert(
                "/project".to_string(),
                DevServerInfo {
                    terminal_id: "t1".to_string(),
                    synthetic_session_id: "ds-1".to_string(),
                    port: Some(3000),
                    url: None,
                    status: DevServerStatus::Scanning,
                },
            );
        }

        // Read via clone — should see the same data
        let servers = servers_clone.lock().await;
        assert!(servers.contains_key("/project"));
        assert_eq!(servers.get("/project").unwrap().port, Some(3000));
    }

    #[tokio::test]
    async fn poll_cancel_starts_uncancelled() {
        let state = PreviewState::new();
        let token = state.poll_cancel.lock().await;
        assert!(!token.is_cancelled());
    }

    #[tokio::test]
    async fn poll_cancel_cancels_cloned_tokens() {
        let state = PreviewState::new();

        // Clone the token (simulating what the polling task does)
        let task_token = {
            let token = state.poll_cancel.lock().await;
            token.clone()
        };

        assert!(!task_token.is_cancelled());

        // Cancel via the state (simulating what open_preview_window does)
        {
            let mut cancel = state.poll_cancel.lock().await;
            cancel.cancel();
            *cancel = CancellationToken::new();
        }

        // The cloned token should be cancelled
        assert!(task_token.is_cancelled());

        // The new token in state should NOT be cancelled
        let new_token = state.poll_cancel.lock().await;
        assert!(!new_token.is_cancelled());
    }

    #[tokio::test]
    async fn poll_cancel_multiple_replacements() {
        let state = PreviewState::new();

        // Simulate three consecutive preview opens — each cancels the previous
        let token_a = {
            let t = state.poll_cancel.lock().await;
            t.clone()
        };

        // "Open" preview B — cancels A
        {
            let mut cancel = state.poll_cancel.lock().await;
            cancel.cancel();
            *cancel = CancellationToken::new();
        }
        let token_b = {
            let t = state.poll_cancel.lock().await;
            t.clone()
        };

        // "Open" preview C — cancels B
        {
            let mut cancel = state.poll_cancel.lock().await;
            cancel.cancel();
            *cancel = CancellationToken::new();
        }
        let token_c = {
            let t = state.poll_cancel.lock().await;
            t.clone()
        };

        assert!(token_a.is_cancelled());
        assert!(token_b.is_cancelled());
        assert!(!token_c.is_cancelled());
    }

    #[tokio::test]
    async fn active_preview_project_starts_none() {
        let state = PreviewState::new();
        let active = state.active_preview_project.lock().await;
        assert!(active.is_none());
    }

    #[tokio::test]
    async fn active_preview_project_set_and_clear() {
        let state = PreviewState::new();

        // Set active project (simulates open_preview_window)
        {
            let mut active = state.active_preview_project.lock().await;
            *active = Some("/project-a".to_string());
        }

        {
            let active = state.active_preview_project.lock().await;
            assert_eq!(active.as_deref(), Some("/project-a"));
        }

        // Replace with different project
        {
            let mut active = state.active_preview_project.lock().await;
            *active = Some("/project-b".to_string());
        }

        {
            let active = state.active_preview_project.lock().await;
            assert_eq!(active.as_deref(), Some("/project-b"));
        }

        // Clear (simulates close_preview_window)
        {
            let mut active = state.active_preview_project.lock().await;
            *active = None;
        }

        let active = state.active_preview_project.lock().await;
        assert!(active.is_none());
    }

    #[tokio::test]
    async fn active_preview_project_shared_via_arc() {
        let state = PreviewState::new();
        let arc_clone = state.active_preview_project.clone();

        // Set via original
        {
            let mut active = state.active_preview_project.lock().await;
            *active = Some("/project".to_string());
        }

        // Read via clone — should see the same data
        let active = arc_clone.lock().await;
        assert_eq!(active.as_deref(), Some("/project"));
    }

    // ── Callback port injection contract tests ──
    // Regression: the callback port was injected via eval() which is blocked
    // by pages with restrictive CSP. It must now be injected via
    // initialization_script by prepending to the bridge JS.

    // ── Action IPC contract tests ──
    // Primary: fetch() to approval server. Fallback: hidden iframe navigation
    // to cm-ipc:// scheme, intercepted by on_navigation handler (CSP-immune).

    #[test]
    fn bridge_has_navigation_fallback() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(
            bridge.contains("cm-ipc://action/"),
            "Bridge must use cm-ipc:// scheme for navigation-based IPC fallback"
        );
    }

    #[test]
    fn bridge_screenshot_pushes_action() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(
            bridge.contains("action: 'screenshot'"),
            "Screenshot button must push action:'screenshot' to action queue"
        );
    }

    #[test]
    fn bridge_close_pushes_action_and_calls_window_close() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(
            bridge.contains("action: 'close'"),
            "Close button must push action:'close' to action queue"
        );
        assert!(
            bridge.contains("window.close()"),
            "Close button must also call window.close() for immediate feedback"
        );
    }

    #[test]
    fn bridge_open_pushes_action_with_url() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(
            bridge.contains("action: 'open'"),
            "Open button must push action:'open' to action queue"
        );
    }

    #[test]
    fn bridge_console_to_chat_pushes_action_with_logs() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(
            bridge.contains("action: 'console_to_chat'"),
            "Send to Chat must push action:'console_to_chat' to action queue"
        );
    }

    #[test]
    fn bridge_uses_fetch_to_approval_server_for_actions() {
        // The bridge sends toolbar actions via fetch() to the approval server
        // (127.0.0.1:{port}) which has CORS headers for localhost origins.
        // Falls back to cm-ipc:// navigation if fetch fails (CSP blocking).
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(bridge.contains("127.0.0.1"), "Bridge must use 127.0.0.1 for approval server");
        assert!(bridge.contains("__CM_CALLBACK_PORT"), "Bridge must reference the callback port");
        assert!(bridge.contains("/screenshot"), "Bridge must have /screenshot endpoint");
        assert!(bridge.contains("/open"), "Bridge must have /open endpoint");
        assert!(bridge.contains("/close"), "Bridge must have /close endpoint");
        assert!(bridge.contains("/console-to-chat"), "Bridge must have /console-to-chat endpoint");
    }

    #[test]
    fn bridge_falls_back_to_navigation_on_fetch_failure() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        // The .catch() handler must call the navigation fallback
        assert!(
            bridge.contains("cmSendViaNavigation(action)"),
            "Bridge must fall back to cmSendViaNavigation on fetch failure"
        );
    }

    #[test]
    fn bridge_toolbar_is_created() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(
            bridge.contains("__cm_toolbar"),
            "Bridge must create the toolbar element"
        );
    }

    #[test]
    fn bridge_console_drawer_is_created() {
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(
            bridge.contains("__cm_console_drawer"),
            "Bridge must create the console drawer element"
        );
        assert!(
            bridge.contains("Send to Chat"),
            "Console drawer must contain 'Send to Chat' button"
        );
    }

    #[test]
    fn toolbar_action_deserializes_screenshot() {
        let json = r#"{"action":"screenshot"}"#;
        let action: super::super::commands::preview::ToolbarAction =
            serde_json::from_str(json).unwrap();
        assert_eq!(action.action, "screenshot");
        assert!(action.url.is_none());
        assert!(action.logs.is_none());
    }

    #[test]
    fn toolbar_action_deserializes_open_with_url() {
        let json = r#"{"action":"open","url":"http://localhost:3000/about"}"#;
        let action: super::super::commands::preview::ToolbarAction =
            serde_json::from_str(json).unwrap();
        assert_eq!(action.action, "open");
        assert_eq!(action.url.as_deref(), Some("http://localhost:3000/about"));
    }

    #[test]
    fn toolbar_action_deserializes_console_to_chat_with_logs() {
        let json = r#"{"action":"console_to_chat","logs":"[ERROR] Something broke"}"#;
        let action: super::super::commands::preview::ToolbarAction =
            serde_json::from_str(json).unwrap();
        assert_eq!(action.action, "console_to_chat");
        assert_eq!(action.logs.as_deref(), Some("[ERROR] Something broke"));
    }

    #[test]
    fn toolbar_action_deserializes_batch() {
        let json = r#"[
            {"action":"screenshot"},
            {"action":"open","url":"http://localhost:3000"},
            {"action":"console_to_chat","logs":"[ERROR] oops"}
        ]"#;
        let actions: Vec<super::super::commands::preview::ToolbarAction> =
            serde_json::from_str(json).unwrap();
        assert_eq!(actions.len(), 3);
        assert_eq!(actions[0].action, "screenshot");
        assert_eq!(actions[1].action, "open");
        assert_eq!(actions[1].url.as_deref(), Some("http://localhost:3000"));
        assert_eq!(actions[2].action, "console_to_chat");
        assert_eq!(actions[2].logs.as_deref(), Some("[ERROR] oops"));
    }

    #[test]
    fn toolbar_action_unknown_type_deserializes() {
        let json = r#"{"action":"future_feature","url":"x"}"#;
        let action: super::super::commands::preview::ToolbarAction =
            serde_json::from_str(json).unwrap();
        assert_eq!(action.action, "future_feature");
    }

    #[test]
    fn toolbar_action_console_to_chat_without_logs() {
        // If logs field is missing, it should default to None
        let json = r#"{"action":"console_to_chat"}"#;
        let action: super::super::commands::preview::ToolbarAction =
            serde_json::from_str(json).unwrap();
        assert_eq!(action.action, "console_to_chat");
        assert!(action.logs.is_none());
    }

    #[test]
    fn toolbar_action_open_without_url() {
        let json = r#"{"action":"open"}"#;
        let action: super::super::commands::preview::ToolbarAction =
            serde_json::from_str(json).unwrap();
        assert_eq!(action.action, "open");
        assert!(action.url.is_none());
    }

    #[test]
    fn bridge_navigation_fallback_defined_before_use() {
        // cmSendViaNavigation must be defined before cmSendAction calls it
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        let defn = bridge.find("function cmSendViaNavigation");
        let usage = bridge.find("cmSendViaNavigation(action)");
        assert!(defn.is_some(), "cmSendViaNavigation must be defined");
        assert!(usage.is_some(), "cmSendViaNavigation must be called");
        assert!(
            defn.unwrap() < usage.unwrap(),
            "cmSendViaNavigation definition must come before its first use"
        );
    }

    #[test]
    fn toolbar_action_deserializes_close() {
        let json = r#"{"action":"close"}"#;
        let action: super::super::commands::preview::ToolbarAction =
            serde_json::from_str(json).unwrap();
        assert_eq!(action.action, "close");
    }

    // ── IPC listener ID tracking ──

    #[tokio::test]
    async fn ipc_listener_ids_starts_empty() {
        let state = PreviewState::new();
        let ids = state.ipc_listener_ids.lock().await;
        assert!(ids.is_empty());
    }

    // ── Capability contract ──

    #[test]
    fn preview_capability_exists_and_has_remote_urls() {
        let cap = include_str!("../../capabilities/preview.json");
        assert!(cap.contains("preview-remote"), "Capability must have preview-remote identifier");
        assert!(cap.contains("http://localhost:*"), "Capability must allow localhost");
        assert!(cap.contains("http://127.0.0.1:*"), "Capability must allow 127.0.0.1");
        assert!(cap.contains("core:event:allow-emit"), "Capability must grant event:allow-emit");
    }

    #[test]
    fn default_capability_includes_preview_window() {
        // The preview window needs window management permissions (close, size, etc.)
        // for Rust-side operations. Removing "preview" from default breaks close button.
        let cap = include_str!("../../capabilities/default.json");
        assert!(cap.contains("\"preview\""), "Default capability must include the preview window");
    }

    // ── Bridge fetch routing ──

    #[test]
    fn bridge_cm_send_action_routes_to_correct_endpoints() {
        // Verify the switch statement in cmSendAction maps actions to endpoints
        let bridge = include_str!("../../resources/preview-console-bridge.js");
        assert!(bridge.contains("case 'screenshot':"));
        assert!(bridge.contains("case 'open':"));
        assert!(bridge.contains("case 'close':"));
        assert!(bridge.contains("case 'console_to_chat':"));
    }
}
