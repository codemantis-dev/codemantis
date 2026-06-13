use crate::agents::claude_code::approval_server::ApprovalServerState;
use crate::agents::{AgentId, AgentProcessHandle};
use crate::storage::Database;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Session permission mode. Phase 1 Session 3 unified this with the
/// adapter-agnostic [`crate::agents::SessionMode`] — the legacy local enum
/// (identical variants + kebab-case serde) is gone. `classify_permission_mode`
/// (incoming) and `agents::claude_code::session_mode_to_cli` (outgoing) remain
/// the camelCase ↔ enum funnels for the Claude wire.
pub use crate::agents::SessionMode;

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
    /// Which agent owns this session. Phase 1: always `ClaudeCode` (legacy
    /// rows and `create_session` default to it). Phase 2 makes this
    /// user-selectable via the provider picker + adds the SQLite column.
    pub agent_id: AgentId,
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
    /// Per-session adapter handles. Phase 1 Session 3 generalised this from
    /// `ClaudeProcess` to `Box<dyn AgentProcessHandle>` so non-Claude agents
    /// (Phase 2: Codex) can coexist.
    pub processes: Mutex<HashMap<String, Box<dyn AgentProcessHandle>>>,
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
    pub cli_latest_version_cache: crate::agents::claude_code::cli_version::LatestVersionCache,
    /// Monotonic counter bumped by the frontend `wake_pong` IPC. The wake
    /// observer reads this before/after emitting `wake-from-sleep` to detect
    /// a dead WKWebView content process — see `crate::lifecycle::wake_observer`.
    pub last_wake_pong: Arc<AtomicU64>,
    /// Set to `true` by the wake observer immediately before it calls
    /// `WebviewWindow::reload()` as a last-resort recovery. The frontend
    /// consumes this on boot via `consume_wake_recovery_flag` so it can take
    /// the re-attach path (live CLI processes are still in `processes`)
    /// instead of treating sessions as crashed and routing them through the
    /// Resume list. See `crate::lifecycle::wake_observer`.
    pub wake_recovery_reload: Arc<AtomicBool>,
    /// `true` between `NSWorkspaceWillSleepNotification` and
    /// `NSWorkspaceDidWakeNotification`. The wake observer treats missed
    /// pongs as expected while this is set so a long sleep doesn't escalate
    /// to a reload. macOS-only; non-macOS builds leave this at `false`.
    pub is_system_asleep: Arc<AtomicBool>,
    /// Unix-epoch seconds at which the system last woke (from
    /// `NSWorkspaceDidWakeNotification`). `0` means "never observed."
    /// Used by the wake observer to grant a short post-wake grace window
    /// before counting missed pongs.
    pub last_wake_at_epoch: Arc<AtomicI64>,
    /// Per-project Recall harvest watchers, keyed by project path and
    /// reference-counted by open sessions. Started when the first session
    /// for a project opens (and Recall is enabled) and cancelled when the
    /// last one closes. See `crate::recall::harvester::git_watcher`.
    pub harvest_watchers: Mutex<HashMap<String, crate::recall::harvester::git_watcher::HarvestWatcher>>,
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
            wake_recovery_reload: Arc::new(AtomicBool::new(false)),
            is_system_asleep: Arc::new(AtomicBool::new(false)),
            last_wake_at_epoch: Arc::new(AtomicI64::new(0)),
            harvest_watchers: Mutex::new(HashMap::new()),
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
