use log::{error, info, warn};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes all PID file writes to prevent corruption from concurrent calls.
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn pid_file_path() -> Option<PathBuf> {
    crate::utils::paths::app_data_dir().map(|d| d.join("codemantis.pids"))
}

/// Add a PID to the tracking file (atomic write via temp + rename).
pub fn register_pid(pid: u32) {
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Some(path) = pid_file_path() else { return };

    let mut pids = read_all_pids_inner(&path);
    if !pids.contains(&pid) {
        pids.push(pid);
    }
    write_pids_atomic(&path, &pids);
    info!("[pid_tracker] Registered PID {}", pid);
}

/// Remove a PID from the tracking file (atomic write via temp + rename).
pub fn unregister_pid(pid: u32) {
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Some(path) = pid_file_path() else { return };

    let mut pids = read_all_pids_inner(&path);
    pids.retain(|&p| p != pid);
    write_pids_atomic(&path, &pids);
    info!("[pid_tracker] Unregistered PID {}", pid);
}

/// Read all tracked PIDs from the file.
pub fn read_all_pids() -> Vec<u32> {
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Some(path) = pid_file_path() else {
        return Vec::new();
    };
    read_all_pids_inner(&path)
}

/// Truncate the PID file (called on clean exit).
pub fn clear_pid_file() {
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Some(path) = pid_file_path() else { return };
    write_pids_atomic(&path, &[]);
}

/// SIGKILL every PID in the file. Synchronous — safe to call from `RunEvent::Exit`.
pub fn kill_all_registered_sync() {
    let pids = read_all_pids();
    for pid in &pids {
        info!("[pid_tracker] Killing registered PID {}", pid);
        unsafe {
            libc::kill(*pid as libc::pid_t, libc::SIGKILL);
        }
    }
}

/// On startup: read PIDs from a previous run, verify each is actually a
/// `claude` or `node` process (guards against PID reuse), SIGKILL matches,
/// then clear the file.
pub fn kill_stale_orphans() {
    let pids = read_all_pids();
    if pids.is_empty() {
        return;
    }

    info!(
        "[pid_tracker] Found {} stale PID(s) from previous run, checking for orphans",
        pids.len()
    );

    for pid in &pids {
        if is_claude_or_node_process(*pid) {
            warn!("[pid_tracker] Killing orphan claude/node process PID {}", pid);
            unsafe {
                libc::kill(*pid as libc::pid_t, libc::SIGKILL);
            }
        } else {
            info!(
                "[pid_tracker] PID {} is not a claude/node process, skipping",
                pid
            );
        }
    }

    clear_pid_file();
}

/// Check if a PID belongs to a `claude` process using `ps -o args=`.
fn is_claude_or_node_process(pid: u32) -> bool {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output();

    match output {
        Ok(out) => {
            if !out.status.success() {
                return false;
            }
            let args = String::from_utf8_lossy(&out.stdout);
            let args = args.trim();
            args.contains("claude")
        }
        Err(e) => {
            warn!("[pid_tracker] Failed to check PID {}: {}", pid, e);
            false
        }
    }
}

// --- Internal helpers ---

fn read_all_pids_inner(path: &Path) -> Vec<u32> {
    match fs::read_to_string(path) {
        Ok(content) => content
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .filter(|&pid| pid <= i32::MAX as u32)
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn write_pids_atomic(path: &Path, pids: &[u32]) {
    let Some(parent) = path.parent() else { return };

    // Write to a temp file then rename for atomicity
    let tmp_path = parent.join("codemantis.pids.tmp");
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp_path)?;
        for pid in pids {
            writeln!(file, "{}", pid)?;
        }
        file.sync_all()?;
        fs::rename(&tmp_path, path)?;
        Ok(())
    })();

    if let Err(e) = result {
        error!("[pid_tracker] Failed to write PID file: {}", e);
        // Clean up temp file on failure
        let _ = fs::remove_file(&tmp_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // --- read_all_pids_inner ---

    #[test]
    fn read_pids_valid_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        fs::write(&path, "100\n200\n300\n").unwrap();
        assert_eq!(read_all_pids_inner(&path), vec![100, 200, 300]);
    }

    #[test]
    fn read_pids_empty_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        fs::write(&path, "").unwrap();
        assert_eq!(read_all_pids_inner(&path), Vec::<u32>::new());
    }

    #[test]
    fn read_pids_nonexistent_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("no_such_file");
        assert_eq!(read_all_pids_inner(&path), Vec::<u32>::new());
    }

    #[test]
    fn read_pids_whitespace_and_blank_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        fs::write(&path, "  100  \n\n  200\n  \n300\n").unwrap();
        assert_eq!(read_all_pids_inner(&path), vec![100, 200, 300]);
    }

    #[test]
    fn read_pids_non_numeric_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        fs::write(&path, "100\nhello\n200\n").unwrap();
        assert_eq!(read_all_pids_inner(&path), vec![100, 200]);
    }

    #[test]
    fn read_pids_overflow_values() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        // i32::MAX = 2147483647, so 2147483648 and 4000000000 should be filtered
        fs::write(&path, "100\n2147483648\n200\n4000000000\n").unwrap();
        assert_eq!(read_all_pids_inner(&path), vec![100, 200]);
    }

    #[test]
    fn read_pids_no_trailing_newline() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        fs::write(&path, "42").unwrap();
        assert_eq!(read_all_pids_inner(&path), vec![42]);
    }

    #[test]
    fn read_pids_duplicates_preserved() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        fs::write(&path, "100\n100\n").unwrap();
        assert_eq!(read_all_pids_inner(&path), vec![100, 100]);
    }

    // --- write_pids_atomic ---

    #[test]
    fn write_pids_creates_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        write_pids_atomic(&path, &[10, 20, 30]);
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "10\n20\n30\n");
    }

    #[test]
    fn write_pids_overwrites_existing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        fs::write(&path, "old content").unwrap();
        write_pids_atomic(&path, &[42]);
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "42\n");
    }

    #[test]
    fn write_pids_empty_list() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        write_pids_atomic(&path, &[]);
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "");
    }

    #[test]
    fn write_pids_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        let original = vec![1, 22, 333, 4444];
        write_pids_atomic(&path, &original);
        let read_back = read_all_pids_inner(&path);
        assert_eq!(read_back, original);
    }

    #[test]
    fn write_pids_no_temp_file_left() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        write_pids_atomic(&path, &[1, 2, 3]);
        let tmp_path = dir.path().join("codemantis.pids.tmp");
        assert!(!tmp_path.exists(), "temp file should be cleaned up after rename");
    }

    // --- register/unregister simulation (using inner helpers directly) ---

    #[test]
    fn register_then_read() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        // Simulate register_pid logic
        let mut pids = read_all_pids_inner(&path);
        if !pids.contains(&42) {
            pids.push(42);
        }
        write_pids_atomic(&path, &pids);

        let result = read_all_pids_inner(&path);
        assert!(result.contains(&42));
    }

    #[test]
    fn register_duplicate_idempotent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");

        // Register 42 twice
        for _ in 0..2 {
            let mut pids = read_all_pids_inner(&path);
            if !pids.contains(&42) {
                pids.push(42);
            }
            write_pids_atomic(&path, &pids);
        }

        let result = read_all_pids_inner(&path);
        assert_eq!(result.iter().filter(|&&p| p == 42).count(), 1);
    }

    #[test]
    fn unregister_existing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        write_pids_atomic(&path, &[10, 20, 30]);

        // Simulate unregister_pid logic for PID 20
        let mut pids = read_all_pids_inner(&path);
        pids.retain(|&p| p != 20);
        write_pids_atomic(&path, &pids);

        let result = read_all_pids_inner(&path);
        assert_eq!(result, vec![10, 30]);
    }

    #[test]
    fn unregister_nonexistent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        write_pids_atomic(&path, &[10, 20]);

        // Unregister PID that doesn't exist
        let mut pids = read_all_pids_inner(&path);
        pids.retain(|&p| p != 999);
        write_pids_atomic(&path, &pids);

        let result = read_all_pids_inner(&path);
        assert_eq!(result, vec![10, 20]);
    }

    #[test]
    fn register_multiple_unregister_one() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        write_pids_atomic(&path, &[10, 20, 30]);

        // Unregister only PID 20
        let mut pids = read_all_pids_inner(&path);
        pids.retain(|&p| p != 20);
        write_pids_atomic(&path, &pids);

        let result = read_all_pids_inner(&path);
        assert_eq!(result, vec![10, 30]);
    }

    // --- is_claude_or_node_process ---

    #[test]
    fn check_nonexistent_pid() {
        // PID 0 is kernel; a very high PID is unlikely to exist
        assert!(!is_claude_or_node_process(4_000_000));
    }

    #[test]
    fn check_current_process() {
        // Our test process is not claude
        let pid = std::process::id();
        assert!(!is_claude_or_node_process(pid));
    }

    // --- clear_pid_file simulation ---

    #[test]
    fn clear_then_read_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pids");
        write_pids_atomic(&path, &[10, 20, 30]);

        // Simulate clear_pid_file logic
        write_pids_atomic(&path, &[]);

        let result = read_all_pids_inner(&path);
        assert!(result.is_empty());
    }
}
