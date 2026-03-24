use crate::errors::AppError;
use crate::storage::migrations;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangelogEntryRow {
    pub id: String,
    pub session_id: String,
    pub timestamp: String,
    pub headline: String,
    pub description: String,
    pub category: String,
    pub files_changed: String, // JSON array string
    pub turn_index: i32,
    pub technical_details: String,
    pub tools_summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectChangelogEntryRow {
    pub id: String,
    pub session_id: String,
    pub session_name: String,
    pub timestamp: String,
    pub headline: String,
    pub description: String,
    pub category: String,
    pub files_changed: String, // JSON array string
    pub turn_index: i32,
    pub technical_details: String,
    pub tools_summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiLogRow {
    pub id: String,
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub session_id: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub success: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderCostRow {
    pub provider: String,
    pub cost: f64,
    pub calls: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiCostSummaryRow {
    pub total_cost: f64,
    pub total_calls: u32,
    pub by_provider: Vec<ProviderCostRow>,
}


#[derive(Debug, Clone, Serialize)]
pub struct PersistedSession {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub status: String,
    pub created_at: String,
    pub model: Option<String>,
    pub icon_index: i32,
    pub cli_session_id: Option<String>,
    pub closed_at: Option<String>,
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(db_path)
            .map_err(|e| AppError::DatabaseError(format!("Failed to open database: {}", e)))?;

        log::info!("[database] Opened: {}", db_path);

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| AppError::DatabaseError(format!("Failed to set pragmas: {}", e)))?;

        conn.execute_batch(migrations::CREATE_TABLES)
            .map_err(|e| AppError::DatabaseError(format!("Failed to create tables: {}", e)))?;

        // Run migrations (safe to re-run — ignores "duplicate column" errors)
        for sql in migrations::MIGRATE_SESSION_HISTORY {
            let _ = conn.execute_batch(sql); // ignore if column already exists
        }

        for sql in migrations::MIGRATE_CHANGELOG_DETAIL {
            let _ = conn.execute_batch(sql);
        }

        for sql in migrations::MIGRATE_API_LOGS {
            let _ = conn.execute_batch(sql);
        }

        for sql in migrations::MIGRATE_TASK_PLANS {
            let _ = conn.execute_batch(sql);
        }

        // V2 migration: add status column, remove UNIQUE constraint on project_path.
        // Only run if task_plans lacks the 'status' column.
        let needs_v2_migration = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('task_plans') WHERE name='status'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            == 0;
        if needs_v2_migration {
            log::info!("[database] Running task_plans V2 migration (add status column)");
            let _ = conn.execute_batch(migrations::MIGRATE_TASK_PLANS_V2);
        }

        // Implementation guides table
        let _ = conn.execute_batch(migrations::MIGRATE_IMPLEMENTATION_GUIDES);

        // Always drop planning_messages if it exists.
        // V1 migration (MIGRATE_TASK_PLANS) recreates it on every startup via
        // CREATE TABLE IF NOT EXISTS, but V2 dropped it and changed task_plans
        // schema (project_path is no longer UNIQUE), causing FK mismatch on DELETE.
        // planning_messages is unused — conversation is stored inside plan_json.
        let _ = conn.execute_batch("DROP TABLE IF EXISTS planning_messages");


        // Migrate api_logs: remove FOREIGN KEY constraint if present.
        // API assistant sessions use frontend-generated IDs that are not in the sessions table,
        // so the FK constraint silently rejects all API provider log inserts.
        let needs_fk_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='api_logs'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| sql.contains("FOREIGN KEY"))
            .unwrap_or(false);

        if needs_fk_migration {
            log::info!("[database] Migrating api_logs to remove FOREIGN KEY constraint");
            let _ = conn.execute_batch(
                "CREATE TABLE api_logs_new (
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
                );
                INSERT INTO api_logs_new SELECT * FROM api_logs;
                DROP TABLE api_logs;
                ALTER TABLE api_logs_new RENAME TO api_logs;"
            );
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_session(
        &self,
        id: &str,
        name: &str,
        project_path: &str,
        status: &str,
        created_at: &str,
        model: Option<&str>,
        icon_index: i32,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, name, project_path, status, created_at, model, icon_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, name, project_path, status, created_at, model, icon_index],
        )
        .map_err(|e| AppError::DatabaseError(format!("Insert session failed: {}", e)))?;
        Ok(())
    }

    pub fn update_session_status(&self, id: &str, status: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "UPDATE sessions SET status = ?1 WHERE id = ?2",
            rusqlite::params![status, id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Update session status failed: {}", e)))?;
        Ok(())
    }

    pub fn rename_session(&self, id: &str, name: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "UPDATE sessions SET name = ?1 WHERE id = ?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Rename session failed: {}", e)))?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<PersistedSession>, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let mut stmt = conn
            .prepare("SELECT id, name, project_path, status, created_at, model, icon_index, cli_session_id, closed_at FROM sessions ORDER BY created_at DESC")
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(PersistedSession {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    project_path: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    model: row.get(5)?,
                    icon_index: row.get(6)?,
                    cli_session_id: row.get(7)?,
                    closed_at: row.get(8)?,
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(sessions)
    }

    pub fn delete_session(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "DELETE FROM sessions WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Delete session failed: {}", e)))?;
        Ok(())
    }

    pub fn get_next_icon_index(&self) -> Result<i32, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .map_err(|e| AppError::DatabaseError(format!("Count failed: {}", e)))?;
        Ok(count % 10)
    }

    pub fn insert_changelog_entry(
        &self,
        id: &str,
        session_id: &str,
        timestamp: &str,
        headline: &str,
        description: &str,
        category: &str,
        files_changed: &str,
        turn_index: i32,
        technical_details: &str,
        tools_summary: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "INSERT INTO changelog_entries (id, session_id, timestamp, headline, description, category, files_changed, turn_index, technical_details, tools_summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![id, session_id, timestamp, headline, description, category, files_changed, turn_index, technical_details, tools_summary],
        )
        .map_err(|e| AppError::DatabaseError(format!("Insert changelog entry failed: {}", e)))?;
        Ok(())
    }

    pub fn list_changelog_entries(&self, session_id: &str) -> Result<Vec<ChangelogEntryRow>, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let mut stmt = conn
            .prepare("SELECT id, session_id, timestamp, headline, description, category, files_changed, turn_index, technical_details, tools_summary FROM changelog_entries WHERE session_id = ?1 ORDER BY timestamp DESC")
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok(ChangelogEntryRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    headline: row.get(3)?,
                    description: row.get(4)?,
                    category: row.get(5)?,
                    files_changed: row.get(6)?,
                    turn_index: row.get(7)?,
                    technical_details: row.get::<_, String>(8).unwrap_or_default(),
                    tools_summary: row.get::<_, String>(9).unwrap_or_default(),
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(entries)
    }

    pub fn delete_changelog_entry(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "DELETE FROM changelog_entries WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Delete changelog entry failed: {}", e)))?;
        Ok(())
    }

    pub fn list_changelog_entries_by_project(&self, project_path: &str) -> Result<Vec<ProjectChangelogEntryRow>, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let mut stmt = conn
            .prepare(
                "SELECT ce.id, ce.session_id, s.name, ce.timestamp, ce.headline, ce.description, ce.category, ce.files_changed, ce.turn_index, ce.technical_details, ce.tools_summary \
                 FROM changelog_entries ce \
                 JOIN sessions s ON ce.session_id = s.id \
                 WHERE s.project_path = ?1 \
                 ORDER BY ce.timestamp DESC"
            )
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map(rusqlite::params![project_path], |row| {
                Ok(ProjectChangelogEntryRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    session_name: row.get(2)?,
                    timestamp: row.get(3)?,
                    headline: row.get(4)?,
                    description: row.get(5)?,
                    category: row.get(6)?,
                    files_changed: row.get(7)?,
                    turn_index: row.get(8)?,
                    technical_details: row.get::<_, String>(9).unwrap_or_default(),
                    tools_summary: row.get::<_, String>(10).unwrap_or_default(),
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(entries)
    }

    pub fn close_session_with_details(
        &self,
        id: &str,
        cli_session_id: Option<&str>,
        model: Option<&str>,
        closed_at: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "UPDATE sessions SET status = 'closed', cli_session_id = ?1, model = COALESCE(?2, model), closed_at = ?3 WHERE id = ?4",
            rusqlite::params![cli_session_id, model, closed_at, id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Close session with details failed: {}", e)))?;
        Ok(())
    }

    pub fn list_closed_sessions_for_project(
        &self,
        project_path: &str,
        limit: i32,
    ) -> Result<Vec<PersistedSession>, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, project_path, status, created_at, model, icon_index, cli_session_id, closed_at \
                 FROM sessions WHERE project_path = ?1 AND status = 'closed' AND cli_session_id IS NOT NULL \
                 ORDER BY closed_at DESC LIMIT ?2"
            )
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map(rusqlite::params![project_path, limit], |row| {
                Ok(PersistedSession {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    project_path: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    model: row.get(5)?,
                    icon_index: row.get(6)?,
                    cli_session_id: row.get(7)?,
                    closed_at: row.get(8)?,
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(sessions)
    }

    pub fn insert_api_log(
        &self,
        id: &str,
        timestamp: &str,
        provider: &str,
        model: &str,
        session_id: &str,
        input_tokens: u32,
        output_tokens: u32,
        cost_usd: f64,
        success: bool,
        error_message: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "INSERT INTO api_logs (id, timestamp, provider, model, session_id, input_tokens, output_tokens, cost_usd, success, error_message) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![id, timestamp, provider, model, session_id, input_tokens, output_tokens, cost_usd, success as i32, error_message],
        )
        .map_err(|e| AppError::DatabaseError(format!("Insert api_log failed: {}", e)))?;
        Ok(())
    }

    pub fn list_api_logs(&self) -> Result<Vec<ApiLogRow>, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let mut stmt = conn
            .prepare("SELECT id, timestamp, provider, model, session_id, input_tokens, output_tokens, cost_usd, success, error_message FROM api_logs ORDER BY timestamp DESC")
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ApiLogRow {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    provider: row.get(2)?,
                    model: row.get(3)?,
                    session_id: row.get(4)?,
                    input_tokens: row.get(5)?,
                    output_tokens: row.get(6)?,
                    cost_usd: row.get(7)?,
                    success: row.get::<_, i32>(8)? != 0,
                    error_message: row.get(9)?,
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(entries)
    }

    pub fn delete_old_api_logs(&self, max_age_days: u32) -> Result<u32, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age_days as i64);
        let cutoff_str = cutoff.to_rfc3339();
        let deleted = conn
            .execute(
                "DELETE FROM api_logs WHERE timestamp < ?1",
                rusqlite::params![cutoff_str],
            )
            .map_err(|e| AppError::DatabaseError(format!("Delete old api_logs failed: {}", e)))?;
        Ok(deleted as u32)
    }

    pub fn get_api_cost_summary(&self) -> Result<ApiCostSummaryRow, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;

        let total_cost: f64 = conn
            .query_row("SELECT COALESCE(SUM(cost_usd), 0.0) FROM api_logs", [], |row| row.get(0))
            .map_err(|e| AppError::DatabaseError(format!("Sum cost failed: {}", e)))?;

        let total_calls: i64 = conn
            .query_row("SELECT COUNT(*) FROM api_logs", [], |row| row.get(0))
            .map_err(|e| AppError::DatabaseError(format!("Count failed: {}", e)))?;

        let mut stmt = conn
            .prepare("SELECT provider, COALESCE(SUM(cost_usd), 0.0), COUNT(*) FROM api_logs GROUP BY provider ORDER BY provider")
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ProviderCostRow {
                    provider: row.get(0)?,
                    cost: row.get(1)?,
                    calls: row.get::<_, i64>(2)? as u32,
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut by_provider = Vec::new();
        for row in rows {
            by_provider.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }

        Ok(ApiCostSummaryRow {
            total_cost,
            total_calls: total_calls as u32,
            by_provider,
        })
    }

    #[allow(dead_code)]
    pub fn update_session_model(&self, id: &str, model: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        conn.execute(
            "UPDATE sessions SET model = ?1 WHERE id = ?2",
            rusqlite::params![model, id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Update model failed: {}", e)))?;
        Ok(())
    }

    pub fn insert_task_plan(&self, id: &str, project_path: &str, plan_json: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "INSERT INTO task_plans (id, project_path, plan_json, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'active', datetime('now'), datetime('now'))",
            rusqlite::params![id, project_path, plan_json],
        ).map_err(|e| AppError::DatabaseError(format!("Insert task plan failed: {}", e)))?;
        Ok(())
    }

    pub fn get_task_plan(&self, project_path: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        let result = conn.query_row(
            "SELECT plan_json FROM task_plans WHERE project_path = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            rusqlite::params![project_path],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(json) => Ok(Some(json)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::DatabaseError(format!("Get task plan failed: {}", e))),
        }
    }

    pub fn get_active_plan_id(&self, project_path: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        let result = conn.query_row(
            "SELECT id FROM task_plans WHERE project_path = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            rusqlite::params![project_path],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::DatabaseError(format!("Get active plan ID failed: {}", e))),
        }
    }

    pub fn update_task_plan(&self, project_path: &str, plan_json: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "UPDATE task_plans SET plan_json = ?1, updated_at = datetime('now') WHERE project_path = ?2 AND status = 'active'",
            rusqlite::params![plan_json, project_path],
        ).map_err(|e| AppError::DatabaseError(format!("Update task plan failed: {}", e)))?;
        Ok(())
    }

    pub fn delete_task_plan_by_id(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "DELETE FROM task_plans WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| AppError::DatabaseError(format!("Delete task plan failed: {}", e)))?;
        Ok(())
    }

    pub fn archive_task_plan(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "UPDATE task_plans SET status = 'archived', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| AppError::DatabaseError(format!("Archive task plan failed: {}", e)))?;
        Ok(())
    }

    // ── Implementation Guides ───────────────────────────────────────────

    pub fn insert_guide(&self, id: &str, project_path: &str, data_json: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "INSERT INTO implementation_guides (id, project_path, data_json, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now'))",
            rusqlite::params![id, project_path, data_json],
        ).map_err(|e| AppError::DatabaseError(format!("Insert guide failed: {}", e)))?;
        Ok(())
    }

    pub fn get_guide_for_project(&self, project_path: &str) -> Result<Option<(String, String)>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        let result = conn.query_row(
            "SELECT id, data_json FROM implementation_guides WHERE project_path = ?1 ORDER BY updated_at DESC LIMIT 1",
            rusqlite::params![project_path],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        );
        match result {
            Ok(pair) => Ok(Some(pair)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::DatabaseError(format!("Get guide failed: {}", e))),
        }
    }

    pub fn update_guide(&self, id: &str, data_json: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "UPDATE implementation_guides SET data_json = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![data_json, id],
        ).map_err(|e| AppError::DatabaseError(format!("Update guide failed: {}", e)))?;
        Ok(())
    }

    pub fn delete_guide(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "DELETE FROM implementation_guides WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| AppError::DatabaseError(format!("Delete guide failed: {}", e)))?;
        Ok(())
    }

    pub fn delete_guides_for_project(&self, project_path: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "DELETE FROM implementation_guides WHERE project_path = ?1",
            rusqlite::params![project_path],
        ).map_err(|e| AppError::DatabaseError(format!("Delete guides for project failed: {}", e)))?;
        Ok(())
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_list_sessions() {
        let db = Database::new(":memory:").unwrap();

        db.insert_session("s1", "Test Session", "/tmp/test", "connected", "2026-01-01T00:00:00Z", None, 0)
            .unwrap();

        let sessions = db.list_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "s1");
        assert_eq!(sessions[0].name, "Test Session");
    }

    #[test]
    fn test_update_status() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0)
            .unwrap();

        db.update_session_status("s1", "closed").unwrap();

        let sessions = db.list_sessions().unwrap();
        assert_eq!(sessions[0].status, "closed");
    }

    #[test]
    fn test_rename_session() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Old Name", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0)
            .unwrap();

        db.rename_session("s1", "New Name").unwrap();

        let sessions = db.list_sessions().unwrap();
        assert_eq!(sessions[0].name, "New Name");
    }

    #[test]
    fn test_delete_session() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0)
            .unwrap();

        db.delete_session("s1").unwrap();

        let sessions = db.list_sessions().unwrap();
        assert_eq!(sessions.len(), 0);
    }

    #[test]
    fn test_icon_index() {
        let db = Database::new(":memory:").unwrap();
        assert_eq!(db.get_next_icon_index().unwrap(), 0);

        db.insert_session("s1", "Test1", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0)
            .unwrap();
        assert_eq!(db.get_next_icon_index().unwrap(), 1);
    }

    #[test]
    fn test_list_changelog_entries_by_project() {
        let db = Database::new(":memory:").unwrap();

        // Two sessions in the same project
        db.insert_session("s1", "Session A", "/project", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.insert_session("s2", "Session B", "/project", "connected", "2026-01-02T00:00:00Z", None, 1).unwrap();
        // One session in a different project
        db.insert_session("s3", "Other", "/other", "connected", "2026-01-03T00:00:00Z", None, 2).unwrap();

        db.insert_changelog_entry("e1", "s1", "2026-01-01T01:00:00Z", "First", "desc1", "feature", "[]", 0, "", "").unwrap();
        db.insert_changelog_entry("e2", "s2", "2026-01-02T01:00:00Z", "Second", "desc2", "bugfix", "[]", 0, "", "").unwrap();
        db.insert_changelog_entry("e3", "s3", "2026-01-03T01:00:00Z", "Other project", "desc3", "docs", "[]", 0, "", "").unwrap();

        let entries = db.list_changelog_entries_by_project("/project").unwrap();
        assert_eq!(entries.len(), 2);
        // Newest first
        assert_eq!(entries[0].id, "e2");
        assert_eq!(entries[0].session_name, "Session B");
        assert_eq!(entries[1].id, "e1");
        assert_eq!(entries[1].session_name, "Session A");

        // Other project only has one
        let other = db.list_changelog_entries_by_project("/other").unwrap();
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].id, "e3");
    }
}
