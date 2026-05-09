// `shell_command` verification — runs the command in the user's login
// shell and reports the outcome. We always go through a login shell
// (`zsh -lic ...`) so PATH entries from `~/.zshrc` (nvm, fnm, brew, etc.)
// are visible. Otherwise a `node --version` check would fail in a Tauri
// .app bundle that inherits a minimal PATH.
//
// Success criteria can be expressed two ways in the catalog:
//   - "exit_code == 0"                    → just check exit code
//   - "stdout matches '<regex>'"          → also require regex match
// Anything else is treated as exit-code-only for safety.

use super::VerifyOutcome;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

pub async fn check(
    command: &str,
    success_when: Option<&str>,
    timeout_ms: u64,
) -> VerifyOutcome {
    let path = crate::utils::paths::login_shell_path();
    // We pre-resolve the user's full login-shell PATH (see login_shell_path)
    // and inject it via env, so we DON'T need `-li` here. Plain `-c` keeps
    // stdout free of any rc-file noise (banners, command summaries) that
    // would confuse `stdout matches '<regex>'` predicates.
    let mut child = Command::new("/bin/zsh");
    child
        .args(["-c", command])
        .env("PATH", path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let result = timeout(Duration::from_millis(timeout_ms), child.output()).await;
    match result {
        Err(_) => VerifyOutcome::Error {
            error: format!("Command timed out after {} ms: {}", timeout_ms, command),
        },
        Ok(Err(e)) => VerifyOutcome::Error {
            error: format!("Failed to run `{}`: {}", command, e),
        },
        Ok(Ok(output)) => evaluate_output(command, success_when, &output),
    }
}

fn evaluate_output(
    command: &str,
    success_when: Option<&str>,
    output: &std::process::Output,
) -> VerifyOutcome {
    let exit_ok = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout_trimmed = stdout.trim();

    // Default: exit code 0 means success.
    let regex_pattern = success_when.and_then(parse_stdout_match);

    if !exit_ok {
        return VerifyOutcome::Missing {
            reason: format!(
                "`{}` exited {} (stderr: {})",
                command,
                output
                    .status
                    .code()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "?".into()),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        };
    }

    if let Some(pattern) = regex_pattern {
        match regex::Regex::new(&pattern) {
            Ok(re) if re.is_match(stdout_trimmed) => VerifyOutcome::Satisfied {
                message: Some(format!("`{}` → {}", command, stdout_trimmed)),
            },
            Ok(_) => VerifyOutcome::Missing {
                reason: format!(
                    "`{}` ran but output didn't match expected pattern: got {:?}",
                    command, stdout_trimmed
                ),
            },
            Err(e) => VerifyOutcome::Error {
                error: format!("invalid success_when regex: {}", e),
            },
        }
    } else {
        VerifyOutcome::Satisfied {
            message: Some(format!("`{}` → {}", command, stdout_trimmed)),
        }
    }
}

/// Parse `stdout matches '<pattern>'` (DSL used in catalog YAML) and return
/// the inner regex. Returns None if the success_when expression is something
/// else (e.g. `exit_code == 0`, which is the default behaviour anyway).
fn parse_stdout_match(expr: &str) -> Option<String> {
    let expr = expr.trim();
    let prefix = "stdout matches ";
    if !expr.starts_with(prefix) {
        return None;
    }
    let rest = expr[prefix.len()..].trim();
    // Trim surrounding single or double quotes.
    let trimmed = rest
        .strip_prefix('\'')
        .and_then(|s| s.strip_suffix('\''))
        .or_else(|| rest.strip_prefix('"').and_then(|s| s.strip_suffix('"')))
        .unwrap_or(rest);
    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_stdout_match_extracts_single_quoted_pattern() {
        assert_eq!(
            parse_stdout_match("stdout matches '^v(2[0-9])'"),
            Some("^v(2[0-9])".into())
        );
    }

    #[test]
    fn parse_stdout_match_extracts_double_quoted_pattern() {
        assert_eq!(
            parse_stdout_match("stdout matches \"foo\""),
            Some("foo".into())
        );
    }

    #[test]
    fn parse_stdout_match_returns_none_for_other_expressions() {
        assert_eq!(parse_stdout_match("exit_code == 0"), None);
        assert_eq!(parse_stdout_match(""), None);
    }

    #[tokio::test]
    async fn echo_with_default_success_passes() {
        let r = check("echo hello", None, 3000).await;
        match r {
            VerifyOutcome::Satisfied { message } => {
                assert!(message.unwrap().contains("hello"));
            }
            other => panic!("expected Satisfied, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn nonzero_exit_reports_missing() {
        let r = check("exit 7", None, 3000).await;
        match r {
            VerifyOutcome::Missing { reason } => assert!(reason.contains("exited 7")),
            other => panic!("expected Missing, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn stdout_regex_match_passes() {
        let r = check("echo v20.10.0", Some("stdout matches '^v(2[0-9])'"), 3000).await;
        assert!(r.is_satisfied());
    }

    #[tokio::test]
    async fn stdout_regex_mismatch_reports_missing() {
        let r = check("echo v18.0.0", Some("stdout matches '^v(2[0-9])'"), 3000).await;
        match r {
            VerifyOutcome::Missing { reason } => assert!(reason.contains("didn't match")),
            other => panic!("expected Missing, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn timeout_reports_error() {
        let r = check("sleep 5", None, 200).await;
        assert!(matches!(r, VerifyOutcome::Error { .. }));
    }
}
