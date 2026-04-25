use crate::errors::AppError;
use crate::preview::port_detector::scan_for_dev_server_url;
use crate::utils::pid_tracker;
use log::{debug, error, info, warn};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

/// Prefix for synthetic session IDs created by the Preview / Run-Application
/// flow.  Used here to decide whether to (a) wrap the spawned command with the
/// pid_tracker sentinel and (b) issue a process-group SIGKILL on close.
const DEVSERVER_SESSION_PREFIX: &str = "devserver-";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevServerDetectedEvent {
    terminal_id: String,
    session_id: String,
    port: u16,
    url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevServerClosedEvent {
    terminal_id: String,
    session_id: String,
    /// Why the PTY closed: `"shutdown_requested"` (we asked it to stop —
    /// e.g. user clicked Stop, or `start_dev_server` is cleaning up stale
    /// state), `"pty_eof"` (child process exited on its own — likely a
    /// crash or port conflict), or `"pty_error"` (read error).  Frontend
    /// uses this to decide whether to surface a "dev server crashed" toast.
    reason: &'static str,
}

struct PtyProcess {
    session_id: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    // We keep the master alive so the PTY doesn't close
    _master: Box<dyn MasterPty + Send>,
    shutdown_tx: tokio::sync::oneshot::Sender<()>,
    /// PID of the child shell.  Populated for dev-server PTYs so
    /// `close_terminal` can SIGTERM/SIGKILL the entire process group, which
    /// is the only reliable way to stop npm/node/vite/next descendants.
    /// `None` for non-dev-server terminals (general-purpose shells), which
    /// are killed via the existing PTY-drop path.
    devserver_pgid: Option<u32>,
    /// Set to true by `close_terminal` *before* sending `shutdown_tx`, so
    /// the reader thread knows the upcoming close is intentional and can
    /// emit `dev-server-closed` with `reason: "shutdown_requested"`
    /// instead of `"pty_eof"`.  Avoids the frontend treating our own
    /// teardown as a crash.
    closing_intentionally: Arc<AtomicBool>,
}

fn shell_quote(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    if s.bytes().all(|b| matches!(b,
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' |
        b'/' | b'.' | b'-' | b'_' | b':' | b'=' | b'+' | b',' | b'@'
    )) {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub struct TerminalPool {
    terminals: Mutex<HashMap<String, PtyProcess>>,
    session_terminals: Mutex<HashMap<String, Vec<String>>>,
}

impl TerminalPool {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            session_terminals: Mutex::new(HashMap::new()),
        }
    }

    pub async fn create_terminal(
        &self,
        app_handle: AppHandle,
        session_id: &str,
        cwd: &str,
        shell: Option<&str>,
        args: Option<Vec<String>>,
    ) -> Result<String, AppError> {
        // Enforce 6-terminal max per session
        {
            let st = self.session_terminals.lock().await;
            if let Some(terms) = st.get(session_id) {
                if terms.len() >= 6 {
                    return Err(AppError::TerminalError(
                        "Maximum 6 terminals per session".to_string(),
                    ));
                }
            }
        }

        let terminal_id = Uuid::new_v4().to_string();
        let pty_system = native_pty_system();

        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(size).map_err(|e| {
            AppError::TerminalError(format!("Failed to open PTY: {}", e))
        })?;

        let user_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        // Dev-server terminals get a sentinel tag prepended to the shell
        // command line.  This serves two purposes:
        //   1. `pid_tracker::classify_tracked_process` can verify a stale PID
        //      really belongs to a CodeMantis dev server (guards against PID
        //      reuse).
        //   2. The shell process itself becomes a `setsid` group leader (a
        //      property of every PTY child), so killing its process group
        //      reaches the entire npm/node/vite/next subtree.
        let is_devserver = session_id.starts_with(DEVSERVER_SESSION_PREFIX);
        let devserver_tag = if is_devserver {
            Some(format!(
                "{}{}",
                pid_tracker::DEVSERVER_TAG_PREFIX,
                Uuid::new_v4().simple()
            ))
        } else {
            None
        };

        let mut cmd = if let Some(custom_program) = shell {
            // Custom command (claude CLI, npm, etc.) — wrap in login shell
            // so user's profile is sourced and PATH is available.
            //
            // SECURITY: We use `sh -c` here because login-shell profile sourcing
            // requires shell interpretation. All arguments MUST be passed through
            // `shell_quote()` to prevent injection. Do NOT bypass shell_quote or
            // concatenate raw user input into full_cmd.  The sentinel below is
            // a fixed prefix of CodeMantis-generated UUID — never user input.
            let mut full_cmd = String::new();
            if let Some(ref tag) = devserver_tag {
                // `:` is the POSIX shell no-op builtin — discards its args.
                // The tag thus appears in `ps -o args=` for the shell PID
                // without affecting execution of the user's dev command.
                full_cmd.push_str(": ");
                full_cmd.push_str(tag);
                full_cmd.push_str("; ");
            }
            full_cmd.push_str(&shell_quote(custom_program));
            if let Some(ref extra_args) = args {
                for arg in extra_args {
                    full_cmd.push(' ');
                    full_cmd.push_str(&shell_quote(arg));
                }
            }
            let mut c = CommandBuilder::new(&user_shell);
            c.arg("-l");
            c.arg("-c");
            c.arg(&full_cmd);
            c
        } else {
            // Interactive shell — start as login shell.  Dev-server flows
            // always pass an explicit `shell`, so this branch never sees the
            // sentinel.
            let mut c = CommandBuilder::new(&user_shell);
            c.arg("-l");
            if let Some(ref extra_args) = args {
                for arg in extra_args {
                    c.arg(arg);
                }
            }
            c
        };

        cmd.env("TERM", "xterm-256color");
        // Remove NODE_PATH inherited from `pnpm tauri dev` — the Tauri CLI
        // sets it to deep paths inside CodeMantis's own node_modules.  If a
        // child PTY (e.g. `npm run dev` for another project) inherits this,
        // its module resolver walks CodeMantis's massive dependency tree for
        // every import, causing RAM to spike from 12 GB to 70+ GB.
        cmd.env_remove("NODE_PATH");
        if !Path::new(cwd).is_dir() {
            return Err(AppError::TerminalError(format!(
                "Working directory does not exist: {}",
                cwd
            )));
        }
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| {
            AppError::TerminalError(format!("Failed to spawn shell: {}", e))
        })?;

        // Capture the shell's PID so we can SIGKILL its process group on close.
        // portable-pty calls `setsid()` on the slave side, which makes the
        // shell its own session/process-group leader → pgid == this PID.
        let devserver_pgid = if is_devserver {
            let pid = child.process_id();
            if let Some(pid) = pid {
                pid_tracker::register_pid(pid);
                debug!(
                    "[pty] Registered dev-server PID {} (terminal: {}, session: {})",
                    pid, terminal_id, session_id
                );
            } else {
                warn!(
                    "[pty] Dev-server child has no PID (terminal: {}); orphan cleanup disabled for this terminal",
                    terminal_id
                );
            }
            pid
        } else {
            None
        };
        // Move the Child into the reader thread so the OS does not reap it
        // before we can SIGTERM/SIGKILL.  We don't `wait()` here — the reader
        // thread does that lazily.
        let mut child_owned = child;

        // Drop slave — we only need the master
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(|e| {
            AppError::TerminalError(format!("Failed to clone reader: {}", e))
        })?;

        let writer = pair.master.take_writer().map_err(|e| {
            AppError::TerminalError(format!("Failed to take writer: {}", e))
        })?;

        let writer = Arc::new(Mutex::new(writer));

        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        // Flag flipped to true by `close_terminal` *before* it sends the
        // shutdown signal, so the reader thread can tag the resulting
        // `dev-server-closed` event with `reason: "shutdown_requested"`.
        let closing_intentionally = Arc::new(AtomicBool::new(false));

        // Spawn blocking read task
        let tid = terminal_id.clone();
        let sid = session_id.to_string();
        let ah = app_handle.clone();
        let close_flag = closing_intentionally.clone();
        tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            let event_name = format!("terminal-output-{}", tid);
            let mut line_buffer = String::new();
            let mut detected_ports: HashSet<u16> = HashSet::new();
            // Why the loop exited.  Defaults to `"pty_eof"`; the shutdown
            // and error paths overwrite it.  If `closing_intentionally` is
            // true at emit time, it overrides this regardless (e.g. PTY EOF
            // arriving in the same tick as a shutdown request still counts
            // as intentional).
            let exit_reason: &'static str;

            loop {
                // Check if we should shutdown (non-blocking)
                if shutdown_rx.try_recv().is_ok() {
                    debug!("Terminal reader shutdown for {}", tid);
                    exit_reason = "shutdown_requested";
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        info!("Terminal PTY closed for {}", tid);
                        exit_reason = "pty_eof";
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        if let Err(e) = ah.emit(&event_name, &data) {
                            warn!("Failed to emit terminal output: {}", e);
                        }

                        // Scan for dev server URLs in output
                        line_buffer.push_str(&data);
                        while let Some(delim_pos) = line_buffer.find(['\n', '\r']) {
                            let line: String = line_buffer.drain(..=delim_pos).collect();
                            let trimmed = line.trim_matches(|c: char| c == '\n' || c == '\r');
                            // Skip empty segments (e.g. from \r\n sequences)
                            if trimmed.is_empty() {
                                continue;
                            }
                            if let Some((port, url)) = scan_for_dev_server_url(trimmed) {
                                if detected_ports.insert(port) {
                                    let event = DevServerDetectedEvent {
                                        terminal_id: tid.clone(),
                                        session_id: sid.clone(),
                                        port,
                                        url,
                                    };
                                    if let Err(e) = ah.emit("dev-server-detected", &event) {
                                        warn!("Failed to emit dev-server-detected: {}", e);
                                    }
                                }
                            }
                        }
                        // Keep partial line in buffer (cap at 4KB to prevent unbounded growth)
                        if line_buffer.len() > 4096 {
                            line_buffer.clear();
                        }
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::Interrupted {
                            error!("Terminal read error for {}: {}", tid, e);
                            exit_reason = "pty_error";
                            break;
                        }
                    }
                }
            }

            // Reap the child so it doesn't sit as a zombie.  Best-effort:
            // ignore errors, the process may already be gone (especially
            // after our `kill_devserver_tree` call from `close_terminal`).
            let _ = child_owned.wait();

            // Unregister this PID from the cross-run orphan tracker.  Safe
            // even when devserver_pgid is None — the function is a no-op for
            // PIDs that were never registered.
            if let Some(pid) = devserver_pgid {
                pid_tracker::unregister_pid(pid);
            }

            // If `close_terminal` set the intentional flag (even after the
            // PTY surfaced EOF or an error in the same tick), prefer that
            // reason so the frontend knows the close was our doing.
            let reason = if close_flag.load(Ordering::Relaxed) {
                "shutdown_requested"
            } else {
                exit_reason
            };

            // Terminal closed — notify frontend to clean up
            let event = DevServerClosedEvent {
                terminal_id: tid.clone(),
                session_id: sid,
                reason,
            };
            if let Err(e) = ah.emit("dev-server-closed", &event) {
                warn!("Failed to emit dev-server-closed: {}", e);
            }
        });

        let process = PtyProcess {
            session_id: session_id.to_string(),
            writer,
            _master: pair.master,
            shutdown_tx,
            devserver_pgid,
            closing_intentionally,
        };

        {
            let mut terminals = self.terminals.lock().await;
            terminals.insert(terminal_id.clone(), process);
        }
        {
            let mut st = self.session_terminals.lock().await;
            st.entry(session_id.to_string())
                .or_default()
                .push(terminal_id.clone());
        }

        info!("Created terminal {} for session {}", terminal_id, session_id);
        Ok(terminal_id)
    }

    pub async fn send_input(&self, terminal_id: &str, data: &str) -> Result<(), AppError> {
        let terminals = self.terminals.lock().await;
        let process = terminals.get(terminal_id).ok_or_else(|| {
            AppError::TerminalError(format!("Terminal not found: {}", terminal_id))
        })?;

        let mut writer = process.writer.lock().await;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| AppError::TerminalError(format!("Write failed: {}", e)))?;
        writer
            .flush()
            .map_err(|e| AppError::TerminalError(format!("Flush failed: {}", e)))?;
        Ok(())
    }

    pub async fn resize(
        &self,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), AppError> {
        let terminals = self.terminals.lock().await;
        let process = terminals.get(terminal_id).ok_or_else(|| {
            AppError::TerminalError(format!("Terminal not found: {}", terminal_id))
        })?;

        process
            ._master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::TerminalError(format!("Resize failed: {}", e)))?;
        Ok(())
    }

    pub async fn close_terminal(&self, terminal_id: &str) -> Result<(), AppError> {
        let process = {
            let mut terminals = self.terminals.lock().await;
            terminals.remove(terminal_id)
        };

        if let Some(process) = process {
            // Mark the close as intentional *before* signaling shutdown so
            // the reader thread emits `dev-server-closed` with
            // `reason: "shutdown_requested"` rather than `"pty_eof"`.
            process.closing_intentionally.store(true, Ordering::Relaxed);

            // For dev-server PTYs, the child shell is a setsid leader;
            // SIGTERM to its process group reaches all descendants
            // (npm, node, vite, next).  Without this, dev-server children
            // outlive the PTY and keep holding ports — the root cause of
            // the "preview only opens every 2nd time" bug.
            if let Some(pgid) = process.devserver_pgid {
                debug!(
                    "[pty] SIGTERM-ing dev-server pgid {} (terminal: {})",
                    pgid, terminal_id
                );
                pid_tracker::kill_devserver_tree(pgid);

                // Spawn a watchdog: SIGKILL the group after a 500 ms grace
                // period if anything in it survived SIGTERM.  Detached so
                // close_terminal returns immediately.
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    debug!("[pty] SIGKILL-ing dev-server pgid {} (post-grace)", pgid);
                    pid_tracker::force_kill_devserver_tree(pgid);
                });
            }

            let _ = process.shutdown_tx.send(());

            let mut st = self.session_terminals.lock().await;
            if let Some(terms) = st.get_mut(&process.session_id) {
                terms.retain(|t| t != terminal_id);
            }
            info!("Closed terminal {}", terminal_id);
        }

        Ok(())
    }

    pub async fn close_all_for_session(&self, session_id: &str) {
        let terminal_ids: Vec<String> = {
            let st = self.session_terminals.lock().await;
            st.get(session_id).cloned().unwrap_or_default()
        };

        for tid in terminal_ids {
            let _ = self.close_terminal(&tid).await;
        }

        let mut st = self.session_terminals.lock().await;
        st.remove(session_id);
    }

    pub async fn close_all_terminals(&self) {
        let terminal_ids: Vec<String> = {
            let terminals = self.terminals.lock().await;
            terminals.keys().cloned().collect()
        };

        for tid in terminal_ids {
            let _ = self.close_terminal(&tid).await;
        }

        let mut st = self.session_terminals.lock().await;
        st.clear();
    }

    pub async fn list_for_session(&self, session_id: &str) -> Vec<String> {
        let st = self.session_terminals.lock().await;
        st.get(session_id).cloned().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_quote_empty() {
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn test_shell_quote_safe_path() {
        assert_eq!(shell_quote("/usr/bin/node"), "/usr/bin/node");
        assert_eq!(shell_quote("file.txt"), "file.txt");
        assert_eq!(shell_quote("a-b_c.d"), "a-b_c.d");
        assert_eq!(shell_quote("/opt/homebrew/bin/pnpm"), "/opt/homebrew/bin/pnpm");
    }

    #[test]
    fn test_shell_quote_safe_special_chars() {
        assert_eq!(shell_quote("key=value"), "key=value");
        assert_eq!(shell_quote("a+b,c@d:e"), "a+b,c@d:e");
    }

    #[test]
    fn test_shell_quote_spaces() {
        assert_eq!(shell_quote("hello world"), "'hello world'");
        assert_eq!(shell_quote("/path/to/my file"), "'/path/to/my file'");
    }

    #[test]
    fn test_shell_quote_single_quotes() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote("'quoted'"), "''\\''quoted'\\'''");
    }

    #[test]
    fn test_shell_quote_special_characters() {
        assert_eq!(shell_quote("hello;world"), "'hello;world'");
        assert_eq!(shell_quote("$(whoami)"), "'$(whoami)'");
        assert_eq!(shell_quote("foo&bar"), "'foo&bar'");
        assert_eq!(shell_quote("a|b"), "'a|b'");
    }

    #[test]
    fn test_shell_quote_backticks() {
        // Backticks trigger command substitution in shell — must be quoted
        assert_eq!(shell_quote("`whoami`"), "'`whoami`'");
        assert_eq!(shell_quote("echo `id`"), "'echo `id`'");
    }

    #[test]
    fn test_shell_quote_dollar_signs() {
        // Dollar signs can expand variables or run subshells
        assert_eq!(shell_quote("$HOME"), "'$HOME'");
        assert_eq!(shell_quote("${PATH}"), "'${PATH}'");
        assert_eq!(shell_quote("price is $5"), "'price is $5'");
    }

    #[test]
    fn test_shell_quote_semicolons_prevent_injection() {
        // Semicolons allow command chaining — verify they get quoted
        assert_eq!(shell_quote("ls; rm -rf /"), "'ls; rm -rf /'");
        assert_eq!(shell_quote("a;b;c"), "'a;b;c'");
    }

    #[test]
    fn test_shell_quote_complex_injection_attempts() {
        // Common shell injection patterns must all be safely quoted
        let quoted = shell_quote("'; drop table --");
        assert!(quoted.starts_with("'"), "Must start with single quote");
        assert!(quoted.ends_with("'"), "Must end with single quote");
        assert!(quoted.contains("drop table"), "Must contain the command text");
        // The single quote in the input must be escaped, preventing injection
        assert_ne!(quoted, "'; drop table --");
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
        assert_eq!(shell_quote("foo\nbar"), "'foo\nbar'");
    }

    #[tokio::test]
    async fn terminal_pool_new_is_empty() {
        let pool = TerminalPool::new();
        let terminals = pool.terminals.lock().await;
        assert!(terminals.is_empty());
        let session_terminals = pool.session_terminals.lock().await;
        assert!(session_terminals.is_empty());
    }

    #[tokio::test]
    async fn close_nonexistent_terminal_is_noop() {
        let pool = TerminalPool::new();
        // Closing a terminal that doesn't exist should return Ok, not error
        let result = pool.close_terminal("nonexistent-id").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn list_for_nonexistent_session_returns_empty() {
        let pool = TerminalPool::new();
        let list = pool.list_for_session("no-such-session").await;
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn close_all_for_nonexistent_session_is_noop() {
        let pool = TerminalPool::new();
        // Should not panic or error
        pool.close_all_for_session("no-such-session").await;
        let list = pool.list_for_session("no-such-session").await;
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn close_all_terminals_on_empty_pool() {
        let pool = TerminalPool::new();
        pool.close_all_terminals().await;
        let terminals = pool.terminals.lock().await;
        assert!(terminals.is_empty());
    }
}
