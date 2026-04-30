//! App lifecycle plumbing.
//!
//! Detects when the WKWebView content process becomes unresponsive — most
//! commonly after a long macOS sleep / lock — and forces a native reload
//! (`WebviewWindow::reload`, which goes through `WKWebView.reload` on
//! macOS) so the window doesn't get stuck on a blank, unmovable canvas.
//! With `titleBarStyle: "Overlay"` the entire drag region is the WebView,
//! so a dead content process makes the whole window appear frozen.
//!
//! The recovery loop bounds itself: after `MAX_CONSECUTIVE_FAILURES`
//! reloads in a row without a successful pong it backs off, to avoid the
//! reload-without-recovery storm that earlier `eval`-based attempts
//! produced.

pub mod wake_observer;
