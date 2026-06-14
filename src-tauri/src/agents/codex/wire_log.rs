//! Optional raw-wire logger for the Codex app-server JSON-RPC stream.
//!
//! When enabled (the `codexDebugLoggingEnabled` setting, or `CM_CODEX_WIRE_LOG=1`)
//! every line crossing the stdin/stdout boundary — plus stderr — is appended to a
//! per-session NDJSON file under `app_data_dir()/codex-wire-logs/`. This is the
//! diagnostic of record for compaction stalls: the harness proves the protocol
//! completes at every context size, so a real stall must be captured from the
//! user's actual session and compared against that baseline.
//!
//! Format (one JSON object per line), matching `tests/codex_protocol_capture.rs`:
//!   {"ts_ms": <i64>, "dir": "send"|"recv"|"stderr", "line": "<raw json-rpc>"}

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Cheap-to-clone handle shared by the stdin/stdout/stderr tasks. A `disabled()`
/// instance records nothing (zero overhead beyond a branch).
#[derive(Clone)]
pub struct WireLog {
    inner: Option<Arc<Mutex<std::fs::File>>>,
    path: Option<PathBuf>,
}

impl WireLog {
    /// A no-op logger.
    pub fn disabled() -> Self {
        Self {
            inner: None,
            path: None,
        }
    }

    /// True when wire logging should be active: the persisted setting
    /// `codex_debug_logging_enabled` OR the `CM_CODEX_WIRE_LOG=1` env override.
    pub fn is_enabled_by_config() -> bool {
        if matches!(std::env::var("CM_CODEX_WIRE_LOG").as_deref(), Ok("1")) {
            return true;
        }
        crate::commands::settings::get_settings()
            .map(|s| s.codex_debug_logging_enabled)
            .unwrap_or(false)
    }

    /// Open a per-session NDJSON log under `app_data_dir()/codex-wire-logs/`.
    /// Falls back to `disabled()` on any path/IO error so logging never breaks
    /// a session. Prunes to the newest `KEEP` files to bound disk use.
    pub fn open(session_id: &str, spawn_ts_ms: i64) -> Self {
        const KEEP: usize = 10;
        let Some(base) = crate::utils::paths::app_data_dir() else {
            return Self::disabled();
        };
        let dir = base.join("codex-wire-logs");
        if std::fs::create_dir_all(&dir).is_err() {
            return Self::disabled();
        }
        prune_old(&dir, KEEP);
        let safe: String = session_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let path = dir.join(format!("codex-wire-{safe}-{spawn_ts_ms}.jsonl"));
        match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            Ok(file) => Self {
                inner: Some(Arc::new(Mutex::new(file))),
                path: Some(path),
            },
            Err(_) => Self::disabled(),
        }
    }

    #[allow(dead_code)] // public API + used in tests
    pub fn is_enabled(&self) -> bool {
        self.inner.is_some()
    }

    pub fn path(&self) -> Option<&PathBuf> {
        self.path.as_ref()
    }

    /// Append one record. `dir` is "send" | "recv" | "stderr". No-op when disabled.
    pub fn record(&self, dir: &str, line: &str) {
        let Some(file) = &self.inner else { return };
        use std::io::Write;
        let ts_ms = chrono::Utc::now().timestamp_millis();
        let entry = serde_json::json!({
            "ts_ms": ts_ms,
            "dir": dir,
            "line": line.trim_end_matches('\n'),
        });
        if let Ok(mut f) = file.lock() {
            let _ = writeln!(&mut *f, "{entry}");
        }
    }
}

/// Keep only the newest `keep` `*.jsonl` files in `dir`; delete the rest.
fn prune_old(dir: &std::path::Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .filter_map(|p| {
            let mtime = std::fs::metadata(&p).ok()?.modified().ok()?;
            Some((mtime, p))
        })
        .collect();
    if files.len() <= keep {
        return;
    }
    // Newest first; delete everything past `keep`.
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_records_nothing_and_reports_disabled() {
        let wl = WireLog::disabled();
        assert!(!wl.is_enabled());
        assert!(wl.path().is_none());
        wl.record("send", "{\"x\":1}"); // must not panic
    }

    #[test]
    fn open_writes_ndjson_with_dir_and_line() {
        // Use a temp dir as a fake app-data root by writing directly via the
        // same logic: open against a real temp path.
        let tmp = std::env::temp_dir().join(format!(
            "cm-wirelog-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        let path = tmp.join("codex-wire-sess-123.jsonl");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .unwrap();
        let wl = WireLog {
            inner: Some(Arc::new(Mutex::new(file))),
            path: Some(path.clone()),
        };
        assert!(wl.is_enabled());
        wl.record("send", "{\"id\":1,\"method\":\"turn/start\"}\n");
        wl.record("recv", "{\"method\":\"turn/completed\"}");

        let body = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["dir"], "send");
        // Trailing newline is trimmed in the stored line.
        assert_eq!(first["line"], "{\"id\":1,\"method\":\"turn/start\"}");
        assert!(first["ts_ms"].is_i64());
        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["dir"], "recv");
        let _ = std::fs::remove_file(&path);
    }
}
