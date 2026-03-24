use crate::errors::AppError;
use crate::preview::port_detector::scan_for_dev_server_url;
use log::{debug, error, info, warn};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

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
}

struct PtyProcess {
    session_id: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    // We keep the master alive so the PTY doesn't close
    _master: Box<dyn MasterPty + Send>,
    shutdown_tx: tokio::sync::oneshot::Sender<()>,
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

        let mut cmd = if let Some(ref custom_program) = shell {
            // Custom command (claude CLI, npm, etc.) — wrap in login shell
            // so user's profile is sourced and PATH is available.
            //
            // SECURITY: We use `sh -c` here because login-shell profile sourcing
            // requires shell interpretation. All arguments MUST be passed through
            // `shell_quote()` to prevent injection. Do NOT bypass shell_quote or
            // concatenate raw user input into full_cmd.
            let mut full_cmd = shell_quote(custom_program);
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
            // Interactive shell — start as login shell
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
        if !Path::new(cwd).is_dir() {
            return Err(AppError::TerminalError(format!(
                "Working directory does not exist: {}",
                cwd
            )));
        }
        cmd.cwd(cwd);

        let _child = pair.slave.spawn_command(cmd).map_err(|e| {
            AppError::TerminalError(format!("Failed to spawn shell: {}", e))
        })?;

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

        // Spawn blocking read task
        let tid = terminal_id.clone();
        let sid = session_id.to_string();
        let ah = app_handle.clone();
        tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            let event_name = format!("terminal-output-{}", tid);
            let mut line_buffer = String::new();
            let mut detected_ports: HashSet<u16> = HashSet::new();

            loop {
                // Check if we should shutdown (non-blocking)
                if shutdown_rx.try_recv().is_ok() {
                    debug!("Terminal reader shutdown for {}", tid);
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        info!("Terminal PTY closed for {}", tid);
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        if let Err(e) = ah.emit(&event_name, &data) {
                            warn!("Failed to emit terminal output: {}", e);
                        }

                        // Scan for dev server URLs in output
                        line_buffer.push_str(&data);
                        while let Some(delim_pos) = line_buffer.find(|c: char| c == '\n' || c == '\r') {
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
                            break;
                        }
                    }
                }
            }

            // Terminal closed — notify frontend to clean up
            let event = DevServerClosedEvent {
                terminal_id: tid.clone(),
                session_id: sid,
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
}
