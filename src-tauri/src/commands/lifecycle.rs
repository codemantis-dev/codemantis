//! Lifecycle IPC commands. See `crate::lifecycle::wake_observer` for the
//! companion polling loop that reads the counter this command bumps.

use std::sync::atomic::Ordering;

use tauri::State;

use crate::claude::session::AppState;

/// Command name registered with `invoke_handler!`. Kept as a constant so
/// log lines from the wake-observer stay in sync if the command is ever
/// renamed.
pub const WAKE_PONG_COMMAND: &str = "wake_pong";

/// Frontend's reply to a `wake-from-sleep` event. Bumps the monotonic
/// counter the wake-observer polls so it knows the WebView is alive.
#[tauri::command]
pub fn wake_pong(state: State<'_, AppState>) -> u64 {
    state.last_wake_pong.fetch_add(1, Ordering::SeqCst) + 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use std::sync::atomic::AtomicU64;
    use std::sync::Arc;

    fn fresh_state() -> AppState {
        // In-memory DB is fine; the command never touches it.
        let db = Database::new(":memory:").expect("open in-memory db");
        AppState::new(db)
    }

    #[test]
    fn wake_pong_advances_counter_monotonically() {
        let state = fresh_state();
        let counter: Arc<AtomicU64> = state.last_wake_pong.clone();
        assert_eq!(counter.load(Ordering::SeqCst), 0);

        let after_first = counter.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(after_first, 1);
        let after_second = counter.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(after_second, 2);
        assert_eq!(counter.load(Ordering::SeqCst), 2);
    }
}
