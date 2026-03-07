# ClaudeForge — Architecture Blueprint
### A Native Mac Desktop UI for Claude Code

---

## 1. Why Tauri v2 (Not Electron)

| Factor | Tauri v2 | Electron |
|---|---|---|
| Binary size | ~3–5 MB | ~150+ MB |
| RAM usage | ~30–50 MB | ~200+ MB |
| Mac native feel | Uses WKWebView (real Safari engine) | Bundles Chromium |
| Process spawning | Rust `tokio::process` (excellent) | Node `child_process` (good) |
| Vibrancy/blur | Built-in window effects in v2 | Requires plugin |
| Your stack fit | React + TypeScript frontend ✅ | React + TypeScript frontend ✅ |

**Recommendation: Tauri v2 with React + TypeScript + Tailwind + shadcn/ui.**

Claude Desktop itself uses Electron — you'd be building something leaner and faster.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                  TAURI SHELL                     │
│          (native Mac window + menu bar)          │
├─────────────────────────────────────────────────┤
│                                                  │
│   ┌──────────────────────────────────────────┐  │
│   │         REACT FRONTEND (WKWebView)       │  │
│   │                                          │  │
│   │  ┌─────────┬──────────────┬──────────┐  │  │
│   │  │ Project │   Chat +     │  Detail   │  │  │
│   │  │ Sidebar │   Stream     │  Panel    │  │  │
│   │  │         │   View       │ (files/   │  │  │
│   │  │ • Files │              │  diffs/   │  │  │
│   │  │ • Git   │  ┌────────┐ │  terminal)│  │  │
│   │  │ • MCP   │  │ Tool   │ │          │  │  │
│   │  │ • Sesh  │  │ Approve│ │          │  │  │
│   │  │         │  │ Modal  │ │          │  │  │
│   │  └─────────┴──┴────────┴─┴──────────┘  │  │
│   └──────────────────────────────────────────┘  │
│                      ▲                           │
│                      │ Tauri IPC (invoke/events) │
│                      ▼                           │
│   ┌──────────────────────────────────────────┐  │
│   │           RUST BACKEND (src-tauri)       │  │
│   │                                          │  │
│   │  ┌──────────────┐  ┌─────────────────┐  │  │
│   │  │ Session Mgr  │  │  Process Pool   │  │  │
│   │  │ (state, hist)│  │  (spawn claude  │  │  │
│   │  │              │  │   CLI procs)    │  │  │
│   │  └──────┬───────┘  └────────┬────────┘  │  │
│   │         │                    │            │  │
│   │         ▼                    ▼            │  │
│   │  ┌──────────────┐  ┌─────────────────┐  │  │
│   │  │ SQLite (local│  │ claude -p ...   │  │  │
│   │  │ session DB)  │  │ --output-format │  │  │
│   │  │              │  │  stream-json    │  │  │
│   │  └──────────────┘  └─────────────────┘  │  │
│   └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
   ~/.claude/                  Your codebase
   (sessions, config,          (CLAUDE.md,
    CLAUDE.md, MCP)             .claude/agents/)
```

---

## 3. The Core Trick: Wrapping Claude Code CLI

The key insight is that Claude Code CLI supports two modes that make UI wrapping possible:

### Mode A: Non-Interactive Streaming (Primary)
```bash
claude -p "your prompt" \
  --output-format stream-json \
  --cwd /path/to/project \
  --allowedTools "Read" "Write" "Edit" "Bash" "Glob" "Grep"
```

This emits newline-delimited JSON (NDJSON) with every token, tool call, and result — perfect for a streaming chat UI.

### Mode B: Interactive Persistent Session (Advanced)
```bash
claude \
  --input-format stream-json \
  --output-format stream-json \
  --include-partial-messages
```

This keeps a persistent process alive with bidirectional streaming. The process maintains full conversation context internally — no need to re-send history. This is how CloudCLI works.

**For your UI, Mode B is the winner.** You get:
- Full session continuity (Claude remembers the whole conversation)
- Real-time token streaming for typewriter effects
- Tool use events you can intercept for approval modals
- Internal context compaction (Claude handles its own memory)

### What the Rust Backend Does

```rust
// Simplified — the Rust side spawns and manages claude processes
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};

async fn spawn_session(project_path: &str) -> Result<Session> {
    let child = Command::new("claude")
        .args(&[
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--include-partial-messages",
            "--cwd", project_path,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Read stdout line-by-line, parse NDJSON, emit Tauri events
    let stdout = BufReader::new(child.stdout.take().unwrap());
    let mut lines = stdout.lines();

    while let Some(line) = lines.next_line().await? {
        let event: StreamEvent = serde_json::from_str(&line)?;
        // Emit to React frontend via Tauri event system
        app_handle.emit("claude-stream", &event)?;
    }

    Ok(session)
}
```

The React frontend listens:

```typescript
import { listen } from '@tauri-apps/api/event';

// In your chat component
useEffect(() => {
  const unlisten = listen<StreamEvent>('claude-stream', (event) => {
    const data = event.payload;

    switch (data.type) {
      case 'text':       appendToChat(data.content);    break;
      case 'tool_use':   showToolApproval(data);        break;
      case 'tool_result':updateToolStatus(data);        break;
      case 'result':     markMessageComplete(data);     break;
    }
  });

  return () => { unlisten.then(fn => fn()); };
}, []);
```

---

## 4. Authentication: Your Subscription Works

Since you're wrapping the actual `claude` CLI binary (not the Agent SDK), authentication uses your existing Pro/Max login. The CLI checks `~/.claude/` for your OAuth credentials — exactly as it does when you run it in the terminal.

**No API key needed. No extra cost. Your subscription covers it.**

The only requirement: you must have run `claude login` once in your terminal so the credentials exist on disk.

---

## 5. Feature Map

### Phase 1 — Core Chat Experience
- [x] Spawn/manage Claude Code sessions per project
- [x] Streaming chat with typewriter effect
- [x] Tool approval modals (Read, Write, Bash, etc.)
- [x] Session persistence (resume conversations)
- [x] Project selector / recent projects
- [x] Dark/light theme with native Mac vibrancy

### Phase 2 — Developer Panels
- [ ] File explorer panel (read project tree)
- [ ] Inline diff viewer for file edits
- [ ] Terminal output panel for Bash tool results
- [ ] Git status / staged changes panel
- [ ] Token usage / context window indicator

### Phase 3 — Power Features
- [ ] Subagent visualization (see spawned agents working)
- [ ] MCP server status panel (connected tools)
- [ ] Custom slash commands palette (Cmd+K)
- [ ] CLAUDE.md editor with preview
- [ ] Multi-session tabs (work on multiple projects)
- [ ] Hooks configuration UI

### Phase 4 — Open Source Polish
- [ ] Onboarding wizard (detect Claude Code install, login status)
- [ ] Settings panel (model selection, tool permissions)
- [ ] Export conversation as Markdown
- [ ] Auto-update via GitHub Releases (Tauri has this built in)

---

## 6. Project Scaffolding

```
claudeforge/
├── src/                          # React frontend
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatView.tsx      # Main chat stream
│   │   │   ├── MessageBubble.tsx # Individual messages
│   │   │   ├── ToolApproval.tsx  # Approve/deny tool use
│   │   │   └── StreamIndicator.tsx
│   │   ├── Sidebar/
│   │   │   ├── ProjectList.tsx
│   │   │   ├── FileTree.tsx
│   │   │   └── SessionList.tsx
│   │   ├── Panels/
│   │   │   ├── DiffViewer.tsx
│   │   │   ├── TerminalOutput.tsx
│   │   │   └── GitStatus.tsx
│   │   └── Layout/
│   │       ├── AppShell.tsx
│   │       ├── TitleBar.tsx      # Custom Mac title bar
│   │       └── CommandPalette.tsx
│   ├── hooks/
│   │   ├── useClaudeSession.ts   # Session management
│   │   ├── useStreamParser.ts    # NDJSON event parser
│   │   └── useProjectFiles.ts    # File tree via Rust
│   ├── stores/
│   │   ├── sessionStore.ts       # Zustand — active sessions
│   │   ├── chatStore.ts          # Zustand — messages
│   │   └── settingsStore.ts
│   ├── types/
│   │   └── claude-events.ts      # TypeScript types for stream events
│   └── App.tsx
│
├── src-tauri/                    # Rust backend
│   └── src/
│       ├── main.rs
│       ├── commands/
│       │   ├── session.rs        # Start/stop/send to Claude sessions
│       │   ├── files.rs          # Read project file tree
│       │   └── settings.rs       # Read/write config
│       ├── claude/
│       │   ├── process.rs        # Spawn + manage CLI processes
│       │   ├── stream_parser.rs  # Parse NDJSON from stdout
│       │   └── session_store.rs  # SQLite session persistence
│       └── lib.rs
│
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

---

## 7. Getting Started (Concrete Steps)

```bash
# 1. Prerequisites
# - Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# - Node 18+
# - Claude Code: npm install -g @anthropic-ai/claude-code
# - Authenticated: claude login

# 2. Scaffold the project
pnpm create tauri-app claudeforge
# Choose: TypeScript, pnpm, React, TypeScript

# 3. Add UI dependencies
cd claudeforge
pnpm add @radix-ui/react-dialog @radix-ui/react-scroll-area
pnpm add zustand
pnpm add lucide-react
pnpm add -D tailwindcss postcss autoprefixer
pnpm add react-markdown remark-gfm  # For rendering Claude's markdown
pnpm add @xterm/xterm               # Terminal emulator for bash output

# 4. Add Rust dependencies (in src-tauri/Cargo.toml)
# tokio = { version = "1", features = ["full"] }
# serde = { version = "1", features = ["derive"] }
# serde_json = "1"
# rusqlite = { version = "0.31", features = ["bundled"] }

# 5. Start developing
pnpm tauri dev
```

---

## 8. Key Technical Decisions

### Why SQLite for sessions?
Claude Code already stores sessions in `~/.claude/projects/`. You can either:
- **Read those directly** (compatible with CLI sessions — you could resume a terminal session in your UI!)
- **Maintain your own** SQLite DB for richer metadata (tags, favorites, search)

Best approach: do both. Read `~/.claude/` for session discovery, store UI-specific metadata in your own SQLite.

### Why Zustand over Redux?
Minimal boilerplate, TypeScript-native, perfect for desktop apps where you need fast reactive state without the ceremony. You're already comfortable with React state patterns from Juliam.

### How to handle tool approvals?
The `stream-json` output includes `tool_use` events before execution. In your UI:
1. Parse the `tool_use` event (tool name, arguments)
2. Show an approval modal with the tool details
3. Send approval/denial back to stdin of the process
4. For pre-approved tools (Read, Glob), auto-approve silently

### How to show file diffs?
When Claude uses the `Edit` or `Write` tool, you receive the file content in the tool arguments. Use `react-diff-viewer` or Monaco Editor's diff view to show before/after.

---

## 9. Risk & Mitigation

| Risk | Mitigation |
|---|---|
| CLI interface changes between versions | Pin Claude Code version, add version check on startup |
| Stream JSON format isn't fully documented | Existing wrappers (CloudCLI, Claudex) have reverse-engineered it well; join the claude-code GitHub discussions |
| Anthropic restricts subscription for wrappers | Current stance is personal use is fine; architecture also supports API key fallback |
| Rust learning curve | Tauri's Rust layer is thin — mostly process spawning + IPC, not complex Rust. 90% of your work is in React/TypeScript |
| Token burn from context re-injection | Use persistent `stream-json` mode (Mode B above) — context stays in-process, Claude handles compaction internally |

---

## 10. Open Source Considerations

- **License**: MIT or Apache 2.0 (both common for Tauri apps)
- **Branding**: Don't call it "Claude" anything — Anthropic asked projects to rebrand (e.g., "Claudebot" → "OpenClaw"). Pick a unique name.
- **Auth**: Document that users need their own Claude Pro/Max subscription
- **Contribution**: The Tauri + React stack is very contributor-friendly
- **Distribution**: Tauri supports macOS `.dmg` builds, plus auto-update via GitHub Releases
