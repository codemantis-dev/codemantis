<!--
  CodeMantis Complete User Guide — Part V, Part VI & Part VII
  Generated from source code by Claude Code
  Date: March 2026
  App Version: 1.0.0
-->

## Part V: Sidebar

---

### Chapter 19: File Tree

The file tree in the left sidebar shows your project's directory structure. You can browse files, create new ones, rename, delete, and interact with files in powerful ways through a rich context menu.

#### What You See

The file tree occupies the main area of the left sidebar, below a "Files" header bar and above the Git Status card and Context Meter.

**Header bar (36px):**
- A folder-tree icon and the label **"Files"** (left side).
- Three action buttons (right side, visible when a project is open):
  - **New File** (file-plus icon): Creates a new file at the project root.
  - **New Folder** (folder-plus icon): Creates a new folder at the project root.
  - **Refresh** (refresh icon): Reloads the file tree. Spins while loading.

**File tree body (scrollable):**
A hierarchical list of files and folders:
- **Folders** show a chevron (▸ collapsed, ▾ expanded), a folder icon, and the folder name. Root-level folders are auto-expanded; deeper folders start collapsed. Click a folder to expand/collapse it.
- **Files** show a file icon (colored by extension) and the file name. Click a file to open it in the File Viewer (right panel).

**File icon colors by extension:**

| Extension | Color |
|-----------|-------|
| .ts, .tsx | Blue (#3178c6) |
| .js, .jsx | Yellow (#f7df1e) |
| .json | Gray (#a1a1aa) |
| .md | Amber (#fbbf24) |
| .rs | Orange (#dea584) |
| .css | Blue (#60a5fa) |
| .html | Red (#f87171) |
| .py | Blue (#3572A5) |
| Other | Default dim color |

**Special files** — `CLAUDE.md` and the `.claude` folder are highlighted in yellow with bold text, making them easy to spot.

**Inline rename input:** When renaming, an inline text input replaces the file/folder name. For files, the name (without extension) is pre-selected. Press Enter to confirm, Escape to cancel.

**Inline new file/folder input:** When creating a new item, an inline input appears at the target location with placeholder text ("filename" or "folder name"). Press Enter to create, Escape to cancel. The parent folder auto-expands to show the input.

**Context menu (right-click):**
The context menu varies based on what you right-click:

**Right-click a file:**
- New File / New Folder (in the same parent directory)
- Add to Main Chat (attach as a file attachment)
- Add to Assistant (expandable submenu with all assistant tabs)
- Add Relative Path to Chat / Add Absolute Path to Chat
- Open (in File Viewer)
- Duplicate / Rename / Delete
- Reveal in Finder
- Copy Contents / Copy Path / Copy Relative Path
- Expand All Folders / Collapse All Folders

**Right-click a folder:**
- New File / New Folder (inside this folder)
- Add Relative Path to Chat / Add Absolute Path to Chat
- Rename / Delete (with confirmation: "Delete folder and all its contents?")
- Reveal in Finder
- Copy Path / Copy Relative Path
- Expand All Folders / Collapse All Folders

**Right-click empty space:**
- New File / New Folder (at project root)
- Expand All Folders / Collapse All Folders

You can also right-click the "Files" header bar to open the root-level context menu.

#### How to Open / Access

The file tree is always visible in the left sidebar when a project is open. Toggle the sidebar with ⌘B.

#### User Actions

**Browse the file tree**
Click folders to expand/collapse them. Scroll to navigate large projects.

**Open a file**
Click a file name → The file opens in the File Viewer (right panel, Files tab). See Chapter 10 for details.

**Create a new file**
Click the file-plus icon in the header, or right-click → New File → Type a filename in the inline input → Press Enter. The file is created and auto-opened in the File Viewer.

**Create a new folder**
Click the folder-plus icon in the header, or right-click → New Folder → Type a name → Press Enter.

**Rename a file or folder**
Right-click → Rename → The name becomes an inline editable input. Edit the name → Press Enter to confirm, Escape to cancel.

**Delete a file or folder**
Right-click → Delete → A browser confirmation dialog appears. For folders: "Delete folder '{name}' and all its contents? This cannot be undone." Confirm to delete. Any File Viewer tabs for deleted files are automatically closed.

**Duplicate a file**
Right-click a file → Duplicate → A copy is created in the same directory.

**Reveal in Finder**
Right-click → Reveal in Finder → The file or folder is shown in macOS Finder.

**Copy file contents to clipboard**
Right-click a file → Copy Contents → The full file text is copied.

**Copy path to clipboard**
Right-click → Copy Path (absolute) or Copy Relative Path (relative to project root).

**Insert path into chat input**
Right-click → Add Relative Path to Chat or Add Absolute Path to Chat → The path is appended to the main chat input area.

**Attach file to chat**
Right-click a file → Add to Main Chat → The file is added as an attachment to the current session's chat input.

**Attach file to an assistant**
Right-click a file → Add to Assistant → Select an assistant tab → The file is attached to that assistant's input.

**Expand or collapse all folders**
Right-click → Expand All Folders (opens every folder) or Collapse All Folders (closes all folders).

**Refresh the file tree**
Click the refresh icon in the header → The tree reloads from disk. This happens automatically when Claude modifies files or when you press Enter in the terminal.

#### States

- **No project open:** "No project open" centered text.
- **Loading:** "Loading..." text in the tree area. The refresh icon spins.
- **Empty directory:** "Empty directory" text.
- **Populated:** Hierarchical file/folder list with icons and colors.

#### Configuration

The file tree respects `.gitignore` and excludes common directories like `node_modules`, `.git`, etc. (handled by the Rust backend's `readFileTree` command).

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ B | Toggle sidebar visibility |

#### Tips

1. **Right-click is your power tool.** The context menu gives you 15+ actions — from attaching files to chat, to copying paths, to creating new files.
2. **CLAUDE.md and .claude are highlighted in yellow** so you can always find your AI configuration files quickly.
3. **The tree auto-refreshes** when Claude edits files or when you run commands in the terminal, so it always reflects the current state of your project.

---

### Chapter 20: Git Status

The Git Status card at the bottom of the sidebar shows a compact summary of your project's git state — the current branch, uncommitted changes, last commit time, and last push time.

#### What You See

The Git Status card appears below the file tree and above the Context Meter. It is only visible when the project is a git repository.

**Row 1 — Branch and changes:**
- **Branch icon** (accent color) + **branch name** (bold, e.g., "main", "feature/auth"). Shows "detached" if in a detached HEAD state.
- **Uncommitted changes count** (right side): A file-edit icon + number in yellow (e.g., "3"). Only visible when there are uncommitted changes.

**Row 2 — Timestamps:**
- **Last commit** (left): A clock icon + relative time (e.g., "5m ago", "2h ago", "3d ago", "1mo ago", "just now").
- **Last push** (right): An upload icon + relative time. Shows "never" if the project has never been pushed.

Timestamps update every 30 seconds to keep the relative times accurate.

#### How to Open / Access

The Git Status card is always visible at the bottom of the sidebar when the project is a git repository. It is hidden for non-git projects.

#### User Actions

The Git Status card is read-only — it provides information at a glance. There are no interactive elements.

#### States

- **Clean working tree:** No uncommitted changes indicator. Timestamps show normally.
- **Dirty working tree:** Yellow file-edit icon + count of uncommitted changes. Git status polls more frequently (every 5 seconds vs. 10 seconds for clean repos).
- **Not a git repo:** The card is completely hidden.
- **Detached HEAD:** Branch name shows "detached".
- **Never pushed:** Last push shows "never".

#### Configuration

Git status is polled automatically:
- Every **5 seconds** when uncommitted changes are present.
- Every **10 seconds** when the working tree is clean.
- **Immediately** when the window regains focus (e.g., after switching back from another app).

No user-configurable settings.

#### Keyboard Shortcuts

None — the Git Status card is informational only.

#### Tips

1. **Watch the yellow change count** — it tells you at a glance whether you have uncommitted work. This is especially useful after Claude makes edits.
2. **The "last push" time** helps you remember whether you've pushed recent changes to the remote repository.
3. **Git status refreshes automatically** so you don't need to do anything — it's always up to date.

---

## Part VI: Settings & Configuration

---

### Chapter 21: Settings — General

The General settings tab controls the app's appearance, text size, input behavior, and several feature toggles.

#### What You See

The Settings modal opens as a centered dialog with a tab sidebar on the left. The **General** tab is the default tab.

**Theme selection:**
A 3×2 grid of theme buttons. Each button shows a color swatch (dark circle for dark themes, light circle for light themes) and the theme name. The active theme has an accent border.

Available themes:

| Theme | Type |
|-------|------|
| Midnight | Dark |
| Ocean | Dark |
| Ember | Dark |
| Dawn | Light |
| Sand | Light |
| Arctic | Light |

**Settings rows (below the theme grid):**

| Setting | Control | Description |
|---------|---------|-------------|
| Font Size | Number input (10-20) | Controls text size throughout the app. Also adjustable via ⌘= / ⌘- / ⌘0 |
| Send Shortcut | Dropdown: "Cmd + Enter" or "Enter" | Which key sends messages in the chat |
| Show trivia while waiting | Toggle switch | Display fun facts while Claude is working. Description: "Display fun facts while Claude is working" |
| Auto-open edited files | Toggle switch | Open files in the viewer when Claude edits them. Description: "Open files in the viewer when Claude edits them" |
| Default context window | Button group: "200K" or "1M" | Fallback context size when the CLI doesn't report it. Description: "Fallback context size when CLI doesn't report it" |
| Show welcome screen on launch | Toggle switch | Display the getting-started screen when the app opens. Description: "Display the getting-started screen when the app opens" |

Toggle switches use an accent-colored track when enabled and a bordered gray track when disabled.

#### How to Open / Access

- Click the **gear icon** in the title bar.
- Press ⌘,

#### User Actions

**Change the theme**
Click a theme button → The app's entire color scheme changes immediately. The theme persists across app restarts.

**Adjust font size**
Change the number in the Font Size input (range: 10-20px) → Text throughout the app resizes. Default is 13px.
Or use keyboard shortcuts: ⌘= (zoom in), ⌘- (zoom out), ⌘0 (reset to 13px). A toast notification confirms the new size.

**Change the send shortcut**
Select "Cmd + Enter" or "Enter" from the dropdown → The send behavior in the chat input changes accordingly.

**Toggle trivia**
Click the toggle → Enables or disables fun fact cards in the thinking indicator (see Chapter 4).

**Toggle auto-open files**
Click the toggle → When enabled, files automatically open in the File Viewer whenever Claude reads or writes them.

**Set default context window**
Click "200K" or "1M" → Sets the fallback context window size used when the Claude CLI doesn't report the actual context size.

**Toggle welcome screen**
Click the toggle → Controls whether the Welcome Screen appears on app launch.

#### States

All settings take effect immediately and are persisted to the database automatically.

#### Configuration

Settings are stored in the app's SQLite database at `~/Library/Application Support/dev.codemantis.app/`.

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘ , | Open Settings |
| ⌘ = | Zoom in (increase font size) |
| ⌘ - | Zoom out (decrease font size) |
| ⌘ 0 | Reset zoom (13px) |

#### Tips

1. **Try all six themes** to find the one that suits your environment. The dark themes (Midnight, Ocean, Ember) are great for extended coding sessions; the light themes (Dawn, Sand, Arctic) work well in bright environments.
2. **Sand is the default theme** — if you want a dark theme, switch immediately after first launch.
3. **Auto-open files** is disabled by default. Enable it if you want to see every file Claude touches in the File Viewer automatically — useful for closely monitoring changes.

---

### Chapter 22: Settings — AI Providers

The AI Providers tab is where you configure API keys for OpenAI, Google Gemini, and Anthropic. These keys power the multi-AI assistants, AI changelog, and SpecWriter features. Claude Code itself does **not** need an API key — it uses your existing Claude Pro/Max subscription.

#### What You See

**Section header:**
"AI Providers" with the description: "Configure API keys and token pricing for each provider. These are shared across Changelog and Assistant features."

**API key inputs:**
One row per provider, each showing:
- The **provider name** as a label (e.g., "OpenAI", "Google Gemini", "Anthropic").
- A **password input** field with placeholder "Enter {Provider} API key". The key is masked.
- A **Test** button: Click to validate the key against the provider's API.

**Test results:**
- **Success:** Green text "API key is valid" appears below the input.
- **Error:** Red text "Invalid API key or connection error" appears below.
- **Testing:** The button reads "Testing..." and is disabled.

**Model Pricing section (below API keys):**
A table organized by provider showing cost per 1M tokens in USD for each model. Each model has:
- The model name (e.g., "GPT-4o", "Gemini 2.5 Flash", "Claude Sonnet 4").
- **Input** price field (editable number input).
- **Output** price field (editable number input).

These prices are used to calculate cost estimates in the Assistant tabs and API Logs.

#### How to Open / Access

Settings → **AI Providers** tab.

#### User Actions

**Enter an API key**
Type or paste your API key into the password field for a provider → The key is saved automatically.

**Test an API key**
Click **Test** → The app makes a test API call to verify the key. A success or error message appears below.

**Adjust model pricing**
Edit the input/output price fields for any model → Pricing updates are used for cost calculations in assistant sessions and API logs.

#### States

- **No key set:** Empty password field. Features requiring this provider show "No API key" or "No key" and are disabled.
- **Key set:** The password field shows dots. The Test button is enabled.
- **Testing:** Button reads "Testing..." and is disabled.
- **Valid key:** Green "API key is valid" message.
- **Invalid key:** Red "Invalid API key or connection error" message.

#### Configuration

| Feature | Requires API Key? |
|---------|------------------|
| Claude Code (main chat) | No — uses Claude subscription |
| Multi-AI Assistants (OpenAI, Gemini, Anthropic) | Yes |
| AI Changelog | Yes |
| SpecWriter | Yes |

#### Keyboard Shortcuts

None specific to this tab.

#### Tips

1. **Claude Code does not need an API key.** It uses your existing Claude Pro or Max subscription. API keys are only for the additional AI features.
2. **Test your keys** after entering them to verify they work before relying on assistant or changelog features.
3. **Model pricing** comes pre-filled with reasonable defaults. Update it if your pricing differs (e.g., enterprise agreements or volume discounts).

---

### Chapter 23: Settings — Assistant, Changelog, Terminal, Quick Commands

This chapter covers four settings tabs that configure specific features.

#### What You See

##### Assistant Settings Tab

**Default Provider:**
A dropdown to select the default AI provider for new assistant tabs. Options: Claude Code, OpenAI, Google Gemini, Anthropic. Description: "New assistant tabs will use this provider by default."

**Default Models:**
A per-provider model selector. Each API provider (OpenAI, Gemini, Anthropic) has a dropdown to choose which model new assistants will use. Providers without an API key have their dropdown disabled (dimmed) with tooltip "Set API key in Settings > AI Providers."

**Shortcuts:**
A list of saved prompt shortcuts. Each shortcut has:
- A **Name** input (e.g., "Code Review").
- A **Prompt** textarea (the full prompt text).
- A **delete button** (×) to remove the shortcut.
- An **"+ Add shortcut"** link at the bottom.

Description: "Saved prompts available as quick-access chips in the assistant panel."

##### Changelog Settings Tab

**Enable auto-changelog:**
A toggle switch. Description: "Auto-generate changelog entries after each coding turn using an LLM provider."

When enabled, additional options appear:

**Provider:**
A dropdown to select the LLM provider: Gemini, OpenAI, or Anthropic.

**Model:**
A dropdown showing available models for the selected provider.

**System Prompt:**
A monospace textarea showing the prompt used to generate changelog entries. A **Reset** button (refresh icon + "Reset") restores the default prompt. Help text: "The AI receives this as a system instruction. It should ask for JSON output with headline, description, and category fields."

##### Terminal Settings Tab

**Shell:**
A text input for the shell path. Placeholder: "Default ($SHELL)". Leave empty to use your system's default shell.

**Font Size:**
A number input (10-20) for the terminal font size. Independent from the app's main font size.

##### Quick Commands Settings Tab

A list of configurable command presets shown in the terminal toolbar.

Each command has:
- A **Label** input (e.g., "Build", "Test").
- A **Command** input in monospace (e.g., "pnpm build", "pnpm test").
- A **delete button** (×) to remove the command.
- An **"+ Add command"** link at the bottom.

Description: "Commands available in the terminal toolbar for quick execution."

Default commands: Build (`pnpm build`), Test (`pnpm test`), Lint (`pnpm lint`), Dev (`pnpm dev`).

#### How to Open / Access

Settings → Select the **Assistant**, **Changelog**, **Terminal**, or **Quick Commands** tab.

#### User Actions

**Add an assistant shortcut**
Click "+ Add shortcut" → Fill in a name and prompt → The shortcut appears as a pill button in the assistant panel.

**Remove an assistant shortcut**
Click the × button next to a shortcut → It is removed from the list and from the assistant panel.

**Enable changelog**
Toggle the "Enable auto-changelog" switch → Configure the provider and model.

**Customize the changelog prompt**
Edit the textarea → The AI will use your custom prompt. Click "Reset" to restore the default.

**Change terminal shell**
Type a shell path (e.g., `/bin/zsh`, `/opt/homebrew/bin/fish`) → New terminals use this shell.

**Add a quick command**
Click "+ Add command" → Enter a label and command → The button appears in the terminal's Quick Commands bar.

**Remove a quick command**
Click the × button → The command is removed from the terminal toolbar.

#### States

All settings take effect immediately and persist across restarts.

#### Configuration

All settings in these tabs are stored in the app's SQLite database.

#### Tips

1. **Quick Commands are project-agnostic.** Set them to match your most common project setup (e.g., `pnpm dev`, `cargo test`, `python manage.py runserver`).
2. **The changelog prompt is customizable.** If you want changelog entries in a specific format (e.g., conventional commits style), edit the system prompt.
3. **Assistant shortcuts** save you from retyping common prompts. Create shortcuts for "Review this code", "Explain this function", or "Write tests for this" to speed up your workflow.

---

### Chapter 24: Settings — Shortcuts & API Logs

This chapter covers the keyboard shortcuts reference and the API activity log viewer.

#### What You See

##### Shortcuts Tab

A read-only reference listing every keyboard shortcut in CodeMantis, organized by category:

**Global:**

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ N | New project from template |
| ⌘ O | Open existing project |
| ⌘ , | Settings |
| ⌘ ⇧ M | MCP Servers |
| ⌘ / | CLI Overlay |
| ⌘ . | Toggle mode (Normal/Auto/Plan) |
| ⌘ = | Zoom in (increase font size) |
| ⌘ - | Zoom out (decrease font size) |
| ⌘ 0 | Reset zoom |

**Sessions:**

| Shortcut | Action |
|----------|--------|
| ⌘ N | New session in current project |
| ⌘ W | Close current session |
| ⌘ ⇧ [ | Previous session |
| ⌘ ⇧ ] | Next session |
| ⌘ 1-9 | Switch to session by number |

**Panels:**

| Shortcut | Action |
|----------|--------|
| ⌘ B | Toggle sidebar |
| ⌘ ⇧ A | Focus activity feed |
| ⌘ ⇧ F | Focus file viewer |
| ⌘ ⇧ T | Focus terminal |
| ⌘ ⇧ L | Focus changelog |

**Preview:**

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ P | Toggle Preview Window |
| ⌘ R | Refresh preview (when focused) |
| ⌘ ⇧ C | Toggle Console Drawer (when focused) |

**SpecWriter:**

| Shortcut | Action |
|----------|--------|
| ⌘ ⇧ B | Toggle SpecWriter slide-over |

**Editor:**

| Shortcut | Action |
|----------|--------|
| ⌘ S | Save file |

Each shortcut is displayed with the description on the left and the key combination in a monospace styled badge on the right.

##### API Logs Tab

A full activity log of all API calls made by CodeMantis (for assistants, changelog, and SpecWriter — not Claude Code itself).

**Tab switcher:**
Two tabs: **Cost Log** and **Error Log** (with error count badge, e.g., "Error Log (3)").

**Cost Log tab:**

*Summary card (when calls exist):*
- **Total Cost** (large, right-aligned)
- **Total Calls** count
- **Per-provider breakdown**: Each provider with its cost and call count.

*Log list:*
Each entry shows:
- A **status dot**: green (success) or red (error).
- **Timestamp** (e.g., "Mar 15, 2:34 PM").
- **Provider** name (capitalized).
- **Model** (monospace).
- **Token count** (input + output).
- **Cost** (bold, right-aligned).

*Empty state:* Chart icon + "No API calls logged yet" + "Calls will appear here when API providers are used."

**Error Log tab:**

*Summary card (when errors exist):*
- **Total Errors** count (in red).
- **Per-provider breakdown** of error counts.

*Error list:*
Each entry is a clickable row showing:
- Red status dot.
- Timestamp, provider, model.
- Error message (red, monospace, truncated).
- Click to expand → Full error message in a red-tinted scrollable box.

*Empty state:* Warning triangle icon + "No errors logged" + "API errors will appear here when they occur."

**Footer note:** "Logs older than 5 days are automatically deleted."

#### How to Open / Access

Settings → **Shortcuts** tab or **API Logs** tab.

#### User Actions

**View keyboard shortcuts**
Open Settings → Shortcuts tab → Browse the complete list organized by category.

**View API cost history**
Open Settings → API Logs tab → The Cost Log shows every API call with timestamps, providers, models, token counts, and costs.

**View API errors**
Switch to the Error Log tab → Click an error entry to expand and see the full error message.

#### States

- **API Logs loading:** "Loading..." text.
- **Cost Log empty:** "No API calls logged yet."
- **Error Log empty:** "No errors logged."
- **Populated:** Scrollable list of log entries with summary card.

#### Configuration

Logs are stored in the app's SQLite database. Logs older than 5 days are automatically cleaned up when the API Logs tab is opened.

#### Tips

1. **The Shortcuts tab is a quick reference** — open it anytime you forget a keyboard shortcut (⌘, → Shortcuts).
2. **Use API Logs to track spending** across all AI providers. The summary card gives you a quick overview of total cost and per-provider breakdown.
3. **Check the Error Log** when an assistant or changelog isn't working — it shows the exact API error message, which is usually the fastest way to diagnose issues (expired keys, rate limits, invalid models).

---

## Part VII: Context & Status

---

### Chapter 25: Context Meter & Token Management

The Context Meter shows how much of Claude's context window has been used in the current session. It helps you understand when a conversation is getting long and when you might want to start a new session.

#### What You See

The Context Meter sits at the very bottom of the left sidebar, below the Git Status card.

**Session stats (top line, when turns exist):**
- **Turn count** + **total tokens** (e.g., "5 turns / 12.3K tok")
- **Total cost** (right-aligned, monospace, e.g., "$0.42") — only shown when cost is greater than zero.

**Context bar (below stats):**
- **Label:** "CONTEXT" (uppercase, small, dim, left side)
- **Usage text:** "{used} / {max}" (right side, e.g., "245K / 1M")
- **Progress bar:** A thin horizontal bar (4px) that fills from left to right:
  - **Accent color** (purple): 0-70% usage — normal.
  - **Yellow**: 70-90% usage — getting full.
  - **Red**: 90-100% usage — nearly full, Claude may start forgetting earlier messages.

Token counts are formatted for readability: values over 1M show as "1.2M", values over 1000 show as "245K", smaller values show as-is.

**Turn Stats Popover (in the chat panel):**
After each assistant message, a small clickable badge shows the turn's total tokens and cost. Click it to open a detailed popover:

| Field | Description |
|-------|-------------|
| Duration | Total time for this turn |
| API time | Time spent in API calls only |
| API calls | Number of API calls in this turn |
| Cost | USD cost for this turn |
| Input tokens | Tokens in the prompt |
| Output tokens | Tokens in the response |
| Cache read | Tokens read from cache |
| Cache write | Tokens written to cache |
| Total tokens | Sum of all token types |

The popover has a divider separating timing/cost info from the token breakdown. Click outside to close it.

#### How to Open / Access

- The Context Meter is always visible at the bottom of the sidebar.
- Turn Stats Popovers appear below each completed assistant message in the chat.

#### User Actions

**Check context usage**
Glance at the Context Meter progress bar → Accent = plenty of room, yellow = getting full, red = nearly full.

**View detailed turn stats**
Click the token/cost badge below any assistant message → The popover opens with a full breakdown of tokens, cost, and duration. Click outside to dismiss.

#### States

- **Empty session (no turns):** Only the "CONTEXT" label and empty progress bar are shown. No stats line.
- **Active session:** Stats line shows turn count, tokens, and cost. Progress bar fills based on usage.
- **High usage (70-90%):** Progress bar turns yellow. The Session Status Bar also shows context percentage in yellow.
- **Critical usage (90%+):** Progress bar turns red. The Session Status Bar shows context percentage in red. Claude may begin losing context of earlier messages.

#### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| Default context window | Settings → General | Fallback context size: 200K or 1M. Used when the CLI doesn't report the actual value. |

#### Keyboard Shortcuts

None — the Context Meter is informational only.

#### Tips

1. **Start a new session** when context usage exceeds 80%. Claude becomes less effective at recalling earlier conversation details as the context fills up.
2. **Use `/compact`** to reduce token usage by summarizing earlier conversation history — this can free up context without starting a new session.
3. **The turn stats popover** is useful for understanding which messages consumed the most tokens — large code outputs or long conversations can fill context quickly.

---

### Chapter 26: Error Recovery & Troubleshooting

CodeMantis is designed to handle errors gracefully. This chapter covers every error state you might encounter and how to recover from each one.

#### What You See

##### Session Status Bar Indicators

The Session Status Bar at the bottom of the chat panel (see Chapter 4) shows several indicators that help diagnose issues:

- **Status**: "Idle" (gray dot), "Busy" (pulsing green dot), or "Compacting" (pulsing yellow dot).
- **Rate limit utilization**: "RL XX%" appears when rate limit usage exceeds 50%. Turns yellow at 80%.
- **Context percentage**: "ctx XX%" with color coding (normal, yellow at 70%, red at 90%).
- **Mode icon**: Shield (Normal), ShieldCheck (Auto-Accept), Map (Plan).

##### Confirm Close Modal

When closing a session or project, a confirmation dialog appears:

- **Close session:** Title: "Close session '{name}'?" Description: "The Claude CLI process will be stopped."
- **Close project:** Title: "Close project '{name}'?" Description: "All N sessions and their CLI processes will be stopped."
- Buttons: **Cancel** (secondary) / **Close** (red).
- Keyboard: Enter = Close, Escape = Cancel.

##### Plan Complete Modal

When a Plan mode conversation finishes, a dialog appears:

- **Title:** "Plan Complete"
- **Description:** "Claude has finished planning. Ready to implement?"
- **Auto-Accept toggle:** A checkbox labeled "Enable Auto-Accept" with description "Approve all tool calls automatically during implementation."
- **Buttons:** "Later" (secondary) / "Implement Now" (primary accent).
- Keyboard: Enter = Implement Now.

Clicking "Implement Now" sends "Go ahead, implement the plan." to Claude and optionally switches to Auto-Accept mode.

##### Error Toast Notifications

Errors throughout the app are surfaced as toast notifications — small temporary messages that appear at the top of the screen. They show the error message in red and automatically dismiss after a few seconds.

##### Session Crash Recovery

If a Claude Code session crashes:
- The last assistant message displays a **"Restart Session"** button (blue, with a refresh icon).
- Click it to start a new Claude Code process for the same project.
- Your files are untouched — only the conversation state is affected.

##### API Error Recovery

If an API error occurs during a Claude response:
- The error message displays a **"Retry"** button (blue, with a refresh icon).
- Click it to retry the failed request.

##### Rate Limiting

When you hit Claude's rate limit:
- The Session Status Bar shows "RL XX%" in yellow (at 80%+).
- Claude Code handles rate limiting internally with automatic retries and backoff.
- A countdown may appear in the chat while waiting for the rate limit to reset.

##### Stale Connection Detection

If no events arrive from Claude for 30+ seconds while a session is marked as busy:
- The project tab dot turns solid yellow (instead of pulsing green).
- This indicates the session may be unresponsive — consider closing and restarting it.

#### How to Open / Access

Error states appear automatically when issues occur. No manual navigation required.

#### User Actions

**Restart a crashed session**
Click the **"Restart Session"** button on the crash message → A new Claude CLI process starts for this project. The previous conversation is gone, but your files remain unchanged.

**Retry after an API error**
Click the **"Retry"** button on the error message → The failed request is retried.

**Handle rate limiting**
Wait for the rate limit to reset (usually 1-5 minutes). The status bar shows the current utilization. Claude Code automatically retries once the limit clears.

**Confirm or cancel closing**
In the Confirm Close dialog: Click **Close** or press Enter to confirm. Click **Cancel** or press Escape to keep the session/project open.

**Implement a completed plan**
In the Plan Complete dialog: Optionally check "Enable Auto-Accept" → Click **"Implement Now"** or press Enter. Or click **"Later"** to dismiss and implement manually.

**Recover from a stale session**
If the project tab shows a solid yellow dot for an extended period: Close the session (⌘W → confirm) and create a new one (⌘N). You can resume the conversation from the History tab (see Chapter 8).

#### States

- **Healthy:** Green pulsing dot (busy) or gray dot (idle). Normal operation.
- **Compacting:** Yellow pulsing dot. Claude is compacting context — temporary, resolves automatically.
- **Rate limited:** "RL XX%" in the status bar. Automatic retry in progress.
- **Stale:** Solid yellow dot on project tab. No events for 30+ seconds.
- **Crashed:** "Restart Session" button on the last message. Session terminated.
- **API error:** "Retry" button on the error message. Single request failed.

#### Configuration

No user-configurable error handling settings. Error behavior is built into the app.

#### Data Safety

- **Your files are never at risk.** If CodeMantis crashes or a session dies, your project files remain exactly as they were at the last edit.
- **Sessions are preserved server-side.** Closed sessions can be resumed from the History tab (see Chapter 8) because the conversation history lives on Claude's servers.
- **The database is backed up automatically.** Before the app starts, `codemantis.db` is copied to `codemantis.db.backup`.
- **App data location:** `~/Library/Application Support/dev.codemantis.app/`

#### Tips

1. **Don't panic on crashes.** Your project files are always safe. Just click "Restart Session" and continue where you left off — or resume from History.
2. **If a session feels stuck** (solid yellow dot for 30+ seconds), close it and start a new one. You can resume the previous conversation from the History tab.
3. **Rate limiting is normal** on heavy usage. The app handles it automatically with retries — just wait a moment and it will resume.
