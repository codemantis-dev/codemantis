//! Hold an `NSProcessInfo` activity assertion for the lifetime of the
//! process so macOS treats CodeMantis as actively-doing-user-work even
//! while the screen is locked.
//!
//! Combined with `NSAppSleepDisabled` in `Info.plist`, this stops App Nap,
//! timer coalescing, and QoS downgrades that otherwise leave the WKWebView
//! white on screen-unlock after a long screen-locked window.
//!
//! Mode is `UserInitiatedAllowingIdleSystemSleep` — we keep ourselves out
//! of background-throttling but explicitly allow the user's Mac to sleep
//! when *they* tell it to. We are not a media player.
//!
//! The token is acquired once during `tauri::Builder::setup` and parked in
//! `AppState`. It releases on `Drop` (either at app shutdown via Tauri's
//! managed-state teardown, or on test scope end). On non-macOS builds the
//! whole module compiles to a no-op.

#[cfg(target_os = "macos")]
mod imp {
    use log::info;
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

    /// RAII wrapper around `[NSProcessInfo beginActivityWithOptions:reason:]`.
    /// `Drop` calls `endActivity:` so the assertion releases when the token
    /// is dropped. Holding multiple is fine — they stack (the OS reference-
    /// counts assertions internally).
    pub struct ActivityToken {
        token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
        reason: String,
    }

    // SAFETY: The token returned by `beginActivityWithOptions:reason:` is an
    // opaque `NSObject` whose only valid use is being passed back to
    // `[NSProcessInfo endActivity:]`. Per Apple's NSProcessInfo docs,
    // `endActivity:` may be called from any thread. We never observe the
    // token's internal state from Rust, so cross-thread movement is safe.
    unsafe impl Send for ActivityToken {}
    unsafe impl Sync for ActivityToken {}

    impl ActivityToken {
        /// Acquire an "I'm doing user-initiated work" assertion. `reason` is
        /// surfaced in `Activity Monitor` and Console under the assertion's
        /// debugging fields, so make it specific.
        pub fn acquire(reason: &str) -> Self {
            // `UserInitiatedAllowingIdleSystemSleep` =
            //   `UserInitiated` with `IdleSystemSleepDisabled` cleared.
            // That is: don't background-throttle us, but let the user's
            // Mac still sleep on its own schedule.
            let options = NSActivityOptions::UserInitiatedAllowingIdleSystemSleep;
            let ns_reason = NSString::from_str(reason);
            let info = NSProcessInfo::processInfo();
            let token = info.beginActivityWithOptions_reason(options, &ns_reason);
            info!(
                "[lifecycle] acquired NSProcessInfo activity assertion: {}",
                reason
            );
            Self {
                token,
                reason: reason.to_string(),
            }
        }
    }

    impl Drop for ActivityToken {
        fn drop(&mut self) {
            let info = NSProcessInfo::processInfo();
            unsafe { info.endActivity(&self.token) };
            info!(
                "[lifecycle] released NSProcessInfo activity assertion: {}",
                self.reason
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    /// No-op token on non-macOS targets.
    pub struct ActivityToken;

    impl ActivityToken {
        pub fn acquire(_reason: &str) -> Self {
            Self
        }
    }
}

pub use imp::ActivityToken;

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_drop_does_not_panic() {
        // Smoke test: we can take and release an assertion without
        // crashing the test runner. Real behavioural verification (does
        // the OS actually stop throttling us?) requires a manual
        // overnight repro and can't be automated.
        let token = ActivityToken::acquire("test acquire/drop");
        drop(token);
    }

    #[test]
    fn multiple_concurrent_tokens_stack_cleanly() {
        // The OS reference-counts assertions, so two acquires + two drops
        // should be perfectly fine.
        let a = ActivityToken::acquire("first");
        let b = ActivityToken::acquire("second");
        drop(a);
        drop(b);
    }
}

#[cfg(all(test, not(target_os = "macos")))]
mod tests {
    use super::*;

    #[test]
    fn noop_token_compiles_and_drops() {
        let token = ActivityToken::acquire("noop");
        drop(token);
    }
}
