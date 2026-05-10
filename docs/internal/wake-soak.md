# Wake-Soak Pre-Release Runbook

A manual gate that the automated test suite cannot replicate: leave the app running through a real macOS sleep/wake cycle and confirm it survives. Required before every `release:` commit.

## Why this exists

Two regressions shipped in the May 10 build that the 3,500+ automated tests did not catch:

1. **Auto-save data loss** — sessions kept open overnight never persisted `cli_session_id`, so they vanished from the Resume Session list after a force-quit. Fixed by persisting on first observation; verified by `src-tauri/tests/crash_recovery_resume.rs`.
2. **White screen after wake** — the app body collapsed into an empty white panel on macOS unlock. Diagnostics added; root cause may still be present in some unwakened code path.

Vitest + jsdom cannot trigger an actual `IOSurface` teardown. cargo-test cannot lock a screen. The only reliable signal is a human on a real Mac.

## Procedure

Run on the same Mac model that ships to users (currently: Apple Silicon, macOS 14+).

1. Start a clean dev build:
   ```
   pnpm tauri dev
   ```
2. Open at least **two projects**, each with **two sessions**. Send a prompt to each session so the CLI emits `system/init` (this is what populates `cli_session_id` under the new persistence path).
3. Verify the wake.log path exists and is being written:
   ```
   ls -la ~/Library/Logs/CodeMantis/
   tail -f ~/Library/Logs/CodeMantis/wake.log
   ```
   You should see `wake | listener-registered` immediately and one `wake | wake-event-recv | …` every ~30s.
4. Lock the Mac (Ctrl-Cmd-Q) and let it sleep for **at least 30 minutes**. Two hours is better.
5. Wake the Mac. Watch the dev window for at least 60 seconds.

## Pass criteria

All of the following must be true:

- [ ] The window content paints. No white panel covering the chat/sidebar.
- [ ] Existing tabs remain visible and selectable.
- [ ] Clicking into a session input still works (keyboard focus, typing).
- [ ] `~/Library/Logs/CodeMantis/wake.log` shows `rs:long-gap | gap_s=…` followed by either `rs:check-alive` (clean) or `rs:stale-pong → rs:repaint-issued` (recovered) lines.
- [ ] `~/Library/Logs/CodeMantis/appshell.log` shows `state | …` lines from before AND after the wake. If post-wake lines are missing, the React tree is frozen — fail.

## Fail criteria

Any of these means the release is blocked:

- [ ] Window body is blank/white with only the title bar visible.
- [ ] Tabs show but clicking them does nothing.
- [ ] No log lines appear after wake (frontend is frozen).
- [ ] App crashes or hangs requiring force-quit.

If any check fails: **do not release**. Capture both log files (`wake.log`, `appshell.log`), the React DevTools snapshot if available, and a screenshot of the failure state. File an issue and copy the operator who ran the test.

## Auto-save sanity check (combined with soak)

Before locking the screen in step 4, **also force-quit the app** (Activity Monitor → Force Quit) and restart it. Confirm:

- [ ] A toast says `Recovered N sessions from an unexpected shutdown` where N matches the number of open tabs from step 2.
- [ ] After dismissing the recovery banner, opening the project picker → Resume Session shows every session from step 2 with today's date.
- [ ] Each entry shows the `Saved` badge.

If any session is missing from Resume Session: **do not release**. The persistence path is the only thing keeping overnight work safe — a regression here is data loss.

## When this runbook is complete

Sign the release commit message with `wake-soak: PASS YYYY-MM-DD <initials>` so we can grep for it later. If the soak is skipped (emergency hotfix), say so explicitly: `wake-soak: SKIPPED – hotfix`.
