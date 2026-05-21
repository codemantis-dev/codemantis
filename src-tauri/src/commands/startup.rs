use crate::agents::claude_code::session::AppState;
use crate::commands::settings::get_settings;
use crate::agents::claude_code::claude_detection::{
    detect_claude, enrich_status, validate_claude_binary, ClaudeStatus,
};
use crate::agents::claude_code::cli_handshake_probe::probe_if_unknown;
use crate::agents::claude_code::cli_version::CliSupport;
use crate::agents::codex::auth_probe::{probe_login_status, AuthProbeOutcome};
use crate::agents::codex::binary_detect::{detect_codex, CodexStatus};
use tauri::State;

#[cfg(test)]
mod tests {
    use crate::agents::claude_code::claude_detection::{detect_claude, validate_claude_binary, ClaudeStatus};
    use crate::agents::claude_code::cli_version::CliSupport;
    use serde_json::Value;

    #[test]
    fn claude_status_serializes_required_fields() {
        let status = ClaudeStatus {
            installed: true,
            version: Some("2.1.126".to_string()),
            parsed_version: Some("2.1.126".to_string()),
            latest_version: Some("2.1.126".to_string()),
            min_supported_version: Some("2.1.116".to_string()),
            support: CliSupport::Supported,
            authenticated: true,
            binary_path: Some("/usr/local/bin/claude".to_string()),
        };
        let v: Value = serde_json::to_value(&status).expect("serialization must not fail");
        assert!(v.get("installed").is_some());
        assert!(v.get("version").is_some());
        assert!(v.get("authenticated").is_some());
        assert!(v.get("binary_path").is_some());
        assert!(v.get("parsed_version").is_some());
        assert!(v.get("latest_version").is_some());
        assert!(v.get("min_supported_version").is_some());
        assert!(v.get("support").is_some());
        assert_eq!(v["support"]["kind"], "supported");
    }

    #[test]
    fn validate_claude_binary_returns_none_for_nonexistent_path() {
        assert!(validate_claude_binary("/this/path/does/not/exist/claude").is_none());
    }

    #[test]
    fn detect_claude_returns_valid_struct_regardless_of_environment() {
        let status = detect_claude();
        if !status.installed {
            assert!(status.version.is_none());
            assert!(status.binary_path.is_none());
        } else {
            assert!(status.binary_path.is_some());
        }
    }
}

/// Run the behavior probe when the registry-based verdict is `Unknown` and
/// promote the support verdict to `Outdated` if the probe finds a mismatch.
async fn promote_unknown_via_probe(status: &mut ClaudeStatus) {
    if !matches!(status.support, CliSupport::Unknown { .. }) {
        return;
    }
    let Some(path) = status.binary_path.as_deref() else {
        return;
    };
    if let Some(reason) = probe_if_unknown(path).await {
        status.support = CliSupport::Outdated { reason };
    }
}

#[tauri::command]
pub async fn check_claude_status(state: State<'_, AppState>) -> Result<ClaudeStatus, String> {
    // Check for a user-configured override first
    let override_status = get_settings()
        .ok()
        .and_then(|s| s.claude_binary_override)
        .and_then(|path| validate_claude_binary(&path));
    let mut status = override_status.unwrap_or_else(detect_claude);

    enrich_status(&mut status, &state.cli_latest_version_cache).await;
    promote_unknown_via_probe(&mut status).await;

    if status.installed {
        let mut binary = state.claude_binary.lock().await;
        *binary = status.binary_path.clone();
    }

    Ok(status)
}

/// Codex counterpart of `check_claude_status`. Surfaces the installed
/// state, version, binary path, and (when installed) whether the user is
/// signed in via `codex login`. v1.3.1 — wired into AgentPicker /
/// AgentBadge / Settings → Agents so the UI never has to guess.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexStatusFull {
    #[serde(flatten)]
    pub binary: CodexStatus,
    /// `true` if `codex login status` exited 0. `false` if the user
    /// needs to run `codex login`, or if the binary isn't installed at
    /// all (in which case `binary.installed` is also false).
    pub authenticated: bool,
}

#[tauri::command]
pub async fn check_codex_status() -> Result<CodexStatusFull, String> {
    let binary = detect_codex();
    let authenticated = if let Some(path) = binary.binary_path.as_deref() {
        matches!(probe_login_status(path), AuthProbeOutcome::Authenticated)
    } else {
        false
    };
    Ok(CodexStatusFull {
        binary,
        authenticated,
    })
}

#[tauri::command]
pub async fn set_claude_binary_override(
    path: String,
    state: State<'_, AppState>,
) -> Result<ClaudeStatus, String> {
    // Validate the binary at the given path
    let mut status = validate_claude_binary(&path)
        .ok_or_else(|| format!("No valid Claude binary found at: {}", path))?;

    enrich_status(&mut status, &state.cli_latest_version_cache).await;
    promote_unknown_via_probe(&mut status).await;

    // Save override to settings
    let mut settings = get_settings().map_err(|e| e.to_string())?;
    settings.claude_binary_override = Some(path);
    crate::commands::settings::update_settings(settings).map_err(|e| e.to_string())?;

    // Update the cached binary path in AppState
    let mut binary = state.claude_binary.lock().await;
    *binary = status.binary_path.clone();

    Ok(status)
}
