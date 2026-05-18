use crate::agents::claude_code::session::AppState;
use crate::preview::port_detector;
use crate::preview::{ConsoleLogEntry, DevServerInfo, DevServerStatus, PreviewState};
use crate::terminal::pty_manager::TerminalPool;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex as AsyncMutex;
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

/// Streamed during dev-server detection so the loading modal can show what is
/// being attempted. Fired multiple times per detection run; consumers should
/// render the latest message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerProgressEvent {
    pub project_path: String,
    /// One of: `"scanning"`, `"probing"`, `"retrying"`, `"lsof"`, `"range"`, `"waiting"`.
    pub stage: String,
    pub message: String,
    #[serde(default)]
    pub port: Option<u16>,
}

/// Write console error/warn entries to `log_dir/preview-console.log` as NDJSON.
/// Truncates to the most recent 200 entries.
/// Extracted as a separate function to allow testing with an arbitrary directory.
fn write_console_log_to_dir(entries: &[ConsoleLogEntry], log_dir: &std::path::Path) {
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

    if let Err(e) = std::fs::create_dir_all(log_dir) {
        debug!("Failed to create log dir: {}", e);
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
            if let Err(e) = writeln!(writer, "{}", json) {
                log::warn!("[preview] Failed to write console log entry: {}", e);
                break;
            }
        }
    }
}

/// Write console error/warn entries to ~/.codemantis/preview-console.log as NDJSON.
/// Truncates to the most recent 200 entries.
fn write_console_log_file(entries: &[ConsoleLogEntry]) {
    let log_dir = match dirs::home_dir() {
        Some(h) => h.join(".codemantis"),
        None => return,
    };
    write_console_log_to_dir(entries, &log_dir);
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

    let tmp_path = std::env::temp_dir().join(format!(
        "codemantis-screenshot-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    let path_str = tmp_path.to_str().ok_or("Invalid temp path")?.to_string();

    // Use `screencapture -l <windowID>` which captures the exact window by its
    // native CGWindowID.  This is more reliable than the coordinate-based `-R`
    // approach which breaks when outer_position() returns incorrect values
    // (observed in wry 0.54 when called from a non-main-thread context).
    //
    // We get the window ID via raw-window-handle → NSWindow → windowNumber.
    #[cfg(target_os = "macos")]
    {
        use raw_window_handle::HasWindowHandle;
        if let Ok(handle) = window.window_handle() {
            if let raw_window_handle::RawWindowHandle::AppKit(appkit) = handle.as_raw() {
                // appkit.ns_view is a pointer to the NSView.
                // NSView.window returns the parent NSWindow.
                // NSWindow.windowNumber returns the CGWindowID.
                let ns_view_ptr = appkit.ns_view.as_ptr() as *const objc2::runtime::AnyObject;
                let ns_window: *const objc2::runtime::AnyObject =
                    unsafe { objc2::msg_send![&*ns_view_ptr, window] };
                let window_number: isize =
                    unsafe { objc2::msg_send![&*ns_window, windowNumber] };
                if window_number > 0 {
                    info!("[preview] Screenshot via window ID {}", window_number);
                    let output = std::process::Command::new("screencapture")
                        .args(["-l", &window_number.to_string(), "-o", "-x", &path_str])
                        .output()
                        .map_err(|e| format!("screencapture -l failed: {}", e))?;
                    if output.status.success() {
                        return Ok(path_str);
                    }
                    warn!(
                        "[preview] screencapture -l {} failed: {}",
                        window_number,
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
            }
        }
    }

    // Fallback: coordinate-based capture
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;

    let mut x = (position.x as f64 / scale) as i32;
    let mut y = (position.y as f64 / scale) as i32;
    let w = (size.width as f64 / scale) as u32;
    let h = (size.height as f64 / scale) as u32;

    info!(
        "[preview] Screenshot fallback -R: physical=({},{}) {}x{}, scale={}, logical=({},{}) {}x{}",
        position.x, position.y, size.width, size.height, scale, x, y, w, h
    );

    if w == 0 || h == 0 {
        return Err(format!(
            "Invalid screenshot dimensions: {}x{} (physical: {}x{}, scale: {})",
            w, h, size.width, size.height, scale
        ));
    }

    if x < 0 { x = 0; }
    if y < 0 { y = 0; }

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

    // Unlisten previous IPC event listeners to prevent duplicate processing
    {
        let mut ids = preview_state.ipc_listener_ids.lock().await;
        for id in ids.drain(..) {
            app_handle.unlisten(id);
        }
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

    // on_navigation handler: CSP-immune JS→Rust IPC channel.
    // Bridge JS creates hidden iframes with cm-ipc:// URLs when fetch() to
    // the approval server is blocked by CSP.  WKWebView's navigation delegate
    // fires for all frames (main + iframes), giving us a reliable callback.
    let nav_ah = app_handle.clone();
    let window = WebviewWindowBuilder::new(
        &app_handle,
        "preview",
        WebviewUrl::External(parsed_url),
    )
    .title(format!("CodeMantis Preview — {}", project_name))
    .initialization_script(&bridge_with_port)
    .on_navigation(move |url| {
        debug!("[preview] on_navigation: {} (scheme={})", url.as_str(), url.scheme());
        if url.scheme() == "cm-ipc" {
            let action = url.path().trim_start_matches('/').to_string();
            let data: Option<String> = url.query_pairs()
                .find(|(k, _)| k == "data")
                .map(|(_, v)| v.to_string());
            info!("[preview] Toolbar action (nav-ipc): {}", action);
            match action.as_str() {
                "screenshot" => {
                    match capture_screenshot_inner(&nav_ah) {
                        Ok(path) => {
                            info!("[preview] Screenshot captured (nav-ipc): {}", path);
                            if let Err(e) = nav_ah.emit("preview-screenshot-taken", path) {
                                warn!("[preview] Failed to emit screenshot event: {}", e);
                            }
                        }
                        Err(e) => warn!("[preview] Screenshot failed (nav-ipc): {}", e),
                    }
                }
                "close" => {
                    if let Some(win) = nav_ah.get_webview_window("preview") {
                        let _ = win.close();
                    }
                }
                "open" => {
                    if let Some(data_str) = &data {
                        if let Ok(parsed) = serde_json::from_str::<ToolbarAction>(data_str) {
                            if let Some(url_str) = &parsed.url {
                                match Url::parse(url_str) {
                                    Ok(u) if u.scheme() == "http" || u.scheme() == "https" => {
                                        info!("[preview] Opening in browser (nav-ipc): {}", u.as_str());
                                        let _ = std::process::Command::new("open").arg(u.as_str()).spawn();
                                    }
                                    _ => warn!("[preview] Rejected open with invalid URL: {}", url_str),
                                }
                            }
                        }
                    }
                }
                "console_to_chat" => {
                    if let Some(data_str) = &data {
                        if let Ok(parsed) = serde_json::from_str::<ToolbarAction>(data_str) {
                            if let Some(logs) = &parsed.logs {
                                info!("[preview] Console logs to chat (nav-ipc, {} bytes)", logs.len());
                                if let Err(e) = nav_ah.emit("preview-console-to-chat", logs.clone()) {
                                    warn!("[preview] Failed to emit console-to-chat: {}", e);
                                }
                            }
                        }
                    }
                }
                other => debug!("[preview] Unknown nav-ipc action: {}", other),
            }
            return false; // Cancel the fake iframe navigation
        }
        true // Allow all real navigations
    })
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

    // ── Tauri IPC listeners for toolbar actions and console batches ────
    // These handle actions sent via window.__TAURI__.event.emit() from the
    // bridge JS.  This is the PRIMARY action channel — the document.title
    // polling below is kept as a fallback for non-localhost origins where
    // Tauri IPC is not available (dangerousRemoteDomainIpcAccess is scoped
    // to localhost / 127.0.0.1).
    // Diagnostic: listen for IPC health-check from the bridge JS
    let diag_listener_id = app_handle.listen("preview-ipc-diag", move |event| {
        info!("[preview] IPC diagnostic received from bridge JS: {}", event.payload());
    });

    info!("[preview] Registering IPC event listeners for toolbar actions and console batches");

    let ipc_ah = app_handle.clone();
    let ipc_console_logs = preview_state.console_logs.clone();
    let _ipc_project_path = project_path.clone();
    let action_listener_id = app_handle.listen("preview-toolbar-action", move |event| {
        let payload = event.payload();
        if let Ok(action) = serde_json::from_str::<ToolbarAction>(payload) {
            info!("[preview] Toolbar action (IPC): {}", action.action);
            match action.action.as_str() {
                "screenshot" => {
                    match capture_screenshot_inner(&ipc_ah) {
                        Ok(path) => {
                            info!("[preview] Screenshot captured: {}", path);
                            if let Err(e) = ipc_ah.emit("preview-screenshot-taken", path) {
                                warn!("[preview] Failed to emit screenshot event: {}", e);
                            }
                        }
                        Err(e) => warn!("[preview] Screenshot failed: {}", e),
                    }
                }
                "close" => {
                    if let Some(win) = ipc_ah.get_webview_window("preview") {
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
                        if let Err(e) = ipc_ah.emit("preview-console-to-chat", logs.clone()) {
                            warn!("[preview] Failed to emit console-to-chat: {}", e);
                        }
                    }
                }
                other => debug!("[preview] Unknown toolbar action: {}", other),
            }
        }
    });

    let console_ipc_ah = app_handle.clone();
    let console_listener_id = app_handle.listen("preview-console-batch", move |event| {
        let payload = event.payload();
        if let Ok(entries) = serde_json::from_str::<Vec<ConsoleLogEntry>>(payload) {
            if entries.is_empty() {
                return;
            }
            // Emit events for errors and warnings to main window
            for entry in &entries {
                if entry.level == "error" || entry.level == "warn" {
                    if let Err(e) = console_ipc_ah.emit("preview-console-entry", entry.clone()) {
                        warn!("[preview] Failed to emit preview-console-entry: {}", e);
                    }
                }
            }

            let rt = tokio::runtime::Handle::try_current();
            if let Ok(handle) = rt {
                let logs_clone = ipc_console_logs.clone();
                let entries_clone = entries;
                handle.spawn(async move {
                    let mut store = logs_clone.lock().await;
                    store.extend(entries_clone);
                    write_console_log_file(&store);
                });
            }
        }
    });

    // Store listener IDs for cleanup when the preview is replaced or closed
    {
        let mut ids = preview_state.ipc_listener_ids.lock().await;
        ids.push(diag_listener_id);
        ids.push(action_listener_id);
        ids.push(console_listener_id);
    }

    // Grab a clone of the current cancellation token for this polling task.
    let poll_token = {
        let cancel = preview_state.poll_cancel.lock().await;
        cancel.clone()
    };

    // Spawn console polling + callback port injection task (fallback for non-IPC domains).
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

            // Delay to let the JS execute — needs enough time for WKWebView
            // to run the eval and update internal state.
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

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

            // Delay for document.title → NSWindow title propagation
            tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

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

    // --- Port detection: register listener BEFORE spawning the detection task ---
    // This eliminates a race condition where fast-starting frameworks (Vite ~295ms)
    // print their URL before the spawned task's listener is registered. The unbounded
    // channel buffers all events until the task starts consuming them.
    let event_name = format!("terminal-output-{}", terminal_id);
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let listener_id = app_handle.listen(&event_name, move |event: tauri::Event| {
        let payload = event.payload();
        if let Ok(data) = serde_json::from_str::<String>(payload) {
            let _ = tx.send(data);
        } else {
            let _ = tx.send(payload.to_string());
        }
    });

    // The PTY child PID lets the lsof poller (Layer 1.5) ask the OS directly
    // what ports the dev-server subprocess is listening on. This is the most
    // reliable detection signal — it bypasses output parsing entirely.
    let child_pid = terminal_pool.get_devserver_pid(&terminal_id).await;

    // Spawn port detection task
    let ah = app_handle.clone();
    let pp = project_path.clone();
    let output_tid = terminal_id.clone();
    let expected_port = dev_port;
    let dev_servers = preview_state.dev_servers.clone();
    let unlisten_ah = app_handle.clone();

    tokio::spawn(async move {
        run_port_detection(
            ah,
            unlisten_ah,
            dev_servers,
            pp,
            output_tid,
            expected_port,
            child_pid,
            rx,
            listener_id,
        )
        .await;
    });

    info!(
        "Started dev server for {} (terminal: {}, session: {})",
        project_path, terminal_id, synthetic_session_id
    );
    Ok(terminal_id)
}

// ── Dev-server port detection ────────────────────────────────────────────
//
// `run_port_detection` is the supervisor for a single dev-server start.
// Four worker tasks race to identify the port the dev server is serving on:
//
//   * Layer 1 — output_worker:   parses `terminal-output-{id}` for URLs.
//   * Layer 1.5 — lsof_worker:   queries `lsof -p <pid>` for bound TCP ports.
//   * Layer 2 — expected_worker: probes the port from the project template.
//   * Layer 3 — range_worker:    probes common dev-server ports (5173, 3000, …)
//
// Each worker, on finding a candidate port, spawns a `confirm_and_announce`
// task that probes the port with backoff. The first task that gets a real
// HTTP response wins — it pushes to `winner_tx`, the supervisor cancels every
// other task, and `dev-server-ready` is emitted.
//
// Adaptive deadline: 90 s base, extended to `last_activity + 30 s` whenever
// the PTY emits output, capped at 180 s. Silent dev servers fail at 90 s;
// noisy slow-compile dev servers (Next.js + Turbopack on a cold disk) get the
// extra runway because each output line resets the clock — the same way a
// human waits when they can see the dev server still working.

const DETECT_BASE_TIMEOUT_SECS: u64 = 90;
const DETECT_MAX_TIMEOUT_SECS: u64 = 180;
const DETECT_ACTIVITY_EXTENSION_SECS: u64 = 30;
const DETECT_LSOF_POLL_MS: u64 = 1500;
const DETECT_RANGE_POLL_MS: u64 = 2000;
const DETECT_PROJECT_REMOVED_POLL_MS: u64 = 500;

#[allow(clippy::too_many_arguments)]
async fn run_port_detection(
    ah: AppHandle,
    unlisten_ah: AppHandle,
    dev_servers: Arc<AsyncMutex<std::collections::HashMap<String, DevServerInfo>>>,
    project_path: String,
    terminal_id: String,
    expected_port: Option<u16>,
    child_pid: Option<u32>,
    rx: tokio::sync::mpsc::UnboundedReceiver<String>,
    listener_id: tauri::EventId,
) {
    info!(
        "[preview] Port detection task started for {} (terminal: {}, expected_port: {:?}, child_pid: {:?})",
        project_path, terminal_id, expected_port, child_pid
    );

    let started_at = tokio::time::Instant::now();
    let max_deadline = started_at + tokio::time::Duration::from_secs(DETECT_MAX_TIMEOUT_SECS);
    let base_deadline = started_at + tokio::time::Duration::from_secs(DETECT_BASE_TIMEOUT_SECS);
    let last_activity_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));

    let occupied_ports: Arc<AsyncMutex<HashSet<u16>>> = Arc::new(AsyncMutex::new(HashSet::new()));
    let pty_exited = Arc::new(AtomicBool::new(false));
    let cancel = CancellationToken::new();

    // Single channel; whichever worker probes a real HTTP response first wins.
    let (winner_tx, mut winner_rx) =
        tokio::sync::mpsc::unbounded_channel::<(u16, String, &'static str)>();

    // PTY-exit listener — flips an atomic so the lsof worker (whose PID is
    // gone after exit) can stop polling. Output and range workers continue
    // because they're useful even after PTY death (orphan reconnect).
    let close_listener_id = {
        let flag = pty_exited.clone();
        let close_tid = terminal_id.clone();
        ah.listen("dev-server-closed", move |event| {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Closed {
                terminal_id: String,
            }
            if let Ok(e) = serde_json::from_str::<Closed>(event.payload()) {
                if e.terminal_id == close_tid {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        })
    };

    // Project-removed watcher: when the user calls stop_dev_server (or
    // start_dev_server's stale-state cleanup) removes the project from
    // dev_servers, cancel everything. Cheap polling — we don't have a
    // reactive signal on the HashMap.
    {
        let dev_servers = dev_servers.clone();
        let project_path = project_path.clone();
        let cancel_w = cancel.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel_w.cancelled() => return,
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(
                        DETECT_PROJECT_REMOVED_POLL_MS,
                    )) => {
                        let removed = !dev_servers.lock().await.contains_key(&project_path);
                        if removed {
                            cancel_w.cancel();
                            return;
                        }
                    }
                }
            }
        });
    }

    let _ = ah.emit(
        "dev-server-progress",
        DevServerProgressEvent {
            project_path: project_path.clone(),
            stage: "scanning".into(),
            message: "Scanning terminal output and ports for dev-server URL…".into(),
            port: None,
        },
    );

    // ── Worker A: terminal-output scanner ──────────────────────────────
    {
        let ah = ah.clone();
        let project_path = project_path.clone();
        let occupied_ports = occupied_ports.clone();
        let cancel_w = cancel.clone();
        let winner_tx = winner_tx.clone();
        let last_activity_ms = last_activity_ms.clone();
        let probed_ports: Arc<AsyncMutex<HashSet<u16>>> =
            Arc::new(AsyncMutex::new(HashSet::new()));
        let mut rx = rx;
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel_w.cancelled() => return,
                    msg = rx.recv() => {
                        let Some(data) = msg else { return; };
                        let elapsed_ms = started_at.elapsed().as_millis() as u64;
                        last_activity_ms.store(elapsed_ms, Ordering::Relaxed);
                        for line in data.lines() {
                            if let Some(occ) = port_detector::extract_occupied_port(line) {
                                occupied_ports.lock().await.insert(occ);
                            }
                            if let Some((port, _url)) = port_detector::scan_for_dev_server_url(line) {
                                let already = !probed_ports.lock().await.insert(port);
                                if already { continue; }
                                if occupied_ports.lock().await.contains(&port) { continue; }
                                let _ = ah.emit("dev-server-progress", DevServerProgressEvent {
                                    project_path: project_path.clone(),
                                    stage: "probing".into(),
                                    message: format!(
                                        "Detected port {} in dev-server output, verifying…",
                                        port
                                    ),
                                    port: Some(port),
                                });
                                spawn_confirmation(port, "output", winner_tx.clone(), cancel_w.clone());
                            }
                        }
                    }
                }
            }
        });
    }

    // ── Worker B (Layer 1.5): lsof poller ──────────────────────────────
    if let Some(pid) = child_pid {
        let ah = ah.clone();
        let project_path = project_path.clone();
        let cancel_w = cancel.clone();
        let winner_tx = winner_tx.clone();
        let pty_exited = pty_exited.clone();
        tokio::spawn(async move {
            let mut probing: HashSet<u16> = HashSet::new();
            loop {
                tokio::select! {
                    _ = cancel_w.cancelled() => return,
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(DETECT_LSOF_POLL_MS)) => {
                        if pty_exited.load(Ordering::Relaxed) { return; }
                        let ports = match tokio::task::spawn_blocking(move || {
                            port_detector::scan_pid_ports(pid)
                        }).await {
                            Ok(p) => p,
                            Err(_) => continue,
                        };
                        for port in ports {
                            if !probing.insert(port) { continue; }
                            let _ = ah.emit("dev-server-progress", DevServerProgressEvent {
                                project_path: project_path.clone(),
                                stage: "lsof".into(),
                                message: format!(
                                    "Dev-server process is listening on port {}, verifying…",
                                    port
                                ),
                                port: Some(port),
                            });
                            spawn_confirmation(port, "lsof", winner_tx.clone(), cancel_w.clone());
                        }
                    }
                }
            }
        });
    }

    // ── Worker C (Layer 2): expected-port prober ───────────────────────
    if let Some(port) = expected_port {
        let ah = ah.clone();
        let project_path = project_path.clone();
        let cancel_w = cancel.clone();
        let winner_tx = winner_tx.clone();
        tokio::spawn(async move {
            let _ = ah.emit("dev-server-progress", DevServerProgressEvent {
                project_path: project_path.clone(),
                stage: "probing".into(),
                message: format!("Probing template-configured port {}…", port),
                port: Some(port),
            });
            confirm_and_announce(port, "expected", winner_tx, cancel_w).await;
        });
    }

    // ── Worker D (Layer 3): range scanner ──────────────────────────────
    {
        let ah = ah.clone();
        let project_path = project_path.clone();
        let occupied_ports = occupied_ports.clone();
        let pty_exited = pty_exited.clone();
        let cancel_w = cancel.clone();
        let winner_tx = winner_tx.clone();
        tokio::spawn(async move {
            let mut probing: HashSet<u16> = HashSet::new();
            loop {
                tokio::select! {
                    _ = cancel_w.cancelled() => return,
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(DETECT_RANGE_POLL_MS)) => {
                        let occupied = occupied_ports.lock().await.clone();
                        let pty_dead = pty_exited.load(Ordering::Relaxed);
                        let plan = layer3_targets(pty_dead, &occupied, expected_port);
                        for port in &plan.probe_set {
                            if plan.exclude.contains(port) { continue; }
                            if !probing.insert(*port) { continue; }
                            let _ = ah.emit("dev-server-progress", DevServerProgressEvent {
                                project_path: project_path.clone(),
                                stage: "range".into(),
                                message: format!(
                                    "Probing common dev-server port {} ({})…",
                                    port, plan.label
                                ),
                                port: Some(*port),
                            });
                            spawn_confirmation(*port, "range", winner_tx.clone(), cancel_w.clone());
                        }
                    }
                }
            }
        });
    }

    // Drop our handle so when every worker (and every spawned confirmation
    // task) exits, recv() returns None — the supervisor's "all workers
    // exhausted" branch.
    drop(winner_tx);

    // ── Supervisor: race winner against adaptive deadline ──────────────
    loop {
        let now = tokio::time::Instant::now();
        let last_act_ms = last_activity_ms.load(Ordering::Relaxed);
        let activity_extended = if last_act_ms > 0 {
            started_at
                + tokio::time::Duration::from_millis(last_act_ms)
                + tokio::time::Duration::from_secs(DETECT_ACTIVITY_EXTENSION_SECS)
        } else {
            started_at
        };
        let effective_deadline = std::cmp::min(
            std::cmp::max(base_deadline, activity_extended),
            max_deadline,
        );

        if effective_deadline <= now {
            cancel.cancel();
            unlisten_ah.unlisten(listener_id);
            unlisten_ah.unlisten(close_listener_id);
            let still_active = dev_servers.lock().await.contains_key(&project_path);
            if !still_active {
                return;
            }
            warn!(
                "Failed to detect dev server port for {} (terminal: {}, elapsed: {}s)",
                project_path,
                terminal_id,
                started_at.elapsed().as_secs()
            );
            {
                let mut servers = dev_servers.lock().await;
                if let Some(info) = servers.get_mut(&project_path) {
                    info.status = DevServerStatus::Failed;
                }
            }
            if let Err(e) = ah.emit(
                "dev-server-error",
                DevServerErrorEvent {
                    message: "Could not detect dev server port. Try entering the URL manually."
                        .to_string(),
                    project_path: project_path.clone(),
                },
            ) {
                warn!("[preview] Failed to emit dev-server-error: {}", e);
            }
            return;
        }

        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                unlisten_ah.unlisten(listener_id);
                unlisten_ah.unlisten(close_listener_id);
                debug!("[preview] Detection cancelled for {}", project_path);
                return;
            }
            msg = winner_rx.recv() => {
                match msg {
                    Some((port, url, source)) => {
                        cancel.cancel();
                        unlisten_ah.unlisten(listener_id);
                        unlisten_ah.unlisten(close_listener_id);
                        let still_active = dev_servers.lock().await.contains_key(&project_path);
                        if !still_active {
                            debug!("Project {} closed before emit; dropping winner", project_path);
                            return;
                        }
                        info!(
                            "Dev server confirmed on port {} for {} (source={}, elapsed={}s)",
                            port,
                            project_path,
                            source,
                            started_at.elapsed().as_secs()
                        );
                        {
                            let mut servers = dev_servers.lock().await;
                            if let Some(info) = servers.get_mut(&project_path) {
                                info.port = Some(port);
                                info.url = Some(url.clone());
                                info.status = DevServerStatus::Detected;
                            }
                        }
                        if let Err(e) = ah.emit(
                            "dev-server-ready",
                            DevServerReadyEvent {
                                port,
                                url,
                                terminal_id: terminal_id.clone(),
                                project_path: project_path.clone(),
                            },
                        ) {
                            warn!("[preview] Failed to emit dev-server-ready: {}", e);
                        }
                        return;
                    }
                    None => {
                        // All workers + spawned probes have exited. Loop to
                        // recompute deadline; effective_deadline <= now will
                        // fire the timeout branch on the next iteration.
                        // Sleep briefly to avoid a hot loop in the rare case
                        // recv() returns None but deadline isn't yet hit
                        // (e.g. project just removed and cancel.cancelled()
                        // arm hasn't fired yet).
                        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                    }
                }
            }
            _ = tokio::time::sleep_until(effective_deadline) => {
                // Wake to recompute. If activity extended the deadline,
                // we'll keep waiting; otherwise the next iteration's
                // effective_deadline <= now check fires the timeout branch.
            }
        }
    }
}

/// Spawn a fire-and-forget task that probes `port` until success/cancel.
fn spawn_confirmation(
    port: u16,
    source: &'static str,
    winner_tx: tokio::sync::mpsc::UnboundedSender<(u16, String, &'static str)>,
    cancel: CancellationToken,
) {
    tokio::spawn(async move {
        confirm_and_announce(port, source, winner_tx, cancel).await;
    });
}

/// Probe `port` repeatedly until it serves an HTTP response or the
/// supervisor cancels. Backoff: 200 ms → 5 s ceiling, persistent. Unlike
/// the prior implementation, we never abandon a candidate — slow
/// first-compile dev servers (Vite warming up its dep graph, Next.js +
/// Turbopack on a cold disk) eventually respond, and the supervisor's
/// adaptive deadline is what decides when "eventually" is too long.
async fn confirm_and_announce(
    port: u16,
    source: &'static str,
    winner_tx: tokio::sync::mpsc::UnboundedSender<(u16, String, &'static str)>,
    cancel: CancellationToken,
) {
    const DELAYS_MS: [u64; 8] = [200, 500, 1000, 1500, 2500, 5000, 5000, 5000];
    let mut idx: usize = 0;
    loop {
        if cancel.is_cancelled() {
            return;
        }
        let delay = DELAYS_MS.get(idx).copied().unwrap_or(5000);
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(delay)) => {}
        }
        if cancel.is_cancelled() {
            return;
        }
        if port_detector::probe_port(port).await {
            let url = format!("http://localhost:{}", port);
            // send() returning Err just means the supervisor already declared
            // a winner — that's fine, we're cleaning up anyway.
            if winner_tx.send((port, url, source)).is_err() {
                return;
            }
            return;
        }
        idx = idx.saturating_add(1);
    }
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

/// Decision returned by `layer3_targets` — which ports to probe and how to
/// label the attempt in logs.
struct Layer3Plan {
    probe_set: Vec<u16>,
    exclude: HashSet<u16>,
    label: &'static str,
}

/// Choose the Layer 3 probe set based on PTY state.
///
/// **PTY still alive** → scan `DEFAULT_DEV_PORTS`, excluding anything the
/// framework flagged "in use" (those belong to a different stale server).
///
/// **PTY exited** → scan only ports the framework called "in use" (plus
/// `expected_port`).  When the user's own previous CodeMantis run left an
/// orphan dev-server holding port 3000, the new spawn dies from the
/// collision — but the orphan IS the server the user wants.  Probing those
/// ports converts what was a hard failure ("Dev server failed" modal) into
/// a transparent reconnect.  Without this, the only recovery was the user
/// hand-typing `localhost:3000` into the modal — which is the symptom that
/// motivated this whole fix.
///
/// Returns an empty `probe_set` when no candidates exist (e.g. PTY exited
/// with zero "in use" messages and no expected port) — caller should skip
/// Layer 3 in that case.
fn layer3_targets(
    pty_dead: bool,
    occupied_ports: &HashSet<u16>,
    expected_port: Option<u16>,
) -> Layer3Plan {
    if pty_dead {
        let mut set: Vec<u16> = occupied_ports.iter().copied().collect();
        // Sort for deterministic probe order (and deterministic log output)
        set.sort_unstable();
        if let Some(port) = expected_port {
            if !set.contains(&port) {
                set.push(port);
            }
        }
        Layer3Plan {
            probe_set: set,
            exclude: HashSet::new(),
            label: "occupied-port reconnect",
        }
    } else {
        Layer3Plan {
            probe_set: port_detector::DEFAULT_DEV_PORTS.to_vec(),
            exclude: occupied_ports.clone(),
            label: "common-port scan",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    // ── Layer 3 target selection ──────────────────────────────────────────────

    #[test]
    fn layer3_pty_alive_scans_defaults_and_excludes_occupied() {
        let mut occupied = HashSet::new();
        occupied.insert(5173);
        let plan = layer3_targets(false, &occupied, None);

        assert_eq!(plan.label, "common-port scan");
        assert_eq!(plan.probe_set, port_detector::DEFAULT_DEV_PORTS.to_vec());
        assert!(plan.exclude.contains(&5173));
    }

    #[test]
    fn layer3_pty_dead_probes_occupied_ports_only() {
        // Core "every 2nd time" recovery scenario: framework printed
        // "Port 3000 is in use" and then died.  We must probe 3000 — that's
        // where the user's previous (orphan) dev server is still running.
        let mut occupied = HashSet::new();
        occupied.insert(3000);
        let plan = layer3_targets(true, &occupied, None);

        assert_eq!(plan.label, "occupied-port reconnect");
        assert_eq!(plan.probe_set, vec![3000]);
        assert!(
            plan.exclude.is_empty(),
            "PTY-dead reconnect must NOT exclude the very ports it's trying to recover"
        );
    }

    #[test]
    fn layer3_pty_dead_includes_expected_port_alongside_occupied() {
        let mut occupied = HashSet::new();
        occupied.insert(3000);
        let plan = layer3_targets(true, &occupied, Some(3001));

        assert!(plan.probe_set.contains(&3000));
        assert!(plan.probe_set.contains(&3001));
    }

    #[test]
    fn layer3_pty_dead_dedupes_expected_port_when_already_occupied() {
        let mut occupied = HashSet::new();
        occupied.insert(3000);
        let plan = layer3_targets(true, &occupied, Some(3000));

        assert_eq!(plan.probe_set, vec![3000]);
    }

    #[test]
    fn layer3_pty_dead_returns_empty_when_no_signal() {
        // PTY exited but framework gave us nothing — caller should skip
        // Layer 3 rather than scan random ports.
        let plan = layer3_targets(true, &HashSet::new(), None);
        assert!(plan.probe_set.is_empty());
    }

    #[test]
    fn layer3_pty_dead_falls_back_to_expected_port_alone() {
        // PTY exited with no "in use" messages but the user template
        // pinned a port — probe just that.
        let plan = layer3_targets(true, &HashSet::new(), Some(8080));
        assert_eq!(plan.probe_set, vec![8080]);
        assert_eq!(plan.label, "occupied-port reconnect");
    }

    #[test]
    fn layer3_pty_dead_probe_order_is_deterministic() {
        // Sorted probe order ensures consistent logs and predictable
        // first-port-wins behavior.
        let mut occupied = HashSet::new();
        occupied.insert(5173);
        occupied.insert(3000);
        occupied.insert(8080);
        let plan = layer3_targets(true, &occupied, None);

        assert_eq!(plan.probe_set, vec![3000, 5173, 8080]);
    }


    // ── ConsoleLogEntry ───────────────────────────────────────────────────────

    #[test]
    fn console_log_entry_serializes_with_camel_case_fields() {
        let entry = ConsoleLogEntry {
            level: "error".to_string(),
            ts: "2024-01-01T00:00:00Z".to_string(),
            msg: "Something went wrong".to_string(),
            url: "http://localhost:3000/app".to_string(),
            stack: Some("Error\n  at foo (app.js:1)".to_string()),
        };

        let json = serde_json::to_string(&entry).unwrap();

        // All fields are simple words so camelCase == snake_case here, but
        // verify each field name is present and the value round-trips.
        assert!(json.contains("\"level\""), "missing level field: {}", json);
        assert!(json.contains("\"ts\""), "missing ts field: {}", json);
        assert!(json.contains("\"msg\""), "missing msg field: {}", json);
        assert!(json.contains("\"url\""), "missing url field: {}", json);
        assert!(json.contains("\"stack\""), "missing stack field: {}", json);
        assert!(json.contains("error"));
        assert!(json.contains("Something went wrong"));
    }

    #[test]
    fn console_log_entry_with_null_stack_serializes_correctly() {
        let entry = ConsoleLogEntry {
            level: "warn".to_string(),
            ts: "2024-01-02T12:00:00Z".to_string(),
            msg: "Deprecated API".to_string(),
            url: "http://localhost:3000/page".to_string(),
            stack: None,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"stack\":null"));
    }

    #[test]
    fn console_log_entry_deserializes_from_json() {
        let json = r#"{"level":"error","ts":"2024-01-01T00:00:00Z","msg":"oops","url":"http://localhost:3000","stack":null}"#;
        let entry: ConsoleLogEntry = serde_json::from_str(json).unwrap();

        assert_eq!(entry.level, "error");
        assert_eq!(entry.msg, "oops");
        assert!(entry.stack.is_none());
    }

    // ── write_console_log_to_dir ──────────────────────────────────────────────

    fn make_entry(level: &str, msg: &str) -> ConsoleLogEntry {
        ConsoleLogEntry {
            level: level.to_string(),
            ts: "2024-01-01T00:00:00Z".to_string(),
            msg: msg.to_string(),
            url: "http://localhost:3000".to_string(),
            stack: None,
        }
    }

    #[test]
    fn write_console_log_to_dir_creates_log_file_with_ndjson_entries() {
        let dir = tempdir().unwrap();
        let entries = vec![
            make_entry("error", "Error one"),
            make_entry("warn", "Warning one"),
            make_entry("info", "Info — should be filtered out"),
        ];

        write_console_log_to_dir(&entries, dir.path());

        let log_path = dir.path().join("preview-console.log");
        assert!(log_path.exists(), "log file should be created");

        let content = fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        // Only error and warn entries should be written
        assert_eq!(lines.len(), 2, "expected 2 lines (error + warn), got: {:?}", lines);

        // Each line should be valid JSON containing the expected message
        let parsed_0: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        let parsed_1: serde_json::Value = serde_json::from_str(lines[1]).unwrap();

        assert_eq!(parsed_0["level"], "error");
        assert_eq!(parsed_0["msg"], "Error one");
        assert_eq!(parsed_1["level"], "warn");
        assert_eq!(parsed_1["msg"], "Warning one");
    }

    #[test]
    fn write_console_log_to_dir_handles_empty_entries() {
        let dir = tempdir().unwrap();

        write_console_log_to_dir(&[], dir.path());

        // File is created (truncated) even with no entries
        let log_path = dir.path().join("preview-console.log");
        assert!(log_path.exists(), "log file should be created even for empty input");

        let content = fs::read_to_string(&log_path).unwrap();
        assert!(content.is_empty(), "log file should be empty for empty input");
    }

    #[test]
    fn write_console_log_to_dir_filters_out_info_and_log_entries() {
        let dir = tempdir().unwrap();
        let entries = vec![
            make_entry("info", "Info message"),
            make_entry("log", "Log message"),
            make_entry("debug", "Debug message"),
        ];

        write_console_log_to_dir(&entries, dir.path());

        let log_path = dir.path().join("preview-console.log");
        let content = fs::read_to_string(&log_path).unwrap();
        assert!(
            content.is_empty(),
            "info/log/debug entries should not be written, got: {}",
            content
        );
    }

    #[test]
    fn write_console_log_to_dir_truncates_to_200_most_recent_entries() {
        let dir = tempdir().unwrap();

        // Create 250 error entries
        let entries: Vec<ConsoleLogEntry> = (0..250)
            .map(|i| make_entry("error", &format!("Error #{}", i)))
            .collect();

        write_console_log_to_dir(&entries, dir.path());

        let log_path = dir.path().join("preview-console.log");
        let content = fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        assert_eq!(lines.len(), 200, "should truncate to 200 entries");

        // Most recent 200 entries should be written (indices 50..250)
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        let last: serde_json::Value = serde_json::from_str(lines[199]).unwrap();
        assert_eq!(first["msg"], "Error #50");
        assert_eq!(last["msg"], "Error #249");
    }

    #[test]
    fn write_console_log_to_dir_creates_parent_dir_if_missing() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("a").join("b").join("c");

        write_console_log_to_dir(&[make_entry("error", "test")], &nested);

        assert!(nested.join("preview-console.log").exists());
    }

    // ── DevServerReadyEvent / DevServerErrorEvent serialization ──────────────

    #[test]
    fn dev_server_ready_event_serializes_with_camel_case() {
        let event = DevServerReadyEvent {
            port: 3000,
            url: "http://localhost:3000".to_string(),
            terminal_id: "term-1".to_string(),
            project_path: "/home/user/project".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"terminalId\""), "expected camelCase terminalId: {}", json);
        assert!(json.contains("\"projectPath\""), "expected camelCase projectPath: {}", json);
        assert!(json.contains("\"port\""));
        assert!(json.contains("\"url\""));
        assert!(!json.contains("terminal_id"), "snake_case must not appear: {}", json);
    }

    #[test]
    fn dev_server_error_event_serializes_with_camel_case() {
        let event = DevServerErrorEvent {
            message: "Could not detect port".to_string(),
            project_path: "/home/user/project".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"projectPath\""), "expected camelCase projectPath: {}", json);
        assert!(json.contains("\"message\""));
        assert!(!json.contains("project_path"), "snake_case must not appear: {}", json);
    }
}
