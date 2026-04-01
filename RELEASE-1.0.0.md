# CodeMantis 1.0.0

**A native macOS desktop app for Claude Code — free, open source, and built for developers who live in the terminal.**

CodeMantis gives Claude Code a three-panel graphical interface with an activity feed, file viewer, integrated terminals, live preview, and multi-AI assistants — all powered by your existing Claude Pro or Max subscription. No API key needed.

Built with Tauri v2 and Rust. Launches in under a second. Uses under 120 MB of memory. Under 30 MB download.

---

## Highlights

### A Real Desktop App, Not a Web Wrapper

CodeMantis is a native macOS application compiled to a universal binary (Intel + Apple Silicon). The backend is Rust — process management, file I/O, SQLite persistence, PTY terminals, and port detection all run natively. The frontend is React 19 with TypeScript, rendered in a single WebView with no Electron overhead.

### Works With Your Subscription

CodeMantis wraps the Claude Code CLI in bidirectional stream-json mode. If you have Claude Pro or Max, you're ready. No API keys to configure, no tokens to budget, no billing surprises.

### Open Source From Day One

MIT licensed. The full source — frontend, backend, build pipeline, templates, knowledge base — is on GitHub. Contributions welcome.

---

## Features

### Three-Panel Layout

The workspace is divided into three resizable panels:

- **Sidebar** — File tree with git status indicators, branch display, uncommitted change count, last commit/push time, and recent commits popover. Dotfile-aware with smart filtering.
- **Chat Panel** — Conversation with Claude. Streaming markdown rendering, syntax-highlighted code blocks with copy, extended thinking visualization, reasoning effort control (low/medium/high), message timestamps, turn duration, and a context meter tracking token usage against the window limit.
- **Right Panel** — Six tabbed views: Activity Feed, File Viewer, Terminal, Changelog, Assistant, and Guide.

### Activity Feed

Every tool operation Claude performs — file reads, writes, edits, bash commands, web searches, agent delegations — appears in the Activity Feed with color-coded badges, status indicators, and expandable detail panels. The chat stays clean; the feed shows the work.

Tool approvals surface as a queued modal with four options: approve once, deny, allow always for this tool, or allow always for this session. Per-project allow-lists persist across sessions.

### File Viewer

Multi-tab file viewer powered by Monaco Editor. Open files from the sidebar, from activity feed entries, or from Claude's tool operations. Per-file dirty state tracking, inline editing, and save. Files auto-open in the viewer when Claude reads or edits them.

### Integrated Terminals

Multiple xterm.js terminal instances per session with full PTY support. Tab management, themed to match the app, with automatic dev server detection — when a terminal starts a server on a known port, CodeMantis surfaces a banner to open the preview browser.

### Live Preview Browser

A native preview window for running web applications:

- **Auto-detection** of dev servers on common ports (3000, 5173, 8000, 8080, 4321, and more)
- **Responsive presets** — desktop, tablet, and mobile viewport emulation
- **Console capture** — browser console output (log, warn, error, info, debug) piped to a right-panel drawer with unread error badges
- **Manual URL fallback** when auto-detection doesn't find the server
- **CSP-safe IPC** — toolbar communication uses `document.title` bridging, not fetch, so it works on sites with strict Content Security Policies

### Multi-AI Assistants

Open parallel assistant tabs alongside Claude Code, powered by API providers:

- **OpenAI** (GPT-4.1, GPT-5, GPT-5-Mini, GPT-5-Nano)
- **Google Gemini** (Gemini 2.5 Pro/Flash, Gemini 3.0/3.1)
- **Anthropic** (Claude Sonnet 4.6, Haiku 4.5)
- **OpenRouter** — access to hundreds of third-party models

Each assistant tracks its own token usage and cost. File attachments and image paste supported with multimodal encoding. Provider badges on tabs for quick identification.

### SpecWriter

An AI-powered specification writing tool that lives in a resizable slide-over panel:

1. **Choose a mode** — "New Application" (from scratch) or "Feature" (enhance existing project)
2. **Gather context** — SpecWriter reads your codebase, respects `.gitignore`, and builds a project understanding
3. **Conversational refinement** — iterate on requirements through dialogue with option prompts and multi-select choices
4. **Generate the spec** — produces an implementation-ready specification document with streaming preview
5. **Save and reuse** — browse, export, and revisit previously saved specs

SpecWriter integrates with Claude Code CLI sessions for resumable conversations and includes a code quality audit mode.

### Super Bro — Contextual AI Coach

An intelligent guidance system that watches your coding sessions and offers proactive suggestions:

- **Knowledge modules** covering build errors, runtime errors, test failures, post-change checklists, session start tips, and "unstuck" prompts
- **Per-project toggle** with eye-icon indicator and global pause
- **Observation system** — Super Bro learns patterns, warnings, and suggestions about your codebase, persisted to the database
- **Action buttons** — copy guidance to clipboard, paste into chat, or send directly to Claude Code
- **Auto-dismiss** after 60 seconds; "all good" state when no issues detected
- **Diagnostic logging** for troubleshooting (rolling 50-entry log)

### Project Templates

11 curated, verified project scaffolds organized by category:

**Frontend**
- React + Vite (Batteries Included) — TanStack Router, TanStack Query, Zustand, Nivo, Vitest, Playwright
- React + Vite + shadcn/ui — Radix UI, Tailwind CSS 4
- Astro — Island architecture, TypeScript strict mode

**Full-Stack**
- Next.js 16 Boilerplate — Drizzle ORM, Clerk auth, PGlite, Sentry
- Next.js SaaS — Stripe billing, multi-tenancy, role-based access
- next-forge Monorepo — Turborepo, Prisma, Biome

**Backend**
- FastAPI (Official) — SQLModel, PostgreSQL, Docker, Alembic
- FastAPI Boilerplate — Async SQLAlchemy, Redis, ARQ job queue

**Mobile**
- Expo (React Native) — Expo Router, iOS + Android + web

**Content & Docs**
- Nextplate — 15+ pages, MDX blog, i18n
- Fumadocs — MDX, Orama search, OpenAPI support

Each template includes prerequisite checks (Docker, uv, pnpm, etc.), post-clone cleanup, and verified dev commands.

### MCP Server Management

Full Model Context Protocol server management from a dedicated modal (Cmd+Shift+M):

- **15+ pre-configured templates** organized by category (No Setup Required, Requires API Key, Cloud Services)
- **Three server types** — stdio (subprocess), HTTP (REST), SSE (Server-Sent Events)
- **Two scopes** — Global (`~/.claude.json`) and project-level (`.mcp.json`)
- **Guided setup** — setup hints, field help descriptions, environment variable management with masked values
- **Atomic writes** — config changes via temp file + rename for safe updates

### Slash Commands & Skills

A native command engine with three-tier routing:

- **Skills** — expand into prompts from `.claude/commands/` and `.claude/skills/` directories with template variables (`$ARGUMENTS`, `${CLAUDE_SESSION_ID}`, shell substitution)
- **Built-in commands** — `/clear`, `/cost`, `/context`, `/help`, `/exit`, `/rename`, `/init`, `/doctor`
- **CLI-only commands** — `/compact`, `/model`, `/mcp` route to the CLI overlay (Cmd+/)

Command palette with fuzzy search, keyboard navigation, and category badges.

### AI-Powered Changelog

Automatic git changelog generation using LLM providers (OpenAI, Gemini, Anthropic). Summarizes commits into categorized entries (Feature, Fix, Plan) with provider/model selection in settings. Per-call token tracking and cost display. API logs with 5-day auto-cleanup.

### Session Management

- **Multiple session tabs** per project with named sessions
- **Session history** — browse and resume closed sessions with changelog headline previews
- **Persistent chat logs** — auto-save with configurable retention period
- **Session restore** — pick up where you left off, including CLI session ID for Claude Code `--resume`
- **Project grouping** — organize sessions by project with per-project state isolation

### Extended Thinking

Visualize Claude's chain-of-thought reasoning in real time:

- Animated thinking indicator with elapsed timer
- Expandable reasoning panel showing thinking content
- Reasoning effort selector (low, medium, high)
- Sub-agent delegation tracking with nested agent visualization
- Turn statistics popover with token breakdown

### Error Recovery

- **Restart Session** button on process crash
- **Rate limit auto-retry** with countdown timer and utilization tracking (warning at >50%)
- **Stale connection detection** with progressive escalation (120s timeout, health checks, auto-recovery)
- **Auth failure guidance** with `claude login` instructions when CLI exits with auth errors
- **Friendly error UX** with translated error messages and ErrorCard component

### Themes

Five built-in color themes — three dark, two light:

| Theme | Style | Accent |
|-------|-------|--------|
| **Midnight** | Dark, purple-centric | `#7c3aed` |
| **Ocean** | Dark, blue | `#3b82f6` |
| **Ember** | Dark, warm orange | `#e67e22` |
| **Dawn** | Light, purple accent | `#7c3aed` |
| **Sand** | Light, warm brown | `#b5650a` |

All themes include color-coded tool badges (read, write, edit, bash), semantic status colors, and matched scrollbar and code block styling.

### Auto-Updates

- Checks for updates on launch with notification banner
- "Check for Updates" in Settings and macOS menu bar
- Update modal with download progress bar
- Signed and notarized macOS builds via GitHub Actions
- Universal binary (Intel + Apple Silicon)

---

## Under the Hood

### Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 3.4 |
| State | Zustand 5 (16 stores) |
| Components | Radix UI, Lucide icons |
| Editor | Monaco Editor |
| Terminal | xterm.js 6 |
| Backend | Tauri v2, Rust, tokio, serde |
| Database | rusqlite (bundled SQLite) with versioned migrations |
| Terminal backend | portable-pty |
| Approval server | axum (HTTP on ephemeral port) |
| CLI protocol | Claude Code `--input-format stream-json --output-format stream-json` |

### State Management

16 Zustand stores with clear separation of concerns — session, activity, assistant, specwriter, super-bro, preview, terminal, MCP, file viewer, changelog, guide, settings, OpenRouter, attachments, toast, and UI. All stores have 100% test coverage.

### Database

SQLite with automatic migrations at startup and pre-migration backup (`codemantis.db.backup`). Schema versioning supports both fresh installs and upgrades from any prior version.

### Process Management

- Claude Code CLI spawned as a subprocess with bidirectional stream-json I/O
- PTY pool for multiple parallel terminals
- Orphan process cleanup on startup (stale claude/node processes)
- Approval server on ephemeral port for tool use confirmation

### Testing

176 test files covering components, stores, types, hooks, and integration scenarios. Vitest for the frontend, cargo test for the backend. All 16 Zustand stores at 100% coverage.

---

## Getting Started

### Requirements

- macOS (Apple Silicon or Intel)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Claude Pro or Max subscription

### Install

Download the `.dmg` from the [Releases page](https://github.com/codemantis-dev/codemantis/releases/tag/v1.0.0), drag to Applications, and launch. CodeMantis finds your Claude Code CLI automatically.

### Build From Source

```bash
git clone https://github.com/codemantis-dev/codemantis.git
cd codemantis
pnpm install
pnpm tauri build
```

The `.dmg` will be in `src-tauri/target/release/bundle/dmg/`.

---

## Contributing

CodeMantis is MIT licensed and contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and PR process.

- Fork and branch from `dev`
- Run `pnpm tsc --noEmit && pnpm lint && pnpm test && cd src-tauri && cargo test` before submitting
- Open PRs against `dev` — `main` tracks stable releases

---

## Acknowledgments

CodeMantis is built on the work of many open-source projects — Tauri, React, Rust, xterm.js, Monaco Editor, Radix UI, Zustand, Lucide, and the Claude Code CLI. Thank you to every maintainer and contributor.

---

**License:** MIT

**Platform:** macOS (universal binary — Apple Silicon + Intel)

**Version:** 1.0.0
