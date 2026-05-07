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
  Read|Glob|Grep|ListDirectory|LS|TodoRead|Monitor)
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

/// Diagnostic-only: open a per-session raw NDJSON log file when
/// `CODEMANTIS_RAW_STREAM_LOG=1`. Returns `None` (silently) if the
/// env var is unset or anything goes wrong — this must never break
/// the CLI session.
fn maybe_open_raw_stream_log(session_id: &str) -> Option<tokio::fs::File> {
    if std::env::var("CODEMANTIS_RAW_STREAM_LOG").ok().as_deref() != Some("1") {
        return None;
    }
    let dir = dirs::home_dir()?.join(".codemantis");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        warn!("[raw-stream-log] cannot create dir: {}", e);
        return None;
    }
    let path = dir.join(format!("raw-stream-{}.jsonl", session_id));
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(std_file) => {
            info!("[raw-stream-log] capturing CLI stdout to {}", path.display());
            Some(tokio::fs::File::from_std(std_file))
        }
        Err(e) => {
            warn!("[raw-stream-log] cannot open {}: {}", path.display(), e);
            None
        }
    }
}

/// Ensure the title hook script exists at ~/.codemantis/title-hook.sh.
/// This hook runs on UserPromptSubmit and sets the CLI session title
/// from the first ~80 characters of the user's message.
pub fn ensure_title_hook_script() -> Result<std::path::PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::ClaudeCliError("Cannot determine home directory".into())
    })?;
    let dir = home.join(".codemantis");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::ClaudeCliError(format!("Failed to create ~/.codemantis: {}", e))
    })?;

    let script_path = dir.join("title-hook.sh");
    let script = r#"#!/bin/bash
# CodeMantis session title hook — DO NOT EDIT (auto-generated)
# Reads UserPromptSubmit JSON from stdin, extracts the user message,
# and returns a sessionTitle for the CLI's resume picker.

INPUT=$(cat)

# Extract the user message text (try "message" field, then "content")
if command -v jq >/dev/null 2>&1; then
    MSG=$(echo "$INPUT" | jq -r '(.message // .content // "") | tostring' 2>/dev/null)
else
    MSG=$(echo "$INPUT" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -z "$MSG" ]; then
        MSG=$(echo "$INPUT" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
fi

# Skip empty messages or very short ones
if [ -z "$MSG" ] || [ ${#MSG} -lt 3 ]; then
    exit 0
fi

# Truncate to ~80 chars at a word boundary
TITLE=$(echo "$MSG" | head -c 80 | sed 's/ [^ ]*$//')
if [ ${#MSG} -gt 80 ]; then
    TITLE="${TITLE}..."
fi

# Output sessionTitle (safe JSON via jq if available)
if command -v jq >/dev/null 2>&1; then
    jq -nc --arg t "$TITLE" '{"hookSpecificOutput":{"sessionTitle":$t}}'
else
    # Escape double quotes in title for safe JSON
    SAFE_TITLE=$(echo "$TITLE" | sed 's/"/\\"/g')
    echo "{\"hookSpecificOutput\":{\"sessionTitle\":\"${SAFE_TITLE}\"}}"
fi
"#;

    std::fs::write(&script_path, script).map_err(|e| {
        AppError::ClaudeCliError(format!("Failed to write title hook script: {}", e))
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&script_path, perms).map_err(|e| {
            AppError::ClaudeCliError(format!("Failed to chmod title hook script: {}", e))
        })?;
    }

    Ok(script_path)
}

/// Build an inline settings JSON string for our session.
/// Passed via --settings to the CLI so it only affects CodeMantis's process,
/// not other Claude Code instances in the same project.
///
/// Always includes `alwaysThinkingEnabled` and `showThinkingSummaries` so
/// Opus thinking blocks appear in the stream-json output — CLI v2.1.90+
/// stopped emitting these by default.
///
/// Hook paths are optional: when provided, PreToolUse + UserPromptSubmit
/// hooks are wired in; when absent, only the thinking settings are emitted.
fn build_session_settings_json(
    hook_paths: Option<(&str, &str)>,
) -> String {
    let mut settings = serde_json::json!({
        "alwaysThinkingEnabled": true,
        "showThinkingSummaries": true,
    });

    if let Some((hook_script_path, title_hook_script_path)) = hook_paths {
        let hook_command = format!("bash \"{}\"", hook_script_path);
        let title_hook_command = format!("bash \"{}\"", title_hook_script_path);
        settings["hooks"] = serde_json::json!({
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
            ],
            "UserPromptSubmit": [
                {
                    "matcher": ".*",
                    "hooks": [
                        {
                            "type": "command",
                            "command": title_hook_command,
                            "timeout": 10
                        }
                    ]
                }
            ]
        });
    }

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
            if let Err(e) = std::fs::write(&settings_path, json) {
                log::warn!("Failed to clean up legacy hook in {}: {}", settings_path.display(), e);
            }
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
    #[allow(clippy::too_many_arguments)]
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
        effort_override: Option<&str>,
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
            //
            // ⚠ DO NOT pair this with `--permission-mode <m>` — the CLI silently
            // overrides any --permission-mode value to "bypassPermissions" when
            // --dangerously-skip-permissions is present. To enter plan mode at
            // runtime, send a `set_permission_mode` control_request after spawn
            // (see send_control_request / process.rs control protocol surface).
            // Verified against CLI 2.1.126 in
            // src-tauri/tests/cli_protocol_capture.rs scenario S06.
            "--dangerously-skip-permissions",
            // Opus 4.7+ defaults thinking.display to "omitted", which streams
            // thinking blocks with empty text. We need summarized content so
            // the Reasoning panel in the Activity tab can show it.
            "--thinking-display",
            "summarized",
        ]);

        // Always pass --settings so thinking output (alwaysThinkingEnabled,
        // showThinkingSummaries) is explicitly enabled — CLI v2.1.90+ disabled
        // thinking summaries by default. --thinking-display above handles
        // the API-level display parameter separately. If an approval server
        // is running we also bundle the PreToolUse + UserPromptSubmit hooks
        // in the same settings blob so they only affect THIS process.
        let settings_json = if let Some(port) = approval_server_port {
            let hook_script = ensure_hook_script()?;
            let title_hook_script = ensure_title_hook_script()?;
            let json = build_session_settings_json(Some((
                hook_script.to_str().unwrap_or("~/.codemantis/approval-hook.sh"),
                title_hook_script.to_str().unwrap_or("~/.codemantis/title-hook.sh"),
            )));
            debug!("Session settings (with hooks) passed via --settings for port {}", port);
            json
        } else {
            build_session_settings_json(None)
        };
        cmd.args(["--settings", &settings_json]);

        // Thinking-effort override uses the documented `--effort` CLI flag
        // (values per `claude --help`: low, medium, high, xhigh, max). This
        // is the ONLY spawn-time mechanism the CLI documents — putting
        // `thinking.effort` in the --settings blob is undocumented, the
        // CLI does not echo it back in `system/init`, and we have no way
        // to verify it took effect. The runtime alternatives are all
        // unavailable in stream-json mode (`set_effort` control_request
        // unsupported, `/effort` slash command TTY-only). See memory
        // project_cli_effort_runtime_constraints.md.
        if let Some(effort) = effort_override {
            cmd.args(["--effort", effort]);
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

        // Stdout parser task — optionally tee raw NDJSON to a per-session
        // log file when CODEMANTIS_RAW_STREAM_LOG=1, for protocol diagnostics.
        let raw_log = maybe_open_raw_stream_log(&session_id);

        // Protocol-failure channel: parser fires this once if it sees sustained
        // un-parseable output before any valid event (an outdated CLI is the
        // common cause). A small task forwards that into a frontend
        // `process_error` so the user gets the "Outdated CLI" remediation card
        // instead of a silent stuck session.
        let (proto_tx, mut proto_rx) = mpsc::channel::<String>(1);
        tokio::spawn(async move {
            parse_stream(stdout, event_tx, raw_log, Some(proto_tx)).await;
        });

        let proto_app = app_handle.clone();
        let proto_sid = session_id.clone();
        tokio::spawn(async move {
            if let Some(detail) = proto_rx.recv().await {
                let chat_channel = format!("claude-chat-{}", proto_sid);
                let user_msg = format!(
                    "The Claude Code CLI is producing output we cannot parse ({}). \
                     This usually means the installed CLI is too old. \
                     Run `npm install -g @anthropic-ai/claude-code@latest` and restart CodeMantis.",
                    detail
                );
                let payload = FrontendEvent::ProcessError {
                    session_id: proto_sid.clone(),
                    error: user_msg,
                };
                if let Err(e) = proto_app.emit(&chat_channel, &payload) {
                    warn!("[process:{}] failed to emit protocol-failure event: {}", proto_sid, e);
                }
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── build_session_settings_json ──

    #[test]
    fn build_session_settings_json_produces_valid_json() {
        let result =
            build_session_settings_json(Some(("/path/to/hook.sh", "/path/to/title.sh")));
        let parsed: serde_json::Value = serde_json::from_str(&result)
            .expect("should be valid JSON");
        assert!(parsed.is_object());
    }

    #[test]
    fn build_session_settings_json_contains_hook_command() {
        let result =
            build_session_settings_json(Some(("/path/to/hook.sh", "/path/to/title.sh")));
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();

        let command = parsed
            .pointer("/hooks/PreToolUse/0/hooks/0/command")
            .and_then(|v| v.as_str())
            .expect("should have command field");
        assert!(command.contains("/path/to/hook.sh"));
        assert!(command.starts_with("bash "));
    }

    #[test]
    fn build_session_settings_json_sets_timeout_300() {
        let result = build_session_settings_json(Some(("/any/path.sh", "/any/title.sh")));
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();

        let timeout = parsed
            .pointer("/hooks/PreToolUse/0/hooks/0/timeout")
            .and_then(|v| v.as_u64())
            .expect("should have timeout field");
        assert_eq!(timeout, 300);
    }

    #[test]
    fn build_session_settings_json_sets_matcher_wildcard() {
        let result = build_session_settings_json(Some(("/hook.sh", "/title.sh")));
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();

        let matcher = parsed
            .pointer("/hooks/PreToolUse/0/matcher")
            .and_then(|v| v.as_str())
            .expect("should have matcher field");
        assert_eq!(matcher, ".*");
    }

    #[test]
    fn build_session_settings_json_handles_path_with_spaces() {
        let result = build_session_settings_json(Some((
            "/path with spaces/hook.sh",
            "/path with spaces/title.sh",
        )));
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        let command = parsed
            .pointer("/hooks/PreToolUse/0/hooks/0/command")
            .and_then(|v| v.as_str())
            .unwrap();
        assert!(command.contains("/path with spaces/hook.sh"));
    }

    #[test]
    fn build_session_settings_json_contains_user_prompt_submit_hook() {
        let result = build_session_settings_json(Some(("/hook.sh", "/title.sh")));
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();

        let command = parsed
            .pointer("/hooks/UserPromptSubmit/0/hooks/0/command")
            .and_then(|v| v.as_str())
            .expect("should have UserPromptSubmit hook command");
        assert!(command.contains("/title.sh"));
        assert!(command.starts_with("bash "));

        let timeout = parsed
            .pointer("/hooks/UserPromptSubmit/0/hooks/0/timeout")
            .and_then(|v| v.as_u64())
            .expect("should have timeout");
        assert_eq!(timeout, 10);

        let matcher = parsed
            .pointer("/hooks/UserPromptSubmit/0/matcher")
            .and_then(|v| v.as_str())
            .expect("should have matcher");
        assert_eq!(matcher, ".*");
    }

    #[test]
    fn build_session_settings_json_enables_thinking_with_hooks() {
        let result = build_session_settings_json(Some(("/hook.sh", "/title.sh")));
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();

        assert_eq!(
            parsed.get("alwaysThinkingEnabled").and_then(|v| v.as_bool()),
            Some(true),
            "alwaysThinkingEnabled must be true so Opus emits thinking blocks"
        );
        assert_eq!(
            parsed.get("showThinkingSummaries").and_then(|v| v.as_bool()),
            Some(true),
            "showThinkingSummaries must be true (CLI v2.1.90+ defaulted this to false)"
        );
    }

    #[test]
    fn build_session_settings_json_enables_thinking_without_hooks() {
        let result = build_session_settings_json(None);
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();

        assert_eq!(
            parsed.get("alwaysThinkingEnabled").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            parsed.get("showThinkingSummaries").and_then(|v| v.as_bool()),
            Some(true)
        );
        // When no hooks are provided, the hooks key must be absent so the
        // CLI does not try to invoke missing scripts.
        assert!(
            parsed.get("hooks").is_none(),
            "hooks key should be absent when no hook paths are supplied"
        );
    }

    // ── ensure_hook_script ──

    #[test]
    fn ensure_hook_script_creates_executable_file() {
        // This test uses the real home directory; it's safe because
        // ensure_hook_script always writes to ~/.codemantis/ which we own.
        let path = ensure_hook_script().expect("should succeed");
        assert!(path.exists());
        assert!(path.to_string_lossy().ends_with("approval-hook.sh"));

        // Verify content
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("#!/bin/bash"));
        assert!(content.contains("CODEMANTIS_SESSION_ID"));
        assert!(content.contains("tool-approval"));

        // Verify executable permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o755, 0o755);
        }
    }

    #[test]
    fn ensure_title_hook_script_creates_executable_file() {
        let path = ensure_title_hook_script().expect("should succeed");
        assert!(path.exists());
        assert!(path.to_string_lossy().ends_with("title-hook.sh"));

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("#!/bin/bash"));
        assert!(content.contains("sessionTitle"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o755, 0o755);
        }
    }

    // ── cleanup_legacy_hook_config ──

    #[test]
    fn cleanup_legacy_hook_config_noop_when_file_missing() {
        // Should not panic when settings file doesn't exist
        cleanup_legacy_hook_config("/nonexistent/project/path");
    }

    #[test]
    fn cleanup_legacy_hook_config_removes_codemantis_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let settings_path = settings_dir.join("settings.local.json");

        let settings = serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": ".*",
                        "hooks": [{
                            "type": "command",
                            "command": "bash \"/Users/test/.codemantis/approval-hook.sh\""
                        }]
                    }
                ]
            },
            "otherSetting": true
        });
        std::fs::write(&settings_path, serde_json::to_string_pretty(&settings).unwrap()).unwrap();

        cleanup_legacy_hook_config(tmp.path().to_str().unwrap());

        let content = std::fs::read_to_string(&settings_path).unwrap();
        let result: serde_json::Value = serde_json::from_str(&content).unwrap();

        // The hooks key should be cleaned up (empty after removal)
        assert!(result.get("hooks").is_none(), "hooks key should be removed when empty");
        // Other settings should be preserved
        assert_eq!(result["otherSetting"], serde_json::json!(true));
    }

    #[test]
    fn cleanup_legacy_hook_config_preserves_other_hooks() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let settings_path = settings_dir.join("settings.local.json");

        let settings = serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": ".*",
                        "hooks": [{
                            "type": "command",
                            "command": "bash \"/Users/test/.codemantis/approval-hook.sh\""
                        }]
                    },
                    {
                        "matcher": "Bash",
                        "hooks": [{
                            "type": "command",
                            "command": "echo 'custom hook'"
                        }]
                    }
                ]
            }
        });
        std::fs::write(&settings_path, serde_json::to_string_pretty(&settings).unwrap()).unwrap();

        cleanup_legacy_hook_config(tmp.path().to_str().unwrap());

        let content = std::fs::read_to_string(&settings_path).unwrap();
        let result: serde_json::Value = serde_json::from_str(&content).unwrap();

        // Custom hook should remain
        let pre_tool_use = result.pointer("/hooks/PreToolUse").unwrap().as_array().unwrap();
        assert_eq!(pre_tool_use.len(), 1);
        let remaining_command = pre_tool_use[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(remaining_command.contains("custom hook"));
    }

    #[test]
    fn cleanup_legacy_hook_config_handles_claudeforge_path() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let settings_path = settings_dir.join("settings.local.json");

        let settings = serde_json::json!({
            "hooks": {
                "PreToolUse": [{
                    "matcher": ".*",
                    "hooks": [{
                        "type": "command",
                        "command": "bash \"/Users/test/.claudeforge/approval-hook.sh\""
                    }]
                }]
            }
        });
        std::fs::write(&settings_path, serde_json::to_string_pretty(&settings).unwrap()).unwrap();

        cleanup_legacy_hook_config(tmp.path().to_str().unwrap());

        let content = std::fs::read_to_string(&settings_path).unwrap();
        let result: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(result.get("hooks").is_none(), "claudeforge entry should be removed");
    }

    #[test]
    fn cleanup_legacy_hook_config_noop_when_no_hooks_section() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let settings_path = settings_dir.join("settings.local.json");

        let settings = serde_json::json!({ "theme": "dark" });
        std::fs::write(&settings_path, serde_json::to_string_pretty(&settings).unwrap()).unwrap();

        cleanup_legacy_hook_config(tmp.path().to_str().unwrap());

        let content = std::fs::read_to_string(&settings_path).unwrap();
        let result: serde_json::Value = serde_json::from_str(&content).unwrap();
        // File should be unchanged
        assert_eq!(result["theme"], serde_json::json!("dark"));
    }
}
