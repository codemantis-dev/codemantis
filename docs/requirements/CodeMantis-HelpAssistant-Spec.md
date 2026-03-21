# CodeMantis — Help Assistant (Powered by Claude Code)

**Type:** New feature
**Date:** March 2026
**Priority:** Medium — implement after Verification Audit and Prompt Quality improvements
**Depends on:** User guide document (`docs/user-guide/codemantis-complete-guide.md`) must exist

---

## 1. Overview

A ❓ Help button in the title bar (rightmost, after Settings) opens a slide-in panel where users ask questions about CodeMantis. The panel is powered by Claude Code itself — no API keys, no separate provider. The user guide is loaded as initial context, and Claude Code answers questions in Plan mode (no file changes, no tool use).

**Why Claude Code, not an API assistant:**
- Claude Code is guaranteed to be installed — CodeMantis won't work without it
- No API key configuration needed — works the moment the app launches
- No additional cost beyond the user's existing Claude Pro/Max subscription
- Plan mode conversations are lightweight (no tool calls, minimal token usage)
- The same quality AI that powers their coding sessions powers their help

---

## 2. User Experience

### Opening Help

1. User clicks ❓ button in the title bar (rightmost button, after Settings gear)
2. Help panel slides in from the right edge, overlaying the right panel
3. If this is the first time: Claude Code session starts, user guide loads as context, welcome message appears
4. If help was opened before in this app session: previous conversation is still there, ready to continue

### Using Help

- User types a question: "How do I add an MCP server?"
- Claude Code answers from the user guide, with exact UI labels, keyboard shortcuts, steps
- User can ask follow-ups: "Which MCP templates don't need an API key?"
- Conversation is natural — same chat experience as the main Claude Code session

### Closing Help

- Click ❓ again (toggles)
- Click × in the help panel header
- Press Escape
- The Claude Code help session stays alive in the background
- Reopening shows the previous conversation

### Session Lifecycle

- **Starts:** On first ❓ click during the application session
- **Persists:** Stays alive while the app is running, even when panel is closed
- **Ends:** When CodeMantis quits (the Claude Code process terminates with the app)
- **Does NOT persist across app restarts** — fresh help session each launch (intentional: keeps context clean, user guide may have updated)

---

## 3. Architecture Decisions

### 3.1 Model: Haiku

The help session uses Claude Haiku (`claude-haiku-4-5`). Rationale:
- Help questions don't need Opus/Sonnet-level reasoning
- Haiku is fast — sub-second responses for simple questions
- Haiku is cheap on the user's quota — minimal impact on their coding budget
- The user guide provides all the knowledge; the model just needs to read and answer

Implementation: Pass `--model claude-haiku-4-5` when spawning the Claude Code process for the help session.

### 3.2 Plan Mode (No File Changes)

The help session runs in Plan mode (`allowedTools: []` or `--plan` flag). This means:
- Claude Code cannot read, write, or edit files
- Claude Code cannot run bash commands
- Claude Code can only reason and respond with text
- Zero risk of the help assistant accidentally modifying the user's project

### 3.3 Working Directory

Claude Code requires a working directory. For the help session:
- If a project is open: use the active project path (doesn't matter — Plan mode won't touch it)
- If no project is open: use the user's home directory (`~`)

### 3.4 Application-Level, Not Project-Level

The help session is NOT tied to a specific project. It's a singleton at the application level:
- One help session shared across all projects
- Switching projects doesn't close or restart the help session
- The help panel is accessible even when no project is open (from the welcome screen)

### 3.5 Not Counted Against Session Limit

The existing `MAX_SESSIONS = 10` limit applies to coding sessions. The help session is separate and doesn't count against this limit. It uses a dedicated session ID prefix (`help-session`) to distinguish it.

---

## 4. UI Design

### 4.1 Title Bar Button

Add the ❓ button as the LAST button in the title bar, after the Settings gear:

```
[+] [📂] [📝] [🌐] [📷] [🧩] [⚙️] [❓]
 │    │    │    │    │    │    │    └── Help (NEW)
 │    │    │    │    │    │    └── Settings
 │    │    │    │    │    └── MCP Servers
 │    │    │    │    └── Screenshot (when preview open)
 │    │    │    └── Run Application
 │    │    └── SpecWriter
 │    └── Open Project
 └── New Project
```

**Button styling:**
- Same size and style as other title bar buttons (p-1.5, rounded-md)
- Icon: `HelpCircle` from lucide-react (or `CircleHelp`)
- Color: `text-text-ghost` default, `text-text-secondary` on hover
- When help panel is open: `text-accent` (active state, matching SpecWriter behavior)
- Tooltip: "Help (⌘?)" or "Help"
- Always visible — does NOT require a project to be open

### 4.2 Help Slide-In Panel

The panel slides in from the right, similar to SpecWriter but simpler (no preview pane, no toolbar — just chat).

**Layout:**
```
┌──────────────────────────────────────────────────────┐
│ ❓ CodeMantis Help                              [×]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ 👋 Welcome! I'm your CodeMantis helper.      │   │
│  │                                              │   │
│  │ I know every feature, shortcut, and setting  │   │
│  │ in the app. Ask me anything:                 │   │
│  │                                              │   │
│  │ • "How do I add an MCP server?"              │   │
│  │ • "What does Auto-Accept mode do?"           │   │
│  │ • "How do I use SpecWriter?"                 │   │
│  │ • "What's the shortcut for...?"              │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  (conversation messages appear here as user asks)    │
│                                                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ [Ask a question about CodeMantis...]          [Send] │
└──────────────────────────────────────────────────────┘
```

**Dimensions:**
- Width: 400px (fixed, not resizable — help doesn't need the width that SpecWriter does)
- Height: full app height (top to bottom)
- Position: slides in from right edge, overlays the right panel
- Z-index: above the right panel but below modals (same z-layer as SpecWriter)

**Header:**
- ❓ icon + "CodeMantis Help" title
- × close button (same as SpecWriter close)
- Subtle border-bottom

**Chat area:**
- Scrollable message list
- Messages styled identically to the main chat panel (MessageBubble-like)
- But simpler: no tool badges, no activity chips, no thinking indicator (Haiku + Plan mode doesn't produce tool use or extended thinking)
- Streaming response with cursor (same StreamingCursor component)

**Input area:**
- Single-line or auto-expanding text input
- Send button (or Enter to send)
- Placeholder: "Ask a question about CodeMantis..."
- No mode selector, no model selector, no attachment bar (help doesn't need these)

### 4.3 Welcome Message

On first open, before the user types anything, show a welcome message (not from Claude Code — this is a static UI element):

```
👋 Welcome! I'm your CodeMantis helper.

I know every feature, shortcut, and setting in the app. 
Ask me anything:

• "How do I add an MCP server?"
• "What does Auto-Accept mode do?"
• "How do I use SpecWriter?"
• "What's the shortcut for...?"
```

The suggested questions are clickable — clicking one sends it as a message.

### 4.4 Loading State

When the help session is starting (Claude Code process spawning, user guide being sent):

```
┌──────────────────────────────────┐
│                                  │
│     Starting help assistant...   │
│     (loading spinner)            │
│                                  │
└──────────────────────────────────┘
```

This takes 1-3 seconds on first open. Show the spinner, then transition to the welcome message + input area once the session is ready.

---

## 5. Claude Code Session Management

### 5.1 Creating the Help Session

When the user clicks ❓ for the first time:

```typescript
// Pseudo-code for help session creation
const helpSessionId = await createSession(
  workingDirectory,  // active project path or home dir
  "CodeMantis Help", // session name
  undefined,         // no CLI session to resume
  {
    model: "claude-haiku-4-5",
    plan: true,      // Plan mode — no file changes
  }
);
```

**Important:** The `createSession` Rust command may need a small modification to accept optional model override and plan mode flags. Currently it spawns `claude` with the default model. For the help session, we need to pass `--model claude-haiku-4-5` as an argument.

If modifying `createSession` is too invasive, an alternative is to call `setSessionMode(helpSessionId, "plan")` immediately after creation and use the session's model selection to switch to Haiku (`claude-haiku-4-5`).

### 5.2 Injecting the User Guide

After the session is created, send the user guide as the first message:

```typescript
const userGuide = await readUserGuide(); // reads from bundled resource

await sendMessage(helpSessionId, `You are the CodeMantis Help Assistant. 
Your ONLY job is to answer questions about how to use CodeMantis.

Rules:
- Answer ONLY from the user guide below — do not make things up
- Include keyboard shortcuts when relevant (e.g., "Press ⌘⇧N or click the + button")
- Reference exact UI labels (button names, tab names, modal titles)
- Keep answers concise: 2-5 sentences for simple questions, step-by-step for how-to
- If the guide doesn't cover something, say: "I don't have information about that. 
  You can check the GitHub Issues page or the documentation at codemantis.dev/help"
- Never suggest editing files, running commands, or changing code
- You are in Plan mode — you cannot and should not touch any files

USER GUIDE:
${userGuide}`);
```

Then wait for Claude Code's acknowledgment response (it will respond with something like "I've read the guide, ready to help"). This response is hidden from the user — the welcome message is the static UI element shown instead.

### 5.3 Reading the Bundled User Guide

The user guide ships with the app as a Tauri resource:

**File location:** `src-tauri/resources/user-guide.md`

**New Rust command:**

```rust
#[tauri::command]
pub fn read_user_guide(app_handle: tauri::AppHandle) -> Result<String, String> {
    let resource_path = app_handle
        .path()
        .resolve("resources/user-guide.md", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve user guide path: {}", e))?;
    
    std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read user guide: {}", e))
}
```

Register in `lib.rs` invoke handler. Add TypeScript wrapper in `tauri-commands.ts`.

### 5.4 Session Persistence (In-Memory Only)

The help session:
- Is NOT saved to the SQLite database (no `persistState` call)
- Is NOT resumable across app restarts
- Lives only in memory while the app is running
- When the app quits, the Claude Code process terminates naturally (Tauri handles child process cleanup)

Store the help session ID in the UI store (not the session store):

```typescript
// In uiStore.ts
helpSessionId: string | null;
helpPanelOpen: boolean;
helpSessionReady: boolean;  // true after guide is loaded and initial response received

setHelpSessionId: (id: string | null) => void;
setHelpPanelOpen: (open: boolean) => void;
setHelpSessionReady: (ready: boolean) => void;
toggleHelpPanel: () => void;
```

### 5.5 Sending User Questions

When the user types a question and presses Enter/Send:

```typescript
const helpSessionId = useUiStore.getState().helpSessionId;
if (!helpSessionId) return;

// Use the existing sendMessage from useClaudeSession
await sendMessage(helpSessionId, userQuestion);
```

The response streams in via the same `listenChatEvents` that powers normal sessions. The help panel renders the streaming response in its chat area.

### 5.6 Closing the Session

The help session closes when the app quits. No explicit close action needed. But if the user somehow needs to restart the help session (e.g., it gets stuck), the × close button + reopening ❓ could trigger a fresh session.

Implementation detail: closing the panel (×) just hides it. The session stays alive. Only `app.quit()` terminates the Claude Code process.

---

## 6. New Files

```
src/
├── components/
│   └── help/
│       ├── HelpPanel.tsx           # The slide-in panel container
│       ├── HelpChat.tsx            # Message list (simplified ChatPanel)
│       ├── HelpChatInput.tsx       # Input area (simplified InputArea)
│       └── HelpWelcome.tsx         # Static welcome message with clickable suggestions
├── hooks/
│   └── useHelpSession.ts          # Help session lifecycle management
│
src-tauri/
├── resources/
│   └── user-guide.md              # Bundled user guide (generated separately)
├── src/
│   └── commands/
│       └── help.rs                 # read_user_guide command (NEW)
```

### 6.1 Modified Files

```
src/components/layout/TitleBar.tsx    — Add ❓ button after Settings
src/components/layout/AppShell.tsx    — Render HelpPanel alongside SpecWriterSlideOver
src/stores/uiStore.ts                — Add helpSessionId, helpPanelOpen, helpSessionReady state
src/lib/tauri-commands.ts            — Add readUserGuide wrapper
src-tauri/src/lib.rs                 — Register read_user_guide command
```

---

## 7. Component Specifications

### 7.1 HelpPanel.tsx

The main container. Renders as a slide-in from the right edge.

```tsx
interface HelpPanelProps {
  // No props — reads all state from uiStore and sessionStore
}
```

**Behavior:**
- Reads `helpPanelOpen` from uiStore to determine visibility
- Animates in/out with CSS transition (transform: translateX)
- Width: 400px, fixed
- Background: `var(--bg-primary)` with `border-left: 1px solid var(--border)`
- Renders: header, HelpChat (or HelpWelcome if no messages yet), HelpChatInput
- On first render when `helpSessionId` is null: triggers help session creation via `useHelpSession`

**States:**
- **Loading:** Spinner + "Starting help assistant..." while session initializes
- **Ready, no messages:** HelpWelcome with suggested questions
- **Active conversation:** HelpChat with message history
- **Error:** "Failed to start help assistant. Please try reopening." with retry button

### 7.2 HelpChat.tsx

Simplified message list. Reuses message rendering patterns from ChatPanel but stripped down.

```tsx
interface HelpChatProps {
  sessionId: string;
}
```

**What it shows:**
- User messages (styled as user bubbles)
- Assistant messages (styled as assistant bubbles, streaming supported)
- NO tool badges, NO activity chips, NO thinking indicator
- Auto-scrolls to bottom on new messages

**What it hides:**
- The initial system message (user guide injection) — user never sees it
- Claude Code's acknowledgment response to the guide — hidden

Implementation: filter `sessionStore.messages` for the help session, skip the first 2 messages (guide injection + acknowledgment), render the rest.

### 7.3 HelpChatInput.tsx

Minimal input area.

```tsx
interface HelpChatInputProps {
  sessionId: string;
  onSend: (message: string) => void;
  disabled: boolean;
}
```

**Elements:**
- Text input (auto-expanding textarea, 1-3 lines)
- Send button (right side, accent color, `Send` icon from lucide-react)
- Placeholder: "Ask a question about CodeMantis..."
- Enter to send (always — no ⌘Enter option for help, keep it simple)
- Disabled while Claude is streaming a response

**What it does NOT have:**
- Mode selector (always Plan)
- Model selector (always Haiku)
- Attachment bar (not needed for help questions)
- Slash command palette (not relevant for help)

### 7.4 HelpWelcome.tsx

Static welcome content shown before any messages.

```tsx
// No props — purely presentational
```

**Content:**
```
👋 Welcome! I'm your CodeMantis helper.

I know every feature, shortcut, and setting in the app.
Ask me anything:
```

**Suggested questions (clickable):**
- "How do I create a new project from a template?"
- "What are the three session modes?"
- "How do I connect an MCP server?"
- "How do I use SpecWriter?"
- "What keyboard shortcuts are available?"

Each suggestion is a button. Clicking it sends the text as a message to the help session.

### 7.5 useHelpSession.ts

Hook that manages the help session lifecycle.

```typescript
interface UseHelpSessionReturn {
  initHelpSession: () => Promise<void>;
  sendHelpMessage: (message: string) => Promise<void>;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
}
```

**`initHelpSession()`:**
1. Check if `helpSessionId` already exists in uiStore → if yes, return (already started)
2. Determine working directory:
   - If `activeProjectPath` exists → use it
   - Else → use home directory (read from Tauri `homeDir()`)
3. Call `createSession(workingDirectory, "CodeMantis Help")` with model override
4. Set `helpSessionId` in uiStore
5. Register chat event listeners (same as normal sessions)
6. Set session mode to Plan: `setSessionMode(helpSessionId, "plan")`
7. Read user guide: `const guide = await readUserGuide()`
8. Send initial message with system prompt + guide content
9. Wait for Claude Code's first response (acknowledgment)
10. Set `helpSessionReady = true` in uiStore
11. If any step fails → set error state, allow retry

**`sendHelpMessage(message)`:**
1. Check `helpSessionReady` → if not ready, show toast "Help is still loading..."
2. Call `sendMessage(helpSessionId, message)` using existing `useClaudeSession`

**Cleanup:** On app unmount, close the help session (same as other sessions — Tauri handles child process cleanup on app quit, but explicit cleanup is cleaner):
```typescript
useEffect(() => {
  return () => {
    const helpId = useUiStore.getState().helpSessionId;
    if (helpId) {
      closeSession(helpId).catch(() => {});
    }
  };
}, []);
```

---

## 8. Title Bar Changes

In `TitleBar.tsx`, add after the Settings button:

```tsx
{/* Help button — always visible, even without a project */}
<button
  onClick={() => useUiStore.getState().toggleHelpPanel()}
  title="Help"
  className={`mr-3 p-1.5 rounded-md transition-colors ${
    helpPanelOpen
      ? "text-accent bg-accent-dim"
      : "text-text-ghost hover:text-text-secondary hover:bg-bg-elevated"
  }`}
>
  <HelpCircle size={14} />
</button>
```

Note: the Settings button currently has `mr-3` for right padding. Move that `mr-3` to the Help button instead, and give Settings `mx-0.5` like the other buttons:

```tsx
{/* Settings button — mr removed, Help button gets it */}
<button
  onClick={() => setShowSettingsModal(true)}
  title="Settings (Cmd+,)"
  className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
>
  <Settings size={14} />
</button>

{/* Help button — rightmost, gets the mr-3 padding */}
<button
  onClick={toggleHelpPanel}
  title="Help"
  className={`mr-3 p-1.5 rounded-md transition-colors ${
    helpPanelOpen
      ? "text-accent bg-accent-dim"
      : "text-text-ghost hover:text-text-secondary hover:bg-bg-elevated"
  }`}
>
  <HelpCircle size={14} />
</button>
```

Import `HelpCircle` from `lucide-react`.

---

## 9. AppShell Changes

In `AppShell.tsx`, render the HelpPanel at the app level (same z-layer as SpecWriterSlideOver):

```tsx
{/* Help panel — app-level, not project-level */}
<HelpPanel />
```

Position it after the main layout but before modals. The panel uses `position: fixed` or absolute positioning to overlay the right side.

---

## 10. UI Store Changes

Add to `uiStore.ts`:

```typescript
// In the state interface:
helpSessionId: string | null;
helpPanelOpen: boolean;
helpSessionReady: boolean;

// In the actions:
setHelpSessionId: (id: string | null) => void;
setHelpPanelOpen: (open: boolean) => void;
setHelpSessionReady: (ready: boolean) => void;
toggleHelpPanel: () => void;
```

Initial values:
```typescript
helpSessionId: null,
helpPanelOpen: false,
helpSessionReady: false,
```

`toggleHelpPanel` toggles `helpPanelOpen`. Does NOT create or destroy the session — that's handled by `useHelpSession` when the panel opens for the first time.

---

## 11. Rust Backend: read_user_guide Command

### 11.1 New file: `src-tauri/src/commands/help.rs`

```rust
use tauri::Manager;

#[tauri::command]
pub fn read_user_guide(app_handle: tauri::AppHandle) -> Result<String, String> {
    let resource_path = app_handle
        .path()
        .resolve("resources/user-guide.md", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve user guide path: {}", e))?;
    
    std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read user guide: {}", e))
}
```

### 11.2 Register in lib.rs

Add `read_user_guide` to the `invoke_handler` alongside existing commands.

### 11.3 Bundle the resource

In `tauri.conf.json`, ensure `src-tauri/resources/` is included in the bundle resources (it already is for `templates.json`):

```json
{
  "bundle": {
    "resources": ["resources/*"]
  }
}
```

### 11.4 TypeScript wrapper

In `src/lib/tauri-commands.ts`:

```typescript
export async function readUserGuide(): Promise<string> {
  return invoke<string>("read_user_guide");
}
```

---

## 12. The System Prompt

This is the message sent as the first user message to the help Claude Code session, before the user types anything:

```
You are the CodeMantis Help Assistant. You answer questions about how to use
the CodeMantis application.

RULES:
1. Answer ONLY from the user guide below. Do not invent features or UI elements
   that aren't described in the guide.
2. Use EXACT UI labels from the guide: button names ("Save to Project"), 
   tab names ("Activity"), modal titles ("MCP Servers"), etc.
3. Include keyboard shortcuts when relevant: "Press ⌘⇧N or click the + button 
   in the title bar."
4. Keep answers concise:
   - Simple questions: 2-4 sentences
   - How-to questions: numbered step-by-step (keep steps brief)
   - "What does X do?": explain in 1-2 sentences
5. If the guide doesn't cover the question, say: "I don't have specific 
   information about that in my knowledge base. You might find help at 
   codemantis.dev/help or by opening a GitHub Issue."
6. Never suggest editing files, running bash commands, or changing code.
   You are a help assistant, not a coding assistant.
7. When listing multiple options (like MCP templates or keyboard shortcuts),
   use brief formatting — don't quote the entire guide section.
8. Be warm and helpful. The user may be new to CodeMantis.

USER GUIDE:

{guide_content}
```

---

## 13. Keyboard Shortcut (Optional)

Consider adding `⌘?` (Cmd + Shift + /) as a global shortcut to toggle the help panel. This mirrors the help shortcut in many Mac apps.

If implemented, add to `src/data/shortcuts.ts`:
```typescript
{
  name: "Global",
  shortcuts: [
    // ... existing shortcuts ...
    { keys: "⌘ ?", description: "Toggle Help panel" },
  ],
}
```

And register in `useKeyboardShortcuts.ts`.

---

## 14. What This Does NOT Include

- **No search within help articles** — the user just asks Claude Code naturally
- **No separate help article rendering** — no markdown viewer, no category browser. Those are for the website. In-app, it's conversational.
- **No persistence across app restarts** — fresh session each launch. This is intentional: keeps token budget clean and ensures the user guide is always the latest bundled version.
- **No model selector** — always Haiku. If we need to change this later, it's a one-line constant change.
- **No project context in help** — the help assistant knows about CodeMantis features, not about the user's specific project. For project questions, they use the normal Claude Code session.

---

## 15. Implementation Checklist

### Rust Backend
- [ ] `src-tauri/src/commands/help.rs` created with `read_user_guide` command
- [ ] Command reads from `src-tauri/resources/user-guide.md` (bundled resource)
- [ ] Command registered in `lib.rs` invoke handler
- [ ] `resources/*` included in `tauri.conf.json` bundle config (verify)
- [ ] TypeScript wrapper `readUserGuide()` added to `tauri-commands.ts`

### UI Store
- [ ] `helpSessionId: string | null` added to uiStore
- [ ] `helpPanelOpen: boolean` added to uiStore
- [ ] `helpSessionReady: boolean` added to uiStore
- [ ] `setHelpSessionId`, `setHelpPanelOpen`, `setHelpSessionReady` actions added
- [ ] `toggleHelpPanel` action added

### Hook: useHelpSession
- [ ] `src/hooks/useHelpSession.ts` created
- [ ] `initHelpSession()` creates Claude Code session with Haiku model
- [ ] Session set to Plan mode after creation
- [ ] User guide read from bundled resource and sent as first message
- [ ] Initial Claude Code response waited for and hidden from user
- [ ] `helpSessionReady` set to true after initialization
- [ ] `sendHelpMessage()` sends user message to help session
- [ ] Error handling: session creation failure shows error state with retry
- [ ] Cleanup: session closed on app unmount

### Components
- [ ] `src/components/help/HelpPanel.tsx` — slide-in container (400px, from right)
- [ ] Slide-in animation (CSS transition, translateX)
- [ ] Panel has header ("CodeMantis Help" + × close button)
- [ ] Renders HelpWelcome when no messages, HelpChat when conversation active
- [ ] Loading state with spinner while session initializes
- [ ] Error state with retry button

- [ ] `src/components/help/HelpChat.tsx` — message list
- [ ] Renders user and assistant messages
- [ ] Hides first 2 messages (guide injection + acknowledgment)
- [ ] Streaming response support (StreamingCursor)
- [ ] Auto-scroll to bottom
- [ ] No tool badges, no thinking indicator, no activity chips

- [ ] `src/components/help/HelpChatInput.tsx` — input area
- [ ] Auto-expanding textarea (1-3 lines)
- [ ] Send button (accent color)
- [ ] Enter to send
- [ ] Disabled while streaming
- [ ] Placeholder: "Ask a question about CodeMantis..."

- [ ] `src/components/help/HelpWelcome.tsx` — static welcome message
- [ ] Welcome text with emoji
- [ ] 5 clickable suggested questions
- [ ] Clicking a suggestion sends it as a message

### Title Bar
- [ ] ❓ button added as rightmost button (after Settings)
- [ ] Uses `HelpCircle` icon from lucide-react, size 14
- [ ] Active state: `text-accent bg-accent-dim` when panel is open
- [ ] Tooltip: "Help"
- [ ] Settings button `mr-3` moved to Help button
- [ ] Button is always visible (even without project open)

### AppShell
- [ ] `<HelpPanel />` rendered at app level
- [ ] Z-index: above right panel, below modals
- [ ] Does not interfere with SpecWriter slide-over

### User Guide Resource
- [ ] `src-tauri/resources/user-guide.md` exists (generated from User Guide Catalog)
- [ ] File included in app bundle (verified by running `pnpm tauri build` and checking .dmg contents)

### Session Management
- [ ] Help session does NOT count against MAX_SESSIONS (10) limit
- [ ] Help session is separate from project sessions in sessionStore
- [ ] Help session uses session ID prefix "help-" for identification
- [ ] Closing/switching projects does NOT affect the help session
- [ ] Help session terminates when app quits

### Quality
- [ ] Help panel opens in < 200ms (panel animation)
- [ ] First question answer appears in < 3 seconds (Haiku is fast)
- [ ] No console errors when opening/closing help panel repeatedly
- [ ] Help works when no project is open
- [ ] Help works while Claude Code is streaming in a coding session (separate process)
