# CodeMantis — Pre-Launch Package

**Date:** March 2026  
**Version:** 0.5.3 → 1.0.0 target  
**GitHub org:** codemantis-dev

---

## PART 1: Requirements & TODO List for Claude Code

Use this section as direct input for Claude Code sessions. Each task is self-contained with acceptance criteria.

---

### TASK 1: Add `.claude/` to .gitignore

**Priority:** BLOCKER — do this first  
**Files to modify:** `.gitignore`

Add `.claude/` to `.gitignore`. This directory contains `settings.local.json` with user-specific Claude Code permissions (allowed bash commands, file paths, etc.) and must never be committed to a public repo.

Also verify `.claude/` is not currently tracked by git. If it is, run:
```bash
git rm -r --cached .claude/
```

**Acceptance:** `git status` shows `.claude/` is untracked. The directory is listed in `.gitignore`.

---

### TASK 2: Delete `input_data/` directory

**Priority:** BLOCKER  
**Files to delete:** `input_data/trivia_dataset.json` (1.07 MB)

This is an exact duplicate of `src/data/trivia_dataset.json`. The `input_data/` directory serves no purpose in the published repo. Delete the entire directory.

**Acceptance:** `input_data/` no longer exists. `src/data/trivia_dataset.json` is unchanged. App still compiles and trivia cards still work.

---

### TASK 3: Delete stale build artifacts from `dist/`

**Priority:** HIGH  
**Files to delete:** `dist/tauri.svg`, `dist/vite.svg`

These are leftover default icons from Vite/Tauri scaffolding. The `dist/` directory itself should probably be in `.gitignore` since it's a build output. Add `dist/` to `.gitignore` and remove the directory from version control:

```bash
echo "dist/" >> .gitignore
git rm -r --cached dist/
```

**Acceptance:** `dist/` is in `.gitignore` and untracked. Fresh build via `pnpm build` still works.

---

### TASK 4: Rename `docs/requirements/ClaudeForge-Requirements.md`

**Priority:** MEDIUM  
**Files to rename:** `docs/requirements/ClaudeForge-Requirements.md` → `docs/requirements/CodeMantis-Requirements.md`

This is the last file carrying the old project name.

**Acceptance:** No file in the repo contains "ClaudeForge" in its filename.

---

### TASK 5: Update LICENSE copyright year

**Priority:** MEDIUM  
**Files to modify:** `LICENSE`

Change:
```
Copyright (c) 2025 Harald
```
To:
```
Copyright (c) 2025-2026 CodeMantis Contributors
```

**Acceptance:** LICENSE file shows updated copyright line.

---

### TASK 6: Verify or remove previously rejected templates

**Priority:** MEDIUM  
**Files to check:** `src-tauri/resources/templates.json`, `src-tauri/resources/claude-md/`

The following templates were previously flagged as problematic. Verify they actually work well, or remove them:

1. **`nextjs-saas`** (ixartz/SaaS-Boilerplate) — Was rejected because key features (auth, payments) are paywalled. If the free version is now fully functional, keep it. Otherwise remove.

2. **`fastapi-fullstack`** (fastapi/full-stack-fastapi-template) — Was rejected because the repo was stale. Check if it has been updated since. The star count in your registry says 30,000 — verify this is still accurate and the template works.

3. **`next-forge`** — Your `templates.json` points to `haydenbleasel/next-forge` but this repo has moved to `vercel/next-forge`. Update the `repo_url` to `https://github.com/vercel/next-forge`.

For each: clone the repo, run the install command from templates.json, verify the dev server starts without errors.

**Acceptance:** All templates in `templates.json` successfully scaffold, install, and start. No dead repo URLs.

---

### TASK 7: Add missing Fumadocs and Nextra templates

**Priority:** MEDIUM  
**Files to create/modify:** `src-tauri/resources/templates.json`, `src-tauri/resources/claude-md/fumadocs.md`, `src-tauri/resources/claude-md/nextra.md`

Add two new template entries to `templates.json`:

**Fumadocs (CLI scaffold):**
```json
{
  "id": "fumadocs",
  "name": "Fumadocs (Docs + Blog)",
  "description": "Beautiful documentation and blog framework for Next.js — used by Vercel v0 and Unkey.",
  "long_description": "The fastest-growing React docs framework (11K stars). Official CLI scaffold. MDX content, full-text search (Orama), syntax highlighting (Shiki), dark mode, OpenAPI docs support. Compose Content → Core → UI layers. Works with Next.js App Router from day one.",
  "category": "static",
  "tags": ["next.js", "mdx", "fumadocs", "typescript", "tailwind", "docs"],
  "repo_url": "",
  "branch": "",
  "license": "MIT",
  "install_command": "pnpm install",
  "dev_command": "pnpm dev",
  "dev_port": 3000,
  "icon": "book-open",
  "verified": true,
  "last_verified": "2026-03-11",
  "scaffold_type": "cli",
  "cli_command": "pnpm create fumadocs-app {{PROJECT_NAME}} --template +next+fuma-docs-mdx --pm pnpm --no-git"
}
```

**Nextra (Git clone):**
```json
{
  "id": "nextra",
  "name": "Nextra (Docs + Blog)",
  "description": "Powerful Next.js site framework for docs and blogs — by Shu Ding (Vercel/Next.js core team).",
  "long_description": "13.6K stars, created by a Next.js core maintainer. Dedicated docs and blog themes. File-based routing for content — just write MDX. Built-in search (flexsearch), syntax highlighting (Shiki), i18n support. Used by SWR, Turbo, and many Vercel ecosystem projects.",
  "category": "static",
  "tags": ["next.js", "mdx", "nextra", "typescript", "docs", "blog"],
  "repo_url": "https://github.com/shuding/nextra-docs-template",
  "branch": "main",
  "stars": 13600,
  "license": "MIT",
  "install_command": "pnpm install",
  "dev_command": "pnpm dev",
  "dev_port": 3000,
  "post_clone_cleanup": [".git", "LICENSE"],
  "icon": "file-text",
  "verified": true,
  "last_verified": "2026-03-11",
  "scaffold_type": "git-clone"
}
```

Also create `src-tauri/resources/claude-md/fumadocs.md`:
```markdown
# {{PROJECT_NAME}}

## Stack
Next.js (App Router), TypeScript, Tailwind CSS, Fumadocs (MDX + Core + UI)

## Structure
- `content/docs/` — Documentation pages as .mdx files (folder = sidebar group)
- `app/(home)/` — Landing page and non-docs routes
- `app/docs/` — Documentation layout and page rendering
- `app/api/search/` — Search API route handler
- `lib/source.ts` — Content source adapter (loader() provides typed content access)
- `source.config.ts` — Content collections schema and frontmatter config

## Commands
- `pnpm dev` — Start dev server (http://localhost:3000)
- `pnpm build` — Production build

## Conventions
- Docs go in `content/docs/` as .mdx files; folder structure = sidebar navigation
- Frontmatter: title, description, icon (optional) — validated by source.config.ts
- Use `meta.json` in folders to control sidebar order and labels
- Search is built-in via the API route in `app/api/search/`
- Use Fumadocs UI components: Callout, Card, Tab, Steps, TypeTable
```

And `src-tauri/resources/claude-md/nextra.md`:
```markdown
# {{PROJECT_NAME}}

## Stack
Next.js, TypeScript, Nextra, MDX

## Structure
- `pages/` — MDX content files (file = page, folder = section)
- `pages/_meta.json` — Navigation order and page titles for each folder
- `theme.config.tsx` — Nextra theme configuration (logo, links, footer, search)
- `next.config.mjs` — Next.js config wrapped with withNextra()

## Commands
- `pnpm dev` — Start dev server (http://localhost:3000)
- `pnpm build` — Production build

## Conventions
- Every folder needs a `_meta.json` to define page order and display names
- MDX files in `pages/` map directly to URL routes
- Nextra auto-generates sidebar from folder structure + _meta.json
- Code blocks get syntax highlighting automatically (Shiki-based)
- Search is built-in (flexsearch), no extra config needed
```

**Acceptance:** `pnpm create fumadocs-app test-proj --template +next+fuma-docs-mdx --pm pnpm --no-git` works. Nextra template clones and installs. Both CLAUDE.md files exist and are referenced in `templates.json`.

---

### TASK 8: Rewrite CLAUDE.md to reflect v0.5.3 reality

**Priority:** HIGH  
**Files to modify:** `CLAUDE.md`

The current CLAUDE.md still references Phase 1 checklist items, React 18+, and planning-stage language. Rewrite it to describe the project as it is now. Here is the replacement content:

```markdown
# CLAUDE.md — CodeMantis

## What This Is
CodeMantis is a native macOS desktop app (Tauri v2 + React 19 + TypeScript + Rust) that wraps the Claude Code CLI with a modern UI. Uses the user's existing Claude Pro/Max subscription — no API key needed for Claude Code features.

## Architecture
- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 3.4, Zustand 5, Radix UI, Monaco Editor, xterm.js
- **Backend:** Tauri v2, Rust, tokio, serde, rusqlite (bundled SQLite), portable-pty, axum (approval server)
- **CLI Integration:** `claude --input-format stream-json --output-format stream-json --include-partial-messages`

### Key Architectural Rules
- **Chat Panel** shows ONLY conversation text. All tool operations (file reads, writes, edits, bash) go to the **Activity Feed**
- Each session = one Claude CLI process in bidirectional stream-json mode
- Zustand for all global state. No Redux, no Context API for global state
- All Tauri IPC is async via invoke/listen
- Frontend NEVER directly accesses the filesystem — always through Tauri commands

## Project Structure
```
src/                          # React frontend
  components/
    chat/                     # ChatPanel, MessageBubble, CodeBlock, ThinkingIndicator, TriviaCard
    input/                    # InputArea, CommandPalette, ModeSelector, AttachmentBar
    layout/                   # AppShell, TitleBar, SessionTab, ProjectTab
    modals/                   # SettingsModal, ProjectPicker, TemplatePicker, McpModal, CliOverlay, ToolApproval
    rightpanel/               # RightPanel, ActivityFeed, FileViewer, TerminalView, AssistantPanel, ChangelogFeed
    sidebar/                  # Sidebar, FileTree, GitStatusCard
    shared/                   # ContextMeter, StatusDot, Toast, ToolBadge
  stores/                     # Zustand stores (session, activity, settings, assistant, terminal, etc.)
  hooks/                      # Custom hooks (useClaudeSession, useAssistantSession, useTerminal, etc.)
  types/                      # TypeScript type definitions
  lib/                        # Utilities (tauri-commands, event-classifier, editor-themes)
  data/                       # Static data (shortcuts, trivia)

src-tauri/                    # Rust backend
  src/
    claude/                   # CLI process manager, stream parser, approval server
    commands/                 # Tauri IPC commands (session, files, terminal, scaffold, mcp, etc.)
    changelog/                # LLM-powered changelog summarizer (Gemini, OpenAI, Anthropic)
    storage/                  # SQLite database (sessions, changelog entries, API logs)
    terminal/                 # PTY manager for integrated terminals
  resources/
    templates.json            # Project template registry
    claude-md/                # CLAUDE.md templates for each scaffold
```

## Commands
```bash
pnpm tauri dev          # Full app with hot reload
pnpm tauri build        # Production .dmg build
pnpm dev                # Frontend only (Vite)
pnpm lint               # ESLint
pnpm tsc --noEmit       # Type check
pnpm test               # Vitest
cd src-tauri && cargo test  # Rust tests
```

## Versioning
Semantic versioning across THREE locations (must stay in sync):
- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `"version"`

Add entry to `RELEASES.md` with every version bump.

## Code Standards
- **TypeScript:** strict mode, no `any`, explicit return types on exports
- **React:** functional components only, hooks for state/effects
- **Rust:** handle all Results (no `.unwrap()` in production), thiserror for errors
- **CSS:** Tailwind only, CSS variables for theme colors (defined in `index.css`)
- **Naming:** camelCase (TS/JS), snake_case (Rust), PascalCase (components)
- **Files:** one component per file, default export. One Rust module per file.
```

**Acceptance:** CLAUDE.md accurately reflects the current codebase. No references to Phase 1, React 18, or planning-stage language.

---

### TASK 9: Create README.md with screenshots

**Priority:** BLOCKER  
**Files to replace:** `README.md`  
**Requires:** Screenshot files placed in `docs/screenshots/`

Replace the current README with the structure defined in Part 2 of this document. Add screenshots to `docs/screenshots/` and reference them with relative paths.

**Acceptance:** README renders correctly on GitHub with all images visible. Includes hero image, feature descriptions, installation steps, and screenshot gallery.

---

### TASK 10: Bump version to 1.0.0

**Priority:** Do this LAST, after all other tasks  
**Files to modify:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `RELEASES.md`

Update version from `0.5.3` to `1.0.0` in all three locations. Add a `## 1.0.0` entry to RELEASES.md summarizing the public launch:

```markdown
## 1.0.0

- Public release on GitHub (MIT license)
- 9 project templates (Next.js, Vite+React, FastAPI, Astro, Expo, Fumadocs, Nextra, Nextplate, and more)
- Rewritten CLAUDE.md and README with screenshots
- Cleaned up repository for open source (removed duplicates, stale artifacts, old naming)
```

**Acceptance:** `grep -r "0.5.3" package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json` returns nothing. All three files show `1.0.0`.

---

### TASK SUMMARY (execution order)

```
1.  [ ] Add .claude/ to .gitignore, untrack if tracked
2.  [ ] Delete input_data/ directory
3.  [ ] Add dist/ to .gitignore, untrack
4.  [ ] Rename ClaudeForge-Requirements.md → CodeMantis-Requirements.md
5.  [ ] Update LICENSE copyright year
6.  [ ] Verify/fix template registry (next-forge URL, rejected templates)
7.  [ ] Add Fumadocs + Nextra templates and CLAUDE.md files
8.  [ ] Rewrite CLAUDE.md
9.  [ ] Create README with screenshots (see Part 2)
10. [ ] Bump version to 1.0.0
11. [ ] Final: pnpm tsc --noEmit && pnpm lint && pnpm test && cd src-tauri && cargo test
```

---

## PART 2: README Structure

This is the exact structure for the GitHub README. Replace the current README.md with this.

Screenshot placeholders are marked as `![description](docs/screenshots/filename.png)`. You need to create these screenshots and place them in `docs/screenshots/`.

---

```markdown
<div align="center">

# CodeMantis

**A native macOS desktop app for Claude Code**

Use Claude Code with a real UI — chat, activity feed, file viewer, terminals, and more.  
Uses your existing Claude Pro/Max subscription. No API key needed.

![CodeMantis hero screenshot](docs/screenshots/hero.png)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)]()
[![Built with Tauri](https://img.shields.io/badge/built_with-Tauri_v2-FFC131.svg)](https://tauri.app)

[Download .dmg](#installation) · [Screenshots](#screenshots) · [Features](#features) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is CodeMantis?

CodeMantis wraps the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI in a native macOS application. Instead of a terminal, you get a three-panel IDE-like interface with a chat panel, activity feed, file viewer, integrated terminals, and AI-powered assistants — all connected to your existing Claude subscription.

**This is not an API wrapper.** CodeMantis spawns the real `claude` CLI process and communicates via its streaming JSON protocol. Every feature of Claude Code works — tool use, file editing, bash commands, MCP servers — with a proper UI on top.

## Features

### Chat + Activity Separation
The chat panel shows only conversation text. All code operations — file reads, writes, edits, bash commands — appear in the Activity Feed with color-coded tool badges, approval controls, and expandable details.

![Chat and Activity panels](docs/screenshots/chat-activity.png)

### Session Modes
Switch between **Normal** (approve each tool use), **Auto-Accept** (let Claude work autonomously), and **Plan** (reasoning-only, no code changes). Toggle with `⌘.` or the mode selector.

### Project Templates
Scaffold new projects from 10+ curated templates: Next.js, Vite+React, FastAPI, Astro, Expo, Fumadocs, Nextra, and more. Each template includes a CLAUDE.md file optimized for Claude Code.

![Template picker](docs/screenshots/templates.png)

### Multi-AI Assistants
Open parallel assistant tabs powered by OpenAI, Google Gemini, or Anthropic APIs alongside your Claude Code session. Use them as brainstorming partners, code reviewers, or documentation helpers — while Claude Code remains the hands that edit your files.

![Assistant panel](docs/screenshots/assistants.png)

### Integrated File Viewer
Browse your project's file tree, open files in a multi-tab Monaco Editor with syntax highlighting, and view diffs. All within the app — no need to switch to VS Code for quick edits.

### Integrated Terminals
Full PTY terminals (xterm.js) inside the app. Open multiple tabs, run your dev server, execute tests — alongside your Claude Code session.

### Slash Commands
Type `/` in the input area to open a searchable command palette. Three-tier routing: skill templates expand into prompts, built-in commands execute natively, CLI commands fall back to the CLI overlay.

![Slash command palette](docs/screenshots/slash-commands.png)

### MCP Server Management
Add, edit, and remove MCP servers across global and project scopes. 15 pre-configured templates (GitHub, Slack, Supabase, Stripe, and more) with setup hints and auto-filled configuration.

### AI-Powered Changelog
After each session, CodeMantis generates a structured changelog entry summarizing what changed — powered by your choice of Gemini, OpenAI, or Anthropic. Browse per-session and per-project changelogs.

### Themes
Six built-in themes: **Midnight** (default dark), **Ocean**, **Ember**, **Dawn** (light), **Sand** (warm light), **Arctic** (cool light).

![Theme gallery](docs/screenshots/themes.png)

### And More

- **Error recovery** — auto-retry on rate limits, restart button on crashes, stale connection detection
- **Context meter** — live token usage with warnings at 80% and 95%
- **Git status** — branch name, uncommitted changes, last commit/push time
- **Session history** — resume previous Claude Code conversations
- **Keyboard shortcuts** — full shortcut reference in Settings
- **Trivia cards** — rotating facts while Claude is working (because waiting should be fun)

## Installation

### Download

Download the latest `.dmg` from the [Releases](https://github.com/codemantis-dev/codemantis/releases) page.

### Prerequisites

- **macOS** (Apple Silicon or Intel)
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** — install and sign in with your Claude Pro or Max subscription
- The `claude` command must be on your `PATH`

### From Source

```bash
# Prerequisites: Node.js (LTS), pnpm, Rust (via rustup)

git clone https://github.com/codemantis-dev/codemantis.git
cd codemantis
pnpm install
pnpm tauri dev       # Development with hot reload
pnpm tauri build     # Production .dmg
```

## Screenshots

| | |
|---|---|
| ![Full layout](docs/screenshots/hero.png) | ![Template picker](docs/screenshots/templates.png) |
| Three-panel layout with chat, activity, and file viewer | Scaffold projects from curated templates |
| ![Assistants](docs/screenshots/assistants.png) | ![MCP servers](docs/screenshots/mcp.png) |
| Multi-AI assistants (OpenAI, Gemini, Anthropic) | MCP server management with 15 templates |
| ![Themes](docs/screenshots/themes.png) | ![Settings](docs/screenshots/settings.png) |
| Six color themes (dark and light) | Settings with keyboard shortcuts reference |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘ ⇧ N` | New project from template |
| `⌘ O` | Open existing project |
| `⌘ N` | New session |
| `⌘ W` | Close session |
| `⌘ .` | Toggle mode (Normal/Auto/Plan) |
| `⌘ /` | CLI Overlay |
| `⌘ B` | Toggle sidebar |
| `⌘ ,` | Settings |
| `⌘ ⇧ M` | MCP Servers |
| `⌘ 1-9` | Switch session by number |

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Zustand, Radix UI, Monaco Editor, xterm.js
- **Backend:** Tauri v2, Rust, tokio, serde, rusqlite, portable-pty, axum
- **CLI:** Claude Code (stream-json protocol)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code standards, and PR process.

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built by a non-developer using Claude Code.  
If that's not a product demo, what is?

</div>
```

---

## PART 3: Screenshots Needed

Once you have the app running, take these screenshots. Use the **Midnight** theme (default) for most shots, and show multiple themes in the gallery shot.

| Filename | What to capture | Notes |
|----------|----------------|-------|
| `hero.png` | Full app with all three panels visible: sidebar with file tree, chat panel with a real conversation, activity feed showing tool operations | Use a real project, not an empty state. 1440×900 or higher resolution. This is the most important screenshot. |
| `chat-activity.png` | Close-up of chat panel + activity feed side by side. Chat should show a Claude response. Activity should show colored tool badges (read=blue, write=green, edit=yellow, bash=purple). | Crop to just these two panels. |
| `templates.png` | Template picker modal showing the grid of available templates | Show at least 6 templates visible in the grid |
| `assistants.png` | Assistant panel with at least 2 tabs open — one Claude Code, one API provider (e.g., Gemini). Show a conversation in progress. | The provider badge (CC/G/OA/A) should be visible on tabs |
| `slash-commands.png` | Command palette dropdown open, showing a few command categories | Type `/` in the input area to open it |
| `mcp.png` | MCP server management modal, ideally showing the template gallery or a configured server list | |
| `settings.png` | Settings modal open on the Shortcuts tab showing keyboard shortcuts | |
| `themes.png` | Composite image showing 4-6 themes. Either a grid of smaller screenshots, or a single split-screen. | Can be created by taking separate screenshots in each theme and compositing them. |
| `welcome.png` | Welcome/first-run screen | Optional — for the website |
| `terminal.png` | Terminal panel with output visible | Optional — for the website |
| `changelog.png` | Changelog feed showing session summaries | Optional — for the website |
| `file-viewer.png` | Multi-tab file viewer with Monaco editor | Optional — for the website |

---

## PART 4: FAQs

Based on the codebase, feature set, and likely user questions:

### General

**Q: What is CodeMantis?**
A: CodeMantis is a native macOS desktop application that provides a graphical user interface for Claude Code, Anthropic's coding AI. Instead of working in a terminal, you get a three-panel IDE-like layout with a chat panel, activity feed, file viewer, integrated terminals, and multi-AI assistants.

**Q: Is CodeMantis made by Anthropic?**
A: No. CodeMantis is an independent, open-source project (MIT license). It is not affiliated with, endorsed by, or supported by Anthropic. It wraps the Claude Code CLI that Anthropic provides.

**Q: Do I need an API key?**
A: Not for Claude Code features. CodeMantis uses your existing Claude Pro or Max subscription through the `claude` CLI. You authenticate once via `claude login` and CodeMantis uses that session. However, if you want to use the multi-AI assistant feature with OpenAI, Google Gemini, or Anthropic's API directly, those require separate API keys configured in Settings.

**Q: Does CodeMantis work on Windows or Linux?**
A: Currently macOS only. The app is built with Tauri v2 which supports all platforms, but the Claude Code CLI itself is only available on macOS and Linux. Windows support may come in the future depending on Claude Code's platform availability.

**Q: Is CodeMantis free?**
A: Yes, completely free and open-source under the MIT license. You do need a Claude Pro ($20/month) or Max ($100-200/month) subscription from Anthropic for the underlying Claude Code CLI.

**Q: How is this different from using Claude Code in a terminal?**
A: CodeMantis adds visual structure. Chat conversations appear in a dedicated panel while all code operations (file reads, writes, edits, bash commands) appear in a separate Activity Feed with color-coded badges. You also get integrated file browsing, multi-tab terminals, project templates, MCP server management, session history, changelogs, and parallel AI assistants — all in one window.

### Installation & Setup

**Q: What are the prerequisites?**
A: macOS (Apple Silicon or Intel), the Claude Code CLI installed and signed in (`claude` must be on your PATH), and for building from source: Node.js (LTS), pnpm, and Rust (via rustup).

**Q: How do I install Claude Code?**
A: Follow Anthropic's instructions at https://docs.anthropic.com/en/docs/claude-code. Typically: `npm install -g @anthropic-ai/claude-code`, then `claude login` to authenticate with your Claude Pro/Max subscription.

**Q: The app says "Claude Code not found" — what do I do?**
A: The `claude` CLI binary must be on your system PATH. Open a terminal and type `which claude` — if it returns nothing, Claude Code isn't installed or isn't on your PATH. Install it via npm or verify your PATH includes the directory where it was installed (often `~/.npm-global/bin/` or `/usr/local/bin/`).

**Q: Can I use this with the free Claude tier?**
A: No. Claude Code requires a Claude Pro or Max subscription. The free tier does not include CLI access.

### Features

**Q: What are session modes?**
A: CodeMantis offers three modes: **Normal** (Claude asks permission before each tool use — file edits, bash commands, etc.), **Auto-Accept** (Claude executes all tools automatically — faster but less control), and **Plan** (Claude only reasons and plans without making any code changes). Toggle with `⌘.`.

**Q: What are project templates?**
A: When creating a new project (`⌘⇧N`), you can choose from 10+ curated starter templates (Next.js, Vite+React, FastAPI, Astro, Expo, Fumadocs, Nextra, etc.). CodeMantis clones the template, installs dependencies, generates a CLAUDE.md file that teaches Claude about the project structure, and opens it as a new session.

**Q: What is CLAUDE.md?**
A: CLAUDE.md is a file at the root of your project that Claude Code reads at the start of every conversation. It contains project-specific instructions — your tech stack, folder structure, coding conventions, and available commands. CodeMantis auto-generates one for each template, and you can customize it for existing projects.

**Q: What are multi-AI assistants?**
A: You can open additional AI chat tabs alongside your Claude Code session. These can use OpenAI (GPT-4, GPT-5), Google Gemini, or Anthropic's Claude API. They're chat-only — they can't edit files or run commands. Use them for brainstorming, code review, documentation help, or getting a second opinion without leaving the app. Requires API keys configured in Settings.

**Q: What are MCP servers?**
A: MCP (Model Context Protocol) servers extend Claude Code's capabilities by connecting it to external tools and data sources — GitHub, Slack, Supabase, databases, and more. CodeMantis provides a visual interface for managing MCP server configurations across global and project scopes, with 15 pre-configured templates.

**Q: What is the AI changelog?**
A: After each coding session, CodeMantis can automatically generate a structured summary of what changed — new features, bug fixes, refactors — using an LLM (your choice of Gemini, OpenAI, or Anthropic). It creates per-session entries that you can browse by session or by project.

**Q: What is the CLI Overlay?**
A: Press `⌘/` to open a transparent overlay that drops you directly into the Claude Code CLI inside the app. This is useful for Claude CLI commands that aren't exposed in the GUI (like `/compact`, `/model`, etc.).

### Troubleshooting

**Q: Claude seems stuck or the session is frozen.**
A: CodeMantis has built-in stale connection detection. If a session is unresponsive for more than 60 seconds, you'll see a warning with a "Restart Session" button. You can also close and reopen the session tab. Your conversation history is preserved in Claude Code's own session system.

**Q: I'm getting rate-limited.**
A: Claude Code has usage limits based on your subscription tier. When rate-limited, CodeMantis shows a countdown timer and automatically retries when the limit resets. Max subscribers have significantly higher limits.

**Q: The app crashed — did I lose my work?**
A: No. Claude Code itself tracks sessions server-side. Your files on disk are unchanged. Reopen CodeMantis and resume your session from the Claude History tab, or start a new session in the same project.

**Q: How do I update CodeMantis?**
A: Download the latest .dmg from the GitHub Releases page and install it over the existing version. Your settings, session history, and changelog data are stored in `~/Library/Application Support/dev.codemantis.app/` and are preserved across updates.

---

## PART 5: Support Articles

### Article 1: Getting Started with CodeMantis

**Summary:** First-time setup guide from download to first session.

**Content outline:**
1. Prerequisites — macOS, Claude Pro/Max subscription, Claude Code CLI installed
2. Download the .dmg from GitHub Releases
3. Open the .dmg and drag CodeMantis to Applications
4. Launch — the app checks for the `claude` CLI on startup
5. Open an existing project (`⌘O`) or create from template (`⌘⇧N`)
6. Type your first message — explain the three-panel layout
7. Understand session modes — when to use Normal, Auto-Accept, Plan
8. Screenshot reference: **hero.png**, **templates.png**

### Article 2: Understanding the Three-Panel Layout

**Summary:** How the chat panel, activity feed, and right panel work together.

**Content outline:**
1. The core design principle: chat shows text, activity shows actions
2. Left sidebar — file tree, git status card
3. Center — chat panel with streaming messages, thinking indicators, code blocks
4. Right panel — tabbed: Activity Feed, File Viewer, Terminals, Changelog, Assistants
5. How tool approvals work in Normal mode (approve/reject buttons)
6. How activity entries map to Claude's tool use (read=blue, write=green, edit=yellow, bash=purple)
7. Screenshot reference: **hero.png**, **chat-activity.png**

### Article 3: Project Templates — Start Building in Seconds

**Summary:** How to use the built-in template system to scaffold new projects.

**Content outline:**
1. Open the template picker: `⌘⇧N` or menu
2. Browse templates by category (Full-Stack, Frontend, Backend, Static, Mobile)
3. Select a template — see description, stack, and star count
4. Configure project name and location
5. Watch the scaffold progress (clone → clean → install → CLAUDE.md → git init)
6. Templates ship with CLAUDE.md files optimized for Claude Code
7. List of all available templates with brief descriptions
8. Screenshot reference: **templates.png**

### Article 4: Multi-AI Assistants

**Summary:** How to use OpenAI, Gemini, and Anthropic alongside Claude Code.

**Content outline:**
1. What assistants are and aren't (chat-only, no file access)
2. Setting up API keys: Settings → AI Providers
3. Creating a new assistant tab (click + button, select provider and model)
4. Cost tracking — per-session token and cost display on tabs
5. Use cases: brainstorming, code review, documentation drafting, second opinions
6. Provider badges on tabs (CC = Claude Code, OA = OpenAI, G = Gemini, A = Anthropic)
7. Screenshot reference: **assistants.png**, **settings.png**

### Article 5: MCP Servers — Extending Claude's Capabilities

**Summary:** Connecting Claude Code to external tools and services.

**Content outline:**
1. What MCP is — Model Context Protocol, extending Claude with external tools
2. Open the MCP modal: `⌘⇧M`
3. Using pre-configured templates (15 available — GitHub, Slack, Supabase, etc.)
4. Server types: stdio (local process), HTTP, SSE
5. Scopes: global (`~/.claude.json`) vs. project (`.mcp.json`)
6. Setting up a server step-by-step (e.g., GitHub MCP server)
7. Screenshot reference: **mcp.png**

### Article 6: Keyboard Shortcuts & Productivity Tips

**Summary:** All keyboard shortcuts and power-user tips.

**Content outline:**
1. Full shortcut table (from the data/shortcuts.ts file)
2. Slash commands — type `/` for the command palette
3. Session switching — `⌘1-9` for direct access
4. Mode toggling — `⌘.` to cycle Normal → Auto → Plan
5. CLI Overlay — `⌘/` for direct CLI access
6. Context meter — watch your token budget
7. Screenshot reference: **slash-commands.png**

### Article 7: Themes & Customization

**Summary:** Personalizing the CodeMantis experience.

**Content outline:**
1. Six available themes: Midnight, Ocean, Ember, Dawn, Sand, Arctic
2. Switching themes: Settings → General
3. Dark themes (Midnight, Ocean, Ember) vs. Light themes (Dawn, Sand, Arctic)
4. Other customization: font size, send shortcut (Enter vs. Cmd+Enter), terminal shell
5. Screenshot reference: **themes.png**, **settings.png**

---

## PART 6: Website Copy

### Hero Section

**Headline:** A real UI for Claude Code  
**Subheadline:** Stop squinting at terminal output. CodeMantis wraps Claude Code in a native macOS app with a three-panel layout, project templates, multi-AI assistants, and integrated terminals. Uses your existing Claude subscription.  
**CTA:** Download for macOS · View on GitHub  
**Screenshot:** hero.png

### Feature Sections (for a scrolling landing page)

**Section 1: See Everything at Once**  
Body: Chat with Claude on the left. Watch every file read, write, edit, and bash command in the Activity Feed on the right. Color-coded tool badges tell you exactly what's happening — blue for reads, green for writes, yellow for edits, purple for bash. Approve or reject each action, or switch to Auto-Accept mode and let Claude work.  
Screenshot: **chat-activity.png**

**Section 2: Start Projects in Seconds**  
Body: Pick from 10+ curated templates — Next.js, Vite+React, FastAPI, Astro, Expo, Fumadocs, Nextra, and more. CodeMantis scaffolds the project, installs dependencies, and writes a CLAUDE.md file so Claude immediately understands your codebase. From zero to coding in under a minute.  
Screenshot: **templates.png**

**Section 3: More Than One Brain**  
Body: Open parallel AI assistants powered by OpenAI, Google Gemini, or Anthropic's Claude API. Brainstorm with GPT-5 while Claude Code edits your files. Get a second opinion on architecture. Draft documentation. Each assistant runs in its own tab with per-session cost tracking.  
Screenshot: **assistants.png**

**Section 4: Everything in One Window**  
Body: File browser, multi-tab code editor with Monaco, integrated terminals, MCP server management, session history, AI-powered changelogs, slash commands, and six beautiful themes. Everything you need, nothing you don't.  
Screenshot: **file-viewer.png** or **hero.png**

**Section 5: Built to Extend**  
Body: Connect Claude to GitHub, Slack, Supabase, databases, and 15+ other services through MCP servers. Visual management UI — no JSON editing required. Works with both global and per-project configurations.  
Screenshot: **mcp.png**

### Social Proof / Story Section

**Headline:** Built by a non-developer, using Claude Code  
Body: CodeMantis was built entirely by a product manager using Claude Code itself — from Tauri v2 scaffolding to Rust backend to React frontend. Over 10,000 lines of Rust and 15,000 lines of TypeScript, all AI-assisted. If that's not a product demo for Claude Code, what is?

### Footer CTA

**Headline:** Free. Open source. MIT licensed.  
Body: CodeMantis uses your existing Claude Pro or Max subscription. No API keys, no additional fees, no telemetry. Just download and go.  
CTA: Download v1.0.0 · Star on GitHub · Read the Docs

---

## PART 7: Screenshot Reference Map

When building the website, use these screenshots in these locations:

| Screenshot | README | Website Hero | Website Features | Support Articles |
|-----------|--------|-------------|-----------------|-----------------|
| hero.png | Hero image, Screenshots gallery | Main hero | Section 4 background | Articles 1, 2 |
| chat-activity.png | Feature section | — | Section 1 | Article 2 |
| templates.png | Feature section, Screenshots gallery | — | Section 2 | Articles 1, 3 |
| assistants.png | Feature section, Screenshots gallery | — | Section 3 | Article 4 |
| slash-commands.png | Feature section | — | — | Article 6 |
| mcp.png | Screenshots gallery | — | Section 5 | Article 5 |
| settings.png | Screenshots gallery | — | — | Articles 4, 7 |
| themes.png | Feature section, Screenshots gallery | — | — | Article 7 |
| welcome.png | — | — | Optional onboarding section | Article 1 |
| terminal.png | — | — | Section 4 alt | — |
| changelog.png | — | — | Optional feature | — |
| file-viewer.png | — | — | Section 4 | — |
