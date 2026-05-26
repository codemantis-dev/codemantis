//! Integration tests for the data orchestration that powers the
//! `list_recent_sessions` Tauri command (Open Project modal — Resume Session tab).
//!
//! The Tauri command itself is a thin wrapper that combines two database
//! queries — `list_recent_closed_sessions` + `list_changelog_entries` — into
//! `SessionHistoryEntry` records. These tests verify that combination behaves
//! correctly end-to-end against a real SQLite database.

use codemantis_lib::storage::database::{Database, SessionMessageRow};

/// Helper to create a closed session with one stored message in one call.
/// As of the empty-placeholder filter (see analyse-what-happened-over-…)
/// `list_recent_closed_sessions` and `list_closed_sessions_for_project` only
/// surface sessions that actually have stored messages, so every test fixture
/// that expects a row to appear must include at least one message.
fn seed_closed_session(
    db: &Database,
    id: &str,
    name: &str,
    project_path: &str,
    closed_at: &str,
    cli_session_id: &str,
) {
    seed_closed_session_with_agent(db, id, name, project_path, closed_at, cli_session_id, "claude_code");
}

fn seed_closed_session_with_agent(
    db: &Database,
    id: &str,
    name: &str,
    project_path: &str,
    closed_at: &str,
    cli_session_id: &str,
    agent_id: &str,
) {
    db.insert_session(id, name, project_path, "closed", closed_at, None, 0, agent_id)
        .unwrap();
    db.close_session_with_details(id, Some(cli_session_id), None, closed_at)
        .unwrap();
    db.save_session_messages(
        id,
        &[SessionMessageRow {
            id: format!("{}-m1", id),
            session_id: id.to_string(),
            role: "user".to_string(),
            content: "seed".to_string(),
            timestamp: closed_at.to_string(),
            thinking_content: None,
            sort_order: 0,
        }],
    )
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
fn recent_sessions_filters_out_sessions_without_stored_messages() {
    // Updated for the empty-placeholder filter: sessions without stored
    // messages (e.g. "Claude 1" tabs the user opened but never used) are
    // no longer surfaced in the Resume list.
    let db = Database::new(":memory:").unwrap();
    // Real closed session with messages — must appear
    seed_closed_session(&db, "s-with", "With", "/proj-a", "2026-04-01T10:00:00Z", "cli-1");
    // Empty placeholder — directly insert + close without messages
    db.insert_session("s-without", "Without", "/proj-b", "closed", "2026-04-02T10:00:00Z", None, 0, "claude_code")
        .unwrap();
    db.close_session_with_details("s-without", Some("cli-2"), None, "2026-04-02T10:00:00Z")
        .unwrap();

    let rows = db.list_recent_closed_sessions(20).unwrap();
    let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, vec!["s-with"], "empty placeholder must not appear");
    assert!(rows[0].has_stored_messages);
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

/// Regression for the "lost dev sessions" bug: a session that was open when
/// the previous run crashed (status='connected', was_open=1) must still be
/// reachable through Resume Session, even if the crash-recovery banner never
/// got to acknowledge it. Without this, sessions become invisible to every
/// UI surface and the user concludes they were deleted.
#[test]
fn recent_sessions_includes_was_open_rows_alongside_closed() {
    let db = Database::new(":memory:").unwrap();

    // Cleanly closed session — the baseline case.
    seed_closed_session(&db, "clean", "Clean", "/proj-a", "2026-04-01T10:00:00Z", "cli-clean");

    // Crashed-but-unacknowledged session: status stays 'connected', was_open=1,
    // closed_at is NULL. We still seed a stored message so the
    // "has stored messages" filter is satisfied — that filter is intentional;
    // empty placeholders remain hidden by design.
    db.insert_session(
        "crashed",
        "Crashed",
        "/proj-b",
        "connected",
        "2026-04-02T10:00:00Z",
        None,
        0,
        "claude_code",
    )
    .unwrap();
    db.set_cli_session_id("crashed", "cli-crashed").unwrap();
    db.set_session_was_open("crashed", true).unwrap();
    db.save_session_messages(
        "crashed",
        &[SessionMessageRow {
            id: "crashed-m1".to_string(),
            session_id: "crashed".to_string(),
            role: "user".to_string(),
            content: "real work".to_string(),
            timestamp: "2026-04-02T10:00:01Z".to_string(),
            thinking_content: None,
            sort_order: 0,
        }],
    )
    .unwrap();

    // Global Resume list must surface BOTH rows.
    let recent = db.list_recent_closed_sessions(20).unwrap();
    let ids: Vec<&str> = recent.iter().map(|r| r.id.as_str()).collect();
    assert!(
        ids.contains(&"crashed"),
        "Resume Session must surface was_open=1 rows so crash-recovery failures stay recoverable; got {:?}",
        ids
    );
    assert!(ids.contains(&"clean"));
    // Newest first: crashed (created 04-02) before clean (closed 04-01).
    assert_eq!(ids, vec!["crashed", "clean"]);

    // Per-project list shares the fix — same query path, same predicate.
    let per_project = db.list_closed_sessions_for_project("/proj-b", 20).unwrap();
    let ids2: Vec<&str> = per_project.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids2, vec!["crashed"]);
}

/// Regression for the "Codex hasn't responded" mislabel bug: the recovery
/// chain (DB → `list_recent_closed_sessions` / `list_crashed_sessions`)
/// MUST surface each row's `agent_id`. Without it, recovered sessions arrive
/// at the frontend with `agent_id` undefined and `StuckActivityBanner` falls
/// back to a single hardcoded label.
#[test]
fn recent_sessions_surface_agent_id_per_row() {
    let db = Database::new(":memory:").unwrap();
    seed_closed_session_with_agent(
        &db, "cc-1", "CC", "/proj-a", "2026-04-01T10:00:00Z", "cli-cc", "claude_code",
    );
    seed_closed_session_with_agent(
        &db, "cx-1", "CX", "/proj-b", "2026-04-02T10:00:00Z", "cli-cx", "codex",
    );

    let rows = db.list_recent_closed_sessions(20).unwrap();
    let by_id: std::collections::HashMap<_, _> = rows
        .iter()
        .map(|r| (r.id.clone(), r.agent_id.clone()))
        .collect();
    assert_eq!(by_id["cc-1"], "claude_code");
    assert_eq!(by_id["cx-1"], "codex");

    // Per-project query reads through the same code path; verify both.
    let per_a = db.list_closed_sessions_for_project("/proj-a", 20).unwrap();
    assert_eq!(per_a[0].agent_id, "claude_code");
    let per_b = db.list_closed_sessions_for_project("/proj-b", 20).unwrap();
    assert_eq!(per_b[0].agent_id, "codex");
}

/// Conversely: a `was_open=1` row with NO stored messages stays hidden. The
/// has-stored-messages filter is the existing line of defence against empty
/// placeholder pollution and the Bug-1 fix MUST NOT widen it accidentally.
#[test]
fn recent_sessions_still_excludes_was_open_rows_without_messages() {
    let db = Database::new(":memory:").unwrap();
    db.insert_session(
        "empty-crashed",
        "Empty Crashed",
        "/proj-c",
        "connected",
        "2026-04-03T10:00:00Z",
        None,
        0,
        "claude_code",
    )
    .unwrap();
    db.set_cli_session_id("empty-crashed", "cli-empty").unwrap();
    db.set_session_was_open("empty-crashed", true).unwrap();
    // No save_session_messages call — this is the empty-placeholder case.

    let recent = db.list_recent_closed_sessions(20).unwrap();
    assert!(
        recent.is_empty(),
        "was_open=1 rows without stored messages must stay hidden; got {:?}",
        recent.iter().map(|r| &r.id).collect::<Vec<_>>()
    );
}
