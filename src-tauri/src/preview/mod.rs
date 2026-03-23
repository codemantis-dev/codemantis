pub mod port_detector;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
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
}

impl PreviewState {
    pub fn new() -> Self {
        Self {
            dev_servers: Arc::new(Mutex::new(HashMap::new())),
            console_logs: Arc::new(Mutex::new(Vec::new())),
            window_lock: Arc::new(Mutex::new(())),
            poll_cancel: Arc::new(Mutex::new(CancellationToken::new())),
            active_preview_project: Arc::new(Mutex::new(None)),
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
}
