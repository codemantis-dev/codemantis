// PF-001..PF-004 audit rules — validate that a SpecWriter bundle's manifest
// and sessions agree with each other. Pure logic, no I/O.
//
// PF-001: Every capability ID referenced in any session's `requires:` array
//         must be defined in preflight.yaml.
// PF-002: Every capability in preflight.yaml must be referenced in at least
//         one session's `requires:`. (Else it's dead weight.)
// PF-003: Every capability with `blocks_self_drive: true` must have a
//         non-null `verification` block (i.e. not Verification::Unsupported).
// PF-004: No session body may mention a known service name without a
//         corresponding `requires:` entry. (Light keyword scan against the
//         catalog's known service names — not exhaustive, just a tripwire.)
//
// A spec failing any rule does not ship to Self-Drive — SpecWriter must fix
// it first. Lifts the existing "specs decide, audits verify" principle out
// of the codebase and into the world outside it.

#![allow(dead_code)]

use crate::preflight::manifest::{Manifest, Verification};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditFinding {
    pub rule: String,
    pub session_index: Option<u32>,
    pub capability_id: Option<String>,
    pub message: String,
}

/// Minimal session shape consumed by the auditor — keeps this module
/// independent of any larger Guide/Session type.
#[derive(Debug, Clone)]
pub struct AuditSession<'a> {
    pub index: u32,
    pub body: &'a str,
    pub requires: &'a [String],
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditReport {
    pub findings: Vec<AuditFinding>,
}

impl AuditReport {
    pub fn is_clean(&self) -> bool {
        self.findings.is_empty()
    }
}

/// Run every rule against the bundle. Returns an empty report when the
/// bundle is clean.
pub fn audit(
    manifest: &Manifest,
    sessions: &[AuditSession<'_>],
    known_service_names: &[&str],
) -> AuditReport {
    let mut findings = Vec::new();
    findings.extend(rule_pf_001(manifest, sessions));
    findings.extend(rule_pf_002(manifest, sessions));
    findings.extend(rule_pf_003(manifest));
    findings.extend(rule_pf_004(sessions, known_service_names));
    AuditReport { findings }
}

/// PF-001: every required capability is defined.
fn rule_pf_001(manifest: &Manifest, sessions: &[AuditSession<'_>]) -> Vec<AuditFinding> {
    let defined: HashSet<&str> = manifest.capabilities.iter().map(|c| c.id.as_str()).collect();
    let mut findings = Vec::new();
    for s in sessions {
        for req in s.requires {
            if !defined.contains(req.as_str()) {
                findings.push(AuditFinding {
                    rule: "PF-001".into(),
                    session_index: Some(s.index),
                    capability_id: Some(req.clone()),
                    message: format!(
                        "Session {} requires capability `{}` which is not defined in preflight.yaml",
                        s.index, req
                    ),
                });
            }
        }
    }
    findings
}

/// PF-002: every defined capability is required somewhere.
fn rule_pf_002(manifest: &Manifest, sessions: &[AuditSession<'_>]) -> Vec<AuditFinding> {
    let mut required: HashSet<&str> = HashSet::new();
    for s in sessions {
        for r in s.requires {
            required.insert(r.as_str());
        }
    }
    let mut findings = Vec::new();
    for cap in &manifest.capabilities {
        if !required.contains(cap.id.as_str()) {
            findings.push(AuditFinding {
                rule: "PF-002".into(),
                session_index: None,
                capability_id: Some(cap.id.clone()),
                message: format!(
                    "Capability `{}` is defined in preflight.yaml but no session requires it (dead weight)",
                    cap.id
                ),
            });
        }
    }
    findings
}

/// PF-003: blocking capabilities have a real verification kind.
fn rule_pf_003(manifest: &Manifest) -> Vec<AuditFinding> {
    let mut findings = Vec::new();
    for cap in &manifest.capabilities {
        if !cap.blocks_self_drive {
            continue;
        }
        if matches!(cap.verification, Verification::Unsupported) {
            findings.push(AuditFinding {
                rule: "PF-003".into(),
                session_index: None,
                capability_id: Some(cap.id.clone()),
                message: format!(
                    "Capability `{}` has blocks_self_drive=true but no real verification kind",
                    cap.id
                ),
            });
        }
    }
    findings
}

/// PF-004: session body mentions a known service name without `requires:`.
/// Tripwire only — uses simple substring match (case-insensitive). False
/// positives are accepted in exchange for catching the common drift.
fn rule_pf_004(
    sessions: &[AuditSession<'_>],
    known_service_names: &[&str],
) -> Vec<AuditFinding> {
    let mut findings = Vec::new();
    for s in sessions {
        let lower_body = s.body.to_lowercase();
        let lower_required: Vec<String> = s.requires.iter().map(|r| r.to_lowercase()).collect();
        for &service in known_service_names {
            let needle = service.to_lowercase();
            if !lower_body.contains(&needle) {
                continue;
            }
            // If any `requires:` entry mentions the service name, we consider
            // the dependency declared.
            if lower_required.iter().any(|r| r.contains(&needle)) {
                continue;
            }
            findings.push(AuditFinding {
                rule: "PF-004".into(),
                session_index: Some(s.index),
                capability_id: None,
                message: format!(
                    "Session {} mentions `{}` but no `requires:` entry references it",
                    s.index, service
                ),
            });
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preflight::manifest::{Capability, Category, DetectionHints, Verification};
    use std::collections::HashMap;

    fn cap(id: &str, blocks: bool, verification: Verification) -> Capability {
        Capability {
            id: id.into(),
            catalog_ref: "x".into(),
            name: id.into(),
            category: Category::GuidedHuman,
            purpose: None,
            sessions_requiring: vec![],
            storage: None,
            verification,
            value_validation: None,
            required: true,
            blocks_self_drive: blocks,
            detection_hints: DetectionHints::default(),
        }
    }

    fn manifest(caps: Vec<Capability>) -> Manifest {
        Manifest {
            schema_version: "1.0".into(),
            project: "test".into(),
            generated_by: None,
            generated_at: None,
            capabilities: caps,
        }
    }

    fn ok_verification() -> Verification {
        Verification::SecretPresent { key: "k".into() }
    }

    fn api_verification() -> Verification {
        Verification::ApiProbe {
            method: "GET".into(),
            url: "https://x".into(),
            auth: None,
            extra_headers: HashMap::new(),
            success_when: None,
            timeout_ms: 5000,
        }
    }

    fn session(idx: u32, body: &'static str, requires: &'static [&'static str]) -> AuditSession<'static> {
        // Box::leak the converted Vec so we can return refs that borrow from
        // 'static memory — safe because tests are short-lived.
        let owned: Vec<String> = requires.iter().map(|s| s.to_string()).collect();
        let leaked: &'static [String] = Box::leak(owned.into_boxed_slice());
        AuditSession { index: idx, body, requires: leaked }
    }

    #[test]
    fn clean_bundle_produces_no_findings() {
        let m = manifest(vec![cap("CAP-A", true, api_verification())]);
        let s = vec![session(1, "Use CAP-A here.", &["CAP-A"])];
        let report = audit(&m, &s, &[]);
        assert!(report.is_clean(), "got findings: {:?}", report.findings);
    }

    #[test]
    fn pf_001_flags_undefined_capability() {
        let m = manifest(vec![cap("CAP-A", true, api_verification())]);
        let s = vec![session(2, "uses CAP-NOT-DEFINED", &["CAP-NOT-DEFINED"])];
        let report = audit(&m, &s, &[]);
        let pf001: Vec<_> = report.findings.iter().filter(|f| f.rule == "PF-001").collect();
        assert_eq!(pf001.len(), 1);
        assert_eq!(pf001[0].session_index, Some(2));
        assert_eq!(pf001[0].capability_id.as_deref(), Some("CAP-NOT-DEFINED"));
    }

    #[test]
    fn pf_002_flags_dead_weight_capability() {
        let m = manifest(vec![
            cap("CAP-USED", true, api_verification()),
            cap("CAP-DEAD", true, api_verification()),
        ]);
        let s = vec![session(1, "uses CAP-USED", &["CAP-USED"])];
        let report = audit(&m, &s, &[]);
        let pf002: Vec<_> = report.findings.iter().filter(|f| f.rule == "PF-002").collect();
        assert_eq!(pf002.len(), 1);
        assert_eq!(pf002[0].capability_id.as_deref(), Some("CAP-DEAD"));
    }

    #[test]
    fn pf_003_flags_blocking_unsupported_verification() {
        let m = manifest(vec![cap("CAP-X", true, Verification::Unsupported)]);
        let s = vec![session(1, "x", &["CAP-X"])];
        let report = audit(&m, &s, &[]);
        let pf003: Vec<_> = report.findings.iter().filter(|f| f.rule == "PF-003").collect();
        assert_eq!(pf003.len(), 1);
    }

    #[test]
    fn pf_003_passes_for_non_blocking_unsupported() {
        // Optional capabilities can have unsupported verification — SpecWriter
        // can include them as informational without blocking.
        let mut c = cap("CAP-X", false, Verification::Unsupported);
        c.required = false;
        let m = manifest(vec![c]);
        let s = vec![session(1, "x", &["CAP-X"])];
        let report = audit(&m, &s, &[]);
        let pf003: Vec<_> = report.findings.iter().filter(|f| f.rule == "PF-003").collect();
        assert!(pf003.is_empty());
    }

    #[test]
    fn pf_004_flags_undeclared_service_mention() {
        let m = manifest(vec![cap("CAP-X", true, api_verification())]);
        let s = vec![session(1, "We integrate Stripe for payments.", &["CAP-X"])];
        let report = audit(&m, &s, &["Stripe"]);
        let pf004: Vec<_> = report.findings.iter().filter(|f| f.rule == "PF-004").collect();
        assert_eq!(pf004.len(), 1);
    }

    #[test]
    fn pf_004_quiet_when_requires_mentions_service() {
        let m = manifest(vec![cap(
            "stripe.api_key.secret",
            true,
            api_verification(),
        )]);
        let s = vec![session(
            1,
            "We integrate Stripe for payments.",
            &["stripe.api_key.secret"],
        )];
        let report = audit(&m, &s, &["Stripe"]);
        let pf004: Vec<_> = report.findings.iter().filter(|f| f.rule == "PF-004").collect();
        assert!(pf004.is_empty(), "got: {:?}", report.findings);
    }

    #[test]
    fn pf_004_case_insensitive() {
        let m = manifest(vec![cap("CAP-X", true, api_verification())]);
        let s = vec![session(1, "Talks to STRIPE.", &["CAP-X"])];
        let report = audit(&m, &s, &["Stripe"]);
        let pf004: Vec<_> = report.findings.iter().filter(|f| f.rule == "PF-004").collect();
        assert_eq!(pf004.len(), 1);
    }

    #[test]
    fn audit_aggregates_multiple_rule_violations() {
        let m = manifest(vec![
            cap("CAP-DEAD", true, api_verification()),
            cap("CAP-NO-VERIFY", true, Verification::Unsupported),
        ]);
        let s = vec![session(1, "Mentions Stripe.", &["CAP-UNKNOWN"])];
        let report = audit(&m, &s, &["Stripe"]);
        // PF-001 (CAP-UNKNOWN), PF-002 (CAP-DEAD + CAP-NO-VERIFY both unused),
        // PF-003 (CAP-NO-VERIFY), PF-004 (Stripe mentioned but not required).
        let by_rule: std::collections::HashMap<&str, usize> =
            report.findings.iter().fold(HashMap::new(), |mut m, f| {
                *m.entry(f.rule.as_str()).or_insert(0) += 1;
                m
            });
        assert_eq!(by_rule.get("PF-001").copied().unwrap_or(0), 1);
        assert!(by_rule.get("PF-002").copied().unwrap_or(0) >= 1);
        assert_eq!(by_rule.get("PF-003").copied().unwrap_or(0), 1);
        assert_eq!(by_rule.get("PF-004").copied().unwrap_or(0), 1);
    }
}
