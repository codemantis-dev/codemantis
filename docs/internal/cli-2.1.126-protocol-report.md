# Claude Code CLI v2.1.126 — Empirical Protocol Report

**Date captured:** 2026-05-01
**CLI version under test:** 2.1.126 (Claude Code), `/Users/hr/.local/bin/claude`
**Skill v1 baseline:** `.claude/skills/claude-cli-control-protocol/SKILL.md`, captured 2026-03-13 against v2.1.74
**Harness:** `src-tauri/tests/cli_protocol_capture.rs` (12 scenarios, run sequentially)
**Capture artefacts:** `src-tauri/tests/captures/S*.jsonl` (gitignored — regenerate with the harness)

This report records the verified wire-level behaviour of CLI 2.1.126 against
the assumptions baked into CodeMantis. Every claim is followed by a
`(SNN)` reference to the scenario whose capture proves it. Open the
matching `S<NN>-*.jsonl` file to read the raw NDJSON.

---

## TL;DR — the bug, root-caused

**Symptom 1** — toast reads `"2 writes blocked … AskUserQuestion, ExitPlanMode. Ask the agent to use Bash heredoc instead."`
**Symptom 2** — "Run Plan?" modal does not open after the agent calls `ExitPlanMode`.

**Verified root cause** (S06–S09):

In CLI 2.1.126 the tools `ExitPlanMode`, `EnterPlanMode`, and `AskUserQuestion` are special **interactive UI tools**. The CLI fires the host's `PreToolUse` hook for them (so the host can observe and log the call), reads the host's decision string into the synthetic `tool_result` it then injects, but it **always**:

1. Returns a synthetic `tool_result` with `is_error: true` and a UI-prompt-shaped `content` string (`"Exit plan mode?"`, `"Answer questions?"`).
2. Adds a corresponding entry to `result.permission_denials`, regardless of whether the host returned `allow`, `deny`, or `ask`.

`permission_denials` is no longer just the protected-path guardrail channel from 2.1.78. It is now a multi-purpose **"host should produce UI for these tools"** channel.

CodeMantis's `chat.ts:291–305` was written under the 2.1.78 assumption (denials = protected-path writes) and so labels every `permission_denials` entry as a "write blocked." That's symptom 1. Symptom 2 is independent and almost certainly **not** caused by the modal trigger never firing — the CLI still emits the `assistant`/`tool_use(ExitPlanMode)` block (S06–S08), so `message_router.rs` should still synthesise a `tool_use_start` event and `activity.ts:90` should fire `setShowPlanCompleteModal(true)`. The modal-not-opening symptom needs verification under `pnpm tauri dev`; it may be a React-side regression unrelated to CLI drift, or it may be that the toast firing first sets some modal-suppressing state. **Do not fix symptom 2 from this report alone — reproduce it live first.**

A second, separate finding from S10: **the protected-path guardrail does not fire in `bypassPermissions` mode (i.e. when CodeMantis launches with `--dangerously-skip-permissions`).** The agent writes freely to `.claude/skills/.../SKILL.md`. The memory note `project_cli_upgrade_v2186.md` ("`.claude/` writes silently denied even with `--dangerously-skip-permissions`") is **stale** for 2.1.126. This means the original `protected_path_deny` toast wording was already misleading by the time the CLI shipped 2.1.126 — it was describing a behaviour that no longer exists in this configuration.

---

## Verified delta vs skill v1 (2.1.74)

| Area | Skill v1 said | 2.1.126 says | Source |
|------|---------------|--------------|--------|
| Default model | "Opus 4.6 - Most capable for complex work" | "Opus 4.7 with 1M context · Most capable for complex work" | S01 |
| `opus[1m]` model | Listed as separate value `opus[1m]` with effort levels low/medium/high/max | **Removed.** `default` is now Opus 4.7 with 1M context built in | S01 |
| Default model effort levels | low, medium, high, max | low, medium, high, **xhigh**, max | S01 |
| Sonnet model | "Sonnet 4.6 - Best for everyday tasks" with `supportsAdaptiveThinking: true, supportsAutoMode: true` | "Sonnet 4.6 · Best for everyday tasks" — `supportsAutoMode` and `supportsFastMode` REMOVED, gained `xhigh` effort | S01 |
| `supportsFastMode` field | Documented on Default and `opus[1m]` | **Removed from all models** | S01 |
| `apiKeySource` (init) | Not mentioned | Present, value e.g. `"none"` | S06–S08 init |
| `apiProvider` (initialize.account) | Not mentioned | Present, e.g. `"firstParty"` | S01 |
| `agents[].model` | Not present | Present (`Explore: "haiku"`, `statusline-setup: "sonnet"`) | S01 |
| `result` event keys | subtype, duration_ms, session_id, result, total_cost_usd, is_error, usage, num_turns, duration_api_ms, stop_reason, terminal_reason, modelUsage, permission_denials | All of the above PLUS `api_error_status`, `fast_mode_state`, `uuid` | S06–S12 |
| Hook envelope (PreToolUse) | Skill did not document the hook contract | Confirmed: `hookSpecificOutput.{hookEventName, permissionDecision, permissionDecisionReason}` (camelCase). Decision values: `allow`, `deny`, `ask` (S06/07/08 prove all three are accepted; `ask` does **not** trigger an inbound control_request). | S06–S09 |
| `--include-hook-events` | Not mentioned | Adds `system` events with `subtype: "hook_started"` and `subtype: "hook_response"` to the stdout stream around every PreToolUse fire. Useful for the host to confirm the CLI saw the hook decision. | All scenarios |
| `tool_use_start` (frontend event) | Skill referred to it as a CLI event | It is a CodeMantis-synthesised frontend event, not a CLI event. The CLI emits `assistant.message.content[].tool_use` blocks and `stream_event/content_block_start` with `content_block.type: "tool_use"`. The router (`message_router.rs:227, 383`) translates these into `FrontendEvent::ToolUseStart`. | S06–S09 |
| `permission_denials` semantics | "Tool calls the CLI denied internally (e.g. writes to `.claude/`/`.git/`/`.vscode/`)" | **Multi-purpose channel** in 2.1.126: still includes protected-path-like denials from host-hook denies, AND now ALWAYS includes ExitPlanMode / EnterPlanMode / AskUserQuestion entries when those tools fire (regardless of host decision). The protected-path guardrail itself is **inactive in `bypassPermissions` mode** — see S10. | S06–S11 |
| `--permission-mode plan` at spawn | Not directly tested | **Silently overridden** by `--dangerously-skip-permissions`. `system/init.permissionMode` reports `"bypassPermissions"`. Use the runtime `set_permission_mode` control_request instead (works correctly — see S05/S06). | S06 (early run vs corrected run) |

## Confirmed-working control_request subtypes (2.1.126)

| Subtype | Status | Notes |
|---------|--------|-------|
| `initialize` | ✅ Works | Returns capability manifest. Payload shape changed — see Skill update §1. |
| `interrupt` | ✅ Works | Same semantics as v1: response success, generation halts, process stays alive, next user message restarts cleanly, post-interrupt `result` has `stop_reason: null`. |
| `set_model` | ✅ Works | Models in 2.1.126: `default`, `sonnet`, `sonnet[1m]`, `haiku`. `opus[1m]` no longer a separate value. |
| `set_permission_mode` | ✅ Works | **Accepts ANY mode value without validation, including `"invalidModeXYZ"` (S05).** No error response for unknown modes. |
| `set_max_thinking_tokens` | ✅ Works | |
| `stop_task` | ✅ Works | Returns error `"No task found with ID: ..."` for unknown IDs. |

## Subtypes that remain unsupported as outbound `control_request` (2.1.126)

All of these return `"Unsupported control request subtype: <name>"` (S02 sweep):

`compact`, `get_context`, `getContext`, `set_effort`, `setEffort`, `set_output_style`, `setOutputStyle`, `get_account_info`, `get_session_id`, `get_server_info`, `get_usage`, `get_cost`, `get_mcp_status`, `reconnect_mcp_server`, `toggle_mcp_server`, `add_mcp_server`, `remove_mcp_server`, `set_mcp_servers`.

**Newly-tested-and-still-unsupported:** `can_use_tool`, `tool_permission_request`, `request_permission`, `ask_user_question`. None of these subtypes are accepted as outbound control_requests — i.e. CodeMantis cannot proactively *ask* the CLI to ask the user about a tool. Permission flow is still hook-driven.

## Inbound `control_request` from CLI → host

**Not observed in any scenario.** S06/S07/S08 specifically tried to provoke an inbound `can_use_tool`-style request by responding to ExitPlanMode with `ask` — the CLI did not escalate. This contradicts the user's working theory in the bug report. As of 2.1.126, the CLI does not initiate control_requests; it communicates everything via the regular stream (`system` events, `permission_denials`, synthetic `tool_result` blocks).

## Per-scenario summary

### S01 — initialize
- `subtype: success` returned in 3.4 s. Full capability manifest captured.
- See "Verified delta" table for shape changes.

### S02 — subtype sweep (28 control_requests)
- 5 successes (initialize, interrupt, set_model, set_permission_mode, set_max_thinking_tokens), 1 expected error (`stop_task` unknown ID), 22 `Unsupported control request subtype` errors.
- Confirms the 2.1.74 supported-subtype set is unchanged in 2.1.126.

### S03 — interrupt mid-stream
- Works exactly as v1 documented. Process stayed alive. `result` event arrived with `stop_reason: null` after interrupt.

### S04 — set_model
- All three of `haiku`, `sonnet`, `default` accepted. Each emitted a `<local-command-stdout>Set model to ... (claude-...)</local-command-stdout>` user-visible event.

### S05 — set_permission_mode
- All seven values accepted, **including `invalidModeXYZ`** with `subtype: success`. No validation. Pitfall: typos are silent.

### S06 — ExitPlanMode with host hook returning `allow` ★
- `system/init.permissionMode = "plan"` (after runtime switch).
- PreToolUse hook fired with `tool_input: {plan: "..."}`. Host returned `allow`.
- CLI emitted assistant tool_use(ExitPlanMode) block AND emitted `system/hook_started` + `system/hook_response` events.
- CLI synthesised `tool_result(is_error=true, content="Exit plan mode?")`.
- `result.permission_denials = [{tool_name: "ExitPlanMode", tool_use_id, tool_input: {plan}}]`.
- Result `stop_reason: end_turn`, `terminal_reason: completed`, `is_error: false`.

### S07 — ExitPlanMode with host hook returning `deny`
- Same overall shape as S06. The `permissionDecisionReason` ("denied for harness S07") was preserved verbatim as the synthetic `tool_result.content`.

### S08 — ExitPlanMode with host hook returning `ask`
- Same overall shape as S06/S07. The reason ("escalating to user") again landed in the synthetic `tool_result.content`. **No inbound `control_request` observed** — the CLI does not escalate `ask` decisions through any side channel for ExitPlanMode.

### S09 — AskUserQuestion (no plan mode)
- `system/init.permissionMode = "bypassPermissions"` (no runtime switch).
- The model first called `ToolSearch` to look up the tool signature, then `AskUserQuestion`.
- For both, hook fired and host returned `allow`.
- `AskUserQuestion` produced the synthetic `tool_result(is_error=true, content="Answer questions?")` and an entry in `result.permission_denials`. Same channel as ExitPlanMode.
- The earlier `ToolSearch` was a **regular** tool: hook returned `allow`, real `tool_result` came back with the search results, no entry in `permission_denials`.

### S10 — Protected-path baseline write
- **Protected-path guardrail did not fire.** The agent wrote successfully to `.claude/skills/harness-test/SKILL.md` under a temp cwd. Tool result is_error: false. `permission_denials` empty.
- Implication: in `bypassPermissions` mode (the CodeMantis production configuration), there is no protected-path block on `.claude/`. The original `protected_path_deny` toast in `chat.ts` describes a behaviour that does not occur for CodeMantis users.

### S11 — Mixed denials in one turn
- First Write (`.claude/x.md`) — host returned `allow`, write succeeded, NOT in `permission_denials`.
- Second Write (`/tmp/cm-harness-S11-b.md`) — host returned `deny: "denied by harness S11 (target b)"`. tool_result `is_error: true content: "denied by harness S11 (target b)"`. Listed in `permission_denials` with `tool_input.{file_path, content}`.
- `permission_denials` correctly mixes only the genuinely-denied tool; allow-decisions never produce a denial entry.

### S12a — Slow hook (8 s)
- Hook delayed 8 s, returned `allow`. CLI tolerated the wait. Write succeeded. No effect on denial channel.

### S12b — Hook returns HTTP 500
- The bash approval-hook script's curl call fails. The script's fallback fires, returning `permissionDecision: "deny"` with `permissionDecisionReason: "CodeMantis approval server unavailable"`.
- CLI honours the deny: `tool_result(is_error=true, content="CodeMantis approval server unavailable")`, entry in `permission_denials`. Defensive behaviour is already correct.

### S14 — MCP tool under hook + `--dangerously-skip-permissions` ★ added 2026-06-16, CLI **2.1.178** ★

> **Version note:** S14 was captured against CLI **2.1.178**, not the 2.1.126 baseline of the rest
> of this report. Per CLAUDE.md, trust the capture. Everything below is a 2.1.178 observation.

**Motivation.** Field incident: `mcp__shared-browser-mcp__browser_navigate` was denied with the
CLI's *generic, reasonless* default (`"The user doesn't want to proceed with this tool use…"`) and the
user **never saw a CodeMantis approval prompt**. No CodeMantis hook path emits a reasonless deny, and
S07/S11/S12b prove the CLI relays hook reasons verbatim — so that deny did **not** originate in
CodeMantis's approval pipeline. S14 probes where it comes from with a hermetic stdio MCP stub
(`teststub`, one tool `echo` → `mcp__teststub__echo`) loaded via `--mcp-config --strict-mcp-config`.
The hook policy **allows** the MCP tool in both sub-runs, so any block must come from the CLI.

> **CORRECTION (clean re-run, same day):** an initial S14 run concluded there was a "native
> MCP-tool permission gate" because S14a (no allow-list) produced no tool call. That was an
> **artefact of rate-limiting** — that run had 6× `system/api_retry` and a `rate_limit_event` with
> `overageStatus: "rejected"`, `overageDisabledReason: "out_of_credits"`; the model never generated.
> A clean re-run (no retries) overturns it. The conclusions below are from the clean run.

**S14a — no `--allowedTools` (DECISIVE, clean run):**
- `system/init`: `permissionMode: "bypassPermissions"`, `mcp_servers: [{name:"teststub", status:"connected"}]`, `mcp__teststub__echo` present in `tools[]`.
- Model called `ToolSearch` then `mcp__teststub__echo`. **The PreToolUse hook FIRED for the MCP tool** (`hook_in`/`hook_out` = 2/2 — one per tool) and our stub returned `allow`.
- Real `tool_result` returned (`"echo: hello from S14"`), `result.subtype: success`, **`permission_denials: []`**.
- **Conclusion:** under `--dangerously-skip-permissions`, an MCP tool **already routes through the
  PreToolUse hook and runs WITHOUT any `--allowedTools` allow-list**. There is **no** separate native
  MCP gate blocking un-allow-listed MCP tools (at least for a stdio server via `--mcp-config`). In the
  real app, the hook forwards to the approval server, which would surface the modal for a non-auto-
  approved MCP tool — so MCP tools are approvable by default.

**S14b / S14c — `--allowedTools mcp__teststub__echo` (exact-tool) and `mcp__teststub` (whole-server):**
- Both: hook fired (1/1), tool ran, `result: success`, `permission_denials: []`. `--allowedTools` does
  **not** skip the hook, and the whole-server form `mcp__<server>` works the same as the exact form.
  But per S14a this allow-listing is **not required** for the tool to run.

**Implication for the field incident — root cause RE-OPENED.** Since un-allow-listed MCP tools route
through the hook fine in this hermetic stdio setup, the original symptom (an MCP tool denied with the
CLI's generic reasonless message, no modal) is **not** explained by an MCP permission gate, and the
speculative `--allowedTools` "fix" was **reverted** (it was unnecessary and its non-restricting
semantics were unverified). Leading remaining hypotheses, none yet reproduced:
- The user's server is **HTTP transport** (`shared-browser-mcp` at `127.0.0.1:8931`), not stdio —
  HTTP/SSE MCP permissioning may differ. (S14 only tested stdio.)
- The MCP server was **unhealthy/disconnected** at that moment (browser MCP servers drop).
- A **frontend modal-render miss** — but that would time out with reason `"Approval timed out"`, not
  the generic reasonless default, so this is unlikely on its own.

The diagnostics added in the same change (hook-script logging, the approval-server shown-prompt record,
and the `cli_denied_no_prompt` cross-check + "blocked by the CLI, not by you" toast) are the mechanism
to capture the real cause on the next occurrence — they stand regardless of this correction.

### S15 — MCP tool over HTTP (Streamable HTTP) transport ★ CLI 2.1.178 ★

Tests the leading hypothesis from S14: does HTTP-transport MCP (the real `shared-browser-mcp`) behave
differently from stdio? Minimal Node Streamable-HTTP MCP stub (`type: "http"`), production flags, **no
`--allowedTools`**.

- `system/init`: `mcp_servers: [{name:"httpstub", status:"connected"}]`, `mcp__httpstub__echo` in tools.
- Model called `mcp__httpstub__echo`; **hook fired (1/1)**; tool **ran** (`echo: hello from S15`);
  `permission_denials: []`, `result: success`. (`api_retries: 0` — clean.)
- **Conclusion:** HTTP transport behaves identically to stdio — MCP tools route through the hook and run
  without an allow-list. **HTTP is NOT the differentiator.** The field incident remains unreproduced.

### S16 — PreToolUse hook EXCEEDS the CLI `timeout` (fail-open discovery) ★ CLI 2.1.178 ★

Hook stub responds in 5s; CLI PreToolUse `timeout` set to 2s. Observe what the CLI does when it gives
up on a hook.

- Hook stub received the request (`hook_in=1`) but the CLI killed it at 2s before it replied (`out=0`).
- **The Write SUCCEEDED** (`tool_result: "File created successfully…"`, `permission_denials: []`,
  `result: success`). The CLI emitted a `hook_response` system event and **ran the tool anyway**.
- **Conclusion:** under `bypassPermissions`, the CLI **FAILS OPEN** on a PreToolUse hook timeout — it
  runs the tool, it does NOT inject a reasonless deny. So the timeout race does **not** explain the
  field incident's reasonless deny either — **but it exposes a real safety gap.**

**Safety gap + fix (shipped).** Production had three equal `300s` timers: the approval server's internal
decision timeout, the hook script's `curl --max-time`, and the CLI PreToolUse `timeout`. A never-answered
approval races all three at ≈300s; if the CLI hook timeout wins, the CLI fail-opens and **runs the tool
unapproved** instead of returning CodeMantis's intended deny. Fixed by strict ordering — server `300` <
curl `320` < CLI hook `360` — so the server's reasoned `deny("Approval timed out")` always reaches the
CLI before its fail-open deadline. `approval_server::DECISION_TIMEOUT_SECS` is now the single source of
truth; `process.rs` derives `HOOK_CURL_MAX_TIME_SECS` / `CLI_HOOK_TIMEOUT_SECS` from it and a test
(`hook_timeout_ordering_prevents_fail_open`) guards the invariant.

### Field incident: status after S14/S15/S16

Three structural hypotheses are now **ruled out** by clean captures: native MCP gate (S14a), HTTP
transport (S15), hook-timeout→reasonless-deny (S16, fails open). The exact trigger of the original
`mcp__shared-browser-mcp__browser_navigate` reasonless deny is **still unreproduced** and likely depends
on runtime state not recoverable from the screenshot (a non-`bypassPermissions` permission mode, MCP
server health, sub-agent context, or a host-side modal miss). The shipped diagnostics are the path to
catching it with full context next time. Untested next step: hook timeout under a NON-bypass permission
mode (`plan`/`default`) — the CLI may fail *closed* there.

> **★ RESOLVED 2026-06-28 (CLI 2.1.195) — see §S21.** It was never a permission gate. The reason-less
> "user doesn't want to proceed" was an **interrupt-cancelled** slow MCP tool. Diagnosed not by a new
> capture but by reading the CLI's OWN transcript (`~/.claude/projects/<proj>/<id>.jsonl`): hook fired +
> allowed, the `mcp-remote` browser-gateway tool hung ~2 min, the user sent a message, CodeMantis
> interrupted, and the CLI labels the cancelled tool `toolUseResult:"User rejected tool use"` +
> `[Request interrupted by user for tool use]`. None of the three remaining hypotheses applied
> (mode was `acceptEdits`/AutoAccept = auto-allow, no modal expected; not a sub-agent). Lesson: when a
> screenshot is ambiguous, the CLI transcript is the ground truth — go there first.

### S17 — manual `/compact` over stream-json ★ added 2026-06-21, CLI **2.1.185** ★

> **Version note:** captured against CLI **2.1.185**. Per CLAUDE.md, trust the capture.

**Motivation.** Field report: after `/compact`, the sidebar CONTEXT meter stayed pinned at its
pre-compaction value (e.g. `973K / 1M`) while the session was idle. Open question: does `/compact` over
`--input-format stream-json` actually shrink the next turn's context the way the interactive TUI does, or
does it only emit a summary while the working context stays full? No prior scenario exercised compaction.

**Method.** Two substantive turns to build history → `/compact` (sent as plain text, exactly as
CodeMantis does) → a tiny follow-up. Capture: `S17-compaction.jsonl`.

**Findings (decisive):**
- **`/compact` genuinely compacts in stream-json mode.** `compact_boundary.compact_metadata` reports
  `pre_tokens: 28258 → post_tokens: 3367`. Not a CLI regression.
- **NEW: `compact_metadata` now carries `post_tokens`** (and `duration_ms`, `preserved_segment`,
  `preserved_messages`), not just `pre_tokens` as the 2.1.126 fixture assumed. `post_tokens` is the
  **conversation-only** size; it excludes the fixed system-prompt + tool-definitions overhead (~15.6K in
  this capture — the per-turn `cache_read` floor). So the true next-turn window fill (T4 measured
  `input+cache_read+cache_creation+output ≈ 23.5K`) is larger than `post_tokens` alone.
- **Compaction status lifecycle is richer than we keyed on.** Observed sequence:
  `system/status:"requesting"` → `system/status:"compacting"` → `system/status:{status:null,
  compact_result:"success"}` → fresh `system/init` (re-init) → `system/subtype:"compact_boundary"` →
  a synthetic `user` message containing the summary (`"This session is being continued…"`) and
  `<local-command-stdout>Compacted </local-command-stdout>`. Our `handle_system_status` keys only on
  `status=="compacting"`, which still works; the new `compact_result` field is ignored (could be used to
  detect compaction *failure* in future).
- The `/compact` turn's own `result` reports `num_turns:0` and **zero** usage.

**Fix shipped (this change).** `handle_system_compact_boundary` now also extracts `post_tokens` and
threads it through `FrontendEvent::CompactComplete`. On `compact_complete` the host drops the meter to
`post_tokens` flagged **pending** (muted bar + "refreshes on next message" hint) instead of leaving the
stale value; the next `usage_update` clears pending and sets the true full-window fill. This is the
honest behaviour: `post_tokens` is a real CLI number (not fabricated), shown provisionally because it
undercounts the system/tool overhead. `store.markContextCompacted` + `ContextMeter`'s `pending` prop;
threshold toasts re-armed via `resetContextToastFired`. Verdict for the original report: **not a
CodeMantis regression and not a Claude Code break** — the meter was a snapshot of the last API call and
nothing reset it on compaction; the session was simply idle on the pre-compaction summarization read.

---

### S18 — `/compact` "doesn't compact" was host-side recall enrichment, NOT a CLI break ★ added 2026-06-26, CLI **2.1.186** ★

> **Version note:** captured against CLI **2.1.186** (one patch past S17's 2.1.185). Per CLAUDE.md, trust the capture.

**Field report.** In the real app, running `/compact` no longer compacted. Instead the model answered the
literal text `/compact` conversationally — emitting a handoff/"checkpoint" summary ("Go ahead with
`/compact` — I'm at a clean stopping point"). Re-running it just repeated the summary. The CONTEXT meter
sat at 92% (≈921K/1M). The initial hypothesis was a 2.1.186 CLI regression: that the CLI had stopped
intercepting plain-text `/compact` over stream-json.

**Method.** `s18_compaction_mechanism` (capture `S18-compaction-mechanism.jsonl`): build a small
compactable history, then probe three candidate triggers in one process, delimited by `probe_*` marker
events — (A) `/compact` as plain `user` text, (B) `compact` as a `control_request` subtype, (C) two-phase
`/compact` + a `"yes"` confirmation. The harness spawns the CLI exactly like production but sends a **bare**
`/compact`.

**Findings (decisive — they overturn the hypothesis):**
- **Plain-text `/compact` STILL genuinely compacts on 2.1.186.** Probe A: `system/status:"compacting"` →
  `{status:null, compact_result:"success"}` → fresh `system/init` → `compact_boundary` with
  `pre_tokens 25910 → post_tokens 2670`, `trigger:"manual"`. No model role-play at all. **Not a CLI
  regression.**
- **`compact` is still "Unsupported" as a `control_request` subtype** (Probe B:
  `"error":"Unsupported control request subtype: compact"`) — unchanged since 2.1.74. Compaction did not
  move onto the control channel.
- **A second back-to-back `/compact` returns `compact_result:"failed"`** (Probe C: two
  `{status:null, compact_result:"failed"}` status events, no `compact_boundary`) — i.e. "nothing left to
  compact." So `compact_result` is a real success/failure signal worth surfacing.

**Root cause (host-side).** The clean harness sends a **bare** `/compact`; the real app does not. With
`recall.enabled = true` (the user's setting) and `autoEnrichSources:["agent_prompts"]`, `send_message`
(`commands/session.rs`) routes every user prompt through `recall::enricher::enrich_if_enabled`, which
**prepends a context brief**. That turns the content from exactly `/compact` into `<brief>…/compact`, and
the CLI only intercepts a slash command when the message content **is exactly the command** — so the
enriched form reaches the model as plain text, which role-plays the "go ahead and compact" handoff. This
fully explains every symptom (model produces a real turn; consistent across attempts; only in the real app,
never in the harness). Mirrors the long-standing precedent that `/effort` typed as a user message is gated
in non-TTY mode (S13) — slash-command-over-stdin handling is exact and unforgiving of leading text.

**Fix shipped (this change).**
- **Slash commands bypass recall enrichment.** `send_message` now sends slash commands verbatim
  (`is_cli_slash_command` guard — `/<word>` with an ASCII-command-word first token, so file paths like
  `/Users/...` and natural-language mentions are still enriched). This restores `/compact`, `/cost`, etc.
- **Failed compactions are now visible.** `handle_system_status` extracts `compact_result` onto
  `FrontendEvent::CompactingStatus`; `chat.ts` surfaces a durable chat message + error toast when
  `compact_result !== "success"`, instead of silently clearing the spinner (Probe C's failure mode).

---

## Actionable bugs in CodeMantis (proven by the captures)

### B1 — `chat.ts:291–305` toast misclassifies UI-prompt denials as "writes blocked"
Source of truth: every entry in `result.permission_denials` triggers `FrontendEvent::ProtectedPathDeny` at `message_router.rs:425`, which `chat.ts:case "protected_path_deny"` then renders as `"… writes blocked by Claude CLI's protected-path guardrail … Ask the agent to use Bash heredoc instead."` regardless of `tool_name`.

In 2.1.126 (S06–S09, S11), `permission_denials` mixes:
- Real host denials from `Write`/`Edit` (legitimate "blocked write" — should keep current wording).
- ExitPlanMode / EnterPlanMode / AskUserQuestion synthetic UI-prompt denials (NOT writes — should be silent or produce a different toast).
- Future CLI-internal denials we haven't seen.

**Fix sketch** (still belongs to a follow-up PR — out of scope for this capture report):
- In `chat.ts`, partition `event.denials` by `tool_name` into three buckets: writes (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`), control/UI tools (`ExitPlanMode`, `EnterPlanMode`, `AskUserQuestion`), other.
- Suppress the toast entirely for the control/UI bucket — those tools are handled by their own modals (`PlanCompleteModal`, `QuestionModal`).
- Keep the protected-path wording only when the writes-bucket entries actually look like protected paths (e.g. `file_path` starts with `.claude/`, `.git/`, `.vscode/`). For other host-denied writes (S11), use a generic "Write blocked: <reason>" wording sourced from the `tool_result.content` if available.
- Update `chat.test.ts:506–567` accordingly with the buckets verified by S06/S07/S09/S11.

### B2 — `approval_server.rs:251–328` ExitPlanMode/EnterPlanMode auto-approve branch is half-effective
The host hook DOES fire for ExitPlanMode, so the SpecWriter rejection branch (lines 280–294) still works correctly. **However, the `HookResponse::allow()` returned for non-SpecWriter sessions has no effect on the CLI's decision** — the CLI denies ExitPlanMode regardless and uses the synthetic `tool_result` path.

This is not a bug per se (the allow response is harmless), but the `info!` log on line 327 ("auto-approved ExitPlanMode") is misleading — the CLI will still deny it. Add a comment explaining this, or change the log to "observed".

### B3 — Stale memory note `project_cli_upgrade_v2186.md`
Says `.claude/`/`.git/`/`.vscode/` writes are silently denied even with `--dangerously-skip-permissions`. **False in 2.1.126** (S10). Replace with `project_cli_upgrade_v21126.md` reflecting current truth.

### B4 — `--permission-mode plan` at spawn is silently overridden
`process.rs` does not currently pass `--permission-mode plan`, so this is not biting prod — but if anyone adds it later thinking it'll work alongside `--dangerously-skip-permissions`, it won't. Document in the skill and avoid in any future code.

### B5 — `set_permission_mode` accepts unknown modes silently
Pitfall — typos in the mode value are not surfaced. CodeMantis sends from a small enum of known values so this is not exploitable today, but worth documenting.

---

## What the bug report's hypothesis got right and wrong

> "CLI 2.1.123 [recently uses] inbound control_request (can_use_tool / tool_permission_request)"

**Wrong.** S02/S06/S08 prove that no inbound control_request is emitted by the CLI for permission decisions in 2.1.126. The mechanism is the regular stream + `permission_denials` array.

> "ExitPlanMode appears in permission_denials means the CLI considers it denied — so the assistant's ExitPlanMode call never reaches the activity handler."

**Half-wrong.** The CLI does denote ExitPlanMode as "denied" in `permission_denials`, BUT the CLI also still emits `assistant.message.content[].tool_use(ExitPlanMode)` blocks (S06–S08). Those blocks reach the message router and produce `FrontendEvent::ToolUseStart`. So `activity.ts:82–113` should still fire `setShowPlanCompleteModal(true)`. The "modal does not open" symptom must be reproduced live before further diagnosis — it is not explained by the capture data alone.

> "Hook now expects permissionDecision (camelCase) or a different envelope than HookResponse::allow() produces."

**Wrong.** S06 confirms `{hookSpecificOutput: {hookEventName, permissionDecision, permissionDecisionReason}}` (the exact production shape) is accepted. Camelcase is correct. No envelope drift.

> "ExitPlanMode is no longer routed via PreToolUse at all in 2.1.123."

**Wrong.** S06–S08 prove PreToolUse fires for ExitPlanMode, with `tool_input: {plan}`. The host *is* in the loop. The host's *decision* is just consistently overridden by a CLI-internal "this is a UI tool" rule.

---

### S19 — MCP grant via `--settings` `permissions.allow` ★ added 2026-06-28, CLI **2.1.195** ★

Tests whether a static MCP permission grant in the `--settings` blob is honored and, decisively,
whether a hook `deny` still overrides it. Three sub-captures (stdio stub via `--mcp-config`, **no**
`--allowedTools`), all `rate_limit_info.status:"allowed"`:

- **S19a-perm-wildcard** (`permissions.allow:["mcp__*"]`, hook=allow) → MCP tool **ran**, `permission_denials:[]`.
- **S19a-perm-server** (`permissions.allow:["mcp__teststub"]`, hook=allow) → **ran**, `[]`.
- **S19b-perm-deny-gates** (`permissions.allow:["mcp__teststub"]`, hook=**deny**) → tool **blocked**;
  `permission_denials` carries the entry and the host's reason ("S19 user denied the MCP tool") is
  propagated. **The hook still fires and its deny still wins over a static allow rule.**

**Conclusion:** a `permissions.allow` MCP grant is **safe** (preserves the deny gate) and **functional**,
but **unnecessary** on 2.1.195 — S14a/S19a show hook-allow already runs MCP tools. Not shipped to
production. The `mcp__*` wildcard is accepted.

### S20 — production-faithful MCP discovery (no `--strict-mcp-config`) ★ CLI 2.1.195 ★

Production does NOT pass `--mcp-config`/`--strict-mcp-config`; it auto-discovers servers. S20 writes a
project `.mcp.json` and passes neither flag (so the CLI also loaded the real user servers). All three
variants (bare / `enableAllProjectMcpServers:true` / `permissions.allow:["mcp__*"]`, hook=allow) **ran**
the stub tool, `permission_denials:[]`. Notable: under `--dangerously-skip-permissions`, discovered
project servers **auto-connect** (the stub was `connected`), and the **real `stable-browser-gateway`
showed `status:"pending"`** (slow `mcp-remote` proxy) — the readiness signal behind the hang in §S21.

### S21 — the field incident: an interrupt-cancelled MCP tool, mislabeled ★ RESOLVED, CLI 2.1.195 ★

Not a capture — **transcript forensics** on the real incident. Reported: "Claude says it's waiting for my
approval, but I get no prompt." Evidence from `~/.codemantis/approval-hook.log` +
`~/.claude/projects/-Users-hr-…/<id>.jsonl`:

| ts (UTC) | event |
|---|---|
| `01:23:41Z` | hook log: `browser_open_local` → **allow** (forward, curl_exit=0) |
| `01:23:41.106` | transcript: assistant `TOOL_USE browser_open_local` (same second — hook allowed THIS call) |
| `01:25:41.473` | transcript: `tool_result is_error=true`, `toolUseResult:"User rejected tool use"` |
| `01:25:41.474` | transcript: user text `[Request interrupted by user for tool use]` |
| `01:25:41.480` | transcript: a NEW user message (recall brief auto-injected) |

`permissionMode:"acceptEdits"` (AutoAccept → MCP auto-allowed, no modal by design). `isSidechain:false`
(not a sub-agent). The ~2-min gap = the slow `mcp-remote` gateway tool **hung**; the user sent a message;
CodeMantis **interrupted** the turn; the CLI labels the cancelled tool with its reason-less rejection
text, which the agent then narrated as "waiting for approval."

**Distinguishing signatures** (for any host): a CodeMantis hook deny ALWAYS carries a specific reason, so
the **reason-less** "user doesn't want to proceed" is never a host decision; an interrupt-cancel has **no
`permission_denials` entry** in `result` (unlike a CLI-side deny); `toolUseResult:"User rejected tool
use"` + `[Request interrupted by user for tool use]` are the markers.

**Fix (UI-side, shipped):** `src/lib/interrupt-detector.ts` classifies the artifact; tool_result becomes
`ActivityStatus:"interrupted"` (not a red error); `ActivityFeed` shows "Interrupted — … not a rejection;
no approval was needed"; `StuckActivityBanner` names the hung in-flight tool and states it is "not
waiting for your approval." No CLI/permission/spawn change.

---

## How to reproduce / re-run

```bash
cd src-tauri
# Full battery (~3 min):
cargo test --test cli_protocol_capture capture_full_battery -- --ignored --nocapture --test-threads=1
# Single scenario:
CM_HARNESS_ONLY=S06 cargo test --test cli_protocol_capture capture_single -- --ignored --nocapture
```

Re-running wipes prior `.jsonl` captures unless `CM_HARNESS_KEEP=1` is set.

To regenerate against a future CLI version, just `claude install` the new version and re-run; the harness binds to the `claude` on PATH.
