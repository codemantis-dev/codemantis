<!--
  CodeMantis Complete User Guide — Part III & Part IV
  Generated from source code by Claude Code
  Date: March 2026
  App Version: 1.0.0
-->

## Part III: The Right Panel

---

### Chapter 9: Activity Feed

The Activity Feed is a real-time timeline of every tool operation Claude performs — file reads, writes, edits, bash commands, search queries, agent spawns, and MCP calls. While the Chat Panel shows the conversation, the Activity Feed shows what Claude is actually *doing*.

#### What You See

The Activity Feed occupies the first tab of the right panel. It displays a vertical timeline of activity entries, sorted newest-first. Each entry shows:

- A **timeline dot** (left edge): A small colored circle connected to the next entry by a thin vertical line. The dot pulses when the operation is still running.
- A **Tool Badge**: A compact 24×18px monospace label identifying the operation type. Badge codes and their colors:

| Badge | Type | Color |
|-------|------|-------|
| RE | Read | Blue |
| WR | Write | Green |
| ED | Edit | Yellow |
| BA | Bash | Purple |
| SR | Search/Grep/Glob | Purple |
| AG | Agent | Green |
| TD | Task | Blue |
| Q? | Question | Accent |
| MC | MCP tool call | Purple |
| EX | Other/External | Dim |

- **Tool name** (bold): The operation name. MCP tool names are reformatted from `mcp__server__tool` to "server: tool". The tool `AskUserQuestion` displays as "User Question".
- **Approval status badge** (if applicable): A small pill showing APPROVED (green), DENIED (red), or PENDING (yellow).
- **Sub-agent attribution** (if applicable): A green pill showing which sub-agent performed the operation, with the agent's description.
- **Agent stats** (for Agent entries): Badges showing total tool uses and total tokens consumed by the agent.
- **Session label** (in Project scope): A small badge showing which session generated this entry.
- **Timestamp** (right side): The time in HH:MM:SS format.
- **Input summary** (below the header): A monospace line showing the key input — the file path, command, regex pattern, or agent description. Truncated to 3 lines.
- **Result preview** (below the input): A dimmed line showing the tool's output or result. Truncated to 3 lines.
- **Error indicator**: If the operation failed, the result line is shown in red with "Error:" prefix.
- **Question answer**: If the tool was `AskUserQuestion`, the user's answer is shown in accent color.

**Scope toggle** (top-right corner): A small button labeled "Session" or "Project" with a layers icon. Click to switch between:
- **Session**: Shows activity only for the currently active session.
- **Project**: Shows merged activity from all sessions in the project, including assistant tabs. When multiple sources are present, each entry gets a session label badge.

**Preview console entries**: Console errors and warnings from the Preview Browser appear in the feed with a special "Send to chat" button (message icon) that forwards the console output to the main chat input.

**Empty state**: When no activity exists, shows "No activity yet" centered.

#### How to Open / Access

- Click the **Activity** tab in the right panel.
- Press ⌘⇧A to focus the Activity Feed.

#### User Actions

**View activity details**
Click any activity entry → The **Activity Detail Panel** slides in from the right, replacing the feed with a full-detail view of that operation (see below).

**Toggle scope**
Click the **Session/Project** toggle → Switches between session-only and project-wide activity views.

**Send preview console to chat**
On a `preview_console` entry, click the message icon button → The console output is formatted and inserted into the main chat input area.

**Activity Detail Panel**

When you click an entry, the detail panel shows:

- **Header**: Back button (← arrow, also Escape key), tool badge, tool name, status dot, duration, and timestamp.
- **Sub-agent attribution** (if applicable): Green bar showing which agent performed this.
- **Input section**: A table of all input fields — `file_path`, `command`, `pattern`, etc. — with monospace values.
- **Changes section** (Edit tool only): A Monaco diff editor showing the old and new content side-by-side with syntax highlighting.
- **Written Content section** (Write tool only): The full file content in a monospace scrollable area.
- **Result section** (on success): The full tool output in a scrollable monospace area.
- **Error section** (on failure): The error message in red with a red-tinted background.
- **Answer section** (for questions): The user's answer in accent color.
- **Footer** (if a file path exists): An "Open in File Viewer" or "Open Diff in File Viewer" button that opens the file in the Files tab.

#### States

- **Default (empty):** "No activity yet" centered text.
- **Running operation:** The timeline dot pulses. The entry may show an "in progress" state without a result.
- **Completed operation:** Static dot. Result preview visible.
- **Error:** Red result text with "Error:" prefix.
- **Detail view:** The entire feed is replaced by the detail panel. Press Escape or click the back arrow to return.

#### Configuration

The Activity Feed has no dedicated settings. Activity entries are capped at 500 per session to prevent memory growth.

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ A | Focus Activity Feed |
| Escape | Close Activity Detail Panel (back to feed) |

#### Tips

1. **Click any entry to see the full details** — especially useful for Edit operations where you can see the exact diff in a Monaco editor.
2. **Switch to Project scope** when you want to see activity across all sessions — useful for understanding what happened while you were looking at a different session.
3. **The "Open in File Viewer" button** in the detail panel lets you jump directly to the file Claude just edited, with the diff already loaded.

---

### Chapter 10: File Viewer & Editor

The File Viewer is a tabbed code editor built on Monaco Editor. You can browse files in the sidebar, view and edit them, see diffs of Claude's changes, and save modifications.

#### What You See

The File Viewer occupies the **Files** tab in the right panel. It has three layers:

**Tab bar (top, 28px):**
A row of file tabs, each showing:
- The file name (truncated to 120px). A bullet character (•) appended if the file has unsaved changes.
- A close button (×) visible on hover.
- Active tab has elevated background; inactive tabs are dimmed.

**File header (below tab bar):**
- File icon + file name (with • for unsaved changes)
- Extension badge (e.g., `.tsx`, `.rs`)
- Diff summary (for diff views): green "+N" and red "-N" showing lines added/removed
- File size (for normal views, e.g., "12.3 KB")
- Toolbar buttons (right side):
  - **Save** (disk icon): Only visible when the file has unsaved changes. Tooltip: "Save (⌘S)"
  - **Diff toggle** (arrows icon): Switches between normal view and diff view. Available when both old and new content exist. Highlighted in accent when diff mode is active.
  - **Word wrap** (wrap icon): Toggles word wrapping on/off. Highlighted when active.
  - **Side-by-side** (columns icon): Only visible in diff mode. Switches between unified and side-by-side diff display.

**Editor (fills remaining space):**
A full Monaco Editor instance with:
- Syntax highlighting (language auto-detected from file extension)
- Line numbers
- Code folding
- Scrollbar (6px thin)
- Theme matching the app's current color scheme

In **diff mode**, the editor switches to Monaco's DiffEditor, showing removed lines (red background) and added lines (green background).

**Empty state:** When no files are open, shows a file icon with "No file open" and "Click a file in the sidebar or activity feed" hint text.

**File tree (sidebar):**
The sidebar shows the project directory structure with:
- Folders with expand/collapse chevrons (auto-expanded at depth 0)
- Files with colored icons based on extension (TypeScript = blue, JavaScript = yellow, Rust = orange, CSS = blue, HTML = red, JSON = gray, Markdown = amber, Python = blue)
- Special files highlighted in yellow: `CLAUDE.md`, `.claude` folder
- Inline rename: double-click or right-click → Rename, then type and press Enter
- Inline new file/folder: click the header buttons or right-click → New File / New Folder

**Context menu (right-click a file):**
- New File / New Folder (in the same directory)
- Add to Main Chat (attaches file to the chat input)
- Add to Assistant (expandable submenu listing all assistant tabs)
- Add Relative Path to Chat / Add Absolute Path to Chat
- Open (in File Viewer)
- Duplicate / Rename / Delete (with confirmation)
- Reveal in Finder
- Copy Contents / Copy Path / Copy Relative Path
- Expand All Folders / Collapse All Folders

**Context menu (right-click a folder):**
Same as above minus: Add to Main Chat, Open, Duplicate, Copy Contents. Plus: New File and New Folder create items inside that folder.

**Context menu (right-click empty space):**
- New File / New Folder (at project root)
- Expand All Folders / Collapse All Folders

#### How to Open / Access

- Click the **Files** tab in the right panel.
- Click any file in the **sidebar file tree** → Opens in File Viewer.
- Click **"Open in File Viewer"** in the Activity Detail Panel → Opens the file (or diff) in the Files tab.
- Press ⌘⇧F to focus the File Viewer.

#### User Actions

**Open a file**
Click a file name in the sidebar file tree → The file opens as a new tab in the File Viewer with syntax highlighting.

**Switch between open files**
Click a tab in the tab bar → The editor shows that file's content.

**Close a file tab**
Hover over a tab → Click the × button → The tab closes. If the file has unsaved changes, they are discarded.

**Edit a file**
Click in the editor and type → Changes are tracked. The tab name shows a • bullet to indicate unsaved changes. The Save button appears in the toolbar.

**Save a file**
Press ⌘S or click the **Save** button → The file is written to disk. The • indicator disappears.

**View a diff**
Click the **diff toggle** button (arrows icon) → The editor switches to diff mode showing old and new content with added/removed line highlighting. Click again to return to normal view.

**Toggle side-by-side diff**
In diff mode, click the **columns icon** → Switches between unified diff (inline) and side-by-side comparison.

**Toggle word wrap**
Click the **wrap icon** → Toggles word wrapping. Active state is highlighted in accent color.

**Create a new file**
Click the **file+** icon in the sidebar header, or right-click → New File → An inline input appears. Type the filename and press Enter → The file is created and opened in the File Viewer.

**Create a new folder**
Click the **folder+** icon in the sidebar header, or right-click → New Folder → An inline input appears. Type the folder name and press Enter.

**Rename a file or folder**
Right-click → Rename → An inline input appears pre-filled with the current name (file name selected without extension). Edit and press Enter to confirm, or Escape to cancel.

**Delete a file or folder**
Right-click → Delete → A browser confirmation dialog appears. For folders: "Delete folder '{name}' and all its contents? This cannot be undone." Confirm to delete.

**Duplicate a file**
Right-click a file → Duplicate → Creates a copy with a modified name.

**Reveal in Finder**
Right-click → Reveal in Finder → Opens the containing folder in macOS Finder with the item selected.

**Copy file path / relative path / contents**
Right-click → Choose the appropriate option → Copied to clipboard.

**Add file to chat or assistant**
Right-click → Add to Main Chat (attaches as attachment) or Add to Assistant → select assistant tab.

**Insert file path into chat input**
Right-click → Add Relative Path to Chat / Add Absolute Path to Chat → The path text is appended to the main chat input area.

#### States

- **Default (no files open):** File icon + "No file open" message.
- **File open:** Tab bar shows the file, editor displays content with syntax highlighting.
- **Unsaved changes:** Tab name and header show • bullet. Save button appears.
- **Diff mode:** DiffEditor replaces the standard editor, showing red/green change highlights.
- **Loading (sidebar):** "Loading..." text in the file tree area.
- **Empty directory:** "Empty directory" text.

#### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| Auto-open files | Settings → General | Automatically open files in File Viewer when Claude reads or writes them |
| Font size | Settings → General | Affects editor text size |
| Theme | Settings → General | Editor theme matches the app theme |

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ F | Focus File Viewer |
| ⌘ S | Save the active file |

#### Tips

1. **Right-click files in the sidebar** for a full context menu including copy path, reveal in Finder, add to chat, and more.
2. **Use the diff toggle** after Claude edits a file — you'll see exactly what changed with green/red highlighting, just like a Git diff.
3. **The file tree auto-refreshes** when Claude modifies files or when you run commands in the terminal.

---

### Chapter 11: Integrated Terminals

CodeMantis includes fully integrated terminal emulators powered by xterm.js. You can run commands, start dev servers, and use quick command presets — all without leaving the app.

#### What You See

The Terminal tab in the right panel contains:

**Terminal tabs (top, 28px):**
A row of terminal tabs, each showing:
- A **status dot**: green if the terminal process is running, red if it has exited.
- The **terminal name** (e.g., "Terminal 1", "Dev Server").
- A **close button** (×) on hover.
- Active tab has elevated background.

A **"+"** button after the last tab to create a new terminal.

**Terminal view (fills remaining space):**
A full xterm.js terminal with:
- Cursor blinking
- Monospace font (SF Mono, Fira Code, Cascadia Code)
- Color support (ANSI 256 colors)
- 5,000 lines of scrollback
- Clickable URLs (opens in default browser)
- Auto-resize when the panel is resized
- Theme matching the app's current color scheme

**Quick Commands bar (bottom edge):**
A row of configurable command buttons. By default:
- **Build** → runs `pnpm build`
- **Test** → runs `pnpm test`
- **Lint** → runs `pnpm lint`
- **Dev** → runs `pnpm dev`

Each button is a rounded pill with the command label. Hover shows the full command as a tooltip. Clicking sends the command to the active terminal.

**Dev Server Banner (top of terminal area):**
When a dev server is detected running in another session's terminal, a banner appears showing:
- A radio icon (accent color)
- The session name and detected port(s) as clickable links (e.g., ":3000", ":5173")
- Clicking a port opens the URL in your default browser

#### How to Open / Access

- Click the **Terminal** tab in the right panel.
- Press ⌘⇧T to focus the Terminal.

#### User Actions

**Create a new terminal**
Click the **+** button in the terminal tab bar → A new terminal opens with your system shell.

**Switch between terminals**
Click a terminal tab → That terminal becomes visible and focused.

**Close a terminal**
Click the × on a terminal tab → The terminal process is terminated and the tab is removed.

**Run a command**
Type in the terminal and press Enter → The command executes in your project directory.

**Run a quick command**
Click a button in the Quick Commands bar → The command is typed and executed in the active terminal automatically.

**Open a dev server URL**
When the Dev Server Banner shows detected ports, click a port number → The URL opens in your default browser.

**Click a URL in terminal output**
URLs in terminal output are automatically linked. Click one → It opens in your default browser.

#### States

- **No terminals:** The tab bar is empty with just the "+" button.
- **Terminal running:** Green status dot, cursor blinking.
- **Terminal exited:** Red status dot, terminal content preserved for review.
- **Dev server detected:** Banner appears above the terminal showing session name and port(s).

#### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| Terminal shell | Settings → Terminal | Custom shell path (defaults to system shell) |
| Terminal font size | Settings → Terminal | Adjustable independently from the app font size |
| Quick Commands | Settings → Quick Commands | Add, edit, or remove preset terminal commands |

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ T | Focus Terminal |

#### Tips

1. **Customize Quick Commands** in Settings to match your project. Add commands like `pnpm dev`, `cargo test`, `python manage.py runserver`, or any frequently-used commands.
2. **The file tree auto-refreshes** after you press Enter in the terminal — so file changes from terminal commands are reflected in the sidebar within about 2 seconds.
3. **Use multiple terminals** for different tasks — one for the dev server, one for running tests, one for git operations.

---

### Chapter 12: AI Changelog

The AI Changelog automatically generates human-readable summaries of what changed during each coding session. An AI provider (Gemini, OpenAI, or Anthropic) reads the session activity and writes categorized changelog entries.

#### What You See

The Changelog tab in the right panel shows a list of changelog entries for the active session, sorted newest-first.

**Search bar (top, if entries exist):**
A search input with a magnifying glass icon. Placeholder: "Search changelog..."
When filtering, shows a count ("3 of 12") and a clear button (×).

**Changelog cards:**
Each entry shows:
- A **category icon** with color: feature (green), fix (red), refactor (blue), etc.
- A **category badge** (e.g., "Feature", "Fix", "Refactor").
- A **timestamp** (e.g., "2:34 PM").
- A **delete button** (trash icon, visible on hover).
- The **headline** (bold, Markdown-rendered).
- The **description** (Markdown-rendered, dimmer text).
- An **expandable technical details** section: "Show details (N)" toggle revealing a bulleted list of implementation details.
- A **tools summary** line (italic, very small): e.g., "5 edits, 3 reads, 2 bash commands".
- **Files changed** badges: Small monospace pills showing file names, with the full path as a tooltip.

**Generating state:**
When a changelog is being generated, a banner at the top shows a spinning loader with "Generating summary..."

**Empty state:**
When no entries exist, shows a sparkles icon with "No changelog entries yet" and "Enable in Settings to auto-generate summaries of each coding turn."

**No results state:**
When search returns nothing, shows "No entries match your search" with a "Clear search" link.

#### How to Open / Access

- Click the **Changelog** tab in the right panel.
- Press ⌘⇧L to focus the Changelog.

#### User Actions

**Search entries**
Type in the search bar → Entries are filtered in real-time across headline, description, technical details, tools summary, category, and file names.

**Clear search**
Click the × button or the "Clear search" link → Returns to showing all entries.

**Expand technical details**
Click "Show details (N)" on any entry → Reveals a bulleted list of implementation specifics. Click "Hide details" to collapse.

**Delete an entry**
Hover over an entry → Click the trash icon → The entry is removed from the database and the list.

#### States

- **Default (empty):** Sparkles icon + "No changelog entries yet" + hint to enable in Settings.
- **Generating:** Spinning loader + "Generating summary..." at the top.
- **Populated:** Scrollable list of changelog cards with search.
- **Searching:** Count badge showing "N of M" results, clear button visible.
- **No results:** "No entries match your search" with clear link.

#### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| Changelog enabled | Settings → Changelog | Master toggle for auto-generating changelogs |
| Changelog provider | Settings → Changelog | Which AI generates summaries: Gemini, OpenAI, or Anthropic |
| Changelog model | Settings → Changelog | Specific model within the provider |
| Changelog prompt | Settings → Changelog | Custom prompt used to generate summaries |

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ L | Focus Changelog |

#### Tips

1. **Enable changelog in Settings** to automatically get summaries after each coding turn. These are great for writing commit messages or daily standups.
2. **The Project Log** (session sub-tab) aggregates changelogs across all sessions — see Chapter 8 for details.
3. **Search is powerful** — it searches across all fields including file names and technical details.

---

### Chapter 13: Multi-AI Assistants

The Assistant panel lets you chat with additional AI models alongside Claude Code. Unlike Claude Code, assistants are chat-only — they cannot edit files or run commands. Use them for brainstorming, code review, second opinions, or working with different AI providers.

#### What You See

The Assistant panel occupies the **Assistant** tab in the right panel.

**Empty state (no assistants):**
A message icon with "Ask questions about your project, get help with code, or chat with AI." Below it, a list of AI provider buttons to create your first assistant.

**Provider selection (creating a new assistant):**
A list of provider buttons, each showing the provider name. Providers without a configured API key show "No API key" or "No key" and are disabled. Clicking an API provider expands a model selection submenu.

Available providers:
- **Claude Code** — Uses your existing Claude subscription (no API key needed). Badge: "CC" in accent color.
- **OpenAI** — Requires API key from Settings → AI Providers. Badge: "OA" in green.
- **Google Gemini** — Requires API key. Badge: "G" in blue.
- **Anthropic** — Requires API key. Badge: "A" in warm brown.

**Assistant tabs (top, 28px):**
Each assistant tab shows:
- A **status dot**: green (idle) or yellow (busy/generating).
- A **provider badge**: A small colored pill with a 2-letter abbreviation (CC, OA, G, A).
- The **assistant name** (truncated to 60px).
- **Session cost** (if any): tiny text showing the running cost.
- A **close button** (×) on hover.

A **"+"** button to create a new assistant (opens the provider selection menu as a floating popover).

**Capability notice (for API providers):**
When an API provider assistant has no messages yet, a subtle info bar appears: "Chat only — no file access or tool use. Uses your {provider} API key."

**Chat messages area:**
Messages scroll vertically. User messages are right-aligned with accent styling. Assistant messages are left-aligned with an elevated background and a copy button on hover. Markdown is fully rendered with syntax highlighting in code blocks. A thinking indicator (animated dots) appears while the assistant is generating a response.

**Shortcut buttons (above input area):**
If assistant shortcuts are configured in Settings, they appear as rounded pill buttons. Click one to populate the input with that shortcut's prompt.

**Attachment bar:**
When files are attached, they appear above the textarea as chips showing a thumbnail (images) or paperclip icon (documents) with file name and a remove button.

**Input area (bottom):**
- A textarea (4 rows default, max 200px): Placeholder reads "Ask the assistant... (/ for commands)" for Claude Code assistants, or "Ask the assistant..." for API providers.
- A **+ button** (left of Send): Opens a file picker to attach images, documents, or code files.
- A **Send button** (accent color): Sends the message. Replaced by a red **Stop button** (square icon) while the assistant is generating.

**Slash commands (Claude Code assistants only):**
Typing "/" opens a command palette above the input with available commands. Navigate with arrow keys, select with Enter.

**Context menu (right-click a message):**
An **AssistantMessageMenu** appears with options including "Add as Shortcut" — which opens a dialog to save the message text as a named prompt shortcut.

**"Save as Shortcut" dialog:**
- Title: "Save as Shortcut"
- Name input (e.g., "Code Review")
- Prompt preview (truncated to 200 chars)
- Cancel / Save buttons

#### How to Open / Access

- Click the **Assistant** tab in the right panel.
- Assistants are per-session — each session has its own set of assistant tabs.

#### User Actions

**Create an assistant**
Click the **+** button in the assistant tab bar (or click a provider in the empty state) → Select a provider → For API providers, select a model from the submenu → A new assistant tab appears.

**Send a message**
Type in the textarea → Press ⌘Enter → The message is sent and the AI responds with streaming text.

**Send with attachments**
Click the **+** button next to the textarea or drag & drop files → Files appear in the attachment bar → Type an optional message → Press ⌘Enter.

**Paste an image**
Press ⌘V with an image on your clipboard → The image is saved and added to the attachment bar.

**Stop generation**
While the assistant is responding, click the red **Stop** button or press Escape → Generation is interrupted.

**Retry a failed response**
If an error occurs, a Retry button appears on the error message → Click to retry the last request.

**Use a prompt shortcut**
Click a shortcut pill button → The shortcut's prompt text populates the input. Edit if needed, then send.

**Save a message as a shortcut**
Right-click a message → Click "Add as Shortcut" → Enter a name in the dialog → Click Save → The shortcut appears as a pill button above the input in future assistant sessions.

**Use slash commands (Claude Code assistants only)**
Type "/" → The command palette appears. Available commands include `/help`, `/clear`, `/context`, `/cost`, `/exit`, `/rename`, and all skill commands from `.claude/commands/`.

**Close an assistant**
Click the × on an assistant tab → The assistant session ends and the tab is removed.

**Switch between assistants**
Click an assistant tab → That assistant's conversation becomes active.

#### States

- **No project open:** "Open a project to use the assistant"
- **No assistants:** Provider selection buttons with empty-state message.
- **Chat (idle):** Messages displayed, input ready.
- **Chat (busy):** Yellow status dot on tab. Thinking indicator (animated dots) below messages. Stop button replaces Send.
- **Chat (streaming):** AI response appears word by word.
- **API provider info:** Info bar shown for API assistants (no file access or tools).

#### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| API keys | Settings → AI Providers | Required for OpenAI, Gemini, and Anthropic assistants |
| Assistant shortcuts | Settings → Assistant | Named prompt templates shown as pill buttons |
| Default model | Settings → Assistant | Default model for each provider |

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ Enter | Send message |
| Escape | Stop generation |
| / | Open command palette (Claude Code assistants) |

#### Tips

1. **Assistants can't edit files or run commands** — they're chat-only. Use them for brainstorming, code review, or getting a second opinion from a different AI model.
2. **Configure API keys** in Settings → AI Providers to unlock OpenAI, Gemini, and Anthropic assistants.
3. **Save frequently-used prompts as shortcuts** — right-click any message, choose "Add as Shortcut", and it becomes a one-click button above the input.

---

## Part IV: Advanced Features

---

### Chapter 14: SpecWriter — AI-Powered Specifications

SpecWriter is an AI-guided conversation tool that helps you create comprehensive requirements specifications before you start coding. It asks clarifying questions, helps you select features, then writes a detailed spec document that you can save to your project and hand to Claude Code for implementation.

#### What You See

SpecWriter opens as a slide-over panel anchored to the right edge of the screen, covering about 80% of the window width (minimum 600px). It has two columns with a draggable divider between them.

**Header (top bar):**
- Title: **"SpecWriter"**
- **"Suggest Features"** button (visible in Feature mode only, when not streaming)
- **Close button** (×)

**Left column — Chat (default 40% width):**

*Chat header:*
- Label: "SpecWriter Chat"
- Streaming indicator: pulsing dot + "AI is responding..." with elapsed timer (shown after 5 seconds)
- **Model selector** (visible before the first message): dropdown to choose the AI model. Models without API keys show "(no key)" and are disabled.
- **Mode selector** (bottom of chat, before first message): "Mode:" dropdown with two options:
  - "Feature (existing project)" — Adds features to an existing codebase
  - "New Application" — Designs a new app from scratch

*Context loading overlay (Feature mode):*
Before the conversation starts in Feature mode, the AI analyzes your project. An overlay shows "Analyzing project..." with a spinner and a "Skip — start without context" button. A context badge shows status: "scanning...", "error", "loaded", or "—".

*API key warning:*
If the selected model's provider has no API key configured, an amber banner appears: "No API key set for this model's provider." with a link to "Settings → AI Providers."

*Chat messages:*
- **System messages**: Accent-colored rounded boxes with info icon and Markdown content. May include clickable option buttons.
- **User messages**: Right-aligned, accent background, white text.
- **Assistant messages**: Left-aligned, elevated background. Copy button appears on hover. Markdown-rendered with full syntax highlighting.
- **File context messages**: Collapsible cards showing "📂 N file(s) loaded" with expandable list of files, their line counts, and code previews.
- **Selectable options**: When the AI offers choices:
  - For 4+ options: checkboxes for multi-select. Help text: "Select the features to include, then press Send". A "Send N selected" button appears.
  - For fewer options: single-click to answer immediately. Right-click enables multi-select mode. Help text: "Click to answer · Right-click to multi-select"

*Chat input (bottom):*
- **Paperclip button** (left): Attach images or documents (accepts images, PDF, TXT, MD, DOCX).
- **Textarea**: Placeholder "Describe what you want to build..." (6 rows, max 250px). Disabled during streaming.
- **Send/Stop button** (right): Send icon when idle, red Stop icon when streaming.
- Help text: "Cmd+Enter to send"

*Drag & drop:* Drag files over the input area to attach them (accent ring highlight on drag-over).

**Right column — Spec Preview (default 60% width):**

*Empty state:* A notepad icon with "Spec Preview" title and text: "Start a conversation on the left to create your requirements specification."

*Tab bar (when both spec and audit exist):*
- "Specification" tab
- "Verification Audit" tab

*Preview mode (default):*
Rendered Markdown of the specification document. Auto-scrolls to bottom during streaming.

*Edit mode:*
A textarea with monospace font showing the raw Markdown source. Click "Edit" to switch, "Preview" to switch back.

**Action buttons (when spec content exists):**
- **Edit / Preview** toggle
- **Save to Project** (primary)
- **Copy to Clipboard**

**Integration section (after saving):**
An accent-colored banner showing: `Add to CLAUDE.md: Read docs/specs/{filename} for implementation`
With a copy button, plus:
- **"Send to Chat"** button (secondary)
- **"Implement"** button (primary accent) — sends a full implementation request to the active Claude Code session.

**Bottom Toolbar (SpecToolbar):**
- **Reset** (refresh icon): Clears the entire conversation. Visible when messages exist.
- **Generate Spec** (pen icon): Tells the AI to write the spec now. Enabled when the conversation reaches "ready to write" status.
- **Save to Project**: Opens the save dialog. Visible when spec content exists.
- **Generate Audit** (clipboard icon): Generates a Verification Audit companion document. Enabled when a spec exists but no audit yet.
- **Save Audit** (clipboard icon): Saves the audit document. Visible when audit content exists.

**Save dialog:**
- Title: "Save Specification" or "Save Verification Audit"
- Filename input with placeholder "my-spec.md" or "my-feature.audit.md"
- Help text: "Saves to: docs/specs/{filename}"
- If file exists: amber warning with "Overwrite" and "Save as {filename}-v2.md" options.
- Cancel / Save buttons.

**Saved Specs list (collapsible panel):**
- Header: "Saved Specs (N)" with collapse toggle
- Each spec: file icon, title, filename, modification date, hover buttons for "Load into conversation" (upload icon) and Delete (trash icon with confirm step).

**SpecWriter Badge (in title bar):**
A small badge next to the pen icon showing: "In progress", "Spec ready", "Writing..." (pulsing), or "Done".

#### How to Open / Access

- Click the **pen icon** in the title bar.
- Press ⌘⇧B to toggle the SpecWriter slide-over.

#### User Actions

**Start a new spec conversation**
Open SpecWriter → Select a mode (Feature or New Application) → Optionally select a model → Type a description of what you want to build → Press ⌘Enter.

**Answer the AI's questions**
Click an option button to answer a single question, or use checkboxes to select multiple features → Click "Send N selected".

**Generate the specification**
When the conversation reaches the "ready to write" stage, click **Generate Spec** in the toolbar or the button that appears in the chat → The AI writes a full specification document that streams into the right preview pane.

**Edit the spec**
Click **Edit** to switch to raw Markdown editing mode → Make your changes → Click **Preview** to see the rendered result.

**Save the spec**
Click **Save to Project** → Enter a filename → Click Save → The spec is saved to `docs/specs/{filename}` in your project.

**Generate a Verification Audit**
After saving a spec, click **Generate Audit** → The AI creates a companion audit document checking the spec for completeness and consistency.

**Send spec to Claude Code for implementation**
After saving, click **"Implement"** in the integration section → A message is sent to your active Claude Code session asking it to implement the spec.

**Reset the conversation**
Click **Reset** in the toolbar → The conversation is cleared and you can start over.

**Load a saved spec**
In the Saved Specs list, click a spec to load its content into the preview. Click the upload icon to load it back into the conversation for revision.

**Resize the chat/preview columns**
Drag the divider between the chat and preview columns → Adjustable from 25% to 65% chat width.

#### States

- **Closed:** The slide-over is hidden. The SpecWriter Badge may show status in the title bar.
- **Loading context (Feature mode):** "Analyzing project..." overlay with spinner.
- **Conversation (gathering):** Chat active, AI asking questions, spec preview empty.
- **Ready to write:** "Generate Spec" button becomes enabled. Badge shows "Spec ready".
- **Writing:** Spec streams into the preview pane. Badge shows "Writing..." (pulsing).
- **Done:** Spec complete. Action buttons (Edit, Save, Copy) appear. Badge shows "Done".
- **Audit ready:** After spec is saved, "Generate Audit" button is enabled.

#### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| API keys | Settings → AI Providers | Required for all SpecWriter AI models |

SpecWriter uses the same API keys configured in Settings → AI Providers. It supports models from OpenAI, Google Gemini, and Anthropic.

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ B | Toggle SpecWriter slide-over |
| ⌘ Enter | Send message in SpecWriter chat |
| Escape | Close SpecWriter |

#### Tips

1. **Start with Feature mode** for existing projects — the AI automatically reads your CLAUDE.md, file tree, dependencies, routes, components, and recent git history to understand your codebase.
2. **Use "Implement"** after saving your spec. This sends a message to Claude Code saying "Read docs/specs/{filename} and implement it" — bridging the gap between specification and code.
3. **The Verification Audit** acts as a QA checklist. It cross-references the spec against itself to catch inconsistencies, missing edge cases, and ambiguous requirements.

---

### Chapter 15: Project Templates

Project Templates let you scaffold new projects from popular frameworks and boilerplate repositories. CodeMantis handles the entire setup — cloning, cleaning, installing dependencies, generating a CLAUDE.md file, and initializing git.

#### What You See

The Template Picker is embedded in the Project Picker modal (accessible via ⌘⇧N or the + button in the title bar) under the **Templates** tab.

**Search bar (top):**
A text input with placeholder "Search templates..." Auto-focused on open. Filters templates by name, description, and tags in real-time.

**Category filter pills:**
A row of buttons: **All**, **Frontend**, **Full-Stack**, **Backend**, **Static**, **Mobile**. Active category is highlighted in accent color.

**Template grid (2 columns):**
Each template card shows:
- An **icon** (Zap, Component, Triangle, etc.) in a rounded container.
- The **template name** (bold).
- A **description** (2-line max, truncated).
- **Tags** (max 3 visible, e.g., "React", "TypeScript", "Tailwind"). Overflow shown as "+N".
- **Footer**: Star count (formatted as "1.2K" for thousands), license name, and scaffold type badge ("git-clone" or "cli").

**Template detail view (after clicking a card):**
- **Back button**: "← Back to templates"
- Full icon, name, star count, and license.
- All tags (no limit).
- Full description (uses `long_description` if available).
- **Prerequisites section** (if template has checks): Each prerequisite with a status icon (✓ green / ✗ red), a label, a "required" or "optional" badge, and an Install button for missing prerequisites. A Re-check button refreshes the status.
- **Project name input**: Pre-filled with a slugified version of the template name. Validates for valid characters (letters, numbers, hyphens, underscores, dots).
- **Location button**: Opens a macOS folder picker. Shows the selected path or "Choose a folder..." Remembers the last-used directory.
- **"View on GitHub"** link (if the template has a repo URL).
- **"Use This Template"** button: Primary accent, disabled if required prerequisites are missing.

**Scaffold progress view:**
After clicking "Use This Template":
- Title: "Setting up: {projectName}" with "This may take a minute..." subtitle.
- **Step progress list**: Each step shows a status icon (empty circle → spinning loader → green checkmark → red ✗) and a label. For git-clone templates, steps include: Clone Repository, Clean Up, Install Dependencies, Generate CLAUDE.md, Initialize Git. For CLI templates: Run CLI Scaffold, Post Setup, Install Dependencies, Generate CLAUDE.md, Initialize Git.
- **Error handling**: If a step fails, the error message appears in red below the step with a collapsible "Show output" section containing the full error. A "Fix with Claude" button opens a mini-chat assistant to help debug the issue.
- **Warnings summary**: If warnings occurred, an amber box shows them.
- **Action buttons**:
  - On success: **"Open in CodeMantis"** (primary accent).
  - On error with partial result: **"Open Anyway"** (secondary) + **"Retry"** (primary) + **"Cancel"**.
  - During progress: **"Cancel"**.

**All available templates:**

| Name | Category | Description | Type |
|------|----------|-------------|------|
| React + Vite Boilerplate | Frontend | React + Vite with TanStack Router, Zustand, Vitest, Playwright, Tailwind | git-clone |
| React + Vite + shadcn/ui | Frontend | Minimal React + Vite + shadcn/ui | cli |
| Next.js Boilerplate | Full-Stack | Next.js 16 + Drizzle + Clerk | git-clone |
| Next.js SaaS | Full-Stack | Next.js SaaS with Stripe, multi-tenancy | git-clone |
| next-forge | Full-Stack | Monorepo with Turborepo + Prisma + Stripe | cli |
| FastAPI Full-Stack | Full-Stack | Official FastAPI + React + PostgreSQL + Docker | git-clone |
| FastAPI Boilerplate | Backend | FastAPI + SQLAlchemy + Redis | git-clone |
| Astro Starter | Static | Astro static site | cli |
| Expo Starter | Mobile | Expo React Native app | cli |
| Nextplate | Static | Next.js website + blog with MDX | git-clone |
| Fumadocs | Static | Next.js docs framework with MDX | cli |

#### How to Open / Access

- Press ⌘⇧N or click the **+** icon in the title bar.
- The Templates tab is the default view in the Project Picker.

#### User Actions

**Browse templates**
Scroll through the 2-column grid → Click a card to see its full details.

**Search templates**
Type in the search bar → Templates are filtered by name, description, and tags.

**Filter by category**
Click a category pill (Frontend, Full-Stack, Backend, Static, Mobile) → Only matching templates are shown. Click "All" to reset.

**Scaffold a project**
Click a template card → Review the detail view → Enter a project name → Choose a location → Click **"Use This Template"** → Watch the progress steps complete → Click **"Open in CodeMantis"** to start working.

**Check prerequisites**
In the detail view, review the prerequisites list → Missing prerequisites show an **Install** button → Click to install (e.g., runs `npm install -g pnpm`). Click **Re-check** to refresh.

**Handle scaffold errors**
If a step fails, click **"Fix with Claude"** → A mini-chat opens where you can ask Claude for help debugging the issue. After fixing, click **"Continue Setup"** to resume.

#### States

- **Grid view:** Template cards in a 2-column grid.
- **Detail view:** Full template information with configuration form.
- **Progress view:** Step-by-step scaffold progress with animated status icons.
- **Success:** "Project ready!" with "Open in CodeMantis" button.
- **Error:** Red error message with "Show output" collapsible, "Fix with Claude" button, and Retry/Open Anyway options.
- **Prerequisites missing:** "Use This Template" button is disabled until required prerequisites are satisfied.

#### Configuration

No dedicated settings. Template data is bundled with the app in `src-tauri/resources/templates.json`.

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ N | Open Template Picker |

#### Tips

1. **CLAUDE.md is auto-generated** for every scaffolded project. It tells Claude Code about your project's structure, commands, and coding conventions — giving it the context it needs from the first message.
2. **Use the "Fix with Claude" button** if a scaffold step fails. The built-in assistant can often diagnose missing dependencies or permission issues.
3. **The location picker remembers your last-used directory**, so you don't have to navigate to your projects folder every time.

---

### Chapter 16: Preview Browser

The Preview Browser lets you view your running web application in a native window alongside CodeMantis. It auto-detects dev servers, supports viewport presets, captures console logs, and can screenshot your app directly into the Claude conversation.

#### What You See

The Preview Browser opens as a **separate native window** (not inside the right panel). It shows your running web application.

**Title bar integration (main CodeMantis window):**
- **Globe icon** in the title bar: Click to start the dev server and open the preview, or to focus the preview if already open.
- **Camera icon** (only visible when the preview is open): Click to screenshot the preview and add it as a chat attachment.

**Dev Server Banner (in the Terminal tab):**
When a dev server is detected running in another session's terminal, a banner with a radio icon shows the session name and clickable port numbers.

**Dev server states:**
The dev server goes through a lifecycle:
1. **Idle** — No dev server running.
2. **Starting** — The dev server command has been launched.
3. **Scanning** — CodeMantis is detecting the port.
4. **Running** — Dev server is active. The preview window opens automatically.
5. **Error** — The dev server failed to start. An error message is shown.

**Console log capture:**
Console errors and warnings from the preview are surfaced in the Activity Feed (see Chapter 9). Errors also trigger toast notifications: "Preview error: {message}".

#### How to Open / Access

- Click the **globe icon** in the title bar.
- Press ⌘⇧P to toggle the preview window.

#### User Actions

**Start the dev server and open preview**
Click the globe icon → If no dev server is running, CodeMantis starts one (using the project's dev command). Once the server is ready, the preview window opens automatically.

**Focus the preview window**
If the preview is already open, click the globe icon → The preview window comes to the front.

**Screenshot to chat**
Click the **camera icon** in the title bar → A screenshot of the preview is captured and added as an attachment to your current chat session. A toast confirms: "Screenshot added to chat."

**Refresh the preview**
Press ⌘R when the preview window is focused → The page reloads.

**Toggle the console drawer**
Press ⌘⇧C when the preview window is focused → Shows/hides the console log drawer.

**Close the preview**
Close the preview window → The dev server is automatically stopped and the camera icon disappears from the title bar.

#### States

- **Idle:** Globe icon shows in the title bar. No preview window.
- **Starting:** Toast: "Dev server is starting..." Globe icon available.
- **Scanning:** CodeMantis is detecting the dev server port.
- **Running:** Preview window open. Camera icon appears in the title bar.
- **Error:** Toast with error message (e.g., "Failed to start dev server").

#### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| Default preview width | Settings (internal) | Default viewport width (1024px) |
| Default preview height | Settings (internal) | Default viewport height (768px) |
| Auto-start preview | Settings (internal) | Whether to auto-start the dev server |
| Custom dev command | Settings (internal) | Override the detected dev command |
| Console auto-open | Settings (internal) | Auto-open the console drawer |

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ P | Toggle Preview Window |
| ⌘ R | Refresh preview (when focused) |
| ⌘ ⇧ C | Toggle Console Drawer (when focused) |

#### Tips

1. **Screenshot + chat is powerful.** Click the camera icon to capture your app, then ask Claude "fix this layout issue" — Claude sees exactly what you see.
2. **Console errors automatically appear** in the Activity Feed and as toast notifications, so you'll catch runtime errors even when the preview window isn't focused.
3. **The dev server auto-stops** when you close the preview window, keeping your system clean.

---

### Chapter 17: MCP Server Management

MCP (Model Context Protocol) servers extend Claude's capabilities by connecting it to external services — databases, APIs, browsers, documentation providers, and more. CodeMantis provides a visual interface for adding, configuring, and managing MCP servers.

#### What You See

The MCP modal is a full-height dialog with three views:

**Server list (default view):**

*Toolbar:*
- Scope filter buttons: **All**, **Global**, **Project** (project option only visible when a project is open). Active scope highlighted in accent.
- **"Add Server"** button (+ icon, accent color).

*Server list:*
Each server entry shows:
- **Server name** (monospace, bold).
- **Type badge**: "stdio" (blue), "http" (green), or "sse" (purple) in a small colored pill.
- **Scope badge**: "Global" (dim) or "Project" (accent).
- **Edit button** (pencil icon, on hover).
- **Delete button** (trash icon, on hover) → Reveals "Delete" / "Cancel" confirmation buttons.
- **Summary line** (monospace, dimmed): The command and args for stdio, or URL for http/sse.
- **Environment variables** (if any): Small chips showing `KEY=•••••` with an eye toggle to reveal/hide the value.

*Footer:*
Shows the file paths for configuration: global at `~/.claude.json` and project at `.mcp.json`.

**Template picker (when adding a server):**

*Header:* "Add MCP Server" with subtitle "Choose a template or configure manually."

*Categories with templates:*

**No Setup Required** (ready to use, no API key needed):
| Template | Icon | Type | Description |
|----------|------|------|-------------|
| Context7 | 📚 | stdio | Documentation lookup for any library |
| Playwright | 🎭 | stdio | Browser automation and testing |
| BrowserMCP | 🌐 | stdio | Chrome extension-based browser control |
| Fetch | 📥 | stdio | Fetch web content as Markdown |
| Filesystem | 📁 | stdio | Read/write files outside project |
| Memory | 🧠 | stdio | Persistent knowledge graph storage |

**Requires API Key:**
| Template | Icon | Type | Description |
|----------|------|------|-------------|
| Brave Search | 🦁 | stdio | Web search via Brave API |
| Stripe | 💳 | stdio | Stripe API management |

**Cloud Services** (HTTP-based, often OAuth):
| Template | Icon | Type | Description |
|----------|------|------|-------------|
| Supabase | ⚡ | http | Database and auth management |
| Sentry | 🐛 | http | Error tracking |
| Neon | 🟢 | http | Serverless Postgres |
| Cloudflare | ☁️ | http | Workers, Pages, DNS management |

*Manual Configuration button:* Dashed border, wrench icon, "Start with a blank form."

**Server form (adding or editing):**

*Fields:*
- **Name**: Text input (disabled when editing). Validated for letters, numbers, hyphens, underscores. Must be unique within scope.
- **Scope**: Radio buttons — Global (`~/.claude.json`) or Project (`.mcp.json`). Disabled when editing.
- **Type**: Dropdown — stdio, http, or sse. Each shows a description:
  - stdio: "Runs a local process on your machine. Communicates via stdin/stdout."
  - http: "Connects to a remote HTTP endpoint. Used for cloud-hosted MCP servers."
  - sse: "Server-Sent Events (legacy). Prefer HTTP for new servers."

*Type-specific fields:*
- **stdio**: Command input ("npx"), Arguments input (comma-separated), Environment Variables (key-value rows with masking).
- **http**: URL input, Headers (key-value rows with masking).
- **sse**: URL input, Headers (key-value rows with masking).

*Setup hint:* If the template provides a hint, it appears in an info box at the top of the form.

*Actions:* "Show config file" link, Cancel button, Save/Add button (disabled until validation passes).

**Config file editor:**
A full Monaco editor showing the raw JSON configuration file. Title shows the file path. Cancel / Save buttons at the bottom.

#### How to Open / Access

- Click the **blocks icon** in the title bar.
- Press ⌘⇧M.

#### User Actions

**Add a server from a template**
Click **"Add Server"** → Browse templates → Click a template card → The form opens pre-filled with the template's configuration. Fill in any required fields (API keys, custom paths) → Click **Add**.

**Add a server manually**
Click **"Add Server"** → Click **"Manual Configuration"** → Fill in name, scope, type, and type-specific fields → Click **Add**.

**Edit a server**
Hover over a server entry → Click the pencil icon → The form opens with current values. Modify fields → Click **Save**.

**Delete a server**
Hover over a server entry → Click the trash icon → "Delete" / "Cancel" buttons appear → Click **Delete** to confirm.

**Toggle environment variable visibility**
On a server entry with environment variables, click the eye icon → Values toggle between `•••••` and the actual value.

**Filter servers by scope**
Click **All**, **Global**, or **Project** in the scope filter → Only matching servers are shown.

**Edit the raw config file**
In the server form, click **"Show config file"** → A Monaco editor opens with the full JSON configuration. Edit directly → Click **Save** to write the file.

#### States

- **Default (no servers):** "No servers" message.
- **Loading:** "Loading..." indicator.
- **Error:** Red error message box below the toolbar.
- **Server list:** Cards for each configured server.
- **Template picker:** Grid of template cards grouped by category.
- **Server form:** Full configuration form.
- **Config editor:** Monaco editor with JSON.

#### Configuration

MCP server configurations are stored in two locations:
- **Global:** `~/.claude.json` (available in all projects)
- **Project:** `.mcp.json` in the project root (only for that project)

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ M | Open MCP Servers modal |

#### Tips

1. **Start with "No Setup Required" templates** like Context7 (documentation lookup) and Playwright (browser automation) — they work immediately with no API keys.
2. **Use Project scope** for project-specific servers (like a Supabase connection) and **Global scope** for general-purpose servers (like Fetch or Memory) that you want available everywhere.
3. **The config file editor** is useful for advanced users who want to fine-tune JSON configuration or copy configurations between projects.

---

### Chapter 18: Slash Commands & CLI Overlay

Slash commands give you quick access to actions and workflows by typing "/" in the input area. Some commands run instantly, some expand into prompts, and some open the Claude CLI directly.

#### What You See

**Command Palette (appears above the input area):**
When you type "/" at the start of a line, a floating dropdown appears with a searchable list of available commands. Each command shows:
- The command name in monospace accent color (e.g., `/commit`, `/review`).
- A description.
- An argument hint when the command is selected (e.g., `<new name>` for `/rename`).
- A **category badge**:
  - **Skill** (accent color): Custom commands from `.claude/commands/` that expand into prompts.
  - **Built-in** (dim): Native commands executed instantly by CodeMantis.
  - **Opens CLI** (yellow, "Opens CLI"): Commands passed to the Claude CLI terminal.

Navigation: Arrow keys to move, Enter to select, Escape to close, Tab to autocomplete.

**CLI Overlay (full interactive Claude CLI terminal):**
A centered modal window (up to 900px wide × 600px tall) containing a full xterm.js terminal running the Claude CLI interactively. This is used for commands that require the full Claude CLI interface.

*Header:*
- Terminal icon + "Claude CLI" title
- Hint text: "— /model, /config, /doctor, /help"
- "Esc to close" label
- Close button (×)

#### How to Open / Access

- Type **/** at the beginning of the input area → Command Palette opens.
- Press **⌘/** → Opens the Command Palette (alternative shortcut).
- Select a CLI-only command → CLI Overlay opens automatically.

#### User Actions

**Open the Command Palette**
Type "/" in the input area → The palette appears. Start typing to filter commands by name or description.

**Execute a built-in command**
Type "/" → Select a built-in command → It executes immediately:

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation and restart the session |
| `/compact` | Compact conversation context (reduce token usage) |
| `/context` | Show context window usage (tokens used / max) |
| `/cost` | Show session cost and token stats |
| `/exit` | Close the current session |
| `/help` | Show available commands |
| `/rename <name>` | Rename the current session |

**Execute a skill command**
Type "/" → Select a skill command → The skill's template is expanded with project context and sent as a message to Claude. Skills come from `.claude/commands/` in your project or home directory.

**Open the CLI Overlay**
Type "/" → Select a CLI-only command (yellow "Opens CLI" badge) → The CLI Overlay opens. Available CLI commands include `/model`, `/config`, `/doctor`, `/mcp`, `/hooks`, `/theme`, and others.

**Use the CLI Overlay**
The overlay pauses the normal stream-json session and opens an interactive Claude CLI terminal. You can:
- Change models with `/model`
- View and edit configuration with `/config`
- Run diagnostics with `/doctor`
- Manage MCP servers with `/mcp`
- View and manage hooks with `/hooks`

**Close the CLI Overlay**
Press Escape or click the × button → The overlay closes, the interactive CLI exits, and the normal stream-json session resumes.

**Use slash commands in assistant tabs**
Claude Code assistant tabs also support slash commands. Type "/" in the assistant input to open the command palette. Supported commands include `/help`, `/clear`, `/context`, `/cost`, `/exit`, and `/rename`.

#### States

- **Command Palette loading:** "Loading commands..." while the command list is being discovered.
- **No results:** "No commands matching '/{query}'" when the search returns nothing.
- **CLI Overlay loading:** "Pausing session and starting Claude CLI..." while the overlay initializes.
- **CLI Overlay error:** "Failed to start Claude CLI" with error message.
- **CLI Overlay ready:** Full terminal visible and interactive.

#### Configuration

Skill commands are discovered automatically from:
- `.claude/commands/` in your project directory
- `.claude/commands/` in your home directory

Each `.md` file in these directories becomes a slash command. The file name becomes the command name, and the file content becomes the prompt template.

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| / | Open Command Palette (when typed at start of input) |
| ⌘ / | Open CLI Overlay |
| Arrow keys | Navigate Command Palette |
| Enter | Select command |
| Tab | Autocomplete command |
| Escape | Close Command Palette or CLI Overlay |

#### Tips

1. **Create custom skill commands** by adding `.md` files to `.claude/commands/` in your project. For example, `review.md` with a code review prompt becomes the `/review` command.
2. **Use `/compact` when context is running high** — it reduces token usage by compacting the conversation history, letting you continue longer without starting a new session.
3. **The CLI Overlay is temporary** — it pauses your normal session, lets you use interactive CLI features, then resumes exactly where you left off. No work is lost.
