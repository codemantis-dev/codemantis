//! Integration tests for the data orchestration that powers the
//! `list_recent_sessions` Tauri command (Open Project modal — Resume Session tab).
//!
//! The Tauri command itself is a thin wrapper that combines two database
//! queries — `list_recent_closed_sessions` + `list_changelog_entries` — into
//! `SessionHistoryEntry` records. These tests verify that combination behaves
//! correctly end-to-end against a real SQLite database.

use codemantis_lib::storage::database::Database;

/// Helper to create a closed session in one call.
fn seed_closed_session(
    db: &Database,
    id: &str,
    name: &str,
    project_path: &str,
    closed_at: &str,
    cli_session_id: &str,
) {
    db.insert_session(id, name, project_path, "closed", closed_at, None, 0, "claude_code")
        .unwrap();
    db.close_session_with_details(id, Some(cli_session_id), None, closed_at)
        .unwrap();
}

#[test]
fn recent_sessions_includes_project_path_per_row() {
    let db = Database::new(":memory:").unwrap();
    seed_closed_session(&db, "s1", "Build feature", "/Users/me/proj-a", "2026-04-01T10:00:00Z", "cli-1");
    seed_closed_session(&db, "s2", "Fix bug",        "/Users/me/proj-b", "2026-04-02T10:00:00Z", "cli-2");

    let rows = db.list_recent_closed_sessions(20).unwrap();
    assert_eq!(rows.len(), 2);

    let by_id: std::collections::HashMap<_, _> = rows
        .iter()
        .map(|r| (r.id.clone(), r.project_path.clone()))
        .collect();
    assert_eq!(by_id["s1"], "/Users/me/proj-a");
    assert_eq!(by_id["s2"], "/Users/me/proj-b");
}

#[test]
fn recent_sessions_caps_changelog_to_top_three() {
    let db = Database::new(":memory:").unwrap();
    seed_closed_session(&db, "s1", "Big session", "/proj", "2026-04-01T10:00:00Z", "cli-1");

    // Insert 5 changelog entries; only the top 3 by timestamp DESC should be used.
    db.insert_changelog_entry("e1", "s1", "2026-04-01T09:00:00Z", "First",  "d", "feature", "[]", 0, "", "").unwrap();
    db.insert_changelog_entry("e2", "s1", "2026-04-01T09:10:00Z", "Second", "d", "feature", "[]", 1, "", "").unwrap();
    db.insert_changelog_entry("e3", "s1", "2026-04-01T09:20:00Z", "Third",  "d", "feature", "[]", 2, "", "").unwrap();
    db.insert_changelog_entry("e4", "s1", "2026-04-01T09:30:00Z", "Fourth", "d", "feature", "[]", 3, "", "").unwrap();
    db.insert_changelog_entry("e5", "s1", "2026-04-01T09:40:00Z", "Fifth",  "d", "feature", "[]", 4, "", "").unwrap();

    // The command pulls `list_changelog_entries(session_id)` which orders DESC by timestamp.
    let entries = db.list_changelog_entries("s1").unwrap();
    let top_three: Vec<String> = entries.iter().take(3).map(|e| e.headline.clone()).collect();

    // Newest first: Fifth, Fourth, Third
    assert_eq!(top_three, vec!["Fifth".to_string(), "Fourth".to_string(), "Third".to_string()]);
}

#[test]
fn recent_sessions_has_stored_messages_flag_round_trips() {
    use codemantis_lib::storage::database::SessionMessageRow;

    let db = Database::new(":memory:").unwrap();
    seed_closed_session(&db, "s-with",    "With",    "/proj-a", "2026-04-01T10:00:00Z", "cli-1");
    seed_closed_session(&db, "s-without", "Without", "/proj-b", "2026-04-02T10:00:00Z", "cli-2");

    db.save_session_messages(
        "s-with",
        &[SessionMessageRow {
            id: "m1".to_string(),
            session_id: "s-with".to_string(),
            role: "user".to_string(),
            content: "hi".to_string(),
            timestamp: "2026-04-01T10:00:01Z".to_string(),
            thinking_content: None,
            sort_order: 0,
        }],
    )
    .unwrap();

    let rows = db.list_recent_closed_sessions(20).unwrap();
    let with    = rows.iter().find(|r| r.id == "s-with").unwrap();
    let without = rows.iter().find(|r| r.id == "s-without").unwrap();
    assert!(with.has_stored_messages);
    assert!(!without.has_stored_messages);
}

#[test]
fn recent_sessions_ordering_is_global_not_per_project() {
    let db = Database::new(":memory:").unwrap();
    // Interleave projects across timestamps. Newest-first must put proj-c at top
    // even though proj-a appears earlier alphabetically.
    seed_closed_session(&db, "a1", "a1", "/proj-a", "2026-04-01T10:00:00Z", "cli-a1");
    seed_closed_session(&db, "b1", "b1", "/proj-b", "2026-04-02T10:00:00Z", "cli-b1");
    seed_closed_session(&db, "c1", "c1", "/proj-c", "2026-04-03T10:00:00Z", "cli-c1");
    seed_closed_session(&db, "a2", "a2", "/proj-a", "2026-04-04T10:00:00Z", "cli-a2");

    let rows = db.list_recent_closed_sessions(20).unwrap();
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    assert_eq!(ids, vec!["a2".to_string(), "c1".to_string(), "b1".to_string(), "a1".to_string()]);
}
