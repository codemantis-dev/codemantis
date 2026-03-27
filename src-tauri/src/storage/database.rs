use crate::errors::AppError;
use crate::storage::migrations;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
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


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub thinking_content: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationRow {
    pub id: String,
    pub project_path: String,
    pub text: String,
    pub category: String,
    pub created_at: String,
    pub last_referenced_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessageSearchResult {
    pub session_id: String,
    pub session_name: String,
    pub message_id: String,
    pub role: String,
    pub content_snippet: String,
    pub timestamp: String,
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
    pub has_stored_messages: bool,
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

        // Session messages table
        let _ = conn.execute_batch(migrations::MIGRATE_SESSION_MESSAGES);

        // Implementation guides table
        let _ = conn.execute_batch(migrations::MIGRATE_IMPLEMENTATION_GUIDES);

        // Super-Bro observations table
        let _ = conn.execute_batch(migrations::MIGRATE_SUPER_BRO_OBSERVATIONS);

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
            .prepare(
                "SELECT s.id, s.name, s.project_path, s.status, s.created_at, s.model, s.icon_index, s.cli_session_id, s.closed_at, \
                 EXISTS(SELECT 1 FROM session_messages sm WHERE sm.session_id = s.id) \
                 FROM sessions s ORDER BY s.created_at DESC"
            )
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
                    has_stored_messages: row.get::<_, i32>(9)? != 0,
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
                "SELECT s.id, s.name, s.project_path, s.status, s.created_at, s.model, s.icon_index, s.cli_session_id, s.closed_at, \
                 EXISTS(SELECT 1 FROM session_messages sm WHERE sm.session_id = s.id) \
                 FROM sessions s WHERE s.project_path = ?1 AND s.status = 'closed' AND s.cli_session_id IS NOT NULL \
                 ORDER BY s.closed_at DESC LIMIT ?2"
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
                    has_stored_messages: row.get::<_, i32>(9)? != 0,
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

    // ── Session Messages ──────────────────────────────────────────────

    pub fn save_session_messages(
        &self,
        session_id: &str,
        messages: &[SessionMessageRow],
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let tx = conn.unchecked_transaction().map_err(|e| {
            AppError::DatabaseError(format!("Begin transaction failed: {}", e))
        })?;
        // Delete existing messages for idempotent re-save
        tx.execute(
            "DELETE FROM session_messages WHERE session_id = ?1",
            rusqlite::params![session_id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Delete old messages failed: {}", e)))?;

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO session_messages (id, session_id, role, content, timestamp, thinking_content, sort_order) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .map_err(|e| AppError::DatabaseError(format!("Prepare insert failed: {}", e)))?;

            for msg in messages {
                stmt.execute(rusqlite::params![
                    msg.id,
                    session_id,
                    msg.role,
                    msg.content,
                    msg.timestamp,
                    msg.thinking_content,
                    msg.sort_order,
                ])
                .map_err(|e| AppError::DatabaseError(format!("Insert message failed: {}", e)))?;
            }
        }

        tx.commit()
            .map_err(|e| AppError::DatabaseError(format!("Commit failed: {}", e)))?;
        Ok(())
    }

    pub fn load_session_messages(
        &self,
        session_id: &str,
    ) -> Result<Vec<SessionMessageRow>, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, timestamp, thinking_content, sort_order \
                 FROM session_messages WHERE session_id = ?1 ORDER BY sort_order ASC",
            )
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok(SessionMessageRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    timestamp: row.get(4)?,
                    thinking_content: row.get(5)?,
                    sort_order: row.get(6)?,
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut messages = Vec::new();
        for row in rows {
            messages.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(messages)
    }

    pub fn session_has_messages(&self, session_id: &str) -> Result<bool, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM session_messages WHERE session_id = ?1)",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;
        Ok(exists)
    }

    pub fn delete_expired_session_messages(&self, retention_days: u32) -> Result<u32, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let cutoff_str = cutoff.to_rfc3339();
        let deleted = conn
            .execute(
                "DELETE FROM session_messages WHERE session_id IN \
                 (SELECT id FROM sessions WHERE closed_at IS NOT NULL AND closed_at < ?1)",
                rusqlite::params![cutoff_str],
            )
            .map_err(|e| AppError::DatabaseError(format!("Delete expired messages failed: {}", e)))?;
        Ok(deleted as u32)
    }

    pub fn search_session_messages(
        &self,
        project_path: &str,
        query: &str,
        limit: i32,
    ) -> Result<Vec<SessionMessageSearchResult>, AppError> {
        let conn = self.conn.lock().map_err(|e| {
            AppError::DatabaseError(format!("Lock poisoned: {}", e))
        })?;
        let like_pattern = format!(
            "%{}%",
            query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        );
        let mut stmt = conn
            .prepare(
                "SELECT sm.session_id, s.name, sm.id, sm.role, sm.content, sm.timestamp \
                 FROM session_messages sm \
                 JOIN sessions s ON sm.session_id = s.id \
                 WHERE s.project_path = ?1 AND s.status = 'closed' \
                   AND sm.content LIKE ?2 ESCAPE '\\' \
                 ORDER BY sm.timestamp DESC LIMIT ?3",
            )
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map(rusqlite::params![project_path, like_pattern, limit], |row| {
                let content: String = row.get(4)?;
                let snippet = if content.len() > 200 {
                    format!("{}...", &content[..200])
                } else {
                    content
                };
                Ok(SessionMessageSearchResult {
                    session_id: row.get(0)?,
                    session_name: row.get(1)?,
                    message_id: row.get(2)?,
                    role: row.get(3)?,
                    content_snippet: snippet,
                    timestamp: row.get(5)?,
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(results)
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

    // ── Super-Bro Observations ───────────────────────────────────────────

    pub fn insert_observation(
        &self,
        id: &str,
        project_path: &str,
        text: &str,
        category: &str,
        created_at: &str,
        last_referenced_at: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "INSERT OR REPLACE INTO super_bro_observations (id, project_path, text, category, created_at, last_referenced_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, project_path, text, category, created_at, last_referenced_at],
        ).map_err(|e| AppError::DatabaseError(format!("Insert observation failed: {}", e)))?;
        Ok(())
    }

    pub fn list_observations(&self, project_path: &str) -> Result<Vec<ObservationRow>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_path, text, category, created_at, last_referenced_at FROM super_bro_observations WHERE project_path = ?1 ORDER BY last_referenced_at DESC LIMIT 50"
            )
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let rows = stmt
            .query_map(rusqlite::params![project_path], |row| {
                Ok(ObservationRow {
                    id: row.get(0)?,
                    project_path: row.get(1)?,
                    text: row.get(2)?,
                    category: row.get(3)?,
                    created_at: row.get(4)?,
                    last_referenced_at: row.get(5)?,
                })
            })
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let mut observations = Vec::new();
        for row in rows {
            observations.push(
                row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?,
            );
        }
        Ok(observations)
    }

    pub fn delete_observation(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::DatabaseError(format!("Lock poisoned: {}", e)))?;
        conn.execute(
            "DELETE FROM super_bro_observations WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| AppError::DatabaseError(format!("Delete observation failed: {}", e)))?;
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

    // ── Session Messages ──

    fn make_test_messages(session_id: &str, count: usize) -> Vec<SessionMessageRow> {
        (0..count)
            .map(|i| SessionMessageRow {
                id: format!("msg-{}-{}", session_id, i),
                session_id: session_id.to_string(),
                role: if i % 2 == 0 { "user".to_string() } else { "assistant".to_string() },
                content: format!("Message {} content", i),
                timestamp: format!("2026-01-01T{:02}:00:00Z", i),
                thinking_content: if i % 2 == 1 { Some("thinking...".to_string()) } else { None },
                sort_order: i as i32,
            })
            .collect()
    }

    #[test]
    fn test_save_and_load_session_messages() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();

        let messages = make_test_messages("s1", 5);
        db.save_session_messages("s1", &messages).unwrap();

        let loaded = db.load_session_messages("s1").unwrap();
        assert_eq!(loaded.len(), 5);
        assert_eq!(loaded[0].id, "msg-s1-0");
        assert_eq!(loaded[0].role, "user");
        assert_eq!(loaded[4].id, "msg-s1-4");
        assert_eq!(loaded[1].thinking_content, Some("thinking...".to_string()));
        assert_eq!(loaded[0].thinking_content, None);
    }

    #[test]
    fn test_save_messages_overwrite() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();

        let messages1 = make_test_messages("s1", 3);
        db.save_session_messages("s1", &messages1).unwrap();

        let messages2 = make_test_messages("s1", 2);
        db.save_session_messages("s1", &messages2).unwrap();

        let loaded = db.load_session_messages("s1").unwrap();
        assert_eq!(loaded.len(), 2); // overwritten, not appended
    }

    #[test]
    fn test_session_messages_cascade_delete() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();

        let messages = make_test_messages("s1", 5);
        db.save_session_messages("s1", &messages).unwrap();
        assert!(db.session_has_messages("s1").unwrap());

        db.delete_session("s1").unwrap();
        assert!(!db.session_has_messages("s1").unwrap());
        assert_eq!(db.load_session_messages("s1").unwrap().len(), 0);
    }

    #[test]
    fn test_session_has_messages() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();

        assert!(!db.session_has_messages("s1").unwrap());

        let messages = make_test_messages("s1", 1);
        db.save_session_messages("s1", &messages).unwrap();

        assert!(db.session_has_messages("s1").unwrap());
    }

    #[test]
    fn test_has_stored_messages_in_listing() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "With msgs", "/project", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.insert_session("s2", "Without msgs", "/project", "connected", "2026-01-02T00:00:00Z", None, 1).unwrap();

        let messages = make_test_messages("s1", 2);
        db.save_session_messages("s1", &messages).unwrap();

        let sessions = db.list_sessions().unwrap();
        let s1 = sessions.iter().find(|s| s.id == "s1").unwrap();
        let s2 = sessions.iter().find(|s| s.id == "s2").unwrap();
        assert!(s1.has_stored_messages);
        assert!(!s2.has_stored_messages);
    }

    #[test]
    fn test_search_session_messages() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Auth session", "/project", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.close_session_with_details("s1", Some("cli1"), None, "2026-01-01T01:00:00Z").unwrap();
        db.insert_session("s2", "Other session", "/project", "closed", "2026-01-02T00:00:00Z", None, 1).unwrap();
        db.close_session_with_details("s2", Some("cli2"), None, "2026-01-02T01:00:00Z").unwrap();

        let msgs1 = vec![
            SessionMessageRow { id: "m1".into(), session_id: "s1".into(), role: "user".into(), content: "Fix the authentication bug".into(), timestamp: "2026-01-01T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
            SessionMessageRow { id: "m2".into(), session_id: "s1".into(), role: "assistant".into(), content: "I'll fix the auth flow".into(), timestamp: "2026-01-01T00:02:00Z".into(), thinking_content: None, sort_order: 1 },
        ];
        db.save_session_messages("s1", &msgs1).unwrap();

        let msgs2 = vec![
            SessionMessageRow { id: "m3".into(), session_id: "s2".into(), role: "user".into(), content: "Add a new button".into(), timestamp: "2026-01-02T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
        ];
        db.save_session_messages("s2", &msgs2).unwrap();

        // Search for "auth" — should find messages in s1 only
        let results = db.search_session_messages("/project", "auth", 50).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.session_id == "s1"));

        // Search for "button" — should find in s2 only
        let results = db.search_session_messages("/project", "button", 50).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_id, "s2");

        // Search for nonexistent term
        let results = db.search_session_messages("/project", "xyznotfound", 50).unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_save_empty_messages_list() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();

        // Save 3 messages first
        let messages = make_test_messages("s1", 3);
        db.save_session_messages("s1", &messages).unwrap();
        assert_eq!(db.load_session_messages("s1").unwrap().len(), 3);

        // Saving empty list clears all messages
        db.save_session_messages("s1", &[]).unwrap();
        assert_eq!(db.load_session_messages("s1").unwrap().len(), 0);
        assert!(!db.session_has_messages("s1").unwrap());
    }

    #[test]
    fn test_load_messages_preserves_sort_order() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();

        // Insert messages with non-sequential sort_orders
        let messages = vec![
            SessionMessageRow { id: "m-c".into(), session_id: "s1".into(), role: "user".into(), content: "Third".into(), timestamp: "2026-01-01T00:03:00Z".into(), thinking_content: None, sort_order: 20 },
            SessionMessageRow { id: "m-a".into(), session_id: "s1".into(), role: "user".into(), content: "First".into(), timestamp: "2026-01-01T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
            SessionMessageRow { id: "m-b".into(), session_id: "s1".into(), role: "assistant".into(), content: "Second".into(), timestamp: "2026-01-01T00:02:00Z".into(), thinking_content: Some("I'm thinking".into()), sort_order: 10 },
        ];
        db.save_session_messages("s1", &messages).unwrap();

        let loaded = db.load_session_messages("s1").unwrap();
        assert_eq!(loaded.len(), 3);
        // Should be ordered by sort_order ASC, not by insertion order
        assert_eq!(loaded[0].content, "First");
        assert_eq!(loaded[1].content, "Second");
        assert_eq!(loaded[2].content, "Third");
        // Verify thinking_content preserved
        assert_eq!(loaded[1].thinking_content, Some("I'm thinking".to_string()));
    }

    #[test]
    fn test_delete_expired_session_messages() {
        let db = Database::new(":memory:").unwrap();

        // Old session — closed 60 days ago
        db.insert_session("old", "Old Session", "/project", "closed", "2025-01-01T00:00:00Z", None, 0).unwrap();
        let old_closed = (chrono::Utc::now() - chrono::Duration::days(60)).to_rfc3339();
        db.close_session_with_details("old", Some("cli-old"), None, &old_closed).unwrap();

        // Recent session — closed 5 days ago
        db.insert_session("recent", "Recent Session", "/project", "closed", "2026-01-01T00:00:00Z", None, 1).unwrap();
        let recent_closed = (chrono::Utc::now() - chrono::Duration::days(5)).to_rfc3339();
        db.close_session_with_details("recent", Some("cli-recent"), None, &recent_closed).unwrap();

        // Active session — no closed_at
        db.insert_session("active", "Active Session", "/project", "connected", "2026-01-01T00:00:00Z", None, 2).unwrap();

        // Save messages for all three
        db.save_session_messages("old", &make_test_messages("old", 3)).unwrap();
        db.save_session_messages("recent", &make_test_messages("recent", 4)).unwrap();
        db.save_session_messages("active", &make_test_messages("active", 2)).unwrap();

        // Delete messages older than 30 days
        let deleted = db.delete_expired_session_messages(30).unwrap();
        assert_eq!(deleted, 3); // 3 messages from "old" session

        // Old session messages gone
        assert!(!db.session_has_messages("old").unwrap());
        // Recent session messages preserved
        assert!(db.session_has_messages("recent").unwrap());
        assert_eq!(db.load_session_messages("recent").unwrap().len(), 4);
        // Active session messages preserved (no closed_at)
        assert!(db.session_has_messages("active").unwrap());
        assert_eq!(db.load_session_messages("active").unwrap().len(), 2);
    }

    #[test]
    fn test_delete_expired_keeps_all_when_none_expired() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Recent", "/project", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        let closed_at = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
        db.close_session_with_details("s1", Some("cli1"), None, &closed_at).unwrap();
        db.save_session_messages("s1", &make_test_messages("s1", 5)).unwrap();

        let deleted = db.delete_expired_session_messages(30).unwrap();
        assert_eq!(deleted, 0);
        assert_eq!(db.load_session_messages("s1").unwrap().len(), 5);
    }

    #[test]
    fn test_search_scoped_to_project() {
        let db = Database::new(":memory:").unwrap();

        // Session in project A
        db.insert_session("s1", "Project A", "/project-a", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.close_session_with_details("s1", Some("cli1"), None, "2026-01-01T01:00:00Z").unwrap();
        let msgs = vec![
            SessionMessageRow { id: "m1".into(), session_id: "s1".into(), role: "user".into(), content: "deploy the thing".into(), timestamp: "2026-01-01T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
        ];
        db.save_session_messages("s1", &msgs).unwrap();

        // Session in project B with same content
        db.insert_session("s2", "Project B", "/project-b", "closed", "2026-01-02T00:00:00Z", None, 1).unwrap();
        db.close_session_with_details("s2", Some("cli2"), None, "2026-01-02T01:00:00Z").unwrap();
        let msgs2 = vec![
            SessionMessageRow { id: "m2".into(), session_id: "s2".into(), role: "user".into(), content: "deploy the thing too".into(), timestamp: "2026-01-02T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
        ];
        db.save_session_messages("s2", &msgs2).unwrap();

        // Search in project A only
        let results = db.search_session_messages("/project-a", "deploy", 50).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_id, "s1");

        // Search in project B only
        let results = db.search_session_messages("/project-b", "deploy", 50).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_id, "s2");
    }

    #[test]
    fn test_search_only_finds_closed_sessions() {
        let db = Database::new(":memory:").unwrap();

        // Active session (not closed)
        db.insert_session("s1", "Active", "/project", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();
        let msgs = vec![
            SessionMessageRow { id: "m1".into(), session_id: "s1".into(), role: "user".into(), content: "secret keyword".into(), timestamp: "2026-01-01T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
        ];
        db.save_session_messages("s1", &msgs).unwrap();

        // Search should NOT find messages from active sessions
        let results = db.search_session_messages("/project", "secret", 50).unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_search_respects_limit() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Session", "/project", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.close_session_with_details("s1", Some("cli1"), None, "2026-01-01T01:00:00Z").unwrap();

        let msgs: Vec<SessionMessageRow> = (0..10)
            .map(|i| SessionMessageRow {
                id: format!("m{}", i),
                session_id: "s1".into(),
                role: "user".into(),
                content: format!("matching keyword {}", i),
                timestamp: format!("2026-01-01T00:{:02}:00Z", i),
                thinking_content: None,
                sort_order: i,
            })
            .collect();
        db.save_session_messages("s1", &msgs).unwrap();

        let results = db.search_session_messages("/project", "keyword", 3).unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_search_returns_session_name() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "My Named Session", "/project", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.close_session_with_details("s1", Some("cli1"), None, "2026-01-01T01:00:00Z").unwrap();
        let msgs = vec![
            SessionMessageRow { id: "m1".into(), session_id: "s1".into(), role: "user".into(), content: "findme".into(), timestamp: "2026-01-01T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
        ];
        db.save_session_messages("s1", &msgs).unwrap();

        let results = db.search_session_messages("/project", "findme", 50).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_name, "My Named Session");
        assert_eq!(results[0].role, "user");
    }

    #[test]
    fn test_search_truncates_long_content_to_snippet() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Session", "/project", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.close_session_with_details("s1", Some("cli1"), None, "2026-01-01T01:00:00Z").unwrap();

        let long_content = "x".repeat(500);
        let msgs = vec![
            SessionMessageRow { id: "m1".into(), session_id: "s1".into(), role: "assistant".into(), content: long_content, timestamp: "2026-01-01T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
        ];
        db.save_session_messages("s1", &msgs).unwrap();

        let results = db.search_session_messages("/project", "xxx", 50).unwrap();
        assert_eq!(results.len(), 1);
        // Snippet should be truncated to ~200 chars + "..."
        assert!(results[0].content_snippet.len() <= 204);
        assert!(results[0].content_snippet.ends_with("..."));
    }

    #[test]
    fn test_search_escapes_sql_wildcards() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Session", "/project", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.close_session_with_details("s1", Some("cli1"), None, "2026-01-01T01:00:00Z").unwrap();

        let msgs = vec![
            SessionMessageRow { id: "m1".into(), session_id: "s1".into(), role: "user".into(), content: "100% complete".into(), timestamp: "2026-01-01T00:01:00Z".into(), thinking_content: None, sort_order: 0 },
            SessionMessageRow { id: "m2".into(), session_id: "s1".into(), role: "user".into(), content: "just a normal message".into(), timestamp: "2026-01-01T00:02:00Z".into(), thinking_content: None, sort_order: 1 },
        ];
        db.save_session_messages("s1", &msgs).unwrap();

        // Searching for "%" should only match the message that literally contains %
        let results = db.search_session_messages("/project", "100%", 50).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].content_snippet.contains("100%"));
    }

    #[test]
    fn test_has_stored_messages_in_closed_sessions_listing() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "With msgs", "/project", "closed", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.close_session_with_details("s1", Some("cli1"), None, "2026-01-01T01:00:00Z").unwrap();
        db.insert_session("s2", "Without msgs", "/project", "closed", "2026-01-02T00:00:00Z", None, 1).unwrap();
        db.close_session_with_details("s2", Some("cli2"), None, "2026-01-02T01:00:00Z").unwrap();

        db.save_session_messages("s1", &make_test_messages("s1", 2)).unwrap();

        let sessions = db.list_closed_sessions_for_project("/project", 20).unwrap();
        let s1 = sessions.iter().find(|s| s.id == "s1").unwrap();
        let s2 = sessions.iter().find(|s| s.id == "s2").unwrap();
        assert!(s1.has_stored_messages);
        assert!(!s2.has_stored_messages);
    }

    #[test]
    fn test_messages_isolated_between_sessions() {
        let db = Database::new(":memory:").unwrap();
        db.insert_session("s1", "Session 1", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();
        db.insert_session("s2", "Session 2", "/tmp", "connected", "2026-01-02T00:00:00Z", None, 1).unwrap();

        db.save_session_messages("s1", &make_test_messages("s1", 3)).unwrap();
        db.save_session_messages("s2", &make_test_messages("s2", 5)).unwrap();

        // Each session has its own messages
        assert_eq!(db.load_session_messages("s1").unwrap().len(), 3);
        assert_eq!(db.load_session_messages("s2").unwrap().len(), 5);

        // Deleting one session's messages doesn't affect the other
        db.delete_session("s1").unwrap();
        assert_eq!(db.load_session_messages("s2").unwrap().len(), 5);
    }

    // ── Super-Bro Observation Tests ──────────────────────────────────

    #[test]
    fn test_insert_and_list_observations() {
        let db = Database::new(":memory:").unwrap();
        db.insert_observation("obs-1", "/project/a", "Claude forgets loading states", "pattern", "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z").unwrap();
        db.insert_observation("obs-2", "/project/a", "Uses pnpm not npm", "project_note", "2026-03-02T00:00:00Z", "2026-03-02T00:00:00Z").unwrap();

        let obs = db.list_observations("/project/a").unwrap();
        assert_eq!(obs.len(), 2);
        assert_eq!(obs[0].id, "obs-2"); // Most recently referenced first
        assert_eq!(obs[1].id, "obs-1");
    }

    #[test]
    fn test_observations_filtered_by_project() {
        let db = Database::new(":memory:").unwrap();
        db.insert_observation("obs-1", "/project/a", "Pattern A", "pattern", "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z").unwrap();
        db.insert_observation("obs-2", "/project/b", "Pattern B", "pattern", "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z").unwrap();

        let obs_a = db.list_observations("/project/a").unwrap();
        assert_eq!(obs_a.len(), 1);
        assert_eq!(obs_a[0].text, "Pattern A");

        let obs_b = db.list_observations("/project/b").unwrap();
        assert_eq!(obs_b.len(), 1);
        assert_eq!(obs_b[0].text, "Pattern B");
    }

    #[test]
    fn test_delete_observation() {
        let db = Database::new(":memory:").unwrap();
        db.insert_observation("obs-1", "/project/a", "Pattern", "pattern", "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z").unwrap();
        assert_eq!(db.list_observations("/project/a").unwrap().len(), 1);

        db.delete_observation("obs-1").unwrap();
        assert_eq!(db.list_observations("/project/a").unwrap().len(), 0);
    }

    #[test]
    fn test_insert_observation_upsert() {
        let db = Database::new(":memory:").unwrap();
        db.insert_observation("obs-1", "/project/a", "Original text", "pattern", "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z").unwrap();
        db.insert_observation("obs-1", "/project/a", "Updated text", "preference", "2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z").unwrap();

        let obs = db.list_observations("/project/a").unwrap();
        assert_eq!(obs.len(), 1);
        assert_eq!(obs[0].text, "Updated text");
        assert_eq!(obs[0].category, "preference");
    }

    #[test]
    fn test_list_observations_empty_project() {
        let db = Database::new(":memory:").unwrap();
        let obs = db.list_observations("/project/nonexistent").unwrap();
        assert!(obs.is_empty());
    }

    #[test]
    fn test_observation_row_serialization() {
        let row = ObservationRow {
            id: "obs-1".to_string(),
            project_path: "/project/a".to_string(),
            text: "Test observation".to_string(),
            category: "pattern".to_string(),
            created_at: "2026-03-01T00:00:00Z".to_string(),
            last_referenced_at: "2026-03-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_value(&row).unwrap();
        // Verify camelCase serialization
        assert!(json.get("projectPath").is_some());
        assert!(json.get("createdAt").is_some());
        assert!(json.get("lastReferencedAt").is_some());
    }

    #[test]
    fn test_delete_nonexistent_observation() {
        let db = Database::new(":memory:").unwrap();
        // Should not error
        db.delete_observation("obs-does-not-exist").unwrap();
    }

    #[test]
    fn test_list_observations_limit_50() {
        let db = Database::new(":memory:").unwrap();
        for i in 0..60 {
            db.insert_observation(
                &format!("obs-{}", i),
                "/project/a",
                &format!("Observation {}", i),
                "pattern",
                "2026-03-01T00:00:00Z",
                &format!("2026-03-{:02}T00:00:00Z", (i % 28) + 1),
            ).unwrap();
        }
        let obs = db.list_observations("/project/a").unwrap();
        assert_eq!(obs.len(), 50);
    }
}
