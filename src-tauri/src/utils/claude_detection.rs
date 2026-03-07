use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub authenticated: bool,
    pub binary_path: Option<String>,
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
    // Try `which` crate first
    if let Ok(path) = which::which("claude") {
        return Some(path);
    }

    // Check common paths
    let common_paths = [
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
    ];

    // Also check user's npm global bin
    if let Some(home) = dirs::home_dir() {
        let npm_global = home.join(".npm-global/bin/claude");
        if npm_global.exists() {
            return Some(npm_global);
        }
        let nvm_paths = [
            home.join(".nvm/versions/node"),
        ];
        for nvm_path in &nvm_paths {
            if nvm_path.exists() {
                if let Ok(entries) = std::fs::read_dir(nvm_path) {
                    for entry in entries.flatten() {
                        let claude = entry.path().join("bin/claude");
                        if claude.exists() {
                            return Some(claude);
                        }
                    }
                }
            }
        }
    }

    for path in &common_paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
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
