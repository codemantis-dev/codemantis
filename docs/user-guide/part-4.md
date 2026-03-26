<!-- CodeMantis Complete User Guide — Part IV (Chapters 15-21) -->
<!-- Generated from source code | App Version: 0.9.1 | Date: 2026-03-26 -->

# Part IV: Advanced Features

---

## Chapter 15: SpecWriter — AI-Powered Specifications

SpecWriter is a dedicated slide-over panel for producing implementation-ready requirements specifications before you write a single line of code. It pairs an interactive AI conversation with a live Markdown preview, so you can describe what you want to build, answer clarifying questions, review a generated spec, and then hand it off to Claude Code for implementation.

### What You See

When SpecWriter is open, a large panel slides in from the right edge of the window, covering approximately 80% of the screen width. The panel sits below the title bar and is divided into three horizontal bands:

1. **Toolbar** -- a thin header bar at the top with the title "SpecWriter" on the left. To the right of the title you may see contextual buttons: "Generate Spec" (accent-colored when the conversation is ready), "Reset" (appears once the conversation has messages), and "Suggest Features" (visible in Feature mode). On the far right is an X close button.

2. **Two-column body** -- the majority of the panel. The left column is the **SpecWriter Chat** and the right column is the **Spec Preview Panel**. A thin vertical divider separates them; you can drag the divider to resize the columns (default split is 40% chat / 60% preview).

3. **Saved Specs list** -- a collapsible section at the very bottom of the right column showing previously saved specifications for the current project.

The chat column has its own sub-header reading "SpecWriter Chat" with a streaming indicator ("AI is responding..." with an elapsed timer when active). Below that are the conversation messages, followed by an input area with a paperclip button for attachments, a multi-line text area ("Describe what you want to build..."), and a Send/Stop button.

The preview column shows either an empty state ("Spec Preview -- Start a conversation on the left...") or a rendered Markdown document. When both a specification and an audit document exist, a tab bar appears with "Specification" and "Verification Audit" tabs. Below the preview are action buttons: Edit/Preview toggle, Copy to Clipboard, Generate Audit, and Save Spec or Save Audit (depending on the active tab).

### How to Open / Access

| Method | Action |
|--------|--------|
| Keyboard shortcut | Press **Command+Shift+B** |
| Title bar icon | Click the **pen icon** (PenTool) in the title bar |

Closing: press **Escape**, click the backdrop behind the panel, or click the **X** button on the toolbar.

### User Actions

**Choose a mode**

Before your first message, use the **Mode** dropdown at the bottom of the chat column. Two options are available:

- **Feature (existing project)** -- the AI reads your project's structure (framework, routes, components, stores, etc.) and writes specs that reference your actual codebase. A context status indicator shows the scanning state: hourglass while scanning, green check when loaded, red X if scanning failed.
- **New Application** -- the AI helps you design an entirely new app from scratch, including recommending a project template from the built-in catalog.

Once you send your first message the mode selector locks.

**Choose a provider and model**

Before your first message, two dropdowns appear in the chat sub-header:

- **Provider selector** -- choose between "Claude Code" (uses your existing Claude subscription, no API key needed), "Gemini", "OpenAI", "Anthropic", or "OpenRouter". Providers without a configured API key are shown as disabled with "(no key)".
- **Model selector** -- lists the available models for the selected provider. For Claude Code, models include Claude Sonnet 4 and Claude Opus 4.

After the first message, the provider and model are shown as read-only text.

If the selected model's provider has no API key, a yellow warning banner appears: "No API key set for this model's provider." with a link to **Settings -> AI Providers**.

**Describe what you want to build**

Type a description in the chat input area. You can also:

- **Attach images** -- click the paperclip icon, paste from clipboard (Command+V), or drag and drop files onto the input area. Images are resized to a maximum of 1024px on the longest edge. Accepted file types: images, PDF, TXT, MD, DOCX.
- **Attach documents** -- text files are extracted inline (up to 10,000 characters); binary files (PDF, DOCX) are sent as document parts.

Press **Enter** (or **Command+Enter** if configured in Settings) to send. Attached files appear as small chips above the input area, each with an X to remove.

**Answer clarifying questions**

The AI asks focused questions and presents selectable options as clickable buttons. The buttons use one of two interaction modes:

- **Few options (fewer than 4):** Click an option to send it immediately. Right-click to toggle multi-select mode.
- **Many options (4 or more):** Options display as checkboxes. Click to toggle selection. A "Select all" link appears at the top. Once you have selected the options you want, click the accent-colored "Send N selected" button.

A hint line below the options reads "Click to answer / Right-click to multi-select" or "Select the features to include, then press Send."

**Suggest Features (Feature mode only)**

In the toolbar, click **Suggest Features** (lightbulb icon). The AI analyzes your project and suggests features or improvements.

**Generate Spec**

When the AI determines it has enough information, the conversation status changes to "ready_to_write" and:
- A full-width accent-colored **Generate Spec** button appears at the bottom of the chat column.
- The toolbar "Generate Spec" button also becomes active.

Click either button. The status changes to "writing" and the AI produces a complete Markdown specification document. As it streams, the spec appears in real time in the preview panel.

**Generate Verification Audit**

After a spec is complete, the AI presents a system message: "Spec complete! Generate a Verification Audit?" with two option buttons:
- "Yes, generate the Verification Audit" -- starts audit generation immediately.
- "Not now -- I'll generate it later" -- you can generate it later via the **Generate Audit** button in the preview action bar.

The Verification Audit is a companion document that Claude Code uses after implementation to self-check its work by opening every file and verifying it matches the spec.

When both documents exist, the preview shows tabs for "Specification" and "Verification Audit."

**Edit the spec**

Click the **Edit** button (pencil icon) in the preview action bar. The rendered Markdown switches to a raw text editor. Click **Preview** (eye icon) to return to the rendered view. Editing is disabled while the AI is streaming.

**Copy to clipboard**

Click **Copy to Clipboard** in the preview action bar. A toast confirms "Spec copied to clipboard."

**Save to project**

Click **Save Spec** (or **Save Audit** if on the Audit tab). A dialog appears:

- **Title:** "Save Specification" or "Save Verification Audit"
- **Filename field:** auto-populated from the spec's first heading (slugified). Audit files use the `.audit.md` extension.
- **Path display:** shows "Saves to: docs/specs/{filename}"
- **Overwrite warning:** if the file already exists, a yellow banner offers "Overwrite" or "Save as {name}-v2.md".
- **Buttons:** Cancel and Save. The Save button is disabled if the filename is empty or if a duplicate exists without overwrite confirmation.

Files are saved to `docs/specs/` within the project directory. A metadata HTML comment is prepended with the date, AI model, mode, and project path.

After saving a spec, the system automatically attempts to create an **Implementation Guide** (see Chapter 16) if the spec contains a Session Plan section. A toast confirms "Implementation Guide created -- N sessions to complete."

After saving an audit, a system message explains how to use it with Claude Code and offers to add a verification workflow to your project's CLAUDE.md file. Selecting "Yes, add to CLAUDE.md" appends the workflow instruction; a toast confirms "Added verification workflow to CLAUDE.md."

**Send to Chat / Implement**

After saving, the toolbar gains two additional buttons:
- **Send to Chat** (send icon) -- sends a reference to the saved spec to your active chat session: "Read docs/specs/{filename} for implementation."
- **Implement** (play icon) -- sends a full implementation request: "Please implement the feature described in docs/specs/{filename}. Follow the specification and implementation checklist."

Both buttons close SpecWriter after sending.

**Use Guide**

If an Implementation Guide was created from the spec, a **Use Guide** button (book icon) appears in the toolbar. Clicking it closes SpecWriter and switches the right panel to the Guide tab (see Chapter 16).

**Reset**

Click **Reset** (rotate-ccw icon) in the toolbar. This clears the entire conversation, spec content, audit content, and persisted state. The SpecWriter returns to its initial state for a fresh start.

**Browse saved specs**

At the bottom of the preview panel, a collapsible section titled "Saved Specs (N)" lists all specs saved in the project. Each entry shows:
- File icon and title (extracted from the Markdown heading)
- Filename and last-modified date
- On hover: an **Upload** button (loads the spec into the conversation for revision) and a **Trash** button (with a "Confirm" step)

Click any spec to load its content into the preview panel.

**Cancel streaming**

While the AI is responding, a red square **Stop** button replaces the Send button. Click it to cancel the current generation. A system message "Generation stopped." is added to the conversation.

### States

- **Default (no conversation):** Empty chat with the prompt "Describe what you want to build." Mode and provider selectors are visible.
- **Gathering:** Conversation in progress. The AI asks questions. Status shows "In progress" in the badge.
- **Context loading (Feature mode):** A full overlay with a spinner says "Analyzing project... Scanning {projectName} to understand its structure." A "Skip -- start without context" button lets you bypass the scan.
- **Context error:** A red banner at the top reads "Context loading failed: {error}" with a Dismiss button.
- **Ready to write:** The Generate Spec button activates. Badge shows "Spec ready."
- **Writing:** The AI is streaming the specification. Badge pulses with "Writing..."
- **Done:** Spec complete. Badge shows "Done." Audit offer appears.
- **Streaming:** A pulsing dot with "AI is responding..." and an elapsed timer (shown after 5 seconds).
- **Loading files:** A pulsing amber dot with "Loading requested files..." appears when the AI requests project files in Feature mode.
- **Error:** System messages in a gray box with an info icon describe API errors or missing keys.
- **Empty preview:** A centered notebook emoji with "Spec Preview" and instructions.

### Configuration

- **Settings -> AI Providers:** Configure API keys for Gemini, OpenAI, Anthropic, or OpenRouter to use those providers in SpecWriter.
- **Settings -> AI Providers -> SpecWriter Model:** Choose the default model for SpecWriter conversations.
- **Settings -> General -> Send Shortcut:** Controls whether Enter or Command+Enter sends messages (applies to SpecWriter input too).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Command+Shift+B** | Open/close SpecWriter |
| **Escape** | Close SpecWriter (or stop generation if AI is responding) |
| **Enter** or **Command+Enter** | Send message (depends on setting) |
| **Command+V** | Paste image from clipboard |

### Tips

- In Feature mode, let the context scan complete before sending your first message. The AI produces much better specs when it can reference your actual file structure, routes, and components.
- When the AI presents a feature checklist with 4+ options, use "Select all" and then deselect the features you do not want -- this is faster than selecting each one individually.
- After saving both the spec and the audit, use the "Implement" button to send Claude Code a single-shot implementation request, or use the Implementation Guide for a structured, multi-session approach to complex features.

---

## Chapter 16: Implementation Guide

The Implementation Guide is a structured, multi-session plan derived from a SpecWriter specification. It breaks a complex feature into sequential sessions, each with a defined scope, a ready-to-use prompt, a list of files to create or modify, and a verification checklist. It lives in the right panel and persists across app restarts.

### What You See

The Guide tab appears in the right panel tab bar only when an active guide exists. Its icon is a **ListChecks** (checklist) icon. When selected, the panel contains:

1. **Header** -- a book-open icon (green when complete, accent-colored otherwise), the guide title (truncated if long), a progress summary ("Implementation Guide -- 3 of 5 sessions complete"), and a narrow progress bar that fills from left to right as sessions are completed. The bar turns green when all sessions are done.

2. **Session list** -- a scrollable list of expandable cards, one per session. Each card shows:
   - A **status icon** on the left: green checkmark (done), accent play-triangle (active), or hollow circle (pending).
   - Session label: "Session 1: {name}"
   - An **active badge** reading "CURRENT" on the currently active session.
   - A done summary reading "All checks passed" on completed sessions.
   - A chevron to expand/collapse.

   When a card is expanded, it reveals:
   - **Scope** and **Read sections** -- brief descriptions of what this session covers and which spec sections to reference.
   - **Files list** -- a collapsible sub-section showing the files this session will create or modify.
   - **Copy Prompt** button -- copies the session's implementation prompt to the clipboard.
   - **Send to Chat** button (accent-colored) -- pastes the prompt into your main chat input area for review before sending.
   - **Verify checklist** -- a list of checkbox items under the heading "Verify before next session." Each item can be checked individually.
   - **Verify for me** button (shield icon) -- pastes a verification prompt into the chat input that asks Claude Code to open the relevant files and report PASS/FAIL for each check.
   - **Mark Session Complete** button -- full-width, disabled (gray) until all verify checks are checked. Once all checks pass, it turns green. Clicking it marks the session as done and auto-activates the next pending session.

3. **Footer** -- at the bottom of the panel:
   - **Open Spec** button -- opens the specification file in the file viewer.
   - **Dismiss** button (trash icon) -- shows a confirmation ("Delete guide? Yes / No") before permanently deleting the guide.

### How to Open / Access

The Guide tab appears automatically in the right panel when:
- You save a spec in SpecWriter that contains a Session Plan section (the guide is created automatically).
- You click "Use Guide" in the SpecWriter toolbar.

You can also click the Guide tab icon (ListChecks) in the right panel tab bar whenever a guide is active.

### User Actions

**Expand a session card**

Click anywhere on the session header row. The active session is expanded by default. Pending sessions are collapsed and slightly dimmed (70% opacity).

**Copy a session prompt**

Click **Copy Prompt** on an expanded session card. A toast confirms "Prompt copied to clipboard." You can then paste it into any Claude Code session.

**Send a prompt to chat**

Click **Send to Chat** on an expanded session card. The prompt is pasted into the main chat input area. A toast advises "Prompt pasted into chat. Review and press Enter to send." The guide does not auto-send -- you review and send manually.

**Check verification items**

Click each checkbox in the "Verify before next session" list. Checked items appear with strikethrough text and dimmed color. All items must be checked before you can mark the session complete.

**Ask Claude Code to verify for you**

Click **Verify for me** (shield icon). A verification prompt is pasted into the chat input that instructs Claude Code to check each item by opening files and reading the actual code. Review and send.

**Mark a session complete**

Once all verification checks are checked, the **Mark Session Complete** button turns green. Click it. The session transitions to "done" (green checkmark) and the next pending session becomes "active." A toast confirms "Session N complete! Next: Session N+1." When all sessions are done, a toast reads "All sessions complete! Your implementation is done." and the progress bar turns green.

**Open the spec**

Click **Open Spec** in the footer. The spec file opens in the right panel file viewer.

**Dismiss the guide**

Click **Dismiss** in the footer. A confirmation appears: "Delete guide? Yes / No." Click "Yes" to permanently delete the guide. The right panel switches to the Activity tab. A toast confirms "Implementation guide dismissed."

### States

- **Default (no guide):** A centered book-open icon with "No implementation guide yet. Save a spec with a Session Plan to generate one."
- **Loading:** A centered spinner while the guide data is loaded from the database.
- **Active:** The session list with progress tracking.
- **Completed:** The progress bar is full and green. The header reads "Implementation Guide Complete." All session cards show green checkmarks.

### Configuration

There are no dedicated settings for the Implementation Guide. It uses the same chat session and project context as your main Claude Code session.

### Keyboard Shortcuts

The Guide panel does not have dedicated shortcuts. Use the general right-panel tab shortcuts to switch between tabs.

### Tips

- Work through sessions in order. Each session builds on the previous one, and the verification checks ensure you do not carry bugs forward.
- Use "Verify for me" to let Claude Code do the manual checking -- it opens every file mentioned in the checklist and reports PASS or FAIL, then fixes any failures automatically.
- If you need to revise the spec mid-implementation, open SpecWriter, load the saved spec into the conversation, make changes, and save again. The guide does not auto-update, but you can dismiss and regenerate it.

---

## Chapter 17: Project Templates

Project Templates let you scaffold a new project from a curated library of production-ready starter templates. Each template comes with pre-configured tooling, dependencies, and a generated CLAUDE.md file so Claude Code understands the project from the first session.

### What You See

The template picker is a full-page view inside the "New Project" modal. It contains:

1. **Search bar** -- a text input at the top with a magnifying glass icon and placeholder "Search templates..." Auto-focused on open.

2. **Category pills** -- a row of filter buttons: **All**, **Frontend**, **Full-Stack**, **Backend**, **Mobile**, **Static**. The active filter is highlighted with an accent background. Click any pill to filter the grid.

3. **Template grid** -- a two-column grid of cards, one per template. Each card shows:
   - An **icon** in a rounded square (e.g., Zap, Component, Triangle).
   - The **template name** in bold.
   - A **description** (up to two lines, truncated with ellipsis).
   - **Tech tags** (up to three shown, with "+N" for extras).
   - **Stars** count (formatted as "12.7K stars" for large numbers) and **license** at the bottom.
   - A **CLI** indicator if the template uses CLI scaffolding rather than git clone.

4. **Detail view** -- clicking a card navigates to a detail page showing:
   - A "Back to templates" link with a left arrow.
   - The template icon (larger), name, stars, and license.
   - All tech tags displayed.
   - The full (long) description.
   - A **Prerequisites** section (if applicable) showing each prerequisite with a green check or red X, required/optional labels, and an **Install** button for missing tools.
   - A **Project name** input field (auto-populated with a slugified version of the template name).
   - A **Location** picker (opens a native folder chooser dialog). Remembers the last-used directory.
   - A **View on GitHub** link (opens in browser).
   - A **Use This Template** button (disabled if required prerequisites are missing or no location is set).

5. **Scaffold progress** -- after clicking "Use This Template," a progress view shows:
   - A header: "Setting up: {projectName}" with the template name below.
   - A vertical step list with status icons: hollow circle (pending), spinning loader (in progress), green checkmark (done), red X (error).
   - For git-clone templates, steps are: Validating environment, Cloning template, Cleaning up, Installing dependencies, Verifying project, Setting up CLAUDE.md, Finalizing project.
   - For CLI templates, steps are: Validating environment, Generating project, Installing dependencies, Running post-setup, Verifying project, Setting up CLAUDE.md, Finalizing project.
   - On success: "Project ready!" with an **Open in CodeMantis** button.
   - On error: the failed step shows its error message. Expandable "Show output" reveals command output. Buttons: "Open Anyway" (if a partial project exists), **Retry**, and **Cancel**.
   - If the error is a missing-tools error, a **Fix with Claude** button appears. Clicking it starts a mini Claude Code session within the progress view to install the missing tools. The mini-chat has an input field and a "Continue Setup" button that re-runs the scaffold after tools are installed.

### How to Open / Access

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Command+Shift+N** |
| Title bar | Click the **+** (Plus) button |

### Available Templates

The following templates are included in the built-in library:

| Template | Category | Scaffold Type | Description |
|----------|----------|---------------|-------------|
| **React + Vite (Batteries Included)** | Frontend | git-clone | Vite + React 19 with TanStack Router, Zustand, Vitest, Playwright, Tailwind CSS |
| **React + Vite + shadcn/ui** | Frontend | CLI | Minimal React + Vite + Tailwind + shadcn/ui via the official shadcn CLI |
| **Next.js Full-Stack** | Full-Stack | git-clone | Next.js 16 with TypeScript, Tailwind CSS 4, Drizzle ORM, Clerk Auth, Vitest, Playwright |
| **Next.js SaaS Boilerplate** | Full-Stack | git-clone | Stripe payments, multi-tenancy, roles, team management, shadcn/ui, Drizzle |
| **next-forge (Monorepo)** | Full-Stack | CLI | Turborepo monorepo with Prisma, Clerk, Stripe, Sentry, Biome |
| **FastAPI Full-Stack (Official)** | Backend | git-clone | Official FastAPI template with React frontend, SQLModel, PostgreSQL, Docker |
| **FastAPI Boilerplate** | Backend | git-clone | Async SQLAlchemy, Redis, ARQ job queues, rate limiting, uv package manager |
| **Astro (Static Site)** | Static | CLI | Official Astro scaffolding for content sites, blogs, documentation |
| **Expo (React Native)** | Mobile | CLI | Official Expo scaffolding for cross-platform iOS, Android, and web apps |
| **Nextplate (Website + Blog)** | Static | git-clone | Next.js + Tailwind site with blog, dark mode, MDX, SEO |
| **Fumadocs (Docs + Blog)** | Static | CLI | Documentation framework for Next.js with MDX, full-text search, OpenAPI docs |

### User Actions

**Search for a template**

Type in the search bar. The grid filters in real time by template name, description, and tags.

**Filter by category**

Click any category pill (All, Frontend, Full-Stack, Backend, Mobile, Static). The grid shows only matching templates.

**View template details**

Click a template card. The detail view shows the full description, prerequisites, and configuration form.

**Check prerequisites**

On the detail view, the Prerequisites section automatically runs checks on mount. Each prerequisite shows:
- Green check + name if installed.
- Red X + name + "required" or "optional" label if missing.
- An **Install** button (if an install command is known) that runs the install and re-checks.
- A **Re-check** button to manually re-verify after manual installation.

**Configure project name and location**

Enter a project name (letters, numbers, hyphens, underscores, dots -- no spaces). Click the Location button to open a native folder picker. The last-used directory is remembered.

**Scaffold the project**

Click **Use This Template**. The view transitions to the progress screen. Watch the step-by-step progress. On completion, click **Open in CodeMantis** to immediately open the new project with a Claude Code session.

**Fix missing tools with Claude**

If scaffolding fails because CLI tools are missing, click **Fix with Claude**. A mini-chat opens within the progress view where Claude Code installs the missing tools. Once Claude finishes, click **Continue Setup** to retry the scaffold.

### States

- **Loading:** "Loading templates..." centered in the grid area.
- **Empty search:** "No templates match your search" centered.
- **No templates:** "No templates available" (should not occur with bundled templates).
- **Detail -- prerequisites checking:** A spinning Re-check indicator.
- **Detail -- installing prerequisite:** The Install button shows a spinner with "Installing..."
- **Progress -- in progress:** Steps animate through their states.
- **Progress -- success:** "Project ready!" with warnings listed if any.
- **Progress -- error:** The failed step is highlighted red with expandable output.

### Configuration

There are no dedicated template settings. The last scaffold directory is remembered in local storage.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Command+Shift+N** | Open new project (template picker) |
| **Enter** | Submit project name (when focused on the name field in detail view) |

### Tips

- CLI-scaffolded templates (marked with a "CLI" label) always use the latest version of their tooling because they run the official create/init command at scaffold time.
- After scaffolding, the generated CLAUDE.md file gives Claude Code a head start -- it already knows the project's framework, directory structure, available scripts, and conventions.
- If a prerequisite install fails, you can install it manually in your terminal and click "Re-check" to verify.

---

## Chapter 18: Preview Browser

The Preview Browser opens your application's development server in a separate window and captures console output so you can debug without leaving CodeMantis. It auto-detects dev server ports, takes screenshots directly into your chat, and shows console errors in real time.

### What You See

The Preview Browser opens as a **separate native window** (not a tab or panel within the main CodeMantis window). The preview window is a WebView that renders your running web application.

In the main CodeMantis window, the title bar shows:
- A **globe icon** button -- click to start the dev server and open the preview.
- A **camera icon** (appears only when the preview is open) -- click to take a screenshot and attach it to the current chat.

When the dev server fails to auto-detect, a **Preview URL dialog** appears as a modal overlay:
- Title: "Dev server failed" with a warning triangle icon.
- The error message explaining what went wrong.
- A text input with a globe icon: "Enter the URL of your running dev server (e.g. from Docker or a remote host)" with a placeholder "http://localhost:3000".
- Cancel and **Open Preview** buttons.

### How to Open / Access

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Command+Shift+P** |
| Title bar | Click the **globe icon** |

Closing: close the preview window normally (Command+W or the window close button). When the preview window closes, the dev server is automatically stopped.

### User Actions

**Start the preview**

Click the **globe icon** in the title bar or press **Command+Shift+P**. CodeMantis:
1. Starts your project's dev server in a background terminal (using the detected dev command, e.g., `pnpm dev`).
2. Scans for the dev server port by monitoring the terminal output.
3. Once the server is ready, opens the preview window automatically.

If the dev server was already running, clicking the globe icon focuses the existing preview window.

**Enter a custom URL**

If the auto-detection fails (the dev server output did not match known patterns, or the server is running externally), the Preview URL dialog appears. Type the URL of your dev server and click **Open Preview**. The URL is saved per-project and pre-filled next time.

**Take a screenshot**

When the preview window is open, click the **camera icon** in the title bar. A screenshot is captured and automatically attached to the current chat session as "preview-screenshot.png." A toast confirms "Screenshot added to chat."

**Refresh the preview**

Press **Command+R** in the preview window to reload the page.

**Close the preview**

Close the preview window. The dev server process is automatically stopped and cleaned up. The camera icon disappears from the title bar.

### States

- **Idle:** No dev server running. The globe icon is the only visible control.
- **Starting:** The dev server process has been launched. Internal status: "starting."
- **Scanning:** The terminal output is being monitored for a URL/port. Internal status: "scanning."
- **Running:** The dev server is active and the preview window is open. The camera icon appears.
- **Error:** The dev server failed. The Preview URL dialog appears as a fallback. An error message is shown.

### Configuration

- **Settings -> Preview -> Auto-start dev server:** When enabled, the dev server starts automatically when you open a project (not yet exposed in settings UI -- configured per-project).
- **Settings -> Preview -> Custom dev command:** Override the auto-detected dev command with a custom one (e.g., `docker compose up`).

The preview stores per-project state including the last-used URL. Console logs are capped at 500 entries per project.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Command+Shift+P** | Open/toggle preview |
| **Command+R** | Refresh preview (when preview window is focused) |

### Tips

- If your project uses Docker or a non-standard dev server setup, start the server manually and use the Preview URL dialog to connect.
- The screenshot feature is invaluable for showing Claude Code what your UI looks like -- attach a screenshot and ask "fix the layout issue shown in this screenshot."
- When the preview window closes, the dev server stops automatically. If you want the dev server to keep running, use the integrated terminal instead.

---

## Chapter 19: MCP Server Management

MCP (Model Context Protocol) servers extend Claude Code's capabilities by connecting it to external tools and services -- from web search and browser automation to databases and payment platforms. The MCP modal lets you add, configure, and manage these servers using templates or manual configuration.

### What You See

The MCP modal is a centered dialog (up to 780px wide, 720px tall) with:

1. **Header** -- the Blocks icon in accent color, the title "MCP Servers", and an X close button.

2. **Scope filter toolbar** -- filter buttons: **All**, **Global**, and (if a project is open) **Project**. The active filter is highlighted.

3. **Add Server button** -- "+ Add Server" on the right side of the toolbar.

4. **Server list** -- each configured server is shown as a row with:
   - The server **name** in monospace font.
   - A **Type badge** indicating "stdio", "http", or "sse."
   - A **Scope badge** indicating "Global" or "Project."
   - A summary line showing the command/URL.
   - Environment variables displayed as masked key-value chips (with eye/eye-off toggle to reveal values).
   - **Edit** (pencil) and **Delete** (trash) buttons on hover.

5. **Footer** -- shows config file paths: "Global: ~/.claude.json" and "Project: {path}/.mcp.json" with folder-reveal buttons next to each.

When adding a server, the modal transitions through sub-views:
- **Template Picker** -- categorized grid of templates.
- **Server Form** -- manual or template-prefilled configuration form.
- **Config File Editor** -- a Monaco editor showing the raw JSON config file.

### How to Open / Access

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Command+Shift+M** |
| Title bar | Click the **Blocks icon** |

### Available MCP Templates

Templates are organized into three categories:

**No Setup Required**

| Template | Description |
|----------|-------------|
| Context7 | Documentation lookup for any library |
| Playwright | Browser automation and testing |
| BrowserMCP | Browser control via Chrome extension |
| Fetch | Fetch web content as markdown |
| Filesystem | Read/write files in allowed directories |
| Memory | Persistent memory via knowledge graph |

**Requires API Key**

| Template | Description |
|----------|-------------|
| Brave Search | Web search via Brave Search API |
| Stripe | Stripe payments and billing |

**Cloud Services**

| Template | Description |
|----------|-------------|
| Supabase | Supabase database, auth, and storage |
| Sentry | Error tracking and monitoring |
| Neon | Serverless Postgres by Neon |
| Cloudflare | Cloudflare Workers and edge services |

### User Actions

**Add a server from a template**

1. Click **+ Add Server**. The Template Picker appears.
2. Click a template card. The Server Form appears, pre-filled with the template's command, arguments, environment variables, and setup hint.
3. Adjust the **Name** if desired (must be unique, letters/numbers/hyphens/underscores only).
4. Choose the **Scope**: Global (saved to `~/.claude.json`, available in all projects) or Project (saved to `.mcp.json` in the project root, available only in this project).
5. Fill in any required values (e.g., API keys in the environment variables section). Placeholder hints show the expected format.
6. Click **Add Server**.

Each template card includes a setup hint (displayed as an info box in the form) and a **Docs** link that opens the server's documentation.

**Add a server manually**

1. Click **+ Add Server**, then click **Manual Configuration** at the bottom of the template picker.
2. Fill in:
   - **Name** -- a unique identifier.
   - **Scope** -- Global or Project.
   - **Type** -- stdio (local process), http (remote HTTP endpoint), or sse (Server-Sent Events, legacy).
3. For **stdio** servers:
   - **Command** -- the executable to run (e.g., `npx`, `node`, `python`, `uvx`).
   - **Arguments** -- comma-separated arguments.
   - **Environment Variables** -- key-value pairs passed to the process at startup.
4. For **http** or **sse** servers:
   - **URL** -- the endpoint URL.
   - **Headers** -- key-value pairs (e.g., Authorization headers).
5. Click **Add Server**.

**Edit a server**

Click the **pencil icon** on a server row. The Server Form opens with the current configuration. The name and scope fields are locked (cannot be changed after creation). Modify the command, arguments, URL, environment variables, or headers, then click **Save Changes**.

**Delete a server**

Click the **trash icon** on a server row. A confirmation appears with "Delete" and "Cancel" buttons. Click "Delete" to remove the server from the config file.

**View/edit the raw config file**

In the Server Form footer, click **Show config file**. A Monaco JSON editor opens showing the full contents of the relevant config file (`~/.claude.json` or `.mcp.json`). Edit the JSON directly and click **Save**, or click **Cancel** to discard changes.

**Reveal config file in Finder**

In the modal footer, click the **folder icon** next to "Global: ~/.claude.json" or "Project: {path}/.mcp.json" to open the containing folder in Finder.

**Toggle environment variable visibility**

On the server list, each environment variable shows its value as "bullets" by default. Click the **eye icon** on any variable chip to reveal the actual value. Click the **eye-off icon** to re-mask it.

### States

- **Loading:** "Loading..." centered in the server list.
- **Empty (no servers):** "No MCP servers configured" centered.
- **Empty (filtered):** "No servers match this filter" centered.
- **Error:** A red banner at the top of the body displays the error message.
- **Form validation:** The name field shows red borders and error messages for invalid characters or duplicate names. The Add Server / Save Changes button is disabled until validation passes.

### Configuration

MCP server configuration is stored in two files:
- **Global:** `~/.claude.json` -- servers available in every project.
- **Project:** `{project}/.mcp.json` -- servers available only in that project.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Command+Shift+M** | Open MCP Servers modal |
| **Escape** | Close modal (blocked if there are unsaved changes) |

### Tips

- "No Setup Required" templates work immediately -- just add them and they are ready to use in your next Claude Code session.
- For cloud services like Supabase and Sentry, the first connection triggers browser-based OAuth authentication. No API key entry is needed.
- Use Project scope for servers that are specific to one project (e.g., a project-specific Supabase instance) and Global scope for general-purpose tools (e.g., web search, browser automation).

---

## Chapter 20: Slash Commands & CLI Overlay

Slash commands let you trigger actions by typing "/" in the chat input. The Command Palette shows all available commands with categories, descriptions, and keyboard navigation. For commands that require the interactive Claude CLI (like `/model` or `/config`), the CLI Overlay provides a full terminal session.

### What You See

**Command Palette**

When you type "/" at the beginning of a message in the chat input, a floating panel appears above the input area. It contains:

- A scrollable list of commands (up to 300px tall).
- Each command row shows:
  - The command name in accent-colored monospace text (e.g., `/clear`).
  - A description in dimmed text.
  - An argument hint (italic, shown only for the currently selected command).
  - A **category badge** on the right side, color-coded:
    - **Skill** (accent color) -- custom commands from `.claude/commands/` that expand into prompts.
    - **Built-in** (dim color) -- instant commands handled by CodeMantis without restarting the session.
    - **Opens CLI** (yellow) -- commands that open the CLI Overlay.

The currently selected command is highlighted with a subtle background. The palette supports typeahead filtering: as you type after "/", the list narrows.

**CLI Overlay**

The CLI Overlay is a centered modal dialog (up to 900px wide, 600px tall) containing:

- A header with a terminal icon, "Claude CLI" title, a hint showing common CLI commands ("-- /model, /config, /doctor, /help"), and "Esc to close."
- A full terminal emulator (xterm.js) running an interactive Claude CLI session.
- An X close button.

### How to Open / Access

**Command Palette:**

| Method | Action |
|--------|--------|
| Type "/" | Type "/" at the start of a message in the chat input area |

**CLI Overlay:**

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Command+/** |
| Select a "cli-only" command | Pick a yellow-badged command from the palette |

### User Actions

**Search and filter commands**

Type "/" followed by any characters. The palette filters commands by name and description as you type. For example, typing "/com" shows `/compact`, `/config`, etc.

**Navigate the palette**

- **Arrow Up / Arrow Down** -- move the selection highlight.
- **Enter** -- execute the selected command.
- **Tab** -- autocomplete the selected command name.
- **Escape** -- close the palette without executing.

Click any command row to execute it.

**Execute a skill command**

Select a Skill command (accent-colored badge). CodeMantis reads the command's source file from `.claude/commands/`, expands any variables, and sends the resulting prompt to Claude Code as a regular message.

**Execute a built-in command**

Select a Built-in command (dim badge). These execute instantly:

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation history and restart the session |
| `/compact` | Compact the conversation context (free up tokens) |
| `/context` | Show context window usage (used / max tokens, percentage) |
| `/cost` | Show session cost, turn count, input/output/cache tokens |
| `/exit` | Close the current session |
| `/help` | Show the list of all available commands |
| `/rename <name>` | Rename the current session tab |

**Execute a CLI-only command**

Select a CLI-only command (yellow badge). This opens the CLI Overlay and auto-types the command into the interactive terminal. Common CLI-only commands include `/model`, `/config`, `/doctor`, `/mcp`, `/hooks`, `/theme`.

**Use the CLI Overlay directly**

Press **Command+/** to open the CLI Overlay. When it opens:
1. The current stream-json session is paused.
2. An interactive Claude CLI process starts in the terminal with `--resume` pointing to the current CLI session.
3. You interact directly with the Claude CLI -- change models, run diagnostics, configure settings.
4. When you close the overlay (Escape or X), the terminal is killed and the stream-json session resumes.

If a command was routed from the palette, it is auto-typed into the terminal after a brief delay.

**Pass arguments to commands**

Type the command name followed by a space and arguments. For example: `/rename My Feature Branch`. The arguments are extracted and passed to the command handler.

### States

- **Loading:** "Loading commands..." displayed in the palette while commands are being discovered.
- **No match:** "No commands matching '/{query}'" when no commands match the typed filter.
- **CLI Overlay loading:** "Pausing session and starting Claude CLI..." centered in the terminal area.
- **CLI Overlay error:** An error card is displayed in the terminal area. The session is automatically recovered (stream-json process resumed).

### Configuration

Skill commands are discovered from `.claude/commands/` directories in your project. There are no dedicated settings for the command palette or CLI Overlay.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **/** (at start of input) | Open command palette |
| **Command+/** | Open CLI Overlay directly |
| **Arrow Up / Down** | Navigate palette selection |
| **Enter** | Execute selected command |
| **Tab** | Autocomplete command name |
| **Escape** | Close palette or CLI Overlay |

### Tips

- The `/cost` command is a quick way to check how many tokens and dollars the current session has consumed.
- Use `/compact` when you notice Claude Code repeating itself or losing track of earlier context -- it compresses the conversation to free up the context window.
- The CLI Overlay is the only way to run interactive Claude CLI commands (like `/model` to switch models mid-session) because the main CodeMantis interface uses non-interactive stream-json mode.

---

## Chapter 21: Help System

The Help System is a built-in AI assistant dedicated to answering questions about CodeMantis itself. It runs as a separate Claude Code session (using Claude Haiku for fast responses), pre-loaded with the complete user guide, so it can answer questions about any feature, shortcut, or setting without consuming your main session's context.

### What You See

The Help panel slides in from the right edge of the window as a 400px-wide panel. It contains:

1. **Header** -- a help-circle icon in accent color, the title "CodeMantis Help," a **Home** button (house icon, visible when viewing chat and a conversation exists), and an **X** close button.

2. **Welcome screen** (shown on first open or when you click Home):
   - A greeting: "Welcome! I'm your CodeMantis helper."
   - A subtitle: "I know every feature, shortcut, and setting in the app. Ask me anything:"
   - Five **suggestion cards**, each a clickable button with a pre-written question:
     - "How do I create a new project from a template?"
     - "What are the three session modes?"
     - "How do I connect an MCP server?"
     - "How do I use SpecWriter?"
     - "What keyboard shortcuts are available?"

3. **Chat view** (shown after asking a question):
   - User messages appear as rounded bubbles on the right with a purple-tinted background.
   - Assistant messages appear on the left as plain Markdown text with code blocks and links.
   - A streaming cursor appears while the assistant is responding.
   - A "Thinking..." indicator with a spinning loader appears when the assistant is processing but has not started streaming yet.
   - A "New messages" scroll-to-bottom button appears if you scroll up during a response.

4. **Input area** (shown whenever the session is ready):
   - A rounded text area with the placeholder "Ask a question about CodeMantis... ({send shortcut hint})"
   - A **Send** button (accent-colored when text is entered) or a **Stop** button (red, when the assistant is responding).
   - The Stop button also shows "Esc" as a shortcut hint.

### How to Open / Access

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Command+?** (Command+Shift+/) |
| Title bar | Click the **Help (?) icon** on the far right of the title bar |

The Help icon in the title bar highlights in accent color with an accent background when the panel is open.

Closing: click the **X** button, press **Escape** (if the assistant is not responding), or click the Help icon again.

### User Actions

**Ask a question**

Type your question in the input area and press Enter (or Command+Enter, depending on your send shortcut setting). The welcome screen transitions to the chat view. The assistant responds with information drawn exclusively from the built-in user guide.

**Click a suggestion**

On the welcome screen, click any of the five suggestion cards. The question is sent immediately and the chat view appears.

**Stop a response**

While the assistant is streaming, click the **Stop** button or press **Escape**. The response is interrupted immediately.

**Return to the welcome screen**

Click the **Home** button (house icon) in the header. The chat view is replaced by the welcome screen. Your conversation history is preserved -- switching back to the chat view will show previous messages.

**Retry after an error**

If the help session fails to start (e.g., Claude Code CLI is not available), an error message is shown with a **Retry** button. Click it to re-initialize the session.

### States

- **Loading:** A centered spinning loader with "Starting help assistant..." The session is being created, the model is being set to Claude Haiku, and the user guide is being loaded.
- **Error:** An error message is centered with the failure description and a "Retry" button.
- **Welcome (ready):** The suggestion cards are shown. The input area is active.
- **Chat (ready):** Messages are visible. The input area is active.
- **Streaming:** The assistant's response is appearing character by character. The Stop button is shown.
- **Busy (not streaming):** A "Thinking..." indicator is shown while the assistant processes but has not started outputting text yet.

### Configuration

- **Settings -> General -> Send Shortcut:** Controls whether Enter or Command+Enter sends messages in the Help input area.

The Help session uses Claude Haiku (claude-haiku-4-5) for fast, low-cost responses. It runs in Plan mode (read-only -- no file modifications).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Command+?** | Open/close Help panel |
| **Escape** | Stop response (if streaming) or close panel |
| **Enter** or **Command+Enter** | Send message (depends on setting) |

### Tips

- The Help assistant answers only from the built-in user guide -- it will not make up features that do not exist. If it cannot find the answer, it directs you to the documentation website or GitHub Issues.
- The Help session is entirely separate from your main coding session. It does not consume your main session's context window or affect your conversation history.
- Click a suggestion card on the welcome screen to get oriented quickly if you are new to CodeMantis.
