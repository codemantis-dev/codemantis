//! App lifecycle plumbing.
//!
//! Three pieces, all aimed at the same scenario: user leaves CodeMantis
//! open while the Mac stays awake but the screen locks for hours,
//! typically with a long-running Self-Drive run in flight.
//!
//! 1. **`Info.plist` keys** (`NSAppSleepDisabled`,
//!    `NSSupportsAutomaticTermination = false`,
//!    `NSSupportsSuddenTermination = false`) opt the bundle out of macOS
//!    App Nap — the OS-level throttling that coalesces our timers, drops
//!    our QoS, and can reclaim helper processes for "idle" apps. See
//!    `src-tauri/Info.plist`.
//!
//! 2. **[`activity_assertion::ActivityToken`]** — held for the lifetime of
//!    the app. Tells the OS "user-initiated work in progress" so we keep
//!    full timer fidelity even when the screen is locked. Belt-and-
//!    suspenders alongside (1).
//!
//! 3. **[`wake_observer`]** — periodic frontend liveness ping. On a missed
//!    pong we now call [`repaint::force_repaint_main`] (a non-destructive
//!    `setNeedsDisplay:`), not a `WebviewWindow::reload()`. The reload
//!    path destroyed all in-memory UI state on every Mac unlock, which
//!    was a worse regression than the original symptom.

pub mod activity_assertion;
pub mod repaint;
pub mod sleep_observer;
pub mod wake_observer;
