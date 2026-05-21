//! Codex authentication probe — `codex login status`.
//!
//! Codex stores its OAuth tokens in `~/.codex/auth.json` (or
//! `$CODEX_HOME/auth.json`). We never read or write that file directly —
//! the user runs `codex login` themselves (Phase 2 v1 has no in-app login
//! per spec §2.2). This module just *checks* whether the user is signed in
//! so the spawn path can surface an actionable error early instead of
//! letting `codex app-server` fail mid-handshake.
//!
//! `codex login status` exits 0 when authenticated, non-zero otherwise.
//! That's the contract this module relies on.
//!
//! Spec: `CodeMantis-Phase2-CodexAdapter-v1.0.md` §2.2 (auth modes) and
//! §4.3 (spawn flow — `ensure_logged_in` runs before any thread/start).

#![allow(dead_code)] // Spawn integration lands in S4.

use std::process::Command;
use std::time::Duration;

/// Where the user can go to fix an `AuthRequired` error. Shown verbatim in
/// the welcome banner and the AgentPicker error inline (spec §5).
pub const AUTH_DOCS_URL: &str = "https://developers.openai.com/codex/auth";

/// Outcome of [`probe_login_status`]. Distinguishes "not authenticated"
/// from "binary not on PATH / probe failed" so the caller can decide
/// whether to surface auth guidance vs. install guidance.
#[derive(Debug, Clone, PartialEq)]
pub enum AuthProbeOutcome {
    /// `codex login status` exited 0 — user is authenticated.
    Authenticated,
    /// `codex login status` exited non-zero — user must `codex login`.
    /// Surfaces the suggested action message + docs link in the
    /// `AgentError::AuthRequired` payload at the caller.
    NotAuthenticated,
    /// We couldn't run the probe at all (binary missing, IO error,
    /// timeout). The caller should fall back to the install-guidance
    /// path rather than the login path.
    ProbeFailed(String),
}

impl AuthProbeOutcome {
    /// User-facing message ready to embed in an `AgentError::AuthRequired`.
    /// Includes the docs link verbatim so a terminal copy-paste works.
    pub fn actionable_message(&self) -> Option<String> {
        match self {
            AuthProbeOutcome::Authenticated => None,
            AuthProbeOutcome::NotAuthenticated => Some(format!(
                "OpenAI Codex is not signed in. Run `codex login` in a terminal, \
                 then retry. Auth docs: {AUTH_DOCS_URL}"
            )),
            AuthProbeOutcome::ProbeFailed(reason) => Some(format!(
                "Could not check Codex auth status: {reason}. Auth docs: {AUTH_DOCS_URL}"
            )),
        }
    }
}

/// Run `<binary> login status` and classify the exit code. Timeout: 5 s —
/// `login status` is a local file read, but we don't want a hung subprocess
/// to block CodeMantis startup.
///
/// Returns `Authenticated` if exit 0, `NotAuthenticated` if non-zero exit,
/// `ProbeFailed` if the subprocess never produced an exit status.
pub fn probe_login_status(binary: &str) -> AuthProbeOutcome {
    probe_with_timeout(binary, Duration::from_secs(5))
}

/// Test seam: explicit timeout so unit tests don't wait 5 s.
pub(crate) fn probe_with_timeout(binary: &str, timeout: Duration) -> AuthProbeOutcome {
    probe_command_with_timeout(binary, &["login", "status"], timeout)
}

/// Inner test seam — lets tests substitute their own args so they can
/// exercise the timeout path without needing a hung Codex install.
pub(crate) fn probe_command_with_timeout(
    binary: &str,
    args: &[&str],
    timeout: Duration,
) -> AuthProbeOutcome {
    let mut child = match Command::new(binary)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return AuthProbeOutcome::ProbeFailed(e.to_string()),
    };

    // Poll the child for up to `timeout` so we don't block forever on a
    // wedged subprocess.
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    AuthProbeOutcome::Authenticated
                } else {
                    AuthProbeOutcome::NotAuthenticated
                };
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return AuthProbeOutcome::ProbeFailed(format!(
                        "`codex login status` did not exit within {:?}",
                        timeout
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return AuthProbeOutcome::ProbeFailed(e.to_string()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authenticated_has_no_actionable_message() {
        assert!(AuthProbeOutcome::Authenticated.actionable_message().is_none());
    }

    #[test]
    fn not_authenticated_message_includes_docs_url_and_action() {
        let msg = AuthProbeOutcome::NotAuthenticated.actionable_message().unwrap();
        assert!(msg.contains("codex login"), "got: {msg}");
        assert!(msg.contains(AUTH_DOCS_URL), "got: {msg}");
    }

    #[test]
    fn probe_failed_carries_reason_and_docs_url() {
        let msg = AuthProbeOutcome::ProbeFailed("io: file not found".into())
            .actionable_message()
            .unwrap();
        assert!(msg.contains("io: file not found"));
        assert!(msg.contains(AUTH_DOCS_URL));
    }

    #[test]
    fn missing_binary_returns_probe_failed() {
        let out = probe_login_status("/definitely/does/not/exist/codex");
        assert!(matches!(out, AuthProbeOutcome::ProbeFailed(_)));
    }

    #[test]
    fn exit_zero_binary_is_authenticated() {
        // `true` exits 0 — the closest stand-in for a `login status`-style
        // probe that exists on every Unix.
        let out = probe_login_status("true");
        assert_eq!(out, AuthProbeOutcome::Authenticated);
    }

    #[test]
    fn exit_nonzero_binary_is_not_authenticated() {
        // `false` exits 1.
        let out = probe_login_status("false");
        assert_eq!(out, AuthProbeOutcome::NotAuthenticated);
    }

    #[test]
    fn short_timeout_kills_a_hung_subprocess() {
        // `sleep 60` hangs for one minute; the 100ms deadline must fire
        // and the child must be killed.
        let out = probe_command_with_timeout("sleep", &["60"], Duration::from_millis(100));
        match out {
            AuthProbeOutcome::ProbeFailed(reason) => {
                assert!(reason.contains("did not exit within"), "got: {reason}");
            }
            other => panic!("expected ProbeFailed, got {:?}", other),
        }
    }
}
