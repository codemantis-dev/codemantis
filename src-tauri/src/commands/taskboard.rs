use crate::claude::session::AppState;
use crate::preview::PreviewState;
use log::info;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub passed: bool,
    pub evidence: String,
    pub checked_at: String,
}

#[tauri::command]
pub async fn create_task_plan(
    state: State<'_, AppState>,
    project_path: String,
    plan_json: String,
) -> Result<String, String> {
    let id = format!("plan-{}", chrono::Utc::now().timestamp_millis());
    state
        .database
        .insert_task_plan(&id, &project_path, &plan_json)
        .map_err(|e| format!("Failed to save plan: {}", e))?;
    info!("Created task plan {} for {}", id, project_path);
    Ok(id)
}

#[tauri::command]
pub async fn get_task_plan(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Option<String>, String> {
    state
        .database
        .get_task_plan(&project_path)
        .map_err(|e| format!("Failed to get plan: {}", e))
}

#[tauri::command]
pub async fn update_task_status(
    state: State<'_, AppState>,
    project_path: String,
    task_id: String,
    status: String,
) -> Result<(), String> {
    // Load plan, update task status, save back
    let plan_json = state
        .database
        .get_task_plan(&project_path)
        .map_err(|e| format!("Failed to get plan: {}", e))?
        .ok_or("No plan found")?;

    let mut plan: serde_json::Value =
        serde_json::from_str(&plan_json).map_err(|e| format!("Failed to parse plan: {}", e))?;

    if let Some(wps) = plan
        .get_mut("work_packages")
        .and_then(|v| v.as_array_mut())
    {
        for wp in wps.iter_mut() {
            if let Some(tasks) = wp.get_mut("tasks").and_then(|v| v.as_array_mut()) {
                for task in tasks.iter_mut() {
                    if task.get("id").and_then(|v| v.as_str()) == Some(&task_id) {
                        task["status"] = serde_json::Value::String(status.clone());
                    }
                }
            }
        }
    }

    let updated =
        serde_json::to_string(&plan).map_err(|e| format!("Failed to serialize: {}", e))?;
    state
        .database
        .update_task_plan(&project_path, &updated)
        .map_err(|e| format!("Failed to update plan: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn update_task(
    state: State<'_, AppState>,
    project_path: String,
    task_id: String,
    task_json: String,
) -> Result<(), String> {
    let plan_json = state
        .database
        .get_task_plan(&project_path)
        .map_err(|e| format!("Failed to get plan: {}", e))?
        .ok_or("No plan found")?;

    let mut plan: serde_json::Value =
        serde_json::from_str(&plan_json).map_err(|e| format!("Failed to parse plan: {}", e))?;

    let updated_task: serde_json::Value =
        serde_json::from_str(&task_json).map_err(|e| format!("Failed to parse task: {}", e))?;

    if let Some(wps) = plan
        .get_mut("work_packages")
        .and_then(|v| v.as_array_mut())
    {
        for wp in wps.iter_mut() {
            if let Some(tasks) = wp.get_mut("tasks").and_then(|v| v.as_array_mut()) {
                for task in tasks.iter_mut() {
                    if task.get("id").and_then(|v| v.as_str()) == Some(&task_id) {
                        *task = updated_task.clone();
                    }
                }
            }
        }
    }

    let updated =
        serde_json::to_string(&plan).map_err(|e| format!("Failed to serialize: {}", e))?;
    state
        .database
        .update_task_plan(&project_path, &updated)
        .map_err(|e| format!("Failed to update plan: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_task(
    state: State<'_, AppState>,
    project_path: String,
    task_id: String,
) -> Result<(), String> {
    let plan_json = state
        .database
        .get_task_plan(&project_path)
        .map_err(|e| format!("Failed to get plan: {}", e))?
        .ok_or("No plan found")?;

    let mut plan: serde_json::Value =
        serde_json::from_str(&plan_json).map_err(|e| format!("Failed to parse plan: {}", e))?;

    if let Some(wps) = plan
        .get_mut("work_packages")
        .and_then(|v| v.as_array_mut())
    {
        for wp in wps.iter_mut() {
            if let Some(tasks) = wp.get_mut("tasks").and_then(|v| v.as_array_mut()) {
                tasks.retain(|t| t.get("id").and_then(|v| v.as_str()) != Some(&task_id));
            }
        }
    }

    let updated =
        serde_json::to_string(&plan).map_err(|e| format!("Failed to serialize: {}", e))?;
    state
        .database
        .update_task_plan(&project_path, &updated)
        .map_err(|e| format!("Failed to update plan: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn reorder_tasks(
    state: State<'_, AppState>,
    project_path: String,
    wp_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let plan_json = state
        .database
        .get_task_plan(&project_path)
        .map_err(|e| format!("Failed to get plan: {}", e))?
        .ok_or("No plan found")?;

    let mut plan: serde_json::Value =
        serde_json::from_str(&plan_json).map_err(|e| format!("Failed to parse plan: {}", e))?;

    if let Some(wps) = plan
        .get_mut("work_packages")
        .and_then(|v| v.as_array_mut())
    {
        for wp in wps.iter_mut() {
            if wp.get("id").and_then(|v| v.as_str()) != Some(&wp_id) {
                continue;
            }
            if let Some(tasks) = wp.get_mut("tasks").and_then(|v| v.as_array_mut()) {
                let task_map: std::collections::HashMap<String, serde_json::Value> = tasks
                    .drain(..)
                    .filter_map(|t| {
                        let id = t.get("id")?.as_str()?.to_string();
                        Some((id, t))
                    })
                    .collect();

                for id in &ordered_ids {
                    if let Some(task) = task_map.get(id) {
                        tasks.push(task.clone());
                    }
                }
            }
        }
    }

    let updated =
        serde_json::to_string(&plan).map_err(|e| format!("Failed to serialize: {}", e))?;
    state
        .database
        .update_task_plan(&project_path, &updated)
        .map_err(|e| format!("Failed to update plan: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn run_code_verification(
    project_path: String,
    check_type: String,
    path: Option<String>,
    pattern: Option<String>,
    command: Option<String>,
) -> Result<CheckResult, String> {
    let now = chrono::Utc::now().to_rfc3339();

    match check_type.as_str() {
        "file_exists" => {
            let file_path = path.ok_or("Missing path for file_exists check")?;
            let full_path = Path::new(&project_path).join(&file_path);
            let exists = full_path.exists();
            Ok(CheckResult {
                passed: exists,
                evidence: if exists {
                    "File exists".into()
                } else {
                    format!("File not found: {}", file_path)
                },
                checked_at: now,
            })
        }
        "file_contains" => {
            let file_path = path.ok_or("Missing path for file_contains check")?;
            let search_pattern = pattern.ok_or("Missing pattern for file_contains check")?;
            let full_path = Path::new(&project_path).join(&file_path);
            match std::fs::read_to_string(&full_path) {
                Ok(content) => {
                    let found = content.contains(&search_pattern);
                    Ok(CheckResult {
                        passed: found,
                        evidence: if found {
                            format!("Pattern '{}' found", search_pattern)
                        } else {
                            format!("Pattern '{}' not found in {}", search_pattern, file_path)
                        },
                        checked_at: now,
                    })
                }
                Err(e) => Ok(CheckResult {
                    passed: false,
                    evidence: format!("Cannot read file {}: {}", file_path, e),
                    checked_at: now,
                }),
            }
        }
        "grep_codebase" => {
            let search_pattern = pattern.ok_or("Missing pattern for grep_codebase check")?;
            let extensions = ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java"];
            let mut found = false;
            let mut evidence = String::new();

            fn walk_dir(
                dir: &Path,
                extensions: &[&str],
                pattern: &str,
                found: &mut bool,
                evidence: &mut String,
            ) {
                let entries = match std::fs::read_dir(dir) {
                    Ok(e) => e,
                    Err(_) => return,
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                    // Skip common directories
                    if path.is_dir() {
                        if matches!(
                            name,
                            "node_modules"
                                | ".git"
                                | "dist"
                                | "build"
                                | ".next"
                                | "__pycache__"
                                | "target"
                        ) {
                            continue;
                        }
                        walk_dir(&path, extensions, pattern, found, evidence);
                        if *found {
                            return;
                        }
                        continue;
                    }

                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if !extensions.contains(&ext) {
                        continue;
                    }

                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if content.contains(pattern) {
                            *found = true;
                            *evidence =
                                format!("Pattern '{}' found in {}", pattern, path.display());
                            return;
                        }
                    }
                }
            }

            walk_dir(
                Path::new(&project_path),
                &extensions,
                &search_pattern,
                &mut found,
                &mut evidence,
            );

            if !found {
                evidence = format!("Pattern '{}' not found in codebase", search_pattern);
            }

            Ok(CheckResult {
                passed: found,
                evidence,
                checked_at: now,
            })
        }
        "command_succeeds" => {
            let cmd = command.ok_or("Missing command for command_succeeds check")?;
            let output = Command::new("sh")
                .args(["-c", &cmd])
                .current_dir(&project_path)
                .output()
                .await
                .map_err(|e| format!("Failed to run command: {}", e))?;

            let success = output.status.success();
            Ok(CheckResult {
                passed: success,
                evidence: if success {
                    "Command succeeded".into()
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    format!(
                        "Exit code: {}, stderr: {}",
                        output.status,
                        stderr.chars().take(200).collect::<String>()
                    )
                },
                checked_at: now,
            })
        }
        _ => Err(format!("Unknown check type: {}", check_type)),
    }
}

#[tauri::command]
pub async fn run_dom_verification(
    app_handle: AppHandle,
    project_path: String,
    route: String,
    selector: String,
    assertion: String,
    expected: Option<String>,
) -> Result<CheckResult, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let preview = app_handle
        .get_webview_window("preview")
        .ok_or("Preview window not open — start the dev server first")?;

    // Get current dev server port from PreviewState
    let preview_state = app_handle.state::<PreviewState>();
    let port = {
        let servers = preview_state.dev_servers.lock().await;
        servers
            .get(&project_path)
            .and_then(|info| info.port)
            .ok_or("No dev server running for this project")?
    };

    // Navigate to route
    let route_path = if route.starts_with('/') {
        route.clone()
    } else {
        format!("/{}", route)
    };
    let nav_url = format!("http://localhost:{}{}", port, route_path);
    let nav_js = format!(
        "window.location.href = '{}';",
        nav_url.replace('\'', "\\'")
    );
    preview
        .eval(&nav_js)
        .map_err(|e| format!("Failed to navigate: {}", e))?;

    // Wait for page load
    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

    // Build assertion script body (produces a JSON string result)
    let escaped_selector = selector.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_route = route.replace('\\', "\\\\").replace('\'', "\\'");
    let assertion_body = match assertion.as_str() {
        "exists" => format!(
            r#"var el = document.querySelector('{sel}');
               result = JSON.stringify({{ passed: !!el, evidence: el ? el.tagName + ' found' : 'No element matching selector found on {route}' }});"#,
            sel = escaped_selector, route = escaped_route
        ),
        "visible" => format!(
            r#"var el = document.querySelector('{sel}');
               if (!el) {{ result = JSON.stringify({{ passed: false, evidence: 'No element matching selector found on {route}' }}); }}
               else {{
                   var rect = el.getBoundingClientRect();
                   var style = window.getComputedStyle(el);
                   var visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                   result = JSON.stringify({{ passed: visible, evidence: visible ? 'Element is visible' : 'Element exists but is not visible' }});
               }}"#,
            sel = escaped_selector, route = escaped_route
        ),
        "has_text" => {
            let exp = expected.as_deref().unwrap_or("");
            let escaped_exp = exp.replace('\\', "\\\\").replace('\'', "\\'");
            format!(
                r#"var el = document.querySelector('{sel}');
                   if (!el) {{ result = JSON.stringify({{ passed: false, evidence: 'No element matching selector found on {route}' }}); }}
                   else {{
                       var hasText = (el.textContent || '').includes('{exp}');
                       result = JSON.stringify({{ passed: hasText, evidence: hasText ? 'Text found' : 'Expected text not found in element' }});
                   }}"#,
                sel = escaped_selector, route = escaped_route, exp = escaped_exp
            )
        }
        "has_options" => format!(
            r#"var el = document.querySelector('{sel}');
               if (!el) {{ result = JSON.stringify({{ passed: false, evidence: 'No element matching selector found on {route}' }}); }}
               else {{
                   var options = el.querySelectorAll('option, [role="option"]');
                   result = JSON.stringify({{ passed: options.length > 0, evidence: 'Found ' + options.length + ' options' }});
               }}"#,
            sel = escaped_selector, route = escaped_route
        ),
        "count_gte" => {
            let exp = expected.as_deref().unwrap_or("1");
            format!(
                r#"var els = document.querySelectorAll('{sel}');
                   var count = els.length;
                   var expected = {exp};
                   result = JSON.stringify({{ passed: count >= expected, evidence: 'Found ' + count + ' elements (expected >= ' + expected + ')' }});"#,
                sel = escaped_selector, exp = exp
            )
        }
        "not_exists" => format!(
            r#"var el = document.querySelector('{sel}');
               result = JSON.stringify({{ passed: !el, evidence: el ? 'Element found but should not exist' : 'Element correctly does not exist' }});"#,
            sel = escaped_selector
        ),
        _ => return Err(format!("Unknown assertion: {}", assertion)),
    };

    // Use a unique marker so we can identify this specific result in console logs
    let check_id = format!("dom_check_{}", chrono::Utc::now().timestamp_millis());

    // Build the full JS: run assertion, push result into __CM_CONSOLE_BUFFER
    // with level "dom_result" so the existing console polling loop picks it up.
    let full_js = format!(
        r#"(function() {{
            try {{
                var result;
                {body}
                window.__CM_CONSOLE_BUFFER = window.__CM_CONSOLE_BUFFER || [];
                window.__CM_CONSOLE_BUFFER.push({{
                    level: 'dom_result',
                    ts: '{check_id}',
                    msg: typeof result === 'string' ? result : JSON.stringify(result),
                    url: window.location.href
                }});
            }} catch(e) {{
                window.__CM_CONSOLE_BUFFER = window.__CM_CONSOLE_BUFFER || [];
                window.__CM_CONSOLE_BUFFER.push({{
                    level: 'dom_result',
                    ts: '{check_id}',
                    msg: JSON.stringify({{ passed: false, evidence: 'Script error: ' + e.message }}),
                    url: window.location.href
                }});
            }}
        }})()"#,
        body = assertion_body, check_id = check_id
    );

    preview
        .eval(&full_js)
        .map_err(|e| format!("Failed to run assertion: {}", e))?;

    // Poll PreviewState.console_logs for our dom_result entry.
    // The console polling loop runs every 500ms. We poll up to 6 times (3 seconds total).
    let console_logs = preview_state.console_logs.clone();
    let max_polls = 6;
    for _ in 0..max_polls {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        let logs = console_logs.lock().await;
        // Search for our specific result by matching the check_id in the ts field
        if let Some(entry) = logs.iter().rev().find(|e| e.level == "dom_result" && e.ts == check_id) {
            // Parse the result JSON from msg
            if let Ok(result) = serde_json::from_str::<DomCheckPayload>(&entry.msg) {
                return Ok(CheckResult {
                    passed: result.passed,
                    evidence: result.evidence,
                    checked_at: now,
                });
            } else {
                // msg wasn't valid JSON — treat as failure
                return Ok(CheckResult {
                    passed: false,
                    evidence: format!("DOM check returned unparseable result: {}", entry.msg),
                    checked_at: now,
                });
            }
        }
    }

    // Timed out waiting for result
    Ok(CheckResult {
        passed: false,
        evidence: format!(
            "DOM check timed out — no result received for selector '{}' on route '{}'. \
             Ensure the preview window is open and the page has loaded.",
            selector, route
        ),
        checked_at: now,
    })
}

#[derive(Debug, Deserialize)]
struct DomCheckPayload {
    passed: bool,
    evidence: String,
}
