# DRAFT GitHub issue — openai/codex

> **Status:** draft for review before posting. Target repo: `openai/codex`. This is a focused follow-up to the (closed) #3064; consider posting as a comment on #3064 **or** a new issue that references it. Labels to request: `bug`/`enhancement`, `app-server`.

**Title:** `shell_environment_policy` strips `HOME`/`DOCKER_HOST`/etc. even under `danger-full-access`, silently breaking agent-invoked host tools (docker/gh/aws/ssh) — with no diagnostic

## Summary

Codex's default `shell_environment_policy` scrubs most of the parent environment from the command-execution environment. This is documented and intentional for sandboxed runs (see #3064 and the design rationale in #1249). The gap we want to raise:

1. **It persists even with `--sandbox danger-full-access` / full-access.** When a user has explicitly opted out of sandboxing, the stripped environment is surprising: tools the model runs still don't see `HOME`, `DOCKER_HOST`, `PATH` additions, cloud-credential env, etc.
2. **The failure is silent and misattributed.** `docker`, `gh`, `aws`, `ssh` and friends fail with `EACCES` / "cannot connect" / "not logged in" because their config/socket env is missing — but nothing tells the user (or the model) that Codex removed the env. The model often then "diagnoses" a non-existent Docker/auth problem.
3. **It bites the `codex app-server` path too**, not just the TUI — a third-party client spawning `codex app-server` must know to pass `-c shell_environment_policy.inherit=all` or host tooling is broken out of the box.

The workaround is `-c shell_environment_policy.inherit=all` (and sometimes additionally `set = { … }`, since several users report `inherit="all"` alone wasn't sufficient and that Codex still aggressively rewrites `PATH`).

## Environment

- Codex CLI **0.139.0** (Homebrew cask), macOS (Darwin arm64).
- Reproduces both in the TUI and via `codex app-server --listen stdio://`.

## Steps to reproduce

1. With a default config (no `shell_environment_policy`), run Codex with `--sandbox danger-full-access` (or the app-server equivalent).
2. Ask the model to run a host tool that depends on environment, e.g. `docker ps` (needs `DOCKER_HOST`/`HOME`), `gh auth status` / `aws sts get-caller-identity` (need `HOME`/credential env), or anything resolving config under `$HOME`.
3. Observe the tool fail with `EACCES` / missing-config errors.
4. Add `-c shell_environment_policy.inherit=all` and re-run → the same tools now work.

## Expected (one of)

- Under `danger-full-access` specifically, **inherit the full parent environment by default** (the user has already accepted the risk), **or**
- At minimum, **emit a diagnostic** when an agent-invoked command fails in a way consistent with stripped env (e.g. surface "Codex removed N environment variables under `shell_environment_policy`; see <docs>") so the failure isn't misattributed, **or**
- Document the `danger-full-access` + `shell_environment_policy` interaction prominently and recommend `inherit=all` for app-server integrations.

## Actual

- Env is stripped regardless of sandbox level; host tools fail with opaque errors; only `-c shell_environment_policy.inherit=all` (± `set`) restores them. No diagnostic links the failure to the policy.

## Related

- #3064 — *Configuration for inherited environment variables* (CLOSED) — canonical root report; the foundational ask.
- #1249 — design rationale: env scrubbing is intentional secret-hygiene (maintainer @bolinfest), and even flags the API as "a bit complicated."
- #22023 — request for an include-allowlist (`include`) on `shell_environment_policy`.
- #18248 — Windows analog: child procs miss core env (APPDATA/etc.), breaking dotnet/NuGet/git.
- #20220, #6243, #4843 — `PATH`-specific variants.
- The in-progress "environments v2" refactor (#27433, #27498, #27696, #27709, #27972, …) reworks env resolution but, as of 0.140, does not appear to change the default `inherit` behavior for host tools.

> The novel angle vs. #3064: the **`danger-full-access` interaction**, the **silent misattribution**, and the **`codex app-server` spawn requirement** for third-party clients.
