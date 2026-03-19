# CodeMantis — SpecWriter: Requirements Specification Assistant

**Version:** 2.0 (replaces Preview Window & Task Board Spec v1.0)
**Date:** March 2026
**Status:** Pre-implementation

---

## What Changed & Why

The v1.0 Task Board attempted to orchestrate Claude Code execution from a planning AI — decomposing specs into tasks, executing them sequentially, running verification checks, and retrying failures. **This did not work.** The synchronization between the planning AI and Claude Code sessions was chaotic. The execution engine, verification loop, and DOM checking added massive complexity for unreliable results.

**What actually works well:** Claude Code reading a spec file and implementing it independently. The bottleneck is spec quality, not execution orchestration.

**The pivot:** Strip the execution engine entirely. Keep the interactive AI conversation (which works). Redirect the output from "task decomposition JSON" to **professional requirements specification documents** saved directly to the project folder. Claude Code reads them and implements them as it normally does — no orchestration needed.

**What we keep from v1.0:**
- TaskBoardSlideOver (rename to SpecWriterSlideOver)
- PlanningChat with multi-turn conversation, attachments, streaming
- usePlanningConversation hook (rewrite the system prompt)
- snapshot.rs for project context gathering
- Template catalog integration
- SQLite persistence of conversations

**What we remove:**
- WorkPackageList, WorkPackageCard, TaskCard, VerificationResults
- useTaskExecution hook
- All verification logic (code checks, DOM checks, retry loops)
- TaskBoardToolbar (Start All, Pause buttons)
- TaskBoardBadge execution progress display
- All execution-related types (WorkPackage, TaskItem, VerificationCheck, CheckResult)
- All execution-related store actions and state

---

## Table of Contents

1. Feature Overview
2. User Flows
3. UI: SpecWriter Slide-Over
4. Interactive AI Conversation
5. AI System Prompt Design (CRITICAL)
6. Context Gathering for Existing Projects
7. Spec Document Format & Output
8. Saving Specs to the Project Folder
9. Spec Document Management (Right Column)
10. Data Models
11. File Changes (What to Add, Change, Remove)
12. Implementation Order
13. Known Risks

---

## 1. Feature Overview

**SpecWriter** is an AI-powered requirements specification assistant built into CodeMantis. It conducts thorough interactive conversations with the user — accepting text, images (mockups, screenshots), and documents (PDFs, existing specs) — and produces professional, Claude-Code-ready specification documents saved directly to the project folder.

**Two modes:**

**New Application Mode:** The user describes an app from scratch. The AI asks questions about requirements, design, tech stack, and deployment. It recommends a template from CodeMantis's template registry. The output is a complete spec document that Claude Code can use to build the entire application.

**Feature Mode (for existing projects):** The user describes a new feature or modification for an existing project. The AI automatically gathers project context — file tree, existing routes, dependencies, CLAUDE.md, key source files — and asks questions that account for the current architecture. The output is a feature spec that references existing files, follows established patterns, and integrates with the existing codebase.

**The AI is NOT one-shot.** It engages in a genuine multi-turn conversation (typically 3-8 exchanges) before writing the spec. Better prompts and deeper questioning produce better specs. The spec quality is the entire value proposition.

---

## 2. User Flows

### 2.1 New Application

```
1. User clicks 📝 (SpecWriter) button in title bar → slide-over opens
2. User types: "I want to build a dashboard for tracking client projects"
3. AI asks clarifying questions (one at a time, with selectable options)
4. User answers with text, pastes mockup screenshots, attaches PDF brief
5. After 3-6 exchanges, AI says: "I have enough to write the spec"
6. User clicks "Write Spec" button (or types "go ahead")
7. AI generates a complete specification document (streamed in real-time)
8. Spec appears in the right column as a rendered Markdown preview
9. User reviews, can ask for changes: "Add a dark mode section"
10. AI revises the spec
11. User clicks "Save to Project" → spec saved to docs/specs/{name}.md
12. User opens Claude Code session → says "Read docs/specs/client-dashboard-spec.md and implement it"
```

### 2.2 Feature for Existing Project

```
1. User has an active project session open (e.g., their Next.js app)
2. User clicks 📝 → slide-over opens
3. AI detects this is an existing project → automatically gathers context
4. AI shows: "I've reviewed your project. It's a Next.js app with 12 routes,
   using Supabase for auth and Prisma for the database. What would you
   like to add or change?"
5. User: "Add a notification system — in-app and email"
6. AI asks questions ACCOUNTING FOR the existing stack:
   "You're using Supabase — should notifications use Supabase Realtime
   for live updates, or polling? For email, you have no email provider
   set up. Should I spec Resend, SendGrid, or Supabase Edge Functions?"
7. User answers, attaches a mockup of the notification bell UI
8. AI generates a feature spec that references existing files:
   "Modify src/app/layout.tsx to add NotificationBell component..."
   "Add new route src/app/notifications/page.tsx..."
   "Extend the existing Prisma schema with a Notification model..."
9. User saves → Claude Code implements by reading the spec
```

### 2.3 Iterating on a Saved Spec

```
1. User opens SpecWriter → right column shows list of saved specs
2. User clicks an existing spec → loads it into the conversation
3. User: "The auth spec needs to include OAuth with Google and GitHub"
4. AI reads the existing spec content and conversation history
5. AI asks targeted questions about the OAuth addition
6. AI generates a revised spec (or an addendum)
7. User saves → overwrites or creates a new version
```

---

## 3. UI: SpecWriter Slide-Over

### 3.1 Approach: Same Slide-Over, New Right Column

Reuse the existing TaskBoardSlideOver infrastructure. The slide-over slides in from the right, covers ~60% of the window, has a dimmed backdrop.

**Left Column (40%): AI Conversation** — Keep as-is from the existing PlanningChat. Multi-turn conversation with attachments, streaming, option buttons.

**Right Column (60%): Spec Preview & Management** — REPLACE the WorkPackageList/TaskCard components with:
- A rendered Markdown preview of the current spec being written
- A list of saved specs for this project
- Save/Export controls

### 3.2 Updated Layout

```
┌────────────────┬──────────────────────────────────────────────────┐
│                │  📝 SpecWriter                             [×]  │
│  Main App      │                                                 │
│  (dimmed)      ├────────────────────┬────────────────────────────┤
│                │                    │                            │
│  Chat panel    │  AI Conversation   │  Spec Preview              │
│  visible but   │                    │                            │
│  inactive      │  [AI]: "Your app   │  ┌────────────────────┐   │
│                │  uses Supabase     │  │ # Client Dashboard │   │
│                │  for auth. Should  │  │ ## 1. Overview      │   │
│                │  notifications     │  │ This feature adds...│   │
│                │  use Realtime?"    │  │                    │   │
│                │                    │  │ ## 2. Data Model   │   │
│                │  ?> Supabase RT    │  │ ### Notification    │   │
│                │  ?> Polling        │  │ - id: UUID         │   │
│                │  ?> WebSocket      │  │ - user_id: FK      │   │
│                │                    │  │ - type: enum       │   │
│                │  [📎 mockup.png]   │  │ ...                │   │
│                │                    │  └────────────────────┘   │
│                │  ┌──────────────┐  │                            │
│                │  │ Type here... │  │  [Save to Project]        │
│                │  │ [📎] [Send]  │  │  [Copy to Clipboard]      │
│                │  └──────────────┘  │  [Export as PDF]           │
│                │                    │                            │
│                ├────────────────────┤  ── Saved Specs ────────── │
│                │  Mode: Feature     │  📄 auth-spec.md (Mar 15) │
│                │  Context: ✅ loaded │  📄 dashboard-spec.md (…) │
│                │  📝 Gemini Flash   │  📄 notifications-spec.md  │
│                ├────────────────────┴────────────────────────────┤
│                │  [New Spec]  [Write Spec]  [💡 Suggest Features]│
└────────────────┴────────────────────────────────────────────────┘
```

### 3.3 Right Column Components

**Spec Preview (top, scrollable, takes most of the space):**
- Renders the current spec as formatted Markdown
- Updates in real-time as the AI streams the spec
- Syntax highlighting for code blocks
- Collapsible sections for long specs
- "Empty state" before spec is written: shows helpful text about what the AI will produce

**Action Buttons (below preview):**
- **"Save to Project"** — saves the spec to `docs/specs/{slug}.md` in the project folder
- **"Copy to Clipboard"** — copies raw Markdown
- **"Export as PDF"** — future enhancement, not required for v1

**Saved Specs List (bottom, collapsible):**
- Lists all `.md` files in `docs/specs/` of the current project
- Each entry shows: filename, last modified date, first line (title)
- Click a spec → loads it into the preview pane
- Right-click context menu: Open in File Viewer, Delete, Rename
- "📂 Open specs folder" link at the bottom

### 3.4 Bottom Bar

- **"New Spec"** — clears conversation and preview, starts fresh
- **"Write Spec"** — tells the AI to generate the spec now (enabled when AI indicates readiness)
- **"💡 Suggest Features"** — AI analyzes the project and suggests potential features/improvements (Feature Mode only)

### 3.5 Mode Indicator (bottom-left of left column)

Shows which mode the conversation is in:
- **"Mode: New Application"** — when no project session is active, or user explicitly chose new app
- **"Mode: Feature"** — when a project session is active
- **"Context: ✅ loaded"** / **"Context: ⏳ loading..."** / **"Context: ❌ failed"** — status of project context gathering
- AI provider badge (e.g., "📝 Gemini Flash")

---

## 4. Interactive AI Conversation

### 4.1 Conversation Infrastructure (KEEP AS-IS)

The existing `PlanningChat.tsx`, `PlanningChatInput.tsx`, `PlanningChatMessage.tsx`, and `usePlanningConversation.ts` remain. They already support:
- Multi-turn conversation with streaming
- Image paste (⌘V), drag-and-drop, file dialog attachments
- Document text extraction and inline sending
- Selectable option buttons (`?>` format)
- Provider/model switching
- Conversation persistence to SQLite

### 4.2 What Changes in the Hook

`usePlanningConversation.ts` needs these changes:
1. **System prompt** — completely rewritten (see Section 5)
2. **Output detection** — instead of looking for JSON task plans, detect Markdown spec output (starts with `# ` heading)
3. **Project context injection** — when in Feature Mode, automatically prepend project context to the first message
4. **"Write Spec" trigger** — instead of `generatePlan()`, implement `writeSpec()` that tells the AI to produce the document
5. **Spec revision** — when the user asks for changes after a spec is written, the AI revises and outputs an updated spec
6. **Remove** all task plan parsing, work package creation, verification check generation

### 4.3 Conversation Patterns the AI Should Follow

**Pattern 1: Depth over breadth**
Don't ask 5 surface-level questions. Ask 1 deep question, use the answer to ask a more specific follow-up. "What type of data table?" → "You mentioned sorting — should it be client-side or server-side? Client-side is simpler but won't scale past ~1000 rows."

**Pattern 2: Show understanding, then probe**
After 2-3 exchanges, summarize: "So far I understand you need X, Y, Z. What I'm not clear on is..." This builds user confidence and catches misunderstandings early.

**Pattern 3: Offer concrete options, not open-ended questions**
Bad: "What kind of authentication do you want?"
Good: "For authentication, the two main approaches with your Supabase stack are: (1) Supabase Auth with magic link + OAuth, or (2) custom JWT auth. Supabase Auth is faster to implement. Which fits better?"

**Pattern 4: Reference what the user showed you**
If the user pastes a screenshot: "In your mockup, I see a sidebar with 5 items, a data table with sortable columns, and a filter bar at the top. Should the filter bar support date ranges, or just text search?"

---

## 5. AI System Prompt Design (CRITICAL)

This is where the value lives. The prompt must produce specs that Claude Code can directly implement.

### 5.1 New Application Mode Prompt

```
You are a senior technical architect and requirements analyst working 
inside CodeMantis, a desktop development tool. Your job is to have a 
thorough conversation with the user and then write a complete, 
implementation-ready requirements specification.

CONVERSATION PHASE:
- Start by acknowledging what the user described
- Ask ONE focused question at a time
- After each question, offer 2-5 selectable options:
  ?> Option A
  ?> Option B  
  ?> Option C
- Dig deep: don't accept vague answers. "A dashboard" → what data? 
  what visualizations? what user roles? what actions?
- If the user attaches images, reference specific visual elements
- If the user attaches documents, summarize what you found and confirm
- Ask about: user roles & permissions, data model, key pages/routes, 
  UI components, error handling, loading/empty states, responsive design,
  authentication, deployment target, third-party integrations
- After 3-8 exchanges, summarize your understanding and say:
  "I have enough to write the specification. Ready when you are."
- Wait for confirmation before writing

WRITING PHASE:
When the user confirms, write a COMPLETE specification document in 
Markdown. The document MUST follow this structure:

# {Feature/Application Name} — Requirements Specification

## 1. Overview
Brief description, goals, target user.

## 2. Tech Stack & Architecture
Framework, libraries, database, deployment. 
Reference the recommended CodeMantis template if applicable.

## 3. Data Model
Every entity with fields, types, relationships, and constraints.
Use code blocks for schema definitions.

## 4. Pages & Routes  
Every page/route with: URL path, purpose, components on the page,
user interactions, data fetched/displayed.

## 5. Components
Key reusable components with: props, behavior, states (loading, 
empty, error), and where they're used.

## 6. Authentication & Authorization
Auth method, user roles, route protection rules, session handling.

## 7. API / Data Layer
API endpoints or data fetching patterns. Include request/response 
shapes. For Supabase: RLS policies. For REST: endpoint list.

## 8. Error Handling & Edge Cases
What happens when: API fails, user has no data, invalid input, 
network offline, session expires. Every page should have error 
and empty states specified.

## 9. UI/UX Details
Layout behavior, responsive breakpoints, animations, loading 
indicators, toast notifications, form validation messages.

## 10. Implementation Notes
Order of implementation (what to build first), known complexities,
suggested file structure.

WRITING RULES:
- Be SPECIFIC. Not "a data table" but "a data table with columns: 
  Name (sortable), Status (filterable dropdown: active/inactive/all), 
  Created (date, sortable), Actions (edit/delete buttons)"
- Include EVERY state: loading skeleton, empty state message, error 
  state with retry button, success toast
- Include EVERY validation: email format, password min 8 chars, 
  required fields, character limits
- Write for Claude Code to implement — use actual file paths, 
  component names, and import patterns
- Reference the template's conventions if one is recommended

AFTER WRITING:
- After outputting the spec, ask: "Would you like me to adjust 
  anything, or shall we save this?"
- If the user requests changes, output the COMPLETE revised spec 
  (not just the changed section)

AVAILABLE TEMPLATES:
{TEMPLATE_CATALOG}
```

### 5.2 Feature Mode Prompt (for Existing Projects)

```
You are a senior technical architect working inside CodeMantis. You 
are helping the user write a requirements specification for a new 
feature in their EXISTING project.

PROJECT CONTEXT (gathered automatically):
{PROJECT_CONTEXT}

IMPORTANT: This is an existing codebase. Your specification MUST:
- Reference existing files by their actual paths
- Follow the patterns already established in the codebase
- Reuse existing components, hooks, and utilities where possible
- Extend (not replace) existing data models
- Match the existing code style and conventions
- Account for existing authentication, routing, and state management

CONVERSATION PHASE:
- Start by confirming what you see in the project: "I've reviewed your 
  project. It's a {framework} app with {N} routes, using {key deps}. 
  Your main layout is at {path}. What would you like to add?"
- Ask questions that account for existing architecture
- When suggesting approaches, reference what's already built:
  "You already have a DataTable component in src/components/ui/ — 
  should the new report page reuse it?"
- Ask about integration points: where in the existing nav, which 
  existing pages are affected, any data model extensions needed

WRITING PHASE:
Write a feature specification following this structure:

# {Feature Name} — Feature Specification

## 1. Overview
What this feature adds, why, and how it fits into the existing app.

## 2. Affected Files
List of existing files that need modification, with a summary of 
what changes in each. Plus new files to create.

## 3. Data Model Changes
New tables/models AND modifications to existing ones. Show the 
complete model definition including existing fields that don't change 
(for context).

## 4. New Routes & Pages
New pages with: path, components, data requirements. Reference 
existing layout/navigation structure.

## 5. New & Modified Components
New components to create. Existing components to modify (specify 
what changes). Reuse existing components where possible.

## 6. API / Data Layer Changes
New endpoints or queries. Changes to existing ones. New RLS 
policies or middleware.

## 7. Integration Points
How this feature connects to existing features. Shared state, 
navigation changes, permission changes.

## 8. Error Handling & Edge Cases
Feature-specific error states. How errors surface in existing UI 
patterns (reuse existing toast system, error boundaries, etc.)

## 9. Implementation Order
Step-by-step order: what to build first, what depends on what.
Reference existing patterns: "Follow the same pattern as 
src/app/users/page.tsx for the new page."

WRITING RULES:
- Use ACTUAL file paths from the project (you have the file tree)
- Reference ACTUAL existing components and hooks by name
- Match the project's naming conventions exactly
- If the project uses a specific pattern (e.g., server actions, 
  API routes, tRPC), follow that same pattern
- Don't suggest adding dependencies that overlap with existing ones
{FEATURE_MODE_SUFFIX}
```

### 5.3 Context String Generation

The `{PROJECT_CONTEXT}` placeholder is filled by the Rust backend using the existing `gather_project_snapshot` command, reformatted into a readable summary:

```
Project: /Users/hr/projects/my-dashboard
Framework: Next.js (detected from next.config.ts)
Package Manager: pnpm (detected from pnpm-lock.yaml)

Dependencies: react, next, @supabase/supabase-js, prisma, @prisma/client, 
tailwindcss, @radix-ui/react-dialog, zustand, lucide-react, ...

Routes (15):
  src/app/page.tsx (/)
  src/app/login/page.tsx (/login)
  src/app/dashboard/page.tsx (/dashboard)
  src/app/dashboard/users/page.tsx (/dashboard/users)
  ...

File Structure (key directories):
  src/app/          — App Router pages
  src/components/   — Shared React components
  src/hooks/        — Custom React hooks
  src/lib/          — Utilities (supabase client, helpers)
  src/types/        — TypeScript type definitions
  prisma/           — Database schema

Key File Contents:
--- src/app/layout.tsx (main layout) ---
{first 80 lines}

--- prisma/schema.prisma ---
{first 100 lines}

--- src/lib/supabase.ts ---
{full file if < 50 lines}

CLAUDE.md:
{contents if exists}

Existing Specs (in docs/specs/):
  auth-spec.md — "User Authentication with Supabase Auth"
  dashboard-spec.md — "Admin Dashboard with Data Tables"
```

---

## 6. Context Gathering for Existing Projects

### 6.1 When Context is Gathered

Context gathering triggers automatically when the SpecWriter opens and a project session is active. It uses the existing `gather_project_snapshot` command from `snapshot.rs` plus additional reads.

### 6.2 What to Gather (extends current snapshot)

The existing `gather_project_snapshot` already provides:
- File tree (top 3 levels, 50 lines)
- Package.json dependencies
- Route list (page.tsx/route.tsx files)
- Key file contents (layout, routes, entry points — first 100 lines, max 10 files)
- Git diff stats

**Additional context needed for spec writing (new Tauri command: `gather_spec_context`):**

1. **CLAUDE.md contents** — read `CLAUDE.md` from project root (if exists). This tells the AI about coding conventions, architecture, and project rules.

2. **Existing specs** — scan `docs/specs/*.md` and read the first 5 lines of each (title + overview). List them so the AI knows what's already been specified.

3. **Framework detection** — check for indicator files:
   - `next.config.ts` / `next.config.js` → Next.js
   - `vite.config.ts` → Vite
   - `astro.config.mjs` → Astro
   - `nuxt.config.ts` → Nuxt
   - `svelte.config.js` → SvelteKit
   - `Cargo.toml` → Rust
   - `pyproject.toml` / `requirements.txt` → Python

4. **Database schema** — read:
   - `prisma/schema.prisma` (first 150 lines)
   - `drizzle/schema.ts` or `src/db/schema.ts`
   - `supabase/migrations/` (list migration files)
   - `src/types/*.ts` (first 50 lines of each, max 5 files — these contain data model types)

5. **Component inventory** — list files in `src/components/` (2 levels deep). This tells the AI what reusable components already exist.

6. **Existing hooks** — list files in `src/hooks/` or `src/lib/hooks/`.

### 6.3 Token Budget

All gathered context MUST fit within 6000 tokens (roughly 24,000 characters). Truncation rules:
- CLAUDE.md: first 100 lines
- Database schema: first 150 lines
- Each key file: first 80 lines
- Component/hook inventories: file names only (no contents)
- Existing spec summaries: title + first 2 lines only

### 6.4 Implementation

New Tauri command in `snapshot.rs` (or a new `spec_context.rs`):

```rust
#[tauri::command]
pub async fn gather_spec_context(
    project_path: String,
) -> Result<String, String>
```

Returns a formatted text string (NOT JSON — the AI reads it directly as part of its context).

---

## 7. Spec Document Format & Output

### 7.1 Detection: When is the AI Writing a Spec?

The AI's response during the writing phase starts with a Markdown heading: `# {Name} — Requirements Specification` or `# {Name} — Feature Specification`. 

Detect this in the stream handler:
```typescript
const SPEC_START_PATTERN = /^#\s+.+(?:—|-)?\s*(?:Requirements |Feature )?Specification/m;
```

When detected, the Markdown content is ALSO rendered in the right column's spec preview pane (in addition to appearing in the chat stream).

### 7.2 Spec Content is in the Chat AND the Preview

The spec appears in TWO places simultaneously:
1. **In the chat** — as the AI's message (scrollable, in the conversation flow)
2. **In the right column** — as a clean rendered Markdown preview (better reading experience)

The right column preview is the "primary" view. The chat version is useful for context in the conversation.

### 7.3 Revision Flow

When the user asks for changes:
- User: "Add a section about email notifications"
- AI outputs the COMPLETE revised spec (not just the delta)
- The right column preview updates to show the latest version
- Previous versions are still visible in the chat history

---

## 8. Saving Specs to the Project Folder

### 8.1 Save Location

Specs are saved to: `{project_path}/docs/specs/{slug}.md`

- The `docs/specs/` directory is created automatically if it doesn't exist
- The slug is derived from the spec title: "User Authentication" → `user-authentication.md`
- If a file with the same name exists: prompt the user — "Overwrite existing spec?" or "Save as user-authentication-v2.md?"

### 8.2 Save Command (Rust)

New Tauri command:

```rust
#[tauri::command]
pub async fn save_spec_document(
    project_path: String,
    filename: String,       // e.g., "user-authentication.md"
    content: String,        // raw Markdown
    overwrite: bool,
) -> Result<String, String>  // returns the full saved path
```

Implementation:
1. Ensure `{project_path}/docs/specs/` exists (create recursively)
2. If `!overwrite` and file exists → return error "File already exists"
3. Write the Markdown content to the file
4. Add `docs/specs/` to `.gitignore` comments (NOT to ignore list — specs SHOULD be committed)
5. Return the full path

### 8.3 Auto-Generated Header

Prepend a metadata header to every saved spec:

```markdown
<!-- 
  Generated by CodeMantis SpecWriter
  Date: 2026-03-19
  AI Model: gemini-2.5-flash
  Mode: Feature (existing project)
  Project: /Users/hr/projects/my-dashboard
-->

# User Authentication — Feature Specification
...
```

This header is invisible in rendered Markdown but helps Claude Code understand the spec's provenance.

### 8.4 CLAUDE.md Integration

After saving a spec, suggest adding a reference to the project's CLAUDE.md:

```
Spec saved to docs/specs/user-authentication.md

💡 Tip: Add this to your CLAUDE.md so Claude Code reads it automatically:
   ## Specifications
   - Read docs/specs/user-authentication.md for auth requirements
```

Show this as a toast or inline message with a "Copy" button for the CLAUDE.md snippet.

---

## 9. Spec Document Management (Right Column)

### 9.1 Saved Specs List

The bottom of the right column shows specs from `docs/specs/*.md`:

**Tauri command:** `list_spec_documents(project_path: String) -> Vec<SpecDocumentInfo>`

```rust
pub struct SpecDocumentInfo {
    pub filename: String,
    pub title: String,        // extracted from first # heading
    pub modified_at: String,  // file modification time
    pub size_bytes: u64,
    pub path: String,         // full path
}
```

### 9.2 Interactions

- **Click a spec** → loads the Markdown into the preview pane (read-only view)
- **"Load into conversation"** → injects the spec content as context so the AI can revise it
- **"Open in File Viewer"** → opens the spec in the main app's right panel file viewer (Monaco)
- **Delete** → confirm dialog → removes the file
- **Rename** → inline edit of filename

### 9.3 Empty State

When no specs exist:
```
No specifications yet.

Start a conversation on the left to create your first
requirements specification. The AI will help you think
through your project systematically.

📝 Describe a new application
🔧 Add a feature to this project
💡 Ask the AI to suggest improvements
```

---

## 10. Data Models

### 10.1 Types to KEEP (from existing task-board.ts, simplified)

```typescript
// src/types/spec-writer.ts (rename from task-board.ts)

export interface SpecConversation {
  id: string;
  project_path: string;
  messages: SpecMessage[];
  ai_provider: string;
  ai_model: string;
  status: 'gathering' | 'ready_to_write' | 'writing' | 'done';
  mode: 'new_application' | 'feature';
  context_loaded: boolean;
  template_catalog?: string;
}

export interface SpecMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: SpecAttachment[];
  message_type: 'conversation' | 'spec_document' | 'context_summary';
  timestamp: string;
  parsedOptions?: string[];  // selectable options from ?> markers
}

export interface SpecAttachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  size: number;
  mime_type: string;
  preview_url?: string;      // base64 data URI for images
  text_content?: string;     // extracted text for documents
  file_path: string;
}

export interface SpecDocumentInfo {
  filename: string;
  title: string;
  modified_at: string;
  size_bytes: number;
  path: string;
}

export interface SpecWriterUIState {
  is_open: boolean;
  chat_width: number;        // percentage, default 40
  current_spec_content: string | null;  // Markdown being previewed
  selected_saved_spec: string | null;   // filename of spec being viewed
}
```

### 10.2 Types to REMOVE

Delete entirely or remove from imports:
- `TaskPlan`, `WorkPackage`, `TaskItem`
- `VerificationCheck`, `CheckResult`
- `ProgressReview`, `ProjectSnapshot` (keep the Rust struct, remove TS type)
- `ProjectTargetDecision`
- All execution-related types

---

## 11. File Changes

### 11.1 Files to MODIFY

| File | Changes |
|------|---------|
| `src/stores/taskBoardStore.ts` | Rename to `specWriterStore.ts`. Strip all plan/task/execution/verification state. Keep conversation and UI state. Add `currentSpecContent`, `savedSpecs`, `loadSavedSpecs()`, `setCurrentSpec()`. |
| `src/hooks/usePlanningConversation.ts` | Rename to `useSpecConversation.ts`. Rewrite system prompt (Section 5). Replace plan JSON detection with spec Markdown detection. Remove task plan parsing. Add `writeSpec()` and spec revision handling. Add project context injection for Feature Mode. |
| `src/components/taskboard/TaskBoardSlideOver.tsx` | Rename to `SpecWriterSlideOver.tsx`. Replace right column: remove WorkPackageList, add SpecPreview + SavedSpecsList. Update toolbar. |
| `src/components/taskboard/PlanningChat.tsx` | Rename to `SpecChat.tsx`. Minor: update store imports, add "Write Spec" button instead of "Generate Plan". |
| `src/components/taskboard/PlanningChatInput.tsx` | Rename to `SpecChatInput.tsx`. Keep as-is functionally. |
| `src/components/taskboard/PlanningChatMessage.tsx` | Rename to `SpecChatMessage.tsx`. Keep as-is. |
| `src/components/taskboard/TaskBoardBadge.tsx` | Rename to `SpecWriterBadge.tsx`. Show conversation status instead of execution progress. |
| `src/types/task-board.ts` | Rename to `spec-writer.ts`. Replace types per Section 10. |
| `src-tauri/src/commands/snapshot.rs` | Add `gather_spec_context` command (Section 6). Keep `gather_project_snapshot` for now (other features may use it). |
| `src-tauri/src/commands/taskboard.rs` | Rename to `specwriter.rs`. Remove execution/verification commands. Add `save_spec_document`, `list_spec_documents`, `read_spec_document`, `delete_spec_document`. |
| `src-tauri/src/commands/mod.rs` | Update module declaration and re-exports. |
| `src-tauri/src/lib.rs` | Update command registrations. |
| Layout files (TitleBar, keyboard shortcuts) | Update icon/label from 📋 to 📝, update shortcut label. |

### 11.2 Files to REMOVE

| File | Reason |
|------|--------|
| `src/components/taskboard/WorkPackageList.tsx` | Execution UI |
| `src/components/taskboard/WorkPackageCard.tsx` | Execution UI |
| `src/components/taskboard/TaskCard.tsx` | Execution UI |
| `src/components/taskboard/VerificationResults.tsx` | Verification UI |
| `src/components/taskboard/TaskBoardToolbar.tsx` | Execution controls |
| `src/components/taskboard/ProgressUpdateMessage.tsx` | Execution feedback |
| `src/components/taskboard/ProjectTargetDecision.tsx` | Execution routing |
| `src/components/taskboard/PlanPicker.tsx` | Plan management |
| `src/components/taskboard/UserActionBanner.tsx` | Execution feedback |
| `src/hooks/useTaskExecution.ts` | Execution engine |
| All corresponding `.test.tsx` / `.test.ts` files | Tests for removed code |

### 11.3 Files to ADD

| File | Purpose |
|------|---------|
| `src/components/specwriter/SpecPreview.tsx` | Rendered Markdown preview of current spec |
| `src/components/specwriter/SavedSpecsList.tsx` | List of docs/specs/*.md files with actions |
| `src/components/specwriter/SpecToolbar.tsx` | Bottom bar: New Spec, Write Spec, Suggest Features |
| `src/components/specwriter/SaveSpecDialog.tsx` | Filename input, overwrite confirmation |
| `src-tauri/src/commands/specwriter.rs` | save/list/read/delete spec document commands |

### 11.4 Directory Rename

Rename `src/components/taskboard/` → `src/components/specwriter/`

---

## 12. Implementation Order

```
STEP 1: Rename & strip (cleanup pass)
────────────────────────────────────
1a. Rename directory: taskboard/ → specwriter/
1b. Rename files per Section 11.1 (store, hook, components, types)
1c. DELETE all files from Section 11.2
1d. Update all imports across the codebase
1e. Verify: app compiles (pnpm tsc --noEmit), tests pass where applicable
    *** DO NOT PROCEED until the app compiles cleanly ***

STEP 2: New right column
────────────────────────
2a. Create SpecPreview.tsx — renders Markdown with react-markdown
    (reuse existing markdown rendering from chat MessageBubble)
2b. Create SavedSpecsList.tsx — reads docs/specs/ via new Tauri command
2c. Create SpecToolbar.tsx — New Spec, Write Spec, Suggest Features buttons
2d. Wire into SpecWriterSlideOver replacing the old right column
2e. Verify: slide-over opens with chat on left, empty spec preview on right

STEP 3: Spec saving infrastructure
───────────────────────────────────
3a. Add Rust commands: save_spec_document, list_spec_documents,
    read_spec_document, delete_spec_document in specwriter.rs
3b. Register commands in lib.rs
3c. Wire "Save to Project" button → save dialog → Rust command
3d. Wire SavedSpecsList to list_spec_documents
3e. Verify: can save a hardcoded markdown string to docs/specs/test.md
    and it appears in the saved list

STEP 4: Rewrite AI system prompt
────────────────────────────────
4a. Replace system prompt in useSpecConversation with Section 5.1 
    (New Application Mode)
4b. Update spec detection: look for Markdown heading pattern instead 
    of JSON task plan
4c. When spec detected: populate SpecPreview with the content
4d. Verify: start conversation → answer questions → AI writes spec →
    spec appears in preview → save works

STEP 5: Feature Mode + context gathering
────────────────────────────────────────
5a. Add gather_spec_context command to Rust (Section 6)
5b. On slide-over open: detect if project session is active
5c. If yes: call gather_spec_context, inject into AI conversation
5d. Switch system prompt to Feature Mode (Section 5.2)
5e. AI's first message references actual project structure
5f. Verify: open SpecWriter in an existing project → AI knows the 
    framework, routes, dependencies, and references real file paths

STEP 6: Polish
──────────────
6a. Spec revision flow: user asks for changes → AI outputs revised spec → 
    preview updates
6b. "Load into conversation" for existing saved specs
6c. CLAUDE.md integration suggestion after saving
6d. "Suggest Features" button (AI analyzes project, suggests improvements)
6e. Empty states, loading indicators, error handling
6f. Keyboard shortcut update: ⌘⇧B → opens SpecWriter
```

---

## 13. Known Risks

| Risk | Mitigation |
|------|------------|
| AI writes shallow specs despite the detailed prompt | Prompt engineering is iterative. Start with the prompt in Section 5, test extensively, refine based on output quality. The conversation depth matters more than the writing prompt. |
| Context gathering exceeds token budget | Strict truncation limits (Section 6.3). Log warnings when approaching limit. Prioritize CLAUDE.md and schema over file contents. |
| Spec documents get out of sync with the codebase | Specs are reference documents, not live contracts. Add "Last updated" date in header. The AI can re-read saved specs and flag stale sections. |
| User expects the AI to implement, not just spec | Clear UI labeling: "Write Specification." The slide-over is called "SpecWriter" not "Builder." Include a tip after saving: "Open a Claude Code session and say: Read docs/specs/X.md and implement it." |
| Large projects generate huge context strings | The 6000-token budget is strict. For very large projects, prioritize: CLAUDE.md first, then schema, then routes, then file tree. Skip file contents entirely if budget is tight. |
| Renaming the taskboard directory breaks git history | Use `git mv` for all renames. Do the rename as a single atomic commit before any content changes. |
| Existing taskboard database tables need migration | The conversation data structure is compatible. Rename the table from `task_board_state` to `spec_writer_state` in a migration. Plan data can be dropped. |
