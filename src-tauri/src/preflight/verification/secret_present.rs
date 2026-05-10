// `secret_present` verification — confirms the caller already has a stored
// secret and (optionally) that it matches the value-validation regex.
// The verifier doesn't access the secret store itself — the caller is
// responsible for retrieval.

use super::{matches_validation, VerifyOutcome};
use crate::preflight::manifest::ValueValidation;

pub fn check(secret: Option<&str>, validation: Option<&ValueValidation>) -> VerifyOutcome {
    match secret {
        None => VerifyOutcome::Missing {
            reason: "No value has been entered yet".into(),
        },
        Some("") => VerifyOutcome::Missing {
            reason: "The stored value is empty".into(),
        },
        Some(value) => {
            if matches_validation(Some(value), validation) {
                VerifyOutcome::Satisfied {
                    message: Some("Stored and matches expected format".into()),
                }
            } else {
                VerifyOutcome::Missing {
                    reason: "The stored value doesn't match the expected format".into(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_secret_reports_missing() {
        let r = check(None, None);
        assert!(matches!(r, VerifyOutcome::Missing { .. }));
    }

    #[test]
    fn empty_secret_reports_missing() {
        let r = check(Some(""), None);
        assert!(matches!(r, VerifyOutcome::Missing { .. }));
    }

    #[test]
    fn stored_secret_passes_without_regex() {
        let r = check(Some("sk-anything"), None);
        assert!(r.is_satisfied());
    }

    #[test]
    fn stored_secret_passes_when_regex_matches() {
        let v = ValueValidation::Regex {
            pattern: "^sk-".into(),
            hint: None,
            example_format: None,
        };
        let r = check(Some("sk-test"), Some(&v));
        assert!(r.is_satisfied());
    }

    #[test]
    fn stored_secret_fails_when_regex_doesnt_match() {
        let v = ValueValidation::Regex {
            pattern: "^sk-".into(),
            hint: None,
            example_format: None,
        };
        let r = check(Some("garbage"), Some(&v));
        assert!(matches!(r, VerifyOutcome::Missing { .. }));
    }
}
