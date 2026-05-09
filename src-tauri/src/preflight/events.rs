// Tauri event names + payload types emitted by the preflight module.
// Keep names stable — the frontend store subscribes to these strings.

#![allow(dead_code)]

use crate::preflight::installer::ProgressStream;
use crate::preflight::status::{CapabilityStatus, DetectionHit, PreflightStatus};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const EVENT_VERIFICATION_STARTED: &str = "preflight:verification_started";
pub const EVENT_VERIFICATION_COMPLETE: &str = "preflight:verification_complete";
pub const EVENT_ALL_COMPLETE: &str = "preflight:all_complete";
pub const EVENT_INSTALLER_PROGRESS: &str = "preflight:installer_progress";
pub const EVENT_DETECTION_HIT: &str = "preflight:detection_hit";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationStartedPayload {
    pub project_id: String,
    pub capability_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCompletePayload {
    pub project_id: String,
    pub capability_id: String,
    pub status: CapabilityStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllCompletePayload {
    pub project_id: String,
    pub status: PreflightStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerProgressPayload {
    pub project_id: String,
    pub capability_id: String,
    pub line: String,
    pub stream: ProgressStream,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionHitPayload {
    pub project_id: String,
    pub hit: DetectionHit,
}

pub fn emit_verification_started(app: &AppHandle, project_id: &str, capability_id: &str) {
    let _ = app.emit(
        EVENT_VERIFICATION_STARTED,
        VerificationStartedPayload {
            project_id: project_id.into(),
            capability_id: capability_id.into(),
        },
    );
}

pub fn emit_verification_complete(app: &AppHandle, status: &CapabilityStatus) {
    let _ = app.emit(
        EVENT_VERIFICATION_COMPLETE,
        VerificationCompletePayload {
            project_id: status.project_id.clone(),
            capability_id: status.capability_id.clone(),
            status: status.clone(),
        },
    );
}

pub fn emit_all_complete(app: &AppHandle, project_id: &str, status: &PreflightStatus) {
    let _ = app.emit(
        EVENT_ALL_COMPLETE,
        AllCompletePayload {
            project_id: project_id.into(),
            status: status.clone(),
        },
    );
}

pub fn emit_installer_progress(
    app: &AppHandle,
    project_id: &str,
    capability_id: &str,
    line: String,
    stream: ProgressStream,
) {
    let _ = app.emit(
        EVENT_INSTALLER_PROGRESS,
        InstallerProgressPayload {
            project_id: project_id.into(),
            capability_id: capability_id.into(),
            line,
            stream,
        },
    );
}

pub fn emit_detection_hit(app: &AppHandle, project_id: &str, hit: &DetectionHit) {
    let _ = app.emit(
        EVENT_DETECTION_HIT,
        DetectionHitPayload {
            project_id: project_id.into(),
            hit: hit.clone(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_names_are_stable() {
        // These strings are part of the wire contract with the frontend store.
        // Changing one without updating the TS side would silently break UX.
        assert_eq!(EVENT_VERIFICATION_STARTED, "preflight:verification_started");
        assert_eq!(EVENT_VERIFICATION_COMPLETE, "preflight:verification_complete");
        assert_eq!(EVENT_ALL_COMPLETE, "preflight:all_complete");
        assert_eq!(EVENT_INSTALLER_PROGRESS, "preflight:installer_progress");
        assert_eq!(EVENT_DETECTION_HIT, "preflight:detection_hit");
    }

    #[test]
    fn payloads_serialize_with_camel_case() {
        let p = VerificationStartedPayload {
            project_id: "p".into(),
            capability_id: "c".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert!(v.get("projectId").is_some());
        assert!(v.get("capabilityId").is_some());
    }
}
