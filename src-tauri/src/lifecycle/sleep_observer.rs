//! Subscribe to macOS `NSWorkspace` sleep / wake notifications so the
//! [`wake_observer`](super::wake_observer) can distinguish "WebContent is
//! hung" from "the whole machine is asleep."
//!
//! Without this, the wake observer relies on the wall-clock gap heuristic
//! (a tick whose `elapsed > LONG_GAP_THRESHOLD` is *probably* a wake). The
//! heuristic is reasonable but coarse — it misses short sleeps and can't
//! distinguish a hung event loop from a paused kernel. `NSWorkspace`
//! gives us the authoritative signal.
//!
//! State surfaces back to the wake observer via two atomics parked on
//! [`AppState`](crate::agents::claude_code::session::AppState):
//!
//! - `is_system_asleep` — set on `NSWorkspaceWillSleepNotification`,
//!   cleared on `NSWorkspaceDidWakeNotification`. The wake observer
//!   treats missed pongs as expected while this is set.
//! - `last_wake_at_epoch` — Unix-epoch seconds stamped on
//!   `NSWorkspaceDidWakeNotification`. The wake observer grants a short
//!   post-wake grace window before counting missed pongs against the
//!   reload threshold.
//!
//! On non-macOS targets the module compiles to a no-op `register` fn so
//! the lifecycle module can call it unconditionally.

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
    use std::sync::{Arc, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use log::{info, warn};
    use objc2::define_class;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::NSObject;
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSString};

    /// Shared state the ObjC callbacks write to. We can't easily store
    /// Rust data inside ObjC ivars without unsafe trickery, so we park
    /// one of these in a process-global `OnceLock` and have the callbacks
    /// fish it back out. There is only ever one observer per process —
    /// the lifecycle setup is run once during Tauri `setup` — so the
    /// `OnceLock` constraint is fine.
    pub struct SleepState {
        pub is_system_asleep: Arc<AtomicBool>,
        pub last_wake_at_epoch: Arc<AtomicI64>,
    }

    static SLEEP_STATE: OnceLock<Arc<SleepState>> = OnceLock::new();

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "CodeMantisSleepObserver"]
        struct SleepObserver;

        impl SleepObserver {
            #[unsafe(method(workspaceWillSleep:))]
            fn workspace_will_sleep(&self, _notification: &NSNotification) {
                if let Some(state) = SLEEP_STATE.get() {
                    state.is_system_asleep.store(true, Ordering::SeqCst);
                    info!("[lifecycle] NSWorkspaceWillSleepNotification — system entering sleep");
                    crate::commands::lifecycle::write_diagnostic_log("wake", "ns:will-sleep");
                }
            }

            #[unsafe(method(workspaceDidWake:))]
            fn workspace_did_wake(&self, _notification: &NSNotification) {
                if let Some(state) = SLEEP_STATE.get() {
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    state.last_wake_at_epoch.store(now, Ordering::SeqCst);
                    state.is_system_asleep.store(false, Ordering::SeqCst);
                    info!("[lifecycle] NSWorkspaceDidWakeNotification — system woke at epoch {}", now);
                    crate::commands::lifecycle::write_diagnostic_log(
                        "wake",
                        &format!("ns:did-wake | epoch_s={}", now),
                    );
                }
            }
        }
    );

    /// Retain the observer for the lifetime of the app so it doesn't get
    /// deallocated while still subscribed. Parked in a `OnceLock` because
    /// it must survive past the end of `register()`.
    static OBSERVER: OnceLock<Retained<SleepObserver>> = OnceLock::new();

    /// Subscribe to `NSWorkspace` sleep / wake notifications. Idempotent —
    /// safe to call from `tauri::Builder::setup` exactly once. Subsequent
    /// calls are no-ops (the `OnceLock` ignores them).
    pub fn register(state: Arc<SleepState>) {
        if SLEEP_STATE.set(state).is_err() {
            warn!("[lifecycle] sleep_observer already registered — ignoring duplicate register()");
            return;
        }

        let observer = SleepObserver::alloc().set_ivars(());
        let observer: Retained<SleepObserver> = unsafe { msg_send![super(observer), init] };

        // The relevant notifications are posted on the *workspace*
        // notification center, not the default `NSNotificationCenter` —
        // a subtlety that has tripped up many Cocoa devs.
        let workspace = NSWorkspace::sharedWorkspace();
        let center: Retained<NSNotificationCenter> = workspace.notificationCenter();

        let will_sleep = NSString::from_str("NSWorkspaceWillSleepNotification");
        let did_wake = NSString::from_str("NSWorkspaceDidWakeNotification");
        let will_sleep_sel = objc2::sel!(workspaceWillSleep:);
        let did_wake_sel = objc2::sel!(workspaceDidWake:);

        unsafe {
            center.addObserver_selector_name_object(
                &observer,
                will_sleep_sel,
                Some(&will_sleep),
                None,
            );
            center.addObserver_selector_name_object(
                &observer,
                did_wake_sel,
                Some(&did_wake),
                None,
            );
        }

        if OBSERVER.set(observer).is_err() {
            warn!("[lifecycle] OBSERVER already set — second register() somehow raced through");
        }
        info!("[lifecycle] NSWorkspace sleep/wake observer registered");
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicI64};
    use std::sync::Arc;

    /// Stub type so the cross-platform caller can construct one without
    /// `#[cfg]` gates. Fields are unused off-macOS.
    pub struct SleepState {
        pub is_system_asleep: Arc<AtomicBool>,
        pub last_wake_at_epoch: Arc<AtomicI64>,
    }

    /// No-op on non-macOS targets.
    pub fn register(_state: Arc<SleepState>) {}
}

pub use imp::{register, SleepState};

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
    use std::sync::Arc;

    #[test]
    fn register_is_idempotent_and_safe_to_call() {
        // Smoke test: registration completes without panicking. We can't
        // synthesise a real NSWorkspace sleep notification from a unit
        // test, so verifying behaviour requires the manual `pmset
        // sleepnow` flow described in the plan.
        let state = Arc::new(SleepState {
            is_system_asleep: Arc::new(AtomicBool::new(false)),
            last_wake_at_epoch: Arc::new(AtomicI64::new(0)),
        });
        register(state.clone());
        // A second register() must not panic and must not clobber state.
        register(state.clone());
        // The fields are still readable / writable from Rust.
        state.is_system_asleep.store(true, Ordering::SeqCst);
        assert!(state.is_system_asleep.load(Ordering::SeqCst));
    }
}
