<!-- CodeMantis Complete User Guide — Part III (Chapters 10-14) -->
<!-- Generated from source code | App Version: 0.9.1 | Date: 2026-03-26 -->

# Part III: The Right Panel

The Right Panel is the operational hub of CodeMantis. It sits on the right side of the application window and provides five permanent tabs -- Activity, Terminal, Files, Changelog, and Assistant -- plus an optional Guide tab when a guide is loaded. Each tab serves a distinct function: monitoring what Claude is doing, running shell commands, viewing and editing files, tracking changes, and chatting with multiple AI providers simultaneously.

The Right Panel tab bar runs across the top. Each tab displays an icon and a label; when the panel is too narrow to fit all labels, it automatically collapses to icon-only mode for inactive tabs while keeping the label visible on the active tab.

---

## Chapter 10: Activity Feed

The Activity Feed is a real-time, reverse-chronological log of every tool operation Claude performs during your session. While the Chat Panel shows conversational text, the Activity Feed shows the mechanics -- every file read, write, edit, bash command, search, and sub-agent task. It is the primary window into what Claude Code is actually doing behind the scenes.

### What You See

The Activity Feed occupies the first tab of the Right Panel, marked with a pulse/activity icon and labeled "Activity." The feed is a vertical timeline with each entry displayed as a row containing:

- **Timeline dot and line:** A small colored dot on the left, connected by a thin vertical line to the next entry. The dot pulses with an animation when the operation is still running.
- **Tool Badge:** A compact 24x18 pixel monospace label showing a two-letter code identifying the tool type. Each badge has a distinct color:

| Badge | Label | Tool Type | Color |
|-------|-------|-----------|-------|
| RE | Read | File reads (Read, Glob, Grep) | Blue |
| WR | Write | File writes (Write, NotebookEdit) | Green |
| ED | Edit | File edits (Edit) | Yellow |
| BA | Bash | Shell commands (Bash) | Purple |
| TD | Task | Task/Todo operations (TodoWrite, TodoRead, etc.) | Blue |
| SR | Search | Search tools (ToolSearch, WebSearch, WebFetch) | Purple |
| AG | Agent | Sub-agent tasks (Agent) | Green |
| Q? | Question | User questions (AskUserQuestion) | Accent (purple) |
| MC | MCP | MCP server tools (mcp__*) | Purple |
| EX | Other | Any unrecognized tool | Gray |

- **Tool name:** Displayed next to the badge. For MCP tools, the raw name `mcp__server__tool` is formatted as "server: tool." The `AskUserQuestion` tool displays as "User Question."
- **Approval badge:** If the tool required approval, a small colored pill appears: green "APPROVED," red "DENIED," or yellow "PENDING."
- **Sub-agent label:** If the operation was performed by a sub-agent, a green pill shows the sub-agent's description.
- **Agent statistics:** For completed Agent (sub-agent) entries, small gray pills show the total number of tool uses and token count (formatted as "1.2K tokens" when over 1000).
- **Session label:** In Project scope mode, when entries come from multiple sessions, a gray pill shows which session the entry belongs to.
- **Preview console button:** For `preview_console` entries, a small "Send to chat" button (speech bubble icon) appears on the right. Clicking it formats the console output and places it in the chat input.
- **Timestamp:** Shown at the far right in HH:MM:SS format.
- **Input summary:** Below the header row, a monospace line shows the key input -- file path for file operations, command for bash, pattern for searches, or question text for user questions. Agent entries show a formatted description with optional type tag and background indicator. This line is capped at 3 lines with ellipsis.
- **Result preview:** For completed operations, a faint line shows the result text (capped at 3 lines). For errors, this text appears in red. For answered questions, it shows "Answer: ..." in accent color.

Above the feed, you see a small toolbar area with:

- **Reasoning toggle:** A button with a brain icon labeled "Reasoning." When active, it splits the panel vertically -- the top third shows Claude Code's extended thinking content in real time, and the bottom two-thirds show the activity entries.
- **Scope toggle:** A button with a layers icon showing either "Session" or "Project." This controls whether the feed shows entries from only the active session or from all sessions (and assistants) in the current project.

### How to Open / Access

- Click the **Activity** tab in the Right Panel tab bar (first tab, pulse icon).
- Press **Cmd+Shift+A** to focus the Activity Feed directly from anywhere in the app.
- The Activity Feed updates automatically as Claude works; no action is needed to start it.

### User Actions

**View activity detail**
Click any entry in the feed. The Activity Detail Panel slides in from the right, overlaying the feed. This full-screen detail view shows:
- Header with back arrow, tool badge, tool name, status dot, duration (e.g., "1.2s"), and timestamp.
- Sub-agent attribution bar if applicable, showing which sub-agent performed the operation.
- Input section: a bordered table listing all input parameters with keys on the left and values on the right. File paths, commands, patterns, and regex values are displayed in monospace.
- Changes section (Edit tool only): a Monaco diff editor showing old vs. new content in inline diff mode.
- Written Content section (Write tool only): the full content that was written, in a scrollable monospace block.
- Result section: the full result output in a scrollable monospace block.
- Error section: if the operation errored, shown in red with a red border.
- Answer section: for question tools, the user's answer displayed in accent color.
- Footer: if the entry involves a file, an "Open in File Viewer" button (or "Open Diff in File Viewer" for edits) lets you jump to the Files tab with the relevant content loaded.

Press **Escape** or click the back arrow to dismiss the detail panel.

**Toggle reasoning panel**
Click the **Reasoning** button (brain icon) at the top of the feed. When active, the top third of the Activity Feed area shows Claude Code's extended thinking content. The reasoning text updates in real time during streaming. When no reasoning is available, it shows "No reasoning yet."

**Switch scope**
Click the **Session/Project** toggle button. In Session mode, only entries from the active session appear. In Project mode, entries from all sessions and assistant tabs in the current project are merged and sorted by timestamp. When there are two or more sources, each entry gets a session label pill so you can tell which session generated it.

**Handle tool approvals**
When Claude wants to use a tool that requires approval, an "Approve Tool?" modal appears automatically. The modal shows:
- Tool name with its badge and a JSON preview of the input parameters.
- **Approve** button (also triggered by pressing **Enter**).
- **Deny** button (also triggered by pressing **Escape**).
- **Approve all (N)** button when multiple approvals are queued (also triggered by **Cmd+A**).
- **Always allow [tool] in this session** link at the bottom left, which auto-approves all future uses of that tool for the remainder of the session.
- Queue navigation arrows (**Left/Right arrow keys**) when multiple approvals are pending, with a "1/3" counter.

After you approve or deny, the decision is recorded on the activity entry as a colored badge.

**Always Allow a tool**
In the Approve Tool modal, click the "Always allow [ToolName] in this session" link. All future uses of that tool in the current session will be automatically approved without showing the modal. This resets when you use `/clear` or start a new session.

### States

- **Default:** Shows the activity timeline with entries sorted newest-first. The Reasoning panel is hidden. Scope defaults to Session.
- **Loading (incremental):** Entries load in batches of 30. When you scroll near the bottom, the next batch loads automatically via an intersection observer. Maximum 500 entries per session.
- **Empty:** Centered text reads "No activity yet." The Reasoning toggle and Scope toggle remain visible.
- **Detail view:** The Activity Detail Panel slides in as a full overlay with a "Back (Escape)" button and contextual sections based on the tool type.
- **Error entries:** Shown with red result text. The status dot inherits the tool's color but does not pulse.

### Configuration

- **Settings -> General -> Font Size:** Affects the text size throughout the Activity Feed and Detail Panel. The Monaco diff editor in the detail view uses font size minus 1.
- **Settings -> General -> Theme:** The Activity Feed inherits the app theme. The Monaco diff editor in the detail view uses the matched CodeMantis editor theme.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+A | Focus Activity Feed tab |
| Escape | Dismiss Activity Detail Panel |
| Enter | Approve tool (in approval modal) |
| Escape | Deny tool (in approval modal) |
| Left/Right arrows | Navigate approval queue |
| Cmd+A | Approve all queued tools |

### Tips

- Use the **Project** scope toggle to monitor all sessions at once when you have multiple chat tabs open for the same project. This is especially useful for tracking what assistant tabs and sub-agents are doing across the board.
- Click on an Edit activity entry to see a full inline diff view of the changes. If you want a richer view, click "Open Diff in File Viewer" at the bottom of the detail panel to see it in the Files tab with side-by-side mode available.
- The Reasoning panel is invaluable during complex tasks. Toggle it on to watch Claude Code think through its approach before it starts making changes.

---

## Chapter 11: File Viewer & Editor

The File Viewer is a built-in code editor and diff viewer powered by Monaco (the same engine behind VS Code). It lets you browse, view, edit, and save project files without leaving CodeMantis. Files open automatically when Claude edits them, and you can open files manually from the sidebar's file tree.

### What You See

The File Viewer tab shows the file code icon and is labeled "Files" in the Right Panel tab bar. Its layout has three sections:

**Tab bar:** A horizontal row of open file tabs at the very top. Each tab shows the file name, a dot indicator if the file has unsaved changes, and an X close button that appears on hover. Clicking a tab switches to that file. Tabs are scrollable horizontally when many files are open.

**File header toolbar:** Below the tab bar, a row displays:
- A file icon and the active file's name (with a dot if dirty/unsaved).
- The file extension in a small gray badge (e.g., ".tsx").
- For diff views: a green "+N" and red "-N" count showing lines added and removed.
- For normal views: the file size (e.g., "12.3 KB").
- Toolbar buttons on the right:
  - **Save** (disk icon): Appears only when the file has unsaved changes. Also accessible with Cmd+S.
  - **Diff toggle** (left-right arrow icon): Appears when the file was opened from an edit activity and has old/new content available. Toggles between normal editor view and diff view. Highlighted in accent color when diff mode is active.
  - **Word wrap** (wrap icon): Toggles word wrapping on/off. Highlighted in accent color when enabled (on by default).
  - **Side-by-side** (columns icon): Appears only in diff mode. Toggles between unified inline diff and side-by-side split diff view.

**Editor area:** The main body of the panel. Uses Monaco Editor with:
- Syntax highlighting for 50+ languages (TypeScript, JavaScript, Rust, Python, Go, Java, Ruby, Swift, Kotlin, C/C++, C#, HTML, CSS, SCSS, SQL, YAML, TOML, Markdown, Shell, Lua, PHP, Perl, Dart, Dockerfile, GraphQL, Protobuf, R, HCL/Terraform, and more).
- Line numbers on the left.
- Code folding support.
- Theme-aware coloring that matches the app's selected theme.
- Scrollbar with thin 6px tracks.

In **diff mode**, the editor switches to Monaco's DiffEditor component, showing the old content on the left (or as removed lines in inline mode) and new content on the right (or as added lines). Added lines have a green background, removed lines have a red background.

### How to Open / Access

- Click the **Files** tab in the Right Panel tab bar (third tab, code file icon).
- Press **Cmd+Shift+F** to focus the File Viewer directly.
- **From the sidebar file tree:** Click any file to open it in the File Viewer. The right panel automatically switches to the Files tab.
- **From the Activity Feed:** Click an activity entry, then click "Open in File Viewer" or "Open Diff in File Viewer" at the bottom of the detail panel.
- **Auto-open:** When Claude edits a file, it automatically opens in the File Viewer as a diff tab showing old vs. new content.
- **Image files:** When you click an image file (PNG, JPG, GIF, WebP, SVG, ICO, BMP), it opens in a modal image preview instead of the Monaco editor.

### User Actions

**Open a file from the file tree**
Click any file in the sidebar's file tree. The file opens as a new tab in the File Viewer (or focuses the existing tab if already open). The right panel switches to the Files tab automatically.

**Browse files with the context menu**
Right-click a file or folder in the file tree to open the context menu. Available actions differ by target:

*File context menu:*
- **New File** -- Creates a new file in the same directory (inline name input appears).
- **New Folder** -- Creates a new folder in the same directory.
- **Add to Main Chat** -- Attaches the file to the main chat's input as a file attachment.
- **Add to Assistant** -- Expandable submenu listing all assistant tabs; click one to attach the file there.
- **Add Relative Path to Chat** -- Inserts the file's relative path into the chat input.
- **Add Absolute Path to Chat** -- Inserts the file's absolute path into the chat input.
- **Open** -- Opens the file in the File Viewer.
- **Duplicate** -- Creates a copy of the file in the same directory.
- **Rename** -- Activates inline rename mode (the file name becomes an editable text field; press Enter to confirm, Escape to cancel).
- **Delete** -- Deletes the file after a confirmation dialog. This cannot be undone.
- **Reveal in Finder** -- Opens the containing folder in macOS Finder with the file selected.
- **Copy Contents** -- Copies the file's text content to the clipboard.
- **Copy Path** -- Copies the absolute file path to the clipboard.
- **Copy Relative Path** -- Copies the path relative to the project root.
- **Expand All Folders** -- Expands every folder in the file tree.
- **Collapse All Folders** -- Collapses every folder in the file tree.

*Folder context menu:*
- **New File** / **New Folder** -- Creates inside this folder.
- **Add Relative Path to Chat** / **Add Absolute Path to Chat** -- Inserts the folder path.
- **Rename** / **Delete** -- Rename or delete the folder (deletion is recursive and requires confirmation).
- **Reveal in Finder** / **Copy Path** / **Copy Relative Path** -- Path operations.
- **Expand All Folders** / **Collapse All Folders** -- Tree-wide expand/collapse.

*Empty space context menu (right-click on empty area of the file tree):*
- **New File** / **New Folder** -- Creates at the project root.
- **Expand All Folders** / **Collapse All Folders**

**Edit a file**
When a file is open in normal (non-diff) mode, the editor is fully editable. Type to make changes. The tab label shows a dot indicator when the file has unsaved modifications.

**Save a file**
Press **Cmd+S** or click the Save button (disk icon) in the toolbar. The file is written to disk and the dirty indicator disappears. The Save button only appears when there are unsaved changes.

**Toggle diff mode**
When a file was opened from an edit activity (so it has old and new content), click the diff toggle button (left-right arrow icon) in the toolbar. This switches between a normal editable view of the new content and a read-only diff view showing what changed.

**Toggle side-by-side diff**
While in diff mode, click the columns icon in the toolbar to switch between inline (unified) diff and side-by-side (split) diff views.

**Toggle word wrap**
Click the word wrap button (wrap text icon) in the toolbar. Enabled by default.

**Close a file tab**
Hover over a tab and click the X button that appears on the right side of the tab. If the file has unsaved changes, they are discarded.

**Create a new file or folder**
Right-click in the file tree and choose "New File" or "New Folder." An inline input field appears at the appropriate location. Type the name and press Enter to create, or Escape to cancel.

**Rename a file or folder**
Right-click and choose "Rename." The name becomes an editable field. For files with extensions, the selection initially highlights just the name portion (not the extension). Press Enter to confirm or Escape to cancel.

### States

- **Default (empty):** A centered file icon with "No file open" and the hint "Click a file in the sidebar or activity feed."
- **File open:** The tab bar, toolbar, and editor are all visible. The editor has full syntax highlighting and is editable.
- **Diff mode:** The editor switches to a read-only diff view. The diff toggle button is highlighted. Added/removed line counts appear in the toolbar.
- **Dirty (unsaved changes):** A dot appears after the file name in both the tab and the toolbar. The Save button appears in the toolbar.
- **Saving:** The Save button is temporarily disabled while the write operation completes.

### Configuration

- **Settings -> General -> Font Size:** The Monaco editor uses font size minus 1 (matching the Activity Feed detail editor).
- **Settings -> General -> Theme:** The Monaco editor applies the matching CodeMantis theme (each theme defines editor background, line highlight, line number colors, selection colors, and diff colors).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+F | Focus File Viewer tab |
| Cmd+S | Save the current file |

### Tips

- The File Viewer automatically opens diffs when Claude edits files, so you can immediately review changes. Use the diff toggle to switch between seeing the diff and editing the resulting file.
- Use "Copy Contents" from the file tree context menu to quickly grab a file's content for pasting elsewhere. Use "Add to Main Chat" to attach it directly as context for Claude.
- Special files like `CLAUDE.md` and the `.claude` directory are highlighted in yellow in the file tree for easy identification.

---

## Chapter 12: Integrated Terminals

CodeMantis includes fully functional integrated terminals powered by xterm.js. Each session can have up to 6 terminal tabs running concurrently, complete with a Quick Commands bar for one-click execution of common commands and automatic Dev Server detection.

### What You See

The Terminal tab shows a terminal icon and is labeled "Terminal" in the Right Panel tab bar. The panel has four sections stacked vertically:

**Terminal tab bar:** A horizontal row of terminal tabs at the top (when at least one terminal exists). Each tab shows:
- A small status dot: green when the terminal is running, red when it has stopped.
- The terminal name (e.g., "Terminal 1," "Terminal 2").
- An X close button that appears on hover.
- A **+** (plus) button at the end of the tab row to create a new terminal.

**Dev Server Banner:** Appears automatically when a dev server is detected in another session's terminal within the same project. Shows a radio icon in accent color, followed by the session name and clickable port numbers (e.g., ":3000", ":5173"). Clicking a port opens that URL in your default browser.

**Terminal display:** The main terminal area, powered by xterm.js. Features:
- Full color support and ANSI escape code rendering.
- Blinking cursor.
- Monospace font (SF Mono, Fira Code, Cascadia Code, or system monospace).
- 5000 lines of scrollback buffer.
- Clickable URLs (detected automatically; clicking opens them in your default browser).
- Auto-resize when the panel is resized.
- Preserves terminal state even when switching between tabs or sessions.

**Quick Commands bar:** A horizontal strip of pill-shaped buttons at the bottom of the terminal panel (below the terminal, separated by a border). Each button shows a label. Clicking a button sends the associated command to the active terminal and presses Enter. The default quick commands are typically build/test/lint/dev commands; they are fully configurable in Settings.

### How to Open / Access

- Click the **Terminal** tab in the Right Panel tab bar (second tab, terminal icon).
- Press **Cmd+Shift+T** to focus the Terminal tab directly.
- If no terminals exist, the panel shows a centered "No terminals" message with a "Create Terminal" button.

### User Actions

**Create a terminal**
Click the **+** button in the terminal tab bar, or click the "Create Terminal" button in the empty state. A new terminal opens in the current session's project directory. Terminals are automatically named "Terminal 1," "Terminal 2," etc.

**Switch between terminals**
Click a terminal tab to switch to it. The terminal regains focus automatically.

**Close a terminal**
Hover over a terminal tab and click the X button. The terminal process is terminated and the tab is removed.

**Run a quick command**
Click any pill button in the Quick Commands bar at the bottom. The command text is sent to the active terminal followed by Enter, executing it immediately. Hover over a button to see the full command in a tooltip.

**Open a detected dev server**
When the Dev Server Banner appears (showing detected ports from other sessions), click a port number (e.g., ":3000") to open that URL in your default browser. The banner shows which session the server belongs to, with an arrow pointing to the port(s).

**Type in the terminal**
Click anywhere in the terminal area to focus it, then type normally. All standard terminal interactions work: Tab completion, arrow keys for command history, Ctrl+C to interrupt, etc.

**Click a URL**
URLs in terminal output are automatically detected and underlined. Click one to open it in your default browser.

### States

- **Default (empty):** Centered text "No terminals" with a "Create Terminal" button. The Quick Commands bar is hidden.
- **Active terminal:** The terminal display fills the panel. The cursor blinks. The Quick Commands bar is visible at the bottom.
- **Multiple terminals:** Tabs appear in the tab bar. Switching between them preserves each terminal's full state and scrollback.
- **Dev Server detected:** A banner appears between the tab bar and the terminal display, showing session names with clickable port links.
- **Terminal stopped:** The status dot turns red. The terminal display still shows its output but is no longer interactive.

### Configuration

- **Settings -> Terminal -> Shell:** Configure which shell to use for new terminals.
- **Settings -> Terminal -> Font Size:** Set the terminal font size independently of the main app font size. Changes apply immediately to all open terminals.
- **Settings -> Quick Commands:** Add, remove, or reorder quick command buttons. Each command has a label (displayed on the pill button) and a command string (sent to the terminal). You can add project-specific commands like `pnpm build`, `cargo test`, or `npm run dev`.
- **Settings -> General -> Theme:** Terminal colors automatically match the selected app theme.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+T | Focus Terminal tab |

### Tips

- Quick Commands are a major time saver. Customize them in **Settings -> Quick Commands** to match your project's workflow (e.g., add buttons for your test runner, linter, build command, and dev server).
- The Dev Server Banner watches for common dev server patterns across all sessions in your project. If you start `pnpm dev` or `npm start` in one terminal, the detected port appears in other sessions' terminal panels so you can quickly open the preview.
- Up to 6 terminals can run simultaneously per session. Use separate terminals for different tasks: one for the dev server, one for running tests, one for git operations, etc.

---

## Chapter 13: AI Changelog

The AI Changelog generates automatic, LLM-powered summaries of every coding turn Claude completes. Each entry captures what changed, why it changed, and which files were affected. It is powered by a separate LLM provider of your choice (not Claude Code itself), creating an independent record of your development session.

### What You See

The Changelog tab shows a scroll icon and is labeled "Changelog" in the Right Panel tab bar. The panel displays:

**Search bar:** At the top (when entries exist), a search input with a magnifying glass icon and "Search changelog..." placeholder. When filtering, it shows a count ("3 of 12") and a clear button (X). Searching is instant and matches across headlines, descriptions, technical details, tools summaries, categories, and file names.

**Entry cards:** Each changelog entry is a card separated by a light border. Each card contains:

- **Category icon and badge:** An icon and colored label identifying the type of change:

| Category | Icon | Color | Label |
|----------|------|-------|-------|
| Feature | Sparkles | Green | Feature |
| Bug Fix | Bug | Red | Bug Fix |
| Refactor | Wrench | Yellow | Refactor |
| Docs | FileText | Blue | Docs |
| Config | Settings | Purple | Config |
| Test | TestTube | Accent | Test |
| Plan | Map | Blue | Plan |

- **Timestamp:** Shown at the top right of each card in HH:MM format.
- **Copy button:** Appears on hover. Copies the entry as both HTML (bold headline + description) and plain text to the clipboard.
- **Delete button:** Appears on hover (trash icon, turns red). Permanently deletes the entry from the database.
- **Headline:** Bold, primary-colored text summarizing the change in a few words. Supports Markdown formatting.
- **Description:** Smaller, dimmer text explaining the change in more detail. Supports Markdown formatting with GFM (GitHub Flavored Markdown) including links.
- **Tools summary:** A small italic line at the bottom in ghost-colored text, summarizing which tools were used (e.g., "Read, Edit, Bash").
- **Expandable technical details:** When technical details are available, a "Show details (N)" toggle appears. Clicking it reveals a bulleted list of implementation specifics. Click "Hide details" to collapse.
- **Files changed:** A row of small monospace pills showing the file names (not full paths; hover for the full path) of files that were modified.

**Generating indicator:** When a summary is being generated, a spinner appears at the top of the feed with "Generating summary..." text.

### How to Open / Access

- Click the **Changelog** tab in the Right Panel tab bar (fourth tab, scroll icon).
- Press **Cmd+Shift+L** to focus the Changelog tab directly.
- Changelog entries appear automatically after each coding turn when the feature is enabled.

### User Actions

**Enable the changelog**
Go to **Settings -> Changelog** and toggle "Enable auto-changelog" on. Select a provider and model. You must have an API key configured for the chosen provider in **Settings -> AI Providers**.

**Search entries**
Type in the search bar at the top. The filter applies instantly, showing only entries that match all search terms across all fields. The count updates to show "N of M." Click X or clear the text to reset.

**Copy an entry**
Hover over a card and click the copy button (clipboard icon) that appears next to the timestamp. The entry is copied to your clipboard in both HTML format (for rich pasting into documents) and plain text format.

**Delete an entry**
Hover over a card and click the trash icon. The entry is immediately and permanently deleted from the database.

**Expand technical details**
Click "Show details (N)" at the bottom of a card to see the bulleted list of technical implementation notes. Click "Hide details" to collapse.

**Change provider and model**
Go to **Settings -> Changelog**. Choose a provider from the dropdown (Google Gemini, OpenAI, Anthropic, or OpenRouter). Then select a model from the model dropdown. For OpenRouter, a searchable model picker appears instead of a simple dropdown.

**Customize the system prompt**
In **Settings -> Changelog**, scroll to the "System Prompt" section. Edit the textarea to change the instructions given to the LLM when generating summaries. Click the "Reset" button (with a rotate icon) to restore the default prompt. The help text below notes: "The AI receives this as a system instruction. It should ask for JSON output with headline, description, and category fields."

**View Project Log**
The changelog entries are persisted to the database and can be viewed across all sessions for a project via the Project Log view (accessible from the project tab's menu).

### States

- **Default (empty, disabled):** Centered sparkles icon with "No changelog entries yet" and a prompt: "Enable in Settings to auto-generate summaries of each coding turn."
- **Active with entries:** The search bar and scrollable list of entry cards are visible, newest first.
- **Generating:** A loading spinner and "Generating summary..." text appear at the top of the entry list while the LLM processes.
- **Search active, no matches:** "No entries match your search" with a "Clear search" link.
- **Filtering:** The search bar shows the match count and a clear button.

### Configuration

- **Settings -> Changelog -> Enable auto-changelog:** Master toggle (on/off).
- **Settings -> Changelog -> Provider:** Choose between Google Gemini, OpenAI, Anthropic, or OpenRouter.
- **Settings -> Changelog -> Model:** Select the specific model. For OpenRouter, uses a searchable model picker. For other providers, shows a dropdown of available models.
- **Settings -> Changelog -> System Prompt:** A textarea where you can customize the LLM prompt used to generate summaries. Includes a Reset button to restore defaults.
- **Settings -> AI Providers -> API Keys:** The changelog provider requires a valid API key for the selected provider.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+L | Focus Changelog tab |

### Tips

- Use a fast, inexpensive model for changelog generation (e.g., Gemini 2.5 Flash or GPT-5.4 Nano) since it runs after every turn. You do not need the most powerful model for summarization.
- The copy button outputs both HTML and plain text, making it perfect for pasting into Slack, Notion, or other rich-text editors where the bold headline and description formatting are preserved.
- Use the search feature to quickly find when a specific file was changed or when a particular feature was implemented. The search covers everything -- headlines, descriptions, file names, and technical details.

---

## Chapter 14: Multi-AI Assistants

The Assistant Panel lets you chat with multiple AI providers simultaneously in separate tabs alongside your main Claude Code session. You can have conversations with OpenAI, Google Gemini, Anthropic's API, OpenRouter (giving access to hundreds of models), or additional Claude Code instances -- all within the same project context. Assistants are useful for quick questions, code review, brainstorming, or comparing responses across providers.

### What You See

The Assistant tab shows a message bubble icon and is labeled "Assistant" in the Right Panel tab bar. The panel has three main areas:

**Assistant tab bar:** A horizontal row of assistant tabs at the top (when at least one assistant exists). Each tab shows:
- A small status dot: yellow when the assistant is generating a response, green when idle.
- A **provider badge:** A small colored two-letter label identifying the provider:

| Badge | Provider | Color |
|-------|----------|-------|
| CC | Claude Code (local) | Accent purple |
| OA | OpenAI | Green (#10a37f) |
| G | Google Gemini | Blue (#4285f4) |
| A | Anthropic API | Warm brown (#d4a574) |
| OR | OpenRouter | Indigo (#6366f1) |

- The assistant's name (e.g., "Claude 1," "GPT 1," "Gemini 1").
- Cost tracking: if the assistant has tracked token usage, a small gray cost figure appears (e.g., "$0.03").
- An X close button that appears on hover.
- A **+** (plus) button at the end of the tab row to create a new assistant (opens the provider menu).

**Chat area:** The main message display. Shows a scrollable list of message bubbles, identical in appearance to the main Chat Panel. User messages and assistant responses alternate. Streaming responses show text appearing in real time. When the assistant is processing but not yet streaming, three pulsing dots with "Thinking..." text appear.

**Info banner (API providers only):** When a new API-based assistant is created and has no messages yet, a small info bar appears below the tabs: "Chat only -- no file access or tool use. Uses your [provider] API key."

**Input area:** At the bottom of the panel:
- **Shortcut pills:** If you have saved assistant shortcuts (reusable prompts), they appear as pill-shaped buttons above the input. Click one to populate the input with that prompt.
- **Attachment bar:** When files are attached, they appear as small cards showing a thumbnail (for images), file name, size, and an X to remove. Click an image attachment to see a full-size preview modal.
- **Text input:** A multi-line textarea with the placeholder "Ask the assistant... (/ for commands)" for Claude Code assistants, or "Ask the assistant..." for API providers. Supports auto-resize up to 200px height.
- **Attach file button:** A + button to the right of the textarea. Opens a file dialog to attach files. Attachments can also be pasted from the clipboard or dragged and dropped into the input area.
- **Send/Stop buttons:** Below the attach button:
  - When idle: a Send button (paper plane icon) in accent color. Disabled when the input is empty and no attachments are present.
  - When generating: a Stop button (red square icon) to cancel the response. Also triggered by pressing **Escape**.

**Command palette (Claude Code assistants only):** When you type "/" in the input, a floating command palette appears above the input showing available slash commands. Navigate with Up/Down arrows, select with Enter, dismiss with Escape. Available built-in commands include:
- `/help` -- Shows available commands.
- `/clear` -- Clears conversation history and resets the session.
- `/context` -- Shows current context token usage.
- `/cost` -- Shows session cost and token statistics.
- `/exit` -- Closes the assistant tab.
- `/rename New Name` -- Renames the assistant tab.
- Skills from `.claude/commands/` are also available and expand as prompts.

**Message context menu:** Right-click a user message to see a context menu with:
- **Copy** -- Copies the message text to the clipboard.
- **Use in Chat** -- Pastes the message text into the main Chat Panel's input area.
- **Add as Shortcut** -- Opens a dialog to save the message as a reusable shortcut with a custom name.

### How to Open / Access

- Click the **Assistant** tab in the Right Panel tab bar (fifth tab, message bubble icon).
- When no project is open, the panel shows "Open a project to use the assistant."
- When a project is open but no assistants exist, the panel shows an empty state with provider selection buttons.

### User Actions

**Create a new assistant**
Click the **+** button in the assistant tab bar (or select from the empty state view). A provider menu appears listing all five providers:
- **Claude Code (local):** No API key required. Uses your Claude Pro/Max subscription. Has full tool access (file reads, writes, edits, bash commands) just like the main chat. Supports slash commands.
- **OpenAI:** Requires an API key. Available models include GPT-4.1, GPT-5.4 Nano, GPT-5.4 Mini, and GPT-5.4.
- **Google Gemini:** Requires an API key. Available models include Gemini 2.5 Flash Lite, Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 3.0 Flash, Gemini 3.1 Pro, and Gemini 3.1 Flash Lite.
- **Anthropic API:** Requires an API key. Available models include Claude Opus 4.6, Claude Sonnet 4.6, and Claude Haiku 4.5.
- **OpenRouter:** Requires an API key. Shows a searchable model picker with hundreds of models, separated into Free and Paid sections. Each model shows capability badges (e.g., vision support, file support). If models have not been loaded, it shows "No models loaded. Test your API key in Settings first."

Providers without a configured API key show "No API key" (or "No key" in the popover) and are disabled. Hover over a disabled provider to see the tooltip "Set API key in Settings > AI Providers."

Click a provider (for Claude Code) or expand it and select a model (for API providers) to create the assistant. Assistants are automatically named with the provider name and a number (e.g., "Claude 1," "GPT 1," "Gemini 2").

**Send a message**
Type in the textarea and press **Enter** (or **Cmd+Enter**, depending on your send shortcut setting) or click the Send button. The message appears as a user bubble and the assistant begins generating a response.

**Attach files**
Click the **+** (attach) button to open a file dialog, or paste an image from the clipboard, or drag and drop files onto the input area. Attached files appear in the attachment bar above the textarea. For API providers, images are sent as multimodal content; text files are inlined as text; binary files (PDFs, etc.) are sent as document parts. For Claude Code assistants, file contents are inlined into the prompt as text.

**Stop a response**
While the assistant is generating, click the red Stop button or press **Escape**. The streaming response is finalized at whatever point it reached.

**Retry a failed response**
When an API provider returns an error, the error message appears with a retry option. Click retry to resend the last user message.

**Switch between assistants**
Click an assistant tab to switch to it. Each assistant maintains its own independent conversation history, even across tab switches.

**Close an assistant**
Hover over an assistant tab and click the X button. The assistant's session is terminated and its conversation history is removed. For Claude Code assistants, the CLI session is also closed.

**Use a slash command (Claude Code assistants only)**
Type "/" followed by a command name. The command palette appears showing matching commands. Use arrow keys to navigate and Enter to select, or keep typing to filter. Commands from `.claude/commands/` directories are expanded as skill prompts.

**Use a shortcut prompt**
If you have saved shortcuts (via the message menu or Settings), they appear as pill buttons above the input. Click one to populate the input with the saved prompt.

**Save a message as a shortcut**
Right-click a user message and choose "Add as Shortcut." A dialog appears asking for a name. Enter a name and click Save. The shortcut appears as a pill button in all assistant input areas.

**Use a response in the main chat**
Right-click a user message and choose "Use in Chat." The message text is placed into the main Chat Panel's input area, ready to send to Claude Code.

**Copy a message**
Right-click a user message and choose "Copy." The text is copied to the clipboard.

### States

- **No project:** "Open a project to use the assistant."
- **Empty (no assistants):** A message bubble icon with explanatory text and a full provider selection list.
- **Active assistant, no messages:** The chat area shows "Send a message or use / commands to get started" (Claude Code) or "Send a message to get started" (API providers). API providers also show the info banner about chat-only mode.
- **Active conversation:** Messages displayed as alternating user/assistant bubbles with streaming support.
- **Generating (thinking):** Three pulsing dots with "Thinking..." label before streaming begins.
- **Generating (streaming):** Response text appears character-by-character in the assistant's message bubble.
- **Error:** An error message appears in the chat (for API providers, often with a Retry button).

### Configuration

- **Settings -> AI Providers -> API Keys:** Enter API keys for OpenAI, Google Gemini, Anthropic, and/or OpenRouter. Each key unlocks the corresponding provider in the assistant panel.
- **Settings -> AI Providers -> Default Models:** Set the default model for each provider so new assistants start with your preferred model.
- **Settings -> AI Providers -> Model Pricing:** Customize per-model pricing (input/output cost per million tokens) for accurate cost tracking.
- **Settings -> Assistant -> Shortcuts:** View and manage saved shortcut prompts. Each shortcut has a name and a prompt.
- **Settings -> General -> Send Shortcut:** Choose between Enter or Cmd+Enter for sending messages (applies to both the main chat and assistant inputs).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Enter or Cmd+Enter | Send message (depends on send shortcut setting) |
| Escape | Stop generation / Cancel response |
| / | Open command palette (Claude Code assistants only) |
| Up/Down arrows | Navigate command palette |
| Enter | Select command from palette |
| Escape | Close command palette |

### Tips

- Use API-based assistants for quick questions that do not require file access. They are faster and do not consume your Claude Code context window. Keep your main session focused on coding tasks while asking GPT or Gemini for syntax questions, explanations, or brainstorming in a side tab.
- Claude Code assistants in the Assistant Panel are full Claude Code sessions with tool access. They can read, write, and edit files just like your main session. Use them to run independent tasks in parallel.
- Up to 6 assistants can be open simultaneously per session. Each API assistant tracks its own token usage and cost, displayed in the tab. Use this to monitor spending across providers.
- The "Use in Chat" feature in the message context menu is powerful for cross-pollination: ask an API assistant for a code snippet or approach, then right-click the response and send it to your main Claude Code session as instructions.
- OpenRouter gives you access to hundreds of models, including many free options. The model picker shows capability badges so you can quickly identify which models support images or file attachments.
