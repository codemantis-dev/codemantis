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

/// Ensure the hook script exists at ~/.claudeforge/approval-hook.sh
pub fn ensure_hook_script() -> Result<std::path::PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::ClaudeCliError("Cannot determine home directory".into())
    })?;
    let dir = home.join(".claudeforge");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::ClaudeCliError(format!("Failed to create ~/.claudeforge: {}", e))
    })?;

    let script_path = dir.join("approval-hook.sh");
    let script = r#"#!/bin/bash
# ClaudeForge tool approval hook — DO NOT EDIT (auto-generated)
# Reads PreToolUse JSON from stdin, forwards to ClaudeForge's HTTP server,
# and outputs the decision. Auto-approves read-only tools locally.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Auto-approve read-only tools without network roundtrip
case "$TOOL_NAME" in
  Read|Glob|Grep|AskUserQuestion|ListDirectory|LS|TodoRead)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
    ;;
esac

# Forward to ClaudeForge approval server
RESPONSE=$(echo "$INPUT" | curl -s --max-time 300 -X POST \
  -H "Content-Type: application/json" \
  -d @- \
  "http://127.0.0.1:${CLAUDEFORGE_APPROVAL_PORT}/tool-approval" 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    echo "$RESPONSE"
else
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"ClaudeForge approval server unavailable"}}'
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
/// Passed via --settings to the CLI so it only affects ClaudeForge's process,
/// not other Claude Code instances in the same project.
fn build_hook_settings_json(hook_script_path: &str) -> String {
    let hook_command = format!("bash {}", hook_script_path);
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

/// Remove the ClaudeForge hook entry from a project's .claude/settings.local.json
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
                .map(|c| c.contains(".claudeforge/approval-hook.sh"))
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
                "Cleaned up legacy ClaudeForge hook from {}",
                settings_path.display()
            );
        }
    }
}

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
        approval_server_port: Option<u16>,
    ) -> Result<Self, AppError> {
        info!(
            "Spawning Claude CLI for session {} in {} (resume: {:?}, approval_port: {:?})",
            session_id, project_path, resume_cli_session_id, approval_server_port
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
            // Tool approval is handled by the PreToolUse hook + ClaudeForge's
            // approval server instead.
            "--dangerously-skip-permissions",
        ]);

        // If an approval server is running, pass hook config via --settings flag
        // so it only affects THIS process, not other Claude Code instances.
        if let Some(port) = approval_server_port {
            let hook_script = ensure_hook_script()?;
            let settings_json = build_hook_settings_json(
                hook_script.to_str().unwrap_or("~/.claudeforge/approval-hook.sh"),
            );
            cmd.args(["--settings", &settings_json]);
            debug!("Hook config passed via --settings for port {}", port);
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

        // Pass the approval server port to the hook script via env var
        if let Some(port) = approval_server_port {
            cmd.env("CLAUDEFORGE_APPROVAL_PORT", port.to_string());
        }

        let mut child = cmd.spawn().map_err(|e| {
            error!("Failed to spawn Claude CLI: {}", e);
            AppError::ClaudeCliError(format!("Failed to spawn: {}", e))
        })?;

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

        // Channel for parsed events
        let (event_tx, event_rx) = mpsc::unbounded_channel();

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
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }
}
