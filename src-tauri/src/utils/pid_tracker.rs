use log::{error, info, warn};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes all PID file writes to prevent corruption from concurrent calls.
static FILE_LOCK: Mutex<()> = Mutex::new(());

/// Sentinel substring embedded in the argv of every dev-server shell we spawn,
/// so `kill_stale_orphans` can verify a tracked PID is one of *ours* before
/// sending SIGKILL.  Survives PID reuse: if the OS recycles a PID to an
/// unrelated process after a crash, that process won't carry this tag.
pub const DEVSERVER_TAG_PREFIX: &str = "cm-devserver-tag-";

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

/// On startup: read PIDs from a previous run, verify each is actually one of
/// ours (a `claude` CLI process or a tagged dev-server shell), SIGKILL matches
/// — using process-group kill so dev-server descendants (npm/node/vite/next)
/// die too — then clear the file.
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
        match classify_tracked_process(*pid) {
            TrackedKind::DevServer => {
                warn!(
                    "[pid_tracker] Killing orphan dev-server process group PID {}",
                    pid
                );
                kill_process_group(*pid, libc::SIGKILL);
            }
            TrackedKind::Claude => {
                warn!("[pid_tracker] Killing orphan claude process PID {}", pid);
                unsafe {
                    libc::kill(*pid as libc::pid_t, libc::SIGKILL);
                }
            }
            TrackedKind::None => {
                info!(
                    "[pid_tracker] PID {} is not a tracked CodeMantis process, skipping",
                    pid
                );
            }
        }
    }

    clear_pid_file();
}

/// What kind of CodeMantis-spawned process is this PID?
#[derive(Debug, PartialEq, Eq)]
enum TrackedKind {
    Claude,
    DevServer,
    None,
}

/// Classify a PID by inspecting `ps -o args=`.  The dev-server shell carries
/// a `cm-devserver-tag-…` sentinel that survives PID reuse; the Claude CLI is
/// matched by command name (loose, but acceptable since claude is uncommon
/// outside our spawn path).
fn classify_tracked_process(pid: u32) -> TrackedKind {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output();

    match output {
        Ok(out) => {
            if !out.status.success() {
                return TrackedKind::None;
            }
            let args = String::from_utf8_lossy(&out.stdout);
            let args = args.trim();
            if args.contains(DEVSERVER_TAG_PREFIX) {
                TrackedKind::DevServer
            } else if args.contains("claude") {
                TrackedKind::Claude
            } else {
                TrackedKind::None
            }
        }
        Err(e) => {
            warn!("[pid_tracker] Failed to check PID {}: {}", pid, e);
            TrackedKind::None
        }
    }
}

/// Send `signal` to every process in the process group whose pgid == `pid`.
/// On Unix, `kill(-pid, sig)` semantics — used so all descendants of a
/// `setsid`-ed shell (npm, node, vite, next) die together.
fn kill_process_group(pid: u32, signal: libc::c_int) {
    if pid == 0 || pid > i32::MAX as u32 {
        return;
    }
    unsafe {
        // Negative pid → "send to process group whose ID is |pid|"
        libc::kill(-(pid as libc::pid_t), signal);
    }
}

/// Public form of [`kill_process_group`] for callers that already have a PID
/// known to be a setsid-leader.  Used by `pty_manager::close_terminal`.
pub fn kill_devserver_tree(pid: u32) {
    kill_process_group(pid, libc::SIGTERM);
}

/// SIGKILL the process group as a last resort (after a SIGTERM grace period).
pub fn force_kill_devserver_tree(pid: u32) {
    kill_process_group(pid, libc::SIGKILL);
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

    // --- classify_tracked_process ---

    #[test]
    fn classify_nonexistent_pid_is_none() {
        // PID 0 is kernel; a very high PID is unlikely to exist
        assert_eq!(classify_tracked_process(4_000_000), TrackedKind::None);
    }

    #[test]
    fn classify_current_process_is_none() {
        // Our test process is not a tracked CodeMantis process
        let pid = std::process::id();
        assert_eq!(classify_tracked_process(pid), TrackedKind::None);
    }

    #[test]
    fn classify_devserver_tagged_shell() {
        // Spawn `sh -c ': cm-devserver-tag-test123; sleep 5'` and verify
        // classify_tracked_process returns DevServer.
        let tag_cmd = format!(": {}test123; sleep 5", DEVSERVER_TAG_PREFIX);
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", &tag_cmd])
            .spawn()
            .expect("failed to spawn tagged sh");
        let pid = child.id();

        // ps may take a moment to reflect the new process — small retry.
        let mut classified = TrackedKind::None;
        for _ in 0..10 {
            classified = classify_tracked_process(pid);
            if classified == TrackedKind::DevServer {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // Cleanup before asserting so a failure doesn't leak the sleep
        let _ = child.kill();
        let _ = child.wait();

        assert_eq!(classified, TrackedKind::DevServer);
    }

    #[test]
    fn classify_untagged_shell_is_none() {
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 5"])
            .spawn()
            .expect("failed to spawn sh");
        let pid = child.id();

        // Allow ps to settle
        std::thread::sleep(std::time::Duration::from_millis(50));
        let classified = classify_tracked_process(pid);

        let _ = child.kill();
        let _ = child.wait();

        assert_eq!(classified, TrackedKind::None);
    }

    #[test]
    fn devserver_tag_prefix_is_unique_enough() {
        // The prefix must be specific enough that random processes won't
        // accidentally match it.  These shouldn't be substrings of common
        // command lines.
        assert!(DEVSERVER_TAG_PREFIX.starts_with("cm-"));
        assert!(DEVSERVER_TAG_PREFIX.len() >= 10);
    }

    #[test]
    fn kill_process_group_rejects_invalid_pid() {
        // PID 0 means "this process group" in Unix kill semantics — we must
        // refuse to send signals there to avoid killing CodeMantis itself.
        kill_process_group(0, libc::SIGTERM);
        // No assertion possible — the guard is a no-op return; reaching here
        // without a crash means the guard worked.
    }

    /// End-to-end check that `kill_devserver_tree` actually terminates a
    /// process group — the core invariant the "every 2nd time" preview bug
    /// hinged on.  Spawns `sh -c "sleep 30 & sleep 30 & wait"` as a setsid
    /// leader (mirroring how portable-pty sets up its PTY children), waits
    /// for the children to exist, then SIGTERMs the group.  Any of the
    /// `sleep` descendants surviving means the kill failed.
    #[cfg(unix)]
    #[test]
    fn kill_devserver_tree_kills_setsid_group() {
        use std::os::unix::process::CommandExt;
        use std::process::Command;
        use std::time::{Duration, Instant};

        // Spawn the leader as its own session/process-group head.  setsid()
        // is what portable-pty does for PTY slaves; replicating it here lets
        // us exercise kill_devserver_tree without dragging in a full PTY.
        let mut leader = unsafe {
            Command::new("/bin/sh")
                .args(["-c", "sleep 30 & sleep 30 & wait"])
                .pre_exec(|| {
                    if libc::setsid() == -1 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                })
                .spawn()
                .expect("failed to spawn setsid leader")
        };
        let pgid = leader.id();

        // Give the shell a moment to fork its two `sleep` children.
        std::thread::sleep(Duration::from_millis(150));

        // SIGTERM the entire group → leader and both sleeps should die.
        kill_devserver_tree(pgid);

        // Wait for the leader to be reaped (up to 2 s).  If SIGTERM was
        // somehow ignored, escalate to SIGKILL so the test never wedges CI.
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut exited = false;
        while Instant::now() < deadline {
            match leader.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
        if !exited {
            force_kill_devserver_tree(pgid);
            let _ = leader.wait();
            panic!("kill_devserver_tree did not terminate the leader within 2s");
        }

        // Cross-check that `sleep` processes spawned by the leader are
        // gone too — that's the actual orphan-prevention guarantee.
        std::thread::sleep(Duration::from_millis(100));
        let lingering = Command::new("pgrep")
            .args(["-g", &pgid.to_string(), "sleep"])
            .output();
        if let Ok(out) = lingering {
            let stdout = String::from_utf8_lossy(&out.stdout);
            assert!(
                stdout.trim().is_empty(),
                "sleep descendants still alive after kill_devserver_tree: {}",
                stdout
            );
        }
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
