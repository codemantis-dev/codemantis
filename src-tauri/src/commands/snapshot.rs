use crate::preview::PreviewState;
use log::warn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::State;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub insertions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub files_changed: Vec<FileChange>,
    pub new_files: Vec<String>,
    pub deleted_files: Vec<String>,
    pub file_tree: String,
    pub package_json_deps: Vec<String>,
    pub route_list: Vec<String>,
    pub check_results: Vec<serde_json::Value>,
    pub console_errors: Vec<serde_json::Value>,
    pub console_warnings: Vec<serde_json::Value>,
    pub file_contents: Option<Vec<FileContent>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub async fn gather_project_snapshot(
    preview_state: State<'_, PreviewState>,
    project_path: String,
) -> Result<String, String> {
    let project = Path::new(&project_path);

    // 1. Git diff --name-status
    let name_status = Command::new("git")
        .args(["diff", "--name-status", "HEAD~1"])
        .current_dir(&project_path)
        .output()
        .await
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // 1b. Git diff --stat for insertions/deletions per file
    let diff_stat = Command::new("git")
        .args(["diff", "--stat", "--numstat", "HEAD~1"])
        .current_dir(&project_path)
        .output()
        .await
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut stat_map: HashMap<String, (i32, i32)> = HashMap::new();
    for line in diff_stat.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let insertions = parts[0].parse::<i32>().unwrap_or(0);
            let deletions = parts[1].parse::<i32>().unwrap_or(0);
            let file_path = parts[2].to_string();
            stat_map.insert(file_path, (insertions, deletions));
        }
    }

    let mut files_changed = Vec::new();
    let mut new_files = Vec::new();
    let mut deleted_files = Vec::new();

    for line in name_status.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let status_char = parts[0].trim();
        let file_path = parts[1].trim().to_string();
        let (ins, del) = stat_map.get(&file_path).copied().unwrap_or((0, 0));

        match status_char {
            "A" => {
                new_files.push(file_path.clone());
                files_changed.push(FileChange {
                    path: file_path,
                    status: "added".into(),
                    insertions: ins,
                    deletions: del,
                });
            }
            "D" => {
                deleted_files.push(file_path.clone());
                files_changed.push(FileChange {
                    path: file_path,
                    status: "deleted".into(),
                    insertions: ins,
                    deletions: del,
                });
            }
            _ => {
                files_changed.push(FileChange {
                    path: file_path,
                    status: "modified".into(),
                    insertions: ins,
                    deletions: del,
                });
            }
        }
    }

    // 2. File tree (truncated to 50 lines)
    let tree_output = Command::new("find")
        .args([
            ".",
            "-maxdepth",
            "3",
            "-not",
            "-path",
            "*/node_modules/*",
            "-not",
            "-path",
            "*/.git/*",
            "-not",
            "-path",
            "*/dist/*",
            "-not",
            "-path",
            "*/.next/*",
            "-not",
            "-path",
            "*/target/*",
        ])
        .current_dir(&project_path)
        .output()
        .await
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let file_tree: String = tree_output.lines().take(50).collect::<Vec<_>>().join("\n");

    // 3. Package.json deps
    let mut package_json_deps = Vec::new();
    let pkg_path = project.join("package.json");
    if pkg_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pkg_path) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(deps) = pkg.get("dependencies").and_then(|d| d.as_object()) {
                    for key in deps.keys() {
                        package_json_deps.push(key.clone());
                    }
                }
                if let Some(dev_deps) = pkg.get("devDependencies").and_then(|d| d.as_object()) {
                    for key in dev_deps.keys() {
                        package_json_deps.push(format!("(dev) {}", key));
                    }
                }
            }
        }
    }

    // 4. Detect routes
    let mut route_list = Vec::new();
    let route_patterns = [
        "page.tsx",
        "page.ts",
        "page.jsx",
        "page.js",
        "route.tsx",
        "route.ts",
        "+page.svelte",
        "+page.ts",
    ];

    fn find_routes(dir: &Path, patterns: &[&str], routes: &mut Vec<String>, base: &Path) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if path.is_dir() {
                if matches!(name, "node_modules" | ".git" | "dist" | ".next" | "target") {
                    continue;
                }
                find_routes(&path, patterns, routes, base);
            } else if patterns.iter().any(|p| name == *p) {
                if let Ok(relative) = path.strip_prefix(base) {
                    routes.push(relative.display().to_string());
                }
            }
        }
    }

    find_routes(project, &route_patterns, &mut route_list, project);

    // 5. Console logs from preview
    let (console_errors, console_warnings) = {
        let logs = preview_state.console_logs.lock().await;
        let errors: Vec<serde_json::Value> = logs
            .iter()
            .filter(|l| l.level == "error")
            .rev()
            .take(20)
            .map(|l| {
                serde_json::json!({
                    "level": l.level,
                    "ts": l.ts,
                    "msg": if l.msg.len() > 200 { format!("{}...", &l.msg[..200]) } else { l.msg.clone() },
                    "url": l.url,
                })
            })
            .collect();
        let warnings: Vec<serde_json::Value> = logs
            .iter()
            .filter(|l| l.level == "warn")
            .rev()
            .take(10)
            .map(|l| {
                serde_json::json!({
                    "level": l.level,
                    "ts": l.ts,
                    "msg": if l.msg.len() > 200 { format!("{}...", &l.msg[..200]) } else { l.msg.clone() },
                    "url": l.url,
                })
            })
            .collect();
        (errors, warnings)
    };

    // 6. Read key file contents (first 100 lines, max 10 files)
    let key_file_patterns = ["layout", "page", "route", "index", "app", "main"];
    let mut key_files: Vec<String> = Vec::new();

    // Include files from changes
    for fc in &files_changed {
        if key_files.len() >= 10 {
            break;
        }
        if !key_files.contains(&fc.path) {
            key_files.push(fc.path.clone());
        }
    }

    // Include key layout/route files from the file tree
    for route in &route_list {
        if key_files.len() >= 10 {
            break;
        }
        if !key_files.contains(route) {
            key_files.push(route.clone());
        }
    }

    // Scan for common entry-point files
    if key_files.len() < 10 {
        for line in file_tree.lines() {
            if key_files.len() >= 10 {
                break;
            }
            let trimmed = line.trim().trim_start_matches("./");
            let lower = trimmed.to_lowercase();
            if key_file_patterns.iter().any(|p| lower.contains(p))
                && (lower.ends_with(".tsx") || lower.ends_with(".ts") || lower.ends_with(".jsx") || lower.ends_with(".js"))
                && !key_files.contains(&trimmed.to_string())
            {
                key_files.push(trimmed.to_string());
            }
        }
    }

    let mut file_contents_vec: Vec<FileContent> = Vec::new();
    for file_rel in key_files.iter().take(10) {
        let full_path = project.join(file_rel);
        if let Ok(content) = std::fs::read_to_string(&full_path) {
            let truncated: String = content.lines().take(100).collect::<Vec<_>>().join("\n");
            file_contents_vec.push(FileContent {
                path: file_rel.clone(),
                content: truncated,
            });
        }
    }

    let file_contents = if file_contents_vec.is_empty() {
        None
    } else {
        Some(file_contents_vec)
    };

    let snapshot = ProjectSnapshot {
        files_changed,
        new_files,
        deleted_files,
        file_tree,
        package_json_deps,
        route_list,
        check_results: Vec::new(),
        console_errors,
        console_warnings,
        file_contents,
    };

    let json = serde_json::to_string(&snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;

    // Token budget check (rough estimate: ~4 chars per token)
    let estimated_tokens = json.len() / 4;
    if estimated_tokens > 8000 {
        warn!(
            "Project snapshot exceeds 8000 token budget: ~{} tokens",
            estimated_tokens
        );
    }

    Ok(json)
}
