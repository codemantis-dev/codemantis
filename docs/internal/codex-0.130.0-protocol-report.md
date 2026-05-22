# Codex app-server protocol — empirical report

Companion to `docs/internal/cli-2.1.126-protocol-report.md` (Claude).
Captures what we learned about the **OpenAI Codex CLI** JSON-RPC
protocol the same way: by driving the real binary and observing the
actual wire shapes, not by transcribing the docs.

**Verified against:** `codex-cli 0.130.0` on macOS 26.4.1 arm64,
2026-05-22.

**Authoritative schema bundle:** `docs/internal/codex-app-server-schemas/`
(re-generate with `codex app-server generate-json-schema --out <dir>`).
Always defer to the bundle over this report when they disagree.

**Testing framework:**
1. `src-tauri/tests/codex_schema_drift.rs` — every PR re-runs
   `generate-json-schema` and diffs vs the committed bundle. Free.
2. `src-tauri/tests/codex_protocol_smoke.rs` — credit-free harness
   that drives initialize / thread/start / model/list / shutdown
   against the live binary. Runs on every PR.
3. `src-tauri/tests/codex_protocol_capture.rs` — full battery
   (C01–C12) with real turns. `#[ignore]`-gated; consumes OpenAI
   credits; manual merge gate before tagging.

CI sets `CM_REQUIRE_CODEX=1` on the release-gate runner so the skip
paths in (1) and (2) become hard failures.

---

## What the v1.0 spec doc got wrong

These are the empirically-discovered drifts between the Phase 2 spec
(`_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`) and
the live `codex-cli 0.130.0`. Every one of them caused a user-visible
bug; every one is now locked by a regression test.

| Spec said | Live binary says | Where I learned | Fix |
|---|---|---|---|
| `sandbox` enum uses camelCase (`readOnly` / `workspaceWrite` / `dangerFullAccess`) | **kebab-case** (`read-only` / `workspace-write` / `danger-full-access`) | `v2/ThreadStartParams.json::SandboxMode`; live probe returned `-32600 Invalid Request` for camelCase | `CodexSandbox::as_codex_wire()` → kebab values (hotfix #6) |
| `approvalPolicy` enum uses camelCase (`onRequest`) | **kebab-case** (`on-request`); enum also includes `on-failure` (not in spec) | `v2/ThreadStartParams.json::AskForApproval`; same `-32600` rejection | `CodexApproval::as_codex_wire()` → kebab values |
| `personality` and `serviceName` fields cause `thread/start` rejection (hotfix #5 dropped them) | **Both fields are valid** — `personality` enum is `none / friendly / pragmatic`; `serviceName` is freeform string for analytics | Schema bundle + live probe accepted them | spawn.rs restores both (hotfix #6) |
| `cwd` is required on `thread/start` | **Optional**; only `threadId` is required (and only on `thread/resume`) | `v2/ThreadStartParams.json` has no `required` array | We always send `cwd` anyway (set to project path or AGENTS.md ephemeral dir) |
| `effort` enum is `low / medium / high / xhigh / max` (Claude-style) | `none / minimal / low / medium / high / xhigh` (note: `none` + `minimal` added, no `max`) | `v2/TurnStartParams.json::ReasoningEffort` definition | EffortSelector still uses Claude's enum visually for now; agent-aware list TBD in a follow-up |

## What the v1.0 spec doc got right

- **Bidirectional JSON-RPC 2.0** on `--listen stdio://`. ✓
- **Newline-delimited JSON**, `"jsonrpc":"2.0"` omitted on the wire by Codex. ✓
- **Server-initiated approval requests** with four kinds:
  `item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`,
  `mcpServer/elicitation/request`,
  `item/permissions/requestApproval`. ✓
- **Initialize lifecycle**: `initialize` → `initialized` notification.
  Both required before any thread/* call. ✓
- `thread/started` notification fires AFTER the `thread/start` response.
  ✓ (and `thread/started` payload mirrors the response's `thread` object)

## Verified facts (live-probed, 2026-05-22)

### Initialize response shape

```json
{
  "userAgent":     "codemantis-probe/0.130.0 (Mac OS 26.4.1; arm64) vscode/3.2.21 (...)",
  "codexHome":     "/Users/hr/.codex",
  "platformFamily":"unix",
  "platformOs":    "macos"
}
```

The `vscode/...` substring in `userAgent` reflects Codex's source-tag
defaulting; it doesn't mean anything is actually using VSCode.

### `model/list` (v2/ModelListResponse.json) — live response on 0.130.0

```
gpt-5.5        | GPT-5.5         | default=true  hidden=false  efforts=[low, medium, high, xhigh]
gpt-5.4        | gpt-5.4         | default=false hidden=false  efforts=[low, medium, high, xhigh]
gpt-5.4-mini   | GPT-5.4-Mini    | default=false hidden=false  efforts=[low, medium, high, xhigh]
gpt-5.3-codex  | gpt-5.3-codex   | default=false hidden=false  efforts=[low, medium, high, xhigh]
gpt-5.2        | gpt-5.2         | default=false hidden=false  efforts=[low, medium, high, xhigh]
```

None of the surfaced models support `none` or `minimal` effort despite
the enum allowing them. Older models may.

### Sandbox response shape (sandbox: workspace-write)

```json
{
  "type": "workspaceWrite",
  "writableRoots": ["/Users/hr/.codex/memories"],
  "networkAccess": false,
  "excludeTmpdirEnvVar": false,
  "excludeSlashTmp": false
}
```

Note: the response uses `"workspaceWrite"` (camelCase) even though the
**request** uses `"workspace-write"` (kebab). Codex marshals between
the two; CodeMantis's translator must too. See
`agents::codex::translation`.

### Protected paths inside `workspace-write` mode

The live response listed these as read-only inside writable roots:
- `.git`
- `.agents`
- `.codex`

Confirms spec §2.3 (`.codex/.git/.agents`). CodeMantis's multi-agent
protected-path detector in `chat.ts` uses this set.

## Reasoning text is not exposed by the protocol

**Empirically discovered 2026-05-22** by probing a real turn at
`effort: high` against `gpt-5.5`:

```
=== METHODS RECEIVED DURING TURN ===
  27× item/agentMessage/delta
   3× item/started        (userMessage, reasoning, agentMessage)
   3× item/completed      (userMessage, reasoning, agentMessage)
   1× turn/started
   1× turn/completed
   1× thread/tokenUsage/updated     ← reasoningOutputTokens: 40

  0× item/reasoning/textDelta
  0× item/reasoning/summaryTextDelta
  0× item/reasoning/summaryPartAdded
```

The reasoning ThreadItem arrives but with both `summary: []` and
`content: []` (the schema's `ReasoningThreadItem` allows them to be
populated, but in practice the model's reasoning text is *not*
written to either). **No delta notifications fire for reasoning at
all** — only `tokenUsage` reports the `reasoningOutputTokens` count
(40 in this example, billed by OpenAI but text-hidden).

This is by design: OpenAI's o-series and GPT-5 reasoning is hidden by
default — only the tokens are exposed.

Implications for CodeMantis:
- The Reasoning panel will stay empty for Codex turns regardless of
  effort. The chat-handler / store flow are correct; there's just
  nothing to display.
- The empty-state copy in `ActivityFeed.tsx` was changed in
  hotfix #16 from "Codex emits reasoning only at medium effort or
  higher" (misleading — that implies high-effort would populate it)
  to a clear "reasons internally but doesn't stream the text"
  statement.
- The translator now reads `summary` and `content` AS ARRAYS rather
  than scalar strings, so if a future Codex version exposes the
  reasoning text the panel populates automatically.
- If we want to surface that reasoning *happened*, we can extract
  `reasoningOutputTokens` from `thread/tokenUsage/updated`
  notifications and show it as a token counter (future work).

The hypothesis from earlier (hotfix #12) that "reasoning needs medium
effort or higher" was wrong — even high effort doesn't expose the text.

## Crash-recovery / `thread/resume` contract

**Empirically discovered by the smoke harness** (S02), 2026-05-22:
Codex only writes the thread's rollout file
(`~/.codex/sessions/YYYY/MM/DD/rollout-<uuid>.jsonl`) **after the
thread has had at least one turn**. A `thread/start` followed by an
immediate close leaves no on-disk record; a later `thread/resume` for
that thread id returns:

```json
{
  "error": {
    "code": -32600,
    "message": "no rollout found for thread id <uuid>"
  }
}
```

Implications for CodeMantis crash recovery:
- The crash-recovery banner only offers Resume for sessions where at
  least one turn ran.
- If a user creates a session, doesn't send anything, then quits, we
  should mark the session as ephemeral (no rollout to recover) and
  hide it from the Resume list — silently dropping a `-32600` toast.
- `agents::codex::translation::map_error` should special-case this
  message and emit `ProcessError` with the "session's history is no
  longer available on disk" wording from spec §9.

This finding came from the smoke test, not the spec. The Phase 2 doc
suggested resume was always safe.

## Common error codes seen

| Code | Meaning | Triggers | Surface |
|---|---|---|---|
| `-32600` | Invalid Request | Wrong enum casing (the big one), missing required `threadId` on resume, unknown method | Stamped onto a JSON-RPC `error` field in the response; `ClientError::Rpc` carries `data` so the toast shows the field name |
| `-32601` | Method not found | Unknown server-initiated method we route via `approvals.rs` | We `respond_error` it back so Codex doesn't wedge |
| `-32001` | Server overloaded | Documented retry-with-backoff signal | `CodexClient::send_request_with_retry` handles |

## Rule of thumb

> **Any wire-shape uncertainty gets verified via
> `codex app-server generate-json-schema --out /tmp/codex_schema`
> before code is touched. Never the spec doc alone.**

If you're tempted to "just match the spec," look at the table at the
top of this report. The spec was wrong four times. The binary is the
ground truth.
