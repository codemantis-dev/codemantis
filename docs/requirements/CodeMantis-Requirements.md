# ClaudeForge — Product Requirements Specification

**Version:** 1.0
**Date:** March 2026
**Author:** Harald (Product Owner)
**Purpose:** Complete specification for building a native macOS desktop application that wraps Claude Code CLI with a modern UI. This document is intended to be used directly by Claude Code as the primary build specification.

---

## Table of Contents

1. Product Vision & Goals
2. Architecture Overview
3. Technology Stack
4. Project Structure
5. Core Module: CLI Process Manager (Rust)
6. Core Module: Session Manager (Rust)
7. Core Module: Authentication & Startup
8. UI Module: Application Shell & Layout
9. UI Module: Session Tabs
10. UI Module: Left Sidebar
11. UI Module: Chat Panel (Center)
12. UI Module: Right Panel — Activity Feed
13. UI Module: Right Panel — Terminal(s)
14. UI Module: Right Panel — File Viewer
15. UI Module: Right Panel — Diff Viewer
16. UI Module: Input Area & Attachments
17. UI Module: Command Palette (Slash Commands)
18. UI Module: Tool Approval Modal
19. Feature: Image & File Attachments
20. Feature: Settings & Preferences
21. Feature: Keyboard Shortcuts
22. Data Persistence & Storage
23. Build, Packaging & Distribution
24. Implementation Phases
25. Appendix: Stream JSON Event Types
26. Appendix: CLI Flags Reference

---

## 1. Product Vision & Goals

ClaudeForge is a native macOS desktop application that provides a modern graphical user interface around the Claude Code CLI. It uses the user's existing Claude Pro/Max subscription — no API key is required.

**Core principle:** The chat conversation and code operations are visually separated. The center panel is a clean conversational interface. All code reads, writes, edits, terminal commands, and diffs live in the right panel. This gives the user a clear mental model: "I talk to Claude on the left, I see what Claude does on the right."

**Goals:**
- Provide the full power of Claude Code (all tools, slash commands, skills, MCP servers, hooks, subagents, CLAUDE.md) in a polished native UI
- Support multiple concurrent sessions (one per project) as top-level tabs
- Support multiple concurrent terminal instances for running dev commands (npm run dev, tests, git, etc.)
- Enable seamless image/file attachments via drag-and-drop and clipboard paste
- Show all code operations in a dedicated Activity feed, separate from the conversation
- Launch as a .dmg-installable macOS application with auto-update support

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     TAURI v2 SHELL                           │
│             (native macOS window, WKWebView)                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            REACT FRONTEND (WKWebView)                │   │
│  │                                                      │   │
│  │  ┌──────────┬──────────────────┬─────────────────┐  │   │
│  │  │  Left    │  Center          │  Right           │  │   │
│  │  │  Sidebar │  Chat Panel      │  Activity/Term/  │  │   │
│  │  │          │  (conversation   │  File/Diff       │  │   │
│  │  │  Files   │   only — no      │                  │  │   │
│  │  │  Git     │   code/tools)    │  (all code ops   │  │   │
│  │  │  MCP     │                  │   shown here)    │  │   │
│  │  └──────────┴──────────────────┴─────────────────┘  │   │
│  │                 ┌──────────────────┐                  │   │
│  │                 │  Input + Attach  │                  │   │
│  │                 └──────────────────┘                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ▲                                    │
│                          │ Tauri IPC (invoke / events)       │
│                          ▼                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              RUST BACKEND (src-tauri)                 │   │
│  │                                                      │   │
│  │  ┌───────────────┐    ┌────────────────────────┐    │   │
│  │  │ Session Mgr   │    │ CLI Process Pool       │    │   │
│  │  │ (SQLite)      │    │ (tokio async procs)    │    │   │
│  │  └───────────────┘    └────────────────────────┘    │   │
│  │  ┌───────────────┐    ┌────────────────────────┐    │   │
│  │  │ Terminal Pool  │    │ File Watcher           │    │   │
│  │  │ (PTY procs)   │    │ (notify crate)         │    │   │
│  │  └───────────────┘    └────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
    ~/.claude/                  Project directories
    (sessions, auth,            (CLAUDE.md, .claude/,
     config, MCP)                source code)
```

**Data Flow for a user message:**
1. User types prompt in React input area, optionally with attachments
2. React calls Tauri `invoke("send_message", { sessionId, prompt, attachments })` 
3. Rust backend writes the prompt as NDJSON to the Claude CLI process's stdin
4. Claude CLI emits NDJSON events to stdout
5. Rust parses each line, classifies as text vs tool-use vs result, emits Tauri events
6. React receives events: text goes to Chat Panel, tool operations go to Activity Feed
7. If a tool needs approval, Rust emits an approval event; React shows the modal; user response is sent back via invoke

---

## 3. Technology Stack

### Frontend
- **Framework:** React 18+ with TypeScript (strict mode)
- **Build:** Vite
- **Styling:** Tailwind CSS v3 with CSS variables for theming
- **UI Components:** shadcn/ui (Radix primitives)
- **State:** Zustand for global state (sessions, settings, chat messages)
- **Terminal rendering:** xterm.js (@xterm/xterm) for embedded terminals
- **Code display:** Monaco Editor (@monaco-editor/react) for file viewer
- **Diff rendering:** react-diff-viewer-continued or Monaco diff editor
- **Markdown:** react-markdown with remark-gfm and rehype-highlight for chat messages
- **Icons:** Lucide React

### Backend (Rust — src-tauri)
- **Framework:** Tauri v2
- **Async runtime:** Tokio (full features)
- **Process management:** tokio::process for Claude CLI, portable-pty for terminal PTYs
- **JSON parsing:** serde, serde_json for NDJSON stream parsing
- **Database:** rusqlite (bundled SQLite) for session metadata
- **File watching:** notify crate for file change detection
- **Clipboard:** Tauri clipboard plugin (@tauri-apps/plugin-clipboard-manager)
- **File dialogs:** Tauri dialog plugin (@tauri-apps/plugin-dialog)
- **Shell:** Tauri shell plugin (@tauri-apps/plugin-shell) for PTY terminals

### System Requirements
- macOS 12+ (Monterey or later)
- Claude Code CLI installed globally (`npm install -g @anthropic-ai/claude-code`)
- Active Claude Pro or Max subscription (authenticated via `claude login`)
- Node.js 18+ (Claude Code dependency)

---

## 4. Project Structure

```
claudeforge/
├── src/                              # React frontend (TypeScript)
│   ├── App.tsx                       # Root component, layout orchestration
│   ├── main.tsx                      # Entry point
│   ├── index.css                     # Tailwind imports, global styles
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx          # Three-panel layout container
│   │   │   ├── TitleBar.tsx          # Custom titlebar with session tabs
│   │   │   └── ResizablePanel.tsx    # Draggable panel dividers
│   │   │
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx           # Left sidebar container with tabs
│   │   │   ├── FileTree.tsx          # Project file explorer
│   │   │   ├── GitPanel.tsx          # Git status / staged changes
│   │   │   └── McpPanel.tsx          # MCP server status
│   │   │
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx         # Scrollable message list
│   │   │   ├── MessageBubble.tsx     # Individual message (user or assistant)
│   │   │   ├── ActivityChip.tsx      # Inline "3 reads · 2 edits → Activity" link
│   │   │   └── StreamingCursor.tsx   # Blinking cursor during streaming
│   │   │
│   │   ├── input/
│   │   │   ├── InputArea.tsx         # Chat input with attachment bar
│   │   │   ├── AttachmentPreview.tsx # Thumbnail chips for attached files/images
│   │   │   ├── CommandPalette.tsx    # Slash command dropdown
│   │   │   └── PasteHandler.tsx      # Clipboard image detection
│   │   │
│   │   ├── rightpanel/
│   │   │   ├── RightPanel.tsx        # Right panel container with tabs
│   │   │   ├── ActivityFeed.tsx      # Timeline of all code operations
│   │   │   ├── TerminalTabs.tsx      # Multi-terminal tab bar
│   │   │   ├── TerminalView.tsx      # Single xterm.js terminal instance
│   │   │   ├── FileViewer.tsx        # Monaco editor read-only file view
│   │   │   └── DiffViewer.tsx        # Side-by-side or unified diff
│   │   │
│   │   ├── modals/
│   │   │   ├── ToolApproval.tsx      # Approve/deny tool use modal
│   │   │   ├── SettingsModal.tsx     # App settings dialog
│   │   │   └── ProjectPicker.tsx     # Open project / new session dialog
│   │   │
│   │   └── shared/
│   │       ├── ToolBadge.tsx         # Colored tool type indicator (RE, WR, ED, BA)
│   │       ├── StatusDot.tsx         # Green/yellow/red status indicator
│   │       └── ContextMeter.tsx      # Token usage progress bar
│   │
│   ├── hooks/
│   │   ├── useClaudeSession.ts       # Manage a single Claude CLI session
│   │   ├── useStreamParser.ts        # Parse NDJSON events from Tauri
│   │   ├── useTerminal.ts            # Manage a PTY terminal instance
│   │   ├── useFileTree.ts            # Read project directory tree
│   │   ├── useKeyboardShortcuts.ts   # Global keyboard shortcut handler
│   │   └── useTheme.ts              # Dark/light theme toggle
│   │
│   ├── stores/
│   │   ├── sessionStore.ts           # All sessions and their messages
│   │   ├── activityStore.ts          # Activity feed entries per session
│   │   ├── terminalStore.ts          # Terminal instances per session
│   │   ├── uiStore.ts               # Panel widths, active tabs, modal state
│   │   └── settingsStore.ts         # User preferences, persisted
│   │
│   ├── types/
│   │   ├── claude-events.ts          # TypeScript types for all stream events
│   │   ├── session.ts               # Session, Message, Attachment types
│   │   ├── activity.ts              # ActivityEntry types
│   │   └── terminal.ts             # Terminal instance types
│   │
│   └── lib/
│       ├── tauri-commands.ts         # Typed wrappers for Tauri invoke calls
│       ├── event-classifier.ts       # Classify stream events as chat vs activity
│       └── markdown-renderer.ts      # Custom markdown rendering config
│
├── src-tauri/                        # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json               # Tauri configuration
│   ├── capabilities/                 # Tauri v2 capability declarations
│   │   └── default.json
│   ├── icons/                        # App icons for macOS
│   │
│   └── src/
│       ├── main.rs                   # Tauri app builder, plugin registration
│       ├── lib.rs                    # Module declarations
│       │
│       ├── commands/                 # Tauri IPC command handlers
│       │   ├── mod.rs
│       │   ├── session.rs            # create_session, send_message, close_session
│       │   ├── terminal.rs           # create_terminal, send_terminal_input, close_terminal
│       │   ├── files.rs              # read_file_tree, read_file_content
│       │   ├── attachments.rs        # save_clipboard_image, resolve_attachment_path
│       │   └── settings.rs           # get_settings, update_settings
│       │
│       ├── claude/                   # Claude CLI integration
│       │   ├── mod.rs
│       │   ├── process.rs            # Spawn Claude CLI with stream-json flags
│       │   ├── stream_parser.rs      # Line-by-line NDJSON parser
│       │   ├── event_types.rs        # Rust structs for all stream event types
│       │   └── message_router.rs     # Classify events → emit to frontend
│       │
│       ├── terminal/                 # PTY terminal management
│       │   ├── mod.rs
│       │   └── pty_manager.rs        # Spawn PTY shells, read/write
│       │
│       ├── storage/                  # Local persistence
│       │   ├── mod.rs
│       │   ├── database.rs           # SQLite schema and queries
│       │   └── migrations.rs         # DB schema migrations
│       │
│       └── utils/
│           ├── mod.rs
│           ├── claude_detection.rs    # Detect Claude CLI install, version, auth status
│           └── project_scanner.rs     # Scan ~/.claude/projects/ for existing sessions
│
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
├── postcss.config.js
└── README.md
```

---

## 5. Core Module: CLI Process Manager (Rust)

This is the most critical module. It manages the lifecycle of Claude Code CLI processes.

### 5.1 Process Spawning

Each Claude Code session is a single long-running process using bidirectional stream-json mode:

```
claude --input-format stream-json \
       --output-format stream-json \
       --include-partial-messages \
       --cwd <project_directory>
```

**Requirements:**
- The Rust backend must spawn this process using `tokio::process::Command`
- stdin must be captured as a piped writer (for sending messages)
- stdout must be captured as a piped reader (for receiving NDJSON events)
- stderr must be captured for error logging
- The process must run asynchronously and not block the main thread
- Each session has exactly one Claude CLI process

### 5.2 Sending Messages

When the user sends a message (with or without attachments):
1. The Rust backend receives a `send_message` invoke from the frontend
2. It constructs a JSON message object and writes it as a line to the CLI process's stdin
3. For messages with image attachments: images are saved to a temp directory in the project, and the file path is included in the message content so Claude Code's vision can read them
4. For messages with file attachments: file paths are included as references in the prompt

### 5.3 Receiving Events

The stdout of the Claude CLI process emits newline-delimited JSON (NDJSON). Each line is one event.

**Requirements:**
- Read stdout line-by-line using `tokio::io::BufReader::lines()`
- Parse each line as JSON using `serde_json::from_str()`
- Classify each event (see Appendix for types) and emit it as a Tauri event to the frontend
- Events should be emitted in two channels:
  - `claude-chat-{sessionId}` — for text content (assistant responses)
  - `claude-activity-{sessionId}` — for tool use, tool results, file operations
- Partial text messages (streaming tokens) should be emitted as incremental deltas

### 5.4 Process Lifecycle

- **Startup:** Process is spawned when a session is created or resumed
- **Idle:** Process stays alive between messages (maintains context)
- **Crash recovery:** If the process exits unexpectedly, emit an error event to the frontend and offer to restart
- **Graceful shutdown:** When the user closes a session tab, send SIGTERM to the process, wait up to 5 seconds, then SIGKILL
- **App quit:** On app close, gracefully shut down all Claude CLI processes

### 5.5 Tool Approval Flow

When Claude Code wants to use a tool that requires approval:
1. The stream event includes a tool_use event with the tool name and arguments
2. The Rust backend emits a `claude-approval-{sessionId}` event to the frontend
3. The frontend shows the ToolApproval modal
4. The user clicks Approve or Deny
5. The frontend calls `invoke("respond_to_approval", { sessionId, approved, alwaysAllow })` 
6. The Rust backend writes the approval response to stdin
7. If `alwaysAllow` is true, add this tool to the auto-approve list for this session

---

## 6. Core Module: Session Manager (Rust)

### 6.1 Session Lifecycle

A session represents one Claude Code conversation tied to one project directory.

**Session states:** `starting` → `connected` → `idle` → `closed`

**Session data model:**
```
Session {
  id: UUID
  name: String              // User-editable label (e.g., "Auth refactor")
  project_path: String      // Absolute path to project directory
  created_at: DateTime
  updated_at: DateTime
  status: SessionStatus     // starting | connected | idle | closed
  model: String             // Current model (sonnet, opus, haiku)
  context_used: u64         // Tokens used in context window
  context_max: u64          // Max context window size
}
```

### 6.2 Session Discovery

On app startup:
1. Scan `~/.claude/projects/` to discover existing Claude Code sessions
2. Read the user's recent sessions and their project paths
3. Present these as resumable sessions in the UI
4. Allow the user to create new sessions by selecting a project directory

### 6.3 Session Persistence

Store in SQLite (located at `~/Library/Application Support/com.claudeforge.app/sessions.db`):
- Session metadata (name, project path, timestamps)
- UI state per session (last active right panel tab, panel widths)
- Per-session auto-approved tools list
- Terminal instance labels per session

Chat messages are NOT stored — they live in the Claude CLI's own session state. If the user resumes a session, Claude Code's internal context handles continuity.

---

## 7. Core Module: Authentication & Startup

### 7.1 Startup Checks

On application launch, perform these checks in order:

1. **Claude Code installed?** Check if `claude` binary exists in PATH. If not, show a friendly message: "Claude Code is not installed. Install it with: `npm install -g @anthropic-ai/claude-code`" with a one-click copy button.

2. **Claude Code version?** Run `claude --version` and parse the output. Store the version. Show a warning if version is below minimum supported (define a MIN_VERSION constant).

3. **Authenticated?** Check if `~/.claude/` contains valid OAuth credentials (the CLI stores these after `claude login`). If not authenticated, show: "Please run `claude login` in your terminal first to authenticate with your Claude subscription." Optionally, offer to open Terminal.app with the command.

4. **All checks pass?** Show the main application window with the last active sessions restored, or the project picker if no previous sessions.

### 7.2 Authentication Method

The app does NOT handle authentication itself. It relies on the Claude Code CLI's existing OAuth flow, which stores credentials in `~/.claude/`. This means:
- No API key is needed
- The user's Pro/Max subscription is used
- Token limits and rate limits are the same as using Claude Code in the terminal

---

## 8. UI Module: Application Shell & Layout

### 8.1 Window Configuration

- **Default size:** 1440 x 900 pixels
- **Minimum size:** 1024 x 640 pixels
- **Title bar:** Custom (Tauri `decorations: false`), with native macOS traffic lights positioned at top-left
- **Vibrancy:** Use Tauri v2's built-in window vibrancy for macOS frosted glass effect on the sidebar
- **Theme:** Dark mode by default, with light mode toggle in settings. Use CSS variables for all colors.

### 8.2 Three-Panel Layout

The layout has three resizable panels:

```
[Left Sidebar (220px)] | [Chat Panel (flex-1)] | [Right Panel (360px)]
```

- **Left Sidebar:** Fixed minimum width of 180px, maximum 320px. Resizable by dragging the right edge.
- **Chat Panel:** Takes all remaining space (flex-1). Minimum width 400px.
- **Right Panel:** Fixed minimum width of 280px, maximum 500px. Resizable by dragging the left edge.
- Panel widths persist across sessions.
- Each panel border shows a subtle resize handle on hover.

### 8.3 Color System (CSS Variables)

Define all colors as CSS custom properties for easy theming:

```css
:root[data-theme="dark"] {
  --bg-primary: #09090b;
  --bg-subtle: rgba(255,255,255,0.02);
  --bg-elevated: rgba(255,255,255,0.04);
  --border: rgba(255,255,255,0.07);
  --border-light: rgba(255,255,255,0.04);
  --text-primary: #e4e4e7;
  --text-secondary: #a1a1aa;
  --text-dim: #71717a;
  --text-faint: #52525b;
  --text-ghost: #3f3f46;
  --accent: #7c3aed;
  --accent-light: #a78bfa;
  --accent-dim: rgba(124,58,237,0.15);
  --green: #4ade80;
  --yellow: #fbbf24;
  --red: #f87171;
  --blue: #60a5fa;
}
```

### 8.4 Typography

- **UI font:** System font stack (-apple-system, SF Pro Display)
- **Code font:** SF Mono, Fira Code, Cascadia Code, monospace
- **Base size:** 13.5px for chat text, 12px for UI elements, 11px for secondary labels

---

## 9. UI Module: Session Tabs

### 9.1 Location

Session tabs live in the title bar, to the right of the traffic lights. They look and behave like browser tabs.

### 9.2 Tab Appearance

Each tab shows:
- A session icon (geometric symbol: ⬡, ◈, △, etc. — auto-assigned per session)
- Session name (editable on double-click)
- Project name (smaller, dimmed text below the session name)
- Status indicator (green dot = connected, yellow = starting, none = idle/closed)
- Close button (×) on hover

The active tab has:
- Elevated background
- Top border in accent color
- Rounded top corners connecting to the panel below

### 9.3 Tab Behavior

- Click a tab to switch sessions. This swaps the entire content of all three panels.
- Click "+" to create a new session (opens ProjectPicker modal).
- Close button (×) closes the session and kills its Claude CLI process (with confirmation if a conversation is active).
- Tabs are reorderable by drag-and-drop.
- Right-click a tab for context menu: Rename, Duplicate, Close, Close Others.
- Middle-click a tab to close it.
- Maximum 10 concurrent sessions (each has its own CLI process consuming resources).

---

## 10. UI Module: Left Sidebar

### 10.1 Sidebar Tabs

The sidebar has three tabs at the top: **Files**, **Git**, **MCP**.

### 10.2 Files Tab

- Shows the file tree of the current session's project directory.
- The Rust backend reads the directory tree using `std::fs` and sends it to the frontend via a Tauri command.
- Directories are collapsible (with arrow indicators).
- Files show an icon based on extension (TypeScript, JavaScript, JSON, Markdown, etc.).
- Modified files (tracked by git) show a green "M" badge.
- New files show a green "A" badge.
- Clicking a file opens it in the right panel's File Viewer tab.
- CLAUDE.md files are highlighted with a special icon/color (amber).
- .claude/ directory items (commands, agents, skills) are visually distinguished.
- File tree auto-refreshes when Claude creates or modifies files (via the file watcher).
- Maximum tree depth: 5 levels. Deeper directories show a "..." indicator.
- Ignore patterns: node_modules, .git, dist, build, .next, __pycache__, .DS_Store.

### 10.3 Git Tab

- Shows the current git branch name at the top.
- Lists "Staged Changes" section: files with their status (A = added, M = modified, D = deleted).
- Lists "Unstaged Changes" section below.
- Each file entry shows the status badge and relative file path.
- Clicking a changed file opens the Diff Viewer in the right panel.
- A "Commit staged changes" button at the bottom (triggers Claude to create a commit message).
- Data comes from running `git status --porcelain` via a Tauri command.
- Refreshes automatically when files change.

### 10.4 MCP Tab

- Lists all connected MCP servers for the current session.
- Each server shows: name, connection status (green dot = connected, red = error), tool count.
- Clicking a server expands to show its available tools.
- Data comes from the Claude CLI session's initialization message (which reports connected MCP servers).

### 10.5 Context Meter

Below the sidebar content, always visible:
- Label "CONTEXT" with current usage (e.g., "47K / 200K")
- A thin progress bar showing the percentage used
- Bar color: accent gradient when under 70%, yellow when 70-90%, red when over 90%
- Updates in real-time as the conversation grows.

---

## 11. UI Module: Chat Panel (Center)

### 11.1 Design Principle

The Chat Panel shows ONLY the conversation text. No code blocks for tool operations, no inline diffs, no terminal output. This is a clean, readable conversation view.

### 11.2 User Messages

- Displayed as right-aligned bubbles with accent-colored background.
- Show the message text, timestamp on hover.
- If attachments were sent with the message, show small thumbnail chips below the text.

### 11.3 Assistant Messages

Each assistant message has two parts:

**Activity Chip (top):** A small inline button showing a summary of what Claude did:
- Format: "4 reads · 3 created · 2 edited → Activity"
- Green dot if all operations completed, yellow pulsing dot if operations are in progress.
- Clicking the chip switches the right panel to Activity tab and scrolls to the relevant entries.
- Only shown if the message involved any tool use.

**Response Text (main):** Claude's conversational response, rendered as Markdown:
- Bold, italic, inline code formatting
- Code blocks with syntax highlighting (use rehype-highlight)
- Bullet and numbered lists
- Links (clickable, open in system browser)
- No tool operation details — those are exclusively in the Activity panel

### 11.4 Streaming

When Claude is generating a response:
- Text appears token-by-token with a blinking cursor at the end (accent color, 530ms blink interval).
- The Activity Chip updates in real-time as tools are invoked.
- The chat automatically scrolls to the bottom as new content arrives.
- A "Stop" button appears at the bottom of the chat area to cancel generation.

### 11.5 Message History

- Messages scroll vertically. Oldest at top, newest at bottom.
- Maximum message width: 720px, centered in the panel.
- When switching sessions (tabs), the chat panel shows that session's messages and restores the scroll position.

---

## 12. UI Module: Right Panel — Activity Feed

### 12.1 Purpose

The Activity Feed is a chronological timeline of every operation Claude performs on the codebase. It is the primary "what's happening" view.

### 12.2 Activity Entry Types

Each entry in the feed represents one tool invocation:

**READ operations (blue):** Glob, Grep, Read
- Show: tool name badge, arguments (file pattern or path), duration, result summary (e.g., "Found 12 files", "7 matches", "186 lines")

**WRITE operations (green):** Write (new file creation)
- Show: "NEW" badge, file path, duration, line count
- Clickable → opens the file in File Viewer

**EDIT operations (yellow):** Edit (modify existing file)
- Show: "EDIT" badge, file path, duration, change summary (e.g., "+8 -4 lines")
- Clickable → opens the diff in Diff Viewer

**BASH operations (purple):** Bash command execution
- Show: "BASH" badge, command string, status (running/done/failed), duration
- If running: pulsing yellow dot
- If failed: red dot with error indicator
- Output is shown inline below (collapsed by default, expandable)

**PENDING operations (yellow):** Awaiting user approval
- Show: pulsing yellow dot, tool name and arguments
- Clicking opens/focuses the approval modal

### 12.3 Timeline Design

- Each entry has a colored dot on the left forming a vertical timeline line.
- Entries are grouped by assistant message (with a subtle divider between groups).
- Timestamp shown on each entry.
- Hover shows additional details (full path, complete arguments).
- Auto-scrolls to newest entries as operations stream in.

### 12.4 Interactivity

- Click a WRITE entry → right panel switches to File Viewer showing that file
- Click an EDIT entry → right panel switches to Diff Viewer showing that diff
- Click a BASH entry → expands/collapses the command output inline
- Click a READ entry → shows read content in a tooltip or expandable section

---

## 13. UI Module: Right Panel — Terminal(s)

### 13.1 Terminal Sub-Tabs

When the Terminal tab is selected, a second row of tabs appears below showing individual terminal instances.

Each terminal tab shows:
- Terminal name (editable on double-click, defaults to "shell 1", "shell 2", etc.)
- Green pulsing dot if a process is running in that terminal
- Close button (×)
- "+" button to create a new terminal instance

### 13.2 Terminal Implementation

Each terminal is a real PTY (pseudo-terminal) session:
- Spawned via the Rust backend using the `portable-pty` crate
- Shell: user's default shell (from $SHELL, typically zsh on macOS)
- Working directory: current session's project path
- Environment: inherits the user's environment variables
- Rendered in the frontend using xterm.js with the fit addon
- Supports full ANSI colors, cursor movement, and interactive programs
- Input: keyboard input is sent to the PTY via the Rust backend
- Output: PTY output is streamed to the frontend via Tauri events

### 13.3 Quick Command Buttons

Below the terminal, a row of configurable quick-command buttons:
- Default commands: `npm run dev`, `npm test`, `git status`, `npx tsc`
- Clicking a button sends the command text to the active terminal
- Commands are customizable per project (stored in settings)

### 13.4 Limits

- Maximum 6 terminal instances per session
- Terminals persist when switching between right panel tabs (xterm.js instances stay alive)
- Terminals are killed when their session tab is closed

---

## 14. UI Module: Right Panel — File Viewer

### 14.1 Implementation

- Uses Monaco Editor in read-only mode for full syntax highlighting
- Detects language from file extension
- Shows line numbers, minimap (optional), and word wrap toggle
- Header shows: file name, file extension badge, file size

### 14.2 Opening Files

Files can be opened in the viewer from:
- Clicking a file in the left sidebar File Tree
- Clicking a WRITE activity entry in the Activity Feed
- Claude creating a new file (auto-opens)

### 14.3 Features

- Syntax highlighting for all common languages (TypeScript, JavaScript, Python, Rust, JSON, YAML, Markdown, HTML, CSS, SQL)
- Search within file (Cmd+F)
- Line numbers
- Go to line (Cmd+G)

---

## 15. UI Module: Right Panel — Diff Viewer

### 15.1 Implementation

- Shows unified diff view (additions in green background, deletions in red background)
- Header shows: file name and change summary (+N -M lines)
- Line numbers for both before and after

### 15.2 Opening Diffs

Diffs appear from:
- Clicking an EDIT activity entry
- Clicking a modified file in the Git panel
- Claude editing a file (auto-shows the diff)

### 15.3 Features

- Toggle between unified and side-by-side view
- Collapse/expand unchanged context lines
- Navigate between hunks with up/down arrows

---

## 16. UI Module: Input Area & Attachments

### 16.1 Input Field

- Multi-line textarea (3 rows default, expands up to 8 rows as user types)
- Placeholder: "Ask Claude anything... (⌘+Enter to send, / for commands)"
- Monospace font is NOT used here — use the UI font for natural typing feel
- Submit: Cmd+Enter sends the message (Enter inserts newline)
- Shift+Enter also inserts newline (standard behavior)

### 16.2 Attachment Bar

Above the textarea, when attachments are present:
- Each attachment shows as a chip with: thumbnail (for images) or file icon (for other files), file name, file size, remove button (×)
- Image thumbnails are 36x36px with rounded corners
- File chips have a colored icon based on type (PDF = red, code = blue, etc.)
- Chips wrap to multiple rows if needed

### 16.3 Action Buttons

Below the textarea, a row of buttons:
- **"+ File"** — Opens native file dialog (Tauri dialog plugin). Selected file is added as an attachment.
- **"/ Cmd"** — Toggles the Command Palette (see next section). Highlighted when active.
- **"@ Agent"** — Shows a dropdown of available subagents (from .claude/agents/). Selecting one prefixes the message with the agent invocation.
- **"📋 ⌘V to paste screenshot"** — Hint text (not a button), reminds user of paste functionality.
- **"Send ⌘↵"** — Send button, active (accent gradient) when there's text or attachments, disabled otherwise.

---

## 17. UI Module: Command Palette (Slash Commands)

### 17.1 Activation

The Command Palette appears as a dropdown above the input area when:
- The user types "/" as the first character in the input field
- The user clicks the "/ Cmd" button

### 17.2 Content

The palette lists all available slash commands:
- **Built-in commands:** /compact, /clear, /model, /init, /context, /help, /hooks, /terminal-setup, /install-github-app
- **Custom commands:** Read from `.claude/commands/` and `~/.claude/commands/` directories
- **Skill-based commands:** Read from `.claude/skills/` and `~/.claude/skills/` directories

Each entry shows:
- Command name (monospace, accent color)
- Description text (from the skill/command markdown frontmatter or a static description for built-ins)
- Category badge: "built-in" (dim) or "custom" (accent)

### 17.3 Behavior

- Searchable: typing filters the list in real-time (matches command name and description)
- Keyboard navigation: arrow keys to move, Enter to select, Escape to close
- Selecting a command inserts it into the input field (e.g., `/compact `)
- The palette closes after selection
- The command list is loaded once per session (from the CLI's initialization message and filesystem scan) and cached

---

## 18. UI Module: Tool Approval Modal

### 18.1 Appearance

A centered modal with backdrop blur:
- Tool icon and name in a colored badge
- "Approve Tool?" title
- "Claude wants to execute a command" subtitle
- Tool details box: tool name label, full arguments in monospace
- Two buttons: "Deny" (neutral) and "Approve" (accent gradient)
- Below buttons: "Always allow [ToolName] for this session" link

### 18.2 Behavior

- Modal blocks the chat panel with a blurred overlay
- Focus trap within the modal
- Keyboard: Enter = Approve, Escape = Deny
- "Always allow" adds the tool to the auto-approve list (stored per-session in the Rust backend)
- Auto-approved tools never show the modal; they proceed silently with a brief notification in the Activity Feed
- Default auto-approve list: Read, Glob, Grep (read-only tools)

### 18.3 Permission Modes

Respect Claude Code's existing permission configuration:
- Tools listed in `--allowedTools` or project settings.json are auto-approved
- Tools listed in `--disallowedTools` are auto-denied (never offered)
- All other tools show the approval modal

---

## 19. Feature: Image & File Attachments

### 19.1 Clipboard Paste (Screenshots)

When the user presses Cmd+V in the input area:
1. The React PasteHandler checks if the clipboard contains image data
2. If yes: prevent default text paste behavior
3. Create a blob from the clipboard image data
4. Generate a filename: `clipboard_HHMMSS.png`
5. Call Tauri invoke `save_clipboard_image({ sessionId, imageData, filename })`
6. Rust backend saves the image to `<project_path>/.claudeforge/attachments/<filename>`
7. Add the attachment to the input area's attachment bar
8. When the message is sent, include the full file path in the prompt

### 19.2 Drag and Drop

The input area (and the entire chat panel) accepts drag-and-drop:
1. Show a visual drop zone overlay when dragging files over
2. On drop: read the file(s) from the drag event
3. For images: save to attachments directory, show thumbnail
4. For other files: reference the original file path, show file chip
5. Multiple files can be dropped at once

### 19.3 File Dialog

The "+ File" button uses Tauri's native file dialog:
- Allows selecting one or multiple files
- File type filters: Images (png, jpg, gif, webp), Documents (pdf, docx, txt, md), Code (ts, js, py, rs, etc.), All files
- Selected files are added as attachments

### 19.4 Supported Image Formats

- PNG, JPEG, GIF, WebP
- Maximum file size: 20MB per image (Claude Code limit)
- Images are passed to Claude Code via file path reference in the prompt

### 19.5 Attachment Storage

- Attachments are saved in `<project_path>/.claudeforge/attachments/`
- This directory should be added to .gitignore automatically
- Attachments older than 7 days are cleaned up on app startup
- The `.claudeforge/` directory is also used for terminal quick-command configs

---

## 20. Feature: Settings & Preferences

### 20.1 Settings Modal

Accessible via Cmd+, or a gear icon in the title bar.

### 20.2 Settings Categories

**General:**
- Theme: Dark / Light / System
- Font size: Small (12px) / Medium (13.5px) / Large (15px)
- Send shortcut: Cmd+Enter (default) or Enter

**Claude Code:**
- Model preference: Sonnet (default) / Opus / Haiku
- Default allowed tools: checkboxes for Read, Write, Edit, Bash, Glob, Grep
- Auto-compact threshold: automatically run /compact when context reaches N% (default: 80%)

**Terminal:**
- Shell: Auto-detect (default) / zsh / bash / fish
- Font size: 12px (default), adjustable
- Quick commands: editable list per project

**Panels:**
- Default right panel tab: Activity (default) / Terminal / File
- Show context meter: Yes (default) / No
- Auto-open file viewer on write: Yes (default) / No
- Auto-open diff viewer on edit: Yes (default) / No

### 20.3 Storage

Settings are stored in `~/Library/Application Support/com.claudeforge.app/settings.json` and loaded on startup. Changes are applied immediately without restart.

---

## 21. Feature: Keyboard Shortcuts

### 21.1 Global Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Enter | Send message |
| Cmd+N | New session (open project picker) |
| Cmd+W | Close current session tab |
| Cmd+, | Open settings |
| Cmd+K | Open quick-action search (future: global command palette) |
| Cmd+1-9 | Switch to session tab N |
| Cmd+Tab | Next session tab |
| Cmd+Shift+Tab | Previous session tab |
| Cmd+\ | Toggle left sidebar |
| Cmd+Shift+\ | Toggle right panel |
| Escape | Close current modal / command palette |

### 21.2 Chat Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Enter | Send message |
| / (first char) | Open command palette |
| Cmd+V | Paste (handles images) |
| Cmd+L | Focus input area |
| Cmd+Shift+C | Copy last assistant response |

### 21.3 Right Panel Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+A | Switch to Activity tab |
| Cmd+Shift+T | Switch to Terminal tab |
| Cmd+Shift+F | Switch to File tab |
| Cmd+Shift+D | Switch to Diff tab |
| Cmd+` | Create new terminal |
| Ctrl+Tab | Next terminal tab |

---

## 22. Data Persistence & Storage

### 22.1 SQLite Database

Location: `~/Library/Application Support/com.claudeforge.app/sessions.db`

**Schema:**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  model TEXT DEFAULT 'sonnet',
  icon TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE session_settings (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  auto_approved_tools TEXT DEFAULT '[]',  -- JSON array
  quick_commands TEXT DEFAULT '[]',        -- JSON array
  panel_widths TEXT DEFAULT '{}',          -- JSON object
  last_right_tab TEXT DEFAULT 'activity',
  terminal_count INTEGER DEFAULT 1
);

CREATE TABLE terminal_instances (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  name TEXT NOT NULL DEFAULT 'shell',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
```

### 22.2 Settings File

Location: `~/Library/Application Support/com.claudeforge.app/settings.json`

Global preferences that apply across all sessions (see Settings section).

### 22.3 What Is NOT Stored

- Chat messages (managed by Claude Code's own session state)
- File contents (read from disk on demand)
- Attachment files (stored temporarily in project directory)

---

## 23. Build, Packaging & Distribution

### 23.1 Development

```bash
# Install dependencies
pnpm install

# Start development mode (hot-reload frontend + Rust rebuild)
pnpm tauri dev
```

### 23.2 Production Build

```bash
# Build macOS .dmg
pnpm tauri build --target universal-apple-darwin
```

This produces:
- `target/release/bundle/dmg/ClaudeForge_x.y.z_universal.dmg`
- `target/release/bundle/macos/ClaudeForge.app`

### 23.3 Auto-Update

Use Tauri's built-in updater plugin:
- Update server: GitHub Releases on the open-source repository
- Check for updates on app launch (once per day)
- Show a non-intrusive notification when an update is available
- User clicks to download and install

### 23.4 Code Signing

For distribution outside the Mac App Store:
- Sign with a Developer ID certificate
- Notarize with Apple
- Staple the notarization ticket to the .dmg

Note: For initial personal use, this can be skipped by running `xattr -c` on the .app.

---

## 24. Implementation Phases

### Phase 1: Foundation (MVP)

Build the core infrastructure and a working end-to-end flow.

**Deliverables:**
1. Tauri v2 project scaffolded with React + TypeScript + Tailwind
2. Rust CLI process manager: spawn Claude Code in stream-json mode, parse NDJSON
3. Single session support (no tabs yet — one session at a time)
4. Chat Panel: send messages, display streaming responses (text only)
5. Activity Feed: display tool operations in real-time
6. Tool Approval modal: basic approve/deny flow
7. Left sidebar with File Tree (basic directory listing)
8. Input area with basic text input (no attachments yet)

**This phase proves:** The core architecture works — you can chat with Claude Code through the UI, see activity in a separate panel, and approve tool use.

### Phase 2: Multi-Session & Terminals

Add concurrent session support and integrated terminals.

**Deliverables:**
1. Session tabs in the title bar (create, switch, close, rename)
2. Session manager with SQLite persistence
3. PTY terminal integration with xterm.js
4. Multi-terminal tabs within the right panel
5. Quick command buttons for terminals
6. Context meter in the sidebar
7. Basic settings modal

### Phase 3: Rich Content & File Integration

Add attachments, file viewer, and diff viewer.

**Deliverables:**
1. Clipboard image paste detection and handling
2. Drag-and-drop file attachments
3. File dialog integration
4. Attachment preview chips in input area
5. Monaco Editor file viewer in right panel
6. Diff viewer for file edits
7. File Tree click → opens in viewer
8. Activity entries click → opens file/diff

### Phase 4: Command Palette & Polish

Add slash commands, keyboard shortcuts, and polish.

**Deliverables:**
1. Command Palette with searchable slash commands
2. Custom command discovery from .claude/commands/ and skills
3. Git panel in sidebar
4. MCP panel in sidebar
5. Full keyboard shortcut system
6. Theme toggle (dark/light)
7. Auto-update via GitHub Releases
8. Performance optimization (virtualized lists for long chats)
9. Error handling and crash recovery
10. README and contribution guide for open-source release

---

## 25. Appendix: Stream JSON Event Types

The Claude Code CLI in `--output-format stream-json` mode emits these NDJSON event types. The Rust parser must handle all of them.

### Text Events (→ Chat Panel)
```json
{"type": "text", "content": "Here is my analysis..."}
```
Partial text tokens during streaming. Accumulate these into the current assistant message.

### Tool Use Events (→ Activity Feed)
```json
{"type": "tool_use", "id": "toolu_01...", "name": "Read", "input": {"file_path": "src/auth/index.ts"}}
```
Claude is invoking a tool. Show in Activity Feed. If tool requires approval, trigger the approval modal.

### Tool Result Events (→ Activity Feed)
```json
{"type": "tool_result", "id": "toolu_01...", "content": "File contents here..."}
```
The result of a tool invocation. Update the corresponding Activity entry with status "done" and result summary.

### Result Events (→ Chat Panel)
```json
{"type": "result", "result": "Final response text", "duration_ms": 4500, "usage": {"input_tokens": 1200, "output_tokens": 800}}
```
The final result of a turn. Mark the message as complete. Update the context meter with token usage.

### System Events (→ Internal)
```json
{"type": "system", "subtype": "init", "model": "claude-sonnet-4-20250514", "slash_commands": ["/compact", "/clear", ...], "mcp_servers": [...]}
```
Session initialization data. Extract model info, available commands, MCP servers.

### Error Events (→ Chat Panel + Activity Feed)
```json
{"type": "error", "error": "Rate limit exceeded"}
```
Show error message in chat and mark current activity as failed.

Note: The exact event format may vary between Claude Code versions. The Rust parser should be resilient to unknown fields (use `#[serde(flatten)]` for extra fields) and log unrecognized event types without crashing.

---

## 26. Appendix: CLI Flags Reference

Full set of Claude Code CLI flags used by ClaudeForge:

```bash
# Session mode (primary — used for all sessions)
claude \
  --input-format stream-json \
  --output-format stream-json \
  --include-partial-messages \
  --cwd <project_directory>

# One-shot mode (used for quick commands like git status)
claude -p "<prompt>" \
  --output-format json \
  --cwd <project_directory> \
  --allowedTools "Read" "Glob" "Grep"

# Version check
claude --version

# Session resume (if supported by current version)
claude --resume <session_id> \
  --input-format stream-json \
  --output-format stream-json
```

### Key flags explained:
- `--input-format stream-json` — Accept NDJSON on stdin for bidirectional communication
- `--output-format stream-json` — Emit NDJSON on stdout for real-time streaming
- `--include-partial-messages` — Emit token-by-token text deltas during generation
- `--cwd <path>` — Set the working directory (project root)
- `--allowedTools` — Pre-approve specific tools (no modal needed)
- `-p` — Non-interactive (print) mode for one-shot queries

---

*End of specification. This document should be placed in the project root as `REQUIREMENTS.md` and referenced in `CLAUDE.md` for Claude Code to follow during implementation.*
