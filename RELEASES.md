# CodeMantis Releases

## 1.1.4

Hotfix release focused on macOS lock-screen lifecycle, SpecWriter save UX, and CLI protocol alignment with `claude` 2.1.126.

### macOS Lifecycle (Hotfix)
- **Lock-screen stalls eliminated without destructive reloads**: long-running sessions no longer freeze when the Mac sleeps/locks for extended periods. Combines an App Nap opt-out, a process activity assertion token, and a non-destructive WKWebView repaint recovery path on missed wake pongs
- **No more frontend visibility-triggered reloads**: the visibility-change reload path is gone — unlocking the screen no longer wipes in-memory UI state (active session, scroll position, modal stacks). Recovery now happens at the native layer instead of by reloading the webview
- **Updated wake-recovery tests** to cover the new repaint path and the absence of the visibility reload

### SpecWriter
- **Smarter save dialog filename**: the SpecWriter save dialog now derives its default filename from `docs/specs/<stem>.md` self-references in the body (e.g. Session Plan prompts) before falling back to H1 slugging — so saved specs land at the filename the spec actually claims to use
- **Em/en-dash only as title separators**: filename derivation no longer splits compound names like `Spec-Forge` on hyphens. Helper functions are pure and covered by unit + dialog regression tests
- **Toolbar/list icon sizing normalized**: SpecWriter action buttons and saved-spec list icons render at a consistent visual scale, with collapse chevron typography aligned for legibility
- **Lucide chevrons for saved-specs collapse**: replaced unicode triangle glyphs with `ChevronRight`/`ChevronDown` so the header matches the rest of the Lucide UI and scales cleanly

### Claude CLI 2.1.126 Compatibility
- **Protocol capture harness**: new reproducible suite with scenario NDJSON artifacts and a detailed 2.1.126 audit report, used to drive runtime behavior changes
- **ExitPlanMode plan state preserved across inactive sessions**: switching tabs no longer drops the pending plan from a paused session
- **Protected-path deny toast bucketing**: control-tool denials no longer surface as misleading errors; they're routed through the same protected-path UX introduced in 1.1.3
- **Documented**: `--dangerously-skip-permissions` overrides `--permission-mode` in CLI spawn args (call-site comment, no behavior change)

### Plan Mode Diagnostics
- Cross-stack `[plan-modal]` trace logs at the message router (when `ExitPlanMode`/`EnterPlanMode`/`AskUserQuestion` ToolUseStart events surface), at the activity handler (visibility decision), and at `PlanCompleteModal` (render-state transitions). `@tauri-apps/plugin-log` is mocked in Vitest setup so diagnostic calls remain side-effect-free in tests

## 1.1.3

### Chat
- **In-message search**: new search bar (Cmd+F) lets you find text across the active session's messages with term highlighting in both prose and code blocks, plus next/prev navigation across matches
- **Highlight helpers**: shared `highlight-text` and `highlight-children` utilities so search hits render consistently in MessageBubble and CodeBlock

### Session Resume
- **Resume from Project picker**: the Open Project modal now lists recent sessions across all projects with a per-row Resume action — picking one switches active project and rehydrates the CLI session, instead of forcing you to open the project first
- **Recent-sessions backend**: new SQLite query and Tauri command surface globally-ordered recent sessions with stored-message flag, project path, and capped changelog snippets per row
- **Spec self-reference recognition**: stronger detection of when the assistant references the current spec by name so guide recognition doesn't double-load or mismatch the active plan

### File Viewer & Preview
- **Session-scoped file viewer**: file viewer state is now keyed per session — switching sessions no longer leaks the previously-open file or selection state across tabs
- **Preview progress modal hardening**: clearer phase transitions in the preview loading modal, with port detection improvements that distinguish dev-server boot phases from idle states
- **Claude stream-parser fixes**: process and stream-parser handle additional CLI partial-message edge cases without dropping events or stalling the activity feed

### Claude CLI
- **Protected-path denials surfaced in chat**: when the CLI refuses an operation due to its protected-path guardrail, the denial now appears in chat with the path and reason instead of disappearing silently — makes guardrail behavior debuggable
- **New event types**: `tool_denied` / protected-path event handling wired through `event_types.rs`, the message router, and the chat event handler

### Lifecycle & SpecWriter Recovery
- **Bounded wake-reload backoff**: after a long sleep, the wake observer now reloads with exponential backoff capped at a small budget, so a flaky network or backend doesn't trigger a reload storm at wake
- **SpecWriter wake recovery**: SpecWriter sessions detect post-wake state divergence and either resume the in-flight Claude conversation or restart cleanly with the user notified, instead of leaving a half-dead spec stream
- **Audit companion hardening**: spec audit companion handles missing or moved guide files more gracefully and exposes errors instead of failing silently
- **SaveSpecDialog/SpecPreview polish**: tighter loading/error states and cleaner integration with the audit + recovery flow

### Documentation
- User-guide version references synced to the shipped build (embedded guide and source-of-truth markdown in lockstep)

## 1.1.2

### Self-Drive
- **Static cross-system action parity**: before a session can finish, the orchestrator verifies that backend handlers, frontend wiring, and integration evidence all agree on the same actions — catches half-implemented features that pass code review individually but don't connect end-to-end
- **`request_recheck` loop**: orchestrator can now ask Claude Code to re-state evidence for specific verify items before pausing, up to 2 rounds per session (opt-out via `selfDriveEnableRecheckLoop`)
- **Integration-evidence contracts**: typed contracts make verify items explicit about what evidence is required (file:line citations, test names, behavior descriptions)
- **Handler-authoring carve-out**: parity gate is skipped during pure handler-authoring sessions where the frontend wiring intentionally lands later
- **Orchestrator-authoritative evidence format**: orchestrator now owns the evidence schema instead of letting the verifier and prompts drift apart
- **No verifier truncation**: the verifier no longer truncates Claude's evidence text mid-quote, fixing false PASSes from cut-off file references
- **Token-reset stall handling**: stall timeout and live blocker UI now correctly handle the post-token-reset window where the model legitimately pauses
- **Unknown-blocker recovery hardening**: orchestrator no longer loops indefinitely on unrecognized blocker kinds and stops spamming the compact-log channel
- **Skipped-verify and parity-error fixes**: verify items marked SKIPPED no longer break parity, and the GuidePanel store now stays in sync with orchestrator state

### SpecWriter
- **Preflight input analyzer + clarification gate**: before generating a spec, SpecWriter analyzes the user's input for missing details and asks targeted clarification questions instead of guessing
- **Input-fidelity coverage audit**: new audit pass compares the generated spec against the original input to surface dropped requirements, with auto-recheck on regeneration
- **Coverage panel + report persistence**: dedicated UI surface for coverage findings; reports are saved alongside specs for later review
- **Stream observability in coverage workflow**: live progress and tool activity are visible during coverage runs, not just the final result
- **Phase-based session plans parsed correctly**: guides can now be recognized from specs that organize sessions by phase (`## Phase 1: …` → `### Session 1.1: …`) instead of flat `### Session N` lists
- **Better guide-failure explanations**: surface concrete reasons when guide recognition fails (no plan section, malformed sessions, etc.) instead of a generic toast
- **No project-context truncation**: `gather_spec_context` now uses tighter per-section caps instead of a cumulative budget that silently dropped late files
- **Fewer false stall warnings**: tool-heavy streams (many small reads/edits) no longer trigger the inactivity stall heuristic
- **Unified guide recognition + filename targeting**: single code path for recognize-guide regardless of entry point, with consistent filename matching
- **Context-compaction surfacing**: Claude Code context compactions are now visible in CLI sessions so the user knows when history was rewritten

### Activity Feed
- **No cross-project/session bleed**: activity entries from other projects or sessions can no longer appear in the current feed or detail view (regression from session pinning)
- **Claude settings carve-out failures explained**: when CodeMantis can't write the Claude settings carve-out (permissions, locked files), the activity feed now surfaces the actual reason instead of failing silently

### Claude CLI
- Handle `task_notification` and `task_updated` events from the CLI's background-task system so long-running shell tasks surface progress in the activity feed

### Preview Window
- Distinguish intentional dev-server shutdown from crashes — closing the preview no longer logs the dev server as crashed when the user simply stopped it

### Documentation
- User guide refreshed for the new toolbar layout, default spec models, and current MCP access shortcut (Cmd+Shift+M)

## 1.1.1

### Self-Drive
- **Persistent paused runs**: Self-Drive state is saved to SQLite (`self_drive_runs` table) across app restarts — paused runs rehydrate at boot and require the user to attach a live session before resuming
- **Session and guide pinning**: lock the target sessionId and guide snapshot at start so tab/project switches cannot retarget Claude or swap plans mid-run
- **Structured blockers**: typed blocker kinds with options, resolution lifecycle, and a dedicated recovery phase — the orchestrator verifies blocker resolution via a recovery prompt before normal flow resumes
- **Blocker input required**: pause stamps `prePauseLastMessageId`; Resume is blocked until the user provides resolution via a one-click option pick or main chat reply
- **Tool extraction from activity feed**: derive tool names from activityStore instead of unused activityIds
- **Verification prompt always merges checklist**: custom `verificationPrompt` is now guidance above the numbered `verifyChecks` list so the orchestrator never loses checklist items

### UI
- **Shared CopyButton**: extracted component with lazy `getText()` for click-time snapshots — used in MessageBubble (always-visible copy on latest assistant reply, streaming-safe), RunLogViewer, and Self-Drive paused status
- **Text selection**: `-webkit-user-select` and `.select-text` so Cmd+C works in the Tauri webview; run log body is now selectable
- **Chat scroll stability**: track container `clientHeight` so reflow-driven scroll events (e.g. ThinkingIndicator growth) don't flip the user off the bottom or flash the new-messages affordance

### Claude CLI
- Pass `--thinking-display summarized` so Opus 4.7+ still streams usable thinking summaries for the reasoning panel

### Security
- **Skill template shell expansion allowlist**: validate `!`cmd`!` fragments against a read-only command allowlist before running via `sh`, with null stdin and explicit stdio pipes
- Harden preview `port_detector` regex init with labeled expect/panic messages and a compile smoke test
- MCP `read_json_file` edge-case tests for truncated/empty JSON

### Refactoring
- Extract `useSpecWriterActions` hook from SpecWriterSlideOver (1,479 lines moved to a thinner component + dedicated hook with tests)
- Add `useAssistantAttachments` test coverage

### Testing
- **128 new Rust unit tests** covering IPC command modules: `api_logs`, `clone`, `guide`, `preview`, `specwriter`, `startup`, `super_bro`, `terminal`
- 2 new TypeScript integration tests for Self-Drive navigation safety

### Documentation
- Updated user guide and Super-Bro knowledge for v1.1.0 permission modes, status bar, shortcuts, safety guidance, and Python/uv install hints

## 1.1.0

### Claude Code CLI Compatibility
- **Permission modes**: full support for `auto`, `dontAsk`, and `bypassPermissions` modes (Claude Code 2.1.x) — Rust session variants, approval-server behavior, ModeSelector labels, and keyboard cycle
- **Thinking blocks restored**: always pass `alwaysThinkingEnabled` and `showThinkingSummaries` in `--settings` to counteract CLI v2.1.90+ defaulting thinking summaries off
- **ExitPlanMode plan path**: prefer `plan` and `planFilePath` from the CLI tool input over the Write observer; show plan preview text in the modal and open from in-memory content

### Plan Mode UI
- **Pending-plan banner** in the input area with Review / Implement / Dismiss actions — plan context persists after dismissing the modal so you can act on it later
- Shared `implementPendingPlan` action extracted for reuse across modal and banner
- **AskUserQuestion modal** now displays and submits the full question text instead of header-only labels

### Self-Drive
- **Evidence-based verification**: strict preamble requiring per-item `file:line` evidence, batch-of-10 progress accounting, and explicit PASS/FAIL/SKIPPED output
- Anti-skimming guards: detect batch-pass language, require quoted file evidence for passed checks, and enforce full per-check coverage before advancing
- Mandatory `**Verification Prompt:**` blocks per session in spec prompts

### SpecWriter
- Audit file integration: loading `*.audit.md` selects the audit preview and clears spec content (and vice versa); clearing paired files resets both previews
- Tab-aware copy/edit: Copy uses the active tab content; Edit always targets the spec
- Verify hardening requirements spec added to documentation

### Model Updates
- Align Claude Opus model ID to `claude-opus-4-7` across frontend, backend, pricing, and fixtures

### Code Quality
- Consolidate repeated time/duration formatting and click-outside behavior into shared helpers
- Replace ignored Rust `emit`/`write` errors with explicit `warn`/`error` logging in assistant streaming, preview log writes, and legacy hook cleanup
- Dependency overrides updated (dompurify, undici, flatted, picomatch, brace-expansion)

## 1.0.9

### Input Area
- **Message history picker**: press ArrowUp in the input to open a dropdown of recent user prompts (deduplicated), with keyboard navigation and select-to-fill — quickly re-send or edit previous messages

### Implementation Guide
- **Per-session Verification Prompt**: parse `**Verification Prompt:**` fenced blocks from session plans, prefer them over generic verify prompts, and show a "Verify for me" button on guide session cards even without checklist items
- **Unload Guide**: new action in the Guide panel to unload an active guide (blocked once started), freeing the panel for a different spec
- **Replace Guide confirmation**: when loading a guide from a saved spec while another guide is already active, a confirmation modal prevents accidental overwrites
- **Safety gates**: guide loading is blocked during in-progress sessions and Self-Drive runs

### SpecWriter
- Specs can now load a guide directly from the saved-specs list with replace confirmation
- Stronger spec prompts: cross-session consistency rules, mandatory NOT-negative checks, optional verification-prompt template for complex sessions, and anti-fabrication / `[ASSUMPTION]` guidance

### CLI Slash Commands
- Add `bug`, `loop`, and `usage` to the CLI-only command list

## 1.0.8

### SpecWriter
- **Recognize Guide** action on the toolbar for saved specs that don't yet have a linked guide — runs `parseSessionPlan` + `createGuide` and opens the Guide tab on success, with toasts for already-existing or invalid multi-session plans
- Parse "Implementation Plan" and "Specification" title variants, not just "Session Plan" — and if there is no `## Session Plan` section, fall back to scanning the whole markdown for `### Session N` blocks
- Plan Complete modal: the plan file row is now an actionable control that focuses the file in File Viewer and closes the modal

### Assistant Panel
- Scroll to the latest message when switching back to the Assistant tab, so returning to a long conversation lands on the bottom instead of wherever the previous tab was scrolled

## 1.0.7

### Claude CLI Integration
- Parse `terminal_reason` on result and turn_complete events, and `UsageInfo.iterations` (CLI v2.1.97+)
- Treat user-interrupts (`aborted_streaming`) as a normal turn completion instead of a process error, so cancelling mid-stream no longer surfaces as a failure
- Auto-approve the new Monitor tool in the inline PreTool hook and the approval server
- Add `~/.codemantis/title-hook.sh` and UserPromptSubmit hook wiring in the CLI `--settings` JSON

### SpecWriter
- Audit-over-spec streaming: when early chunks look like a spec but the final content is an audit, restore the pre-stream spec preview and keep the audit tab routing correct
- Auto-switch to the audit tab only the first time an audit appears; manual tab switches are now preserved across re-renders
- "Use Guide" button activates only when the saved file matches the guide's expected filename; stale paths are cleared after a write→done transition
- Info toast when saving a spec that has no "Session Plan" section, so guide generation expectations are clear

## 1.0.6

### Code Quality
- Fix all 27 clippy errors (Rust 1.94.0): suppress `too_many_arguments` on Tauri commands and database helpers, replace `map_err` with `inspect_err`, use `contains()` over `iter().any()`, adopt `clamp()`, `strip_prefix()`, `next_back()`, and the `?` operator where clippy recommends them
- CI clippy gate now passes clean

## 1.0.5

### Plan Mode
- Capture plan files written by Claude into the UI and auto-open them in the File Viewer when the session exits plan mode
- Show the plan filename in the Plan Complete modal for quick reference

### Activity Feed
- Show in Finder action on file detail panels — reveal the current file directly in macOS Finder

### Preview
- Probe dev-server ports on both IPv4 (127.0.0.1) and IPv6 (::1) so Vite and other servers binding to IPv6 are detected correctly

### Self-Drive
- Smarter resume logic: use per-session flags (done, promptSent, verifyRequested) instead of currentPhase so pausing during a fix cycle no longer skips back to verify
- Handle completed sessions by advancing to the next phase and retry unsent prompts after failed starts

### SpecWriter
- Rewrite `docs/specs/*.md` references in session prompts to the actual saved spec filename so implementation plans always point at the correct file

### Approval Server
- Remove AskUserQuestion from the plan-mode auto-allow list so interactive prompts go through user approval

### Documentation
- Updated README with Self-Drive highlights, screenshots, and refreshed demo video

## 1.0.4

### Self-Drive
- Scope autonomous runs to the active project — switching projects no longer leaks state from a running session into another
- Mirror every orchestrator prompt into the chat panel as a synthetic user message so users can see exactly what Self-Drive sent during autonomous execution
- Honor live setting changes (run tests, auto-commit) mid-run instead of using the cached startup config

### Approval Server
- Replace blanket Plan-mode denial with a fine-grained allowlist (Write, Edit, Agent, web tools, tasks, LSP, etc.) so the CLI can use planning tools when it skips permissions
- Tools not on the allowlist (e.g. Bash) now fall through to the normal user-approval flow instead of being auto-denied

### SpecWriter
- Require deployment steps (migrations, deploy, install, restart) in implementation-guide phases that produce deployable artifacts
- Add deployment-aware verify-before-next-session guidance with concrete examples for databases, Edge Functions, containers, and dependencies

### Documentation
- Updated user guide with Self-Drive decision cards and confidence-guard behavior
- Added Self-Drive and SpecWriter guide screenshots

## 1.0.3

### Self-Drive Enhancements
- Decision cards with confidence guards and prompt visibility
- Users can review and approve each orchestrator decision before execution

### SpecWriter
- Promote assistant replies to spec content and broaden spec detection patterns

### Documentation
- Updated user guide for v1.0.3 with Self-Drive decision cards, confidence guards, and version bump

## 1.0.2

### Self-Drive Mode (New Feature)
- Autonomous implementation guide with orchestrator and settings
- Session-scoped chat events and advance phase handling

### SpecWriter
- Persist drafts and keep panel mounted when closed
- Fix badge showing "Working..." when done but still streaming
- Derive hasGuide from guideStore; sync Self-Drive mode in UI
- Fix approval-server session IDs, Plan mode writes, and spec prompts

### Testing Infrastructure
- 296 new tests with comprehensive test infrastructure and testing docs
- Complete test coverage plan: hooks, components, integrations, Rust expansion
- Resolve all pre-existing TypeScript type errors in test files
- Add enforcement rules to CLAUDE.md to prevent test coverage drift

### UI & Fixes
- Semantic font-size tokens from --font-size-base
- /clear resets approvals without clearing activity feed
- Increase Super Bro strip max height
- Fix stale screenshot events after preview unmount; unique attachment IDs

## 1.0.1

- SpecWriter: batched completeTurn, persist spec content, and audit tab sync
- Super Bro: testing context awareness and inline test coverage guidance

## 1.0.0

CodeMantis 1.0.0 — the first stable release. See the full release notes on GitHub.

- First public stable release
- Session logs: auto-save toggles, always restore history, avoid message ID collisions
- Expanded README with product walkthrough, screenshots, and demo assets

## 0.9.9

### Terminal & Preview Fixes
- Fix: clear NODE_PATH on PTY spawn to prevent stale module resolution
- Fix: avoid duplicate/stale port probes and stop probing after PTY exit
- Fix: cm-ipc navigation fallback for toolbar when CSP blocks fetch
- Fix: PTY exit handling for preview dev servers

### SpecWriter Improvements
- Default planning model to Gemini 3 Flash; default provider to Claude Code
- Weak-model warning and stronger feature-mode navigation instructions
- Tighten session sizing, audit handoff, and clean-output prompt rules

### Super Bro
- Clarify CLI-only suggested prompts vs visual checks in persona docs

## 0.9.8

- Super Bro: surface CLAUDE.md presence in project context and coaching prompts

## 0.9.7

- Guide & Super Bro: deterministic verify prompts and completed-guide context awareness
- SpecWriter: widen slide-over layout and ensure verification audit outputs COMPLETE marker
- Test coverage for AUDIT_FILE_PATTERN matcher

## 0.9.6

- Super Bro: per-trigger debounce, 10-second rate limit, and deferred retry to prevent API spam
- Guide: track prompt-sent and verify-requested states for better session flow
- Refactor Super-Bro API helpers into shared utilities

## 0.9.5

### Super Bro — Contextual AI Coach
- Introduce Super Bro: a contextual coaching assistant that watches your coding sessions and offers proactive guidance
- Deployment-aware context with live git status and post-change knowledge modules
- Per-project enable/disable with eye-icon toggle and status dot
- Auto-dismiss guidance strip after 60 seconds; all-good state when no issues detected
- Gate providers on configured API keys; model lists from AI_MODELS and OpenRouter
- Dedicated Super-Bro tab in Settings and API Logs
- Bundle Super-Bro knowledge resources with the app

### Updater & Session Improvements
- Centralize update polling with macOS menu "Check for Updates" command and shared state
- Pass `--name` to Claude CLI for named sessions; flatten extra rate limit fields
- Cost-by-feature matrix on API cost log tab

### UI & UX Polish
- Help chat busy banner with elapsed timer and input hints
- Include verification audit path in Verify-for-me prompt
- Align SpecWriter typography with text-ui and text-chat tokens
- Fix preview port-detection race with Layer 3 port scan
- Bottom padding on main chat column

## 0.9.4

- Tighten SpecWriter system prompts: enforce structured output format, session-plan warning blocks, section-scoped Claude prompts, multi-session audit notes, and VERIFY line pre-counting

## 0.9.3

- Preview toolbar console via Tauri emit with scoped remote capability
- Fix preview toolbar via approval-server fetch and reliable macOS screenshots

## 0.9.2

- Persist right-panel subviews and add uiStore coverage
- Default-expand reasoning panel content
- Auto-focus chat inputs and polish assistant/spec send-stop controls
- Add tab tooltips and Esc-to-stop for SpecWriter streaming
- Preview loading modal and more resilient startup polling
- Expand user guide; fix preview dev server retry and cleanup
- Add reasoning panel and spec writer guide screenshots

## 0.9.1

- Persist session chat logs with retention and restore on resume
- Add Back control to Project Log view
- Migrate app data to dev.codemantis.myapp and simplify build
- Activity-feed reasoning panel and smarter spec options
- Unify MCP modal chrome and validation in McpModal shell
- Fix preview toolbar actions without fetch for strict CSP pages
- Test coverage for preview toolbar, bridge ordering, and CORS preflight

## 0.9.0

- Stream and display extended thinking in chat
- Centralize send-shortcut handling and default to Enter to send
- Add Back button to Session History view
- Rename History tab to Session History
- Open API log file in Finder from settings
- Fix focus main window shortly after launch
- Simplify MCP modal headers and surface template info in form
- Preview console bridge tests, local preview improvements, and approval server enhancements

## 0.8.12

- SpecWriter displayContent for option prompts and bullet multi-select
- Manual preview URL fallback when dev server fails
- Guide verify prompt and spec preview toolbar polish
- Fix inline text attachments for Claude Code assistant and SpecWriter
- Test coverage for preview URL dialog and prompt flow

## 0.8.11

- Modular assistant/spec UI, Rust stream routing, and test sweep
- Parse OpenRouter API errors and improve API logs UI

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
