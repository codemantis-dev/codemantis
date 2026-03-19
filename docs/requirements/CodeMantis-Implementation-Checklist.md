# CodeMantis — Preview Window & Task Board: Implementation Completeness Checklist

**Purpose:** This document is a verification list for Claude Code to quality-check its own implementation of the Preview Window and AI Task Board features. After implementing each section, run through the relevant checklist items and confirm each one passes. Do NOT mark items as complete unless you have verified them.

**How to use:** After implementing a phase, copy the relevant section's checklist items and verify each one. If any item fails, fix it before proceeding. Items marked with ⚠️ are historically problematic — pay extra attention.

---

## PHASE A: Preview Window — Browser Integration

### A1: Capability Permissions

- [ ] `src-tauri/capabilities/default.json` contains `"core:webview:allow-create-webview-window"` in the permissions array
- [ ] ⚠️ Verify the EXACT string — not `"webview:allow-create-webview"` or `"webview:allow-create-webview-window"` (both are wrong). It must be `"core:webview:allow-create-webview-window"`
- [ ] `"core:window:allow-create"` is in the permissions array
- [ ] `"core:window:allow-set-focus"` is in the permissions array
- [ ] `"core:window:allow-close"` is in the permissions array
- [ ] `"core:window:allow-show"` is in the permissions array
- [ ] `"core:window:allow-hide"` is in the permissions array
- [ ] `"core:window:allow-set-size"` is in the permissions array
- [ ] `"core:window:allow-set-position"` is in the permissions array

### A2: Preview Rust Command

- [ ] File `src-tauri/src/commands/preview.rs` exists
- [ ] `open_preview_window` command exists and is `async`
- [ ] Command is registered in `lib.rs` invoke_handler: `commands::preview::open_preview_window`
- [ ] Command accepts `url: String`, `project_name: String`, `app_handle: tauri::AppHandle`
- [ ] ⚠️ Uses `WebviewUrl::External()` (NOT `WebviewUrl::App()`) for the URL parameter
- [ ] URL is parsed with `.parse::<tauri::Url>()` with proper error handling
- [ ] Window label is `"preview"` (hardcoded, single preview window)
- [ ] If window with label `"preview"` already exists → navigate it (via `eval`) + focus it, don't create new
- [ ] `.title()` is set to `format!("CodeMantis Preview — {}", project_name)`
- [ ] `.inner_size(1024.0, 768.0)` is set
- [ ] `.min_inner_size(400.0, 300.0)` is set
- [ ] `.resizable(true)` is set
- [ ] `.initialization_script()` is called with the console bridge JS (Section B below)
- [ ] `.build()` is called with proper error handling (`.map_err()`, not `.unwrap()`)

### A3: Basic Window Test (MUST PASS BEFORE PROCEEDING)

- [ ] ⚠️ A temporary test button exists in the title bar or somewhere accessible
- [ ] Clicking the button calls `open_preview_window` with URL `"https://example.com"`
- [ ] A separate native window opens (not a panel, not a modal)
- [ ] The window shows the example.com content (not blank, not error)
- [ ] The window is independently resizable (drag any edge/corner)
- [ ] The window can be moved to a different position
- [ ] The window can be minimized to Dock
- [ ] The window can be closed with the × button
- [ ] Clicking the test button again after closing opens a new window
- [ ] Clicking the test button while the window is open focuses it (doesn't create a second window)
- [ ] Calling with a different URL navigates the existing window

### A4: Dev Server Management

- [ ] `start_dev_server` command exists in `preview.rs`
- [ ] Command is registered in `lib.rs` invoke_handler
- [ ] Command accepts `project_path`, `template_id` (optional), `custom_command` (optional)
- [ ] If `custom_command` provided → use it as the dev command
- [ ] If `template_id` provided → look up `dev_command` from templates.json
- [ ] If neither → try defaults: `npm run dev`, `pnpm dev`, `yarn dev` (check package.json for which manager)
- [ ] Dev command starts in a **managed terminal** (same PTY infrastructure as existing terminals)
- [ ] Terminal is labeled "Dev Server" and visible in the Terminal tabs
- [ ] If a "Dev Server" terminal already exists and its process is alive → don't start a new one
- [ ] Terminal output is emitted as normal terminal events (visible to user)

### A5: Port Detection

- [ ] Port detection regex patterns are defined (at least 8 patterns covering Next.js, Vite, Astro, Express, Uvicorn, generic)
- [ ] ⚠️ Terminal output scanner is wired into the existing PTY output handler (not a separate process)
- [ ] Scanner only runs for terminals tagged as "dev-server" (not all terminals)
- [ ] When a URL is detected → emit Tauri event `"dev-server-ready"` with `{ port, url, terminal_id }`
- [ ] If no URL detected after 15 seconds → try probing `dev_port` from template registry via HTTP HEAD
- [ ] If probing fails → try `lsof` on the dev server process PID
- [ ] If all detection fails → show error with "Enter URL manually" option
- [ ] Port detection handles the case where port changes (dev server restart): emit updated event

### A6: End-to-End Flow

- [ ] "Run Application" button exists in the title bar (🌐 icon or similar)
- [ ] Clicking it when no project is open → shows message "Open a project first"
- [ ] Clicking it with a project open → starts dev server + opens preview window
- [ ] Preview window initially shows "Starting dev server..." state
- [ ] When port is detected → preview navigates to `http://localhost:{port}`
- [ ] User's application is visible and interactive in the preview
- [ ] Hot-reload works: edit a file in the project → preview updates (may require manual refresh for some frameworks)
- [ ] ⚠️ Clicking "Run Application" when preview is already open → focuses the existing window (doesn't create duplicate)
- [ ] Clicking "Run Application" when dev server is already running → reuses it (doesn't start a second one)

### A7: Window Controls

- [ ] Preview window has Back button (←) that works
- [ ] Preview window has Forward button (→) that works
- [ ] Preview window has Refresh button (↻) that works
- [ ] URL bar shows the current URL
- [ ] URL bar is editable — user can type a URL and navigate to it
- [ ] Viewport presets exist: Mobile (375px), Tablet (768px), Desktop (full width)
- [ ] Viewport presets constrain the content area width, not the window width
- [ ] "Open in Browser" button opens the current URL in the system default browser
- [ ] Console badge shows count of console messages (red for errors, yellow for warnings)

---

## PHASE B: Console Log Bridge

### B1: Console Bridge Script

- [ ] File `src-tauri/resources/preview-console-bridge.js` exists
- [ ] Script uses `function` keywords (not arrow functions) for WKWebView compatibility
- [ ] Script uses `arguments` object (not rest parameters) for compatibility
- [ ] Script checks `window.__CM_CONSOLE_BRIDGE` to prevent double-injection on SPA navigation
- [ ] Script sets `window.__CM_CONSOLE_BUFFER = []`
- [ ] Script overrides `console.log`, `console.warn`, `console.error`, `console.info`, `console.debug`
- [ ] Each override calls the original function after capturing (logs still appear in devtools)
- [ ] Captured entries include: `level`, `ts` (ISO string), `msg` (serialized args), `url` (current page)
- [ ] `console.error` entries also include `stack` (stack trace)
- [ ] Script captures `window.addEventListener('error', ...)` for unhandled errors
- [ ] Script captures `window.addEventListener('unhandledrejection', ...)` for promise rejections
- [ ] Buffer is capped at 500 entries (oldest dropped)
- [ ] Script does NOT reference `window.__TAURI_INTERNALS__` (not available on external pages)

### B2: Initialization Script Injection

- [ ] ⚠️ `open_preview_window` calls `.initialization_script(console_bridge_script)` on the WebviewWindowBuilder
- [ ] Console bridge JS is loaded via `include_str!("../resources/preview-console-bridge.js")`
- [ ] Test: After opening preview, check browser devtools console — `window.__CM_CONSOLE_BUFFER` should be defined
- [ ] Test: Run `console.error("test")` in the preview's devtools — `window.__CM_CONSOLE_BUFFER` should have 1 entry
- [ ] ⚠️ If `__CM_CONSOLE_BUFFER` is NOT defined after page load: initialization_script is not running on external URLs. Implement the eval() injection fallback:
  - [ ] On page load event, use `preview_window.eval(console_bridge_script)` to inject manually
  - [ ] Re-inject on each navigation (listen for URL changes via polling)

### B3: Rust Polling Loop

- [ ] `start_console_polling` async function exists
- [ ] Polls every 500ms
- [ ] Uses `preview_window.eval()` to drain `__CM_CONSOLE_BUFFER` (splice(0) atomically empties it)
- [ ] Parses the JSON result into `Vec<ConsoleLogEntry>`
- [ ] Stops polling when the preview window is closed (check `get_webview_window("preview").is_none()`)
- [ ] Does NOT crash or log errors when page is navigating (eval may fail temporarily)
- [ ] If `eval()` returns empty array or fails → silently continue (don't spam logs)

### B4: Console Log Storage & Distribution

- [ ] Console entries stored in-memory in `AppState` (for the Console Drawer)
- [ ] Console errors/warnings emitted as Tauri events to the main window: `"preview-console-entry"`
- [ ] Console errors written to `~/.codemantis/preview-console.log` as NDJSON
- [ ] Log file truncated to last 200 entries on each write cycle
- [ ] Log file directory (`~/.codemantis/`) is created if it doesn't exist
- [ ] `get_preview_console_logs` command exists — returns entries with optional `since` timestamp filter
- [ ] Console errors surface in the main window Activity Feed with 🌐 badge and red highlight
- [ ] Toast appears in main window on console.error: "Preview error: {message}" with [View] button

### B5: Console Drawer UI

- [ ] Console Drawer exists at the bottom of the Preview Window
- [ ] Drawer is collapsible (toggle with Console badge click or ⌘⇧C)
- [ ] Shows entries with: timestamp, level icon (colored), message text
- [ ] Error entries show expandable stack trace
- [ ] "Clear" button resets the drawer
- [ ] "Copy All" button copies all entries to clipboard
- [ ] Drawer height is resizable (drag top edge)
- [ ] New entries auto-scroll to bottom

---

## PHASE C: Task Board Slide-Over + Interactive Planning Chat

### C1: Types & Store

- [ ] File `src/types/task-board.ts` exists with ALL types: `TaskPlan`, `WorkPackage`, `TaskItem`, `VerificationCheck`, `CheckResult`, `PlanningConversation`, `PlanningMessage`, `PlanningAttachment`, `ProjectSnapshot`, `FileChange`, `ConsoleLogEntry`, `ProgressReview`, `TaskBoardUIState`
- [ ] File `src/stores/taskBoardStore.ts` exists with Zustand store
- [ ] Store has: `currentPlan`, `planningConversation`, `uiState`, `createPlan()`, `updateTaskStatus()`, `updateCheckResult()`, `addPlanningMessage()`, `toggleSlideOver()`
- [ ] Plans persist to SQLite (survive app restart)
- [ ] Planning conversation messages persist to SQLite (survive app restart)

### C2: Slide-Over Container

- [ ] `TaskBoardSlideOver.tsx` component exists
- [ ] Slides in from the RIGHT side of the main window
- [ ] Covers approximately 60% of the window width
- [ ] Main app content behind it is dimmed (semi-transparent backdrop)
- [ ] Clicking the dimmed backdrop closes the slide-over
- [ ] Smooth slide animation (200-300ms ease-out)
- [ ] Has two columns: Planning Chat (left, ~40%) and Work Packages (right, ~60%)
- [ ] Column widths are adjustable by dragging the divider
- [ ] Has a bottom toolbar with: [▶ Start All] [⏸ Pause] [🔄 Re-plan]
- [ ] Has × close button in the top-right corner
- [ ] Pressing Escape closes the slide-over

### C3: Title Bar Integration

- [ ] 📋 button exists in the title bar (next to MCP/settings buttons)
- [ ] Clicking 📋 toggles the slide-over open/closed
- [ ] `⌘⇧B` keyboard shortcut toggles the slide-over
- [ ] When slide-over is closed and tasks exist: small badge next to 📋 shows compact status (e.g., "WP2: 5/7 ✅")
- [ ] Badge pulses gently when execution is in progress
- [ ] Slide-over auto-opens when: plan is being generated, or tasks are executing

### C4: Planning Chat (Left Column)

- [ ] `PlanningChat.tsx` component exists
- [ ] Shows scrollable message history (user, AI, system messages)
- [ ] AI messages render as Markdown with streaming token display
- [ ] User messages show on the right side
- [ ] System messages (progress updates) are visually distinct (different background, icon)

### C5: Planning Chat Input

- [ ] `PlanningChatInput.tsx` component exists
- [ ] Multi-line text input (same style as main chat input)
- [ ] ⚠️ Image paste (⌘V) works — clipboard image detected, thumbnail shown, added as attachment
- [ ] Drag-and-drop images onto the input area works
- [ ] "+" button opens native file dialog for attaching files
- [ ] Supports: PNG, JPG, GIF, WebP (images), PDF, TXT, MD, DOCX (documents)
- [ ] Attachments show as preview chips above the input (same pattern as main input AttachmentBar)
- [ ] Image attachments show thumbnail preview (36×36px)
- [ ] Document attachments show file icon + name + size
- [ ] Attachments can be removed (× on each chip)
- [ ] Send button (or ⌘Enter) sends message + attachments to planning AI
- [ ] Images sent to AI as base64 in the API message content
- [ ] Documents: text content extracted and sent inline (PDFs via existing extraction, text files directly)
- [ ] ⚠️ Images resized to max 1024px longest edge before sending (token budget)
- [ ] ⚠️ Document text truncated to 10,000 characters with "..." if longer

### C6: Interactive Conversation Flow

- [ ] `usePlanningConversation.ts` hook exists
- [ ] Planning AI system prompt is CONVERSATIONAL — instructs AI to ask questions first, NOT generate plan immediately
- [ ] ⚠️ First AI response is ALWAYS clarifying questions, not a task plan
- [ ] AI acknowledges what the user described and what's clear
- [ ] AI asks 3-5 focused questions about ambiguities
- [ ] If user attaches images: AI analyzes and references specific visual elements it sees
- [ ] If user attaches documents: AI reads and confirms understanding of key points
- [ ] Conversation continues for 2-4 exchanges until AI has enough information
- [ ] AI says something like "I have enough to create the plan. Shall I proceed?"
- [ ] ⚠️ "Generate Plan" button appears in the chat when AI indicates readiness
- [ ] Clicking "Generate Plan" sends a message: "Yes, generate the plan now"
- [ ] AI responds with structured JSON task plan
- [ ] JSON response is parsed → tasks populate the right column
- [ ] ⚠️ Handle case where AI wraps JSON in markdown code blocks (strip ```json and ```)
- [ ] Handle case where AI returns invalid JSON (show error, allow retry)
- [ ] User CAN also type "just generate the plan" at any point to skip questions

### C7: Work Package List (Right Column)

- [ ] `WorkPackageList.tsx` component exists
- [ ] Shows plan name and overall progress at the top
- [ ] Work packages displayed as collapsible cards
- [ ] Each card shows: name, task count, progress bar, status badge
- [ ] Clicking a card expands to show individual tasks
- [ ] Each task shows: status icon (✅❌🔄⏳), title, click to expand
- [ ] Expanded task shows: description, acceptance criteria, verification checks
- [ ] Each check shows: type icon, description, pass/fail status with evidence
- [ ] "Start" button on each work package
- [ ] Tasks can be manually edited (title, description) before execution
- [ ] Tasks can be deleted or reordered via drag-and-drop
- [ ] New tasks can be added manually to any work package

### C8: Rust Backend

- [ ] File `src-tauri/src/commands/taskboard.rs` exists
- [ ] `create_task_plan` command — receives JSON plan, stores in SQLite
- [ ] `get_task_plan` command — returns current plan with all tasks and checks
- [ ] `update_task_status` command — updates individual task status
- [ ] `update_task` command — edit task title, description, checks
- [ ] `delete_task` command — remove a task
- [ ] `reorder_tasks` command — change task order within a work package
- [ ] `run_code_verification` command — runs Tier 1 checks, returns results
- [ ] `run_dom_verification` command — runs Tier 2 checks via preview eval, returns results
- [ ] All commands registered in `lib.rs` invoke_handler

---

## PHASE D: Execution & Verification

### D1: Sequential Execution

- [ ] `useTaskExecution` hook exists
- [ ] Executing a work package creates a Claude Code session in Auto-Accept mode
- [ ] The prompt includes ALL tasks in the work package with descriptions and acceptance criteria
- [ ] The prompt instructs Claude to complete ALL tasks and say "ALL TASKS COMPLETE" when done
- [ ] Hook monitors session for the completion signal or 30s idle timeout
- [ ] After completion → automatically triggers verification
- [ ] ⚠️ Work packages execute one at a time, strictly sequential (never parallel)
- [ ] Progress is reflected in the Task Board UI in real-time

### D2: Tier 1 Verification (Code Checks)

- [ ] `file_exists` checks work correctly (relative to project root)
- [ ] `file_contains` checks work — substring matching, case-sensitive
- [ ] `grep_codebase` checks work — searches .ts, .tsx, .js, .jsx, .py, .rs files (skip node_modules, .git)
- [ ] `command_succeeds` checks work — runs shell command, checks exit code 0
- [ ] Results stored per-check with `passed`, `evidence`, `checked_at`
- [ ] Results displayed in Task Board UI immediately after check runs
- [ ] Overall work package status updated: all checks pass → done, any fail → verifying/retry

### D3: Tier 2 Verification (DOM Checks)

- [ ] ⚠️ Preview Window must be open and a dev server running for DOM checks to work
- [ ] If preview is not open → auto-open it before running DOM checks
- [ ] If dev server is not running → auto-start it before running DOM checks
- [ ] For each unique route in the dom_checks:
  - [ ] Navigate preview to `http://localhost:{port}{route}`
  - [ ] Wait 3 seconds for page load (or poll for `document.readyState === 'complete'`)
  - [ ] Execute the assertion script via `preview_window.eval()`
  - [ ] Parse the JSON results
- [ ] `exists` assertion: `document.querySelector(selector) !== null`
- [ ] `visible` assertion: element exists AND has non-zero dimensions AND is not `display:none`
- [ ] `has_text` assertion: `element.textContent.includes(expected)`
- [ ] `has_options` assertion: element has `option` or `[role="option"]` children
- [ ] `count_gte` assertion: `document.querySelectorAll(selector).length >= expected`
- [ ] `not_exists` assertion: `document.querySelector(selector) === null`
- [ ] ⚠️ Multiple selectors separated by commas are tried as a single CSS selector (standard CSS behavior — `querySelector("a, b")` matches either `a` or `b`)
- [ ] DOM check failures show the evidence (e.g., "No element matching selector found on /dashboard")
- [ ] DOM check results displayed in Task Board UI alongside code check results

### D4: Retry Flow

- [ ] After verification, if any checks failed → build retry prompt
- [ ] Retry prompt lists ONLY the failed checks with specific descriptions
- [ ] Retry prompt is sent to the SAME Claude Code session (maintains context)
- [ ] Maximum 3 retries per work package
- [ ] After 3 retries with same failures → status set to `needs_review`, proceed to next package
- [ ] ⚠️ Retry does NOT re-run passed checks (only re-verifies previously failed ones)
- [ ] Task Board shows retry count: "Auto-retrying... attempt 2/3"

---

## PHASE E: AI Lifecycle — Progress Reviews & Data Access

### E1: Project Snapshot Infrastructure

- [ ] File `src-tauri/src/commands/snapshot.rs` exists
- [ ] `gather_project_snapshot` command exists and is registered in `lib.rs`
- [ ] Snapshot gathers: `git diff --stat` for files changed (insertions/deletions per file)
- [ ] Snapshot gathers: `git diff --name-status` for new/deleted files
- [ ] Snapshot gathers: file tree (reuses existing `read_file_tree`, truncated to 50 lines)
- [ ] Snapshot gathers: `package.json` dependencies list (parsed from file)
- [ ] Snapshot gathers: detected routes (scan for `page.tsx`, `route.tsx`, `+page.svelte` patterns)
- [ ] Snapshot gathers: last 20 console errors + last 10 console warnings from preview
- [ ] Snapshot gathers: verification check results (already in memory from Phase D)
- [ ] For gap review (Role 3): reads content of key files — files referenced in `file_exists`/`file_contains` checks, plus main layout file and route index files
- [ ] ⚠️ File contents truncated to first 100 lines per file, max 10 files total
- [ ] ⚠️ Total snapshot output measured — MUST stay under 8000 tokens. Log a warning if exceeded.
- [ ] Snapshot returns a `ProjectSnapshot` struct serialized as JSON

### E2: Progress Updates After Each Work Package

- [ ] After a work package completes AND verification runs → snapshot is gathered automatically
- [ ] Snapshot is formatted as a PROGRESS_UPDATE message
- [ ] Message is injected into the planning conversation (same assistant session)
- [ ] `ProgressUpdateMessage.tsx` component exists — renders as a visually distinct system message
- [ ] Progress message shows: "📊 Work Package {name} completed. {pass}/{total} checks passed."
- [ ] Expandable section in the message shows: list of passed/failed checks with evidence
- [ ] Expandable section shows: files changed summary
- [ ] If console errors exist: shown with ⚠️ indicator

### E3: Planning AI Reviews Progress (Role 2)

- [ ] After injecting PROGRESS_UPDATE, wait for planning AI response
- [ ] AI response is parsed as `ProgressReview` JSON
- [ ] ⚠️ Handle case where AI responds conversationally instead of JSON (show in chat, ask user to interpret)
- [ ] If `assessment === "on_track"`: proceed to next work package
- [ ] If `assessment === "needs_refinement"`:
  - [ ] `refined_tasks` are applied — existing tasks updated with new descriptions/checks
  - [ ] Task Board UI shows which tasks were refined (visual indicator: 🔄 + "Refined by AI")
  - [ ] Refined tasks re-execute (only the changed ones, not the whole package)
- [ ] If `assessment === "has_gaps"`:
  - [ ] `new_tasks` are added to the CURRENT work package (or a new supplementary one)
  - [ ] `removed_task_ids` are removed from the plan
  - [ ] `updated_checks` are applied to existing tasks (e.g., selector refinement)
  - [ ] New/changed tasks execute before moving to the next package
- [ ] `notes` from AI are displayed in the planning chat as the AI's response

### E4: Gap Detection After All Packages (Role 3)

- [ ] After ALL work packages are marked done → trigger gap review automatically
- [ ] Gap review message includes: original user description (from first conversation messages), full project snapshot with file contents
- [ ] Planning AI prompt for gap review: "All planned tasks are complete. Review the original requirements against what was built. What is missing?"
- [ ] AI response can contain `new_tasks` → these form a "Supplementary" work package added to the board
- [ ] If AI says nothing is missing → plan status set to `done` 🎉
- [ ] If supplementary tasks exist → they execute and verify like any other work package
- [ ] After supplementary package → gap review runs ONCE more (but only once — no infinite loop)

### E5: User Feedback Integration (Role 4)

- [ ] "Report Issue" button exists in the planning chat input area
- [ ] Clicking it pre-fills the input with "I found an issue: "
- [ ] ⚠️ User can paste screenshots of the issue (⌘V) — they're attached to the message
- [ ] User's issue report is sent to the planning AI conversation
- [ ] AI analyzes the issue and responds with new fix tasks (parsed as `ProgressReview`)
- [ ] Fix tasks are added to the board as a new "Fixes" work package
- [ ] Fix tasks execute and verify normally
- [ ] Multiple issue reports can be batched — AI accumulates them before generating tasks

### E6: Verification Refinement (Role 5)

- [ ] When a DOM check fails 2+ times AND Claude Code reports the feature is built:
  - [ ] Automatically send the failing check details + relevant file content to the planning AI
  - [ ] AI determines: is the code wrong, or is the check wrong?
  - [ ] If check is wrong: AI returns `updated_checks` with new selectors/assertions
  - [ ] Updated checks are applied and re-run
  - [ ] If code is wrong: AI returns specific fix instructions in a retry prompt
- [ ] Planning chat shows: "🔍 Verification refinement: Updated selector for 'Category dropdown' from `select#category` to `[role='combobox']`"

---

## PHASE F: Polish & Integration

### F1: Preview Window Polish

- [ ] Window position and size persist in AppSettings across app restarts
- [ ] `⌘⇧P` keyboard shortcut toggles the preview window (open/focus/hide)
- [ ] `⌘R` refreshes the preview when it has focus
- [ ] `⌘⇧C` toggles the Console Drawer when preview has focus
- [ ] Shortcuts are added to `src/data/shortcuts.ts` under "Preview" and "Task Board" categories
- [ ] Shortcuts are visible in Settings → Shortcuts tab

### F2: Task Board Polish

- [ ] Work packages can be reordered via drag-and-drop
- [ ] "Re-plan" button in toolbar asks AI to regenerate the plan (preserving conversation history)
- [ ] "Pause" button stops execution after the current work package finishes (doesn't kill in-progress)
- [ ] Slide-over remembers its open/closed state per project
- [ ] Planning chat column width is adjustable and persists

### F3: Settings

- [ ] Preview settings section in Settings modal:
  - [ ] Default window width/height
  - [ ] Auto-start dev server when project opens (default: false)
  - [ ] Custom dev command override (per project)
  - [ ] Console auto-open on errors (default: true)
- [ ] Task Board settings:
  - [ ] Default planning AI model (dropdown: Gemini Flash, OpenAI GPT-4o, etc.)
  - [ ] Max retry count (default: 3)
  - [ ] Auto-start next work package (default: true)
  - [ ] Auto-open slide-over during execution (default: true)

### F4: Error Handling

- [ ] Preview window creation failure → shows error toast in main window, not a crash
- [ ] Dev server start failure → shows terminal output in error state, offer retry
- [ ] Port detection failure → shows manual URL input, not a crash
- [ ] Console polling failure → silently continues, doesn't spam errors
- [ ] Planning AI returns invalid JSON → shows "Failed to parse response" with raw text in planning chat, allows retry
- [ ] DOM check timeout → marks check as failed with "Page did not load within timeout"
- [ ] Claude Code session crash during execution → shows error in Task Board, offers retry
- [ ] Snapshot gathering fails (e.g., not a git repo) → continues with partial data, shows warning
- [ ] Planning AI API rate limited → shows rate limit message, auto-retries after 30s

---

## INTEGRATION TESTS (run after all phases complete)

### End-to-End: Preview Window

- [ ] Fresh app launch → open project → click "Run Application" → dev server starts → port detected → preview shows app
- [ ] Edit a file in Claude Code → preview hot-reloads (or shows updated content after manual refresh)
- [ ] Console.error in user's app → appears in Console Drawer + Activity Feed + preview-console.log
- [ ] Close preview → dev server prompt → "Keep running" → reopen preview → shows same app
- [ ] Close preview → dev server prompt → "Stop" → dev server terminal process ends

### End-to-End: Interactive Planning

- [ ] Open Task Board slide-over → type "Build a login page with email and password"
- [ ] ⚠️ AI responds with QUESTIONS first — does NOT immediately generate a task plan
- [ ] Answer the questions → AI asks follow-up or says "ready to plan"
- [ ] Paste a screenshot mockup → AI references visual elements it sees
- [ ] Attach a PDF spec → AI reads and confirms key requirements from it
- [ ] Click "Generate Plan" → AI returns structured task plan
- [ ] Tasks and work packages appear in the right column

### End-to-End: Execution + AI Review Loop

- [ ] Click "Start" on WP1 → Claude Code session opens in auto-accept mode
- [ ] Claude Code builds the features
- [ ] Verification runs: code checks + DOM checks execute
- [ ] ⚠️ Planning AI receives progress update automatically in the planning chat
- [ ] AI reviews and responds (on_track / needs_refinement / has_gaps)
- [ ] If refinement needed: tasks update in the board, re-execute
- [ ] Execution proceeds to WP2 → same cycle
- [ ] After all packages: gap review runs automatically
- [ ] If gaps found: supplementary tasks appear and execute

### End-to-End: User Feedback Loop

- [ ] After execution completes, user opens preview and tests the app
- [ ] User clicks "Report Issue" in planning chat
- [ ] User pastes a screenshot of the bug
- [ ] AI creates fix tasks with verification checks
- [ ] Fix tasks appear in the board and execute
- [ ] Fix is verified → user confirms in the planning chat

### End-to-End: Full Flow (The Demo Story)

- [ ] User describes a multi-page app in 2-3 sentences
- [ ] AI asks smart questions, user answers with text + a mockup screenshot
- [ ] Plan generated: 40+ tasks across 5+ work packages
- [ ] Click "Start All" → walk away
- [ ] 20-30 minutes later: all packages executed, verified, AI reviewed
- [ ] Gap review found 2 missing features → supplementary package ran
- [ ] Preview shows complete running application
- [ ] User reports one visual issue → AI creates fix → fixed and verified
- [ ] Result: complete application built from a conversation
