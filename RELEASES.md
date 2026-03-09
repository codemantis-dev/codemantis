# ClaudeForge Releases

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
