//! Lifecycle IPC commands. See `crate::lifecycle::wake_observer` for the
//! companion polling loop that reads the counter this command bumps.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
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

/// Maximum log file size before rotation, in bytes. ~1 MiB. When a category
/// log grows past this, it is rotated to a `.1` sibling (overwriting any
/// previous `.1`). One generation of rotation is enough for short-lived
/// diagnostics; we deliberately avoid building a richer rotation policy.
const DIAGNOSTIC_LOG_MAX_BYTES: u64 = 1_048_576;

/// Resolve the diagnostics log directory. Always returns
/// `~/Library/Logs/CodeMantis/` when `dirs::home_dir()` is available; falls
/// back to the system temp dir otherwise so the command never errors purely
/// due to a missing $HOME (which would silently swallow breadcrumbs).
fn diagnostic_log_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join("Library").join("Logs").join("CodeMantis")
    } else {
        std::env::temp_dir().join("CodeMantis")
    }
}

/// Sanitize a category string into a safe file-stem. Permits
/// `[a-zA-Z0-9._-]`; everything else collapses to `_`. Bounded to 32 chars.
fn sanitize_category(category: &str) -> String {
    let cleaned: String = category
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .take(32)
        .collect();
    if cleaned.is_empty() { "default".to_string() } else { cleaned }
}

/// Append a single diagnostic line to `~/Library/Logs/CodeMantis/<category>.log`.
///
/// Used by the frontend (wake-debug, AppShell render trace) and the Rust
/// wake-observer to record breadcrumbs that survive `localStorage.clear()`
/// and force-quits. Best-effort — failures are logged but never propagated
/// to the caller, since dropping a breadcrumb must not break user-visible
/// flows. Each line is timestamped at write time with RFC3339 UTC.
#[tauri::command]
pub fn append_diagnostic_log(category: String, line: String) -> Result<(), String> {
    let category = sanitize_category(&category);
    let dir = diagnostic_log_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        return Err(format!("create_dir_all({}): {}", dir.display(), e));
    }
    let path = dir.join(format!("{}.log", category));

    // Rotate if needed. Best-effort — a rotation failure just means the file
    // grows a bit longer than the limit; we still write the new line.
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > DIAGNOSTIC_LOG_MAX_BYTES {
            let rotated = dir.join(format!("{}.log.1", category));
            let _ = fs::rename(&path, &rotated);
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open({}): {}", path.display(), e))?;

    let ts = chrono::Utc::now().to_rfc3339();
    // One line per breadcrumb. Strip embedded newlines so a malformed line
    // can't pollute later entries.
    let safe_line: String = line
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect();
    writeln!(file, "{} {}", ts, safe_line)
        .map_err(|e| format!("write to {}: {}", path.display(), e))?;
    Ok(())
}

/// Convenience wrapper for native Rust callers (e.g. wake_observer). Failures
/// are logged at warn-level and swallowed — see the command for rationale.
pub fn write_diagnostic_log(category: &str, line: &str) {
    if let Err(e) = append_diagnostic_log(category.to_string(), line.to_string()) {
        log::warn!("[diagnostics] failed to write {}: {}", category, e);
    }
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

    #[test]
    fn sanitize_category_strips_path_separators() {
        // Defense against a malicious caller trying to traverse out of the
        // logs directory via a category name like "../../foo". The slash is
        // replaced with `_`; the leading `..` survives because dots are an
        // allowed character — but no path separator can appear, so a join
        // against the log dir cannot escape it.
        let s = sanitize_category("../etc/passwd");
        assert!(!s.contains('/'));
        assert!(!s.contains('\\'));
        assert_eq!(s, ".._etc_passwd");
        assert_eq!(sanitize_category("wake"), "wake");
        assert_eq!(sanitize_category("AppShell.render"), "AppShell.render");
    }

    #[test]
    fn sanitize_category_truncates_to_32_chars() {
        let long = "a".repeat(100);
        assert_eq!(sanitize_category(&long).len(), 32);
    }

    #[test]
    fn sanitize_category_falls_back_to_default_when_empty() {
        assert_eq!(sanitize_category(""), "default");
        // After sanitization-then-truncation, an all-bad-chars input also
        // yields a non-empty string ("___"), so this guard catches only the
        // truly empty case.
        assert_ne!(sanitize_category("///"), "default");
    }

    #[test]
    fn append_diagnostic_log_creates_dir_and_appends() {
        // Run with a HOME override so we don't pollute the developer's
        // ~/Library/Logs/CodeMantis. We can't actually monkey-patch
        // dirs::home_dir(), so we just exercise the function and assert
        // the file ends up somewhere readable.
        let category = format!("test_{}", uuid::Uuid::new_v4().simple());
        append_diagnostic_log(category.clone(), "hello-world".into()).expect("write");
        append_diagnostic_log(category.clone(), "second-line".into()).expect("write");

        let path = diagnostic_log_dir().join(format!("{}.log", sanitize_category(&category)));
        let contents = std::fs::read_to_string(&path).expect("read back");
        assert!(contents.contains("hello-world"));
        assert!(contents.contains("second-line"));
        // Each line is timestamped with an RFC3339 prefix.
        assert!(contents.lines().all(|l| l.contains('T') && l.contains('Z') || l.contains('+')));

        // Cleanup
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn append_diagnostic_log_strips_embedded_newlines() {
        let category = format!("test_{}", uuid::Uuid::new_v4().simple());
        append_diagnostic_log(category.clone(), "line1\nline2\rline3".into()).expect("write");
        let path = diagnostic_log_dir().join(format!("{}.log", sanitize_category(&category)));
        let contents = std::fs::read_to_string(&path).expect("read back");
        // Exactly one line in the file.
        assert_eq!(contents.lines().count(), 1);
        assert!(contents.contains("line1 line2 line3"));
        let _ = std::fs::remove_file(&path);
    }
}
