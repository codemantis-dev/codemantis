use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub authenticated: bool,
    pub binary_path: Option<String>,
}

/// Validate a specific binary path as a Claude CLI binary.
/// Returns Some(ClaudeStatus) if the binary exists and is executable.
pub fn validate_claude_binary(path: &str) -> Option<ClaudeStatus> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return None;
    }
    let version = get_claude_version(&p);
    // If we can't get a version, it's probably not a real Claude binary
    if version.is_none() {
        return None;
    }
    let authenticated = check_authenticated();
    Some(ClaudeStatus {
        installed: true,
        version,
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

    let authenticated = check_authenticated();

    ClaudeStatus {
        installed,
        version,
        authenticated,
        binary_path: path_str,
    }
}

fn find_claude_binary() -> Option<PathBuf> {
    // Try resolving via the user's login shell first — macOS .app bundles
    // don't inherit the terminal's PATH, so `which::which` will miss binaries
    // in user-specific directories like ~/.local/bin.
    if let Some(path) = find_via_shell() {
        return Some(path);
    }

    // Try `which` crate (uses process PATH — works in dev, not in .app bundles)
    if let Ok(path) = which::which("claude") {
        return Some(path);
    }

    // Check common fixed paths
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

        // Check NVM-installed Node versions
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

    let system_paths = [
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
    ];
    for path in &system_paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    None
}

/// Resolve the claude binary by asking the user's login shell for its PATH.
/// This handles macOS .app bundles where the process PATH is minimal.
fn find_via_shell() -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", "which claude"])
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
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Some(version)
    } else {
        None
    }
}

fn check_authenticated() -> bool {
    if let Some(home) = dirs::home_dir() {
        let claude_dir = home.join(".claude");
        claude_dir.exists()
    } else {
        false
    }
}
