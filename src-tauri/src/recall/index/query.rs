//! Recall index queries.
//!
//! Three primitives the Enricher's gather step (Phase 2) will compose:
//! - `search_notes_fts` — keyword search over FTS5
//! - `notes_by_path_overlap` — find notes whose `source_paths` intersect
//!   a given set of files (the most common Enricher query)
//! - `backlinks_of` — walk the wikilink graph one hop
//!
//! All return lightweight `IndexedNote` rows — full markdown bodies stay
//! on disk and are loaded by the caller when needed.

use crate::recall::RecallError;
use crate::storage::Database;

/// Lightweight index row used by query results. The full markdown lives
/// on disk at `file_path` (vault-relative).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct IndexedNote {
    pub row_id: i64,
    pub vault_id: i64,
    pub note_id: String,
    pub note_type: String,
    pub title: String,
    pub status: String,
    pub trust: String,
    pub severity: Option<String>,
    /// `last_verified_at` date text ("YYYY-MM-DD"). Used by the enricher's
    /// freshness filter to flag notes whose source paths haven't been
    /// touched in a while (see `RecallConfig::stale_threshold_days`).
    pub last_verified: String,
    pub file_path: String,
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<IndexedNote> {
    Ok(IndexedNote {
        row_id: row.get(0)?,
        vault_id: row.get(1)?,
        note_id: row.get(2)?,
        note_type: row.get(3)?,
        title: row.get(4)?,
        status: row.get(5)?,
        trust: row.get(6)?,
        severity: row.get(7)?,
        last_verified: row.get(8)?,
        file_path: row.get(9)?,
    })
}

const SELECT_COLS: &str =
    "n.id, n.vault_id, n.note_id, n.type, n.title, n.status, n.trust, n.severity, n.last_verified_at, n.file_path";

/// FTS5 keyword search. `query` is passed through to SQLite's FTS5 MATCH
/// syntax; callers building it from user input should sanitize against
/// MATCH-syntax injection (quote phrases, escape `"`). Returns matches
/// ordered by FTS5's built-in rank, capped at `limit`.
pub fn search_notes_fts(
    db: &Database,
    vault_id: i64,
    query: &str,
    limit: usize,
) -> Result<Vec<IndexedNote>, RecallError> {
    let guard = db.conn().lock().unwrap();
    let mut stmt = guard.prepare(&format!(
        "SELECT {SELECT_COLS}
           FROM recall_notes n
           JOIN recall_notes_fts f ON f.rowid = n.id
          WHERE n.vault_id = ?1 AND recall_notes_fts MATCH ?2 AND n.status != 'archived'
       ORDER BY rank LIMIT ?3"
    ))?;
    let rows = stmt
        .query_map(rusqlite::params![vault_id, query, limit as i64], map_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Find notes whose `source_paths` intersect any of `paths`. This is the
/// Enricher's path-overlap gather step (RECALL-SPEC §6.1 step 2).
///
/// The result is deduplicated per note; a note matching three of the
/// query paths still appears once. Ordering: by `severity = recurring`
/// first (landmines that recur are highest-leverage), then by trust
/// ranking, then by `last_verified_at` desc (freshest first).
pub fn notes_by_path_overlap(
    db: &Database,
    vault_id: i64,
    paths: &[String],
    limit: usize,
) -> Result<Vec<IndexedNote>, RecallError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    // Build a parameter list of the form ?2, ?3, … ?N.
    let placeholders: Vec<String> = (0..paths.len()).map(|i| format!("?{}", i + 2)).collect();
    let in_clause = placeholders.join(", ");
    let sql = format!(
        "SELECT DISTINCT {SELECT_COLS}
           FROM recall_notes n
           JOIN recall_note_paths p ON p.note_id = n.id
          WHERE n.vault_id = ?1
            AND n.status != 'archived'
            AND p.source_path IN ({in_clause})
       ORDER BY CASE WHEN n.severity = 'recurring' THEN 0 ELSE 1 END,
                CASE n.trust
                    WHEN 'high'     THEN 0
                    WHEN 'medium'   THEN 1
                    WHEN 'inferred' THEN 2
                    WHEN 'seeded'   THEN 3
                    WHEN 'low'      THEN 4
                    ELSE 5
                END,
                n.last_verified_at DESC
          LIMIT ?{}",
        paths.len() + 2
    );
    let guard = db.conn().lock().unwrap();
    let mut stmt = guard.prepare(&sql)?;
    let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(paths.len() + 2);
    params.push(rusqlite::types::Value::from(vault_id));
    for p in paths {
        params.push(rusqlite::types::Value::from(p.clone()));
    }
    params.push(rusqlite::types::Value::from(limit as i64));
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), map_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// One-hop graph walk: notes that link *to* the given note via wikilinks.
pub fn backlinks_of(db: &Database, note_row_id: i64) -> Result<Vec<IndexedNote>, RecallError> {
    let guard = db.conn().lock().unwrap();
    let mut stmt = guard.prepare(&format!(
        "SELECT {SELECT_COLS}
           FROM recall_notes n
           JOIN recall_note_links l ON l.src_note_id = n.id
          WHERE l.dst_note_id = ?1 AND n.status != 'archived'
       ORDER BY n.title"
    ))?;
    let rows = stmt
        .query_map(rusqlite::params![note_row_id], map_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Notes filtered by tag (cheap one-tag lookup). Useful for the brief
/// assembler's "always include landmines tagged X" path.
pub fn notes_by_tag(
    db: &Database,
    vault_id: i64,
    tag: &str,
    limit: usize,
) -> Result<Vec<IndexedNote>, RecallError> {
    let guard = db.conn().lock().unwrap();
    let mut stmt = guard.prepare(&format!(
        "SELECT DISTINCT {SELECT_COLS}
           FROM recall_notes n
           JOIN recall_note_tags t ON t.note_id = n.id
          WHERE n.vault_id = ?1 AND t.tag = ?2 AND n.status != 'archived'
       ORDER BY n.last_verified_at DESC LIMIT ?3"
    ))?;
    let rows = stmt
        .query_map(rusqlite::params![vault_id, tag, limit as i64], map_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Top landmines for a vault, independent of any extracted entity.
///
/// The enricher gathers these on *every* prompt so the most
/// safety-critical memory surfaces even when the user's prompt names no
/// overlapping path (e.g. "implement the plan", "make a commit"). Ordered
/// recurring-first, then by trust, then freshest-verified — and capped by
/// `limit` so the never-drop landmine guarantee in `assemble` stays
/// bounded.
pub fn top_landmines(
    db: &Database,
    vault_id: i64,
    limit: usize,
) -> Result<Vec<IndexedNote>, RecallError> {
    let guard = db.conn().lock().unwrap();
    let mut stmt = guard.prepare(&format!(
        "SELECT {SELECT_COLS}
           FROM recall_notes n
          WHERE n.vault_id = ?1
            AND n.type = 'landmine'
            AND n.status != 'archived'
       ORDER BY CASE WHEN n.severity = 'recurring' THEN 0 ELSE 1 END,
                CASE n.trust
                    WHEN 'high'     THEN 0
                    WHEN 'medium'   THEN 1
                    WHEN 'inferred' THEN 2
                    WHEN 'seeded'   THEN 3
                    WHEN 'low'      THEN 4
                    ELSE 5
                END,
                n.last_verified_at DESC
          LIMIT ?2"
    ))?;
    let rows = stmt
        .query_map(rusqlite::params![vault_id, limit as i64], map_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::super::ingest::ingest_note;
    use super::super::test_helpers::*;
    use super::*;
    use crate::recall::vault::{Note, NoteType, Status, Trust};
    use chrono::NaiveDate;

    fn make_note(id: &str, title: &str, body: &str, paths: &[&str]) -> Note {
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
            tags: vec![],
            title: title.to_string(),
            body: body.to_string(),
            file_path: None,
        }
    }

    fn setup() -> (std::sync::Arc<crate::storage::Database>, i64) {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = crate::recall::index::ensure_vault_row(
            &db,
            &project,
            &project.join(".recall"),
            false,
        )
        .unwrap();
        (db, vault_id)
    }

    #[test]
    fn fts_matches_title_term() {
        let (db, vault_id) = setup();
        let n = make_note(
            "n1",
            "pgcrypto landmine for credentials",
            "Body about encryption.",
            &["src/x.rs"],
        );
        ingest_note(
            &db,
            vault_id,
            &n,
            std::path::Path::new("notes/landmines/n1.md"),
        )
        .unwrap();
        let hits = search_notes_fts(&db, vault_id, "pgcrypto", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note_id, "n1");
    }

    #[test]
    fn fts_matches_body_term() {
        let (db, vault_id) = setup();
        let n = make_note("n1", "Untouched title", "search_path drift here", &[]);
        ingest_note(
            &db,
            vault_id,
            &n,
            std::path::Path::new("notes/landmines/n1.md"),
        )
        .unwrap();
        let hits = search_notes_fts(&db, vault_id, "search_path", 10).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn path_overlap_returns_matches() {
        let (db, vault_id) = setup();
        let n1 = make_note("n1", "a", "x", &["src/a.rs", "src/b.rs"]);
        let n2 = make_note("n2", "b", "x", &["src/c.rs"]);
        ingest_note(&db, vault_id, &n1, std::path::Path::new("notes/landmines/n1.md")).unwrap();
        ingest_note(&db, vault_id, &n2, std::path::Path::new("notes/landmines/n2.md")).unwrap();

        let hits =
            notes_by_path_overlap(&db, vault_id, &["src/b.rs".to_string()], 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note_id, "n1");
    }

    #[test]
    fn path_overlap_orders_recurring_landmines_first() {
        let (db, vault_id) = setup();
        let mut n1 = make_note("n1", "ordinary", "x", &["src/x.rs"]);
        let mut n2 = make_note("n2", "recurring", "x", &["src/x.rs"]);
        n2.severity = Some("recurring".to_string());
        n1.trust = Trust::Low; // shouldn't even matter; severity dominates
        ingest_note(&db, vault_id, &n1, std::path::Path::new("notes/landmines/n1.md")).unwrap();
        ingest_note(&db, vault_id, &n2, std::path::Path::new("notes/landmines/n2.md")).unwrap();

        let hits =
            notes_by_path_overlap(&db, vault_id, &["src/x.rs".to_string()], 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].note_id, "n2", "recurring landmine ranks first");
    }

    #[test]
    fn path_overlap_orders_by_trust_then_freshness() {
        let (db, vault_id) = setup();
        let mut older_high = make_note("h", "high old", "x", &["src/x.rs"]);
        older_high.last_verified = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let mut newer_low = make_note("l", "low new", "x", &["src/x.rs"]);
        newer_low.trust = Trust::Low;
        newer_low.last_verified = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        ingest_note(&db, vault_id, &older_high, std::path::Path::new("notes/landmines/h.md")).unwrap();
        ingest_note(&db, vault_id, &newer_low, std::path::Path::new("notes/landmines/l.md")).unwrap();

        let hits =
            notes_by_path_overlap(&db, vault_id, &["src/x.rs".to_string()], 10).unwrap();
        assert_eq!(hits[0].note_id, "h", "high trust outranks low even when older");
    }

    #[test]
    fn path_overlap_empty_paths_returns_empty() {
        let (db, vault_id) = setup();
        let hits = notes_by_path_overlap(&db, vault_id, &[], 10).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn path_overlap_dedupes_when_multiple_paths_match_same_note() {
        let (db, vault_id) = setup();
        let n = make_note("n", "n", "x", &["src/a.rs", "src/b.rs"]);
        ingest_note(&db, vault_id, &n, std::path::Path::new("notes/landmines/n.md")).unwrap();
        let hits = notes_by_path_overlap(
            &db,
            vault_id,
            &["src/a.rs".to_string(), "src/b.rs".to_string()],
            10,
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn backlinks_of_walks_one_hop() {
        let (db, vault_id) = setup();
        let target = make_note("target", "T", "I am the target", &[]);
        let outcome = ingest_note(
            &db,
            vault_id,
            &target,
            std::path::Path::new("notes/landmines/target.md"),
        )
        .unwrap();
        let target_id = outcome.note_row_id();
        let linker = make_note("linker", "L", "see [[target]]", &[]);
        ingest_note(
            &db,
            vault_id,
            &linker,
            std::path::Path::new("notes/landmines/linker.md"),
        )
        .unwrap();

        let backs = backlinks_of(&db, target_id).unwrap();
        assert_eq!(backs.len(), 1);
        assert_eq!(backs[0].note_id, "linker");
    }

    #[test]
    fn archived_notes_are_excluded_from_search() {
        let (db, vault_id) = setup();
        let mut n = make_note("n", "archived note", "body", &["src/a.rs"]);
        n.status = Status::Archived;
        ingest_note(&db, vault_id, &n, std::path::Path::new("notes/landmines/n.md")).unwrap();

        let fts_hits = search_notes_fts(&db, vault_id, "archived", 10).unwrap();
        assert!(fts_hits.is_empty(), "archived notes are hidden from FTS");
        let overlap = notes_by_path_overlap(&db, vault_id, &["src/a.rs".to_string()], 10).unwrap();
        assert!(overlap.is_empty(), "archived notes are hidden from overlap");
    }

    #[test]
    fn top_landmines_returns_only_landmines_capped() {
        let (db, vault_id) = setup();
        // make_note defaults to NoteType::Landmine; add a non-landmine too.
        let l1 = make_note("l1", "landmine one", "x", &[]);
        let l2 = make_note("l2", "landmine two", "x", &[]);
        let mut pattern = make_note("p1", "a pattern", "x", &[]);
        pattern.note_type = NoteType::Pattern;
        ingest_note(&db, vault_id, &l1, std::path::Path::new("notes/landmines/l1.md")).unwrap();
        ingest_note(&db, vault_id, &l2, std::path::Path::new("notes/landmines/l2.md")).unwrap();
        ingest_note(&db, vault_id, &pattern, std::path::Path::new("notes/patterns/p1.md")).unwrap();

        let hits = top_landmines(&db, vault_id, 5).unwrap();
        assert_eq!(hits.len(), 2, "only landmines returned");
        assert!(hits.iter().all(|n| n.note_type == "landmine"));

        let capped = top_landmines(&db, vault_id, 1).unwrap();
        assert_eq!(capped.len(), 1, "limit caps the result set");
    }

    #[test]
    fn top_landmines_orders_recurring_first() {
        let (db, vault_id) = setup();
        let ordinary = make_note("l1", "ordinary landmine", "x", &[]);
        let mut recurring = make_note("l2", "recurring landmine", "x", &[]);
        recurring.severity = Some("recurring".to_string());
        ingest_note(&db, vault_id, &ordinary, std::path::Path::new("notes/landmines/l1.md")).unwrap();
        ingest_note(&db, vault_id, &recurring, std::path::Path::new("notes/landmines/l2.md")).unwrap();

        let hits = top_landmines(&db, vault_id, 5).unwrap();
        assert_eq!(hits[0].note_id, "l2", "recurring landmine ranks first");
    }

    #[test]
    fn notes_by_tag_returns_only_tagged_notes() {
        let (db, vault_id) = setup();
        let mut n1 = make_note("n1", "tagged", "x", &[]);
        n1.tags = vec!["security".to_string()];
        let n2 = make_note("n2", "untagged", "x", &[]);
        ingest_note(&db, vault_id, &n1, std::path::Path::new("notes/landmines/n1.md")).unwrap();
        ingest_note(&db, vault_id, &n2, std::path::Path::new("notes/landmines/n2.md")).unwrap();
        let hits = notes_by_tag(&db, vault_id, "security", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note_id, "n1");
    }
}
