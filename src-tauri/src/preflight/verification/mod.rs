// Verification engine — runs the recipe declared in a capability's
// `verification` block and returns a structured outcome.
//
// Phase 2 implements four kinds:
//   - shell_command   → runs a command in the user's login shell
//   - env_var_present → reads a process environment variable
//   - secret_present  → confirms a secret has been stored (and optionally
//                       matches the value-validation regex)
//   - api_probe       → fires a single HTTP request with the right auth
//
// The caller is responsible for retrieving the secret and passing it in;
// verifier code never reads from preflight_secrets or settings directly.
// This keeps the dependency graph clean and makes unit testing trivial.

#![allow(dead_code)] // Phase 3 wires this into Tauri commands.

pub mod api;
pub mod env;
pub mod secret_present;
pub mod shell;

use crate::preflight::manifest::{ValueValidation, Verification};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VerifyOutcome {
    /// Capability is currently satisfied. The optional message is shown in UI.
    Satisfied { message: Option<String> },
    /// Capability is missing or invalid. `reason` is shown in UI; if a known
    /// `troubleshooting` hint applies, it's also surfaced.
    Missing { reason: String },
    /// Verification couldn't run (e.g. network failure, command not found).
    /// Distinct from Missing: the world's state is unknown, not negative.
    Error { error: String },
}

impl VerifyOutcome {
    pub fn is_satisfied(&self) -> bool {
        matches!(self, VerifyOutcome::Satisfied { .. })
    }
}

/// Run the verification recipe and return the outcome.
///
/// `secret` is consulted only for kinds that need it (currently
/// `secret_present` and `api_probe`); other kinds ignore it.
pub async fn check(
    verification: &Verification,
    secret: Option<&str>,
    value_validation: Option<&ValueValidation>,
) -> VerifyOutcome {
    match verification {
        Verification::ShellCommand {
            command,
            success_when,
            timeout_ms,
        } => shell::check(command, success_when.as_deref(), *timeout_ms).await,
        Verification::EnvVarPresent {
            var_name,
            value_validation: per_check_validation,
        } => env::check(var_name, per_check_validation.as_ref().or(value_validation)),
        Verification::SecretPresent { .. } => {
            secret_present::check(secret, value_validation)
        }
        Verification::ApiProbe {
            method,
            url,
            auth,
            extra_headers,
            success_when,
            timeout_ms,
        } => {
            api::check(api::Probe {
                method,
                url,
                auth: auth.as_deref(),
                extra_headers,
                success_when: success_when.as_deref(),
                timeout_ms: *timeout_ms,
                secret,
            })
            .await
        }
        Verification::Unsupported => VerifyOutcome::Error {
            error: "verification kind not implemented in this CodeMantis version".into(),
        },
    }
}

/// Validate a candidate value against an optional regex. `None` value with
/// `Some` regex returns false; `None` regex with any value returns true.
pub(crate) fn matches_validation(value: Option<&str>, validation: Option<&ValueValidation>) -> bool {
    let Some(validation) = validation else {
        return true;
    };
    match validation {
        ValueValidation::Regex { pattern, .. } => {
            let Some(value) = value else { return false };
            match regex::Regex::new(pattern) {
                Ok(re) => re.is_match(value),
                Err(_) => false,
            }
        }
        ValueValidation::Unsupported => true, // forward-compat: don't fail
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_verification_returns_error() {
        let v = Verification::Unsupported;
        let result = futures::executor::block_on(check(&v, None, None));
        assert!(matches!(result, VerifyOutcome::Error { .. }));
    }

    #[test]
    fn matches_validation_passes_when_no_regex() {
        assert!(matches_validation(Some("anything"), None));
        assert!(matches_validation(None, None));
    }

    #[test]
    fn matches_validation_requires_value_when_regex_set() {
        let v = ValueValidation::Regex {
            pattern: "^x$".into(),
            hint: None,
            example_format: None,
        };
        assert!(!matches_validation(None, Some(&v)));
        assert!(matches_validation(Some("x"), Some(&v)));
        assert!(!matches_validation(Some("y"), Some(&v)));
    }

    #[test]
    fn matches_validation_with_invalid_regex_fails_safe() {
        let v = ValueValidation::Regex {
            pattern: "(unclosed".into(),
            hint: None,
            example_format: None,
        };
        // A broken pattern should refuse to match — better than panicking.
        assert!(!matches_validation(Some("anything"), Some(&v)));
    }
}
