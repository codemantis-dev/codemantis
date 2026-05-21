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

    if let (Some(url), Some(anon)) = (supabase_url, supabase_anon) {
        out.push(ProbedCapability {
            id: "db.supabase-anon".to_string(),
            status: "claimed-unverified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: format!("Env keys present: {} + {}", url, anon),
            last_verified_at: now.to_string(),
            verify_method: Some(
                "live-fire: GET $URL/rest/v1/<any-table>?select=id&limit=1 → 200".to_string(),
            ),
            expires: None,
            notes: None,
        });
    }
    if let (Some(url), Some(service)) = (supabase_url, supabase_service) {
        out.push(ProbedCapability {
            id: "db.supabase-service-role".to_string(),
            status: "claimed-unverified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: format!("Env keys present: {} + {}", url, service),
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

/// Detect whether this project ships a local Supabase stack via
/// `supabase/config.toml`. SpecWriter uses this to decide whether
/// `supabase db reset`, `supabase start`, and `psql -h localhost` are
/// legal evidence shapes. Atikon CRM is the motivating case: cloud-only
/// Supabase with no local stack — `supabase db reset` will hang forever.
///
/// Emits three shapes:
/// - `config.toml` present → `verified` (file IS the proof; no live-fire needed).
/// - `config.toml` absent + any cloud-Supabase signal (env URL or anon key)
///   → `absent` with a "cloud-only setup detected" evidence string. SpecWriter
///   substitutes `supabase db push` / `supabase db query --linked` for items
///   tagged `capability=db.supabase.local-stack`.
/// - Neither → omit (this isn't a Supabase project at all).
fn probe_supabase_local_stack(project_path: &Path, now: &str) -> Vec<ProbedCapability> {
    let config_toml = project_path.join("supabase").join("config.toml");
    if config_toml.exists() {
        return vec![ProbedCapability {
            id: "db.supabase.local-stack".to_string(),
            status: "verified".to_string(),
            discovered_by: DiscoveryMethod::PassiveProbe,
            evidence: "supabase/config.toml present at project root".to_string(),
            last_verified_at: now.to_string(),
            verify_method: Some("file: supabase/config.toml".to_string()),
            expires: None,
            notes: Some(
                "Local stack assumed available — `supabase start` / `db reset` / `psql -h localhost:54322` are legal evidence shapes."
                    .to_string(),
            ),
        }];
    }
    // No config.toml — only emit the capability if there's a cloud signal,
    // so an `absent` record actively tells SpecWriter "this project IS
    // Supabase but cloud-only; substitute local commands."
    let keys = super::claude_md::read_env_keys_real_sources(project_path);
    let has_cloud_signal = keys.keys().any(|k| {
        k.contains("SUPABASE_URL")
            || k.contains("SUPABASE_PROJECT_URL")
            || k.contains("SUPABASE_ANON_KEY")
            || k.contains("SUPABASE_PUBLISHABLE")
            || k.contains("SUPABASE_SERVICE_ROLE")
    });
    if !has_cloud_signal {
        return Vec::new();
    }
    vec![ProbedCapability {
        id: "db.supabase.local-stack".to_string(),
        status: "absent".to_string(),
        discovered_by: DiscoveryMethod::PassiveProbe,
        evidence: "no supabase/config.toml; cloud-only Supabase setup detected via env keys".to_string(),
        last_verified_at: now.to_string(),
        verify_method: Some("file: supabase/config.toml (not found)".to_string()),
        expires: None,
        notes: Some(
            "Do not emit `supabase db reset`, `supabase start`, or `psql -h localhost`. Use `supabase db push`, `supabase db query --linked`, or live REST/MCP."
                .to_string(),
        ),
    }]
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

// ── Phase 0c: live-fire verification ────────────────────────────────────
//
// After the user confirms a `claimed-unverified` capability via the
// handshake (Phase 0b), the frontend asks Rust to actually invoke each
// capability to prove it's reachable. Live-fire updates a capability's
// status from `claimed-unverified` to `verified` (success) or `absent`
// (failure). The frontend merges the results into the existing record
// and persists via `write_project_capabilities`.
//
// One capability — `browser-mcp` — cannot be exercised from Rust because
// MCP tools (`mcp__browsermcp__browser_navigate` etc.) are invokable only
// through a Claude Code CLI session. For that case Rust emits a record
// flagged for frontend handling; PR 3 (Self-Drive verify-mode awareness)
// drives the actual browser_navigate + browser_snapshot via a Claude
// Code dispatcher.

/// Read `.env*` files including VALUES for the live-fire phase. Values stay
/// inside Rust — never returned through Tauri IPC, never logged. The map is
/// dropped at the end of `live_fire_capabilities`.
fn read_env_values_for_live_fire(
    project_path: &Path,
) -> std::collections::BTreeMap<String, String> {
    let candidates = [
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.production",
        ".env.production.local",
    ];
    let mut out = std::collections::BTreeMap::new();
    for candidate in &candidates {
        let path = project_path.join(candidate);
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let Some(eq) = trimmed.find('=') else { continue };
            let key = trimmed[..eq].trim().to_string();
            if key.is_empty() {
                continue;
            }
            let raw_value = trimmed[eq + 1..].trim();
            // Strip surrounding quotes if present (.env convention).
            let value = raw_value
                .trim_start_matches(['"', '\''])
                .trim_end_matches(['"', '\''])
                .to_string();
            if value.is_empty() {
                continue;
            }
            // Later files override earlier ones (typical .env precedence:
            // .env.local overrides .env).
            out.insert(key, value);
        }
    }
    out
}

/// Build a live-fire-result record. `evidence` is short; `verify_method` is
/// the exact command/URL that was tried.
fn live_fire_result(
    id: &str,
    status: &str,
    evidence: String,
    verify_method: String,
    now: &str,
) -> ProbedCapability {
    ProbedCapability {
        id: id.to_string(),
        status: status.to_string(),
        discovered_by: DiscoveryMethod::LiveFire,
        evidence,
        last_verified_at: now.to_string(),
        verify_method: Some(verify_method),
        expires: None,
        notes: None,
    }
}

fn first_matching_value<'a>(
    env: &'a std::collections::BTreeMap<String, String>,
    patterns: &[&str],
) -> Option<(&'a str, &'a str)> {
    for (k, v) in env.iter() {
        for pat in patterns {
            if k.contains(pat) {
                return Some((k.as_str(), v.as_str()));
            }
        }
    }
    None
}

async fn fire_supabase_anon(
    env: &std::collections::BTreeMap<String, String>,
    now: &str,
) -> ProbedCapability {
    let id = "db.supabase-anon";
    let url = first_matching_value(env, &["SUPABASE_URL", "SUPABASE_PROJECT_URL"]);
    let key = first_matching_value(env, &["SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE"]);
    let (Some((url_name, url_val)), Some((key_name, key_val))) = (url, key) else {
        return live_fire_result(
            id,
            "absent",
            "Required env vars missing at live-fire time".to_string(),
            "skipped: SUPABASE_URL + SUPABASE_ANON_KEY required".to_string(),
            now,
        );
    };
    // Hit a generic introspection endpoint that requires the anon key but no
    // specific table. PostgREST returns 200 with OpenAPI-style JSON when the
    // key is valid even on a project with no public tables.
    let target = format!("{}/rest/v1/", url_val.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return live_fire_result(
                id,
                "absent",
                format!("reqwest client build failed: {}", e),
                format!("GET {}", target),
                now,
            );
        }
    };
    let resp = client
        .get(&target)
        .header("apikey", key_val)
        .header("Authorization", format!("Bearer {}", key_val))
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => live_fire_result(
            id,
            "verified",
            format!(
                "REST {} returned {} using env keys {} + {}",
                target,
                r.status().as_u16(),
                url_name,
                key_name
            ),
            format!("GET {} (with apikey + Bearer)", target),
            now,
        ),
        Ok(r) => live_fire_result(
            id,
            "absent",
            format!(
                "REST {} returned {} (env keys present: {} + {})",
                target,
                r.status().as_u16(),
                url_name,
                key_name
            ),
            format!("GET {}", target),
            now,
        ),
        Err(e) => live_fire_result(
            id,
            "absent",
            format!("HTTP error: {}", e),
            format!("GET {}", target),
            now,
        ),
    }
}

async fn fire_supabase_service_role(
    env: &std::collections::BTreeMap<String, String>,
    now: &str,
) -> ProbedCapability {
    let id = "db.supabase-service-role";
    let url = first_matching_value(env, &["SUPABASE_URL", "SUPABASE_PROJECT_URL"]);
    let key = first_matching_value(env, &["SUPABASE_SERVICE_ROLE", "SERVICE_ROLE_KEY"]);
    let (Some((url_name, url_val)), Some((key_name, key_val))) = (url, key) else {
        return live_fire_result(
            id,
            "absent",
            "Required env vars missing at live-fire time".to_string(),
            "skipped: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required".to_string(),
            now,
        );
    };
    // PR 2 verification proves the service-role KEY is valid — we hit the
    // same introspection endpoint with the service-role Authorization. A
    // future enhancement could exercise an actual write/revert against a
    // sentinel row, but that requires knowing a safe target table per
    // project — out of scope for the generic dispatcher.
    let target = format!("{}/rest/v1/", url_val.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return live_fire_result(
                id,
                "absent",
                format!("reqwest client build failed: {}", e),
                format!("GET {}", target),
                now,
            );
        }
    };
    let resp = client
        .get(&target)
        .header("apikey", key_val)
        .header("Authorization", format!("Bearer {}", key_val))
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => live_fire_result(
            id,
            "verified",
            format!(
                "REST {} returned {} with service-role key ({} + {})",
                target,
                r.status().as_u16(),
                url_name,
                key_name
            ),
            format!("GET {} (service-role Bearer)", target),
            now,
        ),
        Ok(r) => live_fire_result(
            id,
            "absent",
            format!("REST {} returned {}", target, r.status().as_u16()),
            format!("GET {}", target),
            now,
        ),
        Err(e) => live_fire_result(
            id,
            "absent",
            format!("HTTP error: {}", e),
            format!("GET {}", target),
            now,
        ),
    }
}

async fn fire_anthropic(
    env: &std::collections::BTreeMap<String, String>,
    now: &str,
) -> ProbedCapability {
    let id = "llm-key.anthropic";
    let key = first_matching_value(env, &["ANTHROPIC_API_KEY"]);
    let Some((key_name, key_val)) = key else {
        return live_fire_result(
            id,
            "absent",
            "ANTHROPIC_API_KEY missing at live-fire time".to_string(),
            "skipped".to_string(),
            now,
        );
    };
    let target = "https://api.anthropic.com/v1/messages";
    // Send the smallest possible request that exercises auth without burning
    // meaningful tokens: 1-token max, single user word, cheapest model.
    let body = serde_json::json!({
        "model": "claude-haiku-4-5",
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": "hi" }]
    });
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return live_fire_result(
                id,
                "absent",
                format!("reqwest client build failed: {}", e),
                format!("POST {}", target),
                now,
            );
        }
    };
    let resp = client
        .post(target)
        .header("x-api-key", key_val)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => live_fire_result(
            id,
            "verified",
            format!(
                "POST {} returned {} using env key {}",
                target,
                r.status().as_u16(),
                key_name
            ),
            format!("POST {} (max_tokens=1)", target),
            now,
        ),
        Ok(r) => live_fire_result(
            id,
            "absent",
            format!("POST {} returned {}", target, r.status().as_u16()),
            format!("POST {}", target),
            now,
        ),
        Err(e) => live_fire_result(
            id,
            "absent",
            format!("HTTP error: {}", e),
            format!("POST {}", target),
            now,
        ),
    }
}

async fn fire_openai(
    env: &std::collections::BTreeMap<String, String>,
    now: &str,
) -> ProbedCapability {
    let id = "llm-key.openai";
    let key = first_matching_value(env, &["OPENAI_API_KEY"]);
    let Some((key_name, key_val)) = key else {
        return live_fire_result(
            id,
            "absent",
            "OPENAI_API_KEY missing at live-fire time".to_string(),
            "skipped".to_string(),
            now,
        );
    };
    let target = "https://api.openai.com/v1/models";
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return live_fire_result(
                id,
                "absent",
                format!("reqwest client build failed: {}", e),
                format!("GET {}", target),
                now,
            );
        }
    };
    let resp = client
        .get(target)
        .header("Authorization", format!("Bearer {}", key_val))
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => live_fire_result(
            id,
            "verified",
            format!(
                "GET {} returned {} using env key {}",
                target,
                r.status().as_u16(),
                key_name
            ),
            format!("GET {}", target),
            now,
        ),
        Ok(r) => live_fire_result(
            id,
            "absent",
            format!("GET {} returned {}", target, r.status().as_u16()),
            format!("GET {}", target),
            now,
        ),
        Err(e) => live_fire_result(
            id,
            "absent",
            format!("HTTP error: {}", e),
            format!("GET {}", target),
            now,
        ),
    }
}

async fn fire_gemini(
    env: &std::collections::BTreeMap<String, String>,
    now: &str,
) -> ProbedCapability {
    let id = "llm-key.gemini";
    let key = first_matching_value(env, &["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
    let Some((key_name, key_val)) = key else {
        return live_fire_result(
            id,
            "absent",
            "GEMINI_API_KEY / GOOGLE_API_KEY missing at live-fire time".to_string(),
            "skipped".to_string(),
            now,
        );
    };
    let target = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        key_val
    );
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return live_fire_result(
                id,
                "absent",
                format!("reqwest client build failed: {}", e),
                "GET v1beta/models".to_string(),
                now,
            );
        }
    };
    let resp = client.get(&target).send().await;
    match resp {
        Ok(r) if r.status().is_success() => live_fire_result(
            id,
            "verified",
            format!(
                "GET v1beta/models returned {} using env key {}",
                r.status().as_u16(),
                key_name
            ),
            "GET v1beta/models".to_string(),
            now,
        ),
        Ok(r) => live_fire_result(
            id,
            "absent",
            format!("GET v1beta/models returned {}", r.status().as_u16()),
            "GET v1beta/models".to_string(),
            now,
        ),
        Err(e) => live_fire_result(
            id,
            "absent",
            format!("HTTP error: {}", e),
            "GET v1beta/models".to_string(),
            now,
        ),
    }
}

fn fire_browser_mcp_marker(now: &str) -> ProbedCapability {
    // MCP tools are invokable only via a Claude Code CLI session, not from
    // Rust. The frontend must orchestrate the actual `browser_navigate` +
    // `browser_snapshot` call. Until that happens, the capability stays
    // claimed-unverified — but with a clear marker so the frontend knows
    // it's responsible for finishing the verification.
    ProbedCapability {
        id: "browser-mcp".to_string(),
        status: "claimed-unverified".to_string(),
        discovered_by: DiscoveryMethod::LiveFire,
        evidence: "Rust dispatcher cannot invoke MCP tools — frontend must complete the live-fire via a Claude Code session.".to_string(),
        last_verified_at: now.to_string(),
        verify_method: Some(
            "frontend: mcp__browsermcp__browser_navigate about:blank + browser_snapshot".to_string(),
        ),
        expires: None,
        notes: Some(
            "PR 3 wires the actual browser-mcp live-fire through a Claude Code dispatcher. For now this remains claimed-unverified after Phase 0c.".to_string(),
        ),
    }
}

fn fire_unknown(id: &str, now: &str) -> ProbedCapability {
    ProbedCapability {
        id: id.to_string(),
        status: "claimed-unverified".to_string(),
        discovered_by: DiscoveryMethod::LiveFire,
        evidence: format!("Live-fire requested for unknown capability `{}` — dispatcher has no handler.", id),
        last_verified_at: now.to_string(),
        verify_method: None,
        expires: None,
        notes: Some(
            "Add a fire_* handler in project_capabilities.rs to support this capability.".to_string(),
        ),
    }
}

/// Phase 0c — live-fire verification. Takes a list of capability IDs the user
/// confirmed in the handshake and returns updated records (status, evidence,
/// verifyMethod, lastVerifiedAt) for each. The caller merges these into the
/// existing on-disk record and persists.
///
/// Errors here are per-capability — one failed fire downgrades that single
/// capability to `status: absent`, it does NOT abort the batch.
#[tauri::command]
pub async fn live_fire_capabilities(
    project_path: String,
    capability_ids: Vec<String>,
) -> Result<Vec<ProbedCapability>, String> {
    let project = Path::new(&project_path);
    let env = read_env_values_for_live_fire(project);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut results: Vec<ProbedCapability> = Vec::with_capacity(capability_ids.len());
    for id in capability_ids {
        let cap = match id.as_str() {
            "browser-mcp" => fire_browser_mcp_marker(&now),
            "db.supabase-anon" => fire_supabase_anon(&env, &now).await,
            "db.supabase-service-role" => fire_supabase_service_role(&env, &now).await,
            "llm-key.anthropic" => fire_anthropic(&env, &now).await,
            "llm-key.openai" => fire_openai(&env, &now).await,
            "llm-key.gemini" => fire_gemini(&env, &now).await,
            other => fire_unknown(other, &now),
        };
        results.push(cap);
    }
    info!(
        "Live-fire complete: project={}, fired={}",
        project_path,
        results.len()
    );
    Ok(results)
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
    capabilities.extend(probe_supabase_local_stack(project, &now));
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

    // ── probe_supabase_local_stack ──

    #[test]
    fn probe_local_stack_emits_verified_when_config_toml_present() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("supabase")).unwrap();
        fs::write(
            dir.path().join("supabase").join("config.toml"),
            "[project]\nname = \"x\"\n",
        )
        .unwrap();
        let caps = probe_supabase_local_stack(dir.path(), "2026-05-14T10:00:00Z");
        let cap = caps
            .iter()
            .find(|c| c.id == "db.supabase.local-stack")
            .expect("local-stack capability must be emitted when config.toml is present");
        assert_eq!(cap.status, "verified");
        assert!(cap.evidence.contains("supabase/config.toml"));
        // Notes guide SpecWriter on legal evidence shapes.
        assert!(cap.notes.as_ref().unwrap().contains("db reset"));
    }

    #[test]
    fn probe_local_stack_emits_absent_when_cloud_only() {
        let dir = tempdir().unwrap();
        // No supabase/config.toml; cloud signal via env keys.
        fs::write(
            dir.path().join(".env.local"),
            "VITE_SUPABASE_URL=https://x.supabase.co\nVITE_SUPABASE_ANON_KEY=ey...\n",
        )
        .unwrap();
        let caps = probe_supabase_local_stack(dir.path(), "2026-05-14T10:00:00Z");
        let cap = caps
            .iter()
            .find(|c| c.id == "db.supabase.local-stack")
            .expect("absent local-stack must be surfaced when cloud signal is present");
        assert_eq!(cap.status, "absent");
        assert!(cap.evidence.contains("cloud-only"));
        // Notes tell SpecWriter what to substitute.
        let notes = cap.notes.as_ref().unwrap();
        assert!(notes.contains("supabase db push"));
        assert!(!notes.contains(" db reset") || notes.contains("Do not emit"));
    }

    #[test]
    fn probe_local_stack_omitted_when_no_supabase_signal() {
        let dir = tempdir().unwrap();
        // Neither config.toml nor any Supabase env keys.
        fs::write(dir.path().join(".env.local"), "FOO=bar\n").unwrap();
        let caps = probe_supabase_local_stack(dir.path(), "2026-05-14T10:00:00Z");
        assert!(
            caps.is_empty(),
            "no local-stack capability should be emitted for non-Supabase projects"
        );
    }

    #[test]
    fn probe_local_stack_present_takes_precedence_over_env_signal() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("supabase")).unwrap();
        fs::write(
            dir.path().join("supabase").join("config.toml"),
            "[project]\nname = \"x\"\n",
        )
        .unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "VITE_SUPABASE_URL=https://x.supabase.co\n",
        )
        .unwrap();
        let caps = probe_supabase_local_stack(dir.path(), "2026-05-14T10:00:00Z");
        let cap = caps
            .iter()
            .find(|c| c.id == "db.supabase.local-stack")
            .unwrap();
        // config.toml wins — local stack is a real capability here.
        assert_eq!(cap.status, "verified");
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

    // ── read_env_values_for_live_fire ──

    #[test]
    fn env_values_strip_surrounding_quotes() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "QUOTED=\"hello\"\nSINGLE='world'\nBARE=plain\n",
        )
        .unwrap();
        let env = read_env_values_for_live_fire(dir.path());
        assert_eq!(env.get("QUOTED").map(String::as_str), Some("hello"));
        assert_eq!(env.get("SINGLE").map(String::as_str), Some("world"));
        assert_eq!(env.get("BARE").map(String::as_str), Some("plain"));
    }

    #[test]
    fn env_values_local_overrides_base() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".env"), "SHARED=base\n").unwrap();
        fs::write(dir.path().join(".env.local"), "SHARED=override\n").unwrap();
        let env = read_env_values_for_live_fire(dir.path());
        // .env.local appears later in the candidate list, so it overrides.
        assert_eq!(env.get("SHARED").map(String::as_str), Some("override"));
    }

    #[test]
    fn env_values_skip_empty_values() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".env.local"), "EMPTY=\nREAL=value\n").unwrap();
        let env = read_env_values_for_live_fire(dir.path());
        assert!(!env.contains_key("EMPTY"));
        assert_eq!(env.get("REAL").map(String::as_str), Some("value"));
    }

    // ── live_fire_capabilities — env-missing paths ──

    #[tokio::test]
    async fn live_fire_supabase_anon_missing_env_returns_absent() {
        let dir = tempdir().unwrap();
        // No .env files written.
        let project = dir.path().to_string_lossy().to_string();
        let results =
            live_fire_capabilities(project, vec!["db.supabase-anon".to_string()])
                .await
                .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "db.supabase-anon");
        assert_eq!(results[0].status, "absent");
        assert!(results[0].evidence.contains("Required env vars missing"));
    }

    #[tokio::test]
    async fn live_fire_llm_keys_missing_env_return_absent() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let results = live_fire_capabilities(
            project,
            vec![
                "llm-key.anthropic".to_string(),
                "llm-key.openai".to_string(),
                "llm-key.gemini".to_string(),
            ],
        )
        .await
        .unwrap();
        assert_eq!(results.len(), 3);
        for cap in &results {
            assert_eq!(cap.status, "absent");
            assert!(cap.evidence.contains("missing at live-fire time"));
            assert_eq!(cap.discovered_by, DiscoveryMethod::LiveFire);
        }
    }

    #[tokio::test]
    async fn live_fire_browser_mcp_returns_frontend_marker() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let results =
            live_fire_capabilities(project, vec!["browser-mcp".to_string()])
                .await
                .unwrap();
        assert_eq!(results[0].id, "browser-mcp");
        // Rust cannot complete browser-mcp verification — frontend must drive it.
        assert_eq!(results[0].status, "claimed-unverified");
        assert!(results[0].evidence.contains("frontend"));
        assert!(results[0]
            .verify_method
            .as_ref()
            .unwrap()
            .contains("browser_navigate"));
    }

    #[tokio::test]
    async fn live_fire_unknown_capability_returns_unknown_marker() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let results =
            live_fire_capabilities(project, vec!["does.not.exist".to_string()])
                .await
                .unwrap();
        assert_eq!(results[0].id, "does.not.exist");
        assert_eq!(results[0].status, "claimed-unverified");
        assert!(results[0].evidence.contains("unknown capability"));
    }

    #[tokio::test]
    async fn live_fire_handles_batch_of_mixed_capabilities() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let results = live_fire_capabilities(
            project,
            vec![
                "browser-mcp".to_string(),
                "llm-key.openai".to_string(),
                "does.not.exist".to_string(),
            ],
        )
        .await
        .unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].id, "browser-mcp");
        assert_eq!(results[1].id, "llm-key.openai");
        assert_eq!(results[2].id, "does.not.exist");
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
