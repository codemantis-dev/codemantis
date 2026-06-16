# DRAFT GitHub issue — openai/codex

> **Status:** draft for review before posting. Target repo: `openai/codex`. Labels to request: `app-server`, `bug`.

**Title:** app-server: compaction completes server-side but `turn/completed` is never delivered to the JSON-RPC client — thread stays "Compacting…" yet remains healthy/resumable

## Summary

When driving Codex purely over the `codex app-server` JSON-RPC transport (no TUI), a turn that triggers context compaction can leave the **client** stuck in a "Compacting…" state forever, even though the **server-side thread is healthy**: the compaction actually completed, the thread is still usable, and resuming it immediately recovers a fully working session. The missing piece is the **completion notification** — the client never receives the `turn/completed` (or an equivalent compaction-finished) event for that turn, so an external client has no signal that the turn is done.

This is distinct from the well-reported *un-compactable context* hangs (e.g. #24388) where compaction genuinely loops/deadlocks. Here compaction **succeeds**; only the notification is lost.

## Environment

- Codex CLI **0.139.0** (Homebrew cask, `codex-aarch64-apple-darwin`), macOS (Darwin arm64).
- Transport: `codex -c shell_environment_policy.inherit=all app-server --listen stdio://`, newline-delimited JSON-RPC 2.0.
- Third-party client (not the TUI / Desktop / VS Code extension): a native app that owns the app-server lifecycle and consumes `turn/*` + `thread/*` notifications directly.

## Steps to reproduce

1. Start a thread over app-server and drive several turns until the context approaches the auto-compaction threshold (high reasoning effort makes this easier to hit).
2. Send a turn that crosses the threshold, so the server performs (remote) compaction mid-turn.
3. Observe the notification stream for that turn.

## Expected

- The client receives a terminal `turn/completed` (or a documented compaction-completed → turn-completed) notification for every turn that the server actually finished, including turns where compaction ran.

## Actual

- The turn completes server-side (the thread is idle and fully usable afterward), but **no `turn/completed` notification arrives** for that turn. The client is left believing the turn — and the compaction — is still in progress indefinitely.
- **Recovery confirms the thread is healthy:** tearing down and re-attaching with `thread/resume` (same thread id) immediately yields a working session with the compacted history intact. So the state desync is purely on the notification channel, not the thread.

## Why this matters for app-server clients

External clients have no TUI heuristic to fall back on; the notification stream **is** the source of truth. A silently dropped terminal event for a turn is unrecoverable without a timeout/poll workaround. This is the exact lifecycle-guarantee question raised in **#20943** ("Clarify app-server turn lifecycle semantics for external clients — is `turn/completed` guaranteed across all terminal paths?").

## Questions for maintainers

1. Is `turn/completed` **guaranteed** to be emitted for every terminal outcome of a turn, including turns that perform compaction? (If yes, this is a delivery bug; if no, app-server clients need a documented alternative completion signal.)
2. Could the WebSocket-reset / connection-cleanup behavior (e.g. #23954, "managed app-server daemon resets the WebSocket and drops clients") drop the completion notification specifically around the longer compaction window?
3. Is there a request-scoped turn-state / sequence number an external client can use to detect a missed terminal event and reconcile?

## Related

- #20943 — clarify app-server turn lifecycle semantics for external clients (the contract this violates)
- #14346 — "silent compaction that hangs, then self-resumes ~15 min later" (behaviorally adjacent, framed as TUI)
- #23954 — managed app-server resets WebSocket / drops clients (plausible drop mechanism)
- #20208, #21937, #9251 — other "completion/turn event never reaches the client" reports (different mechanisms)
- #24388 — *un-compactable* context deadlock (the **other**, already-reported failure mode; not this one)

## Note on recent changes

0.140.0 landed #27996 ("Send request-scoped turn state over WebSocket") and #28002 ("Send turn state through compact requests"), which look directly adjacent. If those already fix this on 0.140, please confirm — happy to re-test against 0.140 and close.
