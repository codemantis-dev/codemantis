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

## Database Migrations
- All schema migrations run at startup in `Database::new()` (`src-tauri/src/storage/database.rs`)
- Migration SQL lives in `src-tauri/src/storage/migrations.rs`
- **Before `Database::new()` is called, `lib.rs` backs up the database file** (`codemantis.db` → `codemantis.db.backup`). This MUST remain in place — never remove or skip this backup step.
- When adding new migrations: use `ALTER TABLE … ADD COLUMN` for simple additions (ignore "duplicate column" errors), or the rename-table pattern (create new → copy → drop old → rename) for constraint changes. Test with both fresh databases and existing ones.

## Code Standards
- **TypeScript:** strict mode, no `any`, explicit return types on exports
- **React:** functional components only, hooks for state/effects
- **Rust:** handle all Results (no `.unwrap()` in production), thiserror for errors
- **CSS:** Tailwind only, CSS variables for theme colors (defined in `index.css`)
- **Naming:** camelCase (TS/JS), snake_case (Rust), PascalCase (components)
- **Files:** one component per file, default export. One Rust module per file.
