# CodeMantis SpecWriter — Prompt Quality Improvements

**Type:** Prompt enhancement (text changes only — no component or feature code)
**File to modify:** `src/lib/spec-prompts.ts`
**Date:** March 2026
**Priority:** High — implement BEFORE the Verification Audit feature
**Estimated effort:** Small — editing text strings in one file

---

## What This Is

Five surgical additions to the AI system prompts that make the generated specs measurably more complete. These are text edits to the prompt strings in `spec-prompts.ts`. No TypeScript components, no Rust commands, no store changes, no UI work.

**Why implement first:** The Verification Audit checks whether the spec was implemented correctly. Better specs = more specific things to verify = more useful audits. These improvements are a prerequisite.

---

## Current State of the Prompts

The WRITING RULES section in both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT` currently has 7 rules (new app) and 10 rules (feature mode). The Implementation Checklist Phase 4 says:

```
### Phase 4: Polish
- [ ] All loading states implemented (list each one)
- [ ] All error states implemented (list each one)
- [ ] All empty states implemented (list each one)
- [ ] All form validations implemented (list each one)
- [ ] All toast messages implemented (list each one)
- [ ] Responsive layout verified at 375px, 768px, 1024px, 1440px
- [ ] All keyboard navigation works (Tab, Enter, Escape)
```

The parenthetical "(list each one)" is good intent but not enforced — the AI often writes summary lines like "All loading states: ListManager, Modal, Wizard" instead of individual checkboxes for each one. The rules also lack guidance on responsive behavior per component, keyboard navigation per component, error recovery paths, and state transitions.

---

## Change 1: Exhaustive Polish Phase (WRONG/RIGHT Example)

### Where to add

In BOTH prompts, find the Phase 4 section inside the Implementation Checklist template. Replace the current Phase 4 content with:

### What to replace

FIND this text (appears in both `NEW_APP_PROMPT` and `FEATURE_MODE_PROMPT`):

```
### Phase 4: Polish
- [ ] All loading states implemented (list each one)
- [ ] All error states implemented (list each one)
- [ ] All empty states implemented (list each one)
- [ ] All form validations implemented (list each one)
- [ ] All toast messages implemented (list each one)
- [ ] Responsive layout verified at 375px, 768px, 1024px, 1440px
- [ ] All keyboard navigation works (Tab, Enter, Escape)
```

REPLACE WITH:

```
### Phase 4: Polish & Verification

CRITICAL: The items below MUST enumerate every single instance 
individually. Do NOT summarize. Do NOT use category-level items.

WRONG (too vague — Claude Code skips items):
  - [ ] All loading states: ListManager, ListMembershipModal, CampaignWizard

RIGHT (every item is individually checkable):
  - [ ] Loading states:
    - [ ] ListManager page: centered spinner (match SegmentsPanel pattern)
    - [ ] ListManager create modal submit: button shows spinner, form disabled
    - [ ] ListManager delete modal: "Delete List" button shows spinner
    - [ ] ListMembershipModal: spinner while fetching lists
    - [ ] SubscriberList list filter dropdown: "Loading..." while lists load
    - [ ] CampaignWizard recipients step: spinner in Lists section

Apply this exhaustive enumeration to EVERY category below:

- [ ] Loading states (list EVERY loading indicator — one checkbox each):
  - [ ] {page/component}: {exact loading behavior}
  - [ ] {page/component}: {exact loading behavior}
  
- [ ] Error states (list EVERY error state — one checkbox each):
  - [ ] {page/component}: {exact error display + recovery action}
  
- [ ] Empty states (list EVERY empty state — one checkbox each):
  - [ ] {page/component}: {exact empty state text and CTA}
  
- [ ] Form validations (list EVERY field + EVERY rule):
  - [ ] {field name}: {rule} → "{exact error message}" (timing: blur/submit)
  
- [ ] Toast messages (list EVERY toast with exact text):
  - [ ] Success: "{exact toast message}"
  - [ ] Error: "{exact toast message}"
  
- [ ] Responsive behavior (list EVERY component):
  - [ ] {component}: mobile (<640px): {layout}, tablet: {layout}, desktop: {layout}
  
- [ ] Keyboard navigation:
  - [ ] {component}: Tab → {behavior}, Enter → {behavior}, Escape → {behavior}
```

---

## Change 2: Responsive Behavior Per Component

### Where to add

In BOTH prompts, in the WRITING RULES section, add as a NEW rule after the existing rules.

### What to add

After the last numbered writing rule (rule 7 in new app mode, rule 10 in feature mode), add:

```
{NEXT_NUMBER}. EVERY new component must specify responsive behavior:
   - Mobile (<640px): [layout — single column? stacked? hidden?]
   - Tablet (640-1024px): [layout — two columns? reduced padding?]
   - Desktop (>1024px): [layout — full grid? sidebar?]
   
   EVERY modal must specify:
   - Mobile: full-width with 16px body padding (no horizontal margin)
   - Desktop: max-width constraint (typically 400-500px), centered
   
   If the project has breakpoint conventions (check Tailwind config or 
   existing components), use those. Otherwise use Tailwind defaults:
   sm:640px, md:768px, lg:1024px, xl:1280px.
```

---

## Change 3: Keyboard Navigation Per Component

### Where to add

In BOTH prompts, in the WRITING RULES section, add as another NEW rule.

### What to add

```
{NEXT_NUMBER}. EVERY interactive component must specify keyboard behavior:
   - Which elements can receive Tab focus
   - Enter/Space: what they activate
   - Escape: what it closes/cancels
   - Arrow keys: any list/grid navigation (if applicable)
   
   EVERY modal MUST have:
   - Escape → closes modal
   - Tab → cycles through focusable elements inside the modal
   - Focus trap: Tab does NOT leave the modal while it's open
   - Enter on primary button → submits
   - Enter on cancel button → closes
```

---

## Change 4: Error Recovery Paths

### Where to add

In BOTH prompts, in the section guidance for Error Handling. 

For `NEW_APP_PROMPT`: In the Section 7 template (Error Handling & Edge Cases), add after the existing bullet points.

For `FEATURE_MODE_PROMPT`: In the Section 8 template (Error Handling & Edge Cases), add after the existing text.

### What to add

In the **NEW_APP_PROMPT**, find this section template:

```
## 7. Error Handling & Edge Cases
For EVERY page and EVERY user interaction:
- What happens when the API fails (network error, 500, 404)
- What happens with invalid input (each validation rule, each error message)
- What happens when data is empty
- What happens when the user's session expires mid-action
- What happens on slow connections (optimistic updates? loading indicators?)
```

REPLACE WITH:

```
## 7. Error Handling & Edge Cases
For EVERY page and EVERY user interaction:
- What happens when the API fails (network error, 500, 404)
- What happens with invalid input (each validation rule, each error message)
- What happens when data is empty
- What happens when the user's session expires mid-action
- What happens on slow connections (optimistic updates? loading indicators?)

CRITICAL: For every error state, specify the RECOVERY PATH — not just 
what the error looks like, but what the user does next.

WRONG (describes the error but not recovery):
  "Show error message when API fails"

RIGHT (describes error AND how the user recovers):
  "When listService.getLists() fails:
   → Red banner appears: 'Failed to load lists. Please try again.'
   → 'Try Again' button below the message
   → Click 'Try Again' → shows loading spinner → re-calls getLists()
   → If still fails → same error banner (no infinite loop)
   → User can also navigate away and come back (full reload)"

For save/submit errors in modals:
  "When createList() fails:
   → Modal stays OPEN (do NOT close on error)
   → Inline error below form shows the error message from the service
   → Submit button re-enabled so user can fix input and retry
   → Form field values preserved (not cleared)"
```

In the **FEATURE_MODE_PROMPT**, find:

```
## 8. Error Handling & Edge Cases
Feature-specific error states.
How errors surface in existing UI patterns.
```

REPLACE WITH:

```
## 8. Error Handling & Edge Cases
Feature-specific error states.
How errors surface in existing UI patterns (reuse existing toast, 
banner, inline error components).

For EVERY error state, specify the RECOVERY PATH:
- What error UI appears (banner, toast, inline message)
- What action the user can take (retry button, close and reopen, 
  navigate away)
- What happens on retry (loading indicator, same error on repeat failure)
- For modals: modal stays OPEN on error, submit button re-enabled, 
  form values preserved
```

---

## Change 5: State Transitions for Complex Components

### Where to add

In BOTH prompts, add to the component specification guidance.

For `NEW_APP_PROMPT`: Add to the Section 4 (Components) template, after "Visual states: default, hover, active, disabled, loading, error".

For `FEATURE_MODE_PROMPT`: Add to the Section 5 (New & Modified Components) template, after "Modified components: EXACT changes needed".

### What to add

For **NEW_APP_PROMPT**, find:

```
## 4. Components
For every REUSABLE component (used on 2+ pages):
- Component name and file path
- Props with types (TypeScript interface)
- Internal state (if any)
- Behavior description
- Visual states: default, hover, active, disabled, loading, error
```

REPLACE WITH:

```
## 4. Components
For every REUSABLE component (used on 2+ pages):
- Component name and file path
- Props with types (TypeScript interface)
- Internal state (if any)
- Behavior description
- Visual states: default, hover, active, disabled, loading, error
- Responsive behavior: mobile / tablet / desktop layout
- Keyboard behavior: Tab focus, Enter/Escape actions

For components with 3+ visual states, include a STATE TRANSITION MAP:

  Component Mount → Loading (immediately)
  Loading + data received → Default (show content)
  Loading + empty data → Empty (show empty state)
  Loading + error → Error (show error + retry)
  Error + "Try Again" click → Loading (retry)
  Default + "Create" click → Modal Open (create mode)
  Modal Open + Submit success → Default (refresh + toast)
  Modal Open + Submit error → Modal Open (show inline error)

This prevents ambiguous transitions (e.g., does the empty state show 
briefly before data arrives? It shouldn't — the loading state should 
cover the entire wait).
```

For **FEATURE_MODE_PROMPT**, find:

```
## 5. New & Modified Components
New components: full props interface, behavior, states.
Modified components: EXACT changes needed (line-level if you've read the file).
Reference existing components to reuse.
```

REPLACE WITH:

```
## 5. New & Modified Components
New components: full props interface, behavior, states (default, loading, 
empty, error), responsive behavior (mobile/tablet/desktop), keyboard 
behavior (Tab/Enter/Escape).

For components with 3+ states, include a STATE TRANSITION MAP:
  Mount → Loading → Default | Empty | Error
  Error + retry → Loading
  (Map every trigger → state change)

Modified components: EXACT changes needed (line-level if you've read the file).
Reference existing components to reuse.
```

---

## Implementation Checklist

### Change 1: Exhaustive Polish Phase
- [ ] Find Phase 4 in `NEW_APP_PROMPT` → replace with WRONG/RIGHT version
- [ ] Find Phase 4 in `FEATURE_MODE_PROMPT` → replace with same WRONG/RIGHT version
- [ ] Both versions include: individual loading states, error states, empty states, form validations, toast messages, responsive behavior, keyboard navigation

### Change 2: Responsive Per Component  
- [ ] Add responsive rule to WRITING RULES in `NEW_APP_PROMPT` (after rule 7)
- [ ] Add responsive rule to WRITING RULES in `FEATURE_MODE_PROMPT` (after rule 10)
- [ ] Rule covers: mobile/tablet/desktop layout + modal mobile behavior

### Change 3: Keyboard Per Component
- [ ] Add keyboard rule to WRITING RULES in `NEW_APP_PROMPT`
- [ ] Add keyboard rule to WRITING RULES in `FEATURE_MODE_PROMPT`
- [ ] Rule covers: Tab focus, Enter/Space, Escape, focus trap for modals

### Change 4: Error Recovery Paths
- [ ] Replace Section 7 template in `NEW_APP_PROMPT` with WRONG/RIGHT recovery version
- [ ] Replace Section 8 template in `FEATURE_MODE_PROMPT` with recovery guidance
- [ ] Both versions specify: error UI + recovery action + retry behavior + modal stays open

### Change 5: State Transitions
- [ ] Replace Section 4 template in `NEW_APP_PROMPT` with state transition map guidance
- [ ] Replace Section 5 template in `FEATURE_MODE_PROMPT` with state transition map guidance
- [ ] Both versions include: Mount → Loading → Default|Empty|Error flow + trigger descriptions

### Verification
- [ ] `pnpm tsc --noEmit` passes (prompts are just strings — this shouldn't break)
- [ ] Test: open SpecWriter, describe a feature with a form and a list view
- [ ] Generated spec includes: individual loading/error/empty states in Phase 4 checklist
- [ ] Generated spec includes: responsive behavior for new components
- [ ] Generated spec includes: keyboard behavior for modals
- [ ] Generated spec includes: error recovery paths (not just "show error")
- [ ] Generated spec includes: state transition map for the main component
