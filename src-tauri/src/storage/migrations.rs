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
