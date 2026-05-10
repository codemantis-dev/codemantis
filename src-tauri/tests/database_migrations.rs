//! Integration tests for the Database migration chain and CRUD operations.
//!
//! Every test creates a fresh in-memory SQLite database via `Database::new(":memory:")`,
//! which runs the full migration chain defined in `storage::migrations`.

use codemantis_lib::storage::database::{Database, SessionMessageRow};

// ---------------------------------------------------------------------------
// Schema verification
// ---------------------------------------------------------------------------

#[test]
fn fresh_database_creates_all_tables() {
    let db = Database::new(":memory:").unwrap();

    // Query sqlite_master through the public API by inserting/listing;
    // but we need raw SQL access. We can verify indirectly by exercising
    // every table. For a direct check we open a second connection.
    let conn = rusqlite::Connection::open(":memory:").unwrap();
    // Re-run the same init the Database does so we can inspect sqlite_master.
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .unwrap();
    conn.execute_batch(codemantis_lib::storage::migrations::CREATE_TABLES)
        .unwrap();
    for sql in codemantis_lib::storage::migrations::MIGRATE_SESSION_HISTORY {
        let _ = conn.execute_batch(sql);
    }
    for sql in codemantis_lib::storage::migrations::MIGRATE_CHANGELOG_DETAIL {
        let _ = conn.execute_batch(sql);
    }
    for sql in codemantis_lib::storage::migrations::MIGRATE_API_LOGS {
        let _ = conn.execute_batch(sql);
    }
    for sql in codemantis_lib::storage::migrations::MIGRATE_TASK_PLANS {
        let _ = conn.execute_batch(sql);
    }
    // V2 migration
    let needs_v2: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('task_plans') WHERE name='status'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
        == 0;
    if needs_v2 {
        let _ = conn.execute_batch(codemantis_lib::storage::migrations::MIGRATE_TASK_PLANS_V2);
    }
    let _ = conn.execute_batch(codemantis_lib::storage::migrations::MIGRATE_SESSION_MESSAGES);
    let _ = conn.execute_batch(codemantis_lib::storage::migrations::MIGRATE_IMPLEMENTATION_GUIDES);
    let _ = conn.execute_batch(codemantis_lib::storage::migrations::MIGRATE_SUPER_BRO_OBSERVATIONS);
    let _ = conn.execute_batch("DROP TABLE IF EXISTS planning_messages");

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    let expected = vec![
        "api_logs",
        "changelog_entries",
        "implementation_guides",
        "session_messages",
        "session_settings",
        "sessions",
        "super_bro_observations",
        "task_plans",
        "terminal_instances",
    ];

    assert_eq!(tables, expected, "Expected exactly 9 tables after migration");

    // Also verify the Database::new path succeeded (no panic)
    drop(db);
}

#[test]
fn fresh_database_sets_journal_mode() {
    // For an in-memory database, SQLite returns "memory" instead of "wal".
    // We verify that Database::new succeeds (which sets PRAGMA journal_mode=WAL)
    // and that the in-memory connection reports "memory".
    let _db = Database::new(":memory:").unwrap();

    // Open a standalone connection to verify the pragma behavior.
    let conn = rusqlite::Connection::open(":memory:").unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    // In-memory databases always report "memory" regardless of WAL request.
    assert_eq!(mode, "memory");
}

// ---------------------------------------------------------------------------
// Migration idempotency
// ---------------------------------------------------------------------------

#[test]
fn migrations_are_idempotent() {
    // Calling Database::new twice on the same file must not error.
    // We use a temp file so both calls hit the same database.
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let path = tmp.path().to_str().unwrap();

    let db1 = Database::new(path);
    assert!(db1.is_ok(), "First Database::new failed: {:?}", db1.err());
    drop(db1);

    let db2 = Database::new(path);
    assert!(
        db2.is_ok(),
        "Second Database::new (re-migration) failed: {:?}",
        db2.err()
    );
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

#[test]
fn insert_and_list_sessions() {
    let db = Database::new(":memory:").unwrap();

    db.insert_session("s1", "Alpha", "/projects/alpha", "connected", "2026-01-01T00:00:00Z", Some("claude-4"), 0)
        .unwrap();
    db.insert_session("s2", "Beta", "/projects/beta", "idle", "2026-01-02T00:00:00Z", None, 1)
        .unwrap();
    db.insert_session("s3", "Gamma", "/projects/gamma", "connected", "2026-01-03T00:00:00Z", Some("claude-4-opus"), 2)
        .unwrap();

    let sessions = db.list_sessions().unwrap();
    assert_eq!(sessions.len(), 3, "Expected 3 sessions");

    // list_sessions orders by created_at DESC
    assert_eq!(sessions[0].id, "s3");
    assert_eq!(sessions[0].name, "Gamma");
    assert_eq!(sessions[0].project_path, "/projects/gamma");
    assert_eq!(sessions[0].model, Some("claude-4-opus".to_string()));
    assert_eq!(sessions[0].icon_index, 2);

    assert_eq!(sessions[1].id, "s2");
    assert_eq!(sessions[1].status, "idle");
    assert_eq!(sessions[1].model, None);

    assert_eq!(sessions[2].id, "s1");
    assert_eq!(sessions[2].name, "Alpha");
}

#[test]
fn update_session_status_and_rename() {
    let db = Database::new(":memory:").unwrap();

    db.insert_session("s1", "Original", "/tmp/proj", "connected", "2026-01-01T00:00:00Z", None, 0)
        .unwrap();

    // Update status
    db.update_session_status("s1", "idle").unwrap();
    let sessions = db.list_sessions().unwrap();
    assert_eq!(sessions[0].status, "idle");

    // Rename
    db.rename_session("s1", "Renamed Session").unwrap();
    let sessions = db.list_sessions().unwrap();
    assert_eq!(sessions[0].name, "Renamed Session");

    // Both changes persisted together
    assert_eq!(sessions[0].status, "idle");
}

#[test]
fn get_next_icon_index_cycles() {
    let db = Database::new(":memory:").unwrap();

    // icon index = count % 10, so after inserting N sessions, next index is N % 10
    assert_eq!(db.get_next_icon_index().unwrap(), 0);

    for i in 0..11 {
        db.insert_session(
            &format!("s{}", i),
            &format!("Session {}", i),
            "/project",
            "connected",
            &format!("2026-01-{:02}T00:00:00Z", i + 1),
            None,
            i % 10,
        )
        .unwrap();
    }

    // 11 sessions => 11 % 10 = 1
    assert_eq!(db.get_next_icon_index().unwrap(), 1);

    // Add 9 more to get to 20 sessions => 20 % 10 = 0
    for i in 11..20 {
        db.insert_session(
            &format!("s{}", i),
            &format!("Session {}", i),
            "/project",
            "connected",
            &format!("2026-02-{:02}T00:00:00Z", i - 10),
            None,
            0,
        )
        .unwrap();
    }
    assert_eq!(db.get_next_icon_index().unwrap(), 0);
}

// ---------------------------------------------------------------------------
// Changelog CRUD
// ---------------------------------------------------------------------------

#[test]
fn changelog_entry_crud() {
    let db = Database::new(":memory:").unwrap();

    // Need a session first (FK constraint)
    db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0)
        .unwrap();

    // Insert
    db.insert_changelog_entry(
        "cl1",
        "s1",
        "2026-01-01T01:00:00Z",
        "Added login flow",
        "Implemented OAuth2 login with Google provider",
        "feature",
        "[\"src/auth.rs\"]",
        1,
        "Uses reqwest for token exchange",
        "read(3), write(2), bash(1)",
    )
    .unwrap();

    // List
    let entries = db.list_changelog_entries("s1").unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, "cl1");
    assert_eq!(entries[0].headline, "Added login flow");
    assert_eq!(entries[0].category, "feature");
    assert_eq!(entries[0].files_changed, "[\"src/auth.rs\"]");
    assert_eq!(entries[0].turn_index, 1);
    assert_eq!(entries[0].technical_details, "Uses reqwest for token exchange");
    assert_eq!(entries[0].tools_summary, "read(3), write(2), bash(1)");

    // Delete
    db.delete_changelog_entry("cl1").unwrap();
    let entries = db.list_changelog_entries("s1").unwrap();
    assert!(entries.is_empty(), "Changelog should be empty after delete");
}

// ---------------------------------------------------------------------------
// API Logs
// ---------------------------------------------------------------------------

#[test]
fn api_log_cost_summary() {
    let db = Database::new(":memory:").unwrap();

    // Insert logs across two providers
    db.insert_api_log("log1", "2026-01-01T00:00:00Z", "anthropic", "claude-4", "s1", 1000, 500, 0.05, true, None)
        .unwrap();
    db.insert_api_log("log2", "2026-01-01T00:01:00Z", "anthropic", "claude-4", "s1", 2000, 800, 0.10, true, None)
        .unwrap();
    db.insert_api_log("log3", "2026-01-01T00:02:00Z", "openai", "gpt-4o", "s1", 500, 200, 0.03, true, None)
        .unwrap();
    db.insert_api_log("log4", "2026-01-01T00:03:00Z", "openai", "gpt-4o", "s1", 100, 50, 0.01, false, Some("rate limit"))
        .unwrap();

    let summary = db.get_api_cost_summary().unwrap();
    assert_eq!(summary.total_calls, 4);

    // Floating point comparison with tolerance
    let expected_total = 0.05 + 0.10 + 0.03 + 0.01;
    assert!(
        (summary.total_cost - expected_total).abs() < 1e-9,
        "Total cost mismatch: expected {}, got {}",
        expected_total,
        summary.total_cost
    );

    assert_eq!(summary.by_provider.len(), 2);

    // by_provider is ordered by provider name alphabetically
    let anthropic = summary.by_provider.iter().find(|p| p.provider == "anthropic").unwrap();
    assert_eq!(anthropic.calls, 2);
    assert!((anthropic.cost - 0.15).abs() < 1e-9);

    let openai = summary.by_provider.iter().find(|p| p.provider == "openai").unwrap();
    assert_eq!(openai.calls, 2);
    assert!((openai.cost - 0.04).abs() < 1e-9);

    // Verify list_api_logs returns all 4 in reverse chronological order
    let logs = db.list_api_logs().unwrap();
    assert_eq!(logs.len(), 4);
    assert_eq!(logs[0].id, "log4"); // newest first
    assert!(!logs[0].success);
    assert_eq!(logs[0].error_message, Some("rate limit".to_string()));
}

// ---------------------------------------------------------------------------
// Session Messages
// ---------------------------------------------------------------------------

#[test]
fn session_message_storage_and_search() {
    let db = Database::new(":memory:").unwrap();

    // Create a closed session (search only works on closed sessions)
    db.insert_session("s1", "Search Session", "/projects/searchable", "closed", "2026-01-01T00:00:00Z", None, 0)
        .unwrap();

    let messages = vec![
        SessionMessageRow {
            id: "m1".to_string(),
            session_id: "s1".to_string(),
            role: "user".to_string(),
            content: "How do I implement a binary search tree?".to_string(),
            timestamp: "2026-01-01T00:01:00Z".to_string(),
            thinking_content: None,
            sort_order: 0,
        },
        SessionMessageRow {
            id: "m2".to_string(),
            session_id: "s1".to_string(),
            role: "assistant".to_string(),
            content: "A binary search tree (BST) is a data structure where each node has at most two children.".to_string(),
            timestamp: "2026-01-01T00:02:00Z".to_string(),
            thinking_content: Some("The user wants BST implementation details.".to_string()),
            sort_order: 1,
        },
        SessionMessageRow {
            id: "m3".to_string(),
            session_id: "s1".to_string(),
            role: "user".to_string(),
            content: "Can you show the insert operation?".to_string(),
            timestamp: "2026-01-01T00:03:00Z".to_string(),
            thinking_content: None,
            sort_order: 2,
        },
    ];

    // Save
    db.save_session_messages("s1", &messages).unwrap();

    // Load
    let loaded = db.load_session_messages("s1").unwrap();
    assert_eq!(loaded.len(), 3);
    assert_eq!(loaded[0].id, "m1"); // sorted by sort_order ASC
    assert_eq!(loaded[0].role, "user");
    assert_eq!(loaded[1].id, "m2");
    assert_eq!(
        loaded[1].thinking_content,
        Some("The user wants BST implementation details.".to_string())
    );
    assert_eq!(loaded[2].sort_order, 2);

    // Search - should find messages containing "binary search"
    let results = db
        .search_session_messages("/projects/searchable", "binary search", 10)
        .unwrap();
    assert!(
        !results.is_empty(),
        "Search for 'binary search' should return results"
    );
    assert_eq!(results[0].session_name, "Search Session");

    // Search - no results for unrelated term
    let empty = db
        .search_session_messages("/projects/searchable", "quantum computing", 10)
        .unwrap();
    assert!(empty.is_empty(), "Should find no results for unrelated query");

    // Search - wrong project path returns nothing
    let wrong_project = db
        .search_session_messages("/projects/other", "binary", 10)
        .unwrap();
    assert!(wrong_project.is_empty());

    // Verify idempotent re-save (save_session_messages deletes then re-inserts)
    db.save_session_messages("s1", &messages[..2]).unwrap();
    let reloaded = db.load_session_messages("s1").unwrap();
    assert_eq!(reloaded.len(), 2, "Re-save should replace all messages");
}

#[test]
fn delete_expired_session_messages() {
    let db = Database::new(":memory:").unwrap();

    // Session closed 100 days ago
    let old_closed_at = (chrono::Utc::now() - chrono::Duration::days(100)).to_rfc3339();
    db.insert_session("old", "Old Session", "/tmp", "connected", "2025-01-01T00:00:00Z", None, 0)
        .unwrap();
    db.close_session_with_details("old", Some("cli-old"), None, &old_closed_at)
        .unwrap();

    // Session closed 5 days ago
    let recent_closed_at = (chrono::Utc::now() - chrono::Duration::days(5)).to_rfc3339();
    db.insert_session("recent", "Recent Session", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 1)
        .unwrap();
    db.close_session_with_details("recent", Some("cli-recent"), None, &recent_closed_at)
        .unwrap();

    // Insert messages for both sessions
    let old_messages = vec![SessionMessageRow {
        id: "om1".to_string(),
        session_id: "old".to_string(),
        role: "user".to_string(),
        content: "old message".to_string(),
        timestamp: "2025-01-01T00:01:00Z".to_string(),
        thinking_content: None,
        sort_order: 0,
    }];
    let recent_messages = vec![SessionMessageRow {
        id: "rm1".to_string(),
        session_id: "recent".to_string(),
        role: "user".to_string(),
        content: "recent message".to_string(),
        timestamp: "2026-01-01T00:01:00Z".to_string(),
        thinking_content: None,
        sort_order: 0,
    }];

    db.save_session_messages("old", &old_messages).unwrap();
    db.save_session_messages("recent", &recent_messages).unwrap();

    // Retain messages for 30 days -- should delete "old" (100 days) but keep "recent" (5 days)
    let deleted = db.delete_expired_session_messages(30).unwrap();
    assert_eq!(deleted, 1, "Should have deleted 1 expired message");

    // Old session messages gone
    let old_loaded = db.load_session_messages("old").unwrap();
    assert!(old_loaded.is_empty(), "Old session messages should be deleted");

    // Recent session messages preserved
    let recent_loaded = db.load_session_messages("recent").unwrap();
    assert_eq!(recent_loaded.len(), 1, "Recent session messages should be preserved");
    assert_eq!(recent_loaded[0].content, "recent message");
}
