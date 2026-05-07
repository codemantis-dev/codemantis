use crate::claude::approval_server::ApprovalServerState;
use crate::claude::process::ClaudeProcess;
use crate::storage::Database;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Session permission mode, enforced at the Rust approval server level.
///
/// Wire format to the Claude CLI is *camelCase* (`acceptEdits`, `dontAsk`,
/// `bypassPermissions`, `auto`, `plan`, `default`) and is handled by the
/// explicit `classify_permission_mode` (incoming) and `session_mode_to_cli`
/// (outgoing) funnels. Internal Rust↔TS serialization is *kebab-case* via
/// serde — do not confuse the two.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionMode {
    Normal,
    AutoAccept,
    Plan,
    /// CLI's auto-routing mode — the CLI decides per-tool whether to ask.
    /// CodeMantis treats this like Normal for approval-server purposes.
    Auto,
    /// "Don't ask for anything" — behaviorally equivalent to AutoAccept for
    /// CodeMantis's approval server; distinct label only.
    DontAsk,
    /// CLI bypasses all permission checks. The approval hook likely never
    /// fires in this mode; branch returns allow defensively.
    BypassPermissions,
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
    /// Cached "latest published" Claude Code CLI version from npm registry.
    /// 6-hour TTL (see `cli_version::LATEST_VERSION_TTL`).
    pub cli_latest_version_cache: crate::utils::cli_version::LatestVersionCache,
    /// Monotonic counter bumped by the frontend `wake_pong` IPC. The wake
    /// observer reads this before/after emitting `wake-from-sleep` to detect
    /// a dead WKWebView content process — see `crate::lifecycle::wake_observer`.
    pub last_wake_pong: Arc<AtomicU64>,
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
            cli_latest_version_cache: tokio::sync::Mutex::new(None),
            last_wake_pong: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Resolve the thinking-effort override that should be baked into the
    /// `--settings` blob for a newly spawned CLI session. Reads from the
    /// global `settings.json` (`default_thinking_effort`). The `_project_path`
    /// argument is reserved for future per-project overrides — current
    /// behaviour is global. Returns `None` to let the CLI inherit its own
    /// `~/.claude/settings.json` configuration.
    pub async fn thinking_effort_override(&self, _project_path: &str) -> Option<String> {
        let settings = crate::commands::settings::get_settings().ok()?;
        settings
            .default_thinking_effort
            .map(|s| s.to_lowercase())
            .filter(|s| matches!(s.as_str(), "low" | "medium" | "high" | "xhigh"))
    }
}
