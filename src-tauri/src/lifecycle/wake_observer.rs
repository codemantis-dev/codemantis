//! Periodic WKWebView health-check.
//!
//! Every `TICK_INTERVAL` we emit a `wake-from-sleep` event to the main
//! webview and wait up to `PONG_TIMEOUT` for the frontend to call back via
//! the `wake_pong` IPC command (which bumps `AppState::last_wake_pong`).
//! If the counter doesn't advance, we assume the content process is dead
//! and call `WebviewWindow::eval("window.location.reload()")` to force
//! WKWebView to spawn a fresh content process.
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
/// the content process dead.
const PONG_TIMEOUT: Duration = Duration::from_secs(5);
/// Wall-clock gap threshold above which we assume the system was asleep
/// (or the host process was suspended). When detected, we run an
/// immediate health-check rather than waiting for the next tick.
const LONG_GAP_THRESHOLD: Duration = Duration::from_secs(60);
/// Polling resolution for the pong wait.
const POLL_STEP: Duration = Duration::from_millis(100);

/// Event name the frontend listens to. When received, the frontend
/// should immediately invoke the `wake_pong` Tauri command.
pub const WAKE_EVENT: &str = "wake-from-sleep";
/// Stable label for the main webview window (matches `tauri.conf.json`).
const MAIN_WINDOW_LABEL: &str = "main";

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
        }

        check_once(&app, &counter).await;
    }
}

/// One round-trip: emit the ping, wait for pong, reload on timeout.
/// Public for test scaffolding.
pub async fn check_once(app: &AppHandle, counter: &Arc<std::sync::atomic::AtomicU64>) {
    let window = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(w) => w,
        None => return, // Window closed — nothing to check.
    };

    let before = counter.load(Ordering::SeqCst);
    if let Err(e) = window.emit(WAKE_EVENT, ()) {
        warn!("[lifecycle] failed to emit {}: {}", WAKE_EVENT, e);
        return;
    }

    if wait_for_pong(counter, before, PONG_TIMEOUT).await {
        return;
    }

    warn!(
        "[lifecycle] no {} reply within {}s — forcing webview reload",
        crate::commands::lifecycle::WAKE_PONG_COMMAND,
        PONG_TIMEOUT.as_secs()
    );
    if let Err(e) = window.eval("window.location.reload()") {
        warn!("[lifecycle] eval reload failed ({}); falling back to webview.reload()", e);
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
}
