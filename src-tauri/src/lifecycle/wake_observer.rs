//! Periodic WKWebView liveness check.
//!
//! Every `TICK_INTERVAL` we emit a `wake-from-sleep` event to the main
//! webview and wait up to `PONG_TIMEOUT` for the frontend to call back via
//! the `wake_pong` IPC command (which bumps `AppState::last_wake_pong`).
//!
//! On a missed pong we invoke [`super::repaint::force_repaint_main`],
//! which calls `setNeedsDisplay:YES` on the content `NSView`. That is
//! non-destructive — it asks AppKit to redraw, which in practice
//! re-establishes the `IOSurface` compositing layer if it was torn down
//! during a long screen-lock. **No page reload, no React re-mount, no
//! state loss.**
//!
//! Previous iterations of this loop reloaded the webview on a missed
//! pong. That worked when the JS context was genuinely dead, but it also
//! fired on every Mac unlock where the renderer was just briefly slow to
//! pong, kicking the user back to the start screen. With the bundle-
//! level App Nap opt-out (`NSAppSleepDisabled`) and the activity
//! assertion in [`super::activity_assertion`], the renderer should
//! rarely if ever miss a pong — and when it does, repaint is the right
//! response, not a destructive reload.
//!
//! `SystemTime` (wall-clock) is used to detect long sleep gaps so the
//! check fires immediately after wake instead of waiting for the next
//! scheduled tick.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use log::{info, warn};
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::session::AppState;

/// How often we check that the WebView is alive.
const TICK_INTERVAL: Duration = Duration::from_secs(30);
/// How long we wait for the frontend's `wake_pong` reply before declaring
/// the content process unresponsive and triggering a repaint.
const PONG_TIMEOUT: Duration = Duration::from_secs(10);
/// Wall-clock gap threshold above which we assume the system was asleep
/// (or the host process was suspended). When detected, we run an
/// immediate liveness check rather than waiting for the next tick.
const LONG_GAP_THRESHOLD: Duration = Duration::from_secs(60);
/// Polling resolution for the pong wait.
const POLL_STEP: Duration = Duration::from_millis(100);

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
    /// Pong timed out — caller should repaint.
    Stale,
    /// Window was already gone — nothing to check.
    WindowClosed,
}

/// Spawn the periodic health-check loop. Idempotent at the call site —
/// callers should invoke once during `.setup`.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        run_loop(app).await;
    });
}

async fn run_loop(app: AppHandle) {
    let counter = match app.try_state::<AppState>() {
        Some(state) => state.last_wake_pong.clone(),
        None => {
            warn!("[lifecycle] AppState unavailable — health-check loop exiting");
            return;
        }
    };

    let mut last_tick = SystemTime::now();
    loop {
        tokio::time::sleep(TICK_INTERVAL).await;
        let now = SystemTime::now();
        let elapsed = now.duration_since(last_tick).unwrap_or_default();
        last_tick = now;

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
                crate::commands::lifecycle::write_diagnostic_log("wake", "rs:check-alive");
            }
            CheckResult::Stale => {
                info!(
                    "[lifecycle] no {} reply within {}s — nudging webview to repaint",
                    crate::commands::lifecycle::WAKE_PONG_COMMAND,
                    PONG_TIMEOUT.as_secs()
                );
                crate::commands::lifecycle::write_diagnostic_log(
                    "wake",
                    &format!("rs:stale-pong | timeout_s={}", PONG_TIMEOUT.as_secs()),
                );
                super::repaint::force_repaint_main(&app);
                crate::commands::lifecycle::write_diagnostic_log("wake", "rs:repaint-issued");
            }
            CheckResult::WindowClosed => {
                crate::commands::lifecycle::write_diagnostic_log("wake", "rs:window-closed");
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
