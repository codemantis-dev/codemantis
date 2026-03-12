use crate::preview::port_detector;
use crate::preview::{DevServerInfo, DevServerStatus, PreviewState};
use crate::terminal::pty_manager::TerminalPool;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
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

#[tauri::command]
pub async fn open_preview_window(
    url: String,
    project_name: String,
    width: Option<f64>,
    height: Option<f64>,
    app_handle: AppHandle,
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

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    let window = WebviewWindowBuilder::new(
        &app_handle,
        "preview",
        WebviewUrl::External(parsed_url),
    )
    .title(format!("CodeMantis Preview — {}", project_name))
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
