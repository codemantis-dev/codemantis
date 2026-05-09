// `env_var_present` verification — checks whether a process environment
// variable is set and (optionally) matches the value-validation regex.

use super::{matches_validation, VerifyOutcome};
use crate::preflight::manifest::ValueValidation;

pub fn check(var_name: &str, validation: Option<&ValueValidation>) -> VerifyOutcome {
    match std::env::var(var_name) {
        Ok(value) if value.is_empty() => VerifyOutcome::Missing {
            reason: format!("${} is set but empty", var_name),
        },
        Ok(value) => {
            if matches_validation(Some(&value), validation) {
                VerifyOutcome::Satisfied {
                    message: Some(format!("${} is set", var_name)),
                }
            } else {
                VerifyOutcome::Missing {
                    reason: format!("${} doesn't match the expected format", var_name),
                }
            }
        }
        Err(_) => VerifyOutcome::Missing {
            reason: format!("${} is not set", var_name),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Each test uses a unique env var name. cargo test runs in parallel,
    // and if two tests touched the same name they'd race against each
    // other (set / unset / read).

    #[test]
    fn missing_var_reports_not_set() {
        let name = "CODEMANTIS_PREFLIGHT_TEST_MISSING";
        std::env::remove_var(name);
        match check(name, None) {
            VerifyOutcome::Missing { reason } => assert!(reason.contains("not set")),
            other => panic!("expected Missing, got {:?}", other),
        }
    }

    #[test]
    fn empty_var_reports_empty() {
        let name = "CODEMANTIS_PREFLIGHT_TEST_EMPTY";
        std::env::set_var(name, "");
        let result = check(name, None);
        std::env::remove_var(name);
        match result {
            VerifyOutcome::Missing { reason } => assert!(reason.contains("empty")),
            other => panic!("expected Missing, got {:?}", other),
        }
    }

    #[test]
    fn set_var_passes_without_validation() {
        let name = "CODEMANTIS_PREFLIGHT_TEST_SET";
        std::env::set_var(name, "anything");
        let result = check(name, None);
        std::env::remove_var(name);
        assert!(result.is_satisfied());
    }

    #[test]
    fn validation_passes_when_value_matches_regex() {
        let name = "CODEMANTIS_PREFLIGHT_TEST_REGEX_PASS";
        std::env::set_var(name, "sk-test-12345");
        let v = ValueValidation::Regex {
            pattern: "^sk-".into(),
            hint: None,
            example_format: None,
        };
        let result = check(name, Some(&v));
        std::env::remove_var(name);
        assert!(result.is_satisfied());
    }

    #[test]
    fn validation_fails_when_value_doesnt_match_regex() {
        let name = "CODEMANTIS_PREFLIGHT_TEST_REGEX_FAIL";
        std::env::set_var(name, "garbage");
        let v = ValueValidation::Regex {
            pattern: "^sk-".into(),
            hint: None,
            example_format: None,
        };
        let result = check(name, Some(&v));
        std::env::remove_var(name);
        match result {
            VerifyOutcome::Missing { reason } => assert!(reason.contains("format")),
            other => panic!("expected Missing, got {:?}", other),
        }
    }
}
