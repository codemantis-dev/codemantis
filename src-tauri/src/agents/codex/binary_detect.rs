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

/// Locate `codex` on $PATH. Uses the same `which` crate the Claude
/// detector uses for parity.
pub fn locate_binary() -> Option<PathBuf> {
    which::which("codex").ok()
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
