# Duo-Coding — developer notes

Duo-Coding pairs a **Primary** coding agent (sole writer) with a read-only
**Mentor** agent that reviews each turn and directs repairs, plus an **Analyst**
API-LLM that produces the dashboard. This note covers the architecture and how
to extend it. User-facing docs live in the guide (Chapter 21D).

## Where things live

| Concern | Location |
|---|---|
| Orchestration state machine | `src/stores/duoStore.ts` |
| Verdict parsing | `src/lib/duo-verdict.ts` |
| Injected prompts (review/repair/dialogue) | `src/lib/duo-prompts.ts` |
| Mid-turn drift classifier | `src/lib/duo-drift.ts` |
| Model/effort dropdown resolution | `src/lib/agent-model-options.ts` |
| UI (dashboard, modals, dialogue) | `src/components/duo/` |
| Settings tab | `src/components/modals/settings/DuoTab.tsx` |
| Analyst LLM + strict report schema | `src-tauri/src/duo/analyst.rs` |
| Snapshot event (`duo:snapshot`) | `src-tauri/src/duo/events.rs` |
| Persistence commands | `src-tauri/src/commands/duo.rs` |
| Tables (`duo_runs`/`duo_events`/`duo_analyst_snapshots`) | `migrations.rs` + `database.rs` |

## How it works

Both CLI sessions are **pinned** at `start()` (immune to UI tab switches). The
store observes each session's `turn_complete`, assembles the response +
`get_git_diff`, and injects a review into the Mentor. The Mentor's reply must end
with a fenced ` ```duo-verdict``` ` block (one re-ask, then graceful degrade).
Blocking verdicts open a bounded dialogue; non-convergence (round cap or repeated
concern) hits the Settings tie-break (default: pause). Injection reuses the
ordinary `send_message` path — the same a human uses. The Analyst runs after each
review (debounced) and streams a sanitized report back via `duo:snapshot`.

## Adding a new coding agent to Duo

Duo is agent-agnostic: it only uses the shared `AgentAdapter`/`AgentId` registry
(`src-tauri/src/agents/`). To make a new agent usable in a Duo pairing:

1. **Register the adapter** (the normal agent-integration work) so
   `create_session` / `send_message` / `turn_complete` work for it. Duo needs
   nothing beyond that for the **Primary** role.
2. **Read-only Mentor lock** — extend `setReadOnly()` in `duoStore.ts` with the
   new agent's read-only mechanism (cf. Claude `set_session_mode("plan")`,
   Codex `set_codex_policy({sandbox:"read-only"})`).
3. **Prompt vocabulary** — if the agent needs a clarifier (like Codex's), add a
   branch in `clarifier()` in `duo-prompts.ts`.
4. **Setup modal** — add it to the `AGENTS` list in `DuoSetupModal.tsx`. Models
   and effort levels come live from the capability cache via
   `agent-model-options.ts`; add a cold-start fallback list if the agent has one
   (mirror `CODEX_FALLBACK_MODELS` / `CLAUDE_FALLBACK_MODELS`).

This is the intended path to the project's strategic goal: a **cheap/OSS Primary
mentored by a prime model** — swap the Primary in the setup modal, keep a strong
Mentor, no orchestration changes required.

## Invariants / gotchas

- **Single writer.** The Mentor must stay read-only; it directs repairs, never
  edits. Don't add a Mentor write path.
- **Analyst never recomputes hard numbers.** Counts/series/cost are computed in
  `commands/duo.rs` and handed to the LLM as context; the LLM supplies judgment
  only. The report is sanitized in `analyst.rs::parse_and_sanitize` — the
  dashboard contract holds even on a malformed reply.
- **No `temperature`** on Analyst calls (reuses `summarizer::call_provider`).
- **No hardcoded model/effort lists** — resolve live from capabilities.
- **Restart recovery is read-only.** Two dead CLI sessions can't resume live;
  interrupted runs are reconciled to `paused` and shown read-only on boot.
