//! Drop-and-rebuild the SQLite index for a vault.
//!
//! Spec §5.4 promise: `rm .recall-index.db && reindex` always works. Our
//! analogue: `reindex_vault` deletes every `recall_notes` row for the
//! vault (cascading to join tables) plus the matching FTS5 rows, then
//! re-ingests every markdown file on disk. The vault row in
//! `recall_vaults` is preserved (last_indexed_at is refreshed).

use crate::recall::index::{ingest, touch_last_indexed_at};
use crate::recall::vault::Vault;
use crate::recall::RecallError;
use crate::storage::Database;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReindexReport {
    pub vault_id: i64,
    pub notes_indexed: usize,
    pub partial_parses: usize,
}

pub fn reindex_vault(
    db: &Database,
    vault_id: i64,
    vault: &Vault,
) -> Result<ReindexReport, RecallError> {
    // Capture the set of row ids we'll wipe so we can clean up FTS5
    // (which doesn't honor SQL foreign keys).
    let row_ids: Vec<i64> = {
        let guard = db.conn().lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id FROM recall_notes WHERE vault_id = ?1",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![vault_id], |r| r.get::<_, i64>(0))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    {
        let guard = db.conn().lock().unwrap();
        for id in &row_ids {
            guard.execute(
                "DELETE FROM recall_notes_fts WHERE rowid = ?1",
                rusqlite::params![id],
            )?;
        }
        guard.execute(
            "DELETE FROM recall_notes WHERE vault_id = ?1",
            rusqlite::params![vault_id],
        )?;
    }

    let mut partial_parses = 0;
    let mut notes_indexed = 0;
    for rel in vault.list_notes()? {
        let outcome = vault.read_note(&rel)?;
        if outcome.partial {
            partial_parses += 1;
        }
        ingest::ingest_note(db, vault_id, &outcome.note, &rel)?;
        notes_indexed += 1;
    }

    touch_last_indexed_at(db, vault_id)?;

    Ok(ReindexReport {
        vault_id,
        notes_indexed,
        partial_parses,
    })
}

#[cfg(test)]
mod tests {
    use super::super::ingest::ingest_vault;
    use super::super::test_helpers::*;
    use super::*;
    use crate::recall::vault::{Note, NoteType, Status, Trust};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn make_note(id: &str, paths: &[&str], body: &str) -> Note {
        Note {
            id: id.to_string(),
            note_type: NoteType::Landmine,
            project: Some("p".to_string()),
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
            tags: vec![],
            title: format!("Note {}", id),
            body: body.to_string(),
            file_path: None,
        }
    }

    fn row_snapshot(db: &crate::storage::Database, vault_id: i64) -> (i64, i64, i64, i64, i64) {
        let guard = db.conn().lock().unwrap();
        let notes: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_notes WHERE vault_id = ?1",
                rusqlite::params![vault_id],
                |r| r.get(0),
            )
            .unwrap();
        let paths: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_note_paths p
                   JOIN recall_notes n ON n.id = p.note_id
                  WHERE n.vault_id = ?1",
                rusqlite::params![vault_id],
                |r| r.get(0),
            )
            .unwrap();
        let links: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_note_links l
                   JOIN recall_notes n ON n.id = l.src_note_id
                  WHERE n.vault_id = ?1",
                rusqlite::params![vault_id],
                |r| r.get(0),
            )
            .unwrap();
        let tags: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_note_tags t
                   JOIN recall_notes n ON n.id = t.note_id
                  WHERE n.vault_id = ?1",
                rusqlite::params![vault_id],
                |r| r.get(0),
            )
            .unwrap();
        let fts: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM recall_notes_fts", [], |r| r.get(0)
            )
            .unwrap();
        (notes, paths, links, tags, fts)
    }

    #[test]
    fn reindex_matches_incremental_ingest_state() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let vault = crate::recall::vault::Vault::open_or_create(tmp.path()).unwrap();
        let project = dummy_project_path();
        let vault_id =
            crate::recall::index::ensure_vault_row(&db, &project, vault.root(), false).unwrap();

        for i in 0..3 {
            let n = make_note(
                &format!("n{}", i),
                &[&format!("src/{}.rs", i)],
                &format!("body {}", i),
            );
            vault.write_note(&n).unwrap();
        }

        ingest_vault(&db, vault_id, &vault).unwrap();
        let before = row_snapshot(&db, vault_id);

        let report = reindex_vault(&db, vault_id, &vault).unwrap();
        assert_eq!(report.notes_indexed, 3);
        assert_eq!(report.partial_parses, 0);

        let after = row_snapshot(&db, vault_id);
        assert_eq!(before, after, "drop+rebuild should match incremental");
    }

    #[test]
    fn reindex_picks_up_a_freshly_added_file() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let vault = crate::recall::vault::Vault::open_or_create(tmp.path()).unwrap();
        let project = dummy_project_path();
        let vault_id =
            crate::recall::index::ensure_vault_row(&db, &project, vault.root(), false).unwrap();

        vault.write_note(&make_note("one", &["src/a.rs"], "body")).unwrap();
        reindex_vault(&db, vault_id, &vault).unwrap();
        assert_eq!(row_snapshot(&db, vault_id).0, 1);

        // Add a second note on disk without going through the index.
        vault.write_note(&make_note("two", &["src/b.rs"], "body")).unwrap();
        reindex_vault(&db, vault_id, &vault).unwrap();
        assert_eq!(row_snapshot(&db, vault_id).0, 2);
    }

    #[test]
    fn reindex_drops_notes_whose_files_disappeared() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let vault = crate::recall::vault::Vault::open_or_create(tmp.path()).unwrap();
        let project = dummy_project_path();
        let vault_id =
            crate::recall::index::ensure_vault_row(&db, &project, vault.root(), false).unwrap();

        let n1 = make_note("one", &[], "body1");
        let p1 = vault.write_note(&n1).unwrap();
        vault.write_note(&make_note("two", &[], "body2")).unwrap();
        reindex_vault(&db, vault_id, &vault).unwrap();
        assert_eq!(row_snapshot(&db, vault_id).0, 2);

        std::fs::remove_file(&p1).unwrap();
        reindex_vault(&db, vault_id, &vault).unwrap();
        assert_eq!(row_snapshot(&db, vault_id).0, 1);
    }

    #[test]
    fn reindex_refreshes_last_indexed_at() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let vault = crate::recall::vault::Vault::open_or_create(tmp.path()).unwrap();
        let project = dummy_project_path();
        let vault_id =
            crate::recall::index::ensure_vault_row(&db, &project, vault.root(), false).unwrap();

        let status_before = crate::recall::index::status_for_project(&db, &project)
            .unwrap()
            .unwrap();
        assert!(status_before.last_indexed_at.is_none());

        reindex_vault(&db, vault_id, &vault).unwrap();
        let status_after = crate::recall::index::status_for_project(&db, &project)
            .unwrap()
            .unwrap();
        assert!(status_after.last_indexed_at.is_some());
    }
}
