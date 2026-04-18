use crate::claude::session::AppState;
use crate::commands::settings::get_settings;
use crate::utils::claude_detection::{detect_claude, validate_claude_binary, ClaudeStatus};
use tauri::State;

#[cfg(test)]
mod tests {
    use crate::utils::claude_detection::{detect_claude, validate_claude_binary, ClaudeStatus};
    use serde_json::Value;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    // ── ClaudeStatus serialization ────────────────────────────────────────────

    #[test]
    fn claude_status_serializes_installed_fields_as_camel_case() {
        let status = ClaudeStatus {
            installed: true,
            version: Some("1.2.3".to_string()),
            authenticated: false,
            binary_path: Some("/usr/local/bin/claude".to_string()),
        };

        let v: Value = serde_json::to_value(&status).expect("serialization must not fail");
        // All four fields must be present at the top level
        assert!(v.get("installed").is_some(), "field 'installed' must be present");
        assert!(v.get("version").is_some(), "field 'version' must be present");
        assert!(v.get("authenticated").is_some(), "field 'authenticated' must be present");
        assert!(v.get("binaryPath").is_some() || v.get("binary_path").is_some(),
            "field 'binary_path' / 'binaryPath' must be present");
    }

    #[test]
    fn claude_status_installed_true_reflects_in_serialized_value() {
        let status = ClaudeStatus {
            installed: true,
            version: Some("2.0.0".to_string()),
            authenticated: true,
            binary_path: Some("/opt/homebrew/bin/claude".to_string()),
        };
        let v: Value = serde_json::to_value(&status).unwrap();
        assert_eq!(v["installed"], Value::Bool(true));
        assert_eq!(v["authenticated"], Value::Bool(true));
    }

    #[test]
    fn claude_status_none_fields_serialize_as_null() {
        let status = ClaudeStatus {
            installed: false,
            version: None,
            authenticated: false,
            binary_path: None,
        };
        let v: Value = serde_json::to_value(&status).unwrap();
        assert_eq!(v["installed"], Value::Bool(false));
        assert_eq!(v["version"], Value::Null);
        assert_eq!(v["binary_path"].as_str().is_some() || v["binary_path"].is_null(), true);
    }

    // ── validate_claude_binary ────────────────────────────────────────────────

    #[test]
    fn validate_claude_binary_returns_none_for_nonexistent_path() {
        let result = validate_claude_binary("/this/path/does/not/exist/claude");
        assert!(result.is_none(), "nonexistent path must return None");
    }

    #[test]
    fn validate_claude_binary_returns_none_for_empty_string_path() {
        let result = validate_claude_binary("");
        assert!(result.is_none(), "empty path must return None");
    }

    #[test]
    fn validate_claude_binary_returns_none_for_non_executable_file() {
        let dir = tempdir().expect("tempdir must be created");
        let file_path = dir.path().join("fake_claude");
        fs::write(&file_path, b"not a binary").expect("write must succeed");
        // File exists but is not executable and does not output a version
        let path_str = file_path.to_str().unwrap();
        // validate_claude_binary calls get_claude_version which runs binary --version.
        // A non-executable file will fail to run, so version will be None → returns None.
        let result = validate_claude_binary(path_str);
        assert!(result.is_none(), "non-executable file must return None");
    }

    #[test]
    #[cfg(unix)]
    fn validate_claude_binary_returns_some_for_executable_script_with_version_output() {
        let dir = tempdir().expect("tempdir must be created");
        let script_path = dir.path().join("fake_claude");

        // A script that exits 0 and prints a version string when called with --version
        fs::write(
            &script_path,
            b"#!/bin/sh\necho 'claude 9.9.9-test'\nexit 0\n",
        )
        .expect("write must succeed");

        let mut perms = fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms).expect("set_permissions must succeed");

        let path_str = script_path.to_str().unwrap();
        let result = validate_claude_binary(path_str);
        assert!(result.is_some(), "executable script with version output must return Some");

        let status = result.unwrap();
        assert!(status.installed, "installed must be true");
        assert!(status.version.is_some(), "version must be Some");
        assert!(
            status.version.as_deref().unwrap().contains("9.9.9-test"),
            "version must contain the script output, got: {:?}",
            status.version
        );
        assert_eq!(
            status.binary_path.as_deref(),
            Some(path_str),
            "binary_path must match the provided path"
        );
    }

    // ── detect_claude ─────────────────────────────────────────────────────────

    #[test]
    fn detect_claude_returns_valid_struct_regardless_of_environment() {
        // detect_claude must never panic; it must always return a ClaudeStatus
        // with internally consistent fields.
        let status = detect_claude();

        // If not installed, version and binary_path must be None.
        if !status.installed {
            assert!(
                status.version.is_none(),
                "version must be None when not installed"
            );
            assert!(
                status.binary_path.is_none(),
                "binary_path must be None when not installed"
            );
        }

        // If installed, binary_path must be Some.
        if status.installed {
            assert!(
                status.binary_path.is_some(),
                "binary_path must be Some when installed"
            );
        }
    }

    #[test]
    fn detect_claude_result_serializes_without_error() {
        // Ensure the returned struct is always serializable (Tauri IPC requires this).
        let status = detect_claude();
        let result = serde_json::to_value(&status);
        assert!(result.is_ok(), "detect_claude result must serialize to JSON without error");
    }
}

#[tauri::command]
pub async fn check_claude_status(state: State<'_, AppState>) -> Result<ClaudeStatus, String> {
    // Check for a user-configured override first
    if let Ok(settings) = get_settings() {
        if let Some(ref override_path) = settings.claude_binary_override {
            if let Some(status) = validate_claude_binary(override_path) {
                let mut binary = state.claude_binary.lock().await;
                *binary = status.binary_path.clone();
                return Ok(status);
            }
        }
    }

    let status = detect_claude();

    if status.installed {
        let mut binary = state.claude_binary.lock().await;
        *binary = status.binary_path.clone();
    }

    Ok(status)
}

#[tauri::command]
pub async fn set_claude_binary_override(
    path: String,
    state: State<'_, AppState>,
) -> Result<ClaudeStatus, String> {
    // Validate the binary at the given path
    let status = validate_claude_binary(&path)
        .ok_or_else(|| format!("No valid Claude binary found at: {}", path))?;

    // Save override to settings
    let mut settings = get_settings().map_err(|e| e.to_string())?;
    settings.claude_binary_override = Some(path);
    crate::commands::settings::update_settings(settings).map_err(|e| e.to_string())?;

    // Update the cached binary path in AppState
    let mut binary = state.claude_binary.lock().await;
    *binary = status.binary_path.clone();

    Ok(status)
}
