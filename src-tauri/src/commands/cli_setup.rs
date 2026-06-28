//! In-app CLI install / update — the npm-free path.
//!
//! Most CodeMantis users are non-developers on macOS, where `npm`/Node is not
//! installed by default. Telling them to run `npm install -g …` is a dead end.
//! Instead we drive the **official native installer** (a standalone binary that
//! needs no npm/Node) from inside the app and stream its output to the Welcome
//! screen:
//!   - Claude → `curl -fsSL https://claude.ai/install.sh | bash`
//!     (lands in `~/.local/bin/claude`, which `find_claude_binary()` already
//!     detects regardless of PATH).
//!   - Codex  → `curl -fsSL https://chatgpt.com/codex/install.sh | sh`.
//!
//! Execution reuses `preflight::installer::run` (login-shell PATH, refuses
//! `sudo`/`su`, line-streamed stdout/stderr). The frontend re-checks status via
//! the existing `check_claude_status` / `check_codex_status` once we return.

use crate::agents::AgentId;
use crate::preflight::catalog::Remediation;
use crate::preflight::installer::{self, InstallResult, ProgressStream};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event name the Welcome screen subscribes to for live install output.
pub const EVENT_CLI_SETUP_PROGRESS: &str = "cli-setup:progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSetupProgressPayload {
    /// `"claude_code"` or `"codex"` — lets the UI route lines to the right row.
    pub agent: String,
    pub line: String,
    pub stream: ProgressStream,
}

/// Only allow simple channel/version tokens (e.g. `stable`, `2.1.89`). Anything
/// with shell metacharacters is dropped — the script runs through `sh -c`, so
/// this prevents injection even though today's callers only pass fixed values.
fn sanitize_channel(channel: &str) -> Option<String> {
    let trimmed = channel.trim();
    if !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

/// Whether Claude is already installed as a native binary under
/// `~/.local/bin/claude`. When true and no specific channel was requested we can
/// run the fast in-place `claude update` instead of re-downloading via the
/// installer script. (npm/Homebrew installs are NOT native — the installer
/// script is the universal fallback for those.)
fn claude_is_native() -> bool {
    dirs::home_dir()
        .map(|h| h.join(".local/bin/claude").exists())
        .unwrap_or(false)
}

/// Build the `Remediation::Automated` that installs or updates `agent`.
fn build_remediation(agent: AgentId, channel: Option<&str>, native: bool) -> Remediation {
    let script = match agent {
        AgentId::ClaudeCode => {
            if native && channel.is_none() {
                // Fast in-place self-update for an existing native install.
                "claude update".to_string()
            } else {
                let mut s = "curl -fsSL https://claude.ai/install.sh | bash".to_string();
                if let Some(ch) = channel {
                    // `bash -s <channel>` forwards the channel to install.sh as $1.
                    s.push_str(&format!(" -s {ch}"));
                }
                s
            }
        }
        AgentId::Codex => "curl -fsSL https://chatgpt.com/codex/install.sh | sh".to_string(),
    };

    Remediation::Automated {
        estimated_minutes: 2,
        command: "sh".to_string(),
        args: vec!["-c".to_string(), script],
        success_message: Some(format!(
            "{} installed successfully. Re-checking…",
            match agent {
                AgentId::ClaudeCode => "Claude Code",
                AgentId::Codex => "OpenAI Codex",
            }
        )),
    }
}

/// Install or update a coding-agent CLI using its official npm-free installer.
/// Streams progress lines as `cli-setup:progress` events. Returns the final
/// `InstallResult`; the frontend then re-runs the status check.
#[tauri::command]
pub async fn install_or_update_cli(
    app: AppHandle,
    agent: AgentId,
    channel: Option<String>,
) -> Result<InstallResult, String> {
    let channel = channel.as_deref().and_then(sanitize_channel);
    let native = matches!(agent, AgentId::ClaudeCode) && claude_is_native();
    let remediation = build_remediation(agent, channel.as_deref(), native);

    let app_clone = app.clone();
    installer::run(&remediation, move |progress| {
        let _ = app_clone.emit(
            EVENT_CLI_SETUP_PROGRESS,
            CliSetupProgressPayload {
                agent: agent.as_str().to_string(),
                line: progress.line,
                stream: progress.stream,
            },
        );
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script_of(r: &Remediation) -> String {
        match r {
            Remediation::Automated { command, args, .. } => {
                assert_eq!(command, "sh");
                assert_eq!(args.first().map(String::as_str), Some("-c"));
                args.get(1).cloned().unwrap_or_default()
            }
            _ => panic!("expected Automated remediation"),
        }
    }

    #[test]
    fn claude_fresh_install_uses_native_installer() {
        let r = build_remediation(AgentId::ClaudeCode, None, false);
        let s = script_of(&r);
        assert!(s.contains("https://claude.ai/install.sh"), "got: {s}");
        assert!(s.contains("| bash"));
        assert!(!s.contains("-s "), "no channel flag expected: {s}");
    }

    #[test]
    fn claude_native_update_uses_claude_update() {
        let r = build_remediation(AgentId::ClaudeCode, None, true);
        assert_eq!(script_of(&r), "claude update");
    }

    #[test]
    fn claude_channel_forwarded_even_when_native() {
        // An explicit channel forces a full installer run so the requested
        // channel is honored, never the silent `claude update` path.
        let r = build_remediation(AgentId::ClaudeCode, Some("stable"), true);
        let s = script_of(&r);
        assert!(s.contains("install.sh"));
        assert!(s.ends_with("| bash -s stable"), "got: {s}");
    }

    #[test]
    fn codex_uses_codex_installer() {
        let r = build_remediation(AgentId::Codex, None, false);
        let s = script_of(&r);
        assert!(s.contains("https://chatgpt.com/codex/install.sh"), "got: {s}");
        assert!(s.contains("| sh"));
    }

    #[test]
    fn sanitize_channel_accepts_versions_and_tags() {
        assert_eq!(sanitize_channel("stable").as_deref(), Some("stable"));
        assert_eq!(sanitize_channel("2.1.89").as_deref(), Some("2.1.89"));
        assert_eq!(sanitize_channel(" latest ").as_deref(), Some("latest"));
    }

    #[test]
    fn sanitize_channel_rejects_shell_metacharacters() {
        assert!(sanitize_channel("stable; rm -rf /").is_none());
        assert!(sanitize_channel("$(whoami)").is_none());
        assert!(sanitize_channel("a b").is_none());
        assert!(sanitize_channel("").is_none());
        assert!(sanitize_channel("`id`").is_none());
    }

    #[test]
    fn remediation_is_never_privileged() {
        // Sanity: none of our scripts invoke sudo, so installer::run won't refuse.
        for r in [
            build_remediation(AgentId::ClaudeCode, None, false),
            build_remediation(AgentId::ClaudeCode, None, true),
            build_remediation(AgentId::Codex, None, false),
        ] {
            assert!(!script_of(&r).contains("sudo"));
        }
    }
}
