pub mod port_detector;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

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
}

impl PreviewState {
    pub fn new() -> Self {
        Self {
            dev_servers: Arc::new(Mutex::new(HashMap::new())),
            console_logs: Arc::new(Mutex::new(Vec::new())),
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
}
