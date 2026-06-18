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

// Phase 2 Session 1: per-session agent discriminator. Default 'claude_code'
// covers every legacy row (the only agent that existed before v1.3.0) so the
// `NOT NULL` is safe. Crash-recovery and the future provider picker dispatch
// on this column. There is no separate `session_history` table — the
// historical-sessions UI reads back from `sessions` filtered on `closed_at`,
// so this single ALTER is sufficient (spec §7 referenced a `session_history`
// table that does not exist in this codebase).
pub const MIGRATE_SESSION_AGENT_ID: &[&str] = &[
    "ALTER TABLE sessions ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'claude_code'",
    "CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)",
];

// Codex compaction-deadlock marker. Codex's upstream remote-compaction endpoint
// times out/drops on a large context (known OpenAI bug, e.g. openai/codex#17392),
// leaving the thread unresumable: `thread/resume` reloads the full context and
// instantly re-triggers the broken compaction. We mark such sessions so a later
// Resume routes to a FRESH thread + carried chat context instead of the doomed
// `thread/resume`. Dedicated table keeps it off the hot `sessions` SELECTs.
pub const MIGRATE_CODEX_COMPACTION_FAILED: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS codex_compaction_failed (
        session_id TEXT PRIMARY KEY,
        marked_at  TEXT NOT NULL
    )",
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

// Duo-Coding — collaborative mentor/primary agent runs.
//
// `duo_runs`: one row per Duo run, linking the primary (sole writer) and the
// read-only Duo/mentor CLI sessions. `config_json` snapshots the DuoConfig used.
// `duo_events`: the chronological event log (turn/verdict/agreement/disagreement/
// dialogue/repair/drift/escalation/decision/nudge) — powers the dashboard and the
// session-history record. FK→duo_runs ON DELETE CASCADE.
// `duo_analyst_snapshots`: the API-LLM analyst's periodic narrative+metrics+series,
// latest replayed on reopen.
pub const MIGRATE_DUO_CODING: &str = r#"
CREATE TABLE IF NOT EXISTS duo_runs (
    id TEXT PRIMARY KEY,
    primary_session_id TEXT NOT NULL,
    duo_session_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    outcome TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_duo_runs_project ON duo_runs(project_path);
CREATE INDEX IF NOT EXISTS idx_duo_runs_created ON duo_runs(created_at);

CREATE TABLE IF NOT EXISTS duo_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES duo_runs(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    diff_stats_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_duo_events_run ON duo_events(run_id, ts);

CREATE TABLE IF NOT EXISTS duo_analyst_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES duo_runs(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    narrative TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    series_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duo_snapshots_run ON duo_analyst_snapshots(run_id, ts);
"#;

// Recall — project-and-cross-project memory layer (see RECALL-SPEC §8).
//
// Deviation from spec: the spec's `project_id INTEGER REFERENCES projects(id)`
// FK is unsatisfiable in CodeMantis (no `projects` table). All tables here
// key on `project_path TEXT`, matching the existing convention used by
// task_plans, super_bro_observations, self_drive_runs, etc.
//
// recall_notes_fts is an FTS5 virtual table with `content=''` (external
// content): rows are inserted/deleted manually in lockstep with
// recall_notes by the indexer (see src/recall/index/ingest.rs).
pub const MIGRATE_RECALL: &str = r#"
CREATE TABLE IF NOT EXISTS recall_vaults (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path    TEXT NOT NULL,
    vault_path      TEXT NOT NULL,
    is_meta         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    last_indexed_at TEXT,
    UNIQUE(project_path, is_meta)
);

CREATE TABLE IF NOT EXISTS recall_notes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_id         INTEGER NOT NULL REFERENCES recall_vaults(id) ON DELETE CASCADE,
    note_id          TEXT NOT NULL,
    type             TEXT NOT NULL,
    title            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active',
    trust            TEXT NOT NULL DEFAULT 'medium',
    severity         TEXT,
    discovered_at    TEXT NOT NULL,
    last_verified_at TEXT NOT NULL,
    file_path        TEXT NOT NULL,
    body_hash        TEXT NOT NULL,
    UNIQUE(vault_id, note_id)
);
CREATE INDEX IF NOT EXISTS idx_recall_notes_vault ON recall_notes(vault_id);
CREATE INDEX IF NOT EXISTS idx_recall_notes_type  ON recall_notes(type);

CREATE TABLE IF NOT EXISTS recall_note_paths (
    note_id     INTEGER NOT NULL REFERENCES recall_notes(id) ON DELETE CASCADE,
    source_path TEXT NOT NULL,
    PRIMARY KEY (note_id, source_path)
);
CREATE INDEX IF NOT EXISTS idx_recall_note_paths_path ON recall_note_paths(source_path);

CREATE TABLE IF NOT EXISTS recall_note_commits (
    note_id      INTEGER NOT NULL REFERENCES recall_notes(id) ON DELETE CASCADE,
    commit_hash  TEXT NOT NULL,
    role         TEXT NOT NULL,
    occurred_at  TEXT NOT NULL,
    PRIMARY KEY (note_id, commit_hash, role)
);

CREATE TABLE IF NOT EXISTS recall_note_links (
    src_note_id  INTEGER NOT NULL REFERENCES recall_notes(id) ON DELETE CASCADE,
    dst_note_id  INTEGER,
    dst_text     TEXT NOT NULL,
    is_meta      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (src_note_id, dst_text)
);
CREATE INDEX IF NOT EXISTS idx_recall_note_links_dst ON recall_note_links(dst_note_id);

CREATE TABLE IF NOT EXISTS recall_note_tags (
    note_id  INTEGER NOT NULL REFERENCES recall_notes(id) ON DELETE CASCADE,
    tag      TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_recall_note_tags_tag ON recall_note_tags(tag);

-- Spec §8 specified `content=''` (external content) but FTS5 forbids
-- regular DELETE on contentless tables, which we need for the
-- delete-then-insert update path and for index drop-and-rebuild.
-- Contentful mode stores a duplicate of title+body inside the FTS5
-- shadow table; for note-sized text the storage cost is negligible
-- (typical note < 4 KB; vault < 10 MB even for large projects).
CREATE VIRTUAL TABLE IF NOT EXISTS recall_notes_fts USING fts5(
    title, body,
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS recall_enrichments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path        TEXT NOT NULL,
    session_id          TEXT,
    occurred_at         TEXT NOT NULL,
    user_prompt_summary TEXT,
    notes_injected      TEXT NOT NULL,
    brief_tokens        INTEGER,
    model_used          TEXT,
    cost_usd            REAL
);
CREATE INDEX IF NOT EXISTS idx_recall_enrichments_project ON recall_enrichments(project_path);

CREATE TABLE IF NOT EXISTS recall_harvests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path    TEXT NOT NULL,
    session_id      TEXT,
    commit_hash     TEXT,
    occurred_at     TEXT NOT NULL,
    note_id         INTEGER REFERENCES recall_notes(id) ON DELETE SET NULL,
    fidelity_status TEXT,
    flagged_tokens  TEXT,
    model_used      TEXT,
    cost_usd        REAL
);
CREATE INDEX IF NOT EXISTS idx_recall_harvests_project ON recall_harvests(project_path);
CREATE INDEX IF NOT EXISTS idx_recall_harvests_commit  ON recall_harvests(commit_hash);

CREATE TABLE IF NOT EXISTS recall_misses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path  TEXT NOT NULL,
    occurred_at   TEXT NOT NULL,
    source_path   TEXT NOT NULL,
    has_note      INTEGER NOT NULL,
    processed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_recall_misses_project ON recall_misses(project_path);
"#;
