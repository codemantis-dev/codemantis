//! Force the main webview to repaint without reloading.
//!
//! After a long screen-lock the WKWebView's `IOSurface` compositing layer
//! can be torn down. The view comes back white on display wake until
//! something asks AppKit to draw it again. `setNeedsDisplay:YES` on the
//! content `NSView` triggers exactly that — at zero state cost (no JS
//! reload, no React re-mount).
//!
//! This replaces the previous reload-on-stale-pong path in
//! `wake_observer.rs`. Reload was destructive (drops every Zustand
//! store, kicks the user back to start screen); repaint is not.

use log::{info, warn};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
const MAIN_WINDOW_LABEL: &str = "main";

/// Best-effort: ask the main window's content view to repaint. No-op on
/// non-macOS targets and on non-fatal errors. Caller does not need to
/// check the result.
pub fn force_repaint_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            warn!("[lifecycle] force_repaint: main window unavailable");
            return;
        };
        match repaint_window(&window) {
            Ok(()) => info!("[lifecycle] force_repaint: setNeedsDisplay dispatched"),
            Err(e) => warn!("[lifecycle] force_repaint failed: {}", e),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "macos")]
fn repaint_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    use raw_window_handle::HasWindowHandle;

    let handle = window
        .window_handle()
        .map_err(|e| format!("window_handle: {}", e))?;
    let raw = handle.as_raw();
    let raw_window_handle::RawWindowHandle::AppKit(appkit) = raw else {
        return Err("not an AppKit window handle".to_string());
    };

    // appkit.ns_view → NSView; setNeedsDisplay: schedules a redraw on the
    // next AppKit run loop tick.
    let ns_view_ptr = appkit.ns_view.as_ptr() as *const objc2::runtime::AnyObject;
    // SAFETY: `ns_view` is owned by the live Tauri window; the pointer is
    // valid for the duration of this call. `setNeedsDisplay:` is a bog-
    // standard AppKit selector with a `BOOL` (`bool` in objc2 0.6) param.
    unsafe {
        let _: () = objc2::msg_send![&*ns_view_ptr, setNeedsDisplay: true];
        // Also nudge the content view's window to refresh its display, which
        // covers cases where the IOSurface backing the whole content area
        // (not just the view) needs reattachment.
        let ns_window: *const objc2::runtime::AnyObject =
            objc2::msg_send![&*ns_view_ptr, window];
        if !ns_window.is_null() {
            let _: () = objc2::msg_send![&*ns_window, displayIfNeeded];
        }
    }
    Ok(())
}
