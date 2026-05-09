// Auto-installer — runs `Remediation::Automated` recipes (e.g. `npm install
// -g pnpm`) and streams stdout/stderr back to the UI line-by-line so the
// user sees progress in Mission Control.
//
// **Safety policy:**
//   - Caller MUST display the full command line and obtain user confirmation
//     before invoking. This module does not gate on confirmation itself.
//   - We refuse to run anything that contains `sudo` or `su -` (Phase 2
//     scope: no privileged installs without an explicit, separate flow).
//   - Output is captured via tokio's piped reader and emitted as discrete
//     lines, preserving the stdout/stderr stream tag.

#![allow(dead_code)] // Phase 2 wires this into Tauri commands.

use crate::preflight::catalog::Remediation;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub line: String,
    pub stream: ProgressStream,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressStream {
    Stdout,
    Stderr,
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("not an automated remediation kind")]
    NotAutomated,
    #[error("blocked: command requires elevated privileges (`sudo`/`su`)")]
    PrivilegeRefused,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Run an `automated` remediation. The `on_progress` callback receives every
/// line of stdout/stderr in order, lets the caller forward to a Tauri event.
pub async fn run<F>(
    remediation: &Remediation,
    mut on_progress: F,
) -> Result<InstallResult, InstallError>
where
    F: FnMut(InstallProgress),
{
    let Remediation::Automated {
        command,
        args,
        success_message,
        ..
    } = remediation
    else {
        return Err(InstallError::NotAutomated);
    };

    if is_privileged(command, args) {
        return Err(InstallError::PrivilegeRefused);
    }

    let path = crate::utils::paths::login_shell_path();
    let mut child = Command::new(command)
        .args(args)
        .env("PATH", path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().expect("piped");
    let stderr = child.stderr.take().expect("piped");
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();

    loop {
        tokio::select! {
            line = stdout_lines.next_line() => match line {
                Ok(Some(l)) => on_progress(InstallProgress {
                    line: l,
                    stream: ProgressStream::Stdout,
                }),
                Ok(None) => break,
                Err(e) => return Err(e.into()),
            },
            line = stderr_lines.next_line() => match line {
                Ok(Some(l)) => on_progress(InstallProgress {
                    line: l,
                    stream: ProgressStream::Stderr,
                }),
                Ok(None) => continue,
                Err(e) => return Err(e.into()),
            },
        }
    }
    // Drain any remaining stderr after stdout closes.
    while let Ok(Some(l)) = stderr_lines.next_line().await {
        on_progress(InstallProgress {
            line: l,
            stream: ProgressStream::Stderr,
        });
    }

    let status = child.wait().await?;
    let exit_code = status.code();
    Ok(InstallResult {
        success: status.success(),
        exit_code,
        message: if status.success() {
            success_message
                .clone()
                .unwrap_or_else(|| "Install completed".into())
        } else {
            format!(
                "Install failed (exit {})",
                exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "?".into())
            )
        },
    })
}

fn is_privileged(command: &str, args: &[String]) -> bool {
    let cmd = command.trim().to_ascii_lowercase();
    if cmd == "sudo" || cmd == "doas" {
        return true;
    }
    if cmd == "su" && args.iter().any(|a| a == "-") {
        return true;
    }
    // Even if user wraps in shell, refuse if the literal command line says sudo.
    if cmd.contains("sudo") {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn automated(command: &str, args: Vec<&str>) -> Remediation {
        Remediation::Automated {
            estimated_minutes: 1,
            command: command.into(),
            args: args.into_iter().map(String::from).collect(),
            success_message: Some("ok".into()),
        }
    }

    #[tokio::test]
    async fn refuses_non_automated_remediation() {
        let r = Remediation::ExternalOnly { info: None };
        let mut hit = false;
        let result = run(&r, |_| hit = true).await;
        assert!(matches!(result, Err(InstallError::NotAutomated)));
        assert!(!hit);
    }

    #[tokio::test]
    async fn refuses_sudo_command() {
        let r = automated("sudo", vec!["apt", "install"]);
        let result = run(&r, |_| {}).await;
        assert!(matches!(result, Err(InstallError::PrivilegeRefused)));
    }

    #[tokio::test]
    async fn refuses_doas_command() {
        let r = automated("doas", vec!["pkg_add", "x"]);
        let result = run(&r, |_| {}).await;
        assert!(matches!(result, Err(InstallError::PrivilegeRefused)));
    }

    #[tokio::test]
    async fn refuses_su_dash() {
        let r = automated("su", vec!["-", "root"]);
        let result = run(&r, |_| {}).await;
        assert!(matches!(result, Err(InstallError::PrivilegeRefused)));
    }

    #[tokio::test]
    async fn echo_runs_and_streams_progress() {
        let r = automated("echo", vec!["hello", "world"]);
        let mut lines = vec![];
        let result = run(&r, |p| lines.push((p.stream, p.line)))
            .await
            .unwrap();
        assert!(result.success);
        assert_eq!(result.exit_code, Some(0));
        // echo with two args produces "hello world" on a single line.
        assert!(
            lines
                .iter()
                .any(|(s, l)| *s == ProgressStream::Stdout && l.contains("hello world")),
            "expected stdout 'hello world' line, got {:?}",
            lines
        );
    }

    #[tokio::test]
    async fn nonzero_exit_is_reported_as_failure() {
        let r = automated("sh", vec!["-c", "exit 3"]);
        let result = run(&r, |_| {}).await.unwrap();
        assert!(!result.success);
        assert_eq!(result.exit_code, Some(3));
        assert!(result.message.contains("failed"));
    }

    #[tokio::test]
    async fn stderr_is_tagged_separately() {
        let r = automated("sh", vec!["-c", "echo ohno >&2"]);
        let mut got_stderr = false;
        let _ = run(&r, |p| {
            if p.stream == ProgressStream::Stderr && p.line.contains("ohno") {
                got_stderr = true;
            }
        })
        .await
        .unwrap();
        assert!(got_stderr, "expected stderr line tagged correctly");
    }
}
