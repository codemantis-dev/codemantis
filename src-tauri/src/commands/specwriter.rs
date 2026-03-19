use crate::claude::session::AppState;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::Path;
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

// ── Context gathering for feature mode ─────────────────────────────────

#[tauri::command]
pub async fn gather_spec_context(
    project_path: String,
) -> Result<String, String> {
    let project = Path::new(&project_path);
    let mut sections: Vec<String> = Vec::new();
    let mut total_chars: usize = 0;
    let char_budget: usize = 24000; // ~6000 tokens

    let project_name = project.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    sections.push(format!("Project: {}\nPath: {}", project_name, project_path));

    // 1. Framework detection
    let framework = detect_framework(project);
    sections.push(format!("Framework: {}", framework));

    // 2. CLAUDE.md (first 100 lines)
    let claude_md = project.join("CLAUDE.md");
    if claude_md.exists() {
        if let Ok(content) = std::fs::read_to_string(&claude_md) {
            let truncated: String = content.lines().take(100).collect::<Vec<_>>().join("\n");
            sections.push(format!("CLAUDE.md:\n{}", truncated));
        }
    }

    // 3. Package.json dependencies
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
                    sections.push(format!("Dependencies: {}", deps.join(", ")));
                }
            }
        }
    }

    // 4. Route detection
    let mut routes = Vec::new();
    find_routes_recursive(project, &["page.tsx", "page.ts", "page.jsx", "page.js", "route.tsx", "route.ts", "+page.svelte"], &mut routes, project);
    if !routes.is_empty() {
        let route_lines: Vec<String> = routes.iter().take(30).map(|r| format!("  {}", r)).collect();
        sections.push(format!("Routes ({}):\n{}", routes.len(), route_lines.join("\n")));
    }

    // 5. Database schema
    let schema_files = [
        "prisma/schema.prisma",
        "drizzle/schema.ts",
        "src/db/schema.ts",
    ];
    for schema_file in &schema_files {
        let schema_path = project.join(schema_file);
        if schema_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&schema_path) {
                let truncated: String = content.lines().take(150).collect::<Vec<_>>().join("\n");
                sections.push(format!("Database Schema ({}):\n{}", schema_file, truncated));
                break;
            }
        }
    }

    // 6. Component inventory (2 levels deep, names only)
    let components_dir = project.join("src").join("components");
    if components_dir.exists() {
        let mut component_files = Vec::new();
        list_files_shallow(&components_dir, 2, &mut component_files, &components_dir);
        if !component_files.is_empty() {
            let limited: Vec<&String> = component_files.iter().take(50).collect();
            sections.push(format!("Components ({}):\n  {}", component_files.len(), limited.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n  ")));
        }
    }

    // 7. Hooks inventory
    for hooks_dir_name in &["src/hooks", "src/lib/hooks"] {
        let hooks_dir = project.join(hooks_dir_name);
        if hooks_dir.exists() {
            let mut hook_files = Vec::new();
            list_files_shallow(&hooks_dir, 1, &mut hook_files, &hooks_dir);
            if !hook_files.is_empty() {
                sections.push(format!("Hooks:\n  {}", hook_files.join("\n  ")));
            }
            break;
        }
    }

    // 8. Existing specs
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
                        .unwrap_or_else(|| path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string());
                    spec_summaries.push(format!("  {} — {}", path.file_name().and_then(|n| n.to_str()).unwrap_or(""), title));
                }
            }
        }
        if !spec_summaries.is_empty() {
            sections.push(format!("Existing Specs (in docs/specs/):\n{}", spec_summaries.join("\n")));
        }
    }

    // Assemble with budget check
    let mut result = String::new();
    for section in &sections {
        if total_chars + section.len() > char_budget {
            warn!("gather_spec_context: exceeded {} char budget at {} chars, truncating", char_budget, total_chars);
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
        } else if patterns.iter().any(|p| name == *p) {
            if let Ok(relative) = path.strip_prefix(base) {
                routes.push(relative.display().to_string());
            }
        }
    }
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
