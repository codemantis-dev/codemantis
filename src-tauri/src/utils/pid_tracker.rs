use log::{error, info, warn};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
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
    let _ = fs::write(&path, "");
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

/// Check if a PID belongs to a `claude` or `node` process using `ps`.
fn is_claude_or_node_process(pid: u32) -> bool {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output();

    match output {
        Ok(out) => {
            let comm = String::from_utf8_lossy(&out.stdout);
            let comm = comm.trim();
            comm.contains("claude") || comm.contains("node")
        }
        Err(e) => {
            warn!("[pid_tracker] Failed to check PID {}: {}", pid, e);
            false
        }
    }
}

// --- Internal helpers ---

fn read_all_pids_inner(path: &PathBuf) -> Vec<u32> {
    match fs::read_to_string(path) {
        Ok(content) => content
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn write_pids_atomic(path: &PathBuf, pids: &[u32]) {
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
