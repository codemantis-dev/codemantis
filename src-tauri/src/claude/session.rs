use crate::claude::process::ClaudeProcess;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub status: SessionStatus,
    pub created_at: DateTime<Utc>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Starting,
    Connected,
    Idle,
    Closed,
}

pub struct AppState {
    pub sessions: Mutex<HashMap<String, SessionInfo>>,
    pub processes: Mutex<HashMap<String, ClaudeProcess>>,
    pub claude_binary: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            processes: Mutex::new(HashMap::new()),
            claude_binary: Mutex::new(None),
        }
    }
}
