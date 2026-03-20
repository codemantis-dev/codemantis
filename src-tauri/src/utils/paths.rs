use std::path::PathBuf;
use std::sync::Mutex;

const APP_ID: &str = "dev.codemantis.app";

// ── Login shell PATH resolution ──
//
// macOS GUI apps (Tauri .app bundles) inherit a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin). Tools installed via Homebrew, nvm,
// cargo, etc. are invisible unless we source the user's shell profile.

static CACHED_LOGIN_PATH: Mutex<Option<String>> = Mutex::new(None);

fn resolve_path_from_shell() -> String {
    std::process::Command::new("/bin/zsh")
        .args(["-l", "-c", "echo $PATH"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
}

/// Return the full login-shell PATH (cached after first call).
pub fn login_shell_path() -> String {
    let guard = CACHED_LOGIN_PATH.lock().unwrap();
    if let Some(ref cached) = *guard {
        return cached.clone();
    }
    drop(guard);
    refresh_login_shell_path()
}

/// Re-resolve the login-shell PATH (clears cache).
/// Call before validation so newly installed tools are detected.
pub fn refresh_login_shell_path() -> String {
    let resolved = resolve_path_from_shell();
    let mut guard = CACHED_LOGIN_PATH.lock().unwrap();
    *guard = Some(resolved.clone());
    resolved
}

/// Check whether a CLI tool exists using the login-shell PATH.
pub fn tool_exists_in_login_shell(tool: &str, path: &str) -> bool {
    let check_cmd = format!("command -v {}", tool);
    std::process::Command::new("/bin/zsh")
        .args(["-c", &check_cmd])
        .env("PATH", path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Returns the application data directory, separated by build profile.
///
/// - Release builds: `~/Library/Application Support/dev.codemantis.app/`
/// - Debug  builds: `~/Library/Application Support/dev.codemantis.app.dev/`
///
/// This ensures development sessions never leak settings, API keys,
/// or onboarding state into production builds.
pub fn app_data_dir() -> Option<PathBuf> {
    let dir_name = if cfg!(debug_assertions) {
        format!("{}.dev", APP_ID)
    } else {
        APP_ID.to_string()
    };
    dirs::data_dir().map(|d| d.join(dir_name))
}
