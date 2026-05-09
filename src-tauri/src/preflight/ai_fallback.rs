// AI fallback for catalog entry generation. When SpecWriter (Phase 4.5)
// references a `catalog_ref` that doesn't exist in either the bundled
// catalog or the local cache, this module asks an LLM to produce a
// structured CatalogEntry following the same schema.
//
// Phase 5 ships single-AI generation. Cross-verification (sending the same
// prompt to two other providers and comparing) is Phase 5.5 — it depends
// on this single-AI path being battle-tested first and on the user having
// multiple providers configured.
//
// **Safety:** the LLM is allowed to invent remediation steps (URLs, copy)
// and value-validation regexes. It is NOT allowed to invent verification
// recipes for security-sensitive services — for those, the entry is forced
// to `verification: secret_present` so the user does the validation.

#![allow(dead_code)]

use crate::preflight::catalog::{
    CatalogEntry, Remediation, RemediationStep, ServiceMeta, StepAction, TrustTier,
};
use crate::preflight::manifest::{ValueValidation as CatalogValueValidation, Verification};
use serde::{Deserialize, Serialize};

/// Fixed system prompt. Versioned: bump the integer when meaningful changes
/// happen so cached entries can be regenerated against the new spec.
pub const PROMPT_VERSION: &str = "2026-05-09:v1";

pub fn build_prompt(catalog_ref: &str) -> String {
    format!(
        r#"You are generating a structured "capability catalog entry" for a developer
tool called CodeMantis. The user is trying to set up a project that needs a
service or tool identified only by the catalog_ref below. Generate a JSON
object describing how a non-technical user can satisfy this capability.

Catalog ref: {catalog_ref}

Respond with ONLY the JSON object below. No prose, no markdown fences.

{{
  "displayName": "Human-friendly name",
  "service": {{
    "name": "Brand or tool name",
    "category": "llm_provider | payments | email | backend | auth | runtime | package_manager | version_control | containerization | other",
    "homepage": "https://...",
    "iconHint": "stripe.svg | etc (informational, optional)"
  }},
  "description": "1-2 sentences explaining what this is and what it's used for.",
  "valueValidation": {{
    "regex": "^... a regex matching the credential format ...$",
    "hint": "One-line hint shown to user when they paste the wrong format",
    "exampleFormat": "sk_test_..."
  }},
  "remediation": {{
    "kind": "guided_steps",
    "estimatedMinutes": 3,
    "steps": [
      {{
        "title": "Open <service> account page",
        "body": "Optional one-line context.",
        "action": {{ "kind": "open_url", "url": "https://...", "label": "Open <service>" }}
      }},
      {{
        "title": "Sign in or create an account",
        "action": {{ "kind": "manual_confirm", "label": "Done" }}
      }},
      {{
        "title": "Copy your API key",
        "body": "Where in the UI to find it."
      }},
      {{
        "title": "Paste it here",
        "action": {{ "kind": "paste_and_verify" }}
      }}
    ]
  }}
}}

Rules:
- All URLs must be real, accurate, and use HTTPS.
- valueValidation regex must match the actual credential format.
- Do NOT invent verification API endpoints for security-sensitive services.
- Keep step titles short (under 50 chars) and bodies under 200 chars.
- estimatedMinutes must be 1, 2, 3, 4, 5, 6, 8, or 10."#
    )
}

/// Raw shape we expect the LLM to produce. Looser than CatalogEntry so we
/// can validate piecewise and produce useful error messages.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawEntry {
    display_name: String,
    service: RawService,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    value_validation: Option<RawRegex>,
    remediation: RawRemediation,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawService {
    name: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    icon_hint: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RawRegex {
    regex: String,
    #[serde(default)]
    hint: Option<String>,
    #[serde(default)]
    example_format: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawRemediation {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default = "default_minutes")]
    estimated_minutes: u32,
    #[serde(default)]
    steps: Vec<RawStep>,
}

fn default_minutes() -> u32 {
    3
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RawStep {
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    action: Option<serde_json::Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum AiFallbackError {
    #[error("model returned non-JSON output: {0}")]
    ParseError(String),
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("regex from model is invalid: {0}")]
    BadRegex(String),
}

/// Parse the LLM's JSON output and convert to a CatalogEntry. Validates
/// the regex compiles and that step actions have a known kind.
pub fn parse_into_entry(
    catalog_ref: &str,
    json_text: &str,
) -> Result<CatalogEntry, AiFallbackError> {
    let raw: RawEntry = serde_json::from_str(json_text.trim())
        .map_err(|e| AiFallbackError::ParseError(e.to_string()))?;

    if raw.display_name.trim().is_empty() {
        return Err(AiFallbackError::Validation(
            "displayName must not be empty".into(),
        ));
    }
    if raw.service.name.trim().is_empty() {
        return Err(AiFallbackError::Validation(
            "service.name must not be empty".into(),
        ));
    }

    let value_validation = raw
        .value_validation
        .map(|r| -> Result<CatalogValueValidation, AiFallbackError> {
            // Compile regex to confirm it's syntactically valid.
            regex::Regex::new(&r.regex).map_err(|e| AiFallbackError::BadRegex(e.to_string()))?;
            Ok(CatalogValueValidation::Regex {
                pattern: r.regex,
                hint: r.hint,
                example_format: r.example_format,
            })
        })
        .transpose()?;

    let steps: Vec<RemediationStep> = raw
        .remediation
        .steps
        .into_iter()
        .enumerate()
        .map(|(i, s)| RemediationStep {
            id: (i + 1) as u32,
            title: s.title,
            body: s.body,
            action: parse_action(s.action),
            screenshot: None,
        })
        .collect();

    if steps.is_empty() {
        return Err(AiFallbackError::Validation(
            "remediation.steps must not be empty".into(),
        ));
    }

    Ok(CatalogEntry {
        schema_version: "1.0".into(),
        catalog_ref: catalog_ref.into(),
        display_name: raw.display_name,
        service: ServiceMeta {
            name: raw.service.name,
            category: raw.service.category,
            homepage: raw.service.homepage,
            icon: raw.service.icon_hint,
            trust_tier: TrustTier::AiGenerated,
            last_verified: None,
        },
        description: raw.description,
        // For security: AI-generated entries default to secret_present rather
        // than letting the model invent an api_probe.
        verification_recipe: Verification::SecretPresent {
            key: catalog_ref.into(),
        },
        value_validation,
        remediation: Remediation::GuidedSteps {
            estimated_minutes: raw.remediation.estimated_minutes,
            steps,
        },
    })
}

fn parse_action(value: Option<serde_json::Value>) -> Option<StepAction> {
    let value = value?;
    let kind = value.get("kind")?.as_str()?;
    match kind {
        "open_url" => Some(StepAction::OpenUrl {
            url: value.get("url")?.as_str()?.to_string(),
            label: value
                .get("label")
                .and_then(|v| v.as_str())
                .map(String::from),
        }),
        "paste_and_verify" => Some(StepAction::PasteAndVerify),
        "confirm_install" => Some(StepAction::ConfirmInstall),
        "manual_confirm" => Some(StepAction::ManualConfirm {
            label: value
                .get("label")
                .and_then(|v| v.as_str())
                .map(String::from),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_json() -> String {
        r#"{
            "displayName": "Resend API Key",
            "service": {
                "name": "Resend",
                "category": "email",
                "homepage": "https://resend.com",
                "iconHint": "resend.svg"
            },
            "description": "Transactional email API.",
            "valueValidation": {
                "regex": "^re_[A-Za-z0-9_]{20,}$",
                "hint": "Resend keys start with re_",
                "exampleFormat": "re_..."
            },
            "remediation": {
                "kind": "guided_steps",
                "estimatedMinutes": 2,
                "steps": [
                    {
                        "title": "Open Resend",
                        "action": {"kind": "open_url", "url": "https://resend.com/api-keys", "label": "Open"}
                    },
                    {"title": "Paste it", "action": {"kind": "paste_and_verify"}}
                ]
            }
        }"#
        .into()
    }

    #[test]
    fn parses_good_json_into_entry() {
        let entry = parse_into_entry("resend.api_key", &good_json()).unwrap();
        assert_eq!(entry.catalog_ref, "resend.api_key");
        assert_eq!(entry.display_name, "Resend API Key");
        assert_eq!(entry.service.trust_tier, TrustTier::AiGenerated);
        // Security: AI-generated entries default to secret_present.
        assert!(matches!(
            entry.verification_recipe,
            Verification::SecretPresent { .. }
        ));
    }

    #[test]
    fn enforces_secret_present_verification_even_when_model_implies_api() {
        // The model has no field for verification — we never let it choose.
        let entry = parse_into_entry("foo.bar", &good_json()).unwrap();
        assert!(matches!(
            entry.verification_recipe,
            Verification::SecretPresent { .. }
        ));
    }

    #[test]
    fn rejects_non_json_output() {
        let result = parse_into_entry("x.y", "Sure! Here's your entry: {invalid");
        assert!(matches!(result, Err(AiFallbackError::ParseError(_))));
    }

    #[test]
    fn rejects_empty_display_name() {
        let json = good_json().replace("Resend API Key", "");
        let result = parse_into_entry("x.y", &json);
        assert!(matches!(result, Err(AiFallbackError::Validation(_))));
    }

    #[test]
    fn rejects_empty_service_name() {
        let json = good_json().replace("\"name\": \"Resend\"", "\"name\": \"\"");
        let result = parse_into_entry("x.y", &json);
        assert!(matches!(result, Err(AiFallbackError::Validation(_))));
    }

    #[test]
    fn rejects_invalid_regex() {
        let json = good_json().replace(
            "^re_[A-Za-z0-9_]{20,}$",
            "(unclosed-bracket",
        );
        let result = parse_into_entry("x.y", &json);
        assert!(matches!(result, Err(AiFallbackError::BadRegex(_))));
    }

    #[test]
    fn rejects_empty_steps() {
        // Use a directly-constructed fixture rather than mutating the good
        // one — easier to reason about than chained replaces.
        let json = r#"{
            "displayName": "X", "service": {"name": "X"},
            "remediation": {"kind": "guided_steps", "estimatedMinutes": 1, "steps": []}
        }"#;
        let result = parse_into_entry("x.y", json);
        assert!(matches!(result, Err(AiFallbackError::Validation(_))));
    }

    #[test]
    fn step_actions_round_trip() {
        let entry = parse_into_entry("x.y", &good_json()).unwrap();
        if let Remediation::GuidedSteps { steps, .. } = &entry.remediation {
            assert!(matches!(steps[0].action, Some(StepAction::OpenUrl { .. })));
            assert!(matches!(steps[1].action, Some(StepAction::PasteAndVerify)));
        } else {
            panic!("expected guided_steps");
        }
    }

    #[test]
    fn unknown_step_action_kind_drops_action_silently() {
        // Forward-compat: model invents a future action kind we don't support.
        let json = r#"{
            "displayName": "X", "service": {"name": "X"},
            "remediation": {"kind": "guided_steps", "estimatedMinutes": 1, "steps": [
                {"title": "Step", "action": {"kind": "future_kind"}}
            ]}
        }"#;
        let entry = parse_into_entry("x.y", json).unwrap();
        if let Remediation::GuidedSteps { steps, .. } = &entry.remediation {
            assert!(steps[0].action.is_none());
        } else {
            panic!("expected guided_steps");
        }
    }

    #[test]
    fn missing_value_validation_is_optional() {
        let json = r#"{
            "displayName": "X", "service": {"name": "X"},
            "remediation": {"kind": "guided_steps", "estimatedMinutes": 1, "steps": [
                {"title": "Step"}
            ]}
        }"#;
        let entry = parse_into_entry("x.y", json).unwrap();
        assert!(entry.value_validation.is_none());
    }

    #[test]
    fn build_prompt_mentions_the_catalog_ref() {
        let p = build_prompt("stripe.api_key.secret");
        assert!(p.contains("stripe.api_key.secret"));
        assert!(p.contains("JSON"));
    }

    #[test]
    fn prompt_version_constant_is_set() {
        assert!(!PROMPT_VERSION.is_empty());
    }
}
