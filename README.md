# CodeMantis

A native **macOS desktop app** that wraps the [Claude Code](https://claude.com/code) CLI with a modern UI. Uses your existing Claude Pro/Max subscription — no API key required.

Built with **Tauri v2**, **React**, and **TypeScript**.

## Features

- **Chat panel** — Streaming conversation with Claude; text-only in chat, tool activity in the sidebar
- **Activity feed** — Tool calls (read, edit, run, etc.) with approval flow and status
- **Sessions** — Multiple sessions with Normal / Auto-Accept / Plan modes
- **File tree** — Project sidebar; file viewer with Monaco Editor (diff view included)
- **Integrated terminal** — In-app terminals (xterm.js) and optional **CLI overlay** to run the Claude CLI inside the app
- **Slash commands** — Command palette with fuzzy search, three-tier routing (skills, built-in, CLI)
- **MCP server management** — Full CRUD with 15 pre-configured templates
- **Error recovery** — Auto-retry on rate limits, restart button on crashes, stale connection detection
- **Changelog feed** — Per-session change summaries via LLM providers
- **Themes** — Midnight, Ocean, Ember, Dawn, Sand, Arctic
- **Settings** — Font size, send shortcut, terminal shell, theme, keyboard shortcuts reference

## Prerequisites

- **macOS** (primary target)
- [Node.js](https://nodejs.org/) (LTS) and [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) (for Tauri)
- [Claude Code](https://claude.com/code) installed and signed in (`claude` on `PATH`)

## Quick start

```bash
# Install dependencies
pnpm install

# Run in development
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Scripts

| Command             | Description                    |
|---------------------|--------------------------------|
| `pnpm tauri dev`    | Start app with hot reload      |
| `pnpm tauri build`  | Build production app           |
| `pnpm dev`          | Frontend only (Vite)           |
| `pnpm lint`         | Run ESLint                     |
| `pnpm tsc --noEmit` | Type check                     |
| `pnpm test`         | Run Vitest                     |

## Project structure

- `src/` — React frontend (components, stores, hooks, types)
- `src-tauri/` — Rust backend (Claude CLI process, NDJSON stream, terminal PTY, storage, commands)
- `docs/requirements/` — Product spec and architecture docs
- `CLAUDE.md` — Build instructions and phase checklist for contributors

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Zustand, Radix UI, Monaco Editor, xterm.js
- **Backend:** Tauri v2, Rust, tokio, serde, rusqlite, portable-pty

## License

MIT — see [LICENSE](LICENSE) for details.
