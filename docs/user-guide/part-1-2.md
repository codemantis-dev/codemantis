<!-- CodeMantis Complete User Guide — Parts I & II (Chapters 1-9) -->
<!-- Generated from source code | App Version: 0.9.1 | Date: 2026-03-26 -->

# Part I: Getting Started

---

## Chapter 1: First Launch

The first time you open CodeMantis, a Welcome Screen greets you and walks you through prerequisites and first steps. This screen is designed to ensure your environment is ready before you begin coding with Claude.

### What You See

The Welcome Screen fills the entire window. At the top center is the CodeMantis icon (a large rounded square logo) followed by the heading **"Welcome to CodeMantis"**, the subtitle *"Native desktop UI for Claude Code"*, and the current version number (e.g., v0.9.1).

Below the heading is a brief description: **"CodeMantis: The AI Coding Studio for the Rest of Us."** followed by a short paragraph explaining what CodeMantis does, and three highlighted capabilities:

- **Visual Session Management** -- Organize your thoughts and threads effortlessly.
- **Your Ideas to AI-powered Specifications to Claude Code** -- Integrated to work.
- **Real-time Activity Tracking** -- See exactly what your AI is doing as it happens.

The bottom half of the screen is split into two side-by-side cards:

**Left card: "Requirements"**
A checklist of prerequisites, each with a green checkmark or an empty circle:

1. **Claude Code CLI** -- Shows "Installed (vX.X.X)" when detected, or "Not installed" with the install command `npm install -g @anthropic-ai/claude-code`.
2. **Authentication** -- Shows "Logged in at Claude Code" or "Not authenticated" with the command `claude login`.
3. **You are cool and motivated** -- Always checked (just for fun).

A **Re-check** button sits in the top-right of the Requirements card. Click it to re-verify your installation. It shows a spinning icon and the text "Checking..." while working.

**Right card: "First steps..."**
Four action buttons stacked vertically, each with an icon, title, and subtitle:

1. **Add AI API Keys** (Key icon) -- Subtitle: "Multi-AI assistant & changelog". Tagged as "Optional". Opens Settings.
2. **Open a Project** (FolderOpen icon) -- Subtitle: "Open an existing folder". Opens the system folder picker.
3. **Clone from GitHub** (GitBranch icon) -- Subtitle: "Clone a Git repository". Opens the Clone form.
4. **Create New Project** (Plus icon) -- Subtitle: "Scaffold from a template". Opens the Template picker.

All four buttons are disabled (grayed out, cursor shows not-allowed) until all requirements are satisfied.

**If Claude Code is not found**, a yellow warning box appears above the description with an AlertTriangle icon. It reads **"Claude Code not found"** and explains that CodeMantis needs Claude Code installed. Two links are provided: **"Get Claude Code"** (opens the Anthropic product page in your browser) and **"Locate Claude Code"** (lets you manually point CodeMantis to the `claude` binary on your system).

At the very bottom of the screen is a footer row with:

- A checkbox labeled **"Do not show this again"** (checked by default).
- A **"Skip for now"** link on the right (only visible when prerequisites are met).

### How to Open / Access

- The Welcome Screen appears automatically on first launch.
- If you checked "Do not show this again" and want to see it again, go to **Settings** (gear icon in the title bar, or press `Cmd ,`) and set the `onboardingCompleted` preference back. The underlying setting is `onboardingCompleted: false` in the settings store.

### User Actions

**Check prerequisites**
Click the **Re-check** button in the Requirements card. The icon spins while CodeMantis re-verifies that the Claude Code CLI is installed and authenticated.

**Locate Claude Code manually**
If Claude Code is installed but not found automatically, click **"Locate Claude Code"** in the yellow warning banner. A file picker opens so you can select the `claude` binary.

**Open an existing project**
Click **"Open a Project"** in the First Steps card. This opens the system folder picker dialog. Select a folder and CodeMantis will open it as a project.

**Clone from GitHub**
Click **"Clone from GitHub"** to open the Clone form (see Chapter 3).

**Create a new project from template**
Click **"Create New Project"** to open the Template picker (see Chapter 3).

**Add AI API Keys**
Click **"Add AI API Keys"** to open the Settings modal. This is optional -- CodeMantis works with just your Claude Code subscription, but API keys enable the multi-AI assistant and changelog features.

**Dismiss the Welcome Screen**
Leave the **"Do not show this again"** checkbox checked (it is checked by default) and either click **"Skip for now"** or open a project. The Welcome Screen will not appear on future launches.

**Keep the Welcome Screen for next launch**
Uncheck the **"Do not show this again"** checkbox before dismissing.

### States

- **Default (prerequisites met):** All three checkmarks are green. All four action buttons are enabled. The "Skip for now" link is visible.
- **Prerequisites not met:** One or more items show an empty circle instead of a checkmark. A terminal command is shown below the unmet item (e.g., `npm install -g @anthropic-ai/claude-code`). The four action buttons are disabled.
- **Claude Code not found:** A yellow warning banner appears above the description with instructions and a link to install Claude Code.
- **Re-checking:** The Re-check button shows a spinning icon and "Checking..." text.

### Configuration

- **Settings -> General -> Onboarding:** The `onboardingCompleted` flag controls whether the Welcome Screen appears. Set to `false` to show it again.
- **Settings -> General -> Claude Binary Override:** If automatic detection fails, use "Locate Claude Code" to set a custom binary path. This is stored as `claudeBinaryOverride` in settings.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd ,`  | Open Settings (from anywhere in the app) |

### Tips

1. If you installed Claude Code via a version manager (e.g., nvm, volta), it might not be in the default PATH. Use "Locate Claude Code" to point CodeMantis directly to the binary.
2. You must authenticate with Claude Code before CodeMantis can start sessions. Run `claude login` in your terminal if the Authentication prerequisite is unmet.
3. The "Add AI API Keys" step is optional. You only need API keys if you want to use the multi-AI Assistant panel or the automatic changelog summarizer.

---

## Chapter 2: The CodeMantis Interface

CodeMantis uses a three-panel layout with a title bar and session sub-tabs. Once you understand the layout, every feature is at most two clicks away.

### What You See

The interface is divided vertically into five horizontal zones, top to bottom:

**1. Title Bar** (top bar, 48px tall)

Starting from the left:

- **macOS traffic lights** (close, minimize, maximize) in the standard position with a spacer after them.
- **Project tabs** -- One tab per open project, showing a folder icon, the project folder name, and optionally a session count badge (when more than one session exists). The active project tab has an accent-colored top border and elevated background. Inactive tabs have a transparent top border. Each tab shows a close button (X) on hover. Projects also show a status indicator: a pulsing green dot means at least one session is busy; a yellow dot means a session has gone stale (no events for 30+ seconds).
- **Flexible drag region** -- The space between project tabs and action buttons is a drag region. You can click and drag here to move the window. If no projects are open, the text "CodeMantis" appears here.

On the right side of the title bar, a row of icon buttons (left to right):

| Icon | Button | Shortcut | Description |
|------|--------|----------|-------------|
| Plus (+) | New Project | `Cmd Shift N` | Opens the Project Picker on the Templates tab |
| FolderOpen | Open Project | `Cmd O` | Opens the Project Picker on the Open Folder tab |
| PenTool | SpecWriter | `Cmd Shift B` | Toggles the SpecWriter slide-over panel. Shows a badge if specs exist for the current project. |
| Globe | Run Application | -- | Starts/focuses the app preview window. Launches the dev server if not running. |
| Camera | Screenshot | -- | Captures a screenshot of the preview window and attaches it to the chat input. **Only visible when the preview window is open.** |
| Blocks | MCP Servers | `Cmd Shift M` | Opens the MCP server configuration modal |
| Settings (gear) | Settings | `Cmd ,` | Opens the Settings modal |
| HelpCircle (?) | Help | `Cmd ?` | Toggles the Help panel. Highlighted with accent color when the Help panel is open. |

**2. Session Sub-Tabs** (second bar, 32px tall, only visible when a project is open)

A row of tabs for the sessions within the active project. Each session tab shows:

- A **status dot**: green (idle) or yellow with pulse animation (streaming/busy).
- A **model badge**: a small accent-colored pill showing the model family (e.g., "Sonnet", "Opus", "Haiku"), extracted from the model identifier.
- The **session name** (truncated if long).
- A **close button** (X) that appears on hover or when the tab is active.

The active session tab has an elevated background and an accent-colored bottom border. Double-click a session tab to rename it.

To the right of the session tabs:

- A **Plus (+) button** to create a new session in the current project.
- A flexible spacer.
- **Session History** tab (History icon) -- Shows closed sessions you can resume. See Chapter 8.
- **Project Log** tab (ScrollText icon) -- Shows changelog entries across all sessions. See Chapter 8.

**3. Left Panel: Sidebar**

The sidebar shows:

- A header bar labeled **"Files"** with a FolderTree icon, plus buttons for New File (FilePlus), New Folder (FolderPlus), and Refresh (RefreshCw, spins while loading).
- The **file tree** of the current project, showing folders and files in a collapsible tree structure.
- A **Git Status Card** at the bottom (only if the project is a git repository), showing branch name and status.
- A **Context Meter** at the very bottom, displaying the context window usage (used tokens vs. max).

When no project is open, the sidebar shows "No project open". When a project is loading, it shows "Loading...". When a project folder is empty, it shows "Empty directory".

**4. Center Panel: Chat + Input**

The main work area. Contains:

- The **Chat Panel** (scrollable area showing conversation messages). See Chapter 4.
- The **Input Area** (fixed at the bottom of the center panel). See Chapter 5.

When the Session History or Project Log tab is active, the center panel switches to show that view instead of the chat.

**5. Right Panel**

A tabbed panel with the following tabs (each shown as an icon + label in the tab bar):

| Tab | Icon | Description |
|-----|------|-------------|
| **Activity** | Activity (pulse icon) | Real-time feed of tool operations Claude is performing |
| **Terminal** | TerminalSquare | Integrated terminal(s) with tab management and quick commands |
| **Files** | FileCode | Monaco editor for viewing/editing files |
| **Changelog** | ScrollText | AI-generated changelog entries for the current session |
| **Assistant** | MessageSquare | Multi-provider AI assistant (independent of Claude Code) |
| **Guide** | ListChecks | Step-by-step guide panel (only visible when a guide is active) |

The active tab is highlighted with an elevated background and bold text. When the panel is narrow, inactive tabs collapse to icon-only mode to prevent overflow.

**Resize Dividers**

Two vertical resize handles separate the three panels. Drag them to adjust panel widths:

- The left handle sits between the sidebar and center panel.
- The right handle sits between the center panel and right panel.
- Handles show a subtle 1px line that highlights on hover (accent-light color) and becomes accent-colored while dragging.
- The center panel has a minimum width of 300px, and the right panel enforces a dynamic minimum based on its tab bar width.

### How to Open / Access

The interface appears automatically after dismissing the Welcome Screen and opening a project. All panels are always visible -- there is no way to completely collapse a panel, though you can resize them quite narrow.

### User Actions

**Toggle the sidebar**
Press `Cmd B` to toggle sidebar visibility.

**Resize panels**
Click and drag any resize handle. The cursor changes to a column-resize cursor while dragging.

**Switch right panel tabs**
Click a tab label in the right panel header, or use keyboard shortcuts:

| Shortcut | Tab |
|----------|-----|
| `Cmd Shift A` | Activity Feed |
| `Cmd Shift F` | File Viewer |
| `Cmd Shift T` | Terminal |
| `Cmd Shift L` | Changelog |

**Move the window**
Click and drag the title bar (anywhere that is not a button or tab).

### States

- **No project open:** Title bar shows "CodeMantis" text, session sub-tabs are hidden, sidebar shows "No project open", center panel shows "Welcome to CodeMantis -- Open a project to start a session".
- **Project open, no sessions:** Session sub-tabs area is visible but empty (only the Plus, Session History, and Project Log buttons appear).
- **Active session:** All panels populate with session data. The sidebar shows the file tree, the center shows the chat, and the right panel shows tool activity.

### Configuration

- **Settings -> General -> Theme:** Choose from available themes. The theme changes all panel colors via CSS variables.
- **Settings -> General -> Font Size:** Adjust with `Cmd =` (zoom in), `Cmd -` (zoom out), `Cmd 0` (reset to 13px). Affects both UI and terminal.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd Shift N` | New project from template |
| `Cmd O` | Open existing project |
| `Cmd ,` | Settings |
| `Cmd Shift M` | MCP Servers |
| `Cmd /` | CLI Overlay |
| `Cmd .` | Toggle mode (Normal/Auto/Plan) |
| `Cmd =` | Zoom in (increase font size) |
| `Cmd -` | Zoom out (decrease font size) |
| `Cmd 0` | Reset zoom |
| `Cmd ?` | Toggle Help panel |
| `Cmd B` | Toggle sidebar |
| `Cmd Shift A` | Focus Activity Feed |
| `Cmd Shift F` | Focus File Viewer |
| `Cmd Shift T` | Focus Terminal |
| `Cmd Shift L` | Focus Changelog |

### Tips

1. The right panel dynamically switches between showing tab labels and icon-only mode based on available width. If you see only icons, widen the right panel by dragging the resize handle.
2. The Camera (Screenshot) button only appears in the title bar when the preview window is open. It captures the preview and adds the screenshot as a chat attachment automatically.
3. The SpecWriter button shows a small badge next to the pen icon when specs exist for the current project, so you can tell at a glance whether you have written any specifications.

---

## Chapter 3: Opening & Managing Projects

CodeMantis organizes work by project. Each project is a folder on your Mac, and you can have multiple projects open at the same time in separate tabs.

### What You See

The **Project Picker** is a centered modal dialog (680px wide, up to 600px tall) with a header, a tab bar, and content that changes based on the selected tab.

The dialog title changes to match the active tab:

- **"New Project"** (Templates tab)
- **"Open Project"** (Open Folder tab)
- **"Clone from Git"** (Clone tab)
- **"Recent Projects"** (Recent tab)

The tab bar shows four tabs, each with an icon:

| Tab | Icon | Description |
|-----|------|-------------|
| **Templates** | LayoutGrid | Create a new project from a predefined template |
| **Open Folder** | FolderOpen | Browse and select an existing folder |
| **Clone** | GitBranch | Clone a Git repository by URL |
| **Recent** | Clock | Reopen a recently used project (shows count in parentheses) |

### How to Open / Access

| Method | Action |
|--------|--------|
| Keyboard shortcut | `Cmd O` opens the picker on the **Open Folder** tab |
| Keyboard shortcut | `Cmd Shift N` opens the picker on the **Templates** tab |
| Title bar button | Click the **Plus (+)** button to open on the **Templates** tab |
| Title bar button | Click the **FolderOpen** button to open on the **Open Folder** tab |
| Welcome Screen | Click "Open a Project", "Clone from GitHub", or "Create New Project" |

### User Actions

**Open an existing project folder**

1. Open the Project Picker (e.g., `Cmd O`).
2. The **Open Folder** tab is selected. Click the dashed-border area labeled **"Select a project folder..."** to open the macOS folder picker dialog.
3. Select a folder. The selected path and folder name appear in the picker area.
4. Click the **"Open Project"** button (accent-colored, full width).
5. The dialog closes. A new project tab appears in the title bar with the folder name. A session is created automatically.

**Clone a repository from Git**

1. Open the Project Picker and switch to the **Clone** tab.
2. Fill in the **Repository URL** field (e.g., `https://github.com/user/repo`). You can click the clipboard icon button to paste from your clipboard.
3. The **Clone to** field defaults to your last clone directory (or `~/Projects`). Click the folder icon to browse for a different location.
4. The **Project name** auto-fills from the repository URL. Edit it if desired.
5. Two checkboxes are available:
   - **"Install dependencies after cloning"** (checked by default) -- Runs the package manager's install command after cloning.
   - **"Generate CLAUDE.md for AI-assisted development"** (checked by default) -- Creates a CLAUDE.md file to give Claude Code context about the project.
6. Click **"Clone & Open"**. The view switches to a progress view showing steps with status icons:
   - Pending: empty circle
   - In progress: spinning loader
   - Done: green checkmark
   - Error: red X with error message
7. When cloning completes, the button changes to **"Open in CodeMantis"**. Click it to open the project. If warnings occurred (e.g., dependency install failed), they appear in a collapsible warnings section.

**Open a recent project**

1. Open the Project Picker and switch to the **Recent** tab.
2. A list of recently opened projects appears, each showing the folder name and full path.
3. Click any project to open it immediately.
4. Hover over a project to reveal an X button on the right to remove it from the recent list.

**Switch between open projects**

Click a project tab in the title bar. The active tab gets an accent-colored top border and elevated background. The session sub-tabs, sidebar, and all panels update to show the selected project's content.

**Close a project**

1. Hover over the project tab in the title bar to reveal the close button (X).
2. Click the X button (or click the close button on the active project tab).
3. A confirmation dialog appears: **"Close [project name]?"** with the number of sessions that will be closed.
4. Click **"Close"** to confirm or **"Cancel"** to keep the project open.

**CLAUDE.md generation**

When you open a project that does not have a CLAUDE.md file, the Chat Panel shows a suggestion banner:

> "This project doesn't have a CLAUDE.md file. Claude Code works better with one."

Click the **"Generate CLAUDE.md"** button in the banner. CodeMantis analyzes the project structure and generates a CLAUDE.md file. A success toast confirms: *"CLAUDE.md generated -- Claude Code will use it in your next session."* Click the X button on the banner to dismiss it without generating.

### States

- **Default (Open Folder tab):** Empty folder picker area showing "Select a project folder..." placeholder. The "Open Project" button is disabled (grayed out).
- **Folder selected:** Folder name and path appear in the picker area. The "Open Project" button becomes active (accent-colored).
- **Starting:** The "Open Project" button shows "Starting..." and is disabled.
- **Error:** A red error card appears below the button with the error message and a dismiss button.
- **Clone in progress:** Step-by-step progress view replaces the form. A "Cancel" button is available.
- **Clone error:** Failed steps show red X with error text. "Retry" and "Cancel" buttons appear. If a result was partially created, "Open Anyway" is also available.
- **Recent (empty):** Shows "No recent projects" centered message.

### Configuration

- **Settings -> General -> Last Clone Directory:** Remembered automatically; the Clone form defaults to this path.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd O` | Open Project Picker (Open Folder tab) |
| `Cmd Shift N` | Open Project Picker (Templates tab) |
| `Escape` | Close the Project Picker dialog |

### Tips

1. You can have multiple projects open simultaneously. Each gets its own tab in the title bar, its own set of sessions, and its own sidebar file tree.
2. When cloning, CodeMantis automatically appends `.git` to GitHub, GitLab, and Bitbucket URLs if missing, so you can paste the plain repository URL.
3. The "Generate CLAUDE.md" banner only appears once per project -- after you generate or dismiss it, it will not reappear for that project.

---

# Part II: Working with Claude Code

---

## Chapter 4: Chat Panel -- Conversations with Claude

The Chat Panel is where all conversation with Claude Code takes place. You see your messages, Claude's responses, thinking indicators, tool activity summaries, and session diagnostics here.

### What You See

The Chat Panel occupies the center column of the three-panel layout. It is a vertically scrollable area with messages arranged chronologically, newest at the bottom.

**Empty state:** When no messages have been exchanged, the panel shows the CodeMantis icon (faded to 30% opacity) and the text *"Send a message to start the conversation."*

**User messages** appear as right-aligned bubbles with:

- A light accent-colored background with a subtle purple border.
- White-space preserved text (line breaks, indentation are shown as typed).
- A timestamp below the bubble (e.g., "2:35 PM").
- A **Copy** button that appears to the left of the bubble on hover. Click it to copy the message text to your clipboard; the icon briefly changes to a checkmark to confirm.

**Assistant messages** (Claude's responses) appear as left-aligned blocks with:

- **Activity Chip** (at the top of the message) -- A small pill-shaped badge summarizing tool operations performed during this response turn. It shows counts like "1 reads . 2 edited . 1 commands" with a status dot (yellow if still running, green if complete). Clicking the chip navigates to the Activity tab in the right panel. The chip only appears if Claude used tools during that turn.
- **Markdown-rendered content** -- Claude's text is rendered as rich markdown with headers, lists, bold, italic, links, tables, and code blocks. Links open in your default browser.
- **Code blocks** -- Fenced code blocks have a header bar showing the language label (e.g., "typescript", "bash") and a **Copy** button. Click Copy to copy the code; the button text briefly changes to "Copied" with a green checkmark.
- **Streaming cursor** -- While Claude is actively generating text, a blinking purple vertical bar appears at the end of the streaming content.
- **Turn Stats** -- After Claude finishes a response, a small stats row appears below the message showing:
  - A bar-chart icon button displaying total tokens and cost (e.g., "12.3K tokens $0.02"). Click this button to open the **Turn Stats Popover**.
  - The timestamp and response duration (e.g., "2:36 PM . took 8.2s").

**Reasoning / Thinking Content**

When Claude uses extended thinking, a collapsible **"Reasoning"** section appears above the assistant's response text:

- A left accent-colored border and subtle accent background tint.
- A chevron toggle (right-pointing when collapsed, down-pointing when expanded).
- The label **"Reasoning"** and a word count when collapsed (e.g., "432 words").
- When expanded, the thinking text is shown in a scrollable pre-formatted area with a maximum height of 300px.
- During streaming, the section auto-expands and shows "streaming..." label. Once streaming completes, it remains in whatever state (expanded/collapsed) the user last set.

**Turn Stats Popover**

Click the token count below any assistant message to open a floating popover titled **"Turn Context"** showing:

- **Duration** -- Total wall-clock time for the turn.
- **API time** -- Time spent waiting for the API (if available).
- **API calls** -- Number of API calls made within the turn.
- **Cost** -- Dollar amount for the turn.
- A separator, then a token breakdown:
  - Input tokens
  - Output tokens
  - Cache read tokens (if any)
  - Cache write tokens (if any)
  - **Total tokens** (bold)

Click outside the popover or press Escape to dismiss it.

**Thinking Indicator**

When Claude is busy but not yet streaming text (e.g., running tools, planning), a Thinking Indicator appears pinned below the scroll area:

- Three animated bouncing dots in accent color.
- A label describing what Claude is doing (e.g., "Thinking...", "Reading App.tsx", "Editing settings.ts", "Running command...", "Compacting context...").
- An elapsed timer showing how long Claude has been working (e.g., "12s", "1m 5s").
- If the tool has been running for more than 5 seconds, the tool elapsed time is shown in parentheses.

**Sub-Agent Panel** (within the Thinking Indicator)

When Claude spawns sub-agents, a collapsible card appears below the thinking dots:

- A summary header: "1 sub-agent running" or "3 sub-agents running" with total token count.
- Click to expand/collapse. Auto-expands when 3 or fewer agents, collapses when more.
- Each agent row shows: a status dot (yellow for preparing, green for running), the agent description, an optional type badge (if not "general-purpose"), tool use count, token count, and elapsed time.
- A live activity line at the bottom showing the current agent's activity.

**Trivia Cards**

If trivia is enabled in Settings, a trivia card appears after Claude has been thinking for 3 seconds:

- A rounded card with the label "Did you know?" (or "Fun fact!" for easter eggs).
- A topic badge in the top-right corner.
- The trivia fact text.
- A **"Disable trivia"** button at the bottom-right to turn off trivia permanently.

Trivia cards rotate to a new fact periodically while Claude is working.

**Session Status Bar**

A thin bar pinned at the very bottom of the Chat Panel, always visible. It shows at a glance:

- **Left side:**
  - A status dot (green pulsing = busy, yellow pulsing = compacting, gray = idle).
  - Status text: **"Busy"**, **"Compacting"**, or **"Idle"**.
  - Elapsed time while busy (e.g., "12s").
  - Current activity detail while busy (e.g., "Editing settings.ts", "3 agents").
  - Agent token count while agents are running (e.g., "(12.5K agent tokens)").
- **Right side:**
  - Mode icon: ShieldCheck (green, Auto-Accept) or Map (yellow, Plan). Not shown in Normal mode.
  - Model name (e.g., "Sonnet", "Opus").
  - Turn count (e.g., "5 turns").
  - Rate limit utilization (shown when above 50%, e.g., "RL 65%", yellow at 80%+).
  - Total session tokens (e.g., "45.2K tokens").
  - Total session cost (e.g., "$0.12").
  - Context usage percentage (e.g., "ctx 72%"), colored yellow at 70%+ and red at 90%+.

**CLAUDE.md Suggestion Banner**

If the current project lacks a CLAUDE.md file, a banner appears at the top of the chat area with a sparkle icon, text explaining the benefit, a **"Generate CLAUDE.md"** button, and a dismiss (X) button. See Chapter 3 for details.

**Restored Session Divider**

When a session is resumed with restored messages (see Chapter 9), a horizontal divider labeled **"Previous session"** appears between the restored messages and new ones.

**Incremental Message Loading**

For sessions with many messages, the Chat Panel loads messages incrementally. As you scroll upward, older messages load automatically. A 1px sentinel element at the top triggers loading when it becomes visible.

**Scroll-to-Bottom Button**

When you scroll up and new messages arrive below, a floating button labeled **"New messages"** with a down-arrow icon appears at the bottom center of the chat. Click it to smoothly scroll to the latest message. The button disappears when you reach the bottom.

### How to Open / Access

The Chat Panel is always visible in the center column when a session is active and neither Session History nor Project Log is selected.

### User Actions

**Read a conversation**
Scroll up and down through the message history. Older messages load automatically as you scroll up.

**Copy a user message**
Hover over any user message bubble to reveal the Copy button on the left. Click it to copy the message text.

**Copy a code block**
Click the **"Copy"** button in the header bar of any code block within an assistant message.

**Expand/collapse reasoning**
Click the **"Reasoning"** toggle on any assistant message that has extended thinking content. The section expands or collapses with a smooth animation.

**View turn statistics**
Click the token/cost badge below any completed assistant message. The Turn Stats Popover opens showing full details. Click outside or press Escape to close.

**Scroll to latest messages**
Click the **"New messages"** button that appears when scrolled up, or simply scroll to the bottom.

**Restart a crashed session**
If Claude's session crashes, the last message shows a **"Restart Session"** button with a RotateCcw icon. Click it to restart.

**Retry a failed API call**
If an API error occurs, the message shows a **"Retry"** button. Click it to retry the last request.

**Generate CLAUDE.md**
Click **"Generate CLAUDE.md"** in the suggestion banner. The button shows "Generating..." while working.

**Disable trivia**
Click **"Disable trivia"** at the bottom of any trivia card. Trivia is disabled immediately across all sessions.

### States

- **Default (empty session):** Faded CodeMantis icon and "Send a message to start the conversation" text.
- **Streaming:** Assistant message text appears word by word with a blinking purple cursor. The Thinking Indicator is hidden while text is streaming.
- **Busy (tools running):** The Thinking Indicator shows animated dots, activity label, and elapsed time. Sub-agent panel may appear if agents are active.
- **Idle:** Session Status Bar shows "Idle" with gray dot. No thinking indicator visible.
- **Error/crash:** The last message includes a "Restart Session" or "Retry" button.

### Configuration

- **Settings -> General -> Trivia:** Toggle trivia cards on or off (`triviaEnabled`).
- **Settings -> General -> Default Context Window:** Affects the Context Meter in the sidebar and the percentage shown in the Session Status Bar.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Escape` | Interrupt Claude (stop generation) when a session is busy |

### Tips

1. The Activity Chip on each assistant message is a quick way to see what Claude did during that turn without switching to the Activity tab. Click it to jump to the Activity Feed for full details.
2. The Turn Stats Popover is the most detailed cost and performance view available per-turn. Use it to track which turns are most expensive.
3. When Claude is compacting context (approaching the context window limit), the Thinking Indicator shows "Compacting context..." and the status bar shows "Compacting" with a yellow dot. This is normal -- Claude is summarizing older context to make room for new conversation.

---

## Chapter 5: The Input Area

The Input Area is where you compose messages, attach files, select modes and models, and access slash commands. It sits at the bottom of the center panel, always visible during an active chat session.

### What You See

The Input Area is a rounded, bordered container with several zones:

**Attachment Bar** (top, only visible when attachments are present)
A horizontal row of attachment chips, each showing:

- An image thumbnail (36x36px) for image files, or a FileText icon for non-image files.
- The file name (truncated to 120px).
- The file size (e.g., "1.2 MB").
- A remove button (X) that appears on hover.

Click an image attachment to open a full-screen preview modal. Click a non-image attachment to open it with the system default application.

**Drop zone overlay**
When you drag files over the input area, the border turns accent-colored and the text "Drop files to attach" appears. The background gains a subtle accent tint.

**Text area**
A multiline text field with 3 default rows that auto-grows up to 8 rows as you type. Placeholder text shows:

- *"Ask Claude anything... (Enter)"* when idle (or the configured send shortcut).
- *"Ask Claude anything... even while Claude is busy! (Enter)"* when Claude is busy.
- *"Open a project to start..."* when no project is open (text area is disabled).

**Action bar** (below the text area)

Left side buttons:

| Button | Icon | Description |
|--------|------|-------------|
| **+ File** | Plus | Opens the system file picker to attach files |
| **@ Agent** | AtSign | Agent mention (placeholder for future feature) |
| **/ Cmd** | Slash (/) | Opens the Command Palette (same as typing "/" in the text area) |

Right side controls:

- **Mode Selector** -- Shows the current mode icon and label (e.g., Shield "Normal"). See Chapter 6.
- A vertical divider.
- **Model Selector** -- Shows the current model name (e.g., "Sonnet") with a dropdown chevron. Click to open a dropdown of available models.
- **Thinking Effort indicator** -- Three vertical bars showing thinking effort level (high = 3 bars lit, medium = 2, low = 1) with a text label ("High", "Medium", "Low"). Click to open Settings.
- **Send/Stop button:**
  - When idle: An accent-colored **"Send"** button with a Send icon and the shortcut label (e.g., "Enter" or "Cmd+Enter"). Disabled (grayed out) when the text area is empty and no attachments are present.
  - When busy: A red **"Stop"** button with a Square icon and "Esc" label.

**Keyboard shortcut hints**
A subtle centered row below the action bar showing: "Shift+Tab to switch mode" and "Cmd+/Cmd- to adjust font size".

### How to Open / Access

The Input Area is always visible at the bottom of the center panel when a session is active and the Chat Panel is showing (not Session History or Project Log).

### User Actions

**Type a message**
Click the text area and type. The text area auto-grows as you type more lines, up to a maximum of 8 lines. After that, it becomes scrollable.

**Send a message**
Press **Enter** to send (default), or **Cmd Enter** if you have changed the send shortcut in Settings. The message is sent, the text area clears, and the cursor remains in the text area.

**Insert a newline**
Press **Shift Enter** (if send shortcut is Enter) to insert a newline without sending. If send shortcut is Cmd Enter, plain Enter inserts a newline.

**Attach files via file picker**
Click the **"+ File"** button in the action bar. The system file picker opens with filters for Images, Documents, Code, and All Files. Select one or more files. They appear as chips in the Attachment Bar above the text area.

**Attach files via drag and drop**
Drag files from Finder onto the Input Area. The border highlights and "Drop files to attach" appears. Drop to attach.

**Attach images from clipboard**
Press **Cmd V** while an image is in your clipboard. The image is saved to the project directory and appears as an attachment chip with a thumbnail preview.

**Remove an attachment**
Hover over an attachment chip and click the X button.

**Preview an image attachment**
Click an image attachment chip to open a full-screen preview modal showing the image, file name, and file size. Click outside or the X button to close.

**Open the Command Palette**
Type **/** as the first character in the text area, or click the **"/ Cmd"** button, or press **Cmd /**. A dropdown appears above the text area listing available slash commands. See the Command Palette section below.

**Change session mode**
Click the mode selector in the action bar (or use `Cmd .` / `Shift Tab`). See Chapter 6.

**Change model**
Click the model name in the action bar to open a dropdown of available models. Each entry shows the model display name and a description. Click a model to switch. The current model is highlighted with accent color.

Available models (when the CLI provides them, or fallback list):

| Model | Description |
|-------|-------------|
| Default | Account default |
| Sonnet | Fast and capable |
| Opus (1M) | Extended context |
| Sonnet (1M) | Extended context |
| Haiku | Fastest |

**Stop Claude**
When Claude is busy, click the red **"Stop"** button or press **Escape** from anywhere in the app (when no modal is open). This sends an interrupt signal to the Claude CLI process.

**View/change thinking effort**
Click the effort bars indicator in the action bar. This opens the Settings modal where you can adjust thinking effort.

### Command Palette

When you type `/` as the first character in the input area (or click "/ Cmd" or press `Cmd /`), the Command Palette opens as a dropdown above the input area.

**What you see:**

- A scrollable list of available commands, each showing:
  - The command name in monospace accent font (e.g., `/compact`, `/status`).
  - A description in muted text.
  - An argument hint for the selected command (shown in italic).
  - A category badge: **"Skill"** (accent), **"Built-in"** (dim), or **"Opens CLI"** (yellow).
- Commands are filtered as you type after the slash.
- The currently highlighted command has a subtle background.

**How to use:**

1. Type `/` followed by a search query to filter commands (e.g., `/com` to find `/compact`).
2. Use **Arrow Up/Down** to navigate the list.
3. Press **Enter** to execute the selected command.
4. Press **Tab** to autocomplete the command name.
5. Press **Escape** to close the palette.
6. You can include arguments after the command name (e.g., `/search patterns in code`).

When no commands match your query, the palette shows *"No commands matching '/your-query'"*.

### States

- **Default:** Empty text area with placeholder text, Send button disabled.
- **Typing:** Text area expands, Send button becomes active (accent-colored).
- **With attachments:** Attachment Bar visible above text area with file chips.
- **Busy:** Send button replaced by red Stop button. Text area remains editable (you can queue a message).
- **No session:** Text area disabled, placeholder reads "Open a project to start..."
- **File drag over:** Border and background highlight in accent color, "Drop files to attach" text appears.
- **Command palette open:** Dropdown appears above input area showing filtered command list.

### Configuration

- **Settings -> General -> Send Shortcut:** Choose between "Enter to send" (Shift+Enter for newline) or "Cmd+Enter to send" (Enter for newline). Stored as `sendShortcut: "enter"` or `"cmd-enter"`.
- **Settings -> General -> Font Size:** Affects text area text size.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` or `Cmd Enter` | Send message (depends on Settings) |
| `Shift Enter` or `Enter` | Insert newline (depends on Settings) |
| `Escape` | Stop/interrupt Claude when busy |
| `Cmd /` | Open Command Palette |
| `Shift Tab` | Switch mode (cycles Normal -> Auto-Accept -> Plan) |
| `Cmd =` / `Cmd -` | Adjust font size |

### Tips

1. You can send messages even while Claude is busy -- they will be queued and processed after Claude finishes the current task.
2. Pasting a screenshot from your clipboard (Cmd+V) automatically saves it as a PNG in the project directory and attaches it. This is a fast way to share visual context with Claude.
3. Input drafts are preserved per-session. If you switch sessions and come back, your unsent draft text is restored.

---

## Chapter 6: Session Modes

Session modes control how Claude Code handles tool execution. The mode determines whether Claude asks for permission before making changes or acts autonomously. There are three modes.

### What You See

The **Mode Selector** is a small button in the Input Area action bar (bottom-right of the chat). It shows an icon and a text label:

| Mode | Icon | Color | Label |
|------|------|-------|-------|
| **Normal** | Shield | Gray (text-faint) | Normal |
| **Auto-Accept** | ShieldCheck | Green | Auto-Accept |
| **Plan** | Map | Yellow | Plan |

Click the button to open a popup menu above it listing all three modes. Each mode entry shows:

- The mode icon on the left.
- The mode name in bold.
- A description below:
  - Normal: *"Ask permission before edits"*
  - Auto-Accept: *"Accept all tool calls automatically"*
  - Plan: *"Plan only, no code changes"*

The currently active mode is highlighted with an accent background.

The active mode is also reflected in the **Session Status Bar** at the bottom of the Chat Panel:

- Auto-Accept shows a green ShieldCheck icon.
- Plan shows a yellow Map icon.
- Normal shows no icon (the default state).

### How to Open / Access

| Method | Action |
|--------|--------|
| Click | Click the Mode Selector button in the Input Area |
| Keyboard | Press `Cmd .` to cycle through modes: Normal -> Auto-Accept -> Plan -> Normal |
| Keyboard | Press `Shift Tab` (while focus is in the input area) to cycle modes |

### User Actions

**Switch modes**

1. Click the Mode Selector button to open the dropdown.
2. Click the desired mode.
3. The dropdown closes. The button updates to show the new mode's icon, label, and color.
4. The mode change is sent to the Claude Code CLI backend and takes effect immediately.

Or simply press `Cmd .` to cycle through modes without opening the dropdown.

### States

- **Normal (default):** Shield icon, gray color. Claude asks for permission before executing file edits, bash commands, and other tool operations. You will see the Tool Approval modal (Chapter 7) for each action.
- **Auto-Accept:** ShieldCheck icon, green color. All tool calls are approved automatically without user intervention. Claude can read, write, edit files, and run commands freely. Use this when you trust Claude's plan and want faster execution.
- **Plan:** Map icon, yellow color. Claude discusses and plans but does not execute any code changes. Tool calls that would modify files are blocked. Use this to have Claude outline an approach before committing to it.

### Configuration

Modes are set per-session and are not persisted across app restarts. Each new session starts in **Normal** mode.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd .` | Cycle through modes: Normal -> Auto-Accept -> Plan |
| `Shift Tab` | Cycle through modes (same order) |

### Tips

1. Start a session in Normal mode to review what Claude wants to do, then switch to Auto-Accept once you are comfortable with its approach. This gives you the best balance of control and speed.
2. Plan mode is especially useful when working on complex features. Have Claude plan the approach first, review the plan, then switch to Normal or Auto-Accept mode and ask Claude to execute it.
3. Mode changes sync to the Claude Code CLI backend immediately, so the behavior change takes effect on the very next tool call.

---

## Chapter 7: Tool Approvals & Questions

When Claude Code wants to perform an action on your project (in Normal mode), or when Claude needs your input to proceed, modal dialogs appear for your review and response.

### What You See

**Tool Approval Modal**

A centered dialog titled **"Approve Tool?"** with a yellow ShieldAlert icon. The subtitle reads: *"Claude wants to use a tool"* followed by the project name in accent color (e.g., "in **my-project**").

The modal contains:

- A **tool detail card** with:
  - A **ToolBadge** (colored icon indicating the tool type: read, write, edit, bash, etc.).
  - The **tool name** in bold (e.g., "Edit", "Bash", "Write").
  - A JSON preview of the **tool input** (file path, content, command, etc.) in a monospace, scrollable pre-formatted area (max 200px height).

- **Queue navigation** (only visible when multiple approvals are pending):
  - Left/right arrow buttons to navigate between queued approvals.
  - A counter showing "1/3" (current position / total).

- **Action buttons** at the bottom:
  - **"Always allow [tool name] in this session"** -- A text link on the left. Click to approve this tool call AND automatically approve all future uses of the same tool in this session.
  - **"Approve all (N)"** -- A bordered button showing the queue count. Only visible when multiple items are queued. Approves all pending tool calls at once.
  - **"Deny"** -- A neutral bordered button. Rejects the tool call.
  - **"Approve"** -- An accent-colored button. Approves the tool call.

**Question Modal**

A centered dialog titled **"Claude has a question"** with a purple MessageCircleQuestion icon.

The subtitle shows either:
- *"Please respond to continue"* (for a single question).
- *"Question 1 of 3"* (when Claude asks multiple questions in sequence).

The modal content varies by question type:

**Text question:** A paragraph with the question text, a 3-row text area for your answer, and Cancel/Submit buttons. Submit is disabled until you type something.

**Option question (single-select):** The question header in bold, a list of option buttons (each showing the option label and optional description), and a "Write your own response..." dashed-border button for free-text. Clicking an option immediately submits it and closes the modal.

**Option question (multi-select):** Same as single-select but with checkboxes next to each option. The text "Select one or more options" appears below the header. A "Submit (N selected)" button appears at the bottom. You must select at least one option.

For both option types, a "Write your own response..." button expands into a text area where you can type a custom answer instead of choosing from the options.

A close button (X) and Cancel button are available to decline to answer.

### How to Open / Access

These modals open automatically when Claude Code requests an approval or asks a question. You do not need to do anything to trigger them.

- **Tool Approval:** Opens whenever Claude tries to use a tool that requires permission (in Normal mode). Multiple approvals queue up and you can navigate between them.
- **Question Modal:** Opens when Claude uses the `AskUserQuestion` tool to gather information from you.

Neither modal opens in **Auto-Accept** mode (tool approvals are auto-approved) or when a tool has been marked "Always allow" for the current session.

### User Actions

**Approve a tool call**
Click the **"Approve"** button or press **Enter**. The tool executes and the modal advances to the next queued item (or closes if the queue is empty).

**Deny a tool call**
Click the **"Deny"** button or press **Escape**. The tool call is rejected with the reason "Denied by user". Claude will see this and may try an alternative approach.

**Approve all queued tool calls**
Click **"Approve all (N)"** or press **Cmd A** (when the modal is open). All pending tool calls are approved at once.

**Always allow a tool for this session**
Click the text link **"Always allow [tool name] in this session"** at the bottom-left. This approves the current call AND marks the tool as always-approved for the remainder of this session. Future calls to the same tool will not prompt you.

**Navigate the approval queue**
When multiple approvals are pending, use the **Left/Right arrow** buttons or press **Arrow Left / Arrow Right** keys to view different pending approvals.

**Answer a text question**
Type your answer in the text area and click **"Submit"** or press **Cmd Enter**.

**Answer a single-select question**
Click one of the option buttons. Your selection is submitted immediately.

**Answer a multi-select question**
Click checkboxes next to desired options, then click **"Submit (N selected)"** or press **Cmd Enter**.

**Provide a custom answer to an option question**
Click **"Write your own response..."** at the bottom of the options list. A text area appears. Type your answer and click **"Submit"** or press **Cmd Enter**. Press Escape or click "Back" to return to the option list.

**Decline to answer a question**
Click **"Cancel"** or the X button, or press **Escape**. Claude receives the response "User declined to answer".

### States

- **Single approval:** The modal shows one tool call. Queue navigation is hidden.
- **Multiple approvals:** Queue navigation arrows and counter are visible. "Approve all" button appears.
- **Text question:** A text area and Submit button are shown.
- **Single-select options:** Option buttons shown without checkboxes. Clicking submits immediately.
- **Multi-select options:** Option buttons shown with checkboxes. Submit button shows selection count.
- **Custom answer mode:** A text area replaces the option list with Back and Submit buttons.
- **Multi-question sequence:** The subtitle updates to show "Question X of Y" as you progress through the sequence.

### Configuration

There are no Settings for tool approvals. The behavior is determined by the session mode (Chapter 6):

- **Normal mode:** All tool calls require approval (except those marked "Always allow").
- **Auto-Accept mode:** All tool calls are approved automatically. The approval modal never appears.
- **Plan mode:** Tool calls that modify files are blocked at the CLI level. Non-modifying tools may still require approval.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Approve the current tool call |
| `Escape` | Deny the current tool call / Cancel a question |
| `Arrow Left` | Previous item in approval queue |
| `Arrow Right` | Next item in approval queue |
| `Cmd A` | Approve all queued tool calls |
| `Cmd Enter` | Submit answer to a question |

### Tips

1. Use "Always allow" for tools you trust (like file reads) to reduce interruptions while keeping approval required for more impactful tools (like Bash commands).
2. If you find yourself approving every tool call, consider switching to Auto-Accept mode (`Cmd .`) to let Claude work uninterrupted.
3. When Claude asks a multi-select question, you can always use "Write your own response..." to provide a more nuanced answer than the predefined options allow.

---

## Chapter 8: Sessions & History

Sessions are the core unit of work in CodeMantis. Each session is an independent conversation with Claude Code, tied to a specific project. You can run multiple sessions per project, switch between them instantly, and resume closed sessions from history.

### What You See

**Session Sub-Tabs**

The session sub-tab bar runs below the title bar (32px tall). Each session tab shows:

- A **status dot** (4px): green = idle, yellow with pulse = streaming/busy.
- A **model badge**: a small accent-colored rounded pill showing the model family name (e.g., "Sonnet", "Opus", "Haiku"), extracted from the full model identifier and capitalized.
- The **session name** (truncated if longer than the tab width of 180px max).
- A **close button** (X, 10px) that appears when the tab is hovered or active.

The active session tab has:
- An elevated background color.
- An accent-colored bottom border (2px).

Inactive tabs have:
- A transparent bottom border.
- Dimmed text that brightens on hover.

**Session Icons**

Each session is assigned one of 10 geometric symbols (hexagon, diamond, triangle, circle, square, diamond outline, filled hexagon, inverted triangle, bullseye, and filled circle) based on its `icon_index`. These appear in the Session History list to help visually distinguish sessions.

**Auto-Naming**

New sessions start with a default name (typically "Session" or auto-generated from the first message). Sessions can be renamed at any time.

**Session History Tab**

Located at the right end of the session sub-tab bar, the **"Session History"** button (History icon) switches the center panel from the chat to a full-height list of closed sessions.

The Session History view shows:

- A header bar with: History icon, **"Claude History"** title, session count badge, a **"Back"** button (ArrowLeft) to return to the active session, and a **"Refresh"** button (RefreshCw).
- A **search bar** (only visible when sessions exist) with a Search icon and placeholder text *"Search session conversations..."*. As you type, results are filtered with a debounce delay. A count shows matching sessions (e.g., "3 of 12"). A clear button (X) appears when filtering.
- A scrollable list of **History Cards**, each showing:
  - A session icon (one of the 10 geometric symbols).
  - The session name in bold.
  - A model badge (same style as session tabs).
  - A **"Saved"** badge (green, only if stored messages are available for restoration).
  - Relative time (e.g., "5m ago", "yesterday", "3d ago", "Mar 15").
  - Bullet-pointed **recent headlines** (snippets of what was discussed).
  - When searching: bullet-pointed **search result snippets** (highlighted matching content) replace the headlines.
  - A **"Resume"** button (Play icon) on the right. Shows a spinning loader while resuming.

**Project Log Tab**

Located next to Session History, the **"Project Log"** button (ScrollText icon) shows a chronological feed of all changelog entries across all sessions in the project.

Each Project Log entry shows:
- A category icon and badge (e.g., "Feature", "Fix", "Refactor").
- The session name that produced the entry.
- A timestamp.
- A headline in bold.
- A description in muted text.
- File change badges (file names shown as monospace pills).
- A copy button (appears on hover) to copy the entry to clipboard.

The header has a **"Back"** button and a **"Refresh"** button.

### How to Open / Access

| Method | Action |
|--------|--------|
| `Cmd N` | Create a new session in the current project |
| `Cmd W` | Close the current session (with confirmation) |
| `Cmd 1` through `Cmd 9` | Switch directly to session 1-9 |
| `Cmd Shift [` | Switch to the previous session |
| `Cmd Shift ]` | Switch to the next session |
| Plus (+) button | Click the + button in the session sub-tab bar |
| Double-click tab | Rename the session |
| Session History tab | Click "Session History" in the sub-tab bar |
| Project Log tab | Click "Project Log" in the sub-tab bar |

### User Actions

**Create a new session**
Press `Cmd N` or click the Plus (+) button in the session sub-tab bar. A new session tab appears and becomes active. A Claude Code CLI process starts in the background.

**Switch between sessions**
Click a session tab, or use `Cmd 1` through `Cmd 9` to switch by position, or use `Cmd Shift [` / `Cmd Shift ]` to navigate left/right.

**Rename a session**
Double-click the session tab name. An inline text input appears. Type the new name and press Enter to confirm, or Escape to cancel. The rename is also sent to the backend.

**Close a session**
Click the X button on a session tab (visible on hover or when the tab is active), or press `Cmd W`. A confirmation dialog appears: it shows the session name and asks you to confirm. Click **"Close"** or **"Cancel"**.

**View Session History**
Click the **"Session History"** tab at the right end of the session sub-tab bar. The center panel switches to the history list.

**Search across sessions**
In the Session History view, type in the search bar. Results filter in real-time (with a 300ms debounce). Matching sessions show content snippets instead of their usual headlines.

**Resume a closed session**
In the Session History view, click the **"Resume"** button on any history card. The button shows a spinner while the session is being restored. Once complete, the session tab appears and becomes active, with the conversation restored (if stored messages are available).

**Return to active session from history**
Click the **"Back"** button in the Session History header, or click any session tab in the sub-tab bar.

**View the Project Log**
Click the **"Project Log"** tab at the right end of the session sub-tab bar. The center panel shows a chronological feed of changelog entries.

**Copy a Project Log entry**
Hover over a Project Log card and click the Copy icon that appears. The headline and description are copied to your clipboard in both rich text and plain text formats.

### States

- **New session:** Tab appears with default name, green status dot, model badge. Chat panel shows empty state.
- **Active/busy session:** Yellow pulsing status dot. Thinking indicator visible in chat.
- **Idle session:** Green status dot. No thinking indicator.
- **Session History (empty):** Shows "No closed sessions for this project" with explanatory text.
- **Session History (loading):** Shows a spinner and "Loading session history..."
- **Session History (searching, no results):** Shows "No sessions match your search" with a "Clear search" link.
- **Project Log (empty):** Shows "No changelog entries yet" with a suggestion to enable changelog in Settings.
- **Project Log (loading):** Shows a spinner and "Loading project log..."

### Configuration

- **Settings -> Session Logs -> Save session conversations:** Controls whether session messages are persisted. See Chapter 9.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd N` | New session in current project |
| `Cmd W` | Close current session |
| `Cmd Shift [` | Previous session |
| `Cmd Shift ]` | Next session |
| `Cmd 1` - `Cmd 9` | Switch to session by number |

### Tips

1. The "Saved" badge on history cards tells you which sessions have stored messages that will be fully restored when resumed. Sessions without the badge can still be resumed (the Claude Code CLI remembers them), but the chat messages won't be replayed in the UI.
2. Use the search feature in Session History to find conversations from days or weeks ago. It searches across all message content, not just session names.
3. The Project Log is most useful when you have the changelog feature enabled (Settings -> Changelog). Without it, the log will be empty.

---

## Chapter 9: Session Persistence & Chat Logs

Session persistence saves the complete conversation history of each session so that when you resume a closed session, the full chat appears exactly as you left it. This is an opt-in feature that stores data locally on your Mac.

### What You See

The settings for session persistence are in the **Session Logs** tab within the Settings modal.

At the top is the section title **"Session Logs"** followed by an explanation:

> "Save the complete conversation of each session -- all messages exchanged between you and Claude Code. When you reopen a historical session, the full chat history is restored so you can pick up where you left off."

Below is a toggle:

- **"Save session conversations"** -- A toggle switch (on/off). The label reads *"Save session conversations"* with the subtitle: *"Store all messages when a session closes so they can be replayed later."*

When enabled, an additional option appears:

- **"Retention period"** -- A dropdown select with the following options:
  - 7 days
  - 14 days
  - 30 days (default)
  - 90 days
  - 1 year
  - Forever

Below the dropdown is a note: *"Session logs older than this are automatically cleaned up on app launch. Set to 'Forever' to keep all logs indefinitely."*

### How to Open / Access

1. Press `Cmd ,` or click the Settings gear icon in the title bar.
2. Navigate to the **"Session Logs"** tab within the Settings modal.

### User Actions

**Enable session persistence**
Toggle the **"Save session conversations"** switch to the ON position (accent-colored). From this point forward, every session you close will have its complete message history saved.

**Disable session persistence**
Toggle the switch to the OFF position. New sessions will no longer be saved. Previously saved sessions remain in storage until their retention period expires.

**Change the retention period**
Click the **"Retention period"** dropdown and select a duration. Options are:

| Value | Meaning |
|-------|---------|
| 7 days | Logs older than 7 days are deleted on app launch |
| 14 days | Logs older than 14 days are deleted on app launch |
| 30 days | Logs older than 30 days are deleted on app launch (default) |
| 90 days | Logs older than 90 days are deleted on app launch |
| 1 year | Logs older than 1 year are deleted on app launch |
| Forever | Logs are never automatically deleted |

Cleanup runs automatically when CodeMantis launches. It does not run while the app is open.

### States

- **Enabled (default):** Toggle is on (accent-colored). Retention period selector is visible below. Sessions are saved on close and restored on resume.
- **Disabled:** Toggle is off. Retention period selector is hidden. Sessions are not saved. The Session History view still shows sessions (from the Claude Code CLI's own history), but the "Saved" badge won't appear and full message restoration won't be available.

### Configuration

- **Settings -> Session Logs -> Save session conversations:** Toggle on/off. Default: on (`sessionLogsEnabled: true`).
- **Settings -> Session Logs -> Retention period:** Select duration. Default: 30 days (`sessionLogsRetentionDays: 30`).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd ,` | Open Settings (then navigate to Session Logs tab) |

### Tips

1. Session persistence is enabled by default with a 30-day retention period. If you are working on sensitive projects, be aware that conversation content is stored locally in the CodeMantis database.
2. All data is stored locally on your Mac in the CodeMantis application data directory. Nothing is sent to any external server. Your conversations remain completely private.
3. When you resume a session with saved messages, the chat shows a "Previous session" divider between restored messages and new ones, so you can clearly see where the old conversation ended and the new one begins.
