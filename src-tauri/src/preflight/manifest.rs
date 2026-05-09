// Preflight Manifest — `preflight.yaml` schema (v1.0).
//
// One manifest per spec bundle, enumerating every external precondition the
// project needs. The verification engine (Phase 2) consumes this; Mission
// Control (Phase 3) renders it; Self-Drive (Phase 4) gates against it.

#![allow(dead_code)] // Phase 2 wires these into commands; Phase 0 ships the schema.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Manifest {
    pub schema_version: String,
    pub project: String,
    #[serde(default)]
    pub generated_by: Option<String>,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<Capability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Capability {
    pub id: String,
    pub catalog_ref: String,
    pub name: String,
    pub category: Category,
    #[serde(default)]
    pub purpose: Option<String>,
    #[serde(default)]
    pub sessions_requiring: Vec<String>,
    #[serde(default)]
    pub storage: Option<Storage>,
    pub verification: Verification,
    #[serde(default)]
    pub value_validation: Option<ValueValidation>,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default = "default_true")]
    pub blocks_self_drive: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    AutoResolvable,
    GuidedHuman,
    PreExistingDetection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Storage {
    pub kind: StorageKind,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StorageKind {
    /// Encrypted-at-rest in CodeMantis (formerly named `keychain` in the spec
    /// before we settled on AES-GCM file-based encryption).
    SecretBox,
    EnvVar,
    ProjectEnvFile,
    TauriStore,
}

/// Verification recipe — how to check whether a capability is satisfied.
/// Phase 2 implements `ShellCommand`, `EnvVarPresent`, `SecretPresent`,
/// `ApiProbe`. Other variants are accepted for forward-compat; the engine
/// will return `Unsupported` until they're built.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Verification {
    ShellCommand {
        command: String,
        #[serde(default)]
        success_when: Option<String>,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },
    EnvVarPresent {
        var_name: String,
        #[serde(default)]
        value_validation: Option<ValueValidation>,
    },
    SecretPresent {
        key: String,
    },
    ApiProbe {
        #[serde(default = "default_get")]
        method: String,
        url: String,
        /// Auth scheme hint for the Phase 2 verifier. Recognised values:
        /// `bearer` (Authorization: Bearer …), `x_api_key` (x-api-key: …),
        /// `query_param:<name>` (?<name>=…). None = no auth header injected.
        #[serde(default)]
        auth: Option<String>,
        /// Verbatim headers added to the request (e.g. `anthropic-version`).
        #[serde(default)]
        extra_headers: HashMap<String, String>,
        #[serde(default)]
        success_when: Option<String>,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },
    /// Forward-compat catch-all for verification kinds not yet implemented.
    /// Deserialization preserves the raw payload so the catalog stays valid.
    #[serde(other)]
    Unsupported,
}

fn default_timeout() -> u64 {
    5000
}
fn default_get() -> String {
    "GET".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ValueValidation {
    Regex {
        pattern: String,
        #[serde(default)]
        hint: Option<String>,
        #[serde(default)]
        example_format: Option<String>,
    },
    /// Forward-compat for future validation kinds.
    #[serde(other)]
    Unsupported,
}

impl Manifest {
    /// Parse a manifest from YAML text. Accepts JSON too (YAML is a superset).
    pub fn from_yaml(text: &str) -> Result<Self, ManifestError> {
        serde_yaml_with_serde_json(text)
    }

    /// Index capabilities by id for quick lookup.
    pub fn index(&self) -> HashMap<&str, &Capability> {
        self.capabilities
            .iter()
            .map(|c| (c.id.as_str(), c))
            .collect()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("invalid manifest: {0}")]
    Parse(String),
}

/// We don't want a hard dependency on `serde_yaml` for Phase 0 (one more
/// crate to audit). YAML parsing arrives in Phase 1 alongside the catalog.
/// For now we accept JSON-format manifests — sufficient to validate the
/// schema with unit tests.
fn serde_yaml_with_serde_json(text: &str) -> Result<Manifest, ManifestError> {
    serde_json::from_str(text).map_err(|e| ManifestError::Parse(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_manifest() {
        let json = r#"{
            "schema_version": "1.0",
            "project": "test-app",
            "capabilities": []
        }"#;
        let m = Manifest::from_yaml(json).unwrap();
        assert_eq!(m.schema_version, "1.0");
        assert_eq!(m.project, "test-app");
        assert!(m.capabilities.is_empty());
    }

    #[test]
    fn parses_capability_with_api_probe() {
        let json = r#"{
            "schema_version": "1.0",
            "project": "atikon",
            "capabilities": [{
                "id": "PREFLIGHT-stripe-key",
                "catalog_ref": "stripe.api_key.secret",
                "name": "Stripe Secret",
                "category": "guided_human",
                "purpose": "Charges",
                "sessions_requiring": ["SESS-014"],
                "storage": {"kind": "secret_box", "key": "atikon.STRIPE_SECRET_KEY"},
                "verification": {
                    "kind": "api_probe",
                    "method": "GET",
                    "url": "https://api.stripe.com/v1/account",
                    "auth": "bearer",
                    "success_when": "status == 200",
                    "timeout_ms": 5000
                },
                "value_validation": {
                    "kind": "regex",
                    "pattern": "^sk_(test|live)_[A-Za-z0-9]{24,}$",
                    "hint": "Stripe secret keys start with sk_"
                },
                "required": true,
                "blocks_self_drive": true
            }]
        }"#;
        let m = Manifest::from_yaml(json).unwrap();
        assert_eq!(m.capabilities.len(), 1);
        let c = &m.capabilities[0];
        assert_eq!(c.id, "PREFLIGHT-stripe-key");
        assert_eq!(c.category, Category::GuidedHuman);
        assert!(matches!(c.verification, Verification::ApiProbe { .. }));
        assert!(c.required);
    }

    #[test]
    fn parses_shell_command_verification() {
        let json = r#"{
            "schema_version": "1.0", "project": "x",
            "capabilities": [{
                "id": "PREFLIGHT-node",
                "catalog_ref": "system.node.20",
                "name": "Node 20+",
                "category": "auto_resolvable",
                "verification": {
                    "kind": "shell_command",
                    "command": "node --version",
                    "success_when": "stdout matches '^v(2[0-9])'",
                    "timeout_ms": 3000
                }
            }]
        }"#;
        let m = Manifest::from_yaml(json).unwrap();
        match &m.capabilities[0].verification {
            Verification::ShellCommand { command, .. } => assert_eq!(command, "node --version"),
            _ => panic!("expected shell_command"),
        }
    }

    #[test]
    fn unknown_verification_kind_falls_back_to_unsupported() {
        // Forward-compat: a future kind we haven't built yet shouldn't break parsing.
        let json = r#"{
            "schema_version": "1.0", "project": "x",
            "capabilities": [{
                "id": "X",
                "catalog_ref": "x",
                "name": "X",
                "category": "guided_human",
                "verification": {"kind": "port_open", "port": 5432, "host": "localhost"}
            }]
        }"#;
        let m = Manifest::from_yaml(json).unwrap();
        assert!(matches!(
            m.capabilities[0].verification,
            Verification::Unsupported
        ));
    }

    #[test]
    fn defaults_for_required_and_blocks_self_drive_are_true() {
        // Spec: capabilities default to required+blocking unless explicitly opted out.
        let json = r#"{
            "schema_version": "1.0", "project": "x",
            "capabilities": [{
                "id": "X", "catalog_ref": "x", "name": "X",
                "category": "guided_human",
                "verification": {"kind": "secret_present", "key": "X"}
            }]
        }"#;
        let m = Manifest::from_yaml(json).unwrap();
        assert!(m.capabilities[0].required);
        assert!(m.capabilities[0].blocks_self_drive);
    }

    #[test]
    fn capability_index_lookups() {
        let json = r#"{
            "schema_version": "1.0", "project": "x",
            "capabilities": [
                {"id": "A", "catalog_ref": "a", "name": "A", "category": "guided_human",
                 "verification": {"kind": "secret_present", "key": "A"}},
                {"id": "B", "catalog_ref": "b", "name": "B", "category": "guided_human",
                 "verification": {"kind": "secret_present", "key": "B"}}
            ]
        }"#;
        let m = Manifest::from_yaml(json).unwrap();
        let idx = m.index();
        assert!(idx.contains_key("A"));
        assert!(idx.contains_key("B"));
        assert!(!idx.contains_key("C"));
    }

    #[test]
    fn invalid_manifest_returns_error() {
        let result = Manifest::from_yaml("{ this is not valid json");
        assert!(result.is_err());
    }
}
