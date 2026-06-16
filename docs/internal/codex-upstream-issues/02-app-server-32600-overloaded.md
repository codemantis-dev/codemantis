# DRAFT GitHub issue — openai/codex

> **Status:** draft for review before posting. Target repo: `openai/codex`. Labels to request: `app-server`, `bug`, `enhancement`.

**Title:** app-server: JSON-RPC `-32600` is overloaded across "no rollout found" and "failed to load configuration" — please make the two discriminable

## Summary

Over the `codex app-server` JSON-RPC transport, error code **`-32600`** is returned for at least two completely unrelated failure conditions, and the only way to tell them apart is to substring-match the human-readable `message`. An external client that wants to react correctly (auto-recover vs. surface to the user) has to parse English strings, which is brittle.

The two meanings we hit:

1. **Stale resume — recoverable.** `thread/resume` (or a read on) a thread whose rollout no longer exists returns `-32600` with a message like `no rollout found` / `thread not found` / `not loaded`. The correct client behavior is to **fall back to `thread/start`** (a fresh thread).
2. **Malformed project config — user must fix.** A bad project-local `.codex/config.toml` (e.g. an invalid type / unknown variant) surfaces as `-32600` "failed to load configuration: …config.toml:LINE:COL: …". The correct client behavior is the **opposite**: do *not* retry/fallback; show the file path + parse error to the user.

Because both arrive as `-32600`, a client that auto-falls-back on `-32600` will silently paper over a broken config file, and a client that surfaces `-32600` to the user will nag them about recoverable stale-resume cases.

## Environment

- Codex CLI **0.139.0** (Homebrew cask), macOS (Darwin arm64).
- Transport: `codex app-server --listen stdio://`, newline-delimited JSON-RPC 2.0.
- Third-party app-server client (not the TUI).

## Observed error payloads

Case 1 (stale resume):
```json
{"id":N,"error":{"code":-32600,"message":"thread/read failed: thread not loaded: <uuid>"}}
```
(also seen as `no rollout found for thread id <uuid>`)

Case 2 (bad config):
```json
{"id":N,"error":{"code":-32600,"message":"failed to load configuration: /path/.codex/config.toml:228:1: invalid type: ..."}}
```

## Request

Make the two discriminable **without string parsing**, e.g. any of:

- Distinct codes (a dedicated code for config-load failure, and/or for thread-not-found), **or**
- A structured `error.data` discriminator, e.g. `{ "data": { "kind": "no_rollout" | "config_load" | ... } }`, **or**
- For the resume half specifically, the `thread/resumeFailed { thread_id, reason }` notification already proposed in **#22064**.

A machine-readable discriminator on `error.data` would be the lowest-risk fix and would cover both halves at once.

## Related

- #22064 — `codex exec resume <missing-uuid>`: noisy "thread not found"; proposes thread/read→thread/start fallback **and** a `thread/resumeFailed {thread_id, reason}` notification (covers Case 1; cites `-32600` literally).
- #16872 — app-server WebSocket: turns complete but rollout never materializes → sibling `thread/resume` fails "no rollout found" (Case 1, pure app-server).
- #19476 — `failed to load configuration: config.toml:…: invalid type` (Case 2 symptom; does **not** note the `-32600` framing or the collision).
- PR #6938 (merged) — introduced richer v2 app-server error codes/events; the infrastructure exists but isn't applied to these two cases.

> Note: the resume-half symptom (#22064/#16872) and the config-parse symptom (#19476) are each reported separately, but the **overloading of `-32600` across both** — and the resulting inability to disambiguate from the payload — does not appear to be filed anywhere. That's the specific ask here.
