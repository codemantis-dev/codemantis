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

    let stat_map = parse_numstat(&diff_stat);
    let (files_changed, new_files, deleted_files) = parse_name_status(&name_status, &stat_map);

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
            } else if patterns.contains(&name) {
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
    let changed_paths: Vec<&str> = files_changed.iter().map(|fc| fc.path.as_str()).collect();
    let route_refs: Vec<&str> = route_list.iter().map(|r| r.as_str()).collect();
    let key_files = select_key_files(&changed_paths, &route_refs, &file_tree, 10);

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
    let estimated_tokens = estimate_tokens(&json);
    if estimated_tokens > 8000 {
        warn!(
            "Project snapshot exceeds 8000 token budget: ~{} tokens",
            estimated_tokens
        );
    }

    Ok(json)
}

// ── Pure helper functions (extracted for testability) ──

/// Parses `git diff --numstat` output into a map of file_path -> (insertions, deletions).
pub(crate) fn parse_numstat(numstat_output: &str) -> HashMap<String, (i32, i32)> {
    let mut stat_map = HashMap::new();
    for line in numstat_output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let insertions = parts[0].parse::<i32>().unwrap_or(0);
            let deletions = parts[1].parse::<i32>().unwrap_or(0);
            let file_path = parts[2].to_string();
            stat_map.insert(file_path, (insertions, deletions));
        }
    }
    stat_map
}

/// Parses `git diff --name-status` output and cross-references with numstat data
/// to produce categorized file changes.
pub(crate) fn parse_name_status(
    name_status_output: &str,
    stat_map: &HashMap<String, (i32, i32)>,
) -> (Vec<FileChange>, Vec<String>, Vec<String>) {
    let mut files_changed = Vec::new();
    let mut new_files = Vec::new();
    let mut deleted_files = Vec::new();

    for line in name_status_output.lines() {
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

    (files_changed, new_files, deleted_files)
}

/// Selects up to `max` key files for inclusion in a snapshot, combining changed files,
/// route files, and entry-point files discovered from the file tree.
pub(crate) fn select_key_files(
    changed_paths: &[&str],
    route_paths: &[&str],
    file_tree: &str,
    max: usize,
) -> Vec<String> {
    let key_file_patterns = ["layout", "page", "route", "index", "app", "main"];
    let mut key_files: Vec<String> = Vec::new();

    // Include files from changes
    for path in changed_paths {
        if key_files.len() >= max {
            break;
        }
        let s = path.to_string();
        if !key_files.contains(&s) {
            key_files.push(s);
        }
    }

    // Include route files
    for route in route_paths {
        if key_files.len() >= max {
            break;
        }
        let s = route.to_string();
        if !key_files.contains(&s) {
            key_files.push(s);
        }
    }

    // Scan for common entry-point files from the file tree
    if key_files.len() < max {
        for line in file_tree.lines() {
            if key_files.len() >= max {
                break;
            }
            let trimmed = line.trim().trim_start_matches("./");
            let lower = trimmed.to_lowercase();
            if key_file_patterns.iter().any(|p| lower.contains(p))
                && (lower.ends_with(".tsx")
                    || lower.ends_with(".ts")
                    || lower.ends_with(".jsx")
                    || lower.ends_with(".js"))
                && !key_files.contains(&trimmed.to_string())
            {
                key_files.push(trimmed.to_string());
            }
        }
    }

    key_files
}

/// Rough token estimate: ~4 characters per token.
pub(crate) fn estimate_tokens(text: &str) -> usize {
    text.len() / 4
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_numstat ──

    #[test]
    fn parse_numstat_basic() {
        let input = "10\t5\tsrc/main.rs\n3\t1\tsrc/lib.rs\n";
        let result = parse_numstat(input);
        assert_eq!(result.len(), 2);
        assert_eq!(result.get("src/main.rs"), Some(&(10, 5)));
        assert_eq!(result.get("src/lib.rs"), Some(&(3, 1)));
    }

    #[test]
    fn parse_numstat_empty_input() {
        let result = parse_numstat("");
        assert!(result.is_empty());
    }

    #[test]
    fn parse_numstat_binary_file() {
        // Git uses "-" for binary files
        let input = "-\t-\timage.png\n5\t2\tsrc/app.rs\n";
        let result = parse_numstat(input);
        // "-" won't parse as i32, so defaults to 0
        assert_eq!(result.get("image.png"), Some(&(0, 0)));
        assert_eq!(result.get("src/app.rs"), Some(&(5, 2)));
    }

    #[test]
    fn parse_numstat_malformed_line_skipped() {
        let input = "not_enough_tabs\n10\t5\tsrc/valid.rs\n";
        let result = parse_numstat(input);
        assert_eq!(result.len(), 1);
        assert!(result.contains_key("src/valid.rs"));
    }

    #[test]
    fn parse_numstat_zero_changes() {
        let input = "0\t0\tsrc/unchanged.rs\n";
        let result = parse_numstat(input);
        assert_eq!(result.get("src/unchanged.rs"), Some(&(0, 0)));
    }

    // ── parse_name_status ──

    #[test]
    fn parse_name_status_added_file() {
        let stat_map = HashMap::from([("src/new.rs".to_string(), (20, 0))]);
        let input = "A\tsrc/new.rs\n";
        let (changes, new, deleted) = parse_name_status(input, &stat_map);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].status, "added");
        assert_eq!(changes[0].path, "src/new.rs");
        assert_eq!(changes[0].insertions, 20);
        assert_eq!(changes[0].deletions, 0);
        assert_eq!(new, vec!["src/new.rs"]);
        assert!(deleted.is_empty());
    }

    #[test]
    fn parse_name_status_deleted_file() {
        let stat_map = HashMap::from([("old.rs".to_string(), (0, 50))]);
        let input = "D\told.rs\n";
        let (changes, new, deleted) = parse_name_status(input, &stat_map);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].status, "deleted");
        assert_eq!(changes[0].deletions, 50);
        assert!(new.is_empty());
        assert_eq!(deleted, vec!["old.rs"]);
    }

    #[test]
    fn parse_name_status_modified_file() {
        let stat_map = HashMap::from([("src/app.rs".to_string(), (5, 3))]);
        let input = "M\tsrc/app.rs\n";
        let (changes, new, deleted) = parse_name_status(input, &stat_map);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].status, "modified");
        assert_eq!(changes[0].insertions, 5);
        assert_eq!(changes[0].deletions, 3);
        assert!(new.is_empty());
        assert!(deleted.is_empty());
    }

    #[test]
    fn parse_name_status_mixed_changes() {
        let stat_map = HashMap::from([
            ("added.ts".to_string(), (10, 0)),
            ("modified.ts".to_string(), (3, 2)),
            ("deleted.ts".to_string(), (0, 15)),
        ]);
        let input = "A\tadded.ts\nM\tmodified.ts\nD\tdeleted.ts\n";
        let (changes, new, deleted) = parse_name_status(input, &stat_map);

        assert_eq!(changes.len(), 3);
        assert_eq!(new, vec!["added.ts"]);
        assert_eq!(deleted, vec!["deleted.ts"]);
    }

    #[test]
    fn parse_name_status_empty_input() {
        let stat_map = HashMap::new();
        let (changes, new, deleted) = parse_name_status("", &stat_map);
        assert!(changes.is_empty());
        assert!(new.is_empty());
        assert!(deleted.is_empty());
    }

    #[test]
    fn parse_name_status_missing_stat_defaults_to_zero() {
        let stat_map = HashMap::new(); // no stats at all
        let input = "M\tsrc/unknown.rs\n";
        let (changes, _, _) = parse_name_status(input, &stat_map);

        assert_eq!(changes[0].insertions, 0);
        assert_eq!(changes[0].deletions, 0);
    }

    #[test]
    fn parse_name_status_skips_malformed_lines() {
        let stat_map = HashMap::new();
        let input = "no-tab-here\nM\tvalid.rs\n";
        let (changes, _, _) = parse_name_status(input, &stat_map);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "valid.rs");
    }

    #[test]
    fn parse_name_status_unknown_status_treated_as_modified() {
        let stat_map = HashMap::new();
        // R = renamed in git
        let input = "R\trenamed.rs\n";
        let (changes, new, deleted) = parse_name_status(input, &stat_map);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].status, "modified");
        assert!(new.is_empty());
        assert!(deleted.is_empty());
    }

    // ── select_key_files ──

    #[test]
    fn select_key_files_changed_first() {
        let changed = vec!["src/app.tsx", "src/utils.ts"];
        let routes: Vec<&str> = vec![];
        let tree = "";
        let result = select_key_files(&changed, &routes, tree, 10);
        assert_eq!(result, vec!["src/app.tsx", "src/utils.ts"]);
    }

    #[test]
    fn select_key_files_routes_after_changes() {
        let changed = vec!["src/app.tsx"];
        let routes = vec!["app/page.tsx", "app/about/page.tsx"];
        let tree = "";
        let result = select_key_files(&changed, &routes, tree, 10);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], "src/app.tsx");
        assert_eq!(result[1], "app/page.tsx");
        assert_eq!(result[2], "app/about/page.tsx");
    }

    #[test]
    fn select_key_files_deduplicates() {
        let changed = vec!["app/page.tsx"];
        let routes = vec!["app/page.tsx"]; // same file
        let tree = "";
        let result = select_key_files(&changed, &routes, tree, 10);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn select_key_files_respects_max() {
        let changed = vec!["a.ts", "b.ts", "c.ts"];
        let routes = vec!["d.ts", "e.ts"];
        let tree = "./f.ts\n./index.ts\n";
        let result = select_key_files(&changed, &routes, tree, 4);
        assert_eq!(result.len(), 4);
    }

    #[test]
    fn select_key_files_scans_tree_for_entry_points() {
        let changed: Vec<&str> = vec![];
        let routes: Vec<&str> = vec![];
        let tree = "./src/components/Button.tsx\n./src/index.tsx\n./src/app.ts\n./README.md\n";
        let result = select_key_files(&changed, &routes, tree, 10);
        // Should find index.tsx and app.ts (match patterns), but not Button.tsx or README.md
        assert!(result.contains(&"src/index.tsx".to_string()));
        assert!(result.contains(&"src/app.ts".to_string()));
        assert!(!result.contains(&"src/components/Button.tsx".to_string()));
        assert!(!result.contains(&"README.md".to_string()));
    }

    #[test]
    fn select_key_files_tree_filters_non_js_ts_files() {
        let changed: Vec<&str> = vec![];
        let routes: Vec<&str> = vec![];
        let tree = "./src/main.rs\n./src/main.tsx\n./src/index.py\n";
        let result = select_key_files(&changed, &routes, tree, 10);
        // main.rs and index.py should NOT be included (wrong extensions)
        assert!(result.contains(&"src/main.tsx".to_string()));
        assert!(!result.contains(&"src/main.rs".to_string()));
        assert!(!result.contains(&"src/index.py".to_string()));
    }

    #[test]
    fn select_key_files_empty_everything() {
        let result = select_key_files(&[], &[], "", 10);
        assert!(result.is_empty());
    }

    #[test]
    fn select_key_files_strips_dot_slash_prefix() {
        let changed: Vec<&str> = vec![];
        let routes: Vec<&str> = vec![];
        let tree = "./src/layout.tsx\n";
        let result = select_key_files(&changed, &routes, tree, 10);
        assert_eq!(result[0], "src/layout.tsx"); // not "./src/layout.tsx"
    }

    // ── estimate_tokens ──

    #[test]
    fn estimate_tokens_basic() {
        // 400 chars -> ~100 tokens
        let text = "x".repeat(400);
        assert_eq!(estimate_tokens(&text), 100);
    }

    #[test]
    fn estimate_tokens_empty() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn estimate_tokens_short_string() {
        // 3 chars -> 0 tokens (integer division)
        assert_eq!(estimate_tokens("abc"), 0);
    }

    // ── FileChange serialization ──

    #[test]
    fn file_change_serializes_camel_case() {
        let fc = FileChange {
            path: "src/main.rs".to_string(),
            status: "modified".to_string(),
            insertions: 5,
            deletions: 3,
        };
        let json = serde_json::to_value(&fc).unwrap();
        assert_eq!(json["path"], "src/main.rs");
        assert_eq!(json["status"], "modified");
        assert_eq!(json["insertions"], 5);
        assert_eq!(json["deletions"], 3);
    }

    #[test]
    fn file_change_deserializes() {
        let json = r#"{"path":"a.ts","status":"added","insertions":10,"deletions":0}"#;
        let fc: FileChange = serde_json::from_str(json).unwrap();
        assert_eq!(fc.path, "a.ts");
        assert_eq!(fc.status, "added");
        assert_eq!(fc.insertions, 10);
    }

    // ── ProjectSnapshot serialization ──

    #[test]
    fn project_snapshot_serializes_and_deserializes() {
        let snapshot = ProjectSnapshot {
            files_changed: vec![FileChange {
                path: "src/app.tsx".to_string(),
                status: "modified".to_string(),
                insertions: 5,
                deletions: 2,
            }],
            new_files: vec!["src/new.ts".to_string()],
            deleted_files: vec![],
            file_tree: "./src\n./src/app.tsx".to_string(),
            package_json_deps: vec!["react".to_string()],
            route_list: vec!["app/page.tsx".to_string()],
            check_results: vec![],
            console_errors: vec![],
            console_warnings: vec![],
            file_contents: Some(vec![FileContent {
                path: "src/app.tsx".to_string(),
                content: "export default function App() {}".to_string(),
            }]),
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        let restored: ProjectSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.files_changed.len(), 1);
        assert_eq!(restored.new_files, vec!["src/new.ts"]);
        assert!(restored.deleted_files.is_empty());
        assert_eq!(restored.package_json_deps, vec!["react"]);
        assert!(restored.file_contents.is_some());
    }

    #[test]
    fn project_snapshot_with_no_file_contents() {
        let snapshot = ProjectSnapshot {
            files_changed: vec![],
            new_files: vec![],
            deleted_files: vec![],
            file_tree: String::new(),
            package_json_deps: vec![],
            route_list: vec![],
            check_results: vec![],
            console_errors: vec![],
            console_warnings: vec![],
            file_contents: None,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert!(json["fileContents"].is_null());
    }
}
