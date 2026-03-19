use crate::preview::port_detector;
use crate::preview::{ConsoleLogEntry, DevServerInfo, DevServerStatus, PreviewState};
use crate::terminal::pty_manager::TerminalPool;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::{AppHandle, Emitter, Listener, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerReadyEvent {
    pub port: u16,
    pub url: String,
    pub terminal_id: String,
    pub project_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerErrorEvent {
    pub message: String,
    pub project_path: String,
}

/// Write console error/warn entries to ~/.codemantis/preview-console.log as NDJSON.
/// Truncates to the most recent 200 entries.
fn write_console_log_file(entries: &[ConsoleLogEntry]) {
    let error_entries: Vec<&ConsoleLogEntry> = entries
        .iter()
        .filter(|e| e.level == "error" || e.level == "warn")
        .collect();

    // Only keep the last 200 error/warn entries
    let to_write: Vec<&ConsoleLogEntry> = if error_entries.len() > 200 {
        error_entries[error_entries.len() - 200..].to_vec()
    } else {
        error_entries
    };

    let log_dir = match dirs::home_dir() {
        Some(h) => h.join(".codemantis"),
        None => return,
    };

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        debug!("Failed to create .codemantis dir: {}", e);
        return;
    }

    let log_path = log_dir.join("preview-console.log");
    let file = match std::fs::File::create(&log_path) {
        Ok(f) => f,
        Err(e) => {
            debug!("Failed to create preview-console.log: {}", e);
            return;
        }
    };

    let mut writer = std::io::BufWriter::new(file);
    for entry in to_write {
        if let Ok(json) = serde_json::to_string(entry) {
            let _ = writeln!(writer, "{}", json);
        }
    }
}

#[tauri::command]
pub async fn open_preview_window(
    url: String,
    project_name: String,
    width: Option<f64>,
    height: Option<f64>,
    app_handle: AppHandle,
    preview_state: State<'_, PreviewState>,
) -> Result<(), String> {
    let w = width.unwrap_or(1024.0);
    let h = height.unwrap_or(768.0);

    // Destroy existing preview window if any.
    // Use destroy() instead of close() to avoid firing the CloseRequested event,
    // which would incorrectly signal the JS side that the preview was closed
    // when we're actually just replacing it.
    if let Some(existing) = app_handle.get_webview_window("preview") {
        let _ = existing.destroy();
    }

    // Clear console logs from previous preview session
    {
        let mut logs = preview_state.console_logs.lock().await;
        logs.clear();
    }

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    let console_bridge = include_str!("../../resources/preview-console-bridge.js");

    let window = WebviewWindowBuilder::new(
        &app_handle,
        "preview",
        WebviewUrl::External(parsed_url),
    )
    .title(format!("CodeMantis Preview — {}", project_name))
    .initialization_script(console_bridge)
    .inner_size(w, h)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create preview window: {}", e))?;

    // Emit close event only for genuine user-initiated closes
    let ah = app_handle.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let _ = ah.emit("preview-window-closed", ());
        }
    });

    // Spawn console polling task.
    // Strategy: since eval() is fire-and-forget in Tauri (no return value),
    // we use a two-step approach:
    //   1. eval drains __CM_CONSOLE_BUFFER into document.title with a known prefix
    //   2. Rust reads window.title() and parses the entries
    let poll_ah = app_handle.clone();
    let console_logs = preview_state.console_logs.clone();
    tokio::spawn(async move {
        // Wait briefly for the window to load
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(500));
        loop {
            interval.tick().await;

            // Check if preview window still exists
            let preview_win = match poll_ah.get_webview_window("preview") {
                Some(w) => w,
                None => {
                    debug!("Preview window closed, stopping console polling");
                    break;
                }
            };

            // Step 0: Re-inject console bridge if not present (SPA navigation / external URL fallback)
            let reinject_js = r#"
                (function() {
                    if (typeof window.__CM_CONSOLE_BUFFER === 'undefined') {
                        window.__CM_CONSOLE_BRIDGE_REINJECT = true;
                    }
                })();
            "#;
            let _ = preview_win.eval(reinject_js);

            // If bridge is missing, re-inject it via eval()
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
            let check_reinject_js = format!(
                r#"
                (function() {{
                    if (window.__CM_CONSOLE_BRIDGE_REINJECT) {{
                        delete window.__CM_CONSOLE_BRIDGE_REINJECT;
                        {}
                    }}
                }})();
                "#,
                include_str!("../../resources/preview-console-bridge.js")
                    .replace("if (window.__CM_CONSOLE_BRIDGE) return;", "")
            );
            let _ = preview_win.eval(&check_reinject_js);

            // Step 1: Drain the buffer and encode into document.title with a prefix
            let drain_js = r#"
                (function() {
                    if (window.__CM_CONSOLE_BUFFER && window.__CM_CONSOLE_BUFFER.length > 0) {
                        var entries = window.__CM_CONSOLE_BUFFER.splice(0);
                        var json = JSON.stringify(entries);
                        window.__CM_CONSOLE_PENDING = json;
                    }
                })();
            "#;
            if let Err(e) = preview_win.eval(drain_js) {
                debug!("Console poll drain eval failed: {}", e);
                continue;
            }

            // Small delay to let the JS execute
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

            // Step 2: Move pending data into document.title temporarily so Rust can read it
            let title_js = r#"
                (function() {
                    var pending = window.__CM_CONSOLE_PENDING;
                    if (pending) {
                        window.__CM_CONSOLE_PENDING = null;
                        window.__CM_ORIGINAL_TITLE = document.title;
                        document.title = '__CM_CONSOLE__' + pending;
                    }
                })();
            "#;
            if let Err(e) = preview_win.eval(title_js) {
                debug!("Console poll title eval failed: {}", e);
                continue;
            }

            // Small delay for title to update
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

            // Step 3: Read the title from Rust side
            match preview_win.title() {
                Ok(title) => {
                    if let Some(json_str) = title.strip_prefix("__CM_CONSOLE__") {
                        // Restore the original title
                        let restore_js = r#"
                            (function() {
                                if (window.__CM_ORIGINAL_TITLE !== undefined) {
                                    document.title = window.__CM_ORIGINAL_TITLE;
                                    delete window.__CM_ORIGINAL_TITLE;
                                }
                            })();
                        "#;
                        let _ = preview_win.eval(restore_js);

                        if let Ok(entries) = serde_json::from_str::<Vec<ConsoleLogEntry>>(json_str) {
                            if !entries.is_empty() {
                                let mut store = console_logs.lock().await;

                                // Emit events for errors and warnings to main window
                                for entry in &entries {
                                    if entry.level == "error" || entry.level == "warn" {
                                        let _ = poll_ah.emit("preview-console-entry", entry.clone());
                                    }
                                }

                                store.extend(entries);

                                // Write error/warn entries to log file
                                write_console_log_file(&store);
                            }
                        }
                    }
                }
                Err(e) => {
                    debug!("Failed to read preview window title: {}", e);
                }
            }
        }
    });

    info!("Opened preview window for {}: {}", project_name, url);
    Ok(())
}

#[tauri::command]
pub async fn close_preview_window(app_handle: AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("preview") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn navigate_preview(url: String, app_handle: AppHandle) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("preview")
        .ok_or("Preview window not open")?;

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    window
        .navigate(parsed_url)
        .map_err(|e| format!("Failed to navigate: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn refresh_preview(app_handle: AppHandle) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("preview")
        .ok_or("Preview window not open")?;

    // Navigate to the current URL to refresh
    let current_url = window.url().map_err(|e| e.to_string())?;
    window
        .navigate(current_url)
        .map_err(|e| format!("Failed to refresh: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn focus_preview_window(app_handle: AppHandle) -> Result<bool, String> {
    if let Some(window) = app_handle.get_webview_window("preview") {
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn get_preview_console_logs(
    preview_state: State<'_, PreviewState>,
) -> Result<Vec<ConsoleLogEntry>, String> {
    let logs = preview_state.console_logs.lock().await;
    Ok(logs.clone())
}

#[tauri::command]
pub async fn start_dev_server(
    app_handle: AppHandle,
    terminal_pool: State<'_, TerminalPool>,
    preview_state: State<'_, PreviewState>,
    project_path: String,
    dev_command: Option<String>,
    dev_port: Option<u16>,
) -> Result<String, String> {
    // Check if already running for this project
    {
        let servers = preview_state.dev_servers.lock().await;
        if let Some(info) = servers.get(&project_path) {
            if info.status == DevServerStatus::Detected || info.status == DevServerStatus::Scanning {
                return Ok(info.terminal_id.clone());
            }
        }
    }

    // Create a synthetic session ID for the dev server
    let hash = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        project_path.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    };
    let synthetic_session_id = format!("devserver-{}", &hash[..8]);

    // Determine the command to run
    let cmd = dev_command.unwrap_or_else(|| "npm run dev".to_string());
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    let (shell_cmd, args) = if parts.is_empty() {
        ("npm", vec!["run".to_string(), "dev".to_string()])
    } else {
        let shell = parts[0];
        let args: Vec<String> = parts[1..].iter().map(|s| s.to_string()).collect();
        (shell, args)
    };

    // Create terminal with the dev server command
    let terminal_id = terminal_pool
        .create_terminal(
            app_handle.clone(),
            &synthetic_session_id,
            &project_path,
            Some(shell_cmd),
            Some(args),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Store the dev server info
    let info = DevServerInfo {
        terminal_id: terminal_id.clone(),
        synthetic_session_id: synthetic_session_id.clone(),
        port: None,
        url: None,
        status: DevServerStatus::Scanning,
    };
    {
        let mut servers = preview_state.dev_servers.lock().await;
        servers.insert(project_path.clone(), info);
    }

    // Spawn port detection task
    let ah = app_handle.clone();
    let pp = project_path.clone();
    let tid = terminal_id.clone();
    let expected_port = dev_port;

    // Listen for terminal output to scan for port
    let output_ah = app_handle.clone();
    let output_pp = pp.clone();
    let output_tid = tid.clone();
    let dev_servers = preview_state.dev_servers.clone();

    // Clone app_handle for unlisten cleanup
    let unlisten_ah = app_handle.clone();

    tokio::spawn(async move {
        let event_name = format!("terminal-output-{}", output_tid);

        // Use a channel to collect terminal output
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        // Listen to terminal output events — store EventId so we can unlisten later
        let listener_id = output_ah.listen(event_name, move |event: tauri::Event| {
            let payload = event.payload();
            if let Ok(data) = serde_json::from_str::<String>(payload) {
                let _ = tx.send(data);
            } else {
                let _ = tx.send(payload.to_string());
            }
        });

        let timeout = tokio::time::Duration::from_secs(30);
        let deadline = tokio::time::Instant::now() + timeout;

        // Helper: check if project was removed (stop_dev_server called)
        let project_removed = || async {
            let servers = dev_servers.lock().await;
            !servers.contains_key(&output_pp)
        };

        // Layer 1: Scan terminal output for port patterns
        let detected = loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break false;
            }

            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Some(data)) => {
                    for line in data.lines() {
                        if let Some((port, url)) = port_detector::scan_for_dev_server_url(line) {
                            // Guard: project may have been closed during scanning
                            if project_removed().await {
                                debug!("Project {} was closed during port detection, skipping emit", output_pp);
                                unlisten_ah.unlisten(listener_id);
                                return;
                            }
                            info!("Dev server detected on port {} for {}", port, output_pp);
                            let mut servers = dev_servers.lock().await;
                            if let Some(info) = servers.get_mut(&output_pp) {
                                info.port = Some(port);
                                info.url = Some(url.clone());
                                info.status = DevServerStatus::Detected;
                            }
                            let _ = ah.emit("dev-server-ready", DevServerReadyEvent {
                                port,
                                url,
                                terminal_id: output_tid.clone(),
                                project_path: output_pp.clone(),
                            });
                            unlisten_ah.unlisten(listener_id);
                            return;
                        }
                    }
                }
                Ok(None) => break false,
                Err(_) => break false, // timeout
            }
        };

        // Clean up terminal output listener — no longer needed after Layer 1
        unlisten_ah.unlisten(listener_id);

        if detected {
            return;
        }

        // Guard: project may have been closed during scanning
        if project_removed().await {
            debug!("Project {} was closed during port detection, aborting", output_pp);
            return;
        }

        // Layer 2: Try probing the expected port from template
        if let Some(port) = expected_port {
            info!("Probing expected port {} for {}", port, output_pp);
            {
                let mut servers = dev_servers.lock().await;
                if let Some(info) = servers.get_mut(&output_pp) {
                    info.status = DevServerStatus::Probing;
                }
            }

            for _ in 0..5 {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

                // Guard: check project still exists before each probe
                if project_removed().await {
                    debug!("Project {} was closed during port probing, aborting", output_pp);
                    return;
                }

                if port_detector::probe_port(port).await {
                    let url = format!("http://localhost:{}", port);
                    info!("Dev server confirmed on expected port {} for {}", port, output_pp);
                    let mut servers = dev_servers.lock().await;
                    if let Some(info) = servers.get_mut(&output_pp) {
                        info.port = Some(port);
                        info.url = Some(url.clone());
                        info.status = DevServerStatus::Detected;
                    }
                    let _ = ah.emit("dev-server-ready", DevServerReadyEvent {
                        port,
                        url,
                        terminal_id: output_tid.clone(),
                        project_path: output_pp.clone(),
                    });
                    return;
                }
            }
        }

        // Guard: one final check before emitting failure
        if project_removed().await {
            debug!("Project {} was closed, not emitting failure", output_pp);
            return;
        }

        warn!("Failed to detect dev server port for {}", output_pp);
        {
            let mut servers = dev_servers.lock().await;
            if let Some(info) = servers.get_mut(&output_pp) {
                info.status = DevServerStatus::Failed;
            }
        }
        let _ = ah.emit("dev-server-error", DevServerErrorEvent {
            message: "Could not detect dev server port. Try entering the URL manually.".to_string(),
            project_path: output_pp,
        });
    });

    info!(
        "Started dev server for {} (terminal: {}, session: {})",
        project_path, terminal_id, synthetic_session_id
    );
    Ok(terminal_id)
}

#[tauri::command]
pub async fn stop_dev_server(
    terminal_pool: State<'_, TerminalPool>,
    preview_state: State<'_, PreviewState>,
    project_path: String,
) -> Result<(), String> {
    let info = {
        let mut servers = preview_state.dev_servers.lock().await;
        servers.remove(&project_path)
    };

    if let Some(info) = info {
        // Close all terminals for this synthetic session
        terminal_pool
            .close_all_for_session(&info.synthetic_session_id)
            .await;
        info!("Stopped dev server for {}", project_path);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_dev_server_status(
    preview_state: State<'_, PreviewState>,
    project_path: String,
) -> Result<Option<DevServerInfo>, String> {
    let servers = preview_state.dev_servers.lock().await;
    Ok(servers.get(&project_path).cloned())
}
