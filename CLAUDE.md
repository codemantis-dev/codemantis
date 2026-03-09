# CLAUDE.md — ClaudeForge Build Instructions

## What This Project Is

ClaudeForge is a native macOS desktop app (Tauri v2 + React + TypeScript) that wraps the Claude Code CLI with a modern UI. It uses the user's existing Claude Pro/Max subscription — no API key.

## Primary Specification

**Read `REQUIREMENTS.md` before any implementation work.** It contains the complete product specification with architecture, module details, data models, and implementation phases.

## Implementation Approach

Follow the phases defined in Section 24 of REQUIREMENTS.md. Build Phase 1 completely before starting Phase 2.

### Phase 1 checklist:
1. Scaffold Tauri v2 project: `pnpm create tauri-app claudeforge` (TypeScript, React, pnpm)
2. Install frontend deps: tailwindcss, @radix-ui/react-dialog, zustand, lucide-react, react-markdown, remark-gfm
3. Set up the three-panel layout (AppShell component)
4. Build the Rust CLI process manager (spawn `claude` in stream-json mode)
5. Build the NDJSON stream parser and event router
6. Wire up Chat Panel with streaming text display
7. Wire up Activity Feed with tool operation entries
8. Build Tool Approval modal
9. Build basic File Tree in sidebar
10. Build Input Area

### Key architectural rules:
- Chat Panel shows ONLY text. All tool operations go to the Activity Feed.
- Each session = one Claude CLI process in bidirectional stream-json mode
- Use Zustand for state (no Redux, no Context API for global state)
- All Tauri IPC is async via invoke/listen
- Rust backend handles all process spawning, filesystem access, and persistence
- Frontend NEVER directly accesses the filesystem — always go through Tauri commands

## Tech Stack (exact versions)

- Tauri v2 (latest stable)
- React 18+
- TypeScript (strict mode)
- Vite
- Tailwind CSS v3
- Zustand
- xterm.js (@xterm/xterm) for terminals (Phase 2)
- Monaco Editor for file viewer (Phase 3)
- rusqlite with bundled feature for SQLite
- tokio with full features for async Rust
- serde + serde_json for JSON parsing
- portable-pty for terminal PTY management (Phase 2)

## Commands

```bash
# Development
pnpm tauri dev

# Build
pnpm tauri build

# Frontend only (for UI development)
pnpm dev

# Lint
pnpm lint

# Type check
pnpm tsc --noEmit
```

## File Organization Rules

- React components: one component per file, default export
- Rust modules: one module per file, re-export from mod.rs
- Types: separate files in types/ directory, imported where needed
- No barrel exports (index.ts re-exporting everything) — import directly from the file

## Coding Standards

- TypeScript: strict mode, no `any` types, explicit return types on exported functions
- React: functional components only, hooks for all state/effects
- Rust: handle all Results (no unwrap in production code), use thiserror for error types
- CSS: Tailwind classes only, CSS variables for colors (defined in index.css)
- Naming: camelCase for TS/JS, snake_case for Rust, PascalCase for components

## Versioning

ClaudeForge uses semantic versioning (major.minor.patch).

**On every commit that changes functionality:**
1. Bump the patch version (or minor for features, major for breaking)
2. Update version in ALL THREE locations:
   - `package.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `"version"`
3. Add entry to `RELEASES.md` with version number and bullet list of changes
