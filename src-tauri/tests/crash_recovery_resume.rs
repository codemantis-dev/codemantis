//! Integration tests for the crash-recovery + auto-save scenario that the
//! 3,400-test suite missed pre-fix.
//!
//! The bug: a session that received its CLI init message but was never
//! explicitly closed (e.g. force-quit after an overnight white screen) used
//! to land on disk with `cli_session_id = NULL`. Both `list_crashed_sessions`
//! (which skips NULL ids) and `list_recent_closed_sessions` (which filters
//! `cli_session_id IS NOT NULL`) silently dropped it. The user's overnight
//! work appeared to vanish from the Resume Session list.
//!
//! These tests model the full lifecycle at the database boundary so a
//! regression in either persistence or the snapshot-tick promotion would
//! surface immediately.

use codemantis_lib::storage::database::Database;

/// Helper: seed a session in the on-startup state — inserted, was_open=1,
/// no CLI init yet observed (cli_session_id NULL), no close.
fn seed_active_session(db: &Database, id: &str, project: &str, created_at: &str) {
    db.insert_session(id, "Overnight work", project, "connected", created_at, None, 0, "claude_code")
        .unwrap();
    db.set_session_was_open(id, true).unwrap();
}

#[test]
fn force_quit_after_init_keeps_session_resumable() {
    // Scenario: app boots, session starts, CLI emits its first system/init
    // (so set_cli_session_id runs), user works overnight, app force-quits.
    // On next launch the session must be visible to list_crashed_sessions
    // AND must carry the CLI session id needed to resume.
    let db = Database::new(":memory:").unwrap();
    seed_active_session(&db, "overnight-1", "/repo/proj", "2026-05-09T22:00:00Z");

    // CLI's first system/init arrives — this is the new behavior under test.
    db.set_cli_session_id("overnight-1", "cli-uuid-7e3a").unwrap();

    // Simulate force-quit: drop and re-open the database. (For an in-memory
    // db, "re-opening" means a fresh Database; the persisted state under
    // test in production is what was already written. Here we just verify
    // that the writes to `sessions` are there before the simulated restart.)
    let crashed = db.list_crashed_sessions().unwrap();
    let ids: Vec<&str> = crashed.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["overnight-1"],
        "session must survive crash recovery — pre-fix this list was empty for never-closed sessions"
    );
    assert_eq!(
        crashed[0].cli_session_id.as_deref(),
        Some("cli-uuid-7e3a"),
        "CLI session id must be persisted at init time, not at close time"
    );
}

#[test]
fn force_quit_before_init_remains_unresumable() {
    // Negative case: a session that crashed before the CLI ever emitted
    // init genuinely cannot be resumed. The database layer surfaces the
    // raw row (was_open=1) but `cli_session_id` stays NULL — and the
    // `list_crashed_sessions` Tauri command (commands/session.rs) skips
    // any row without one. We assert the database invariant here; the
    // command-layer skip is exercised by its own tests.
    let db = Database::new(":memory:").unwrap();
    seed_active_session(&db, "stillborn", "/repo/proj", "2026-05-09T22:00:00Z");
    // No set_cli_session_id call — simulating a crash before init.

    let crashed = db.list_crashed_sessions().unwrap();
    assert_eq!(crashed.len(), 1, "raw was_open list must still contain the row");
    assert!(
        crashed[0].cli_session_id.is_none(),
        "cli_session_id must remain NULL — Tauri-command layer will drop it"
    );
}

#[test]
fn snapshot_tick_promotes_stale_open_to_resume_list() {
    // Scenario: session received init, ran for a while, then the user closed
    // its tab (in-memory state flipped to Closed) but the row on disk still
    // says 'connected' because no explicit close was sent. The next 60s
    // snapshot tick must promote it so it appears in the Resume Session list.
    let db = Database::new(":memory:").unwrap();
    db.insert_session(
        "ghost",
        "Yesterday's session",
        "/repo/proj",
        "connected",
        "2026-05-09T08:00:00Z",
        None,
        0,
        "claude_code",
    )
    .unwrap();
    db.set_cli_session_id("ghost", "cli-uuid-ghost").unwrap();

    // Pre-condition: not yet in Resume list (status != 'closed').
    let before = db.list_recent_closed_sessions(20).unwrap();
    assert!(
        before.iter().all(|s| s.id != "ghost"),
        "stale-open sessions must not appear in Resume list before promotion"
    );

    // Snapshot tick promotes it.
    let promoted = db
        .mark_session_closed_if_stale("ghost", "2026-05-09T08:30:00Z")
        .unwrap();
    assert!(promoted);

    // Post-condition: visible in Resume list with the right metadata.
    let after = db.list_recent_closed_sessions(20).unwrap();
    let row = after
        .iter()
        .find(|s| s.id == "ghost")
        .expect("promoted session must appear in Resume list");
    assert_eq!(row.status, "closed");
    assert_eq!(row.closed_at.as_deref(), Some("2026-05-09T08:30:00Z"));
    assert_eq!(row.cli_session_id.as_deref(), Some("cli-uuid-ghost"));
}

#[test]
fn graceful_shutdown_promotes_all_open_sessions() {
    // Scenario: user runs the app overnight with three sessions in tabs,
    // then quits via Cmd-Q in the morning without explicitly closing tabs.
    // The graceful-shutdown drain in lib.rs must promote all three so they
    // appear in tomorrow's Resume Session list.
    let db = Database::new(":memory:").unwrap();
    for (i, id) in ["a", "b", "c"].iter().enumerate() {
        db.insert_session(
            id,
            "Tab",
            "/repo",
            "connected",
            &format!("2026-05-09T0{}:00:00Z", i),
            None,
            0,
            "claude_code",
        )
        .unwrap();
        db.set_cli_session_id(id, &format!("cli-{}", id)).unwrap();
        db.set_session_was_open(id, true).unwrap();
    }
    // Also one session that was already explicitly closed yesterday — it
    // must NOT be touched by the bulk promotion.
    db.insert_session("legit", "Old", "/repo", "connected", "2026-05-08T10:00:00Z", None, 0, "claude_code")
        .unwrap();
    db.close_session_with_details("legit", Some("cli-legit"), None, "2026-05-08T11:00:00Z")
        .unwrap();

    let promoted = db.promote_open_sessions_to_closed("2026-05-10T07:00:00Z").unwrap();
    assert_eq!(promoted, 3, "exactly the three open sessions promote");

    let listed = db.list_recent_closed_sessions(20).unwrap();
    let by_id: std::collections::HashMap<_, _> = listed
        .iter()
        .map(|s| (s.id.clone(), s.closed_at.clone()))
        .collect();
    assert_eq!(by_id["a"].as_deref(), Some("2026-05-10T07:00:00Z"));
    assert_eq!(by_id["b"].as_deref(), Some("2026-05-10T07:00:00Z"));
    assert_eq!(by_id["c"].as_deref(), Some("2026-05-10T07:00:00Z"));
    // The legit close_at is preserved.
    assert_eq!(by_id["legit"].as_deref(), Some("2026-05-08T11:00:00Z"));
}

#[test]
fn promotion_does_not_clobber_explicit_close_timestamp() {
    // Defensive: if a session was explicitly closed, a later stale-promotion
    // tick must not rewrite its closed_at. The user's "1 May" entry should
    // not get bumped to today's timestamp because of an unrelated tick.
    let db = Database::new(":memory:").unwrap();
    db.insert_session("legit", "Real close", "/repo/proj", "connected", "2026-05-01T10:00:00Z", None, 0, "claude_code")
        .unwrap();
    db.close_session_with_details("legit", Some("cli-legit"), None, "2026-05-01T11:00:00Z")
        .unwrap();

    let promoted = db
        .mark_session_closed_if_stale("legit", "2026-05-09T22:00:00Z")
        .unwrap();
    assert!(!promoted);

    let row = db
        .list_recent_closed_sessions(20)
        .unwrap()
        .into_iter()
        .find(|s| s.id == "legit")
        .unwrap();
    assert_eq!(row.closed_at.as_deref(), Some("2026-05-01T11:00:00Z"));
}
