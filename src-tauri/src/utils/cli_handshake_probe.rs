//! Behavior-based fallback for compatibility detection when the npm registry
//! version comparison didn't yield a verdict (offline, ambiguous version, etc).
//!
//! We don't start a real session — that would consume Anthropic credits on
//! every app launch. Instead we ask the CLI to print its help text and look
//! for the protocol keywords CodeMantis depends on (`stream-json`,
//! `--input-format`, `--output-format`). An old CLI that doesn't speak the
//! protocol will be missing these, even if its `--version` looks plausible.

use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Outcome of a handshake probe.
#[derive(Debug)]
pub enum ProbeOutcome {
    /// CLI's help output advertises every keyword we depend on.
    Compatible,
    /// CLI's help output is missing one or more required keywords.
    /// `missing` lists the keyword(s) that were absent.
    ProtocolMismatch { missing: Vec<&'static str> },
    /// CLI did not respond within the timeout.
    Timeout,
    /// CLI errored out (non-zero exit, IO error). Treat as incompatible —
    /// `stderr` may help the user diagnose.
    Error { stderr: String },
}

/// Keywords every supported CLI's `--help` output must contain.
const REQUIRED_KEYWORDS: &[&str] = &["stream-json", "--input-format", "--output-format"];

const HELP_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn probe_help(binary_path: &str) -> ProbeOutcome {
    let mut cmd = Command::new(binary_path);
    cmd.arg("--help");
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ProbeOutcome::Error {
                stderr: format!("spawn failed: {e}"),
            }
        }
    };

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let read_outputs = async {
        if let Some(out) = stdout.as_mut() {
            let _ = out.read_to_end(&mut stdout_buf).await;
        }
        if let Some(err) = stderr.as_mut() {
            let _ = err.read_to_end(&mut stderr_buf).await;
        }
        child.wait().await
    };

    let result = match tokio::time::timeout(HELP_TIMEOUT, read_outputs).await {
        Ok(r) => r,
        Err(_) => return ProbeOutcome::Timeout,
    };

    match result {
        Ok(status) if status.success() => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&stdout_buf),
                String::from_utf8_lossy(&stderr_buf)
            );
            let missing: Vec<&'static str> = REQUIRED_KEYWORDS
                .iter()
                .copied()
                .filter(|kw| !combined.contains(kw))
                .collect();
            if missing.is_empty() {
                ProbeOutcome::Compatible
            } else {
                ProbeOutcome::ProtocolMismatch { missing }
            }
        }
        Ok(_) => ProbeOutcome::Error {
            stderr: String::from_utf8_lossy(&stderr_buf).into_owned(),
        },
        Err(e) => ProbeOutcome::Error {
            stderr: format!("wait failed: {e}"),
        },
    }
}

/// Convenience wrapper used by `enrich_status`-style call sites: if the verdict
/// is already definitive (Supported or Outdated from version data), don't
/// probe. Only probe when the verdict is `Unknown`.
///
/// Returns `Some(reason)` if the probe found a definitive incompatibility —
/// the caller should overwrite the `Unknown` verdict with `Outdated`.
pub async fn probe_if_unknown(
    binary_path: &str,
) -> Option<String> {
    match probe_help(binary_path).await {
        ProbeOutcome::Compatible => None,
        ProbeOutcome::ProtocolMismatch { missing } => Some(format!(
            "The installed CLI does not advertise the stream-json protocol that CodeMantis requires \
             (missing: {}). This typically means the CLI is too old.",
            missing.join(", ")
        )),
        ProbeOutcome::Timeout => Some(
            "The installed CLI did not respond to `--help` within 5 seconds. This typically means \
             it is too old or broken."
                .to_string(),
        ),
        ProbeOutcome::Error { stderr } => Some(format!(
            "The installed CLI failed to print --help. This typically means it is too old or \
             broken. Details: {}",
            stderr.lines().take(3).collect::<Vec<_>>().join(" ")
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn probe_help_returns_error_for_missing_binary() {
        let outcome = probe_help("/this/path/definitely/does/not/exist/claude").await;
        assert!(matches!(outcome, ProbeOutcome::Error { .. }));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_help_compatible_when_help_contains_keywords() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake_claude");
        std::fs::write(
            &script,
            b"#!/bin/sh\ncat <<EOF\nUsage: claude [options]\nOptions:\n  --input-format <format>  e.g. stream-json\n  --output-format <format>\nEOF\nexit 0\n",
        )
        .expect("write");
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("perms");
        let outcome = probe_help(script.to_str().unwrap()).await;
        assert!(
            matches!(outcome, ProbeOutcome::Compatible),
            "expected Compatible, got {outcome:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_help_protocol_mismatch_when_keywords_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake_claude");
        std::fs::write(
            &script,
            b"#!/bin/sh\necho 'Usage: claude [options]'\necho '  --version    Show version'\nexit 0\n",
        )
        .expect("write");
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("perms");
        let outcome = probe_help(script.to_str().unwrap()).await;
        match outcome {
            ProbeOutcome::ProtocolMismatch { missing } => {
                assert!(missing.contains(&"stream-json"));
            }
            other => panic!("expected ProtocolMismatch, got {other:?}"),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_if_unknown_returns_none_for_compatible_binary() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake_claude");
        std::fs::write(
            &script,
            b"#!/bin/sh\necho '--input-format stream-json --output-format stream-json'\nexit 0\n",
        )
        .expect("write");
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("perms");
        let result = probe_if_unknown(script.to_str().unwrap()).await;
        assert!(result.is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_if_unknown_returns_reason_for_old_binary() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake_claude");
        std::fs::write(&script, b"#!/bin/sh\necho 'old cli'\nexit 0\n").expect("write");
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("perms");
        let result = probe_if_unknown(script.to_str().unwrap()).await;
        assert!(result.is_some(), "should detect mismatch");
        let reason = result.unwrap();
        assert!(reason.contains("stream-json") || reason.contains("input-format"));
    }
}
