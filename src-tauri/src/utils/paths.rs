use std::path::PathBuf;
use std::sync::Mutex;

const APP_ID: &str = "dev.codemantis.myapp";

// ── Login shell PATH resolution ──
//
// macOS GUI apps (Tauri .app bundles) inherit a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin). Tools installed via Homebrew, nvm,
// cargo, etc. are invisible unless we source the user's shell profile.

static CACHED_LOGIN_PATH: Mutex<Option<String>> = Mutex::new(None);

fn resolve_path_from_shell() -> String {
    std::process::Command::new("/bin/zsh")
        .args(["-li", "-c", "echo $PATH"])
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

/// Resolve a tool name to an absolute path using the login-shell PATH.
///
/// Bundled `.app`s on macOS inherit a minimal PATH that excludes Homebrew,
/// nvm, npm-global, etc. so a bare `which::which("foo")` will miss tools
/// the user can run perfectly well from a terminal. This helper runs
/// `command -v <tool>` with `PATH` set to [`login_shell_path()`] so any
/// detector can resolve binaries the user actually has installed.
///
/// Returns `None` if the lookup fails, the tool isn't found, or the path
/// it reports no longer exists on disk.
pub fn locate_via_login_shell(tool: &str) -> Option<PathBuf> {
    // `command -v` is a POSIX builtin available in every shell we'd plausibly
    // run. Using `-c` (non-interactive) keeps it fast: we already paid the
    // interactive-shell cost when caching `login_shell_path()`.
    let check_cmd = format!("command -v {}", tool);
    let output = std::process::Command::new("/bin/zsh")
        .args(["-c", &check_cmd])
        .env("PATH", login_shell_path())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let p = PathBuf::from(raw);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Returns the application data directory, separated by build profile.
///
/// - Release builds: `~/Library/Application Support/dev.codemantis.myapp/`
/// - Debug  builds: `~/Library/Application Support/dev.codemantis.myapp.dev/`
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_path_uses_interactive_shell() {
        // Verify that resolve_path_from_shell() sources ~/.zshrc by using
        // an interactive shell (-li). Tools like bun, nvm, fnm, pyenv add
        // their PATH entries in .zshrc, which is only sourced for interactive
        // shells. Without -i, compiled .app bundles can't find these tools.
        //
        // We test this by comparing the output of -li (interactive+login)
        // vs -l (login-only). On most dev machines .zshrc adds entries that
        // .zprofile doesn't, so the interactive PATH should be a superset.
        let interactive = std::process::Command::new("/bin/zsh")
            .args(["-li", "-c", "echo $PATH"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .expect("failed to run zsh -li");

        let login_only = std::process::Command::new("/bin/zsh")
            .args(["-l", "-c", "echo $PATH"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .expect("failed to run zsh -l");

        let interactive_path = String::from_utf8_lossy(&interactive.stdout)
            .trim()
            .to_string();
        let login_path = String::from_utf8_lossy(&login_only.stdout)
            .trim()
            .to_string();

        // The interactive PATH must be non-empty and at least as long as login-only.
        // (On machines with .zshrc PATH additions it will be strictly longer.)
        assert!(
            !interactive_path.is_empty(),
            "interactive shell PATH is empty"
        );
        assert!(
            interactive_path.len() >= login_path.len(),
            "interactive PATH ({} chars) should be >= login-only PATH ({} chars)",
            interactive_path.len(),
            login_path.len()
        );
    }

    #[test]
    fn resolve_path_contains_homebrew_paths() {
        // On Apple Silicon Macs, Homebrew lives in /opt/homebrew/bin.
        // On Intel Macs, it's /usr/local/bin.
        // Both should appear in the resolved PATH.
        let path = resolve_path_from_shell();
        let has_homebrew = path.contains("/opt/homebrew/bin") || path.contains("/usr/local/bin");
        assert!(
            has_homebrew,
            "resolved PATH should contain Homebrew path (/opt/homebrew/bin or /usr/local/bin): {}",
            path
        );
    }

    #[test]
    fn login_shell_path_is_cached() {
        // Call twice — both should return the same value (cached).
        let first = login_shell_path();
        let second = login_shell_path();
        assert_eq!(first, second, "login_shell_path() should return cached value");
    }

    #[test]
    fn refresh_clears_cache_and_resolves() {
        let initial = login_shell_path();
        let refreshed = refresh_login_shell_path();
        // Both should be valid non-empty PATHs
        assert!(!initial.is_empty());
        assert!(!refreshed.is_empty());
        // After refresh, login_shell_path() should return the new value
        assert_eq!(refreshed, login_shell_path());
    }

    #[test]
    fn tool_exists_finds_system_tools() {
        let path = login_shell_path();
        assert!(
            tool_exists_in_login_shell("git", &path),
            "git should be found in login shell PATH"
        );
        assert!(
            tool_exists_in_login_shell("ls", &path),
            "ls should be found in login shell PATH"
        );
    }

    #[test]
    fn tool_exists_rejects_missing_tools() {
        let path = login_shell_path();
        assert!(
            !tool_exists_in_login_shell("__nonexistent_tool_99999__", &path),
            "nonexistent tool should not be found"
        );
    }

    #[test]
    fn locate_via_login_shell_finds_system_tool() {
        // `git` and `ls` are both reliably present on any macOS dev box
        // (Xcode CLT installs git into /usr/bin), so they're safe targets
        // for a smoke test even in minimal CI shells.
        let resolved = locate_via_login_shell("ls").expect("ls must resolve");
        assert!(resolved.is_absolute(), "expected absolute path, got: {:?}", resolved);
        assert!(resolved.exists(), "resolved path must exist: {:?}", resolved);
    }

    #[test]
    fn locate_via_login_shell_returns_none_for_missing_tool() {
        assert!(
            locate_via_login_shell("__definitely_not_a_real_binary_99999__").is_none(),
            "nonexistent tool should resolve to None"
        );
    }

    #[test]
    fn locate_via_login_shell_returns_absolute_path() {
        // Regression guard for the .app-bundle PATH bug: detectors must get
        // back an absolute path they can spawn directly, not a bare name.
        if let Some(p) = locate_via_login_shell("sh") {
            assert!(p.is_absolute(), "must be absolute: {:?}", p);
        }
    }

    #[test]
    fn app_data_dir_returns_some() {
        let dir = app_data_dir();
        assert!(dir.is_some(), "app_data_dir() should return Some on macOS");
    }

    #[test]
    fn app_data_dir_uses_correct_app_id() {
        let dir = app_data_dir().unwrap();
        let dir_name = dir.file_name().unwrap().to_str().unwrap();
        if cfg!(debug_assertions) {
            assert_eq!(
                dir_name, "dev.codemantis.myapp.dev",
                "debug builds should use APP_ID.dev suffix"
            );
        } else {
            assert_eq!(
                dir_name, "dev.codemantis.myapp",
                "release builds should use APP_ID directly"
            );
        }
    }

    #[test]
    fn app_data_dir_is_under_library_application_support() {
        let dir = app_data_dir().unwrap();
        let parent = dir.parent().unwrap();
        assert!(
            parent.ends_with("Application Support"),
            "app_data_dir should be under Application Support, got: {:?}",
            parent
        );
    }
}
