//! Ingest one note into SQLite.
//!
//! Idempotency contract (spec §12.1 unit test list):
//! - Same file ingested twice → identical row state. We detect via
//!   `body_hash`; unchanged hash short-circuits the join-table churn.
//! - File deletion is handled by [`remove_note_by_path`], which deletes
//!   the `recall_notes` row and lets `ON DELETE CASCADE` clear the join
//!   tables.
//! - `recall_notes_fts` is maintained in lockstep — every insert/update
//!   of `recall_notes` does an `INSERT … ON CONFLICT DO UPDATE` on the
//!   FTS5 rowid (which we tie to `recall_notes.id`).

use std::path::{Path, PathBuf};

use crate::recall::vault::wikilinks;
use crate::recall::vault::{Note, Vault};
use crate::recall::RecallError;
use crate::storage::Database;

/// Result of an ingest call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestOutcome {
    /// Inserted as a new row.
    Inserted { note_row_id: i64 },
    /// Existing row's body_hash matched — no DB writes performed.
    Unchanged { note_row_id: i64 },
    /// Existing row updated in place.
    Updated { note_row_id: i64 },
}

impl IngestOutcome {
    pub fn note_row_id(&self) -> i64 {
        match self {
            IngestOutcome::Inserted { note_row_id }
            | IngestOutcome::Unchanged { note_row_id }
            | IngestOutcome::Updated { note_row_id } => *note_row_id,
        }
    }
}

/// Ingest one note. `relative_path` is the vault-relative path; it's
/// stored in `recall_notes.file_path` so the reverse lookup
/// (`remove_note_by_path`) can find the row when the file vanishes.
pub fn ingest_note(
    db: &Database,
    vault_id: i64,
    note: &Note,
    relative_path: &Path,
) -> Result<IngestOutcome, RecallError> {
    let new_hash = note.body_hash();
    let file_path = relative_path.to_string_lossy().to_string();

    let guard = db.conn().lock().unwrap();

    // Look up existing row.
    let existing: Option<(i64, String)> = guard
        .query_row(
            "SELECT id, body_hash FROM recall_notes WHERE vault_id = ?1 AND note_id = ?2",
            rusqlite::params![vault_id, note.id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    if let Some((row_id, existing_hash)) = &existing {
        if *existing_hash == new_hash {
            // Update file_path in case the note moved subdirectory but
            // is otherwise unchanged, then short-circuit.
            guard.execute(
                "UPDATE recall_notes SET file_path = ?1 WHERE id = ?2",
                rusqlite::params![file_path, row_id],
            )?;
            return Ok(IngestOutcome::Unchanged { note_row_id: *row_id });
        }
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    let trust_value = if !note.trust_raw.is_empty() {
        note.trust_raw.clone()
    } else {
        note.trust.as_str().to_string()
    };

    let note_row_id = if let Some((row_id, _)) = existing {
        guard.execute(
            "UPDATE recall_notes SET
                type = ?1, title = ?2, status = ?3, trust = ?4, severity = ?5,
                discovered_at = ?6, last_verified_at = ?7, file_path = ?8, body_hash = ?9
             WHERE id = ?10",
            rusqlite::params![
                note.note_type.as_str(),
                note.title,
                note.status.as_str(),
                trust_value,
                note.severity,
                note.discovered.to_string(),
                note.last_verified.to_string(),
                file_path,
                new_hash,
                row_id,
            ],
        )?;
        clear_join_rows(&guard, row_id)?;
        row_id
    } else {
        guard.execute(
            "INSERT INTO recall_notes
                (vault_id, note_id, type, title, status, trust, severity,
                 discovered_at, last_verified_at, file_path, body_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                vault_id,
                note.id,
                note.note_type.as_str(),
                note.title,
                note.status.as_str(),
                trust_value,
                note.severity,
                note.discovered.to_string(),
                note.last_verified.to_string(),
                file_path,
                new_hash,
            ],
        )?;
        guard.last_insert_rowid()
    };

    // Re-populate join tables.
    for path in &note.source_paths {
        guard.execute(
            "INSERT OR IGNORE INTO recall_note_paths (note_id, source_path) VALUES (?1, ?2)",
            rusqlite::params![note_row_id, path],
        )?;
    }
    for hash in &note.source_commits {
        guard.execute(
            "INSERT OR IGNORE INTO recall_note_commits (note_id, commit_hash, role, occurred_at)
             VALUES (?1, ?2, 'origin', ?3)",
            rusqlite::params![note_row_id, hash, now_iso],
        )?;
    }
    for occ in &note.prior_occurrences {
        guard.execute(
            "INSERT OR IGNORE INTO recall_note_commits (note_id, commit_hash, role, occurred_at)
             VALUES (?1, ?2, 'occurrence', ?3)",
            rusqlite::params![note_row_id, occ.commit_hash, occ.date.to_string()],
        )?;
    }
    for tag in &note.tags {
        guard.execute(
            "INSERT OR IGNORE INTO recall_note_tags (note_id, tag) VALUES (?1, ?2)",
            rusqlite::params![note_row_id, tag],
        )?;
    }

    // Wikilinks extracted from the body (authoritative graph). The
    // frontmatter `links:` list is a convenience and is not separately
    // indexed — the body is canonical.
    let links = wikilinks::extract(&note.body);
    for link in links {
        // Resolve target → recall_notes.id when the link points to a
        // note in the *same* vault. Meta links are recorded with
        // `is_meta = 1` and `dst_note_id = NULL` until a separate meta
        // resolver runs (Phase 2 / Phase 5; not Phase 1).
        let dst_note_id: Option<i64> = if link.is_meta {
            None
        } else {
            guard
                .query_row(
                    "SELECT id FROM recall_notes WHERE vault_id = ?1 AND note_id = ?2",
                    rusqlite::params![vault_id, link.target],
                    |row| row.get::<_, i64>(0),
                )
                .ok()
        };
        guard.execute(
            "INSERT OR REPLACE INTO recall_note_links
                (src_note_id, dst_note_id, dst_text, is_meta)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                note_row_id,
                dst_note_id,
                link.raw,
                link.is_meta as i64,
            ],
        )?;
    }

    // FTS5 maintenance: external-content table, so we manage rowid
    // explicitly. FTS5 does not support UPSERT, so we delete the row
    // (no-op when it doesn't exist) and re-insert.
    guard.execute(
        "DELETE FROM recall_notes_fts WHERE rowid = ?1",
        rusqlite::params![note_row_id],
    )?;
    guard.execute(
        "INSERT INTO recall_notes_fts(rowid, title, body) VALUES (?1, ?2, ?3)",
        rusqlite::params![note_row_id, note.title, note.body],
    )?;

    Ok(if existing.is_some() {
        IngestOutcome::Updated { note_row_id }
    } else {
        IngestOutcome::Inserted { note_row_id }
    })
}

/// Remove a note by its on-disk path (vault-relative). Returns true if a
/// row was deleted, false if no such note was indexed. Cascade rules drop
/// the join tables; we also delete the FTS5 row explicitly because FTS5
/// virtual tables don't honor SQL foreign keys.
pub fn remove_note_by_path(
    db: &Database,
    vault_id: i64,
    relative_path: &Path,
) -> Result<bool, RecallError> {
    let file_path = relative_path.to_string_lossy().to_string();
    let guard = db.conn().lock().unwrap();
    let row_id: Option<i64> = guard
        .query_row(
            "SELECT id FROM recall_notes WHERE vault_id = ?1 AND file_path = ?2",
            rusqlite::params![vault_id, file_path],
            |row| row.get(0),
        )
        .ok();
    let Some(row_id) = row_id else { return Ok(false) };
    guard.execute(
        "DELETE FROM recall_notes_fts WHERE rowid = ?1",
        rusqlite::params![row_id],
    )?;
    guard.execute(
        "DELETE FROM recall_notes WHERE id = ?1",
        rusqlite::params![row_id],
    )?;
    Ok(true)
}

fn clear_join_rows(
    conn: &rusqlite::Connection,
    note_row_id: i64,
) -> Result<(), RecallError> {
    conn.execute(
        "DELETE FROM recall_note_paths WHERE note_id = ?1",
        rusqlite::params![note_row_id],
    )?;
    conn.execute(
        "DELETE FROM recall_note_commits WHERE note_id = ?1",
        rusqlite::params![note_row_id],
    )?;
    conn.execute(
        "DELETE FROM recall_note_links WHERE src_note_id = ?1",
        rusqlite::params![note_row_id],
    )?;
    conn.execute(
        "DELETE FROM recall_note_tags WHERE note_id = ?1",
        rusqlite::params![note_row_id],
    )?;
    Ok(())
}

/// Walk a vault directory and ingest every note found. Used by both
/// initial indexing and incremental refresh (idempotent — unchanged
/// notes short-circuit on hash). Returns the list of (relative_path,
/// outcome) tuples for the caller's audit log.
pub fn ingest_vault(
    db: &Database,
    vault_id: i64,
    vault: &Vault,
) -> Result<Vec<(PathBuf, IngestOutcome)>, RecallError> {
    let mut out = Vec::new();
    for rel in vault.list_notes()? {
        let outcome = vault.read_note(&rel)?;
        let result = ingest_note(db, vault_id, &outcome.note, &rel)?;
        out.push((rel, result));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::*;
    use super::*;
    use crate::recall::vault::{NoteType, Status, Trust};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn vault_dir() -> (TempDir, Vault) {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        (tmp, vault)
    }

    fn make_note(id: &str, paths: &[&str], tags: &[&str], body: &str) -> Note {
        Note {
            id: id.to_string(),
            note_type: NoteType::Landmine,
            project: Some("proj".to_string()),
            status: Status::Active,
            trust: Trust::High,
            trust_raw: String::new(),
            severity: None,
            discovered: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            last_verified: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            source_paths: paths.iter().map(|s| s.to_string()).collect(),
            source_commits: vec![],
            prior_occurrences: vec![],
            links: vec![],
            tags: tags.iter().map(|s| s.to_string()).collect(),
            title: format!("Note {}", id),
            body: body.to_string(),
            file_path: None,
        }
    }

    #[test]
    fn first_ingest_inserts_then_second_is_unchanged() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = crate::recall::index::ensure_vault_row(
            &db,
            &project,
            &project.join(".recall"),
            false,
        )
        .unwrap();
        let note = make_note("n1", &["src/a.rs"], &["t1"], "body");
        let rel = std::path::PathBuf::from("notes/landmines/n1.md");

        let r1 = ingest_note(&db, vault_id, &note, &rel).unwrap();
        assert!(matches!(r1, IngestOutcome::Inserted { .. }));
        let r2 = ingest_note(&db, vault_id, &note, &rel).unwrap();
        assert!(matches!(r2, IngestOutcome::Unchanged { .. }));
        assert_eq!(r1.note_row_id(), r2.note_row_id());
    }

    #[test]
    fn body_change_triggers_update_and_refreshes_join_rows() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = crate::recall::index::ensure_vault_row(
            &db,
            &project,
            &project.join(".recall"),
            false,
        )
        .unwrap();
        let rel = std::path::PathBuf::from("notes/landmines/n1.md");
        let mut note = make_note("n1", &["src/a.rs"], &["t1"], "v1");
        ingest_note(&db, vault_id, &note, &rel).unwrap();

        note.body.push_str(" v2");
        note.source_paths = vec!["src/b.rs".to_string()];
        note.tags = vec!["t2".to_string()];
        let result = ingest_note(&db, vault_id, &note, &rel).unwrap();
        assert!(matches!(result, IngestOutcome::Updated { .. }));

        let guard = db.conn().lock().unwrap();
        let path_count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_note_paths WHERE note_id = ?1",
                rusqlite::params![result.note_row_id()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(path_count, 1);
        let path_value: String = guard
            .query_row(
                "SELECT source_path FROM recall_note_paths WHERE note_id = ?1",
                rusqlite::params![result.note_row_id()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(path_value, "src/b.rs");
        let tag_value: String = guard
            .query_row(
                "SELECT tag FROM recall_note_tags WHERE note_id = ?1",
                rusqlite::params![result.note_row_id()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tag_value, "t2");
    }

    #[test]
    fn remove_note_drops_row_and_cascades_join_tables() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = crate::recall::index::ensure_vault_row(
            &db,
            &project,
            &project.join(".recall"),
            false,
        )
        .unwrap();
        let rel = std::path::PathBuf::from("notes/landmines/n1.md");
        let note = make_note("n1", &["src/a.rs"], &["t1"], "body");
        let outcome = ingest_note(&db, vault_id, &note, &rel).unwrap();
        let row_id = outcome.note_row_id();

        let removed = remove_note_by_path(&db, vault_id, &rel).unwrap();
        assert!(removed);

        let guard = db.conn().lock().unwrap();
        let count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_notes WHERE id = ?1",
                rusqlite::params![row_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        let path_count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_note_paths WHERE note_id = ?1",
                rusqlite::params![row_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(path_count, 0, "cascade should remove join rows");
        let fts_count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_notes_fts WHERE rowid = ?1",
                rusqlite::params![row_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 0, "fts row must be deleted alongside the note");
    }

    #[test]
    fn remove_note_returns_false_when_not_indexed() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = crate::recall::index::ensure_vault_row(
            &db,
            &project,
            &project.join(".recall"),
            false,
        )
        .unwrap();
        let removed = remove_note_by_path(
            &db,
            vault_id,
            std::path::Path::new("notes/landmines/nope.md"),
        )
        .unwrap();
        assert!(!removed);
    }

    #[test]
    fn wikilinks_in_body_indexed_with_resolution() {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = crate::recall::index::ensure_vault_row(
            &db,
            &project,
            &project.join(".recall"),
            false,
        )
        .unwrap();
        // First, ingest the target note so the linker can resolve.
        let target = make_note("target", &[], &[], "I'm the target");
        ingest_note(
            &db,
            vault_id,
            &target,
            std::path::Path::new("notes/landmines/target.md"),
        )
        .unwrap();
        // Now a linker note that references both target + a meta link.
        let linker = make_note(
            "linker",
            &[],
            &[],
            "see [[target]] and [[meta:cross]]",
        );
        let outcome = ingest_note(
            &db,
            vault_id,
            &linker,
            std::path::Path::new("notes/landmines/linker.md"),
        )
        .unwrap();
        let linker_id = outcome.note_row_id();

        let guard = db.conn().lock().unwrap();
        let mut stmt = guard
            .prepare(
                "SELECT dst_text, dst_note_id, is_meta FROM recall_note_links
                 WHERE src_note_id = ?1 ORDER BY dst_text",
            )
            .unwrap();
        let rows: Vec<(String, Option<i64>, i64)> = stmt
            .query_map(rusqlite::params![linker_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(rows.len(), 2);
        // meta link: is_meta=1, dst_note_id=None
        assert!(rows.iter().any(|(t, dst, m)| t.contains("meta:cross") && dst.is_none() && *m == 1));
        // resolved link: dst_note_id Some
        assert!(rows.iter().any(|(t, dst, m)| t == "target" && dst.is_some() && *m == 0));
    }

    #[test]
    fn ingest_vault_walks_all_notes_on_disk() {
        let db = fresh_db();
        let (_tmp, vault) = vault_dir();
        let project = dummy_project_path();
        let vault_id = crate::recall::index::ensure_vault_row(&db, &project, vault.root(), false).unwrap();

        vault.write_note(&make_note("a", &["src/x.rs"], &[], "A")).unwrap();
        vault.write_note(&make_note("b", &["src/y.rs"], &[], "B")).unwrap();

        let results = ingest_vault(&db, vault_id, &vault).unwrap();
        assert_eq!(results.len(), 2);
        for (_p, outcome) in &results {
            assert!(matches!(outcome, IngestOutcome::Inserted { .. }));
        }
    }
}
