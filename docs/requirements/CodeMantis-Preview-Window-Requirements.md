# CodeMantis — Preview Window Feature

**Requirements Specification v1.0**  
**Date:** March 2026  
**Target:** v1.1.0

---

## 1. Feature Overview

CodeMantis gets a **Preview Window** — a separate, resizable, detachable native window that shows the user's running web application inside the app. The user clicks "Run Application," CodeMantis starts the dev server, detects the port, and opens the preview. Console logs from the previewed application are captured and made available to Claude Code for debugging.

**Why this matters:** Currently, building a web app in CodeMantis requires switching to a separate browser to see results. This feature closes the loop — code, preview, and debug all happen within CodeMantis.

---

## 2. User Flow

### 2.1 Happy Path

```
1. User opens a web project in CodeMantis (e.g., Next.js, Vite+React)
2. User clicks the "Run Application" button (🌐 icon in the title bar or right panel)
3. CodeMantis opens the Preview Window (separate native window)
4. Preview Window shows a "Starting dev server..." state
5. CodeMantis starts the dev_command in a managed terminal
6. Terminal output is scanned for a localhost URL pattern
7. Port is detected → Preview Window navigates to the URL
8. User sees their running application
9. Claude edits code → hot-reload updates the preview automatically
10. User can resize, move to another monitor, hide, or close the window
```

### 2.2 Window Lifecycle

```
                    ┌──────────────────────────┐
                    │    "Run Application"      │
                    │      button click         │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  Is dev server already    │
                    │  running for this project?│
                    └──┬────────────────────┬───┘
                       │ YES                │ NO
                       │                    │
           ┌───────────▼──┐    ┌────────────▼──────────┐
           │ Re-use        │    │ Start dev_command in  │
           │ detected port │    │ a managed terminal    │
           └───────────┬──┘    └────────────┬──────────┘
                       │                    │
                       │       ┌────────────▼──────────┐
                       │       │ Scan terminal output   │
                       │       │ for localhost:PORT      │
                       │       └────────────┬──────────┘
                       │                    │
                    ┌──▼────────────────────▼───┐
                    │  Open/focus Preview Window │
                    │  Navigate to detected URL  │
                    │  Inject console log bridge  │
                    └───────────────────────────┘
```

### 2.3 Window States

- **Starting** — Window open, shows spinner + "Starting dev server..." + terminal output excerpt
- **Running** — WebView loaded, showing the application. URL bar visible at top. Console log badge shows count.
- **Error** — Dev server failed to start. Shows error output from terminal with "Retry" and "Open Terminal" buttons.
- **Hidden** — User hid the window (⌘H or hide button). Dev server keeps running. Window can be re-shown.
- **Closed** — User closed the window. Dev server process is NOT killed (user may still want it running for other reasons). User is prompted: "Stop the dev server too?" with [Yes, stop] [No, keep running] options.

---

## 3. Preview Window Design

### 3.1 Window Properties

The Preview Window is a **separate native macOS window** — not a panel inside the main CodeMantis window. This means:

- Independently resizable (minimum 400×300, no maximum)
- Movable to any monitor (including external displays)
- Can be minimized to Dock independently
- Can be hidden (⌘H) without closing
- Retains position and size between sessions (persist in settings)
- Title: "CodeMantis Preview — {project_name}"
- Default size: 1024×768
- Default position: right of the main window (if space available)

### 3.2 Window Layout

```
┌──────────────────────────────────────────────────────────┐
│  CodeMantis Preview — my-project              [−][□][×]  │
├──────────────────────────────────────────────────────────┤
│ ← → ↻  [ http://localhost:3000/dashboard     ▼]  📱💻🖥 │
│                                          [Console: 3 ⚠] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                                                          │
│                   WebView Content                        │
│                  (user's application)                    │
│                                                          │
│                                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ▶ Console (collapsible)                            [▼△]  │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [error] Uncaught TypeError: Cannot read property...  │ │
│ │ [warn]  React: Each child in a list should have...   │ │
│ │ [log]   API response: 200 OK (145ms)                 │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 3.3 Toolbar Elements

**Navigation:**
- **Back/Forward** buttons (← →) — standard browser navigation within the app
- **Refresh** button (↻) — reload the current page. Long-press or right-click: "Hard Refresh (clear cache)"
- **URL bar** — shows and allows editing the current URL. Dropdown shows recent URLs for this project.

**Viewport presets (right side of toolbar):**
- 📱 Mobile (375×667 — iPhone SE size)
- 💻 Tablet (768×1024 — iPad size)
- 🖥 Desktop (full window width)
- These resize the WebView content area, not the window itself. The WebView gets a max-width constraint and centers within the window.

**Console badge:**
- Shows count of console messages since last viewed, with color: red for errors, yellow for warnings, dim for info/log
- Click to toggle the Console Drawer

### 3.4 Console Drawer

A collapsible drawer at the bottom of the Preview Window (like Chrome DevTools console, but simpler):

- Shows `console.log`, `console.warn`, `console.error`, `console.info` messages
- Each entry shows: timestamp, level icon (colored), message text
- Error entries show stack trace (expandable)
- "Clear" button to reset
- "Copy All" button for clipboard
- Max 500 entries (oldest are dropped)
- Resizable height (drag the top edge)

**Critical:** These console messages are also forwarded to the main CodeMantis app and stored in a structure that Claude Code can access. See Section 5.

---

## 4. Smart Port Detection

### 4.1 The Problem

Dev servers don't always start on the expected port. If port 3000 is busy, Next.js tries 3001, then 3002. Vite might go from 5173 to 5174. We can't rely on the template's `dev_port` alone.

### 4.2 Detection Strategy (layered)

**Layer 1: Terminal output parsing (primary, most reliable)**

When the dev server terminal produces output, scan each line for URL patterns:

```rust
// Regex patterns to match, ordered by specificity
static PORT_PATTERNS: &[&str] = &[
    // Framework-specific patterns (most reliable)
    r"Local:\s+https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)",  // Vite, Astro
    r"ready started server on .+?localhost:(\d+)",                      // Next.js
    r"http://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)",             // Generic
    r"listening on port (\d+)",                                         // Express/generic
    r"listening at https?://(?:localhost|127\.0\.0\.1):(\d+)",         // Nuxt, etc.
    r"serving at (?:https?://)?(?:localhost|127\.0\.0\.1):(\d+)",      // Static servers
    r"Available on:\s*https?://(?:localhost|127\.0\.0\.1):(\d+)",      // serve, http-server
    r"Uvicorn running on https?://(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)", // FastAPI/Uvicorn
];
```

This is the most reliable method because it catches the *actual* port the server chose, including fallback ports.

**Layer 2: Template registry hint (fallback)**

If terminal parsing hasn't found a port within 15 seconds, try the `dev_port` from the template registry (3000, 5173, 4321, etc.) by checking if it responds to an HTTP request.

**Layer 3: Process port scan (last resort)**

If both above fail, use `lsof` to find ports opened by the dev server process:

```bash
lsof -i -P -n | grep LISTEN | grep <dev_server_pid>
```

Since CodeMantis spawned the terminal process, we know its PID. We can find which port it's listening on.

### 4.3 Port Detection State Machine

```
[Idle] → "Run Application" clicked → [Scanning]
[Scanning] → URL found in terminal output → [Detected] → open preview
[Scanning] → 15s timeout, no URL found → [Probing] → try dev_port via HTTP HEAD
[Probing] → HTTP 200 on dev_port → [Detected] → open preview
[Probing] → HTTP fails → [Scanning_PID] → lsof on dev server PID
[Scanning_PID] → port found → [Detected] → open preview
[Scanning_PID] → no port → [Failed] → show error, offer manual URL input
```

### 4.4 Port Change Detection

Dev servers can restart and pick a different port. After initial detection, CodeMantis continues scanning terminal output. If a new URL is detected (different port), show a toast: "Dev server restarted on port {new_port}" with a [Switch] button. Auto-switch if the old port stops responding.

### 4.5 "Run Application" Command

**New Tauri command:**

```rust
#[tauri::command]
pub async fn start_dev_server(
    project_path: String,
    template_id: Option<String>,   // to look up dev_command and dev_port
    custom_command: Option<String>, // override: user-specified dev command
    app_handle: tauri::AppHandle,
) -> Result<DevServerHandle, String>
```

**Process:**
1. If `custom_command` is provided, use it. Otherwise, look up `dev_command` from the template registry by `template_id`. If neither, try common defaults: `npm run dev`, `pnpm dev`, `yarn dev`.
2. Start the command in a **managed terminal** (same PTY infrastructure used for the existing terminal panel). This terminal is labeled "Dev Server" and visible in the terminal tabs.
3. Begin scanning terminal output for port patterns immediately.
4. Return a handle containing: terminal_id, PID, detected_port (initially None).
5. Emit `dev-server-port-detected { port, url }` event when port is found.

**If a dev server is already running** (detected by: a terminal labeled "Dev Server" exists for this project and the process is alive), skip starting a new one. Instead, re-detect its port and open/focus the preview window.

---

## 5. Console Log Bridge

### 5.1 The Mechanism

When the Preview Window loads a page, CodeMantis injects a JavaScript initialization script that intercepts `console.*` calls and forwards them to the Rust backend.

**Tauri provides `initialization_script()`** on `WebviewWindowBuilder` — a JS snippet that runs on every page load, before any page scripts execute. This is the injection point.

```javascript
// Injected via initialization_script() on the Preview WebView
(function() {
  const __CM_ORIGINAL = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };
  
  function __cmCapture(level, args) {
    const entry = {
      level: level,
      timestamp: new Date().toISOString(),
      message: Array.from(args).map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
        catch { return String(a); }
      }).join(' '),
      // Capture stack trace for errors
      stack: level === 'error' ? new Error().stack : undefined,
    };
    
    // Send to Rust backend via postMessage to the Tauri IPC
    window.__TAURI_INTERNALS__?.invoke('preview_console_log', { entry })
      .catch(() => {}); // silently fail if IPC not available
  }
  
  console.log = function(...args) { __cmCapture('log', args); __CM_ORIGINAL.log(...args); };
  console.warn = function(...args) { __cmCapture('warn', args); __CM_ORIGINAL.warn(...args); };
  console.error = function(...args) { __cmCapture('error', args); __CM_ORIGINAL.error(...args); };
  console.info = function(...args) { __cmCapture('info', args); __CM_ORIGINAL.info(...args); };
  console.debug = function(...args) { __cmCapture('debug', args); __CM_ORIGINAL.debug(...args); };
  
  // Also capture unhandled errors and promise rejections
  window.addEventListener('error', function(e) {
    __cmCapture('error', [`Uncaught ${e.error?.name || 'Error'}: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`]);
  });
  window.addEventListener('unhandledrejection', function(e) {
    __cmCapture('error', [`Unhandled Promise Rejection: ${e.reason}`]);
  });
})();
```

**Important caveat:** The `initialization_script` approach works well on Tauri's own webviews. For a webview pointing at an external URL (like `localhost:3000`), we need to verify that `window.__TAURI_INTERNALS__` is available. If it isn't (because the external page doesn't have the Tauri IPC bridge), we fall back to:

**Fallback: Periodic eval polling.** Use `webview.eval()` from Rust to periodically (every 500ms) execute a script that reads from a buffer and returns captured console entries. The initialization script stores entries in a `window.__CM_CONSOLE_BUFFER` array, and the polling script drains it:

```javascript
// Injected via initialization_script (always works, no IPC needed)
window.__CM_CONSOLE_BUFFER = [];
// ... same console overrides, but push to buffer instead of invoke:
function __cmCapture(level, args) {
  window.__CM_CONSOLE_BUFFER.push({
    level, timestamp: new Date().toISOString(),
    message: /* serialized args */,
    stack: level === 'error' ? new Error().stack : undefined,
  });
  if (window.__CM_CONSOLE_BUFFER.length > 500) window.__CM_CONSOLE_BUFFER.shift();
}
```

```rust
// Rust: poll every 500ms
let entries_json = preview_webview.eval(
    "JSON.stringify(window.__CM_CONSOLE_BUFFER?.splice(0) || [])"
).await?;
```

### 5.2 Rust Backend: Console Log Storage

**New Tauri command and storage:**

```rust
#[tauri::command]
pub async fn preview_console_log(entry: ConsoleLogEntry, state: State<AppState>) {
    state.preview_console_logs.lock().await.push(entry);
    // Also emit event to main window for the Console Drawer
    // Trim to max 500 entries
}

#[tauri::command]
pub async fn get_preview_console_logs(
    since: Option<String>,  // ISO timestamp, return only newer entries
    level: Option<String>,  // filter: "error", "warn", etc.
    state: State<AppState>,
) -> Vec<ConsoleLogEntry>
```

### 5.3 Making Logs Available to Claude Code

This is the most important part. Console logs need to reach Claude Code so it can debug issues.

**Approach: Surface in Activity Feed + Claude can query via tool.**

When errors occur in the preview console:
1. A red-badged entry appears in the Activity Feed: "🌐 Preview Error: {message}" (collapsed, expandable to show full error + stack)
2. Claude Code can see these in its activity stream
3. For explicit debugging, Claude Code can use the existing bash tool to run a CodeMantis CLI helper: `codemantis preview-logs --errors --last 10` — or more practically, console errors are appended to a rotating log file at `~/.codemantis/preview-console.log` that Claude Code can read via its file read tool.

**The simplest reliable path:** Write console errors and warnings to a file that Claude Code can read:

```
~/.codemantis/preview-console.log
```

Format (one JSON object per line, NDJSON):
```json
{"ts":"2026-03-12T10:15:32.123Z","level":"error","msg":"TypeError: Cannot read properties of null (reading 'map')","stack":"at UserList (UserList.tsx:42:18)\n  at renderWithHooks...","url":"http://localhost:3000/users"}
{"ts":"2026-03-12T10:15:33.456Z","level":"warn","msg":"React: Each child in a list should have a unique \"key\" prop.","url":"http://localhost:3000/users"}
```

This file is truncated to the last 200 entries on each write. Claude Code can read it with its standard file read tool — no special integration needed.

Additionally, surface errors prominently: when a `console.error` arrives, show a toast in the main CodeMantis window: "Preview error: {first line of message}" with a "View" button that opens the Console Drawer.

---

## 6. Technical Implementation

### 6.1 Tauri: Separate Window for Preview

```rust
use tauri::WebviewUrl;

#[tauri::command]
pub async fn open_preview_window(
    url: String,          // e.g., "http://localhost:3000"
    project_name: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let label = "preview";
    
    // If window already exists, navigate to new URL and focus
    if let Some(existing) = app_handle.get_webview_window(label) {
        existing.eval(&format!("window.location.href = '{}'", url))
            .map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    
    // Load saved position/size from settings, or use defaults
    let (width, height) = load_preview_size().unwrap_or((1024.0, 768.0));
    
    let console_bridge_script = include_str!("../resources/preview-console-bridge.js");
    
    let window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        label,
        WebviewUrl::External(url.parse().unwrap()),
    )
    .title(format!("CodeMantis Preview — {}", project_name))
    .inner_size(width, height)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .initialization_script(console_bridge_script)
    .build()
    .map_err(|e| e.to_string())?;
    
    // Start console log polling (fallback for when IPC isn't available)
    start_console_polling(app_handle.clone(), label.to_string());
    
    Ok(())
}
```

**Required Tauri capability permission:**
```json
"core:webview:allow-create-webview-window"
```

### 6.2 Frontend: Preview Button & State

**New store:** `src/stores/previewStore.ts`

```typescript
interface PreviewState {
  isOpen: boolean;
  url: string | null;
  port: number | null;
  status: 'idle' | 'starting' | 'scanning' | 'running' | 'error';
  devServerTerminalId: string | null;
  consoleLogs: ConsoleLogEntry[];
  consoleDrawerOpen: boolean;
  viewportPreset: 'mobile' | 'tablet' | 'desktop';
  errorMessage: string | null;
}
```

**Button placement:** Add a 🌐 "Run Application" button to the title bar, next to the existing MCP button. When clicked:
1. If preview is already running → focus the window
2. If not → start dev server + open preview window

### 6.3 New Files

```
src-tauri/src/
  commands/
    preview.rs              # open_preview_window, start_dev_server,
                            # close_preview_window, get_preview_console_logs
  resources/
    preview-console-bridge.js  # The initialization script for console capture

src/
  stores/
    previewStore.ts         # Preview window state
  hooks/
    usePreviewServer.ts     # Dev server lifecycle + port detection
  types/
    preview.ts              # ConsoleLogEntry, DevServerHandle, etc.
```

### 6.4 Port Detection: Terminal Output Scanner

Add a scan function to the existing terminal output handler. When a terminal is tagged as a "dev-server" terminal, its output passes through the port detector:

```rust
fn scan_for_dev_server_url(line: &str) -> Option<(u16, String)> {
    // Returns (port, full_url) if a dev server URL is found
    // Uses the regex patterns from Section 4.2
}
```

Wire this into the existing `terminal.rs` PTY output handler. When a port is found, emit a Tauri event:

```rust
app_handle.emit("dev-server-ready", DevServerReadyPayload {
    port,
    url: full_url,
    terminal_id: terminal_id.clone(),
}).ok();
```

The frontend listens for this event in `usePreviewServer` and calls `open_preview_window`.

---

## 7. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘ ⇧ P` | Toggle Preview Window (open if closed, focus if open, hide if focused) |
| `⌘ R` (when Preview is focused) | Refresh preview |
| `⌘ ⇧ C` (when Preview is focused) | Toggle Console Drawer |

Add to `src/data/shortcuts.ts` under a new "Preview" category.

---

## 8. Settings

Add to `AppSettings`:

```typescript
// Preview settings
previewDefaultWidth: number;     // default: 1024
previewDefaultHeight: number;    // default: 768
previewLastX: number | null;     // persisted window position
previewLastY: number | null;
previewConsoleAutoOpen: boolean; // auto-open Console Drawer on errors (default: true)
previewAutoStart: boolean;       // auto-start dev server when project opens (default: false)
previewCustomDevCommand: string | null; // override dev_command per project
```

Add a "Preview" section in Settings modal (or extend the "General" tab).

---

## 9. Implementation Order

```
Phase 1: Separate window + manual URL (v1.1-alpha)
  1. Create previewStore.ts and preview.ts types
  2. Create preview.rs with open_preview_window command
  3. Add Tauri capability permission for webview creation
  4. Add "Run Application" button to title bar
  5. Clicking opens a separate window with a URL bar
  6. User can manually enter localhost:3000 and see their app
  7. Test: window opens, navigates, resizes, moves to external monitor

Phase 2: Auto port detection (v1.1-beta)
  8. Add port detection regex patterns to a utility module
  9. Wire terminal output scanner into PTY handler
  10. Create start_dev_server command
  11. Create usePreviewServer hook
  12. "Run Application" now starts the dev server and auto-detects port
  13. Test: scaffold Next.js template, click Run, preview opens automatically

Phase 3: Console log bridge (v1.1-rc)
  14. Create preview-console-bridge.js initialization script
  15. Inject via initialization_script on WebviewWindowBuilder
  16. Create preview_console_log command and in-memory storage
  17. Add Console Drawer UI to the preview window (requires a wrapper page)
  18. Write errors/warnings to ~/.codemantis/preview-console.log
  19. Surface errors in main window Activity Feed
  20. Test: trigger a console.error in the preview app, verify it appears
      in Console Drawer, log file, and Activity Feed

Phase 4: Polish (v1.1)
  21. Viewport presets (mobile/tablet/desktop)
  22. Persist window position/size across sessions
  23. Port change detection (dev server restart)
  24. Settings UI for preview preferences
  25. Keyboard shortcuts
```

---

## 10. Risks & Mitigations

**Risk: `initialization_script` doesn't execute on external URLs in Tauri WebKit.**
Mitigation: Verified that Tauri's `initialization_script()` runs on all page loads, including external URLs. If this fails in practice, fall back to `eval()` polling (Section 5.1 fallback).

**Risk: WebKit renders differently from Chrome.**
Mitigation: Acceptable trade-off. Preview is for rapid feedback, not pixel-perfect Chrome testing. For Chrome-specific testing, users can open the URL in their browser or run Playwright tests. Add a "Open in Browser" button to the toolbar that opens the URL in the system default browser.

**Risk: Console log bridge gets blocked by Content Security Policy.**
Mitigation: The initialization script runs before page scripts and doesn't make network requests — it only writes to an in-memory buffer. The `eval()` polling approach reads from the same buffer. CSP shouldn't block either.

**Risk: Port detection fails for custom/unusual dev server setups.**
Mitigation: Manual URL bar is always available. After 20 seconds without detection, show: "Couldn't detect the dev server. Enter the URL manually or check the terminal for the address."

---

## 11. Future Enhancements (Not for v1.1)

- **Screenshot capture** — "Take Screenshot" button that saves the current preview state and optionally attaches it to the Claude Code chat context
- **Interactive testing via MCP** — Connect `browsermcp` to the preview window so Claude can navigate, click, and test
- **Network inspector** — Show XHR/Fetch requests and responses (like a simplified Network tab)
- **Hot-reload indicator** — Flash a brief overlay when the page hot-reloads after a code change
- **Multi-page previewing** — Open multiple preview windows for different routes simultaneously
- **Responsive preview** — Side-by-side mobile + desktop view
