use crate::claude::event_types::StdinMessage;
use crate::claude::message_router::route_events;
use crate::claude::stream_parser::parse_stream;
use crate::errors::AppError;
use log::{debug, error, info, warn};
use std::process::Stdio;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub struct ClaudeProcess {
    child: Option<Child>,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    session_id: String,
}

impl ClaudeProcess {
    pub async fn spawn(
        app_handle: AppHandle,
        session_id: String,
        project_path: &str,
        claude_binary: &str,
        resume_cli_session_id: Option<&str>,
        skip_permissions: bool,
    ) -> Result<Self, AppError> {
        info!(
            "Spawning Claude CLI for session {} in {} (resume: {:?}, skip_permissions: {})",
            session_id, project_path, resume_cli_session_id, skip_permissions
        );

        let mut cmd = Command::new(claude_binary);
        cmd.args([
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
        ]);
        if skip_permissions {
            cmd.arg("--dangerously-skip-permissions");
        }
        if let Some(cli_sid) = resume_cli_session_id {
            cmd.args(["--resume", cli_sid]);
        }
        cmd.current_dir(project_path);

        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Remove env vars that cause nested session detection
        cmd.env_remove("CLAUDECODE");
        cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");

        let mut child = cmd.spawn().map_err(|e| {
            error!("Failed to spawn Claude CLI: {}", e);
            AppError::ClaudeCliError(format!("Failed to spawn: {}", e))
        })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::ClaudeCliError("Failed to capture stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::ClaudeCliError("Failed to capture stderr".into()))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::ClaudeCliError("Failed to capture stdin".into()))?;

        // Channel for stdin writes
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // Channel for parsed events
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        // Stdin writer task
        tokio::spawn(async move {
            while let Some(data) = stdin_rx.recv().await {
                if let Err(e) = stdin.write_all(&data).await {
                    warn!("Failed to write to stdin: {}", e);
                    break;
                }
                if let Err(e) = stdin.flush().await {
                    warn!("Failed to flush stdin: {}", e);
                    break;
                }
            }
            debug!("Stdin writer task finished");
        });

        // Stderr logger task
        let sid_clone = session_id.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                debug!("[stderr:{}] {}", sid_clone, line);
            }
        });

        // Stdout parser task
        tokio::spawn(async move {
            parse_stream(stdout, event_tx).await;
        });

        // Message router task
        let sid_clone = session_id.clone();
        tokio::spawn(async move {
            route_events(app_handle, sid_clone, event_rx).await;
        });

        Ok(Self {
            child: Some(child),
            stdin_tx,
            session_id,
        })
    }

    pub fn send_message(&self, text: &str) -> Result<(), AppError> {
        let msg = StdinMessage::new_user_message(text);
        let mut json = serde_json::to_string(&msg)
            .map_err(|e| AppError::SendFailed(e.to_string()))?;
        json.push('\n');
        self.stdin_tx
            .send(json.into_bytes())
            .map_err(|e| AppError::SendFailed(e.to_string()))
    }

    pub fn send_raw(&self, json_str: &str) -> Result<(), AppError> {
        let mut data = json_str.to_string();
        if !data.ends_with('\n') {
            data.push('\n');
        }
        self.stdin_tx
            .send(data.into_bytes())
            .map_err(|e| AppError::SendFailed(e.to_string()))
    }

    pub async fn shutdown(&mut self) {
        info!("Shutting down Claude process for session {}", self.session_id);

        if let Some(ref mut child) = self.child {
            // Try SIGTERM first
            #[cfg(unix)]
            {
                if let Some(pid) = child.id() {
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                    }
                }
            }

            // Wait up to 5 seconds
            match tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    info!("Claude process exited with: {}", status);
                }
                Ok(Err(e)) => {
                    warn!("Error waiting for process: {}", e);
                }
                Err(_) => {
                    warn!("Process didn't exit in 5s, killing");
                    let _ = child.kill().await;
                }
            }
        }

        self.child = None;
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }
}

impl Drop for ClaudeProcess {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.child {
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
        }
    }
}
