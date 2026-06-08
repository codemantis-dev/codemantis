---
name: Codex-cli-control-protocol
description: >
  Complete reference for the Codex CLI control protocol — the hidden JSON-based
  control channel over stdin/stdout that enables interrupt, live model switching,
  permission mode changes, capability discovery, and more. Plus the related PreToolUse
  hook contract, permission_denials semantics, and the known interaction pitfalls
  with --dangerously-skip-permissions. Use whenever working on CLI process management,
  session commands, the stream-json protocol, or any feature that interacts with the
  Codex subprocess.
  Auto-triggers on: control protocol, control_request, control_response, interrupt session,
  set_model, set_permission_mode, initialize handshake, stream-json protocol, stdin message,
  ClaudeProcess, process_manager, session command, stop generation, cancel generation,
  model switching, permission mode, capability discovery, file checkpointing, rewind_files,
  PreToolUse hook, permission_denials, ExitPlanMode, AskUserQuestion, EnterPlanMode.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Edit
  - Write
---

# Codex CLI Control Protocol — Complete Reference

> **Re-baselined:** 2026-05-01 against Codex CLI **v2.1.126**.
> Original baseline 2026-03-13 against v2.1.74 — see "Version History" for diffs.
> Captures and a per-scenario report live at `docs/internal/cli-2.1.126-protocol-report.md`
> (CodeMantis repo) — synthesised from `src-tauri/tests/cli_protocol_capture.rs`.

## Overview

When the Codex CLI runs in stream-json mode (`--input-format stream-json --output-format stream-json`), it accepts **three types of JSON messages** on stdin — not the two that the public docs mention:

| Type | Purpose | Documented? |
|------|---------|-------------|
| `user` | Send user messages to the conversation | Yes |
| `tool_result` | Respond to tool approval requests | Yes |
| `control_request` | **Control the CLI session** (interrupt, model switch, etc.) | No (SDK-internal) |

The CLI responds to control requests with `control_response` messages on stdout.

**As of 2.1.126 the CLI does NOT initiate inbound `control_request` messages.** All host-facing signals come either through the regular event stream (`system`, `assistant`, `tool_use`, etc.) or through the `permission_denials` array in the final `result` event. Verified by S02 (sweep of `can_use_tool` / `tool_permission_request` / `request_permission` / `ask_user_question` — all rejected as outbound subtypes) and by S06–S09 (no inbound control_request observed when the host returned `ask`).

---

## Wire Format

### Sending a control request (stdin)

```json
{
  "type": "control_request",
  "request_id": "req_<unique_id>",
  "request": {
    "subtype": "<command_name>",
    ...additional fields depending on subtype
  }
}
```

- `request_id`: any unique string. Used to match responses. Convention: `req_` prefix + UUID hex.
- All messages are NDJSON (newline-delimited JSON) — one JSON object per line, terminated with `\n`.

### Receiving a control response (stdout)

Success:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "req_<matching_id>",
    "response": { ...optional payload }
  }
}
```

Error:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "error",
    "request_id": "req_<matching_id>",
    "error": "Human-readable error message"
  }
}
```

Unsupported subtypes return: `"error": "Unsupported control request subtype: <name>"`

**IMPORTANT**: control responses are interleaved with regular stream events on stdout. Use `request_id` to correlate. The response may also be wrapped in a `stream_event` envelope: `{"type": "stream_event", "event": {actual control_response}}` — handle both shapes.

---

## Confirmed Working Subtypes (CLI v2.1.126)

Same set as v2.1.74 — no working subtypes have been added or removed.

### 1. `initialize` — Capability Discovery

Returns the full capability manifest: available models, slash commands, agents, account info, output styles, and the CLI's PID.

**Request:**
```json
{
  "type": "control_request",
  "request_id": "req_init",
  "request": { "subtype": "initialize" }
}
```

**Response payload (2.1.126 shape — fields that changed since 2.1.74 noted inline):**
```json
{
  "commands": [ /* per-CLI builtin slash commands + per-user skills, each with name/description/argumentHint, sometimes aliases */ ],
  "models": [
    {
      "value": "default",
      "displayName": "Default (recommended)",
      "description": "Opus 4.7 with 1M context · Most capable for complex work",
      "supportsEffort": true,
      "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],
      "supportsAdaptiveThinking": true,
      "supportsAutoMode": true
    },
    {
      "value": "sonnet",
      "displayName": "Sonnet",
      "description": "Sonnet 4.6 · Best for everyday tasks",
      "supportsEffort": true,
      "supportedEffortLevels": ["low", "medium", "high", "max"],
      "supportsAdaptiveThinking": true
    },
    {
      "value": "sonnet[1m]",
      "displayName": "Sonnet (1M context)",
      "description": "Sonnet 4.6 with 1M context · Billed as extra usage · $3/$15 per Mtok",
      "supportsEffort": true,
      "supportedEffortLevels": ["low", "medium", "high", "max"],
      "supportsAdaptiveThinking": true
    },
    {
      "value": "haiku",
      "displayName": "Haiku",
      "description": "Haiku 4.5 · Fastest for quick answers"
    }
  ],
  "agents": [
    { "name": "Explore",          "description": "...", "model": "haiku" },
    { "name": "general-purpose",  "description": "..." },
    { "name": "Plan",             "description": "..." },
    { "name": "statusline-setup", "description": "...", "model": "sonnet" }
  ],
  "account": {
    "email": "user@example.com",
    "organization": "...",
    "subscriptionType": "Codex Max",
    "apiProvider": "firstParty"
  },
  "output_style": "default",
  "available_output_styles": ["default", "Explanatory", "Learning"],
  "pid": 12345
}
```

**Changes from v2.1.74:**
- Default model description: "Opus 4.6" → "Opus 4.7 with 1M context".
- `opus[1m]` removed as a separate model entry — the 1M context is folded into `default`.
- New effort level `xhigh` between `high` and `max` for Default and Sonnet families. Haiku still has no effort field.
- `supportsFastMode` field removed from all models.
- Sonnet no longer reports `supportsAutoMode` (Default still does).
- `agents[].model` field added (Explore=haiku, statusline-setup=sonnet).
- `account.apiProvider` field added.

### 2. `interrupt` — Stop Current Generation

Gracefully cancels the current assistant turn mid-stream. Process stays alive, session continues.

```json
{
  "type": "control_request",
  "request_id": "req_abc123",
  "request": { "subtype": "interrupt" }
}
```

**Behaviour observed (S03, unchanged from v1):**
1. Immediate `control_response` with `subtype: "success"`.
2. Text delta streaming stops immediately.
3. A `result` event is emitted with `stop_reason: null` (interrupted, not completed).
4. Process remains alive.
5. New `user` messages can be sent immediately — session continues normally.
6. The next turn emits a fresh `system/init` event.

**Always prefer `control_request` interrupt over signals.** SIGINT/SIGTERM/SIGKILL all kill the process.

### 3. `set_model` — Live Model Switching

```json
{
  "type": "control_request",
  "request_id": "req_model",
  "request": { "subtype": "set_model", "model": "sonnet" }
}
```

**Valid `model` values (2.1.126):** `"default"`, `"sonnet"`, `"sonnet[1m]"`, `"haiku"`, or omit/null to reset to default.
**`opus[1m]` is no longer a valid value** (it was rolled into `default`). Sending it returns... not retested in this baseline; assume rejection or silent fallback.

**Behaviour:** success response, plus a `user` event injected with `<local-command-stdout>Set model to <name> (Codex-<id>)</local-command-stdout>`. All subsequent turns use the new model.

### 4. `set_permission_mode` — Live Permission Mode Switching

```json
{
  "type": "control_request",
  "request_id": "req_perm",
  "request": { "subtype": "set_permission_mode", "mode": "plan" }
}
```

**Valid `mode` values (per `Codex --help`):** `"acceptEdits"`, `"auto"`, `"bypassPermissions"`, `"default"`, `"dontAsk"`, `"plan"`.

**Pitfall confirmed in S05:** the CLI accepts ANY `mode` value with `subtype: success` — including invalid strings like `"invalidModeXYZ"`. Typos are silent. Validate on the host side before sending.

### 5. `set_max_thinking_tokens` — Thinking Budget Control

```json
{
  "type": "control_request",
  "request_id": "req_think",
  "request": { "subtype": "set_max_thinking_tokens", "max_thinking_tokens": 10000 }
}
```

### 6. `stop_task` — Stop Background Task

```json
{
  "type": "control_request",
  "request_id": "req_stop",
  "request": { "subtype": "stop_task", "task_id": "task_abc123" }
}
```

Returns `"No task found with ID: ..."` if the task doesn't exist (S02).

### 7. `rewind_files` — File Checkpointing

```json
{
  "type": "control_request",
  "request_id": "req_rewind",
  "request": { "subtype": "rewind_files", "user_message_id": "uuid-of-user-message" }
}
```

Without checkpointing enabled at spawn: `"File rewinding is not enabled."` Not exercised by the 2.1.126 capture battery (CodeMantis does not enable checkpointing).

---

## Not Supported in CLI v2.1.126

These return `"Unsupported control request subtype: <name>"`. Identical set to 2.1.74 — no progress upstream.

- `compact` — context compaction
- `set_effort` / `setEffort`
- `set_output_style` / `setOutputStyle`
- `get_context` / `getContext`
- `get_account_info` / `get_session_id` / `get_server_info`
- `get_usage` / `get_cost`
- `get_mcp_status` / `reconnect_mcp_server` / `toggle_mcp_server` / `add_mcp_server` / `remove_mcp_server` / `set_mcp_servers`
- `can_use_tool` / `tool_permission_request` / `request_permission` / `ask_user_question`  ← **newly tested in 2.1.126; still not accepted as outbound subtypes.** The CLI does not expose a host-initiated "ask the user" channel; permission flow remains hook-driven.

The CLI uses **snake_case** for subtypes. CamelCase variants are all unsupported.

---

## PreToolUse Hook Contract (verified against 2.1.126)

This is the channel CodeMantis (and any host) uses to gate tool calls. The CLI invokes a host-configured shell command per `PreToolUse` hook entry in `--settings`, pipes the tool-call JSON to its stdin, and reads the host's decision from its stdout.

### Settings JSON shape (passed via `--settings`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          { "type": "command", "command": "bash /path/to/hook.sh", "timeout": 300 }
        ]
      }
    ]
  }
}
```

### Hook input (CLI → host, on stdin)

```json
{
  "session_id": "<cli session uuid>",
  "cwd": "<absolute path>",
  "tool_name": "Write",
  "tool_input": { "file_path": "...", "content": "..." }
}
```

(CodeMantis injects `forge_session_id` from `CODEMANTIS_SESSION_ID` env var into this object before forwarding to its HTTP server — that field is not from the CLI.)

### Hook output (host → CLI, on stdout)

**Confirmed working shape (S06 ALLOW, S07 DENY, S08 ASK):**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow" | "deny" | "ask",
    "permissionDecisionReason": "optional free-text reason (string)"
  }
}
```

**All field names are camelCase.** `permissionDecisionReason` is propagated into the synthetic `tool_result.content` for tools where the CLI ignores the host decision (see "Special tools" below).

### Decision semantics

- `allow` — the CLI runs the tool and returns the real `tool_result`. Hook reason ignored.
- `deny` — the CLI does NOT run the tool. Returns synthetic `tool_result(is_error=true, content=<reason or default>)`. Adds entry to `result.permission_denials`.
- `ask` — the CLI does NOT escalate to the host via any side channel (S08 verified — no inbound control_request fired). The CLI treats `ask` like `deny` for the tool call, with the reason text propagated.

### `--include-hook-events`

When the host spawns the CLI with `--include-hook-events`, the stdout stream gains paired `system` events around every PreToolUse fire:

```json
{ "type": "system", "subtype": "hook_started", ... }
{ "type": "system", "subtype": "hook_response", ... }
```

Useful for diagnostics — gives a second view of whether the CLI saw the hook decision. Not required for production.

---

## Special tools — the `permission_denials` UI-prompt channel ★ NEW IN 2.1.126 ★

`ExitPlanMode`, `EnterPlanMode`, and `AskUserQuestion` are interactive UI tools. The CLI's behaviour for them is **fixed regardless of the host's hook decision**:

1. PreToolUse hook DOES fire — host can observe / log / reject for SpecWriter-style use cases.
2. CLI emits the standard assistant `tool_use` content block (so `tool_use_start`-style host events still fire).
3. CLI ALWAYS synthesises `tool_result(is_error=true, content=<UI prompt string>)`:
   - `ExitPlanMode` → `"Exit plan mode?"` (or the host's `permissionDecisionReason` if one was provided)
   - `AskUserQuestion` → `"Answer questions?"` (or the reason)
4. CLI ALWAYS adds an entry to `result.permission_denials`:

```json
{
  "tool_name": "ExitPlanMode",
  "tool_use_id": "toolu_...",
  "tool_input": { "plan": "<full markdown plan from agent>" }
}
```

The host is expected to use these `permission_denials` entries as **UI signals** — open the appropriate modal, capture the `tool_input` payload, and resolve the UX out-of-band.

### Implications for hosts

- A simple "if `permission_denials` non-empty, show 'writes blocked' toast" is **wrong** in 2.1.126 (this is exactly the CodeMantis bug captured in B1 of the report). Bucket by `tool_name`.
- The `tool_use_start`-style trigger for opening modals (e.g. CodeMantis's `activity.ts:90`) still works — the assistant tool_use block reaches the host. The denial entry is a **second** signal carrying the actual tool input payload.
- A host that wants to deny ExitPlanMode (e.g. for SpecWriter sessions) cannot fully prevent it via PreToolUse — the CLI's synthetic denial fires either way. Use the deny only to suppress the modal on the host side.

---

## `permission_denials` semantics (full)

`result.permission_denials` is now a multi-purpose channel:

| Source | Example tool | When it fires |
|--------|--------------|---------------|
| Host hook returned `deny` | `Write`, `Edit`, anything | Whenever your `PreToolUse` returns `deny` (or `ask`). The host's reason is propagated into `tool_result.content`. (S07, S11) |
| Special UI-prompt tools | `ExitPlanMode`, `EnterPlanMode`, `AskUserQuestion` | Always, regardless of host decision. (S06, S07, S08, S09) |
| CLI protected-path guardrail | `Write`, `Edit` to `.Codex/`, `.git/`, `.vscode/` | **NOT in `bypassPermissions` mode** (i.e. when `--dangerously-skip-permissions` is on). S10 verified the agent writes freely under those paths in this configuration. May still fire under `default` / `acceptEdits` / `plan` modes (not retested in 2.1.126). |
| Hook script unavailable | Anything | If the hook script returns its own deny on transport failure (CodeMantis's `approval-hook.sh` does this on curl failure → `"CodeMantis approval server unavailable"`), it lands here. (S12b) |

---

## Pitfall — `--dangerously-skip-permissions` overrides `--permission-mode <mode>` ★

Confirmed in S06 (initial run). Spawning with both `--dangerously-skip-permissions` AND `--permission-mode plan` results in `system/init.permissionMode = "bypassPermissions"`. The `--permission-mode` argument is silently ignored.

**Workaround:** use the runtime `set_permission_mode` control_request after spawn — it works correctly even with `--dangerously-skip-permissions` (S05 + S06 final run). This is the only way to enter plan mode in the CodeMantis configuration.

---

## Stream event reference (relevant subset, 2.1.126)

| Event type / subtype | When | Relevant fields |
|---------------------|------|-----------------|
| `system / init` | Session start | `permissionMode`, `tools[]`, `model`, `cwd`, `agents[]`, `slash_commands[]`, `apiKeySource`, `claude_code_version`, `fast_mode_state`, `uuid`, `session_id` |
| `system / status` | Periodic | Lightweight heartbeat |
| `system / hook_started` / `hook_response` | Around PreToolUse fires (with `--include-hook-events`) | Diagnostic |
| `stream_event / message_start` / `message_delta` / `message_stop` | Per assistant message | Anthropic-shaped |
| `stream_event / content_block_start` | Per content block in assistant message | When `content_block.type == "tool_use"`, fields: `name`, `id` |
| `stream_event / content_block_delta` | Per chunk | `delta.type == "text_delta"` (text), `"input_json_delta"` (tool input streaming), `"thinking_delta"` (thinking) |
| `stream_event / content_block_stop` | Per content block end | Index correlates back to start |
| `assistant` | Assembled assistant message | `message.content[]` with `text` / `tool_use` / `tool_result` / `thinking` blocks |
| `user` | Tool result / injected local-command output | `message.content[]` with `tool_result(tool_use_id, is_error, content)` |
| `result` | End of turn | `subtype`, `is_error`, `api_error_status`, `duration_ms`, `duration_api_ms`, `num_turns`, `result`, `stop_reason`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `terminal_reason`, `fast_mode_state`, `uuid` |
| `rate_limit_event` | When the API throttles / warns | Independent envelope |

`tool_use_start` is **NOT** a CLI event type — it is a CodeMantis frontend event synthesised by `message_router.rs` from `assistant` events and `stream_event/content_block_start` events.

---

## Existing Stdin Message Types (full)

### `user` — Send User Message
```json
{
  "type": "user",
  "message": { "role": "user", "content": "Your prompt text here" }
}
```

### `tool_result` — Respond to Tool Approval (legacy)
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "approved": true
}
```

(In CodeMantis's PreToolUse-hook approach this is not used — the hook script's stdout is the response channel. Kept here for completeness.)

### `control_request` — see "Wire Format" above

---

## Signal Behavior

| Signal | Effect | Graceful? | Session survives? |
|--------|--------|-----------|-------------------|
| `control_request` interrupt | Stops generation | Yes | Yes |
| `SIGINT` (Ctrl+C) | Kills process, exit code 0 | No | No (needs `--resume`) |
| `SIGKILL` | Kills process immediately | No | No |
| `SIGTERM` | Kills process | No | No |
| Escape byte (`\x1b`) on stdin | No effect in stream-json mode | N/A | N/A |
| Sending new `user` message during streaming | Queued, does not interrupt | N/A | Yes |

**Always prefer `control_request` interrupt over signals.**

---

## Integration Notes for CodeMantis (current state, 2026-05-01)

Production spawn flags (`src-tauri/src/Codex/process.rs:330–347`):

```
--input-format stream-json
--output-format stream-json
--include-partial-messages
--verbose
--dangerously-skip-permissions    ← forces permissionMode = bypassPermissions
--thinking-display summarized
--settings <inline JSON>
[--model <m>]                     ← optional
[--append-system-prompt <p>]      ← optional
[--resume <cli-session-id>]       ← optional
[--name <session-name>]           ← optional
```

`--include-hook-events` and `--debug api,hooks` are **not** passed in production — they're useful for capture sessions only.

Outbound control protocol surface today (`event_types.rs:479–510`): `interrupt`, `set_model`, `initialize`, `set_permission_mode`. Not yet implemented but supported by CLI: `set_max_thinking_tokens`, `stop_task`, `rewind_files`.

Inbound side: nothing other than `control_response` correlated by `request_id`. There is no `control_request` from the CLI in 2.1.126.

---

## Model Metadata Reference (2.1.126)

| Value | Display Name | Effort Levels | Adaptive Thinking | Auto Mode | Notes |
|-------|-------------|---------------|-------------------|-----------|-------|
| `default` | Default (recommended) | low, medium, high, **xhigh**, max | Yes | Yes | Opus 4.7 with 1M context built-in |
| `sonnet` | Sonnet | low, medium, high, max | Yes | — | Sonnet 4.6 |
| `sonnet[1m]` | Sonnet (1M context) | low, medium, high, max | Yes | — | Extra-usage billing |
| `haiku` | Haiku | — | No | — | Haiku 4.5 |

`opus[1m]` from v2.1.74 is no longer a separate value — folded into `default`.
`supportsFastMode` field removed from all models since v2.1.74.

---

## Version History

- **2026-03-13** — Discovered against CLI v2.1.74. Skill v1 published.
- **2026-05-01** — **Re-baselined against CLI v2.1.126.** Driven by two CodeMantis user-visible regressions (toast wording, "Run Plan?" modal). Captured via `src-tauri/tests/cli_protocol_capture.rs` (12 scenarios). Notable changes from v1:
  - Model lineup overhaul (Opus 4.7 default, no separate `opus[1m]`, new `xhigh` effort, `supportsFastMode` removed).
  - `result` event gains `api_error_status`, `fast_mode_state`, `uuid`.
  - `system/init` gains `apiKeySource`, `fast_mode_state`, `uuid`.
  - `account` in `initialize` gains `apiProvider`.
  - `agents[]` in `initialize` gains optional `model`.
  - PreToolUse hook envelope formally documented (`hookSpecificOutput.{hookEventName, permissionDecision, permissionDecisionReason}`, camelCase).
  - **`permission_denials` is now a multi-purpose channel** — UI-prompt signal for ExitPlanMode/EnterPlanMode/AskUserQuestion, in addition to host-deny and protected-path. Hosts must bucket by `tool_name`.
  - **Protected-path guardrail does NOT fire in `bypassPermissions` mode.** The 2.1.78-era memory note about silent `.Codex/` blocks is stale for hosts using `--dangerously-skip-permissions`.
  - **`--permission-mode` is silently overridden by `--dangerously-skip-permissions`.** Use the runtime `set_permission_mode` control_request instead.
  - **`set_permission_mode` accepts unknown mode strings** with `subtype: success` — no validation.
  - Confirmed-supported subtype set is unchanged from v1. All previously-unsupported subtypes are still unsupported.
  - Hypothesised inbound `can_use_tool` / `tool_permission_request` pathway does **not** exist in 2.1.126 — the CLI never initiates control_requests.
