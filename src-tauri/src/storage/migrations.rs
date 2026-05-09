pub const CREATE_TABLES: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'closed',
    created_at TEXT NOT NULL,
    model TEXT,
    icon_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_settings (
    session_id TEXT PRIMARY KEY,
    auto_approve_read INTEGER NOT NULL DEFAULT 1,
    auto_approve_write INTEGER NOT NULL DEFAULT 0,
    auto_approve_bash INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS terminal_instances (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    shell TEXT,
    cwd TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS changelog_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    headline TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'feature',
    files_changed TEXT NOT NULL DEFAULT '[]',
    turn_index INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
"#;

pub const MIGRATE_SESSION_HISTORY: &[&str] = &[
    "ALTER TABLE sessions ADD COLUMN cli_session_id TEXT",
    "ALTER TABLE sessions ADD COLUMN closed_at TEXT",
];

// Crash-recovery flag. Set to 1 while a session tab is open, cleared during
// graceful shutdown. If any rows still hold 1 on next launch, the previous
// shutdown was unclean and those sessions are candidates for paused-restore.
pub const MIGRATE_SESSION_WAS_OPEN: &[&str] = &[
    "ALTER TABLE sessions ADD COLUMN was_open INTEGER NOT NULL DEFAULT 0",
];

pub const MIGRATE_CHANGELOG_DETAIL: &[&str] = &[
    "ALTER TABLE changelog_entries ADD COLUMN technical_details TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE changelog_entries ADD COLUMN tools_summary TEXT NOT NULL DEFAULT ''",
];

pub const MIGRATE_API_LOGS: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS api_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        session_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        success INTEGER NOT NULL DEFAULT 1,
        error_message TEXT
    )",
];

pub const MIGRATE_TASK_PLANS: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS task_plans (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL UNIQUE,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )",
    "CREATE TABLE IF NOT EXISTS planning_messages (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'conversation',
        attachments_json TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (project_path) REFERENCES task_plans(project_path) ON DELETE CASCADE
    )",
];

/// V2 migration: remove UNIQUE constraint on project_path, add status column.
/// Allows multiple plans per project (active + archived).
pub const MIGRATE_TASK_PLANS_V2: &str = r#"
CREATE TABLE IF NOT EXISTS task_plans_v2 (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO task_plans_v2 (id, project_path, plan_json, status, created_at, updated_at)
    SELECT id, project_path, plan_json, 'active', created_at, updated_at FROM task_plans;
DROP TABLE IF EXISTS planning_messages;
DROP TABLE IF EXISTS task_plans;
ALTER TABLE task_plans_v2 RENAME TO task_plans;
CREATE INDEX IF NOT EXISTS idx_task_plans_project ON task_plans(project_path);
CREATE INDEX IF NOT EXISTS idx_task_plans_status ON task_plans(status);
"#;

pub const MIGRATE_SESSION_MESSAGES: &str = r#"
CREATE TABLE IF NOT EXISTS session_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    thinking_content TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_messages_session
  ON session_messages(session_id);
"#;

pub const MIGRATE_IMPLEMENTATION_GUIDES: &str = r#"
CREATE TABLE IF NOT EXISTS implementation_guides (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_impl_guides_project ON implementation_guides(project_path);
"#;

pub const MIGRATE_SUPER_BRO_OBSERVATIONS: &str = r#"
CREATE TABLE IF NOT EXISTS super_bro_observations (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    text TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_referenced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_super_bro_obs_project ON super_bro_observations(project_path);
"#;

// Self-Drive run state — persists the in-memory run (pinned guide/session ids,
// active blocker, blocker history, run log, phase/fix counters, pause reason)
// so a CodeMantis restart can resurrect it and prompt the user to re-attach a
// fresh Claude Code session and re-run diagnostic evidence. One row per project.
pub const MIGRATE_SELF_DRIVE_RUNS: &str = r#"
CREATE TABLE IF NOT EXISTS self_drive_runs (
    project_path TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_self_drive_runs_updated ON self_drive_runs(updated_at);
"#;

// Preflight System — last-known verification state per (project, capability).
// Cached so the UI can render an at-a-glance "ready / needs setup" status
// without re-running every probe on each launch. Fresh verification still
// runs in the background when the project is opened.
pub const MIGRATE_PREFLIGHT_CAPABILITIES: &str = r#"
CREATE TABLE IF NOT EXISTS preflight_capabilities (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    catalog_ref TEXT,
    state TEXT NOT NULL,
    last_checked INTEGER NOT NULL,
    last_message TEXT,
    last_error TEXT,
    detection_source TEXT,
    user_acknowledged_optional_skip INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preflight_capabilities_project ON preflight_capabilities(project_id);
"#;
