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

use codemantis_lib::storage::database::{Database, SessionMessageRow};

/// Helper: seed a session in the on-startup state — inserted, was_open=1,
/// no CLI init yet observed (cli_session_id NULL), no close.
fn seed_active_session(db: &Database, id: &str, project: &str, created_at: &str) {
    db.insert_session(id, "Overnight work", project, "connected", created_at, None, 0, "claude_code")
        .unwrap();
    db.set_session_was_open(id, true).unwrap();
}

/// Helper: persist a single stored message so the session qualifies as "real"
/// under the new empty-placeholder filter on `list_recent_closed_sessions`
/// / `list_closed_sessions_for_project`.
fn seed_one_message(db: &Database, id: &str, timestamp: &str) {
    db.save_session_messages(
        id,
        &[SessionMessageRow {
            id: format!("{}-m1", id),
            session_id: id.to_string(),
            role: "user".to_string(),
            content: "seed".to_string(),
            timestamp: timestamp.to_string(),
            thinking_content: None,
            sort_order: 0,
        }],
    )
    .unwrap();
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
    // Real session must have at least one stored message to survive the
    // empty-placeholder filter on list_recent_closed_sessions.
    seed_one_message(&db, "ghost", "2026-05-09T08:01:00Z");

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
        seed_one_message(&db, id, &format!("2026-05-09T0{}:01:00Z", i));
    }
    // Also one session that was already explicitly closed yesterday — it
    // must NOT be touched by the bulk promotion.
    db.insert_session("legit", "Old", "/repo", "connected", "2026-05-08T10:00:00Z", None, 0, "claude_code")
        .unwrap();
    db.close_session_with_details("legit", Some("cli-legit"), None, "2026-05-08T11:00:00Z")
        .unwrap();
    seed_one_message(&db, "legit", "2026-05-08T10:30:00Z");

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
    seed_one_message(&db, "legit", "2026-05-01T10:30:00Z");

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

#[test]
fn empty_placeholders_do_not_pollute_recent_list_after_promotion() {
    // Reproduces the overnight session-loss scenario:
    // 1. App runs with a mix of real sessions and empty "Claude 1" tabs the
    //    user opened but never used.
    // 2. Webview reload fires crash-recovery.
    // 3. Empty placeholders used to be promoted to status='closed' just like
    //    real sessions, polluting the Resume list with indistinguishable
    //    "Claude 1" entries.
    //
    // The defensive SQL filter on list_recent_closed_sessions /
    // list_closed_sessions_for_project must hide them even if a pre-fix DB
    // already has empty rows in status='closed'.
    let db = Database::new(":memory:").unwrap();

    // Real session with messages
    db.insert_session("real", "Spec-Forge 7", "/repo", "closed", "2026-05-26T03:00:00Z", None, 0, "claude_code").unwrap();
    db.close_session_with_details("real", Some("cli-real"), None, "2026-05-26T04:14:16Z").unwrap();
    seed_one_message(&db, "real", "2026-05-26T03:30:00Z");

    // Empty placeholder, also promoted to closed at the same instant
    // (simulating the bulk acknowledge that wrote identical timestamps).
    db.insert_session("empty", "Claude 1", "/repo", "closed", "2026-05-26T02:00:00Z", None, 0, "claude_code").unwrap();
    db.close_session_with_details("empty", Some("cli-empty"), None, "2026-05-26T04:14:16Z").unwrap();
    // NO seed_one_message — this is the "empty placeholder" condition.

    let recent = db.list_recent_closed_sessions(20).unwrap();
    let ids: Vec<&str> = recent.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, vec!["real"], "empty placeholder must not pollute the Resume list");

    let per_proj = db.list_closed_sessions_for_project("/repo", 20).unwrap();
    let pp_ids: Vec<&str> = per_proj.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(pp_ids, vec!["real"], "per-project picker must also filter empties");
}

#[test]
fn list_crashed_sessions_skips_and_cleans_empty_placeholders() {
    // The command-layer skip (commands/session.rs list_crashed_sessions) now
    // (a) excludes empty placeholders from the returned list AND
    // (b) clears their was_open flag so they don't keep being reported on
    //     every restart. This DB-level test exercises (b) by simulating the
    //     command's cleanup directly: empties get set_session_was_open(false),
    //     after which list_crashed_sessions returns only the real session.
    let db = Database::new(":memory:").unwrap();

    // Real crashed session — was_open=1, cli set, has messages
    db.insert_session("real", "Real", "/repo", "connected", "2026-05-26T01:00:00Z", None, 0, "claude_code").unwrap();
    db.set_cli_session_id("real", "cli-real").unwrap();
    db.set_session_was_open("real", true).unwrap();
    seed_one_message(&db, "real", "2026-05-26T01:30:00Z");

    // Empty placeholder — was_open=1, cli set, NO messages
    db.insert_session("empty", "Claude 1", "/repo", "connected", "2026-05-26T02:00:00Z", None, 0, "claude_code").unwrap();
    db.set_cli_session_id("empty", "cli-empty").unwrap();
    db.set_session_was_open("empty", true).unwrap();

    // Pre-cleanup snapshot: DB layer returns both (it doesn't filter).
    let before = db.list_crashed_sessions().unwrap();
    assert_eq!(before.len(), 2, "DB layer surfaces all was_open=1 rows");
    let empty_row = before.iter().find(|s| s.id == "empty").unwrap();
    assert!(!empty_row.has_stored_messages, "DB layer reports has_stored_messages correctly");

    // Simulate the command-layer cleanup: clear was_open on the empty one.
    db.set_session_was_open("empty", false).unwrap();

    let after = db.list_crashed_sessions().unwrap();
    let ids: Vec<&str> = after.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, vec!["real"], "empty placeholder is gone from next list_crashed_sessions");
}

#[test]
fn staggered_close_at_breaks_ordering_ties() {
    // Verifies the staggering contract: when multiple rows are promoted in
    // one acknowledge_crashed_sessions batch, each gets a unique closed_at
    // (1ms apart) so list_recent_closed_sessions's DESC sort produces a
    // stable, predictable order rather than depending on SQLite's row layout.
    let db = Database::new(":memory:").unwrap();
    for id in ["s1", "s2", "s3"] {
        db.insert_session(id, id, "/p", "connected", "2026-01-01T00:00:00Z", None, 0, "claude_code").unwrap();
        db.set_cli_session_id(id, &format!("cli-{}", id)).unwrap();
        seed_one_message(&db, id, "2026-01-01T00:30:00Z");
    }

    // Mimic the staggered ack: base + i ms.
    let base = chrono::DateTime::parse_from_rfc3339("2026-05-26T04:14:16Z").unwrap();
    for (i, id) in ["s1", "s2", "s3"].iter().enumerate() {
        let ts = (base + chrono::Duration::milliseconds(i as i64)).to_rfc3339();
        db.mark_session_closed_if_stale(id, &ts).unwrap();
    }

    let recent = db.list_recent_closed_sessions(20).unwrap();
    let ids: Vec<&str> = recent.iter().map(|s| s.id.as_str()).collect();
    // s3 has the largest closed_at (base + 2ms) → first in DESC; s1 the smallest → last.
    assert_eq!(ids, vec!["s3", "s2", "s1"], "ordering must follow the staggered timestamps");

    // All closed_at values are distinct — no ties.
    let mut closed_ats: Vec<String> = recent.iter().map(|s| s.closed_at.clone().unwrap()).collect();
    closed_ats.sort();
    closed_ats.dedup();
    assert_eq!(closed_ats.len(), 3, "staggering must produce unique closed_at values");
}

/// Regression for the "Spec-Forge 4 lost after dev crash" incident
/// (2026-05-26). A session created via the resume-from-history path (i.e.
/// `create_session` invoked with `resume_cli_session_id = Some(...)`) used to
/// only pass that token to the CLI spawn handle, leaving the SQLite row with
/// `cli_session_id = NULL` until the spawned process's first `system/init`
/// event reached the Tauri message router. If the dev process died in that
/// gap, the row was stranded: present, with messages, but invisible to both
/// `list_crashed_sessions` (cli_session_id IS NULL) and `list_recent_closed_
/// sessions` (cli_session_id IS NOT NULL filter). The fix in commands/session.
/// rs writes the resume token to the row immediately after `insert_session`.
///
/// We can't drive `create_session` directly from an integration test without
/// a full AppState + Tauri runtime, so we model the contract at the DB
/// boundary: after the persistence step that the fix introduces, the row
/// MUST be queryable as a recoverable session even if no `system/init`
/// arrives.
/// Regression for the "Codex hasn't responded" mislabel bug (2026-05-26):
/// the crash-recovery list MUST surface `agent_id` on each row so the
/// restored frontend `Session` can carry it through to agent-aware UI such
/// as `StuckActivityBanner`. Pre-fix `PersistedSession` dropped the column,
/// which made every recovered session render the Codex-only copy regardless
/// of the actual adapter.
#[test]
fn list_crashed_sessions_returns_agent_id_for_each_row() {
    let db = Database::new(":memory:").unwrap();

    // One Claude Code session and one Codex session, both crashed.
    db.insert_session(
        "cc-crash", "CC", "/p1", "connected", "2026-05-09T22:00:00Z", None, 0, "claude_code",
    )
    .unwrap();
    db.set_cli_session_id("cc-crash", "cli-cc").unwrap();
    db.set_session_was_open("cc-crash", true).unwrap();
    seed_one_message(&db, "cc-crash", "2026-05-09T22:01:00Z");

    db.insert_session(
        "cx-crash", "CX", "/p2", "connected", "2026-05-09T23:00:00Z", None, 0, "codex",
    )
    .unwrap();
    db.set_cli_session_id("cx-crash", "cli-cx").unwrap();
    db.set_session_was_open("cx-crash", true).unwrap();
    seed_one_message(&db, "cx-crash", "2026-05-09T23:01:00Z");

    let crashed = db.list_crashed_sessions().unwrap();
    let by_id: std::collections::HashMap<_, _> = crashed
        .iter()
        .map(|s| (s.id.clone(), s.agent_id.clone()))
        .collect();
    assert_eq!(by_id["cc-crash"], "claude_code");
    assert_eq!(by_id["cx-crash"], "codex");
}

#[test]
fn resume_session_persists_cli_session_id_at_create_time() {
    let db = Database::new(":memory:").unwrap();

    // Step 1: simulate `create_session` with resume_cli_session_id=Some(...).
    //   insert_session(was_open=0 implicit) → set_session_was_open(true)
    //   → set_cli_session_id(resume_token)   ← the new write under test
    let session_id = "resumed-456";
    let resume_token = "cli-resume-abc-123";
    db.insert_session(
        session_id,
        "Resumed Session",
        "/repo/proj",
        "starting",
        "2026-05-26T10:30:00Z",
        None,
        0,
        "claude_code",
    )
    .unwrap();
    db.set_session_was_open(session_id, true).unwrap();
    db.set_cli_session_id(session_id, resume_token).unwrap();

    // Step 2: user actually works in the session.
    seed_one_message(&db, session_id, "2026-05-26T10:30:05Z");

    // Step 3: simulate force-quit before any `system/init` arrives — status
    // stays at 'starting' (the message router never got to flip it to
    // 'connected') and closed_at is NULL.
    let crashed = db.list_crashed_sessions().unwrap();
    let row = crashed
        .iter()
        .find(|s| s.id == session_id)
        .expect("resumed session must appear in crash list");
    assert_eq!(
        row.cli_session_id.as_deref(),
        Some(resume_token),
        "resume token must be persisted at create time so list_crashed_sessions can return it"
    );
    assert!(row.has_stored_messages);

    // Step 4: after acknowledgement (the recovery banner path), the session
    // moves into Resume Session — the very thing that was broken pre-fix.
    db.mark_session_closed_if_stale(session_id, "2026-05-26T10:35:00Z").unwrap();
    let recent = db.list_recent_closed_sessions(20).unwrap();
    assert!(
        recent.iter().any(|s| s.id == session_id),
        "Resume Session must surface the recovered session — the cli_session_id binding is what unlocks the filter; got: {:?}",
        recent.iter().map(|s| &s.id).collect::<Vec<_>>()
    );
}
