# CodeMantis SpecWriter — Enhancement: Verification Audit Documents

**Type:** Feature enhancement to SpecWriter
**Date:** March 2026
**Priority:** High — this is what transforms SpecWriter from "a spec writer" into a quality assurance system
**Status:** Pre-implementation
**Depends on:** Base SpecWriter (implemented), Enhancement Part 1 context architecture (implemented)

---

## Table of Contents

1. The Problem This Solves
2. What Exists Today vs What This Adds
3. The Verification Audit Document — What It Is
4. Document Format Specification
5. Example: Full Verification Audit Document
6. UI Flow & Trigger Design
7. AI System Prompt Addition
8. Implementation Changes (Code Level)
9. Implementation Checklist

---

## 1. The Problem This Solves

Claude Code is excellent at building forward. It reads a spec, starts at the top, and works its way down. The problem is at the end: Claude Code says "done" and the user trusts it.

**What actually happens when Claude Code says "done":**
- Loading states are implemented for the main view but not for modals
- Error states exist but show generic "Something went wrong" instead of the specific messages from the spec
- Validation rules are partially implemented — required fields work, but character limits don't
- The empty state exists but doesn't match the spec's exact copy
- Integration points are wired but edge cases (deleted reference, archived item) are silently ignored
- Responsive behavior was never touched
- Keyboard navigation was never touched

The current implementation checklist at the bottom of each spec helps — Claude Code treats it as a todo list. But a todo list runs alongside building. Claude Code checks items off as it goes, which means it's checking things off from memory ("I just wrote the loading state") rather than from verification ("I just opened the file, read the code, and confirmed the loading state renders a centered spinner that matches SegmentsPanel").

**The Verification Audit is a separate document designed to be read AFTER implementation.** It shifts Claude Code from generative mode to evaluative mode. It says: "STOP BUILDING. NOW VERIFY. Open each file. Read what's actually there. Compare it to what was specified. Report what passes and what fails."

---

## 2. What Exists Today vs What This Adds

### Today (after base SpecWriter implementation)

```
User → SpecWriter conversation → Spec document generated
  ↓
Spec includes Section 9: Implementation Checklist
  (hierarchical todo list at the bottom)
  ↓
User saves spec to docs/specs/feature-name.md
  ↓
User tells Claude Code: "Read the spec and implement it"
  ↓
Claude Code implements, checking off the todo list as it goes
  ↓
Claude Code says "done" — user hopes everything is right
```

### After this enhancement

```
User → SpecWriter conversation → Spec document generated
  ↓
Spec includes Section 9: Implementation Checklist (unchanged)
  ↓
User saves spec to docs/specs/feature-name.md
  ↓
CodeMantis prominently offers: "📋 Generate Verification Audit?"
  ↓
User clicks yes → AI generates audit document
  ↓
User saves to docs/specs/feature-name.audit.md
  ↓
User tells Claude Code: "Read the spec and implement it"
  ↓
Claude Code implements using the spec + checklist
  ↓
Claude Code says "done"
  ↓
User tells Claude Code: "Now read docs/specs/feature-name.audit.md
  and verify your work. Open every file mentioned. Report PASS/FAIL."
  ↓
Claude Code discovers gaps → fixes them → re-verifies
  ↓
All items pass → feature is actually complete
```

The audit document is the quality gate between "Claude Code thinks it's done" and "it's actually done."

---

## 3. The Verification Audit Document — What It Is

### What it is NOT

It is NOT a checklist. A checklist says:
```
- [ ] ListManager loading state implemented
```

This is useless for verification because Claude Code reads it and thinks "yes, I implemented that" without opening the file.

### What it IS

A guided code review that Claude Code performs on its own work. Each item:

1. **Tells Claude Code which file to open** — "VERIFY: Open src/components/tenant/ListManager.tsx"
2. **Tells it what to look for** — "Find the loading conditional render. What variable controls it?"
3. **States the expected answer** — "Expected: `isLoading` state, set true on mount, false after getLists() resolves"
4. **Describes what failure looks like** — "NOT: spinner stays forever. NOT: empty state flashes before data."
5. **Forces a gate** — "IF ANY ITEM FAILS: Fix before proceeding to next section."

The document is structured so that Claude Code must actually read code, trace logic, and compare against expectations — not just recall what it wrote.

### Three types of verification items

**Type 1: Static code verification**
"Open this file. Find this code. Does it match this expected pattern?"
Used for: type definitions, component props, imports, schema fields.

**Type 2: Logic trace verification**
"What happens when X occurs? Trace the code path from trigger to render."
Used for: state transitions, error handling, conditional rendering, event handlers.

**Type 3: Integration flow verification**
"Follow this user journey across multiple files. Does each step connect correctly?"
Used for: navigation, data passing between components, shared state, API integration.

---

## 4. Document Format Specification

### 4.1 File Naming Convention

```
Spec:   docs/specs/feature-name.md
Audit:  docs/specs/feature-name.audit.md
```

The `.audit.md` suffix (not `-audit.md`, not `-checklist.md`) keeps them visually paired in file listings and clearly distinguishes from the spec.

### 4.2 Document Header

```markdown
<!-- 
  Generated by CodeMantis SpecWriter
  Date: 2026-03-21
  AI Model: claude-sonnet-4-6
  Type: Verification Audit
  Spec: feature-name.md
  Project: /Users/hr/Dev_Projects/ProjectName
-->

# {Feature Name} — Verification Audit

**Companion to:** `docs/specs/feature-name.md`
**When to run:** AFTER implementation is complete. Do NOT use during building.

**How to use:** 
1. Open this document after Claude Code says the feature is implemented
2. Work through every section sequentially — do not skip ahead
3. For each VERIFY directive, actually open the file and read the code
4. Do NOT rely on your memory of what you wrote — read the actual file
5. For each item, report: PASS, FAIL (describe what's wrong), or MISSING
6. Fix all FAIL and MISSING items before moving to the next section
7. After fixing, re-verify the fixed items in the same section
8. Only proceed to the next section when all items in the current section PASS
```

### 4.3 Section Structure

Each section follows this pattern:

```markdown
## Section N: {Area Name}

### {Component/File Name}

VERIFY: Open `{exact file path}`

**{Check Name}**
What to look for: {specific instruction — what code to find, what to read}
Expected: {exact expected behavior, value, pattern, or outcome}
Not expected: {common mistakes to watch for}
```

### 4.4 Required Sections (in order)

Every Verification Audit MUST have these sections:

0. **Pre-Implementation Verification** *(conditional — only when the spec has ⚠️ INFERRED or ❓ ASSUMED items)* — Gated section at the very top. Every uncertain item must be confirmed or decided before implementation starts.
1. **Pre-Flight Checks** — TypeScript compiles, tests pass, no regressions
2. **Data Model Verification** — Types, interfaces, schema fields
3. **Service/API Layer Verification** — Service methods, return types, error handling, slow response behavior
4. **Component Verification** — One sub-section per component, covering all states. Each item cross-references the spec section it came from.
5. **Integration Verification** — How components connect, navigation (position + route + active state), shared state
6. **State Transition Verification** — For each complex component: trigger → state change sequences
7. **Edge Case Verification** — Every edge case from spec Section 8
8. **Validation Verification** — Every form field, every rule, every error message
9. **UI Polish Verification** — Loading states, empty states, error states, toast messages (every one individually)
10. **Full User Journey Trace** — One end-to-end flow exercising the entire feature
11. **Final Audit Summary** — PASS/FAIL/MISSING counts, completion determination

### 4.5 Severity Markers

Each verification item gets a severity that tells Claude Code how to prioritize fixes:

```
🔴 CRITICAL — Feature is broken or missing. Must fix before any other work.
🟡 IMPORTANT — Feature works but doesn't match spec. Fix before sign-off.
🟢 POLISH — Minor discrepancy. Fix if time allows, note for future.
```

---

## 5. Example: Full Verification Audit Document (Excerpt)

This is what the AI should generate for the subscriber-list-management spec. Showing representative sections, not the complete document:

```markdown
# Subscriber List Management — Verification Audit

**Companion to:** `docs/specs/subscriber-list-management.md`
**When to run:** AFTER implementation is complete. Do NOT use during building.
[...header as specified in 4.2...]

---

## Pre-Flight Checks

VERIFY: Run `pnpm tsc --noEmit` in the project root.
Expected: Zero TypeScript errors.
🔴 CRITICAL — If there are type errors, fix them before any verification.
The rest of this audit assumes the code compiles.

VERIFY: Run `pnpm test` in the project root.
Expected: All pre-existing tests pass. Zero regressions.
🔴 CRITICAL — If existing tests fail, the new code broke something.
Fix regressions before proceeding.

---

## Section 1: Data Model Verification

### List Interface

VERIFY: Open `src/types/list.ts`

**1.1 List interface exists and has correct fields** 🟡 IMPORTANT
What to look for: An exported `List` interface.
Expected fields (every one must be present with exact types):
  - `id: string`
  - `tenantId: string`
  - `name: string`
  - `description: string`
  - `contactCount: number`
  - `status: 'active' | 'archived'` ← must be a union type, NOT `string`
  - `isDefault: boolean`
  - `createdAt: string`
  - `updatedAt: string`
Not expected: `status: string` (too loose). Missing `isDefault` (commonly dropped).

**1.2 ListMembership interface** 🟡 IMPORTANT
What to look for: An exported `ListMembership` interface.
Expected fields: id, listId, contactId, subscribedAt, source
Expected: `source: 'manual' | 'import' | 'api' | 'form'` as a union type.

**1.3 Payload interfaces** 🟢 POLISH
What to look for: `ListCreatePayload` and `ListUpdatePayload` exported.
Expected: CreatePayload has `name` (required), `description`, `isDefault`.
Expected: UpdatePayload has ALL fields optional (Partial pattern).

### Contact Interface Extension

VERIFY: Open `src/types/index.ts`

**1.4 Contact has listIds field** 🟡 IMPORTANT
What to look for: The `Contact` interface.
Expected: Contains `listIds?: string[]` as an optional field.
Not expected: Missing entirely. Or `listIds: string[]` without the `?` (would 
break existing code that doesn't set it).

### Segment Type Promotion

VERIFY: Open `src/types/index.ts`

**1.5 Segment and SegmentCondition are exported from shared types** 🟡 IMPORTANT
What to look for: `Segment` and `SegmentCondition` interfaces in this file.
Expected: Both interfaces present with fields matching the spec.

VERIFY: Open `src/components/tenant/SegmentsPanel.tsx`

**1.6 Local Segment interface removed** 🟢 POLISH
What to look for: NO local `interface Segment` or `interface SegmentCondition`.
Expected: Import from `../../types` instead.
Not expected: Both local AND imported definitions (duplicate type).

IF ANY ITEM FAILS: Fix all data model issues before proceeding.
Data model errors cascade — everything downstream depends on correct types.

---

## Section 2: Service Layer Verification

### listService

VERIFY: Open `src/services/listService.ts`

**2.1 All 8 methods exist** 🔴 CRITICAL
What to look for: The exported `listService` object.
Expected methods (check each one exists):
  - `getLists(tenantId?: string)`
  - `getList(listId: string)`
  - `createList(tenantId: string, payload: ListCreatePayload)`
  - `updateList(listId: string, payload: ListUpdatePayload)`
  - `deleteList(listId: string)`
  - `getListContacts(listId: string, page: number, pageSize: number)`
  - `addContacts(listId: string, contactIds: string[])`
  - `removeContacts(listId: string, contactIds: string[])`
Not expected: Missing methods. Synchronous methods (all should be async).
Methods returning raw data instead of ServiceResponse envelope.

**2.2 deleteList guards default list** 🟡 IMPORTANT
What to look for: Inside `deleteList`, a check for `isDefault: true`.
Expected: If the list being deleted has `isDefault: true`, return an error 
response with code `CANNOT_DELETE_DEFAULT` and message "Cannot delete the 
default list. Set another list as default first."
Not expected: Silently deleting the default list. Throwing an exception instead 
of returning an error response. Missing the guard entirely.

Trace the logic: Find the list by ID → check isDefault → if true, return error 
→ if false, proceed with deletion.

**2.3 addContacts deduplicates** 🟡 IMPORTANT
What to look for: Inside `addContacts`, a check preventing duplicate membership.
Expected: If a contact is already in the list (their `listIds` already includes 
this listId), skip them. Do NOT increment `contactCount` for duplicates.
Trace: Get the list → for each contactId → check if already a member → 
skip if yes → add if no → increment count only for newly added.

**2.4 Error simulation** 🟢 POLISH
What to look for: A random error simulation (5% chance) in each method.
Expected: `Math.random() < 0.05` or similar, returning an error response.
This matches the existing mock service pattern in the project.

IF ANY ITEM FAILS: Fix service layer before proceeding to components.
Components depend on correct service behavior.

---

## Section 3: Component Verification — ListManager

VERIFY: Open `src/components/tenant/ListManager.tsx`

### Loading State

**3.1 Loading state renders correctly** 🟡 IMPORTANT
What to look for: A conditional render based on a loading boolean.
Expected: Centered spinner component (matching SegmentsPanel's loading pattern).
Not expected: Text "Loading..." without spinner. Loading and list cards both 
visible simultaneously. Loading and empty state both visible.

**3.2 Loading state is the ONLY thing visible while loading** 🟡 IMPORTANT
Trace: When the component mounts → state is set to loading → render function 
returns ONLY the spinner. No "Create List" button. No grid. No empty state.
The spinner should be the exclusive render during loading.

**3.3 Loading → data transition** 🟢 POLISH
Trace: getLists() resolves with data → loading state set to false → list data 
set in state → render function switches to the list grid.
Expected: No flash of empty state between loading and data render.

### Empty State

**3.4 Empty state renders when no lists exist** 🟡 IMPORTANT
What to look for: Conditional render when lists array is empty (after loading).
Expected: 
  - Users icon (from lucide-react)
  - Heading: "No lists yet"
  - Subtext: "Create your first list to organize your subscribers."
  - CTA button: "Create List"
Check the EXACT text. If the spec says "No lists yet" and the code says 
"No lists found", that's a FAIL — the copy must match.

**3.5 Empty state CTA works** 🟡 IMPORTANT
Trace: Click the "Create List" button in the empty state → the create/edit modal 
should open with empty fields, in create mode.
Check: Does the empty state's button use the same handler as the header's 
"Create List" button? It should.

### Error State

**3.6 Error state renders on service failure** 🟡 IMPORTANT
What to look for: Error handling around the getLists() call.
Expected: Red banner matching CampaignList error pattern: 
`bg-red-50 border border-red-200 rounded-md p-4`
Check: Does it show the actual error message from the service response? 
Or a generic "Something went wrong"? The spec says to show the service error.

**3.7 Error state has retry** 🟡 IMPORTANT
What to look for: A retry mechanism in the error state.
Expected: "Try again" button or link that re-calls getLists().
Trace: Click retry → loading state shows again → getLists() called again.

### Create/Edit Modal

**3.8 Modal opens in create mode** 🟡 IMPORTANT
Trace: Click "Create List" button (in header or empty state) → modal appears.
Expected: Title is "Create List". All fields empty. isDefault unchecked.

**3.9 Modal opens in edit mode** 🟡 IMPORTANT
Trace: Click "Edit" button on a list card → modal appears.
Expected: Title is "Edit List". Name pre-filled. Description pre-filled. 
isDefault reflects the list's current value.

**3.10 Name field validation — empty** 🔴 CRITICAL
Trace: Leave name empty → blur the field (or click submit).
Expected: Error message "List name is required" appears below the field.
Check timing: Does it appear on blur, on submit, or both? Spec says both.

**3.11 Name field validation — too long** 🟡 IMPORTANT
Trace: Enter 101+ characters in the name field → blur.
Expected: Error message "List name must be 100 characters or fewer".
Check: Is there a character counter visible? Spec says yes.

**3.12 Description field validation** 🟡 IMPORTANT
Trace: Enter 501+ characters in the description field → blur.
Expected: Error message "Description must be 500 characters or fewer".
Check: Description is optional — empty description should NOT show an error.

**3.13 isDefault checkbox warning** 🟡 IMPORTANT
Trace: Check "Set as default list" when another list is already default.
Expected: Inline notice appears: "Setting this as default will remove the 
default flag from '{existing default list name}'".
Not expected: Silent acceptance. Alert/confirm dialog. Error message.

**3.14 Successful submission** 🟡 IMPORTANT
Trace: Fill valid data → click "Create List" → 
Expected sequence: Button shows spinner → form fields disabled → 
service call succeeds → modal closes → list refreshes → 
toast appears: "List '{name}' created successfully".
Check EACH step in this sequence. Common failures: toast missing, 
list doesn't refresh, modal stays open.

**3.15 Failed submission** 🟡 IMPORTANT
Trace: Fill valid data → click "Create List" → service returns error.
Expected: Inline error message below form. Modal stays OPEN (not closes).
Submit button re-enabled so user can retry.
Not expected: Modal closes on error. Toast instead of inline error.
Unrecoverable state (button stays disabled forever).

IF ANY ITEM FAILS: Fix ListManager before proceeding. This is the core 
new component — it must be solid.

---

[Sections 4-8 continue with same depth for ListMembershipModal, 
SubscriberList modifications, CampaignWizard modifications, 
Navigation, and Tests]

---

## Section 9: Full User Journey Trace

This is the integration test. Trace the ENTIRE feature through the code 
across all components and services.

**Journey: Create a list, add contacts, use in campaign**

Step 1: Navigate to /t/:tenantId/lists (no lists exist yet)
  → ListManager mounts → loading spinner → getLists returns [] → empty state
  VERIFY: Empty state is visible with correct copy and CTA.

Step 2: Click "Create List" in empty state
  → Modal opens in create mode
  VERIFY: Title says "Create List". Fields are empty.

Step 3: Enter name "VIP Customers", description "High-value clients", 
check isDefault → click Create
  → Service call → success → modal closes → list refreshes
  VERIFY: List card appears with name "VIP Customers", contactCount 0, 
  "Default" badge visible.

Step 4: Navigate to /t/:tenantId/subscribers
  → SubscriberList loads with list filter dropdown
  VERIFY: Dropdown includes "All Lists" and "VIP Customers".

Step 5: Select 3 subscribers → click "Add to List"
  → ListMembershipModal opens showing available lists
  VERIFY: "VIP Customers" appears with checkbox. Check it. Click "Add to Lists".

Step 6: Modal closes → success
  VERIFY: Toast shows "Added 3 contact(s) to 1 list(s)".

Step 7: Navigate back to /t/:tenantId/lists
  VERIFY: "VIP Customers" card now shows contactCount 3.

Step 8: Navigate to Campaign Wizard → reach recipients step
  VERIFY: "VIP Customers" appears with checkbox showing "3 contacts".
  Select it. "Estimated reach: 3 unique contacts (approximate)" displays.

Step 9: Proceed through wizard to review step
  VERIFY: Review shows "VIP Customers" by name (not by ID).

**IF ANY STEP FAILS:** The integration between components is broken.
Identify which component's output doesn't match the next component's 
expected input and fix the connection.

---

## Section 10: Final Audit Summary

After completing all sections, tally:

```
Total items checked: ___
PASS:    ___
FAIL:    ___  (list item numbers)
MISSING: ___  (list item numbers)

🔴 CRITICAL failures: ___
🟡 IMPORTANT failures: ___
🟢 POLISH failures: ___
```

**If 🔴 CRITICAL > 0:** Feature is not shippable. Fix immediately.
**If 🟡 IMPORTANT > 0:** Feature works but has quality gaps. Fix before merge.
**If only 🟢 POLISH > 0:** Feature is shippable. Fix these in a follow-up.
**If all PASS:** Feature is verified complete. Ready for merge.
```

---

## 6. UI Flow & Trigger Design

### 6.1 Primary Trigger: After Saving the Spec

When the user saves a spec via `SaveSpecDialog`, and no audit document has been generated yet for this spec, CodeMantis shows a prominent prompt.

**Implementation:** In the `onSaved` callback of `SaveSpecDialog` (in `SpecWriterSlideOver.tsx` or wherever the save flow is handled):

After save succeeds:
1. A system message appears in the chat:

   ```
   ✅ Spec saved to docs/specs/feature-name.md

   📋 Generate a Verification Audit? This is a companion document that 
   Claude Code uses to self-check its implementation — it opens every 
   file, reads the actual code, and verifies it matches the spec.

   This is the single most important step for implementation quality.
   ```

2. Two option buttons appear:
   - "📋 Yes, generate the Verification Audit"
   - "Not now — I'll generate it later"

3. If "Yes" → calls `generateAudit(projectPath)` which sends the AI a message to produce the audit document
4. If "Not now" → the toolbar shows a persistent "📋 Generate Audit" button so the user can trigger it later

### 6.2 Secondary Trigger: Toolbar Button

The `SpecToolbar` gains a "Generate Audit" button that appears when:
- A spec has been generated (`currentSpecContent` is not null)
- No audit has been generated yet (`currentAuditContent` is null)
- Not currently streaming

```
[Reset] [Generate Spec] [Save to Project] [📋 Generate Audit] [💡 Suggest Features]
```

After the audit is generated, the button changes to "Save Audit" (same pattern as "Save to Project" for the spec).

### 6.3 Audit Content in the Preview

When the audit is generated, the `SpecPreview` component needs to switch between showing the spec and the audit:

**Add a tab bar at the top of SpecPreview:**
```
[Specification] [Verification Audit]
```

When both exist, the user can toggle between them. The most recently generated document is shown by default. Each tab shows the respective markdown content rendered.

### 6.4 Saving the Audit

The `SaveSpecDialog` needs to handle both document types. When saving an audit:
- Default filename: `{spec-slug}.audit.md` (derived from the spec's filename)
- Header metadata includes `Type: Verification Audit` and `Spec: {spec-filename}`
- Dialog title: "Save Verification Audit"

### 6.5 Post-Save Message: How to Use the Audit

After saving the audit, show an inline message in the chat:

```
✅ Verification Audit saved to docs/specs/feature-name.audit.md

📌 How to use it:
1. Tell Claude Code: "Read docs/specs/feature-name.md and implement it"
2. After Claude Code says it's done, tell it:
   "Read docs/specs/feature-name.audit.md and verify your work.
    Open every file mentioned, read the actual code, and report 
    PASS/FAIL for each item."
3. Claude Code will find gaps and fix them.

💡 Copy this prompt to use after implementation:
```

Below that, show a copyable text block:
```
Read docs/specs/feature-name.audit.md and verify your implementation.
For every VERIFY directive, open the actual file and read the code.
Report PASS, FAIL, or MISSING for each item. Fix all failures.
```

---

## 7. AI System Prompt Addition

Add this block to the END of both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT` in `useSpecConversation.ts`, after the existing "AFTER WRITING" section:

```
═══════════════════════════════════════════════════════════════════
VERIFICATION AUDIT (after spec is saved)
═══════════════════════════════════════════════════════════════════

After the spec is saved, the user may ask you to generate a Verification
Audit. This is a DIFFERENT document from the implementation checklist 
already in the spec. The checklist is a todo list for building. The 
audit is a guided code review for AFTER building.

When asked to generate the audit, produce a document starting with:
# {Feature/App Name} — Verification Audit

The audit is designed to be read by Claude Code AFTER it has 
implemented the spec. Its job is to force Claude Code to:
1. Open actual files (not rely on memory)
2. Read actual code (not assume correctness)  
3. Compare against specific expectations (not vague "works")
4. Report what passes and what fails
5. Fix failures before moving on

DOCUMENT STRUCTURE (mandatory sections in order):

## Pre-Flight Checks
- TypeScript compiles: `pnpm tsc --noEmit`
- All existing tests pass: `pnpm test`
- These are 🔴 CRITICAL — stop if they fail

## Data Model Verification  
For each type/interface in the spec:
- VERIFY: Open {file path}
- Check each field exists with correct type
- Check union types are unions (not string)
- Check optional fields have ?

## Service/API Layer Verification
For each service method:
- VERIFY: Open {file path}
- Check method exists with correct signature
- Trace key logic paths (guards, error handling, dedup)
- Check return type matches ServiceResponse pattern

## Component Verification (one sub-section per component)
For each component:
- VERIFY: Open {file path}
- Check EVERY state: loading, empty, error, default
  For each state:
  - What triggers this state?
  - What renders? (Be specific: component name, text, styling)
  - What should NOT render alongside it?
- Check every modal:
  - Open trigger, close (×/Escape/Cancel), submit success, submit error
  - Every form field: present, labeled, validated (each rule + message + timing)
- Check every button/action:
  - Click → what happens? Loading indicator? Service call? Toast? Redirect?

## Integration Verification
For each integration point from the spec:
- Trace the data flow between components
- Verify navigation paths (Component A click → Component B renders with correct props)
- Check shared state (stores, URL params, props)

## State Transition Verification
For complex components (3+ states), map:
  Mount → Loading
  Loading + data → Default
  Loading + empty → Empty  
  Loading + error → Error
  Error + retry → Loading
  Default + create click → Modal open
  ...etc
VERIFY each transition exists in the code.

## Edge Case Verification
For every edge case from spec Section 8:
  - VERIFY: {exact scenario}
  - Expected: {exact behavior}
  - This catches the cases Claude Code most commonly drops.

## Validation Verification  
For every form field with validation:
  - Field present with correct label
  - Valid input: no error
  - Each invalid input: specific error message + timing (blur/submit)
  List EVERY field and EVERY rule individually. Do not group.

## UI Polish Verification
List EVERY loading state, EVERY empty state, EVERY error state, 
EVERY toast message individually with:
  - Where it appears
  - What triggers it
  - What it looks like (component, text, styling)

## Full User Journey Trace
One end-to-end scenario exercising the entire feature:
  Step 1: {starting state} → {action} → {expected result}
  Step 2: {from step 1 result} → {action} → {expected result}
  ...through to completion
  This catches integration bugs that component-level checks miss.

## Final Audit Summary
Template for tallying results:
  Total items: ___
  PASS: ___
  FAIL: ___ (list numbers)
  MISSING: ___ (list numbers)
  🔴 CRITICAL: ___
  🟡 IMPORTANT: ___
  🟢 POLISH: ___

FORMAT RULES:

1. Every check starts with "VERIFY: Open {exact file path}"
   This forces the reader to actually open the file.

2. Every check has "Expected: {specific outcome}"
   Not "loading state works" but "centered spinner matching SegmentsPanel,
   no other content visible during loading."

3. Every check has a severity: 🔴 CRITICAL, 🟡 IMPORTANT, or 🟢 POLISH

4. Complex checks include "Trace:" instructions that walk through 
   the code logic step by step.

5. Every check includes "Not expected:" for common mistakes:
   "Not expected: spinner stays forever. Not expected: empty state 
   flashes before data arrives."

6. Each section ends with a gate:
   "IF ANY ITEM FAILS: Fix before proceeding to next section."

7. Form validation checks are INDIVIDUAL — one check per field per rule.
   Not "all validations work" but 3+ checks per field.

8. Modal checks cover ALL close paths: ×, Escape, Cancel, click outside,
   successful submit, failed submit. That's 6+ checks per modal.

9. The Full User Journey at the end must be a COMPLETE flow, not a 
   summary. Every step, every expected outcome, every screen transition.

10. Use the actual file paths from the spec — never invent paths 
    you haven't confirmed.

11. If the spec has ⚠️ INFERRED or ❓ ASSUMED items, include a 
    "Pre-Implementation Verification" section at the VERY TOP of the
    audit (before Pre-Flight Checks):
    
    ### Pre-Implementation Verification
    These must be resolved BEFORE starting implementation:
    - [ ] Confirm: [⚠️ item — what to verify and where]
    - [ ] Confirm: [⚠️ item — what to verify and where]
    - [ ] Decide: [❓ item — what decision is needed and who decides]
    
    This is a GATE. Do not start implementing until all items are resolved.

12. Every verification item should CROSS-REFERENCE the spec section it 
    comes from. Example:
    "Expected: centered spinner matching SegmentsPanel pattern 
    (see spec Section 5, ListManager States table)"
    This lets the implementer look up the original requirement immediately 
    when something fails.

13. Every API-dependent component must include a SLOW RESPONSE check:
    "Simulate: What happens if the API call takes 5+ seconds?
    Expected: loading indicator stays visible the entire time. No timeout
    error. No flash of empty state. No UI freeze."
    This catches a category of bugs that normal happy-path checks miss.

14. Every NAVIGATION change must verify ALL THREE of:
    - [ ] Nav item visible in correct position relative to siblings
    - [ ] Click navigates to correct route (check URL changes)
    - [ ] Active state styling applied when on that route (and removed 
          when navigating away)
```

---

## 8. Implementation Changes (Code Level)

### 8.1 Store: `specWriterStore.ts`

Add to state:
```typescript
currentAuditContent: Map<string, string | null>;
```

Add actions:
```typescript
setCurrentAuditContent: (projectPath: string, content: string | null) => void;
```

Include `currentAuditContent` in `persistState` and `loadState` so it survives across sessions.

### 8.2 Hook: `useSpecConversation.ts`

Add detection pattern:
```typescript
const AUDIT_START_PATTERN = /^#\s+.+(?:—|-)\s*Verification Audit/m;
```

In the `done` handler, after the existing spec detection and checklist detection:
```typescript
if (AUDIT_START_PATTERN.test(finalContent)) {
  currentStore.setCurrentAuditContent(projectPath, finalContent);
}
```

Add new exported function:
```typescript
const generateAudit = useCallback(
  (projectPath: string) => {
    sendMessage(
      projectPath,
      "Generate the Verification Audit document for the spec you just wrote. " +
      "This is a guided code review document that Claude Code will use AFTER " +
      "implementation to verify every component, state, validation, and " +
      "integration point. Follow the Verification Audit format from your instructions."
    );
  },
  [sendMessage]
);
```

Return it alongside `sendMessage`, `writeSpec`, and `loadContext`.

### 8.3 Toolbar: `SpecToolbar.tsx`

Add the audit button and save-audit button:

```typescript
import { ClipboardCheck } from "lucide-react";

// In the component:
const currentAudit = useSpecWriterStore(
  (s) => s.currentAuditContent.get(projectPath)
);
const { generateAudit } = useSpecConversation();
const canGenerateAudit = !!currentSpec && !currentAudit && !isStreaming;
const canSaveAudit = !!currentAudit && !isStreaming;
```

Render between "Save to Project" and "Suggest Features":
```tsx
{canGenerateAudit && (
  <button onClick={() => generateAudit(projectPath)} disabled={isStreaming}>
    <ClipboardCheck size={13} />
    Generate Audit
  </button>
)}

{canSaveAudit && (
  <button onClick={onSaveAudit}>
    <ClipboardCheck size={13} />
    Save Audit
  </button>
)}
```

The `onSaveAudit` prop is passed from `SpecWriterSlideOver` and opens `SaveSpecDialog` with `documentType: 'audit'`.

### 8.4 SaveSpecDialog Changes

Add `documentType` prop:

```typescript
interface Props {
  projectPath: string;
  specContent: string;
  aiModel: string;
  mode: string;
  documentType: 'spec' | 'audit';  // NEW
  onClose: () => void;
  onSaved: (filename: string) => void;
}
```

When `documentType === 'audit'`:
- Default filename: derive from the spec filename with `.audit.md` extension
  (if spec was `subscriber-list-management.md`, audit is `subscriber-list-management.audit.md`)
- Metadata header: `Type: Verification Audit` and `Spec: {spec-filename}`
- Dialog title: "Save Verification Audit"

The filename derivation:
```typescript
useEffect(() => {
  if (documentType === 'audit') {
    // Find the most recently saved spec filename for this project
    const specs = savedSpecs.filter(s => !s.filename.endsWith('.audit.md'));
    const latestSpec = specs[specs.length - 1];
    if (latestSpec) {
      setFilename(latestSpec.filename.replace(/\.md$/, '.audit.md'));
    } else {
      const titleMatch = specContent.match(/^#\s+(.+?)(?:\s*[—-]\s*.+)?$/m);
      setFilename(titleMatch ? slugify(titleMatch[1]) + '.audit.md' : `audit-${Date.now()}.md`);
    }
  } else {
    // existing spec filename logic
  }
}, [specContent, documentType, savedSpecs]);
```

### 8.5 SpecPreview Changes

Add a tab bar when both spec and audit content exist:

```typescript
const specContent = useSpecWriterStore(s => s.currentSpecContent.get(projectPath));
const auditContent = useSpecWriterStore(s => s.currentAuditContent.get(projectPath));
const [activeTab, setActiveTab] = useState<'spec' | 'audit'>('spec');

// Auto-switch to audit when it's generated
useEffect(() => {
  if (auditContent) setActiveTab('audit');
}, [auditContent]);

const displayContent = activeTab === 'audit' ? auditContent : specContent;
const hasBothDocuments = !!specContent && !!auditContent;
```

Render the tab bar:
```tsx
{hasBothDocuments && (
  <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
    <button 
      onClick={() => setActiveTab('spec')}
      className={activeTab === 'spec' ? 'active-tab' : 'inactive-tab'}>
      Specification
    </button>
    <button 
      onClick={() => setActiveTab('audit')}
      className={activeTab === 'audit' ? 'active-tab' : 'inactive-tab'}>
      Verification Audit
    </button>
  </div>
)}
```

### 8.6 Post-Save Auto-Offer

In the save handler for specs (not audits):

```typescript
const handleSpecSaved = (filename: string) => {
  setSaveDialogOpen(false);
  refreshSavedSpecs(); // refresh the list
  
  // Auto-offer audit generation if no audit exists yet
  const auditContent = useSpecWriterStore.getState().currentAuditContent.get(projectPath);
  if (!auditContent) {
    const store = useSpecWriterStore.getState();
    store.addMessage(projectPath, {
      id: `msg-audit-offer-${Date.now()}`,
      role: "system",
      content: `✅ Spec saved to docs/specs/${filename}\n\n📋 **Generate a Verification Audit?** This is a companion document that Claude Code uses to self-check its implementation — it opens every file, reads the actual code, and verifies it matches the spec. This is the single most important step for implementation quality.`,
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    store.setMessageOptions(projectPath, [
      "📋 Yes, generate the Verification Audit",
      "Not now — I'll generate it later",
    ]);
  }
};
```

### 8.7 Post-Audit-Save Usage Hint

After saving the audit:

```typescript
const handleAuditSaved = (filename: string) => {
  setSaveDialogOpen(false);
  refreshSavedSpecs();
  
  const specFilename = filename.replace('.audit.md', '.md');
  const store = useSpecWriterStore.getState();
  store.addMessage(projectPath, {
    id: `msg-audit-saved-${Date.now()}`,
    role: "system",
    content: `✅ Verification Audit saved to docs/specs/${filename}\n\n📌 **How to use it:**\n1. Tell Claude Code: "Read docs/specs/${specFilename} and implement it"\n2. After Claude Code says it's done, tell it:\n   "Read docs/specs/${filename} and verify your work. Open every file mentioned, read the actual code, and report PASS/FAIL for each item."\n\n💡 Copy this prompt for after implementation:`,
    message_type: "conversation",
    timestamp: new Date().toISOString(),
  });
  // The copyable prompt block could be rendered specially by SpecChatMessage
};
```

### 8.8 System Prompt Update

Append the verification audit prompt block from Section 7 to both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT` in `useSpecConversation.ts`. This is a text addition to the existing prompt strings — no structural changes to the hook needed beyond what's described above.

### 8.9 CLAUDE.md Integration (After Saving Audit)

After the audit is saved, CodeMantis offers to add a workflow instruction to the project's `CLAUDE.md`. This is the single most impactful thing we can do to ensure Claude Code runs the audit — it reads CLAUDE.md at the start of every session.

**What gets added to CLAUDE.md:**

```markdown
## SpecWriter Verification Workflow

When implementing a spec from docs/specs/:
1. Read the spec file (e.g., docs/specs/feature-name.md)
2. Implement all items in the Implementation Checklist (Section 9)
3. When done, BEFORE saying you're finished:
   - Check if a matching .audit.md file exists (e.g., docs/specs/feature-name.audit.md)
   - If yes, read it and run the verification audit
   - For each VERIFY directive, open the actual file and read the code
   - Report PASS/FAIL for each item
   - Fix all failures
   - Only then say "Implementation complete"
4. Never skip step 3. The verification audit catches issues that the implementation checklist misses.
```

**How the offer works:**

After `handleAuditSaved` runs (Section 8.7), add a follow-up message:

```typescript
// After the usage hint message, offer CLAUDE.md integration
store.addMessage(projectPath, {
  id: `msg-claudemd-offer-${Date.now()}`,
  role: "system",
  content: `📝 **Add verification workflow to CLAUDE.md?**\nThis adds an instruction to your project's CLAUDE.md so Claude Code automatically runs the verification audit after implementing a spec. Claude Code reads CLAUDE.md at the start of every session.`,
  message_type: "conversation",
  timestamp: new Date().toISOString(),
});
store.setMessageOptions(projectPath, [
  "📝 Yes, add to CLAUDE.md",
  "No, skip this",
]);
```

**When the user clicks "Yes, add to CLAUDE.md":**

New Tauri command: `add_verification_workflow_to_claude_md`

```rust
#[tauri::command]
pub async fn add_verification_workflow_to_claude_md(
    project_path: String,
) -> Result<String, String> {
    let claude_md_path = Path::new(&project_path).join("CLAUDE.md");
    
    let workflow_section = r#"
## SpecWriter Verification Workflow

When implementing a spec from docs/specs/:
1. Read the spec file (e.g., docs/specs/feature-name.md)
2. Implement all items in the Implementation Checklist (Section 9)
3. When done, BEFORE saying you're finished:
   - Check if a matching .audit.md file exists (e.g., docs/specs/feature-name.audit.md)
   - If yes, read it and run the verification audit
   - For each VERIFY directive, open the actual file and read the code
   - Report PASS/FAIL for each item
   - Fix all failures
   - Only then say "Implementation complete"
4. Never skip step 3. The verification audit catches issues that the implementation checklist misses.
"#;

    // DEDUP CHECK: Read existing CLAUDE.md and check if the section already exists
    let existing_content = if claude_md_path.exists() {
        std::fs::read_to_string(&claude_md_path)
            .map_err(|e| format!("Failed to read CLAUDE.md: {}", e))?
    } else {
        String::new()
    };
    
    // Check for the section header — if it's already there, don't add again
    if existing_content.contains("## SpecWriter Verification Workflow") {
        return Ok("already_exists".to_string());
    }
    
    // Append the section to the end of CLAUDE.md
    let new_content = if existing_content.is_empty() {
        // No CLAUDE.md exists — create one with just this section
        format!("# CLAUDE.md\n{}", workflow_section)
    } else {
        // Append to existing file with a blank line separator
        format!("{}\n{}", existing_content.trim_end(), workflow_section)
    };
    
    std::fs::write(&claude_md_path, new_content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
    
    Ok("added".to_string())
}
```

**Frontend handling of the response:**

```typescript
const handleAddToClaudeMd = async () => {
  try {
    const result = await addVerificationWorkflowToClaudeMd(projectPath);
    if (result === "already_exists") {
      showToast("Verification workflow already in CLAUDE.md", "info");
    } else {
      showToast("Added verification workflow to CLAUDE.md", "success");
    }
  } catch (e) {
    showToast(`Failed to update CLAUDE.md: ${e}`, "error");
  }
};
```

**Dedup logic summary:**
- Read the existing CLAUDE.md content
- Search for the string `"## SpecWriter Verification Workflow"`
- If found → show toast "already exists", don't modify the file
- If not found → append the section to the end of the file
- If CLAUDE.md doesn't exist → create it with a minimal header + the section

This ensures the workflow section is added exactly once, no matter how many specs and audits the user generates.

---

## 9. Implementation Checklist

### Store Changes
- [ ] `currentAuditContent: Map<string, string | null>` added to state
- [ ] `setCurrentAuditContent` action added
- [ ] Audit content included in `persistState` and `loadState`

### Hook Changes
- [ ] `AUDIT_START_PATTERN` regex defined
- [ ] Audit content detected in `done` handler and stored
- [ ] `generateAudit` function exported from `useSpecConversation`

### System Prompt
- [ ] Verification Audit prompt section appended to `NEW_APP_PROMPT`
- [ ] Verification Audit prompt section appended to `FEATURE_MODE_PROMPT`
- [ ] Prompt includes all 14 format rules
- [ ] Prompt specifies mandatory sections (Pre-Implementation through Final Summary)
- [ ] Prompt specifies severity markers (🔴 🟡 🟢)
- [ ] Prompt specifies "VERIFY: Open {path}" directive format
- [ ] Prompt specifies "Expected:" and "Not expected:" format
- [ ] Prompt specifies gate pattern: "IF ANY ITEM FAILS: Fix before proceeding"
- [ ] Rule 11: Pre-Implementation Verification section for ⚠️/❓ items
- [ ] Rule 12: Spec section cross-references in every item
- [ ] Rule 13: Slow response (5+ second) check for API-dependent components
- [ ] Rule 14: Navigation verification (position + route + active state)

### Toolbar
- [ ] "Generate Audit" button appears when spec exists + no audit + not streaming
- [ ] "Save Audit" button appears when audit exists + not streaming
- [ ] Buttons use `ClipboardCheck` icon from lucide-react
- [ ] `generateAudit` called on button click

### SaveSpecDialog
- [ ] Accepts `documentType: 'spec' | 'audit'` prop
- [ ] Audit: filename defaults to `{spec-slug}.audit.md`
- [ ] Audit: dialog title says "Save Verification Audit"
- [ ] Audit: metadata header includes `Type: Verification Audit` and `Spec: {spec-filename}`
- [ ] Existing spec save flow unchanged

### SpecPreview
- [ ] Tab bar appears when both spec and audit content exist
- [ ] Tabs: "Specification" and "Verification Audit"
- [ ] Switching tabs shows respective content
- [ ] Auto-switches to audit tab when audit is first generated
- [ ] Tab bar hidden when only spec exists (no visual change for existing behavior)

### Auto-Offer Flow
- [ ] After saving spec: system message offers audit generation
- [ ] Two option buttons: "Yes, generate" / "Not now"
- [ ] "Yes" → calls `generateAudit(projectPath)`
- [ ] "Not now" → no action, toolbar button remains available

### Post-Audit-Save Flow
- [ ] After saving audit: system message with usage instructions
- [ ] Instructions include the two-step process (implement → verify)
- [ ] Copyable prompt block for the verification step

### CLAUDE.md Integration
- [ ] New Tauri command: `add_verification_workflow_to_claude_md` in `specwriter.rs`
- [ ] Command registered in `lib.rs` invoke_handler
- [ ] TypeScript wrapper added to `tauri-commands.ts`
- [ ] Command reads existing CLAUDE.md content (or handles file not existing)
- [ ] **Dedup check:** Command searches for `"## SpecWriter Verification Workflow"` in existing content
- [ ] If found → returns `"already_exists"` without modifying the file
- [ ] If not found → appends the workflow section to the end of CLAUDE.md
- [ ] If CLAUDE.md doesn't exist → creates it with a minimal header + the workflow section
- [ ] After saving audit: system message offers "📝 Add verification workflow to CLAUDE.md?"
- [ ] Two option buttons: "Yes, add to CLAUDE.md" / "No, skip this"
- [ ] "Yes" → calls the Tauri command
- [ ] If command returns `"already_exists"` → toast: "Verification workflow already in CLAUDE.md"
- [ ] If command returns `"added"` → toast: "Added verification workflow to CLAUDE.md"
- [ ] If command fails → error toast with message

### Output Quality
- [ ] Generated audit has Pre-Flight Checks section
- [ ] Every component gets loading/empty/error/default verification items
- [ ] Every modal gets 6+ check items (open, close×3, submit success, submit error)
- [ ] Every form field gets 3+ check items (present, valid, each invalid case)
- [ ] Every check starts with "VERIFY: Open {file path}"
- [ ] Every check has "Expected:" and severity marker
- [ ] Complex checks have "Trace:" instructions
- [ ] Document ends with Full User Journey Trace
- [ ] Document ends with Final Audit Summary template
- [ ] All file paths reference actual files from the spec (not invented)
- [ ] Pre-Implementation Verification section present at the top (when spec has ⚠️/❓ items)
- [ ] Every verification item cross-references its spec section (e.g., "see spec Section 5")
- [ ] Every API-dependent component includes a slow response check (5+ second scenario)
- [ ] Every navigation change verifies: position, route, and active state styling
