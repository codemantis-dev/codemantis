//! Integration tests for the wake-recovery reload signalling that lives in
//! `AppState.wake_recovery_reload` and the helpers in
//! `crate::lifecycle::wake_observer::suppression_for_tick`.
//!
//! The scenario these tests model: the user's Mac sleeps with several
//! Claude / Codex sessions open, the WKWebView's WebContent process
//! hangs after wake, and the Rust wake observer eventually fires its
//! last-resort `WebviewWindow::reload()`. The Rust backend (and the
//! per-session CLI subprocesses) stays alive; the wake_recovery_reload
//! flag tells the post-reload frontend to take the re-attach path
//! (`list_live_sessions` + listener rebind) instead of routing every
//! session through the Resume list as if it were a crash.

use std::sync::atomic::Ordering;
use std::time::Duration;

use codemantis_lib::lifecycle::wake_observer::{suppression_for_tick, SuppressReason};
use codemantis_lib::storage::database::Database;
use codemantis_lib::testing_exports::AppState;

fn fresh_state() -> AppState {
    let db = Database::new(":memory:").expect("open in-memory db");
    AppState::new(db)
}

#[test]
fn wake_recovery_flag_starts_unset() {
    // A freshly booted backend has never reloaded for wake recovery, so
    // the first consume_wake_recovery_flag() call must observe `false`
    // and the post-reload frontend takes the normal crash-recovery path.
    let state = fresh_state();
    assert!(!state.wake_recovery_reload.load(Ordering::SeqCst));
}

#[test]
fn wake_recovery_flag_swap_is_read_once() {
    // The wake observer sets the flag before WebviewWindow::reload().
    // The post-reload frontend must read it exactly once — a second
    // caller during the same boot (e.g. a duplicate hydration pass)
    // must observe `false` so re-attach happens exactly once.
    let state = fresh_state();
    state.wake_recovery_reload.store(true, Ordering::SeqCst);

    let first = state.wake_recovery_reload.swap(false, Ordering::SeqCst);
    let second = state.wake_recovery_reload.swap(false, Ordering::SeqCst);

    assert!(first, "first reader must observe the flag");
    assert!(!second, "second reader must observe the cleared flag");
    assert!(!state.wake_recovery_reload.load(Ordering::SeqCst));
}

#[test]
fn wake_recovery_flag_survives_multiple_swap_cycles() {
    // Two wake-recovery reloads in the lifetime of one backend (long
    // session, two distinct sleep/wake events that both hung WebContent
    // past the reload threshold) must each surface to the frontend
    // independently.
    let state = fresh_state();

    state.wake_recovery_reload.store(true, Ordering::SeqCst);
    assert!(state.wake_recovery_reload.swap(false, Ordering::SeqCst));

    state.wake_recovery_reload.store(true, Ordering::SeqCst);
    assert!(state.wake_recovery_reload.swap(false, Ordering::SeqCst));
}

#[test]
fn sleep_state_defaults_to_awake() {
    // is_system_asleep starts `false` — the wake observer's suppression
    // check only fires once the NSWorkspaceWillSleep notification flips
    // this. Wake observer running on a never-slept machine must escalate
    // normally on a genuine WebContent hang.
    let state = fresh_state();
    assert!(!state.is_system_asleep.load(Ordering::SeqCst));
    assert_eq!(state.last_wake_at_epoch.load(Ordering::SeqCst), 0);
}

#[test]
fn suppression_during_sleep_blocks_escalation() {
    // NSWorkspaceWillSleepNotification flipped is_system_asleep. Every
    // missed pong while sleeping must be suppressed — the kernel paused
    // WebContent; it physically cannot pong.
    let r = suppression_for_tick(true, 0, Duration::from_secs(30), 1_700_000_000);
    assert_eq!(r, Some(SuppressReason::SystemAsleep));
}

#[test]
fn suppression_during_post_wake_grace_blocks_escalation() {
    // 10 seconds after NSWorkspaceDidWakeNotification: WebContent is
    // typically mid-thaw. The May 2026 incident escalated through this
    // window all the way to a reload — exactly what the grace prevents.
    let r = suppression_for_tick(
        false,
        1_700_000_000,
        Duration::from_secs(30),
        1_700_000_010,
    );
    assert_eq!(r, Some(SuppressReason::PostWakeGrace));
}

#[test]
fn suppression_falls_back_to_wall_clock_when_nsworkspace_silent() {
    // Defensive: NSWorkspace observer didn't fire (e.g. the observer
    // missed the notification, non-macOS build, or a paranoid timing
    // edge), but the tokio::sleep clearly noticed a multi-minute gap.
    // We still want suppression — otherwise the very first post-wake
    // tick counts against the reload threshold.
    let r = suppression_for_tick(
        false,
        0,
        Duration::from_secs(120),
        1_700_000_000,
    );
    assert_eq!(r, Some(SuppressReason::WallClockGap));
}

#[test]
fn suppression_returns_none_on_normal_tick() {
    // Regression guard against accidentally suppressing every tick.
    // A normal 30s tick with no sleep evidence must escalate as before.
    let r = suppression_for_tick(false, 0, Duration::from_secs(30), 1_700_000_000);
    assert_eq!(r, None);
}
