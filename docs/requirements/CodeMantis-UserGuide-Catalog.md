# CodeMantis — Complete User Guide: Chapter Catalog & Production Plan

**Purpose:** Everything needed to produce a comprehensive "How-To" document covering every feature, user action, and configuration option in CodeMantis — built by having Claude Code read the actual source code.

**Date:** March 2026
**Output:** `docs/user-guide/codemantis-complete-guide.md` (~150-200 pages equivalent)

---

## Table of Contents

1. Chapter Catalog (What Claude Code Writes)
2. Output Format Specification
3. The Prompt (Copy-Paste into Claude Code)
4. Session Plan (How to Execute)
5. Embedding in CodeMantis (In-App Support AI)
6. Embedding on the Website (Help Center)

---

## 1. Chapter Catalog

Every chapter maps to specific source files. Claude Code reads the files, then writes the documentation describing what users see and can do.

### Part I: Getting Started

**Chapter 1: First Launch**
```
Files to read:
  src/components/onboarding/WelcomeScreen.tsx
  src/stores/settingsStore.ts (showWelcomeScreen flag)
  
Document:
  - What you see on first launch (Welcome Screen)
  - The three options: Open Project, New from Template, or browse docs
  - "Show on startup" checkbox
  - How to re-show later (Settings → General → Show Welcome Screen)
```

**Chapter 2: The CodeMantis Interface**
```
Files to read:
  src/components/layout/AppShell.tsx
  src/components/layout/TitleBar.tsx
  src/components/layout/SessionSubTabs.tsx
  src/components/sidebar/Sidebar.tsx

Document:
  - Title bar: traffic light buttons, project tabs, action buttons
  - Title bar buttons (left to right): New Project (+), Open Project (folder),
    SpecWriter (pen), Run Application (globe), Screenshot (camera, 
    appears when preview is open), MCP Servers (blocks), Settings (gear)
  - Session sub-tabs: session tabs with model badge and status dot,
    "+" to add session, History tab, Project Log tab
  - Three-panel layout: sidebar (left), chat (center), right panel
  - Sidebar content: file tree + git status card
  - Right panel tabs: Activity, Terminal, Files, Changelog, Assistant
  - How to resize panels (drag dividers)
```

**Chapter 3: Opening & Managing Projects**
```
Files to read:
  src/components/modals/ProjectPicker.tsx
  src/stores/sessionStore.ts (projectOrder, activeProjectPath)
  src/components/layout/ProjectTab.tsx

Document:
  - Opening an existing project: ⌘O → folder picker
  - Multiple projects open simultaneously (project tabs in title bar)
  - Switching between projects (click tab)
  - Closing a project (× on tab)
  - What "project" means: a folder with code that Claude Code works on
  - The project path is shown in the tab
```

### Part II: Working with Claude Code

**Chapter 4: Chat Panel — Conversations with Claude**
```
Files to read:
  src/components/chat/ChatPanel.tsx
  src/components/chat/MessageBubble.tsx
  src/components/chat/CodeBlock.tsx
  src/components/chat/ThinkingIndicator.tsx
  src/components/chat/StreamingCursor.tsx
  src/components/chat/TurnStatsPopover.tsx
  src/components/chat/TriviaCard.tsx
  src/components/chat/SessionStatusBar.tsx

Document:
  - Sending messages (text input at the bottom)
  - How Claude's responses appear (streaming, word by word)
  - Thinking indicator (expandable reasoning)
  - Code blocks (syntax highlighting, copy button)
  - Turn stats popover (tokens used, cost per turn)
  - Session status bar (model, token count, cost)
  - Trivia cards while waiting (fun facts, can be disabled)
  - What the different message styles mean (user, assistant, system)
```

**Chapter 5: The Input Area**
```
Files to read:
  src/components/input/InputArea.tsx
  src/components/input/AttachmentBar.tsx
  src/components/input/ModeSelector.tsx
  src/components/input/ModelSelector.tsx
  src/components/input/CommandPalette.tsx

Document:
  - Typing a message (multiline, shift+enter for newline)
  - Send shortcut options: Enter or ⌘Enter (configurable in Settings)
  - Attaching files: images and documents (drag & drop or button)
  - AttachmentBar: thumbnail previews, remove button
  - Mode selector: Normal / Auto-Accept / Plan (bottom-left)
  - Model selector: which Claude model to use
  - Slash commands: type "/" to open the command palette
```

**Chapter 6: Session Modes**
```
Files to read:
  src/components/input/ModeSelector.tsx
  src/types/session.ts (SessionMode type)
  
Document:
  - Normal mode: Claude asks permission for every file edit, bash command
    (Shield icon, default mode)
  - Auto-Accept mode: Claude executes all tool calls automatically
    (ShieldCheck icon, green, faster but less control)
  - Plan mode: Claude only reasons and plans, never touches code
    (Map icon, yellow, good for architecture discussions)
  - How to switch: click the mode selector or press ⌘.
  - When to use each mode (practical guidance)
```

**Chapter 7: Tool Approvals**
```
Files to read:
  src/components/modals/ToolApproval.tsx
  src/hooks/useToolApprovalListener.ts
  src/stores/activityStore.ts (approvalQueue)

Document:
  - What tool approvals are (Claude wants to edit a file / run a command)
  - The approval modal: shows tool name, file path, content preview
  - Approve or Reject buttons
  - Queue navigation: when multiple approvals stack up (< > arrows)
  - How approval relates to session mode (only in Normal mode)
  - Project name shown in the approval dialog
```

**Chapter 8: Sessions & History**
```
Files to read:
  src/components/layout/SessionSubTabs.tsx
  src/components/chat/ClaudeHistory.tsx
  src/components/chat/ProjectLogFeed.tsx

Document:
  - What a session is (one conversation with Claude Code)
  - Creating a new session: ⌘N or "+" button in sub-tabs
  - Switching between sessions: click sub-tab or ⌘1-9
  - Renaming a session: double-click the sub-tab name
  - Closing a session: × on the sub-tab (with confirmation if active)
  - Status dot: green = idle, yellow = streaming/working
  - Model badge: shows which Claude model (Sonnet, etc.)
  - Claude History tab: resume previously closed sessions
  - Project Log tab: all changelog entries for this project
  - Session order: ⌘⇧[ and ⌘⇧] to navigate previous/next
```

### Part III: The Right Panel

**Chapter 9: Activity Feed**
```
Files to read:
  src/components/rightpanel/ActivityFeed.tsx
  src/components/rightpanel/ActivityDetailPanel.tsx
  src/components/shared/ToolBadge.tsx
  src/stores/activityStore.ts

Document:
  - What the Activity Feed shows: every tool operation Claude performs
  - Tool badge colors: what each color means
    (read=blue, write=green, edit=yellow, bash=purple, etc.)
  - Clicking an activity entry: opens the detail panel
  - Activity detail panel: full content of the tool operation
    (file content, diff, bash output)
  - Approve/reject inline (in Normal mode)
  - How activity feed relates to the chat panel
    (chat = conversation, activity = actions)
```

**Chapter 10: File Viewer & Editor**
```
Files to read:
  src/components/rightpanel/FileViewer.tsx
  src/components/sidebar/FileTree.tsx
  src/components/sidebar/FileTreeContextMenu.tsx
  src/hooks/useFileViewer.ts
  src/hooks/useFileTree.ts

Document:
  - Browsing the file tree in the sidebar
  - File tree icons and indicators
  - Context menu (right-click): copy path, open in editor, etc.
  - Opening a file: click in file tree → opens in Files tab
  - Multi-tab editor: open multiple files simultaneously
  - Monaco editor: syntax highlighting, find & replace
  - Saving files: ⌘S
  - Auto-open files: when Claude reads/writes a file (configurable)
```

**Chapter 11: Integrated Terminals**
```
Files to read:
  src/components/rightpanel/TerminalView.tsx
  src/components/rightpanel/TerminalTabs.tsx
  src/components/rightpanel/QuickCommands.tsx
  src/components/rightpanel/DevServerBanner.tsx
  src/hooks/useTerminal.ts

Document:
  - Opening the Terminal tab in the right panel
  - Creating a new terminal: button or from empty state
  - Multiple terminal tabs (create, switch, close)
  - Quick Commands bar: configurable preset commands
    (configure in Settings → Quick Commands)
  - Dev Server Banner: shows when a dev server is running
  - Terminal shell: defaults to system shell (configurable in Settings)
  - Terminal font size (configurable in Settings → Terminal)
  - Full xterm.js terminal: supports colors, scrollback, resize
```

**Chapter 12: AI Changelog**
```
Files to read:
  src/components/rightpanel/ChangelogFeed.tsx
  src/stores/changelogStore.ts
  src/components/modals/settings/ChangelogSettingsTab.tsx

Document:
  - What the changelog does: AI summarizes what changed each session
  - Viewing changelogs in the Changelog tab
  - Per-session entries: what was built, fixed, refactored
  - Choosing the AI provider: Gemini, OpenAI, or Anthropic
    (Settings → Changelog)
  - Changelog model selection
  - Auto-generate on session end vs manual trigger
  - Project Log: all changelogs across sessions for one project
```

**Chapter 13: Multi-AI Assistants**
```
Files to read:
  src/components/rightpanel/AssistantPanel.tsx
  src/components/rightpanel/AssistantTabs.tsx
  src/components/rightpanel/AssistantChatMessages.tsx
  src/components/rightpanel/AssistantProviderMenu.tsx
  src/components/rightpanel/AssistantCommandPalette.tsx
  src/components/rightpanel/AssistantAttachmentBar.tsx
  src/components/rightpanel/AssistantMessageMenu.tsx
  src/hooks/useAssistantSession.ts
  src/hooks/useAssistantShortcuts.ts
  src/stores/assistantStore.ts

Document:
  - What assistants are: parallel AI chats (NOT Claude Code — chat only,
    can't edit files or run commands)
  - Creating an assistant tab: "+" button in Assistant panel
  - Choosing a provider: OpenAI, Google Gemini, Anthropic
  - Provider menu: model selection, token display
  - Conversations: send messages, receive streaming responses
  - Attachments: images and documents in assistant chats
  - Message menu: copy, delete individual messages
  - Assistant command palette: "/" commands in assistant chats
  - Cost tracking: per-session tokens and cost on each tab
  - Provider badges on tabs (OA = OpenAI, G = Gemini, A = Anthropic)
  - Use cases: brainstorming, code review, documentation, second opinions
  - Setting up API keys (link to Settings → AI Providers chapter)
  - Assistant shortcuts: configurable prompt shortcuts
    (Settings → Assistant Shortcuts)
```

### Part IV: Advanced Features

**Chapter 14: SpecWriter — AI-Powered Specifications**
```
Files to read:
  src/components/specwriter/SpecWriterSlideOver.tsx
  src/components/specwriter/SpecChat.tsx
  src/components/specwriter/SpecChatInput.tsx
  src/components/specwriter/SpecChatMessage.tsx
  src/components/specwriter/SpecPreview.tsx
  src/components/specwriter/SpecToolbar.tsx
  src/components/specwriter/SaveSpecDialog.tsx
  src/components/specwriter/SavedSpecsList.tsx
  src/components/specwriter/SpecWriterBadge.tsx
  src/hooks/useSpecConversation.ts
  src/lib/spec-prompts.ts
  src/lib/spec-file-requests.ts
  src/stores/specWriterStore.ts

Document:
  - What SpecWriter is: AI conversation that produces spec documents
  - Opening SpecWriter: ⌘⇧B or pen icon in title bar
  - The slide-over layout: chat on left, spec preview on right
  - Two modes: New Application (full app from scratch) vs Feature
    (add to existing codebase)
  - The conversation flow:
    1. Describe what you want
    2. AI asks clarifying questions with selectable options (?> buttons)
    3. AI presents feature list for selection (★ recommended)
    4. User confirms → AI writes the spec
  - Feature Mode specifics:
    - AI reads your project context automatically (CLAUDE.md, file tree, 
      deps, routes, components, recent git commits)
    - File request markers: AI can request to read specific files
    - Confidence tags: ✅ VERIFIED, ⚠️ INFERRED, ❓ ASSUMED
  - Spec preview: live markdown rendering as the spec streams
  - Toolbar buttons: Reset, Generate Spec, Save to Project
  - Saving specs: docs/specs/{name}.md in your project
  - Save dialog: filename, overwrite/version options
  - Saved specs list: browse and load previously saved specs
  - SpecWriter badge: shows in title bar when spec is in progress
  - Attaching images: paste mockups/screenshots into the conversation
  - Attaching documents: PDF/text documents for context
  - How to use the saved spec:
    "Tell Claude Code: Read docs/specs/feature-name.md and implement it"
```

**Chapter 15: Project Templates**
```
Files to read:
  src/components/modals/TemplatePicker.tsx
  src/components/modals/TemplateCard.tsx
  src/components/modals/TemplateDetail.tsx
  src/components/modals/ScaffoldProgress.tsx
  src-tauri/resources/templates.json

Document:
  - Opening the template picker: ⌘⇧N or "+" in title bar
  - Browsing templates: grid with category filter
  - Template categories: Frontend, Full-Stack, Backend, Mobile, Static, Docs
  - Template card: name, description, stack tags, star count, icon
  - Template detail view: full description, tech stack, prerequisites
  - Each template listed with:
    - Name, description, category
    - Key technologies
    - Scaffold type: git-clone or CLI scaffold
  - Configuring the scaffold: project name, location
  - Scaffold progress: clone → clean → install → CLAUDE.md → git init
  - What CLAUDE.md is: AI instruction file for the project
  - All available templates (list every template from templates.json)
```

**Chapter 16: Preview Browser**
```
Files to read:
  src/hooks/usePreviewServer.ts
  src/hooks/usePreviewWindow.ts
  src/hooks/useDevServerDetection.ts
  src/stores/previewStore.ts
  src/types/preview.ts
  src/components/rightpanel/DevServerBanner.tsx
  src/components/layout/TitleBar.tsx (handleRunApplication, handleScreenshot)

Document:
  - What the preview does: shows your running web app in a native window
  - Opening the preview: Globe icon in title bar or ⌘⇧P
  - Dev server detection: auto-detects port from terminal output
  - Dev server states: idle, scanning, starting, running, error
  - DevServerBanner in the Terminal tab
  - Viewport presets: mobile, tablet, desktop
  - Console log capture: see browser console in CodeMantis
  - Console drawer: toggle with ⌘⇧C (when preview focused)
  - Screenshot to chat: Camera icon captures the preview and adds
    it as an attachment to your Claude Code conversation
  - Refresh preview: ⌘R (when preview focused)
  - Error states: server not found, port conflict, startup failure
```

**Chapter 17: MCP Server Management**
```
Files to read:
  src/components/modals/McpModal/index.tsx
  src/components/modals/McpModal/TemplatePicker.tsx
  src/components/modals/McpModal/ServerForm.tsx
  src/components/modals/McpModal/ConfigFileEditor.tsx
  src/components/modals/McpModal/ScopeBadge.tsx
  src/components/modals/McpModal/TypeBadge.tsx
  src/components/modals/McpModal/helpers.ts
  src/components/modals/McpModal/types.ts
  src/components/modals/McpModal/useMcpServerForm.ts
  src/types/mcp-templates.ts
  src/stores/mcpStore.ts

Document:
  - What MCP is: Model Context Protocol — extends Claude's capabilities
  - Opening MCP modal: ⌘⇧M or Blocks icon in title bar
  - Template categories:
    - No Setup Required: Context7, Playwright, BrowserMCP, Fetch, etc.
    - Requires API Key: GitHub, Slack, Supabase, Stripe, etc.
    - Cloud Services: HTTP-based OAuth integrations
  - Every MCP template listed with: name, description, setup requirements
  - Adding from template: select → fill in config → save
  - Manual configuration: server type, command, args, env vars
  - Server types: stdio (local process), HTTP, SSE
  - Scopes: Global (~/.claude.json) vs Project (.mcp.json)
  - Scope badge: visual indicator of server scope
  - Config file editor: direct JSON editing
  - Editing and removing existing servers
```

**Chapter 18: Slash Commands & CLI Overlay**
```
Files to read:
  src/components/input/CommandPalette.tsx
  src/components/modals/CliOverlay.tsx
  src/hooks/useCommandExecution.ts
  src/types/slash-commands.ts

Document:
  - Slash commands: type "/" in the input area
  - Command palette: searchable dropdown
  - Three command categories:
    - Skill (accent color): templates that expand into prompts
    - Built-in (dim): native commands executed by CodeMantis
    - CLI-only (yellow, "Opens CLI"): commands passed to Claude CLI
  - Navigation: arrow keys, Enter to select, Escape to close, Tab to autocomplete
  - CLI Overlay (⌘/): full interactive Claude CLI terminal
  - What the CLI Overlay does: pauses stream-json, opens interactive 
    claude with --resume, lets you use /model, /config, /doctor, /help
  - Close: Escape or × button → resumes the stream-json session
  - Pre-typed commands: when a CLI-only slash command is selected,
    the command text is sent to the CLI automatically
```

### Part V: Sidebar

**Chapter 19: File Tree**
```
Files to read:
  src/components/sidebar/FileTree.tsx
  src/components/sidebar/FileTreeContextMenu.tsx
  src/hooks/useFileTree.ts

Document:
  - What the file tree shows: project directory structure
  - Expanding/collapsing folders
  - File icons and color indicators
  - Clicking a file: opens in the File Viewer (right panel → Files)
  - Context menu (right-click): copy path, open in Files, 
    reveal in Finder, etc.
  - Hidden files: .gitignore'd files, node_modules, etc.
  - Refresh behavior: auto-refreshes when files change
```

**Chapter 20: Git Status**
```
Files to read:
  src/components/sidebar/GitStatusCard.tsx
  src/hooks/useGitStatus.ts

Document:
  - Git status card at the bottom of the sidebar
  - Branch name display
  - Uncommitted changes count
  - Last commit info (message, time)
  - Last push time
  - Visual indicators for dirty/clean working tree
```

### Part VI: Settings & Configuration

**Chapter 21: Settings — General**
```
Files to read:
  src/components/modals/settings/GeneralTab.tsx
  src/types/settings.ts (ThemeId, THEMES, AppSettings)

Document:
  - Opening Settings: ⌘, or gear icon in title bar
  - Theme selection: Midnight, Ocean, Ember (dark); Dawn, Sand, Arctic (light)
  - Font size: adjustable, also via ⌘= / ⌘- / ⌘0
  - Send shortcut: Enter or ⌘Enter
  - Trivia cards: enable/disable fun facts while waiting
  - Auto-open files: when Claude reads/writes a file, open in viewer
  - Default context window size
  - Show Welcome Screen on startup
```

**Chapter 22: Settings — AI Providers**
```
Files to read:
  src/components/modals/settings/AIProvidersTab.tsx

Document:
  - API key configuration for each provider:
    OpenAI, Google Gemini, Anthropic
  - Where to get API keys (links)
  - Key validation / testing
  - Which features need API keys:
    - Claude Code: NO key needed (uses Claude subscription)
    - Multi-AI Assistants: YES, needs provider key
    - AI Changelog: YES, needs provider key
    - SpecWriter: YES, needs provider key (for the AI conversation)
```

**Chapter 23: Settings — Assistant, Changelog, Terminal, Quick Commands**
```
Files to read:
  src/components/modals/settings/AssistantSettingsTab.tsx
  src/components/modals/settings/ChangelogSettingsTab.tsx
  src/components/modals/settings/TerminalTab.tsx
  src/components/modals/settings/QuickCommandsTab.tsx

Document:
  - Assistant Settings: default model, assistant shortcuts (named prompts)
  - Changelog Settings: provider, model, auto-generate toggle
  - Terminal Settings: shell path, font size
  - Quick Commands: configurable terminal command presets
    (shown below the terminal, one-click execution)
```

**Chapter 24: Settings — Shortcuts, API Logs**
```
Files to read:
  src/components/modals/settings/ShortcutsTab.tsx
  src/components/modals/settings/ApiLogsTab.tsx
  src/data/shortcuts.ts

Document:
  - Keyboard shortcuts reference (complete table):
    Global, Sessions, Panels, Preview, SpecWriter, Editor
  - API Logs: view all API calls made by CodeMantis
    (useful for debugging, cost tracking, provider issues)
```

### Part VII: Context & Status

**Chapter 25: Context Meter & Token Management**
```
Files to read:
  src/components/shared/ContextMeter.tsx
  src/components/chat/TurnStatsPopover.tsx

Document:
  - What the context meter shows: how much of Claude's context window is used
  - Warning thresholds: 80% (yellow), 95% (red)
  - What happens when context is full (Claude may forget earlier messages)
  - Turn stats: tokens used and cost per conversation turn
  - How to manage context: start new sessions for new topics
```

**Chapter 26: Error Recovery & Troubleshooting**
```
Files to read:
  src/components/chat/SessionStatusBar.tsx
  src/lib/error-handler.ts
  src/components/modals/ConfirmCloseModal.tsx
  src/components/modals/PlanCompleteModal.tsx

Document:
  - Rate limiting: what it means, countdown timer, auto-retry
  - Stale connection: detection after 60s, restart button
  - Session crashes: restart vs resume
  - Plan complete modal: when Plan mode conversation finishes
  - Confirm close: unsaved work warning
  - Data safety: files untouched, sessions preserved server-side
  - Where CodeMantis stores data: ~/Library/Application Support/dev.codemantis.app/
```

### Appendices

**Appendix A: All Keyboard Shortcuts**
```
Source: src/data/shortcuts.ts
Format: Complete table of every shortcut, grouped by category
```

**Appendix B: All Settings Options**
```
Source: All settings tab files + src/types/settings.ts
Format: Table of every setting: name, location, type, default, description
```

**Appendix C: All Project Templates**
```
Source: src-tauri/resources/templates.json
Format: Table of every template: name, category, stack, description,
        scaffold type, prerequisites
```

**Appendix D: All MCP Server Templates**
```
Source: src/types/mcp-templates.ts
Format: Table of every MCP template: name, category, server type,
        description, setup requirements
```

**Appendix E: All Slash Commands**
```
Source: src/types/slash-commands.ts + discover_commands output
Format: Table of every command: name, category, description, argument hint
```

---

## 2. Output Format Specification

### File Format

Single Markdown file: `docs/user-guide/codemantis-complete-guide.md`

### Document Structure

```markdown
<!-- 
  CodeMantis Complete User Guide
  Generated from source code by Claude Code
  Date: {date}
  App Version: {version from package.json}
-->

# CodeMantis — Complete User Guide

> This guide covers every feature, every button, every setting, and 
> every keyboard shortcut in CodeMantis. It was generated by reading 
> the application's source code — every description matches the 
> actual implementation.

## Table of Contents
[Auto-generated from headings]

---

## Part I: Getting Started
### Chapter 1: First Launch
...
```

### Per-Chapter Format

Every chapter follows this structure:

```markdown
## Chapter N: {Title}

{1-2 sentence overview of what this feature/area does}

### What You See

{Description of the UI elements: what's visible, where things are,
what the layout looks like. Written as if describing to someone who
has never seen the app.}

### How to Open / Access

{How to reach this feature: keyboard shortcut, button click, menu.
Include ALL ways to access it.}

### User Actions

Every action a user can take in this area, formatted as:

**{Action name}**
{How to do it} → {What happens}
{Any options, variations, or conditions}

### States

{Every visual state the user might encounter:}
- **Default:** {what you normally see}
- **Loading:** {what appears while data loads}
- **Empty:** {what appears when there's no data}
- **Error:** {what appears when something fails + how to recover}
- **Streaming:** {if applicable — what appears during AI response}

### Configuration

{Any related settings, with exact path: Settings → {Tab} → {Option}}

### Keyboard Shortcuts

{All shortcuts relevant to this chapter, as a mini-table}

### Tips

{1-3 practical tips for getting the most out of this feature}
```

### Rules for Writing

1. **Describe what the user SEES, not what the code DOES.** 
   Wrong: "The component renders a useState hook..."
   Right: "A spinner appears in the center of the panel..."

2. **Every button, link, and interactive element gets described.**
   What it looks like, where it is, what happens when you click it.

3. **Use exact text from the UI.** If a button says "Save to Project", 
   write "Save to Project" — not "save the file" or "export".

4. **Include keyboard shortcuts inline** wherever relevant.
   "Click the gear icon or press ⌘, to open Settings."

5. **Reference other chapters** when features connect.
   "For details on API key setup, see Chapter 22: Settings — AI Providers."

6. **Be specific about the location of UI elements.**
   "In the title bar, the fifth button from the right (globe icon)..."

7. **Appendices use tables**, not prose. Every item, no exceptions.

---

## 3. The Prompt

Copy-paste this into Claude Code. Run it in the CodeMantis project directory.

```
I need you to produce a complete user guide for CodeMantis by reading the actual source code. The guide documents every feature, every button, every setting, and every user action — written for someone who has never seen the app.

OUTPUT: Create the file docs/user-guide/codemantis-complete-guide.md

STRUCTURE: The guide has 26 chapters in 7 parts, plus 5 appendices. Work through each chapter sequentially. For each chapter, read the listed source files first, then write the documentation.

FORMAT PER CHAPTER:
- "What You See" — describe the UI elements visually
- "How to Open / Access" — every way to reach this feature
- "User Actions" — every action: **{Action}** {how} → {result}
- "States" — Default, Loading, Empty, Error (where applicable)
- "Configuration" — related settings with exact path
- "Keyboard Shortcuts" — shortcuts for this area
- "Tips" — 1-3 practical tips

WRITING RULES:
- Describe what users SEE, not what the code does
- Use exact UI text (button labels, modal titles, toast messages)
- Include keyboard shortcuts inline: "Press ⌘⇧N or click the + button"
- Cross-reference chapters: "See Chapter 22 for API key setup"
- Be specific about location: "fifth button from the right in the title bar"
- Every interactive element gets: what it looks like, where it is, what it does

START WITH: Read package.json for the version number. Read src/data/shortcuts.ts for the full shortcut registry. Then begin Chapter 1.

CHAPTER CATALOG:

Part I: Getting Started
Ch 1: First Launch — read src/components/onboarding/WelcomeScreen.tsx, src/stores/settingsStore.ts
Ch 2: The Interface — read src/components/layout/AppShell.tsx, TitleBar.tsx, SessionSubTabs.tsx, src/components/sidebar/Sidebar.tsx
Ch 3: Projects — read src/components/modals/ProjectPicker.tsx, src/components/layout/ProjectTab.tsx

Part II: Working with Claude Code
Ch 4: Chat Panel — read src/components/chat/ChatPanel.tsx, MessageBubble.tsx, CodeBlock.tsx, ThinkingIndicator.tsx, StreamingCursor.tsx, TurnStatsPopover.tsx, TriviaCard.tsx, SessionStatusBar.tsx
Ch 5: Input Area — read src/components/input/InputArea.tsx, AttachmentBar.tsx, ModeSelector.tsx, ModelSelector.tsx, CommandPalette.tsx
Ch 6: Session Modes — read src/components/input/ModeSelector.tsx, src/types/session.ts
Ch 7: Tool Approvals — read src/components/modals/ToolApproval.tsx, src/hooks/useToolApprovalListener.ts
Ch 8: Sessions & History — read src/components/layout/SessionSubTabs.tsx, src/components/chat/ClaudeHistory.tsx, ProjectLogFeed.tsx

Part III: The Right Panel
Ch 9: Activity Feed — read src/components/rightpanel/ActivityFeed.tsx, ActivityDetailPanel.tsx, src/components/shared/ToolBadge.tsx
Ch 10: File Viewer — read src/components/rightpanel/FileViewer.tsx, src/components/sidebar/FileTree.tsx, FileTreeContextMenu.tsx
Ch 11: Terminals — read src/components/rightpanel/TerminalView.tsx, TerminalTabs.tsx, QuickCommands.tsx, DevServerBanner.tsx
Ch 12: Changelog — read src/components/rightpanel/ChangelogFeed.tsx, src/stores/changelogStore.ts, src/components/modals/settings/ChangelogSettingsTab.tsx
Ch 13: AI Assistants — read src/components/rightpanel/AssistantPanel.tsx, AssistantTabs.tsx, AssistantChatMessages.tsx, AssistantProviderMenu.tsx, AssistantCommandPalette.tsx, AssistantAttachmentBar.tsx, AssistantMessageMenu.tsx

Part IV: Advanced Features
Ch 14: SpecWriter — read ALL files in src/components/specwriter/, src/hooks/useSpecConversation.ts, src/lib/spec-prompts.ts, src/lib/spec-file-requests.ts, src/stores/specWriterStore.ts
Ch 15: Templates — read src/components/modals/TemplatePicker.tsx, TemplateCard.tsx, TemplateDetail.tsx, ScaffoldProgress.tsx, src-tauri/resources/templates.json
Ch 16: Preview Browser — read src/hooks/usePreviewServer.ts, usePreviewWindow.ts, useDevServerDetection.ts, src/stores/previewStore.ts, src/types/preview.ts
Ch 17: MCP Servers — read ALL files in src/components/modals/McpModal/, src/types/mcp-templates.ts
Ch 18: Slash Commands & CLI — read src/components/input/CommandPalette.tsx, src/components/modals/CliOverlay.tsx, src/types/slash-commands.ts

Part V: Sidebar
Ch 19: File Tree — read src/components/sidebar/FileTree.tsx, FileTreeContextMenu.tsx
Ch 20: Git Status — read src/components/sidebar/GitStatusCard.tsx, src/hooks/useGitStatus.ts

Part VI: Settings
Ch 21: General — read src/components/modals/settings/GeneralTab.tsx, src/types/settings.ts
Ch 22: AI Providers — read src/components/modals/settings/AIProvidersTab.tsx
Ch 23: Assistant, Changelog, Terminal, Commands — read AssistantSettingsTab.tsx, ChangelogSettingsTab.tsx, TerminalTab.tsx, QuickCommandsTab.tsx
Ch 24: Shortcuts & API Logs — read ShortcutsTab.tsx, ApiLogsTab.tsx, src/data/shortcuts.ts

Part VII: Context & Status
Ch 25: Context Meter — read src/components/shared/ContextMeter.tsx, src/components/chat/TurnStatsPopover.tsx
Ch 26: Error Recovery — read src/components/chat/SessionStatusBar.tsx, src/lib/error-handler.ts, src/components/modals/ConfirmCloseModal.tsx, PlanCompleteModal.tsx

Appendices (tables only):
A: All Keyboard Shortcuts — from src/data/shortcuts.ts
B: All Settings — from all settings tabs + src/types/settings.ts
C: All Templates — from src-tauri/resources/templates.json
D: All MCP Templates — from src/types/mcp-templates.ts
E: All Slash Commands — from src/types/slash-commands.ts + discover_commands

Write the complete guide now. Take your time — quality over speed.
```

---

## 4. Session Plan

The full guide is too large for a single Claude Code context window. Split into 3-4 sessions:

| Session | Chapters | Est. Output |
|---------|----------|-------------|
| 1 | Part I + II (Ch 1-8) | ~40 pages |
| 2 | Part III + IV (Ch 9-18) | ~60 pages |
| 3 | Part V + VI + VII (Ch 19-26) | ~30 pages |
| 4 | Appendices A-E + review pass | ~20 pages |

**Session 1 prompt:** Use the full prompt above, but add at the end:
"For this session, write Part I and Part II (Chapters 1-8). Save to docs/user-guide/part-1-2.md"

**Session 2 prompt:** "Continue the CodeMantis User Guide. Read docs/user-guide/part-1-2.md to match tone and format. Now write Part III and Part IV (Chapters 9-18). Save to docs/user-guide/part-3-4.md"

**Session 3 prompt:** Same pattern for Parts V-VII.

**Session 4 prompt:** "Read all parts in docs/user-guide/. Merge into a single docs/user-guide/codemantis-complete-guide.md. Add the table of contents. Write the 5 appendix tables. Review for gaps: is every button in TitleBar.tsx documented? Every setting in each tab? Every template in templates.json? Every MCP template? Fix any gaps."

---

## 5. Embedding in CodeMantis (In-App Support AI)

### The Concept

Add a "Help" or "Ask CodeMantis" assistant that uses the user guide as its knowledge base. When a user asks "how do I add an MCP server?" or "what does the yellow dot mean?", the assistant answers from the guide — with exact UI descriptions, keyboard shortcuts, and step-by-step instructions.

### Implementation: A Dedicated Assistant Provider

The simplest path: add a new assistant tab type called "Help" that pre-loads the user guide as a system prompt.

**New assistant type in the Assistant Panel:**
- Provider: uses whichever AI provider the user has configured (Gemini/OpenAI/Anthropic)
- System prompt: the complete user guide document (or the relevant chapter)
- Tab label: "Help" with a ❓ icon
- The user types questions; the AI answers from the guide

**How it works technically:**
1. On first open, read `docs/user-guide/codemantis-complete-guide.md` from the app bundle (ship it with the app)
2. Set it as the system prompt for this assistant session
3. Add a short instruction prefix:

```
You are the CodeMantis Help Assistant. You answer questions about 
how to use CodeMantis based on the user guide below. 

Rules:
- Answer from the guide content ONLY — don't make things up
- Include keyboard shortcuts when relevant
- Reference specific UI elements by their exact label
- If the guide doesn't cover the question, say so and suggest 
  checking the GitHub Issues page
- Keep answers concise — 2-5 sentences for simple questions,
  step-by-step for how-to questions

USER GUIDE:
{content of codemantis-complete-guide.md}
```

**Token budget concern:** The full guide might be 50K+ tokens. Solutions:
- Use a model with a large context window (Gemini 2.5 Flash: 1M tokens, handles this easily)
- Or: split the guide into chapters and use RAG-style chapter selection — but this is overkill for v1. The full guide in a single system prompt with Gemini Flash is the simplest approach and works fine.

### UI Integration

Add "Help" as a button in the title bar or as a permanent tab option in the Assistant panel:

```
Title bar: [+] [📂] [📝] [🌐] [📷] [🧩] [⚙️] [❓]
                                                    ^ Help button
```

Or in the right panel tabs:
```
[Activity] [Terminal] [Files] [Changelog] [Assistant] [❓ Help]
```

Clicking opens a dedicated help assistant with the guide pre-loaded.

### Updating the Guide

Ship the guide as a bundled resource (`src-tauri/resources/user-guide.md`). When you update the app, the guide updates too. The user never has to maintain it.

---

## 6. Embedding on the Website (Help Center)

### The Connection

The user guide chapters map directly to the help center articles defined in the Website Spec (v2.0, Section 7). Here's the mapping:

| User Guide Chapter | Website Help Article |
|--------------------|--------------------|
| Ch 1: First Launch | Getting Started with CodeMantis |
| Ch 2+3: Interface + Projects | Understanding the Three-Panel Layout |
| Ch 6: Session Modes | Session Modes Explained |
| Ch 3+15: Projects + Templates | Project Templates — Start Building in Seconds |
| Ch 14: SpecWriter | SpecWriter: Writing Better Specs |
| Ch 14: SpecWriter (Feature Mode) | SpecWriter: Feature Mode for Existing Projects |
| Ch 13: Assistants | Multi-AI Assistants |
| Ch 17: MCP Servers | MCP Servers — Extending Claude's Capabilities |
| Ch 16: Preview | Preview Browser — See Your App Live |
| Ch 18: Slash Commands | Slash Commands & CLI Overlay |
| Ch 12: Changelog | AI-Powered Changelog |
| Ch 26: Error Recovery | Claude Code Not Found / Rate Limiting / Session Frozen / App Crashes |
| Ch 21: Settings General | Themes & Appearance |
| Ch 24: Shortcuts | Keyboard Shortcuts Reference |
| Ch 21-24: All Settings | Settings Reference |

### How to Produce the Website Articles

Don't write them separately. Extract and adapt from the user guide:

1. Take each chapter from the guide
2. Add the YAML frontmatter (category, tags, difficulty — from the Website Spec Section 6.1)
3. Adjust the tone: the guide is a reference document, the help articles should be slightly warmer and more "getting started" oriented
4. Add screenshots references where the Website Spec specifies them
5. Save to `content/help/{category}/{slug}.md` in the website project

This ensures the website help articles and the in-app help assistant use the same source of truth.

### AI Chat Widget on the Website (Future)

For the website, you could add a chat widget (like Intercom but AI-powered) that uses the same user guide as context. Visitors ask questions, the AI answers from the guide. 

Implementation options:
- Anthropic's API with the guide as system prompt (your own widget)
- A third-party solution like Mendable or Inkeep that ingests your docs
- Or simply: good search + well-written articles (Fumadocs search is excellent)

For launch, the search + articles approach is enough. The AI chat widget is a nice-to-have for later.
