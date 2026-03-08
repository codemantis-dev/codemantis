use crate::errors::AppError;
use crate::storage::migrations;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
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
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(db_path)
            .map_err(|e| AppError::DatabaseError(format!("Failed to open database: {}", e)))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| AppError::DatabaseError(format!("Failed to set pragmas: {}", e)))?;

        conn.execute_batch(migrations::CREATE_TABLES)
            .map_err(|e| AppError::DatabaseError(format!("Failed to create tables: {}", e)))?;

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
            .prepare("SELECT id, name, project_path, status, created_at, model, icon_index FROM sessions ORDER BY created_at DESC")
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
}
