use crate::claude::session::AppState;
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
    project_path: String,
) -> Result<String, String> {
    let project = Path::new(&project_path);
    let mut sections: Vec<String> = Vec::new();
    let mut total_chars: usize = 0;
    let char_budget: usize = 14000; // ~3,500 tokens (L1 budget)

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

    // Assemble with budget check
    let mut result = String::new();
    for section in &sections {
        if total_chars + section.len() > char_budget {
            warn!(
                "gather_spec_context: exceeded {} char budget at {} chars, truncating",
                char_budget, total_chars
            );
            break;
        }
        if !result.is_empty() {
            result.push_str("\n\n");
        }
        result.push_str(section);
        total_chars = result.len();
    }

    Ok(result)
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
