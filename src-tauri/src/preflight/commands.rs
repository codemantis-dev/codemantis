// Tauri command surface for the Preflight System.
//
// Seven commands cover the lifecycle:
//   - load_manifest          → parse `preflight.yaml` for a project
//   - status                 → cached state from SQLite (instant render)
//   - verify_all / verify_one → run probes, persist results, emit events
//   - store_secret           → encrypt + persist a project secret
//   - run_auto_install       → execute an automated remediation
//   - detect_existing        → scan for pre-existing credentials
//
// All commands take `project_id` (the stable identifier derived from the
// project's absolute path) and emit events via `events.rs`.

#![allow(dead_code)]

use crate::agents::claude_code::session::AppState;
use crate::commands::settings::get_settings;
use crate::preflight::{
    catalog::Catalog,
    detection,
    events,
    extraction::{self, ExtractionRequest, ExtractionResult},
    installer::{self, InstallResult},
    manifest::{Capability, Manifest, Verification},
    secrets,
    status::{self, CapabilityState, CapabilityStatus, DetectionHit, PreflightStatus},
    verification,
};
use chrono::Utc;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

const MANIFEST_FILE: &str = "preflight.yaml";

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn load_manifest_from_project(project_path: &str) -> Result<Manifest, String> {
    let path = PathBuf::from(project_path).join(MANIFEST_FILE);
    if !path.exists() {
        return Err(format!("No preflight.yaml at {}", path.display()));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Manifest::from_yaml(&text).map_err(|e| e.to_string())
}

/// Resolve the bundled catalog from the Tauri resource directory.
fn load_catalog(app: &AppHandle) -> Result<Catalog, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {}", e))?;
    let catalog_dir = resource_dir.join("catalog");
    Catalog::load_from_dir(&catalog_dir).map_err(|e| e.to_string())
}

/// Best-effort secret retrieval: project-scoped slot first, then global
/// settings (LLM provider keys keyed by `capability_id`). Returns None if
/// no secret is stored anywhere — caller decides what that means.
fn lookup_secret(project_id: &str, capability_id: &str) -> Option<String> {
    if let Ok(Some(s)) = secrets::read(project_id, capability_id) {
        return Some(s);
    }
    if let Ok(settings) = get_settings() {
        if let Some(v) = settings.api_keys.get(capability_id) {
            if !v.is_empty() {
                return Some(v.clone());
            }
        }
    }
    None
}

#[tauri::command]
pub async fn preflight_load_manifest(project_path: String) -> Result<Manifest, String> {
    load_manifest_from_project(&project_path)
}

#[tauri::command]
pub async fn preflight_status(
    project_path: String,
    state: State<'_, AppState>,
) -> Result<PreflightStatus, String> {
    let manifest = load_manifest_from_project(&project_path);
    let cached = status::list_for_project(&state.database, &project_path)
        .map_err(|e| e.to_string())?;

    let (blocking_count, optional_count) = match &manifest {
        Ok(m) => {
            let blocking = m
                .capabilities
                .iter()
                .filter(|c| c.blocks_self_drive && c.required)
                .count();
            let optional = m.capabilities.iter().filter(|c| !c.required).count();
            (blocking as u32, optional as u32)
        }
        Err(_) => (0, 0),
    };

    let all_satisfied = match &manifest {
        Ok(m) if !m.capabilities.is_empty() => m.capabilities.iter().all(|c| {
            cached
                .iter()
                .find(|s| s.capability_id == c.id)
                .map(|s| {
                    s.state == CapabilityState::Satisfied
                        || (!c.blocks_self_drive && !c.required)
                        || s.user_acknowledged_optional_skip
                })
                .unwrap_or(false)
        }),
        _ => true, // no manifest = nothing to gate on (legacy projects)
    };

    Ok(PreflightStatus {
        project_id: project_path,
        all_satisfied,
        blocking_count,
        optional_count,
        capabilities: cached,
    })
}

async fn verify_capability(
    project_id: &str,
    cap: &Capability,
) -> CapabilityStatus {
    let secret = lookup_secret(project_id, &cap.id);
    let outcome = verification::check(
        &cap.verification,
        secret.as_deref(),
        cap.value_validation.as_ref(),
    )
    .await;

    let (state, message, error) = match outcome {
        verification::VerifyOutcome::Satisfied { message } => {
            (CapabilityState::Satisfied, message, None)
        }
        verification::VerifyOutcome::Missing { reason } => {
            (CapabilityState::Missing, Some(reason), None)
        }
        verification::VerifyOutcome::Error { error } => {
            (CapabilityState::Missing, None, Some(error))
        }
    };

    CapabilityStatus {
        project_id: project_id.into(),
        capability_id: cap.id.clone(),
        catalog_ref: Some(cap.catalog_ref.clone()),
        state,
        last_checked: now_ms(),
        message,
        error,
        detection_source: None,
        user_acknowledged_optional_skip: false,
    }
}

#[tauri::command]
pub async fn preflight_verify_one(
    project_path: String,
    capability_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CapabilityStatus, String> {
    let manifest = load_manifest_from_project(&project_path)?;
    let Some(cap) = manifest
        .capabilities
        .iter()
        .find(|c| c.id == capability_id)
    else {
        return Err(format!("Capability {} not in manifest", capability_id));
    };
    events::emit_verification_started(&app, &project_path, &capability_id);
    let cap_status = verify_capability(&project_path, cap).await;
    let _ = status::upsert(&state.database, &cap_status);
    events::emit_verification_complete(&app, &cap_status);
    Ok(cap_status)
}

/// Persist `user_acknowledged_optional_skip = true` for a capability. Testable
/// core of `preflight_acknowledge_skip` (no AppHandle / event emission). Errors
/// if the capability id isn't declared in the manifest.
fn apply_acknowledge_skip(
    db: &crate::storage::Database,
    manifest: &Manifest,
    project_path: &str,
    capability_id: &str,
) -> Result<CapabilityStatus, String> {
    let Some(cap) = manifest.capabilities.iter().find(|c| c.id == capability_id) else {
        return Err(format!("Capability {} not in manifest", capability_id));
    };

    // Update the existing row, or synthesize one if the capability was never
    // probed yet (skip-before-verify is valid — the user is opting out).
    let mut row = status::get(db, project_path, capability_id)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| CapabilityStatus {
            project_id: project_path.to_string(),
            capability_id: capability_id.to_string(),
            catalog_ref: Some(cap.catalog_ref.clone()),
            state: CapabilityState::Missing,
            last_checked: now_ms(),
            message: None,
            error: None,
            detection_source: None,
            user_acknowledged_optional_skip: false,
        });
    row.user_acknowledged_optional_skip = true;
    status::upsert(db, &row).map_err(|e| e.to_string())?;
    Ok(row)
}

/// Mark a capability as user-acknowledged-skip so it stops blocking Self-Drive.
/// Persists `user_acknowledged_optional_skip = true` for the capability and
/// emits a status-change event so Mission Control + the tray update. Errors if
/// the project has no manifest or the capability id isn't declared in it.
#[tauri::command]
pub async fn preflight_acknowledge_skip(
    project_path: String,
    capability_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CapabilityStatus, String> {
    let manifest = load_manifest_from_project(&project_path)?;
    let row = apply_acknowledge_skip(&state.database, &manifest, &project_path, &capability_id)?;
    events::emit_verification_complete(&app, &row);
    Ok(row)
}

#[tauri::command]
pub async fn preflight_verify_all(
    project_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<CapabilityStatus>, String> {
    let manifest = load_manifest_from_project(&project_path)?;

    // Emit started events synchronously so the UI shows "checking…" badges
    // for every capability before any HTTP probe returns.
    for cap in &manifest.capabilities {
        events::emit_verification_started(&app, &project_path, &cap.id);
    }

    // Run all probes concurrently. Each is independent (no shared mutable
    // state, no ordering requirement), so this is safe for the four kinds
    // we ship in Phase 2.
    let project_id = project_path.clone();
    let probes = manifest.capabilities.iter().map(|cap| {
        let pid = project_id.clone();
        async move { verify_capability(&pid, cap).await }
    });
    let results = futures::future::join_all(probes).await;

    for cap_status in &results {
        let _ = status::upsert(&state.database, cap_status);
        events::emit_verification_complete(&app, cap_status);
    }

    // Emit aggregate completion.
    let summary = preflight_status(project_path.clone(), state).await?;
    events::emit_all_complete(&app, &project_path, &summary);
    Ok(results)
}

#[tauri::command]
pub async fn preflight_store_secret(
    project_path: String,
    capability_id: String,
    value: String,
) -> Result<(), String> {
    secrets::write(&project_path, &capability_id, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preflight_run_auto_install(
    project_path: String,
    capability_id: String,
    app: AppHandle,
) -> Result<InstallResult, String> {
    let manifest = load_manifest_from_project(&project_path)?;
    let Some(cap) = manifest.capabilities.iter().find(|c| c.id == capability_id) else {
        return Err(format!("Capability {} not in manifest", capability_id));
    };
    let catalog = load_catalog(&app)?;
    let Some(entry) = catalog.get(&cap.catalog_ref) else {
        return Err(format!(
            "Catalog entry {} not found",
            cap.catalog_ref
        ));
    };
    let app_clone = app.clone();
    let project_id = project_path.clone();
    let cap_id = capability_id.clone();
    installer::run(&entry.remediation, move |progress| {
        events::emit_installer_progress(
            &app_clone,
            &project_id,
            &cap_id,
            progress.line,
            progress.stream,
        );
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preflight_detect_existing(
    project_path: String,
    app: AppHandle,
) -> Result<Vec<DetectionHit>, String> {
    let manifest = load_manifest_from_project(&project_path)?;
    let hits = detection::scan(&manifest, &project_path);
    for hit in &hits {
        events::emit_detection_hit(&app, &project_path, hit);
    }
    Ok(hits)
}

// Silence "unused" warnings on unused imports until Phase 3 wires more callers.
const _: fn(&Verification) = |_| {};

/// Generate a `preflight.yaml` from a SpecWriter-saved spec by asking the
/// same LLM that authored the spec what external services and tools the
/// project needs. Resolves against the bundled catalog; unknown services
/// are surfaced for the user to handle manually.
///
/// **Idempotent on disk:** overwrites any existing `preflight.yaml` at the
/// project root. Returns the parsed result so the frontend can update its
/// guide-store sessions with the new `requires:` arrays.
#[tauri::command]
pub async fn preflight_generate_manifest(
    app: AppHandle,
    request: ExtractionRequest,
) -> Result<ExtractionResult, String> {
    // Resolve the API key for the requested provider from settings.
    let settings = get_settings()?;
    let api_key = settings
        .api_keys
        .get(&request.ai_provider)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            format!(
                "No API key configured for `{}`. Add it in Settings → AI Providers.",
                request.ai_provider
            )
        })?;

    // Run the LLM extraction.
    let (extracted, in_tok, out_tok) = extraction::extract(&request, &api_key)
        .await
        .map_err(|e| e.to_string())?;

    // Resolve against the bundled catalog.
    let catalog = load_catalog(&app)?;
    let mut result = extraction::build_manifest(
        &request,
        &extracted,
        &catalog,
        &format!("CodeMantis SpecWriter ({}/{})", request.ai_provider, request.ai_model),
    );
    result.input_tokens = in_tok;
    result.output_tokens = out_tok;

    // Write preflight.yaml to the project root.
    let yaml = extraction::manifest_to_yaml(&result.manifest).map_err(|e| e.to_string())?;
    let path = PathBuf::from(&request.project_path).join(MANIFEST_FILE);
    std::fs::write(&path, yaml).map_err(|e| {
        format!("Failed to write {}: {}", path.display(), e)
    })?;
    log::info!(
        "[preflight] wrote {} ({} capabilities, {} unresolved)",
        path.display(),
        result.manifest.capabilities.len(),
        result.unresolved_refs.len()
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use tempfile::tempdir;

    fn fresh_db() -> (Database, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        (db, dir)
    }

    fn manifest_with(cap_id: &str) -> Manifest {
        let json = format!(
            r#"{{
                "schema_version": "1.0",
                "project": "p",
                "capabilities": [{{
                    "id": "{cap_id}",
                    "catalog_ref": "x.ref",
                    "name": "X",
                    "category": "guided_human",
                    "sessions_requiring": [],
                    "verification": {{ "kind": "secret_present", "key": "{cap_id}" }},
                    "required": false,
                    "blocks_self_drive": false
                }}]
            }}"#
        );
        Manifest::from_yaml(&json).unwrap()
    }

    #[test]
    fn apply_acknowledge_skip_persists_flag() {
        let (db, _dir) = fresh_db();
        let manifest = manifest_with("analytics");

        let row = apply_acknowledge_skip(&db, &manifest, "/p", "analytics").unwrap();
        assert!(row.user_acknowledged_optional_skip);

        // Round-trips through SQLite.
        let stored = status::get(&db, "/p", "analytics").unwrap().unwrap();
        assert!(stored.user_acknowledged_optional_skip);
    }

    #[test]
    fn apply_acknowledge_skip_errors_for_unknown_capability() {
        let (db, _dir) = fresh_db();
        let manifest = manifest_with("analytics");

        let err = apply_acknowledge_skip(&db, &manifest, "/p", "nope").unwrap_err();
        assert!(err.contains("not in manifest"), "unexpected error: {err}");
    }

    #[test]
    fn apply_acknowledge_skip_preserves_existing_state() {
        let (db, _dir) = fresh_db();
        let manifest = manifest_with("analytics");

        // Pre-existing "missing" row — skip must flip the flag, not the state.
        status::upsert(
            &db,
            &CapabilityStatus {
                project_id: "/p".into(),
                capability_id: "analytics".into(),
                catalog_ref: Some("x.ref".into()),
                state: CapabilityState::Missing,
                last_checked: 1,
                message: None,
                error: None,
                detection_source: None,
                user_acknowledged_optional_skip: false,
            },
        )
        .unwrap();

        let row = apply_acknowledge_skip(&db, &manifest, "/p", "analytics").unwrap();
        assert!(row.user_acknowledged_optional_skip);
        assert_eq!(row.state, CapabilityState::Missing);
    }
}
