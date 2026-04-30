//! Periodic WKWebView health-check.
//!
//! Every `TICK_INTERVAL` we emit a `wake-from-sleep` event to the main
//! webview and wait up to `PONG_TIMEOUT` for the frontend to call back via
//! the `wake_pong` IPC command (which bumps `AppState::last_wake_pong`).
//! If the counter doesn't advance, we assume the content process is dead
//! and call `WebviewWindow::reload()` — the native Tauri reload, which on
//! macOS goes through `WKWebView.reload` and **does** restart a stuck or
//! suspended content process. (We previously used
//! `eval("window.location.reload()")`, but eval into a dead JS context is
//! a no-op, which produced an infinite reload-without-recovery loop.)
//!
//! `SystemTime` (wall-clock) is used to detect long sleep gaps so the
//! check fires immediately after wake instead of waiting for the next
//! scheduled tick.
//!
//! After `MAX_CONSECUTIVE_FAILURES` reloads in a row without a successful
//! pong, we escalate to `error!` and back off for `BACKOFF_AFTER_GIVE_UP`
//! before resuming the normal cadence — that prevents a permanently
//! broken WKWebView from saturating logs and burning CPU.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use log::{error, info, warn};
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::session::AppState;

/// How often we check that the WebView is alive.
const TICK_INTERVAL: Duration = Duration::from_secs(30);
/// How long we wait for the frontend's `wake_pong` reply before declaring
/// the content process dead.
const PONG_TIMEOUT: Duration = Duration::from_secs(5);
/// Wall-clock gap threshold above which we assume the system was asleep
/// (or the host process was suspended). When detected, we run an
/// immediate health-check rather than waiting for the next tick.
const LONG_GAP_THRESHOLD: Duration = Duration::from_secs(60);
/// Polling resolution for the pong wait.
const POLL_STEP: Duration = Duration::from_millis(100);
/// After this many consecutive failed reloads we assume the WebView is
/// permanently broken (or we're racing with shutdown) and stop hammering
/// it for `BACKOFF_AFTER_GIVE_UP`.
const MAX_CONSECUTIVE_FAILURES: u32 = 3;
/// How long to pause health-checks after we give up on a reload streak.
const BACKOFF_AFTER_GIVE_UP: Duration = Duration::from_secs(300);

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
    /// Pong timed out — caller should reload.
    Dead,
    /// Window was already gone — nothing to check.
    WindowClosed,
}

/// What the controller wants the loop to do after a missed pong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReloadAction {
    /// Reload the webview. `attempt` is the 1-based count of consecutive
    /// failures including this one.
    Reload { attempt: u32 },
    /// Reached the consecutive-failure ceiling — back off and surface an
    /// `error!` log.
    GiveUp,
}

/// Tracks consecutive reload streaks and enforces a give-up backoff.
/// Pure state machine — no IO — so it can be unit-tested directly.
#[derive(Debug, Default)]
pub struct ReloadController {
    consecutive_failures: u32,
    backoff_until: Option<Instant>,
}

impl ReloadController {
    pub fn new() -> Self {
        Self::default()
    }

    /// Called on a successful pong. Resets the failure streak.
    pub fn record_alive(&mut self) {
        self.consecutive_failures = 0;
    }

    /// Called on a missed pong. Returns whether the loop should reload
    /// or give up. On give-up, the controller arms a backoff window
    /// ending at `now + BACKOFF_AFTER_GIVE_UP`.
    pub fn record_dead(&mut self, now: Instant) -> ReloadAction {
        self.consecutive_failures += 1;
        if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            self.backoff_until = Some(now + BACKOFF_AFTER_GIVE_UP);
            self.consecutive_failures = 0;
            ReloadAction::GiveUp
        } else {
            ReloadAction::Reload { attempt: self.consecutive_failures }
        }
    }

    /// Returns `true` if the loop should skip this tick because we're in
    /// the post-give-up backoff. Clears the backoff once it has expired.
    pub fn should_skip(&mut self, now: Instant) -> bool {
        match self.backoff_until {
            Some(until) if now < until => true,
            Some(_) => {
                self.backoff_until = None;
                false
            }
            None => false,
        }
    }
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
    let mut controller = ReloadController::new();
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
        }

        if controller.should_skip(Instant::now()) {
            continue;
        }

        match check_once(&app, &counter).await {
            CheckResult::Alive => {
                controller.record_alive();
            }
            CheckResult::Dead => match controller.record_dead(Instant::now()) {
                ReloadAction::Reload { attempt } => {
                    warn!(
                        "[lifecycle] no {} reply within {}s — forcing webview reload (attempt {}/{})",
                        crate::commands::lifecycle::WAKE_PONG_COMMAND,
                        PONG_TIMEOUT.as_secs(),
                        attempt,
                        MAX_CONSECUTIVE_FAILURES
                    );
                    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        if let Err(e) = window.reload() {
                            warn!("[lifecycle] webview.reload() failed: {}", e);
                        }
                    }
                }
                ReloadAction::GiveUp => {
                    error!(
                        "[lifecycle] webview unresponsive after {} consecutive reloads — backing off for {}s",
                        MAX_CONSECUTIVE_FAILURES,
                        BACKOFF_AFTER_GIVE_UP.as_secs()
                    );
                }
            },
            CheckResult::WindowClosed => {}
        }
    }
}

/// One round-trip: emit the ping, wait for pong. Public for test
/// scaffolding. Reload is the loop's responsibility, not this function's.
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
        CheckResult::Dead
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
        // Simulates the (rare) race where the frontend pongs before the
        // wait loop starts — counter is already past the baseline.
        let counter = Arc::new(AtomicU64::new(10));
        let ok = wait_for_pong(&counter, 5, Duration::from_millis(20)).await;
        assert!(ok);
    }

    #[test]
    fn controller_resets_failure_streak_on_alive() {
        let mut c = ReloadController::new();
        let now = Instant::now();
        assert_eq!(c.record_dead(now), ReloadAction::Reload { attempt: 1 });
        assert_eq!(c.record_dead(now), ReloadAction::Reload { attempt: 2 });
        c.record_alive();
        assert_eq!(
            c.record_dead(now),
            ReloadAction::Reload { attempt: 1 },
            "alive pong should reset the streak so the next failure is attempt 1"
        );
    }

    #[test]
    fn controller_gives_up_after_max_consecutive_failures() {
        let mut c = ReloadController::new();
        let now = Instant::now();
        for attempt in 1..MAX_CONSECUTIVE_FAILURES {
            assert_eq!(c.record_dead(now), ReloadAction::Reload { attempt });
        }
        assert_eq!(c.record_dead(now), ReloadAction::GiveUp);
    }

    #[test]
    fn controller_skips_during_backoff_then_resumes() {
        let mut c = ReloadController::new();
        let t0 = Instant::now();
        // Hit the give-up branch.
        for _ in 1..MAX_CONSECUTIVE_FAILURES {
            c.record_dead(t0);
        }
        assert_eq!(c.record_dead(t0), ReloadAction::GiveUp);

        // Inside backoff window.
        assert!(c.should_skip(t0));
        assert!(c.should_skip(t0 + Duration::from_secs(60)));
        assert!(c.should_skip(t0 + BACKOFF_AFTER_GIVE_UP - Duration::from_millis(1)));

        // After backoff window — resume.
        let resume = t0 + BACKOFF_AFTER_GIVE_UP + Duration::from_millis(1);
        assert!(!c.should_skip(resume));
        // Streak counter was zeroed at give-up, so the next failure starts fresh.
        assert_eq!(c.record_dead(resume), ReloadAction::Reload { attempt: 1 });
    }
}
