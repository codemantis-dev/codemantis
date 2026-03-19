# CodeMantis — SpecWriter: Implementation Completeness Checklist

**Purpose:** Verification list for Claude Code to quality-check the SpecWriter implementation. Work through each step sequentially. Items marked ⚠️ are historically problematic.

---

## STEP 1: Rename & Strip

### 1a: Directory Rename
- [ ] `src/components/taskboard/` renamed to `src/components/specwriter/`
- [ ] ⚠️ Use `git mv` for the rename (preserves history)
- [ ] Rename done as a single commit before content changes

### 1b: File Renames
- [ ] `taskBoardStore.ts` → `specWriterStore.ts`
- [ ] `taskBoardStore.test.ts` → `specWriterStore.test.ts`
- [ ] `usePlanningConversation.ts` → `useSpecConversation.ts`
- [ ] `usePlanningConversation.test.ts` → `useSpecConversation.test.ts`
- [ ] `TaskBoardSlideOver.tsx` → `SpecWriterSlideOver.tsx`
- [ ] `PlanningChat.tsx` → `SpecChat.tsx`
- [ ] `PlanningChatInput.tsx` → `SpecChatInput.tsx`
- [ ] `PlanningChatMessage.tsx` → `SpecChatMessage.tsx`
- [ ] `PlanningChatMessage.test.tsx` → `SpecChatMessage.test.tsx`
- [ ] `TaskBoardBadge.tsx` → `SpecWriterBadge.tsx`
- [ ] `src/types/task-board.ts` → `src/types/spec-writer.ts`
- [ ] `src-tauri/src/commands/taskboard.rs` → `src-tauri/src/commands/specwriter.rs`

### 1c: File Deletions
- [ ] DELETED: `WorkPackageList.tsx` + `WorkPackageList.test.tsx`
- [ ] DELETED: `WorkPackageCard.tsx`
- [ ] DELETED: `TaskCard.tsx`
- [ ] DELETED: `VerificationResults.tsx`
- [ ] DELETED: `TaskBoardToolbar.tsx` + `TaskBoardToolbar.test.tsx`
- [ ] DELETED: `ProgressUpdateMessage.tsx`
- [ ] DELETED: `ProjectTargetDecision.tsx` + `ProjectTargetDecision.test.tsx`
- [ ] DELETED: `PlanPicker.tsx`
- [ ] DELETED: `UserActionBanner.tsx`
- [ ] DELETED: `useTaskExecution.ts` + `useTaskExecution.test.ts`
- [ ] DELETED: `usePreviewServer.ts` + `usePreviewServer.test.ts` (if preview feature also removed)
- [ ] DELETED: `usePreviewWindow.ts` + `usePreviewWindow.test.ts` (if preview feature also removed)
- [ ] DELETED: `previewStore.ts` + `previewStore.test.ts` (if preview feature also removed)

### 1d: Import Updates
- [ ] Every file that imported from `taskBoardStore` → now imports from `specWriterStore`
- [ ] Every file that imported from `types/task-board` → now imports from `types/spec-writer`
- [ ] Every file referencing `components/taskboard/` → now references `components/specwriter/`
- [ ] Every file referencing `usePlanningConversation` → now references `useSpecConversation`
- [ ] `src-tauri/src/commands/mod.rs` updated: `pub mod specwriter;` (not `pub mod taskboard;`)
- [ ] `src-tauri/src/lib.rs` updated: command registrations use new names
- [ ] No remaining references to old filenames in the codebase (grep for `taskboard`, `TaskBoard`, `task-board`, `usePlanningConversation`, `WorkPackage`, `TaskItem`, `VerificationCheck`)

### 1e: Compilation Check
- [ ] ⚠️ `pnpm tsc --noEmit` passes with 0 errors
- [ ] `pnpm tauri dev` starts without crashes
- [ ] Slide-over opens (may be empty right column — that's OK at this step)
- [ ] *** DO NOT PROCEED TO STEP 2 UNTIL THIS PASSES ***

---

## STEP 2: New Right Column

### 2a: SpecPreview Component
- [ ] `src/components/specwriter/SpecPreview.tsx` exists
- [ ] Renders Markdown content using `react-markdown` with `remark-gfm`
- [ ] Has syntax highlighting for code blocks (reuse from chat MessageBubble)
- [ ] Shows "empty state" when no spec content: helpful text about what to do
- [ ] Scrollable independently from the chat column
- [ ] Updates in real-time during AI streaming (content prop updates)
- [ ] Has a header showing spec title (extracted from first `#` heading)

### 2b: SavedSpecsList Component
- [ ] `src/components/specwriter/SavedSpecsList.tsx` exists
- [ ] Calls `list_spec_documents` Tauri command to get files from `docs/specs/`
- [ ] Each entry shows: filename, title (from first heading), last modified date
- [ ] Click a spec → loads its content into SpecPreview (read-only)
- [ ] "Open in File Viewer" button → opens in main app's Monaco file viewer
- [ ] Delete with confirmation dialog
- [ ] ⚠️ Handles gracefully when `docs/specs/` doesn't exist (shows empty state, not error)
- [ ] "📂 Open specs folder" link at bottom

### 2c: SpecToolbar Component
- [ ] `src/components/specwriter/SpecToolbar.tsx` exists
- [ ] Has "New Spec" button → clears conversation and preview
- [ ] Has "Write Spec" button → sends "write the spec now" to the AI
  - [ ] ⚠️ "Write Spec" is DISABLED until AI indicates readiness (conversation status === 'ready_to_write')
  - [ ] "Write Spec" is DISABLED during streaming
- [ ] Has "💡 Suggest Features" button (Feature Mode only)
  - [ ] Hidden when in New Application mode

### 2d: SlideOver Integration
- [ ] `SpecWriterSlideOver.tsx` has TWO columns: SpecChat (left) + new right column
- [ ] Right column contains: SpecPreview (top, flexible height) + action buttons + SavedSpecsList (bottom, collapsible)
- [ ] Action buttons between preview and list: "Save to Project", "Copy to Clipboard"
- [ ] SpecToolbar at the very bottom of the slide-over (spanning full width)

### 2e: Compilation & Visual Check
- [ ] Slide-over opens with chat on left, empty spec preview on right
- [ ] Saved specs list shows "No specifications yet" empty state
- [ ] Can type in the chat and get AI response (conversation still works)

---

## STEP 3: Spec Saving Infrastructure

### 3a: Rust Commands
- [ ] File `src-tauri/src/commands/specwriter.rs` exists
- [ ] `save_spec_document` command:
  - [ ] Accepts: `project_path`, `filename`, `content`, `overwrite`
  - [ ] Creates `{project_path}/docs/specs/` directory if it doesn't exist
  - [ ] If `!overwrite` and file exists → returns error
  - [ ] Writes content to `{project_path}/docs/specs/{filename}`
  - [ ] Prepends metadata comment header (date, model, mode)
  - [ ] Returns the full saved path
- [ ] `list_spec_documents` command:
  - [ ] Accepts: `project_path`
  - [ ] Reads all `.md` files in `{project_path}/docs/specs/`
  - [ ] For each file: extracts title from first `#` heading, gets file size and modified time
  - [ ] Returns `Vec<SpecDocumentInfo>`
  - [ ] Returns empty vec (not error) if directory doesn't exist
- [ ] `read_spec_document` command:
  - [ ] Accepts: `project_path`, `filename`
  - [ ] Returns file contents as String
- [ ] `delete_spec_document` command:
  - [ ] Accepts: `project_path`, `filename`
  - [ ] Deletes the file
  - [ ] Returns OK

### 3b: Command Registration
- [ ] All 4 commands registered in `lib.rs` invoke_handler
- [ ] TypeScript wrappers added to `src/lib/tauri-commands.ts`

### 3c: Save Flow
- [ ] "Save to Project" button triggers a save dialog
- [ ] Save dialog (SaveSpecDialog.tsx) has: filename input (pre-filled from title slug), Save/Cancel buttons
- [ ] If file exists: shows "Overwrite?" or "Save as {name}-v2.md?" option
- [ ] On save: calls `save_spec_document` → shows success toast
- [ ] After save: shows CLAUDE.md integration tip (toast or inline message):
  "💡 Add to CLAUDE.md: Read docs/specs/{filename} for implementation"
- [ ] SavedSpecsList refreshes after save

### 3d: Copy to Clipboard
- [ ] "Copy to Clipboard" button copies raw Markdown to clipboard
- [ ] Shows brief toast: "Spec copied to clipboard"

### 3e: Verification
- [ ] Can save a spec → appears in `docs/specs/` on disk
- [ ] File appears in SavedSpecsList immediately after save
- [ ] Can click saved spec → content loads in SpecPreview
- [ ] Can delete saved spec → file removed, list refreshes

---

## STEP 4: AI System Prompt Rewrite

### 4a: New Application Mode Prompt
- [ ] System prompt in `useSpecConversation.ts` rewritten per spec Section 5.1
- [ ] ⚠️ AI asks ONE question at a time with selectable `?>` options (not multiple questions)
- [ ] AI does NOT generate the spec on first response (always starts with questions)
- [ ] Template catalog is still injected into the prompt (existing behavior)
- [ ] AI asks about: user roles, data model, pages/routes, UI components, error handling, auth, deployment
- [ ] After enough questions: AI says "I have enough to write the specification"
- [ ] Conversation status updates to `ready_to_write`

### 4b: Spec Output Detection
- [ ] ⚠️ Remove ALL JSON task plan detection code (the `"work_packages"` matching)
- [ ] Replace with Markdown spec detection: `SPEC_START_PATTERN` checks for `# ... Specification` heading
- [ ] When detected: content is set as `currentSpecContent` in the store
- [ ] The spec content streams into BOTH the chat AND the SpecPreview simultaneously
- [ ] After streaming completes: "Write Spec" button changes to "Save to Project" or both are available

### 4c: Spec Preview Updates
- [ ] During streaming: SpecPreview updates in real-time as tokens arrive
- [ ] SpecPreview shows the latest version of the spec (if revised, shows the revision)
- [ ] ⚠️ Spec content is stored separately from chat messages — it's extracted and put in `currentSpecContent`

### 4d: Verification
- [ ] Start a new conversation → describe an app → AI asks questions with options
- [ ] Answer 3-4 questions → AI says it's ready
- [ ] Click "Write Spec" → AI streams a complete Markdown specification
- [ ] Spec appears in both chat and preview pane
- [ ] Spec has all sections from the template: Overview, Tech Stack, Data Model, Pages, Components, Auth, API, Error Handling, UI/UX, Implementation Notes
- [ ] Can save the spec to disk

---

## STEP 5: Feature Mode + Context Gathering

### 5a: gather_spec_context Command
- [ ] New command in Rust (in `snapshot.rs` or new `specwriter.rs`)
- [ ] Reads CLAUDE.md from project root (first 100 lines)
- [ ] Detects framework from config files (next.config, vite.config, etc.)
- [ ] Reads package.json dependencies
- [ ] Lists routes (page.tsx/route.tsx files)
- [ ] Reads database schema (prisma/schema.prisma or drizzle schema, first 150 lines)
- [ ] Lists component files (src/components/, 2 levels deep, names only)
- [ ] Lists hook files (src/hooks/ or src/lib/hooks/, names only)
- [ ] Scans docs/specs/ for existing spec titles (first heading of each .md file)
- [ ] ⚠️ Total output stays under 6000 tokens (~24,000 chars). Log warning if exceeded.
- [ ] Returns formatted text string (not JSON — directly readable by AI)

### 5b: Mode Detection
- [ ] When SpecWriter opens: check if a project session is active
- [ ] If active project session → mode = "feature", load context automatically
- [ ] If no project session → mode = "new_application"
- [ ] Mode indicator shown at bottom-left of chat column
- [ ] Context status shown: "✅ loaded" / "⏳ loading..." / "❌ failed"

### 5c: Context Injection
- [ ] In Feature Mode: context string is prepended to the system prompt (in the `{PROJECT_CONTEXT}` placeholder)
- [ ] ⚠️ Context is injected ONCE at conversation start, not on every message (avoid ballooning token usage)
- [ ] System prompt switches to Feature Mode template (Section 5.2 of spec)

### 5d: AI Behavior in Feature Mode
- [ ] AI's first message references actual project details: framework name, route count, key dependencies
- [ ] AI asks questions that account for existing architecture
- [ ] AI suggests reusing existing components/hooks by name
- [ ] Feature spec output references actual file paths from the project
- [ ] Feature spec includes "Affected Files" section listing existing files to modify

### 5e: Verification
- [ ] Open SpecWriter in an existing project with routes, deps, and a CLAUDE.md
- [ ] AI says something like: "I've reviewed your project. It's a Next.js app with X routes using Y..."
- [ ] Ask for a feature → AI asks context-aware questions
- [ ] Generated spec references real file paths and existing components
- [ ] Generated spec follows Feature Specification template (not New Application template)

---

## STEP 6: Polish

### 6a: Spec Revision Flow
- [ ] After spec is written, user can say "add a section about X" or "change the auth approach"
- [ ] AI outputs a COMPLETE revised spec (not just the changed part)
- [ ] SpecPreview updates to show the latest revision
- [ ] Previous spec versions remain visible in chat history
- [ ] "Save" still works and saves the latest version

### 6b: Load Existing Spec
- [ ] In SavedSpecsList: "Load into conversation" option
- [ ] Loads spec content as a system message into the conversation
- [ ] AI can reference and revise the loaded spec
- [ ] User says "update the auth section to add OAuth" → AI revises the loaded spec

### 6c: CLAUDE.md Integration
- [ ] After saving: shows tip about adding spec reference to CLAUDE.md
- [ ] Includes a "Copy" button for the CLAUDE.md snippet
- [ ] Snippet format: `Read docs/specs/{filename} for {title}`

### 6d: Suggest Features (Feature Mode)
- [ ] "💡 Suggest Features" button visible in Feature Mode
- [ ] Sends a message to the AI: "Based on what you see in this project, what features or improvements would you suggest?"
- [ ] AI analyzes the project context and suggests 3-5 concrete feature ideas
- [ ] Each suggestion can be used as a starting point for a new spec conversation

### 6e: Error Handling & Edge Cases
- [ ] No API key configured → helpful message in chat, not a crash
- [ ] Context gathering fails (not a git repo, no package.json) → shows warning, continues in New Application mode
- [ ] docs/specs/ directory can't be created (permissions) → shows error toast with the path
- [ ] AI generates response that isn't a proper spec → stays in chat, doesn't pollute preview
- [ ] Very long specs → SpecPreview scrolls properly, save handles large files
- [ ] Empty conversation → "Write Spec" and "Save" buttons are disabled

### 6f: UI Polish
- [ ] ⌘⇧B keyboard shortcut toggles SpecWriter slide-over
- [ ] Title bar button icon is 📝 (not 📋)
- [ ] Badge shows conversation status when closed: "📝 Gathering..." or "📝 Spec ready"
- [ ] Slide-over has smooth open/close animation
- [ ] Chat column and preview column widths are adjustable (drag divider)
- [ ] Column widths persist across sessions

---

## INTEGRATION TESTS

### New Application Flow
- [ ] Open SpecWriter (no project active) → mode shows "New Application"
- [ ] Describe an app → AI asks questions with options → answer them
- [ ] AI indicates readiness → click "Write Spec"
- [ ] Spec streams in both chat and preview
- [ ] Spec has all 10 sections (Overview through Implementation Notes)
- [ ] Click "Save to Project" → enter filename → saves to docs/specs/
- [ ] Spec appears in SavedSpecsList
- [ ] CLAUDE.md tip shown after save

### Feature Mode Flow
- [ ] Open project session → open SpecWriter → mode shows "Feature"
- [ ] Context status shows "✅ loaded"
- [ ] AI references actual project structure in first message
- [ ] Describe a feature → AI asks context-aware questions
- [ ] Spec references real file paths and existing components
- [ ] Save works, spec appears in project's docs/specs/

### Revision Flow
- [ ] After spec is written → ask for changes → AI outputs revised spec
- [ ] Preview updates to latest version
- [ ] Save the revised version (overwrite or new file)

### Load & Revise Flow
- [ ] Save a spec → close SpecWriter → reopen
- [ ] Click saved spec → loads in preview
- [ ] Click "Load into conversation" → AI can reference the spec
- [ ] Ask for changes → AI revises → save revised version
