<!-- CodeMantis Complete User Guide — Parts V, VI & VII (Chapters 22-31) -->
<!-- Generated from source code | App Version: 0.9.1 | Date: 2026-03-26 -->

---

# Part V: Sidebar

---

## Chapter 22: File Tree

The File Tree provides a visual representation of your project's directory structure directly inside CodeMantis. It lets you browse, open, create, rename, duplicate, and delete files and folders without leaving the app.

### What You See

The sidebar occupies the left edge of the application window. At the top is a header bar labeled **"Files"** with a folder-tree icon. To the right of the label sit three small icon buttons:

- **New File** (FilePlus icon) -- creates a new file at the project root
- **New Folder** (FolderPlus icon) -- creates a new folder at the project root
- **Refresh** (rotating arrows icon) -- manually reloads the file tree; the icon spins while loading

Below the header, the tree displays your project's files and folders in a hierarchical, indented list. Each item shows:

- **Folders:** A chevron arrow (right when collapsed, down when expanded) followed by a folder icon and the folder name. Folder icons are tinted in a muted color, except for special entries like `CLAUDE.md` and `.claude`, which appear in yellow with bold text.
- **Files:** A file icon tinted by file extension (TypeScript/TSX in blue, JavaScript in yellow, JSON in gray, Markdown in amber, Rust in warm brown, CSS in light blue, HTML in red, Python in blue-violet) followed by the file name. `CLAUDE.md` files appear highlighted in yellow.

The first level of directories auto-expands when the tree loads. Deeper levels start collapsed.

### How to Open / Access

| Method | Action |
|---|---|
| Keyboard shortcut | `Cmd B` toggles the sidebar visibility |
| Always visible | The sidebar is shown by default when a project is open |

### User Actions

**Click a file**
Click any file name in the tree. The file opens in the File Viewer panel on the right side of the app (see Chapter 14).

**Expand / collapse a folder**
Click a folder row to toggle it open or closed. The chevron rotates to indicate the current state.

**Right-click a file (context menu)**
Right-click on any file to open a context menu with these options:

- **New File** -- creates a new file in the same parent directory
- **New Folder** -- creates a new folder in the same parent directory
- **Add to Main Chat** -- attaches the file to the current chat session as a context attachment
- **Add to Assistant** -- expands an inline sub-menu listing all active assistant tabs; click one to attach the file to that assistant
- **Add Relative Path to Chat** -- inserts the file's relative path (from project root) into the chat input box
- **Add Absolute Path to Chat** -- inserts the file's full absolute path into the chat input box
- **Open** -- opens the file in the File Viewer
- **Duplicate** -- creates a copy of the file in the same directory
- **Rename** -- converts the file name into an inline editable text field; press `Enter` to confirm or `Escape` to cancel. For files with extensions, only the name portion (before the dot) is pre-selected.
- **Delete** -- shows a confirmation dialog: "Delete '{filename}'? This cannot be undone." Confirming permanently deletes the file and closes any open File Viewer tabs for it.
- **Reveal in Finder** -- opens macOS Finder with the file highlighted
- **Copy Contents** -- copies the full text content of the file to the clipboard
- **Copy Path** -- copies the absolute file path to the clipboard
- **Copy Relative Path** -- copies the path relative to the project root
- **Expand All Folders** -- expands every folder in the tree at once
- **Collapse All Folders** -- collapses every folder in the tree at once

**Right-click a folder (context menu)**
Right-click on any folder to see:

- **New File** -- creates a new file inside this folder
- **New Folder** -- creates a new sub-folder inside this folder
- **Add Relative Path to Chat** -- inserts the folder's relative path into the chat input
- **Add Absolute Path to Chat** -- inserts the folder's absolute path into the chat input
- **Rename** -- inline rename for the folder
- **Delete** -- confirmation dialog: "Delete folder '{name}' and all its contents? This cannot be undone."
- **Reveal in Finder** -- opens Finder to this folder
- **Copy Path** -- copies the absolute path
- **Copy Relative Path** -- copies the relative path
- **Expand All Folders** / **Collapse All Folders**

**Right-click empty space (context menu)**
Right-clicking on blank area below all files shows:

- **New File** -- creates a file at the project root
- **New Folder** -- creates a folder at the project root
- **Expand All Folders** / **Collapse All Folders**

**Create a new file or folder inline**
When you trigger "New File" or "New Folder" (from the header buttons, context menu, or keyboard), an inline text input appears at the appropriate location in the tree. Type the name, then press `Enter` to create or `Escape` to cancel. Newly created files automatically open in the File Viewer.

**Rename inline**
Selecting "Rename" from the context menu converts the item's label into an editable input field. Press `Enter` to save or `Escape` to discard. Clicking outside the input also commits the rename.

### States

- **Default:** The tree shows all non-hidden files and folders, with the first level expanded.
- **Loading:** The center of the tree area shows "Loading..." text. The refresh button icon spins.
- **Empty:** If the project directory contains no visible files, the message "Empty directory" appears centered.
- **No project:** When no project is open, the tree shows "No project open" centered.

### Hidden Files and Directories

The file tree automatically hides the following directories, which are typically not useful to browse:

`node_modules`, `.git`, `.next`, `__pycache__`, `.DS_Store`, `target`, `.venv`, `venv`, `.turbo`, `.cache`, `coverage`, `.angular`, `.svelte-kit`, `.nuxt`, `.codemantis`

These are filtered server-side (in Rust) and never sent to the frontend.

### Symlink Protection

Symbolic links are silently skipped during tree traversal. This prevents the file tree from escaping outside the project root directory. All file operations (rename, delete, read) canonicalize paths to guard against symlink-based path traversal.

### Tree Depth Limit

The tree traverses up to 5 levels deep. Directories deeper than this are not displayed.

### Auto-Refresh

The file tree refreshes automatically when Claude edits, creates, or deletes files during a session. You can also trigger a manual refresh by clicking the refresh button in the header or right-clicking and choosing an action that modifies the tree.

### Configuration

No dedicated settings. The sidebar visibility is toggled with `Cmd B`.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd B` | Toggle sidebar visibility |

### Tips

- Right-click is the fastest way to attach a file to your chat or an assistant -- no need to drag or use the attachment bar.
- Use "Expand All Folders" when you need to visually scan the entire project, then "Collapse All" to return to a tidy view.
- The inline rename feature pre-selects only the filename (not the extension), so you can quickly type a new name without accidentally changing the file type.

---

## Chapter 23: Git Status

The Git Status Card sits at the bottom of the sidebar, providing a quick glance at your repository's branch, recent activity, and change counts. Clicking the branch name opens a popover showing recent commits.

### What You See

The Git Status Card appears as a compact section pinned to the bottom of the sidebar, just above the Context Meter. It contains two rows:

**Row 1 (top):** On the left, a branch icon (tinted in the theme's accent color) followed by the current branch name in bold. On the right, if there are uncommitted changes, a yellow file-edit icon with a count (e.g., "3").

**Row 2 (bottom):** Two small indicators in muted text:
- Left side: A clock icon and a relative timestamp showing when the last commit was made (e.g., "5m ago", "2h ago", "3d ago")
- Right side: An upload icon and a relative timestamp showing when the last push occurred

If the project is not a Git repository, the card is hidden entirely.

### How to Open / Access

The Git Status Card is always visible at the bottom of the sidebar when a Git repository is open. No action is needed to display it.

### User Actions

**Click the branch name**
Clicking the branch name button opens the **Git Commits Popover**, a floating panel that appears above the branch name. It shows:

- A title: **"Recent Commits"**
- A scrollable list of up to 10 recent commits, each displaying:
  - **Commit hash** (short, monospaced, tinted in the accent color)
  - **Commit message** (truncated if long)
  - **Author name** (small text)
  - **Relative time** (e.g., "just now", "15m ago", "2d ago")

The popover is 280px wide with a maximum height of 300px. If more than a few commits are shown, the list scrolls. Click outside the popover or press `Escape` to close it.

### States

- **Default (clean repository):** Branch name shown, no yellow change count, timestamps visible.
- **Dirty (uncommitted changes):** The yellow file-edit icon and change count appear to the right of the branch name.
- **Loading (commits popover):** When the popover is first opened, it briefly shows "Loading..." while fetching commit history.
- **Empty (no commits):** The popover displays "No commits found" if the repository has no commit history.
- **Not a Git repo:** The entire card is hidden.
- **Detached HEAD:** The branch name displays as "detached".

### Auto-Polling

Git status is polled automatically in the background:
- **Every 5 seconds** when uncommitted changes are detected (active polling)
- **Every 10 seconds** when the working tree is clean (relaxed polling)
- **Immediately** when the window regains focus (e.g., switching back from another app)

The relative timestamps ("5m ago") also re-render every 30 seconds to stay current.

### Configuration

There are no dedicated settings for Git status. It activates automatically for any project that is a Git repository.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd B` | Toggle sidebar (which contains the Git Status Card) |

### Tips

- The change count combines staged, unstaged, and untracked files into one number, giving you a quick sense of how "dirty" your working tree is.
- Click the branch name any time you want to verify what was recently committed -- useful after Claude makes changes to confirm they match your expectations.
- The relative timestamps help you notice if you have forgotten to push for a while, since the "Last push" indicator will drift into hours or days.

---

# Part VI: Settings & Configuration

---

## Chapter 24: Settings -- General

The General tab is the first screen you see when opening Settings. It controls visual appearance, input behavior, and several global preferences.

### What You See

A scrollable panel with the heading **"General"** and the following sections:

**Theme** -- A 3-column grid of six theme buttons, each showing a small circle swatch (dark or light) and the theme name. The currently selected theme has an accent-colored border and highlighted background. The six themes are:

| Theme | Type |
|---|---|
| Midnight | Dark |
| Ocean | Dark |
| Ember | Dark |
| Dawn | Light |
| Sand | Light |
| Arctic | Light |

**Font Size** -- A number input (range 10--20) showing the current font size in pixels. The default is 13px.

**Send Shortcut** -- A dropdown with two options:
- "Cmd + Enter" (sends messages with `Cmd Enter`)
- "Enter" (sends messages with just `Enter`; default)

**Show trivia while waiting** -- A toggle switch with the subtitle "Display fun facts while Claude is working." Off by default.

**Auto-open edited files** -- A toggle switch with the subtitle "Open files in the viewer when Claude edits them." Off by default.

**Default context window** -- Two side-by-side pill buttons: "200K" and "1M". The subtitle reads "Fallback context size when CLI doesn't report it." Default is 1M (1,000,000 tokens).

**Show welcome screen on launch** -- A toggle switch with the subtitle "Display the getting-started screen when the app opens."

**Check for updates** -- Displays "Current version: v{version}" and a blue **"Check Now"** button. While checking, the button text changes to "Checking..." and is disabled. If an update is found, the Settings modal closes and the Update Modal opens (see Chapter 31). If you are already on the latest version, a toast says "You're on the latest version."

### How to Open / Access

| Method | Action |
|---|---|
| Keyboard shortcut | `Cmd ,` |
| Title bar | Click the gear icon in the title bar |
| Settings modal | The "General" tab is selected by default |

### User Actions

**Change the theme**
Click any of the six theme buttons. The theme applies immediately (live preview), but is only persisted when you click **Save**. Themes use CSS variables, so the entire UI -- including the Monaco code editor -- updates to match.

**Adjust font size**
Type a value into the number input, or use the keyboard shortcuts `Cmd =` (zoom in), `Cmd -` (zoom out), and `Cmd 0` (reset to 13px). The keyboard shortcuts work globally, not just inside Settings. Font size changes also adjust the terminal font size by the same amount.

**Toggle a switch**
Click any toggle to flip it on/off. The switch slides and changes color (accent color when on, muted when off).

**Check for updates**
Click "Check Now." If an update is available, the Update Modal appears with the new version number, release notes, and an install button.

### States

- **Default:** All fields show their current saved values.
- **Modified (unsaved):** Changed values appear immediately in the UI but are not persisted until you click "Save" in the bottom-left of the Settings sidebar.
- **Cancelled:** Clicking "Cancel" or the X button reverts all changes to the last saved state.

### Configuration

This IS the configuration panel. All settings here are persisted to the app's SQLite database at `~/Library/Application Support/dev.codemantis.myapp/codemantis.db`.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd ,` | Open Settings |
| `Cmd =` | Zoom in (increase font size by 1px) |
| `Cmd -` | Zoom out (decrease font size by 1px) |
| `Cmd 0` | Reset font size to 13px |

### Tips

- Use "Sand" or "Arctic" for well-lit environments and "Midnight" or "Ocean" for low-light coding sessions.
- If you prefer hitting Enter for newlines in long messages, switch the Send Shortcut to "Cmd + Enter."
- The 1M context window default is recommended for Claude Max subscribers using extended-context models. The 200K setting is appropriate for standard Claude Pro plans.

---

## Chapter 25: Settings -- Session Logs

The Session Logs tab controls whether CodeMantis saves the full conversation history of each session to the local database, enabling you to restore and re-read past sessions.

### What You See

A panel with the heading **"Session Logs"** (accessed via the Database icon in the Settings sidebar). Below the heading is explanatory text:

> "Save the complete conversation of each session -- all messages exchanged between you and Claude Code. When you reopen a historical session, the full chat history is restored so you can pick up where you left off."

**Save session conversations** -- A toggle switch with the subtitle "Store all messages when a session closes so they can be replayed later." Enabled by default.

When the toggle is on, an additional section appears:

**Retention period** -- A dropdown with these options:
- 7 days
- 14 days
- **30 days** (default)
- 90 days
- 1 year
- Forever

Below the dropdown: "Session logs older than this are automatically cleaned up on app launch. Set to 'Forever' to keep all logs indefinitely."

### How to Open / Access

| Method | Action |
|---|---|
| Settings modal | Click the **"Session Logs"** tab (Database icon) in the left sidebar |

### User Actions

**Enable or disable session logging**
Click the toggle switch. When disabled, session conversations are not saved when sessions close. Existing saved logs remain until they expire.

**Change retention period**
Select a value from the dropdown. Logs older than the selected duration are automatically deleted the next time CodeMantis launches.

### States

- **Enabled (default):** The toggle is on and the retention dropdown is visible.
- **Disabled:** The toggle is off. The retention dropdown is hidden. No new session logs will be saved.

### Configuration

- **Settings path:** Settings > Session Logs > Save session conversations
- **Settings path:** Settings > Session Logs > Retention period

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd ,` | Open Settings |

### Tips

- Keeping session logs enabled at the default 30 days is recommended. It costs minimal disk space and lets you resume any session from the Session History panel.
- Set retention to "Forever" if you want a permanent record of all your coding conversations for reference.
- If disk space is a concern, reduce the retention to 7 days. Cleanup happens automatically on launch.

---

## Chapter 26: Settings -- AI Providers

The AI Providers tab is where you configure API keys for external AI services that power the Assistant, Changelog, and SpecWriter features. Claude Code itself requires no API key -- it uses your existing Claude subscription.

### What You See

A panel with the heading **"AI Providers"** and the subtext: "Configure API keys and token pricing for each provider. These are shared across Changelog and Assistant features."

**OpenRouter Promotion Banner** -- If you have no API keys set (or no OpenRouter key), a highlighted banner appears at the top:

> **"No AI API Key? Use OpenRouter -- Free AI for CodeMantis!"**
> "OpenRouter gives you access to 200+ AI models from all major providers. Many models are completely free -- no credit card needed."
> A blue **"Get Free API Key"** button links to `https://openrouter.ai/keys`.

**API Key Inputs** -- Listed from top to bottom:

1. **OpenRouter** (shown first, with a subtitle: "Free models available -- no credit card required")
   - Password input field
   - **Test** button
   - On success: "API key is valid -- {N} models available ({M} free)"
   - On error: "Could not validate API key -- check that the key is correct and your internet connection is working"

2. A divider labeled "Other Providers"

3. **OpenAI** -- Password input + Test button
4. **Google Gemini** -- Password input + Test button
5. **Anthropic API** -- Password input + Test button

Each provider's Test button is disabled until a key is entered. While testing, the button shows "Testing..." and is disabled.

**Model Pricing** -- Below a divider labeled "Model Pricing (per 1M tokens, USD)", each provider's models are listed with editable **In** (input) and **Out** (output) cost fields:

- **OpenAI:** GPT-4.1, GPT-5.4 Nano, GPT-5.4 Mini, GPT-5.4
- **Google Gemini:** Gemini 2.5 Flash Lite, Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 3.0 Flash, Gemini 3.1 Pro, Gemini 3.1 Flash Lite
- **Anthropic API:** Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5
- **OpenRouter:** When an OpenRouter key is configured and models are loaded, this section shows the catalog size (e.g., "OpenRouter (847 models)") with a note: "Pricing is auto-fetched from the OpenRouter API. Free models have $0 cost." Up to 8 free models and 5 lowest-cost paid models are previewed.

### How to Open / Access

| Method | Action |
|---|---|
| Settings modal | Click the **"AI Providers"** tab (Layers icon) in the left sidebar |

### User Actions

**Enter an API key**
Paste or type your key into the password field for the desired provider. Keys are masked by default.

**Test an API key**
Click **"Test"** next to the key field. The app makes a validation call to the provider. A green "API key is valid" message confirms success; a red error message indicates failure.

**Edit model pricing**
Change the "In" or "Out" dollar values for any model. These values are used to calculate cost estimates in the Turn Stats Popover (Chapter 30) and API Logs (Chapter 29).

### States

- **No keys configured:** The OpenRouter promotion banner is prominently displayed.
- **Key entered but untested:** The Test button becomes active (blue tint).
- **Testing:** Button shows "Testing..." and is disabled.
- **Valid key:** Green confirmation text below the input.
- **Invalid key:** Red error text below the input.

### Which Features Need Keys

| Feature | API Key Required? |
|---|---|
| Claude Code (main chat) | No -- uses your Claude Pro/Max subscription |
| Assistant Panel | Yes (any provider) or use Claude Code as provider (free) |
| Changelog | Yes (any provider) |
| SpecWriter | Yes (any provider) or use Claude Code as provider (free) |

### OpenRouter Model Catalog

When an OpenRouter key is configured and validated, CodeMantis automatically fetches the full model catalog from the OpenRouter API. This catalog is cached for 15 minutes. It includes model IDs, names, pricing, context lengths, and supported input/output modalities (text, image, file). Free models are clearly identified. The catalog powers the searchable model dropdowns in the Assistant, Changelog, and SpecWriter settings.

### Configuration

- **Settings path:** Settings > AI Providers > {Provider Name} API key
- **Settings path:** Settings > AI Providers > Model Pricing

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd ,` | Open Settings |

### Tips

- OpenRouter is the recommended starting point if you do not already have API keys -- many powerful models are available completely free.
- Model pricing defaults are pre-filled based on published rates at the time of the CodeMantis release. Update them if prices change.
- You can configure multiple providers simultaneously. Different features can use different providers.

---

## Chapter 27: Settings -- Preview & SpecWriter

The Preview and SpecWriter tabs configure the built-in web preview window and the AI-powered specification writer respectively.

### What You See

#### Preview Settings (Globe icon)

A panel with the heading **"Preview Window"** containing five configuration rows:

| Setting | Control | Default |
|---|---|---|
| Default width (px) | Number input | 1024 |
| Default height (px) | Number input | 768 |
| Auto-start dev server on project open | Checkbox | Off |
| Custom dev command override | Text input (placeholder: "npm run dev") | Empty |
| Auto-open console on errors | Checkbox | On |

#### SpecWriter Settings (PenTool icon, labeled "SpecWriter" in the sidebar)

A panel with the heading **"SpecWriter"** containing two configuration rows:

| Setting | Control | Default |
|---|---|---|
| Spec writing AI model | Dropdown | Auto-selected based on available keys |
| Max output tokens | Number input (range: 1024--200,000, step: 1024) | 64,000 |

The model dropdown lists all hardcoded spec-writing models plus up to 5 free OpenRouter models (if an OpenRouter key is configured). Models whose providers lack an API key are shown but disabled with "(no API key)" appended.

Available hardcoded spec models (in priority order):
- Gemini 3.1 Flash Lite
- GPT-5.4 Mini
- Claude Sonnet 4.6
- Gemini 3.1 Pro
- GPT-5.4
- Claude Opus 4.6

### How to Open / Access

| Method | Action |
|---|---|
| Settings modal | Click **"Preview"** (Globe icon) or **"SpecWriter"** (PenTool icon) in the left sidebar |

### User Actions

**Set preview dimensions**
Type the desired width and height in pixels. These set the initial size of the preview window when it opens.

**Enable auto-start**
Check the "Auto-start dev server" box. When enabled, the preview's dev server starts automatically when you open a project, rather than requiring a manual start.

**Override the dev command**
Type a custom command (e.g., `npm run dev`, `yarn start`, `pnpm dev`) into the text input. If left empty, CodeMantis auto-detects the appropriate command.

**Toggle console auto-open**
Check or uncheck "Auto-open console on errors." When enabled, the console drawer in the preview window opens automatically when JavaScript errors are detected.

**Choose a spec-writing model**
Select a model from the dropdown. Models without an API key are grayed out and cannot be selected.

**Set max output tokens**
Enter a value between 1,024 and 200,000. Higher values allow the SpecWriter to produce longer, more detailed specifications. The default of 64,000 is suitable for most projects.

### States

- **Default:** All fields show their saved values.
- **Modified:** Changes appear immediately but require clicking "Save" to persist.

### Configuration

- **Settings path:** Settings > Preview > Default width / Default height
- **Settings path:** Settings > Preview > Auto-start dev server on project open
- **Settings path:** Settings > Preview > Custom dev command override
- **Settings path:** Settings > Preview > Auto-open console on errors
- **Settings path:** Settings > SpecWriter > Spec writing AI model
- **Settings path:** Settings > SpecWriter > Max output tokens

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd ,` | Open Settings |
| `Cmd Shift P` | Toggle Preview Window |
| `Cmd Shift B` | Toggle SpecWriter slide-over |

### Tips

- If your project uses a non-standard dev command (e.g., `make serve` or `cargo watch`), enter it in the custom dev command field.
- Set max output tokens higher (100,000+) for large-scale specifications covering multiple features; lower values (8,000--16,000) work for focused, single-feature specs.
- Free OpenRouter models appear in the SpecWriter model dropdown when you have an OpenRouter key -- a great zero-cost option for generating specs.

---

## Chapter 28: Settings -- Assistant, Changelog, Terminal, Quick Commands

These four settings tabs configure supporting features of CodeMantis.

### What You See

#### Assistant Settings (MessageSquare icon)

A panel with the heading **"Assistant"** containing three sections:

**Default Provider** -- A dropdown labeled "Provider" listing all available providers:
- Claude Code (local)
- OpenAI
- Google Gemini
- Anthropic API
- OpenRouter

The subtitle reads: "New assistant tabs will use this provider by default." Default: Claude Code (local).

**Default Models** -- One dropdown per API provider (OpenAI, Google Gemini, Anthropic API, OpenRouter). Each lets you select which model to use by default when creating assistant tabs with that provider. Providers without API keys show their dropdowns as disabled with a tooltip "Set API key in Settings > AI Providers." OpenRouter uses a searchable dropdown component.

**Shortcuts** -- A list of named prompt shortcuts. Each has:
- A **Name** text input (e.g., "Explain", "Refactor")
- A **Prompt** text area (e.g., "Explain the selected code in detail")
- A delete button (X)
- An **"+ Add shortcut"** link at the bottom

These shortcuts appear as quick-access chips in the Assistant Panel.

#### Changelog Settings (ScrollText icon)

A panel with the heading **"Changelog"** and the subtitle: "Auto-generate changelog entries after each coding turn using an LLM provider."

**Enable auto-changelog** -- A toggle switch. Off by default.

When enabled, three additional controls appear:

**Provider** -- A dropdown with: Google Gemini, OpenAI, Anthropic, OpenRouter.

**Model** -- A dropdown listing models for the selected provider. When OpenRouter is selected, a searchable model selector appears instead.

**System Prompt** -- A monospaced, resizable text area pre-filled with the default prompt that instructs the AI to output JSON with headline, description, and category fields. A small **Reset** button (with a rotate icon) in the top-right corner restores the default prompt. Below the text area: "The AI receives this as a system instruction."

#### Terminal Settings (Terminal icon)

A compact panel with the heading **"Terminal"** and two fields:

| Setting | Control | Default |
|---|---|---|
| Shell | Text input (placeholder: "Default ($SHELL)") | Empty (uses system default) |
| Font Size | Number input (range: 10--20) | 13 |

#### Quick Commands Settings (Zap icon)

A panel with the heading **"Quick Commands"** and the subtitle: "Commands available in the terminal toolbar for quick execution."

A list of command entries, each with:
- A **Label** text input (e.g., "Build", "Test")
- A **Command** text input in monospace font (e.g., "pnpm build", "pnpm test")
- A delete button (X)

Default commands:

| Label | Command |
|---|---|
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| Dev | `pnpm dev` |

An **"+ Add command"** link at the bottom creates a new empty entry.

### How to Open / Access

| Method | Action |
|---|---|
| Settings modal | Click the respective tab in the left sidebar: **Assistant**, **Changelog**, **Terminal**, or **Quick Commands** |

### User Actions

**Add an assistant shortcut**
Click "+ Add shortcut" at the bottom of the Shortcuts section. Fill in a name and prompt, then Save.

**Edit an assistant shortcut**
Modify the name or prompt text inline. Changes take effect after clicking Save.

**Delete an assistant shortcut**
Click the X button next to any shortcut entry.

**Enable changelog generation**
Toggle "Enable auto-changelog" on, select a provider and model, and optionally customize the system prompt. Changelog entries will be automatically generated after each coding turn that involves file modifications.

**Reset the changelog prompt**
Click the **Reset** button (rotate icon) next to "System Prompt" to restore the default.

**Set a custom shell**
Type a shell path (e.g., `/bin/zsh`, `/usr/local/bin/fish`) into the Shell field. Leave it empty to use the system default ($SHELL).

**Add a quick command**
Click "+ Add command" and fill in a label and shell command.

**Delete a quick command**
Click the X button next to any command entry.

### States

- **Default:** All fields show saved values. Changelog is disabled by default.
- **Modified:** Changes are previewed live but require Save to persist.

### Configuration

- **Settings path:** Settings > Assistant > Default Provider
- **Settings path:** Settings > Assistant > Default Models > {Provider}
- **Settings path:** Settings > Assistant > Shortcuts
- **Settings path:** Settings > Changelog > Enable auto-changelog
- **Settings path:** Settings > Changelog > Provider / Model / System Prompt
- **Settings path:** Settings > Terminal > Shell / Font Size
- **Settings path:** Settings > Quick Commands

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd ,` | Open Settings |

### Tips

- Create assistant shortcuts for your most common prompts ("Review this for bugs", "Write unit tests", "Explain this function") to save typing.
- The default quick commands assume a pnpm-based project. Replace "pnpm" with "npm", "yarn", or your preferred package manager.
- For Changelog, Gemini 2.5 Flash Lite is a low-cost default choice. Switch to a more capable model if you want richer descriptions.

---

## Chapter 29: Settings -- Shortcuts & API Logs

The Shortcuts tab displays all keyboard shortcuts at a glance. The API Logs tab provides visibility into all AI provider API calls, their costs, and any errors.

### What You See

#### Shortcuts Tab (Keyboard icon)

A panel with the heading **"Keyboard Shortcuts"** and categorized lists. Each entry shows the action description on the left and a styled keyboard shortcut badge on the right:

**Global**

| Shortcut | Action |
|---|---|
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

**Sessions**

| Shortcut | Action |
|---|---|
| `Cmd N` | New session in current project |
| `Cmd W` | Close current session |
| `Cmd Shift [` | Previous session |
| `Cmd Shift ]` | Next session |
| `Cmd 1-9` | Switch to session by number |

**Panels**

| Shortcut | Action |
|---|---|
| `Cmd B` | Toggle sidebar |
| `Cmd Shift A` | Focus activity feed |
| `Cmd Shift F` | Focus file viewer |
| `Cmd Shift T` | Focus terminal |
| `Cmd Shift L` | Focus changelog |

**Preview**

| Shortcut | Action |
|---|---|
| `Cmd Shift P` | Toggle Preview Window |
| `Cmd R` | Refresh preview (when focused) |
| `Cmd Shift C` | Toggle Console Drawer (when focused) |

**SpecWriter**

| Shortcut | Action |
|---|---|
| `Cmd Shift B` | Toggle SpecWriter slide-over |

**Editor**

| Shortcut | Action |
|---|---|
| `Cmd S` | Save file |

#### API Logs Tab (BarChart3 icon)

A panel with the heading **"API Logs"** and a tab switcher at the top with two tabs:

**Cost Log** (default view) -- Shows:

1. **Cost Summary Card** (when calls exist): Total Cost (formatted), Total Calls count, and a per-provider breakdown (provider name, cost, call count).

2. **Call List**: Each row shows:
   - A colored dot (green for success, red for failure)
   - Timestamp
   - Provider name
   - Model name (monospaced)
   - Total tokens
   - Cost amount
   - A copy button (appears on hover) that copies the entry details to clipboard

3. Empty state: A bar-chart icon with "No API calls logged yet" and "Calls will appear here when API providers are used."

**Error Log** -- Shows:

1. **Error Summary Card** (when errors exist): Total Errors count (in red) and per-provider error breakdown.

2. **Error List**: Each row is clickable and shows:
   - A red dot
   - Timestamp
   - Provider name
   - Model name
   - Error message (truncated, in red monospace)
   - A copy button

   Clicking an error row expands an inline detail panel showing the full error message in red monospace text, with its own copy button.

3. Empty state: A warning icon with "No errors logged" and "API errors will appear here when they occur."

Below both tabs: "Logs older than 5 days are automatically deleted."

**Diagnostics** section at the bottom:
- **Copy Log Path** button -- copies `~/Library/Logs/dev.codemantis.myapp/codemantis.log` to clipboard
- **Open in Finder** button -- reveals the log file in Finder
- The log file path displayed in monospace text

### How to Open / Access

| Method | Action |
|---|---|
| Settings modal | Click **"Shortcuts"** (Keyboard icon) or **"API Logs"** (BarChart3 icon) in the left sidebar |

### User Actions

**View the shortcut reference**
Open Settings > Shortcuts. All shortcuts are displayed in a read-only reference list.

**View API cost breakdown**
Open Settings > API Logs > Cost Log. The summary card shows your total spend and per-provider totals.

**Inspect an API error**
Switch to the Error Log tab and click any error row to expand its full error message.

**Copy a log entry**
Hover over any row in the Cost Log or Error Log and click the copy icon. The entry details are copied to your clipboard. A brief checkmark animation confirms the copy.

**Access diagnostic logs**
Click "Copy Log Path" to get the filesystem path, or "Open in Finder" to navigate directly to the app's log file.

### States

- **Loading:** "Loading..." text while API logs are fetched from the database.
- **Empty:** Placeholder graphics when no calls or errors have been logged.
- **Populated:** Summary card and scrollable list of entries.

### Configuration

No configuration options -- this tab is read-only. Log cleanup (5-day retention) happens automatically when the tab loads.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd ,` | Open Settings |

### Tips

- Check the API Logs tab periodically to understand how much you are spending on Assistant and Changelog API calls.
- The Error Log is the first place to look if an Assistant response or Changelog generation fails unexpectedly.
- The diagnostic log file path is useful when reporting bugs -- attach the log file to help developers diagnose issues.

---

# Part VII: Context & Status

---

## Chapter 30: Context Meter & Token Management

The Context Meter tracks how much of Claude's context window your current session has consumed. It helps you understand when to start a new session or run `/compact` to free up space.

### What You See

The Context Meter is pinned to the very bottom of the sidebar, below the Git Status Card. It displays:

**Session summary line** (when at least one turn has been completed):
- Left side: Turn count and total tokens (e.g., "3 turns / 45K tok")
- Right side: Cumulative estimated cost (e.g., "$0.12")

**Context bar:**
- A label "CONTEXT" on the left (uppercase, small text)
- A fraction on the right (e.g., "125K / 1M")
- A thin horizontal progress bar that fills from left to right

The progress bar changes color based on usage:
- **Accent color** (blue/theme-dependent): 0--70% usage
- **Yellow**: 71--90% usage
- **Red**: 91--100% usage

#### Turn Stats Popover

Each assistant message in the chat panel shows a small bar-chart icon button displaying the turn's token count and cost (e.g., "12.5K tokens $0.03"). Clicking this button opens a **Turn Stats Popover** -- a 260px floating panel showing:

| Field | Description |
|---|---|
| Duration | Wall-clock time for the turn |
| API time | Time spent waiting for API responses |
| API calls | Number of individual API calls within the turn |
| Cost | Estimated cost of this turn |
| Input tokens | Tokens sent to Claude |
| Output tokens | Tokens generated by Claude |
| Cache read | Tokens served from prompt cache |
| Cache write | Tokens added to prompt cache |
| Total tokens | Sum of all token categories |

Fields with zero values are hidden to keep the popover compact. Click outside or press `Escape` to close.

### How to Open / Access

The Context Meter is always visible at the bottom of the sidebar. The Turn Stats Popover appears on each assistant message bubble.

### Context Threshold Warnings

CodeMantis monitors context usage and fires toast notifications at critical thresholds:

| Threshold | Toast Message | Duration |
|---|---|---|
| 80% | "Context window is 80% full. Consider running /compact to free space." | 10 seconds |
| 95% | "Context window is 95% full. Run /compact to free space before the session stalls." | 15 seconds |

Each threshold fires only once per session -- you will not be repeatedly warned about the same level.

### Session Status Bar

At the bottom of the chat panel, a thin status bar shows real-time session information from left to right:

- **Status indicator:** A small colored dot (green pulsing = busy, yellow pulsing = compacting, gray = idle) followed by the status label ("Busy", "Compacting", or "Idle")
- **Elapsed time** (when busy): Duration since the current operation started
- **Activity detail** (when busy): What Claude is currently doing (e.g., "Editing settings.ts", "Running command...", "2 agents")
- **Agent tokens** (when sub-agents are active): Token count consumed by sub-agents
- **Mode icon** (when applicable): Green shield for Auto-Accept mode, yellow map icon for Plan mode
- **Model name:** The active model (e.g., "Sonnet 4.6")
- **Turn count:** Number of completed turns
- **Rate limit utilization** (when above 50%): "RL 75%" -- shows how close you are to the API rate limit. Turns yellow at 80%.
- **Session tokens:** Total tokens consumed
- **Session cost:** Cumulative cost
- **Context percentage:** "ctx 45%" -- colored based on thresholds (gray < 70%, yellow 70--90%, red > 90%)

### Default Context Window

The default context window size is configurable in Settings > General > Default context window. Choose between:
- **200K** (200,000 tokens) -- standard Claude Pro plans
- **1M** (1,000,000 tokens) -- Claude Max plans with extended context

This value is used as a fallback when the CLI does not report the actual context window size. CodeMantis also attempts to infer the correct size from the model name.

### Managing Context

When context usage gets high:
1. Type `/compact` in the chat input to ask Claude to compress the conversation history
2. Start a new session (`Cmd N`) for a fresh context window
3. The session status bar and context meter will update in real time as context is freed

### Configuration

- **Settings path:** Settings > General > Default context window

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd N` | New session (fresh context) |

### Tips

- Keep an eye on the Context Meter color. When it turns yellow, plan to wrap up your current line of work or run `/compact`.
- The Turn Stats Popover is useful for understanding which turns consume the most tokens -- turns with many file reads or large code blocks will be heavier.
- For long-running tasks, the 1M context window setting gives you significantly more room before needing to compact or start fresh.

---

## Chapter 31: Error Recovery & Troubleshooting

This chapter covers how CodeMantis handles errors, rate limits, stale connections, and other edge cases -- and what you can do when things go wrong.

### Rate Limiting

**What happens:** When the Claude API returns a rate limit error (HTTP 429 or similar), CodeMantis automatically retries with exponential backoff.

**What you see:**
- A message appears in the chat: "**Rate limited.** Retrying in {N}s (attempt {X}/3)..."
- A toast notification: "Rate limited -- retrying in {N}s"
- The retry delays escalate: 30 seconds, then 60 seconds, then 120 seconds

**Behavior:**
- Up to 3 retry attempts are made automatically
- Each retry re-sends the last user message
- After 3 failed attempts, a "Restart" button appears on the error message, allowing you to manually retry
- The rate limit utilization percentage is shown in the status bar ("RL 75%") when above 50%, turning yellow at 80%

### Stale Connection Detection

**What happens:** If a session is marked as busy but no events are received for an extended period, CodeMantis uses progressive stale connection detection.

**What you see:**
- After ~2 minutes of silence: Toast notification "No events for {N}m -- Claude may be working on a complex task"
- After continued silence: "Still no events after {N}m -- process is alive, likely deep in analysis"
- Periodic reminders every ~45 seconds: "No events for {N}m -- process still running"

**Behind the scenes:** A shared timer checks all active sessions every 15 seconds. If a session has been silent for more than 120 seconds and is not actively streaming text, the app checks whether the CLI process is still alive. If the process has died:
- The session is marked as idle
- A recovery message appears: "**Session ended.** The Claude Code process exited without a completion signal. Your work is saved. You can send a new message to continue."
- A toast: "Session recovered -- process had ended"

### Session Crashes and Process Exits

**Non-zero exit codes:** When the CLI process exits with an error code, CodeMantis analyzes the stderr output to provide helpful messages:

- **Authentication failure** (detected by keywords like "auth", "token", "expired", "401"): A message instructs you to run `claude login` in a terminal, with a "Restart" button.
- **Rate limit** (detected by "429", "rate limit"): Auto-retry behavior described above.
- **Other errors:** The error is translated into a user-friendly message with a title, explanation, and remediation suggestion. The raw stderr is included in a code block for debugging.

**Clean exit (code 0):** No error message is shown.

All error messages that indicate a recoverable situation include a **Restart** button, allowing you to re-establish the session.

### Session Compacting

**What you see:** When Claude is compacting the conversation to free context space:
- The status bar shows "Compacting" with a yellow pulsing dot
- The status bar label turns yellow
- Once complete, the status returns to "Idle" or "Busy" as appropriate

### Plan Complete Modal

**When it appears:** After Claude finishes generating a plan in Plan mode.

**What you see:** A modal dialog with:
- A green clipboard-check icon
- Title: **"Plan Complete"**
- Subtitle: "Claude has finished planning. Ready to implement?"
- An **"Enable Auto-Accept"** checkbox: "Approve all tool calls automatically during implementation"
- Two buttons: **"Later"** (dismisses the modal) and **"Implement Now"** (sends "Go ahead, implement the plan." to Claude)

**Keyboard:** Press `Enter` to implement, `Escape` to dismiss.

If Auto-Accept is checked before clicking "Implement Now," the session mode switches to Auto-Accept for the implementation phase.

### Confirm Close Modal

**When it appears:** When you try to close a session or project that has an active CLI process.

**What you see:** A modal with a yellow warning icon and:
- For sessions: "Close session '{name}'? The Claude CLI process will be stopped."
- For projects: "Close project '{name}'? All {N} sessions and their CLI processes will be stopped."
- Two buttons: **"Cancel"** and **"Close"** (red)

**Keyboard:** `Enter` confirms close, `Escape` cancels.

### Auto-Update System

**When it appears:** Automatically on launch (if an update is available) or when you click "Check Now" in Settings > General.

**What you see:** The Update Modal showing:
- A download icon and title: **"Update available"** with "CodeMantis v{new version}"
- Release notes in a scrollable area (up to ~128px tall)
- Two buttons: **"Later"** (dismisses) and **"Update & Restart"** (starts download)

**During download:**
- The modal shows a progress bar with percentage (0--100%)
- Status text: "Downloading..." then "Installing..." then "Restarting..."
- The close button and "Later" button are hidden -- you cannot dismiss the modal during download

**On completion:** The progress bar turns green, status shows "Restarting...", and the app relaunches after a brief pause.

**On failure:** A red error message appears: "Update failed: {error details}" and the buttons reappear so you can try again or dismiss.

### Image Preview Modal

**When it appears:** When you click on an image attachment or preview in the app.

**What you see:** A full-screen overlay with the image centered and scaled to fit the window (maximum height: viewport minus 4rem). A dark overlay bar at the bottom of the image shows the filename and file size (formatted as B/KB/MB). A close button (X) sits at the right end of the bar.

**How to close:** Click the X button, click anywhere outside the image, or press `Escape`.

### External Link Guard

All external links (http, https, mailto) clicked within CodeMantis are intercepted and opened in your default system browser instead of navigating the app's webview. This prevents accidentally leaving the app. Links to localhost, 127.0.0.1, and internal Tauri URLs are allowed to navigate normally.

### Data Safety

**Database location:** `~/Library/Application Support/dev.codemantis.myapp/codemantis.db`

**Automatic backup:** Before every app launch, the database file is copied to `codemantis.db.backup` in the same directory. This happens before any database migrations run, ensuring you have a rollback point if a migration fails.

**Log file:** `~/Library/Logs/dev.codemantis.myapp/codemantis.log` -- accessible via Settings > API Logs > Diagnostics.

### Troubleshooting Quick Reference

| Problem | Solution |
|---|---|
| "Authentication failed" | Run `claude login` in a terminal, then start a new session |
| Rate limited | Wait for auto-retry (up to 3 attempts), or start a new session |
| Session appears stuck | Wait for stale detection (2 minutes). If the process died, a recovery message appears automatically |
| Context window full | Run `/compact` in chat, or start a new session with `Cmd N` |
| Update failed | Dismiss the modal and try again later, or download the latest version from the website |
| API provider not working | Go to Settings > AI Providers and use the "Test" button to verify your key |
| File tree not updating | Click the refresh button in the sidebar header, or wait for auto-refresh |
| Terminal not responding | Check Settings > Terminal for the correct shell path |

### Configuration

- **Settings path:** Settings > General > Check for updates
- **Storage path:** `~/Library/Application Support/dev.codemantis.myapp/`
- **Log path:** `~/Library/Logs/dev.codemantis.myapp/codemantis.log`

### Tips

- If you encounter persistent rate limiting, try switching to a different time of day or upgrading your Claude plan for higher rate limits.
- The automatic database backup means you can safely update CodeMantis without worrying about losing your settings or session history. If something goes wrong, the `.backup` file is your safety net.
- When reporting bugs, always include the diagnostic log file (Settings > API Logs > Diagnostics > "Open in Finder") -- it contains detailed error information that helps developers identify and fix issues quickly.
