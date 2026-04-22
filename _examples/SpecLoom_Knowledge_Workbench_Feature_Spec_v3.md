# SpecLoom — Knowledge Workbench v3 (Complete Spec)

**Version:** 3.1 — complete standalone specification. No other document needs to be read alongside this one to implement v1.0. Handover-ready for CodeMantis SpecWriter.
**Date:** April 18, 2026 (v3.1 additions: final copy §24, AI prompts §25, concurrency §26, privacy §27, tests §28)
**Status:** Ready for implementation. This is the next major feature to ship.
**Supersedes:** `SpecLoom_Knowledge_Workbench_Feature_Spec.md` (v1, superseded) and `SpecLoom_Knowledge_Workbench_Feature_Spec_v2.md` (v2, strategic design only — this v3 absorbs its strategy and adds full-stack implementation detail). Mark both historical.
**Adjacent:** `SpecLoom_AI_Implementation_Guides_Feature_Spec_v3.md` (implemented or in progress — the `clarification_requests` table is defined there; this spec references it rather than duplicating).

---

## 0. What This Document Covers

This is a single source of truth for implementing the Knowledge Workbench end-to-end. Every layer is covered; Claude Code can build from this alone.

| Layer | Sections |
|---|---|
| UX principles and design language | §4, §5 |
| Information architecture + navigation | §6 |
| **v1.0 Magical Core — UX storyboards** (the heart of this spec) | §7 |
| Later phases UX (Stream, Readiness, Explorer, CodeMantis loop) | §8 |
| Database schema + migrations + RLS | §9, §10 |
| Pipeline stages (Python FastAPI worker) | §11 |
| Supabase Edge Functions (API surface) | §12 |
| Frontend components + hooks + routing | §13 |
| Integration with existing synthesis + Guides + CodeMantis | §14 |
| Container / deployment | §15 |
| Model configuration | §16 |
| Cost estimates | §17 |
| Implementation sequence | §18 |
| Files inventory | §19 |
| Success metrics | §20 |
| Risks + mitigations | §21 |
| Validation checklist | §22 |
| Scope boundaries (what this spec does NOT cover) | §23 |
| **Content: onboarding & empty-state copy (final, ship-as-is)** | §24 |
| **Content: AI prompts (full text + output schemas + parsing contracts)** | §25 |
| Concurrency, race conditions, rate limits | §26 |
| Privacy, security, data retention | §27 |
| Testing plan (unit / integration / UX validation / load / smoke) | §28 |

---

## 1. The One Sentence

> **The Workbench is the place a product manager lives.** Every thought, every rule, every answered question, every clarification from a developer — it all flows in through one surface, and the spec, the documents, the tickets, and the AI-ready implementation sessions all flow out.

If a PM opens SpecLoom in the morning and closes it at night, the Workbench is the tab they have open. That's the bar. The rest of this document is a blueprint for earning that.

---

## 2. What v2 Got Right (Keep)

The strategic analysis in v2 holds up completely. Reproduced here so this spec is standalone:

1. **Gap analysis.** Before this feature, notes had no home. `onboarding_context` is write-once, `user_hint` is bolted to a specific upload, `questions` is AI-led not PM-led. The Workbench fixes that.
2. **Co-authorship framing.** PM and AI work together. The AI probes, detects contradictions, proposes classifications. The PM confirms or overrides. Neither dominates.
3. **Seven misses from v1 corrected:** (a) capture is one field, not five; (b) voice is first-class; (c) AI is proactive, not passive; (d) sync has a preview; (e) Ask-the-KB chat exists; (f) CodeMantis bidirectional loop; (g) Readiness is dimensional.
4. **Separate `quick_notes` table.** Schema-correct. Carries forward.
5. **Status lifecycle.** draft → active → superseded → archived. Carries forward.
6. **Read-only KB Explorer.** KB stays derivation-only; changes happen through notes + resync. Non-negotiable.
7. **Incremental sync vs full re-synthesis.** Cost math still works ($0.05-0.20 incremental; $5-15 full).

---

## 3. What's New In v3 (Since v2)

Three material updates since v2 was written in April 2026:

1. **AI Implementation Guides v3 is now implementation-ready.** The `clarification_requests` table is defined in Guides v3 §9.4; this spec references it rather than re-defining. The outbound YAML frontmatter for generated specs moves to Guides v3 as part of the session format; the Workbench focuses on the inbound side (clarifications surfacing in Note Stream).
2. **Strategic reframe adopted.** The Workbench isn't a spec-tool feature — it's the PM's daily workspace for a category-defining product ("AI-Ready Implementation Sessions"). The UX bar is set by that frame, not by spec-tool conventions.
3. **User's UX mandate.** "The great and easy UI experience for the users is imperative." This spec treats UX as the primary deliverable. §7 (UX storyboards for v1.0 Magical Core) is the longest section and the most important.

v3 also absorbs all mechanical detail that v2 lacked: complete database schema, pipeline stages, Edge Functions, React component inventory, migration plans, model configuration — matching the depth of the Guides v3 spec.

---

## 4. UX Principles (The Contract With The User)

Before any mockup or component, the principles that every UX decision must pass against. When two possible designs conflict, the one more aligned with these principles wins.

### 4.1 Zero Friction At Capture

The moment of insight is the moment of lowest cognitive bandwidth. The PM has a thought at 11pm — we have maybe 15 seconds before it slips away. Any field that isn't "body" is a cost. Any classification step before save is a cost. Any "are you sure?" dialog before save is a cost.

**Rule:** one field, one button, one keystroke. Everything else is inferred after.

### 4.2 The AI Reveals Itself Gradually

A good co-author doesn't interrupt you while you're thinking. They wait until you've captured the thought, then offer a gentle "did you mean...?" or "what about...?". They don't present a form.

**Rule:** AI output is layered below the saved note, never above. It's skippable. It's dismissable. Dismissing it once never re-prompts.

### 4.3 Never Punish The User For Moving Fast

If the PM dismisses a classification, the note is still saved. If they ignore probes, the probes are still stored (available in "unanswered" filter). If they skip contradiction review, the contradiction is still flagged. Nothing is lost. Nothing is blocked.

**Rule:** every dismissible thing degrades gracefully. Skip never destroys.

### 4.4 Transparency Over Magic

The PM must always be able to answer three questions: "What have I captured?" "Where did that come from?" "What will happen if I sync?". If they can't, we've failed.

**Rule:** every fact in the system has a "View source" action. Every AI inference shows its basis. Every sync shows its diff before applying.

### 4.5 Voice Is Equal To Text

Not a feature, not a toggle. Voice is a first-class input mode everywhere capture happens. The mic icon appears next to the text field, same size, same prominence. On mobile, voice becomes the default entry point.

**Rule:** every capture surface has a mic. Every conversational surface accepts voice.

### 4.6 Small Signals, Not Big Rewards

No gamification. No badges. No "streaks." The satisfaction is intrinsic — the PM sees their note become a business rule in a generated document, and they feel it. That's the reward loop.

**Rule:** progress indicators (Readiness) are factual, not motivational. Sources on notes are informative, not celebratory.

### 4.7 Respect The PM's Time

Every interaction has a cost-benefit. A probe that's useless once is annoying forever. A contradiction warning that's wrong is worse than none.

**Rule:** if a probe is dismissed, don't ask again. If a contradiction is marked "both correct," don't flag it again. Learning is implicit.

### 4.8 Mobile Is Not A Responsive Afterthought

PMs think at the grocery store. They have thoughts walking the dog. The mobile experience is the primary capture channel for many real users.

**Rule:** every capture surface works thumb-first on a 390px screen. Voice is the primary mode on mobile. Everything else scales down; mobile doesn't scale up.

---

## 5. Design System Foundations

### 5.1 Stack Baseline (Already Available)

From the existing SpecLoom codebase, we have:
- **shadcn/ui** (radix-nova style, neutral base color) — all primitive components present
- **Lucide icons** — use existing icon conventions
- **Geist Variable font** — already loaded; use as-is
- **Tailwind v4** — use existing tokens; do not introduce custom classes
- **Sonner** — toasts
- **cmdk** — command palette primitive
- **LiveKit client + waveform-visualizer + voice-controls** — voice infrastructure already proven (16 voice sessions shipped)
- **@tanstack/react-query** — data-fetching layer; all Workbench hooks use this
- **react-hook-form + zod** — form validation
- **diff** — for KB version diffs (already a dependency — perfect for sync preview)
- **react-markdown + remark-gfm** — markdown rendering

No new dependencies required for v1.0 Magical Core.

### 5.2 Density And Rhythm

| Context | Spacing | Typography |
|---|---|---|
| Capture drawer | Spacious — one thing at a time | Body 16px / line 24 |
| Note Stream | Medium density — scannable | Body 14px / line 20 |
| Ask-the-KB | Spacious — conversational | Body 16px / line 24 |
| Sync preview | High density — table-like | Body 13px / line 18 |
| Readiness dashboard | Cards with generous padding | Mixed; numbers 24-32px |

### 5.3 Color Semantics

Already in use across SpecLoom. Workbench adds no new colors; reuses:
- `primary` — action / main CTA
- `muted` — borders, disabled, subtle backgrounds
- `accent` — hover / focus
- `destructive` — delete / conflict (contradictions)
- `chart-1..5` — note-type pills, dimension bars
- `foreground` / `background` — always via tokens

### 5.4 Iconography (Lucide)

| Concept | Icon |
|---|---|
| Note (generic) | `StickyNote` |
| Business rule | `Scale` |
| Edge case | `AlertCircle` |
| Clarification | `MessageCircleQuestion` |
| Domain term | `BookOpen` |
| Constraint | `Lock` |
| Voice capture | `Mic` |
| Sync | `RefreshCw` |
| Ask KB | `Sparkles` |
| Readiness | `Gauge` |
| Contradiction | `AlertTriangle` |
| Source/origin | `ExternalLink` |

---

## 6. Information Architecture And Navigation

### 6.1 The Workbench Page

One new page at `/projects/:projectId/workbench`. This is the PM's home surface.

The page uses a **tab bar** (not separate nav items) with five tabs. A tab bar keeps all Workbench functions one click away from each other — critical because the flow between them is fluid (capture → review in stream → ask KB → sync).

```
┌─────────────────────────────────────────────────────────────────┐
│  Project: Atikon Kickstarter App    [Sync pending: 3]   [🔔 2] │
├─────────────────────────────────────────────────────────────────┤
│  📝 Capture   📋 Stream   ✨ Ask   📊 Readiness   🔍 Explore    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                       (active tab content)                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

- **Capture** — the capture drawer is actually global (see §7.1) but this tab surfaces recent captures + first-use onboarding
- **Stream** — chronological note feed (v1.1)
- **Ask** — Ask-the-KB chat
- **Readiness** — dimensional score dashboard (v1.2)
- **Explore** — KB Explorer (v1.3, reuses existing `src/components/knowledge-base/` components)

### 6.2 The Capture Affordance Is Global

Unlike the tabs above, capture is accessible **from anywhere in the project**, not just the Workbench page. It appears as a persistent floating pill-button at the bottom-right of every project page (Documents, Videos, Materials, anywhere). Keyboard shortcut `Cmd+N` / `Ctrl+N` focuses it instantly.

**This is the most important affordance in SpecLoom.** It is always one keystroke or one tap away.

### 6.3 The Status Bar

A thin bar at the top of every Workbench page shows two status elements:

```
┌──────────────────────────────────────────────────────────────┐
│ ⟳ Sync: 3 pending notes ready to merge      [Preview →]    │
│ ⚠ Inbox: 2 developer clarifications awaiting answer  [Open] │
└──────────────────────────────────────────────────────────────┘
```

Both elements are conditional — they only appear when relevant. The status bar is quiet when there's nothing to do, loud when action is needed.

### 6.4 Sidebar Navigation Update

Add a new menu item "Workbench" to the project sidebar, positioned between "Materials" and "Documents" (materials is where PM uploads; documents is where specs live; the Workbench sits in between as the thinking workspace).

Sidebar sub-items (collapsible, auto-expanded when on the Workbench page):
- Capture (always the tab shortcut)
- Stream
- Ask KB
- Readiness
- Explore

The sub-items mirror the tab bar so both left-nav and top-tabs work. Default landing: Capture tab (with recent captures visible).

---

## 7. v1.0 Magical Core — UX Storyboards

This is the feature that ships first. Everything else (Stream, Readiness, Explorer, CodeMantis loop) is built on top of this foundation. §7 is detailed; §8 will be lighter for later phases.

### 7.1 Capture — The Global Drawer

#### 7.1.1 The Affordance

A small pill-shaped button lives at `fixed bottom-right` of every project page. States:

| State | Appearance | Trigger |
|---|---|---|
| **Resting** | Small pill, just the StickyNote icon, subtle shadow | Default |
| **Pulse** (first-use) | Gentle rhythmic glow | User has never captured a note |
| **Hover** | Expands horizontally to show text "Capture note" | Mouse hover on desktop |
| **Active** | Pressed state, slight scale-down | During click / tap |

Keyboard: `Cmd+N` on macOS, `Ctrl+N` on Windows/Linux. Shortcut works from **any** project page. If the capture drawer is already open, `Cmd+N` is a no-op (already focused). `Esc` closes it.

#### 7.1.2 Opening The Drawer

Click the pill or press `Cmd+N`. A drawer slides in from the right (desktop) or rises from the bottom as a sheet (mobile). Width on desktop: 420px. Height on mobile: 85vh.

Animation: 200ms ease-out slide. The underlying page dims slightly but stays visible — the PM keeps context of what they were looking at. They might be in a video, a document, an Ask-the-KB conversation — the capture drawer doesn't yank them out.

#### 7.1.3 The Form — One Field

```
┌─ Capture a thought ─────────────────────────── ✕ ─┐
│                                                    │
│   [🎙]  Start typing, or tap to speak...          │
│                                                    │
│   ┌──────────────────────────────────────────┐   │
│   │                                           │   │
│   │   (cursor here, auto-focused)             │   │
│   │                                           │   │
│   │                                           │   │
│   └──────────────────────────────────────────┘   │
│                                                    │
│   ↵ to save       Esc to close                    │
└────────────────────────────────────────────────────┘
```

**Behavioral rules:**
- Auto-focus is the cursor in the text area the moment the drawer opens
- `Cmd+Enter` or `Enter`-on-an-empty-line triggers save
- `Esc` closes the drawer; if there's unsaved text, the drawer fades but the text is retained (re-opening restores it — a local-only draft)
- The mic icon sits inside the input, left edge — tapping it toggles voice mode (§7.1.4)
- No title field. No type picker. No feature-area dropdown. No reference linker. None of it.
- Character counter is **not** shown. Notes can be a word or a page — we don't police length.

The mic icon and text area are the same height. They look like peers. No "fallback to text if voice fails" vibe — both modes are first-class.

**Draft persistence:** typed content is autosaved to IndexedDB every 2 seconds. If the browser crashes, the network dies, or the PM closes the tab accidentally, the draft reappears next time they open the drawer (for 24 hours, then expires).

#### 7.1.4 Voice Mode

Tap the mic. The drawer transforms smoothly — keeping the PM oriented, not jolting to a new screen.

```
┌─ Speak a thought ──────────────────────────── ✕ ─┐
│                                                    │
│   ●●●●●●●●▼▼▼●●●●▼▼●●●●●●●     ← waveform       │
│                                                    │
│   🔴 Recording   0:14                              │
│                                                    │
│   "Steuer-News editions in QC cannot be edited    │
│    by the authors..."      ← live transcript      │
│                                                    │
│   [■ Stop]                                        │
│                                                    │
└────────────────────────────────────────────────────┘
```

Technical flow (reuses existing infrastructure from `src/components/voice/`):
1. Tap mic → request mic permission if not granted
2. Start a LiveKit session (existing `voice-session-panel` pattern) OR direct Whisper streaming via local MediaRecorder → chunked POST to Whisper edge function
3. Waveform animates (reuse `waveform-visualizer.tsx`) showing amplitude
4. Interim transcripts appear live in the drawer (Whisper streaming returns partials)
5. PM taps Stop (or `Esc`) → recording stops, final transcript appears
6. Auto-save after 2 seconds of silence detected? **No, not in v1.0** — too easy to lose a thought mid-pause. Manual stop is required.
7. After stop → transcript is editable text. PM can fix words Whisper got wrong before saving.

**Permission denied state:** if mic permission is blocked, the mic icon shows a crossed-out variant with tooltip: "Microphone access blocked. [Enable in settings]". Typed text still works — we never leave the PM stranded.

**Language:** Whisper auto-detects from audio. German narration works (as proven by the 16 existing voice sessions). No language picker needed.

**Cost awareness:** every voice capture runs Whisper + a cleanup pass (removes "um", "uh", splits run-on sentences). Total cost: ~$0.002 for a 30-second note. Negligible. Tracked via `cost_operation = 'note_voice_transcription'`.

#### 7.1.5 Save — Instant, Then AI

PM presses `Cmd+Enter` or taps Save. Three things happen in order:

**T = 0 (instant, optimistic):**
- The note appears as saved in the UI — no spinner, no wait
- A subtle green checkmark blips next to the timestamp
- The note row shows in an "AI thinking..." sub-state (a subtle skeleton below the body)
- The PM is free to close the drawer (`Esc`) and move on. The AI continues in the background.

**T = 1-3 seconds (AI proactive pass returns):**
- Classification suggestion appears as a pill below the body: `business_rule · Steuer-News Edition Management`
- If body mentioned "video 12 at 04:32", a reference chip appears: `📹 video SD-News-12 @04:32` (auto-linked)
- Each is click-to-accept (single tap), or click-to-edit (opens a small picker)
- If the AI is uncertain (confidence < 0.7), it offers options: "Could this be a `business_rule` or an `edge_case`?" — the PM picks

**T = 3-5 seconds (probes arrive):**
- Below classification, a stacked card appears: "💭 Follow-up"
- Each probe is a short question with four actions: [Voice answer] [Type answer] [Skip] [Not relevant]
- "Skip" defers (the probe stays pending in the Stream for later). "Not relevant" dismisses permanently (AI learns — §4.7)

**T = 3-5 seconds (contradictions arrive, if any):**
- If the AI detects this note conflicts with a previously-saved note, a yellow banner appears
- The banner shows the prior note's body preview and timestamp
- Three actions: [Keep the new one] [Keep the old one] [Both are correct — different scopes]
- Picking one marks the loser as `superseded_by` the winner and preserves history

**The key insight:** none of these AI outputs delay the save. The note is committed to the database at T=0. Everything after is enrichment. If the AI call fails entirely, the note still exists; the PM just doesn't see the suggestions.

#### 7.1.6 After The Drawer Closes

When `Esc` or ✕ closes the drawer, a tiny toast appears in the corner: "Note saved · [View]". Clicking "View" opens the Stream (v1.1) or, in v1.0 where Stream isn't built yet, opens a simple detail panel.

Nothing else happens. The PM returns to whatever they were doing. The capture was a side-quest.

#### 7.1.7 The Capture Tab Itself

The Workbench's first tab is **Capture**. What lives here when you visit directly?

- **Recent captures** — last 5 notes with their AI-inferred type/area/probes. Clicking a card opens the same detail view as above.
- **Empty state (first visit ever):** a large friendly illustration + the line "Write anything — a rule, a question, a detail. SpecLoom will figure out the rest." + a big "Try it now" button that opens the drawer.
- **Quick templates** (v1.1+, not v1.0): small tiles for common capture patterns ("Describe a user role", "Note an edge case", "Add a constraint"). Skip for v1.0.

The Capture tab is a *passive surface* — it shows status. The active capture is always in the global drawer. This separation matters: capture shouldn't be tab-dependent. You might be watching a video, think of something, hit `Cmd+N`, capture, and never leave the video page.

### 7.2 Proactive AI Feedback — UX Details

The AI feedback from §7.1.5 deserves its own breakdown because this is where the co-authorship promise is kept or broken.

#### 7.2.1 Classification Suggestion

Layout: a single horizontal pill row below the note body, separated by a thin `border-t`.

```
┌──────────────────────────────────────────────────┐
│ (note body text above)                            │
│ ──────────────────────────────────────────────   │
│  [Scale  business_rule] · [Book  Steuer-News]    │
│                                        [Edit]    │
└──────────────────────────────────────────────────┘
```

- Pills use the appropriate icon from §5.4
- Single-tap on either pill opens an inline picker (popover) — no modal, no page navigation
- "Edit" at the end lets the PM change both at once (opens a combined picker)
- If AI confidence is medium (0.5-0.7), the pill shows a subtle question-mark icon; tapping offers alternatives

**Micro-interaction:** when the PM accepts a pill (by tapping or by not changing it within 3 seconds), it subtly darkens to confirm. No toast, no sound. Just a visual acknowledgment.

#### 7.2.2 Probes

Probes are 1-3 questions the AI generates based on the note content. Layout:

```
┌─ 💭 Follow-up questions ─────────────────────────┐
│                                                   │
│  What happens if all QC Reviewers are             │
│  unavailable? Timeout? Notification?              │
│  [🎙 Voice] [✎ Type] [Skip] [Not relevant]        │
│                                                   │
│  Is there an audit trail for rejections?          │
│  [🎙 Voice] [✎ Type] [Skip] [Not relevant]        │
│                                                   │
└───────────────────────────────────────────────────┘
```

**Behavioural rules:**
- Answering a probe creates a new note (`note_type=general`, references the parent note)
- [Skip] moves the probe to a "deferred" state — it shows up in the Stream with a filter "Unanswered probes"
- [Not relevant] kills the probe permanently and teaches the AI (incremented in the project's `ai_feedback_counters`)
- Probes auto-collapse to a single-line summary after 30 seconds of no interaction ("2 follow-up questions [Expand]") so they don't dominate the drawer

**Voice answer flow:** tapping `[🎙 Voice]` re-enters voice mode with the probe text pre-loaded as context. The transcript is the answer. Save creates the child note. This is the smoothest iteration on the probe pattern — the PM sees a question, taps mic, answers, done.

**Anti-spam guard:** if the PM dismisses 5 probes in a row without answering any, the AI's probe_level for this project silently drops from `light` to `minimal` — the AI stops generating probes for general notes and only generates them when a direct contradiction or obvious gap is detected. This is the "respect the PM's time" principle in action (§4.7). Settings: PM can reset probe_level explicitly.

#### 7.2.3 Contradictions

If the AI detects a conflict between this note and a previous note, a distinct yellow banner appears above the classification pills:

```
┌─ ⚠ Possible contradiction ────────────────────── ✕ ─┐
│                                                       │
│  This note says "only QC Reviewers can reject"       │
│  But note N-023 (Apr 12) said "Admin can also       │
│  reject". Which is correct?                          │
│                                                       │
│  [← Use N-023]  [✓ Use this one]  [Both correct]    │
│                                                       │
│  [View N-023 →]                                      │
└───────────────────────────────────────────────────────┘
```

- "Use N-023" marks the new note as `superseded_by` N-023 (rare, but possible — PM realized the new one is wrong)
- "Use this one" marks N-023 as `superseded_by` this note
- "Both correct" creates a `contradiction_resolutions` entry saying "these two are compatible — different scopes or contexts" — this teaches the AI not to flag again
- "View N-023" opens the prior note in a side panel so the PM can read the full text before deciding
- The ✕ defers (hides the banner but keeps the contradiction unresolved); it shows up in Stream filter "Unresolved contradictions" for later

**Design principle:** contradictions require explicit resolution for sync (§7.4), so deferring is fine but syncing will re-surface them. This creates pressure without blocking capture.

### 7.3 Ask The KB — Chat Surface

Tab: `✨ Ask`. One of the five Workbench tabs.

#### 7.3.1 Layout

Two-column layout on desktop:

```
┌──────────────────────────────┬─────────────────────────┐
│  Conversation (full width)   │  Context drawer         │
│  ────────────────────────    │  ───────────────────    │
│                               │                          │
│  You: What do we know about  │  Sources cited in this  │
│    Steuer-News article       │  answer:                │
│    versioning?               │                          │
│                               │  📹 SD-News-07          │
│  SpecLoom (with voice):      │     @ 02:14-03:40       │
│  Based on 4 videos, 2 notes, │                          │
│  and 1 doc, articles have... │  📹 SD-News-12          │
│                               │     @ 01:30-02:05       │
│  [Follow up]                  │                          │
│  [Capture this as a note]    │  📝 N-034 (you, Apr 12) │
│                               │                          │
│  ── ── ── ── ── ── ── ──      │  📄 Data Model Ref §3.2 │
│                               │                          │
│  [🎙] Ask anything...         │                          │
│                               │                          │
└──────────────────────────────┴─────────────────────────┘
```

On mobile, the Context drawer becomes a bottom sheet that auto-appears after each AI answer (collapsed by default, tap to expand).

#### 7.3.2 Conversational Flow

- PM types a question or taps mic → voice mode (full-screen on mobile, inline on desktop using existing voice components)
- Answer streams in with a typing indicator; sources populate in the right panel as they're cited
- Every source is a clickable chip: video → opens video at timestamp; note → opens note detail; doc → opens doc at section
- "Follow up" extends the conversation in context
- "Capture this as a note" creates a new note with the answer text as body, auto-tagged with the AI's classification, with `references` populated from the cited sources

**Critical behaviour:** the AI answer, when captured as a note, goes through the **same** proactive AI pass as a manually-typed note — probes and contradictions may emerge. This creates a compound loop: ask → answer → capture → AI enriches → more questions emerge.

#### 7.3.3 History

Each conversation is persisted (existing `conversations` table with `conversation_type='ask_kb'`). A small sidebar on the left shows conversation history — like a chat app. PM can rename, star, or delete. Starred conversations survive a default 90-day retention.

#### 7.3.4 Voice Mode

Full voice-to-voice mode uses the existing `voice-session-panel.tsx`. The user talks to the AI, the AI talks back (ElevenLabs TTS, already in use). This is a distinct "listen mode" button; default is text-in / text-out for speed.

### 7.4 Sync Preview — The Trust Gate

Sync is where notes become KB changes. This is the action that makes the PM nervous. The entire UX is designed to remove that fear.

#### 7.4.1 Accessing Sync

Two entry points:
1. **The status bar** at the top of any Workbench page: "⟳ Sync: 3 pending notes ready to merge [Preview →]"
2. **The Stream** (v1.1) has a "Sync" button in its top-right corner

Tapping either opens the Sync Preview modal. **It is a modal, not a separate page.** Leaving the modal (Esc or Cancel) returns to exactly where the PM was. Context preserved.

#### 7.4.2 The Preview Modal

Four stages in one modal, using a `Tabs` component from shadcn:

```
┌─ Sync Preview ────────────────────────────────────── ✕ ─┐
│                                                           │
│  [Overview] [KB Changes] [Document Impact] [Blockers]    │
│  ═══════════                                              │
│                                                           │
│  3 pending notes will produce:                           │
│                                                           │
│   ✓ 2 new business rules                                 │
│   ✓ 1 feature description update                         │
│   ✓ 1 entity relationship added                          │
│                                                           │
│   ⚠ 1 contradiction must be resolved first              │
│                                                           │
│   📄 3 generated documents will become stale:           │
│      - steuer-news-edition-mgmt (v4)                    │
│      - customer-portal-review (v3)                      │
│      - project-overview (v6)                            │
│                                                           │
│   ⏱ Estimated sync time: ~45 seconds                    │
│   💰 Estimated cost: $0.08                              │
│                                                           │
│                              [Cancel]  [Apply Sync →]    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**Each tab:**
- **Overview**: the summary shown above — the PM's glance view
- **KB Changes**: itemized list of every field that will change, with before/after snippets (uses the `diff` library)
- **Document Impact**: list of generated documents that will go stale, with a "Regenerate after sync" checkbox per document (PM can opt into auto-regeneration; default off in v1.0 because regeneration is separately costly and disruptive)
- **Blockers**: list of unresolved contradictions; each with inline "Resolve" action that opens the contradiction flow from §7.2.3

#### 7.4.3 The Apply Flow

Tap "Apply Sync". The modal transforms to a progress screen:

```
┌─ Applying sync... ──────────────────────────────────── ┐
│                                                         │
│   ⟳ Incorporating notes into KB...                    │
│                                                         │
│   ✓ Loaded existing KB (v38)                           │
│   ✓ Grouped 3 notes by feature area                    │
│   ⟳ Merging into Steuer-News Edition Management (2/3) │
│     Extracting business rules...                        │
│   ⧗ Merging into Customer Portal Review (pending)      │
│   ⧗ Extracting structured business rules (pending)     │
│   ⧗ Saving KB v39 (pending)                            │
│                                                         │
│   [Cancel]                                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Progress is real — each step completes as the backend pipeline runs. The PM sees the system thinking. If anything fails, the current step changes to ⚠ with a recovery option.

**Atomicity:** either the entire sync commits to KB v39, or nothing commits. No partial state. If halfway through the AI call fails, the KB stays at v38 and affected notes remain pending.

#### 7.4.4 After Apply

Modal transitions to success:

```
┌─ Sync complete ─────────────────────────────────────── ┐
│                                                         │
│   ✓ KB is now at v39 (from v38)                        │
│   ✓ 3 notes incorporated                               │
│   ⚠ 3 documents are now out of date                    │
│                                                         │
│   [View KB changes]  [Regenerate documents]  [Done]   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

A **Rollback** option is available for 24 hours via the KB version history (simple link: "Rolled back v38 → v37 before apply"). After 24 hours, the old version is still queryable but not trivially rollback-able.

#### 7.4.5 Edge Cases

- **Sync clicked with zero pending notes:** modal shows "Nothing to sync" with a friendly illustration and a close button
- **Sync clicked with only contradictions pending:** modal jumps directly to Blockers tab, Apply disabled
- **Concurrent sync attempt (multi-tab):** second attempt shows "Another sync is in progress" with a link to the in-progress one
- **Sync fails mid-flow:** KB rolled back automatically; affected notes remain pending; retry button appears

### 7.5 First-Use Onboarding

Nobody reads documentation. The Workbench must teach itself.

#### 7.5.1 Session 1: The First Visit

When a PM enters the Workbench for the first time (detected by: `quick_notes` count = 0 for this project):

A subtle overlay appears on the Capture tab, with three beats:

```
Beat 1:  "This is where your thoughts live."
         (pointer aimed at the capture pill-button)
         [Got it →]

Beat 2:  "Press Cmd+N anywhere in SpecLoom to capture."
         (shows keyboard shortcut visually)
         [Next →]

Beat 3:  "Every thought becomes part of your spec."
         (small diagram: note → KB → document)
         [Try it now]
```

Final beat has the CTA [Try it now] which triggers the capture drawer to open with a pre-filled placeholder: "Write or speak anything about your project...".

After the PM's first note is saved, the overlay disappears forever.

#### 7.5.2 Session 2: After 3 Notes

When `quick_notes` count reaches 3, a new tooltip appears on the Readiness tab (or a badge dot if Readiness is v1.2):

"📊 See how your spec is shaping up — Readiness shows you what's documented and what's missing."

Dismissable. Never re-shown.

#### 7.5.3 Session 3: Before First Sync

When pending notes count reaches 5 and the PM opens the Workbench, a top banner appears:

"You have 5 thoughts captured. Ready to merge them into your Knowledge Base? [Preview sync →]"

Dismissable. Re-shown at 10 pending, 20, 50 (sliding scale — we nudge but don't nag).

#### 7.5.4 Session 4: First Sync Complete

Right after the first successful sync, a celebratory (but understated) overlay:

"Your notes just became part of your Knowledge Base. Next time you generate a document, they'll shape the output. Ask the KB anything, anytime."

One-time. Sets expectations for the compound loop.

**Principle:** onboarding is progressive. We don't cram all the tutorials into session 1. Each overlay appears exactly when the PM is about to benefit from knowing. This respects §4.7 (respect the PM's time).

### 7.6 Error States, Offline, Undo

#### 7.6.1 Save Failure

If `POST /notes` fails:
1. The note stays in local IndexedDB draft state
2. A non-dismissable toast: "Offline. Your note is saved locally and will sync when you're back online."
3. A retry happens automatically every 30 seconds
4. The capture drawer shows a subtle warning icon next to the note
5. When connectivity returns and sync succeeds, the icon clears with a check mark

**The PM never loses a thought to a network blip.** This is sacred.

#### 7.6.2 AI Post-Processing Failure

If the proactive AI call fails (rate limit, API error, timeout):
- The note is still saved (the save happened at T=0)
- The "AI thinking..." skeleton silently disappears after 30 seconds
- A subtle icon appears next to the note: "AI didn't respond. [Retry analysis]"
- Retry is free (doesn't count against budget); behind the scenes it re-queues the same prompt

**We never block the user on AI.** The feature degrades to "dumb storage" under AI failure, which is still useful.

#### 7.6.3 Voice Failure

If Whisper fails:
- The recording is preserved locally
- A message appears: "Transcription failed. Your recording is saved; would you like to retry, or type it instead?"
- Retry button re-sends to Whisper
- "Type instead" returns to text mode with an empty text area (the PM transcribes their own audio if urgent)

#### 7.6.4 Undo

Every destructive action has an undo window:
- **Archive a note:** toast with "Undo" button for 10 seconds
- **Supersede a note via contradiction resolution:** toast with "Undo" for 10 seconds
- **Sync apply:** "Rollback" action available in KB version history for 24 hours

Undo restores exact prior state — no data loss.

### 7.7 Accessibility And Keyboard

The Workbench passes WCAG 2.2 AA.

#### 7.7.1 Keyboard Navigation

| Action | Shortcut |
|---|---|
| Open capture drawer | `Cmd+N` / `Ctrl+N` |
| Close any drawer/modal | `Esc` |
| Save note from drawer | `Cmd+Enter` |
| Switch Workbench tabs | `Cmd+1..5` |
| Focus Ask-KB input | `Cmd+K` (opens command palette with AskKB option) |
| Sync preview | `Cmd+Shift+S` |
| Voice toggle in drawer | `Cmd+M` |

Every interactive element is keyboard-reachable via `Tab`. Focus rings are visible on all elements (no `outline: none` without replacement).

#### 7.7.2 Screen Reader

- All icons have `aria-label`
- The capture drawer opens with `role="dialog"` and `aria-modal="true"`
- Waveform has `aria-label="Recording in progress"` and updates `aria-live="polite"` with duration
- Classification pills announce their type ("Classified as business rule, accept or change")
- Probes are announced sequentially, not all at once

#### 7.7.3 Color Contrast

All text ≥ 4.5:1 on its background. Classification pills use both color AND icon so colorblind users aren't dependent on color. Contradiction warnings use the AlertTriangle icon + yellow tint (not just yellow).

### 7.8 Mobile Behaviour

PMs use SpecLoom on phones. The mobile experience must be great, not adequate.

#### 7.8.1 Breakpoints

| Width | Behaviour |
|---|---|
| ≤ 640px | Mobile layout: drawer becomes bottom sheet, tabs become segmented control |
| 641-1023px | Tablet layout: drawer is side panel 60% width, tabs full |
| ≥ 1024px | Desktop layout: drawer 420px right-side, tabs + context panels |

#### 7.8.2 Capture On Mobile

The capture pill-button is larger on mobile (44px min height per iOS HIG) and positioned bottom-center instead of bottom-right to be thumb-reachable.

Voice is the default on mobile — the mic icon is the primary visual in the capture sheet, text input is secondary. On mobile, PMs are walking, driving, standing in line; voice wins.

The sheet uses native momentum scrolling and a swipe-down-to-close gesture.

#### 7.8.3 Ask-The-KB On Mobile

Full-screen on mobile. The Context drawer becomes a collapsible bottom sheet that auto-appears after each answer. Sources are stacked chips; tapping opens a full-screen viewer (video at timestamp, note, doc section).

#### 7.8.4 Sync Preview On Mobile

The modal becomes a full-screen sheet. Tabs are preserved. The "Apply Sync" button is fixed to the bottom so it's always reachable.

#### 7.8.5 iOS Share Sheet (Deferred)

The v2 design floated "iOS Share Sheet → Add to SpecLoom" for capturing thoughts from other apps. This is a PWA manifest `share_target` + iOS Shortcuts integration. **Deferred to v1.1** — nice to have, not blocking.

---

## 8. Later Phases UX (v1.1 - v2.1)

Lighter detail than §7. Each of these is a phase following v1.0 Magical Core.

### 8.1 v1.1 — Note Stream (2 days)

A chronological feed of all captures. Tab: `📋 Stream`.

**Layout:** full-width list, one row per note, newest first. Each row shows:
- Time-ago (e.g., "2h ago")
- Type pill + feature area pill
- First 120 chars of body
- Status indicator (draft / active / synced)
- Inline action menu (•••)

**Filters:** horizontal chip row at the top (not a sidebar) — "All · Pending probes · Unresolved contradictions · Archived · Clarifications from devs". Adding a feature area as a filter tag is a click on any feature pill.

**Search:** `Cmd+K` opens a command palette with full-text search across all notes.

**Per-note detail:** clicking a row opens a side drawer (not a page navigation — preserves Stream context). The drawer shows:
- Full body with edit affordance
- Classification (editable)
- Feature areas (editable)
- References (editable)
- Probes status (answered / pending / dismissed)
- KB influence (once synced) — "This note contributed to: BR-049 in feature X"
- Timeline: created → AI analyzed → answered probes → synced → merged into KB
- Actions: Archive / Supersede / Duplicate

**Bulk operations:** `Shift+click` selects a range; actions appear in a floating action bar at the bottom.

### 8.2 v1.2 — Readiness Dashboard (1.5 days)

Tab: `📊 Readiness`. Renders a dimensional score using existing `completeness-radar.tsx` component plus new breakdown cards.

**Top section:** overall score as a single number + delta from last week ("74%, +12 from 7 days ago").

**Dimension cards:** one card per dimension — Features, Business Rules, Entities, Workflows, Roles, Error Handling, Integrations. Each card:
- Progress bar with current/target counts
- Top 3 gaps ("Missing: User Account · 0 BRs for Steuer-News Email · Integration X has no error handling defined")
- "Fix now →" button per gap → jumps to the right surface (open questions, capture drawer pre-filled, etc.)

**AI Quick Wins panel:** 3-5 AI-suggested actions the PM can take right now to close the biggest gaps. Each is a single click.

Uses the existing `completeness-radar.tsx`, `gap-report.tsx`, and `data-model-view.tsx` components where applicable — minimizes new UI work.

### 8.3 v1.3 — KB Explorer (3 days)

Tab: `🔍 Explore`. Read-only view onto the Knowledge Base.

**Tabs within:** Features, Entities (table, no graph in v1), Rules, Workflows, Open Questions.

Reuses existing components:
- `feature-map.tsx` for Features tab
- `data-model-view.tsx` for Entities tab
- `cross-references.tsx` for relationship display

**New components for this phase:** Rules table (filterable, sortable), Workflows diagram-renderer (markdown mermaid via remark plugin).

**Cross-linking:** every item links to its source artefacts (notes, videos, documents). Clicking a source navigates with context preserved.

**KB Version label:** persistent at the top of every Explorer tab: "KB v39 · synthesized Apr 18, 2026 · 4 videos, 3 docs, 12 notes". Clicking the label shows version history + diff view.

### 8.4 v1.4 — Cross-Linking (1 day)

Polish pass that wires bidirectional links everywhere:
- Note detail → generated documents that contain content from this note
- Document section → notes that contributed to it
- Business rule → note of origin + video timestamp
- Entity → notes that defined its fields

Pure plumbing, no new UI components. Query layer changes only.

### 8.5 v2.0 — CodeMantis Clarification Loop (3 days)

Integrates with `clarification_requests` table from AI Implementation Guides v3 §9.4.

**Inbound:** a developer hits ambiguity in a session. Their agent (Claude Code, Cursor, Windsurf, CodeMantis) POSTs to `/api/clarifications` (Guides v3 §17.9). The request appears in the PM's Workbench:

- Status bar banner: "⚠ Inbox: 2 developer clarifications awaiting answer [Open]"
- New tab in Stream filters: "Clarifications from devs"
- Each clarification card shows: the question, the session that raised it, which guide/feature it belongs to, the dev's context, and a big [Answer] button

**Answering:** tapping [Answer] opens the capture drawer pre-filled with: (a) the question as a quoted reference in the body, (b) the feature area pre-tagged, (c) a reference back to the clarification. The PM writes the answer (text or voice), saves, syncs, and optionally regenerates the affected session.

**Resolution feedback:** once the PM answers + syncs + regenerates, a webhook (if CodeMantis is connected) notifies the dev's agent to pull the updated session. Without CodeMantis, the PM's answer is visible in the clarification status for the dev to check manually.

### 8.6 v2.1 — Polish (3 days)

- Entity force-directed graph (deferred from v2)
- KB version diff viewer (using the `diff` library already in dependencies)
- Note templates (pre-fill capture drawer for common patterns)
- Email intake (forward an email to notes@project.specloom.io)

---

## 9. Data Model — Database Schema

### 9.1 Tables Overview

| Table | Purpose | New? |
|---|---|---|
| `quick_notes` | The main notes table | Yes |
| `note_probes` | AI-generated probes per note | Yes |
| `note_contradictions` | Detected conflicts between notes | Yes |
| `kb_versions` | Versioned KB snapshots for sync history | Yes |
| `sync_previews` | Ephemeral dry-run results (1hr TTL) | Yes |
| `sync_jobs` | Async Apply job tracking | Yes |
| `conversations` | Extended to support `conversation_type='ask_kb'` | Existing, extended |
| `clarification_requests` | Inbound from agents (defined in Guides v3 §9.4) | Existing (from Guides v3) |

### 9.2 `quick_notes`

```sql
CREATE TABLE quick_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT GENERATED ALWAYS AS ('N-' || lpad((EXTRACT(epoch FROM created_at)::bigint % 100000)::text, 5, '0')) STORED,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  -- Core content
  body TEXT NOT NULL CHECK (length(body) >= 1),

  -- AI-inferred classification (editable by PM)
  note_type TEXT NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('business_rule','edge_case','clarification','domain_term',
                          'constraint','question_for_self','general')),
  note_type_confidence NUMERIC(3,2),        -- AI confidence 0.00-1.00; NULL if human-set
  note_type_ai_suggested BOOLEAN DEFAULT FALSE,
  note_type_accepted_by_user BOOLEAN DEFAULT FALSE,

  -- Feature areas (editable by PM)
  feature_areas TEXT[] DEFAULT '{}',
  feature_areas_ai_suggested BOOLEAN DEFAULT FALSE,
  feature_areas_accepted_by_user BOOLEAN DEFAULT FALSE,

  -- Free-form tags
  tags TEXT[] DEFAULT '{}',

  -- References to other SpecLoom artefacts
  -- Shape: [{"kind": "video"|"document"|"note"|"clarification", "id": "uuid",
  --          "timestamp_seconds": N, "page": N, "section": "text"}]
  refs JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Voice origin
  voice_audio_storage_path TEXT,
  voice_duration_seconds INTEGER,
  voice_transcription_cost NUMERIC(10,6),

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','archived','superseded')),
  superseded_by UUID REFERENCES quick_notes(id),
  superseded_reason TEXT,

  -- Parent note (for probes-become-notes, clarifications-become-notes)
  parent_note_id UUID REFERENCES quick_notes(id),
  parent_kind TEXT CHECK (parent_kind IN ('probe_answer','clarification_answer','askkb_capture','manual')),

  -- Clarification linkage (v2.0)
  answers_clarification_id UUID,  -- FK added in v2.0 when clarification_requests exists

  -- AI post-processing status
  ai_post_processing_status TEXT DEFAULT 'pending'
    CHECK (ai_post_processing_status IN ('pending','running','done','failed','not_needed')),
  ai_post_processing_cost NUMERIC(10,6) DEFAULT 0,

  -- KB incorporation trail
  kb_incorporation JSONB,
  -- Shape: {"kb_version": 39, "incorporated_at": "...",
  --          "applied_to": [{"field": "business_rules", "rule_id": "BR-049"},
  --                          {"field": "feature_map", "feature": "Steuer-News"}],
  --          "sync_job_id": "uuid"}

  last_synced_at TIMESTAMPTZ,
  last_synced_kb_version INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quick_notes_project_status ON quick_notes(project_id, status);
CREATE INDEX idx_quick_notes_project_created ON quick_notes(project_id, created_at DESC);
CREATE INDEX idx_quick_notes_type ON quick_notes(project_id, note_type);
CREATE INDEX idx_quick_notes_feature_areas ON quick_notes USING GIN (feature_areas);
CREATE INDEX idx_quick_notes_tags ON quick_notes USING GIN (tags);
CREATE INDEX idx_quick_notes_search ON quick_notes USING GIN (to_tsvector('simple', body));
CREATE INDEX idx_quick_notes_pending_sync ON quick_notes(project_id, last_synced_at)
  WHERE status = 'active' AND (last_synced_at IS NULL OR updated_at > last_synced_at);

CREATE TRIGGER update_quick_notes_updated_at BEFORE UPDATE
  ON quick_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quick_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY quick_notes_project_access ON quick_notes
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.3 `note_probes`

AI-generated follow-up questions per note.

```sql
CREATE TABLE note_probes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  probe_text TEXT NOT NULL,
  probe_index INTEGER NOT NULL,                        -- 0-based order within a note
  generation_model TEXT,
  generation_cost NUMERIC(10,6) DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','answered','skipped','not_relevant')),
  answer_note_id UUID REFERENCES quick_notes(id),      -- when answered, the resulting child note
  dismissed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(note_id, probe_index)
);

CREATE INDEX idx_note_probes_note ON note_probes(note_id);
CREATE INDEX idx_note_probes_project_pending ON note_probes(project_id, status)
  WHERE status = 'pending';

CREATE TRIGGER update_note_probes_updated_at BEFORE UPDATE
  ON note_probes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE note_probes ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_probes_project_access ON note_probes
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.4 `note_contradictions`

Detected conflicts between notes.

```sql
CREATE TABLE note_contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  note_a_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
  note_b_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,

  description TEXT NOT NULL,
  detection_model TEXT,
  detection_cost NUMERIC(10,6) DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (status IN ('unresolved','resolved_use_a','resolved_use_b','resolved_both','dismissed')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_note_id UUID REFERENCES quick_notes(id),  -- if resolution created a new clarifying note

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (note_a_id <> note_b_id)
);

CREATE INDEX idx_contradictions_project_status ON note_contradictions(project_id, status);
CREATE INDEX idx_contradictions_note_a ON note_contradictions(note_a_id);
CREATE INDEX idx_contradictions_note_b ON note_contradictions(note_b_id);

CREATE TRIGGER update_note_contradictions_updated_at BEFORE UPDATE
  ON note_contradictions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE note_contradictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_contradictions_project_access ON note_contradictions
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.5 `kb_versions`

Versioned KB snapshots. The existing `knowledge_bases` table stores the current KB; this new table stores every historical version so we can diff and rollback.

```sql
CREATE TABLE kb_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,

  -- Full KB snapshot (same shape as knowledge_bases.kb_content)
  kb_content JSONB NOT NULL,

  -- What triggered this version
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('full_synthesis','notes_sync','manual_edit','migration')),
  source_sync_job_id UUID,                           -- if source_kind='notes_sync'
  notes_incorporated_ids UUID[],                      -- if source_kind='notes_sync'

  -- Diff from previous version (computed at creation, for fast read)
  -- Shape: {"added": {...}, "removed": {...}, "modified": {...}}
  diff_from_previous JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(project_id, version_number)
);

CREATE INDEX idx_kb_versions_project ON kb_versions(project_id, version_number DESC);
CREATE INDEX idx_kb_versions_source ON kb_versions(source_kind);

ALTER TABLE kb_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY kb_versions_project_access ON kb_versions
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.6 `sync_previews`

Ephemeral dry-run results. Cached for 1 hour so re-opening the preview doesn't re-run the expensive dry-run.

```sql
CREATE TABLE sync_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  -- Which notes were considered
  pending_note_ids UUID[],
  base_kb_version INTEGER NOT NULL,

  -- Predicted changes (for the Preview modal)
  predicted_kb_changes JSONB NOT NULL,
  predicted_document_impact JSONB NOT NULL,
  blockers JSONB NOT NULL,                            -- unresolved contradictions

  -- Cost estimates
  estimated_cost_usd NUMERIC(10,6),
  estimated_duration_seconds INTEGER,

  -- Cache
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 hour'),
  applied_via_sync_job_id UUID,                       -- set when the preview is actually applied

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_previews_project ON sync_previews(project_id, expires_at)
  WHERE applied_via_sync_job_id IS NULL;

ALTER TABLE sync_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_previews_project_access ON sync_previews
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Cleanup job: delete expired unused previews (to be added to scheduled Supabase function)
-- SELECT cron.schedule('cleanup-sync-previews', '0 * * * *', $$
--   DELETE FROM sync_previews
--   WHERE expires_at < now() AND applied_via_sync_job_id IS NULL;
-- $$);
```

### 9.7 `sync_jobs`

Async apply job tracking.

```sql
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  sync_preview_id UUID REFERENCES sync_previews(id),
  note_ids UUID[] NOT NULL,
  base_kb_version INTEGER NOT NULL,

  -- Execution progress (for the real-time progress UI in §7.4.3)
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','rolled_back')),
  current_step TEXT,                                  -- human-readable current step
  step_index INTEGER DEFAULT 0,
  total_steps INTEGER,
  progress_detail JSONB,                              -- free-form step-by-step detail

  -- Output
  resulting_kb_version INTEGER,
  actual_cost_usd NUMERIC(10,6),
  actual_duration_seconds INTEGER,

  error_message TEXT,
  error_detail JSONB,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_jobs_project_status ON sync_jobs(project_id, status);
CREATE INDEX idx_sync_jobs_project_created ON sync_jobs(project_id, created_at DESC);

CREATE TRIGGER update_sync_jobs_updated_at BEFORE UPDATE
  ON sync_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_jobs_project_access ON sync_jobs
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.8 `conversations` Extension

The existing `conversations` table already has `conversation_type` text column. Extend by using a new value:

```sql
-- No DDL needed — conversations.conversation_type is a text column
-- New value: 'ask_kb'
-- Existing values: 'onboarding', 'qa_session'
```

For Ask-the-KB, the `messages` JSONB column stores the turns:
```json
[
  {"role": "user", "content": "...", "timestamp": "..."},
  {"role": "assistant", "content": "...", "timestamp": "...",
   "sources": [{"kind": "video", "id": "...", "timestamp_seconds": 134}, ...]}
]
```

For v1.0 this is fine. If chat sessions grow very long, a future migration can lift messages to a dedicated table.

### 9.9 Cost Operation Enum Additions

```sql
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'note_voice_transcription';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'note_proactive_analysis';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'note_contradiction_detection';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'ask_kb_response';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'sync_preview_dry_run';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'notes_sync_incorporation';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'notes_sync_rule_extraction';
```

---

## 10. Migration Plan (Database)

Single migration file: `supabase/migrations/2026NNNN_knowledge_workbench.sql`. Order:

1. `quick_notes` table + indexes + trigger + RLS + policy
2. `note_probes` table + indexes + trigger + RLS + policy
3. `note_contradictions` table + indexes + trigger + RLS + policy
4. `kb_versions` table + indexes + RLS + policy
5. `sync_previews` table + indexes + RLS + policy
6. `sync_jobs` table + indexes + trigger + RLS + policy
7. Cost enum additions
8. Backfill: seed `kb_versions` with the current `knowledge_bases.kb_content` for every project that has one, as `version_number=1, source_kind='migration'`

No schema change to `conversations` — we just use `conversation_type='ask_kb'` going forward.

---

## 11. Pipeline Stages (Backend)

New Python modules in `fly-containers/specforge-worker/src/pipeline/`:

### 11.1 `pipeline/note_proactive_analysis.py`

Triggered on every note save. Single AI call produces classification + probes + contradictions.

```python
async def analyze_note_proactive(note: QuickNote, project_kb: dict) -> dict:
    """Single AI call, Grok 4.20 non-reasoning, returns:
      {
        classification: {type: str, type_confidence: float,
                         feature_areas: [str], feature_areas_confidence: float},
        references: [{kind, id, timestamp_seconds?}],  # auto-extracted from body
        probes: [str],  # 1-3 follow-up questions
        contradictions: [{with_note_id: uuid, description: str}]  # matches against recent notes + KB
      }
    Budget: ~$0.001 per call. Timeout: 30s."""
```

Model: `grok-4.20-non-reasoning-latest` (per existing convention). Falls back to `gemini-3-flash-preview` if Grok times out.

Outputs: inserts `note_probes` rows, inserts `note_contradictions` rows, updates `quick_notes` classification fields with `*_ai_suggested=true`.

### 11.2 `pipeline/note_voice_transcription.py`

Whisper streaming via existing voice infrastructure + a cleanup pass.

```python
async def transcribe_note_voice(audio_blob: bytes, language_hint: str | None = None) -> dict:
    """Whisper transcribe → cleanup pass (remove filler words, split run-ons)
       Returns: {transcript: str, cleaned_transcript: str, duration_seconds: int, cost: float}"""
```

Reuses the existing `transcribe-audio` Edge Function for Whisper call; adds a cleanup pass via a tiny Gemini Flash prompt (~$0.0001).

### 11.3 `pipeline/ask_kb_rag.py`

Retrieval-augmented generation over the project's knowledge sources.

```python
async def ask_kb(project_id: str, question: str, conversation_history: list[dict]) -> AsyncIterator[dict]:
    """Streaming RAG pipeline:
       1. Generate embedding for question (existing embeddings infrastructure)
       2. Retrieve top-K chunks from: video transcripts, documents, quick_notes,
          KB feature descriptions, business rules
       3. Feed (question + history + chunks) to Gemini 3 Flash; stream response
       4. Extract source citations from response
       Yields: {type: 'token' | 'source' | 'done', data: ...}"""
```

Reuses the embeddings index already built for synthesis. No new embedding infrastructure.

### 11.4 `pipeline/notes_sync_preview.py`

Dry-run of the sync: predicts KB changes, document impact, blockers. Does NOT write anything.

```python
async def compute_sync_preview(project_id: str, note_ids: list[str]) -> dict:
    """Returns the shape stored in sync_previews.predicted_kb_changes etc.
       Uses Gemini Flash Lite for the dry-run (cheap, fast)."""
```

Execution plan: group notes by feature area → for each group, a tiny AI call predicts "what BRs, entities, feature descriptions would change" without actually computing the merged KB. Output is a predicted diff, not a real diff — fast and cheap.

Cost: ~$0.01 for a typical 10-note sync.

### 11.5 `pipeline/notes_sync_apply.py`

The real sync. This is the expensive one (~$0.05-0.20).

```python
async def apply_notes_sync(sync_job_id: str) -> None:
    """Full incremental incorporation:
       1. Load current KB
       2. Load all active notes flagged for sync
       3. Group by feature area (untagged → global bucket)
       4. Per-bucket AI call: merge notes into that feature's KB content
       5. Global AI call: merge untagged notes into executive_summary, system_context
       6. Extraction AI call: BR/edge_case/constraint notes → structured business_rules[]
       7. Save new kb_versions row with full snapshot + diff_from_previous
       8. Update knowledge_bases (current pointer) to the new version
       9. Update each note's kb_incorporation with version + applied_to
      10. Mark sync_job as completed

       Progress events emitted at each step for real-time UI."""
```

Model: `grok-4.20-reasoning-latest` with `thinking_effort='low'` — structural merging task, same profile as screenshot re-binding.

**Progress emission:** the UI needs real-time progress (§7.4.3). Use Supabase Realtime on `sync_jobs` — UPDATE the row's `current_step` at each milestone, the UI subscribes and re-renders.

### 11.6 `pipeline/kb_diff.py`

Given two KB versions, compute a structured diff. Used by both sync preview and post-sync review.

```python
def compute_kb_diff(before: dict, after: dict) -> dict:
    """Returns {added: {...}, removed: {...}, modified: {...}} per field.
       Uses the 'diff' npm package semantics but in Python — walk the JSONB structure."""
```

Pure function, no AI, no cost. Used everywhere sync or version comparison happens.

### 11.7 `pipeline/note_orchestration.py`

Top-level orchestrator for note lifecycle events. Subscribes to:
- `quick_notes` INSERT → triggers `note_proactive_analysis` async
- Voice upload → triggers `note_voice_transcription`
- Sync preview request → triggers `notes_sync_preview`
- Sync apply request → triggers `notes_sync_apply`

Dispatches to the appropriate pipeline module with cost tracking and error handling.

---

## 12. API Surface (Supabase Edge Functions)

New Edge Functions in `supabase/functions/`:

### 12.1 Notes CRUD

- `POST /functions/v1/notes` — create a note. Triggers proactive analysis async. Returns immediately with note + job_id.
- `GET /functions/v1/notes?project_id=X&status=Y&limit=N&cursor=...` — paginated list, filterable.
- `GET /functions/v1/notes/:id` — single note with embedded probes, contradictions, kb_incorporation.
- `PATCH /functions/v1/notes/:id` — edit body, classification, feature areas, tags, status.
- `DELETE /functions/v1/notes/:id` — soft-delete (sets `status='archived'`). Hard delete never from API.
- `POST /functions/v1/notes/:id/supersede` — body `{superseded_by_id, reason}`.

### 12.2 Voice Capture

- `POST /functions/v1/notes/voice-upload` — multipart upload of audio blob. Returns `{note_id, transcription_job_id}`. Transcription runs async.
- `GET /functions/v1/notes/:id/transcription-status` — poll or (preferred) subscribe via Realtime.

### 12.3 Probes

- `PATCH /functions/v1/note-probes/:id/status` — body `{status: 'answered' | 'skipped' | 'not_relevant'}`. On `answered`, the body also includes the new note content, which creates a child note.
- `POST /functions/v1/note-probes/:id/answer` — creates a child note as the probe answer. Triggers full note creation flow for the child (proactive analysis etc.).

### 12.4 Contradictions

- `PATCH /functions/v1/note-contradictions/:id/resolve` — body `{resolution: 'use_a' | 'use_b' | 'both'}`. Updates both notes' `superseded_by` fields as appropriate.

### 12.5 Ask KB

- `POST /functions/v1/ask-kb` — body `{project_id, conversation_id?, question}`. Server-sent events stream of tokens + source citations. Creates a new `conversations` row if `conversation_id` is omitted.
- `GET /functions/v1/ask-kb/conversations?project_id=X` — list past conversations.
- `POST /functions/v1/ask-kb/capture-answer` — body `{conversation_id, message_index}`. Creates a note from the specified AI answer, pre-populating body + tags + references. Returns the new note.

### 12.6 Sync

- `POST /functions/v1/sync/preview` — body `{project_id}`. Returns a `sync_preview_id` + preview data. The preview is cached (1hr) so re-opens are instant.
- `GET /functions/v1/sync/previews/:id` — retrieve a cached preview.
- `POST /functions/v1/sync/apply` — body `{sync_preview_id}`. Creates a `sync_jobs` row and triggers async pipeline. Returns `{sync_job_id}` immediately.
- `GET /functions/v1/sync/jobs/:id` — current status of a sync job. Real-time via Supabase subscription.
- `POST /functions/v1/sync/rollback` — body `{project_id, to_version}`. Rolls the KB back to a prior version (within 24h soft-rollback window).

### 12.7 KB Versions

- `GET /functions/v1/kb-versions?project_id=X` — list versions with summaries.
- `GET /functions/v1/kb-versions/:id/diff` — structured diff vs previous version (for the v2.1 diff viewer).

### 12.8 Clarifications (from Guides v3 §17.9-17.11)

These endpoints are defined in AI Implementation Guides v3; this spec just consumes them on the PM side:
- `GET /functions/v1/clarifications?project_id=X&status=pending` — list for the Inbox tab.
- `POST /functions/v1/clarifications/:id/answer` — PM answers; creates a `quick_notes` row linked to the clarification; flags the originating session for regeneration.

---

## 13. Frontend Architecture

### 13.1 Routing

Add to `src/router.tsx`:

```ts
{
  path: 'projects/:projectId/workbench',
  element: <WorkbenchPage />,
  children: [
    { index: true, element: <Navigate to="capture" replace /> },
    { path: 'capture',   element: <CaptureTab /> },
    { path: 'stream',    element: <StreamTab /> },      // v1.1
    { path: 'ask',       element: <AskKbTab /> },
    { path: 'readiness', element: <ReadinessTab /> },   // v1.2
    { path: 'explore',   element: <ExploreTab /> },     // v1.3
  ]
}
```

### 13.2 New Pages

- `src/pages/project/workbench.tsx` — shell page with tab bar + status bar + `<Outlet />`

### 13.3 New Components

Organized under `src/components/workbench/`:

**Shared infrastructure (v1.0):**
- `WorkbenchShell.tsx` — the tab bar + status bar + layout
- `StatusBar.tsx` — top strip showing pending sync count + clarification inbox count (conditional rendering)
- `TabNav.tsx` — five-tab navigation, `Cmd+1..5` keyboard shortcuts
- `WorkbenchEmptyState.tsx` — first-visit overlay

**Capture (v1.0):**
- `CapturePillButton.tsx` — global floating affordance, visible on every project page
- `CaptureDrawer.tsx` — the sheet / dialog that opens on `Cmd+N`
- `CaptureForm.tsx` — the one-field form inside the drawer
- `CaptureVoiceMode.tsx` — voice mode transformation of the form (reuses `waveform-visualizer` + `voice-controls`)
- `CaptureSuggestions.tsx` — wrapper for post-save AI suggestions
- `ClassificationPills.tsx` — type + feature-area pill row with inline editing
- `ProbeStack.tsx` — stacked probe cards with voice/type/skip actions
- `ContradictionBanner.tsx` — yellow warning banner with resolution buttons
- `SourceExtractor.tsx` — renders auto-extracted `refs` as chips

**Capture tab surface (v1.0):**
- `CaptureTab.tsx` — the "Capture" Workbench tab with recent captures + onboarding
- `RecentCaptureList.tsx` — small list of 5 newest notes with AI enrichment visible
- `RecentCaptureCard.tsx` — one row in the recent list

**Ask KB (v1.0):**
- `AskKbTab.tsx` — the tab shell
- `AskKbConversation.tsx` — the chat main column
- `AskKbContextPanel.tsx` — sources right panel (collapsible on mobile)
- `AskKbMessage.tsx` — one message bubble (user or assistant)
- `AskKbSourceChip.tsx` — clickable source citation chip
- `AskKbInput.tsx` — text input + mic button
- `AskKbVoiceMode.tsx` — full-screen voice conversation (reuses `voice-session-panel`)
- `AskKbHistoryList.tsx` — left sidebar with past conversations

**Sync (v1.0):**
- `SyncPreviewModal.tsx` — the four-tab modal (Overview / KB Changes / Document Impact / Blockers)
- `SyncOverviewTab.tsx`
- `SyncKbChangesTab.tsx`
- `SyncDocumentImpactTab.tsx`
- `SyncBlockersTab.tsx`
- `SyncProgressView.tsx` — real-time progress display during apply (subscribes to `sync_jobs` via Realtime)
- `SyncSuccessView.tsx` — post-apply success screen with "View KB Changes" / "Regenerate" / "Done"
- `KbDiffView.tsx` — renders a structured diff using the `diff` library for before/after text snippets

**Note detail (v1.0, expanded in v1.1):**
- `NoteDetailDrawer.tsx` — side drawer shown when a note is clicked
- `NoteEditor.tsx` — inline edit of body, classification, areas
- `NoteInfluencePanel.tsx` — "This note contributed to..."
- `NoteTimelineView.tsx` — created → AI analyzed → probes answered → synced

**Later phases (v1.1 - v2.0):**
- `StreamTab.tsx`, `StreamFilterChips.tsx`, `StreamNoteRow.tsx`, `StreamSearchPalette.tsx` (v1.1)
- `ReadinessTab.tsx` (reuses `completeness-radar.tsx`, `gap-report.tsx`) (v1.2)
- `ExploreTab.tsx` (reuses `feature-map.tsx`, `data-model-view.tsx`, `cross-references.tsx`; adds `RulesTable.tsx`, `WorkflowDiagram.tsx`) (v1.3)
- `ClarificationInboxPanel.tsx` (v2.0)

### 13.4 New Hooks

All data-fetching uses `@tanstack/react-query` (already in dependencies). Hooks under `src/hooks/`:

**v1.0:**
- `useNotes(projectId, filters)` — list
- `useNote(noteId)` — single, with embedded probes + contradictions
- `useCreateNote()` — mutation, optimistic update
- `useUpdateNote()` — mutation
- `useSupersedeNote()` — mutation
- `useRetryNoteAnalysis(noteId)` — mutation for "AI didn't respond" retry
- `useVoiceUpload()` — mutation for voice-upload endpoint
- `useProbes(projectId, status)` — list
- `useUpdateProbe()` — mutation
- `useAnswerProbe()` — mutation that creates a child note
- `useContradictions(projectId, status)` — list
- `useResolveContradiction()` — mutation
- `useAskKbConversations(projectId)` — list
- `useAskKbConversation(conversationId)` — single
- `useAskKbStream()` — hook that manages SSE connection for streaming responses
- `useCaptureAskKbAnswer()` — mutation to promote an answer to a note
- `useSyncPreview(projectId)` — mutation (idempotent — cached 1hr)
- `useApplySync()` — mutation
- `useSyncJob(syncJobId)` — subscribes to Realtime, streams progress updates
- `useRollbackKb()` — mutation

**v2.0:**
- `useClarifications(projectId, status)` — list
- `useAnswerClarification()` — mutation that opens capture drawer pre-filled

### 13.5 Global Capture Affordance

`CapturePillButton` is rendered in the project layout wrapper (`src/components/layouts/project-layout.tsx` or equivalent) — NOT inside the Workbench page. This way it's visible on Documents, Videos, Materials, anywhere within a project.

The global `Cmd+N` keyboard listener is registered in the same layout wrapper. Press `Cmd+N` anywhere in a project → `CaptureDrawer` opens.

### 13.6 Keyboard Shortcut Registry

A single `src/hooks/useKeyboardShortcuts.ts` that registers all Workbench shortcuts centrally. This prevents collision with existing shortcuts and makes them discoverable via a `Cmd+/` help overlay.

### 13.7 State Management

- Query cache via React Query (per-key auto-refetch on window focus, stale-while-revalidate)
- Local UI state via React's built-in hooks — no Redux, no Zustand
- IndexedDB draft persistence via `idb-keyval` (tiny library, add to dependencies) for the capture drawer's local draft

### 13.8 Voice Reuse

The Workbench's voice features reuse these existing components without modification:
- `waveform-visualizer.tsx` (in capture drawer and Ask KB voice mode)
- `voice-controls.tsx` (in capture drawer)
- `voice-session-panel.tsx` (in Ask KB full voice mode)
- `voice-transcript.tsx` (in capture drawer for live transcript display)

The existing `transcribe-audio` Edge Function is reused for Whisper transcription.

---

## 14. Integration With Existing SpecLoom Pipeline

### 14.1 Notes → KB → Downstream Consumers

This is the critical data flow that makes notes actually matter:

```
PM writes note
    ↓
saved to quick_notes (status='active')
    ↓
proactive analysis (probes, contradictions, classification)
    ↓
PM clicks Sync → sync_preview → Apply
    ↓
notes_sync_apply pipeline stage
    ↓
NEW KB version (kb_versions row + knowledge_bases pointer updated)
    ↓
Every downstream consumer reads the new KB:
    ├── QA Intelligence (gap questions)
    ├── Document Generation
    ├── Epic Tickets
    ├── AI Implementation Guides (v3 spec §12 — read source_notes from KB)
    ├── Ask-the-KB chat (sees notes directly + KB)
    └── CodeMantis integration (on next bundle pull)
```

**No downstream regeneration is automatic.** The PM explicitly triggers doc regeneration, ticket regeneration, guide regeneration from their respective pages. The Workbench's job ends at "new KB version committed."

### 14.2 Integration With AI Implementation Guides v3

Guides v3 §12 consumes notes as authoritative context. That spec already handles the no-op fallback when this Workbench isn't shipped yet. When the Workbench is shipped:

1. Guide generation reads `quick_notes` filtered by feature area matching the session's scope
2. Selected notes become inline context in the session prompt under `### Notes` with source provenance
3. `guide_sessions.source_note_refs` is populated with the IDs of notes that contributed
4. When a note is edited after a guide is generated, the `guide_sessions.auto_regenerate_reason` flag is set (as per Guides v3 §14.3)

### 14.3 Integration With CodeMantis (v2.0 Only)

CodeMantis clarification requests flow in via the `clarification_requests` table defined in Guides v3 §9.4. The Workbench UI's responsibility in v2.0:

- Status bar shows pending clarification count
- "Clarifications from devs" filter in the Stream
- Clarification answer flow (opens capture drawer pre-filled; answer becomes a note; sync triggers; regeneration offered)

Writing the clarification answer as a note means it flows through the same authoritative-input path as any other note. Unified.

### 14.4 Onboarding Data Flow

The existing `projects.onboarding_context` is NOT replaced. It continues to store the one-time onboarding conversation's output. But a post-v1.0 migration can import high-signal facts from `onboarding_context.data` (e.g., primary entities, user roles) into the Workbench as seed notes — one note per structured field. This gives new projects a non-empty Workbench on day 1.

Migration: optional, done once per project when the PM first visits the Workbench. Not a blocking dependency.

---

## 15. Container / Deployment Concerns

### 15.1 Worker Container

All new pipeline modules live in the existing `fly-containers/specforge-worker` container. No new container.

New Python dependencies to add to `requirements.txt`:
- No new ones — `pyyaml`, `httpx`, OpenAI-compat clients all already present

### 15.2 Edge Functions

Each new Edge Function follows the existing pattern (see `supabase/functions/generate-epic-tickets/index.ts` as reference). Deployment via `supabase functions deploy`.

The `job-orchestrator` function is extended to handle two new `job_type` values:
- `note_proactive_analysis`
- `notes_sync_apply`

### 15.3 Realtime

Supabase Realtime is used for two streams:
1. `sync_jobs` UPDATE events → UI shows real-time progress during sync apply
2. `quick_notes` UPDATE events → Stream view (v1.1) shows new notes arriving on other tabs/devices

Realtime is already enabled for the project. We add publications for the new tables:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE sync_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE quick_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE note_probes;
ALTER PUBLICATION supabase_realtime ADD TABLE note_contradictions;
```

### 15.4 Storage

Voice audio blobs are stored in a new Supabase Storage bucket `note-voice/`. TTL: 90 days (audio is rarely revisited after transcription is saved).

RLS on the bucket: project_id-scoped.

### 15.5 Cron Jobs

One new scheduled Supabase function: `cleanup-sync-previews`, runs hourly, deletes expired unused previews (cleanup query from §9.6).

---

## 16. Model Configuration

```sql
INSERT INTO model_configurations (task_name, model_tier, provider, model, thinking_effort, is_active)
VALUES
  -- Proactive note analysis (fast, cheap, on every save)
  ('note_proactive_analysis', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('note_proactive_analysis', 'standard', 'xai',    'grok-4.20-non-reasoning-latest', NULL, true),
  ('note_proactive_analysis', 'premium',  'xai',    'grok-4.20-non-reasoning-latest', NULL, true),

  -- Voice cleanup pass (tiny, fast)
  ('note_voice_cleanup', 'economy',  'google', 'gemini-2.0-flash-lite', 'low', true),
  ('note_voice_cleanup', 'standard', 'google', 'gemini-2.0-flash-lite', 'low', true),
  ('note_voice_cleanup', 'premium',  'google', 'gemini-3-flash-preview', 'low', true),

  -- Ask-the-KB response (quality matters, latency matters)
  ('ask_kb_response', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('ask_kb_response', 'standard', 'google', 'gemini-3.1-pro-preview', 'medium', true),
  ('ask_kb_response', 'premium',  'anthropic', 'claude-sonnet-4-6', 'high', true),

  -- Sync preview dry-run (cheap, must be fast)
  ('sync_preview_dry_run', 'economy',  'google', 'gemini-2.0-flash-lite', 'low', true),
  ('sync_preview_dry_run', 'standard', 'google', 'gemini-2.0-flash-lite', 'medium', true),
  ('sync_preview_dry_run', 'premium',  'google', 'gemini-3-flash-preview', 'medium', true),

  -- Notes sync apply (the expensive one; quality matters)
  ('notes_sync_incorporation', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('notes_sync_incorporation', 'standard', 'xai',    'grok-4.20-reasoning-latest', NULL, true),
  ('notes_sync_incorporation', 'premium',  'xai',    'grok-4.20-reasoning-latest', NULL, true),

  -- Notes sync BR extraction (converts notes → structured business_rules[])
  ('notes_sync_rule_extraction', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('notes_sync_rule_extraction', 'standard', 'google', 'gemini-3.1-pro-preview', 'medium', true),
  ('notes_sync_rule_extraction', 'premium',  'anthropic', 'claude-sonnet-4-6', 'high', true);
```

---

## 17. Cost Estimates

### 17.1 Per-Note Cost (Standard Tier)

| Operation | Model | Cost |
|---|---|---|
| Voice transcription (30s) | Whisper | ~$0.003 |
| Voice cleanup pass | Gemini Flash Lite | ~$0.0001 |
| Proactive analysis (classify + probes + contradictions) | Grok non-reasoning | ~$0.001 |
| **Per-note total (voice)** | | **~$0.004** |
| **Per-note total (text only)** | | **~$0.001** |

### 17.2 Per-Sync Cost (Standard Tier, 10 Notes)

| Operation | Cost |
|---|---|
| Sync preview dry-run | ~$0.01 |
| Sync apply (incorporation per feature area, ~3 AI calls for 10 notes) | ~$0.05-0.15 |
| BR extraction pass | ~$0.02 |
| **Per-sync total** | **~$0.08-0.18** |

### 17.3 Ask-the-KB Chat (Per Turn)

| Operation | Cost |
|---|---|
| Embedding question | ~$0.0001 |
| Retrieve top-K (existing infra, free) | $0 |
| Gemini Pro response (streamed) | ~$0.008-0.015 |
| **Per turn** | **~$0.01** |

### 17.4 Monthly Estimate For An Active PM (3 Weeks, One Project)

| Activity | Volume | Cost |
|---|---|---|
| Notes captured (120 total, 40 via voice) | 120 | $0.20 |
| Ask-the-KB turns | 200 | $2.00 |
| Sync preview + apply | 12 | $2.00 |
| **Total** | | **~$4.20 / month** |

An active PM costs ~$4/month in Workbench operations. This is negligible against the value created.

---

## 18. Implementation Sequence

### 18.1 v1.0 Magical Core (6 days)

Strictly ordered so each step ends with a testable deliverable.

| # | Layer | Effort | Task |
|---|---|---|---|
| 1 | DB | 0.5 day | Migration: all tables + RLS + cost enum + realtime publications |
| 2 | Backend | 0.5 day | `pipeline/note_proactive_analysis.py` + cost tracking |
| 3 | Backend | 0.25 day | `pipeline/note_voice_transcription.py` wrapper around existing `transcribe-audio` |
| 4 | API | 0.5 day | Notes CRUD Edge Functions (create, list, get, patch, delete, supersede) |
| 5 | API | 0.25 day | Voice upload + transcription status Edge Functions |
| 6 | API | 0.25 day | Probes update + answer Edge Functions |
| 7 | API | 0.25 day | Contradictions resolve Edge Function |
| 8 | Frontend | 0.5 day | `CapturePillButton` + keyboard shortcut + layout integration — appears everywhere in a project |
| 9 | Frontend | 1 day | `CaptureDrawer` + `CaptureForm` + text capture flow end-to-end (save, optimistic UI, IndexedDB draft) |
| 10 | Frontend | 0.5 day | `CaptureVoiceMode` + wiring to existing voice infrastructure |
| 11 | Frontend | 0.75 day | `CaptureSuggestions` + `ClassificationPills` + `ProbeStack` + `ContradictionBanner` — all post-save AI UI |
| 12 | Frontend | 0.25 day | `CaptureTab` with recent captures + first-use onboarding overlay |
| 13 | Backend | 0.5 day | `pipeline/ask_kb_rag.py` + streaming infrastructure |
| 14 | API | 0.25 day | Ask-KB Edge Function (SSE streaming) + conversation list/create/capture-answer |
| 15 | Frontend | 1 day | `AskKbTab` + conversation + context panel + voice mode |
| 16 | Backend | 1 day | `pipeline/notes_sync_preview.py` + `notes_sync_apply.py` + `kb_diff.py` |
| 17 | API | 0.5 day | Sync Edge Functions (preview, apply, jobs, rollback) |
| 18 | Frontend | 1 day | `SyncPreviewModal` + all four tabs + apply flow + real-time progress + rollback |
| 19 | Integration testing | 0.5 day | End-to-end test on a real project (Atikon) — create notes, sync, verify KB updates |
| **Total** | | **~9 days** | |

*The v2 estimate was 6 days. With full-stack detail, realistic effort is closer to 9. This is the truthful number; budget accordingly.*

### 18.2 v1.1 Stream (2 days)

Note Stream page with filters, search, per-note detail.

### 18.3 v1.2 Readiness (1.5 days)

Dimensional scoring dashboard. Heavy reuse of existing `completeness-radar.tsx`.

### 18.4 v1.3 Explorer (3 days)

KB Explorer. Heavy reuse of existing `feature-map.tsx`, `data-model-view.tsx`, `cross-references.tsx`. New: Rules table, Workflows diagram.

### 18.5 v1.4 Cross-Linking (1 day)

Bidirectional link plumbing everywhere.

### 18.6 v2.0 CodeMantis Loop (3 days)

Inbox for clarifications, answer flow, regeneration trigger. Requires Guides v3 §9.4 `clarification_requests` table to exist.

### 18.7 v2.1 Polish (3 days)

Entity graph (deferred from v1.3), KB diff viewer, note templates, email intake.

**Cumulative total for full vision:** ~22.5 days.
**v1.0 is the commitment.** Everything else is iterative improvement.

---

## 19. Files Inventory

### 19.1 Database

- `supabase/migrations/2026NNNN_knowledge_workbench.sql`

### 19.2 Backend Pipeline

- `fly-containers/specforge-worker/src/pipeline/note_proactive_analysis.py`
- `fly-containers/specforge-worker/src/pipeline/note_voice_transcription.py`
- `fly-containers/specforge-worker/src/pipeline/ask_kb_rag.py`
- `fly-containers/specforge-worker/src/pipeline/notes_sync_preview.py`
- `fly-containers/specforge-worker/src/pipeline/notes_sync_apply.py`
- `fly-containers/specforge-worker/src/pipeline/kb_diff.py`
- `fly-containers/specforge-worker/src/pipeline/note_orchestration.py`
- `fly-containers/specforge-worker/src/pipeline/test_note_proactive_analysis.py`
- `fly-containers/specforge-worker/src/pipeline/test_ask_kb_rag.py`
- `fly-containers/specforge-worker/src/pipeline/test_notes_sync_preview.py`
- `fly-containers/specforge-worker/src/pipeline/test_notes_sync_apply.py`
- `fly-containers/specforge-worker/src/pipeline/test_kb_diff.py`

### 19.3 Supabase Edge Functions

- `supabase/functions/notes/index.ts` (CRUD)
- `supabase/functions/notes-voice-upload/index.ts`
- `supabase/functions/note-probes/index.ts`
- `supabase/functions/note-contradictions/index.ts`
- `supabase/functions/ask-kb/index.ts`
- `supabase/functions/sync-preview/index.ts`
- `supabase/functions/sync-apply/index.ts`
- `supabase/functions/sync-jobs/index.ts`
- `supabase/functions/sync-rollback/index.ts`
- `supabase/functions/kb-versions/index.ts`

### 19.4 Frontend Pages

- `src/pages/project/workbench.tsx`

### 19.5 Frontend Components (v1.0)

All under `src/components/workbench/`:
- `WorkbenchShell.tsx`
- `StatusBar.tsx`
- `TabNav.tsx`
- `WorkbenchEmptyState.tsx`
- `CapturePillButton.tsx`
- `CaptureDrawer.tsx`
- `CaptureForm.tsx`
- `CaptureVoiceMode.tsx`
- `CaptureSuggestions.tsx`
- `ClassificationPills.tsx`
- `ProbeStack.tsx`
- `ContradictionBanner.tsx`
- `SourceExtractor.tsx`
- `CaptureTab.tsx`
- `RecentCaptureList.tsx`
- `RecentCaptureCard.tsx`
- `AskKbTab.tsx`
- `AskKbConversation.tsx`
- `AskKbContextPanel.tsx`
- `AskKbMessage.tsx`
- `AskKbSourceChip.tsx`
- `AskKbInput.tsx`
- `AskKbVoiceMode.tsx`
- `AskKbHistoryList.tsx`
- `SyncPreviewModal.tsx`
- `SyncOverviewTab.tsx`
- `SyncKbChangesTab.tsx`
- `SyncDocumentImpactTab.tsx`
- `SyncBlockersTab.tsx`
- `SyncProgressView.tsx`
- `SyncSuccessView.tsx`
- `KbDiffView.tsx`
- `NoteDetailDrawer.tsx`
- `NoteEditor.tsx`
- `NoteInfluencePanel.tsx`
- `NoteTimelineView.tsx`

### 19.6 Frontend Hooks (v1.0)

Under `src/hooks/`:
- `useNotes.ts`
- `useNote.ts`
- `useCreateNote.ts`
- `useUpdateNote.ts`
- `useSupersedeNote.ts`
- `useRetryNoteAnalysis.ts`
- `useVoiceUpload.ts`
- `useProbes.ts`
- `useUpdateProbe.ts`
- `useAnswerProbe.ts`
- `useContradictions.ts`
- `useResolveContradiction.ts`
- `useAskKbConversations.ts`
- `useAskKbConversation.ts`
- `useAskKbStream.ts`
- `useCaptureAskKbAnswer.ts`
- `useSyncPreview.ts`
- `useApplySync.ts`
- `useSyncJob.ts`
- `useRollbackKb.ts`
- `useKeyboardShortcuts.ts`

### 19.7 Files Modified

- `src/router.tsx` — add Workbench route + child routes
- `src/components/layouts/project-layout.tsx` — mount `CapturePillButton` + global `Cmd+N` handler
- The project sidebar navigation component — add "Workbench" menu item between Materials and Documents
- `supabase/functions/job-orchestrator/index.ts` — handle `note_proactive_analysis` and `notes_sync_apply` job types

### 19.8 New Dependency

`idb-keyval` for IndexedDB draft persistence. Add to `package.json` dependencies.

---

## 20. Success Metrics

Targets for a PM using SpecLoom for 3 weeks on a real project.

### 20.1 Adoption Metrics

1. **≥ 100 notes captured** (voice + text). Below 50 → zero-friction capture failed.
2. **≥ 30% of notes captured via voice.** Below 10% → voice UX failed.
3. **≥ 5 Ask-the-KB turns per working day.** Below 1 → interface is not being reached for.
4. **≥ 2 syncs per week.** Below 1/week → fear of sync or value not felt.

### 20.2 Quality Metrics

5. **≥ 60% of AI probes answered or dismissed-not-skipped.** Below 40% → probes are noise.
6. **≥ 80% of contradictions resolved within 24h.** Below 50% → contradiction UI is confusing.
7. **AI classification accepted as-is on ≥ 70% of notes.** Below 50% → classification is untrustworthy.

### 20.3 Impact Metrics

8. **Every note that was synced contributes to ≥ 1 KB field.** 100% target. Below 90% → sync is losing content.
9. **Readiness score moves from <60% to >85% over 3 weeks** (v1.2+).
10. **Zero "lost thought" reports** (notes saved but disappeared). 100% target.

### 20.4 Emotional Metric

11. **Post-use survey:** "SpecLoom feels like thinking with someone." ≥ 7/10 on a Likert scale.

Miss any three → the v3 design didn't deliver. Hit all → category-defining product.

---

## 21. Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Proactive AI feels intrusive or wrong → PMs stop capturing | Catastrophic | Ship probe_level setting (off/light/thorough); auto-downgrade on dismissal streak (§7.2.2) |
| Voice transcription poor on non-German/English | Medium | Whisper large-v3 is multilingual; allow explicit language override if needed |
| Sync is too slow → fear of apply | High | Dry-run caches 1hr; apply runs async with real-time progress; rollback available 24h |
| Contradiction detection false-positives | High | "Both correct" resolution teaches the AI per-project; silently reduce detection threshold after N wrong flags |
| Notes contradict existing KB content (not just other notes) | Medium | v1.1 adds KB-aware contradiction detection; v1.0 limited to note-vs-note |
| Ask-the-KB hallucinations | High | Force source citations; "no sources" = "I don't have enough information" (refuse-to-speculate) |
| IndexedDB draft loss on browser clear | Low | Show the draft age in the drawer; warn if draft is >24h old |
| Voice permission denied | Low | Graceful fallback to text; the mic icon remains visible but disabled |
| Mobile thumb reach on capture button | Medium | Position at bottom-center on mobile, not bottom-right |
| Clarification loop spam (v2.0) | Medium | Rate-limit per project_id (already handled in Guides v3 §17.9) |
| Large note volume (500+) causes sync context to exceed limits | Medium | Feature-area bucketing + summarization of oldest notes if needed |
| Scheduling cron cleanup never runs | Low | Cleanup job runs hourly; expired previews are harmless anyway (worst case: storage bloat) |
| KB diff viewer too complex to render for large KBs | Medium | Render only top 20 changes inline; "see all changes" loads a separate view |

---

## 22. Validation Checklist Before Shipping v1.0

Before declaring v1.0 shipped, all of the below must be verified:

**Capture**
- [ ] `Cmd+N` opens the capture drawer from every page in a project
- [ ] Typing and `Cmd+Enter` saves a note; note appears instantly (optimistic)
- [ ] `Esc` closes the drawer; re-opening preserves unsaved text (IndexedDB draft)
- [ ] Mic toggle enters voice mode; waveform animates; live transcript appears
- [ ] Stopping voice recording yields an editable transcript; Save creates the note
- [ ] Mic permission denial shows a graceful fallback (text still works)
- [ ] Network failure during save is retried silently; note is not lost

**Proactive AI**
- [ ] After save, classification pills appear within 5s (happy path)
- [ ] Classification pills are single-tap editable
- [ ] Probes appear with voice/type/skip actions
- [ ] "Not relevant" on 5 probes in a row reduces probe_level silently
- [ ] Contradictions show yellow banner with three resolution actions
- [ ] Contradiction resolution correctly supersedes one note or marks "both correct"

**Ask KB**
- [ ] Text questions stream responses with real-time token updates
- [ ] Sources appear in the context panel as they are cited
- [ ] Voice mode works end-to-end (voice in, voice out via TTS)
- [ ] "Capture as note" promotes an AI answer to a note with correct tags and refs
- [ ] Past conversations are listed; starred ones survive retention
- [ ] When the RAG has no relevant sources, the AI says so — it does not hallucinate

**Sync**
- [ ] Sync preview modal shows all four tabs (Overview / KB Changes / Document Impact / Blockers)
- [ ] Unresolved contradictions block Apply
- [ ] Apply triggers async job; progress displays in real-time via Supabase subscription
- [ ] On completion, new `kb_versions` row exists; `knowledge_bases` points to it
- [ ] Notes get `kb_incorporation` populated correctly
- [ ] Rollback works within 24h window

**UX polish**
- [ ] All five tabs work on desktop (≥1024px)
- [ ] Capture works on mobile (≤640px) with thumb-reachable pill
- [ ] Keyboard shortcuts work and don't conflict with existing ones
- [ ] Focus rings visible on all interactive elements
- [ ] Screen reader announces capture drawer, classification pills, probes
- [ ] All text meets 4.5:1 contrast on its background
- [ ] First-use onboarding appears on first visit; does not reappear
- [ ] Undo works for archive, supersede, sync (24h rollback)

**Integration**
- [ ] Notes flow through to generated documents on next regeneration
- [ ] AI Implementation Guides (if shipped) read notes as context
- [ ] Sync does not break existing QA Intelligence or document generation
- [ ] Cost telemetry is recorded for every operation listed in §17

**Honest caveat:** some of the interaction-feel items (animation timings, sound/haptic feedback, the exact feel of the capture drawer) won't be validated by a checklist — they'll be validated by 5 PMs using the tool for a week and reporting back. The validation sprint described in the Strategic Positioning doc is the real gate.

---

## 23. What This Spec Does NOT Cover

Deliberately out of scope so Claude Code doesn't guess:

- **Visual design of the capture drawer** (exact colors, exact shadow values). Uses existing SpecLoom design tokens; detailed visual design is a Figma deliverable if desired.
- **The Skill file for agents** (separate Guides v3 deliverable).
- **Mobile native apps.** Web only in v1.0; PWA install banner allowed but no native iOS/Android.
- **Multi-user collaboration on notes.** v3 roadmap topic (not this spec).
- **Third-party integrations** (Notion, Confluence, Slack). v3+ topic.
- **Enterprise features** (audit logs, admin review workflows). v3+ topic.

---

## 24. Content: Onboarding & Empty-State Copy

This section contains the final, ship-as-is strings for every onboarding overlay, empty state, toast, error message, placeholder, button label, and accessibility string the Workbench surfaces to users in v1.0. No placeholders. No "write this later." Every string below is the text users will read.

### 24.1 Tone Of Voice

These principles govern every string in the Workbench and should guide any future copy added to it.

1. **Direct, not bossy.** Write "Press Cmd+N anywhere" not "You should press Cmd+N" or "Why not try pressing Cmd+N?"
2. **Confident, not salesy.** State what the thing does. Don't explain why it's great.
3. **Specific, not generic.** "Your note shaped 3 business rules" beats "Your notes are valuable."
4. **Respectful of intelligence.** Never explain obvious things twice. Never add "!" for enthusiasm.
5. **Human, not corporate.** "We couldn't transcribe your recording" not "An error occurred during transcription processing."
6. **Short.** If a sentence can be cut in half without losing meaning, cut it.
7. **No emojis in system copy.** UI icons (pills, status markers) serve legibility and are fine. Emojis in sentences are not.

Product voice is approximately: a senior peer who knows the job, respects the PM's time, and has something useful to say. Not a cheerleader, not a butler, not a friend-who's-too-friendly.

### 24.2 First-Use Progressive Onboarding — Final Copy

All overlays below dismiss on their explicit CTA button. None are dismissable by clicking outside (too easy to miss). Each fires at most once per project; state tracked in a new `project_onboarding_state` jsonb column on `projects`, with keys `workbench_first_visit_seen`, `workbench_readiness_nudge_seen`, `workbench_sync_nudge_seen_at_counts` (array), `workbench_first_sync_seen`.

**Session 1 — First Workbench visit** (triggered by `quick_notes` count = 0 AND `workbench_first_visit_seen = false`).

Three-beat overlay. Background is dimmed; overlay card floats center. Each beat has one button.

*Beat 1 — pointer arrow aimed at the capture pill-button (bottom-right).*

> **Start here.**
>
> This is the capture button. Tap it — or press Cmd+N from anywhere — to save a thought.
>
> `[ Got it ]`

*Beat 2 — shows keyboard shortcut illustration (two keycaps side by side).*

> **One keystroke, anywhere.**
>
> Cmd+N works from any SpecLoom page. Middle of watching a video, middle of reading a spec — capture without breaking flow.
>
> `[ Next ]`

*Beat 3 — small diagram: note → KB → documents and implementation sessions.*

> **Everything you capture becomes part of your spec.**
>
> Business rules, edge cases, clarifications, questions. SpecLoom figures out the details. You keep thinking.
>
> `[ Try it now ]`

Tapping "Try it now" opens the capture drawer with the placeholder: *Write or speak anything about your project…*

After the first note is saved, set `workbench_first_visit_seen = true`. The overlay never appears again for this project.

On Windows/Linux, `Cmd+N` becomes `Ctrl+N` in all strings.

---

**Session 2 — After third note saved** (only when v1.2 Readiness is live).

Small one-time tooltip pointing at the Readiness tab.

> **New:** Your Readiness dashboard just got interesting. See what's documented and what's missing.
>
> `[ Show me ]` `[ Later ]`

Dismissible either way. Shown exactly once per project.

---

**Session 3 — Pending note threshold reached.**

Top banner on any Workbench tab, conditional:

- First shown when pending count reaches 5
- Re-shown at 10, 20, 50
- At 50+, always shown until acted on

> You've captured `${N}` thoughts. Ready to merge them into your Knowledge Base?
>
> `[ Preview sync ]` `×`

Dismissing with the × records the count at which it was dismissed so it doesn't re-fire at the same threshold.

---

**Session 4 — First successful sync complete.**

Full-screen celebratory overlay (understated, not confetti). Appears once sync finishes.

> **Your notes just joined the Knowledge Base.**
>
> Next time you generate a document or implementation session, they'll shape it. And you can ask about anything you've captured — try the Ask tab.
>
> `[ Ask the KB something ]` `[ Close ]`

Primary button navigates to Ask tab. Secondary dismisses. Either sets `workbench_first_sync_seen = true`.

### 24.3 Empty States — Final Copy

Each empty state is shown when the primary surface has no data to display.

**Capture tab — first visit ever, no notes.**

> **Nothing captured yet.**
>
> Write anything — a rule, a question, a detail that only matters if you remember it. SpecLoom figures out the rest.
>
> `[ Try it now ]`

Visual: soft pen-on-notebook-page SVG illustration. The `Try it now` button opens the capture drawer.

---

**Capture tab — notes exist but recent list is empty** (all archived or older than 30 days).

> Your recent captures will appear here.

No button. The capture pill-button is visible.

---

**Stream tab — no notes yet** (v1.1).

> **Your Stream will appear here.**
>
> Every note you capture lands here — sortable, searchable, filterable.

Visual: small list-view icon in muted color.

---

**Stream tab — notes exist, active filters yield zero.**

> Nothing matches these filters.
>
> `[ Clear filters ]`

---

**Ask tab — no conversations yet.**

> **Ask about anything in your project.**
>
> Try: `"${example_question_1}"` or `"${example_question_2}"`. Answers come from your videos, documents, and notes.
>
> `[ mic ]` `[ input: Ask anything about your project… ]`

Example questions are interpolated from the project's KB feature names. If the KB has features like "Steuer-News Edition Management" and "Customer Portal Review", the examples become `"What do we know about Steuer-News article versioning?"` and `"Which roles can approve editions?"`.

If no KB exists yet, the generic fallbacks are: `"Summarize the user roles we've documented."` and `"What's documented about permissions?"`.

---

**Ask tab — existing conversations sidebar is empty.**

> No past conversations.

---

**Readiness tab — no KB exists yet** (v1.2, before first sync).

> **Readiness appears after your first sync.**
>
> Capture some thoughts, then sync to see where your spec stands across every dimension.
>
> `[ Go to Capture ]`

---

**Readiness tab — KB exists but all dimensions at 0%** (rare; seeded from empty onboarding).

> **Your Knowledge Base is empty.**
>
> Capture, sync, and watch the scores climb. Each dimension updates as you add context.

---

**Explorer tab — no KB exists yet** (v1.3).

Same copy as Readiness pre-first-sync.

---

**Sync preview — zero pending notes.**

> **Everything's synced.**
>
> Capture more, then come back.
>
> `[ Close ]`

---

**Sync preview — only unresolved contradictions pending.**

Modal auto-selects the Blockers tab. Apply button disabled. Overview tab displays:

> **Resolve blockers before syncing.**
>
> `${N}` contradiction`${s}` need a decision before any notes can merge.

No celebratory copy. The Blockers tab lists each contradiction with inline [Resolve] actions.

### 24.4 Toasts & Inline Confirmations — Final Copy

Format: `[trigger] → Toast text (duration / undo button if any)`

All durations are Sonner default unless specified. Duration `persistent` means shown until explicitly dismissed or condition resolved.

**Capture & notes:**

| Trigger | Toast text | Duration | Button |
|---|---|---|---|
| Note saved successfully | `Saved.` | 2s | — |
| Note saved offline | `Saved locally. We'll sync when you're back.` | persistent | — |
| Note updated | `Note updated.` | 2s | — |
| Note archived | `Archived.` | 10s | `Undo` |
| Note superseded | `Superseded by ${code}.` | 10s | `Undo` |
| Note hard-deleted (admin only) | `Deleted.` | 10s | `Undo` |
| Voice recording too short (<1s) | `Hold a moment longer next time.` | 3s | — |
| Voice transcription failed, retry available | `Transcription failed. Your recording is saved.` | persistent | `Retry` `Type instead` |
| Voice transcription in progress | (inline spinner, no toast) | — | — |
| Mic permission denied | `Microphone blocked. Enable it in your browser settings.` | 5s | — |

**Probes:**

| Trigger | Toast text | Duration | Button |
|---|---|---|---|
| Probe answered | `Answer saved.` | 2s | — |
| Probe skipped | (silent) | — | — |
| Probe marked "not relevant" | `Got it. We'll stop asking similar questions.` | 3s | — |

**Contradictions:**

| Trigger | Toast text | Duration | Button |
|---|---|---|---|
| Resolved via "Use this one" | `${other_code} superseded by this note.` | 10s | `Undo` |
| Resolved via "Use ${other_code}" | `This note superseded by ${other_code}.` | 10s | `Undo` |
| Resolved via "Both correct" | `Marked as compatible.` | 3s | — |

**Ask KB:**

| Trigger | Toast text | Duration | Button |
|---|---|---|---|
| Answer captured as note | `Captured as ${code}.` | 5s | `View note` |
| Conversation starred | `Starred. It won't auto-expire.` | 3s | — |
| Conversation renamed | `Renamed.` | 2s | — |

**Sync:**

| Trigger | Toast text | Duration | Button |
|---|---|---|---|
| Preview generation | (inline loading state, no toast) | — | — |
| Apply started | (inline progress, no toast) | — | — |
| Apply complete | (handled in SyncSuccessView) | — | — |
| Apply failed | `Sync failed. KB is unchanged.` | persistent | `Retry` |
| Rollback successful | `Rolled back to KB v${N}.` | 5s | — |

**Other:**

| Trigger | Toast text | Duration | Button |
|---|---|---|---|
| Settings saved | `Saved.` | 2s | — |
| Copy to clipboard | `Copied.` | 2s | — |
| Generic network error | `Lost connection. Trying again…` | persistent until resolved | — |

### 24.5 Error-State Copy — Final Copy

**Capture drawer:**

| Condition | Copy |
|---|---|
| AI post-processing failed | `AI didn't respond.` `[ Retry analysis ]` |
| Voice session connection failed | `Couldn't start recording. Check your connection and try again.` |
| Draft expired (>24h) | (silent — just don't restore; no error UI) |

**Voice mode specifically:**

| Condition | Copy |
|---|---|
| No audio detected (silent recording) | `We didn't hear anything. Try again?` |
| Network dropped mid-recording | `Lost connection. Your recording was saved locally.` |
| Whisper rate-limited | `We're busy. Try in a moment.` |

**Ask KB:**

| Condition | Copy |
|---|---|
| No relevant sources found | `I don't have anything documented about that yet. Capture a note and try again.` |
| RAG call failed | `Ask is offline. Try again in a moment.` |
| Rate-limited | `Slow down — let me think. Try again in a moment.` |

**Sync:**

| Condition | Copy |
|---|---|
| Preview generation failed | `Couldn't compute preview.` `[ Retry ]` |
| Apply failed mid-flow | `Sync failed. Your KB is unchanged.` `[ Retry ]` `[ See details ]` |
| Concurrent sync detected | `Another sync is running.` `[ Open it ]` |
| Rollback failed (rare) | `Couldn't roll back. Contact support.` |

**Loading errors:**

| Condition | Copy |
|---|---|
| Note list failed | `Couldn't load notes.` `[ Retry ]` |
| Single note failed | `This note couldn't be loaded. It may have been deleted.` |
| Conversation failed | `This conversation couldn't be loaded.` |

### 24.6 Placeholders & Hint Text — Final Copy

**Capture drawer text area:**

| State | Placeholder |
|---|---|
| Default | `Write or speak anything about your project…` |
| Returning (draft restored) | `Continue where you left off…` |
| Answering a probe | `Your answer…` |
| Answering a clarification | `Your answer for the developer…` |

**Ask KB input:**

| State | Placeholder |
|---|---|
| Default | `Ask anything about your project…` |
| In a running conversation | `Follow up, or ask something new…` |

**Search palette (Cmd+K):**

> `Search notes, features, rules…`

**Classification edit popovers:**

| Picker | Header text |
|---|---|
| Type picker | `What kind of note is this?` |
| Feature area picker | `Which part of your app?` |

### 24.7 Button Labels — Complete Final Inventory

Every button label in the Workbench, organized by surface. Case is exactly as shown. Button variants (primary, secondary, ghost, destructive) map to existing `Button` component variants.

**Capture drawer:**

| Button | Label | Variant | Notes |
|---|---|---|---|
| Save | `Save` | primary | Shows `Cmd+⏎` hint on desktop |
| Cancel | `Cancel` | ghost | |
| Close (X) | (icon only) | ghost | aria-label: `Close` |
| Mic toggle on | `Start recording` | secondary | Icon-only on mobile |
| Stop recording | `Stop` | destructive-outline | |
| Re-record | `Re-record` | ghost | |

**Probes:**

| Button | Label |
|---|---|
| Voice answer | `Voice answer` |
| Type answer | `Type answer` |
| Skip | `Skip` |
| Not relevant | `Not relevant` |

**Contradictions:**

| Button | Label | Variant |
|---|---|---|
| Keep new | `Use this one` | primary |
| Keep old | `Use ${code}` | secondary |
| Both compatible | `Both correct` | ghost |
| View other | `View ${code}` | link |
| Dismiss | (X) | ghost, aria-label: `Defer contradiction` |

**Ask KB:**

| Button | Label |
|---|---|
| Send | `Ask` |
| Voice toggle | (mic icon, aria-label: `Speak your question`) |
| Follow up | `Follow up` |
| Capture answer as note | `Capture as note` |
| Start new conversation | `New conversation` |

**Sync:**

| Button | Label | Variant |
|---|---|---|
| Open preview (status bar) | `Preview sync` | secondary |
| Open preview (general) | `Sync` | secondary |
| Modal cancel | `Cancel` | ghost |
| Modal apply | `Apply sync →` | primary |
| Cancel apply (before writes) | `Cancel` | ghost |
| Success: view KB | `View KB changes` | secondary |
| Success: regenerate docs | `Regenerate documents` | secondary |
| Success: done | `Done` | primary |
| Rollback | `Roll back to KB v${N}` | destructive |
| Blocker resolve | `Resolve` | secondary |

**Navigation:**

| Element | Label |
|---|---|
| Tab: Capture | `Capture` |
| Tab: Stream (v1.1) | `Stream` |
| Tab: Ask | `Ask` |
| Tab: Readiness (v1.2) | `Readiness` |
| Tab: Explore (v1.3) | `Explore` |
| Modal close | (X), aria-label: `Close` |
| Mobile back | `Back` |

**Clarifications (v2.0):**

| Button | Label |
|---|---|
| Open inbox (status bar) | `Open` |
| View clarification in list | `View clarification` |
| Answer | `Answer` |
| Dismiss | `Not applicable` |

### 24.8 Full-Flow Copy: The Sync Experience

Every string the user sees during a complete sync cycle, in order.

**Status bar (pending sync):**

> `⟳ Sync: ${N} pending note${s} ready to merge` `[ Preview → ]`

**Modal — Overview tab:**

> **Sync preview**
>
> `${N}` pending note`${s}` will produce:
>
> `✓ ${N}` new business rule`${s}`
> `✓ ${N}` feature description`${s}` updated
> `✓ ${N}` new entity relationship`${s}`
> `⚠ ${N}` contradiction`${s}` must be resolved first *(conditional)*
>
> 📄 `${N}` generated document`${s}` will become stale:
>    — `${doc_id}` (v`${N}`)
>
> ⏱ Estimated sync time: ~`${N}` seconds
> 💰 Estimated cost: # SpecLoom — Knowledge Workbench v3 (Complete Spec)

**Version:** 3.1 — complete standalone specification. No other document needs to be read alongside this one to implement v1.0. Handover-ready for CodeMantis SpecWriter.
**Date:** April 18, 2026 (v3.1 additions: final copy §24, AI prompts §25, concurrency §26, privacy §27, tests §28)
**Status:** Ready for implementation. This is the next major feature to ship.
**Supersedes:** `SpecLoom_Knowledge_Workbench_Feature_Spec.md` (v1, superseded) and `SpecLoom_Knowledge_Workbench_Feature_Spec_v2.md` (v2, strategic design only — this v3 absorbs its strategy and adds full-stack implementation detail). Mark both historical.
**Adjacent:** `SpecLoom_AI_Implementation_Guides_Feature_Spec_v3.md` (implemented or in progress — the `clarification_requests` table is defined there; this spec references it rather than duplicating).

---

## 0. What This Document Covers

This is a single source of truth for implementing the Knowledge Workbench end-to-end. Every layer is covered; Claude Code can build from this alone.

| Layer | Sections |
|---|---|
| UX principles and design language | §4, §5 |
| Information architecture + navigation | §6 |
| **v1.0 Magical Core — UX storyboards** (the heart of this spec) | §7 |
| Later phases UX (Stream, Readiness, Explorer, CodeMantis loop) | §8 |
| Database schema + migrations + RLS | §9, §10 |
| Pipeline stages (Python FastAPI worker) | §11 |
| Supabase Edge Functions (API surface) | §12 |
| Frontend components + hooks + routing | §13 |
| Integration with existing synthesis + Guides + CodeMantis | §14 |
| Container / deployment | §15 |
| Model configuration | §16 |
| Cost estimates | §17 |
| Implementation sequence | §18 |
| Files inventory | §19 |
| Success metrics | §20 |
| Risks + mitigations | §21 |
| Validation checklist | §22 |
| Scope boundaries (what this spec does NOT cover) | §23 |
| **Content: onboarding & empty-state copy (final, ship-as-is)** | §24 |
| **Content: AI prompts (full text + output schemas + parsing contracts)** | §25 |
| Concurrency, race conditions, rate limits | §26 |
| Privacy, security, data retention | §27 |
| Testing plan (unit / integration / UX validation / load / smoke) | §28 |

---

## 1. The One Sentence

> **The Workbench is the place a product manager lives.** Every thought, every rule, every answered question, every clarification from a developer — it all flows in through one surface, and the spec, the documents, the tickets, and the AI-ready implementation sessions all flow out.

If a PM opens SpecLoom in the morning and closes it at night, the Workbench is the tab they have open. That's the bar. The rest of this document is a blueprint for earning that.

---

## 2. What v2 Got Right (Keep)

The strategic analysis in v2 holds up completely. Reproduced here so this spec is standalone:

1. **Gap analysis.** Before this feature, notes had no home. `onboarding_context` is write-once, `user_hint` is bolted to a specific upload, `questions` is AI-led not PM-led. The Workbench fixes that.
2. **Co-authorship framing.** PM and AI work together. The AI probes, detects contradictions, proposes classifications. The PM confirms or overrides. Neither dominates.
3. **Seven misses from v1 corrected:** (a) capture is one field, not five; (b) voice is first-class; (c) AI is proactive, not passive; (d) sync has a preview; (e) Ask-the-KB chat exists; (f) CodeMantis bidirectional loop; (g) Readiness is dimensional.
4. **Separate `quick_notes` table.** Schema-correct. Carries forward.
5. **Status lifecycle.** draft → active → superseded → archived. Carries forward.
6. **Read-only KB Explorer.** KB stays derivation-only; changes happen through notes + resync. Non-negotiable.
7. **Incremental sync vs full re-synthesis.** Cost math still works ($0.05-0.20 incremental; $5-15 full).

---

## 3. What's New In v3 (Since v2)

Three material updates since v2 was written in April 2026:

1. **AI Implementation Guides v3 is now implementation-ready.** The `clarification_requests` table is defined in Guides v3 §9.4; this spec references it rather than re-defining. The outbound YAML frontmatter for generated specs moves to Guides v3 as part of the session format; the Workbench focuses on the inbound side (clarifications surfacing in Note Stream).
2. **Strategic reframe adopted.** The Workbench isn't a spec-tool feature — it's the PM's daily workspace for a category-defining product ("AI-Ready Implementation Sessions"). The UX bar is set by that frame, not by spec-tool conventions.
3. **User's UX mandate.** "The great and easy UI experience for the users is imperative." This spec treats UX as the primary deliverable. §7 (UX storyboards for v1.0 Magical Core) is the longest section and the most important.

v3 also absorbs all mechanical detail that v2 lacked: complete database schema, pipeline stages, Edge Functions, React component inventory, migration plans, model configuration — matching the depth of the Guides v3 spec.

---

## 4. UX Principles (The Contract With The User)

Before any mockup or component, the principles that every UX decision must pass against. When two possible designs conflict, the one more aligned with these principles wins.

### 4.1 Zero Friction At Capture

The moment of insight is the moment of lowest cognitive bandwidth. The PM has a thought at 11pm — we have maybe 15 seconds before it slips away. Any field that isn't "body" is a cost. Any classification step before save is a cost. Any "are you sure?" dialog before save is a cost.

**Rule:** one field, one button, one keystroke. Everything else is inferred after.

### 4.2 The AI Reveals Itself Gradually

A good co-author doesn't interrupt you while you're thinking. They wait until you've captured the thought, then offer a gentle "did you mean...?" or "what about...?". They don't present a form.

**Rule:** AI output is layered below the saved note, never above. It's skippable. It's dismissable. Dismissing it once never re-prompts.

### 4.3 Never Punish The User For Moving Fast

If the PM dismisses a classification, the note is still saved. If they ignore probes, the probes are still stored (available in "unanswered" filter). If they skip contradiction review, the contradiction is still flagged. Nothing is lost. Nothing is blocked.

**Rule:** every dismissible thing degrades gracefully. Skip never destroys.

### 4.4 Transparency Over Magic

The PM must always be able to answer three questions: "What have I captured?" "Where did that come from?" "What will happen if I sync?". If they can't, we've failed.

**Rule:** every fact in the system has a "View source" action. Every AI inference shows its basis. Every sync shows its diff before applying.

### 4.5 Voice Is Equal To Text

Not a feature, not a toggle. Voice is a first-class input mode everywhere capture happens. The mic icon appears next to the text field, same size, same prominence. On mobile, voice becomes the default entry point.

**Rule:** every capture surface has a mic. Every conversational surface accepts voice.

### 4.6 Small Signals, Not Big Rewards

No gamification. No badges. No "streaks." The satisfaction is intrinsic — the PM sees their note become a business rule in a generated document, and they feel it. That's the reward loop.

**Rule:** progress indicators (Readiness) are factual, not motivational. Sources on notes are informative, not celebratory.

### 4.7 Respect The PM's Time

Every interaction has a cost-benefit. A probe that's useless once is annoying forever. A contradiction warning that's wrong is worse than none.

**Rule:** if a probe is dismissed, don't ask again. If a contradiction is marked "both correct," don't flag it again. Learning is implicit.

### 4.8 Mobile Is Not A Responsive Afterthought

PMs think at the grocery store. They have thoughts walking the dog. The mobile experience is the primary capture channel for many real users.

**Rule:** every capture surface works thumb-first on a 390px screen. Voice is the primary mode on mobile. Everything else scales down; mobile doesn't scale up.

---

## 5. Design System Foundations

### 5.1 Stack Baseline (Already Available)

From the existing SpecLoom codebase, we have:
- **shadcn/ui** (radix-nova style, neutral base color) — all primitive components present
- **Lucide icons** — use existing icon conventions
- **Geist Variable font** — already loaded; use as-is
- **Tailwind v4** — use existing tokens; do not introduce custom classes
- **Sonner** — toasts
- **cmdk** — command palette primitive
- **LiveKit client + waveform-visualizer + voice-controls** — voice infrastructure already proven (16 voice sessions shipped)
- **@tanstack/react-query** — data-fetching layer; all Workbench hooks use this
- **react-hook-form + zod** — form validation
- **diff** — for KB version diffs (already a dependency — perfect for sync preview)
- **react-markdown + remark-gfm** — markdown rendering

No new dependencies required for v1.0 Magical Core.

### 5.2 Density And Rhythm

| Context | Spacing | Typography |
|---|---|---|
| Capture drawer | Spacious — one thing at a time | Body 16px / line 24 |
| Note Stream | Medium density — scannable | Body 14px / line 20 |
| Ask-the-KB | Spacious — conversational | Body 16px / line 24 |
| Sync preview | High density — table-like | Body 13px / line 18 |
| Readiness dashboard | Cards with generous padding | Mixed; numbers 24-32px |

### 5.3 Color Semantics

Already in use across SpecLoom. Workbench adds no new colors; reuses:
- `primary` — action / main CTA
- `muted` — borders, disabled, subtle backgrounds
- `accent` — hover / focus
- `destructive` — delete / conflict (contradictions)
- `chart-1..5` — note-type pills, dimension bars
- `foreground` / `background` — always via tokens

### 5.4 Iconography (Lucide)

| Concept | Icon |
|---|---|
| Note (generic) | `StickyNote` |
| Business rule | `Scale` |
| Edge case | `AlertCircle` |
| Clarification | `MessageCircleQuestion` |
| Domain term | `BookOpen` |
| Constraint | `Lock` |
| Voice capture | `Mic` |
| Sync | `RefreshCw` |
| Ask KB | `Sparkles` |
| Readiness | `Gauge` |
| Contradiction | `AlertTriangle` |
| Source/origin | `ExternalLink` |

---

## 6. Information Architecture And Navigation

### 6.1 The Workbench Page

One new page at `/projects/:projectId/workbench`. This is the PM's home surface.

The page uses a **tab bar** (not separate nav items) with five tabs. A tab bar keeps all Workbench functions one click away from each other — critical because the flow between them is fluid (capture → review in stream → ask KB → sync).

```
┌─────────────────────────────────────────────────────────────────┐
│  Project: Atikon Kickstarter App    [Sync pending: 3]   [🔔 2] │
├─────────────────────────────────────────────────────────────────┤
│  📝 Capture   📋 Stream   ✨ Ask   📊 Readiness   🔍 Explore    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                       (active tab content)                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

- **Capture** — the capture drawer is actually global (see §7.1) but this tab surfaces recent captures + first-use onboarding
- **Stream** — chronological note feed (v1.1)
- **Ask** — Ask-the-KB chat
- **Readiness** — dimensional score dashboard (v1.2)
- **Explore** — KB Explorer (v1.3, reuses existing `src/components/knowledge-base/` components)

### 6.2 The Capture Affordance Is Global

Unlike the tabs above, capture is accessible **from anywhere in the project**, not just the Workbench page. It appears as a persistent floating pill-button at the bottom-right of every project page (Documents, Videos, Materials, anywhere). Keyboard shortcut `Cmd+N` / `Ctrl+N` focuses it instantly.

**This is the most important affordance in SpecLoom.** It is always one keystroke or one tap away.

### 6.3 The Status Bar

A thin bar at the top of every Workbench page shows two status elements:

```
┌──────────────────────────────────────────────────────────────┐
│ ⟳ Sync: 3 pending notes ready to merge      [Preview →]    │
│ ⚠ Inbox: 2 developer clarifications awaiting answer  [Open] │
└──────────────────────────────────────────────────────────────┘
```

Both elements are conditional — they only appear when relevant. The status bar is quiet when there's nothing to do, loud when action is needed.

### 6.4 Sidebar Navigation Update

Add a new menu item "Workbench" to the project sidebar, positioned between "Materials" and "Documents" (materials is where PM uploads; documents is where specs live; the Workbench sits in between as the thinking workspace).

Sidebar sub-items (collapsible, auto-expanded when on the Workbench page):
- Capture (always the tab shortcut)
- Stream
- Ask KB
- Readiness
- Explore

The sub-items mirror the tab bar so both left-nav and top-tabs work. Default landing: Capture tab (with recent captures visible).

---

## 7. v1.0 Magical Core — UX Storyboards

This is the feature that ships first. Everything else (Stream, Readiness, Explorer, CodeMantis loop) is built on top of this foundation. §7 is detailed; §8 will be lighter for later phases.

### 7.1 Capture — The Global Drawer

#### 7.1.1 The Affordance

A small pill-shaped button lives at `fixed bottom-right` of every project page. States:

| State | Appearance | Trigger |
|---|---|---|
| **Resting** | Small pill, just the StickyNote icon, subtle shadow | Default |
| **Pulse** (first-use) | Gentle rhythmic glow | User has never captured a note |
| **Hover** | Expands horizontally to show text "Capture note" | Mouse hover on desktop |
| **Active** | Pressed state, slight scale-down | During click / tap |

Keyboard: `Cmd+N` on macOS, `Ctrl+N` on Windows/Linux. Shortcut works from **any** project page. If the capture drawer is already open, `Cmd+N` is a no-op (already focused). `Esc` closes it.

#### 7.1.2 Opening The Drawer

Click the pill or press `Cmd+N`. A drawer slides in from the right (desktop) or rises from the bottom as a sheet (mobile). Width on desktop: 420px. Height on mobile: 85vh.

Animation: 200ms ease-out slide. The underlying page dims slightly but stays visible — the PM keeps context of what they were looking at. They might be in a video, a document, an Ask-the-KB conversation — the capture drawer doesn't yank them out.

#### 7.1.3 The Form — One Field

```
┌─ Capture a thought ─────────────────────────── ✕ ─┐
│                                                    │
│   [🎙]  Start typing, or tap to speak...          │
│                                                    │
│   ┌──────────────────────────────────────────┐   │
│   │                                           │   │
│   │   (cursor here, auto-focused)             │   │
│   │                                           │   │
│   │                                           │   │
│   └──────────────────────────────────────────┘   │
│                                                    │
│   ↵ to save       Esc to close                    │
└────────────────────────────────────────────────────┘
```

**Behavioral rules:**
- Auto-focus is the cursor in the text area the moment the drawer opens
- `Cmd+Enter` or `Enter`-on-an-empty-line triggers save
- `Esc` closes the drawer; if there's unsaved text, the drawer fades but the text is retained (re-opening restores it — a local-only draft)
- The mic icon sits inside the input, left edge — tapping it toggles voice mode (§7.1.4)
- No title field. No type picker. No feature-area dropdown. No reference linker. None of it.
- Character counter is **not** shown. Notes can be a word or a page — we don't police length.

The mic icon and text area are the same height. They look like peers. No "fallback to text if voice fails" vibe — both modes are first-class.

**Draft persistence:** typed content is autosaved to IndexedDB every 2 seconds. If the browser crashes, the network dies, or the PM closes the tab accidentally, the draft reappears next time they open the drawer (for 24 hours, then expires).

#### 7.1.4 Voice Mode

Tap the mic. The drawer transforms smoothly — keeping the PM oriented, not jolting to a new screen.

```
┌─ Speak a thought ──────────────────────────── ✕ ─┐
│                                                    │
│   ●●●●●●●●▼▼▼●●●●▼▼●●●●●●●     ← waveform       │
│                                                    │
│   🔴 Recording   0:14                              │
│                                                    │
│   "Steuer-News editions in QC cannot be edited    │
│    by the authors..."      ← live transcript      │
│                                                    │
│   [■ Stop]                                        │
│                                                    │
└────────────────────────────────────────────────────┘
```

Technical flow (reuses existing infrastructure from `src/components/voice/`):
1. Tap mic → request mic permission if not granted
2. Start a LiveKit session (existing `voice-session-panel` pattern) OR direct Whisper streaming via local MediaRecorder → chunked POST to Whisper edge function
3. Waveform animates (reuse `waveform-visualizer.tsx`) showing amplitude
4. Interim transcripts appear live in the drawer (Whisper streaming returns partials)
5. PM taps Stop (or `Esc`) → recording stops, final transcript appears
6. Auto-save after 2 seconds of silence detected? **No, not in v1.0** — too easy to lose a thought mid-pause. Manual stop is required.
7. After stop → transcript is editable text. PM can fix words Whisper got wrong before saving.

**Permission denied state:** if mic permission is blocked, the mic icon shows a crossed-out variant with tooltip: "Microphone access blocked. [Enable in settings]". Typed text still works — we never leave the PM stranded.

**Language:** Whisper auto-detects from audio. German narration works (as proven by the 16 existing voice sessions). No language picker needed.

**Cost awareness:** every voice capture runs Whisper + a cleanup pass (removes "um", "uh", splits run-on sentences). Total cost: ~$0.002 for a 30-second note. Negligible. Tracked via `cost_operation = 'note_voice_transcription'`.

#### 7.1.5 Save — Instant, Then AI

PM presses `Cmd+Enter` or taps Save. Three things happen in order:

**T = 0 (instant, optimistic):**
- The note appears as saved in the UI — no spinner, no wait
- A subtle green checkmark blips next to the timestamp
- The note row shows in an "AI thinking..." sub-state (a subtle skeleton below the body)
- The PM is free to close the drawer (`Esc`) and move on. The AI continues in the background.

**T = 1-3 seconds (AI proactive pass returns):**
- Classification suggestion appears as a pill below the body: `business_rule · Steuer-News Edition Management`
- If body mentioned "video 12 at 04:32", a reference chip appears: `📹 video SD-News-12 @04:32` (auto-linked)
- Each is click-to-accept (single tap), or click-to-edit (opens a small picker)
- If the AI is uncertain (confidence < 0.7), it offers options: "Could this be a `business_rule` or an `edge_case`?" — the PM picks

**T = 3-5 seconds (probes arrive):**
- Below classification, a stacked card appears: "💭 Follow-up"
- Each probe is a short question with four actions: [Voice answer] [Type answer] [Skip] [Not relevant]
- "Skip" defers (the probe stays pending in the Stream for later). "Not relevant" dismisses permanently (AI learns — §4.7)

**T = 3-5 seconds (contradictions arrive, if any):**
- If the AI detects this note conflicts with a previously-saved note, a yellow banner appears
- The banner shows the prior note's body preview and timestamp
- Three actions: [Keep the new one] [Keep the old one] [Both are correct — different scopes]
- Picking one marks the loser as `superseded_by` the winner and preserves history

**The key insight:** none of these AI outputs delay the save. The note is committed to the database at T=0. Everything after is enrichment. If the AI call fails entirely, the note still exists; the PM just doesn't see the suggestions.

#### 7.1.6 After The Drawer Closes

When `Esc` or ✕ closes the drawer, a tiny toast appears in the corner: "Note saved · [View]". Clicking "View" opens the Stream (v1.1) or, in v1.0 where Stream isn't built yet, opens a simple detail panel.

Nothing else happens. The PM returns to whatever they were doing. The capture was a side-quest.

#### 7.1.7 The Capture Tab Itself

The Workbench's first tab is **Capture**. What lives here when you visit directly?

- **Recent captures** — last 5 notes with their AI-inferred type/area/probes. Clicking a card opens the same detail view as above.
- **Empty state (first visit ever):** a large friendly illustration + the line "Write anything — a rule, a question, a detail. SpecLoom will figure out the rest." + a big "Try it now" button that opens the drawer.
- **Quick templates** (v1.1+, not v1.0): small tiles for common capture patterns ("Describe a user role", "Note an edge case", "Add a constraint"). Skip for v1.0.

The Capture tab is a *passive surface* — it shows status. The active capture is always in the global drawer. This separation matters: capture shouldn't be tab-dependent. You might be watching a video, think of something, hit `Cmd+N`, capture, and never leave the video page.

### 7.2 Proactive AI Feedback — UX Details

The AI feedback from §7.1.5 deserves its own breakdown because this is where the co-authorship promise is kept or broken.

#### 7.2.1 Classification Suggestion

Layout: a single horizontal pill row below the note body, separated by a thin `border-t`.

```
┌──────────────────────────────────────────────────┐
│ (note body text above)                            │
│ ──────────────────────────────────────────────   │
│  [Scale  business_rule] · [Book  Steuer-News]    │
│                                        [Edit]    │
└──────────────────────────────────────────────────┘
```

- Pills use the appropriate icon from §5.4
- Single-tap on either pill opens an inline picker (popover) — no modal, no page navigation
- "Edit" at the end lets the PM change both at once (opens a combined picker)
- If AI confidence is medium (0.5-0.7), the pill shows a subtle question-mark icon; tapping offers alternatives

**Micro-interaction:** when the PM accepts a pill (by tapping or by not changing it within 3 seconds), it subtly darkens to confirm. No toast, no sound. Just a visual acknowledgment.

#### 7.2.2 Probes

Probes are 1-3 questions the AI generates based on the note content. Layout:

```
┌─ 💭 Follow-up questions ─────────────────────────┐
│                                                   │
│  What happens if all QC Reviewers are             │
│  unavailable? Timeout? Notification?              │
│  [🎙 Voice] [✎ Type] [Skip] [Not relevant]        │
│                                                   │
│  Is there an audit trail for rejections?          │
│  [🎙 Voice] [✎ Type] [Skip] [Not relevant]        │
│                                                   │
└───────────────────────────────────────────────────┘
```

**Behavioural rules:**
- Answering a probe creates a new note (`note_type=general`, references the parent note)
- [Skip] moves the probe to a "deferred" state — it shows up in the Stream with a filter "Unanswered probes"
- [Not relevant] kills the probe permanently and teaches the AI (incremented in the project's `ai_feedback_counters`)
- Probes auto-collapse to a single-line summary after 30 seconds of no interaction ("2 follow-up questions [Expand]") so they don't dominate the drawer

**Voice answer flow:** tapping `[🎙 Voice]` re-enters voice mode with the probe text pre-loaded as context. The transcript is the answer. Save creates the child note. This is the smoothest iteration on the probe pattern — the PM sees a question, taps mic, answers, done.

**Anti-spam guard:** if the PM dismisses 5 probes in a row without answering any, the AI's probe_level for this project silently drops from `light` to `minimal` — the AI stops generating probes for general notes and only generates them when a direct contradiction or obvious gap is detected. This is the "respect the PM's time" principle in action (§4.7). Settings: PM can reset probe_level explicitly.

#### 7.2.3 Contradictions

If the AI detects a conflict between this note and a previous note, a distinct yellow banner appears above the classification pills:

```
┌─ ⚠ Possible contradiction ────────────────────── ✕ ─┐
│                                                       │
│  This note says "only QC Reviewers can reject"       │
│  But note N-023 (Apr 12) said "Admin can also       │
│  reject". Which is correct?                          │
│                                                       │
│  [← Use N-023]  [✓ Use this one]  [Both correct]    │
│                                                       │
│  [View N-023 →]                                      │
└───────────────────────────────────────────────────────┘
```

- "Use N-023" marks the new note as `superseded_by` N-023 (rare, but possible — PM realized the new one is wrong)
- "Use this one" marks N-023 as `superseded_by` this note
- "Both correct" creates a `contradiction_resolutions` entry saying "these two are compatible — different scopes or contexts" — this teaches the AI not to flag again
- "View N-023" opens the prior note in a side panel so the PM can read the full text before deciding
- The ✕ defers (hides the banner but keeps the contradiction unresolved); it shows up in Stream filter "Unresolved contradictions" for later

**Design principle:** contradictions require explicit resolution for sync (§7.4), so deferring is fine but syncing will re-surface them. This creates pressure without blocking capture.

### 7.3 Ask The KB — Chat Surface

Tab: `✨ Ask`. One of the five Workbench tabs.

#### 7.3.1 Layout

Two-column layout on desktop:

```
┌──────────────────────────────┬─────────────────────────┐
│  Conversation (full width)   │  Context drawer         │
│  ────────────────────────    │  ───────────────────    │
│                               │                          │
│  You: What do we know about  │  Sources cited in this  │
│    Steuer-News article       │  answer:                │
│    versioning?               │                          │
│                               │  📹 SD-News-07          │
│  SpecLoom (with voice):      │     @ 02:14-03:40       │
│  Based on 4 videos, 2 notes, │                          │
│  and 1 doc, articles have... │  📹 SD-News-12          │
│                               │     @ 01:30-02:05       │
│  [Follow up]                  │                          │
│  [Capture this as a note]    │  📝 N-034 (you, Apr 12) │
│                               │                          │
│  ── ── ── ── ── ── ── ──      │  📄 Data Model Ref §3.2 │
│                               │                          │
│  [🎙] Ask anything...         │                          │
│                               │                          │
└──────────────────────────────┴─────────────────────────┘
```

On mobile, the Context drawer becomes a bottom sheet that auto-appears after each AI answer (collapsed by default, tap to expand).

#### 7.3.2 Conversational Flow

- PM types a question or taps mic → voice mode (full-screen on mobile, inline on desktop using existing voice components)
- Answer streams in with a typing indicator; sources populate in the right panel as they're cited
- Every source is a clickable chip: video → opens video at timestamp; note → opens note detail; doc → opens doc at section
- "Follow up" extends the conversation in context
- "Capture this as a note" creates a new note with the answer text as body, auto-tagged with the AI's classification, with `references` populated from the cited sources

**Critical behaviour:** the AI answer, when captured as a note, goes through the **same** proactive AI pass as a manually-typed note — probes and contradictions may emerge. This creates a compound loop: ask → answer → capture → AI enriches → more questions emerge.

#### 7.3.3 History

Each conversation is persisted (existing `conversations` table with `conversation_type='ask_kb'`). A small sidebar on the left shows conversation history — like a chat app. PM can rename, star, or delete. Starred conversations survive a default 90-day retention.

#### 7.3.4 Voice Mode

Full voice-to-voice mode uses the existing `voice-session-panel.tsx`. The user talks to the AI, the AI talks back (ElevenLabs TTS, already in use). This is a distinct "listen mode" button; default is text-in / text-out for speed.

### 7.4 Sync Preview — The Trust Gate

Sync is where notes become KB changes. This is the action that makes the PM nervous. The entire UX is designed to remove that fear.

#### 7.4.1 Accessing Sync

Two entry points:
1. **The status bar** at the top of any Workbench page: "⟳ Sync: 3 pending notes ready to merge [Preview →]"
2. **The Stream** (v1.1) has a "Sync" button in its top-right corner

Tapping either opens the Sync Preview modal. **It is a modal, not a separate page.** Leaving the modal (Esc or Cancel) returns to exactly where the PM was. Context preserved.

#### 7.4.2 The Preview Modal

Four stages in one modal, using a `Tabs` component from shadcn:

```
┌─ Sync Preview ────────────────────────────────────── ✕ ─┐
│                                                           │
│  [Overview] [KB Changes] [Document Impact] [Blockers]    │
│  ═══════════                                              │
│                                                           │
│  3 pending notes will produce:                           │
│                                                           │
│   ✓ 2 new business rules                                 │
│   ✓ 1 feature description update                         │
│   ✓ 1 entity relationship added                          │
│                                                           │
│   ⚠ 1 contradiction must be resolved first              │
│                                                           │
│   📄 3 generated documents will become stale:           │
│      - steuer-news-edition-mgmt (v4)                    │
│      - customer-portal-review (v3)                      │
│      - project-overview (v6)                            │
│                                                           │
│   ⏱ Estimated sync time: ~45 seconds                    │
│   💰 Estimated cost: $0.08                              │
│                                                           │
│                              [Cancel]  [Apply Sync →]    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**Each tab:**
- **Overview**: the summary shown above — the PM's glance view
- **KB Changes**: itemized list of every field that will change, with before/after snippets (uses the `diff` library)
- **Document Impact**: list of generated documents that will go stale, with a "Regenerate after sync" checkbox per document (PM can opt into auto-regeneration; default off in v1.0 because regeneration is separately costly and disruptive)
- **Blockers**: list of unresolved contradictions; each with inline "Resolve" action that opens the contradiction flow from §7.2.3

#### 7.4.3 The Apply Flow

Tap "Apply Sync". The modal transforms to a progress screen:

```
┌─ Applying sync... ──────────────────────────────────── ┐
│                                                         │
│   ⟳ Incorporating notes into KB...                    │
│                                                         │
│   ✓ Loaded existing KB (v38)                           │
│   ✓ Grouped 3 notes by feature area                    │
│   ⟳ Merging into Steuer-News Edition Management (2/3) │
│     Extracting business rules...                        │
│   ⧗ Merging into Customer Portal Review (pending)      │
│   ⧗ Extracting structured business rules (pending)     │
│   ⧗ Saving KB v39 (pending)                            │
│                                                         │
│   [Cancel]                                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Progress is real — each step completes as the backend pipeline runs. The PM sees the system thinking. If anything fails, the current step changes to ⚠ with a recovery option.

**Atomicity:** either the entire sync commits to KB v39, or nothing commits. No partial state. If halfway through the AI call fails, the KB stays at v38 and affected notes remain pending.

#### 7.4.4 After Apply

Modal transitions to success:

```
┌─ Sync complete ─────────────────────────────────────── ┐
│                                                         │
│   ✓ KB is now at v39 (from v38)                        │
│   ✓ 3 notes incorporated                               │
│   ⚠ 3 documents are now out of date                    │
│                                                         │
│   [View KB changes]  [Regenerate documents]  [Done]   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

A **Rollback** option is available for 24 hours via the KB version history (simple link: "Rolled back v38 → v37 before apply"). After 24 hours, the old version is still queryable but not trivially rollback-able.

#### 7.4.5 Edge Cases

- **Sync clicked with zero pending notes:** modal shows "Nothing to sync" with a friendly illustration and a close button
- **Sync clicked with only contradictions pending:** modal jumps directly to Blockers tab, Apply disabled
- **Concurrent sync attempt (multi-tab):** second attempt shows "Another sync is in progress" with a link to the in-progress one
- **Sync fails mid-flow:** KB rolled back automatically; affected notes remain pending; retry button appears

### 7.5 First-Use Onboarding

Nobody reads documentation. The Workbench must teach itself.

#### 7.5.1 Session 1: The First Visit

When a PM enters the Workbench for the first time (detected by: `quick_notes` count = 0 for this project):

A subtle overlay appears on the Capture tab, with three beats:

```
Beat 1:  "This is where your thoughts live."
         (pointer aimed at the capture pill-button)
         [Got it →]

Beat 2:  "Press Cmd+N anywhere in SpecLoom to capture."
         (shows keyboard shortcut visually)
         [Next →]

Beat 3:  "Every thought becomes part of your spec."
         (small diagram: note → KB → document)
         [Try it now]
```

Final beat has the CTA [Try it now] which triggers the capture drawer to open with a pre-filled placeholder: "Write or speak anything about your project...".

After the PM's first note is saved, the overlay disappears forever.

#### 7.5.2 Session 2: After 3 Notes

When `quick_notes` count reaches 3, a new tooltip appears on the Readiness tab (or a badge dot if Readiness is v1.2):

"📊 See how your spec is shaping up — Readiness shows you what's documented and what's missing."

Dismissable. Never re-shown.

#### 7.5.3 Session 3: Before First Sync

When pending notes count reaches 5 and the PM opens the Workbench, a top banner appears:

"You have 5 thoughts captured. Ready to merge them into your Knowledge Base? [Preview sync →]"

Dismissable. Re-shown at 10 pending, 20, 50 (sliding scale — we nudge but don't nag).

#### 7.5.4 Session 4: First Sync Complete

Right after the first successful sync, a celebratory (but understated) overlay:

"Your notes just became part of your Knowledge Base. Next time you generate a document, they'll shape the output. Ask the KB anything, anytime."

One-time. Sets expectations for the compound loop.

**Principle:** onboarding is progressive. We don't cram all the tutorials into session 1. Each overlay appears exactly when the PM is about to benefit from knowing. This respects §4.7 (respect the PM's time).

### 7.6 Error States, Offline, Undo

#### 7.6.1 Save Failure

If `POST /notes` fails:
1. The note stays in local IndexedDB draft state
2. A non-dismissable toast: "Offline. Your note is saved locally and will sync when you're back online."
3. A retry happens automatically every 30 seconds
4. The capture drawer shows a subtle warning icon next to the note
5. When connectivity returns and sync succeeds, the icon clears with a check mark

**The PM never loses a thought to a network blip.** This is sacred.

#### 7.6.2 AI Post-Processing Failure

If the proactive AI call fails (rate limit, API error, timeout):
- The note is still saved (the save happened at T=0)
- The "AI thinking..." skeleton silently disappears after 30 seconds
- A subtle icon appears next to the note: "AI didn't respond. [Retry analysis]"
- Retry is free (doesn't count against budget); behind the scenes it re-queues the same prompt

**We never block the user on AI.** The feature degrades to "dumb storage" under AI failure, which is still useful.

#### 7.6.3 Voice Failure

If Whisper fails:
- The recording is preserved locally
- A message appears: "Transcription failed. Your recording is saved; would you like to retry, or type it instead?"
- Retry button re-sends to Whisper
- "Type instead" returns to text mode with an empty text area (the PM transcribes their own audio if urgent)

#### 7.6.4 Undo

Every destructive action has an undo window:
- **Archive a note:** toast with "Undo" button for 10 seconds
- **Supersede a note via contradiction resolution:** toast with "Undo" for 10 seconds
- **Sync apply:** "Rollback" action available in KB version history for 24 hours

Undo restores exact prior state — no data loss.

### 7.7 Accessibility And Keyboard

The Workbench passes WCAG 2.2 AA.

#### 7.7.1 Keyboard Navigation

| Action | Shortcut |
|---|---|
| Open capture drawer | `Cmd+N` / `Ctrl+N` |
| Close any drawer/modal | `Esc` |
| Save note from drawer | `Cmd+Enter` |
| Switch Workbench tabs | `Cmd+1..5` |
| Focus Ask-KB input | `Cmd+K` (opens command palette with AskKB option) |
| Sync preview | `Cmd+Shift+S` |
| Voice toggle in drawer | `Cmd+M` |

Every interactive element is keyboard-reachable via `Tab`. Focus rings are visible on all elements (no `outline: none` without replacement).

#### 7.7.2 Screen Reader

- All icons have `aria-label`
- The capture drawer opens with `role="dialog"` and `aria-modal="true"`
- Waveform has `aria-label="Recording in progress"` and updates `aria-live="polite"` with duration
- Classification pills announce their type ("Classified as business rule, accept or change")
- Probes are announced sequentially, not all at once

#### 7.7.3 Color Contrast

All text ≥ 4.5:1 on its background. Classification pills use both color AND icon so colorblind users aren't dependent on color. Contradiction warnings use the AlertTriangle icon + yellow tint (not just yellow).

### 7.8 Mobile Behaviour

PMs use SpecLoom on phones. The mobile experience must be great, not adequate.

#### 7.8.1 Breakpoints

| Width | Behaviour |
|---|---|
| ≤ 640px | Mobile layout: drawer becomes bottom sheet, tabs become segmented control |
| 641-1023px | Tablet layout: drawer is side panel 60% width, tabs full |
| ≥ 1024px | Desktop layout: drawer 420px right-side, tabs + context panels |

#### 7.8.2 Capture On Mobile

The capture pill-button is larger on mobile (44px min height per iOS HIG) and positioned bottom-center instead of bottom-right to be thumb-reachable.

Voice is the default on mobile — the mic icon is the primary visual in the capture sheet, text input is secondary. On mobile, PMs are walking, driving, standing in line; voice wins.

The sheet uses native momentum scrolling and a swipe-down-to-close gesture.

#### 7.8.3 Ask-The-KB On Mobile

Full-screen on mobile. The Context drawer becomes a collapsible bottom sheet that auto-appears after each answer. Sources are stacked chips; tapping opens a full-screen viewer (video at timestamp, note, doc section).

#### 7.8.4 Sync Preview On Mobile

The modal becomes a full-screen sheet. Tabs are preserved. The "Apply Sync" button is fixed to the bottom so it's always reachable.

#### 7.8.5 iOS Share Sheet (Deferred)

The v2 design floated "iOS Share Sheet → Add to SpecLoom" for capturing thoughts from other apps. This is a PWA manifest `share_target` + iOS Shortcuts integration. **Deferred to v1.1** — nice to have, not blocking.

---

## 8. Later Phases UX (v1.1 - v2.1)

Lighter detail than §7. Each of these is a phase following v1.0 Magical Core.

### 8.1 v1.1 — Note Stream (2 days)

A chronological feed of all captures. Tab: `📋 Stream`.

**Layout:** full-width list, one row per note, newest first. Each row shows:
- Time-ago (e.g., "2h ago")
- Type pill + feature area pill
- First 120 chars of body
- Status indicator (draft / active / synced)
- Inline action menu (•••)

**Filters:** horizontal chip row at the top (not a sidebar) — "All · Pending probes · Unresolved contradictions · Archived · Clarifications from devs". Adding a feature area as a filter tag is a click on any feature pill.

**Search:** `Cmd+K` opens a command palette with full-text search across all notes.

**Per-note detail:** clicking a row opens a side drawer (not a page navigation — preserves Stream context). The drawer shows:
- Full body with edit affordance
- Classification (editable)
- Feature areas (editable)
- References (editable)
- Probes status (answered / pending / dismissed)
- KB influence (once synced) — "This note contributed to: BR-049 in feature X"
- Timeline: created → AI analyzed → answered probes → synced → merged into KB
- Actions: Archive / Supersede / Duplicate

**Bulk operations:** `Shift+click` selects a range; actions appear in a floating action bar at the bottom.

### 8.2 v1.2 — Readiness Dashboard (1.5 days)

Tab: `📊 Readiness`. Renders a dimensional score using existing `completeness-radar.tsx` component plus new breakdown cards.

**Top section:** overall score as a single number + delta from last week ("74%, +12 from 7 days ago").

**Dimension cards:** one card per dimension — Features, Business Rules, Entities, Workflows, Roles, Error Handling, Integrations. Each card:
- Progress bar with current/target counts
- Top 3 gaps ("Missing: User Account · 0 BRs for Steuer-News Email · Integration X has no error handling defined")
- "Fix now →" button per gap → jumps to the right surface (open questions, capture drawer pre-filled, etc.)

**AI Quick Wins panel:** 3-5 AI-suggested actions the PM can take right now to close the biggest gaps. Each is a single click.

Uses the existing `completeness-radar.tsx`, `gap-report.tsx`, and `data-model-view.tsx` components where applicable — minimizes new UI work.

### 8.3 v1.3 — KB Explorer (3 days)

Tab: `🔍 Explore`. Read-only view onto the Knowledge Base.

**Tabs within:** Features, Entities (table, no graph in v1), Rules, Workflows, Open Questions.

Reuses existing components:
- `feature-map.tsx` for Features tab
- `data-model-view.tsx` for Entities tab
- `cross-references.tsx` for relationship display

**New components for this phase:** Rules table (filterable, sortable), Workflows diagram-renderer (markdown mermaid via remark plugin).

**Cross-linking:** every item links to its source artefacts (notes, videos, documents). Clicking a source navigates with context preserved.

**KB Version label:** persistent at the top of every Explorer tab: "KB v39 · synthesized Apr 18, 2026 · 4 videos, 3 docs, 12 notes". Clicking the label shows version history + diff view.

### 8.4 v1.4 — Cross-Linking (1 day)

Polish pass that wires bidirectional links everywhere:
- Note detail → generated documents that contain content from this note
- Document section → notes that contributed to it
- Business rule → note of origin + video timestamp
- Entity → notes that defined its fields

Pure plumbing, no new UI components. Query layer changes only.

### 8.5 v2.0 — CodeMantis Clarification Loop (3 days)

Integrates with `clarification_requests` table from AI Implementation Guides v3 §9.4.

**Inbound:** a developer hits ambiguity in a session. Their agent (Claude Code, Cursor, Windsurf, CodeMantis) POSTs to `/api/clarifications` (Guides v3 §17.9). The request appears in the PM's Workbench:

- Status bar banner: "⚠ Inbox: 2 developer clarifications awaiting answer [Open]"
- New tab in Stream filters: "Clarifications from devs"
- Each clarification card shows: the question, the session that raised it, which guide/feature it belongs to, the dev's context, and a big [Answer] button

**Answering:** tapping [Answer] opens the capture drawer pre-filled with: (a) the question as a quoted reference in the body, (b) the feature area pre-tagged, (c) a reference back to the clarification. The PM writes the answer (text or voice), saves, syncs, and optionally regenerates the affected session.

**Resolution feedback:** once the PM answers + syncs + regenerates, a webhook (if CodeMantis is connected) notifies the dev's agent to pull the updated session. Without CodeMantis, the PM's answer is visible in the clarification status for the dev to check manually.

### 8.6 v2.1 — Polish (3 days)

- Entity force-directed graph (deferred from v2)
- KB version diff viewer (using the `diff` library already in dependencies)
- Note templates (pre-fill capture drawer for common patterns)
- Email intake (forward an email to notes@project.specloom.io)

---

## 9. Data Model — Database Schema

### 9.1 Tables Overview

| Table | Purpose | New? |
|---|---|---|
| `quick_notes` | The main notes table | Yes |
| `note_probes` | AI-generated probes per note | Yes |
| `note_contradictions` | Detected conflicts between notes | Yes |
| `kb_versions` | Versioned KB snapshots for sync history | Yes |
| `sync_previews` | Ephemeral dry-run results (1hr TTL) | Yes |
| `sync_jobs` | Async Apply job tracking | Yes |
| `conversations` | Extended to support `conversation_type='ask_kb'` | Existing, extended |
| `clarification_requests` | Inbound from agents (defined in Guides v3 §9.4) | Existing (from Guides v3) |

### 9.2 `quick_notes`

```sql
CREATE TABLE quick_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT GENERATED ALWAYS AS ('N-' || lpad((EXTRACT(epoch FROM created_at)::bigint % 100000)::text, 5, '0')) STORED,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  -- Core content
  body TEXT NOT NULL CHECK (length(body) >= 1),

  -- AI-inferred classification (editable by PM)
  note_type TEXT NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('business_rule','edge_case','clarification','domain_term',
                          'constraint','question_for_self','general')),
  note_type_confidence NUMERIC(3,2),        -- AI confidence 0.00-1.00; NULL if human-set
  note_type_ai_suggested BOOLEAN DEFAULT FALSE,
  note_type_accepted_by_user BOOLEAN DEFAULT FALSE,

  -- Feature areas (editable by PM)
  feature_areas TEXT[] DEFAULT '{}',
  feature_areas_ai_suggested BOOLEAN DEFAULT FALSE,
  feature_areas_accepted_by_user BOOLEAN DEFAULT FALSE,

  -- Free-form tags
  tags TEXT[] DEFAULT '{}',

  -- References to other SpecLoom artefacts
  -- Shape: [{"kind": "video"|"document"|"note"|"clarification", "id": "uuid",
  --          "timestamp_seconds": N, "page": N, "section": "text"}]
  refs JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Voice origin
  voice_audio_storage_path TEXT,
  voice_duration_seconds INTEGER,
  voice_transcription_cost NUMERIC(10,6),

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','archived','superseded')),
  superseded_by UUID REFERENCES quick_notes(id),
  superseded_reason TEXT,

  -- Parent note (for probes-become-notes, clarifications-become-notes)
  parent_note_id UUID REFERENCES quick_notes(id),
  parent_kind TEXT CHECK (parent_kind IN ('probe_answer','clarification_answer','askkb_capture','manual')),

  -- Clarification linkage (v2.0)
  answers_clarification_id UUID,  -- FK added in v2.0 when clarification_requests exists

  -- AI post-processing status
  ai_post_processing_status TEXT DEFAULT 'pending'
    CHECK (ai_post_processing_status IN ('pending','running','done','failed','not_needed')),
  ai_post_processing_cost NUMERIC(10,6) DEFAULT 0,

  -- KB incorporation trail
  kb_incorporation JSONB,
  -- Shape: {"kb_version": 39, "incorporated_at": "...",
  --          "applied_to": [{"field": "business_rules", "rule_id": "BR-049"},
  --                          {"field": "feature_map", "feature": "Steuer-News"}],
  --          "sync_job_id": "uuid"}

  last_synced_at TIMESTAMPTZ,
  last_synced_kb_version INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quick_notes_project_status ON quick_notes(project_id, status);
CREATE INDEX idx_quick_notes_project_created ON quick_notes(project_id, created_at DESC);
CREATE INDEX idx_quick_notes_type ON quick_notes(project_id, note_type);
CREATE INDEX idx_quick_notes_feature_areas ON quick_notes USING GIN (feature_areas);
CREATE INDEX idx_quick_notes_tags ON quick_notes USING GIN (tags);
CREATE INDEX idx_quick_notes_search ON quick_notes USING GIN (to_tsvector('simple', body));
CREATE INDEX idx_quick_notes_pending_sync ON quick_notes(project_id, last_synced_at)
  WHERE status = 'active' AND (last_synced_at IS NULL OR updated_at > last_synced_at);

CREATE TRIGGER update_quick_notes_updated_at BEFORE UPDATE
  ON quick_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quick_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY quick_notes_project_access ON quick_notes
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.3 `note_probes`

AI-generated follow-up questions per note.

```sql
CREATE TABLE note_probes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  probe_text TEXT NOT NULL,
  probe_index INTEGER NOT NULL,                        -- 0-based order within a note
  generation_model TEXT,
  generation_cost NUMERIC(10,6) DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','answered','skipped','not_relevant')),
  answer_note_id UUID REFERENCES quick_notes(id),      -- when answered, the resulting child note
  dismissed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(note_id, probe_index)
);

CREATE INDEX idx_note_probes_note ON note_probes(note_id);
CREATE INDEX idx_note_probes_project_pending ON note_probes(project_id, status)
  WHERE status = 'pending';

CREATE TRIGGER update_note_probes_updated_at BEFORE UPDATE
  ON note_probes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE note_probes ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_probes_project_access ON note_probes
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.4 `note_contradictions`

Detected conflicts between notes.

```sql
CREATE TABLE note_contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  note_a_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
  note_b_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,

  description TEXT NOT NULL,
  detection_model TEXT,
  detection_cost NUMERIC(10,6) DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (status IN ('unresolved','resolved_use_a','resolved_use_b','resolved_both','dismissed')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_note_id UUID REFERENCES quick_notes(id),  -- if resolution created a new clarifying note

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (note_a_id <> note_b_id)
);

CREATE INDEX idx_contradictions_project_status ON note_contradictions(project_id, status);
CREATE INDEX idx_contradictions_note_a ON note_contradictions(note_a_id);
CREATE INDEX idx_contradictions_note_b ON note_contradictions(note_b_id);

CREATE TRIGGER update_note_contradictions_updated_at BEFORE UPDATE
  ON note_contradictions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE note_contradictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_contradictions_project_access ON note_contradictions
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.5 `kb_versions`

Versioned KB snapshots. The existing `knowledge_bases` table stores the current KB; this new table stores every historical version so we can diff and rollback.

```sql
CREATE TABLE kb_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,

  -- Full KB snapshot (same shape as knowledge_bases.kb_content)
  kb_content JSONB NOT NULL,

  -- What triggered this version
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('full_synthesis','notes_sync','manual_edit','migration')),
  source_sync_job_id UUID,                           -- if source_kind='notes_sync'
  notes_incorporated_ids UUID[],                      -- if source_kind='notes_sync'

  -- Diff from previous version (computed at creation, for fast read)
  -- Shape: {"added": {...}, "removed": {...}, "modified": {...}}
  diff_from_previous JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(project_id, version_number)
);

CREATE INDEX idx_kb_versions_project ON kb_versions(project_id, version_number DESC);
CREATE INDEX idx_kb_versions_source ON kb_versions(source_kind);

ALTER TABLE kb_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY kb_versions_project_access ON kb_versions
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.6 `sync_previews`

Ephemeral dry-run results. Cached for 1 hour so re-opening the preview doesn't re-run the expensive dry-run.

```sql
CREATE TABLE sync_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  -- Which notes were considered
  pending_note_ids UUID[],
  base_kb_version INTEGER NOT NULL,

  -- Predicted changes (for the Preview modal)
  predicted_kb_changes JSONB NOT NULL,
  predicted_document_impact JSONB NOT NULL,
  blockers JSONB NOT NULL,                            -- unresolved contradictions

  -- Cost estimates
  estimated_cost_usd NUMERIC(10,6),
  estimated_duration_seconds INTEGER,

  -- Cache
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 hour'),
  applied_via_sync_job_id UUID,                       -- set when the preview is actually applied

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_previews_project ON sync_previews(project_id, expires_at)
  WHERE applied_via_sync_job_id IS NULL;

ALTER TABLE sync_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_previews_project_access ON sync_previews
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Cleanup job: delete expired unused previews (to be added to scheduled Supabase function)
-- SELECT cron.schedule('cleanup-sync-previews', '0 * * * *', $$
--   DELETE FROM sync_previews
--   WHERE expires_at < now() AND applied_via_sync_job_id IS NULL;
-- $$);
```

### 9.7 `sync_jobs`

Async apply job tracking.

```sql
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  sync_preview_id UUID REFERENCES sync_previews(id),
  note_ids UUID[] NOT NULL,
  base_kb_version INTEGER NOT NULL,

  -- Execution progress (for the real-time progress UI in §7.4.3)
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','rolled_back')),
  current_step TEXT,                                  -- human-readable current step
  step_index INTEGER DEFAULT 0,
  total_steps INTEGER,
  progress_detail JSONB,                              -- free-form step-by-step detail

  -- Output
  resulting_kb_version INTEGER,
  actual_cost_usd NUMERIC(10,6),
  actual_duration_seconds INTEGER,

  error_message TEXT,
  error_detail JSONB,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_jobs_project_status ON sync_jobs(project_id, status);
CREATE INDEX idx_sync_jobs_project_created ON sync_jobs(project_id, created_at DESC);

CREATE TRIGGER update_sync_jobs_updated_at BEFORE UPDATE
  ON sync_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_jobs_project_access ON sync_jobs
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
```

### 9.8 `conversations` Extension

The existing `conversations` table already has `conversation_type` text column. Extend by using a new value:

```sql
-- No DDL needed — conversations.conversation_type is a text column
-- New value: 'ask_kb'
-- Existing values: 'onboarding', 'qa_session'
```

For Ask-the-KB, the `messages` JSONB column stores the turns:
```json
[
  {"role": "user", "content": "...", "timestamp": "..."},
  {"role": "assistant", "content": "...", "timestamp": "...",
   "sources": [{"kind": "video", "id": "...", "timestamp_seconds": 134}, ...]}
]
```

For v1.0 this is fine. If chat sessions grow very long, a future migration can lift messages to a dedicated table.

### 9.9 Cost Operation Enum Additions

```sql
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'note_voice_transcription';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'note_proactive_analysis';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'note_contradiction_detection';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'ask_kb_response';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'sync_preview_dry_run';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'notes_sync_incorporation';
ALTER TYPE cost_operation ADD VALUE IF NOT EXISTS 'notes_sync_rule_extraction';
```

---

## 10. Migration Plan (Database)

Single migration file: `supabase/migrations/2026NNNN_knowledge_workbench.sql`. Order:

1. `quick_notes` table + indexes + trigger + RLS + policy
2. `note_probes` table + indexes + trigger + RLS + policy
3. `note_contradictions` table + indexes + trigger + RLS + policy
4. `kb_versions` table + indexes + RLS + policy
5. `sync_previews` table + indexes + RLS + policy
6. `sync_jobs` table + indexes + trigger + RLS + policy
7. Cost enum additions
8. Backfill: seed `kb_versions` with the current `knowledge_bases.kb_content` for every project that has one, as `version_number=1, source_kind='migration'`

No schema change to `conversations` — we just use `conversation_type='ask_kb'` going forward.

---

## 11. Pipeline Stages (Backend)

New Python modules in `fly-containers/specforge-worker/src/pipeline/`:

### 11.1 `pipeline/note_proactive_analysis.py`

Triggered on every note save. Single AI call produces classification + probes + contradictions.

```python
async def analyze_note_proactive(note: QuickNote, project_kb: dict) -> dict:
    """Single AI call, Grok 4.20 non-reasoning, returns:
      {
        classification: {type: str, type_confidence: float,
                         feature_areas: [str], feature_areas_confidence: float},
        references: [{kind, id, timestamp_seconds?}],  # auto-extracted from body
        probes: [str],  # 1-3 follow-up questions
        contradictions: [{with_note_id: uuid, description: str}]  # matches against recent notes + KB
      }
    Budget: ~$0.001 per call. Timeout: 30s."""
```

Model: `grok-4.20-non-reasoning-latest` (per existing convention). Falls back to `gemini-3-flash-preview` if Grok times out.

Outputs: inserts `note_probes` rows, inserts `note_contradictions` rows, updates `quick_notes` classification fields with `*_ai_suggested=true`.

### 11.2 `pipeline/note_voice_transcription.py`

Whisper streaming via existing voice infrastructure + a cleanup pass.

```python
async def transcribe_note_voice(audio_blob: bytes, language_hint: str | None = None) -> dict:
    """Whisper transcribe → cleanup pass (remove filler words, split run-ons)
       Returns: {transcript: str, cleaned_transcript: str, duration_seconds: int, cost: float}"""
```

Reuses the existing `transcribe-audio` Edge Function for Whisper call; adds a cleanup pass via a tiny Gemini Flash prompt (~$0.0001).

### 11.3 `pipeline/ask_kb_rag.py`

Retrieval-augmented generation over the project's knowledge sources.

```python
async def ask_kb(project_id: str, question: str, conversation_history: list[dict]) -> AsyncIterator[dict]:
    """Streaming RAG pipeline:
       1. Generate embedding for question (existing embeddings infrastructure)
       2. Retrieve top-K chunks from: video transcripts, documents, quick_notes,
          KB feature descriptions, business rules
       3. Feed (question + history + chunks) to Gemini 3 Flash; stream response
       4. Extract source citations from response
       Yields: {type: 'token' | 'source' | 'done', data: ...}"""
```

Reuses the embeddings index already built for synthesis. No new embedding infrastructure.

### 11.4 `pipeline/notes_sync_preview.py`

Dry-run of the sync: predicts KB changes, document impact, blockers. Does NOT write anything.

```python
async def compute_sync_preview(project_id: str, note_ids: list[str]) -> dict:
    """Returns the shape stored in sync_previews.predicted_kb_changes etc.
       Uses Gemini Flash Lite for the dry-run (cheap, fast)."""
```

Execution plan: group notes by feature area → for each group, a tiny AI call predicts "what BRs, entities, feature descriptions would change" without actually computing the merged KB. Output is a predicted diff, not a real diff — fast and cheap.

Cost: ~$0.01 for a typical 10-note sync.

### 11.5 `pipeline/notes_sync_apply.py`

The real sync. This is the expensive one (~$0.05-0.20).

```python
async def apply_notes_sync(sync_job_id: str) -> None:
    """Full incremental incorporation:
       1. Load current KB
       2. Load all active notes flagged for sync
       3. Group by feature area (untagged → global bucket)
       4. Per-bucket AI call: merge notes into that feature's KB content
       5. Global AI call: merge untagged notes into executive_summary, system_context
       6. Extraction AI call: BR/edge_case/constraint notes → structured business_rules[]
       7. Save new kb_versions row with full snapshot + diff_from_previous
       8. Update knowledge_bases (current pointer) to the new version
       9. Update each note's kb_incorporation with version + applied_to
      10. Mark sync_job as completed

       Progress events emitted at each step for real-time UI."""
```

Model: `grok-4.20-reasoning-latest` with `thinking_effort='low'` — structural merging task, same profile as screenshot re-binding.

**Progress emission:** the UI needs real-time progress (§7.4.3). Use Supabase Realtime on `sync_jobs` — UPDATE the row's `current_step` at each milestone, the UI subscribes and re-renders.

### 11.6 `pipeline/kb_diff.py`

Given two KB versions, compute a structured diff. Used by both sync preview and post-sync review.

```python
def compute_kb_diff(before: dict, after: dict) -> dict:
    """Returns {added: {...}, removed: {...}, modified: {...}} per field.
       Uses the 'diff' npm package semantics but in Python — walk the JSONB structure."""
```

Pure function, no AI, no cost. Used everywhere sync or version comparison happens.

### 11.7 `pipeline/note_orchestration.py`

Top-level orchestrator for note lifecycle events. Subscribes to:
- `quick_notes` INSERT → triggers `note_proactive_analysis` async
- Voice upload → triggers `note_voice_transcription`
- Sync preview request → triggers `notes_sync_preview`
- Sync apply request → triggers `notes_sync_apply`

Dispatches to the appropriate pipeline module with cost tracking and error handling.

---

## 12. API Surface (Supabase Edge Functions)

New Edge Functions in `supabase/functions/`:

### 12.1 Notes CRUD

- `POST /functions/v1/notes` — create a note. Triggers proactive analysis async. Returns immediately with note + job_id.
- `GET /functions/v1/notes?project_id=X&status=Y&limit=N&cursor=...` — paginated list, filterable.
- `GET /functions/v1/notes/:id` — single note with embedded probes, contradictions, kb_incorporation.
- `PATCH /functions/v1/notes/:id` — edit body, classification, feature areas, tags, status.
- `DELETE /functions/v1/notes/:id` — soft-delete (sets `status='archived'`). Hard delete never from API.
- `POST /functions/v1/notes/:id/supersede` — body `{superseded_by_id, reason}`.

### 12.2 Voice Capture

- `POST /functions/v1/notes/voice-upload` — multipart upload of audio blob. Returns `{note_id, transcription_job_id}`. Transcription runs async.
- `GET /functions/v1/notes/:id/transcription-status` — poll or (preferred) subscribe via Realtime.

### 12.3 Probes

- `PATCH /functions/v1/note-probes/:id/status` — body `{status: 'answered' | 'skipped' | 'not_relevant'}`. On `answered`, the body also includes the new note content, which creates a child note.
- `POST /functions/v1/note-probes/:id/answer` — creates a child note as the probe answer. Triggers full note creation flow for the child (proactive analysis etc.).

### 12.4 Contradictions

- `PATCH /functions/v1/note-contradictions/:id/resolve` — body `{resolution: 'use_a' | 'use_b' | 'both'}`. Updates both notes' `superseded_by` fields as appropriate.

### 12.5 Ask KB

- `POST /functions/v1/ask-kb` — body `{project_id, conversation_id?, question}`. Server-sent events stream of tokens + source citations. Creates a new `conversations` row if `conversation_id` is omitted.
- `GET /functions/v1/ask-kb/conversations?project_id=X` — list past conversations.
- `POST /functions/v1/ask-kb/capture-answer` — body `{conversation_id, message_index}`. Creates a note from the specified AI answer, pre-populating body + tags + references. Returns the new note.

### 12.6 Sync

- `POST /functions/v1/sync/preview` — body `{project_id}`. Returns a `sync_preview_id` + preview data. The preview is cached (1hr) so re-opens are instant.
- `GET /functions/v1/sync/previews/:id` — retrieve a cached preview.
- `POST /functions/v1/sync/apply` — body `{sync_preview_id}`. Creates a `sync_jobs` row and triggers async pipeline. Returns `{sync_job_id}` immediately.
- `GET /functions/v1/sync/jobs/:id` — current status of a sync job. Real-time via Supabase subscription.
- `POST /functions/v1/sync/rollback` — body `{project_id, to_version}`. Rolls the KB back to a prior version (within 24h soft-rollback window).

### 12.7 KB Versions

- `GET /functions/v1/kb-versions?project_id=X` — list versions with summaries.
- `GET /functions/v1/kb-versions/:id/diff` — structured diff vs previous version (for the v2.1 diff viewer).

### 12.8 Clarifications (from Guides v3 §17.9-17.11)

These endpoints are defined in AI Implementation Guides v3; this spec just consumes them on the PM side:
- `GET /functions/v1/clarifications?project_id=X&status=pending` — list for the Inbox tab.
- `POST /functions/v1/clarifications/:id/answer` — PM answers; creates a `quick_notes` row linked to the clarification; flags the originating session for regeneration.

---

## 13. Frontend Architecture

### 13.1 Routing

Add to `src/router.tsx`:

```ts
{
  path: 'projects/:projectId/workbench',
  element: <WorkbenchPage />,
  children: [
    { index: true, element: <Navigate to="capture" replace /> },
    { path: 'capture',   element: <CaptureTab /> },
    { path: 'stream',    element: <StreamTab /> },      // v1.1
    { path: 'ask',       element: <AskKbTab /> },
    { path: 'readiness', element: <ReadinessTab /> },   // v1.2
    { path: 'explore',   element: <ExploreTab /> },     // v1.3
  ]
}
```

### 13.2 New Pages

- `src/pages/project/workbench.tsx` — shell page with tab bar + status bar + `<Outlet />`

### 13.3 New Components

Organized under `src/components/workbench/`:

**Shared infrastructure (v1.0):**
- `WorkbenchShell.tsx` — the tab bar + status bar + layout
- `StatusBar.tsx` — top strip showing pending sync count + clarification inbox count (conditional rendering)
- `TabNav.tsx` — five-tab navigation, `Cmd+1..5` keyboard shortcuts
- `WorkbenchEmptyState.tsx` — first-visit overlay

**Capture (v1.0):**
- `CapturePillButton.tsx` — global floating affordance, visible on every project page
- `CaptureDrawer.tsx` — the sheet / dialog that opens on `Cmd+N`
- `CaptureForm.tsx` — the one-field form inside the drawer
- `CaptureVoiceMode.tsx` — voice mode transformation of the form (reuses `waveform-visualizer` + `voice-controls`)
- `CaptureSuggestions.tsx` — wrapper for post-save AI suggestions
- `ClassificationPills.tsx` — type + feature-area pill row with inline editing
- `ProbeStack.tsx` — stacked probe cards with voice/type/skip actions
- `ContradictionBanner.tsx` — yellow warning banner with resolution buttons
- `SourceExtractor.tsx` — renders auto-extracted `refs` as chips

**Capture tab surface (v1.0):**
- `CaptureTab.tsx` — the "Capture" Workbench tab with recent captures + onboarding
- `RecentCaptureList.tsx` — small list of 5 newest notes with AI enrichment visible
- `RecentCaptureCard.tsx` — one row in the recent list

**Ask KB (v1.0):**
- `AskKbTab.tsx` — the tab shell
- `AskKbConversation.tsx` — the chat main column
- `AskKbContextPanel.tsx` — sources right panel (collapsible on mobile)
- `AskKbMessage.tsx` — one message bubble (user or assistant)
- `AskKbSourceChip.tsx` — clickable source citation chip
- `AskKbInput.tsx` — text input + mic button
- `AskKbVoiceMode.tsx` — full-screen voice conversation (reuses `voice-session-panel`)
- `AskKbHistoryList.tsx` — left sidebar with past conversations

**Sync (v1.0):**
- `SyncPreviewModal.tsx` — the four-tab modal (Overview / KB Changes / Document Impact / Blockers)
- `SyncOverviewTab.tsx`
- `SyncKbChangesTab.tsx`
- `SyncDocumentImpactTab.tsx`
- `SyncBlockersTab.tsx`
- `SyncProgressView.tsx` — real-time progress display during apply (subscribes to `sync_jobs` via Realtime)
- `SyncSuccessView.tsx` — post-apply success screen with "View KB Changes" / "Regenerate" / "Done"
- `KbDiffView.tsx` — renders a structured diff using the `diff` library for before/after text snippets

**Note detail (v1.0, expanded in v1.1):**
- `NoteDetailDrawer.tsx` — side drawer shown when a note is clicked
- `NoteEditor.tsx` — inline edit of body, classification, areas
- `NoteInfluencePanel.tsx` — "This note contributed to..."
- `NoteTimelineView.tsx` — created → AI analyzed → probes answered → synced

**Later phases (v1.1 - v2.0):**
- `StreamTab.tsx`, `StreamFilterChips.tsx`, `StreamNoteRow.tsx`, `StreamSearchPalette.tsx` (v1.1)
- `ReadinessTab.tsx` (reuses `completeness-radar.tsx`, `gap-report.tsx`) (v1.2)
- `ExploreTab.tsx` (reuses `feature-map.tsx`, `data-model-view.tsx`, `cross-references.tsx`; adds `RulesTable.tsx`, `WorkflowDiagram.tsx`) (v1.3)
- `ClarificationInboxPanel.tsx` (v2.0)

### 13.4 New Hooks

All data-fetching uses `@tanstack/react-query` (already in dependencies). Hooks under `src/hooks/`:

**v1.0:**
- `useNotes(projectId, filters)` — list
- `useNote(noteId)` — single, with embedded probes + contradictions
- `useCreateNote()` — mutation, optimistic update
- `useUpdateNote()` — mutation
- `useSupersedeNote()` — mutation
- `useRetryNoteAnalysis(noteId)` — mutation for "AI didn't respond" retry
- `useVoiceUpload()` — mutation for voice-upload endpoint
- `useProbes(projectId, status)` — list
- `useUpdateProbe()` — mutation
- `useAnswerProbe()` — mutation that creates a child note
- `useContradictions(projectId, status)` — list
- `useResolveContradiction()` — mutation
- `useAskKbConversations(projectId)` — list
- `useAskKbConversation(conversationId)` — single
- `useAskKbStream()` — hook that manages SSE connection for streaming responses
- `useCaptureAskKbAnswer()` — mutation to promote an answer to a note
- `useSyncPreview(projectId)` — mutation (idempotent — cached 1hr)
- `useApplySync()` — mutation
- `useSyncJob(syncJobId)` — subscribes to Realtime, streams progress updates
- `useRollbackKb()` — mutation

**v2.0:**
- `useClarifications(projectId, status)` — list
- `useAnswerClarification()` — mutation that opens capture drawer pre-filled

### 13.5 Global Capture Affordance

`CapturePillButton` is rendered in the project layout wrapper (`src/components/layouts/project-layout.tsx` or equivalent) — NOT inside the Workbench page. This way it's visible on Documents, Videos, Materials, anywhere within a project.

The global `Cmd+N` keyboard listener is registered in the same layout wrapper. Press `Cmd+N` anywhere in a project → `CaptureDrawer` opens.

### 13.6 Keyboard Shortcut Registry

A single `src/hooks/useKeyboardShortcuts.ts` that registers all Workbench shortcuts centrally. This prevents collision with existing shortcuts and makes them discoverable via a `Cmd+/` help overlay.

### 13.7 State Management

- Query cache via React Query (per-key auto-refetch on window focus, stale-while-revalidate)
- Local UI state via React's built-in hooks — no Redux, no Zustand
- IndexedDB draft persistence via `idb-keyval` (tiny library, add to dependencies) for the capture drawer's local draft

### 13.8 Voice Reuse

The Workbench's voice features reuse these existing components without modification:
- `waveform-visualizer.tsx` (in capture drawer and Ask KB voice mode)
- `voice-controls.tsx` (in capture drawer)
- `voice-session-panel.tsx` (in Ask KB full voice mode)
- `voice-transcript.tsx` (in capture drawer for live transcript display)

The existing `transcribe-audio` Edge Function is reused for Whisper transcription.

---

## 14. Integration With Existing SpecLoom Pipeline

### 14.1 Notes → KB → Downstream Consumers

This is the critical data flow that makes notes actually matter:

```
PM writes note
    ↓
saved to quick_notes (status='active')
    ↓
proactive analysis (probes, contradictions, classification)
    ↓
PM clicks Sync → sync_preview → Apply
    ↓
notes_sync_apply pipeline stage
    ↓
NEW KB version (kb_versions row + knowledge_bases pointer updated)
    ↓
Every downstream consumer reads the new KB:
    ├── QA Intelligence (gap questions)
    ├── Document Generation
    ├── Epic Tickets
    ├── AI Implementation Guides (v3 spec §12 — read source_notes from KB)
    ├── Ask-the-KB chat (sees notes directly + KB)
    └── CodeMantis integration (on next bundle pull)
```

**No downstream regeneration is automatic.** The PM explicitly triggers doc regeneration, ticket regeneration, guide regeneration from their respective pages. The Workbench's job ends at "new KB version committed."

### 14.2 Integration With AI Implementation Guides v3

Guides v3 §12 consumes notes as authoritative context. That spec already handles the no-op fallback when this Workbench isn't shipped yet. When the Workbench is shipped:

1. Guide generation reads `quick_notes` filtered by feature area matching the session's scope
2. Selected notes become inline context in the session prompt under `### Notes` with source provenance
3. `guide_sessions.source_note_refs` is populated with the IDs of notes that contributed
4. When a note is edited after a guide is generated, the `guide_sessions.auto_regenerate_reason` flag is set (as per Guides v3 §14.3)

### 14.3 Integration With CodeMantis (v2.0 Only)

CodeMantis clarification requests flow in via the `clarification_requests` table defined in Guides v3 §9.4. The Workbench UI's responsibility in v2.0:

- Status bar shows pending clarification count
- "Clarifications from devs" filter in the Stream
- Clarification answer flow (opens capture drawer pre-filled; answer becomes a note; sync triggers; regeneration offered)

Writing the clarification answer as a note means it flows through the same authoritative-input path as any other note. Unified.

### 14.4 Onboarding Data Flow

The existing `projects.onboarding_context` is NOT replaced. It continues to store the one-time onboarding conversation's output. But a post-v1.0 migration can import high-signal facts from `onboarding_context.data` (e.g., primary entities, user roles) into the Workbench as seed notes — one note per structured field. This gives new projects a non-empty Workbench on day 1.

Migration: optional, done once per project when the PM first visits the Workbench. Not a blocking dependency.

---

## 15. Container / Deployment Concerns

### 15.1 Worker Container

All new pipeline modules live in the existing `fly-containers/specforge-worker` container. No new container.

New Python dependencies to add to `requirements.txt`:
- No new ones — `pyyaml`, `httpx`, OpenAI-compat clients all already present

### 15.2 Edge Functions

Each new Edge Function follows the existing pattern (see `supabase/functions/generate-epic-tickets/index.ts` as reference). Deployment via `supabase functions deploy`.

The `job-orchestrator` function is extended to handle two new `job_type` values:
- `note_proactive_analysis`
- `notes_sync_apply`

### 15.3 Realtime

Supabase Realtime is used for two streams:
1. `sync_jobs` UPDATE events → UI shows real-time progress during sync apply
2. `quick_notes` UPDATE events → Stream view (v1.1) shows new notes arriving on other tabs/devices

Realtime is already enabled for the project. We add publications for the new tables:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE sync_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE quick_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE note_probes;
ALTER PUBLICATION supabase_realtime ADD TABLE note_contradictions;
```

### 15.4 Storage

Voice audio blobs are stored in a new Supabase Storage bucket `note-voice/`. TTL: 90 days (audio is rarely revisited after transcription is saved).

RLS on the bucket: project_id-scoped.

### 15.5 Cron Jobs

One new scheduled Supabase function: `cleanup-sync-previews`, runs hourly, deletes expired unused previews (cleanup query from §9.6).

---

## 16. Model Configuration

```sql
INSERT INTO model_configurations (task_name, model_tier, provider, model, thinking_effort, is_active)
VALUES
  -- Proactive note analysis (fast, cheap, on every save)
  ('note_proactive_analysis', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('note_proactive_analysis', 'standard', 'xai',    'grok-4.20-non-reasoning-latest', NULL, true),
  ('note_proactive_analysis', 'premium',  'xai',    'grok-4.20-non-reasoning-latest', NULL, true),

  -- Voice cleanup pass (tiny, fast)
  ('note_voice_cleanup', 'economy',  'google', 'gemini-2.0-flash-lite', 'low', true),
  ('note_voice_cleanup', 'standard', 'google', 'gemini-2.0-flash-lite', 'low', true),
  ('note_voice_cleanup', 'premium',  'google', 'gemini-3-flash-preview', 'low', true),

  -- Ask-the-KB response (quality matters, latency matters)
  ('ask_kb_response', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('ask_kb_response', 'standard', 'google', 'gemini-3.1-pro-preview', 'medium', true),
  ('ask_kb_response', 'premium',  'anthropic', 'claude-sonnet-4-6', 'high', true),

  -- Sync preview dry-run (cheap, must be fast)
  ('sync_preview_dry_run', 'economy',  'google', 'gemini-2.0-flash-lite', 'low', true),
  ('sync_preview_dry_run', 'standard', 'google', 'gemini-2.0-flash-lite', 'medium', true),
  ('sync_preview_dry_run', 'premium',  'google', 'gemini-3-flash-preview', 'medium', true),

  -- Notes sync apply (the expensive one; quality matters)
  ('notes_sync_incorporation', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('notes_sync_incorporation', 'standard', 'xai',    'grok-4.20-reasoning-latest', NULL, true),
  ('notes_sync_incorporation', 'premium',  'xai',    'grok-4.20-reasoning-latest', NULL, true),

  -- Notes sync BR extraction (converts notes → structured business_rules[])
  ('notes_sync_rule_extraction', 'economy',  'google', 'gemini-3-flash-preview', 'medium', true),
  ('notes_sync_rule_extraction', 'standard', 'google', 'gemini-3.1-pro-preview', 'medium', true),
  ('notes_sync_rule_extraction', 'premium',  'anthropic', 'claude-sonnet-4-6', 'high', true);
```

---

## 17. Cost Estimates

### 17.1 Per-Note Cost (Standard Tier)

| Operation | Model | Cost |
|---|---|---|
| Voice transcription (30s) | Whisper | ~$0.003 |
| Voice cleanup pass | Gemini Flash Lite | ~$0.0001 |
| Proactive analysis (classify + probes + contradictions) | Grok non-reasoning | ~$0.001 |
| **Per-note total (voice)** | | **~$0.004** |
| **Per-note total (text only)** | | **~$0.001** |

### 17.2 Per-Sync Cost (Standard Tier, 10 Notes)

| Operation | Cost |
|---|---|
| Sync preview dry-run | ~$0.01 |
| Sync apply (incorporation per feature area, ~3 AI calls for 10 notes) | ~$0.05-0.15 |
| BR extraction pass | ~$0.02 |
| **Per-sync total** | **~$0.08-0.18** |

### 17.3 Ask-the-KB Chat (Per Turn)

| Operation | Cost |
|---|---|
| Embedding question | ~$0.0001 |
| Retrieve top-K (existing infra, free) | $0 |
| Gemini Pro response (streamed) | ~$0.008-0.015 |
| **Per turn** | **~$0.01** |

### 17.4 Monthly Estimate For An Active PM (3 Weeks, One Project)

| Activity | Volume | Cost |
|---|---|---|
| Notes captured (120 total, 40 via voice) | 120 | $0.20 |
| Ask-the-KB turns | 200 | $2.00 |
| Sync preview + apply | 12 | $2.00 |
| **Total** | | **~$4.20 / month** |

An active PM costs ~$4/month in Workbench operations. This is negligible against the value created.

---

## 18. Implementation Sequence

### 18.1 v1.0 Magical Core (6 days)

Strictly ordered so each step ends with a testable deliverable.

| # | Layer | Effort | Task |
|---|---|---|---|
| 1 | DB | 0.5 day | Migration: all tables + RLS + cost enum + realtime publications |
| 2 | Backend | 0.5 day | `pipeline/note_proactive_analysis.py` + cost tracking |
| 3 | Backend | 0.25 day | `pipeline/note_voice_transcription.py` wrapper around existing `transcribe-audio` |
| 4 | API | 0.5 day | Notes CRUD Edge Functions (create, list, get, patch, delete, supersede) |
| 5 | API | 0.25 day | Voice upload + transcription status Edge Functions |
| 6 | API | 0.25 day | Probes update + answer Edge Functions |
| 7 | API | 0.25 day | Contradictions resolve Edge Function |
| 8 | Frontend | 0.5 day | `CapturePillButton` + keyboard shortcut + layout integration — appears everywhere in a project |
| 9 | Frontend | 1 day | `CaptureDrawer` + `CaptureForm` + text capture flow end-to-end (save, optimistic UI, IndexedDB draft) |
| 10 | Frontend | 0.5 day | `CaptureVoiceMode` + wiring to existing voice infrastructure |
| 11 | Frontend | 0.75 day | `CaptureSuggestions` + `ClassificationPills` + `ProbeStack` + `ContradictionBanner` — all post-save AI UI |
| 12 | Frontend | 0.25 day | `CaptureTab` with recent captures + first-use onboarding overlay |
| 13 | Backend | 0.5 day | `pipeline/ask_kb_rag.py` + streaming infrastructure |
| 14 | API | 0.25 day | Ask-KB Edge Function (SSE streaming) + conversation list/create/capture-answer |
| 15 | Frontend | 1 day | `AskKbTab` + conversation + context panel + voice mode |
| 16 | Backend | 1 day | `pipeline/notes_sync_preview.py` + `notes_sync_apply.py` + `kb_diff.py` |
| 17 | API | 0.5 day | Sync Edge Functions (preview, apply, jobs, rollback) |
| 18 | Frontend | 1 day | `SyncPreviewModal` + all four tabs + apply flow + real-time progress + rollback |
| 19 | Integration testing | 0.5 day | End-to-end test on a real project (Atikon) — create notes, sync, verify KB updates |
| **Total** | | **~9 days** | |

*The v2 estimate was 6 days. With full-stack detail, realistic effort is closer to 9. This is the truthful number; budget accordingly.*

### 18.2 v1.1 Stream (2 days)

Note Stream page with filters, search, per-note detail.

### 18.3 v1.2 Readiness (1.5 days)

Dimensional scoring dashboard. Heavy reuse of existing `completeness-radar.tsx`.

### 18.4 v1.3 Explorer (3 days)

KB Explorer. Heavy reuse of existing `feature-map.tsx`, `data-model-view.tsx`, `cross-references.tsx`. New: Rules table, Workflows diagram.

### 18.5 v1.4 Cross-Linking (1 day)

Bidirectional link plumbing everywhere.

### 18.6 v2.0 CodeMantis Loop (3 days)

Inbox for clarifications, answer flow, regeneration trigger. Requires Guides v3 §9.4 `clarification_requests` table to exist.

### 18.7 v2.1 Polish (3 days)

Entity graph (deferred from v1.3), KB diff viewer, note templates, email intake.

**Cumulative total for full vision:** ~22.5 days.
**v1.0 is the commitment.** Everything else is iterative improvement.

---

## 19. Files Inventory

### 19.1 Database

- `supabase/migrations/2026NNNN_knowledge_workbench.sql`

### 19.2 Backend Pipeline

- `fly-containers/specforge-worker/src/pipeline/note_proactive_analysis.py`
- `fly-containers/specforge-worker/src/pipeline/note_voice_transcription.py`
- `fly-containers/specforge-worker/src/pipeline/ask_kb_rag.py`
- `fly-containers/specforge-worker/src/pipeline/notes_sync_preview.py`
- `fly-containers/specforge-worker/src/pipeline/notes_sync_apply.py`
- `fly-containers/specforge-worker/src/pipeline/kb_diff.py`
- `fly-containers/specforge-worker/src/pipeline/note_orchestration.py`
- `fly-containers/specforge-worker/src/pipeline/test_note_proactive_analysis.py`
- `fly-containers/specforge-worker/src/pipeline/test_ask_kb_rag.py`
- `fly-containers/specforge-worker/src/pipeline/test_notes_sync_preview.py`
- `fly-containers/specforge-worker/src/pipeline/test_notes_sync_apply.py`
- `fly-containers/specforge-worker/src/pipeline/test_kb_diff.py`

### 19.3 Supabase Edge Functions

- `supabase/functions/notes/index.ts` (CRUD)
- `supabase/functions/notes-voice-upload/index.ts`
- `supabase/functions/note-probes/index.ts`
- `supabase/functions/note-contradictions/index.ts`
- `supabase/functions/ask-kb/index.ts`
- `supabase/functions/sync-preview/index.ts`
- `supabase/functions/sync-apply/index.ts`
- `supabase/functions/sync-jobs/index.ts`
- `supabase/functions/sync-rollback/index.ts`
- `supabase/functions/kb-versions/index.ts`

### 19.4 Frontend Pages

- `src/pages/project/workbench.tsx`

### 19.5 Frontend Components (v1.0)

All under `src/components/workbench/`:
- `WorkbenchShell.tsx`
- `StatusBar.tsx`
- `TabNav.tsx`
- `WorkbenchEmptyState.tsx`
- `CapturePillButton.tsx`
- `CaptureDrawer.tsx`
- `CaptureForm.tsx`
- `CaptureVoiceMode.tsx`
- `CaptureSuggestions.tsx`
- `ClassificationPills.tsx`
- `ProbeStack.tsx`
- `ContradictionBanner.tsx`
- `SourceExtractor.tsx`
- `CaptureTab.tsx`
- `RecentCaptureList.tsx`
- `RecentCaptureCard.tsx`
- `AskKbTab.tsx`
- `AskKbConversation.tsx`
- `AskKbContextPanel.tsx`
- `AskKbMessage.tsx`
- `AskKbSourceChip.tsx`
- `AskKbInput.tsx`
- `AskKbVoiceMode.tsx`
- `AskKbHistoryList.tsx`
- `SyncPreviewModal.tsx`
- `SyncOverviewTab.tsx`
- `SyncKbChangesTab.tsx`
- `SyncDocumentImpactTab.tsx`
- `SyncBlockersTab.tsx`
- `SyncProgressView.tsx`
- `SyncSuccessView.tsx`
- `KbDiffView.tsx`
- `NoteDetailDrawer.tsx`
- `NoteEditor.tsx`
- `NoteInfluencePanel.tsx`
- `NoteTimelineView.tsx`

### 19.6 Frontend Hooks (v1.0)

Under `src/hooks/`:
- `useNotes.ts`
- `useNote.ts`
- `useCreateNote.ts`
- `useUpdateNote.ts`
- `useSupersedeNote.ts`
- `useRetryNoteAnalysis.ts`
- `useVoiceUpload.ts`
- `useProbes.ts`
- `useUpdateProbe.ts`
- `useAnswerProbe.ts`
- `useContradictions.ts`
- `useResolveContradiction.ts`
- `useAskKbConversations.ts`
- `useAskKbConversation.ts`
- `useAskKbStream.ts`
- `useCaptureAskKbAnswer.ts`
- `useSyncPreview.ts`
- `useApplySync.ts`
- `useSyncJob.ts`
- `useRollbackKb.ts`
- `useKeyboardShortcuts.ts`

### 19.7 Files Modified

- `src/router.tsx` — add Workbench route + child routes
- `src/components/layouts/project-layout.tsx` — mount `CapturePillButton` + global `Cmd+N` handler
- The project sidebar navigation component — add "Workbench" menu item between Materials and Documents
- `supabase/functions/job-orchestrator/index.ts` — handle `note_proactive_analysis` and `notes_sync_apply` job types

### 19.8 New Dependency

`idb-keyval` for IndexedDB draft persistence. Add to `package.json` dependencies.

---

## 20. Success Metrics

Targets for a PM using SpecLoom for 3 weeks on a real project.

### 20.1 Adoption Metrics

1. **≥ 100 notes captured** (voice + text). Below 50 → zero-friction capture failed.
2. **≥ 30% of notes captured via voice.** Below 10% → voice UX failed.
3. **≥ 5 Ask-the-KB turns per working day.** Below 1 → interface is not being reached for.
4. **≥ 2 syncs per week.** Below 1/week → fear of sync or value not felt.

### 20.2 Quality Metrics

5. **≥ 60% of AI probes answered or dismissed-not-skipped.** Below 40% → probes are noise.
6. **≥ 80% of contradictions resolved within 24h.** Below 50% → contradiction UI is confusing.
7. **AI classification accepted as-is on ≥ 70% of notes.** Below 50% → classification is untrustworthy.

### 20.3 Impact Metrics

8. **Every note that was synced contributes to ≥ 1 KB field.** 100% target. Below 90% → sync is losing content.
9. **Readiness score moves from <60% to >85% over 3 weeks** (v1.2+).
10. **Zero "lost thought" reports** (notes saved but disappeared). 100% target.

### 20.4 Emotional Metric

11. **Post-use survey:** "SpecLoom feels like thinking with someone." ≥ 7/10 on a Likert scale.

Miss any three → the v3 design didn't deliver. Hit all → category-defining product.

---

## 21. Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Proactive AI feels intrusive or wrong → PMs stop capturing | Catastrophic | Ship probe_level setting (off/light/thorough); auto-downgrade on dismissal streak (§7.2.2) |
| Voice transcription poor on non-German/English | Medium | Whisper large-v3 is multilingual; allow explicit language override if needed |
| Sync is too slow → fear of apply | High | Dry-run caches 1hr; apply runs async with real-time progress; rollback available 24h |
| Contradiction detection false-positives | High | "Both correct" resolution teaches the AI per-project; silently reduce detection threshold after N wrong flags |
| Notes contradict existing KB content (not just other notes) | Medium | v1.1 adds KB-aware contradiction detection; v1.0 limited to note-vs-note |
| Ask-the-KB hallucinations | High | Force source citations; "no sources" = "I don't have enough information" (refuse-to-speculate) |
| IndexedDB draft loss on browser clear | Low | Show the draft age in the drawer; warn if draft is >24h old |
| Voice permission denied | Low | Graceful fallback to text; the mic icon remains visible but disabled |
| Mobile thumb reach on capture button | Medium | Position at bottom-center on mobile, not bottom-right |
| Clarification loop spam (v2.0) | Medium | Rate-limit per project_id (already handled in Guides v3 §17.9) |
| Large note volume (500+) causes sync context to exceed limits | Medium | Feature-area bucketing + summarization of oldest notes if needed |
| Scheduling cron cleanup never runs | Low | Cleanup job runs hourly; expired previews are harmless anyway (worst case: storage bloat) |
| KB diff viewer too complex to render for large KBs | Medium | Render only top 20 changes inline; "see all changes" loads a separate view |

---

## 22. Validation Checklist Before Shipping v1.0

Before declaring v1.0 shipped, all of the below must be verified:

**Capture**
- [ ] `Cmd+N` opens the capture drawer from every page in a project
- [ ] Typing and `Cmd+Enter` saves a note; note appears instantly (optimistic)
- [ ] `Esc` closes the drawer; re-opening preserves unsaved text (IndexedDB draft)
- [ ] Mic toggle enters voice mode; waveform animates; live transcript appears
- [ ] Stopping voice recording yields an editable transcript; Save creates the note
- [ ] Mic permission denial shows a graceful fallback (text still works)
- [ ] Network failure during save is retried silently; note is not lost

**Proactive AI**
- [ ] After save, classification pills appear within 5s (happy path)
- [ ] Classification pills are single-tap editable
- [ ] Probes appear with voice/type/skip actions
- [ ] "Not relevant" on 5 probes in a row reduces probe_level silently
- [ ] Contradictions show yellow banner with three resolution actions
- [ ] Contradiction resolution correctly supersedes one note or marks "both correct"

**Ask KB**
- [ ] Text questions stream responses with real-time token updates
- [ ] Sources appear in the context panel as they are cited
- [ ] Voice mode works end-to-end (voice in, voice out via TTS)
- [ ] "Capture as note" promotes an AI answer to a note with correct tags and refs
- [ ] Past conversations are listed; starred ones survive retention
- [ ] When the RAG has no relevant sources, the AI says so — it does not hallucinate

**Sync**
- [ ] Sync preview modal shows all four tabs (Overview / KB Changes / Document Impact / Blockers)
- [ ] Unresolved contradictions block Apply
- [ ] Apply triggers async job; progress displays in real-time via Supabase subscription
- [ ] On completion, new `kb_versions` row exists; `knowledge_bases` points to it
- [ ] Notes get `kb_incorporation` populated correctly
- [ ] Rollback works within 24h window

**UX polish**
- [ ] All five tabs work on desktop (≥1024px)
- [ ] Capture works on mobile (≤640px) with thumb-reachable pill
- [ ] Keyboard shortcuts work and don't conflict with existing ones
- [ ] Focus rings visible on all interactive elements
- [ ] Screen reader announces capture drawer, classification pills, probes
- [ ] All text meets 4.5:1 contrast on its background
- [ ] First-use onboarding appears on first visit; does not reappear
- [ ] Undo works for archive, supersede, sync (24h rollback)

**Integration**
- [ ] Notes flow through to generated documents on next regeneration
- [ ] AI Implementation Guides (if shipped) read notes as context
- [ ] Sync does not break existing QA Intelligence or document generation
- [ ] Cost telemetry is recorded for every operation listed in §17

**Honest caveat:** some of the interaction-feel items (animation timings, sound/haptic feedback, the exact feel of the capture drawer) won't be validated by a checklist — they'll be validated by 5 PMs using the tool for a week and reporting back. The validation sprint described in the Strategic Positioning doc is the real gate.

---

## 23. What This Spec Does NOT Cover

Deliberately out of scope so Claude Code doesn't guess:

- **Visual design of the capture drawer** (exact colors, exact shadow values). Uses existing SpecLoom design tokens; detailed visual design is a Figma deliverable if desired.
- **The Skill file for agents** (separate Guides v3 deliverable).
- **Mobile native apps.** Web only in v1.0; PWA install banner allowed but no native iOS/Android.
- **Multi-user collaboration on notes.** v3 roadmap topic (not this spec).
${N}`

*Special case — zero predicted changes:*

> Your notes don't change your KB. They may still be useful context — you can keep them as-is.
>
> `[ Cancel ]`

**Modal — KB Changes tab header:**

> **What will change in your Knowledge Base**

**Modal — Document Impact tab header:**

> **Documents affected**
>
> These documents will be marked as out-of-date. Regenerate them later to reflect the new KB.

Per-doc row: `${doc_title}` `v${N} → v${N+1}` `${major|minor}` `[ ☐ Regenerate after sync ]`

**Modal — Blockers tab header:**

> **Resolve before applying**
>
> `${N}` contradiction`${s}` need a decision.

Per-blocker row: `${description}` `[ Resolve ]`

**Modal bottom buttons (on all tabs):**

> `[ Cancel ]` `[ Apply sync → ]` *(Apply disabled if blockers remain)*

**Progress view (after Apply click):**

> **Applying sync…**
>
> Don't close this window — it's safe to switch tabs.
>
> `✓ Loaded existing KB (v${N})`
> `✓ Grouped ${N} notes by feature area`
> `⟳ Merging into ${feature_name} (${i}/${total})`
> `   Extracting rules…`
> `⏗ Merging into ${next_feature} (pending)`
> `⏗ Extracting structured business rules (pending)`
> `⏗ Saving KB v${N+1} (pending)`

*Step-failure state* (replaces `⟳` with `⚠` on the failed step):

> `⚠ ${step_name} failed. ${reason}` `[ Retry ]`

**Success view:**

> **Sync complete**
>
> `✓ KB is now at v${N+1} (from v${N})`
> `✓ ${N} note${s} incorporated`
> `⚠ ${N} document${s} are now out of date`
>
> `[ View KB changes ]` `[ Regenerate documents ]` `[ Done ]`

**Rollback prompt** (opened from KB version history within 24h):

> Roll back to KB v`${N}`? This will undo the last sync. Notes will return to pending status.
>
> `[ Cancel ]` `[ Roll back ]` *(destructive)*

**Post-rollback toast:**

> `Rolled back to KB v${N}. Your notes are pending again.`

### 24.9 Accessibility Strings (aria-labels)

Every icon-only interactive element needs a readable accessible name.

| Element | aria-label |
|---|---|
| Capture pill-button | `Capture a note. Cmd+N shortcut available.` |
| Mic toggle (idle) | `Toggle voice input` |
| Mic toggle (recording) | `Stop recording` |
| Mic disabled (no permission) | `Voice input unavailable — enable microphone in browser settings` |
| Classification pill | `Classified as ${type}. Activate to edit.` |
| Feature area pill | `Tagged ${feature_area}. Activate to edit.` |
| Probe skip | `Skip this follow-up question` |
| Probe "not relevant" | `Mark this follow-up as not relevant, don't ask similar` |
| Contradiction dismiss | `Defer contradiction, resolve later` |
| Sync status bar button | `Open sync preview for ${N} pending notes` |
| Ask KB mic | `Speak your question` |
| Ask KB send | `Send question` |
| Ask KB source chip | `Open source: ${source_name}` |
| Tab navigation | `Workbench tab: ${tab_name}` |
| Note detail drawer close | `Close note details` |
| Sync modal close | `Close sync preview` |

**Waveform during recording:**

- aria-label: `Recording in progress`
- aria-live: `polite`
- Updates every 5 seconds with: `Recording for ${N} seconds`

---

## 25. Content: AI Prompts

This section contains the complete text of every AI prompt the Workbench pipeline issues. Each prompt includes: the system prompt, the user prompt template with variable placeholders, the expected output schema, and the parsing contract. Claude Code implements these verbatim — do not paraphrase, do not "improve" prompt wording without validating against the success metrics.

### 25.1 Prompt Engineering Principles

Principles that apply to all Workbench prompts. These keep behavior consistent and quality predictable across prompt revisions.

1. **Structure everything as a contract.** Every prompt says what the AI does, what it receives, what it must return, what it must not do. Leave no room for interpretation.
2. **Use JSON output when any downstream code parses it.** Ask for `response_format: json_object` (or the provider-specific equivalent) and a specific schema. Never ask for "return X, Y, Z as a list."
3. **Give failure paths.** Every prompt explicitly tells the AI what to do if it can't complete (return a specific error shape, not a hallucinated answer).
4. **Bound the output.** Specify max counts (e.g., "1-3 probes"), max lengths (e.g., "≤ 150 chars per probe"). Non-reasoning models wander without bounds.
5. **Separate context from instructions.** Use labeled sections (`### Context`, `### Task`, `### Output format`). Never mix.
6. **Include worked examples when behavior is subtle.** One example is worth 100 words of instructions — especially for classification and contradiction detection.
7. **Don't over-specify persona.** One sentence of role is enough. Adding "you are friendly and thoughtful" costs tokens without improving output.
8. **Fail explicitly, not silently.** If the model would return an empty array, have it say so with a reason. Makes debugging easier.

### 25.2 Shared Project Context Block

Several prompts need project-level context. Build once per call, inject into every prompt that needs it.

**Python builder signature:**

```python
def build_project_context_block(project_id: str, kb_version: int | None = None) -> str:
    """Build a compact project context block for prompts.

    Pulls from:
      - projects.onboarding_context (organization, application, tech stack)
      - knowledge_bases.kb_content at the given version (or latest):
          feature_map (names + one-line descriptions)
          entities (names only, no fields)

    Returns a string, target ≤ 800 tokens. If KB doesn't exist yet,
    returns onboarding context only, with a note that KB is not yet synthesized.
    """
```

**Example output (Atikon Kickstarter App, KB v38):**

```
### Project: Atikon Kickstarter App
Domain: Austrian web agency, SME, primarily serving Steuerberater / Rechtsanwälte / Ärzte in DACH.
Application type: web_app, React + FastAPI + Postgres, multi-tenant, in_development.
Compliance: GDPR. Languages: German (current), multi-language planned for Customer Portal.
External systems: Intranet (legacy CRM), Cognitor (headless CMS), Internal KeyCloak, Customer KeyCloak, GitLab, Agentic AI Framework.

### Feature map (KB v38, top 20 by note count)
- Steuer-News Edition Management — Create, edit, QC, dispatch monthly tax-news editions across multiple formats.
- Customer Portal Review — Customer-side self-service and project status visibility.
- SEO Management — AI-assisted SEO target extraction per project.
- Content Orchestration — Manage and deploy content across Dev/Test/Prod environments.
- Workflow & AI Automation Configuration — Define and manage AI-driven workflows per project.
- … (truncated if >20)

### Known entities
Project, Website, Customer, Edition, Article, Info-Liste, Customer User, Atikon User, Phase, Workflow, Notification, Audit Log
```

Token budget: ≤ 800. Truncate feature list to top-20 (sorted by note count descending) if the full list would exceed budget.

### 25.3 `note_proactive_analysis`

**Purpose.** Single AI call on every note save. Classifies the note, suggests a feature area, extracts references mentioned in the body, generates 0-3 follow-up probes, and detects contradictions with recent notes.

**Model.** `grok-4.20-non-reasoning-latest` (standard and premium); `gemini-3-flash-preview` (economy, also fallback on Grok timeout).

**Budget.** ~$0.001 per call. Timeout: 30 seconds. On timeout, note save is unaffected — a retry is scheduled after 30 seconds; after one failed retry we give up silently.

**System prompt:**

```
You are a product manager's co-author. A PM just captured a thought about their software project. Your job is to: (1) classify what kind of thought it is, (2) suggest which part of the application it relates to, (3) extract any references to videos, documents, or other notes mentioned in the text, (4) generate 0-3 follow-up questions that would meaningfully sharpen the spec, (5) flag any obvious contradictions with the PM's recent notes.

You are not the PM. You do not decide what is correct. You suggest; the PM accepts or overrides. Never phrase your output as a command.

Return a single JSON object matching the schema below. No prose outside the JSON.
```

**User prompt template:**

```
### Project context
{project_context_block}

### The note (just captured)
Body: """
{note_body}
"""
Captured via: {capture_mode}   # "text" or "voice_transcribed"
Captured at: {timestamp_iso}

### Recent notes (last 20, most recent first — used for contradiction detection)
{recent_notes_block}
# Format per note:
# N-{code} ({status}) [{type}] [{feature_areas}] — {body_first_200_chars}

### Your task

Return a JSON object with exactly these fields:

{
  "classification": {
    "type": "business_rule" | "edge_case" | "clarification" | "domain_term" | "constraint" | "question_for_self" | "general",
    "type_confidence": <float 0.0 to 1.0>,
    "type_rationale": "<one sentence, max 120 chars, why you picked this type>",
    "feature_areas": [<zero or more feature names exactly from the feature map above>],
    "feature_areas_confidence": <float 0.0 to 1.0>
  },
  "references": [
    # Objects extracted from the note body. Include only high-confidence matches.
    # Recognized patterns:
    #   - "video N-NN" or "video X at MM:SS" → {"kind": "video", "id_hint": "...", "timestamp_seconds": N or null}
    #   - "doc X" or "the Y spec" or "section Z" → {"kind": "document", "id_hint": "...", "section_hint": "..."}
    #   - "N-NNN" → {"kind": "note", "id_hint": "N-NNN"}
    # If none, return [].
  ],
  "probes": [
    # 0 to 3 follow-up questions that would meaningfully sharpen the spec.
    # Each probe: a single question, max 150 chars, ends with a question mark.
    # ABSTAIN (return []) if:
    #   - the note is a domain_term definition (no probes needed)
    #   - the note is a question_for_self (don't probe a question with more questions)
    #   - the note is very short (< 20 words)
    #   - the note is comprehensive and leaves no obvious gap
    # Good probes: edge cases, error paths, unspecified roles, missing timeouts, missing state transitions.
    # Bad probes: things already answered in the note, generic "have you considered X", questions the PM would find annoying.
  ],
  "contradictions": [
    # 0 or more detected conflicts with recent notes.
    # ONLY include contradictions with confidence >= 0.75 — do not cry wolf.
    # Each object: {"with_note_code": "N-NNN", "description": "<=200 chars summary", "confidence": <float>}
    # Examples of real contradictions: role permissions differ, state transitions differ, field required vs optional.
    # NOT contradictions: elaboration of the same point, different aspects of the same feature.
  ]
}

### Critical constraints
- Return JSON only. No markdown fences, no prose.
- `type_confidence` reflects certainty about the type. If genuinely ambiguous between two valid types, pick the more conservative ("general") and set confidence 0.5-0.7.
- `feature_areas` must be empty or a subset of the feature map names from the project context. Do not invent features.
- If the PM captured via voice, expect colloquial phrasing — don't penalize for it. Focus on meaning.
- Length bounds are hard limits. Exceeding them will cause downstream truncation.
```

**Worked example (include in prompt as few-shot if model quality requires it; omit for Grok which generally doesn't need it):**

*Input note body:* "QC Reviewers can reject an edition. The edition goes back to in_edit state, not draft. Audit log records the rejector and reason."

*Expected output:*

```json
{
  "classification": {
    "type": "business_rule",
    "type_confidence": 0.92,
    "type_rationale": "Explicit rule about state transition and audit logging",
    "feature_areas": ["Steuer-News Edition Management"],
    "feature_areas_confidence": 0.88
  },
  "references": [],
  "probes": [
    "What happens if all QC Reviewers are unavailable — is there a timeout?",
    "Can the edition's original editor re-submit without changes, or must something actually be modified?"
  ],
  "contradictions": []
}
```

**Response size.** 300-600 tokens typical. Enforce with `max_tokens=900`.

**Parsing contract:**

```python
@dataclass
class ProactiveAnalysisResult:
    classification: Classification
    probes: list[str]
    references: list[ReferenceHint]  # unresolved id_hints
    contradictions: list[ContradictionHint]
    status: Literal["ok", "parse_failed", "partial"]
    raw_response: str  # kept for debugging if status != "ok"

def parse_proactive_analysis(
    raw_response: str,
    known_feature_names: set[str],
    recent_note_codes: set[str],
) -> ProactiveAnalysisResult:
    """Parse and validate the AI response.

    Handles:
      - Code fences stripped (```json ... ```)
      - Malformed JSON → status='parse_failed'
      - Valid JSON but missing required fields → fill defaults, status='partial'
      - Feature areas not in known_feature_names → filter out (don't allow invention)
      - References kept as hints for the resolver pass
      - Contradictions with with_note_code not in recent_note_codes → filter out
      - type_confidence outside [0,1] → clamp
      - Length bounds violated → truncate
    """
```

**Post-processing flow (after parse):**

1. Resolve `id_hint` on references to actual video/document/note IDs via fuzzy match against project artifacts. Drop any that can't resolve confidently.
2. Insert `note_probes` rows for each probe with `probe_index` matching order.
3. Insert `note_contradictions` rows for each surviving contradiction (both `note_a_id` and `note_b_id` set).
4. Update `quick_notes` fields: `note_type`, `note_type_confidence`, `note_type_ai_suggested=true`; same for `feature_areas`.
5. Update `quick_notes.ai_post_processing_status='done'`.
6. If `status != 'ok'`, schedule one retry after 30 seconds. If retry also fails, set status to `'failed'` and log.

### 25.4 `note_voice_cleanup`

**Purpose.** Clean up a raw Whisper transcript. Remove filler words, fix obvious mishearings, preserve meaning and voice.

**Model.** `gemini-2.0-flash-lite` (all tiers).

**Budget.** ~$0.0001 per call.

**System prompt:**

```
You clean up voice transcripts. You do not summarize, rephrase, or "improve" — you only remove disfluencies and obvious noise. You preserve the speaker's meaning and voice.
```

**User prompt template:**

```
Clean up this voice transcript. Remove filler words ("um", "uh", "like", "you know", "sort of"), fix obvious single-word mishearings where possible (common words only), and add sensible punctuation. Do NOT change vocabulary. Do NOT rephrase sentences. Do NOT add or remove content.

Language hint: {language_or_"auto"}

Transcript:
"""
{raw_transcript}
"""

Return only the cleaned transcript. No prose, no quotes, no markdown.
```

**Calibration example** (include in the system prompt if Flash-Lite output quality is insufficient):

*Input:* `"Um so like the Steuer-News editions uh they have this QC state and uh only the QC reviewers can you know reject them but like there's no timeout defined yet you know"`

*Output:* `"Steuer-News editions have a QC state, and only the QC reviewers can reject them. There's no timeout defined yet."`

**Response size.** Usually similar length to input. Enforce `max_tokens = 1.2 * input_tokens`.

**Parsing contract.** Plain text, no JSON. Strip leading/trailing whitespace. Sanity check: if output length < 30% of input length, treat as failure and fall back to raw transcript.

### 25.5 `ask_kb_rag`

**Purpose.** Streaming conversational answer grounded in retrieved project sources, with inline citations.

**Model.** `gemini-3.1-pro-preview` (standard); `claude-sonnet-4-6` (premium); `gemini-3-flash-preview` (economy).

**Budget.** ~$0.01 per turn (standard tier).

**Pre-prompt retrieval step:**

1. Generate embedding for the question using existing embedding infrastructure.
2. Retrieve top-20 chunks across: notes (body, tags, feature_areas), KB fields (feature descriptions, business rules, entities, workflows), video transcript chunks, document sections.
3. Rerank by relevance to top-8.
4. Pass the top-8 to the prompt as numbered sources `[S1]`…`[S8]`.

**System prompt:**

```
You answer questions about a specific software project. Answer strictly from the sources provided. If the sources don't contain enough information, say so and suggest what the user could capture to fill the gap.

You ALWAYS cite sources inline using the format [S1], [S2], etc., referring to the numbered source list in the user prompt. Every factual claim MUST have at least one citation. Claims without citations are invalid and will be discarded.

If a question asks for an opinion, a recommendation, or anything not grounded in the sources, respond: "I can tell you what's documented, but I can't speculate. Based on the sources: …" then continue with what IS documented.

Do not refer to "the sources" or "the documents" in prose — just cite. The citations speak for themselves.
```

**User prompt template:**

```
### Project context
{project_context_block}

### Sources (top 8 retrieved for this question)
[S1] {source_1_kind}: {source_1_identifier}
     {source_1_content_max_400_chars}

[S2] {source_2_kind}: {source_2_identifier}
     {source_2_content_max_400_chars}

… up to [S8]

### Conversation so far
{conversation_history_formatted}
# Alternating "User: …" / "You: …" lines. Omit this section if empty.

### User's question
{question}

### Your answer
Write a clear, concise answer using only the sources above. Cite inline with [S1], [S2], etc. Target length: 2-5 sentences unless the question demands more.

If none of the sources cover the question, respond exactly:
"I don't have anything documented about that yet. Want to capture a note with what you know, or ask something else?"
```

**Streaming contract.** Response streams via SSE. Client renders tokens as they arrive. After stream completion, the server extracts `[SN]` markers and attaches source metadata (kind, identifier, deep-link URL) to the message. The Context Panel renders cited sources as chips in order of first appearance.

**Post-stream parsing:**

```python
@dataclass
class AskKbAnswer:
    text: str                        # full answer with inline [S1]-style markers preserved
    cited_source_indices: list[int]  # deduplicated, in order of first appearance
    has_refusal: bool                # True if literal "I don't have anything documented" appears
    invalid_citations: list[int]     # citations the model produced that don't correspond to any provided source

def parse_ask_kb_response(full_text: str, sources: list[Source]) -> AskKbAnswer:
    """Extract citations from a completed answer. Invalid citations are stripped
    from the text before display; the raw text with invalid markers is kept only
    for the quality-monitoring pipeline."""
```

**Quality guards:**

- If response contains fewer than 1 citation per 2 sentences on average, set a `low_confidence: true` flag on the message. UI shows a subtle indicator; doesn't hide the answer.
- If response contains citations for source indices outside the provided range, filter them out and log the incident for prompt tuning. Do not surface hallucinated citations to the user.

### 25.6 `notes_sync_preview`

**Purpose.** Dry-run prediction of what the KB will change when pending notes are synced. Cheap, fast, no writes.

**Model.** `gemini-2.0-flash-lite` (economy and standard); `gemini-3-flash-preview` (premium).

**Budget.** ~$0.01 per preview.

**Precondition.** Do NOT run this prompt if there are unresolved contradictions among the pending notes. The UI jumps directly to the Blockers tab, saving tokens and frustration.

**System prompt:**

```
You predict what will change in a Knowledge Base when a set of notes is synced. You do NOT produce the new KB — you predict the shape of changes. Your output drives a preview UI, not an actual merge.
```

**User prompt template:**

```
### Project context
{project_context_block}

### Current Knowledge Base (structural summary only)
{kb_summary_block}
# Format:
#   - N features
#   - N entities, N relationships
#   - N business rules
#   - N workflows
#   - N open questions
# Do NOT embed full KB content — structural counts + feature names only.

### Pending notes to be synced ({N} total)
{notes_block}
# Format per note:
# N-{code} [{type}] [{feature_areas}] — {body_first_500_chars}

### Existing documents that may go stale
{documents_block}
# Format per doc:
# {doc_id} (v{N}) covers features [{feature_list}]

### Your task

Return a JSON object:

{
  "predicted_kb_changes": {
    "business_rules": {
      "added_count": <int>,
      "modified_count": <int>,
      "examples": [   // up to 3
        {"kind": "added", "description": "BR for <feature>: <one-line summary>"}
      ]
    },
    "features": {
      "modified_count": <int>,
      "examples": [
        {"kind": "modified", "feature_name": "<name>", "description": "description refined with <N> notes"}
      ]
    },
    "entities": {
      "added_count": <int>,
      "modified_count": <int>,
      "relationships_added": <int>,
      "examples": []
    },
    "workflows": {
      "added_count": <int>,
      "modified_count": <int>,
      "examples": []
    }
  },
  "predicted_document_impact": [
    {
      "doc_id": "<id>",
      "impact_level": "major" | "minor",
      "reason": "<one sentence why>"
    }
  ],
  "estimated_cost_usd": <float>,
  "estimated_duration_seconds": <int>
}

### Estimation heuristics
- Cost: $0.05 base + $0.01 per note + $0.02 per feature area touched
- Duration: 20s base + 5s per note + 10s per feature area touched
- Impact level: "major" if a feature's rules increase by >= 3 OR a new entity is added; otherwise "minor"
```

**Parsing contract:**

```python
def parse_sync_preview(
    raw_response: str,
    pending_notes: list[Note],
    known_doc_ids: set[str]
) -> SyncPreviewResult:
    """Parse, sanity-check, return a typed result.

    Validations:
      - Predicted change counts are non-negative integers
      - Document impacts reference known doc_ids (drop unknown)
      - Cost bounded: cost < $5, duration < 10 minutes; out-of-bounds → clamp and log
      - examples array length <= 3 per category (truncate excess)
    """
```

### 25.7 `notes_sync_apply` — Per-Feature-Area Merge

**Purpose.** Given current KB content for a feature area plus relevant notes, produce the updated KB content for that feature area. Run once per feature-area bucket.

**Model.** `grok-4.20-reasoning-latest` with `thinking_effort='low'` (standard and premium); `gemini-3-flash-preview` (economy).

**Budget.** ~$0.03-0.06 per merge. Largest cost in a sync.

**System prompt (the cardinal rules):**

```
You are updating a project's Knowledge Base for one feature area. A PM provided new notes containing business rules, edge cases, constraints, clarifications, and domain terms. Your job is to integrate these notes into the existing Knowledge Base content for this feature area and return the updated content.

Cardinal rules (violating any is a bug, not a style choice):

1. NOTES ARE AUTHORITATIVE. If a note contradicts existing KB content, the note wins. The PM provided the note; they mean it.

2. NO KNOWLEDGE MAY BE LOST. Every fact in the existing KB that is not explicitly overridden by a note must remain. If a note merely adds to existing content, merge — don't replace.

3. PRESERVE SOURCE ATTRIBUTION. Every business rule, entity, or relationship carries a `source_note_ids` array (may be empty for pre-existing). When you incorporate a note, APPEND its code to that array — never replace.

4. USE THE PROVIDED VOCABULARY. Feature names, entity names, role names must match exactly what's in the project vocabulary — don't introduce synonyms.

5. NO INVENTION. If a note implies a field or entity that isn't defined in the provided context, record it as an `open_question` rather than inventing the structure.

Return one JSON object representing the updated KB content for this feature area. No prose outside the JSON.
```

**User prompt template:**

```
### Project context
{project_context_block}

### Project vocabulary (exact names — use as-is)
Entities: {entity_names_list}
Roles: {role_names_list}
Existing business rule codes: BR-001 through BR-{last_br_code}

### Feature area being updated
Name: {feature_name}
Current description: "{feature_description}"

### Existing KB content for this feature area
{existing_content_block}
# Contains:
#   business_rules: [{id, trigger, condition, consequence, source_note_ids}, ...]
#   entities (where this feature area is involved)
#   workflows (where this feature area is involved)

### Notes to incorporate ({N} total)
{notes_block}
# Format:
# N-{code} [{type}] {body}
# References: {refs_list}

### Your task

Return a JSON object with this exact shape:

{
  "updated_feature_description": "<string or null if unchanged>",
  "business_rules_added": [
    {
      "id": "BR-<next available integer>",
      "feature_area": "{feature_name}",
      "trigger": "<string>",
      "condition": "<string>",
      "consequence": "<string>",
      "source_note_ids": ["<N-code>"],
      "confidence": <float 0-1>
    }
  ],
  "business_rules_modified": [
    {
      "id": "BR-<existing>",
      "changes": { "trigger"?: "...", "condition"?: "...", "consequence"?: "..." },  // only changed fields
      "source_note_ids": ["<N-code>"],   // notes that caused the modification, APPENDED to existing
      "rationale": "<one sentence>"
    }
  ],
  "entities_modified": [
    {
      "entity_name": "<existing entity name>",
      "added_fields": [ {"name": "...", "type": "...", "required": bool, "source_note_ids": [...]} ],
      "added_relationships": [ {"to": "<entity>", "kind": "has_many|belongs_to|has_one", "source_note_ids": [...]} ]
    }
  ],
  "workflows_modified": [
    {
      "workflow_name": "<existing>",
      "steps_added_or_modified": [...],
      "source_note_ids": [...]
    }
  ],
  "open_questions_added": [
    {
      "question": "<string>",
      "source_note_id": "<N-code that implied this gap>",
      "feature_area": "{feature_name}"
    }
  ],
  "notes_unused": [
    // N-codes of notes from the input that produced no changes.
    // Include rationale: "already documented in BR-XYZ" or "belongs to a different feature area"
    {"note_code": "N-NNN", "reason": "<string>"}
  ]
}

### Hard constraints
- New BR IDs must be sequential, starting from BR-{last_br_code + 1}.
- Every new BR must have source_note_ids with at least one entry.
- Every BR modification APPENDS to source_note_ids; do not replace.
- NEW entities are NOT handled here — only modifications to existing entities. New entities go through the global merge pass.
- If a note produces nothing useful (e.g., elaborates an existing rule without adding rule content), put it in notes_unused with a clear reason.
```

**Parsing and post-processing contract:**

```python
@dataclass
class PerFeatureMergeResult:
    feature_name: str
    updated_description: str | None
    rules_added: list[BusinessRule]
    rules_modified: list[BusinessRuleChange]
    entities_modified: list[EntityChange]
    workflows_modified: list[WorkflowChange]
    open_questions_added: list[OpenQuestion]
    notes_unused: list[UnusedNote]

def parse_merge_result(
    raw_response: str,
    existing_kb: dict,
    feature_name: str,
    next_br_id_start: int,
    valid_entity_names: set[str],
    input_note_codes: set[str],
) -> PerFeatureMergeResult:
    """Parse and STRICTLY validate.

    Validations (any failure aborts the sync with a specific error; do NOT silently drop data):
      - New BR IDs sequential from next_br_id_start
      - All source_note_ids reference notes in input_note_codes
      - Modified BR IDs exist in existing_kb.business_rules
      - Modified entities exist in valid_entity_names
      - No new entities proposed in entities_modified
      - All notes from input appear in exactly one of: rules_added, rules_modified, entities_modified, workflows_modified, open_questions_added, notes_unused

    Returns a MergeResult that downstream code applies to the KB snapshot atomically.
    """
```

### 25.8 `notes_sync_apply` — Global Merge

**Purpose.** Notes without `feature_areas` get merged into the global KB layer (executive_summary, system_context, glossary, cross-cutting workflows).

**Model.** Same as §25.7.

**Budget.** ~$0.03 per sync (runs once).

**System prompt.** Same cardinal rules as §25.7.

**User prompt template:**

```
### Project context
{project_context_block}

### Current global KB layer
Executive summary: {current_executive_summary}
System context: {current_system_context}   # JSON object
Glossary (domain terms): {current_glossary}   # array of {term, definition, source_note_ids}
Cross-cutting workflows: {current_cross_workflows}

### Untagged notes to incorporate ({N} total)
{notes_block}

### Your task

Return a JSON object:

{
  "executive_summary_updated": "<string or null if unchanged>",
  "system_context_changes": { ... only keys that changed or were added ... },
  "glossary_added": [ {"term": "...", "definition": "...", "source_note_ids": [...]} ],
  "glossary_modified": [ {"term": "...", "new_definition": "...", "source_note_ids": [...]} ],
  "cross_workflows_added_or_modified": [ ... ],
  "notes_unused": [
    {"note_code": "N-NNN", "reason": "<string>"}
  ]
}

Untagged notes that are really about a specific feature should go in notes_unused with rationale "likely belongs to feature X" (include the feature name). The PM can then re-tag and re-sync.
```

### 25.9 `notes_sync_rule_extraction`

**Purpose.** After per-feature merging, run a final pass over notes of type `business_rule`, `edge_case`, `constraint` to ensure every rule they describe is structurally captured. Redundant with §25.7 in the happy path, but catches rules that the feature merge missed.

**Model.** `gemini-3.1-pro-preview` (standard); `claude-sonnet-4-6` (premium); `gemini-3-flash-preview` (economy).

**Budget.** ~$0.02.

**System prompt:**

```
You review a set of business-rule-style notes and verify every rule they describe is captured as a structured business rule in the Knowledge Base. For any rule that is not captured, you produce a structured entry.
```

**User prompt template:**

```
### Project context
{project_context_block}

### Current business rules in KB ({N} total)
{current_business_rules_block}
# Each: BR-NNN [{feature_area}] trigger / condition / consequence / source_note_ids

### Notes to check ({N} total — types: business_rule, edge_case, constraint only)
{notes_block}

### Your task

For each note, determine: is its core rule already captured in the business rules list above?
  - If yes: do nothing (add the note code to notes_fully_captured).
  - If no: produce a structured BR entry in rules_missing.

Return JSON:

{
  "rules_missing": [
    {
      "id": "BR-<next available>",
      "feature_area": "<name or null if global>",
      "trigger": "<string>",
      "condition": "<string>",
      "consequence": "<string>",
      "source_note_id": "<N-code>",
      "confidence": <float>,
      "reason_missing": "<one sentence: why this wasn't captured in the feature merge>"
    }
  ],
  "notes_fully_captured": [<N-codes whose rules already exist in the KB>]
}

Use sequential BR IDs starting from BR-{last_br_code_after_feature_merges + 1}.
```

### 25.10 Response Parsing & Retry Contract (Shared)

**Retry policy** (identical for all Workbench AI calls):

| Failure mode | Retry policy | User-visible effect |
|---|---|---|
| Network timeout | 1 retry with 5s delay | Silent unless both attempts fail |
| Rate limit (429) | Exponential backoff, max 3 retries | Silent; pipeline waits |
| Invalid JSON | 1 retry with "respond in valid JSON only" reminder | Silent if retry succeeds; "AI didn't respond" icon if not |
| Content policy refusal | No retry | Log; treat as failure; for note analysis, note is saved without AI enrichment |
| Model unavailable | Fall back to economy tier's model | Silent |
| Schema validation failure after parse | 1 retry with "follow the schema exactly" reminder | Silent if retry succeeds |

**All retries tracked.** Each retry writes a separate `cost_events` row with `operation=<original>_retry`. Monitoring alerts fire if retry rate > 10% over a 1-hour window for any operation.

**Fallback ladder.** Standard fails → try economy model. Never auto-upgrade to premium without explicit tier configuration. If economy also fails, the operation fails and the user-visible degradation described in §7.6.2 kicks in (note saved without enrichment, ask-kb offline message, sync-apply retry button).

**JSON parse helper:**

```python
def robust_json_parse(raw: str) -> tuple[dict | None, str]:
    """Parse JSON from a model response. Handles:
      - Leading/trailing prose (strip to first { ... last })
      - Code fences (```json ... ```)
      - Single quotes around keys (some models)
      - Trailing commas
      - Common escape issues (\" vs “, newlines in strings)

    Returns (parsed_dict, error_reason). Either parsed_dict is None or error_reason is empty string.
    """
```

### 25.11 Cost & Latency Targets Per Prompt

Above target → alert is logged. Above alert threshold → admin banner surfaces in SpecLoom monitoring UI.

| Operation | Target cost | Alert cost | Target latency | Alert latency |
|---|---|---|---|---|
| note_proactive_analysis | $0.001 | $0.005 | 3s | 10s |
| note_voice_cleanup | $0.0001 | $0.001 | 1s | 5s |
| ask_kb_rag (per turn) | $0.01 | $0.05 | 5s first token / 20s complete | 30s |
| notes_sync_preview | $0.01 | $0.05 | 10s | 30s |
| notes_sync_apply (per feature area) | $0.05 | $0.20 | 30s | 120s |
| notes_sync_apply (global merge) | $0.03 | $0.15 | 20s | 90s |
| notes_sync_rule_extraction | $0.02 | $0.10 | 15s | 60s |

---

## 26. Concurrency, Race Conditions & Rate Limits

Every new surface the Workbench introduces needs explicit concurrency rules. Without these, the first real user who opens two tabs or saves two notes at once will find edge-case bugs.

### 26.1 Capture Save Concurrency

- `POST /notes` is idempotent via a client-generated `request_id` (uuid). The client attaches `X-Idempotency-Key: <request_id>` on every save. If the same key arrives twice (network retry), the second call returns the original `note_id` without side-effects.
- Multiple notes saved in parallel by the same user: no lock needed; each gets its own row. No ordering guarantees across concurrent saves.
- Client-side: the capture drawer disables the Save button for 500ms after a click to prevent accidental double-saves. Keyboard repeat (`Cmd+Enter Cmd+Enter`) also no-ops during this window.

### 26.2 Proactive Analysis

- Queued per note via `job-orchestrator`. Never blocks save.
- If the user edits a note while analysis is running for the prior version → the running analysis completes, but the result is discarded if stale (compare `analysis_started_at` to `note.updated_at`; discard if older).
- Worker concurrency: max 10 in-flight proactive analyses per project (prevents cost runaway on a rapid-fire capture burst). Additional analyses queue; the Notes UI shows "AI thinking…" for queued notes too.
- Global: max 100 in-flight across all projects on a single worker instance. Fly.io horizontal scaling handles beyond that.

### 26.3 Sync Concurrency

- **Only one sync job per project at a time.** Enforced by DB partial unique index:

  ```sql
  CREATE UNIQUE INDEX uniq_sync_jobs_running_per_project
    ON sync_jobs (project_id)
    WHERE status IN ('queued', 'running');
  ```

- Attempt to Apply while another sync is running → API returns HTTP 409 with body `{"error": "concurrent_sync", "running_job_id": "<id>"}`. UI displays: `Another sync is running. [Open it]`.
- `apply_notes_sync` wraps the KB write in a single transaction that: creates the new `kb_versions` row, updates the `knowledge_bases` pointer, updates `quick_notes.kb_incorporation` for all affected notes. If any step fails, the entire transaction rolls back.
- `SELECT ... FOR UPDATE` on the `knowledge_bases` row at the start of the transaction prevents races with manual-edit writes (which shouldn't happen anyway — KB is derivation-only — but belt and braces).

### 26.4 Ask-The-KB

- Rate-limited per project: 30 requests per minute.
- Server-side stream timeout: 120s for a complete response. Client terminates gracefully on server timeout; partial answer preserved with `truncated: true` flag.
- Conversation lock: while a stream is in progress for a given `conversation_id`, further `POST /ask-kb` calls to the same conversation return 409 until the first completes. Prevents interleaved responses.

### 26.5 Voice Uploads

- Max audio duration per upload: 5 minutes.
- Max file size: 15 MB.
- Per-user concurrent uploads: 2. Excess uploads queue client-side.
- Whisper transcription: 1 concurrent call per user (Whisper is cheap but serialization keeps UX predictable).

### 26.6 Clarification Requests (v2.0)

The `POST /clarifications` endpoint lives in Guides v3 (§17.9) but the rate limit applies project-wide: 60 requests per hour per `project_id`. Enforced via a sliding-window rate limiter keyed on project_id.

### 26.7 General API Rate Limits

| Endpoint class | Limit |
|---|---|
| All Workbench GET endpoints | 300 requests/minute per user |
| All Workbench write endpoints | 60 requests/minute per user |
| Bulk actions (archive/delete multiple notes) | 1 batch of up to 100 items per request; 10 batches/minute |
| Voice upload | 30 uploads/hour per user |
| Sync Preview | 10 previews/hour per project (preview is cached 1h, so realistic usage is well under) |
| Sync Apply | 20 applies/hour per project |

Rate limit headers returned on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### 26.8 IndexedDB Draft Reconciliation

When the capture drawer opens and a draft exists:

1. Compare the draft's `created_at` to the current server-side latest note's `created_at` for the same project.
2. If the draft is older than the latest note AND the note body prefix matches (first 80 chars) → the draft was already saved; discard the draft.
3. Otherwise → restore the draft.

This handles the case where a user saves on one device, then opens on another; the second device's stale draft doesn't resurrect content that was already committed.

### 26.9 Multi-Tab Behaviour

The Workbench may be open in multiple tabs simultaneously. Expected behaviour:

- Note created in tab A appears in tab B within 2 seconds (Realtime subscription on `quick_notes`).
- Sync started in tab A: tab B shows the running job banner (`Sync in progress by another tab [Open it]`), Preview button disabled in tab B.
- If tab A closes mid-sync, the job continues server-side; tab B sees it finish.
- Ask-KB conversations are per-tab locally but persisted server-side; reopening the conversation in tab B loads the same history.

---

## 27. Privacy, Security & Data Retention

### 27.1 Voice Audio Retention

- Voice blobs stored in Supabase Storage bucket `note-voice/` with path `{project_id}/{note_id}.webm`.
- Retention: **90 days** from upload.
- Deletion: hourly cron function `cleanup-voice-audio` deletes blobs older than 90 days.
- The transcript remains on the note indefinitely (transcripts are the user's content; audio is raw material).
- Users can explicitly request earlier deletion via the note detail drawer: `[Delete recording]` removes the blob immediately, keeps the transcript.

### 27.2 Note Content

- Notes are project-scoped via RLS (§9.2 policy).
- On project delete: `ON DELETE CASCADE` removes all notes, probes, contradictions.
- No automated PII scanning; notes may contain any content the PM provides. GDPR compliance inherited from the hosting platform (Supabase EU region for EU tenants).
- Notes are never shared across projects, tenants, or users without explicit export.

### 27.3 Ask-The-KB Conversation Logs

- Retained 90 days unless starred.
- Starred conversations retained indefinitely.
- Unstarred conversation cleanup handled by a weekly cron function `cleanup-askkb-conversations`.
- Embedded source content from videos/documents is kept as text excerpts in `conversations.messages`; these are not separately retained beyond the conversation's own retention.

### 27.4 KB Version History

- Retained indefinitely in v1.0.
- Each version is a full JSONB snapshot of the KB.
- Storage concern for very long-running projects: future optimization is a cold-tier move for versions > 1 year old, but not implemented in v1.0.
- Rollback is available for 24 hours via UI; beyond that, manual rollback requires a support request (the data is still there; just not the self-serve flow).

### 27.5 AI Model Provider Boundaries

- Requests to xAI, Google (Gemini), Anthropic go through existing provider abstractions in the worker container.
- Enterprise agreements with all three providers currently prohibit training on request/response data. If this changes, Workbench AI calls must be updated with provider-specific opt-outs.
- No customer data is logged outside Supabase; provider request/response bodies are stored only in ephemeral cost-tracking metadata (truncated to first 500 chars of response for debugging).

### 27.6 RLS Verification

Every new table in §9 has an explicit RLS policy. Checklist for pre-ship verification:

- [ ] `quick_notes` — project_id scoped via `quick_notes_project_access` policy
- [ ] `note_probes` — same
- [ ] `note_contradictions` — same
- [ ] `kb_versions` — same
- [ ] `sync_previews` — same
- [ ] `sync_jobs` — same
- [ ] Voice storage bucket — path-scoped via bucket policy (user can only access `{own_project_ids}/*`)
- [ ] No service-role bypass in any Edge Function except: cron cleanup, backfill migration, sync apply (which validates project ownership before using service-role for atomic transaction)

### 27.7 Audit Logging

- Every sync creates a `sync_jobs` row with `user_id` — permanent record of who synced what.
- Every contradiction resolution logs `resolved_by` (user_id) — permanent.
- Note archive/supersede/unarchive actions logged in a new `note_audit_events` table (simple: `{id, note_id, user_id, action, timestamp}`). Optional for v1.0; required if any user asks for audit capability.
- Note edits do NOT log revision history in v1.0 — explicit trade-off to keep the DB light. If needed, add a `note_revisions` table in v1.1 that copies the old body/classification on every PATCH.

### 27.8 Export Capability

Users can export their Workbench data via a new endpoint `GET /functions/v1/workbench/export?project_id=X&format=json|markdown`:

- `json`: complete dump of notes, probes, contradictions, ask-kb conversations, sync jobs, KB versions — suitable for GDPR data portability requests.
- `markdown`: human-readable Workbench summary — all notes grouped by feature area with headings.

Not in v1.0 implementation sequence — add as v1.1 task. But the data model supports it without changes.

### 27.9 Incident Response

If a data issue is discovered (e.g., a note cross-leaking between projects due to an RLS bug):

1. Rollback: revert the deploy causing the issue.
2. Scope: query affected rows (`SELECT id FROM quick_notes WHERE created_at > $leak_start AND project_id NOT IN (user's projects)`).
3. Remediate: delete leaked views, notify affected tenants via email.
4. Root cause: write postmortem, add regression test to §28.

Procedure is standard; nothing Workbench-specific. Documented here so CodeMantis SpecWriter knows to include "verify RLS enforcement" in the shipped guide's verification prompts.

---

## 28. Testing Plan

Tests at every level. Each category below describes what to test, not every individual test case — the exact test file names and assertions are implementation detail the guide generator can produce.

### 28.1 Backend Unit Tests (`pytest`)

**`pipeline/test_note_proactive_analysis.py`:**

- 20 synthetic notes covering all 7 types; assert classification correctness ≥ 17/20 (relaxed for ambiguous ones)
- Test probe generation: produces 0-3 probes per note; empty for domain_term and question_for_self
- Test contradiction detection with crafted conflicting pairs; high-precision (false positives < 10%)
- Test voice-captured notes: classification unaffected by colloquial phrasing
- Test timeout fallback to Flash model
- Test JSON parse failure → one retry → graceful failure
- Test feature_area invention prevention: unknown features filtered out of output

**`pipeline/test_note_voice_cleanup.py`:**

- German narration: filler words in German ("ähm", "halt", "also") removed
- English narration: filler words in English removed
- Mixed-language transcript: preserved (no language translation)
- Output shorter than 30% of input → fallback to raw

**`pipeline/test_ask_kb_rag.py`:**

- Retrieval pulls from all source kinds (notes, KB, videos, docs)
- Every claim in response has a citation (assert `\[S\d+\]` present per sentence on average)
- Refusal when sources don't cover the question (assert literal refusal string)
- Conversation history affects output (test with and without prior turns)
- Invalid citations (e.g., `[S99]` when only 8 sources) stripped from output

**`pipeline/test_notes_sync_preview.py`:**

- Zero pending notes → returns empty prediction structure without calling AI
- Only blockers pending → preview not run; API returns Blockers-only response
- Prediction counts non-negative; documents referenced exist
- Cost and duration within bounds

**`pipeline/test_notes_sync_apply.py`:**

- Feature-area merge: all pre-existing content preserved unless explicitly overridden
- Source_note_ids populated correctly (appended, never replaced)
- BR IDs sequential across merges within a single sync
- Invalid merge (e.g., references non-existent entity) aborts transaction; KB unchanged
- Global merge handles untagged notes correctly
- Rule extraction catches rules the feature merge missed
- notes_unused categorization accurate

**`pipeline/test_kb_diff.py`:**

- Structural diff detects added, removed, modified at every field level
- Nested diff within JSONB structures (e.g., `business_rules[7].consequence` changed)
- Very large KB (1 MB JSONB) diff completes in < 500ms
- Identity diff (KB unchanged) returns empty diff

### 28.2 Backend Integration Tests

Run against a test project (Atikon fixture), seeded database:

1. **End-to-end note capture** — POST /notes → proactive analysis → verify probes, contradictions, classification in DB → note visible in GET /notes list
2. **Voice upload to note** — POST /notes/voice-upload → Whisper transcription (mocked Whisper response) → cleanup → note saved with voice metadata
3. **Multiple notes → sync preview → sync apply** — capture 10 notes → preview shows correct counts → apply creates KB v+1 → each note's kb_incorporation populated
4. **Contradiction flow** — note A saved → contradicting note B saved → contradiction row created → resolve via API → one note superseded → DB reflects correctly
5. **Ask-the-KB over real data** — with seeded notes + KB, query returns answer citing the seeded sources; refusal works for off-topic queries
6. **Rollback** — apply sync (KB v38 → v39) → rollback within 24h → knowledge_bases points to v38 again → notes return to pending
7. **Concurrent sync** — start sync, start another → second returns 409
8. **RLS enforcement** — user A can't GET user B's notes (expect 404, not 403 — don't leak existence)

### 28.3 Frontend Unit Tests (`vitest` + `@testing-library/react`)

**`CaptureForm.test.tsx`:**

- Typing + Cmd+Enter triggers save mutation
- Esc closes drawer; reopen preserves unsaved text (IndexedDB mocked)
- Draft older than 24h is NOT restored
- Save button disabled for 500ms after click
- Offline save shows correct toast; retry succeeds when reconnected

**`CaptureVoiceMode.test.tsx`:**

- Mic permission denied → renders disabled mic icon with tooltip
- Valid recording → waveform renders; live transcript updates
- Stop button transitions to editable transcript state
- Too-short recording (<1s) shows correct toast

**`ClassificationPills.test.tsx`:**

- Pill displays AI-suggested type and feature area
- Click opens popover; select changes pill
- Low-confidence pill (type_confidence < 0.7) shows `?` indicator

**`ProbeStack.test.tsx`:**

- Probes render in order
- Skip dismisses probe; probe disappears; API call fires
- Not-relevant marks permanently dismissed
- Voice answer button opens voice mode with probe text as context
- Auto-collapse after 30s of inactivity

**`ContradictionBanner.test.tsx`:**

- Banner renders with other-note preview
- "Use this one" supersedes other note; toast shows with undo
- "Use ${other_code}" supersedes current note
- "Both correct" marks compatible
- Dismiss (X) defers without resolving
- Undo from toast reverts supersession

**`AskKbConversation.test.tsx`:**

- Sending text question triggers stream
- Tokens render as they arrive (mock SSE)
- Sources appear in context panel as cited
- "Capture as note" creates a note with cited sources as refs
- Refusal message renders when sources don't cover question

**`SyncPreviewModal.test.tsx`:**

- Tabs render; switch between them
- Apply disabled when blockers tab has items
- Apply enabled when blockers resolved
- Cancel closes modal
- Loading state while preview generates
- Error state with retry button when preview fails

**`SyncProgressView.test.tsx`:**

- Subscribes to Realtime channel
- Renders each step as `current_step` updates
- Failed step shows ⚠ with retry button
- Cancel button disabled after first write-step
- Success transitions to SyncSuccessView

### 28.4 Frontend Integration Tests

Using MSW (Mock Service Worker) to simulate the API:

1. First-visit flow: no notes → empty state renders → click `Try it now` → drawer opens with placeholder
2. Onboarding overlay sequence: beat 1 → 2 → 3 → drawer opens
3. Capture through save through AI suggestion through sync: full happy path
4. Capture drawer on mobile: bottom sheet layout renders; thumb-reachable
5. Keyboard-only navigation: can complete a full capture cycle without touching the mouse

### 28.5 UX Validation (Manual, Validation Sprint)

Conducted with 5 design-partner PMs over 1 week, with observation and post-session interview. Metrics:

- **Time from "I have an idea" to "saved"**: target ≤ 5 seconds (median)
- **Time from mic tap to "transcript ready to save"** for a 15-second note: target ≤ 7 seconds
- **Probe dismiss rate** (skipped + not-relevant / total shown): target ≤ 30%. Above = probes are noise, tune the prompt
- **Classification override rate**: target ≤ 40%. Above = classifier is wrong, tune the prompt
- **Sync confidence** (post-task interview 1-10): target ≥ 8 median
- **Voice transcription edit count**: target ≤ 2 edits per 30-second note on average
- **Accessibility**: complete a full capture cycle using keyboard only in ≤ 15 key presses
- **Emotional metric**: "SpecLoom feels like thinking with someone" on Likert 1-7: target ≥ 6 median

### 28.6 Load Tests

- **100 concurrent capture saves** with proactive analysis — all complete within 10s p95
- **Project with 500 pending notes** — sync preview < 30s; sync apply < 5 min
- **30 concurrent Ask-KB streams** per project — no degradation on any single stream
- **Voice upload storm**: 10 users uploading simultaneously — Whisper queue drains within 30s

Tools: `k6` (already in the SpecLoom engineering toolkit for existing load testing of the synthesis pipeline).

### 28.7 Smoke Tests (Post-Deploy)

Run automatically against staging and production after every deploy:

1. Health check endpoint returns 200
2. Create a test note via API → appears in database; proactive analysis completes within budget
3. Trigger sync preview on a fixture project → returns valid preview structure
4. Trigger sync apply → new KB version created; rolled back immediately (fixture safety)
5. Ask-KB with a fixture question → response includes citations
6. All Realtime subscriptions connect within 2 seconds
7. Voice upload endpoint accepts a 1-second test audio → returns transcription

Failing smoke tests block the deploy from being marked healthy; alerts fire.

---

## 29. Implementation Readiness Statement

This specification — v3.1 — is complete and handover-ready for any implementer, including automated code-generation via CodeMantis SpecWriter. Specifically:

- **Every database table is defined with full DDL, indexes, constraints, and RLS policies.** (§9)
- **Every pipeline stage has a signature, inputs, outputs, and AI model.** (§11, §16)
- **Every API endpoint has a request shape, response shape, and auth model.** (§12)
- **Every React component is named, located, and scoped.** (§13)
- **Every user-visible string is final copy, ready to ship.** (§24)
- **Every AI prompt is full text with output schema and parsing contract.** (§25)
- **Every concurrency edge case has an explicit rule.** (§26)
- **Every data-retention decision is stated with a duration and a cleanup job.** (§27)
- **Every layer has a testing plan with specific assertions.** (§28)

The only deliverables NOT contained in this spec, listed in §23, are: visual design polish (colors, shadows) which uses existing SpecLoom design tokens; the Skill file for AI agents (separate Guides v3 deliverable); and explicitly deferred features (mobile native, multi-user collab, third-party integrations, enterprise features).

A CodeMantis SpecWriter receiving this document should be able to produce a self-drive implementation guide covering all 19 sessions listed in §18.1 without needing external clarification. Any ambiguity surfaced during implementation should use the clarification loop in Guides v3 §11 to flow back to the PM rather than be guessed.
