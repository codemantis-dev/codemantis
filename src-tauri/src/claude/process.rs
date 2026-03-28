use crate::claude::event_types::{ControlRequestPayload, FrontendEvent, StdinMessage};
use crate::claude::message_router::route_events;
use crate::claude::session::{AppState, SessionStatus};
use crate::claude::stream_parser::parse_stream;
use crate::errors::AppError;
use crate::utils::paths::login_shell_path;
use log::{debug, error, info, warn};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

/// Ensure the hook script exists at ~/.codemantis/approval-hook.sh
pub fn ensure_hook_script() -> Result<std::path::PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::ClaudeCliError("Cannot determine home directory".into())
    })?;
    let dir = home.join(".codemantis");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::ClaudeCliError(format!("Failed to create ~/.codemantis: {}", e))
    })?;

    let script_path = dir.join("approval-hook.sh");
    let script = r#"#!/bin/bash
# CodeMantis tool approval hook — DO NOT EDIT (auto-generated)
# Reads PreToolUse JSON from stdin, forwards to CodeMantis's HTTP server,
# and outputs the decision. Auto-approves read-only tools locally.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Inject CodeMantis session ID into the JSON payload so the approval
# server can route to the correct session (session IDs are UUIDs: [a-f0-9-])
if [ -n "$CODEMANTIS_SESSION_ID" ]; then
    if command -v jq >/dev/null 2>&1; then
        INPUT=$(echo "$INPUT" | jq -c --arg sid "$CODEMANTIS_SESSION_ID" '.forge_session_id = $sid')
    else
        INPUT=$(echo "$INPUT" | sed "s/^{/{\"forge_session_id\":\"${CODEMANTIS_SESSION_ID}\",/")
    fi
fi

# Auto-approve read-only tools without network roundtrip
case "$TOOL_NAME" in
  Read|Glob|Grep|ListDirectory|LS|TodoRead)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
    ;;
esac

# Forward to CodeMantis approval server
RESPONSE=$(echo "$INPUT" | curl -s --max-time 300 -X POST \
  -H "Content-Type: application/json" \
  -d @- \
  "http://127.0.0.1:${CODEMANTIS_APPROVAL_PORT}/tool-approval" 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    echo "$RESPONSE"
else
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"CodeMantis approval server unavailable"}}'
fi
"#;

    std::fs::write(&script_path, script).map_err(|e| {
        AppError::ClaudeCliError(format!("Failed to write hook script: {}", e))
    })?;

    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&script_path, perms).map_err(|e| {
            AppError::ClaudeCliError(format!("Failed to chmod hook script: {}", e))
        })?;
    }

    Ok(script_path)
}

/// Build an inline settings JSON string containing our hook config.
/// Passed via --settings to the CLI so it only affects CodeMantis's process,
/// not other Claude Code instances in the same project.
fn build_hook_settings_json(hook_script_path: &str) -> String {
    let hook_command = format!("bash \"{}\"", hook_script_path);
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": ".*",
                    "hooks": [
                        {
                            "type": "command",
                            "command": hook_command,
                            "timeout": 300
                        }
                    ]
                }
            ]
        }
    });
    serde_json::to_string(&settings).unwrap_or_else(|_| "{}".to_string())
}

/// Remove the CodeMantis hook entry from a project's .claude/settings.local.json
/// if it was previously written there by older versions.
fn cleanup_legacy_hook_config(project_path: &str) {
    let settings_path = std::path::Path::new(project_path)
        .join(".claude")
        .join("settings.local.json");

    if !settings_path.exists() {
        return;
    }

    let content = match std::fs::read_to_string(&settings_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    // Check if hooks.PreToolUse exists and contains our entry
    let modified = if let Some(pre_tool_use) = settings
        .pointer_mut("/hooks/PreToolUse")
        .and_then(|v| v.as_array_mut())
    {
        let before_len = pre_tool_use.len();
        pre_tool_use.retain(|entry| {
            !entry["hooks"]
                .as_array()
                .and_then(|h| h.first())
                .and_then(|h| h["command"].as_str())
                .map(|c| c.contains(".codemantis/approval-hook.sh") || c.contains(".claudeforge/approval-hook.sh"))
                .unwrap_or(false)
        });
        pre_tool_use.len() != before_len
    } else {
        false
    };

    if modified {
        // Clean up empty structures
        if let Some(arr) = settings.pointer("/hooks/PreToolUse").and_then(|v| v.as_array()) {
            if arr.is_empty() {
                if let Some(hooks) = settings.get_mut("hooks").and_then(|v| v.as_object_mut()) {
                    hooks.remove("PreToolUse");
                    if hooks.is_empty() {
                        if let Some(obj) = settings.as_object_mut() {
                            obj.remove("hooks");
                        }
                    }
                }
            }
        }

        if let Ok(json) = serde_json::to_string_pretty(&settings) {
            let _ = std::fs::write(&settings_path, json);
            info!(
                "Cleaned up legacy CodeMantis hook from {}",
                settings_path.display()
            );
        }
    }
}

/// Max stderr lines kept in the ring buffer for the process exit event.
const STDERR_BUFFER_LINES: usize = 20;

pub struct ClaudeProcess {
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    session_id: String,
    pid: Option<u32>,
}

impl ClaudeProcess {
    pub async fn spawn(
        app_handle: AppHandle,
        session_id: String,
        project_path: &str,
        claude_binary: &str,
        resume_cli_session_id: Option<&str>,
        approval_server_port: Option<u16>,
        model_override: Option<&str>,
        append_system_prompt: Option<&str>,
        session_name: Option<&str>,
    ) -> Result<Self, AppError> {
        info!(
            "Spawning Claude CLI for session {} in {} (resume: {:?}, approval_port: {:?}, model: {:?})",
            session_id, project_path, resume_cli_session_id, approval_server_port, model_override
        );

        // Clean up any legacy hook config from settings.local.json
        // (older versions wrote hooks there, polluting other Claude instances)
        cleanup_legacy_hook_config(project_path);

        let mut cmd = Command::new(claude_binary);
        cmd.args([
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
            // Skip CLI-level permissions: the CLI has no TTY in stream-json mode.
            // Tool approval is handled by the PreToolUse hook + CodeMantis's
            // approval server instead.
            "--dangerously-skip-permissions",
        ]);

        // If an approval server is running, pass hook config via --settings flag
        // so it only affects THIS process, not other Claude Code instances.
        if let Some(port) = approval_server_port {
            let hook_script = ensure_hook_script()?;
            let settings_json = build_hook_settings_json(
                hook_script.to_str().unwrap_or("~/.codemantis/approval-hook.sh"),
            );
            cmd.args(["--settings", &settings_json]);
            debug!("Hook config passed via --settings for port {}", port);
        }

        // Model override (for SpecWriter sessions with a specific model)
        if let Some(model) = model_override {
            cmd.args(["--model", model]);
        }

        // Append system prompt (for SpecWriter behavioral instructions)
        if let Some(prompt) = append_system_prompt {
            cmd.args(["--append-system-prompt", prompt]);
        }

        if let Some(cli_sid) = resume_cli_session_id {
            cmd.args(["--resume", cli_sid]);
        }
        if let Some(name) = session_name {
            cmd.args(["--name", name]);
        }
        cmd.current_dir(project_path);

        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Remove env vars that cause nested session detection
        cmd.env_remove("CLAUDECODE");
        cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");

        // Pass the approval server port to the hook script via env var
        if let Some(port) = approval_server_port {
            cmd.env("CODEMANTIS_APPROVAL_PORT", port.to_string());
        }

        // Pass the CodeMantis session ID so the hook script can inject it
        // into the approval request for unambiguous session routing
        cmd.env("CODEMANTIS_SESSION_ID", &session_id);

        // Use the full login-shell PATH so Claude can find tools like
        // brew, npm, pnpm, cargo, etc. that aren't in the minimal GUI PATH
        cmd.env("PATH", login_shell_path());

        let mut child = cmd.spawn().map_err(|e| {
            error!("Failed to spawn Claude CLI: {}", e);
            AppError::ClaudeCliError(format!("Failed to spawn: {}", e))
        })?;

        // Track the child PID for cleanup on exit/crash
        let child_pid = child.id();
        if let Some(pid) = child_pid {
            crate::utils::pid_tracker::register_pid(pid);
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::ClaudeCliError("No stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::ClaudeCliError("No stderr".into()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::ClaudeCliError("No stdin".into()))?;

        // Bounded channel for parsed events — provides natural backpressure
        let (event_tx, event_rx) = mpsc::channel(256);

        // Stdin writer task
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        tokio::spawn(async move {
            let mut stdin = stdin;
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

        // Shared stderr buffer (ring buffer of last N lines)
        let stderr_buf: Arc<tokio::sync::Mutex<Vec<String>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));

        // Stderr logger + buffer task
        let sid_stderr = session_id.clone();
        let stderr_buf_clone = Arc::clone(&stderr_buf);
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                debug!("[stderr:{}] {}", sid_stderr, line);
                let mut buf = stderr_buf_clone.lock().await;
                buf.push(line);
                if buf.len() > STDERR_BUFFER_LINES {
                    buf.remove(0);
                }
            }
        });

        // Stdout parser task
        tokio::spawn(async move {
            parse_stream(stdout, event_tx).await;
        });

        // Message router task
        let router_app = app_handle.clone();
        let sid_clone = session_id.clone();
        tokio::spawn(async move {
            route_events(router_app, sid_clone, event_rx).await;
        });

        // Wrap child in Arc<Mutex> so the monitor task and shutdown() can share it
        let child_arc: Arc<tokio::sync::Mutex<Option<Child>>> =
            Arc::new(tokio::sync::Mutex::new(Some(child)));

        // Process monitor task — detects when the CLI exits.
        // Uses try_wait polling to avoid holding the child lock across await
        // points, which would deadlock with shutdown().
        let monitor_child = Arc::clone(&child_arc);
        let monitor_stderr = Arc::clone(&stderr_buf);
        let monitor_sid = session_id.clone();
        let monitor_app = app_handle.clone();
        let monitor_pid = child_pid;
        let spawn_instant = std::time::Instant::now();
        tokio::spawn(async move {
            // Poll the child process status without holding the lock across awaits
            let exit_status = loop {
                {
                    let mut guard = monitor_child.lock().await;
                    match guard.as_mut() {
                        None => {
                            // Child was already taken by shutdown()
                            return;
                        }
                        Some(child) => {
                            match child.try_wait() {
                                Ok(Some(status)) => {
                                    // Process exited — take it out
                                    guard.take();
                                    break Some(status);
                                }
                                Ok(None) => {
                                    // Still running — drop lock and sleep
                                }
                                Err(e) => {
                                    error!("[monitor:{}] Failed to check child: {}", monitor_sid, e);
                                    guard.take();
                                    break None;
                                }
                            }
                        }
                    }
                    // guard is dropped here
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            };

            // Unregister PID now that the process has exited
            if let Some(pid) = monitor_pid {
                crate::utils::pid_tracker::unregister_pid(pid);
            }

            let elapsed_ms = spawn_instant.elapsed().as_millis() as u64;

            // Wait for the message router to finish processing all buffered events.
            // The stdout pipe closes → stream parser exits → message router drains
            // its channel. We need to give this chain enough time to complete before
            // emitting ProcessExited, which the frontend uses as a recovery signal.
            tokio::time::sleep(std::time::Duration::from_millis(2000)).await;

            let exit_code = exit_status.and_then(|s| s.code());
            let stderr_tail = {
                let buf = monitor_stderr.lock().await;
                if buf.is_empty() {
                    None
                } else {
                    Some(buf.join("\n"))
                }
            };

            info!(
                "[monitor:{}] Process exited with code {:?} after {}ms",
                monitor_sid, exit_code, elapsed_ms
            );

            // Update session status in AppState (if not already Closed)
            if let Some(state) = monitor_app.try_state::<AppState>() {
                let mut sessions = state.sessions.lock().await;
                if let Some(session_info) = sessions.get_mut(&monitor_sid) {
                    if session_info.status != SessionStatus::Closed {
                        session_info.status = SessionStatus::Idle;
                    }
                }
            }

            // Emit ProcessExited event to frontend on the session-specific channel
            // (must match the channel the frontend listens on: "claude-chat-{sessionId}")
            let chat_channel = format!("claude-chat-{}", monitor_sid);
            let event = FrontendEvent::ProcessExited {
                session_id: monitor_sid.clone(),
                exit_code,
                stderr_tail,
                elapsed_ms,
            };
            if let Err(e) = monitor_app.emit(&chat_channel, &event) {
                error!(
                    "[monitor:{}] Failed to emit process_exited: {}",
                    monitor_sid, e
                );
            }
        });

        Ok(Self {
            child: child_arc,
            stdin_tx,
            session_id,
            pid: child_pid,
        })
    }

    pub fn send_control_request(&self, payload: ControlRequestPayload) -> Result<String, AppError> {
        let request_id = format!("req_{}", uuid::Uuid::new_v4().simple());
        let msg = StdinMessage::ControlRequest {
            request_id: request_id.clone(),
            request: payload,
        };
        let mut json =
            serde_json::to_string(&msg).map_err(|e| AppError::SendFailed(e.to_string()))?;
        json.push('\n');
        self.stdin_tx
            .send(json.into_bytes())
            .map_err(|e| AppError::SendFailed(e.to_string()))?;
        Ok(request_id)
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

    pub async fn shutdown(&mut self) {
        info!("Shutting down Claude process for session {}", self.session_id);
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            if let Err(e) = child.kill().await {
                warn!("[process] Failed to kill child process for session {}: {}", self.session_id, e);
            }
            if let Some(pid) = self.pid {
                crate::utils::pid_tracker::unregister_pid(pid);
            }
        }
    }

    pub fn is_running(&self) -> bool {
        // Try to check if the child is still present.
        // If the lock is held (monitor task awaiting), assume running.
        match self.child.try_lock() {
            Ok(guard) => guard.is_some(),
            Err(_) => true,
        }
    }
}

impl Drop for ClaudeProcess {
    fn drop(&mut self) {
        // Last-resort safety net: if the child is still alive when we're dropped,
        // send SIGKILL synchronously. Uses try_lock to avoid deadlocking.
        if let Some(pid) = self.pid {
            if let Ok(guard) = self.child.try_lock() {
                if guard.is_some() {
                    warn!(
                        "[process] Drop safety net: killing PID {} for session {}",
                        pid, self.session_id
                    );
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGKILL);
                    }
                    crate::utils::pid_tracker::unregister_pid(pid);
                }
            }
        }
    }
}
