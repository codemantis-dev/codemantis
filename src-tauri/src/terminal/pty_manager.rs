use crate::errors::AppError;
use crate::preview::port_detector::scan_for_dev_server_url;
use log::{debug, error, info, warn};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
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

        let shell_cmd = shell
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
            });

        let mut cmd = CommandBuilder::new(&shell_cmd);
        if let Some(ref extra_args) = args {
            for arg in extra_args {
                cmd.arg(arg);
            }
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

    pub async fn list_for_session(&self, session_id: &str) -> Vec<String> {
        let st = self.session_terminals.lock().await;
        st.get(session_id).cloned().unwrap_or_default()
    }
}
