# CodeMantis — Preview Window & AI Task Board

**Comprehensive Requirements Specification v1.0**
**Date:** March 2026
**Target version:** v1.1.0
**Status:** Pre-implementation

---

## CRITICAL: Browser Integration Warning

**The Preview Window WebView previously failed completely and was removed from the codebase.** This spec addresses every known failure mode with Tauri v2 external URL webviews. Claude Code MUST follow the browser integration section (Section 4) exactly as specified — especially the capability permissions, CSP configuration, and fallback patterns. Do NOT skip or simplify any step in the browser integration. Test each phase independently before proceeding to the next.

---

## Table of Contents

1. Feature Overview
2. Preview Window — User Flow & Design
3. Smart Port Detection
4. Browser Integration (CRITICAL — Read Carefully)
5. Console Log Bridge
6. AI Task Board — Overview
7. Task Decomposition & Planning AI
   - 7.1 Planning API Call
   - 7.2 Planning Response Format
   - 7.3 Interactive Planning Conversation
   - 7.4 Attachments in the Planning Conversation
   - 7.5 Planning AI Lifecycle (Ongoing Involvement — 5 Roles)
   - 7.6 How the Planning AI Gets Codebase Information
8. Task Board UI (Slide-Over Overlay)
9. Sequential Execution Engine
10. Verification Engine
11. DOM Verification via Preview Window
12. Data Models
13. New Files & Modules
14. Implementation Order
15. Known Risks & Mitigations

---

## 1. Feature Overview

Two connected features that together form CodeMantis's "punch" for v1.1:

**Preview Window:** A separate, detachable native macOS window showing the user's running web application. Auto-starts the dev server, auto-detects the port, captures browser console logs, and makes them available to Claude Code.

**AI Task Board:** An AI planning assistant decomposes a requirements spec into atomic, verifiable tasks. Tasks execute sequentially in Claude Code sessions. After each work package completes, a verification engine runs code-level and DOM-level checks, auto-retrying any failures. This solves the "30% problem" where Claude Code builds most of a spec but skips edge cases, error states, and features described late in the document.

The Preview Window is a prerequisite for the Task Board's DOM verification — the verification engine navigates the preview to each route and runs assertion checks.

---

## 2. Preview Window — User Flow & Design

### 2.1 It is NOT a Panel — It is a Separate Window

The Preview Window is a **standalone native macOS window** created via `tauri::WebviewWindowBuilder`. It is NOT embedded in the right panel (there isn't enough horizontal space). The window:

- Is fully independent from the main CodeMantis window
- Can be resized freely (min 400×300, no maximum)
- Can be moved to any monitor, including external displays
- Can be minimized to Dock independently
- Can be hidden via ⌘H without closing
- Persists position and size between sessions (stored in AppSettings)
- Has its own title: "CodeMantis Preview — {project_name}"
- Default size: 1024×768
- Default position: right of the main window (if screen space allows)

### 2.2 User Flow

```
1. User clicks "Run Application" (🌐 button in title bar)
2. Preview Window opens showing "Starting dev server..." spinner
3. CodeMantis starts the dev_command in a managed "Dev Server" terminal
4. Terminal output is scanned for localhost URL
5. Port detected → Preview WebView navigates to URL
6. User sees their running application
7. Code changes → hot-reload updates preview automatically
8. User can: resize, move to another monitor, hide (⌘H), or close (×)
```

### 2.3 Window Layout

```
┌──────────────────────────────────────────────────────────┐
│  CodeMantis Preview — my-project              [−][□][×]  │
├──────────────────────────────────────────────────────────┤
│ ← → ↻  [ http://localhost:3000/            ▼]  📱 💻 🖥  │
│                                       [Console: 3 ⚠]    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    WebView Content                        │
│                   (user's application)                    │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ▶ Console (collapsible)                                  │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [error] TypeError: Cannot read properties of null... │ │
│ │ [warn]  Each child in a list should have a unique... │ │
│ │ [log]   API response: 200 OK (145ms)                 │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Toolbar:** Back/Forward buttons, Refresh (long-press for hard refresh), URL bar (editable, with recent URLs dropdown), viewport presets (mobile 375×667, tablet 768×1024, desktop full-width), Console badge showing unread count.

**Console Drawer:** Collapsible bottom drawer showing console.log/warn/error/info messages. Each entry: timestamp, level icon with color, message text. Errors show expandable stack trace. Clear and Copy All buttons. Max 500 entries. Resizable height.

### 2.4 Window Lifecycle States

| State | Description | UI |
|-------|-------------|-----|
| Starting | Dev server is launching | Spinner + "Starting dev server..." + terminal output excerpt |
| Scanning | Dev server running, detecting port | Spinner + "Detecting server port..." |
| Running | WebView loaded and showing app | Normal browser view with toolbar |
| Error | Dev server failed or port not found | Error message + terminal output + "Retry" and "Open Terminal" buttons |
| Hidden | User hid window (⌘H) | Dev server keeps running. Window can be re-shown. |
| Closed | User closed window (×) | Prompt: "Stop dev server too?" → [Yes] / [No, keep running] |

---

## 3. Smart Port Detection

### 3.1 Why This is Hard

Dev servers don't always use their expected port. If port 3000 is busy, Next.js tries 3001, 3002. Vite goes from 5173 to 5174. Multiple projects running simultaneously compound this. The `dev_port` from the template registry is just a hint.

### 3.2 Three-Layer Detection Strategy

**Layer 1: Terminal output parsing (primary — most reliable)**

When the dev server terminal produces output, scan each line against these regex patterns:

```rust
static PORT_PATTERNS: &[&str] = &[
    // Vite, Astro, Nuxt
    r"Local:\s+https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)",
    // Next.js
    r"ready started server on .+?localhost:(\d+)",
    r"▲ Next.js .+ \(turbo\)\s+- Local:\s+https?://localhost:(\d+)",
    // Generic URL patterns
    r"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)",
    // Express, Hono, etc.
    r"(?i)listening (?:on|at) (?:https?://)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d+)",
    // Static servers (serve, http-server)
    r"Available on:\s*https?://(?:localhost|127\.0\.0\.1):(\d+)",
    // Python/FastAPI
    r"Uvicorn running on https?://(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)",
];
```

**Implementation:** Add this scanner to the existing terminal PTY output handler. When a terminal is tagged as "dev-server", its output passes through the port detector. On match, emit a Tauri event `dev-server-ready { port, url, terminal_id }`.

**Layer 2: Template registry hint (fallback after 15s)**

If terminal parsing hasn't found a port within 15 seconds, try the `dev_port` from the template registry by sending an HTTP HEAD request to `http://localhost:{dev_port}`. If it returns any response (even an error page), the port is active.

```rust
async fn probe_port(port: u16) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build().unwrap();
    client.head(&format!("http://localhost:{}", port))
        .send().await.is_ok()
}
```

**Layer 3: Process port scan (last resort)**

If both above fail, use `lsof` to find ports opened by the dev server process:

```bash
lsof -i TCP -s TCP:LISTEN -n -P | grep <dev_server_pid>
```

Since CodeMantis spawned the terminal process, we know its PID.

### 3.3 Port Change Detection

After initial detection, continue scanning terminal output. If a new URL is detected (different port), show a toast in the main window: "Dev server restarted on port {new_port}" with a [Switch] button. Auto-switch if the old port stops responding.

### 3.4 Dev Server Lifecycle

**New Tauri command: `start_dev_server`**

```rust
#[tauri::command]
pub async fn start_dev_server(
    project_path: String,
    template_id: Option<String>,   // look up dev_command and dev_port
    custom_command: Option<String>, // user override
    app_handle: tauri::AppHandle,
) -> Result<DevServerHandle, String>
```

Process:
1. If `custom_command` provided, use it. Else look up `dev_command` from template registry. Else try common defaults: `npm run dev`, `pnpm dev`, `yarn dev`.
2. Start command in a **managed terminal** labeled "Dev Server" (visible in terminal tabs).
3. Begin scanning terminal output for port patterns immediately.
4. Return handle with: terminal_id, PID, detected_port (initially None).
5. Emit `dev-server-port-detected` when found.

If a dev server is already running (detected by: a "Dev Server" terminal exists for this project and its process is alive), skip starting a new one. Re-detect its port and open/focus the preview window.

---

## 4. Browser Integration (CRITICAL SECTION)

**This section exists because the Preview Window WebView previously failed and was removed. Every instruction here addresses a specific failure mode. Follow exactly.**

### 4.1 The Approach: Tauri v2 Native WebView (NOT Chromium)

Use Tauri's built-in `WebviewWindowBuilder` to create a separate window that loads an external URL. This uses macOS WKWebView (Safari engine) — zero additional binary size, already in Tauri's stack.

**Do NOT:**
- Bundle Chromium, CEF, or any embedded browser engine
- Use an iframe inside the main window's webview
- Try to load external URLs in the main window

### 4.2 Required Capability Permission

**In `src-tauri/capabilities/default.json`, add this permission to the `permissions` array:**

```json
"core:webview:allow-create-webview-window"
```

**This is the #1 reason the previous implementation failed.** Without this permission, `WebviewWindowBuilder::new()` silently fails or returns a 400 error. The error message from Tauri points to the wrong permission name (it says `webview:allow-create-webview` but the actual permission is `core:webview:allow-create-webview-window`).

Also add:
```json
"core:window:allow-create",
"core:window:allow-set-focus",
"core:window:allow-set-size",
"core:window:allow-set-position",
"core:window:allow-center",
"core:window:allow-hide",
"core:window:allow-show",
"core:window:allow-close",
"core:window:allow-destroy"
```

### 4.3 Creating the Preview Window (Rust)

```rust
use tauri::webview::WebviewUrl;
use tauri::Manager;

#[tauri::command]
pub async fn open_preview_window(
    url: String,
    project_name: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let label = "preview";

    // If window already exists, navigate to new URL and focus
    if let Some(existing) = app_handle.get_webview_window(label) {
        // Navigate by evaluating JS — this is the reliable way
        existing.eval(&format!(
            "window.location.href = '{}';",
            url.replace('\'', "\\'")
        )).map_err(|e| format!("Failed to navigate: {}", e))?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Read console bridge script from bundled resource
    let console_bridge = include_str!("../resources/preview-console-bridge.js");

    // CRITICAL: Use WebviewUrl::External for localhost URLs
    let external_url = url.parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    let window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        label,
        WebviewUrl::External(external_url),
    )
    .title(format!("CodeMantis Preview — {}", project_name))
    .inner_size(1024.0, 768.0)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .initialization_script(console_bridge)
    .build()
    .map_err(|e| format!("Failed to create preview window: {}", e))?;

    Ok(())
}
```

### 4.4 Known Failure Modes & Fixes

**Failure 1: Window creates but shows blank/white page**
- Cause: CSP (Content Security Policy) in tauri.conf.json blocks external URLs
- Fix: The main app's CSP is set to `null` in your current `tauri.conf.json` — this is fine. But if it's ever set to a restrictive policy, ensure it includes `http://localhost:*` in `connect-src` and `frame-src`. The preview window's WebView is separate from the main app's WebView, so the main CSP shouldn't apply, but verify.

**Failure 2: `WebviewWindowBuilder::new()` returns an error about permissions**
- Cause: Missing `core:webview:allow-create-webview-window` in capabilities
- Fix: Add the exact permission string from Section 4.2. Note: Tauri's error message may say a different permission name than what actually works.

**Failure 3: `initialization_script` doesn't run on the external page**
- Cause: Some Tauri versions only run initialization scripts on `tauri://` protocol pages
- Fix: Test with a simple `initialization_script("document.title = 'CM_TEST'")` first. If `document.title` doesn't change, the initialization script isn't running on external URLs. Fall back to `eval()` polling (Section 5.1 Fallback).

**Failure 4: Window opens but crashes or freezes**
- Cause: On Windows, creating webviews in synchronous commands deadlocks. On macOS this is less common but can happen.
- Fix: The command is already `async`. Ensure it runs on the main thread via Tauri's runtime. If issues persist, use `app_handle.run_on_main_thread()`.

**Failure 5: Hot reload doesn't work in the preview**
- Cause: WKWebView may cache aggressively
- Fix: The preview loads from `localhost`, which should bypass cache. If hot-reload via WebSocket fails, it's because WKWebView's WebSocket implementation differs from Chrome. The user can always click Refresh. For HMR, most frameworks (Vite, Next.js) use WebSocket — verify this works in Safari/WKWebView.

### 4.5 Testing the Browser Integration (BEFORE building any other feature)

**Phase 0 test — do this FIRST, in isolation:**

1. Add the capability permissions from Section 4.2
2. Create a minimal `open_preview_window` command that just opens a window to `https://example.com`
3. Register it in `lib.rs` invoke_handler
4. Create a temporary button in the title bar that calls this command
5. Verify: clicking the button opens a separate native window showing example.com
6. Verify: the window is resizable, movable, and independently closable
7. Verify: calling the command again with a different URL navigates the existing window (doesn't create a second one)

**Only after Phase 0 passes, proceed to localhost URLs and initialization_script.**

If Phase 0 fails, STOP and debug. Do not proceed to port detection or console bridging until the basic external URL WebView works.

### 4.6 CSP for the Preview WebView

The preview WebView needs to be able to:
- Load content from `http://localhost:*` (any port)
- Execute JavaScript (for HMR/hot-reload and our console bridge)
- Make WebSocket connections to `ws://localhost:*` (for HMR)
- Load fonts, images, and stylesheets from localhost and CDNs

If you need to set a CSP on the preview webview specifically:
```
default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src * ws: wss:;
```

But ideally, don't set any CSP on the preview window — it's loading the user's own localhost content and should be unrestricted.

---

## 5. Console Log Bridge

### 5.1 How It Works

When the Preview Window loads a page, an `initialization_script` intercepts `console.*` calls and stores them in a buffer. A Rust-side polling loop reads the buffer periodically via `eval()`.

**Why polling instead of IPC:** The preview WebView loads an external URL (the user's app on localhost). The Tauri IPC bridge (`window.__TAURI_INTERNALS__`) is NOT available in external pages. So we can't `invoke()` from the preview. Instead, we use the buffer + eval pattern.

**File: `src-tauri/resources/preview-console-bridge.js`**

```javascript
// Injected via initialization_script() — runs before any page scripts
(function() {
  // Don't re-inject if already present (page navigated within same WebView)
  if (window.__CM_CONSOLE_BRIDGE) return;
  window.__CM_CONSOLE_BRIDGE = true;
  window.__CM_CONSOLE_BUFFER = [];

  const MAX_ENTRIES = 500;
  const ORIG = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  function serialize(args) {
    return Array.from(args).map(function(a) {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (a instanceof Error) return a.stack || a.message || String(a);
      if (typeof a === 'object') {
        try { return JSON.stringify(a, null, 2); }
        catch(e) { return String(a); }
      }
      return String(a);
    }).join(' ');
  }

  function capture(level, args) {
    var entry = {
      level: level,
      ts: new Date().toISOString(),
      msg: serialize(args),
      url: window.location.href,
    };
    if (level === 'error') {
      try { entry.stack = new Error().stack; } catch(e) {}
    }
    window.__CM_CONSOLE_BUFFER.push(entry);
    if (window.__CM_CONSOLE_BUFFER.length > MAX_ENTRIES) {
      window.__CM_CONSOLE_BUFFER.shift();
    }
  }

  console.log = function() { capture('log', arguments); ORIG.log.apply(console, arguments); };
  console.warn = function() { capture('warn', arguments); ORIG.warn.apply(console, arguments); };
  console.error = function() { capture('error', arguments); ORIG.error.apply(console, arguments); };
  console.info = function() { capture('info', arguments); ORIG.info.apply(console, arguments); };
  console.debug = function() { capture('debug', arguments); ORIG.debug.apply(console, arguments); };

  // Capture unhandled errors
  window.addEventListener('error', function(e) {
    capture('error', ['Uncaught ' + (e.error ? e.error.name + ': ' : '') + e.message + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno]);
  });
  window.addEventListener('unhandledrejection', function(e) {
    capture('error', ['Unhandled Promise Rejection: ' + (e.reason ? (e.reason.message || String(e.reason)) : 'unknown')]);
  });
})();
```

**IMPORTANT NOTES on this script:**
- Uses `function` keywords not arrow functions (broader engine compatibility)
- Uses `arguments` not rest params (WKWebView compatibility)
- Checks `__CM_CONSOLE_BRIDGE` to prevent double-injection on SPA navigation
- Does NOT use `window.__TAURI_INTERNALS__` — unavailable on external pages

### 5.2 Rust: Polling the Console Buffer

```rust
use tokio::time::{interval, Duration};

async fn start_console_polling(app_handle: tauri::AppHandle) {
    let mut tick = interval(Duration::from_millis(500));
    loop {
        tick.tick().await;

        let window = match app_handle.get_webview_window("preview") {
            Some(w) => w,
            None => break, // Window closed, stop polling
        };

        // Drain the buffer atomically
        let script = "JSON.stringify((window.__CM_CONSOLE_BUFFER || []).splice(0))";
        match window.eval_as::<String>(script).await {
            Ok(json_str) => {
                if let Ok(entries) = serde_json::from_str::<Vec<ConsoleLogEntry>>(&json_str) {
                    if !entries.is_empty() {
                        // Store in memory for the console drawer
                        // Emit to main window for activity feed display
                        // Write errors/warnings to log file for Claude Code
                        process_console_entries(&app_handle, entries).await;
                    }
                }
            }
            Err(_) => {
                // eval failed — page might be navigating or not loaded yet
                // This is normal during page transitions, don't log
            }
        }
    }
}
```

**IMPORTANT:** `eval_as` might not be available in all Tauri versions. If not, use `eval()` which is fire-and-forget, and instead have the JS side store results in a `window.__CM_CONSOLE_RESULT` variable that a second `eval()` reads:

```rust
// Alternative if eval_as doesn't exist:
window.eval("window.__CM_CONSOLE_RESULT = JSON.stringify((window.__CM_CONSOLE_BUFFER || []).splice(0))")?;
// Then on next tick:
window.eval("window.__CM_CONSOLE_RESULT")?; // Read the result
```

This is less clean but more compatible.

### 5.3 Making Logs Available to Claude Code

Console logs are written to a rotating NDJSON file that Claude Code can read:

**File:** `~/.codemantis/preview-console.log`

```json
{"ts":"2026-03-12T10:15:32Z","level":"error","msg":"TypeError: Cannot read properties of null","stack":"at UserList.tsx:42","url":"http://localhost:3000/users"}
{"ts":"2026-03-12T10:15:33Z","level":"warn","msg":"React: Each child should have unique key","url":"http://localhost:3000/users"}
```

Truncated to last 200 entries on each write. Claude Code reads this file with its standard `Read` tool — no special integration needed.

Additionally, `console.error` entries surface as entries in the main CodeMantis Activity Feed with a 🌐 badge and red highlight. A toast appears in the main window: "Preview error: {first line}" with [View] button.

---

## 6. AI Task Board — Overview

The Task Board solves the "30% problem": Claude Code builds most of a spec but skips edge cases, error states, validation, and features described late in the document.

**How it solves this:**
1. A planning AI (Gemini/OpenAI via existing assistant infrastructure) decomposes the spec into **atomic, independently verifiable tasks** — not "build auth module" but individual checkable items like "login page has email field with format validation"
2. Tasks include **machine-checkable verification criteria** — file existence, code patterns, DOM assertions
3. Tasks execute sequentially in Claude Code sessions (one work package at a time)
4. After each work package: verification checks run automatically
5. Failed checks → retry prompt sent to Claude Code with specific failures
6. The user watches tasks turn green on the board

---

## 7. Task Decomposition (Planning AI)

### 7.1 Planning API Call

Use the existing `send_assistant_chat` Tauri command (the same one powering the Assistant Panel). The planning AI is an API assistant (Gemini Flash recommended — fast, cheap, good at structured output).

**System prompt for the planning AI:**

```
You are a project planning assistant for a software development tool. 
Given a requirements specification, decompose it into atomic, independently 
verifiable tasks.

RULES:
- Each task must be small enough to verify with a single check
- Include ALL details from the spec — error states, loading states, empty 
  states, validation rules, edge cases
- Do NOT combine multiple distinct features into one task
- Order tasks by dependency (foundational tasks first)
- Group related tasks into work packages of 5-8 tasks each

For each task, provide:
1. title: One-line description
2. description: Exactly what to build (2-3 sentences max)
3. acceptance_criteria: What "done" looks like (human-readable)
4. verification_checks: Array of machine-checkable assertions:
   - file_exists: { path: "src/app/login/page.tsx" }
   - file_contains: { path: "src/app/login/page.tsx", pattern: "type=\"password\"" }
   - grep_codebase: { pattern: "validateEmail", description: "Email validation function exists" }
   - command_succeeds: { command: "npx tsc --noEmit", description: "TypeScript compiles" }
   - dom_check: { route: "/login", selector: "input[type='email']", assertion: "exists" }
   - dom_check: { route: "/login", selector: "select#role, [role='combobox']", assertion: "exists", description: "Role dropdown selector exists" }
   - dom_check: { route: "/dashboard", selector: "table tbody tr", assertion: "count_gte", expected: 1, description: "Data table has at least one row" }
5. work_package: Which group (e.g., "WP1: Authentication", "WP2: Dashboard")
6. depends_on: Array of task IDs this depends on ([] if independent)

For DOM checks:
- Provide multiple fallback selectors separated by commas (native select, Radix combobox, headless UI, data-testid)
- Use assertions: exists | visible | has_text | has_options | count_gte | not_exists
- Include the route to navigate to

Respond in JSON format only. No markdown, no preamble, no explanation.
```

### 7.2 Planning Response Format

```json
{
  "plan_name": "User Dashboard Application",
  "template_recommendation": "nextjs-boilerplate",
  "work_packages": [
    {
      "id": "WP1",
      "name": "Authentication",
      "tasks": [
        {
          "id": "T1",
          "title": "Create login page with email and password fields",
          "description": "Create a login page at /login with an email input and a password input. Use a form with proper HTML5 input types.",
          "acceptance_criteria": "Login page exists at /login with email and password fields",
          "verification_checks": [
            { "type": "file_exists", "path": "src/app/login/page.tsx" },
            { "type": "dom_check", "route": "/login", "selector": "input[type='email'], input[name='email']", "assertion": "exists", "description": "Email input exists" },
            { "type": "dom_check", "route": "/login", "selector": "input[type='password']", "assertion": "exists", "description": "Password input exists" }
          ],
          "work_package": "WP1",
          "depends_on": []
        },
        {
          "id": "T2",
          "title": "Add form validation to login page",
          "description": "Email field validates format. Password requires minimum 8 characters. Show inline error messages below each field when validation fails.",
          "acceptance_criteria": "Invalid email shows error, short password shows error, errors appear below fields",
          "verification_checks": [
            { "type": "file_contains", "path": "src/app/login/page.tsx", "pattern": "email" },
            { "type": "grep_codebase", "pattern": "min.*8|minLength.*8|length.*>=.*8", "description": "Password minimum length validation exists" },
            { "type": "dom_check", "route": "/login", "selector": "[role='alert'], .error-message, .text-red, .text-destructive", "assertion": "not_exists", "description": "No validation errors shown initially (before submission)" }
          ],
          "work_package": "WP1",
          "depends_on": ["T1"]
        }
      ]
    }
  ]
}
```

### 7.3 Interactive Planning Conversation (NOT One-Shot)

The planning phase is NOT "user dumps a spec → AI returns tasks." It is a **multi-turn conversation** where the planning AI actively engages the user to gather all the information it needs before generating the task plan.

**The planning AI's conversational system prompt (prepended to the decomposition prompt):**

```
You are a senior product manager and technical architect. Before creating 
a task plan, you MUST have a thorough conversation with the user to 
understand their requirements completely.

CONVERSATION RULES:
- Start by acknowledging what the user described and identifying what's clear
- Ask 3-5 focused clarifying questions about ambiguities, decisions, and preferences
- Ask about: target audience, design preferences, data sources, auth requirements, 
  deployment target, specific UI components they envision, error handling expectations
- If the user attaches images (mockups, screenshots, Figma exports), analyze them 
  and reference specific elements you see
- If the user attaches documents (PDFs, specs), read them and confirm your understanding
- Continue the conversation until you have enough information — typically 2-4 exchanges
- When ready, say: "I have enough information to create the plan. Shall I proceed?"
- Only after the user confirms, generate the structured JSON task plan

DO NOT generate the task plan in your first response. Always start with questions.
```

**Example conversation flow:**

```
User: "I want to build a dashboard for my marketing agency to track client projects"

AI: "Great — a marketing agency project dashboard. I have a few questions before 
    I plan this out:

    1. Authentication: Should this support multiple team members with roles 
       (admin, manager, viewer), or is it single-user?
    2. Data: Where does the project data come from? Manual entry, imported from 
       tools like Asana/Trello, or an API?
    3. What should the dashboard homepage show? Summary cards, a project list, 
       a kanban board, or a combination?
    4. Do you have any design references or mockups? You can paste screenshots 
       or attach files here.
    5. Deployment: Vercel, Netlify, self-hosted, or no preference?"

User: [pastes a screenshot of a Notion dashboard they like]
      "Something like this. Multi-user with roles. Data is manual entry for now 
       but we might add Asana later. Deploy on Vercel."

AI: "Got it. Looking at your screenshot, I see a sidebar navigation, summary cards 
    at the top (active projects, overdue tasks, team utilization), and a sortable 
    project table below. A few follow-ups:

    1. The summary cards — should 'team utilization' show actual hours logged, 
       or is it a simpler status (available/busy)?
    2. Should projects have statuses like 'planning → in progress → review → done', 
       or custom stages?
    3. For multi-user: do you need invite-by-email, or is it admin-creates-accounts?

    I have enough for most of it, but these details affect the task breakdown."

User: "Simple status (available/busy). Custom stages per project type. 
       Admin creates accounts for now."

AI: "Perfect, I have everything I need. Shall I generate the task plan now?"

User: "Yes"

AI: [generates structured JSON plan with 45 atomic tasks across 7 work packages]
```

### 7.4 Attachments in the Planning Conversation

The planning conversation supports the same attachment types as the existing Assistant Panel (which already has this capability):

**Images (screenshots, mockups, designs):**
- Clipboard paste (⌘V) — screenshot or copied image
- Drag-and-drop images onto the conversation
- File dialog (+ button)
- The planning AI receives images as base64 in the API call and can analyze visual elements ("I see a sidebar with 5 nav items, a header with a search bar, and a data table with 6 columns")

**Documents:**
- PDF, TXT, MD files attached via drag-drop or file dialog
- Sent as document content in the API message
- The planning AI reads the document and references specific sections

**Implementation:** This uses the SAME attachment infrastructure already built for the Assistant Panel (`useAssistantSession.ts`, `AssistantAttachmentBar.tsx`, `read_file_bytes` command). The planning AI conversation IS an assistant conversation — it just has a specialized system prompt and the ability to trigger task plan generation.

### 7.5 Planning AI Lifecycle (Ongoing Involvement)

The planning AI has FIVE roles, not one. It stays involved throughout the entire build process:

**Role 1: Interactive Requirements Gathering**
Multi-turn conversation with the user (Section 7.3). Ends with structured task plan.

**Role 2: Progress Review (after each work package)**
After Claude Code finishes a work package and verification runs, the execution engine automatically sends a PROGRESS_UPDATE message to the planning AI conversation. This message contains:
- Which tasks were completed
- Verification results (passed/failed with evidence)
- Summary of files changed (git diff --stat)
- Console errors from the preview (if any)

The planning AI reviews and responds:

```json
{
  "type": "progress_review",
  "assessment": "needs_refinement",
  "refined_tasks": [
    {
      "id": "T12",
      "title": "Add CSV export with format picker modal",
      "description": "REVISED: The export button should open a modal with format options (CSV, Excel, PDF), not just download CSV directly.",
      "verification_checks": [/* updated checks */]
    }
  ],
  "new_tasks": [],
  "notes": "The export button was built as a direct download, but based on the original requirements it should be a format picker. I've refined task T12."
}
```

**Role 3: Gap Detection (after all work packages complete)**
After ALL planned tasks are done, the planning AI gets a final review pass:
- It receives: the original user spec, the full file tree of what was built, console log output, and optionally screenshots of each page (captured via preview window)
- It asks itself: "What from the original conversation is NOT reflected in what was built?"
- Output: a supplementary work package with additional tasks. These get added to the board and executed.

**Role 4: User Feedback Integration**
When the user tests the app in the preview and spots issues, they report them in the planning conversation:
- "The dropdown on the settings page doesn't save when I change it"
- [pastes screenshot] "This layout is broken on mobile"
- "The loading spinner never goes away on the /users page"

The planning AI creates new tasks with verification checks and adds them to the board.

**Role 5: Verification Refinement**
When a DOM check fails repeatedly but Claude Code insists the feature is built, the planning AI looks at both the code (via the progress report) and the failing check. It determines: is the code wrong or is the check wrong? It can update selectors, change assertion types, or acknowledge the feature is built differently than expected.

**Conversation continuity:** The planning AI conversation is a single, persistent assistant tab. All messages — initial planning, progress reviews, gap detection, user feedback — happen in the same conversation thread. The AI maintains full context of the project history.

### 7.6 How the Planning AI Gets Codebase Information

**The problem:** The planning AI is an API call (Gemini/OpenAI/Anthropic). It has NO filesystem access. It cannot read files, run commands, or inspect the project. So how does it know what was built?

**The solution: The execution engine acts as the AI's eyes.**

After each work package completes, the execution engine (Rust backend) assembles a **Project Snapshot** and includes it in the PROGRESS_UPDATE message sent to the planning AI:

```typescript
interface ProjectSnapshot {
  // What changed
  files_changed: FileChange[];     // from: git diff --stat HEAD~1
  new_files: string[];             // files that didn't exist before this package
  deleted_files: string[];         // files removed during this package

  // Current state
  file_tree: string;               // truncated file tree (top 3 levels, key directories)
  package_json_deps: string[];     // current dependency list (from package.json)
  route_list: string[];            // detected routes (scan for page.tsx/route.tsx files)

  // Verification results
  check_results: CheckResult[];    // all verification results with evidence

  // Runtime state
  console_errors: ConsoleLogEntry[];  // last 20 console errors from preview
  console_warnings: ConsoleLogEntry[]; // last 10 console warnings

  // Optional: page screenshots (for Role 3 gap detection)
  page_screenshots?: { route: string; image_base64: string }[];
}
```

**How each piece is gathered (all from Rust backend, no AI filesystem access needed):**

| Data | How it's gathered | Command/Method |
|------|------------------|----------------|
| Files changed | `git diff --stat` | `tokio::process::Command("git")` |
| New/deleted files | `git diff --name-status` | Same |
| File tree | `read_file_tree` (existing command) | Already built |
| Dependencies | Read & parse `package.json` | `std::fs::read_to_string` |
| Routes | Scan for `page.tsx`, `route.tsx`, `+page.svelte` files | File system walk |
| Check results | From the verification engine | Already in memory |
| Console errors | From the console log bridge | Already in memory |
| Screenshots | Preview window screenshot capture | `preview_window.eval("document.documentElement.outerHTML")` or platform screenshot API |

**For the final gap review (Role 3)**, the engine also reads key files the AI might want to inspect. Instead of giving the AI random file access, it reads specific files based on the task plan:
- Every file mentioned in a `file_exists` or `file_contains` check
- The main layout file (e.g., `src/app/layout.tsx`)
- The route index files
- Any file the user explicitly mentions in feedback

These file contents are included (truncated to first 100 lines each) in the gap review message.

**Token budget management:** The project snapshot can get large. For each progress update:
- File tree: truncated to 50 lines
- Changed files: only the diff stat summary, not full diffs
- Console logs: last 20 errors, last 10 warnings, messages truncated to 200 chars
- File contents (for gap review): first 100 lines per file, max 10 files
- Total target: under 8000 tokens per progress update

---

## 8. Task Board UI

### 8.1 UI Approach: Slide-Over Overlay

The Task Board is a **slide-over overlay** that appears from the right side of the main window, covering approximately 60% of the width. This is the right choice because:

- It's **larger than a right panel tab** — the task board needs horizontal space for work package cards, verification results, and the planning conversation side by side
- It's **less disruptive than a full modal** — the user can still see the chat panel and sidebar behind it (dimmed)
- It **slides in/out smoothly** — feels native and modern (like macOS sheet presentations)
- The user can **dismiss it easily** (click outside, press Escape, or click the × button)
- It **persists state** — closing and reopening doesn't lose the conversation or task state

### 8.2 Slide-Over Layout

```
┌────────────────┬────────────────────────────────────────────────┐
│                │  📋 Task Board                           [×]  │
│  Main App      │                                               │
│  (dimmed)      ├───────────────────┬───────────────────────────┤
│                │                   │                           │
│  Chat panel    │  Planning Chat    │   Work Packages           │
│  visible but   │                   │                           │
│  inactive      │  [AI]: "I see     │  ┌─────────────────────┐ │
│                │  your mockup has  │  │ WP1: Auth  ✅ 8/8    │ │
│                │  a sidebar. What  │  │ WP2: Tables 🔄 5/7   │ │
│                │  nav items?"      │  │ WP3: Charts ⏳ 0/6   │ │
│                │                   │  └─────────────────────┘ │
│                │  [You]: "Projects,│                           │
│                │  Team, Settings,  │  ─── WP2 expanded ────── │
│                │  Analytics"       │  ✅ T8: DataTable         │
│                │                   │  ✅ T9: Sorting           │
│                │  [📎 mockup.png]  │  🔄 T12: Export  [verify]│
│                │  [📄 spec.pdf]    │  ⏳ T13: Empty state      │
│                │                   │                           │
│                │  ┌─────────────┐  │  Verification:           │
│                │  │ Type here.. │  │  ✅ file_exists           │
│                │  │ [📎][Send]  │  │  ❌ dom_check: no button │
│                │  └─────────────┘  │  → Retrying (1/3)        │
│                │                   │                           │
│                ├───────────────────┴───────────────────────────┤
│                │  [▶ Start All] [⏸ Pause] [🔄 Re-plan]        │
└────────────────┴────────────────────────────────────────────────┘
```

**The slide-over has two columns:**

**Left column: Planning Chat** — This is the interactive conversation with the planning AI. It shows the full conversation history including the initial requirements gathering, progress updates (inserted automatically), and user feedback. The user can:
- Type messages to the planning AI
- Paste images (screenshots, mockups)
- Attach documents (specs, PDFs)
- See the AI's questions and respond
- Report issues they find during testing

**Right column: Work Packages & Tasks** — The execution board. Shows work packages as collapsible cards with task lists, progress indicators, and verification results. Updates in real-time during execution.

**Bottom bar:** Global actions — Start All (begin sequential execution), Pause (stop after current package), Re-plan (ask AI to regenerate plan based on updated conversation).

### 8.3 Opening the Task Board

- **Title bar button:** 📋 icon next to the existing MCP button. Click to toggle the slide-over.
- **Keyboard shortcut:** `⌘⇧B` (B for Board)
- **Auto-open:** When a plan is being generated or tasks are executing, the slide-over opens automatically.

### 8.4 Planning Chat Interactions

The planning chat column works like the existing Assistant Panel but with task-board-specific features:

**Standard features (reused from Assistant Panel):**
- Text input with multi-line support
- Image paste (⌘V) with thumbnail preview
- File attachment (+ button) for PDFs, docs, images
- Streaming AI responses
- Provider badge showing which AI model is active

**Task-board-specific features:**
- **Progress updates** appear as system messages in the chat: "📊 Work Package 2 completed. 5/7 checks passed. Review below."
- **"Generate Plan" button** appears when the AI says it has enough information
- **"Report Issue" quick action** — pre-fills the input with "I found an issue:" and auto-attaches a preview screenshot
- **Verification results** are summarized inline: "🔍 Verification: 12/15 passed, 3 failed. See details in the task panel →"

### 8.5 User Interactions on the Board

- **"+ Plan" button:** Starts a new planning conversation (or focuses the existing one)
- **Click work package:** Expands/collapses to show tasks
- **Click task:** Shows full description + verification checks
- **Edit task:** Click the edit icon on a task to modify title, description, or checks
- **Delete task:** Remove a task from the plan
- **Reorder:** Drag work packages or tasks to change order
- **"Start" on work package:** Begin execution of that specific package
- **"Start All":** Execute all packages sequentially from the first incomplete one
- **"Mark as Done":** Manually mark a task as complete (skips verification)
- **"Report Issue":** Opens the planning chat with issue reporting context

### 8.6 Board Layout

```
┌─────────────────────────────────────────────────────┐
│  📋 Task Board — my-dashboard-app         [+ Plan]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Master Plan: "Build user dashboard with auth,      │
│  data tables, charts, and CSV export"               │
│  Status: WP2 in progress (3/5 packages done)        │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐   │
│  │ WP1: Auth   │  │ WP2: Tables │  │ WP3: ... │   │
│  │ ✅ 8/8 done  │  │ 🔄 5/7 done │  │ ⏳ 0/6   │   │
│  │             │  │             │  │          │   │
│  │ [Review]    │  │ [Verifying] │  │ [Start]  │   │
│  └─────────────┘  └─────────────┘  └──────────┘   │
│                                                     │
│  ─── WP2: Data Tables (expanded) ─────────────     │
│  ✅ T8: Create DataTable component                  │
│  ✅ T9: Add column sorting                          │
│  ✅ T10: Add pagination controls                    │
│  ✅ T11: Add search/filter input                    │
│  🔄 T12: Add CSV export button       [verifying]   │
│  ⏳ T13: Add empty state message                    │
│  ⏳ T14: Add loading skeleton                       │
│                                                     │
│  Verification Results for T12:                      │
│  ✅ file_exists: src/components/ExportButton.tsx     │
│  ✅ file_contains: "text/csv" in ExportButton        │
│  ❌ dom_check: No "Export CSV" button on /dashboard  │
│  → Auto-retrying (attempt 1/3)...                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 8.7 Compact Board View (when slide-over is closed)

When the slide-over is closed, a small status badge appears in the title bar next to the 📋 button showing current execution progress: "📋 WP2: 5/7 ✅". Clicking it reopens the slide-over.

### 8.8 User Interactions (continued)

- **"+ Plan" button:** Opens a modal: "Describe what you want to build" — free-text input + optional file attachment. Pick planning AI model. Submit → AI decomposes → tasks appear on board.
- **Task cards:** Click to expand and see verification checks. Edit task description. Delete/reorder tasks.
- **"Start" button on work package:** Begins sequential execution. Creates a Claude Code session for this package and sends all tasks as the initial prompt.
- **Manual override:** User can skip a task, mark as done manually, or add new tasks.
- **"Report Issue" in planning chat:** User describes a problem → planning AI creates fix tasks → appended to the board.

---

## 9. Sequential Execution Engine

### 9.1 Why Sequential, Not Parallel

Multiple Claude Code instances editing the same project directory causes file conflicts (package.json, tsconfig, layout files, types). Sequential execution means each task builds on the previous one — tasks can use components built by earlier tasks.

### 9.2 Execution Flow

```
For each work_package in order:
  1. Create a Claude Code session in Auto-Accept mode
  2. Build the prompt:
     "You are executing work package '{wp_name}'. 
      Complete these tasks in order:
      
      Task 1: {title}
      {description}
      Acceptance: {acceptance_criteria}
      
      Task 2: {title}
      ...
      
      Important: Complete ALL tasks. Do not skip any.
      After completing all tasks, say 'ALL TASKS COMPLETE'."
  3. Send the prompt
  4. Wait for Claude Code to respond with "ALL TASKS COMPLETE" or idle for 30s
  5. Run verification checks (Section 10)
  6. If checks pass → mark work package done, proceed to next
  7. If checks fail → send retry prompt with specific failures (max 3 retries)
  8. After 3 retries with same failures → mark as needs_review, proceed to next
```

### 9.3 Retry Prompt

```
"Verification found {N} issues with your work:

1. ❌ No 'Export CSV' button found on /dashboard page
   Expected: A button with text containing 'Export' or 'CSV' on the dashboard
   
2. ❌ No loading skeleton on /dashboard
   Expected: A Skeleton or loading indicator component shown while data loads

Please fix these specific issues now. Do not modify anything else."
```

---

## 10. Verification Engine

### 10.1 Tier 1: Code-Level Checks (instant, no browser needed)

Run immediately after Claude Code finishes a work package.

| Check Type | Implementation | Example |
|-----------|----------------|---------|
| `file_exists` | `std::path::Path::new(path).exists()` | `src/app/login/page.tsx` exists |
| `file_contains` | Read file, search for pattern (substring or regex) | File contains `type="password"` |
| `grep_codebase` | Walk project directory, search files for pattern | Codebase contains `validateEmail` |
| `command_succeeds` | Run command via `tokio::process::Command`, check exit code | `npx tsc --noEmit` exits 0 |

**Rust implementation:**

```rust
async fn run_code_checks(
    project_path: &str,
    checks: &[VerificationCheck],
) -> Vec<CheckResult> {
    let mut results = Vec::new();
    for check in checks {
        let result = match check.check_type.as_str() {
            "file_exists" => {
                let path = Path::new(project_path).join(&check.path.as_ref().unwrap());
                CheckResult {
                    passed: path.exists(),
                    evidence: if path.exists() { "File exists".into() } else { "File not found".into() },
                    ..Default::default()
                }
            },
            "file_contains" => {
                let path = Path::new(project_path).join(&check.path.as_ref().unwrap());
                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        let pattern = check.pattern.as_ref().unwrap();
                        let found = content.contains(pattern);
                        CheckResult {
                            passed: found,
                            evidence: if found { format!("Pattern '{}' found", pattern) }
                                      else { format!("Pattern '{}' not found in file", pattern) },
                            ..Default::default()
                        }
                    },
                    Err(e) => CheckResult { passed: false, evidence: format!("Cannot read file: {}", e), ..Default::default() },
                }
            },
            "command_succeeds" => {
                let cmd = check.command.as_ref().unwrap();
                let output = Command::new("sh")
                    .args(&["-c", cmd])
                    .current_dir(project_path)
                    .output().await;
                match output {
                    Ok(o) => CheckResult {
                        passed: o.status.success(),
                        evidence: if o.status.success() { "Command succeeded".into() }
                                  else { format!("Exit code: {}, stderr: {}", o.status, String::from_utf8_lossy(&o.stderr).chars().take(200).collect::<String>()) },
                        ..Default::default()
                    },
                    Err(e) => CheckResult { passed: false, evidence: format!("Failed to run: {}", e), ..Default::default() },
                }
            },
            _ => continue, // dom_check handled separately
        };
        results.push(result);
    }
    results
}
```

### 10.2 Tier 2: DOM Checks (requires Preview Window)

After code checks pass, navigate the Preview Window to each route and run DOM assertions.

**Flow:**
1. Collect all `dom_check` items from the work package's tasks
2. Group by `route` (to minimize navigation)
3. For each route:
   a. Navigate the preview: `preview_window.eval(&format!("window.location.href = 'http://localhost:{}/{}'", port, route))`
   b. Wait 3 seconds for page load (or listen for `load` event via polling)
   c. Run the assertion script via `eval()`
   d. Parse results

**DOM Assertion Script (generated per route):**

```javascript
// Injected via eval() after navigation
(function() {
  var results = [];
  
  // Check 1: Category dropdown exists
  var el = document.querySelector("select#category, [role='combobox'], [data-testid='category-filter']");
  results.push({
    id: "T15_check_1",
    description: "Category filter dropdown exists on dashboard",
    passed: !!el,
    evidence: el ? el.tagName + ' found' : 'No matching element on page'
  });
  
  // Check 2: Data table has rows
  var rows = document.querySelectorAll("table tbody tr, [role='row']");
  results.push({
    id: "T15_check_2", 
    description: "Data table has at least one row",
    passed: rows.length >= 1,
    evidence: 'Found ' + rows.length + ' rows'
  });
  
  return JSON.stringify(results);
})()
```

**The planning AI generates these selectors** as part of the task decomposition. CodeMantis wraps them in the eval boilerplate. Multiple fallback selectors handle different UI libraries (native HTML, Radix/shadcn, headless UI, custom data-testid).

---

## 11. Data Models

### 11.1 TypeScript Types

```typescript
// src/types/task-board.ts

export interface TaskPlan {
  id: string;
  name: string;
  description: string;
  template_recommendation: string | null;
  work_packages: WorkPackage[];
  created_at: string;
  status: 'planning' | 'ready' | 'executing' | 'done' | 'error';
}

export interface WorkPackage {
  id: string;
  name: string;
  tasks: TaskItem[];
  status: 'planned' | 'in_progress' | 'verifying' | 'done' | 'needs_review';
  session_id: string | null;  // Claude Code session executing this package
  retry_count: number;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  verification_checks: VerificationCheck[];
  work_package: string;
  depends_on: string[];
  status: 'planned' | 'in_progress' | 'done' | 'failed' | 'skipped';
}

export interface VerificationCheck {
  type: 'file_exists' | 'file_contains' | 'grep_codebase' | 'command_succeeds' | 'dom_check';
  // For file checks
  path?: string;
  pattern?: string;
  // For command checks
  command?: string;
  // For DOM checks
  route?: string;
  selector?: string;
  assertion?: 'exists' | 'visible' | 'has_text' | 'has_options' | 'count_gte' | 'not_exists';
  expected?: string | number;
  // Common
  description: string;
  // Result (filled after check runs)
  result?: CheckResult;
}

export interface CheckResult {
  passed: boolean;
  evidence: string;
  checked_at: string;
}

export type AIProvider = 'gemini' | 'openai' | 'anthropic';

// --- Planning Conversation Types ---

export interface PlanningConversation {
  id: string;
  plan_id: string;
  messages: PlanningMessage[];
  ai_provider: AIProvider;
  ai_model: string;
  status: 'gathering' | 'ready_to_plan' | 'planning' | 'monitoring' | 'reviewing';
}

export interface PlanningMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: PlanningAttachment[];
  message_type: 'conversation' | 'progress_update' | 'gap_review' | 'user_feedback';
  timestamp: string;
}

export interface PlanningAttachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  size: number;
  mime_type: string;
  // For images: base64 data or blob URL for preview
  preview_url?: string;
  // For documents: extracted text content (sent to AI)
  text_content?: string;
  // Original file path on disk
  file_path: string;
}

// --- Project Snapshot (sent to planning AI for progress reviews) ---

export interface ProjectSnapshot {
  // What changed in the last work package
  files_changed: FileChange[];
  new_files: string[];
  deleted_files: string[];

  // Current project state
  file_tree: string;               // truncated to 50 lines
  package_json_deps: string[];
  route_list: string[];            // detected page/route files

  // Verification results
  check_results: CheckResult[];

  // Runtime state from Preview Window
  console_errors: ConsoleLogEntry[];   // last 20
  console_warnings: ConsoleLogEntry[]; // last 10

  // Key file contents (for gap review only, first 100 lines each)
  file_contents?: { path: string; content: string }[];

  // Page screenshots (for visual gap review, optional)
  page_screenshots?: { route: string; image_base64: string }[];
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  insertions: number;
  deletions: number;
}

export interface ConsoleLogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  ts: string;
  msg: string;
  url: string;
  stack?: string;
}

// --- AI Progress Review Response ---

export interface ProgressReview {
  assessment: 'on_track' | 'needs_refinement' | 'has_gaps';
  refined_tasks: TaskItem[];        // tasks with updated descriptions or checks
  new_tasks: TaskItem[];            // additional tasks not in original plan
  removed_task_ids: string[];       // task IDs no longer needed
  updated_checks: {                 // verification checks that need selector/assertion fixes
    task_id: string;
    check_index: number;
    updated_check: VerificationCheck;
  }[];
  notes: string;                    // explanation for the user (shown in planning chat)
}

// --- Slide-Over UI State ---

export interface TaskBoardUIState {
  is_open: boolean;
  planning_chat_width: number;      // percentage, default 40
  expanded_work_package: string | null;
  expanded_task: string | null;
  scroll_position: number;
}
```

### 11.2 Rust Structs

Mirror the TypeScript types in Rust with serde derives. Store task plans in SQLite (new `task_plans` and `task_items` tables) for persistence across sessions.

---

## 12. New Files & Modules

```
src-tauri/src/
  commands/
    preview.rs                  # open_preview_window, close_preview_window,
                                # navigate_preview, start_dev_server,
                                # get_preview_console_logs, run_dom_checks
    taskboard.rs                # create_plan, execute_work_package,
                                # run_verification, retry_failed_checks,
                                # get_task_plan, update_task_status
    snapshot.rs                 # gather_project_snapshot, get_file_tree_summary,
                                # get_git_diff_stat, detect_routes,
                                # read_key_files (truncated content for AI)
  resources/
    preview-console-bridge.js   # Console log capture script (Section 5.1)

src/
  stores/
    previewStore.ts             # Preview window state, console logs, port
    taskBoardStore.ts           # Plans, work packages, tasks, verification results,
                                # planning conversation messages, slide-over UI state
  hooks/
    usePreviewServer.ts         # Dev server lifecycle + port detection
    useTaskExecution.ts         # Sequential execution + verification + AI review loop
    usePlanningConversation.ts  # Multi-turn planning AI chat with attachments,
                                # progress update injection, gap review triggers
  types/
    preview.ts                  # ConsoleLogEntry, DevServerHandle
    task-board.ts               # TaskPlan, WorkPackage, TaskItem,
                                # PlanningConversation, PlanningMessage,
                                # PlanningAttachment, ProjectSnapshot,
                                # ProgressReview, TaskBoardUIState
  components/
    taskboard/                  # Slide-over overlay and all sub-components
      TaskBoardSlideOver.tsx    # Main slide-over container (60% width overlay)
      PlanningChat.tsx          # Left column: interactive AI conversation
      PlanningChatInput.tsx     # Input with attachment support (reuses AttachmentBar)
      PlanningChatMessage.tsx   # Message bubble (user, AI, system/progress updates)
      ProgressUpdateMessage.tsx # Styled system message for verification summaries
      WorkPackageList.tsx       # Right column: scrollable work package cards
      WorkPackageCard.tsx       # Expandable work package with progress bar
      TaskCard.tsx              # Individual task with verification checks
      VerificationResults.tsx   # Check results display (pass/fail/evidence)
      TaskBoardToolbar.tsx      # Bottom bar: Start All, Pause, Re-plan
      TaskBoardBadge.tsx        # Title bar badge showing compact progress
```

---

## 13. Implementation Order

```
PHASE A: Preview Window (browser integration FIRST)
─────────────────────────────────────────────────────
A1. Add capability permissions to default.json
A2. Create preview.rs with open_preview_window (external URL only)
A3. Add button to title bar, test with https://example.com
    *** STOP AND VERIFY: Does the window open? Is it resizable? ***
    *** If NO: debug permissions, CSP, WebviewUrl before proceeding ***
A4. Add start_dev_server command (reuse terminal infrastructure)
A5. Add port detection regex scanner to terminal output handler
A6. Wire: "Run Application" → start server → detect port → open preview
A7. Test: scaffold a Next.js project, click Run, preview opens automatically

PHASE B: Console Log Bridge
─────────────────────────────────────────────────────
B1. Create preview-console-bridge.js
B2. Add initialization_script to WebviewWindowBuilder
B3. Test: open preview, open browser devtools on the preview, run console.error
    *** VERIFY: Does __CM_CONSOLE_BUFFER populate? ***
    *** If initialization_script doesn't run: implement eval() polling fallback ***
B4. Create Rust polling loop (start_console_polling)
B5. Write console errors to ~/.codemantis/preview-console.log
B6. Surface errors in Activity Feed with 🌐 badge
B7. Test: trigger console.error in user's app, verify it appears everywhere

PHASE C: Task Board Slide-Over + Interactive Planning Chat
─────────────────────────────────────────────────────
C1. Create task-board.ts types (all types including PlanningConversation,
    ProjectSnapshot, ProgressReview) and taskBoardStore.ts
C2. Create TaskBoardSlideOver.tsx — 60% width overlay with two columns
    Test: button in title bar opens/closes slide-over with animation
C3. Create PlanningChat.tsx (left column) — reuse Assistant Panel patterns
    - Multi-turn conversation with text input
    - Image paste (⌘V), drag-drop, file attachment (+ button)
    - Message bubbles for user, AI, and system messages
    *** VERIFY: can send a message and get streaming AI response ***
C4. Create usePlanningConversation.ts hook
    - Manages the planning AI system prompt (conversational, NOT one-shot)
    - AI asks questions first, doesn't generate plan immediately
    - Detects when AI says "ready to generate plan"
    - Shows "Generate Plan" button in the chat
C5. Create WorkPackageList.tsx (right column) — cards + tasks
    Wire: AI's JSON plan response → parse → populate right column
C6. Create taskboard.rs with plan creation and SQLite persistence
C7. Test END-TO-END: open slide-over → describe app → AI asks questions →
    answer questions → AI generates plan → tasks appear in right column
    *** Include: paste a screenshot as part of the conversation ***
    *** Include: attach a PDF spec document ***

PHASE D: Execution + Verification
─────────────────────────────────────────────────────
D1. Create useTaskExecution hook — sequential work package execution
D2. Implement Tier 1 verification (file checks) in taskboard.rs
D3. Wire: execute → verify → retry flow
D4. Test: run a plan, verify code checks execute and retry works
D5. Implement Tier 2 verification (DOM checks via preview eval)
D6. Wire DOM checks into verification flow
D7. Test: run a plan that includes DOM checks, verify they pass/fail correctly

PHASE E: AI Lifecycle — Progress Reviews & Data Access
─────────────────────────────────────────────────────
E1. Create snapshot.rs — gather_project_snapshot command
    - git diff --stat, file tree, route detection, console logs
    - Read key files (files from verification checks, layout, routes)
    - Truncation: 50-line tree, 200-char messages, 100-line files
    *** VERIFY: snapshot assembles correctly, under 8000 tokens ***
E2. Wire: after each work package → build snapshot → send as
    PROGRESS_UPDATE message in planning conversation
E3. Planning AI receives snapshot → returns ProgressReview JSON →
    refined/new tasks update the board automatically
E4. Create ProgressUpdateMessage.tsx — styled system message in chat
    showing verification summary with expandable details
E5. Wire: after ALL packages done → trigger gap review (Role 3)
    - Send full snapshot + original spec to planning AI
    - AI identifies missing features → creates supplementary work package
E6. Wire: user "Report Issue" in chat → AI creates fix tasks → append
E7. Wire: AI verification refinement (Role 5) — when DOM check fails
    repeatedly, AI can update the selector/assertion

PHASE F: Polish
─────────────────────────────────────────────────────
F1. Preview window: viewport presets, persist position/size
F2. Preview window: keyboard shortcuts (⌘⇧P toggle, ⌘R refresh)
F3. Task Board: manual task editing, reordering, deletion
F4. Task Board: compact badge in title bar when slide-over closed
F5. Task Board: ⌘⇧B keyboard shortcut to toggle slide-over
F6. Planning chat: "Report Issue" quick action (auto-attach screenshot)
F7. Settings: preview and task board preferences
F8. Settings: planning AI model selection, max retries
```

---

## 14. Known Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `initialization_script` doesn't run on external URLs | Use `eval()` polling fallback (Section 5.1). Test in Phase B3 before building anything on top. |
| WKWebView renders differently from Chrome | Acceptable for preview. Add "Open in Browser" button for Chrome-specific testing. |
| Console bridge gets blocked by CSP | Bridge only writes to in-memory buffer, no network calls. Should not be affected by CSP. |
| Port detection fails for unusual dev servers | Manual URL bar always available. Show "Enter URL manually" after 20s timeout. |
| Planning AI generates poor decomposition | Interactive conversation catches most issues BEFORE plan generation. User can also edit/delete/reorder tasks after. |
| Planning AI asks too many questions, frustrating the user | System prompt limits to 3-5 questions per turn. User can always say "just generate the plan with what you have" to skip ahead. |
| DOM checks produce false negatives | Use multiple fallback selectors. Show evidence ("No element found") so user can debug. Allow manual "mark as passed" override. Planning AI can refine selectors (Role 5). |
| Verification loop gets stuck retrying | Max 3 retries. After that, mark as needs_review and continue to next package. |
| Dev server port conflicts between projects | Each project gets its own "Dev Server" terminal. Port detection is per-terminal, not global. |
| Project snapshot exceeds token limits | Strict truncation: 50-line tree, 200-char messages, 100-line files, 10 files max. Total budget: 8000 tokens. Measured and logged. |
| Planning AI can't see the actual code (no filesystem access) | Snapshot includes git diff stats, file tree, route list, and truncated content of key files. For gap review, include files referenced by verification checks. This gives enough signal without raw access. |
| Planning AI hallucinates file paths or selectors in refined tasks | All AI-generated paths are validated against the actual file tree before being added to the plan. Invalid paths flagged with ⚠️ in the UI. |
| Progress review response isn't valid JSON | Parse with fallback: strip markdown code blocks, try lenient JSON parsing. If still fails, show raw response in planning chat and ask user to retry. |
| Slide-over obscures important main window content | Dimmed backdrop is clickable to close. ⌘⇧B toggles. Compact badge in title bar shows progress when closed. |
| Planning conversation loses context over many turns | Use the same assistant session for ALL planning messages. If context approaches model limit, summarize conversation history before the next turn. |
| Image/document attachments are too large for AI context | Images: resize to max 1024px longest edge before sending. Documents: extract text, truncate to 10,000 characters with "..." indicator. |
