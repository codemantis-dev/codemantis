use crate::claude::process::ClaudeProcess;
use crate::storage::Database;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub status: SessionStatus,
    pub created_at: DateTime<Utc>,
    pub model: Option<String>,
    pub icon_index: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
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
    pub database: Arc<Database>,
}

impl AppState {
    pub fn new(database: Database) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            processes: Mutex::new(HashMap::new()),
            claude_binary: Mutex::new(None),
            database: Arc::new(database),
        }
    }
}
