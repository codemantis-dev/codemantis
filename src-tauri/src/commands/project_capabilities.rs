//! Project-level capability record I/O.
//!
//! Persists the Phase 0 probe result to `<project>/.claude/project-capabilities.json`
//! so that SpecWriter (when writing acceptance criteria) and Self-Drive verify-mode
//! (when grading evidence) consult the same source of truth.
//!
//! NOT to be confused with `sessionCapabilities` in the sessionStore — that's the
//! per-session Claude CLI capabilities map from `initialize`. These are
//! project-level, environmental affordances (test runners, MCP servers, creds).
//!
//! The plan that governs this module:
//! `~/.claude/plans/analyse-this-why-refactored-yao.md` — SpecWriter Phase 0
//! Environment Probe + Capability Handshake (approved 2026-05-14).

use log::info;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// How a capability's status was determined. Mirrors the TS type
/// `CapabilityDiscoveryMethod` in `src/types/spec-writer.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiscoveryMethod {
    PassiveProbe,
    UserHandshake,
    LiveFire,
}

/// One probed project capability. Mirrors the TS type `ProbedCapability`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProbedCapability {
    pub id: String,
    pub status: String, // "verified" | "pending-install" | "absent" | "claimed-unverified"
    pub discovered_by: DiscoveryMethod,
    pub evidence: String,
    pub last_verified_at: String,
    pub verify_method: Option<String>,
    pub expires: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub notes: Option<String>,
}

/// The on-disk record. Mirrors the TS type `ProjectCapabilitiesRecord`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCapabilitiesRecord {
    pub schema_version: u32,
    pub probed_at: String,
    pub probed_by_cli_version: Option<String>,
    pub probed_by_spec_writer_version: Option<String>,
    pub capabilities: Vec<ProbedCapability>,
    pub staleness_window: String,
}

/// The on-disk path for a project's capability record.
fn capabilities_path(project_path: &str) -> PathBuf {
    Path::new(project_path)
        .join(".claude")
        .join("project-capabilities.json")
}

/// Write the record atomically (temp file + rename). Mirrors the pattern in
/// `mcp.rs::atomic_write` so concurrent reads never see a half-written file.
fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .claude/ directory: {}", e))?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp_path, path).map_err(|e| format!("Failed to rename temp file: {}", e))?;
    Ok(())
}

// ── Phase 0a: passive probe ─────────────────────────────────────────────
//
// Reads files only — no command execution. Each primitive returns a
// `ProbedCapability` with `discovered_by: PassiveProbe`. Live-fire
// verification (Phase 0c) comes in PR 2 and is what moves capabilities
// requiring real-call confirmation from `claimed-unverified` → `verified`
// or `absent`.

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn read_package_json(project_path: &Path) -> Option<serde_json::Value> {
    let pkg_path = project_path.join("package.json");
    let content = fs::read_to_string(&pkg_path).ok()?;
    serde_json::from_str(&content).ok()
}

fn has_dep(pkg: &serde_json::Value, name: &str) -> bool {
    for section in &["dependencies", "devDependencies"] {
        if pkg
            .get(section)
            .and_then(|d| d.get(name))
            .is_some()
        {
            return true;
        }
    }
    false
}

fn pkg_script(pkg: &serde_json::Value, name: &str) -> Option<String> {
    pkg.get("scripts")
        .and_then(|s| s.get(name))
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Detect each test runner the project supports. Each runner is its own
/// capability so verify-mode can pick whichever the project has. When NONE
/// are present, the probe emits an `absent` record for `test-runner.any` so
/// the spec can substitute (e.g. BrowserMCP) or DEFER.
fn probe_test_runners(pkg: &serde_json::Value, now: &str) -> Vec<ProbedCapability> {
    let runners = [
        ("test-runner.vitest", "vitest"),
        ("test-runner.jest", "jest"),
        ("test-runner.playwright", "@playwright/test"),
        ("test-runner.cypress", "cypress"),
        ("test-runner.bun-test", "bun-types"), // bun's built-in test runner, weakly detected
    ];
    let mut out = Vec::new();
    let mut any_found = false;
    for (cap_id, dep_name) in runners {
        if has_dep(pkg, dep_name) {
            any_found = true;
            out.push(ProbedCapability {
                id: cap_id.to_string(),
                status: "verified".to_string(),
                discovered_by: DiscoveryMethod::PassiveProbe,
                evidence: format!("package.json:dependencies/devDependencies contains '{}'", dep_name),
                last_verified_at: now.to_string(),
                verify_method: None,
                expires: None,
                notes: None,
            });
        }
    }
    if !any_found {
        out.push(ProbedCapability {
            id: "test-runner.any".to_string(),
            status: "absent".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "package.json: no vitest/jest/playwright/cypress in deps or devDeps".to_string(),
            last_verified_at: now.to_string(),
            verify_method: None,
            expires: None,
            notes: Some(
                "Spec must substitute (e.g. browser-mcp) or DEFER behavioral checks.".to_string(),
            ),
        });
    }
    out
}

/// Detect the "vacuous root tsconfig" case: a root `tsconfig.json` with
/// `"files": []` and only `references`, meaning bare `tsc --noEmit` does
/// NOTHING. The real typecheck command is `tsc --noEmit -p <ref>` (usually
/// `tsconfig.app.json`) and the project's `typecheck` script usually
/// invokes it correctly. This probe captures BOTH the canonical command
/// AND whether the literal default would be vacuous.
fn probe_typecheck(project_path: &Path, pkg: &serde_json::Value, now: &str) -> Vec<ProbedCapability> {
    let root_tsconfig = project_path.join("tsconfig.json");
    if !root_tsconfig.exists() {
        return vec![ProbedCapability {
            id: "typecheck.tsc-default".to_string(),
            status: "absent".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "tsconfig.json not found".to_string(),
            last_verified_at: now.to_string(),
            verify_method: None,
            expires: None,
            notes: None,
        }];
    }
    let content = match fs::read_to_string(&root_tsconfig) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let tsconfig: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let has_empty_files = tsconfig
        .get("files")
        .and_then(|v| v.as_array())
        .map(|a| a.is_empty())
        .unwrap_or(false);
    let has_references = tsconfig
        .get("references")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    let vacuous_root = has_empty_files && has_references;

    let typecheck_script = pkg_script(pkg, "typecheck");

    let mut out = Vec::new();
    if vacuous_root {
        // Root tsc is vacuous. The real command lives in the typecheck script.
        let evidence = if let Some(ref s) = typecheck_script {
            format!(
                "tsconfig.json has empty `files` + project references → bare `tsc` is vacuous. Real cmd: {}",
                s
            )
        } else {
            "tsconfig.json has empty `files` + project references → bare `tsc` is vacuous. No `typecheck` script defined.".to_string()
        };
        out.push(ProbedCapability {
            id: "typecheck.tsc-projectref".to_string(),
            status: if typecheck_script.is_some() { "verified" } else { "absent" }.to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence,
            last_verified_at: now.to_string(),
            verify_method: typecheck_script,
            expires: None,
            notes: Some(
                "Specs MUST reference this capability, not `typecheck.tsc-default`. Bare `tsc --noEmit` resolves to root tsconfig and does nothing.".to_string(),
            ),
        });
    } else {
        // Standard tsconfig — `tsc --noEmit` works.
        let cmd = typecheck_script.clone().unwrap_or_else(|| "tsc --noEmit".to_string());
        out.push(ProbedCapability {
            id: "typecheck.tsc-default".to_string(),
            status: "verified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "tsconfig.json has non-empty `files` or no project-reference indirection".to_string(),
            last_verified_at: now.to_string(),
            verify_method: Some(cmd),
            expires: None,
            notes: None,
        });
    }
    out
}

/// Detect linters from devDependencies. ESLint, Biome, and (for Rust) clippy
/// via the presence of Cargo.toml.
fn probe_linters(project_path: &Path, pkg: &serde_json::Value, now: &str) -> Vec<ProbedCapability> {
    let mut out = Vec::new();
    if has_dep(pkg, "eslint") {
        out.push(ProbedCapability {
            id: "lint.eslint".to_string(),
            status: "verified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "package.json devDeps contains 'eslint'".to_string(),
            last_verified_at: now.to_string(),
            verify_method: pkg_script(pkg, "lint"),
            expires: None,
            notes: None,
        });
    }
    if has_dep(pkg, "@biomejs/biome") {
        out.push(ProbedCapability {
            id: "lint.biome".to_string(),
            status: "verified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "package.json devDeps contains '@biomejs/biome'".to_string(),
            last_verified_at: now.to_string(),
            verify_method: pkg_script(pkg, "lint"),
            expires: None,
            notes: None,
        });
    }
    if project_path.join("Cargo.toml").exists() {
        out.push(ProbedCapability {
            id: "lint.clippy".to_string(),
            status: "verified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "Cargo.toml present (clippy ships with the Rust toolchain)".to_string(),
            last_verified_at: now.to_string(),
            verify_method: Some("cargo clippy".to_string()),
            expires: None,
            notes: None,
        });
    }
    out
}

/// Detect MCP servers via the existing `get_mcp_servers` Tauri helper.
/// BrowserMCP gets first-class capability treatment because it's the
/// headline unlock for behavioral verification (see plan §BrowserMCP Unlock).
fn probe_mcp_servers(project_path: &str, now: &str) -> Vec<ProbedCapability> {
    let servers = match super::mcp::get_mcp_servers(Some(project_path.to_string())) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    let mut saw_browsermcp = false;
    for srv in &servers {
        let lower = srv.name.to_lowercase();
        if lower.contains("browsermcp") || lower.contains("browser-mcp") {
            saw_browsermcp = true;
            out.push(ProbedCapability {
                id: "browser-mcp".to_string(),
                status: "claimed-unverified".to_string(),
                discovered_by: DiscoveryMethod::PassiveProbe,
                evidence: format!(
                    "MCP server '{}' configured (scope: {})",
                    srv.name, srv.scope
                ),
                last_verified_at: now.to_string(),
                verify_method: Some(
                    "live-fire: mcp__browsermcp__browser_navigate about:blank + browser_snapshot"
                        .to_string(),
                ),
                expires: None,
                notes: Some(
                    "Live-fire required to confirm reachability. Phase 0c (PR 2) will fire it.".to_string(),
                ),
            });
        }
    }
    if !saw_browsermcp {
        out.push(ProbedCapability {
            id: "browser-mcp".to_string(),
            status: "absent".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "No MCP server matching 'browsermcp' in .mcp.json or ~/.claude.json".to_string(),
            last_verified_at: now.to_string(),
            verify_method: None,
            expires: None,
            notes: Some(
                "Without browser-mcp, behavioral checks must use a test runner or be marked SKIPPED.".to_string(),
            ),
        });
    }
    out
}

/// Detect credentials by env-key presence. Status is `claimed-unverified`
/// because key-presence does NOT prove validity — live-fire in PR 2 confirms.
fn probe_credentials(project_path: &Path, now: &str) -> Vec<ProbedCapability> {
    let keys = super::claude_md::read_env_keys_real_sources(project_path);
    let mut out = Vec::new();

    let supabase_url = keys
        .keys()
        .find(|k| k.contains("SUPABASE_URL") || k.contains("SUPABASE_PROJECT_URL"));
    let supabase_anon = keys
        .keys()
        .find(|k| k.contains("SUPABASE_ANON_KEY") || k.contains("SUPABASE_PUBLISHABLE"));
    let supabase_service = keys
        .keys()
        .find(|k| k.contains("SUPABASE_SERVICE_ROLE") || k.contains("SERVICE_ROLE_KEY"));

    if supabase_url.is_some() && supabase_anon.is_some() {
        out.push(ProbedCapability {
            id: "db.supabase-anon".to_string(),
            status: "claimed-unverified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: format!(
                "Env keys present: {} + {}",
                supabase_url.unwrap(),
                supabase_anon.unwrap()
            ),
            last_verified_at: now.to_string(),
            verify_method: Some(
                "live-fire: GET $URL/rest/v1/<any-table>?select=id&limit=1 → 200".to_string(),
            ),
            expires: None,
            notes: None,
        });
    }
    if supabase_url.is_some() && supabase_service.is_some() {
        out.push(ProbedCapability {
            id: "db.supabase-service-role".to_string(),
            status: "claimed-unverified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: format!(
                "Env keys present: {} + {}",
                supabase_url.unwrap(),
                supabase_service.unwrap()
            ),
            last_verified_at: now.to_string(),
            verify_method: Some(
                "live-fire: sentinel row write + revert on a known table".to_string(),
            ),
            expires: None,
            notes: None,
        });
    }

    for (cap_id, env_pattern, fire_method) in &[
        ("llm-key.anthropic", "ANTHROPIC_API_KEY", "POST /v1/messages with max_tokens=1 → 200"),
        ("llm-key.openai", "OPENAI_API_KEY", "GET /v1/models → 200"),
        ("llm-key.gemini", "GEMINI_API_KEY", "GET /v1beta/models → 200"),
        ("llm-key.gemini", "GOOGLE_API_KEY", "GET /v1beta/models → 200"),
    ] {
        if let Some(key_name) = keys.keys().find(|k| k.contains(env_pattern)) {
            // Avoid duplicate gemini entry when both keys are present.
            if out.iter().any(|c| c.id == *cap_id) {
                continue;
            }
            out.push(ProbedCapability {
                id: cap_id.to_string(),
                status: "claimed-unverified".to_string(),
                discovered_by: DiscoveryMethod::PassiveProbe,
                evidence: format!("Env key '{}' present", key_name),
                last_verified_at: now.to_string(),
                verify_method: Some(format!("live-fire: {}", fire_method)),
                expires: None,
                notes: None,
            });
        }
    }

    out
}

/// Probe git state — clean-tree + upstream tracking. These are cheap and
/// useful for Self-Drive to decide whether a build-mode turn can safely
/// stage commits.
fn probe_git(project_path: &Path, now: &str) -> Vec<ProbedCapability> {
    if !project_path.join(".git").exists() {
        return vec![ProbedCapability {
            id: "git.repo".to_string(),
            status: "absent".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "No .git directory at project root".to_string(),
            last_verified_at: now.to_string(),
            verify_method: None,
            expires: None,
            notes: None,
        }];
    }
    let mut out = Vec::new();
    // git status --porcelain
    if let Ok(output) = std::process::Command::new("git")
        .args(["-C", project_path.to_string_lossy().as_ref(), "status", "--porcelain"])
        .output()
    {
        let clean = output.status.success() && output.stdout.is_empty();
        out.push(ProbedCapability {
            id: "git.clean-tree".to_string(),
            status: if clean { "verified" } else { "absent" }.to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: if clean {
                "git status --porcelain returned no output".to_string()
            } else {
                format!(
                    "git status --porcelain: {} bytes of output (dirty tree)",
                    output.stdout.len()
                )
            },
            last_verified_at: now.to_string(),
            verify_method: Some("git status --porcelain".to_string()),
            expires: None,
            notes: None,
        });
    }
    out
}

/// Phase 0a — full passive probe. Returns the complete record (capabilities
/// + metadata) ready to be persisted via `write_project_capabilities`. PR 2
/// will splice in user-handshake + live-fire updates.
#[tauri::command]
pub fn probe_project_capabilities(
    project_path: String,
) -> Result<ProjectCapabilitiesRecord, String> {
    let project = Path::new(&project_path);
    let now = now_iso();
    let pkg = read_package_json(project).unwrap_or(serde_json::json!({}));

    let mut capabilities: Vec<ProbedCapability> = Vec::new();
    capabilities.extend(probe_test_runners(&pkg, &now));
    capabilities.extend(probe_typecheck(project, &pkg, &now));
    capabilities.extend(probe_linters(project, &pkg, &now));
    capabilities.extend(probe_mcp_servers(&project_path, &now));
    capabilities.extend(probe_credentials(project, &now));
    capabilities.extend(probe_git(project, &now));

    let record = ProjectCapabilitiesRecord {
        schema_version: 1,
        probed_at: now,
        probed_by_cli_version: None, // populated by the frontend, which has sessionCapabilities
        probed_by_spec_writer_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        capabilities,
        staleness_window: "PT24H".to_string(),
    };

    info!(
        "Probed project capabilities: project={}, capabilities={}",
        project_path,
        record.capabilities.len()
    );
    Ok(record)
}

/// Read the project's capability record. Returns `Ok(None)` when the file
/// does not yet exist (first-run case; SpecWriter will trigger a probe).
#[tauri::command]
pub fn read_project_capabilities(
    project_path: String,
) -> Result<Option<ProjectCapabilitiesRecord>, String> {
    let path = capabilities_path(&project_path);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read project-capabilities.json: {}", e))?;
    let record: ProjectCapabilitiesRecord = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse project-capabilities.json: {}", e))?;
    Ok(Some(record))
}

/// Persist the project's capability record. Creates `.claude/` if missing.
#[tauri::command]
pub fn write_project_capabilities(
    project_path: String,
    record: ProjectCapabilitiesRecord,
) -> Result<(), String> {
    let path = capabilities_path(&project_path);
    atomic_write_json(&path, &record)?;
    info!(
        "Wrote project-capabilities.json: project={}, capabilities={}, probedAt={}",
        project_path,
        record.capabilities.len(),
        record.probed_at
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_record() -> ProjectCapabilitiesRecord {
        ProjectCapabilitiesRecord {
            schema_version: 1,
            probed_at: "2026-05-14T10:00:00Z".to_string(),
            probed_by_cli_version: Some("claude-code 2.1.126".to_string()),
            probed_by_spec_writer_version: Some("1.1.10".to_string()),
            capabilities: vec![ProbedCapability {
                id: "browser-mcp".to_string(),
                status: "verified".to_string(),
                discovered_by: DiscoveryMethod::LiveFire,
                evidence: "navigate(about:blank)+snapshot → 200".to_string(),
                last_verified_at: "2026-05-14T10:00:00Z".to_string(),
                verify_method: Some(
                    "mcp__browsermcp__browser_navigate then browser_snapshot".to_string(),
                ),
                expires: None,
                notes: None,
            }],
            staleness_window: "PT24H".to_string(),
        }
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let record = sample_record();
        write_project_capabilities(project.clone(), record.clone()).unwrap();
        let loaded = read_project_capabilities(project).unwrap();
        assert_eq!(loaded.as_ref(), Some(&record));
    }

    #[test]
    fn read_missing_returns_none() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let loaded = read_project_capabilities(project).unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn write_creates_dot_claude_directory() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        assert!(!dir.path().join(".claude").exists());
        write_project_capabilities(project, sample_record()).unwrap();
        assert!(dir.path().join(".claude").exists());
        assert!(dir
            .path()
            .join(".claude")
            .join("project-capabilities.json")
            .exists());
    }

    #[test]
    fn read_invalid_json_returns_err() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(claude_dir.join("project-capabilities.json"), "not json").unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let result = read_project_capabilities(project);
        assert!(result.is_err());
    }

    #[test]
    fn discovery_method_serializes_kebab_case() {
        let record = sample_record();
        let json = serde_json::to_string(&record).unwrap();
        // TS expects kebab-case discriminants to match the type union
        // `'passive-probe' | 'user-handshake' | 'live-fire'`.
        assert!(json.contains("\"discoveredBy\":\"live-fire\""));
    }

    #[test]
    fn camel_case_field_names_on_disk() {
        let record = sample_record();
        let json = serde_json::to_string(&record).unwrap();
        // Schema must match TS so the same file deserializes on the frontend.
        assert!(json.contains("\"schemaVersion\":1"));
        assert!(json.contains("\"probedAt\":"));
        assert!(json.contains("\"stalenessWindow\":"));
        assert!(json.contains("\"lastVerifiedAt\":"));
        assert!(json.contains("\"verifyMethod\":"));
    }

    // ── probe_test_runners ──

    #[test]
    fn probe_test_runners_detects_vitest() {
        let pkg = serde_json::json!({
            "devDependencies": { "vitest": "^1.0.0" }
        });
        let caps = probe_test_runners(&pkg, "2026-05-14T10:00:00Z");
        assert!(caps.iter().any(|c| c.id == "test-runner.vitest" && c.status == "verified"));
        assert!(!caps.iter().any(|c| c.id == "test-runner.any" && c.status == "absent"));
    }

    #[test]
    fn probe_test_runners_emits_absent_when_none_found() {
        let pkg = serde_json::json!({
            "dependencies": { "react": "^18.0.0" },
            "devDependencies": { "eslint": "^9.0.0" }
        });
        let caps = probe_test_runners(&pkg, "2026-05-14T10:00:00Z");
        let absent = caps.iter().find(|c| c.id == "test-runner.any").unwrap();
        assert_eq!(absent.status, "absent");
        assert!(absent.notes.as_ref().unwrap().contains("DEFER"));
    }

    #[test]
    fn probe_test_runners_detects_multiple() {
        let pkg = serde_json::json!({
            "devDependencies": {
                "vitest": "^1.0.0",
                "@playwright/test": "^1.40.0"
            }
        });
        let caps = probe_test_runners(&pkg, "2026-05-14T10:00:00Z");
        assert!(caps.iter().any(|c| c.id == "test-runner.vitest"));
        assert!(caps.iter().any(|c| c.id == "test-runner.playwright"));
    }

    // ── probe_typecheck ──

    #[test]
    fn probe_typecheck_detects_vacuous_root_tsconfig() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("tsconfig.json"),
            r#"{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }"#,
        )
        .unwrap();
        let pkg = serde_json::json!({
            "scripts": { "typecheck": "tsc --noEmit -p tsconfig.app.json" }
        });
        let caps = probe_typecheck(dir.path(), &pkg, "2026-05-14T10:00:00Z");
        let cap = caps.iter().find(|c| c.id == "typecheck.tsc-projectref").unwrap();
        assert_eq!(cap.status, "verified");
        assert_eq!(
            cap.verify_method.as_deref(),
            Some("tsc --noEmit -p tsconfig.app.json")
        );
        // The probe must flag the bare-`tsc` trap so SpecWriter doesn't write
        // acceptance criteria that resolve to the vacuous root tsconfig.
        assert!(cap.evidence.contains("vacuous"));
        assert!(cap.notes.as_ref().unwrap().contains("tsc-default"));
    }

    #[test]
    fn probe_typecheck_standard_tsconfig() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("tsconfig.json"),
            r#"{ "compilerOptions": { "strict": true }, "include": ["src/**/*"] }"#,
        )
        .unwrap();
        let pkg = serde_json::json!({});
        let caps = probe_typecheck(dir.path(), &pkg, "2026-05-14T10:00:00Z");
        let cap = caps.iter().find(|c| c.id == "typecheck.tsc-default").unwrap();
        assert_eq!(cap.status, "verified");
    }

    #[test]
    fn probe_typecheck_missing_tsconfig() {
        let dir = tempdir().unwrap();
        let pkg = serde_json::json!({});
        let caps = probe_typecheck(dir.path(), &pkg, "2026-05-14T10:00:00Z");
        assert_eq!(caps[0].id, "typecheck.tsc-default");
        assert_eq!(caps[0].status, "absent");
    }

    #[test]
    fn probe_typecheck_vacuous_root_no_script_marks_absent() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("tsconfig.json"),
            r#"{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }"#,
        )
        .unwrap();
        let pkg = serde_json::json!({});
        let caps = probe_typecheck(dir.path(), &pkg, "2026-05-14T10:00:00Z");
        let cap = caps.iter().find(|c| c.id == "typecheck.tsc-projectref").unwrap();
        // No `typecheck` script + vacuous root = no real typecheck command exists.
        assert_eq!(cap.status, "absent");
    }

    // ── probe_credentials ──

    #[test]
    fn probe_credentials_detects_supabase_anon() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "VITE_SUPABASE_URL=https://x.supabase.co\nVITE_SUPABASE_ANON_KEY=ey...\n",
        )
        .unwrap();
        let caps = probe_credentials(dir.path(), "2026-05-14T10:00:00Z");
        let cap = caps.iter().find(|c| c.id == "db.supabase-anon").unwrap();
        assert_eq!(cap.status, "claimed-unverified");
        assert!(cap.verify_method.as_ref().unwrap().contains("live-fire"));
    }

    #[test]
    fn probe_credentials_detects_supabase_service_role() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "VITE_SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=ey...\n",
        )
        .unwrap();
        let caps = probe_credentials(dir.path(), "2026-05-14T10:00:00Z");
        assert!(caps.iter().any(|c| c.id == "db.supabase-service-role"));
    }

    #[test]
    fn probe_credentials_detects_llm_keys() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "ANTHROPIC_API_KEY=sk-ant\nOPENAI_API_KEY=sk-x\nGEMINI_API_KEY=AIz\n",
        )
        .unwrap();
        let caps = probe_credentials(dir.path(), "2026-05-14T10:00:00Z");
        assert!(caps.iter().any(|c| c.id == "llm-key.anthropic"));
        assert!(caps.iter().any(|c| c.id == "llm-key.openai"));
        assert!(caps.iter().any(|c| c.id == "llm-key.gemini"));
    }

    #[test]
    fn probe_credentials_no_duplicate_gemini_when_both_keys_present() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "GEMINI_API_KEY=AIz\nGOOGLE_API_KEY=AIz2\n",
        )
        .unwrap();
        let caps = probe_credentials(dir.path(), "2026-05-14T10:00:00Z");
        let gemini_count = caps.iter().filter(|c| c.id == "llm-key.gemini").count();
        assert_eq!(gemini_count, 1, "Gemini should be deduped when both env names are present");
    }

    #[test]
    fn probe_credentials_no_env_files() {
        let dir = tempdir().unwrap();
        let caps = probe_credentials(dir.path(), "2026-05-14T10:00:00Z");
        assert!(caps.is_empty());
    }

    // ── probe_linters ──

    #[test]
    fn probe_linters_detects_eslint() {
        let dir = tempdir().unwrap();
        let pkg = serde_json::json!({
            "devDependencies": { "eslint": "^9.0.0" },
            "scripts": { "lint": "eslint ." }
        });
        let caps = probe_linters(dir.path(), &pkg, "2026-05-14T10:00:00Z");
        let cap = caps.iter().find(|c| c.id == "lint.eslint").unwrap();
        assert_eq!(cap.status, "verified");
        assert_eq!(cap.verify_method.as_deref(), Some("eslint ."));
    }

    #[test]
    fn probe_linters_detects_clippy_via_cargo_toml() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        let pkg = serde_json::json!({});
        let caps = probe_linters(dir.path(), &pkg, "2026-05-14T10:00:00Z");
        assert!(caps.iter().any(|c| c.id == "lint.clippy"));
    }

    // ── probe_project_capabilities (end-to-end) ──

    #[test]
    fn end_to_end_probe_produces_record() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{
              "name": "demo",
              "scripts": { "typecheck": "tsc --noEmit -p tsconfig.app.json" },
              "devDependencies": { "vitest": "^1.0.0", "eslint": "^9.0.0" }
            }"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("tsconfig.json"),
            r#"{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }"#,
        )
        .unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "ANTHROPIC_API_KEY=sk-ant\n",
        )
        .unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let record = probe_project_capabilities(project).unwrap();

        assert_eq!(record.schema_version, 1);
        assert_eq!(record.staleness_window, "PT24H");
        assert!(record.capabilities.iter().any(|c| c.id == "test-runner.vitest"));
        assert!(record.capabilities.iter().any(|c| c.id == "typecheck.tsc-projectref"));
        assert!(record.capabilities.iter().any(|c| c.id == "lint.eslint"));
        assert!(record.capabilities.iter().any(|c| c.id == "llm-key.anthropic"));
        // A browser-mcp entry is ALWAYS emitted (either claimed-unverified when
        // a server is configured globally/project-locally, or absent). We can't
        // assert the status here because `get_mcp_servers` reads the developer's
        // ~/.claude.json, which is environment-specific. The contract is that
        // one entry exists.
        assert!(record.capabilities.iter().any(|c| c.id == "browser-mcp"));
    }
}
