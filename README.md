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
