// Detection scanner — finds pre-existing credentials the user might already
// have, so they can confirm-and-use rather than re-entering them.
//
// Phase 2 sources:
//   - process env vars listed in the capability's detection_hints
//   - already-stored slots in preflight_secrets.json
//
// File-based scanning (`~/.zshrc`, project `.env`, etc.) is Phase 5.
//
// **Critical:** detection only notes that a value is *present*. It never
// reads the value's content into memory or stores it. The user must
// explicitly confirm before CodeMantis pulls the value into its store.

#![allow(dead_code)] // Phase 2 wires this into Tauri commands.

use crate::preflight::manifest::{Capability, Category, Manifest};
use crate::preflight::secrets;
use crate::preflight::status::DetectionHit;

const SOURCE_ENV: &str = "env_var";
const SOURCE_STORE: &str = "secret_store";

/// Walk the manifest and return one DetectionHit per pre-existing capability
/// where a candidate credential was found. Capabilities with no hits are
/// not returned.
pub fn scan(manifest: &Manifest, project_id: &str) -> Vec<DetectionHit> {
    let mut hits = Vec::new();
    for cap in &manifest.capabilities {
        if cap.category != Category::PreExistingDetection {
            continue;
        }
        if let Some(hit) = scan_one(cap, project_id) {
            hits.push(hit);
        }
    }
    hits
}

fn scan_one(cap: &Capability, project_id: &str) -> Option<DetectionHit> {
    // 1. Already in our own secret store (highest confidence).
    if matches!(secrets::is_present(project_id, &cap.id), Ok(true)) {
        return Some(DetectionHit {
            capability_id: cap.id.clone(),
            source: SOURCE_STORE.into(),
            confidence: 1.0,
            suggestion: Some("Already saved for this project".into()),
        });
    }

    // 2. Listed env var on the user's shell (medium confidence — we don't
    //    read its value, just observe presence).
    for var_name in &cap.detection_hints.env_vars {
        if let Ok(value) = std::env::var(var_name) {
            if !value.is_empty() {
                return Some(DetectionHit {
                    capability_id: cap.id.clone(),
                    source: SOURCE_ENV.into(),
                    confidence: 0.85,
                    suggestion: Some(format!(
                        "${} is set on your system",
                        var_name
                    )),
                });
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preflight::manifest::{Capability, Category, DetectionHints, Verification};

    fn cap(id: &str, env_var: Option<&str>) -> Capability {
        Capability {
            id: id.into(),
            catalog_ref: "x".into(),
            name: id.into(),
            category: Category::PreExistingDetection,
            purpose: None,
            sessions_requiring: vec![],
            storage: None,
            verification: Verification::SecretPresent { key: id.into() },
            value_validation: None,
            required: true,
            blocks_self_drive: false,
            detection_hints: DetectionHints {
                env_vars: env_var.map(|s| vec![s.into()]).unwrap_or_default(),
            },
        }
    }

    fn manifest_with(caps: Vec<Capability>) -> Manifest {
        Manifest {
            schema_version: "1.0".into(),
            project: "test".into(),
            generated_by: None,
            generated_at: None,
            capabilities: caps,
        }
    }

    #[test]
    fn skips_capabilities_that_arent_pre_existing_detection() {
        let mut c = cap("X", Some("PATH")); // PATH is always set
        c.category = Category::GuidedHuman;
        let m = manifest_with(vec![c]);
        let hits = scan(&m, "p");
        assert!(hits.is_empty());
    }

    #[test]
    fn returns_no_hit_when_env_var_is_unset() {
        let var = "CODEMANTIS_DETECT_TEST_ABSENT_777";
        std::env::remove_var(var);
        let m = manifest_with(vec![cap("CAP-A", Some(var))]);
        let hits = scan(&m, "p");
        assert!(hits.is_empty());
    }

    #[test]
    fn returns_env_var_hit_when_set() {
        let var = "CODEMANTIS_DETECT_TEST_PRESENT";
        std::env::set_var(var, "something");
        let m = manifest_with(vec![cap("CAP-B", Some(var))]);
        let hits = scan(&m, "p");
        std::env::remove_var(var);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].capability_id, "CAP-B");
        assert_eq!(hits[0].source, SOURCE_ENV);
        assert!(hits[0].confidence > 0.5);
    }

    #[test]
    fn empty_env_var_does_not_hit() {
        let var = "CODEMANTIS_DETECT_TEST_EMPTY";
        std::env::set_var(var, "");
        let m = manifest_with(vec![cap("CAP-C", Some(var))]);
        let hits = scan(&m, "p");
        std::env::remove_var(var);
        assert!(hits.is_empty());
    }

    #[test]
    fn capability_without_hints_returns_no_hit() {
        let m = manifest_with(vec![cap("CAP-D", None)]);
        let hits = scan(&m, "p");
        assert!(hits.is_empty());
    }
}
