//! Recall SQLite index.
//!
//! The index is a *cache* over the on-disk vault — `rm` the rows and a
//! reindex from the markdown files restores the same state (§5.4 promise).
//! All tables live in CodeMantis's main `codemantis.db` for transactional
//! consistency with `recall_enrichments` and `recall_harvests`.
//!
//! Public entry points:
//! - [`ensure_vault_row`]    — registers a vault in `recall_vaults`
//! - [`ingest::ingest_note`] — write one parsed note into the index
//! - [`ingest::remove_note_by_path`] — drop a note when its file vanishes
//! - [`query`]               — FTS5 + path-overlap + graph queries
//! - [`reindex::reindex_vault`] — full drop-and-rebuild from disk

pub mod ingest;
pub mod query;
pub mod reindex;

use chrono::Utc;
use std::path::Path;

use crate::recall::RecallError;
use crate::storage::Database;

/// Status snapshot for the `recall_status` Tauri command.
#[derive(Debug, Clone, serde::Serialize)]
pub struct IndexStatus {
    pub vault_id: i64,
    pub project_path: String,
    pub vault_path: String,
    pub is_meta: bool,
    pub note_count: i64,
    pub last_indexed_at: Option<String>,
}

/// Look up an existing vault row by `(project_path, is_meta)`. Returns
/// `Ok(None)` when no row exists yet — the caller decides whether that's
/// an error or an opportunity to create one.
pub fn lookup_vault(
    db: &Database,
    project_path: &Path,
    is_meta: bool,
) -> Result<Option<i64>, RecallError> {
    let project_path_str = project_path.to_string_lossy().to_string();
    let guard = db.conn().lock().unwrap();
    let mut stmt = guard.prepare(
        "SELECT id FROM recall_vaults WHERE project_path = ?1 AND is_meta = ?2",
    )?;
    let mut rows = stmt.query(rusqlite::params![project_path_str, is_meta as i64])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get::<_, i64>(0)?))
    } else {
        Ok(None)
    }
}

/// Idempotently create the `recall_vaults` row for a project. Returns the
/// row id. Safe to call on every `Recall::for_project`.
pub fn ensure_vault_row(
    db: &Database,
    project_path: &Path,
    vault_path: &Path,
    is_meta: bool,
) -> Result<i64, RecallError> {
    if let Some(id) = lookup_vault(db, project_path, is_meta)? {
        return Ok(id);
    }
    let project_path_str = project_path.to_string_lossy().to_string();
    let vault_path_str = vault_path.to_string_lossy().to_string();
    let now = Utc::now().to_rfc3339();
    let guard = db.conn().lock().unwrap();
    guard.execute(
        "INSERT INTO recall_vaults (project_path, vault_path, is_meta, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![project_path_str, vault_path_str, is_meta as i64, now],
    )?;
    Ok(guard.last_insert_rowid())
}

/// Mark a vault as freshly indexed. Called by `reindex_vault` and after
/// every successful incremental ingest pass.
pub fn touch_last_indexed_at(db: &Database, vault_id: i64) -> Result<(), RecallError> {
    let now = Utc::now().to_rfc3339();
    let guard = db.conn().lock().unwrap();
    guard.execute(
        "UPDATE recall_vaults SET last_indexed_at = ?1 WHERE id = ?2",
        rusqlite::params![now, vault_id],
    )?;
    Ok(())
}

/// Compose the `IndexStatus` payload for the frontend.
pub fn status_for_project(
    db: &Database,
    project_path: &Path,
) -> Result<Option<IndexStatus>, RecallError> {
    let project_path_str = project_path.to_string_lossy().to_string();
    let guard = db.conn().lock().unwrap();
    let row = guard
        .query_row(
            "SELECT id, project_path, vault_path, is_meta, last_indexed_at
               FROM recall_vaults
              WHERE project_path = ?1 AND is_meta = 0",
            rusqlite::params![project_path_str],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .ok();
    let Some((vault_id, project_path, vault_path, is_meta, last_indexed_at)) = row else {
        return Ok(None);
    };
    let note_count: i64 = guard.query_row(
        "SELECT COUNT(*) FROM recall_notes WHERE vault_id = ?1",
        rusqlite::params![vault_id],
        |r| r.get(0),
    )?;
    Ok(Some(IndexStatus {
        vault_id,
        project_path,
        vault_path,
        is_meta,
        note_count,
        last_indexed_at,
    }))
}

#[cfg(test)]
pub(crate) mod test_helpers {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Arc;

    /// Build an in-memory `Database` with the full migration applied, for
    /// use in unit tests. Returns an `Arc` so tests can share it across
    /// modules.
    pub fn fresh_db() -> Arc<Database> {
        // Use a unique tempfile path so each test gets isolation but we
        // still exercise the same code path as production (which wants
        // a file path string).
        let tmp = tempfile::Builder::new()
            .prefix("recall-test-")
            .suffix(".db")
            .tempfile()
            .unwrap();
        let path = tmp.path().to_string_lossy().to_string();
        // Leak the tempfile so it isn't deleted before the connection
        // opens. (Test process is short-lived; OS reaps on exit.)
        std::mem::forget(tmp);
        let db = Database::new(&path).expect("migrations should succeed");
        Arc::new(db)
    }

    pub fn dummy_project_path() -> std::path::PathBuf {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = tmp.path().to_path_buf();
        std::mem::forget(tmp);
        p
    }

    // Bring Connection into scope so callers can use it directly when
    // they want to inspect raw rows.
    #[allow(dead_code)]
    pub fn conn_guard<'a>(db: &'a Database) -> std::sync::MutexGuard<'a, Connection> {
        db.conn().lock().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::test_helpers::*;
    use super::*;

    #[test]
    fn ensure_vault_row_is_idempotent() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault = project.join(".recall");

        let id1 = ensure_vault_row(&db, &project, &vault, false).unwrap();
        let id2 = ensure_vault_row(&db, &project, &vault, false).unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn meta_and_project_vault_coexist_for_same_path() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault = project.join(".recall");
        let meta_vault = project.join("meta");

        let project_id = ensure_vault_row(&db, &project, &vault, false).unwrap();
        let meta_id = ensure_vault_row(&db, &project, &meta_vault, true).unwrap();
        assert_ne!(project_id, meta_id);
    }

    #[test]
    fn status_returns_none_when_no_vault_registered() {
        let db = fresh_db();
        let project = dummy_project_path();
        let status = status_for_project(&db, &project).unwrap();
        assert!(status.is_none());
    }

    #[test]
    fn status_returns_zero_notes_when_vault_empty() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault = project.join(".recall");
        ensure_vault_row(&db, &project, &vault, false).unwrap();
        let status = status_for_project(&db, &project).unwrap().unwrap();
        assert_eq!(status.note_count, 0);
        assert!(status.last_indexed_at.is_none());
        assert!(!status.is_meta);
    }

    #[test]
    fn touch_last_indexed_at_updates_timestamp() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = ensure_vault_row(&db, &project, &project.join(".recall"), false).unwrap();
        touch_last_indexed_at(&db, vault_id).unwrap();
        let status = status_for_project(&db, &project).unwrap().unwrap();
        assert!(status.last_indexed_at.is_some());
    }
}
