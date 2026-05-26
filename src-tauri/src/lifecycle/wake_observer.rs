//! Periodic WKWebView liveness check with graduated recovery.
//!
//! Every `TICK_INTERVAL` we emit a `wake-from-sleep` event to the main
//! webview and wait up to `PONG_TIMEOUT` for the frontend to call back via
//! the `wake_pong` IPC command (which bumps `AppState::last_wake_pong`).
//!
//! On a missed pong we run [`recovery_action_for`] against the current
//! consecutive-stale count and apply the matching action:
//!
//! - **1 stale tick** → `setNeedsDisplay:` on the content `NSView`. Cheap
//!   AppKit nudge; sufficient when only the IOSurface compositing layer
//!   was briefly torn down but the WebContent process is still alive.
//! - **2–4 consecutive stale ticks** → repaint **plus** evaluate a no-op
//!   JS expression in the webview. `setNeedsDisplay:` runs on the
//!   AppKit side of *our* process; the WebContent renderer is a
//!   separate XPC service that can be suspended independently. Posting
//!   work via `WebviewWindow::eval` is the supported way to force
//!   WebKit to schedule that process.
//! - **5+ consecutive stale ticks (~3 min of dead JS)** → fall back to
//!   `WebviewWindow::reload()`. Destructive (drops in-memory UI state),
//!   but at this point the renderer has been frozen for minutes and is
//!   not coming back on its own. After a reload we reset the counter so
//!   the next tick starts the recovery sequence fresh.
//!
//! ### Why this matters — May 2026 incident
//! For ~73 minutes after a multi-hour screensaver session, the loop
//! logged 109 consecutive `rs:stale-pong → rs:repaint-issued` cycles
//! with no recovery. The earlier "repaint-only" recovery (commit
//! `688e3d9`) was tuned for *short* post-unlock thaws and structurally
//! cannot revive a suspended WebContent process — `setNeedsDisplay:`
//! has no work for the XPC renderer to do. The graduated path adds the
//! `eval` nudge (which does), and falls back to `reload()` only when
//! several minutes of `eval` haven't worked either.
//!
//! `SystemTime` (wall-clock) is used to detect long sleep gaps so the
//! check fires immediately after wake instead of waiting for the next
//! scheduled tick.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{info, warn};
use tauri::{AppHandle, Emitter, Manager};

use crate::agents::claude_code::session::AppState;

/// How often we check that the WebView is alive.
const TICK_INTERVAL: Duration = Duration::from_secs(30);
/// How long we wait for the frontend's `wake_pong` reply before declaring
/// the content process unresponsive and triggering a recovery action.
const PONG_TIMEOUT: Duration = Duration::from_secs(10);
/// Wall-clock gap threshold above which we assume the system was asleep
/// (or the host process was suspended). When detected, we run an
/// immediate liveness check rather than waiting for the next tick.
const LONG_GAP_THRESHOLD: Duration = Duration::from_secs(60);
/// Grace window after wake (from either `NSWorkspaceDidWakeNotification`
/// or a wall-clock gap) during which we treat missed pongs as expected.
/// The WKWebView's WebContent XPC service routinely takes 10–30 s to
/// thaw after a real macOS sleep; counting those ticks against the
/// reload threshold causes spurious last-resort reloads. See the May
/// 2026 "wake-observer reloaded a recovering webview" incident behind
/// `~/.claude/plans/why-did-codemantis-crash-gentle-elephant.md`.
const POST_WAKE_GRACE: Duration = Duration::from_secs(45);
/// Polling resolution for the pong wait.
const POLL_STEP: Duration = Duration::from_millis(100);
/// Consecutive stale ticks at which we escalate from a cheap repaint to
/// also evaluating a no-op JS expression to wake the WebContent process.
const STALE_BEFORE_EVAL: u32 = 2;
/// Consecutive stale ticks at which we give up on non-destructive
/// recovery and reload the webview. ~3 min of dead JS at the default
/// 40 s tick+timeout cadence — well past any normal post-unlock thaw,
/// short enough that the user doesn't sit through hours of white screen.
const STALE_BEFORE_RELOAD: u32 = 5;

/// Event name the frontend listens to. When received, the frontend
/// should immediately invoke the `wake_pong` Tauri command.
pub const WAKE_EVENT: &str = "wake-from-sleep";
/// Stable label for the main webview window (matches `tauri.conf.json`).
const MAIN_WINDOW_LABEL: &str = "main";

/// Outcome of a single health-check round-trip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckResult {
    /// Frontend pong was observed before the timeout.
    Alive,
    /// Pong timed out — caller should run a recovery action.
    Stale,
    /// Window was already gone — nothing to check.
    WindowClosed,
}

/// What we do in response to a stale pong, indexed by how many
/// consecutive stale ticks we've already seen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryAction {
    /// `setNeedsDisplay:` on the content NSView. AppKit-side only; cheap.
    Repaint,
    /// Repaint **and** evaluate a no-op JS expression in the webview.
    /// The eval forces WebKit to schedule the WebContent process, which
    /// `setNeedsDisplay:` cannot do (the renderer lives in a separate
    /// XPC service).
    RepaintAndEval,
    /// Last resort. `WebviewWindow::reload()` — destroys in-memory UI
    /// state but reliably revives a WebContent process that has been
    /// suspended for minutes.
    Reload,
}

/// Map a consecutive-stale count to the recovery action to take. Pure
/// function so the thresholds can be unit-tested without spinning up an
/// AppHandle.
///
/// `consecutive` is **the count after this stale tick is recorded** —
/// i.e. `1` means "first stale tick of a run", not "we've already had
/// one and now there's another."
pub fn recovery_action_for(consecutive: u32) -> RecoveryAction {
    if consecutive >= STALE_BEFORE_RELOAD {
        RecoveryAction::Reload
    } else if consecutive >= STALE_BEFORE_EVAL {
        RecoveryAction::RepaintAndEval
    } else {
        RecoveryAction::Repaint
    }
}

/// Why a stale-pong tick is being treated as expected (no escalation).
/// Returned by [`suppression_for_tick`] so the diagnostic breadcrumb can
/// record which signal triggered the suppression.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuppressReason {
    /// `NSWorkspaceWillSleepNotification` fired and `DidWake` hasn't yet.
    SystemAsleep,
    /// Within `POST_WAKE_GRACE` of an `NSWorkspaceDidWakeNotification`.
    PostWakeGrace,
    /// Fallback: NSWorkspace observer didn't fire (e.g. the macOS-only
    /// observer was unavailable, or the notification was delivered after
    /// our first post-wake tick), but the wall-clock elapsed for this
    /// tick is so long that a sleep almost certainly happened.
    WallClockGap,
}

/// Decide whether the current tick falls inside a known sleep / post-wake
/// window — in which case a missed pong should not count against the
/// reload escalation counter. Pure function so the policy is testable
/// without spinning up an AppHandle or an NSWorkspace.
///
/// `now_epoch` is the current Unix-epoch seconds; passing it in (vs
/// reading `SystemTime::now()` inside) keeps the function deterministic
/// for tests.
pub fn suppression_for_tick(
    is_asleep: bool,
    last_wake_at_epoch: i64,
    elapsed: Duration,
    now_epoch: i64,
) -> Option<SuppressReason> {
    if is_asleep {
        return Some(SuppressReason::SystemAsleep);
    }
    if last_wake_at_epoch > 0 {
        let since_wake_s = now_epoch.saturating_sub(last_wake_at_epoch);
        if since_wake_s >= 0
            && Duration::from_secs(since_wake_s as u64) < POST_WAKE_GRACE
        {
            return Some(SuppressReason::PostWakeGrace);
        }
    }
    if elapsed > LONG_GAP_THRESHOLD {
        return Some(SuppressReason::WallClockGap);
    }
    None
}

/// Spawn the periodic health-check loop. Idempotent at the call site —
/// callers should invoke once during `.setup`.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        run_loop(app).await;
    });
}

async fn run_loop(app: AppHandle) {
    let (counter, is_asleep, last_wake_at) = match app.try_state::<AppState>() {
        Some(state) => (
            state.last_wake_pong.clone(),
            state.is_system_asleep.clone(),
            state.last_wake_at_epoch.clone(),
        ),
        None => {
            warn!("[lifecycle] AppState unavailable — health-check loop exiting");
            return;
        }
    };

    let mut last_tick = SystemTime::now();
    let mut consecutive_stale: u32 = 0;
    loop {
        tokio::time::sleep(TICK_INTERVAL).await;
        let now = SystemTime::now();
        let elapsed = now.duration_since(last_tick).unwrap_or_default();
        last_tick = now;
        let now_epoch = now
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        if elapsed > LONG_GAP_THRESHOLD {
            info!(
                "[lifecycle] wall-clock gap of {}s detected — system likely woke from sleep",
                elapsed.as_secs()
            );
            crate::commands::lifecycle::write_diagnostic_log(
                "wake",
                &format!("rs:long-gap | gap_s={}", elapsed.as_secs()),
            );
        }

        match check_once(&app, &counter).await {
            CheckResult::Alive => {
                consecutive_stale = 0;
                crate::commands::lifecycle::write_diagnostic_log("wake", "rs:check-alive");
            }
            CheckResult::Stale => {
                // Before counting this against the escalation threshold,
                // check whether we're in a known sleep / post-wake window.
                // A WKWebView's WebContent XPC service routinely needs
                // 10–30 s to thaw after a real macOS sleep — counting
                // those ticks against STALE_BEFORE_RELOAD caused the
                // May 2026 incident where the observer reloaded a
                // recovering webview.
                if let Some(reason) = suppression_for_tick(
                    is_asleep.load(Ordering::SeqCst),
                    last_wake_at.load(Ordering::SeqCst),
                    elapsed,
                    now_epoch,
                ) {
                    consecutive_stale = 0;
                    info!(
                        "[lifecycle] missed pong suppressed ({:?}) — not escalating",
                        reason
                    );
                    crate::commands::lifecycle::write_diagnostic_log(
                        "wake",
                        &format!("rs:stale-suppressed | reason={:?}", reason),
                    );
                    continue;
                }

                consecutive_stale = consecutive_stale.saturating_add(1);
                crate::commands::lifecycle::write_diagnostic_log(
                    "wake",
                    &format!(
                        "rs:stale-pong | timeout_s={} | streak={}",
                        PONG_TIMEOUT.as_secs(),
                        consecutive_stale
                    ),
                );
                let action = recovery_action_for(consecutive_stale);
                run_recovery(&app, action);
                if matches!(action, RecoveryAction::Reload) {
                    // After a reload the renderer is being torn down and
                    // re-built; the next few ticks could legitimately
                    // miss while it boots. Reset so we don't immediately
                    // schedule another reload on the very next stale.
                    consecutive_stale = 0;
                }
            }
            CheckResult::WindowClosed => {
                crate::commands::lifecycle::write_diagnostic_log("wake", "rs:window-closed");
            }
        }
    }
}

/// Apply the chosen recovery action against the main webview. Each
/// branch logs an `rs:*` breadcrumb to `wake.log` so post-incident
/// triage (see the May 2026 incident in the module docs) can reconstruct
/// exactly which path fired.
fn run_recovery(app: &AppHandle, action: RecoveryAction) {
    match action {
        RecoveryAction::Repaint => {
            info!(
                "[lifecycle] no {} reply within {}s — nudging webview to repaint",
                crate::commands::lifecycle::WAKE_PONG_COMMAND,
                PONG_TIMEOUT.as_secs()
            );
            super::repaint::force_repaint_main(app);
            crate::commands::lifecycle::write_diagnostic_log("wake", "rs:repaint-issued");
        }
        RecoveryAction::RepaintAndEval => {
            info!(
                "[lifecycle] missed pong escalation: repaint + JS eval to wake WebContent"
            );
            super::repaint::force_repaint_main(app);
            crate::commands::lifecycle::write_diagnostic_log("wake", "rs:repaint-issued");
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                // No-op expression. Whatever WebKit does with it, posting
                // any JS to the webview forces it to schedule the
                // suspended WebContent process.
                match window.eval("void 0") {
                    Ok(()) => crate::commands::lifecycle::write_diagnostic_log(
                        "wake",
                        "rs:eval-nudge",
                    ),
                    Err(e) => {
                        warn!("[lifecycle] eval-nudge failed: {}", e);
                        crate::commands::lifecycle::write_diagnostic_log(
                            "wake",
                            &format!("rs:eval-nudge-failed | error={}", e),
                        );
                    }
                }
            } else {
                crate::commands::lifecycle::write_diagnostic_log(
                    "wake",
                    "rs:eval-nudge-skipped | reason=window-missing",
                );
            }
        }
        RecoveryAction::Reload => {
            warn!(
                "[lifecycle] {} consecutive missed pongs — reloading webview as last resort",
                STALE_BEFORE_RELOAD
            );
            // Signal the post-reload frontend that this is a wake-recovery,
            // not a fresh launch: the Rust backend (and its per-session CLI
            // subprocesses in `AppState.processes`) is still alive, so the
            // boot path should re-attach via `list_live_sessions` rather
            // than routing every session through the Resume list. Set the
            // flag *before* reload() so a race-fast frontend that pongs
            // back during reload still observes it on its first IPC call.
            if let Some(state) = app.try_state::<AppState>() {
                state
                    .wake_recovery_reload
                    .store(true, Ordering::SeqCst);
            } else {
                warn!("[lifecycle] AppState missing — cannot set wake_recovery_reload flag");
            }
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                match window.reload() {
                    Ok(()) => crate::commands::lifecycle::write_diagnostic_log(
                        "wake",
                        "rs:reload-issued",
                    ),
                    Err(e) => {
                        warn!("[lifecycle] reload failed: {}", e);
                        crate::commands::lifecycle::write_diagnostic_log(
                            "wake",
                            &format!("rs:reload-failed | error={}", e),
                        );
                    }
                }
            } else {
                crate::commands::lifecycle::write_diagnostic_log(
                    "wake",
                    "rs:reload-skipped | reason=window-missing",
                );
            }
        }
    }
}

/// One round-trip: emit the ping, wait for pong. Public for test
/// scaffolding. Repaint is the loop's responsibility, not this function's.
pub async fn check_once(
    app: &AppHandle,
    counter: &Arc<std::sync::atomic::AtomicU64>,
) -> CheckResult {
    let window = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(w) => w,
        None => return CheckResult::WindowClosed,
    };

    let before = counter.load(Ordering::SeqCst);
    if let Err(e) = window.emit(WAKE_EVENT, ()) {
        warn!("[lifecycle] failed to emit {}: {}", WAKE_EVENT, e);
        return CheckResult::WindowClosed;
    }

    if wait_for_pong(counter, before, PONG_TIMEOUT).await {
        CheckResult::Alive
    } else {
        CheckResult::Stale
    }
}

/// Polls the atomic until it advances past `baseline` or the timeout
/// elapses. Returns `true` if a pong was observed.
async fn wait_for_pong(
    counter: &Arc<std::sync::atomic::AtomicU64>,
    baseline: u64,
    timeout: Duration,
) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if counter.load(Ordering::SeqCst) > baseline {
            return true;
        }
        tokio::time::sleep(POLL_STEP).await;
    }
    counter.load(Ordering::SeqCst) > baseline
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    #[tokio::test]
    async fn wait_for_pong_returns_true_when_counter_advances() {
        let counter = Arc::new(AtomicU64::new(7));
        let probe = counter.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            probe.store(8, Ordering::SeqCst);
        });
        let ok = wait_for_pong(&counter, 7, Duration::from_millis(500)).await;
        assert!(ok, "expected pong to be detected");
    }

    #[tokio::test]
    async fn wait_for_pong_returns_false_on_timeout() {
        let counter = Arc::new(AtomicU64::new(3));
        let ok = wait_for_pong(&counter, 3, Duration::from_millis(50)).await;
        assert!(!ok, "expected timeout when counter never advances");
    }

    #[tokio::test]
    async fn wait_for_pong_returns_true_if_counter_already_advanced() {
        // The (rare) race where the frontend pongs before the wait loop
        // starts — counter is already past the baseline.
        let counter = Arc::new(AtomicU64::new(10));
        let ok = wait_for_pong(&counter, 5, Duration::from_millis(20)).await;
        assert!(ok);
    }

    #[test]
    fn recovery_action_first_stale_is_repaint_only() {
        // The original "post-unlock thaw" case the previous fix targeted:
        // a single missed tick should stay non-destructive.
        assert_eq!(recovery_action_for(1), RecoveryAction::Repaint);
    }

    #[test]
    fn recovery_action_escalates_to_eval_at_threshold() {
        assert_eq!(
            recovery_action_for(STALE_BEFORE_EVAL),
            RecoveryAction::RepaintAndEval
        );
        assert_eq!(
            recovery_action_for(STALE_BEFORE_EVAL + 1),
            RecoveryAction::RepaintAndEval
        );
        // And stays there until the reload threshold.
        assert_eq!(
            recovery_action_for(STALE_BEFORE_RELOAD - 1),
            RecoveryAction::RepaintAndEval
        );
    }

    #[test]
    fn recovery_action_falls_back_to_reload_after_persistent_failure() {
        assert_eq!(
            recovery_action_for(STALE_BEFORE_RELOAD),
            RecoveryAction::Reload
        );
        assert_eq!(recovery_action_for(50), RecoveryAction::Reload);
        // Forensic guard: the May 2026 incident logged 109 consecutive
        // stale ticks. At our thresholds that's firmly Reload territory.
        assert_eq!(recovery_action_for(109), RecoveryAction::Reload);
    }

    #[test]
    fn reload_threshold_is_high_enough_to_avoid_unlock_churn() {
        // Regression guard against re-introducing the
        // reload-on-every-unlock behaviour that commit 688e3d9 explicitly
        // removed. STALE_BEFORE_RELOAD must be high enough that an
        // ordinary post-unlock thaw cannot reach it. At 30s tick + 10s
        // pong timeout, hitting Reload requires ≥ ~3 minutes of dead JS.
        // Wrapped in `const { … }` so clippy doesn't flag the
        // compile-time-known comparison and so a future bad tuning fails
        // the build, not just the test run.
        const { assert!(STALE_BEFORE_RELOAD >= 4) };
        const { assert!(STALE_BEFORE_EVAL < STALE_BEFORE_RELOAD) };
    }

    #[test]
    fn suppression_fires_while_system_asleep() {
        // NSWorkspaceWillSleep set the flag and DidWake hasn't reset it.
        // Every missed pong in this state must be suppressed — the
        // kernel paused the WebContent process; it physically cannot pong.
        let r = suppression_for_tick(true, 0, Duration::from_secs(30), 1_700_000_000);
        assert_eq!(r, Some(SuppressReason::SystemAsleep));
    }

    #[test]
    fn suppression_fires_during_post_wake_grace() {
        // Wake stamped 10s ago; POST_WAKE_GRACE is 45s. WebContent
        // routinely takes 10–30s to thaw — we want zero escalation here.
        let r = suppression_for_tick(
            false,
            1_700_000_000,
            Duration::from_secs(30),
            1_700_000_010,
        );
        assert_eq!(r, Some(SuppressReason::PostWakeGrace));
    }

    #[test]
    fn suppression_ends_after_post_wake_grace_expires() {
        // Wake stamped POST_WAKE_GRACE seconds ago — grace expired.
        // A genuine hang past this point should escalate normally.
        let now = 1_700_000_000;
        let waked_at = now - POST_WAKE_GRACE.as_secs() as i64 - 1;
        let r = suppression_for_tick(false, waked_at, Duration::from_secs(30), now);
        assert_eq!(r, None);
    }

    #[test]
    fn suppression_fires_on_wall_clock_gap_when_nsworkspace_silent() {
        // Fallback path: NSWorkspace observer didn't fire (non-macOS
        // build, or notification raced past our first post-wake tick),
        // but the tick's wall-clock elapsed is so long that a sleep
        // almost certainly happened.
        let r = suppression_for_tick(
            false,
            0,
            LONG_GAP_THRESHOLD + Duration::from_secs(1),
            1_700_000_000,
        );
        assert_eq!(r, Some(SuppressReason::WallClockGap));
    }

    #[test]
    fn suppression_returns_none_for_normal_tick() {
        // The hot path: nothing weird about this tick. The caller should
        // escalate exactly as before. Regression guard against accidentally
        // suppressing every stale pong.
        let r = suppression_for_tick(false, 0, Duration::from_secs(30), 1_700_000_000);
        assert_eq!(r, None);
    }

    #[test]
    fn suppression_handles_clock_skew_without_panicking() {
        // last_wake_at_epoch > now_epoch (clock skew or NTP step back).
        // `since_wake_s` would be negative — guard against ambiguous
        // suppression (we conservatively do NOT suppress).
        let r = suppression_for_tick(
            false,
            1_700_000_100,
            Duration::from_secs(30),
            1_700_000_000,
        );
        assert_eq!(r, None);
    }

    #[test]
    fn pong_timeout_is_long_enough_for_post_unlock_thaw() {
        // Regression guard: we want at least 10s here. Earlier values
        // (5s) were aggressive enough that ordinary post-unlock renderer
        // thaw missed the window and tripped a destructive reload.
        assert!(
            PONG_TIMEOUT >= Duration::from_secs(10),
            "PONG_TIMEOUT should be ≥10s to tolerate post-unlock thaw, got {}s",
            PONG_TIMEOUT.as_secs()
        );
    }
}
