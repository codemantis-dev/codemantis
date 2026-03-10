# CodeMantis — Pre-Launch Requirements

**Purpose:** Minimum required work before the first public open-source release. Everything in this document is either a blocker (will get the project dismissed immediately) or a credibility requirement (will determine whether developers take it seriously).

Organized into three tiers: **Must Ship**, **Should Ship**, and **Nice to Have**.

---

## Tier 1: MUST SHIP (Blockers)

These are non-negotiable. Missing any of these will cause developers to close the tab within 30 seconds.

---

### 1.1 Rename: ClaudeForge → CodeMantis

Anthropic actively enforces trademark claims on projects containing "Claude" in their name. This rename must happen before any public visibility.

**Changes required:**

**Branding strings (search-and-replace across all files):**
- `ClaudeForge` → `CodeMantis` (all case variations)
- `claudeforge` → `codemantis` (package names, identifiers)
- `com.claudeforge.app` → `dev.codemantis.app` (Tauri identifier)

**Files that need updating:**
- `package.json` → name field
- `src-tauri/Cargo.toml` → package name and description
- `src-tauri/tauri.conf.json` → productName, identifier
- `CLAUDE.md` → all references
- `README.md` → title, description, all references
- `RELEASES.md` → header
- All source files referencing "ClaudeForge" in UI strings, comments, paths
- `~/.claudeforge/` directory references → `~/.codemantis/`
- The approval hook script path (`approval-hook.sh`)
- SQLite database path: `com.claudeforge.app` → `dev.codemantis.app`
- Window title in tauri.conf.json

**GitHub:**
- Create the `codemantis` GitHub organization (or user)
- Create the repository as `codemantis/codemantis` or `codemantis/app`
- Secure `codemantis.dev` domain

**Validation:** Search the entire codebase for "claudeforge", "ClaudeForge", and "claude-forge" — zero results except in historical RELEASES.md entries.

---

### 1.2 App Icon

The app currently ships with the default Tauri icon (`public/tauri.svg`, `public/vite.svg`). This screams "unfinished project" in the Dock, in Finder, and in screenshots.

**Requirements:**
- Design a distinctive app icon (mantis/code themed — a stylized mantis head or praying mantis silhouette with code brackets)
- Generate all required sizes for Tauri's macOS bundle (listed in `src-tauri/tauri.conf.json` under `bundle.icon`):
  - `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.png`
- Replace `public/tauri.svg` with a CodeMantis SVG logo
- Remove `public/vite.svg`

**Approach:** Use an AI image generator (Midjourney, DALL-E) or a simple geometric design. A minimal approach works: a green mantis silhouette inside a rounded rectangle, similar to how dev tools use simple geometric icons. Or simply use a clean typographic mark (e.g., "CM" in a distinctive font inside a rounded square). The icon must look sharp at 32x32 and 128x128.

---

### 1.3 README with Screenshots

Developers will not clone or install a project without seeing what it looks like. The current README has no screenshots, no demo GIF, no visual proof that the app works.

**Requirements:**

**Hero section:**
- One full-window screenshot showing the three-panel layout with an active conversation, activity feed, and a visible file tree. This is the first thing people see.
- Place it immediately after the one-line description.

**Feature screenshots (4-6 images):**
- Chat panel with a streaming response and activity chip
- Activity feed showing READ/WRITE/EDIT/BASH entries
- Tool approval modal
- Terminal panel with a running dev server
- File viewer with syntax highlighting
- Settings modal showing themes

**Format:** PNG screenshots at 2x resolution (Retina). Store in a `docs/screenshots/` directory in the repo. Reference them in README.md with relative paths.

**Optional but high-impact:** A 30-second GIF or MP4 showing a real interaction — user sends a prompt, Claude streams a response, tools fire in the activity feed, a file gets created and auto-opens in the viewer.

---

### 1.4 LICENSE File

The repo currently has no LICENSE file. The README says "Private / unlicensed unless stated otherwise." This must change before open-sourcing.

**Requirements:**
- Add an `MIT` license file at the repo root (standard for Tauri apps and developer tools)
- Update README.md to reference MIT license
- Add a one-line license header comment suggestion in CLAUDE.md for new files

---

### 1.5 First-Run / Welcome Experience

When a user opens the app for the first time, they need to understand what they're looking at and how to start. Currently the app checks Claude status and shows the project picker, but the initial experience needs to feel polished.

**Requirements:**

**Welcome screen (when no sessions exist):**
- Show the CodeMantis logo and name
- Show Claude Code status: installed version, authentication status (green checkmark or red warning)
- "Open Project" button (opens the project picker / native folder dialog)
- List of recent projects (if any exist from previous sessions)
- Brief one-liner: "A desktop UI for Claude Code. Open a project to get started."

**Error states (already partially implemented, review for polish):**
- Claude Code not installed: show install instructions with copyable command
- Claude Code not authenticated: show "Run `claude login` in your terminal" with a button to open Terminal.app
- Both states should have a "Check Again" button

**Validation:** A completely fresh install (no SQLite database, no previous sessions) should boot to a clean, understandable welcome screen in under 2 seconds.

---

### 1.6 Pre-Built .dmg Release

Requiring developers to install Rust + clone + `pnpm tauri build` is a huge barrier. Most people evaluating an open-source tool want to download and try it immediately.

**Requirements:**
- Set up a GitHub Actions workflow that builds a universal macOS `.dmg` on each tagged release
- Use `tauri-apps/tauri-action` (the official GitHub Action)
- Produce a universal binary (`aarch64-apple-darwin` + `x86_64-apple-darwin`) so it works on both Apple Silicon and Intel Macs
- Attach the `.dmg` to GitHub Releases
- Add a "Download" section to the README with a link to the latest release

**The workflow file** should go in `.github/workflows/release.yml` and trigger on push to a `release` branch or on version tags like `v0.3.0`.

**Note on code signing:** For the initial release, skip Apple notarization. Users will need to right-click → Open or run `xattr -cr CodeMantis.app` to bypass Gatekeeper. Document this in the README under "Installation." Notarization can come later.

---

## Tier 2: SHOULD SHIP (Credibility Features)

These won't cause immediate dismissal, but their absence will be noticed by serious developers evaluating the tool. Ship as many as possible before launch.

---

### 2.1 Diff Viewer

This is the biggest functional gap. When Claude edits a file, there's currently no way to see what changed without leaving the app. Every competing tool (terminal Claude Code included) shows diffs.

**Requirements:**

**New component:** `src/components/rightpanel/DiffViewer.tsx`

**Implementation:**
- Use Monaco Editor's built-in diff editor (`MonacoDiffEditor` from `@monaco-editor/react`) — this gives you side-by-side diff with syntax highlighting for free, no additional dependency needed
- Show the original content (before edit) on the left, modified content on the right
- Header shows: file name, change summary (e.g., "+8 −4 lines")
- Toggle between side-by-side and inline/unified view

**Integration points:**
- Add a "Diff" tab to the right panel (between "Files" and "Changelog")
- When Claude performs an Edit operation, capture the before-content (from the Read that precedes the Edit) and the after-content
- Store diffs temporarily in a Zustand store (`diffStore.ts`) keyed by file path
- Clicking an EDIT entry in the Activity Feed opens the Diff tab with that file's diff
- Clicking a modified file in the Git sidebar opens the Diff tab (via `git diff` output from Rust backend)

**New right panel tab order:** Activity | Terminal | Files | Diff | Changelog | Assistant

---

### 2.2 Slash Command Palette

Slash commands are a core part of the Claude Code experience (`/compact`, `/model`, `/clear`, `/init`, `/help`, plus custom commands). Not having them accessible in the UI is a noticeable gap.

**Requirements:**

**New component:** `src/components/input/CommandPalette.tsx`

**Trigger:**
- Typing `/` as the first character in an empty input field opens the palette
- Clicking a "/ Commands" button in the input area toolbar also opens it

**Content — Built-in commands (hardcoded list):**
- `/compact` — Compress conversation to save context
- `/clear` — Clear conversation history
- `/model` — Switch model (Sonnet / Opus / Haiku)
- `/init` — Initialize CLAUDE.md in this project
- `/context` — Show context window usage
- `/help` — Show all available commands
- `/cost` — Show token cost for this session
- `/permissions` — Show current tool permissions

**Content — Custom commands (read from filesystem):**
- Scan `<project_path>/.claude/commands/` for `.md` files
- Scan `~/.claude/commands/` for `.md` files (global commands)
- Scan `<project_path>/.claude/skills/` for `SKILL.md` files
- Each file name becomes the command name (e.g., `review.md` → `/review`)
- Read the first line or YAML frontmatter `description` field for the description text

**UI:**
- Dropdown positioned above the input area
- Search/filter as the user types after `/`
- Each entry shows: command name (monospace, accent color), description, source badge ("built-in" / "project" / "global")
- Keyboard navigation: arrow keys to move, Enter to select, Escape to close
- Selecting a command inserts it into the input field

**Tauri command:** Add `list_slash_commands(project_path: String)` to `commands/files.rs` that scans the directories and returns a list of `{ name, description, source }` objects. Cache the result per session and refresh when the file tree updates.

---

### 2.3 Error Recovery & Session Resilience

If the Claude CLI process crashes (which it does occasionally — rate limits, network errors, OOM), the user should not be left staring at a broken UI with no way to recover.

**Requirements:**

**Process crash detection:**
- When the Rust backend detects the Claude CLI process has exited unexpectedly (non-zero exit code, signal), emit a `claude-error-{sessionId}` event
- The frontend shows a clear error message in the chat panel: "Claude Code session ended unexpectedly. [Restart Session] [View Error]"
- "Restart Session" spawns a new Claude CLI process for the same project, preserving the chat message history in the UI (messages are in Zustand, not in the CLI process)
- "View Error" shows the last stderr output from the crashed process

**Rate limit handling:**
- Detect rate limit errors from the stream (the JSON events include error messages about rate limits)
- Show a specific message: "Rate limit reached. Your session will resume when the limit resets." with a countdown if possible
- Auto-retry after a delay (exponential backoff: 30s, 60s, 120s)

**Network interruption:**
- If the CLI process becomes unresponsive (no stdout for 60+ seconds during an active response), show "Claude seems to be taking a while... [Wait] [Restart]"

---

### 2.4 Keyboard Shortcut Documentation

The app has keyboard shortcuts implemented (`useKeyboardShortcuts.ts`) but they're not discoverable. Users won't know they exist unless told.

**Requirements:**
- Add a "Keyboard Shortcuts" section to the Settings modal (or a separate modal accessible via `Cmd+/`)
- Show a formatted list of all shortcuts grouped by category (Global, Chat, Panels)
- Also add a brief shortcuts hint in the README

---

### 2.5 Contributing Guide

An open-source project without a CONTRIBUTING.md signals that contributions aren't welcome or thought-through.

**Requirements:**
- Create `CONTRIBUTING.md` at the repo root
- Cover: how to set up the dev environment, how to run tests, PR process, code style expectations
- Reference the CLAUDE.md file for code standards
- Note that the project is built with Claude Code and that contributors are welcome to use it for development

---

## Tier 3: NICE TO HAVE (Polish)

These improve the experience but won't block a successful launch. Implement if time permits.

---

### 3.1 MCP Server Panel

Show connected MCP servers in the sidebar. The data is available from the CLI's session initialization event. Low effort, nice visibility.

### 3.2 Session Export

Export a conversation + activity log as a Markdown file. Useful for PR descriptions and documentation. A simple "Export" button in the session tab right-click menu.

### 3.3 Auto-Update Notification

Use `tauri-plugin-updater` to check GitHub Releases for new versions on startup. Show a non-intrusive notification when an update is available. Don't auto-install — just link to the release page.

### 3.4 Context Meter Warning

When context usage exceeds 80%, show a subtle warning in the chat area suggesting `/compact`. When it exceeds 95%, make it more prominent. The context meter exists in the sidebar but doesn't trigger any action.

### 3.5 Onboarding Tooltips

On first launch, show brief tooltips highlighting the key UI areas: "This is your chat panel", "Tool operations appear here", "Click to open a terminal". Dismiss on click. Show once per install using a `hasSeenOnboarding` flag in settings.

---

## Implementation Order

This is the recommended sequence, optimized for unblocking the release as fast as possible:

```
Week 1: Foundation
  1. Rename to CodeMantis (1.1) — do this first, everything else builds on the new name
  2. App icon (1.2) — needed for screenshots
  3. LICENSE file (1.4) — trivial, do it now
  4. Contributing guide (2.5) — write it while standards are fresh

Week 2: Core Feature Gaps
  5. Diff Viewer (2.1) — biggest functional gap
  6. Slash Command Palette (2.2) — most visible missing feature
  7. Error recovery (2.3) — prevents embarrassing crashes during demos

Week 3: Launch Prep
  8. Welcome screen polish (1.5) — first impression matters
  9. Screenshots and README update (1.3) — can only do after icon + rename
  10. GitHub Actions release workflow (1.6) — produces the .dmg
  11. Keyboard shortcut docs (2.4) — quick win

Launch: Tag v0.3.0, push to public repo, create GitHub Release with .dmg
```

---

## What NOT to Build Before Launch

Resist the temptation to add more features. The following should wait:

- **Cloud sync** — Requires a backend service. Not needed for v1.
- **Team features** — No users yet. Build when there's demand.
- **Multiple LLM provider support** — Scope creep. Stay focused on Claude Code.
- **Windows/Linux support** — macOS only for launch. Cross-platform later.
- **Plugin system** — Way too early. Ship the core first.
- **Analytics dashboard** — Nice but not a launch requirement.
- **Auto-compact** — Interesting feature but not a launch blocker.

The goal is a **tight, polished, single-platform release** that does one thing well: give Claude Code users a better desktop experience than the terminal. Ship that, get feedback, then iterate.

---

## Launch Checklist

Before tagging v0.3.0 and making the repo public:

- [ ] All "ClaudeForge" references removed, replaced with "CodeMantis"
- [ ] Custom app icon in all required sizes
- [ ] MIT LICENSE file at repo root
- [ ] README with hero screenshot, feature screenshots, install instructions
- [ ] CONTRIBUTING.md with dev setup guide
- [ ] Welcome screen works cleanly on first launch
- [ ] Diff Viewer tab in right panel (functional with Monaco diff)
- [ ] Slash Command Palette opens with `/` in input
- [ ] Error recovery shows clear message on CLI crash
- [ ] GitHub Actions workflow builds .dmg
- [ ] First .dmg attached to GitHub Release
- [ ] Test: fresh macOS install, download .dmg, open app, create session, send message, see response — end to end works
- [ ] `pnpm test` passes
- [ ] `pnpm tsc --noEmit` passes with zero errors
- [ ] No `console.log` debug output in production build
- [ ] `_requirements/` directory either removed or moved to `docs/`
- [ ] `code_example_ui/` directory removed from repo (mockup artifacts)
- [ ] `.gitignore` includes `target/`, `dist/`, `.DS_Store`
