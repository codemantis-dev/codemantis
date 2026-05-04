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

### Before changing anything related to the Claude CLI protocol — REQUIRED reading
Whenever your work touches the Claude Code CLI subprocess, the stream-json protocol, the PreToolUse hook, the approval server, `permission_denials`, `control_request`/`control_response`, ExitPlanMode/EnterPlanMode/AskUserQuestion handling, or any of the files under `src-tauri/src/claude/**` and the chat/activity event handlers under `src/lib/event-handlers/**`, you MUST first consult, in this order:

1. **Skill** `.claude/skills/claude-cli-control-protocol/SKILL.md` — verified-against-live-CLI reference for every supported control_request subtype, the hook envelope, `permission_denials` semantics, model lineup, and known pitfalls (`--dangerously-skip-permissions` overriding `--permission-mode`, silent acceptance of unknown mode strings, etc.).
2. **Audit report** `docs/internal/cli-2.1.126-protocol-report.md` — per-scenario NDJSON evidence behind every claim in the skill, plus the actionable bug list (`B1`–`B5`) and what the original 2.1.123-era hypotheses got wrong.
3. **Capture harness** `src-tauri/tests/cli_protocol_capture.rs` — re-run before merging if your change makes any new assumption about CLI behaviour. Single-scenario form: `CM_HARNESS_ONLY=S06 cargo test --test cli_protocol_capture capture_single -- --ignored --nocapture`. Full battery (~3 min, consumes Anthropic credits): `cargo test --test cli_protocol_capture capture_full_battery -- --ignored --nocapture --test-threads=1`.

If the skill's claims contradict what you observe in a fresh capture, **trust the capture and update the skill** — the skill is empirically derived, not authoritative on its own. A monthly drift-check routine re-runs the harness in Anthropic's cloud and posts findings; check `https://claude.ai/code/routines` for the latest report before you start work.

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

## Testing Standards

### Running Tests
```bash
pnpm test                         # All TS unit tests
pnpm test:integration             # TS integration tests (30s timeout)
pnpm test:coverage                # TS unit tests with coverage report
pnpm test -- src/stores/          # Tests in a specific directory
cd src-tauri && cargo test         # All Rust unit + integration tests
cd src-tauri && cargo test --test '*'  # Rust integration tests only
```

### When to Write Which Type
- **Unit tests** (required for all new code): pure functions, individual store actions, serde types, event classification, command parsing
- **Integration tests** (required for cross-module features): hooks orchestrating multiple stores, event flows (CLI → event-classifier → stores → components), Tauri command → database roundtrips, approval server flows

### File Conventions
- **Unit tests:** co-located with source. `Foo.ts` → `Foo.test.ts`, `Foo.tsx` → `Foo.test.tsx`
- **Integration tests (TS):** `src/test/integration/` with `.integration.test.ts` suffix
- **Integration tests (Rust):** `src-tauri/tests/` directory
- **Test helpers (TS):** `src/test/helpers/` (store-reset, event-fixtures, event-simulator, tauri-mock-factory)
- **Test helpers (Rust):** `src-tauri/src/test_helpers.rs` (database fixtures, AppState builders)
- Always reset stores in `beforeEach` via `resetAllStores()` from `src/test/helpers/store-reset.ts`

### Coverage Requirements
- **New features:** must include tests for all public functions/exports
- **Bug fixes:** must include a regression test that fails without the fix
- **Stores:** every action must have at least one test
- **Hooks:** every hook must have tests for primary return values and side effects
- **Rust commands:** every `#[tauri::command]` must have tests for success and at least one error path

### Mocking Policy
- **Always mock:** Tauri IPC (`invoke`, `listen`, `emit`), filesystem, network, timers
- **Never mock:** Zustand stores (use real stores, reset in `beforeEach`), pure utility functions
- **Prefer real over mock:** if a dependency is a Zustand store or pure function, use the real thing. Only mock at system boundaries
- Use `src/test/helpers/tauri-mock-factory.ts` for configurable invoke mocks

### Enforcement Rules (NO DRIFT ALLOWED)
These rules are non-negotiable. Every code change must satisfy ALL of them:

1. **All tests must pass before committing.** Run `pnpm test`, `pnpm test:integration`, and `cd src-tauri && cargo test`. Zero failures allowed.
2. **`tsc --noEmit` must produce zero errors.** No type errors in any file — test files included.
3. **No code change without corresponding tests.** New features need unit tests. Cross-module features need integration tests. Bug fixes need a regression test.
4. **No `test.skip`, `test.only`, or `#[ignore]` in committed code.** All tests must run, always.
5. **Test count floors — never decrease:**
   - TS unit tests: **3,385** minimum
   - TS integration tests: **124** minimum
   - Rust unit tests: **1,227** minimum
   - Rust integration tests: **10** minimum
6. **Integration tests required for cross-module changes.** If a change touches 2+ stores, a hook + store, or the event pipeline, there must be an integration test covering the interaction.
7. **No mocking Zustand stores.** Use real stores with `resetAllStores()` in `beforeEach`. Mocking stores hides real integration bugs.
8. **Test infrastructure lives in `src/test/helpers/` (TS) and `src-tauri/src/test_helpers.rs` (Rust).** Use the existing helpers — don't reinvent per-file.

### CI Pipeline
Tests run automatically on push/PR via `.github/workflows/test.yml`:
- TypeScript: type check → lint → unit tests → integration tests
- Rust: unit tests → integration tests → clippy
