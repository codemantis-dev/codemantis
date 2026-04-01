# CodeMantis 1.0.0

**A native macOS desktop app for Claude Code — free, open source, and built for developers who live in the terminal.**

CodeMantis gives Claude Code a three-panel graphical interface with an activity feed, file viewer, integrated terminals, live preview, and multi-AI assistants — all powered by your existing Claude Pro or Max subscription. No API key needed.

Built with Tauri v2 and Rust. Launches in under a second. Uses under 120 MB of memory. Under 50 MB download.

---

## Highlights

- **Native macOS app** — universal binary (Intel + Apple Silicon), Rust backend, no Electron
- **Works with your subscription** — wraps Claude Code CLI in stream-json mode. No API keys, no billing surprises
- **Open source from day one** — MIT licensed, full source on GitHub

For the complete feature list, screenshots, and demo video, visit the **[README](https://github.com/codemantis-dev/codemantis#readme)** or **[codemantis.dev](https://codemantis.dev)**.

---

## Key Features

- **Three-panel layout** — sidebar with git status, chat with extended thinking, and six-tab right panel (Activity Feed, File Viewer, Terminal, Changelog, Assistant, Guide)
- **Activity Feed** — every tool operation Claude performs shown with badges and expandable details
- **Integrated terminals** — multiple PTY sessions with dev server auto-detection
- **Live preview browser** — responsive presets, console capture, CSP-safe IPC
- **Multi-AI assistants** — OpenAI, Gemini, Anthropic, OpenRouter in parallel tabs
- **SpecWriter** — conversational AI spec generation with implementation-ready output
- **Super Bro** — contextual AI coach that watches your sessions and offers proactive guidance
- **11 project templates** — React, Next.js, FastAPI, Expo, Astro, and more
- **MCP server management** — 15+ pre-configured templates, stdio/HTTP/SSE
- **Slash commands & skills** — command palette with fuzzy search
- **Auto-updates** — signed and notarized builds with in-app update flow
- **5 themes** — Midnight, Ocean, Ember, Dawn, Sand

---

## Install

Download `CodeMantis_1.0.0_universal.dmg` below, drag to Applications, and launch.

### Requirements

- macOS 12 (Monterey) or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- Claude Pro or Max subscription

### Build From Source

```bash
git clone https://github.com/codemantis-dev/codemantis.git
cd codemantis
pnpm install
pnpm tauri build
```

---

## Links

- **Website:** [codemantis.dev](https://codemantis.dev)
- **Documentation:** [README](https://github.com/codemantis-dev/codemantis#readme)
- **Contributing:** [CONTRIBUTING.md](https://github.com/codemantis-dev/codemantis/blob/dev/CONTRIBUTING.md)

---

**License:** MIT  |  **Platform:** macOS (universal binary)  |  **Version:** 1.0.0
