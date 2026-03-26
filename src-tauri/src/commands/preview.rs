use crate::claude::session::AppState;
use crate::preview::port_detector;
use crate::preview::{ConsoleLogEntry, DevServerInfo, DevServerStatus, PreviewState};
use crate::terminal::pty_manager::TerminalPool;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::{AppHandle, Emitter, Listener, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio_util::sync::CancellationToken;
use url::Url;

/// Actions pushed by preview toolbar buttons via the JS action queue.
/// Replaces fetch()-based callbacks which are blocked by pages with restrictive CSP.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ToolbarAction {
    pub action: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub logs: Option<String>,
}

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

/// Capture screenshot of the preview window (shared logic).
/// Used by both the Tauri command and the HTTP callback handler in approval_server.
pub fn capture_screenshot_inner(app_handle: &AppHandle) -> Result<String, String> {
    let window = app_handle
        .get_webview_window("preview")
        .ok_or("Preview window not open")?;

    // Check if the window is minimized — screencapture cannot capture minimized windows
    if let Ok(true) = window.is_minimized() {
        return Err("Cannot screenshot minimized window".to_string());
    }

    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;

    // Convert physical coords to logical/point coords for screencapture -R
    let mut x = (position.x as f64 / scale) as i32;
    let mut y = (position.y as f64 / scale) as i32;
    let w = (size.width as f64 / scale) as u32;
    let h = (size.height as f64 / scale) as u32;

    info!(
        "[preview] Screenshot: physical=({},{}) {}x{}, scale={}, logical=({},{}) {}x{}",
        position.x, position.y, size.width, size.height, scale, x, y, w, h
    );

    if w == 0 || h == 0 {
        return Err(format!(
            "Invalid screenshot dimensions: {}x{} (physical: {}x{}, scale: {})",
            w, h, size.width, size.height, scale
        ));
    }

    // Clamp negative positions — window may be partially off-screen
    if x < 0 {
        warn!("[preview] Screenshot x position negative ({}), clamping to 0", x);
        x = 0;
    }
    if y < 0 {
        warn!("[preview] Screenshot y position negative ({}), clamping to 0", y);
        y = 0;
    }

    let tmp_path = std::env::temp_dir().join(format!(
        "codemantis-screenshot-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    let path_str = tmp_path.to_str().ok_or("Invalid temp path")?.to_string();

    let rect = format!("{},{},{},{}", x, y, w, h);
    let output = std::process::Command::new("screencapture")
        .args(["-R", &rect, "-x", &path_str])
        .output()
        .map_err(|e| format!("screencapture failed: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "screencapture error (rect={}): {}",
            rect,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(path_str)
}

#[tauri::command]
pub async fn open_preview_window(
    url: String,
    project_name: String,
    project_path: String,
    width: Option<f64>,
    height: Option<f64>,
    app_handle: AppHandle,
    preview_state: State<'_, PreviewState>,
) -> Result<(), String> {
    let w = width.unwrap_or(1024.0);
    let h = height.unwrap_or(768.0);

    // Serialize window creation to prevent race conditions where two concurrent
    // calls both find no existing window and both try to create one.
    let _lock = preview_state.window_lock.lock().await;

    // Cancel any previous polling task before destroying the window.
    // This prevents the orphaned task from seeing the window disappear and
    // emitting a stale "preview-window-closed" event for the wrong project.
    {
        let mut cancel = preview_state.poll_cancel.lock().await;
        cancel.cancel();
        *cancel = CancellationToken::new();
    }

    // Destroy existing preview window if any.
    // Use destroy() instead of close() to avoid firing the CloseRequested event,
    // which would incorrectly signal the JS side that the preview was closed
    // when we're actually just replacing it.
    if let Some(existing) = app_handle.get_webview_window("preview") {
        let _ = existing.destroy();
    }

    // Store which project owns this preview window
    {
        let mut active = preview_state.active_preview_project.lock().await;
        *active = Some(project_path.clone());
    }

    // Clear console logs from previous preview session
    {
        let mut logs = preview_state.console_logs.lock().await;
        logs.clear();
    }

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    // Read the approval server port BEFORE creating the window so we can
    // inject it via initialization_script (WKUserScript), which is immune
    // to the loaded page's Content Security Policy.  Using eval() for this
    // is fragile — pages with restrictive CSP silently block it, leaving
    // the toolbar buttons with no callback port.
    let callback_port = {
        let app_state = app_handle.state::<AppState>();
        let port = app_state.approval_server_port.lock().await;
        *port
    };

    let console_bridge = include_str!("../../resources/preview-console-bridge.js");
    let bridge_with_port = match callback_port {
        Some(port) => format!("window.__CM_CALLBACK_PORT = {};\n{}", port, console_bridge),
        None => console_bridge.to_string(),
    };

    let window = WebviewWindowBuilder::new(
        &app_handle,
        "preview",
        WebviewUrl::External(parsed_url),
    )
    .title(format!("CodeMantis Preview — {}", project_name))
    .initialization_script(&bridge_with_port)
    .inner_size(w, h)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create preview window: {}", e))?;

    let _ = window.set_focus();

    // Emit close event only for genuine user-initiated closes.
    // Include the project path so the frontend marks the correct project as closed.
    let ah = app_handle.clone();
    let close_project_path = project_path.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            info!("[preview] CloseRequested — emitting preview-window-closed for {}", close_project_path);
            if let Err(e) = ah.emit("preview-window-closed", close_project_path.clone()) {
                warn!("[preview] Failed to emit preview-window-closed: {}", e);
            }
        }
    });

    // Grab a clone of the current cancellation token for this polling task.
    let poll_token = {
        let cancel = preview_state.poll_cancel.lock().await;
        cancel.clone()
    };

    // Spawn console polling + callback port injection task.
    let poll_ah = app_handle.clone();
    let console_logs = preview_state.console_logs.clone();
    let poll_project_path = project_path.clone();
    tokio::spawn(async move {
        // Wait briefly for the window to load
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Re-inject the callback server port via eval() as a safety net.
        // The primary injection happens via initialization_script, but eval()
        // covers SPA navigations that reload the JS context.
        if let (Some(win), Some(port)) = (poll_ah.get_webview_window("preview"), callback_port) {
            let inject_port_js = format!(
                "window.__CM_CALLBACK_PORT = {};",
                port
            );
            if let Err(e) = win.eval(&inject_port_js) {
                warn!("[preview] Failed to inject callback port via eval: {}", e);
            }
        }

        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(500));
        loop {
            interval.tick().await;

            // Stop polling if this task was cancelled (a new preview window replaced us)
            if poll_token.is_cancelled() {
                debug!("[preview] Polling task cancelled for {}", poll_project_path);
                break;
            }

            // Check if preview window still exists
            let preview_win = match poll_ah.get_webview_window("preview") {
                Some(w) => w,
                None => {
                    // Don't emit close if we were cancelled — the replacement
                    // window's lifecycle owns close events now.
                    if poll_token.is_cancelled() {
                        debug!("[preview] Polling task cancelled (window gone) for {}", poll_project_path);
                        break;
                    }
                    warn!("Preview window gone (possibly WKWebView crash), emitting close event for {}", poll_project_path);
                    // Failsafe: emit close event so frontend syncs state.
                    // Include the project path so the frontend marks the correct
                    // project as closed (not whatever project is currently active).
                    let _ = poll_ah.emit("preview-window-closed", poll_project_path.clone());
                    break;
                }
            };

            // ── Toolbar action processing ──────────────────────────────────
            // Bridge JS buttons push actions to window.__CM_PENDING_ACTIONS
            // instead of calling fetch() (which is blocked by pages with
            // restrictive CSP like connect-src 'self').  We drain the queue
            // into document.title (same CSP-immune trick as console polling)
            // and dispatch each action from Rust.
            let action_drain_js = r#"
                (function() {
                    var q = window.__CM_PENDING_ACTIONS;
                    if (q && q.length > 0) {
                        var batch = q.splice(0);
                        window.__CM_TITLE_BEFORE_ACTION = document.title;
                        document.title = '__CM_ACTIONS__' + JSON.stringify(batch);
                    }
                })();
            "#;
            if let Err(e) = preview_win.eval(action_drain_js) {
                debug!("[preview] Action drain eval failed: {}", e);
            } else {
                tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                if let Ok(title) = preview_win.title() {
                    if let Some(json_str) = title.strip_prefix("__CM_ACTIONS__") {
                        // Restore the original title immediately
                        let _ = preview_win.eval(r#"
                            (function() {
                                if (window.__CM_TITLE_BEFORE_ACTION !== undefined) {
                                    document.title = window.__CM_TITLE_BEFORE_ACTION;
                                    delete window.__CM_TITLE_BEFORE_ACTION;
                                }
                            })();
                        "#);

                        if let Ok(actions) = serde_json::from_str::<Vec<ToolbarAction>>(json_str) {
                            for action in actions {
                                info!("[preview] Toolbar action: {}", action.action);
                                match action.action.as_str() {
                                    "screenshot" => {
                                        match capture_screenshot_inner(&poll_ah) {
                                            Ok(path) => {
                                                info!("[preview] Screenshot captured: {}", path);
                                                if let Err(e) = poll_ah.emit("preview-screenshot-taken", path) {
                                                    warn!("[preview] Failed to emit screenshot event: {}", e);
                                                }
                                            }
                                            Err(e) => warn!("[preview] Screenshot failed: {}", e),
                                        }
                                    }
                                    "close" => {
                                        // window.close() in JS provides immediate feedback;
                                        // this is a belt-and-suspenders close from Rust.
                                        if let Some(win) = poll_ah.get_webview_window("preview") {
                                            let _ = win.close();
                                        }
                                    }
                                    "open" => {
                                        if let Some(url_str) = &action.url {
                                            match Url::parse(url_str) {
                                                Ok(url) if url.scheme() == "http" || url.scheme() == "https" => {
                                                    info!("[preview] Opening in browser: {}", url.as_str());
                                                    let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
                                                }
                                                _ => warn!("[preview] Rejected open with invalid URL: {}", url_str),
                                            }
                                        }
                                    }
                                    "console_to_chat" => {
                                        if let Some(logs) = &action.logs {
                                            info!("[preview] Sending console logs to chat ({} bytes)", logs.len());
                                            if let Err(e) = poll_ah.emit("preview-console-to-chat", logs.clone()) {
                                                warn!("[preview] Failed to emit console-to-chat: {}", e);
                                            }
                                        }
                                    }
                                    other => debug!("[preview] Unknown toolbar action: {}", other),
                                }
                            }
                        }
                        continue; // skip console drain this iteration to avoid title conflicts
                    }
                }
            }

            // Step 0: Re-inject console bridge if not present (SPA navigation / external URL fallback)
            let reinject_js = r#"
                (function() {
                    if (typeof window.__CM_CONSOLE_BUFFER === 'undefined') {
                        window.__CM_CONSOLE_BRIDGE_REINJECT = true;
                    }
                })();
            "#;
            if let Err(e) = preview_win.eval(reinject_js) {
                debug!("[preview] Bridge presence check eval failed: {}", e);
            }

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
            if let Err(e) = preview_win.eval(&check_reinject_js) {
                warn!("[preview] Bridge re-injection eval failed: {}", e);
            }

            // Re-inject callback port (may have been lost after SPA navigation / re-inject)
            if let Some(port) = callback_port {
                let inject_port_js = format!(
                    "if (typeof window.__CM_CALLBACK_PORT === 'undefined') window.__CM_CALLBACK_PORT = {};",
                    port
                );
                if let Err(e) = preview_win.eval(&inject_port_js) {
                    warn!("[preview] Callback port re-injection eval failed: {}", e);
                }
            }

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
                        if let Err(e) = preview_win.eval(restore_js) {
                            debug!("[preview] Title restoration eval failed: {}", e);
                        }

                        if let Ok(entries) = serde_json::from_str::<Vec<ConsoleLogEntry>>(json_str) {
                            if !entries.is_empty() {
                                let mut store = console_logs.lock().await;

                                // Emit events for errors and warnings to main window
                                for entry in &entries {
                                    if entry.level == "error" || entry.level == "warn" {
                                        if let Err(e) = poll_ah.emit("preview-console-entry", entry.clone()) {
                                            warn!("[preview] Failed to emit preview-console-entry: {}", e);
                                        }
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
pub async fn capture_preview_screenshot(
    app_handle: AppHandle,
) -> Result<String, String> {
    capture_screenshot_inner(&app_handle)
}

#[tauri::command]
pub async fn close_preview_window(
    app_handle: AppHandle,
    preview_state: State<'_, PreviewState>,
) -> Result<(), String> {
    // Cancel the polling task so it doesn't emit a stale close event
    // after the window is gone.
    {
        let mut cancel = preview_state.poll_cancel.lock().await;
        cancel.cancel();
        *cancel = CancellationToken::new();
    }

    if let Some(window) = app_handle.get_webview_window("preview") {
        window.close().map_err(|e| e.to_string())?;
    }

    // Clear the active preview project
    {
        let mut active = preview_state.active_preview_project.lock().await;
        *active = None;
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

    // Clean up stale dev server state from a previous failed attempt.
    // This ensures the old terminal is closed and any orphaned child
    // processes are cleaned up before we create a new one.
    {
        let mut servers = preview_state.dev_servers.lock().await;
        if let Some(old_info) = servers.remove(&project_path) {
            info!(
                "[preview] Cleaning up stale dev server for {} (status: {:?}, terminal: {})",
                project_path, old_info.status, old_info.terminal_id
            );
            terminal_pool
                .close_all_for_session(&old_info.synthetic_session_id)
                .await;
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
        info!(
            "[preview] Port detection task started for {} (terminal: {}, expected_port: {:?})",
            output_pp, output_tid, expected_port
        );
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
                            info!("Dev server candidate on port {} for {}, verifying...", port, output_pp);

                            // Probe the port with retries — some frameworks (Next.js
                            // Turbopack, fumadocs-mdx) print the URL before they actually
                            // accept HTTP connections.  Under heavy system load the gap
                            // can exceed 3 seconds. We retry up to 4 times with increasing
                            // delays (total ~7 s max per detected port) while the overall
                            // 30 s deadline still applies as the hard ceiling.
                            let probe_delays_ms: &[u64] = &[1000, 1500, 2000, 2500];
                            let mut probe_succeeded = false;

                            for (attempt, &delay_ms) in probe_delays_ms.iter().enumerate() {
                                tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;

                                // Guard: project may have been closed during the wait
                                if project_removed().await {
                                    debug!("Project {} was closed during port verification, skipping emit", output_pp);
                                    unlisten_ah.unlisten(listener_id);
                                    return;
                                }

                                if port_detector::probe_port(port).await {
                                    probe_succeeded = true;
                                    break;
                                }

                                info!(
                                    "[preview] Port {} probe attempt {}/{} failed for {}, retrying...",
                                    port, attempt + 1, probe_delays_ms.len(), output_pp
                                );
                            }

                            if !probe_succeeded {
                                warn!(
                                    "Dev server on port {} for {} failed all {} probe attempts, continuing scan",
                                    port, output_pp, probe_delays_ms.len()
                                );
                                continue;
                            }

                            info!("Dev server confirmed on port {} for {}", port, output_pp);
                            let mut servers = dev_servers.lock().await;
                            if let Some(info) = servers.get_mut(&output_pp) {
                                info.port = Some(port);
                                info.url = Some(url.clone());
                                info.status = DevServerStatus::Detected;
                            }
                            if let Err(e) = ah.emit("dev-server-ready", DevServerReadyEvent {
                                port,
                                url,
                                terminal_id: output_tid.clone(),
                                project_path: output_pp.clone(),
                            }) {
                                warn!("[preview] Failed to emit dev-server-ready: {}", e);
                            }
                            unlisten_ah.unlisten(listener_id);
                            return;
                        }
                    }
                }
                Ok(None) => {
                    info!("[preview] Terminal output channel closed for {} before port detected", output_pp);
                    break false;
                }
                Err(_) => {
                    warn!("[preview] Port detection timed out after 30s for {}", output_pp);
                    break false;
                }
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
                    if let Err(e) = ah.emit("dev-server-ready", DevServerReadyEvent {
                        port,
                        url,
                        terminal_id: output_tid.clone(),
                        project_path: output_pp.clone(),
                    }) {
                        warn!("[preview] Failed to emit dev-server-ready: {}", e);
                    }
                    return;
                }
            }
        }

        // Guard: one final check before emitting failure
        if project_removed().await {
            debug!("Project {} was closed, not emitting failure", output_pp);
            return;
        }

        warn!("Failed to detect dev server port for {} (terminal: {})", output_pp, output_tid);
        {
            let mut servers = dev_servers.lock().await;
            if let Some(info) = servers.get_mut(&output_pp) {
                info.status = DevServerStatus::Failed;
            }
        }
        if let Err(e) = ah.emit("dev-server-error", DevServerErrorEvent {
            message: "Could not detect dev server port. Try entering the URL manually.".to_string(),
            project_path: output_pp,
        }) {
            warn!("[preview] Failed to emit dev-server-error: {}", e);
        }
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
