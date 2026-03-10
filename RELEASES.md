# CodeMantis Releases

## 0.4.1

- Add model selection dropdown in Changelog settings (per provider: OpenAI, Gemini, Anthropic)
- Update available models: GPT-4.1/5-Nano/5-Mini, Gemini 2.5 Flash Lite/Flash, Claude Sonnet 4.6/Haiku 4.5
- Track API token usage and cost for each changelog generation call
- Add pricing module with per-model cost calculation
- Add `api_logs` database table with auto-migration
- Add "API Logs" tab in Settings showing cost summary and scrollable call history
- Auto-delete API logs older than 5 days on tab open
- Pass selected model to `test_changelog_api_key` for accurate validation
- Fix: question text not showing in "Claude has a question" modal (tool input was empty at ContentBlockStart)
- Fix: answers in question modal now sent as regular user messages (old tool_result format was rejected by CLI)
- Fix: changelog model validation ensures model matches the selected provider (prevents cross-provider model mismatch)

## 0.4.0

- Rename project from ClaudeForge to CodeMantis across all source files, configs, and UI strings
- Update Tauri identifier from `com.claudeforge.app` to `dev.codemantis.app`
- Rename data directories from `~/.claudeforge/` to `~/.codemantis/` and `.claudeforge/` to `.codemantis/`
- Add localStorage migration for recent projects key
- Delete `code_example_ui/` directory and `public/vite.svg`
- Move `_requirements/` to `docs/requirements/`
- Add `.codemantis/` to file tree ignore list and `.gitignore`
- Add MIT LICENSE file
- Add CONTRIBUTING.md with dev setup, test, PR process, and code standards
- Add error recovery: "Restart Session" button on process crash, rate limit auto-retry with countdown, and stale connection timeout detection
- Add context meter toast notifications at 80% (warning) and 95% (urgent) thresholds suggesting /compact
- Add "Shortcuts" tab in Settings modal showing all keyboard shortcuts grouped by category
- Add GitHub Actions release workflow for building macOS .dmg on version tags

## 0.3.4

- Add trivia facts that rotate every 10 seconds while Claude is working, shown as a card below the ThinkingIndicator
- Curated dataset of 10,500 facts (1,050 topics × 10 pieces) bundled from input_data/trivia_dataset.json
- Easter egg facts shown every 50th rotation with distinct gold-accented styling
- No consecutive topic repeats; fade-in animation on each new fact
- Custom hook (useTriviaRotation) manages lifecycle, interval, and easter egg scheduling

## 0.3.3

- Fix incorrect MCP template configs: Supabase now uses HTTP cloud type (not stdio), Slack uses SLACK_TEAM_ID (not SLACK_APP_TOKEN), PostgreSQL passes connection URL as argument (not env var), Stripe uses STRIPE_SECRET_KEY with --tools=all flag, Cloudflare URL corrected to include /mcp path
- Add setup hints to templates — contextual guidance shown as info box in the form (OAuth instructions, where to get API keys, how to configure arguments)
- Add help descriptions to all form fields: Name, Scope, Type (with dynamic description per type), Command, Arguments, URL
- Widen MCP modal (640px → 780px) so env var names display fully without truncation
- Widen env var key column (128px → 192px) and add mouseover tooltips on key/value inputs
- Add headers support to template system for HTTP templates

## 0.3.2

- Add MCP server template gallery with 15 pre-configured servers organized in 3 categories (No Setup Required, Requires API Key, Cloud Services)
- Clicking "Add Server" now shows a template picker; selecting a template auto-fills the form with name, command, args, env vars, or URL
- "Manual Configuration" option available for power users who want a blank form
- Cancel from a pre-filled form returns to the template picker, not the server list

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
