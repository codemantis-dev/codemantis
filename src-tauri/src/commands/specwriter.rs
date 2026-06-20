use crate::agents::claude_code::session::AppState;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecDocumentInfo {
    pub filename: String,
    pub title: String,
    pub modified_at: String,
    pub size_bytes: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResult {
    pub path: String,
    pub found: bool,
    pub content: Option<String>,
    pub total_lines: usize,
    pub truncated: bool,
}

// ── Spec persistence (reuses task_plans table) ──────────────────────────

#[tauri::command]
pub async fn save_task_board_state(
    state: State<'_, AppState>,
    project_path: String,
    state_json: String,
) -> Result<(), String> {
    let existing_id = state
        .database
        .get_active_plan_id(&project_path)
        .map_err(|e| format!("Failed to check existing state: {}", e))?;

    if existing_id.is_some() {
        state
            .database
            .update_task_plan(&project_path, &state_json)
            .map_err(|e| format!("Failed to update spec writer state: {}", e))?;
    } else {
        let id = format!("spec-{}", chrono::Utc::now().timestamp_millis());
        state
            .database
            .insert_task_plan(&id, &project_path, &state_json)
            .map_err(|e| format!("Failed to save spec writer state: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_task_board_state(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Option<String>, String> {
    state
        .database
        .get_task_plan(&project_path)
        .map_err(|e| format!("Failed to load spec writer state: {}", e))
}

#[tauri::command]
pub async fn delete_task_plan_cmd(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<(), String> {
    state
        .database
        .delete_task_plan_by_id(&plan_id)
        .map_err(|e| format!("Failed to delete: {}", e))?;
    info!("Deleted spec state {}", plan_id);
    Ok(())
}

#[tauri::command]
pub async fn archive_task_plan_cmd(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<(), String> {
    state
        .database
        .archive_task_plan(&plan_id)
        .map_err(|e| format!("Failed to archive: {}", e))?;
    info!("Archived spec state {}", plan_id);
    Ok(())
}

// ── Spec document file management ──────────────────────────────────────

#[tauri::command]
pub async fn save_spec_document(
    state: tauri::State<'_, crate::agents::claude_code::session::AppState>,
    project_path: String,
    filename: String,
    content: String,
    overwrite: bool,
) -> Result<String, String> {
    let full_path = save_spec_document_impl(
        project_path.clone(),
        filename.clone(),
        content.clone(),
        overwrite,
    )
    .await?;

    // RECALL-SPEC §9.2.3 first bullet: trigger spec_to_note harvest
    // so the spec becomes a decision note linked to overlapping
    // landmines. Best-effort — failures here must not block the
    // save. The vault is auto-created on first call.
    let settings_recall_enabled = crate::commands::settings::get_settings()
        .map(|s| s.recall.enabled && s.recall.mode != crate::recall::config::RecallMode::Off)
        .unwrap_or(false);
    if settings_recall_enabled {
        let db = state.database.clone();
        let project = std::path::PathBuf::from(&project_path);
        let body = content.clone();
        let fname = filename.clone();
        tokio::spawn(async move {
            match crate::recall::specwriter::spec_to_note::harvest(&db, &project, &fname, &body) {
                Ok(outcome) => {
                    log::info!("[recall.spec_to_note] {:?}", outcome);
                }
                Err(e) => {
                    log::warn!("[recall.spec_to_note] harvest failed: {}", e);
                }
            }
        });
    }

    Ok(full_path)
}

/// Implementation half of [`save_spec_document`], free of Tauri State so
/// unit tests can call it directly. The Recall integration is in the
/// thin Tauri wrapper above; no behaviour change vs the pre-Phase-4
/// implementation lives here.
pub async fn save_spec_document_impl(
    project_path: String,
    filename: String,
    content: String,
    overwrite: bool,
) -> Result<String, String> {
    let specs_dir = Path::new(&project_path).join("docs").join("specs");
    std::fs::create_dir_all(&specs_dir)
        .map_err(|e| format!("Failed to create docs/specs/: {}", e))?;

    let file_path = specs_dir.join(&filename);

    if !overwrite && file_path.exists() {
        return Err(format!("File already exists: {}", filename));
    }

    std::fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write spec: {}", e))?;

    let full_path = file_path.display().to_string();
    info!("Saved spec document: {}", full_path);
    Ok(full_path)
}

#[tauri::command]
pub async fn list_spec_documents(
    project_path: String,
) -> Result<Vec<SpecDocumentInfo>, String> {
    let specs_dir = Path::new(&project_path).join("docs").join("specs");

    if !specs_dir.exists() {
        return Ok(Vec::new());
    }

    let mut specs = Vec::new();
    let entries = std::fs::read_dir(&specs_dir)
        .map_err(|e| format!("Failed to read docs/specs/: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();

        if !name.ends_with(".md") {
            continue;
        }

        let metadata = std::fs::metadata(&path).ok();
        let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_at = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| {
                        chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default()
                    })
            })
            .unwrap_or_default();

        // Extract title from first # heading
        let title = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| {
                content.lines().find_map(|line| {
                    let trimmed = line.trim();
                    if trimmed.starts_with("# ") {
                        Some(trimmed.trim_start_matches("# ").to_string())
                    } else {
                        None
                    }
                })
            })
            .unwrap_or_else(|| name.trim_end_matches(".md").replace('-', " "));

        specs.push(SpecDocumentInfo {
            filename: name,
            title,
            modified_at,
            size_bytes,
            path: path.display().to_string(),
        });
    }

    // Sort by modified time descending (newest first)
    specs.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(specs)
}

#[tauri::command]
pub async fn read_spec_document(
    project_path: String,
    filename: String,
) -> Result<String, String> {
    let file_path = Path::new(&project_path).join("docs").join("specs").join(&filename);
    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read spec: {}", e))
}

#[tauri::command]
pub async fn delete_spec_document(
    project_path: String,
    filename: String,
) -> Result<(), String> {
    let file_path = Path::new(&project_path).join("docs").join("specs").join(&filename);
    std::fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete spec: {}", e))?;
    info!("Deleted spec document: {}", filename);
    Ok(())
}

// ── Read project files (for AI file request markers) ──────────────────

#[tauri::command]
pub async fn read_project_files(
    project_path: String,
    file_paths: Vec<String>,
    max_lines: Option<usize>,
) -> Result<Vec<FileReadResult>, String> {
    let max_lines = max_lines.unwrap_or(150);
    let project = Path::new(&project_path);

    // Enforce maximum 5 files per request
    let paths_to_read: Vec<&String> = file_paths.iter().take(5).collect();
    let mut results = Vec::new();

    for rel_path in paths_to_read {
        let file_path = project.join(rel_path);

        // Path traversal protection: resolved path must be under project root
        let canonical_project = match project.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                results.push(FileReadResult {
                    path: rel_path.clone(),
                    found: false,
                    content: None,
                    total_lines: 0,
                    truncated: false,
                });
                continue;
            }
        };
        let canonical_file = match file_path.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                results.push(FileReadResult {
                    path: rel_path.clone(),
                    found: false,
                    content: None,
                    total_lines: 0,
                    truncated: false,
                });
                continue;
            }
        };
        if !canonical_file.starts_with(&canonical_project) {
            warn!(
                "read_project_files: path traversal blocked for {}",
                rel_path
            );
            results.push(FileReadResult {
                path: rel_path.clone(),
                found: false,
                content: None,
                total_lines: 0,
                truncated: false,
            });
            continue;
        }

        match std::fs::read_to_string(&file_path) {
            Ok(content) => {
                let all_lines: Vec<&str> = content.lines().collect();
                let total_lines = all_lines.len();
                let truncated = total_lines > max_lines;
                let visible: String = all_lines
                    .iter()
                    .take(max_lines)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                results.push(FileReadResult {
                    path: rel_path.clone(),
                    found: true,
                    content: Some(visible),
                    total_lines,
                    truncated,
                });
            }
            Err(_) => {
                results.push(FileReadResult {
                    path: rel_path.clone(),
                    found: false,
                    content: None,
                    total_lines: 0,
                    truncated: false,
                });
            }
        }
    }

    Ok(results)
}

// ── Context gathering for feature mode ─────────────────────────────────

#[tauri::command]
pub async fn gather_spec_context(
    state: tauri::State<'_, crate::agents::claude_code::session::AppState>,
    project_path: String,
) -> Result<String, String> {
    let assembled = gather_spec_context_impl(project_path.clone()).await?;

    // RECALL-SPEC §9.2.1: append a Recall Context section so the
    // spec-generation LLM sees prior decisions / landmines / patterns
    // for the files it's about to touch. Recall failures fall through
    // to the un-augmented context — spec generation must never be
    // blocked by the memory layer.
    let settings_recall_enabled = crate::commands::settings::get_settings()
        .map(|s| s.recall.enabled && s.recall.mode != crate::recall::config::RecallMode::Off)
        .unwrap_or(false);
    if !settings_recall_enabled {
        return Ok(assembled);
    }
    let detected_paths = extract_session_plan_paths(&assembled);
    let detected_paths = crate::recall::specwriter::context_section::relevant_paths(&detected_paths);
    match crate::recall::specwriter::context_section::append_section(
        &state.database,
        std::path::Path::new(&project_path),
        &assembled,
        &detected_paths,
    ) {
        Ok(augmented) => Ok(augmented),
        Err(e) => {
            log::warn!("[recall.gather_spec_context] append failed: {}", e);
            Ok(assembled)
        }
    }
}

/// Implementation half of [`gather_spec_context`], free of Tauri State.
/// This is the existing behaviour from before Phase 4 — every test
/// that called the Tauri command directly now goes through this.
pub async fn gather_spec_context_impl(
    project_path: String,
) -> Result<String, String> {
    let project = Path::new(&project_path);
    let mut sections: Vec<String> = Vec::new();

    let project_name = project
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    sections.push(format!("Project: {}\nPath: {}", project_name, project_path));

    // 1. Framework detection
    let framework = detect_framework(project);
    sections.push(format!("Framework: {}", framework));

    // 2. Package manager detection (from lock files)
    let pkg_manager = if project.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if project.join("yarn.lock").exists() {
        "yarn"
    } else if project.join("bun.lockb").exists() || project.join("bun.lock").exists() {
        "bun"
    } else if project.join("package-lock.json").exists() {
        "npm"
    } else {
        "unknown"
    };
    sections.push(format!("Package Manager: {}", pkg_manager));

    // 3. CLAUDE.md (first 100 lines)
    let claude_md = project.join("CLAUDE.md");
    if claude_md.exists() {
        if let Ok(content) = std::fs::read_to_string(&claude_md) {
            let lines: Vec<&str> = content.lines().collect();
            let truncated: String = lines.iter().take(100).cloned().collect::<Vec<_>>().join("\n");
            if lines.len() > 100 {
                sections.push(format!(
                    "CLAUDE.md (first 100 of {} lines):\n{}\n[CLAUDE.md truncated — request full file with 📂 REQUEST_FILES if needed]",
                    lines.len(),
                    truncated
                ));
            } else {
                sections.push(format!("CLAUDE.md:\n{}", truncated));
            }
        }
    } else {
        sections.push("CLAUDE.md: not found".to_string());
    }

    // 4. Package.json dependencies (names only, no versions)
    let pkg_path = project.join("package.json");
    if pkg_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pkg_path) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                let mut deps = Vec::new();
                if let Some(d) = pkg.get("dependencies").and_then(|v| v.as_object()) {
                    for key in d.keys() {
                        deps.push(key.clone());
                    }
                }
                if !deps.is_empty() {
                    deps.sort();
                    sections.push(format!("Dependencies ({}):\n  {}", deps.len(), deps.join(", ")));
                }

                let mut dev_deps = Vec::new();
                if let Some(d) = pkg.get("devDependencies").and_then(|v| v.as_object()) {
                    for key in d.keys() {
                        dev_deps.push(key.clone());
                    }
                }
                if !dev_deps.is_empty() {
                    dev_deps.sort();
                    sections.push(format!(
                        "Dev Dependencies ({}):\n  {}",
                        dev_deps.len(),
                        dev_deps.join(", ")
                    ));
                }
            }
        }
    }

    // 5. Route detection
    let mut routes = Vec::new();
    find_routes_recursive(
        project,
        &[
            "page.tsx",
            "page.ts",
            "page.jsx",
            "page.js",
            "route.tsx",
            "route.ts",
            "+page.svelte",
        ],
        &mut routes,
        project,
    );
    if !routes.is_empty() {
        routes.sort();
        let route_lines: Vec<String> =
            routes.iter().take(30).map(|r| format!("  {}", r)).collect();
        let suffix = if routes.len() > 30 {
            format!("\n  ... and {} more", routes.len() - 30)
        } else {
            String::new()
        };
        sections.push(format!(
            "Routes ({}):\n{}{}",
            routes.len(),
            route_lines.join("\n"),
            suffix
        ));
    }

    // 6. Component inventory (2 levels deep, names only)
    let components_dir = project.join("src").join("components");
    if components_dir.exists() {
        let mut component_files = Vec::new();
        list_files_shallow(&components_dir, 2, &mut component_files, &components_dir);
        if !component_files.is_empty() {
            component_files.sort();
            let limited: Vec<&String> = component_files.iter().take(50).collect();
            let suffix = if component_files.len() > 50 {
                format!("\n  ... and {} more", component_files.len() - 50)
            } else {
                String::new()
            };
            sections.push(format!(
                "Components ({}):\n  {}{}",
                component_files.len(),
                limited
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join("\n  "),
                suffix
            ));
        }
    }

    // 7. Hooks inventory
    for hooks_dir_name in &["src/hooks", "src/lib/hooks"] {
        let hooks_dir = project.join(hooks_dir_name);
        if hooks_dir.exists() {
            let mut hook_files = Vec::new();
            list_files_shallow(&hooks_dir, 1, &mut hook_files, &hooks_dir);
            if !hook_files.is_empty() {
                hook_files.sort();
                sections.push(format!("Hooks:\n  {}", hook_files.join("\n  ")));
            }
            break;
        }
    }

    // 8. Store inventory
    for store_dir_name in &["src/stores", "src/store", "src/lib/stores"] {
        let store_dir = project.join(store_dir_name);
        if store_dir.exists() {
            let mut store_files = Vec::new();
            list_files_shallow(&store_dir, 1, &mut store_files, &store_dir);
            if !store_files.is_empty() {
                store_files.sort();
                sections.push(format!("Stores:\n  {}", store_files.join("\n  ")));
            }
            break;
        }
    }

    // 9. Type definitions inventory
    for types_dir_name in &["src/types", "src/lib/types"] {
        let types_dir = project.join(types_dir_name);
        if types_dir.exists() {
            let mut type_files = Vec::new();
            list_files_shallow(&types_dir, 1, &mut type_files, &types_dir);
            if !type_files.is_empty() {
                type_files.sort();
                sections.push(format!("Type Definitions:\n  {}", type_files.join("\n  ")));
            }
            break;
        }
    }

    // 10. Existing specs
    let specs_dir = project.join("docs").join("specs");
    if specs_dir.exists() {
        let mut spec_summaries = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&specs_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    let title = std::fs::read_to_string(&path)
                        .ok()
                        .and_then(|c| {
                            c.lines().find_map(|l| {
                                let t = l.trim();
                                if t.starts_with("# ") {
                                    Some(t.trim_start_matches("# ").to_string())
                                } else {
                                    None
                                }
                            })
                        })
                        .unwrap_or_else(|| {
                            path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("")
                                .to_string()
                        });
                    spec_summaries.push(format!(
                        "  {} — {}",
                        path.file_name().and_then(|n| n.to_str()).unwrap_or(""),
                        title
                    ));
                }
            }
        }
        if !spec_summaries.is_empty() {
            sections.push(format!(
                "Existing Specs (in docs/specs/):\n{}",
                spec_summaries.join("\n")
            ));
        }
    }

    // 11. Last 3 git commit summaries
    if project.join(".git").exists() {
        if let Ok(output) = Command::new("git")
            .args(["log", "--oneline", "-3"])
            .current_dir(project)
            .output()
        {
            if output.status.success() {
                let log = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !log.is_empty() {
                    sections.push(format!("Recent Commits:\n  {}", log.replace('\n', "\n  ")));
                }
            }
        }
    }

    Ok(sections.join("\n\n"))
}

fn detect_framework(project: &Path) -> String {
    let indicators = [
        ("next.config.ts", "Next.js"),
        ("next.config.js", "Next.js"),
        ("next.config.mjs", "Next.js"),
        ("vite.config.ts", "Vite"),
        ("vite.config.js", "Vite"),
        ("astro.config.mjs", "Astro"),
        ("nuxt.config.ts", "Nuxt"),
        ("svelte.config.js", "SvelteKit"),
        ("angular.json", "Angular"),
        ("Cargo.toml", "Rust"),
        ("pyproject.toml", "Python"),
        ("requirements.txt", "Python"),
        ("go.mod", "Go"),
    ];

    for (file, framework) in &indicators {
        if project.join(file).exists() {
            return framework.to_string();
        }
    }

    "Unknown".to_string()
}

fn find_routes_recursive(dir: &Path, patterns: &[&str], routes: &mut Vec<String>, base: &Path) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if path.is_dir() {
            if matches!(name, "node_modules" | ".git" | "dist" | ".next" | "target" | "__pycache__" | "build") {
                continue;
            }
            find_routes_recursive(&path, patterns, routes, base);
        } else if patterns.contains(&name) {
            if let Ok(relative) = path.strip_prefix(base) {
                routes.push(relative.display().to_string());
            }
        }
    }
}

// ── CLAUDE.md Verification Workflow Integration ────────────────────────

#[tauri::command]
pub async fn add_verification_workflow_to_claude_md(
    project_path: String,
) -> Result<String, String> {
    let claude_md_path = Path::new(&project_path).join("CLAUDE.md");

    let workflow_section = r#"

## SpecWriter Verification Workflow

When implementing a spec from docs/specs/:
1. Read the spec file (e.g., docs/specs/feature-name.md)
2. Implement all items in the Implementation Checklist (Section 9)
3. When done, BEFORE saying you're finished:
   - Check if a matching .audit.md file exists (e.g., docs/specs/feature-name.audit.md)
   - If yes, read it and run the verification audit
   - For each VERIFY directive, open the actual file and read the code
   - Report PASS/FAIL for each item
   - Fix all failures
   - Only then say "Implementation complete"
4. Never skip step 3. The verification audit catches issues that the implementation checklist misses.
5. Dual-side rule for cross-system calls (HTTP, DB, Edge Function, queue, external API):
   Before marking PASS on any item that crosses a system boundary, verify BOTH
   the caller code AND the handler code actually exist, then run a real
   non-mocked invocation and quote the output. A passing mocked test is NOT
   sufficient — it only proves the caller can build a request, not that the
   handler accepts it. If the handler does not exist yet, or if the file
   contains markers like "until then … will return an error",
   "NotImplementedError", "unknown action", or "TODO: implement", the item
   is FAIL regardless of test status. Self-Drive runs a static ripgrep
   parity check on declared cross-system actions; it will refuse to advance
   a session if any action is missing its handler.
6. Recommended CI step (optional but strongly advised): add a job that
   greps producer-side action names and verifies each one has a handler
   dispatch branch on the server. Fail the build on unpaired actions. This
   prevents the exact failure mode where mocked tests pass while the real
   handler is unimplemented (the "handlers land in a later session — until
   then these calls will fail at runtime" pattern).
"#;

    // Read existing CLAUDE.md content (or empty if doesn't exist)
    let existing_content = if claude_md_path.exists() {
        std::fs::read_to_string(&claude_md_path)
            .map_err(|e| format!("Failed to read CLAUDE.md: {}", e))?
    } else {
        String::new()
    };

    // Dedup check: if section already exists, don't add again
    if existing_content.contains("## SpecWriter Verification Workflow") {
        return Ok("already_exists".to_string());
    }

    // Append the section to the end of CLAUDE.md
    let new_content = if existing_content.is_empty() {
        format!("# CLAUDE.md\n{}", workflow_section)
    } else {
        format!("{}\n{}", existing_content.trim_end(), workflow_section)
    };

    std::fs::write(&claude_md_path, new_content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;

    info!("Added SpecWriter Verification Workflow to CLAUDE.md at {:?}", claude_md_path);

    Ok("added".to_string())
}

// ── Cross-system action parity check ───────────────────────────────────
//
// The "mock-only PASS" failure mode we're trying to prevent: a caller
// writes `client.call("insert_foo", …)` and its tests pass because the
// HTTP client is mocked — but the server-side handler for "insert_foo"
// was never implemented. In production, every call errors. Section 10
// of the spec declares the contract (action → handler path); this
// command walks that contract and ripgreps BOTH sides. If either side
// lacks the action string, Self-Drive must refuse to mark the session
// done regardless of what the verifier text claimed.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionParityRequest {
    /// The action name issued by the caller (e.g. "insert_note_classification").
    pub action: String,
    /// Single caller path (legacy field). Either this OR `caller_paths` must
    /// be set; both being non-empty is allowed and the two are unioned at
    /// check time. Empty string means "use caller_paths only".
    #[serde(default)]
    pub caller_path: String,
    /// Multiple caller paths — preferred. The action/wire is considered
    /// found if it appears in ANY of these (file or directory). Self-Drive
    /// populates this with every distinct directory across the session's
    /// declared files so the gate doesn't false-positive when the call
    /// site lives in a sibling directory.
    #[serde(default)]
    pub caller_paths: Vec<String>,
    /// Path the handler code lives under (file or directory). Absolute or relative to project root.
    pub handler_path: String,
    /// Optional on-the-wire identifier. When present and non-empty, the
    /// grep needle becomes this value instead of `action` — useful when
    /// the JS function name and the URL slug / edge-function name differ
    /// (e.g. `action: "resolve_checkpoint"` but the actual wire string is
    /// `"hitl-respond"`). Defaults to `action` when None or empty.
    #[serde(default)]
    pub wire: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionParityResult {
    pub action: String,
    /// true if the caller_path contains the action string somewhere.
    pub caller_present: bool,
    /// true if the handler_path contains the action string somewhere.
    pub handler_present: bool,
    /// true if handler_path exists on disk and contains no stub markers
    /// ("until then", "NotImplementedError", "unknown action", "TODO: implement",
    ///  "return 501", "pass  # stub").
    pub handler_stub_free: bool,
    /// Overall status: PASS iff caller_present && handler_present && handler_stub_free.
    pub status: String,
    /// Human-readable detail for display in the UI. Short — one sentence.
    pub detail: String,
}

/// Run a static handshake-parity check across declared cross-system actions.
///
/// For each declared row, this command:
///   1. ripgreps every caller path (`caller_path` and/or `caller_paths`)
///      for the needle — PASS if at least one path contains it.
///   2. ripgreps `handler_path` for the needle — must match.
///   3. ripgreps `handler_path` for stub markers — must NOT match.
///
/// The needle is `wire` when present and non-empty, otherwise `action`.
///
/// Returns one `ActionParityResult` per input, in the same order. The
/// caller (Self-Drive) decides whether to block session completion; this
/// command intentionally does not fail itself on a missing handler.
#[tauri::command]
pub async fn verify_action_parity(
    state: tauri::State<'_, crate::agents::claude_code::session::AppState>,
    project_root: String,
    actions: Vec<ActionParityRequest>,
) -> Result<Vec<ActionParityResult>, String> {
    // We need the request alongside the result for the landmine
    // harvest below, so call the wider helper and split.
    let paired = verify_action_parity_paired(&project_root, actions).await?;
    let results: Vec<ActionParityResult> = paired.iter().map(|(_, r)| r.clone()).collect();

    // RECALL-SPEC §9.2.6: each FAIL row with a stub-marker detail
    // becomes a landmine note via the Harvester. The note's
    // source_paths span both caller and handler so the next
    // gather_spec_context covering either side surfaces it. Skipped
    // entirely when Recall is off. Failures inside the harvest path
    // are logged, not surfaced — Recall must never block the
    // verification flow.
    let settings_recall_enabled = crate::commands::settings::get_settings()
        .map(|s| s.recall.enabled && s.recall.mode != crate::recall::config::RecallMode::Off)
        .unwrap_or(false);
    if settings_recall_enabled {
        let db = state.database.clone();
        let project = std::path::PathBuf::from(&project_root);
        tokio::spawn(async move {
            for (req, result) in paired {
                if result.status == "PASS" {
                    continue;
                }
                let callers: Vec<String> = {
                    let mut v: Vec<String> = Vec::new();
                    if !req.caller_path.trim().is_empty() {
                        v.push(req.caller_path.clone());
                    }
                    for p in &req.caller_paths {
                        if !p.trim().is_empty() && !v.iter().any(|x| x == p) {
                            v.push(p.clone());
                        }
                    }
                    v
                };
                let fail = crate::recall::specwriter::parity_to_landmine::ParityFail {
                    action: &req.action,
                    caller_paths: &callers,
                    handler_path: &req.handler_path,
                    detail: &result.detail,
                    spec_note_id: None,
                };
                match crate::recall::specwriter::parity_to_landmine::landmine_from_fail(
                    &db, &project, &fail,
                ) {
                    Ok(outcome) => log::info!("[recall.parity_to_landmine] {:?}", outcome),
                    Err(e) => log::warn!("[recall.parity_to_landmine] failed: {}", e),
                }
            }
        });
    }

    Ok(results)
}

/// Implementation half of [`verify_action_parity`], free of Tauri State.
/// Matches the original public shape (returns `Vec<ActionParityResult>`)
/// so existing tests keep working with one identifier-rename edit.
pub async fn verify_action_parity_impl(
    project_root: String,
    actions: Vec<ActionParityRequest>,
) -> Result<Vec<ActionParityResult>, String> {
    let paired = verify_action_parity_paired(&project_root, actions).await?;
    Ok(paired.into_iter().map(|(_, r)| r).collect())
}

/// Wider helper used by the Tauri wrapper to keep the input alongside
/// each result — needed for the Recall landmine harvest. Tests can
/// call the simpler [`verify_action_parity_impl`] above.
async fn verify_action_parity_paired(
    project_root: &str,
    actions: Vec<ActionParityRequest>,
) -> Result<Vec<(ActionParityRequest, ActionParityResult)>, String> {
    let root = Path::new(project_root);
    if !root.is_dir() {
        return Err(format!("project_root is not a directory: {}", project_root));
    }
    let mut paired = Vec::with_capacity(actions.len());
    for req in actions {
        let result = check_one_action(root, &req);
        paired.push((req, result));
    }
    Ok(paired)
}

fn check_one_action(root: &Path, req: &ActionParityRequest) -> ActionParityResult {
    // Needle: wire when set and non-empty, else action. This lets the spec
    // declare a friendly action label distinct from the on-the-wire string
    // — important because the static grep is fixed-substring and the actual
    // call site may only carry the URL slug, not the verb name.
    let has_wire = req
        .wire
        .as_deref()
        .is_some_and(|s| !s.trim().is_empty());
    let needle: String = req
        .wire
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(req.action.as_str())
        .to_string();

    // Union the two caller-path inputs, dedup, drop empties. The legacy
    // single field is kept so older callers / DB rows / Tauri shims still
    // work without modification; new callers populate `caller_paths`.
    let mut caller_inputs: Vec<String> = Vec::new();
    if !req.caller_path.trim().is_empty() {
        caller_inputs.push(req.caller_path.clone());
    }
    for p in &req.caller_paths {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !caller_inputs.iter().any(|existing| existing == p) {
            caller_inputs.push(p.clone());
        }
    }
    // Last-resort: no caller paths declared at all → scan project root.
    // Expensive but correct, and matches the prior fallback behaviour.
    if caller_inputs.is_empty() {
        caller_inputs.push(".".to_string());
    }

    let caller_present = caller_inputs
        .iter()
        .any(|p| rg_has_match(&resolve_under(root, p), &needle));

    let handler_path = resolve_under(root, &req.handler_path);
    let handler_present = rg_has_match(&handler_path, &needle);

    // Stub scan only matters when the handler path actually exists.
    // An absent handler is already a fail; no point searching its files.
    let handler_stub_free = if handler_path.exists() {
        !rg_has_match(
            &handler_path,
            "until then|raise NotImplementedError|TODO: implement|unknown action|pass  # stub|return 501",
        )
    } else {
        false
    };

    let needle_label = if has_wire { "wire" } else { "action" };
    let wire_suffix = if has_wire {
        format!(" (wire for action '{}')", req.action)
    } else {
        String::new()
    };

    let pass = caller_present && handler_present && handler_stub_free;
    let detail = if pass {
        format!(
            "caller + handler both reference '{}' and handler is stub-free{}",
            needle, wire_suffix
        )
    } else if !caller_present {
        format!(
            "no caller path in [{}] references {} '{}'",
            caller_inputs.join(", "),
            needle_label,
            needle
        )
    } else if !handler_present {
        format!(
            "handler path '{}' does not reference {} '{}' — the other side of this call has not been implemented",
            req.handler_path, needle_label, needle
        )
    } else {
        format!(
            "handler path '{}' contains a stub/NotImplemented/unknown-action marker — implementation is incomplete",
            req.handler_path
        )
    };

    ActionParityResult {
        action: req.action.clone(),
        caller_present,
        handler_present,
        handler_stub_free,
        status: if pass { "PASS".to_string() } else { "FAIL".to_string() },
        detail,
    }
}

fn resolve_under(root: &Path, relative_or_abs: &str) -> std::path::PathBuf {
    // Strip any "::symbol" suffix first — only the file/dir path is rg-able.
    let path_only = relative_or_abs
        .split("::")
        .next()
        .unwrap_or(relative_or_abs);
    let p = Path::new(path_only);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        root.join(p)
    }
}

/// Return true iff any file under `path` contains at least one of the
/// fixed-string alternates in `pattern` (alternates separated by `|`).
///
/// Implemented in pure Rust — not via an `rg` subprocess — because the
/// production environment cannot guarantee ripgrep is on PATH, and this
/// check must never silently pass just because a tool is missing. Pure
/// Rust also means the logic is testable and deterministic.
///
/// Skips common noise dirs (node_modules, .git, dist, build, target,
/// __pycache__) and binary-like files (>2 MB or content containing a
/// NUL byte in the first 8KiB). Binary skipping matters because source
/// trees sometimes include vendored .sqlite/.so files, which we don't
/// want to scan.
fn rg_has_match(path: &Path, pattern: &str) -> bool {
    if !path.exists() {
        return false;
    }
    let needles: Vec<&str> = pattern.split('|').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if needles.is_empty() {
        return false;
    }
    scan_for_any(path, &needles)
}

fn scan_for_any(path: &Path, needles: &[&str]) -> bool {
    if path.is_file() {
        return file_contains_any(path, needles);
    }
    if !path.is_dir() {
        return false;
    }
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let child = entry.path();
        let name = child.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if child.is_dir() {
            if matches!(
                name,
                "node_modules"
                    | ".git"
                    | "dist"
                    | "build"
                    | "target"
                    | "__pycache__"
                    | ".next"
                    | ".venv"
            ) {
                continue;
            }
            if scan_for_any(&child, needles) {
                return true;
            }
        } else if child.is_file() && file_contains_any(&child, needles) {
            return true;
        }
    }
    false
}

fn file_contains_any(path: &Path, needles: &[&str]) -> bool {
    const MAX_BYTES: u64 = 2 * 1024 * 1024;
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if meta.len() > MAX_BYTES {
        return false;
    }
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return false,
    };
    // Cheap binary sniff — a NUL in the first 8KiB → treat as binary.
    let sniff_end = bytes.len().min(8192);
    if bytes[..sniff_end].contains(&0) {
        return false;
    }
    let text = match std::str::from_utf8(&bytes) {
        Ok(t) => t,
        Err(_) => return false,
    };
    needles.iter().any(|n| text.contains(n))
}

fn list_files_shallow(dir: &Path, max_depth: usize, files: &mut Vec<String>, base: &Path) {
    if max_depth == 0 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if path.is_dir() {
            if matches!(name, "node_modules" | ".git" | "dist" | "build") {
                continue;
            }
            list_files_shallow(&path, max_depth - 1, files, base);
        } else {
            if let Ok(relative) = path.strip_prefix(base) {
                files.push(relative.display().to_string());
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// recover_session_plan — AI-powered Recognize Guide fallback.
//
// The frontend's `parseSessionPlan` is a pure regex parser. It handles
// well-formed specs (≈95% of LLM output) fast and free. When it fails — most
// commonly because a single Session block is missing its
// `**Prompt for Claude Code:**` fence label — we don't want the user staring
// at a red error toast for a thirteen-session guide that's otherwise
// completely usable. We hand the spec back to whichever LLM the user has
// configured for SpecWriter, with a tightly-scoped repair prompt, and let
// it canonicalize the Session Plan section. The frontend re-parses the
// result. If recovery succeeds it surfaces a yellow "auto-recovered" toast;
// if even recovery fails it falls back to the original red error with both
// diagnoses attached.
//
// Provider selection mirrors SpecWriter's existing settings — we don't add
// new configuration. If the user is on the Claude Code CLI provider (no API
// key), the recovery refuses with a clear message rather than silently
// hanging or burning credits.
// ─────────────────────────────────────────────────────────────────────────

/// System prompt for the recovery call. Tight, repair-only — the model
/// MUST NOT invent steps, only restore canonical formatting.
const RECOVERY_SYSTEM_PROMPT: &str = r#"You repair multi-session implementation specs whose Session Plan section failed a strict regex parser.

PREFERRED OUTPUT — a structured JSON envelope (regex-free, most reliable). Return ONLY a fenced code block whose first line is exactly `<!-- SESSION-PLAN-JSON -->`, followed by a JSON object of shape:
{"title":"<spec title>","sessions":[{"title":"<short title>","prompt":"<full instruction Claude Code should receive to implement this session>","scope":"<optional>","readSections":"<optional>","files":["path/one.ts"],"verify":["<check>"]}]}
One entry per implementable session, in order. `prompt` is REQUIRED and must be concrete and self-contained. Skip pure gates (Phase 0) and audit-only wrap-ups; include every session that ships code. Derive each prompt from the spec's existing Scope / Read sections / Files — do NOT invent work.

FALLBACK OUTPUT — if you cannot produce the envelope, return the FULL spec markdown with the Session Plan section made parseable instead. You do this by ensuring every implementable Session block contains a `**Prompt for Claude Code:**` label followed by a fenced code block. You preserve everything else verbatim.

Rules — every single one is non-negotiable:
1. Preserve every byte of content outside the Session Plan section. The `#` title, Overview, Data Model, all other sections — return them exactly as given.
2. Inside the Session Plan, preserve every Session's existing Scope, Read sections, Files, Verification Prompt, Verify-before-next-session checklist, Cross-system actions, etc. Do not paraphrase. Do not reorder. Do not renumber.
3. For every Session that lacks a `**Prompt for Claude Code:**` fenced code block, SYNTHESIZE one by composing the existing Scope + Read sections + Files into a concrete instruction Claude Code can execute. Use this template:

   **Prompt for Claude Code:**
   ```
   Read docs/specs/<filename> — ONLY: <Read sections content>.

   <Scope content rewritten as imperative instruction>

   Files:
   - <file 1> (<create|modify>)
   - <file 2> ...

   <Verification Prompt body, if present, prefixed with "When done, verify with:">

   Scope = deliverables, not file fences (fix upstream when required, no silent workarounds).
   ```

4. If a Session block is a final audit wrap-up (it has `**Verify (full audit):**`), leave it alone — the parser handles those.
5. If a Session block is a wrapper for sub-sessions like 1a/1b/1c, add `**Indivisible note:** This session is split into Na/Nb/Nc — see those entries.` to its body so the parser skips it. Do not invent a Prompt for Claude Code for a wrapper.
6. Do not invent files, do not invent steps, do not invent acceptance criteria. If a Session is so empty you can't synthesize a reasonable prompt from its existing content, leave it as-is and let the parser fail loudly — silent fabrication is worse than a visible error.
7. Return ONLY the raw markdown (or, if you chose the PREFERRED JSON envelope, only that one fenced block). No commentary. No "Here is the repaired spec:" preamble. Just the bytes.
"#;

/// Build the user prompt for a recovery call. The diagnosis text comes
/// straight from the frontend's `diagnoseSessionPlanFailure` so the model
/// knows exactly which Session the regex parser tripped on.
/// Sweep a spec for path-shaped tokens — used by recover_session_plan
/// to drive the Recall landmine lookup. Best-effort; the landmine
/// block is decoration, not gating.
fn extract_session_plan_paths(spec: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    // 1) Backtick-quoted spans likely to be paths.
    for (i, span) in spec.split('`').enumerate() {
        if i % 2 == 1 && looks_path_like(span.trim()) {
            let p = span.trim().to_string();
            if seen.insert(p.clone()) {
                out.push(p);
            }
        }
    }
    // 2) Bare path tokens.
    for raw in spec.split(|c: char| {
        c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')' | '<' | '>' | '"' | '`')
    }) {
        let trimmed = raw.trim_matches(|c: char| matches!(c, '.' | ':' | '[' | ']' | '{' | '}'));
        if looks_path_like(trimmed) && seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn looks_path_like(s: &str) -> bool {
    if s.len() < 3 || !s.contains('/') {
        return false;
    }
    if s.contains("://") || s.starts_with("http") {
        return false;
    }
    // Has either a known extension or a recognized prefix.
    const PFX: &[&str] = &[
        "./", "../", "src/", "tests/", "docs/", "supabase/", "src-tauri/",
        "components/", "hooks/", "api/", "server/", "client/", "config/",
        "migrations/",
    ];
    if s.starts_with('/') || PFX.iter().any(|p| s.starts_with(p)) {
        return true;
    }
    if let Some(ext) = s.rsplit('.').next() {
        matches!(
            ext,
            "rs" | "ts" | "tsx" | "js" | "jsx" | "json" | "toml" | "yaml" | "yml"
                | "md" | "py" | "go" | "sql" | "html" | "css" | "scss"
        )
    } else {
        false
    }
}

fn build_recovery_prompt(spec_markdown: &str, diagnosis: &str, filename: &str) -> String {
    format!(
        "The Session Plan in the spec below failed to parse. The parser said:\n\n\
         {diagnosis}\n\n\
         Spec filename (use this verbatim in any synthesized `Read docs/specs/<filename>` instructions): `{filename}`\n\n\
         Return the FULL spec markdown with the Session Plan section repaired per the system prompt rules.\n\n\
         ─── SPEC START ───\n\
         {spec_markdown}\n\
         ─── SPEC END ───",
        diagnosis = diagnosis,
        filename = filename,
        spec_markdown = spec_markdown,
    )
}

/// Recovery uses a much higher token budget than changelog summaries —
/// Session Plan sections regularly exceed 10 KB and we return the full
/// spec body, not just the repaired section. 32k is safe for every
/// provider we support; the response is bounded by the input length.
const RECOVERY_MAX_TOKENS: u32 = 32_000;

async fn call_anthropic_long(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    // Anthropic deprecated `temperature` for newer models; the repair
    // task is determinism-friendly anyway.
    let body = serde_json::json!({
        "model": model,
        "max_tokens": RECOVERY_MAX_TOKENS,
        "system": system_prompt,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let snip = if text.len() > 500 { &text[..500] } else { &text };
        return Err(format!("Anthropic API error {}: {}", status, snip));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Anthropic response parse failed: {}", e))?;

    json["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in Anthropic response".to_string())
}

async fn call_openai_long(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    // No `temperature` — GPT-5 family / reasoning models reject it.
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "max_completion_tokens": RECOVERY_MAX_TOKENS
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let snip = if text.len() > 500 { &text[..500] } else { &text };
        return Err(format!("OpenAI API error {}: {}", status, snip));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("OpenAI response parse failed: {}", e))?;

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in OpenAI response".to_string())
}

async fn call_gemini_long(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );

    // Gemini accepts temperature; keep it low for deterministic repair.
    let body = serde_json::json!({
        "system_instruction": { "parts": [{"text": system_prompt}] },
        "contents": [{ "parts": [{"text": prompt}] }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": RECOVERY_MAX_TOKENS,
        }
    });

    let resp = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let snip = if text.len() > 500 { &text[..500] } else { &text };
        return Err(format!("Gemini API error {}: {}", status, snip));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Gemini response parse failed: {}", e))?;

    json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in Gemini response".to_string())
}

async fn call_openrouter_long(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "max_completion_tokens": RECOVERY_MAX_TOKENS
    });

    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(api_key)
        .header("HTTP-Referer", "https://codemantis.app")
        .header("X-Title", "CodeMantis")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenRouter request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let snip = if text.len() > 500 { &text[..500] } else { &text };
        return Err(format!("OpenRouter API error {}: {}", status, snip));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("OpenRouter response parse failed: {}", e))?;

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in OpenRouter response".to_string())
}

/// Strip a markdown-code-fence wrapper from a model response, if the model
/// disobeyed instruction #7 and wrapped the whole spec. Tolerates ``` or
/// ~~~ fences with optional language tag.
fn strip_fence_wrapper(text: &str) -> String {
    let trimmed = text.trim();
    let opens_with_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
    if !opens_with_fence {
        return trimmed.to_string();
    }
    // Find the first newline after the opening fence (skips the optional
    // language tag).
    let after_open = match trimmed.find('\n') {
        Some(i) => &trimmed[i + 1..],
        None => return trimmed.to_string(),
    };
    // Strip trailing fence — accept either backtick or tilde variants and
    // tolerate a trailing newline after the fence.
    let body = after_open.trim_end();
    let body = body
        .strip_suffix("```")
        .or_else(|| body.strip_suffix("~~~"))
        .unwrap_or(body);
    body.trim().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverSessionPlanResponse {
    pub recovered_markdown: String,
    pub provider: String,
    pub model: String,
}

/// Re-emit a spec whose Session Plan failed strict regex parsing into a
/// canonical form the parser will accept.
///
/// Provider strings accepted: `"anthropic"`, `"openai"`, `"gemini"`,
/// `"openrouter"`. The frontend routes the user's configured SpecWriter
/// provider here verbatim — there's no provider-specific logic above
/// dispatch.
///
/// Fails fast with a human-readable error string on:
///   - missing/empty `api_key` (user is on CLI provider, no API access)
///   - unknown provider name
///   - HTTP / parse errors from the provider
///   - empty model response
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn recover_session_plan(
    state: tauri::State<'_, crate::agents::claude_code::session::AppState>,
    spec_markdown: String,
    diagnosis: String,
    provider: String,
    api_key: String,
    model: String,
    filename: String,
    // Optional for backward compatibility with the existing frontend
    // call shape. When supplied, RECALL-SPEC §9.2.2 third bullet
    // kicks in: landmines covering paths the Session Plan touches
    // are prepended to the recovery user prompt so the model
    // synthesizes instructions that reference them.
    project_path: Option<String>,
) -> Result<RecoverSessionPlanResponse, String> {
    let landmine_block = project_path
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .and_then(|p| {
            let recall_enabled = crate::commands::settings::get_settings()
                .map(|s| s.recall.enabled
                    && s.recall.mode != crate::recall::config::RecallMode::Off)
                .unwrap_or(false);
            if !recall_enabled {
                return None;
            }
            let paths = extract_session_plan_paths(&spec_markdown);
            match crate::recall::specwriter::recovery_landmines::render_landmine_block(
                &state.database,
                std::path::Path::new(p),
                &paths,
            ) {
                Ok(block) if !block.is_empty() => Some(block),
                Ok(_) => None,
                Err(e) => {
                    log::warn!(
                        "[recall.recovery_landmines] render failed: {}; sending base prompt",
                        e
                    );
                    None
                }
            }
        });
    recover_session_plan_impl(
        spec_markdown, diagnosis, provider, api_key, model, filename, landmine_block,
    )
    .await
}

/// Implementation half of [`recover_session_plan`]. The Recall
/// landmine block (when present) is prepended to the recovery user
/// prompt; everything else matches the pre-Phase-4 behaviour.
#[allow(clippy::too_many_arguments)]
pub async fn recover_session_plan_impl(
    spec_markdown: String,
    diagnosis: String,
    provider: String,
    api_key: String,
    model: String,
    filename: String,
    landmine_block: Option<String>,
) -> Result<RecoverSessionPlanResponse, String> {
    if api_key.trim().is_empty() {
        return Err(
            "Guide auto-recovery needs an API key. Configure an API provider in \
             Settings → AI Providers, or fix the spec manually."
                .to_string(),
        );
    }
    if spec_markdown.trim().is_empty() {
        return Err("Spec markdown is empty — nothing to recover.".to_string());
    }

    let base = build_recovery_prompt(&spec_markdown, &diagnosis, &filename);
    let prompt = match landmine_block {
        Some(block) if !block.is_empty() => format!("{}\n\n{}", block, base),
        _ => base,
    };
    let client = reqwest::Client::new();

    let raw = match provider.as_str() {
        "anthropic" => {
            call_anthropic_long(&client, &api_key, &model, RECOVERY_SYSTEM_PROMPT, &prompt).await?
        }
        "openai" => {
            call_openai_long(&client, &api_key, &model, RECOVERY_SYSTEM_PROMPT, &prompt).await?
        }
        "gemini" => {
            call_gemini_long(&client, &api_key, &model, RECOVERY_SYSTEM_PROMPT, &prompt).await?
        }
        "openrouter" => {
            call_openrouter_long(&client, &api_key, &model, RECOVERY_SYSTEM_PROMPT, &prompt)
                .await?
        }
        other => return Err(format!("Unknown recovery provider: {}", other)),
    };

    let recovered = strip_fence_wrapper(&raw);
    if recovered.trim().is_empty() {
        return Err(format!(
            "{} returned an empty response — recovery cannot proceed.",
            provider
        ));
    }
    // Sanity: model must return something that *looks* like the same spec.
    // We don't want to silently accept a polite refusal or a completely
    // different document. Check the original title is still present.
    if let Some(title_line) = spec_markdown
        .lines()
        .find(|l| l.trim_start().starts_with("# "))
    {
        let title = title_line.trim();
        if !recovered.contains(title) {
            warn!(
                "[recover_session_plan] Model response missing original title `{}` — refusing to use it",
                title
            );
            return Err(format!(
                "{} returned a response that does not look like the original spec (missing title `{}`). \
                 Recovery aborted to avoid silent data loss.",
                provider, title
            ));
        }
    }

    info!(
        "[recover_session_plan] {} ({}) returned {} bytes; original was {} bytes",
        provider,
        model,
        recovered.len(),
        spec_markdown.len()
    );

    Ok(RecoverSessionPlanResponse {
        recovered_markdown: recovered,
        provider,
        model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn temp_dir() -> TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // ── save_spec_document ────────────────────────────────────────────────

    #[tokio::test]
    async fn save_spec_document_creates_file_and_returns_path() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        let result = save_spec_document_impl(
            project.clone(),
            "my-spec.md".to_string(),
            "# My Spec\n\nContent here.".to_string(),
            false,
        )
        .await;

        assert!(result.is_ok());
        let returned_path = result.unwrap();
        assert!(returned_path.ends_with("docs/specs/my-spec.md") || returned_path.contains("my-spec.md"));

        let spec_path = dir.path().join("docs").join("specs").join("my-spec.md");
        assert!(spec_path.exists());
        let content = fs::read_to_string(&spec_path).unwrap();
        assert_eq!(content, "# My Spec\n\nContent here.");
    }

    #[tokio::test]
    async fn save_spec_document_errors_on_existing_file_without_overwrite() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        // First write
        save_spec_document_impl(
            project.clone(),
            "spec.md".to_string(),
            "original".to_string(),
            false,
        )
        .await
        .unwrap();

        // Second write without overwrite flag
        let result = save_spec_document_impl(
            project.clone(),
            "spec.md".to_string(),
            "updated".to_string(),
            false,
        )
        .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists") || err.contains("spec.md"));

        // Original content preserved
        let spec_path = dir.path().join("docs").join("specs").join("spec.md");
        assert_eq!(fs::read_to_string(&spec_path).unwrap(), "original");
    }

    #[tokio::test]
    async fn save_spec_document_with_overwrite_replaces_existing() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        save_spec_document_impl(
            project.clone(),
            "spec.md".to_string(),
            "original".to_string(),
            false,
        )
        .await
        .unwrap();

        let result = save_spec_document_impl(
            project.clone(),
            "spec.md".to_string(),
            "updated content".to_string(),
            true,
        )
        .await;

        assert!(result.is_ok());
        let spec_path = dir.path().join("docs").join("specs").join("spec.md");
        assert_eq!(fs::read_to_string(&spec_path).unwrap(), "updated content");
    }

    // ── list_spec_documents ───────────────────────────────────────────────

    #[tokio::test]
    async fn list_spec_documents_returns_empty_for_nonexistent_dir() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        let result = list_spec_documents(project).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn list_spec_documents_finds_md_files_and_extracts_titles() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        // Create docs/specs directory and files
        let specs_dir = dir.path().join("docs").join("specs");
        fs::create_dir_all(&specs_dir).unwrap();

        fs::write(specs_dir.join("auth.md"), "# Authentication Flow\n\nDetails here.").unwrap();
        fs::write(specs_dir.join("payments.md"), "## No h1 heading\n\nContent.").unwrap();
        // Non-.md file should be excluded
        fs::write(specs_dir.join("notes.txt"), "should be ignored").unwrap();

        let result = list_spec_documents(project).await;
        assert!(result.is_ok());
        let docs = result.unwrap();

        assert_eq!(docs.len(), 2);

        // Auth spec: title extracted from # heading
        let auth = docs.iter().find(|d| d.filename == "auth.md").expect("auth.md missing");
        assert_eq!(auth.title, "Authentication Flow");

        // Payments spec: no # heading, falls back to filename stem
        let payments = docs.iter().find(|d| d.filename == "payments.md").expect("payments.md missing");
        assert_eq!(payments.title, "payments");
    }

    // ── read_spec_document ────────────────────────────────────────────────

    #[tokio::test]
    async fn read_spec_document_returns_content() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        let specs_dir = dir.path().join("docs").join("specs");
        fs::create_dir_all(&specs_dir).unwrap();
        fs::write(specs_dir.join("feature.md"), "# Feature\n\nSpec body.").unwrap();

        let result = read_spec_document(project, "feature.md".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Feature\n\nSpec body.");
    }

    #[tokio::test]
    async fn read_spec_document_errors_on_missing_file() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        let result = read_spec_document(project, "nonexistent.md".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read spec"));
    }

    // ── delete_spec_document ──────────────────────────────────────────────

    #[tokio::test]
    async fn delete_spec_document_removes_file() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        let specs_dir = dir.path().join("docs").join("specs");
        fs::create_dir_all(&specs_dir).unwrap();
        let spec_file = specs_dir.join("to-delete.md");
        fs::write(&spec_file, "# To Delete").unwrap();
        assert!(spec_file.exists());

        let result = delete_spec_document(project, "to-delete.md".to_string()).await;
        assert!(result.is_ok());
        assert!(!spec_file.exists());
    }

    // ── read_project_files ────────────────────────────────────────────────

    #[tokio::test]
    async fn read_project_files_reads_multiple_files_and_respects_max_lines() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        // Write two files; one has 5 lines
        fs::write(dir.path().join("a.ts"), "line1\nline2\nline3").unwrap();
        fs::write(dir.path().join("b.ts"), "x\ny\nz\nw\nv\nextra").unwrap();

        let result = read_project_files(
            project,
            vec!["a.ts".to_string(), "b.ts".to_string()],
            Some(4),
        )
        .await;

        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 2);

        let a = files.iter().find(|f| f.path == "a.ts").unwrap();
        assert!(a.found);
        assert_eq!(a.total_lines, 3);
        assert!(!a.truncated);

        let b = files.iter().find(|f| f.path == "b.ts").unwrap();
        assert!(b.found);
        assert_eq!(b.total_lines, 6);
        assert!(b.truncated);
        // max_lines = 4, so content has 4 lines
        let content = b.content.as_ref().unwrap();
        assert_eq!(content.lines().count(), 4);
    }

    #[tokio::test]
    async fn read_project_files_blocks_path_traversal() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        // Create a file outside the project root to attempt to read
        let outside_dir = temp_dir();
        let outside_file = outside_dir.path().join("secret.txt");
        fs::write(&outside_file, "secret contents").unwrap();

        // Attempt traversal: ../../<outside_dir>/secret.txt
        // Use an absolute path outside the project root directly via a relative traversal
        let traversal = format!(
            "../../{}",
            outside_file.strip_prefix("/").unwrap_or(&outside_file).display()
        );

        let result = read_project_files(project, vec![traversal.clone()], None).await;
        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 1);
        // Must not have found / returned the file
        assert!(!files[0].found);
    }

    #[tokio::test]
    async fn read_project_files_limits_to_five_files() {
        let dir = temp_dir();
        let project = dir.path().to_string_lossy().to_string();

        // Create 7 files
        let mut paths = Vec::new();
        for i in 0..7 {
            let name = format!("file{}.txt", i);
            fs::write(dir.path().join(&name), format!("content {}", i)).unwrap();
            paths.push(name);
        }

        let result = read_project_files(project, paths, None).await;
        assert!(result.is_ok());
        // Only 5 results returned regardless of how many paths were given
        assert_eq!(result.unwrap().len(), 5);
    }

    // ── gather_spec_context ───────────────────────────────────────────────

    #[tokio::test]
    async fn gather_spec_context_includes_project_name_and_framework() {
        let dir = temp_dir();
        let project_path = dir.path().to_string_lossy().to_string();

        // Add a Rust indicator so framework detection triggers
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"test\"").unwrap();

        let result = gather_spec_context_impl(project_path).await;
        assert!(result.is_ok());
        let ctx = result.unwrap();

        // Project name appears (last path component of temp dir)
        let project_name = dir.path().file_name().unwrap().to_string_lossy().to_string();
        assert!(ctx.contains(&project_name));

        // Framework detection picks up Cargo.toml → Rust
        assert!(ctx.contains("Rust"));
    }

    #[tokio::test]
    async fn gather_spec_context_includes_claude_md_when_present() {
        let dir = temp_dir();
        let project_path = dir.path().to_string_lossy().to_string();

        fs::write(
            dir.path().join("CLAUDE.md"),
            "# Project Guide\n\nThis is the project guide.",
        )
        .unwrap();

        let result = gather_spec_context_impl(project_path).await;
        assert!(result.is_ok());
        let ctx = result.unwrap();
        assert!(ctx.contains("CLAUDE.md"));
        assert!(ctx.contains("Project Guide"));
    }

    #[tokio::test]
    async fn gather_spec_context_does_not_truncate_large_contexts() {
        // Regression: the old 14000-char budget silently dropped later sections
        // (existing specs, recent commits) on any non-trivial project. SpecWriter
        // must always receive the full structural summary — each section is
        // already independently capped upstream.
        let dir = temp_dir();
        let project_path = dir.path().to_string_lossy().to_string();

        // CLAUDE.md of 100 lines × ~160 chars ≈ 16000 chars — by itself over
        // the old 14000 budget, guaranteeing later sections would have been
        // dropped under the old logic.
        let long_line = "x".repeat(160);
        let mut claude_md_body = String::from("# Project Guide\n");
        for i in 0..100 {
            claude_md_body.push_str(&format!("line {} {}\n", i, long_line));
        }
        fs::write(dir.path().join("CLAUDE.md"), &claude_md_body).unwrap();

        // Existing Specs is section #10 — one of the last pushed, and exactly
        // the kind of content that was getting dropped.
        let specs_dir = dir.path().join("docs").join("specs");
        fs::create_dir_all(&specs_dir).unwrap();
        fs::write(
            specs_dir.join("existing.md"),
            "# Prior Spec\n\nA spec that already exists.",
        )
        .unwrap();

        let result = gather_spec_context_impl(project_path).await;
        assert!(result.is_ok());
        let ctx = result.unwrap();

        // Early section present.
        assert!(ctx.contains("CLAUDE.md"));
        // Late section present — would have been truncated under the old budget.
        assert!(
            ctx.contains("Prior Spec"),
            "Existing Specs section was dropped — truncation has regressed"
        );
        // Sanity: actual length exceeds the old budget.
        assert!(ctx.len() > 14000);
    }

    // ── add_verification_workflow_to_claude_md ────────────────────────────

    #[tokio::test]
    async fn add_verification_workflow_creates_new_claude_md() {
        let dir = temp_dir();
        let project_path = dir.path().to_string_lossy().to_string();

        let result = add_verification_workflow_to_claude_md(project_path).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "added");

        let claude_md = dir.path().join("CLAUDE.md");
        assert!(claude_md.exists());
        let content = fs::read_to_string(&claude_md).unwrap();
        assert!(content.contains("SpecWriter Verification Workflow"));
    }

    #[tokio::test]
    async fn add_verification_workflow_appends_to_existing_claude_md() {
        let dir = temp_dir();
        let project_path = dir.path().to_string_lossy().to_string();

        fs::write(dir.path().join("CLAUDE.md"), "# Existing Guide\n\nExisting content.").unwrap();

        let result = add_verification_workflow_to_claude_md(project_path).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "added");

        let content = fs::read_to_string(dir.path().join("CLAUDE.md")).unwrap();
        assert!(content.contains("# Existing Guide"));
        assert!(content.contains("Existing content."));
        assert!(content.contains("SpecWriter Verification Workflow"));
    }

    #[tokio::test]
    async fn add_verification_workflow_is_idempotent() {
        let dir = temp_dir();
        let project_path = dir.path().to_string_lossy().to_string();

        // First call
        let r1 = add_verification_workflow_to_claude_md(project_path.clone()).await;
        assert!(r1.is_ok());
        assert_eq!(r1.unwrap(), "added");

        // Second call — section already present
        let r2 = add_verification_workflow_to_claude_md(project_path).await;
        assert!(r2.is_ok());
        assert_eq!(r2.unwrap(), "already_exists");
    }

    #[tokio::test]
    async fn add_verification_workflow_includes_dual_side_rule() {
        // The dual-side rule is the whole reason this text was modified —
        // without it, implementers can mark a cross-system feature PASS
        // based on mocked tests alone. The block must appear verbatim,
        // not paraphrased away by a future edit.
        let dir = temp_dir();
        let project_path = dir.path().to_string_lossy().to_string();

        add_verification_workflow_to_claude_md(project_path)
            .await
            .unwrap();

        let content = fs::read_to_string(dir.path().join("CLAUDE.md")).unwrap();
        assert!(
            content.contains("Dual-side rule for cross-system calls"),
            "CLAUDE.md text missing dual-side rule header"
        );
        assert!(
            content.contains("passing mocked test is NOT"),
            "CLAUDE.md text missing mock-not-sufficient sentence"
        );
        assert!(
            content.contains("ripgrep"),
            "CLAUDE.md text missing parity check description"
        );
        assert!(
            content.contains("CI step"),
            "CLAUDE.md text missing CI recommendation"
        );
    }

    // ── verify_action_parity ─────────────────────────────────────────────

    fn write(path: &std::path::PathBuf, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    #[tokio::test]
    async fn verify_action_parity_errors_when_root_missing() {
        let res = verify_action_parity_impl("/tmp/nonexistent-codemantis-root".to_string(), vec![]).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn verify_action_parity_passes_when_both_sides_reference_action() {
        let dir = temp_dir();
        let root = dir.path().to_path_buf();

        write(
            &root.join("workers/notes/notes_write.py"),
            "def write_classification():\n    return client.call('data-write', 'insert_note_classification', {})\n",
        );
        write(
            &root.join("functions/worker-data-write/actions/notes.py"),
            "def handle(action):\n    if action == 'insert_note_classification':\n        return do_insert()\n",
        );

        let actions = vec![ActionParityRequest {
            action: "insert_note_classification".to_string(),
            caller_path: "workers/notes".to_string(),
            caller_paths: vec![],
            handler_path: "functions/worker-data-write/actions/notes.py".to_string(),
            wire: None,
        }];

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            actions,
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 1);
        let r = &results[0];
        assert_eq!(r.status, "PASS");
        assert!(r.caller_present);
        assert!(r.handler_present);
        assert!(r.handler_stub_free);
    }

    #[tokio::test]
    async fn verify_action_parity_fails_when_handler_is_missing() {
        // The original incident: caller ships, handler never lands.
        let dir = temp_dir();
        let root = dir.path().to_path_buf();

        write(
            &root.join("workers/notes/notes_write.py"),
            "client.call('data-write', 'insert_note_classification', {})\n",
        );
        // Handler file exists but does NOT mention the action at all.
        write(
            &root.join("functions/worker-data-write/actions/notes.py"),
            "def handle(action):\n    return None\n",
        );

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "insert_note_classification".to_string(),
                caller_path: "workers/notes".to_string(),
                caller_paths: vec![],
                handler_path: "functions/worker-data-write/actions/notes.py".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();

        let r = &results[0];
        assert_eq!(r.status, "FAIL");
        assert!(r.caller_present);
        assert!(!r.handler_present);
        assert!(r.detail.contains("handler path"));
    }

    #[tokio::test]
    async fn verify_action_parity_fails_when_handler_file_does_not_exist() {
        let dir = temp_dir();
        let root = dir.path().to_path_buf();

        write(
            &root.join("workers/notes/notes_write.py"),
            "client.call('data-write', 'insert_note_classification', {})\n",
        );
        // Handler path never created.

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "insert_note_classification".to_string(),
                caller_path: "workers/notes".to_string(),
                caller_paths: vec![],
                handler_path: "functions/worker-data-write/actions/notes.py".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();

        let r = &results[0];
        assert_eq!(r.status, "FAIL");
        assert!(!r.handler_present);
        assert!(!r.handler_stub_free);
    }

    #[tokio::test]
    async fn verify_action_parity_fails_on_stub_marker_in_handler() {
        // The handler references the action name — but also contains
        // "until then … will return an error". This is the exact pattern
        // from the incident: the code admits it's not implemented.
        let dir = temp_dir();
        let root = dir.path().to_path_buf();

        write(
            &root.join("workers/notes/notes_write.py"),
            "client.call('data-write', 'insert_note_classification', {})\n",
        );
        write(
            &root.join("functions/worker-data-write/actions/notes.py"),
            "# insert_note_classification: until then, these calls will return an error\n\
             def handle(action):\n    raise NotImplementedError()\n",
        );

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "insert_note_classification".to_string(),
                caller_path: "workers/notes".to_string(),
                caller_paths: vec![],
                handler_path: "functions/worker-data-write/actions/notes.py".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();

        let r = &results[0];
        assert_eq!(r.status, "FAIL");
        assert!(r.caller_present);
        assert!(r.handler_present); // the action string IS there — but...
        assert!(!r.handler_stub_free); // ...the file is a stub
        assert!(r.detail.contains("stub") || r.detail.contains("NotImplemented"));
    }

    #[tokio::test]
    async fn verify_action_parity_strips_symbol_suffix_from_handler_path() {
        // Handler declarations often use `file.py::handle_x`. The command
        // must split on "::" and only ripgrep the file portion — otherwise
        // the existence check fails on a perfectly valid handler.
        let dir = temp_dir();
        let root = dir.path().to_path_buf();

        write(
            &root.join("services/audit/sink.ts"),
            "export function recordAudit(action: string) {\n  if (action === 'emit_audit_log') doit();\n}\n",
        );
        write(
            &root.join("producers/audit.ts"),
            "client.call('audit', 'emit_audit_log', {});\n",
        );

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "emit_audit_log".to_string(),
                caller_path: "producers/audit.ts".to_string(),
                caller_paths: vec![],
                handler_path: "services/audit/sink.ts::recordAudit".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();

        assert_eq!(results[0].status, "PASS");
    }

    #[tokio::test]
    async fn verify_action_parity_runs_multiple_actions_in_order() {
        let dir = temp_dir();
        let root = dir.path().to_path_buf();

        write(
            &root.join("caller.ts"),
            "call('a'); call('b');\n",
        );
        write(
            &root.join("handler.ts"),
            "switch(action) { case 'a': ok(); }\n",
        );

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![
                ActionParityRequest {
                    action: "a".to_string(),
                    caller_path: "caller.ts".to_string(),
                    caller_paths: vec![],
                    handler_path: "handler.ts".to_string(),
                    wire: None,
                },
                ActionParityRequest {
                    action: "b".to_string(),
                    caller_path: "caller.ts".to_string(),
                    caller_paths: vec![],
                    handler_path: "handler.ts".to_string(),
                    wire: None,
                },
            ],
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].action, "a");
        assert_eq!(results[0].status, "PASS");
        assert_eq!(results[1].action, "b");
        assert_eq!(results[1].status, "FAIL");
        assert!(!results[1].handler_present);
    }

    #[tokio::test]
    async fn verify_action_parity_passes_with_legacy_single_caller_path() {
        // Back-compat: callers that only fill `caller_path` (old shape)
        // must still PASS when the action is found there. No `caller_paths`,
        // no `wire`.
        let dir = temp_dir();
        let root = dir.path().to_path_buf();
        write(
            &root.join("src/api/notes.ts"),
            "call('write', 'insert_note', {});\n",
        );
        write(
            &root.join("functions/handler.ts"),
            "switch (action) { case 'insert_note': return ok(); }\n",
        );

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "insert_note".to_string(),
                caller_path: "src/api/notes.ts".to_string(),
                caller_paths: vec![],
                handler_path: "functions/handler.ts".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();

        assert_eq!(results[0].status, "PASS");
        assert!(results[0].caller_present);
        assert!(results[0].handler_present);
    }

    #[tokio::test]
    async fn verify_action_parity_passes_when_action_is_in_second_of_multi_caller_paths() {
        // Regression test for the rustling-wind false-positive: session
        // declares files spanning multiple directories; the action string
        // lives in a sibling dir of the "first" one. With the old single-
        // path scan this FAIL'd; with multi-path union it PASSes.
        let dir = temp_dir();
        let root = dir.path().to_path_buf();
        // `src/hooks/` has NO mention of the action…
        write(
            &root.join("src/hooks/useResolve.ts"),
            "export function useResolve() { return resolveCheckpoint(); }\n",
        );
        // …but `src/lib/api/` does.
        write(
            &root.join("src/lib/api/notes.ts"),
            "fetch('/api', { body: JSON.stringify({ action: 'insert_note' }) });\n",
        );
        write(
            &root.join("functions/handler.ts"),
            "switch (action) { case 'insert_note': return ok(); }\n",
        );

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "insert_note".to_string(),
                caller_path: "".to_string(),
                caller_paths: vec!["src/hooks".to_string(), "src/lib/api".to_string()],
                handler_path: "functions/handler.ts".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();

        assert_eq!(results[0].status, "PASS", "detail was: {}", results[0].detail);
        assert!(results[0].caller_present);
    }

    #[tokio::test]
    async fn verify_action_parity_uses_wire_string_when_present_not_action_name() {
        // The spec author uses a snake_case action label that the actual
        // call site doesn't carry — the wire string is a kebab-case URL
        // slug instead. With `wire` set, the gate searches for the wire;
        // without it, the same setup FAILs (control case).
        let dir = temp_dir();
        let root = dir.path().to_path_buf();
        write(
            &root.join("src/hooks/useResolve.ts"),
            // The literal action label `resolve_checkpoint` appears
            // nowhere — only the wire string `hitl-respond` does.
            "fetch('/functions/hitl-respond', { method: 'POST' });\n",
        );
        write(
            &root.join("functions/hitl-respond/index.ts"),
            "export function handler() { /* hitl-respond handler */ }\n",
        );

        // With wire — PASSes
        let with_wire = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "resolve_checkpoint".to_string(),
                caller_path: "src/hooks".to_string(),
                caller_paths: vec![],
                handler_path: "functions/hitl-respond/index.ts".to_string(),
                wire: Some("hitl-respond".to_string()),
            }],
        )
        .await
        .unwrap();
        assert_eq!(with_wire[0].status, "PASS", "detail: {}", with_wire[0].detail);
        assert!(with_wire[0].detail.contains("wire"));

        // Without wire — control: same fixture FAILs because the literal
        // action name is nowhere to be found.
        let no_wire = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "resolve_checkpoint".to_string(),
                caller_path: "src/hooks".to_string(),
                caller_paths: vec![],
                handler_path: "functions/hitl-respond/index.ts".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();
        assert_eq!(no_wire[0].status, "FAIL");
        assert!(!no_wire[0].caller_present);
    }

    #[tokio::test]
    async fn verify_action_parity_fails_when_no_caller_path_contains_wire() {
        // When the gate FAILs, the detail message must list every scanned
        // caller path so the recovery prompt can pin-point what was checked.
        let dir = temp_dir();
        let root = dir.path().to_path_buf();
        write(&root.join("src/a/file.ts"), "noop\n");
        write(&root.join("src/b/file.ts"), "noop\n");
        write(&root.join("functions/handler.ts"), "switch (a) { case 'foo': }\n");

        let results = verify_action_parity_impl(
            root.to_string_lossy().to_string(),
            vec![ActionParityRequest {
                action: "foo".to_string(),
                caller_path: "".to_string(),
                caller_paths: vec!["src/a".to_string(), "src/b".to_string()],
                handler_path: "functions/handler.ts".to_string(),
                wire: None,
            }],
        )
        .await
        .unwrap();

        assert_eq!(results[0].status, "FAIL");
        assert!(!results[0].caller_present);
        assert!(results[0].detail.contains("src/a"));
        assert!(results[0].detail.contains("src/b"));
    }

    // ── detect_framework ─────────────────────────────────────────────────

    #[test]
    fn detect_framework_returns_unknown_for_empty_dir() {
        let dir = temp_dir();
        let framework = detect_framework(dir.path());
        assert_eq!(framework, "Unknown");
    }

    #[test]
    fn detect_framework_detects_nextjs_from_next_config_ts() {
        let dir = temp_dir();
        fs::write(dir.path().join("next.config.ts"), "").unwrap();
        assert_eq!(detect_framework(dir.path()), "Next.js");
    }

    #[test]
    fn detect_framework_detects_nextjs_from_next_config_js() {
        let dir = temp_dir();
        fs::write(dir.path().join("next.config.js"), "").unwrap();
        assert_eq!(detect_framework(dir.path()), "Next.js");
    }

    #[test]
    fn detect_framework_detects_vite_from_vite_config_ts() {
        let dir = temp_dir();
        fs::write(dir.path().join("vite.config.ts"), "").unwrap();
        assert_eq!(detect_framework(dir.path()), "Vite");
    }

    #[test]
    fn detect_framework_detects_rust_from_cargo_toml() {
        let dir = temp_dir();
        fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();
        assert_eq!(detect_framework(dir.path()), "Rust");
    }

    #[test]
    fn detect_framework_detects_sveltekit() {
        let dir = temp_dir();
        fs::write(dir.path().join("svelte.config.js"), "").unwrap();
        assert_eq!(detect_framework(dir.path()), "SvelteKit");
    }

    #[test]
    fn detect_framework_detects_astro() {
        let dir = temp_dir();
        fs::write(dir.path().join("astro.config.mjs"), "").unwrap();
        assert_eq!(detect_framework(dir.path()), "Astro");
    }

    #[test]
    fn detect_framework_detects_go() {
        let dir = temp_dir();
        fs::write(dir.path().join("go.mod"), "module example.com/app").unwrap();
        assert_eq!(detect_framework(dir.path()), "Go");
    }

    #[test]
    fn detect_framework_detects_python_from_pyproject_toml() {
        let dir = temp_dir();
        fs::write(dir.path().join("pyproject.toml"), "[tool.poetry]").unwrap();
        assert_eq!(detect_framework(dir.path()), "Python");
    }

    #[test]
    fn detect_framework_detects_python_from_requirements_txt() {
        let dir = temp_dir();
        fs::write(dir.path().join("requirements.txt"), "requests==2.31.0").unwrap();
        assert_eq!(detect_framework(dir.path()), "Python");
    }

    // ── list_files_shallow ────────────────────────────────────────────────

    #[test]
    fn list_files_shallow_returns_empty_for_depth_zero() {
        let dir = temp_dir();
        fs::write(dir.path().join("file.ts"), "content").unwrap();

        let mut files = Vec::new();
        list_files_shallow(dir.path(), 0, &mut files, dir.path());
        assert!(files.is_empty());
    }

    #[test]
    fn list_files_shallow_lists_files_at_depth_one() {
        let dir = temp_dir();
        fs::write(dir.path().join("a.ts"), "").unwrap();
        fs::write(dir.path().join("b.ts"), "").unwrap();

        let mut files = Vec::new();
        list_files_shallow(dir.path(), 1, &mut files, dir.path());
        files.sort();
        assert_eq!(files, vec!["a.ts", "b.ts"]);
    }

    #[test]
    fn list_files_shallow_excludes_node_modules_and_dist() {
        let dir = temp_dir();
        fs::write(dir.path().join("index.ts"), "").unwrap();
        let nm = dir.path().join("node_modules");
        fs::create_dir_all(&nm).unwrap();
        fs::write(nm.join("lib.js"), "").unwrap();
        let dist = dir.path().join("dist");
        fs::create_dir_all(&dist).unwrap();
        fs::write(dist.join("bundle.js"), "").unwrap();

        let mut files = Vec::new();
        list_files_shallow(dir.path(), 2, &mut files, dir.path());
        // Only index.ts should appear; node_modules and dist are skipped
        assert_eq!(files, vec!["index.ts"]);
    }

    #[test]
    fn list_files_shallow_descends_at_depth_two() {
        let dir = temp_dir();
        let sub = dir.path().join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("nested.ts"), "").unwrap();

        let mut files = Vec::new();
        list_files_shallow(dir.path(), 2, &mut files, dir.path());
        assert!(files.iter().any(|f| f.contains("nested.ts")));
    }

    // ── find_routes_recursive ─────────────────────────────────────────────

    #[test]
    fn find_routes_recursive_finds_page_tsx_files() {
        let dir = temp_dir();
        let app_dir = dir.path().join("app").join("dashboard");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(app_dir.join("page.tsx"), "export default function Page() {}").unwrap();

        let mut routes = Vec::new();
        find_routes_recursive(dir.path(), &["page.tsx"], &mut routes, dir.path());
        assert_eq!(routes.len(), 1);
        assert!(routes[0].contains("page.tsx"));
    }

    #[test]
    fn find_routes_recursive_skips_node_modules_and_target() {
        let dir = temp_dir();

        // Route inside node_modules — must be skipped
        let nm = dir.path().join("node_modules").join("pkg").join("app");
        fs::create_dir_all(&nm).unwrap();
        fs::write(nm.join("page.tsx"), "").unwrap();

        // Route inside target — must be skipped
        let tgt = dir.path().join("target").join("app");
        fs::create_dir_all(&tgt).unwrap();
        fs::write(tgt.join("page.tsx"), "").unwrap();

        let mut routes = Vec::new();
        find_routes_recursive(dir.path(), &["page.tsx"], &mut routes, dir.path());
        assert!(routes.is_empty());
    }

    // ── DB: task plan operations ──────────────────────────────────────────

    #[test]
    fn db_save_and_load_task_plan_roundtrip() {
        let db = crate::test_helpers::test_db();
        let project = "/tmp/test-project-spec";
        let plan_json = r#"{"tasks":["task1","task2"]}"#;

        db.insert_task_plan("plan-001", project, plan_json).unwrap();

        let loaded = db.get_task_plan(project).unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap(), plan_json);
    }

    #[test]
    fn db_save_update_load_task_plan_reflects_update() {
        let db = crate::test_helpers::test_db();
        let project = "/tmp/test-project-update";
        let original = r#"{"tasks":["initial"]}"#;
        let updated = r#"{"tasks":["initial","added"]}"#;

        db.insert_task_plan("plan-002", project, original).unwrap();
        db.update_task_plan(project, updated).unwrap();

        let loaded = db.get_task_plan(project).unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap(), updated);
    }

    #[test]
    fn db_get_active_plan_id_returns_inserted_id() {
        let db = crate::test_helpers::test_db();
        let project = "/tmp/test-project-id";

        // No plan yet — returns None
        let none = db.get_active_plan_id(project).unwrap();
        assert!(none.is_none());

        db.insert_task_plan("plan-id-test", project, "{}").unwrap();

        let id = db.get_active_plan_id(project).unwrap();
        assert_eq!(id.as_deref(), Some("plan-id-test"));
    }

    #[test]
    fn db_delete_task_plan_removes_entry() {
        let db = crate::test_helpers::test_db();
        let project = "/tmp/test-project-delete";

        db.insert_task_plan("plan-del", project, "{}").unwrap();

        // Confirm it's there
        assert!(db.get_task_plan(project).unwrap().is_some());

        db.delete_task_plan_by_id("plan-del").unwrap();

        // Now it's gone
        let after = db.get_task_plan(project).unwrap();
        assert!(after.is_none());
    }

    #[test]
    fn db_archive_task_plan_hides_from_active_query() {
        let db = crate::test_helpers::test_db();
        let project = "/tmp/test-project-archive";

        db.insert_task_plan("plan-arch", project, r#"{"v":1}"#).unwrap();
        assert!(db.get_task_plan(project).unwrap().is_some());

        db.archive_task_plan("plan-arch").unwrap();

        // get_task_plan only returns active plans
        let after = db.get_task_plan(project).unwrap();
        assert!(after.is_none());
    }

    #[test]
    fn db_load_task_plan_returns_none_for_unknown_project() {
        let db = crate::test_helpers::test_db();
        let loaded = db.get_task_plan("/no/such/project").unwrap();
        assert!(loaded.is_none());
    }

    // ─── recover_session_plan helpers ──────────────────────────────────

    #[test]
    fn recovery_prompt_embeds_diagnosis_and_filename() {
        let prompt = build_recovery_prompt(
            "# My Spec\n\n## 10. Session Plan\n…",
            "Session 1 has no `**Prompt for Claude Code:**` fenced code block",
            "my-feature-v2.md",
        );
        assert!(prompt.contains("Session 1 has no"));
        assert!(prompt.contains("my-feature-v2.md"));
        assert!(prompt.contains("─── SPEC START ───"));
        assert!(prompt.contains("─── SPEC END ───"));
        assert!(prompt.contains("# My Spec"));
    }

    #[test]
    fn recovery_prompt_preserves_full_spec_body_verbatim() {
        // The repair must see every byte. Tools that truncate input here have
        // bitten us before — pin the body length so a future "optimization"
        // can't silently chop the spec.
        let body = "# T\n\n".to_string() + &"x".repeat(50_000);
        let prompt = build_recovery_prompt(&body, "diag", "f.md");
        assert!(prompt.len() > body.len());
        assert!(prompt.contains(&"x".repeat(1000)));
    }

    #[test]
    fn strip_fence_wrapper_unwraps_backtick_fence() {
        let wrapped = "```markdown\n# Spec\n\nBody.\n```";
        assert_eq!(strip_fence_wrapper(wrapped), "# Spec\n\nBody.");
    }

    #[test]
    fn strip_fence_wrapper_unwraps_tilde_fence_no_language() {
        let wrapped = "~~~\n# Spec\n\nBody.\n~~~";
        assert_eq!(strip_fence_wrapper(wrapped), "# Spec\n\nBody.");
    }

    #[test]
    fn strip_fence_wrapper_passes_through_unwrapped_content() {
        // The happy case: model followed instructions and returned raw md.
        let raw = "# Spec\n\n## 10. Session Plan\n\n### Session 1: …";
        assert_eq!(strip_fence_wrapper(raw), raw);
    }

    #[test]
    fn strip_fence_wrapper_tolerates_leading_whitespace() {
        let wrapped = "  \n```\n# Spec\n```\n";
        assert_eq!(strip_fence_wrapper(wrapped), "# Spec");
    }

    #[test]
    fn recovery_system_prompt_pins_repair_only_contract() {
        // These phrases are the "do not invent" guardrail. If a future
        // edit weakens them, this test fires and forces a deliberate
        // decision rather than silent drift.
        assert!(RECOVERY_SYSTEM_PROMPT.contains("Do not invent files"));
        assert!(RECOVERY_SYSTEM_PROMPT.contains("Preserve every byte"));
        assert!(RECOVERY_SYSTEM_PROMPT.contains("Prompt for Claude Code"));
        assert!(RECOVERY_SYSTEM_PROMPT.contains("Indivisible note"));
        assert!(RECOVERY_SYSTEM_PROMPT.contains("Verify (full audit)"));
    }

    #[tokio::test]
    async fn recover_session_plan_refuses_without_api_key() {
        let err = recover_session_plan_impl(
            "# Spec\n\n## 10. Session Plan\n".to_string(),
            "diag".to_string(),
            "anthropic".to_string(),
            "".to_string(),
            "claude-opus-4-8".to_string(),
            "f.md".to_string(),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("API key"), "got: {}", err);
    }

    #[tokio::test]
    async fn recover_session_plan_refuses_empty_spec() {
        let err = recover_session_plan_impl(
            "   ".to_string(),
            "diag".to_string(),
            "anthropic".to_string(),
            "sk-test".to_string(),
            "claude-opus-4-8".to_string(),
            "f.md".to_string(),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("empty"), "got: {}", err);
    }

    #[tokio::test]
    async fn recover_session_plan_rejects_unknown_provider() {
        let err = recover_session_plan_impl(
            "# Spec\nbody".to_string(),
            "diag".to_string(),
            "made-up-provider".to_string(),
            "sk-test".to_string(),
            "some-model".to_string(),
            "f.md".to_string(),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Unknown recovery provider"), "got: {}", err);
    }
}
