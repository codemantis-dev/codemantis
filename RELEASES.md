# ClaudeForge Releases

## 0.3.1

- Add MCP Server Management modal for viewing, adding, editing, and deleting MCP servers across global (~/.claude.json) and project (.mcp.json) scopes
- Support all three MCP server types: stdio, http, and sse with type-specific configuration forms
- Rust backend reads/writes MCP config files using serde_json::Value to safely preserve all other keys in ~/.claude.json
- Atomic file writes via temp file + rename for safe config updates
- Scope filter toggle (All/Global/Project) and inline delete confirmation
- Environment variable and header values masked by default with eye toggle to reveal
- Add Blocks icon button in title bar and Cmd+Shift+M keyboard shortcut to open MCP modal

## 0.3.0

- Add native slash command engine with three-tier routing: skills expand into prompts (no kill/respawn), built-in commands execute natively, CLI-only commands fall back to CliOverlay
- Add command palette dropdown (type `/` in input area) with fuzzy search, keyboard navigation, and category badges
- Discover custom skills from `.claude/commands/` and `.claude/skills/` directories (project and user level)
- Expand skill templates with `$ARGUMENTS`, positional args, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`, and shell command substitution
- Native built-in commands: `/clear`, `/config`, `/cost`, `/context`, `/help`, `/exit`, `/rename`, `/init`, `/doctor`
- CLI-only commands (`/compact`, `/model`, `/mcp`, etc.) open CliOverlay with command pre-typed
- `Cmd+/` remains as direct CLI escape hatch

## 0.2.9

- Detect CLI process exit and emit `ProcessExited` event to frontend with exit code, stderr tail, and elapsed time
- Show auth failure guidance (with `claude login` instructions + toast) when CLI exits quickly with auth-related stderr
- Show error message with stderr when CLI exits with non-zero code
- Wire `AskUserQuestion` tool to the existing QuestionModal so interactive CLI questions are surfaced to the user
- Add `updateSessionStatus` action to session store for process lifecycle transitions

## 0.2.8

- Add Git status card in sidebar showing branch name, uncommitted change count, last commit time, and last push time
- Add `get_git_status` Tauri command with branch, porcelain status, and remote log queries
- Auto-polls every 10 seconds and refreshes alongside file tree updates

## 0.2.7

- Add session history & resume: persist CLI session ID and model when closing sessions
- Add "Claude History" tab in session sub-tabs to browse and resume closed sessions
- Add `list_session_history` Tauri command with changelog headline previews
- Extend `create_session` to accept `resume_cli_session_id` for resuming prior conversations
- Add database migration for `cli_session_id` and `closed_at` columns on sessions table

## 0.2.6

- Fix context meter showing only non-cached tokens (10K instead of actual context usage)
- Include all token categories (input + cache_creation + cache_read) per Anthropic API spec
- Estimate per-call context window usage by dividing aggregated turn usage by API call count

## 0.2.5

- Add tool badges for TodoWrite, TodoRead, ToolSearch, WebSearch, WebFetch, and Agent tools (task, search, agent categories)
- Fix context token calculation that was double-counting cache tokens as additive instead of subsets of input_tokens

## 0.2.4

- Fix terminal black border by overriding xterm's hardcoded `#000` viewport background
- Set terminal container background to match xterm theme for seamless edges
- Increase terminal padding from 4px to 8px for better breathing room

## 0.2.3

- Fix file tree hiding dotfiles and common directories (`.gitignore`, `.lovable`, `dist`, `build`)
- Replace blanket dotfile filter with explicit ignore list for truly noisy entries (`.git`, `node_modules`, `target`, etc.)

## 0.2.2

- Add "Plan" category to changelog entries for plan-mode sessions
- Pass session mode context to changelog LLM prompt so plan-mode turns are categorized correctly
- Show Plan label with Map icon in Changelog feed

## 0.2.1

- Add bottom padding to Activity Feed, Changelog Feed, and Assistant Panel to prevent content clipping
- Reverse activity feed sort order to show newest entries first
- Merge activity entries from all sessions (main + assistants) per project with source labels
- Add multi-tab file viewer with tab bar, per-file dirty state, and independent editing/saving
- Add `sessionId` to activity entries for cross-session tracking

## 0.2.0

- Add "Thinking..." animated indicator when assistant is processing
- Add right-click context menu on user messages (Copy, Use in Chat, Add as Shortcut)
- Add "Use in Chat" to send assistant messages to the main input area
- Add assistant shortcut system with quick-access chips below the input
- Add "Assistant" tab in Settings for managing shortcuts
- Add version number display on the welcome screen
- Add tooltips to assistant tab close buttons and tab names
- Establish versioning workflow (semver across package.json, Cargo.toml, tauri.conf.json)

## 0.1.0

- Initial release
- Three-panel layout with sidebar, chat, and right panel
- Claude Code CLI integration with streaming JSON
- Tool approval modal
- Activity feed with tool operation entries
- File tree sidebar
- Terminal panel with PTY support
- Multiple session tabs
- Assistant panel with separate Claude sessions
- Changelog generation with LLM providers
- Six color themes
- Settings modal with General, Terminal, Quick Commands, and Changelog tabs
