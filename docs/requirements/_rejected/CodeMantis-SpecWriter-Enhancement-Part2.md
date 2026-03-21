# CodeMantis SpecWriter — Enhancement Part 2: Verification Checklist Generation & Spec Quality Refinements

**Type:** Enhancement to CodeMantis-SpecWriter-Requirements.md (implement AFTER Part 1 enhancement)
**Date:** March 2026
**Priority:** High — completes the spec-to-implementation pipeline
**Status:** Pre-implementation
**Depends on:** Base SpecWriter implementation (done), Enhancement Part 1 (context architecture)

---

## What This Enhancement Adds

**1. Automatic Verification Checklist Generation.** After the AI writes a spec and the user confirms it, the AI generates a companion verification document — an exhaustive, checkable list that Claude Code uses to self-verify its implementation. The checklist is saved alongside the spec as `{feature-slug}-checklist.md`.

**2. Spec Quality Refinements.** Based on analyzing real SpecWriter output (the subscriber-list-management spec), this enhancement addresses specific quality gaps in the system prompts that produce measurably better specs.

---

## Table of Contents

1. Analysis of Current Output Quality
2. Verification Checklist: What It Is
3. Verification Checklist: Document Format
4. UI Flow for Checklist Generation
5. System Prompt Additions (Both Modes)
6. Spec Quality Gap Fixes (Prompt Refinements)
7. Implementation Changes
8. Completeness Checklist

---

## 1. Analysis of Current Output Quality

The subscriber-list-management spec was analyzed against the Enhancement Part 1 quality criteria. Here's what's working and what's missing:

### What the AI does well (keep these)

- **Confidence tagging** — ✅/⚠️/❓ tags on every file reference. Correct and honest.
- **Data model specificity** — Full TypeScript interfaces with field-level constraints and realistic mock data.
- **Component specs** — ASCII mockups, validation tables with timing, Tailwind classes for badges.
- **Open Questions section** — 11 specific items, categorized, actionable. The toast system question (#7) was particularly smart.
- **Integration Points section** — Real architectural thinking about how components connect.
- **Implementation Checklist** — 7 phases, hierarchical, with sub-items for states and validations.

### What's missing (fix with this enhancement)

**Gap 1: Phase 7 (Polish) is not exhaustive enough.**

Current output:
```markdown
### Phase 7: Polish
- [ ] All loading states: ListManager, ListMembershipModal list fetch, CampaignWizard recipients step
- [ ] All error states: ListManager fetch fail, createList fail, deleteList fail...
```

This lists the categories but doesn't enumerate every individual item with its exact expected behavior. Claude Code reads "All loading states: ListManager, ListMembershipModal..." and implements the first one or two, then moves on.

Required output (what the prompt should enforce):
```markdown
### Phase 7: Polish
- [ ] Loading states:
  - [ ] ListManager page: centered spinner (match SegmentsPanel pattern)
  - [ ] ListManager create modal: "Create List" button shows spinner, form fields disabled
  - [ ] ListManager delete modal: "Delete List" button shows spinner  
  - [ ] ListMembershipModal: spinner while fetching lists from listService
  - [ ] SubscriberList list filter dropdown: shows "Loading..." option while lists load
  - [ ] CampaignWizard recipients step: spinner in Lists section while fetching
```

**Gap 2: No responsive behavior specified.**

The spec says "responsive: 1 col mobile, 2 col tablet, 3 col desktop" in the checklist but never defines breakpoints or how modals behave on mobile. Missing from the component spec sections entirely.

**Gap 3: No keyboard navigation.**

Can you tab through list cards? Does Enter on a focused card open it? Does Escape close modals? These are never mentioned.

**Gap 4: Generic error recovery not specified.**

Domain-specific errors are covered well (delete default list, archived lists). But what about: network timeout mid-save? User navigates away while modal is saving? API returns 500 during list creation? The spec covers the `what` of error states but not the `how` of recovery.

**Gap 5: No explicit state transition descriptions.**

The spec shows what each state looks like but not how you GET to that state. What triggers the loading state? What triggers the transition from loading to error vs loading to default? State machine thinking is missing.

---

## 2. Verification Checklist: What It Is

The verification checklist is a companion document to the spec. It mechanically transforms every requirement in the spec into a yes/no checkable assertion.

**The spec says WHAT to build. The checklist says HOW TO VERIFY it was built correctly.**

Example transformation:

| Spec says | Checklist says |
|-----------|---------------|
| "List card shows contact count" | `- [ ] ListCard renders contactCount formatted with commas (e.g., "1,420 contacts")` |
| "Delete default list shows error" | `- [ ] Click Delete on a list with isDefault:true → error message "This is your default list..." appears inside the delete modal` |
| "Loading state shows spinner" | `- [ ] When ListManager mounts → spinner visible for 200-400ms → then either list cards or empty state` |
| "Name field: 1-100 chars, required" | `- [ ] Empty name + click Create → "List name is required" error below field` <br> `- [ ] 101-char name + blur → "List name must be 100 characters or fewer" error below field` <br> `- [ ] 1-char name + click Create → form submits successfully (no error)` |

The key difference: the spec describes the desired state. The checklist describes the test action → expected result.

---

## 3. Verification Checklist: Document Format

### 3.1 File Naming

Spec: `docs/specs/subscriber-list-management.md`
Checklist: `docs/specs/subscriber-list-management-checklist.md`

Convention: `{spec-slug}-checklist.md`, always in the same directory as the spec it verifies.

### 3.2 Document Structure

```markdown
<!-- 
  Generated by CodeMantis SpecWriter
  Date: 2026-03-19
  AI Model: claude-sonnet-4-6
  Type: Verification Checklist
  Spec: subscriber-list-management.md
  Project: /Users/hr/Dev_Projects/NewsletterNeu
-->

# Subscriber List Management — Verification Checklist

**Companion to:** `docs/specs/subscriber-list-management.md`
**How to use:** Work through each section after implementing the 
corresponding phase. Every item must pass. Items are ordered by 
implementation dependency — complete top to bottom.

---

## Phase 1: Types & Mock Data

### Type Definitions
- [ ] `src/types/list.ts` exists
- [ ] `List` interface has all fields: id, tenantId, name, description, contactCount, status, isDefault, createdAt, updatedAt
- [ ] `List.status` is typed as `'active' | 'archived'` (not string)
- [ ] `ListMembership` interface has: id, listId, contactId, subscribedAt, source
- [ ] `ListMembership.source` is typed as `'manual' | 'import' | 'api' | 'form'`
- [ ] `ListCreatePayload` has: name (string), description (string), isDefault (boolean)
- [ ] `ListUpdatePayload` has all fields optional: name?, description?, status?, isDefault?
- [ ] `ListContactsResponse` has data (Contact[]) and pagination object
- [ ] `Contact` interface in `src/types/index.ts` has `listIds?: string[]` field added
- [ ] `Segment` and `SegmentCondition` promoted to `src/types/index.ts`
- [ ] No duplicate `Segment` interface in `SegmentsPanel.tsx`
- [ ] `pnpm tsc --noEmit` passes with zero errors

### Mock Data
- [ ] `src/services/mockData/lists.ts` exists
- [ ] Contains exactly 5 seeded lists
- [ ] List 1 ("Newsletter Subscribers"): status active, isDefault true, contactCount 1420
- [ ] List 5 ("Product Updates"): status archived
- [ ] Existing mock contacts have `listIds` arrays referencing seeded list IDs
- [ ] At least 3 contacts belong to multiple lists (test dedup scenarios)

## Phase 2: Service Layer

### listService Methods
- [ ] `src/services/listService.ts` exists
- [ ] Exports `listService` object with all 8 methods
- [ ] `getLists(tenantId)`: returns lists filtered by tenantId
- [ ] `getLists()`: without tenantId returns all lists
- [ ] `getList(listId)`: returns single list by ID
- [ ] `getList("nonexistent")`: returns error response (not throw)
- [ ] `createList(tenantId, payload)`: generates unique ID, sets contactCount:0, sets createdAt/updatedAt
- [ ] `createList` with `isDefault:true` when another default exists → removes default from the other
- [ ] `updateList(listId, payload)`: merges only provided fields, updates `updatedAt`
- [ ] `deleteList(listId)` where `isDefault:true` → returns error with code `CANNOT_DELETE_DEFAULT`
- [ ] `deleteList(listId)` where `isDefault:false` → removes list, returns success
- [ ] `addContacts(listId, contactIds)`: increments contactCount correctly
- [ ] `addContacts` with a contactId already in the list → no duplicate, count stays same
- [ ] `removeContacts(listId, contactIds)`: decrements contactCount correctly
- [ ] All methods simulate 200-400ms delay
- [ ] All methods have 5% random error simulation
- [ ] All methods return `{ success, data, error }` envelope matching existing pattern

### subscriberService Update
- [ ] `subscriberService.getLists()` return type is `Promise<ServiceResponse<List[]>>`
- [ ] `subscriberService.getLists()` delegates to `listService.getLists()`

## Phase 3: ListManager Component

### Rendering States
- [ ] Component renders without errors when mounted
- [ ] **Loading**: centered spinner visible immediately on mount → disappears after data loads
- [ ] **Empty** (0 active lists): Users icon + "No lists yet" + "Create your first list..." + "Create List" CTA button
- [ ] **Error** (service fails): red banner (`bg-red-50 border-red-200`) with error message + retry option
- [ ] **Default** (1+ lists): grid of list cards + "Create List" button in header

### List Cards
- [ ] Card displays: list name, description, contactCount with comma formatting
- [ ] Status badge: "active" → green (`bg-green-100 text-green-800`), "archived" → gray
- [ ] Default badge: blue (`bg-blue-100 text-blue-800`), text "Default", only on isDefault lists
- [ ] "Created {date}" in relative or formatted date
- [ ] Edit button on card → opens Create/Edit modal pre-filled
- [ ] Delete button on card → opens delete confirmation
- [ ] Click card body (not buttons) → navigates to subscriber list filtered by this list
- [ ] Grid responsive: 1 column at <640px, 2 columns at 640-1024px, 3 columns at >1024px

### Create/Edit Modal
- [ ] "Create List" button in header → modal opens with empty fields
- [ ] Edit button on card → modal opens with name, description, isDefault pre-filled
- [ ] Modal title: "Create List" for new, "Edit List" for editing
- [ ] **Name field**: present, labeled "List Name", has character counter
- [ ] Name empty + blur → "List name is required" appears below field
- [ ] Name with 101+ chars + blur → "List name must be 100 characters or fewer"
- [ ] Name with 1-100 chars → no error
- [ ] **Description field**: present, labeled "Description", has character counter
- [ ] Description with 501+ chars + blur → "Description must be 500 characters or fewer"
- [ ] Description empty → no error (field is optional)
- [ ] **isDefault checkbox**: present, labeled "Set as default list"
- [ ] Checking isDefault when another default exists → inline notice: "Setting this as default will remove the default flag from '{name}'"
- [ ] **Submit with valid data** → "Create List"/"Save" button shows spinner → form fields disabled → on success: modal closes, list refreshes, toast "{name} created/updated successfully"
- [ ] **Submit with invalid data** → validation errors shown, form stays open
- [ ] **Service error on submit** → inline error below form, modal stays open
- [ ] Cancel button → modal closes, no changes saved
- [ ] Escape key → modal closes
- [ ] Click outside modal → modal closes (or does NOT close — match existing project pattern)

### Delete Confirmation
- [ ] Shows list name in the confirmation text
- [ ] Shows contactCount: "The 234 contacts themselves will not be deleted"
- [ ] Default list → error message: "This is your default list. Set another list as default first."
- [ ] Default list → "Delete List" button disabled or hidden
- [ ] Non-default list → "Delete List" button enabled, styled `bg-red-600 text-white`
- [ ] Click "Delete List" → button shows spinner → on success: modal closes, list refreshes, toast "List '{name}' deleted"
- [ ] Click Cancel → modal closes, list unchanged

## Phase 4: ListMembershipModal

- [ ] Renders with heading: "Add {N} Contacts to List(s)" with correct selected count
- [ ] **Loading**: spinner while fetching lists
- [ ] **Empty**: "No active lists found. Create a list first." with link
- [ ] Shows only active lists (archived lists hidden)
- [ ] Each list shows: checkbox + name + contactCount
- [ ] "Add to Lists" button disabled when no checkbox checked
- [ ] Check 1+ lists → "Add to Lists" becomes enabled
- [ ] Click "Add to Lists" → button shows spinner, checkboxes disabled → on success: calls onSuccess callback
- [ ] Service error → inline error message in modal
- [ ] Close (✕) → modal closes, no changes

## Phase 5: SubscriberList Modifications

- [ ] `listId` prop accepted and optional
- [ ] List filter `<select>` dropdown appears in the filter bar
- [ ] Dropdown options include "All Lists" + each active list by name
- [ ] When `listId` prop provided → dropdown replaced with read-only badge showing list name
- [ ] Selecting a list from dropdown → subscriber list filters to that list's contacts
- [ ] "Add to List" button appears in bulk action bar when ≥1 subscriber selected
- [ ] "Add to List" button disabled when 0 subscribers selected
- [ ] Click "Add to List" → ListMembershipModal opens with correct selected IDs
- [ ] After successful add → modal closes, selection cleared, success toast shown

## Phase 6: CampaignWizard Modifications

- [ ] `lists` state typed as `List[]` (not `any[]`)
- [ ] Recipients step shows lists with checkboxes and contactCount
- [ ] Recipients step shows segments with checkboxes
- [ ] Archived lists shown with strikethrough and "[Archived]" badge, not checkable
- [ ] "Estimated reach" displays sum of selected list/segment counts with "(approximate)" label
- [ ] No lists or segments selected + click Next → error: "Please select at least one list or segment"
- [ ] At least one selected + click Next → proceeds to next step
- [ ] Review step shows list names (not IDs)
- [ ] Deleted list ID in campaign data → shows "⚠ List 'X' no longer exists" warning

## Phase 7: Navigation

- [ ] "Lists" nav item appears in tenant sidebar
- [ ] Position: between "Subscribers" and "Segments"
- [ ] Icon: Users from lucide-react
- [ ] Active state styling matches existing nav items
- [ ] Clicking "Lists" → navigates to ListManager component
- [ ] Route `/t/:tenantId/lists` renders ListManager

## Phase 8: Tests

### listService Tests
- [ ] `src/services/listService.test.ts` exists and passes
- [ ] Tests: getLists filters by tenantId
- [ ] Tests: createList sets correct defaults
- [ ] Tests: updateList merges only provided fields
- [ ] Tests: deleteList rejects default list
- [ ] Tests: deleteList succeeds for non-default
- [ ] Tests: addContacts deduplicates
- [ ] Tests: removeContacts decrements count
- [ ] Tests: at least one test for error simulation path

### ListManager Tests
- [ ] `src/components/tenant/ListManager.test.tsx` exists and passes
- [ ] Tests: renders loading state
- [ ] Tests: renders empty state when no lists
- [ ] Tests: renders list cards with correct data
- [ ] Tests: create modal validates required fields
- [ ] Tests: edit modal pre-fills correctly
- [ ] Tests: delete shows contact count warning
- [ ] Tests: default list delete shows guard error

## Final Verification

- [ ] `pnpm tsc --noEmit` — zero TypeScript errors
- [ ] `pnpm test` — all existing tests still pass
- [ ] New test files pass: `pnpm test listService ListManager`
- [ ] No console errors in browser during manual testing
- [ ] End-to-end: Create list → add contacts → use in campaign → send → verify recipients
```

### 3.3 Format Rules for the AI

The verification checklist MUST follow these rules:

1. **Every item is action → expected result.** Not "loading state works" but "when component mounts → spinner visible for 200-400ms → then data or empty state."

2. **Every form field gets at least 3 items:** valid input succeeds, each invalid input shows specific error, validation timing correct.

3. **Every modal gets: open trigger, close (×), close (Escape), close (Cancel), close (click outside), submit success, submit error, submit loading state.** That's 8 minimum items per modal.

4. **Every API-dependent component gets: loading, success with data, success with empty data, error, slow response.** That's 5 minimum items.

5. **The final section is always "Final Verification"** with: TypeScript compiles, existing tests pass, new tests pass, no console errors, one end-to-end flow described.

6. **Items reference the spec sections** so Claude Code can look up details: "See spec Section 5, Create/Edit Modal for field validation table."

7. **Responsive and keyboard items exist** even if the spec didn't detail them (the checklist catches spec gaps):
```markdown
### Responsive Behavior
- [ ] ListManager grid: 1 column <640px, 2 columns 640-1024px, 3 columns >1024px
- [ ] Create/Edit modal: full-width on mobile (<640px), max-width 400px on desktop
- [ ] ListMembershipModal: full-width on mobile, max-width 440px on desktop

### Keyboard Navigation
- [ ] Tab navigates between list cards
- [ ] Enter on focused card → opens card (same as click)
- [ ] Tab into modal → focus trapped inside modal
- [ ] Escape in any open modal → closes modal
- [ ] Enter on "Create List" button → opens modal
```

---

## 4. UI Flow for Checklist Generation

### 4.1 When It's Offered

After the spec is written and the user confirms it's good (or saves it), the AI automatically offers to generate the checklist. This happens in the conversation, not as a separate action:

```
AI: "The specification is ready. Would you like me to adjust anything,
    add detail to a specific section, or save it?"

User: "Looks good, save it."

[User clicks Save → SaveSpecDialog → spec saved to docs/specs/subscriber-list-management.md]

AI: "Saved to docs/specs/subscriber-list-management.md.

    📋 Shall I also generate the verification checklist? This is a companion 
    document that Claude Code uses to self-check every feature, state, and 
    validation from the spec."

    ?> Yes, generate the checklist
    ?> No, the spec is enough

User clicks: "Yes, generate the checklist"

AI: [streams the complete verification checklist document]

[SpecPreview switches to showing the checklist]
[Save button becomes active again]
[User saves → subscriber-list-management-checklist.md]
```

### 4.2 Auto-Offer After Save

The trigger for offering the checklist is in the `onSaved` callback of `SaveSpecDialog`. After a spec is saved successfully:

1. The save dialog closes
2. A system message appears in the chat: "📋 Spec saved. Shall I generate the verification checklist?"
3. Two option buttons appear: "Yes, generate the checklist" / "No, the spec is enough"
4. If the user clicks "Yes," the AI receives a message: "Generate the verification checklist for the spec you just wrote."
5. The AI streams the checklist. The `SPEC_START_PATTERN` won't match (checklist starts with `# ... — Verification Checklist`), so we need a second detection pattern.

### 4.3 Checklist Content Detection

Add a new pattern in `useSpecConversation.ts`:

```typescript
const CHECKLIST_START_PATTERN = /^#\s+.+(?:—|-)\s*(?:Verification |Implementation )?Checklist/m;
```

When detected, set `currentChecklistContent` in the store (new field). The SpecPreview renders it. The save flow saves it with the `-checklist.md` suffix.

### 4.4 Dual Save Awareness

The `SaveSpecDialog` needs to know whether it's saving a spec or a checklist:

- If `currentSpecContent` is being saved → default filename: `{slug}.md`
- If `currentChecklistContent` is being saved → default filename: `{slug}-checklist.md`

The simplest approach: add a `documentType: 'spec' | 'checklist'` prop to `SaveSpecDialog`. The toolbar's save button passes the appropriate content and type.

### 4.5 Toolbar Addition

Add a "Generate Checklist" button to `SpecToolbar` that appears after a spec is written:

```typescript
{canGenerateChecklist && (
  <button onClick={handleGenerateChecklist} disabled={isStreaming}>
    <ClipboardCheck size={13} />
    Generate Checklist
  </button>
)}
```

`canGenerateChecklist` is true when: spec content exists AND no checklist content exists yet AND not streaming.

---

## 5. System Prompt Additions (Both Modes)

Add this section to the END of both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT`, after the existing "AFTER WRITING" section:

```
═══════════════════════════════════════════════════════════════════
VERIFICATION CHECKLIST (after spec is saved)
═══════════════════════════════════════════════════════════════════

After the spec is saved, the user may ask you to generate a verification
checklist. When they do, generate a companion document that Claude Code 
uses to self-verify every feature, state, and validation.

Start the document with:
# {Feature/App Name} — Verification Checklist

**Companion to:** `docs/specs/{spec-filename}.md`
**How to use:** Work through each section after implementing the 
corresponding phase from the spec. Every item must pass.

ORGANIZE by implementation phase (matching the spec's Implementation 
Checklist phases).

FORMAT every item as: action/condition → expected observable result.

RULES:
1. Every COMPONENT gets these minimum checks:
   - [ ] Component renders without errors
   - [ ] Loading state: [what trigger] → [what appears] → [when it disappears]
   - [ ] Empty state: [what condition] → [exact text/UI shown]
   - [ ] Error state: [what trigger] → [exact error display]
   - [ ] Default state: [what data] → [what renders]

2. Every MODAL gets these minimum checks:
   - [ ] [Trigger] → modal opens
   - [ ] Modal has correct title
   - [ ] Close (✕ button) → modal closes, no side effects
   - [ ] Close (Escape key) → modal closes
   - [ ] Close (Cancel button) → modal closes
   - [ ] Submit with valid data → loading state → success → modal closes + toast/callback
   - [ ] Submit with invalid data → validation errors shown, modal stays open
   - [ ] Submit with service error → error message shown, modal stays open

3. Every FORM FIELD gets these minimum checks:
   - [ ] Field is present with correct label
   - [ ] Valid input → no error
   - [ ] Each invalid case → specific error message text + correct timing (blur/submit)
   
4. Every API INTEGRATION gets these checks:
   - [ ] Happy path: request → correct response → UI updates
   - [ ] Error path: request → error → UI shows error state
   - [ ] Loading: request pending → loading indicator visible
   
5. Every NAVIGATION change gets:
   - [ ] Nav item visible in correct position
   - [ ] Click → navigates to correct route
   - [ ] Active state styling when on that route
   
6. ALWAYS end with a "Final Verification" section:
   - [ ] `pnpm tsc --noEmit` — zero TypeScript errors
   - [ ] `pnpm test` — all existing tests pass
   - [ ] New test files pass
   - [ ] No console errors in browser
   - [ ] End-to-end: [describe the primary happy-path flow as a test scenario]

7. ALWAYS include these sections even if the spec didn't detail them:
   ### Responsive Behavior
   - [ ] [component] at mobile (<640px): [expected layout]
   - [ ] [component] at tablet (640-1024px): [expected layout]
   - [ ] [component] at desktop (>1024px): [expected layout]
   - [ ] Modals: full-width on mobile, max-width on desktop
   
   ### Keyboard Navigation
   - [ ] Tab navigates through interactive elements
   - [ ] Enter activates focused buttons/links
   - [ ] Escape closes open modals
   - [ ] Focus trapped inside open modals

8. If the spec has ⚠️ INFERRED or ❓ ASSUMED items, include a 
   "Pre-Implementation Verification" section at the TOP:
   ### Pre-Implementation Verification
   - [ ] Confirm: [⚠️ item 1 — what to check]
   - [ ] Confirm: [⚠️ item 2 — what to check]
   - [ ] Decide: [❓ item — what decision is needed]
   These must be resolved BEFORE starting implementation.

The checklist should be thorough enough that if every item passes,
the feature is complete. No more, no less.
```

---

## 6. Spec Quality Gap Fixes (Prompt Refinements)

These are specific additions to the existing system prompts to address the gaps found in real output.

### 6.1 Fix: Exhaustive Polish Phase

Add to the WRITING RULES section in both prompts, replacing the existing Phase 4 guidance:

```
The Implementation Checklist's final phase (Polish) MUST enumerate 
every single state individually. Do NOT summarize. List each one:

WRONG:
  - [ ] All loading states: ListManager, ListMembershipModal, CampaignWizard
  
RIGHT:
  - [ ] Loading states:
    - [ ] ListManager: centered spinner matching SegmentsPanel
    - [ ] ListManager create modal submit: button spinner + form disabled
    - [ ] ListManager delete modal submit: button spinner
    - [ ] ListMembershipModal: spinner while fetching lists
    - [ ] SubscriberList list filter: "Loading..." in dropdown
    - [ ] CampaignWizard recipients: spinner in lists section

Apply the same exhaustive enumeration for error states, empty states,
toast messages, and form validations. The implementer should be able
to use this as a literal checklist with no interpretation needed.
```

### 6.2 Fix: Responsive Behavior

Add to the component spec writing rules:

```
For EVERY new component, specify responsive behavior:
- Mobile (<640px): [layout description]
- Tablet (640-1024px): [layout description]  
- Desktop (>1024px): [layout description]

For EVERY modal:
- Mobile: full-width with body padding (no horizontal margin)
- Desktop: max-width constraint, centered

If the existing project has breakpoint conventions (check Tailwind config
or existing components), use those. Otherwise use: sm:640px, md:768px, 
lg:1024px, xl:1280px.
```

### 6.3 Fix: Keyboard Navigation

Add to the component spec writing rules:

```
For EVERY interactive component, specify keyboard behavior:
- Focusable elements: which elements can receive Tab focus
- Enter/Space: what they activate
- Escape: what it closes/cancels
- Arrow keys: any list/grid navigation
- Tab trap: modals must trap focus (Tab cycles within modal)

Minimum for any modal: Escape closes, Tab cycles through fields 
and buttons, Enter submits the focused action.
```

### 6.4 Fix: Error Recovery Patterns

Add to Section 7 (Error Handling) writing guidance:

```
For EVERY error state, specify the RECOVERY path — not just what the 
error looks like, but what the user does next:

WRONG:
  "Show error message when API fails"

RIGHT:
  "When listService.getLists() fails:
   → Show red banner: 'Failed to load lists. Please try again.'
   → 'Try Again' button below the message
   → Click 'Try Again' → re-calls getLists(), shows loading spinner
   → If still fails → same error banner (no infinite retry)
   → User can also navigate away and come back (full page reload)"

For save/submit errors:
  "When createList() fails:
   → Modal stays open (do NOT close on error)
   → Inline error below form: '{error message from service}'
   → Submit button re-enabled (user can fix input and retry)
   → After 3 consecutive failures → suggest: 'If this persists, 
     try refreshing the page'"
```

### 6.5 Fix: State Transitions

Add to the component spec writing rules:

```
For complex components with multiple states, describe the STATE 
TRANSITIONS — not just the states, but what triggers each transition:

Component Mount → Loading (immediately)
Loading → Default (service returns data)
Loading → Empty (service returns empty array)
Loading → Error (service returns error)
Error + "Try Again" click → Loading (retry)
Default + "Create List" click → Modal Open (create mode)
Modal Open + Submit success → Default (refresh list + toast)
Modal Open + Submit error → Modal Open (show inline error)
Default + Delete click → Delete Confirm modal
Delete Confirm + confirm → Deleting (spinner on card)
Deleting → Default (card removed + toast) or Error (show error)
```

---

## 7. Implementation Changes

### 7.1 Store Changes (`specWriterStore.ts`)

Add:
```typescript
// In the state interface:
currentChecklistContent: Map<string, string | null>;

// In the actions:
setCurrentChecklistContent: (projectPath: string, content: string | null) => void;
```

### 7.2 Hook Changes (`useSpecConversation.ts`)

Add the checklist detection pattern:
```typescript
const CHECKLIST_START_PATTERN = /^#\s+.+(?:—|-)\s*(?:Verification |Implementation )?Checklist/m;
```

In the `done` handler, after the existing spec detection block:
```typescript
// Check for checklist document output
if (CHECKLIST_START_PATTERN.test(finalContent)) {
  currentStore.setCurrentChecklistContent(projectPath, finalContent);
}
```

Add a new exported function:
```typescript
const generateChecklist = useCallback(
  (projectPath: string) => {
    sendMessage(
      projectPath,
      "Generate the verification checklist for the spec you just wrote. Follow the verification checklist format from your instructions."
    );
  },
  [sendMessage]
);
```

Return it alongside `sendMessage`, `writeSpec`, and `loadContext`.

### 7.3 System Prompt Changes

Append the verification checklist prompt section (from Section 5 above) to both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT`.

Integrate the quality gap fixes (Section 6.1–6.5) into the appropriate locations in the existing prompts:
- 6.1 (Exhaustive Polish) → into the Implementation Checklist section of the writing phase
- 6.2 (Responsive) → into Section 4 (Components) guidance
- 6.3 (Keyboard) → into Section 4 (Components) guidance
- 6.4 (Error Recovery) → into Section 7 (Error Handling) guidance
- 6.5 (State Transitions) → into Section 5 (New & Modified Components) guidance for Feature Mode

### 7.4 Toolbar Changes (`SpecToolbar.tsx`)

Add "Generate Checklist" button:

```typescript
const currentChecklist = useSpecWriterStore(
  (s) => s.currentChecklistContent.get(projectPath)
);
const canGenerateChecklist = !!currentSpec && !currentChecklist && !isStreaming;
const canSaveChecklist = !!currentChecklist && !isStreaming;
```

Add the button between "Save to Project" and "Suggest Features":
```tsx
{canGenerateChecklist && (
  <button onClick={() => generateChecklist(projectPath)} disabled={isStreaming}>
    <ClipboardCheck size={13} />
    Generate Checklist
  </button>
)}

{canSaveChecklist && (
  <button onClick={onSaveChecklist}>
    Save Checklist
  </button>
)}
```

### 7.5 SaveSpecDialog Changes

Add `documentType` prop:

```typescript
interface Props {
  projectPath: string;
  specContent: string;
  aiModel: string;
  mode: string;
  documentType: 'spec' | 'checklist';  // NEW
  onClose: () => void;
  onSaved: (filename: string) => void;
}
```

When `documentType === 'checklist'`:
- Default filename: derive from spec filename with `-checklist` suffix
- Header metadata `Type: Verification Checklist` instead of spec type
- Dialog title: "Save Verification Checklist" instead of "Save Specification"

### 7.6 SpecPreview Changes

The SpecPreview component should show either the spec or the checklist, depending on which was most recently generated:

```typescript
const specContent = useSpecWriterStore(s => s.currentSpecContent.get(projectPath));
const checklistContent = useSpecWriterStore(s => s.currentChecklistContent.get(projectPath));

// Show checklist if it exists and was generated after the spec
// Otherwise show spec
const displayContent = checklistContent ?? specContent;
```

Or better: add a toggle at the top of the preview: **[Spec]** | **[Checklist]** when both exist.

### 7.7 Post-Save Auto-Offer

In the `SpecWriterSlideOver` or wherever the `onSaved` callback is handled, after saving the spec:

```typescript
const handleSpecSaved = (filename: string) => {
  setSaveDialogOpen(false);
  // Auto-offer checklist generation
  if (!checklistContent) {
    store.addMessage(projectPath, {
      id: `msg-${Date.now()}`,
      role: "system",
      content: `📋 Spec saved to docs/specs/${filename}. Shall I generate the verification checklist?`,
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    store.setMessageOptions(projectPath, [
      "Yes, generate the checklist",
      "No, the spec is enough",
    ]);
  }
};
```

And in `useSpecConversation`, detect when the user selects "Yes, generate the checklist" and call `generateChecklist()`.

---

## 8. Completeness Checklist for This Enhancement

### Store Changes
- [ ] `currentChecklistContent` map added to `specWriterStore`
- [ ] `setCurrentChecklistContent` action added
- [ ] Checklist content persists (included in `persistState`/`loadState`)

### Hook Changes
- [ ] `CHECKLIST_START_PATTERN` regex defined
- [ ] Checklist content detected in `done` handler
- [ ] `generateChecklist` function exported from `useSpecConversation`
- [ ] Checklist content stored via `setCurrentChecklistContent`

### System Prompt: Verification Checklist Section
- [ ] Verification checklist prompt added to BOTH `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT`
- [ ] Prompt specifies minimum items per component (5: renders, loading, empty, error, default)
- [ ] Prompt specifies minimum items per modal (8: open, title, close×3, submit×3)
- [ ] Prompt specifies minimum items per form field (3: present, valid, each invalid case)
- [ ] Prompt requires "Final Verification" section with tsc, test, console, e2e
- [ ] Prompt requires responsive and keyboard sections
- [ ] Prompt requires "Pre-Implementation Verification" for ⚠️/❓ items

### System Prompt: Quality Gap Fixes
- [ ] Exhaustive Polish Phase guidance added (6.1) — no summarizing, list every item
- [ ] Responsive behavior guidance added (6.2) — breakpoints per component
- [ ] Keyboard navigation guidance added (6.3) — Tab, Enter, Escape per component
- [ ] Error recovery guidance added (6.4) — recovery path for every error
- [ ] State transition guidance added (6.5) — trigger → new state for complex components

### UI: Toolbar
- [ ] "Generate Checklist" button appears after spec is written
- [ ] Button disabled during streaming
- [ ] Button hidden after checklist is generated
- [ ] "Save Checklist" button appears after checklist is generated

### UI: SaveSpecDialog
- [ ] Accepts `documentType` prop
- [ ] Checklist filename defaults to `{spec-slug}-checklist.md`
- [ ] Dialog title changes based on document type
- [ ] Metadata header includes `Type: Verification Checklist`

### UI: SpecPreview
- [ ] Can display both spec and checklist content
- [ ] Toggle between spec and checklist when both exist
- [ ] Checklist renders with working checkbox styling

### UI: Auto-Offer Flow
- [ ] After saving spec → system message offers checklist generation
- [ ] "Yes" option → triggers `generateChecklist()`
- [ ] "No" option → no action, conversation continues
- [ ] If user manually asks for checklist later → also works

### Output Quality
- [ ] Generated checklist has items for every component in the spec
- [ ] Every modal has ≥8 check items
- [ ] Every form field has ≥3 check items
- [ ] Responsive section present (even if spec didn't specify breakpoints)
- [ ] Keyboard section present
- [ ] Pre-Implementation Verification section present (when spec has ⚠️/❓)
- [ ] Final Verification section present with compile + test + e2e
- [ ] Every item is action → expected result (not just "X works")
