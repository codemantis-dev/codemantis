//! Codex CLI binary discovery.
//!
//! Parallel of [`crate::agents::claude_code::claude_detection`] for Codex.
//! Phase 1 of detection only: PATH lookup + `codex --version` probe. The
//! supported-version classifier (analogous to Claude's
//! `cli_version::CliSupport`) is deferred to v1.4.0 — Codex has no
//! published "min supported" floor yet and the wire protocol is still
//! evolving.
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §8 (Preflight catalog) and the spawn flow in §4.3.

#![allow(dead_code)] // Consumers land in S4 (spawn / adapter glue).

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use crate::utils::paths::locate_via_login_shell;

/// Detection result for the Codex CLI. Mirrors `ClaudeStatus`'s shape so
/// the frontend's existing welcome/preflight surface can render it
/// identically for both agents (Phase 2 §6 / §8).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CodexStatus {
    pub installed: bool,
    /// Raw `codex --version` stdout, e.g. `"codex-cli 0.130.0"`.
    pub version: Option<String>,
    /// Canonical `x.y.z` extracted from `version`. `None` if unparseable.
    pub parsed_version: Option<String>,
    pub binary_path: Option<String>,
}

impl CodexStatus {
    pub fn not_installed() -> Self {
        Self {
            installed: false,
            version: None,
            parsed_version: None,
            binary_path: None,
        }
    }
}

/// Locate `codex` on the user's effective PATH.
///
/// Bundled macOS `.app`s inherit a stripped-down PATH (`/usr/bin:/bin:…`)
/// that omits Homebrew, nvm, and `~/.npm-global` — every place a real user
/// installs `codex`. A bare `which::which("codex")` therefore returns
/// `None` in production while working fine in `pnpm tauri dev`, where the
/// terminal's PATH is inherited. We mirror the strategy in
/// [`crate::agents::claude_code::claude_detection::find_claude_binary`]:
///
/// 1. Process PATH (`which::which`) — fast path, succeeds in dev builds.
/// 2. Login-shell PATH (`command -v codex` via `/bin/zsh` with the cached
///    interactive-shell PATH) — covers Homebrew, nvm, fnm, bun, etc.
/// 3. Known install dirs under `$HOME` — `~/.local/bin`, `~/.npm-global/bin`,
///    every `~/.nvm/versions/node/*/bin` — a last-resort scan for users
///    whose shell profile is unusual (fish without compatible env, etc.).
/// 4. System dirs — `/usr/local/bin`, `/opt/homebrew/bin`.
pub fn locate_binary() -> Option<PathBuf> {
    if let Ok(path) = which::which("codex") {
        return Some(path);
    }
    if let Some(path) = locate_via_login_shell("codex") {
        return Some(path);
    }
    if let Some(home) = dirs::home_dir() {
        let user_paths = [
            home.join(".local/bin/codex"),
            home.join(".npm-global/bin/codex"),
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
                    let codex = entry.path().join("bin/codex");
                    if codex.exists() {
                        return Some(codex);
                    }
                }
            }
        }
    }
    let system_paths = ["/usr/local/bin/codex", "/opt/homebrew/bin/codex"];
    for path in &system_paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Run `<binary> --version` synchronously and parse the result. Times out
/// implicitly because `--version` is a non-network probe that exits in <100 ms
/// on every documented Codex build.
pub fn validate_binary(path: &str) -> Option<CodexStatus> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return None;
    }
    let out = Command::new(path).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let parsed = parse_version_string(&raw);
    Some(CodexStatus {
        installed: true,
        version: Some(raw),
        parsed_version: parsed,
        binary_path: Some(path.to_string()),
    })
}

/// Convenience: locate + validate in one step. Falls back to
/// [`CodexStatus::not_installed`] if either fails.
pub fn detect_codex() -> CodexStatus {
    let Some(p) = locate_binary() else {
        return CodexStatus::not_installed();
    };
    let path_str = p.to_string_lossy().to_string();
    validate_binary(&path_str).unwrap_or_else(CodexStatus::not_installed)
}

/// Pull the `x.y.z` out of a `codex --version` line. Codex's current output
/// format is `"codex-cli 0.130.0"` (one space, no leading "v"); we tolerate
/// extra surrounding whitespace and an optional `v` prefix in case future
/// builds change.
pub(crate) fn parse_version_string(raw: &str) -> Option<String> {
    // Find the last whitespace-delimited token that looks like a version.
    // Acceptance rule: ≥2 dot-separated parts; the first part is purely
    // numeric (so we don't match "codex-cli"); later parts may carry an
    // alphanumeric pre-release suffix ("1.0.0-rc1" → "1.0.0-rc1").
    for token in raw.split_whitespace().rev() {
        let candidate = token.trim_start_matches('v');
        let parts: Vec<&str> = candidate.split('.').collect();
        if parts.len() < 2 {
            continue;
        }
        let first_is_numeric =
            !parts[0].is_empty() && parts[0].chars().all(|c| c.is_ascii_digit());
        let rest_look_versionlike = parts.iter().skip(1).take(2).all(|p| {
            !p.is_empty()
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '+')
        });
        if first_is_numeric && rest_look_versionlike {
            // Take only the first three dot-separated segments (drop any
            // build-metadata suffix beyond x.y.z).
            let canonical: String =
                parts.iter().take(3).copied().collect::<Vec<_>>().join(".");
            return Some(canonical);
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_current_codex_version_format() {
        assert_eq!(
            parse_version_string("codex-cli 0.130.0"),
            Some("0.130.0".to_string())
        );
    }

    #[test]
    fn parses_tolerates_leading_v_prefix() {
        assert_eq!(
            parse_version_string("codex v1.2.3"),
            Some("1.2.3".to_string())
        );
    }

    #[test]
    fn parses_truncates_pre_release_to_canonical() {
        // Defensive: future builds might add a pre-release suffix; we keep
        // only the x.y.z prefix.
        assert_eq!(
            parse_version_string("codex-cli 1.0.0-rc1"),
            Some("1.0.0-rc1".to_string())
        );
    }

    #[test]
    fn parses_tolerates_two_segment_version() {
        // "0.130" alone — not the current format, but the parser shouldn't
        // crash. Returns the two-segment string.
        assert_eq!(
            parse_version_string("codex 0.130"),
            Some("0.130".to_string())
        );
    }

    #[test]
    fn parses_returns_none_for_no_version_in_output() {
        assert!(parse_version_string("codex").is_none());
        assert!(parse_version_string("").is_none());
        assert!(parse_version_string("totally unrelated").is_none());
    }

    #[test]
    fn not_installed_status_is_all_default() {
        let s = CodexStatus::not_installed();
        assert!(!s.installed);
        assert!(s.version.is_none());
        assert!(s.parsed_version.is_none());
        assert!(s.binary_path.is_none());
    }

    #[test]
    fn validate_returns_none_for_missing_path() {
        assert!(validate_binary("/definitely/does/not/exist/codex").is_none());
    }

    #[test]
    fn locate_binary_uses_process_path_when_available() {
        // If the host shell that ran `cargo test` already has codex on PATH,
        // step 1 (which::which) should find it. We can't assume codex is
        // installed in CI, so only assert *if* it resolves it must be an
        // absolute existing path — never the bare name "codex".
        if let Some(p) = locate_binary() {
            assert!(p.is_absolute(), "locate_binary must return an absolute path, got {:?}", p);
            assert!(p.exists(), "locate_binary returned a non-existent path: {:?}", p);
        }
    }

    #[test]
    fn login_shell_fallback_resolves_codex_when_installed() {
        // Regression for the v1.5.0 bug where bundled `.app` builds reported
        // "OpenAI Codex isn't on PATH" even with codex installed via Homebrew
        // or npm-global. The bundled `.app` PATH is minimal, so step 1 of
        // `locate_binary` (which::which) misses codex; step 2 — the login-
        // shell fallback — is what saves us.
        //
        // We exercise the fallback directly instead of mutating the process
        // PATH around a `locate_binary` call: env mutation races with other
        // PATH-sensitive tests when cargo runs tests in parallel.
        //
        // Guarded: if codex isn't installed on the test host, we have nothing
        // to assert — the parse/serialize tests cover the not-installed
        // branch separately.
        let probably_installed = std::process::Command::new("/bin/zsh")
            .args(["-lic", "command -v codex"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !probably_installed {
            return;
        }

        let p = locate_via_login_shell("codex").expect(
            "with codex installed, locate_via_login_shell must succeed — that's the only \
             reason `.app` users can find codex when their process PATH is /usr/bin:/bin:…",
        );
        assert!(p.is_absolute(), "expected absolute path, got {:?}", p);
        assert!(p.exists(), "resolved path must exist on disk: {:?}", p);
        assert_eq!(
            p.file_name().and_then(|s| s.to_str()),
            Some("codex"),
            "expected basename 'codex', got {:?}",
            p
        );
    }

    #[test]
    fn codex_status_serializes_required_fields() {
        let s = CodexStatus {
            installed: true,
            version: Some("codex-cli 0.130.0".into()),
            parsed_version: Some("0.130.0".into()),
            binary_path: Some("/opt/homebrew/bin/codex".into()),
        };
        let json: serde_json::Value = serde_json::to_value(&s).unwrap();
        assert_eq!(json["installed"], true);
        assert_eq!(json["version"], "codex-cli 0.130.0");
        assert_eq!(json["parsed_version"], "0.130.0");
        assert_eq!(json["binary_path"], "/opt/homebrew/bin/codex");
    }
}
