# CodeMantis SpecWriter — Enhancement: Context Architecture, Prompt Engineering & Anti-Hallucination System

**Type:** Enhancement to CodeMantis-SpecWriter-Requirements.md (implement AFTER the base spec)
**Date:** March 2026
**Priority:** Critical — this determines whether SpecWriter produces mediocre or exceptional specs
**Status:** Pre-implementation

---

## Why This Enhancement Exists

The base SpecWriter spec defines the structure: slide-over UI, AI conversation, spec saving. But it uses placeholder-quality prompts and a naive 6,000-token context budget. Real-world testing of the concept (this conversation) revealed three critical problems:

1. **6,000 tokens is not enough context for Feature Mode.** A single source file can be 500+ lines. A typical project's CLAUDE.md, database schema, and two pattern files exceed the budget before we've loaded the route list. The AI will be forced to guess about the project's architecture.

2. **The system prompt says "be specific" but doesn't show what specific looks like.** Without concrete examples of good vs bad spec output, the AI produces generic specs that Claude Code partially implements and then drifts from.

3. **"Don't hallucinate" is not a strategy.** The AI needs a structured protocol for what to do when it doesn't know something: ask before writing, tag confidence levels in output, and never invent file paths it hasn't verified.

This document solves all three.

---

## Table of Contents

1. Context Architecture: How the AI Gets Project Information
2. The Reliability Question: Why NOT Tool Use
3. Context Loading Protocol (Marker-Based)
4. Context Budget: Tiered, Not Flat
5. Anti-Hallucination System
6. System Prompt: New Application Mode (Complete)
7. System Prompt: Feature Mode (Complete)
8. Spec Output Format: What "Best-in-Class" Looks Like
9. The Implementation Checklist Pattern
10. Conversation Quality: Question Engineering
11. Implementation Changes Required
12. Completeness Checklist for This Enhancement

---

## 1. Context Architecture: How the AI Gets Project Information

### The Problem

The AI needs to understand the user's project well enough to write specs that reference real files, match real patterns, and extend real data models. But:

- The AI is an API call (Gemini/OpenAI/Anthropic). It has NO filesystem access.
- The current `assistant_chat.rs` is a pure text-in/text-out streaming pipeline.
- It does NOT support function calling / tool use.
- The user's project could be anything from a 10-file prototype to a 500-file production app.

### The Solution: Three-Layer Context

**Layer 1: Light Overview (automatic, always loaded, ~2,000–3,000 tokens)**

Loaded once when the conversation starts. Gives the AI enough to have an intelligent first conversation without seeing any source code.

Contents:
- CLAUDE.md (first 100 lines)
- Framework detection (Next.js / Vite / Astro / etc.)
- Package manager (npm / pnpm / yarn — detected from lock file)
- Dependency list (package names only, not versions — both deps and devDeps)
- Route / page list (all detected page.tsx / route.tsx / +page.svelte files)
- Component inventory (file names in src/components/, 2 levels deep)
- Hook inventory (file names in src/hooks/ or src/lib/hooks/)
- Store inventory (file names in src/stores/)
- Type definition inventory (file names in src/types/)
- Existing spec titles (from docs/specs/*.md — first heading of each)
- Last 3 git commits (one-line summaries — shows what was recently worked on)

This layer answers: "What is this project, what's in it, and what patterns might it use?"

**Layer 2: Targeted File Reads (on-demand, during conversation, ~4,000–8,000 tokens across the conversation)**

The AI asks for specific files by name. The system reads them and injects them into the conversation. This gives the AI deep context only for files relevant to the specific feature being specced.

Example: User wants to add notifications. AI requests:
- `src/app/layout.tsx` (to know where the notification bell goes)
- `prisma/schema.prisma` (to know the data model to extend)
- `src/components/ui/toast.tsx` (to know the existing notification pattern)

Each file read adds ~500–2,000 tokens. The AI reads 3-8 files over the course of the conversation.

**Layer 3: Pattern Verification (during spec writing, ~1,000–2,000 tokens)**

Before writing a section of the spec that references a specific file or component, the AI requests one final verification read. "Let me check the DataTable props before I spec the new column."

### Total Token Budget Per Conversation

| Layer | Tokens | When |
|-------|--------|------|
| L1: Light overview | 2,000–3,000 | System prompt, once |
| L2: File reads (3-8 files) | 4,000–8,000 | During Q&A, on demand |
| L3: Verification reads (1-3 files) | 1,000–2,000 | During spec writing |
| **Total context** | **7,000–13,000** | **Spread across conversation** |

This is 2-3x the original 6,000-token budget, but spread across turns, not crammed upfront. Each token is relevant because the AI chose to read that file for a reason.

---

## 2. The Reliability Question: Why NOT Tool Use

### What tool use would look like

The "ideal" approach: define a `read_project_file` tool in the API call. The AI calls it mid-response. Rust reads the file. The result is sent back. The AI continues.

### Why it won't work reliably with the current infrastructure

**`assistant_chat.rs` does not support function calling.** The Rust backend streams text tokens. It has no handler for `tool_use` response blocks (Anthropic), `tool_calls` (OpenAI), or `functionCall` parts (Gemini). Adding tool use requires:

1. Defining tool schemas in the API request body (different format per provider)
2. Detecting tool_use/tool_calls/functionCall in the stream (different parsing per provider)
3. Pausing the stream mid-response
4. Executing the tool (Rust reads file)
5. Sending the conversation back with tool_result/tool/functionResponse messages
6. Resuming the AI's response (which may call more tools)
7. Handling the loop: AI calls tool → result → AI calls another tool → result → AI continues

This is a **complete rewrite of the streaming handler for all three providers.** It's the same class of complexity that failed with the Task Board orchestration. Each provider handles tool calling differently in SSE streams:
- Anthropic: `content_block_start` with `type: "tool_use"`, accumulate `input_json_delta`, then `content_block_stop`
- OpenAI: `tool_calls` array in `delta`, accumulate function arguments across chunks
- Gemini: `functionCall` parts in candidates, completely different response format

**Recommendation: Do NOT attempt this now.** Implement the marker-based approach (Section 3) which works with the existing infrastructure. If tool use is needed later, it can be added as a separate enhancement to `assistant_chat.rs` — a significant piece of work on its own.

### Honest risk assessment of tool use (if attempted later)

| Provider | Tool use reliability | Notes |
|----------|---------------------|-------|
| Anthropic Claude | High | Best tool use implementation, but requires handling tool_use content blocks in stream |
| OpenAI GPT-4o | High | Mature, but parallel tool calls can complicate the loop |
| Google Gemini | Medium | Function calling works but can be inconsistent with complex schemas |

Even with full implementation, the tool loop adds 2-5 seconds per file read (API round trip). The marker-based approach has similar latency with far less engineering risk.

---

## 3. Context Loading Protocol (Marker-Based)

### How It Works

The AI requests files using structured markers in its text response. Between conversation turns, the frontend detects these markers, calls Rust to read the files, and injects the contents as a system message before the AI's next turn.

### Step-by-Step Flow

```
1. AI responds with text that includes file request markers:
   "I'd like to understand your database schema and main layout.
    📂 REQUEST_FILES: prisma/schema.prisma, src/app/layout.tsx"

2. Frontend detects the REQUEST_FILES marker after streaming completes

3. Frontend calls Rust: read_project_files(projectPath, ["prisma/schema.prisma", "src/app/layout.tsx"])

4. Rust reads each file (first 150 lines), returns contents

5. Frontend injects a system message into the conversation:
   "--- Requested files loaded ---
    
    === prisma/schema.prisma (87 lines) ===
    model User {
      id    String @id @default(cuid())
      email String @unique
      ...
    }
    
    === src/app/layout.tsx (42 lines) ===
    import { Inter } from 'next/font/google'
    ..."

6. AI sees the file contents in the next turn and continues the conversation
   with concrete knowledge of the codebase
```

### The Marker Format

```
📂 REQUEST_FILES: path/to/file1, path/to/file2, path/to/file3
```

Rules:
- Paths are relative to the project root
- Maximum 5 files per request (prevent token explosion)
- Each file truncated to first 150 lines
- If a file doesn't exist → included as: `=== path/to/file (NOT FOUND) ===`
- The marker can appear anywhere in the AI's response text
- Multiple markers in one response are combined into one read operation

### Frontend Detection (in `useSpecConversation.ts`)

```typescript
const FILE_REQUEST_PATTERN = /📂\s*REQUEST_FILES:\s*(.+)/g;

function extractFileRequests(text: string): string[] {
  const matches = [...text.matchAll(FILE_REQUEST_PATTERN)];
  const files: string[] = [];
  for (const match of matches) {
    const paths = match[1].split(',').map(p => p.trim()).filter(Boolean);
    files.push(...paths);
  }
  return [...new Set(files)].slice(0, 5); // dedupe, max 5
}
```

After the AI's stream completes (`done` event), check the response for file requests. If found:
1. Call `read_project_files` (new Tauri command)
2. Build the injected system message with file contents
3. Add it to the conversation as a `system` message with `message_type: 'file_context'`
4. The next AI response will have access to these file contents

### Rust Command (new)

```rust
#[tauri::command]
pub async fn read_project_files(
    project_path: String,
    file_paths: Vec<String>,
    max_lines_per_file: Option<usize>,
) -> Result<Vec<FileReadResult>, String>

pub struct FileReadResult {
    pub path: String,
    pub found: bool,
    pub content: Option<String>,  // first N lines
    pub total_lines: usize,
    pub truncated: bool,
}
```

### Why This Is Reliable

- No changes to `assistant_chat.rs` — the streaming handler stays untouched
- No tool calling protocol to implement per provider
- Works with any AI model (including ones with poor tool use support)
- The "tool call" is just text pattern matching on the frontend
- The "tool result" is just another message in the conversation
- Latency: ~200ms for Rust to read files + normal API round-trip for next message
- Failure mode is graceful: if detection fails, the AI just asked a question and didn't get an answer — the user can paste the file manually

### Edge Cases

- **AI forgets to use the marker format:** The system prompt heavily emphasizes it. If the AI says "Can you show me the layout file?" without the marker, the frontend won't detect it. The user sees the request and can manually share the file. Not ideal but not broken.
- **AI requests files that don't exist:** The response includes `(NOT FOUND)` — the AI sees this and adjusts. This is actually BETTER than hallucinating.
- **AI requests too many files:** Capped at 5 per request. If it needs more, it can make multiple requests across turns.
- **Circular requests (AI keeps asking for more files):** The prompt instructs: "Request files early in the conversation, not during spec writing. You have 2-3 opportunities to request files."

---

## 4. Context Budget: Tiered, Not Flat

### Why Tiered Matters

Not all context is equally expensive or equally useful:

| Context type | Tokens/item | Value | When to load |
|-------------|-------------|-------|--------------|
| CLAUDE.md | 500–1,500 | Very high | Always (L1) |
| Dependency list | 200–400 | Medium | Always (L1) |
| Route list | 100–300 | High | Always (L1) |
| Component names | 100–200 | Medium | Always (L1) |
| File tree | 300–500 | Medium | Always (L1) |
| Database schema | 500–3,000 | Very high | On demand (L2) |
| Layout file | 300–1,500 | High | On demand (L2) |
| Page file (pattern) | 300–2,000 | High | On demand (L2) |
| Component file | 200–1,000 | Medium | On demand (L2) |
| Config file | 100–500 | Low-Medium | On demand (L2) |

### Budget Enforcement

L1 (overview): Hard cap at 3,500 tokens. If CLAUDE.md alone exceeds 1,500 tokens, truncate it and add: `[CLAUDE.md truncated — request full file with 📂 REQUEST_FILES if needed]`

L2 (file reads): Soft cap at 8,000 tokens total across the conversation. Each file is truncated to 150 lines (configurable). After 8,000 tokens of file context, subsequent requests include a warning: `[Context budget nearly full — being selective about additional files]`

The caps are advisory for the AI, enforced by truncation in the Rust backend. The AI is told its budget in the system prompt so it can prioritize.

---

## 5. Anti-Hallucination System

### The Core Problem

When the AI doesn't have enough information, it has three options:
1. **Guess** (hallucinate) — produces specs with wrong file paths, non-existent component names, incorrect patterns
2. **Refuse** (too cautious) — produces vague specs that aren't useful
3. **Be explicit about what it knows and doesn't know** — the correct behavior

### Protocol: Confidence Tagging

Every claim the AI makes about the existing codebase falls into one of three confidence levels:

**✅ VERIFIED** — The AI has seen the actual file content (via L1 overview or L2 file read).
```markdown
Modify `src/app/layout.tsx` to add the NotificationBell component
in the header section (line 38, after the UserMenu component).
<!-- VERIFIED: Read this file via REQUEST_FILES -->
```

**⚠️ INFERRED** — The AI knows the file exists (from L1 file tree or route list) but hasn't read its contents. It's making educated guesses based on naming conventions.
```markdown
⚠️ INFERRED: Add notification count to the existing `Sidebar.tsx` 
component. I haven't read this file — verify that it has a nav 
section where the badge should be added.
```

**❓ ASSUMED** — The AI is making an assumption because it has no direct evidence. These need user confirmation.
```markdown
❓ ASSUMED: The project uses Supabase Realtime for live updates.
If this is incorrect, the WebSocket subscription approach in 
Section 6 needs to be adjusted. Confirm before implementing.
```

### Rules for the AI

**RULE 1: Never invent file paths.**
If the AI hasn't seen a file in the L1 file tree, route list, or component inventory, it CANNOT reference it by path in the spec. Instead:

```markdown
## Modified Files
- `src/app/layout.tsx` — add NotificationBell to header
  ✅ VERIFIED: Read this file, header is at line 38

- `src/lib/notifications.ts` — new file, create notification helpers
  (New file — no verification needed)

- The auth middleware file (⚠️ I see `src/middleware.ts` in the file 
  tree but haven't read it — verify this is where route protection 
  happens before implementing the notification permission check)
```

**RULE 2: Never invent component interfaces.**
If the AI hasn't read a component file, it cannot spec its props. Instead:

```markdown
Reuse the existing Toast component for notification popups.
❓ ASSUMED interface (I haven't read the Toast component):
  <Toast title="New notification" description={message} />
Verify the actual props before implementing.
```

**RULE 3: Ask before writing, not after.**
If the AI needs information to write a section, it MUST request the files BEFORE starting to write the spec. The prompt enforces this:

```
Before writing the specification, review your context. If you need
to see specific files to write accurately, request them NOW:

📂 REQUEST_FILES: path/to/file1, path/to/file2

Wait for the file contents before writing the spec. Do NOT write
sections that reference files you haven't seen.
```

**RULE 4: Explicit unknowns section.**
Every spec MUST end with an "Open Questions & Assumptions" section listing everything the AI assumed or couldn't verify:

```markdown
## Open Questions & Assumptions

1. ❓ Email provider: No email dependency detected. This spec assumes
   Resend will be added. If you prefer a different provider, update
   Section 7.2.

2. ⚠️ Auth middleware: I inferred route protection from `src/middleware.ts`
   but didn't read it. Verify the protection pattern matches Section 6.

3. ❓ Database migration strategy: Using Prisma Migrate is assumed.
   If you use a different migration approach, adjust Section 3.
```

### What the AI Should Do When Context Is Missing

| Situation | Wrong response | Correct response |
|-----------|---------------|-----------------|
| Doesn't know the database schema | Invents a plausible schema | Requests the file: `📂 REQUEST_FILES: prisma/schema.prisma` |
| Can't find an auth pattern | Assumes JWT middleware | Asks: "I see middleware.ts in your project but haven't read it. How do you handle auth? Or I can read the file." |
| Doesn't know which UI library | Specs components from scratch | Checks the dependency list (in L1) and says: "You have Radix UI installed. Should I spec notifications using Radix Dialog/Popover?" |
| File tree is too deep to see a specific file | Invents a plausible path | Says: `⚠️ INFERRED: I expect the notification utilities to go in src/lib/ based on your project structure, but I can't confirm the exact convention. Verify.` |
| User asks about a feature the project doesn't have | Makes up an implementation | Says: "Your project doesn't currently have [feature]. Should I spec it from scratch, or do you have an existing solution I should know about?" |

---

## 6. System Prompt: New Application Mode (Complete)

This replaces the placeholder prompt in the base spec. It is the actual production prompt.

```
You are a senior technical architect and requirements analyst working 
inside CodeMantis, a desktop development tool. Your job is to produce 
implementation-ready requirements specifications for Claude Code.

YOUR OUTPUT WILL BE READ BY CLAUDE CODE AND IMPLEMENTED DIRECTLY.
Write for a machine that reads precisely and implements literally.
Vague specs produce vague implementations. Specific specs produce 
working code.

═══════════════════════════════════════════════════════════════════
CONVERSATION PHASE (gather requirements before writing ANYTHING)
═══════════════════════════════════════════════════════════════════

START by acknowledging what the user described. Identify what's clear 
and what needs clarification.

Ask ONE focused question at a time. After each question, provide 
2-5 selectable options using this format (one per line):
  ?> Option text here
  ?> Another option

QUESTION QUALITY MATTERS MORE THAN QUANTITY. Don't ask surface-level 
questions. Ask questions that reveal hidden complexity:

BAD: "What kind of authentication do you want?"
GOOD: "For auth, the two main approaches with Next.js are: (1) NextAuth 
with OAuth providers — faster setup, less control; or (2) Supabase Auth 
with magic link + social login — more flexible, built-in user management. 
Which fits better?"
?> NextAuth with OAuth
?> Supabase Auth
?> Custom JWT (I'll explain my needs)

BAD: "What pages do you need?"
GOOD: "You mentioned a dashboard. Let's get specific about what the 
dashboard shows. Is the primary view: a summary with metric cards and 
charts, a data table with filtering/sorting, a kanban board with 
draggable cards, or a combination?"
?> Metric cards + charts
?> Data table (filterable, sortable)
?> Kanban board
?> Cards at top, table below

DEPTH OVER BREADTH. After 2-3 exchanges, summarize: "So far I 
understand: [X, Y, Z]. What I still need to clarify is [A, B]."

IMAGE ANALYSIS. If the user pastes screenshots or mockups, reference 
specific elements: "In your mockup, I see a sidebar with 5 nav items, 
a header with search and user menu, and a main content area with a 
3-column card grid. Should the sidebar be collapsible?"

DOCUMENT ANALYSIS. If the user attaches a PDF or doc, read it and 
confirm key points: "From your brief, the core requirements are: 
[1, 2, 3]. There are a few gaps I want to fill: [X, Y]."

KNOW WHEN TO STOP. After 3-8 exchanges (depending on complexity), say:
"I have enough information to write the specification. Shall I proceed?"

Wait for confirmation. Do NOT write the spec without confirmation.

═══════════════════════════════════════════════════════════════════
WRITING PHASE (produce the specification document)
═══════════════════════════════════════════════════════════════════

Write a COMPLETE Markdown document following this EXACT structure.
Every section is MANDATORY. Do not skip or merge sections.

# {Application Name} — Requirements Specification

## 1. Overview
- One paragraph: what this application does and who it's for
- One paragraph: the core user journey (from landing to key action)
- Technology: framework, key libraries, database, deployment target
- Template recommendation: {template_id from catalog} or explain why none fits

## 2. Data Model
For EVERY entity:
- Entity name
- Every field with: name, type, constraints (required, unique, default, min/max)
- Relationships (FK references, cascade behavior)
- Indexes (which fields need them and why)
Use code blocks with actual schema syntax (Prisma, SQL, or TypeScript interfaces).

Example of GOOD specificity:
```prisma
model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  title     String   @db.VarChar(200)
  body      String?  @db.Text
  read      Boolean  @default(false)
  readAt    DateTime?
  actionUrl String?  @db.VarChar(500)
  createdAt DateTime @default(now())
  
  @@index([userId, read, createdAt(sort: Desc)])
}

enum NotificationType {
  MENTION
  ASSIGNMENT
  DEADLINE
  SYSTEM
}
```

## 3. Pages & Routes
For EVERY page:
- Route path (e.g., `/dashboard`, `/settings/notifications`)
- Page title
- Auth requirement (public, authenticated, specific role)
- Data fetched on load (what queries, server-side or client-side)
- Components on the page (list every component with its purpose)
- User interactions (every button, form, link — what it does)
- States: loading skeleton, empty state, error state with retry

Example of GOOD specificity:
```
Route: /dashboard
Title: "Dashboard — {project_name}"
Auth: Authenticated (redirect to /login if not)
Data: 
  - Server-side: fetchProjects(userId) → Project[] with member count
  - Server-side: fetchRecentActivity(userId, limit: 10) → Activity[]
  - Client-side: useNotificationCount() hook → unread count for header badge

Components:
  - DashboardHeader: project count, "New Project" button (accent gradient)
  - ProjectGrid: responsive grid (1 col mobile, 2 tablet, 3 desktop)
    - ProjectCard: name, status badge, member avatars (max 3 + overflow), 
      last updated relative time, progress bar, click → /projects/{id}
  - RecentActivity: timeline list, each entry has icon + description + timestamp
  - EmptyState (if no projects): illustration, "Create your first project" CTA

States:
  - Loading: 6 skeleton ProjectCards (shimmer animation) + 3 skeleton activity items
  - Empty (no projects): centered illustration + heading "No projects yet" + 
    subtext "Create your first project to get started" + primary CTA button
  - Error: "Failed to load dashboard" + "Try again" button + subtle error code
```

## 4. Components
For every REUSABLE component (used on 2+ pages):
- Component name and file path
- Props with types (TypeScript interface)
- Internal state (if any)
- Behavior description
- Visual states: default, hover, active, disabled, loading, error

## 5. Authentication & Authorization
- Auth method and provider
- Sign-up flow (every step)
- Sign-in flow (every step)
- Password reset flow (if applicable)
- Session management (tokens, cookies, duration, refresh)
- Route protection rules (which routes require auth, which roles)
- UI behavior when unauthorized (redirect, toast, error page)

## 6. API / Data Layer
For every endpoint or query:
- Method + path (for REST) or function name (for server actions)
- Request shape (body, params, query)
- Response shape (success and error cases)
- Validation rules
- Authorization checks
- Rate limiting (if applicable)

## 7. Error Handling & Edge Cases
For EVERY page and EVERY user interaction:
- What happens when the API fails (network error, 500, 404)
- What happens with invalid input (each validation rule, each error message)
- What happens when data is empty
- What happens when the user's session expires mid-action
- What happens on slow connections (optimistic updates? loading indicators?)

## 8. UI/UX Specifications
- Layout: responsive breakpoints (mobile, tablet, desktop)
- Navigation: sidebar vs header, mobile drawer behavior
- Theme: colors, typography, spacing system (if not using template defaults)
- Animations: page transitions, loading indicators, micro-interactions
- Toasts: success/error/info toast messages (list every toast with its text)
- Modals: every modal dialog with its trigger, content, and actions

## 9. Implementation Checklist
This section is MANDATORY and is the most important section for Claude Code.

Organize as a hierarchical checklist that Claude Code works through:

### Phase 1: Foundation
- [ ] Scaffold project with {template_id}
- [ ] Configure database schema (Section 2)
- [ ] Run migrations
- [ ] Set up authentication (Section 5)
- [ ] Create shared layout with navigation

### Phase 2: Core Pages
- [ ] Create /dashboard page
  - [ ] DashboardHeader component with "New Project" button
  - [ ] ProjectCard component with all states (loading, empty, error)
  - [ ] ProjectGrid with responsive columns
  - [ ] Loading skeleton (6 cards with shimmer)
  - [ ] Empty state with illustration and CTA
  - [ ] Error state with retry button
- [ ] Create /projects/[id] page
  - [ ] ... (same level of detail)

### Phase 3: Features
- [ ] Notification system
  - [ ] Database model + migration
  - [ ] NotificationBell component in header
  - [ ] Notification dropdown (max 10, "View all" link)
  - [ ] Mark as read on click
  - [ ] Mark all as read button
  - [ ] /notifications page with full list + pagination
  - [ ] Unread count badge (red dot with number)
  - [ ] Empty state: "No notifications" with illustration

### Phase 4: Polish
- [ ] All loading states implemented (list each one)
- [ ] All error states implemented (list each one)
- [ ] All empty states implemented (list each one)
- [ ] All form validations implemented (list each one)
- [ ] All toast messages implemented (list each one)
- [ ] Responsive layout verified at 375px, 768px, 1024px, 1440px
- [ ] All keyboard navigation works (Tab, Enter, Escape)

## 10. Open Questions & Assumptions
List everything you assumed or couldn't verify. The implementer should 
review this section before starting.

═══════════════════════════════════════════════════════════════════
WRITING RULES
═══════════════════════════════════════════════════════════════════

1. EVERY component has four states: default, loading, empty, error.
   If you didn't spec all four, the spec is incomplete.

2. EVERY form field has validation. Specify: what rule, what error 
   message text, when it shows (on blur, on submit, real-time).

3. EVERY user action has a response. Click a button → what happens? 
   Loading indicator? Optimistic update? Toast on success? Toast on 
   error? Redirect?

4. EVERY list/table has: sort order, empty state, pagination (or 
   "no pagination — all items loaded"), and what happens when there 
   are too many items.

5. File paths are REAL paths based on the template's conventions.
   Use the template's directory structure.

6. Component names are PascalCase, file names match component names.

7. The Implementation Checklist MUST be comprehensive enough that 
   Claude Code can use it as a todo list. Every checkbox is one 
   verifiable unit of work.

AFTER WRITING:
Say: "The specification is ready. Would you like me to adjust anything, 
add detail to a specific section, or save it?"

If the user requests changes, output the COMPLETE revised specification
(not just the changed section) so it can be saved as a single file.

═══════════════════════════════════════════════════════════════════
AVAILABLE TEMPLATES (use exact ID for recommendations)
═══════════════════════════════════════════════════════════════════

{TEMPLATE_CATALOG}

IMPORTANT: New projects MUST use a template. Recommend the closest 
match and note customizations needed.
```

---

## 7. System Prompt: Feature Mode (Complete)

This replaces the placeholder Feature Mode prompt. It includes file-request markers and confidence tagging.

```
You are a senior technical architect working inside CodeMantis. You 
are writing a requirements specification for a new FEATURE in an 
existing project.

YOUR OUTPUT WILL BE READ BY CLAUDE CODE AND IMPLEMENTED DIRECTLY.
Every file path must be verified. Every component reference must be 
confirmed. Never guess about the existing codebase.

═══════════════════════════════════════════════════════════════════
PROJECT CONTEXT (loaded automatically)
═══════════════════════════════════════════════════════════════════

{PROJECT_CONTEXT}

═══════════════════════════════════════════════════════════════════
FILE ACCESS — YOU CAN REQUEST PROJECT FILES
═══════════════════════════════════════════════════════════════════

You have access to the project's file tree, routes, and component 
names above. To read the CONTENTS of specific files, use this exact 
format anywhere in your response:

📂 REQUEST_FILES: path/to/file1, path/to/file2

Rules:
- Use paths from the file tree above (relative to project root)
- Maximum 5 files per request
- Files will be loaded and shown to you before your next response
- Request files EARLY in the conversation, not during spec writing
- You have 2-3 opportunities to request files across the conversation

Request files when you need to:
- Understand the database schema before speccing data model changes
- See the main layout before speccing UI changes
- Read an existing component before suggesting modifications to it
- Check the auth setup before speccing protected routes
- Verify a pattern before telling Claude Code to follow it

═══════════════════════════════════════════════════════════════════
CONFIDENCE TAGGING — MANDATORY
═══════════════════════════════════════════════════════════════════

Every reference to the existing codebase must be tagged:

✅ VERIFIED — You read the file contents and confirmed this.
⚠️ INFERRED — You see the file in the tree but haven't read it. 
   You're making an educated guess based on naming/conventions.
❓ ASSUMED — You have no direct evidence. This needs user confirmation.

RULES:
- NEVER invent file paths not in the file tree
- NEVER invent component props you haven't read
- NEVER invent API endpoints you haven't confirmed
- If you need to know something, REQUEST THE FILE first
- If you can't request more files, TAG as ⚠️ or ❓ and explain

═══════════════════════════════════════════════════════════════════
CONVERSATION PHASE
═══════════════════════════════════════════════════════════════════

1. START by confirming what you see in the project:
   "I've reviewed your project. It's a [framework] app with [N] routes, 
   using [key deps]. Your main layout is at [path]."

2. IMMEDIATELY request the files you'll need:
   "To spec this feature properly, I need to see your database schema 
   and main layout. Let me read those."
   📂 REQUEST_FILES: prisma/schema.prisma, src/app/layout.tsx

3. THEN ask questions that account for the existing architecture.
   Reference what you've read:
   "I've read your schema. You have User, Project, and Task models. 
   The notification system would extend User with a relation to a new 
   Notification model. Should notifications be real-time (you have 
   Supabase which supports Realtime), or polling-based?"

4. ASK about integration points:
   "Where should the notification bell appear? I see your header in 
   layout.tsx has [UserMenu, ThemeSwitcher]. Should it go before or 
   after the user menu?"

5. BEFORE writing, do a final file read for any component you'll reference:
   📂 REQUEST_FILES: src/components/ui/toast.tsx

6. THEN say: "I have enough to write the spec. Shall I proceed?"

═══════════════════════════════════════════════════════════════════
WRITING PHASE — FEATURE SPECIFICATION
═══════════════════════════════════════════════════════════════════

# {Feature Name} — Feature Specification

## 1. Overview
What this feature adds, why, how it fits into the existing app.

## 2. Affected Files
EVERY existing file that needs modification. For each:
- Full file path ✅/⚠️/❓
- What changes (specific: "Add import for NotificationBell at line 5", 
  "Add <NotificationBell /> after <UserMenu /> in the header div at line 38")
- Why

EVERY new file to create:
- Full file path (following project conventions)
- Purpose

## 3. Data Model Changes
New models/tables AND modifications to existing ones.
Show the COMPLETE model definition including existing fields for context.
Highlight what's new vs existing.

## 4. New Routes & Pages
Same level of detail as New Application Mode Section 3.
Reference existing layout and navigation.

## 5. New & Modified Components
New components: full props interface, behavior, states.
Modified components: EXACT changes needed (line-level if you've read the file).
Reference existing components to reuse.

## 6. API / Data Layer Changes
New endpoints or queries.
Changes to existing endpoints.
New RLS policies, middleware changes.

## 7. Integration Points
How this feature connects to existing features.
Shared state changes, navigation changes, permission changes.

## 8. Error Handling & Edge Cases
Feature-specific error states.
How errors surface in existing UI patterns.

## 9. Implementation Checklist
Same format as New Application Mode Section 9.
MUST include "Modify existing file X" as separate checklist items.

## 10. Open Questions & Assumptions
List EVERY ⚠️ INFERRED and ❓ ASSUMED item from the spec.
The implementer MUST review this before starting.

═══════════════════════════════════════════════════════════════════
WRITING RULES (same as New Application Mode, plus:)
═══════════════════════════════════════════════════════════════════

- Reference ACTUAL file paths from the project
- Reference ACTUAL existing components and hooks by name
- Match the project's naming conventions
- Follow the project's established patterns (server components, 
  client components, API routes, server actions — whatever it uses)
- Don't add dependencies that overlap with existing ones
- The Implementation Checklist items for modifying existing files 
  should be as specific as possible:
  
  - [ ] Modify `src/app/layout.tsx`:
    - [ ] Import `NotificationBell` from `@/components/notifications/notification-bell`
    - [ ] Add `<NotificationBell />` in header after `<UserMenu />` (line ~38) ✅
    - [ ] Add `<NotificationProvider>` wrapper around `{children}` ⚠️ verify this pattern
```

---

## 8. Spec Output Format: What "Best-in-Class" Looks Like

### The difference between a mediocre and excellent spec section

**MEDIOCRE (what most AI produces):**
```markdown
## Dashboard Page
The dashboard shows a list of projects with their status. Users can 
create new projects and view existing ones. The page should have a 
loading state and handle errors gracefully.
```

**EXCELLENT (what SpecWriter must produce):**
```markdown
## Dashboard Page

Route: `/dashboard`
Auth: Authenticated (redirect → /login with returnUrl param)
Title: "Dashboard — {appName}" (set via Next.js metadata)

### Data Loading (Server Component)
```typescript
// src/app/dashboard/page.tsx
const projects = await db.project.findMany({
  where: { members: { some: { userId: session.user.id } } },
  include: { members: { select: { user: { select: { name: true, avatar: true } } } } },
  orderBy: { updatedAt: 'desc' },
});
const recentActivity = await db.activity.findMany({
  where: { projectId: { in: projects.map(p => p.id) } },
  take: 10,
  orderBy: { createdAt: 'desc' },
});
```

### Components on Page
1. **DashboardHeader** — h1 "Your Projects" + project count badge + 
   "New Project" button (accent gradient, opens /projects/new)
2. **ProjectGrid** — CSS grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
   - **ProjectCard** — per card:
     - Project name (h3, truncate at 40 chars with ellipsis)
     - Status badge: active (green), paused (yellow), completed (gray)
     - Member avatars: show first 3 as 24px circles, +N overflow
     - Last updated: relative time ("2 hours ago")
     - Progress bar: completed tasks / total tasks
     - Click → navigate to /projects/{id}
     - Hover: subtle border-accent/20 + shadow-sm transition
3. **RecentActivity** — vertical timeline with:
   - Each entry: colored dot (create=green, update=blue, delete=red) + 
     "{user} {action} in {project}" + relative timestamp
   - Max 10 entries, "View all activity" link at bottom

### States
**Loading:**
```
6 skeleton cards in grid:
  - 12px skeleton for title (w-48)
  - 8px skeleton for status (w-20)
  - 3 circular skeletons for avatars (w-6 h-6)
  - 8px skeleton for progress bar (w-full)
  Shimmer animation: bg-gradient pulse
3 skeleton activity entries:
  - Circle (w-3 h-3) + line (w-64 h-3) + line (w-20 h-3)
```

**Empty (0 projects):**
```
Centered column, max-w-md:
  - Illustration: folder-open icon (lucide), 64px, text-muted
  - h2: "No projects yet"
  - p: "Create your first project to start tracking your work."
  - Button: "Create Project" (primary, → /projects/new)
```

**Error:**
```
Centered column, max-w-md:
  - AlertCircle icon (lucide), 48px, text-destructive
  - h2: "Failed to load dashboard"
  - p: "Something went wrong. Please try again."
  - Button: "Try Again" (outline, calls router.refresh())
  - p.text-xs.text-muted: error code/message for debugging
```
```

### Why the excellent version works

Claude Code reads the excellent version and produces EXACTLY the right output. There's no ambiguity about:
- What data to fetch (the query is written)
- What the grid looks like (breakpoints specified)
- What a card contains (every element listed with sizes)
- What loading looks like (skeleton dimensions specified)
- What empty state says (exact copy written)
- What error state does (exact button behavior specified)

---

## 9. The Implementation Checklist Pattern

### Why This Matters

From working with Harald on CodeMantis specs over weeks, the single highest-impact pattern is: **end every spec with a hierarchical checklist that covers every verifiable unit of work.**

Claude Code reads the checklist and works through it item by item. Without it, Claude Code implements the "interesting" parts and silently skips:
- Loading skeletons
- Empty states
- Error boundaries
- Form validation messages
- Toast notifications
- Responsive breakpoints
- Keyboard navigation

### Checklist Structure Rules

The AI MUST follow these rules when generating the checklist:

1. **One checkbox = one verifiable thing.** Not "Build the dashboard page" but "Create `/dashboard` route with server data fetching."

2. **Indent for sub-tasks.** The top level is the feature/page. Indented items are specific things within it.

3. **Every component has 4 checkboxes minimum:** default state, loading state, empty state, error state.

4. **Every form has N+2 checkboxes:** one per field validation + one for submit success + one for submit error.

5. **States are SEPARATE checkboxes,** not hidden inside a component checkbox:
```markdown
- [ ] Create ProjectGrid component
  - [ ] Renders project cards in responsive grid
  - [ ] Loading state: 6 skeleton cards with shimmer
  - [ ] Empty state: illustration + "No projects yet" + CTA
  - [ ] Error state: error message + retry button
```

6. **Final phase is ALWAYS "Polish" with explicit state verification:**
```markdown
### Phase 4: Polish & States
- [ ] All loading states:
  - [ ] /dashboard: skeleton cards + skeleton activity
  - [ ] /projects/[id]: skeleton header + skeleton tabs
  - [ ] /settings: skeleton form fields
- [ ] All empty states:
  - [ ] /dashboard (no projects): illustration + CTA
  - [ ] /projects/[id]/tasks (no tasks): "Add your first task"
  - [ ] /notifications (no notifications): "All caught up!"
- [ ] All error states:
  - [ ] /dashboard: "Failed to load" + retry
  - [ ] /projects/[id]: 404 "Project not found" + back link
  - [ ] /settings save: toast "Failed to save settings"
- [ ] All validations:
  - [ ] Project name: required, 1-100 chars, "Project name is required"
  - [ ] Email: format validation, "Please enter a valid email"
  - [ ] Password: min 8 chars, "Password must be at least 8 characters"
- [ ] All toast messages:
  - [ ] Project created: "Project '{name}' created successfully"
  - [ ] Settings saved: "Settings updated"
  - [ ] Delete confirmed: "Project deleted"
  - [ ] Error generic: "Something went wrong. Please try again."
- [ ] Responsive: verified at 375px, 768px, 1024px, 1440px
```

---

## 10. Conversation Quality: Question Engineering

### What Makes SpecWriter's Questions Better Than Generic AI

The system prompt instructs the AI to ask "smart questions" but doesn't enforce it. These concrete patterns should be included:

**Pattern 1: Trade-off questions (not preference questions)**
```
BAD: "Do you want pagination?"
GOOD: "Your data table will show projects. Should it: load all items 
upfront (simpler, works well under 200 items), or paginate server-side 
(handles 10,000+ items, but adds complexity to filtering/sorting)?"
```

**Pattern 2: Decision questions with implementation implications**
```
BAD: "What database do you want?"
GOOD: "For a Next.js app with this data model, the two practical 
choices are: Supabase (PostgreSQL with built-in auth, real-time, 
and a generous free tier) or PlanetScale (MySQL with branching, 
scales better for writes). Given you mentioned real-time features, 
Supabase is likely the better fit. Does that work?"
```

**Pattern 3: Visual confirmation questions (when images are attached)**
```
"Looking at your mockup, I see:
1. A top nav with logo, search, and user avatar
2. A sidebar with 5 items: Dashboard, Projects, Team, Analytics, Settings
3. A main area showing a data table with 6 columns

Am I reading this correctly? And a few things I can't tell from the image:
- Is the sidebar always visible, or collapsible on mobile?
- The 'Analytics' page — is that a priority for v1 or a later addition?"
```

**Pattern 4: Progressive disclosure**
Don't ask about error handling in the first exchange. Ask about it after the happy path is clear:
```
Turn 1-2: "What does the app do? Who uses it?"
Turn 3-4: "What are the key pages? What data do they show?"
Turn 5: "Now let's talk about what happens when things go wrong..."
Turn 6: "I'm ready to write. Here's my understanding: [summary]"
```

---

## 11. Implementation Changes Required

### Changes to existing files

| File | Change |
|------|--------|
| `useSpecConversation.ts` (renamed from usePlanningConversation) | Replace system prompt with Section 6/7 prompts. Add file request marker detection. Add file content injection as system messages. Remove task plan JSON detection. |
| `specWriterStore.ts` (renamed from taskBoardStore) | Add `fileRequestsPending: string[]`, `loadedFiles: Map<string, string>`. Add actions: `setFileRequests()`, `addLoadedFile()`. |
| `SpecChat.tsx` | After streaming completes, check for `📂 REQUEST_FILES` markers. If found, show a brief "Loading requested files..." indicator, call `read_project_files`, inject system message. |
| `SpecChatMessage.tsx` | Render `message_type: 'file_context'` messages with a special "📂 Files loaded" collapsible section showing file names (not full contents — those are in the conversation for the AI but don't need to be fully visible to the user). |
| `snapshot.rs` or new `specwriter.rs` | Add `read_project_files` command: accepts array of paths, returns FileReadResult[] with contents truncated to 150 lines. |
| `gather_spec_context` command | Ensure L1 overview format matches Section 4 budget. Add git log (last 3 commits). |

### New Tauri command

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileReadResult {
    pub path: String,
    pub found: bool,
    pub content: Option<String>,
    pub total_lines: usize,
    pub truncated: bool,
}

#[tauri::command]
pub async fn read_project_files(
    project_path: String,
    file_paths: Vec<String>,
    max_lines: Option<usize>,  // default 150
) -> Result<Vec<FileReadResult>, String>
```

### No changes to `assistant_chat.rs`

This is the key constraint. The streaming handler stays untouched. All context loading happens between turns, not mid-stream.

---

## 12. Completeness Checklist for This Enhancement

### Context Architecture
- [ ] `read_project_files` Tauri command exists and is registered
- [ ] Command accepts array of relative paths, returns FileReadResult[]
- [ ] Files truncated to 150 lines (configurable via max_lines param)
- [ ] Non-existent files return `found: false` (not an error)
- [ ] Maximum 5 files per call enforced

### File Request Detection
- [ ] `FILE_REQUEST_PATTERN` regex detects `📂 REQUEST_FILES:` markers
- [ ] Detection runs AFTER streaming completes (in the `done` handler)
- [ ] Extracted paths are deduplicated and limited to 5
- [ ] Paths are validated against project root (no path traversal)
- [ ] File contents injected as system message with `message_type: 'file_context'`
- [ ] ⚠️ File context messages show abbreviated view to user (file names + line counts) but full contents are in the conversation for the AI
- [ ] Brief "Loading requested files..." indicator shown during read

### L1 Overview (gather_spec_context)
- [ ] Includes CLAUDE.md (first 100 lines, or "not found")
- [ ] Includes framework detection
- [ ] Includes package manager detection
- [ ] Includes dependency list (names only, no versions)
- [ ] Includes route/page list (all detected page files)
- [ ] Includes component inventory (file names, 2 levels deep)
- [ ] Includes hook inventory (file names)
- [ ] Includes store inventory (file names)
- [ ] Includes type definition inventory (file names)
- [ ] Includes existing spec titles from docs/specs/
- [ ] Includes last 3 git commit summaries
- [ ] ⚠️ Total L1 context stays under 3,500 tokens. Log warning if exceeded.

### System Prompts
- [ ] New Application Mode prompt includes ALL writing rules from Section 6
- [ ] New Application Mode prompt includes the Implementation Checklist pattern
- [ ] New Application Mode prompt includes the "4 states per component" rule
- [ ] Feature Mode prompt includes file request marker instructions
- [ ] Feature Mode prompt includes confidence tagging rules (✅ ⚠️ ❓)
- [ ] Feature Mode prompt includes anti-hallucination rules (never invent paths)
- [ ] Feature Mode prompt includes `{PROJECT_CONTEXT}` placeholder
- [ ] Feature Mode prompt includes `{TEMPLATE_CATALOG}` placeholder
- [ ] Both prompts instruct AI to ask ONE question at a time with `?>` options
- [ ] Both prompts instruct AI NOT to write spec without user confirmation

### Spec Output Quality
- [ ] Generated spec has ALL 10 sections (none skipped or merged)
- [ ] Data Model section uses actual schema syntax (Prisma/SQL/TS)
- [ ] Pages section specifies every component, every interaction, every state
- [ ] Components section includes full TypeScript props interfaces
- [ ] Implementation Checklist has hierarchical structure
- [ ] Every component in checklist has 4 checkboxes: default, loading, empty, error
- [ ] Final checklist phase lists ALL loading states, ALL empty states, ALL error states, ALL validations, ALL toast messages explicitly
- [ ] Feature Mode spec includes confidence tags on every file reference
- [ ] Spec ends with "Open Questions & Assumptions" section

### Anti-Hallucination
- [ ] AI requests files before referencing their contents
- [ ] AI never invents paths not in the file tree
- [ ] AI tags every codebase reference with ✅/⚠️/❓
- [ ] Feature Mode spec has "Open Questions" listing all ⚠️ and ❓ items
- [ ] When file doesn't exist, response shows "(NOT FOUND)" — AI acknowledges
- [ ] AI asks about unknowns DURING conversation, not after spec is written

### Conversation Quality  
- [ ] AI asks trade-off questions, not preference questions
- [ ] AI offers concrete options with implementation implications
- [ ] AI references specific elements when user attaches images
- [ ] AI summarizes understanding after 2-3 exchanges before asking more
- [ ] AI follows progressive disclosure (happy path first, edge cases later)
- [ ] AI says "I have enough to write" and waits for confirmation
