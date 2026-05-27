// Capability Catalog — knowledge source for HOW to satisfy a precondition.
//
// One entry per service/tool. The Manifest references entries by `catalog_ref`.
// Phase 1 ships ~13 hand-curated entries bundled with the app. Phase 5 adds
// remote catalog updates and AI-generated long-tail entries.

#![allow(dead_code)] // Phase 2 wires the loader into commands; Phase 3 renders entries.

use crate::preflight::manifest::{ValueValidation, Verification};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CatalogEntry {
    pub schema_version: String,
    pub catalog_ref: String,
    pub display_name: String,
    pub service: ServiceMeta,
    #[serde(default)]
    pub description: Option<String>,
    pub verification_recipe: Verification,
    #[serde(default)]
    pub value_validation: Option<ValueValidation>,
    pub remediation: Remediation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ServiceMeta {
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_trust_tier")]
    pub trust_tier: TrustTier,
    #[serde(default)]
    pub last_verified: Option<String>,
}

fn default_trust_tier() -> TrustTier {
    TrustTier::Curated
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustTier {
    Curated,
    Community,
    AiGenerated,
    AiGeneratedVerified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Remediation {
    Automated {
        #[serde(default = "default_minutes")]
        estimated_minutes: u32,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        success_message: Option<String>,
    },
    GuidedSteps {
        #[serde(default = "default_minutes")]
        estimated_minutes: u32,
        steps: Vec<RemediationStep>,
    },
    ExternalOnly {
        #[serde(default)]
        info: Option<String>,
    },
    /// Forward-compat catch-all.
    #[serde(other)]
    Unsupported,
}

fn default_minutes() -> u32 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RemediationStep {
    pub id: u32,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub action: Option<StepAction>,
    #[serde(default)]
    pub screenshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StepAction {
    OpenUrl {
        url: String,
        #[serde(default)]
        label: Option<String>,
    },
    PasteAndVerify,
    ConfirmInstall,
    ManualConfirm {
        #[serde(default)]
        label: Option<String>,
    },
    /// Forward-compat catch-all.
    #[serde(other)]
    Unsupported,
}

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml parse error in {path}: {source}")]
    Parse {
        path: PathBuf,
        #[source]
        source: serde_yaml_ng::Error,
    },
    #[error("catalog directory not found: {0}")]
    DirNotFound(PathBuf),
}

/// In-memory catalog: `catalog_ref` → entry.
#[derive(Debug, Clone, Default)]
pub struct Catalog {
    entries: HashMap<String, CatalogEntry>,
}

impl Catalog {
    /// Walk the catalog directory and load every `*.yaml`/`*.yml` file under
    /// `services/` and `system/`. Returns the populated catalog.
    pub fn load_from_dir(root: &Path) -> Result<Self, CatalogError> {
        if !root.is_dir() {
            return Err(CatalogError::DirNotFound(root.to_path_buf()));
        }
        let mut entries = HashMap::new();
        for sub in &["services", "system"] {
            let dir = root.join(sub);
            if !dir.is_dir() {
                continue;
            }
            for ent in std::fs::read_dir(&dir)? {
                let ent = ent?;
                let path = ent.path();
                if !is_yaml(&path) {
                    continue;
                }
                let text = std::fs::read_to_string(&path)?;
                let entry: CatalogEntry =
                    serde_yaml_ng::from_str(&text).map_err(|source| CatalogError::Parse {
                        path: path.clone(),
                        source,
                    })?;
                entries.insert(entry.catalog_ref.clone(), entry);
            }
        }
        Ok(Self { entries })
    }

    pub fn get(&self, catalog_ref: &str) -> Option<&CatalogEntry> {
        self.entries.get(catalog_ref)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &CatalogEntry)> {
        self.entries.iter().map(|(k, v)| (k.as_str(), v))
    }
}

fn is_yaml(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()),
        Some("yaml") | Some("yml")
    )
}

/// Cached, app-wide bundled catalog. The path resolver is a callback so the
/// Tauri integration can supply `app.path().resource_dir()` while tests pass
/// a tempdir.
static CACHED: OnceLock<Catalog> = OnceLock::new();

pub fn cached_catalog<F>(resolver: F) -> Result<&'static Catalog, CatalogError>
where
    F: FnOnce() -> Option<PathBuf>,
{
    if let Some(c) = CACHED.get() {
        return Ok(c);
    }
    let path = resolver().ok_or_else(|| CatalogError::DirNotFound(PathBuf::from("<unresolved>")))?;
    let catalog = Catalog::load_from_dir(&path)?;
    let _ = CACHED.set(catalog);
    Ok(CACHED.get().expect("just set"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preflight::manifest::Verification;
    use std::fs;
    use tempfile::tempdir;

    fn write_yaml(dir: &Path, sub: &str, name: &str, contents: &str) {
        let target_dir = dir.join(sub);
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join(name), contents).unwrap();
    }

    fn stripe_entry_yaml() -> &'static str {
        r#"
schema_version: "1.0"
catalog_ref: stripe.api_key.secret
display_name: Stripe Secret API Key
service:
  name: Stripe
  category: payments
  homepage: https://stripe.com
  trust_tier: curated
description: |
  Secret key for server-side Stripe API calls.
verification_recipe:
  kind: api_probe
  method: GET
  url: https://api.stripe.com/v1/account
  auth: bearer
  success_when: "status == 200"
  timeout_ms: 5000
value_validation:
  kind: regex
  pattern: "^sk_(test|live)_[A-Za-z0-9]{24,}$"
  hint: "Stripe secret keys start with sk_"
remediation:
  kind: guided_steps
  estimated_minutes: 3
  steps:
    - id: 1
      title: "Open the Stripe API keys page"
      action:
        kind: open_url
        url: https://dashboard.stripe.com/test/apikeys
        label: "Open API keys"
    - id: 2
      title: "Copy the secret key and paste it here"
      action:
        kind: paste_and_verify
"#
    }

    fn node_entry_yaml() -> &'static str {
        r#"
schema_version: "1.0"
catalog_ref: system.node.20
display_name: Node.js 20+
service:
  name: Node.js
  category: runtime
  trust_tier: curated
verification_recipe:
  kind: shell_command
  command: "node --version"
  success_when: "stdout matches '^v(2[0-9]|[3-9][0-9])'"
  timeout_ms: 3000
remediation:
  kind: external_only
  info: "Install via nvm or the official installer."
"#
    }

    #[test]
    fn loads_single_service_entry() {
        let dir = tempdir().unwrap();
        write_yaml(dir.path(), "services", "stripe.yaml", stripe_entry_yaml());
        let cat = Catalog::load_from_dir(dir.path()).unwrap();
        assert_eq!(cat.len(), 1);
        let entry = cat.get("stripe.api_key.secret").unwrap();
        assert_eq!(entry.display_name, "Stripe Secret API Key");
        assert_eq!(entry.service.trust_tier, TrustTier::Curated);
        assert!(matches!(entry.verification_recipe, Verification::ApiProbe { .. }));
    }

    #[test]
    fn loads_system_entry() {
        let dir = tempdir().unwrap();
        write_yaml(dir.path(), "system", "node.yaml", node_entry_yaml());
        let cat = Catalog::load_from_dir(dir.path()).unwrap();
        assert_eq!(cat.len(), 1);
        let entry = cat.get("system.node.20").unwrap();
        assert!(matches!(
            entry.verification_recipe,
            Verification::ShellCommand { .. }
        ));
        assert!(matches!(entry.remediation, Remediation::ExternalOnly { .. }));
    }

    #[test]
    fn loads_both_subdirectories() {
        let dir = tempdir().unwrap();
        write_yaml(dir.path(), "services", "stripe.yaml", stripe_entry_yaml());
        write_yaml(dir.path(), "system", "node.yaml", node_entry_yaml());
        let cat = Catalog::load_from_dir(dir.path()).unwrap();
        assert_eq!(cat.len(), 2);
        assert!(cat.get("stripe.api_key.secret").is_some());
        assert!(cat.get("system.node.20").is_some());
    }

    #[test]
    fn skips_non_yaml_files() {
        let dir = tempdir().unwrap();
        write_yaml(dir.path(), "services", "stripe.yaml", stripe_entry_yaml());
        write_yaml(dir.path(), "services", "readme.md", "ignore me");
        let cat = Catalog::load_from_dir(dir.path()).unwrap();
        assert_eq!(cat.len(), 1);
    }

    #[test]
    fn missing_dir_returns_error() {
        let dir = tempdir().unwrap();
        let nonexistent = dir.path().join("does-not-exist");
        let err = Catalog::load_from_dir(&nonexistent).unwrap_err();
        assert!(matches!(err, CatalogError::DirNotFound(_)));
    }

    #[test]
    fn parse_error_reports_path() {
        let dir = tempdir().unwrap();
        write_yaml(
            dir.path(),
            "services",
            "broken.yaml",
            "not: valid: yaml: at: all\n  - and: bad",
        );
        let err = Catalog::load_from_dir(dir.path()).unwrap_err();
        match err {
            CatalogError::Parse { path, .. } => assert!(path.ends_with("broken.yaml")),
            _ => panic!("expected Parse error"),
        }
    }

    #[test]
    fn empty_directory_yields_empty_catalog() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("services")).unwrap();
        let cat = Catalog::load_from_dir(dir.path()).unwrap();
        assert!(cat.is_empty());
    }

    #[test]
    fn iter_visits_all_entries() {
        let dir = tempdir().unwrap();
        write_yaml(dir.path(), "services", "stripe.yaml", stripe_entry_yaml());
        write_yaml(dir.path(), "system", "node.yaml", node_entry_yaml());
        let cat = Catalog::load_from_dir(dir.path()).unwrap();
        let refs: Vec<&str> = cat.iter().map(|(k, _)| k).collect();
        assert_eq!(refs.len(), 2);
        assert!(refs.contains(&"stripe.api_key.secret"));
        assert!(refs.contains(&"system.node.20"));
    }

    #[test]
    fn entry_round_trip_via_yaml() {
        // Serialize → parse → equal.
        let original: CatalogEntry = serde_yaml_ng::from_str(stripe_entry_yaml()).unwrap();
        let yaml = serde_yaml_ng::to_string(&original).unwrap();
        let restored: CatalogEntry = serde_yaml_ng::from_str(&yaml).unwrap();
        assert_eq!(restored.catalog_ref, original.catalog_ref);
        assert_eq!(restored.display_name, original.display_name);
    }

    #[test]
    fn unknown_remediation_kind_falls_back_to_unsupported() {
        let yaml = r#"
schema_version: "1.0"
catalog_ref: x
display_name: X
service:
  name: X
verification_recipe:
  kind: secret_present
  key: X
remediation:
  kind: future_kind_not_yet_built
"#;
        let entry: CatalogEntry = serde_yaml_ng::from_str(yaml).unwrap();
        assert!(matches!(entry.remediation, Remediation::Unsupported));
    }

    #[test]
    fn step_actions_parse_correctly() {
        let entry: CatalogEntry = serde_yaml_ng::from_str(stripe_entry_yaml()).unwrap();
        if let Remediation::GuidedSteps { steps, .. } = &entry.remediation {
            assert_eq!(steps.len(), 2);
            assert_eq!(steps[0].id, 1);
            assert!(matches!(steps[0].action, Some(StepAction::OpenUrl { .. })));
            assert!(matches!(steps[1].action, Some(StepAction::PasteAndVerify)));
        } else {
            panic!("expected guided_steps");
        }
    }

    #[test]
    fn trust_tier_defaults_to_curated() {
        let yaml = r#"
schema_version: "1.0"
catalog_ref: x
display_name: X
service:
  name: X
verification_recipe:
  kind: secret_present
  key: X
remediation:
  kind: external_only
"#;
        let entry: CatalogEntry = serde_yaml_ng::from_str(yaml).unwrap();
        assert_eq!(entry.service.trust_tier, TrustTier::Curated);
    }

    /// Load the real repository catalog (`<repo>/catalog/`) and verify every
    /// entry parses to a real schema. Catches typos / drift in the YAML before
    /// they reach a release. The path is computed from CARGO_MANIFEST_DIR so
    /// this works in any checkout.
    #[test]
    fn repo_catalog_loads_all_thirteen_entries() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let catalog_dir = std::path::Path::new(manifest_dir)
            .parent()
            .expect("src-tauri has a parent")
            .join("catalog");
        let cat = Catalog::load_from_dir(&catalog_dir)
            .expect("repo catalog must load cleanly");
        assert_eq!(
            cat.len(),
            13,
            "expected 13 catalog entries (4 LLM + 4 system + 5 service), found {}",
            cat.len()
        );

        // Spot-check the must-have entries by catalog_ref.
        for required_ref in &[
            "anthropic.api_key",
            "openai.api_key",
            "gemini.api_key",
            "openrouter.api_key",
            "system.node.20",
            "system.pnpm",
            "system.git",
            "system.docker",
            "supabase.anon_key",
            "stripe.api_key.secret",
            "stripe.webhook.signing_secret",
            "resend.api_key",
            "google_oauth.client_id",
        ] {
            assert!(
                cat.get(required_ref).is_some(),
                "missing required catalog entry: {}",
                required_ref
            );
        }
    }

    #[test]
    fn every_repo_entry_has_a_real_verification_kind() {
        // No catalog entry may use Verification::Unsupported — that's the
        // forward-compat catch-all, not something to ship.
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let catalog_dir = std::path::Path::new(manifest_dir)
            .parent()
            .unwrap()
            .join("catalog");
        let cat = Catalog::load_from_dir(&catalog_dir).unwrap();
        for (cref, entry) in cat.iter() {
            assert!(
                !matches!(entry.verification_recipe, Verification::Unsupported),
                "{} has Verification::Unsupported — fix the YAML",
                cref
            );
        }
    }

    #[test]
    fn every_repo_entry_has_a_real_remediation_kind() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let catalog_dir = std::path::Path::new(manifest_dir)
            .parent()
            .unwrap()
            .join("catalog");
        let cat = Catalog::load_from_dir(&catalog_dir).unwrap();
        for (cref, entry) in cat.iter() {
            assert!(
                !matches!(entry.remediation, Remediation::Unsupported),
                "{} has Remediation::Unsupported — fix the YAML",
                cref
            );
        }
    }

    #[test]
    fn every_value_validation_regex_compiles() {
        // A broken regex won't be caught by serde — only by use. Verify each.
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let catalog_dir = std::path::Path::new(manifest_dir)
            .parent()
            .unwrap()
            .join("catalog");
        let cat = Catalog::load_from_dir(&catalog_dir).unwrap();
        for (cref, entry) in cat.iter() {
            if let Some(ValueValidation::Regex { pattern, .. }) = &entry.value_validation {
                regex::Regex::new(pattern)
                    .unwrap_or_else(|e| panic!("invalid regex in {}: {} ({})", cref, pattern, e));
            }
        }
    }

    #[test]
    fn last_verified_field_round_trips() {
        let yaml = r#"
schema_version: "1.0"
catalog_ref: x
display_name: X
service:
  name: X
  last_verified: "2026-05-09"
verification_recipe:
  kind: secret_present
  key: X
remediation:
  kind: external_only
"#;
        let entry: CatalogEntry = serde_yaml_ng::from_str(yaml).unwrap();
        assert_eq!(entry.service.last_verified.as_deref(), Some("2026-05-09"));
    }
}
