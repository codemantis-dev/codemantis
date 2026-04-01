<div align="center">

# CodeMantis

### The Mac app Claude Code deserves

A free, open-source native macOS application that gives Claude Code a proper graphical interface — chat, activity feed, file viewer, preview browser, spec writer, terminals, and much more.

**Uses your existing Claude Pro/Max subscription. No API key needed.**

[codemantis.dev](https://codemantis.dev)

![CodeMantis](media/screenshots/CodeMantis_main_application_window_001.jpg)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)]()
[![Built with Tauri v2](https://img.shields.io/badge/built_with-Tauri_v2-FFC131.svg)](https://tauri.app)
[![GitHub Release](https://img.shields.io/github/v/release/codemantis-dev/codemantis?color=green)](https://github.com/codemantis-dev/codemantis/releases)
[![Free & Open Source](https://img.shields.io/badge/free_%26_open_source-brightgreen.svg)]()

[Download](https://github.com/codemantis-dev/codemantis/releases) · [Features](#features) · [Screenshots](#screenshots) · [User Guide](docs/user-guide/codemantis-complete-guide.md) · [Contributing](CONTRIBUTING.md)

</div>

---

<div align="center">

### See it in action

<a href="https://youtu.be/OnSXzzLzi4o">
  <img src="https://img.youtube.com/vi/OnSXzzLzi4o/maxresdefault.jpg" alt="CodeMantis in under 3 minutes" width="80%">
</a>

*CodeMantis in under 3 minutes — click to watch on YouTube*

</div>

## Why CodeMantis?

- **Not Electron.** Built with Tauri v2 and Rust. Launches in under a second. Uses under 120 MB of memory. Under 50 MB download.
- **Not an API wrapper.** Spawns the real `claude` CLI binary and communicates via its streaming JSON protocol. Your existing Pro or Max subscription is all you need.
- **Not just a terminal.** An IDE-like layout with separated chat and activity panels, a spec writer, a preview browser, integrated terminals, multi-AI assistants, and a coaching layer — all in one native window.

---

## Features

### SpecWriter — Write the Spec, Not the Code

Claude Code implements what you describe — but the quality of the description determines the quality of the result. SpecWriter is an AI conversation partner that draws out the details you'd forget. Attach mockups, screenshots, or PDFs. It reads your codebase for real file paths and context, tags its confidence level on each recommendation, and produces implementation-ready specs with verification checklists. Save specs directly to your project and send them to Claude Code in one click.

![SpecWriter](media/screenshots/CodeMantis_spec_writer_finished_spec_001.jpg)

### Implementation Guide — From Spec to Code, Step by Step

SpecWriter doesn't just hand you a document — it breaks the spec into scoped implementation sessions, each with its own file list, verification checklist, and a ready-to-go prompt you can send straight to Claude Code. Track progress across sessions, and use the **"Verify for me"** button to have Claude confirm each step before moving on.

![Implementation Guide](media/screenshots/CodeMantis_guide_session_plan_with_verify_for_me_button_001.jpg)

### Three-Panel Layout with Mode Control

The chat panel shows only conversation text. All code operations — file reads, writes, edits, bash commands — appear in the Activity Feed with color-coded tool badges, approval controls, and expandable details. Switch between **Normal** (approve each tool use), **Auto-Accept** (let Claude work autonomously), and **Plan** (reasoning only, no code changes) with `⌘.`. When a plan finishes, a **"Plan Complete — Implement Now"** dialog lets you jump straight into execution with auto-accept enabled.

![Three-panel layout](media/screenshots/CodeMantis_main_application_window_chat_001.jpg)

### Extended Thinking & Reasoning Panel

See what Claude is thinking. The Activity Feed surfaces Claude's extended reasoning in a dedicated collapsible panel, so you can follow its thought process as it works through your codebase. Sub-agent activity — parallel exploration tasks spawned by Claude — is visualized live in the chat with named task labels.

![Reasoning panel](media/screenshots/CodeMantis_Claude_reasoning_panel_001.jpg)

### Preview Browser

A native browser window for previewing your running app alongside the conversation. Auto-detects dev servers from terminal output, supports responsive viewport presets (mobile, tablet, desktop), and captures console logs — errors and warnings surface directly in the Activity Feed. Screenshot your app and feed it right back into the Claude conversation with one click.

![Preview browser](media/screenshots/CodeMantis_integrated_browser_001.jpg)

### Super Bro — Contextual AI Coach

An optional coaching layer that watches your coding sessions and offers proactive guidance. Super Bro is deployment-aware (reads live git status and recent changes), tags its confidence level, and auto-dismisses when everything looks good. Enable per-project from the sidebar. Configure provider, model, and knowledge modules in Settings.

### Multi-AI Assistants

Open parallel assistant tabs powered by OpenAI, Google Gemini, Anthropic, or OpenRouter alongside your Claude Code session. Per-session token tracking and cost display included. Use them as brainstorming partners, code reviewers, or documentation helpers — while Claude Code remains the one editing your files.

![Multi-AI assistants](media/screenshots/CodeMantis_main_application_window_with_assistant_gpt_001.jpg)

### Project Templates

Scaffold new projects from 11 curated templates — React + Vite, Next.js, Next.js SaaS, next-forge, FastAPI (official + boilerplate), Astro, Expo, Nextplate, Fumadocs, and shadcn/ui. Each template runs prerequisite checks, installs dependencies, and generates a CLAUDE.md optimized for Claude Code. Productive in under a minute.

![Project templates](media/screenshots/CodeMantis_new_project_templates_001.jpg)

### Interactive Tool Approvals & Questions

Claude asks before acting. The approval modal shows exactly what tool Claude wants to use and why, with **Approve**, **Deny**, and **Always allow in this session** options. When Claude needs your input, it presents structured question cards with recommended options — or lets you type a custom response.

| | |
|---|---|
| ![Approval](media/screenshots/CodeMantis_approval_window_001.jpg) | ![Question](media/screenshots/CodeMantis_Claude_question_answer_options_001.jpg) |

### And More

- **Monaco Editor** — Multi-tab file viewer with syntax highlighting and inline diffs
- **Integrated Terminals** — Full PTY terminals (xterm.js) with multiple tabs
- **15+ MCP Server Templates** — Add, edit, and remove MCP servers across global and project scopes
- **Slash Commands** — Searchable command palette with skill templates, built-in commands, and CLI fallback
- **AI Changelogs** — Auto-generated structured changelogs after each session (Gemini, OpenAI, or Anthropic)
- **Session Persistence** — Chat logs saved locally with automatic restore on resume; browse and resume previous sessions from Session History
- **Clone from GitHub** — Clone a repo directly from the welcome screen or project picker
- **Welcome Screen** — Guided onboarding with prerequisite checks, first-step actions, and environment verification
- **6 Themes** — Midnight, Ocean, Ember (dark) / Dawn, Sand, Arctic (light)
- **Auto-Updates** — Built-in Tauri updater with in-app update dialog and progress bar
- **Error Recovery** — Auto-retry on rate limits, restart on crashes, stale connection detection
- **Context Meter** — Live token usage with warnings at 80% and 95%
- **Git Status** — Branch name, uncommitted changes, last commit and push time
- **10,500 Trivia Facts** — Curated rotating facts while Claude is working, with easter eggs every 50th rotation

---

## Screenshots

| | |
|---|---|
| ![Full layout](media/screenshots/CodeMantis_main_application_window_001.jpg) | ![Welcome screen](media/screenshots/CodeMantis_welcome_screen_001.jpg) |
| Three-panel layout with chat, activity feed, and file viewer | Welcome screen with prerequisite checks and first steps |
| ![SpecWriter](media/screenshots/CodeMantis_spec_writer_finished_spec_001.jpg) | ![Implementation Guide](media/screenshots/CodeMantis_spec_writer_guide_result_001.jpg) |
| SpecWriter with full specification output and saved specs | Implementation Guide — scoped sessions with verification checklists |
| ![Preview Browser](media/screenshots/CodeMantis_integrated_browser_001.jpg) | ![Console capture](media/screenshots/CodeMantis_integrated_browser_console_handling_001.jpg) |
| Live preview browser with responsive viewport presets | Console log capture with warnings surfaced in activity feed |
| ![Reasoning](media/screenshots/Codemantis_show_claude_code_reasoning_in_activity_001.jpg) | ![Sub-agents](media/screenshots/CodeMantis_sub_agents_working_001.jpg) |
| Extended thinking and reasoning panel in activity feed | Sub-agent visualization with parallel exploration tasks |
| ![Templates](media/screenshots/CodeMantis_new_project_templates_001.jpg) | ![Multi-AI](media/screenshots/CodeMantis_main_application_window_with_assistant_gpt_001.jpg) |
| 11 curated project templates with prerequisite checks | Parallel AI assistants (OpenAI, Gemini, Anthropic, OpenRouter) |
| ![Approval](media/screenshots/CodeMantis_approval_window_001.jpg) | ![Questions](media/screenshots/CodeMantis_Claude_question_answer_options_001.jpg) |
| Tool approval modal with per-session allow option | Interactive question cards with structured options |
| ![MCP Servers](media/screenshots/CodeMantis_mcp_server_management_001.jpg) | ![Plan Complete](media/screenshots/CodeMantis_plan_complete_implement_now_001.jpg) |
| MCP server management with 15+ templates | Plan Complete dialog — jump straight to implementation |
| ![Projects](media/screenshots/CodeMantis_projects_and_Claude_instances_001.jpg) | ![Screenshot to chat](media/screenshots/CodeMantis_screenshots_and_console_logs_from_integrated_browser_001.jpg) |
| Multiple projects with independent Claude sessions | Screenshot and console logs fed back into conversation |

---

## Quick Start

### Download

Grab the latest `.dmg` from the [Releases](https://github.com/codemantis-dev/codemantis/releases) page.

**Prerequisites:**

- macOS (Apple Silicon or Intel)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and signed in with a Claude Pro or Max subscription
- The `claude` command must be on your `PATH`

### Build from Source

```bash
# Prerequisites: Node.js (LTS), pnpm, Rust (via rustup)

git clone https://github.com/codemantis-dev/codemantis.git
cd codemantis
pnpm install
pnpm tauri dev       # Development with hot reload
pnpm tauri build     # Production .dmg
```

---

<details>
<summary><strong>Keyboard Shortcuts</strong></summary>

### Global

| Shortcut | Action |
|----------|--------|
| `⌘ ⇧ N` | New project from template |
| `⌘ O` | Open existing project |
| `⌘ ,` | Settings |
| `⌘ ⇧ M` | MCP Servers |
| `⌘ /` | CLI Overlay |
| `⌘ .` | Toggle mode (Normal / Auto / Plan) |
| `⌘ =` | Zoom in |
| `⌘ -` | Zoom out |
| `⌘ 0` | Reset zoom |
| `⌘ ?` | Toggle Help panel |

### Sessions

| Shortcut | Action |
|----------|--------|
| `⌘ N` | New session |
| `⌘ W` | Close session |
| `⌘ ⇧ [` | Previous session |
| `⌘ ⇧ ]` | Next session |
| `⌘ 1-9` | Switch to session by number |

### Panels

| Shortcut | Action |
|----------|--------|
| `⌘ B` | Toggle sidebar |
| `⌘ ⇧ A` | Focus activity feed |
| `⌘ ⇧ F` | Focus file viewer |
| `⌘ ⇧ T` | Focus terminal |
| `⌘ ⇧ L` | Focus changelog |

### Preview

| Shortcut | Action |
|----------|--------|
| `⌘ ⇧ P` | Toggle Preview Window |
| `⌘ R` | Refresh preview |
| `⌘ ⇧ C` | Toggle Console Drawer |

### SpecWriter

| Shortcut | Action |
|----------|--------|
| `⌘ ⇧ B` | Toggle SpecWriter |

### Editor

| Shortcut | Action |
|----------|--------|
| `⌘ S` | Save file |

</details>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 3.4, Zustand 5, Radix UI |
| Editor | Monaco Editor |
| Terminal | xterm.js |
| Backend | Tauri v2, Rust, tokio, serde |
| Database | rusqlite (bundled SQLite) |
| CLI Protocol | Claude Code stream-json (bidirectional) |

---

## Contributing

Whether you're fixing a typo, adding a feature, or improving docs — all contributions are welcome.

```bash
pnpm tauri dev          # Full app with hot reload
pnpm lint               # ESLint
pnpm tsc --noEmit       # Type check
pnpm test               # Frontend tests (Vitest)
cd src-tauri && cargo test  # Rust tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full setup instructions, code standards, and PR process.

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built by a non-developer. Powered by Claude Code. Crafted for Mac.**

If that's not a product demo, what is? [Read the story &rarr;](https://codemantis.dev/blog/built-by-non-developer)

[Website](https://codemantis.dev) · [GitHub](https://github.com/codemantis-dev/codemantis) · [Releases](https://github.com/codemantis-dev/codemantis/releases) · [User Guide](docs/user-guide/codemantis-complete-guide.md)

</div>
