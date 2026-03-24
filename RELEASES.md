# CodeMantis Releases

## 0.8.10

- Add implementation guide sessions and right-panel guide UI
- Add shared OpenRouter model picker and fix meta-model pricing

## 0.8.9

- Route SpecWriter through provider-aware conversation pipeline
- Unify popover layering with shared Portal wrapper
- Add external link guard and richer error/spec parsing helpers

## 0.8.8

- Add OpenRouter provider support across settings and assistant flows
- Add local-only preview guard with loopback detection
- Fix preview bridge layout offsets for toolbar

## 0.8.7

- Fix Docker scaffold verification
- Fix update notification bar layout
- Sync lockfile for 0.8.6

## 0.8.6

- Add friendly error UX with translated error messages and ErrorCard component
- Add project picker busy state during session start
- Refreshed app icons (edge-to-edge source)
- Expand scaffold allowlist and improve template/settings UX

## 0.8.5

- Refresh app icons and sync lockfile
- Add community templates, Code of Conduct, and README/CONTRIBUTING updates

## 0.8.4

- Fix app icon: use correct source with rounded corners (CodeMantisIcon.png)
- Fix git log NUL format and add git command tests

## 0.8.3

- Add UpdateModal: confirmation dialog with progress bar for downloading and installing updates
- "Check Now" in Settings opens the update modal directly when an update is found
- Auto-check banner "Update Now" opens the modal instead of downloading inline

## 0.8.2

- Add recent commits popover in sidebar with git log integration
- Fix DMG icon: regenerate all icons from 1024x1024 source (was broken 16x16)
- Fix CI: add packageManager field for pnpm setup in GitHub Actions

## 0.8.1

- Add in-app auto-update: checks for updates on launch, shows notification banner
- Add "Check for Updates" button in Settings > General
- Configure signed + notarized macOS builds via GitHub Actions
- Build universal binary (Intel + Apple Silicon) with Apple Developer ID signing
- Generate updater artifacts (latest.json) for seamless auto-updates

## 0.8.0

- Version bump to 0.8.0 (pre-release)

## 0.5.5

- Add contextual activity labels: tool-specific status messages (Reading file, Editing code, Running command, Searching code, etc.)
- Add tool_progress heartbeat parsing for liveness detection during long-running tool operations
- Add compacting_status and compact_complete event handling with visual indicator
- Add rate_limit_warning event parsing with utilization tracking (shown when >50%)
- Add SessionStatusBar: persistent bottom bar showing status dot, elapsed time, tokens, cost, context %, rate limit
- Add elapsed timer on ThinkingIndicator ticking from busySince timestamp
- Add tool elapsed time display for long-running tools (>5s)
- Add message timestamps on user and assistant message bubbles
- Add "took Xm Ys" duration display on completed assistant messages
- Add project tab busy indicators: green pulsing dot (active), yellow static dot (stale >30s)
- Improve stale detection to progressive escalation instead of single-shot toast
- Add SessionActivityInfo interface and busySince/sessionCompacting/rateLimitUtilization state to session store
- Add comprehensive transparency test suite (event-classifier-transparency.test.ts)

## 0.5.4

- Fix ProcessExited event emitted to wrong channel causing sessions stuck in "busy" state forever
- Fix race condition: delay ProcessExited 2s to let message router finish draining buffered events
- Fix cross-project contamination: scope file viewer state per-project (openFiles, activeFile, editedContents, dirtyFiles)
- Fix cross-project tool approval leakage: scope alwaysAllowedTools per project path
- Fix auto-open guard: only open files/switch tabs for the active session, not background projects
- Add project name to tool approval modal so users know which project is requesting
- Add `checkProcessAlive` Tauri command for stale connection health checks
- Reduce stale detection aggressiveness: 120s timeout, toast-only (no inline messages), auto-recovery when process dead
- Fix auto-scroll on send: chat scrolls to bottom when new message sent while scrolled up
- Fix "New messages" button background from transparent to opaque

## 0.5.3

- Add file upload, image paste, and drag-drop attachment support to Assistant panel
- Add multimodal image support for API providers (OpenAI, Gemini, Anthropic) with base64 encoding
- Add AssistantAttachmentBar component for per-session attachment display
- Fix slash command palette: solid background, shadow, z-index layering, hide shortcuts when palette open
- Fix slash command execution: /clear restarts CLI, /context shows token usage, /cost shows stats, /exit closes tab, /rename renames tab
- Route CLI-only commands (/model, /config, etc.) to CLI overlay instead of sending as chat text
- Show info message for unknown commands instead of sending raw text
- Add `renameAssistant` action to assistant store
- Add per-session attachments map to assistant store
- Show per-provider default model dropdowns in Settings > Assistant (all providers visible at once)
- Add model submenu to provider selection when creating new assistant tabs
- Add diagnostic logging for API call logging (insert success/failure)

## 0.5.2

- Enlarge Settings modal ~30% (720×560 → 940×730) to better fit 8-tab layout
- Add 5 new AI models: GPT-5.4, Gemini 2.5 Pro, Gemini 3.0 Flash, Gemini 3.1 Pro, Gemini 3.1 Flash Lite

## 0.5.1

- Restructure Settings: split AI Providers tab into separate AI Providers (API keys + pricing) and Changelog (toggle, provider/model, prompt) tabs
- Add Assistant settings: default provider and model selection for new assistant tabs
- Log assistant API calls to database (visible in Settings > API Logs)
- Fix provider dropdown background from near-invisible to solid opaque color
- Read default model from settings when creating new assistant tabs

## 0.5.0

- Add multi-AI assistant support: create assistant tabs with OpenAI, Google Gemini, or Anthropic API providers alongside Claude Code
- Add Rust SSE streaming backend for all 3 API providers (OpenAI, Gemini, Anthropic) with proper token counting
- Add provider selection dropdown when creating new assistant tabs
- Add provider badges (CC/OA/G/A) on assistant tabs with color coding
- Add per-session token usage tracking and cost display on tabs
- Add "Chat only" capability indicator for API assistants
- Add slash command palette (/ commands) support in Claude Code assistant tabs
- Expand textarea input to 4-row minimum (96px) with 200px max height
- Rename settings fields: `changelogApiKeys` → `apiKeys`, `changelogModelPricing` → `modelPricing` (shared across changelog + assistant)
- Add serde aliases for backward-compatible settings migration
- Add `assistantDefaultProvider` and `assistantDefaultModel` to settings
- Refactor `AssistantInstance` type: add `provider`, `model`, `sessionCost` tracking
- Refactor `useAssistantSession` hook: branch `createAssistant` and `sendMessage` by provider type
- Add 37 new tests: assistantStore (18), assistant-provider types (12), AssistantTabs component (7)

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
