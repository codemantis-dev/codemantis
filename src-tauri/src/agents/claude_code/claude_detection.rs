use crate::agents::claude_code::cli_version::{
    classify, fetch_latest_version, parse_version, CliSupport, LatestVersionCache,
    FALLBACK_MIN_VERSION,
};
use semver::Version;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeStatus {
    pub installed: bool,
    /// Raw `claude --version` stdout — kept for display in the UI.
    pub version: Option<String>,
    /// Canonical `x.y.z` extracted from the raw string. None if unparsable.
    pub parsed_version: Option<String>,
    /// npm-registry "latest" tag at the time of detection. None when offline.
    pub latest_version: Option<String>,
    /// Floor below which we consider the CLI outdated.
    pub min_supported_version: Option<String>,
    /// Compatibility verdict consumed by the frontend gate.
    pub support: CliSupport,
    pub authenticated: bool,
    pub binary_path: Option<String>,
}

impl ClaudeStatus {
    fn not_installed() -> Self {
        Self {
            installed: false,
            version: None,
            parsed_version: None,
            latest_version: None,
            min_supported_version: None,
            support: CliSupport::NotInstalled,
            authenticated: false,
            binary_path: None,
        }
    }
}

/// Sync, lightweight detection. Does not classify against the registry — call
/// `enrich_status` afterwards to add the support verdict (it requires async +
/// the AppState cache).
pub fn validate_claude_binary(path: &str) -> Option<ClaudeStatus> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return None;
    }
    let version = get_claude_version(&p);
    version.as_ref()?;
    let authenticated = check_authenticated();
    let parsed = version.as_deref().and_then(parse_version);
    Some(ClaudeStatus {
        installed: true,
        version,
        parsed_version: parsed.as_ref().map(|v| v.to_string()),
        latest_version: None,
        min_supported_version: None,
        support: CliSupport::Unknown {
            reason: "Compatibility check has not run yet.".to_string(),
        },
        authenticated,
        binary_path: Some(path.to_string()),
    })
}

pub fn detect_claude() -> ClaudeStatus {
    let binary_path = find_claude_binary();

    let (installed, version, path_str) = match &binary_path {
        Some(path) => {
            let version = get_claude_version(path);
            (true, version, Some(path.to_string_lossy().to_string()))
        }
        None => (false, None, None),
    };

    if !installed {
        return ClaudeStatus::not_installed();
    }

    let authenticated = check_authenticated();
    let parsed = version.as_deref().and_then(parse_version);

    ClaudeStatus {
        installed,
        version,
        parsed_version: parsed.as_ref().map(|v| v.to_string()),
        latest_version: None,
        min_supported_version: None,
        support: CliSupport::Unknown {
            reason: "Compatibility check has not run yet.".to_string(),
        },
        authenticated,
        binary_path: path_str,
    }
}

/// Pure classifier: given the installed status and an optional latest baseline,
/// fill in `latest_version`, `min_supported_version`, and `support`. Extracted
/// from `enrich_status` so it can be tested without the network.
pub fn apply_classification(status: &mut ClaudeStatus, latest: Option<Version>) {
    if !status.installed {
        status.support = CliSupport::NotInstalled;
        return;
    }

    let installed_version = match status
        .parsed_version
        .as_deref()
        .and_then(|v| Version::parse(v).ok())
    {
        Some(v) => v,
        None => {
            status.support = CliSupport::Unknown {
                reason: "Could not parse the installed CLI version. Stream-json compatibility \
                         will be probed at session start."
                    .to_string(),
            };
            return;
        }
    };

    match latest {
        Some(latest_v) => {
            let min = crate::agents::claude_code::cli_version::compute_min_supported(&latest_v);
            status.latest_version = Some(latest_v.to_string());
            status.min_supported_version = Some(min.to_string());
            status.support = classify(&installed_version, &latest_v);
        }
        None => {
            let (mj, mn, pt) = FALLBACK_MIN_VERSION;
            let fallback_min = Version::new(mj, mn, pt);
            status.min_supported_version = Some(fallback_min.to_string());
            if installed_version < fallback_min {
                status.support = CliSupport::Outdated {
                    reason: format!(
                        "Detected v{installed_version}; minimum verified version is v{fallback_min}. \
                         (Could not reach the npm registry to confirm latest.)"
                    ),
                };
            } else {
                status.support = CliSupport::Unknown {
                    reason: "Could not reach the npm registry to verify the latest CLI version. \
                             Proceeding optimistically — stream-json will be probed at session start."
                        .to_string(),
                };
            }
        }
    }
}

/// Fill in `latest_version`, `min_supported_version`, and the `support`
/// classification on an already-detected status. Async because it may hit the
/// npm registry. Pure no-op if the CLI isn't installed.
pub async fn enrich_status(status: &mut ClaudeStatus, cache: &LatestVersionCache) {
    if !status.installed {
        status.support = CliSupport::NotInstalled;
        return;
    }
    let latest = fetch_latest_version(cache).await;
    apply_classification(status, latest);
}

fn find_claude_binary() -> Option<PathBuf> {
    if let Some(path) = find_via_shell() {
        return Some(path);
    }
    if let Ok(path) = which::which("claude") {
        return Some(path);
    }
    if let Some(home) = dirs::home_dir() {
        let user_paths = [
            home.join(".local/bin/claude"),
            home.join(".npm-global/bin/claude"),
        ];
        for p in &user_paths {
            if p.exists() {
                return Some(p.clone());
            }
        }
        let nvm_node = home.join(".nvm/versions/node");
        if nvm_node.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_node) {
                for entry in entries.flatten() {
                    let claude = entry.path().join("bin/claude");
                    if claude.exists() {
                        return Some(claude);
                    }
                }
            }
        }
    }
    let system_paths = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
    for path in &system_paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn find_via_shell() -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-li", "-c", "which claude"])
        .output()
        .ok()?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            let p = PathBuf::from(&path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

fn get_claude_version(binary_path: &PathBuf) -> Option<String> {
    let output = std::process::Command::new(binary_path)
        .arg("--version")
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn check_authenticated() -> bool {
    match dirs::home_dir() {
        Some(home) => check_authenticated_at(&home),
        None => false,
    }
}

/// Pure, testable core of `check_authenticated`. Prefers a real credential
/// signal, but falls back to the historical "`~/.claude` exists" heuristic so we
/// never produce a false negative (e.g. macOS keeps the OAuth token in the
/// Keychain, leaving no credential file on disk). Better to let a signed-in user
/// proceed than to wrongly tell them to log in again.
fn check_authenticated_at(home: &std::path::Path) -> bool {
    let claude_dir = home.join(".claude");
    // Strong positive signal: a stored OAuth credential file (Linux/WSL and
    // some macOS setups).
    if claude_dir.join(".credentials.json").exists() {
        return true;
    }
    // The CLI records the signed-in account in ~/.claude.json; a populated
    // `oauthAccount` means an active login even when the token lives in Keychain.
    if let Ok(contents) = std::fs::read_to_string(home.join(".claude.json")) {
        if contents.contains("\"oauthAccount\"") {
            return true;
        }
    }
    // Conservative fallback — permissive on uncertainty.
    claude_dir.exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_via_shell_uses_interactive_flag() {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let output = std::process::Command::new(&shell)
            .args(["-li", "-c", "which git"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .expect("failed to spawn shell");

        assert!(
            output.status.success(),
            "shell -li -c 'which git' should succeed"
        );
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert!(
            !path.is_empty() && path.contains("git"),
            "should resolve git path, got: {}",
            path
        );
    }

    #[test]
    fn not_installed_status_serializes_with_snake_case_fields() {
        let status = ClaudeStatus::not_installed();
        let v = serde_json::to_value(&status).expect("must serialize");
        assert_eq!(v["installed"], serde_json::Value::Bool(false));
        assert!(v.get("parsed_version").is_some());
        assert!(v.get("latest_version").is_some());
        assert!(v.get("min_supported_version").is_some());
        assert!(v.get("binary_path").is_some());
        // CliSupport keeps camelCase per its own #[serde(rename_all)].
        assert_eq!(v["support"]["kind"], "notInstalled");
    }

    #[test]
    fn validate_claude_binary_returns_none_for_nonexistent_path() {
        assert!(validate_claude_binary("/this/path/does/not/exist/claude").is_none());
    }

    #[test]
    fn validate_claude_binary_returns_none_for_empty_string_path() {
        assert!(validate_claude_binary("").is_none());
    }

    #[test]
    fn validate_claude_binary_returns_none_for_non_executable_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file_path = dir.path().join("fake_claude");
        std::fs::write(&file_path, b"not a binary").expect("write");
        assert!(validate_claude_binary(file_path.to_str().unwrap()).is_none());
    }

    #[test]
    #[cfg(unix)]
    fn validate_claude_binary_parses_version_and_marks_unknown_until_enriched() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("tempdir");
        let script_path = dir.path().join("fake_claude");
        std::fs::write(
            &script_path,
            b"#!/bin/sh\necho '9.9.9 (Claude Code)'\nexit 0\n",
        )
        .expect("write");
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).expect("set_permissions");

        let path_str = script_path.to_str().unwrap();
        let status = validate_claude_binary(path_str).expect("must validate");
        assert!(status.installed);
        assert_eq!(status.parsed_version.as_deref(), Some("9.9.9"));
        // Pre-enrichment, support is Unknown.
        assert!(matches!(status.support, CliSupport::Unknown { .. }));
        assert_eq!(status.binary_path.as_deref(), Some(path_str));
    }

    #[test]
    fn detect_claude_returns_valid_struct_regardless_of_environment() {
        let status = detect_claude();
        if !status.installed {
            assert!(status.version.is_none());
            assert!(status.binary_path.is_none());
            assert_eq!(status.support, CliSupport::NotInstalled);
        } else {
            assert!(status.binary_path.is_some());
        }
    }

    #[test]
    fn detect_claude_result_serializes_without_error() {
        let status = detect_claude();
        assert!(serde_json::to_value(&status).is_ok());
    }

    fn make_status(parsed: Option<&str>) -> ClaudeStatus {
        ClaudeStatus {
            installed: true,
            version: parsed.map(|s| s.to_string()),
            parsed_version: parsed.map(|s| s.to_string()),
            latest_version: None,
            min_supported_version: None,
            support: CliSupport::Unknown {
                reason: "pre".to_string(),
            },
            authenticated: false,
            binary_path: Some("/x".to_string()),
        }
    }

    #[test]
    fn apply_classification_not_installed_short_circuits() {
        let mut status = ClaudeStatus::not_installed();
        apply_classification(&mut status, Some(Version::new(2, 1, 126)));
        assert_eq!(status.support, CliSupport::NotInstalled);
        assert!(status.latest_version.is_none());
    }

    #[test]
    fn apply_classification_unknown_when_version_unparsable() {
        let mut status = make_status(None);
        status.version = Some("garbage".to_string());
        apply_classification(&mut status, Some(Version::new(2, 1, 126)));
        assert!(matches!(status.support, CliSupport::Unknown { .. }));
    }

    #[test]
    fn apply_classification_supported_when_in_window() {
        let mut status = make_status(Some("2.1.120"));
        apply_classification(&mut status, Some(Version::new(2, 1, 126)));
        assert_eq!(status.support, CliSupport::Supported);
        assert_eq!(status.latest_version.as_deref(), Some("2.1.126"));
        assert_eq!(status.min_supported_version.as_deref(), Some("2.1.116"));
    }

    #[test]
    fn apply_classification_outdated_when_below_window() {
        let mut status = make_status(Some("2.1.50"));
        apply_classification(&mut status, Some(Version::new(2, 1, 126)));
        assert!(matches!(status.support, CliSupport::Outdated { .. }));
    }

    #[test]
    fn apply_classification_offline_with_old_version_uses_fallback_floor() {
        let mut status = make_status(Some("0.1.0"));
        apply_classification(&mut status, None);
        assert!(matches!(status.support, CliSupport::Outdated { .. }));
        // Fallback floor must be set even offline.
        let (mj, mn, pt) = FALLBACK_MIN_VERSION;
        let expected = format!("{mj}.{mn}.{pt}");
        assert_eq!(status.min_supported_version.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn apply_classification_offline_with_recent_version_is_unknown() {
        let mut status = make_status(Some("99.0.0"));
        apply_classification(&mut status, None);
        assert!(matches!(status.support, CliSupport::Unknown { .. }));
    }

    #[test]
    fn check_authenticated_true_when_credentials_file_present() {
        let dir = tempfile::tempdir().expect("tempdir");
        let claude = dir.path().join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(claude.join(".credentials.json"), b"{}").unwrap();
        assert!(check_authenticated_at(dir.path()));
    }

    #[test]
    fn check_authenticated_true_when_oauth_account_recorded() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join(".claude.json"),
            br#"{"oauthAccount":{"emailAddress":"a@b.c"}}"#,
        )
        .unwrap();
        assert!(check_authenticated_at(dir.path()));
    }

    #[test]
    fn check_authenticated_falls_back_to_claude_dir_existence() {
        // No credential file and no oauthAccount, but the dir exists: stay
        // permissive (macOS Keychain leaves no on-disk credential file).
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        assert!(check_authenticated_at(dir.path()));
    }

    #[test]
    fn check_authenticated_false_when_nothing_present() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(!check_authenticated_at(dir.path()));
    }
}
