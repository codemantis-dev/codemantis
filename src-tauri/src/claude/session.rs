use crate::claude::approval_server::ApprovalServerState;
use crate::claude::process::ClaudeProcess;
use crate::storage::Database;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Session permission mode, enforced at the Rust approval server level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionMode {
    Normal,
    AutoAccept,
    Plan,
}

/// Tracks a pending control_request so we can match the response.
#[derive(Debug, Clone)]
pub enum ControlRequestKind {
    Interrupt,
    SetModel(String),
    Initialize,
    SetPermissionMode(String),
}

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
    /// Maps CodeMantis session_id → CLI's own session_id.
    /// Populated by the message router when it sees the System init event.
    pub cli_session_ids: Mutex<HashMap<String, String>>,
    /// Shared state for the tool approval HTTP server.
    pub approval_state: Arc<ApprovalServerState>,
    /// Port the approval server is listening on.
    pub approval_server_port: Mutex<Option<u16>>,
    /// Session permission modes, enforced by the approval server.
    pub session_modes: Mutex<HashMap<String, SessionMode>>,
    /// Pending control_request tracking: request_id → (session_id, kind).
    pub pending_control_requests: Mutex<HashMap<String, (String, ControlRequestKind)>>,
    /// Cancellation senders for in-flight assistant chat streams.
    pub assistant_cancellation: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
    /// Cached OpenRouter model list with TTL.
    pub openrouter_model_cache: Mutex<Option<(std::time::Instant, Vec<crate::commands::openrouter::OpenRouterModelResult>)>>,
}

impl AppState {
    pub fn new(database: Database) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            processes: Mutex::new(HashMap::new()),
            claude_binary: Mutex::new(None),
            database: Arc::new(database),
            cli_session_ids: Mutex::new(HashMap::new()),
            approval_state: Arc::new(ApprovalServerState::new()),
            approval_server_port: Mutex::new(None),
            session_modes: Mutex::new(HashMap::new()),
            pending_control_requests: Mutex::new(HashMap::new()),
            assistant_cancellation: Mutex::new(HashMap::new()),
            openrouter_model_cache: Mutex::new(None),
        }
    }
}
