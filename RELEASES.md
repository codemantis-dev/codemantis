# CodeMantis Releases

## 1.1.11

Major SpecWriter + Self-Drive iteration: project capability handshake before spec generation, UI-completeness audit with a Coverage panel, AUDIT-PATCH for splicing spec fixes, evidence-driven verification with a loop guard, and a parity-recovery short-circuit that ends an entire class of false-positive pauses.

### SpecWriter — capability handshake (Phase 0/0b)
- **Passive project probe (Phase 0)**: SpecWriter now scans the active project for capabilities before generating a Feature-mode spec — env vars, `.env` files, `package.json` deps, lockfile presence, docker, supabase/anthropic/openai/gemini/openrouter/stripe/resend/google-oauth credentials. Results land in `.claude/project-capabilities.json` so subsequent runs are incremental
- **Live-fire handshake (Phase 0b)**: yellow banner surfaces probed capabilities and offers a one-click live-fire verification (real API call against the user's keys). Gated by the new `selfDriveConfirmCapabilities` setting (default on). Spec generation is gated on confirmation so the spec reflects real, reachable services instead of speculative ones
- **Project file picker + project-ref attachments**: new picker lets users attach project files as references to the spec (button in the SpecWriter toolbar; Cmd+Enter confirms inside the picker)

### SpecWriter — UI-completeness audit + Coverage panel
- **Coverage panel** (new tab on SpecWriter slide-over) with audit count badges. Findings checked:
  - **Orphan entities** in §Data Model: H3 entities missing a `Screens:` field
  - **Untriggered endpoints** in §API: endpoints with no UI trigger
  - **Forms without validation**: form sections missing a Validation block
  - **Session too large**: per-session weight audit (files × phases × surfaces × SQL fence ratio)
  - **Placeholder leaked**: ungrounded `{{placeholder}}` quotes in the spec body
  - **Indivisible marker missing**: large sessions without an explicit indivisible declaration
- **AUDIT-PATCH for Claude Code** (`f4b8dad`): a "Patch spec & re-audit" button asks Claude Code to splice fixes into existing spec sections rather than rewriting the whole spec. New per-heading patch templates (H1–H6), heading hints to keep splices in the right section, and placeholder recheck context that walks Claude back to where the leak happened
- **Patch outcome banner**: explicit "Spec patched" / "Patch rejected — spec preserved" feedback so users never wonder whether a partial write happened. Spec is restored on rejection
- **Creation log + RESUME HERE pill**: SpecWriter records a creation log so a compaction can recover the session at the right point. A `post-compact` + `RESUME HERE` pill marks the resume anchor

### Self-Drive — evidence-driven verification (`8f0fced`)
- **Evidence vocabulary**: orchestrator now emits typed evidence claims (`command_ran_with_output`, `file_grep_match`, `pnpm_check_output`, etc.) parsed by the store rather than free-text heuristics
- **Semantic verify parsing**: verify checks accept structured proofs, removing the fragile "did the model say the right phrase" detector
- **Loop guard**: bounded retry on repeat-pattern verify failures with a forced pre-emit self-check so the orchestrator can't burn a session on the same redo prompt
- **Capability gating**: gated items report in the pause reason rather than as audit failures, so a missing service can't masquerade as an implementation bug
- **Injection-aware orchestrator** (`44c7547`): the orchestrator now knows what kind of prompt injection produced the current response (parity-recovery, recovery, fix, etc.) and routes verdicts accordingly. Detector suppressors silence false-positive matches for the active injection
- **Project record in orchestrator** (`36ee6c5`): the orchestrator receives the project capability record so verify items tied to a gated capability resolve cleanly without manual override

### Self-Drive — parity-recovery short-circuit (2026-05-15 regression fix)
- **Root cause**: when the orchestrator emitted `advance_recovery` after a parity-recovery turn, the store routed it through `handleAdvanceRecovery`, which requires `state.activeBlocker`. Parity-recovery never sets `activeBlocker` (it's a deterministic filesystem gate, not a real blocker), so the session paused with "Recovery rejected: no active blocker to resolve" even after the parity gap closed
- **Fix**: `handleAdvanceRecovery` short-circuits when `lastSelfDrivePromptInjection === "parity-recovery"` and no blocker is active — delegates to `handleAdvance`, which re-runs the parity gate via `attemptMarkSessionComplete`. Run log entry confirms the reroute
- **Diagnostic upgrade**: the remaining structural case (no blocker + non-parity injection) pauses with a message naming the injection and verdict (`injection=…, verdict=advance_recovery`) so future incidents triage in seconds
- **Orchestrator prompt**: explicit "AFTER A PARITY-RECOVERY TURN" routing rules — must emit `advance` (parity closed / `DEFERRED: …`) or `fix`, never `advance_recovery`. Regression coverage in both `selfDriveStore.recovery.test.ts` and `self-drive-orchestrator.test.ts`

### Super Bro
- Documents the SpecWriter probe/handshake flow and the verify loop guard so Super-Bro can translate `orchestratorReasoning` into plain language and surface canonical recovery options

### Rust Cleanup
- `project_capabilities` probe_credentials uses `if let` destructuring instead of `is_some + unwrap`

### Documentation
- User guide: SpecWriter capability handshake, Coverage panel + AUDIT-PATCH flow, creation log; new "Awaiting capability confirmation" + "Coverage panel empty" states; Self-Drive evidence-driven verification section
- Super-Bro knowledge: persona refines SpecWriter description; guide-transitions adds parity-recovery loop + `orchestrator-uncertain` blocker kind

### Code Quality
- Test count floors raised: TS unit ≥3,799 (+214), TS integration ≥162 (+27), Rust unit ≥1,477 (+39). Rust integration unchanged (19)

## 1.1.10

Major feature release: introduces the **Preflight System** (Mission Control for project capabilities), encrypts AI provider keys at rest, fixes the AskUserQuestion flow on CLI 2.1.126, hardens crash-recovery and graduated wake-recovery, and tightens the Self-Drive parity gate with a recovery loop instead of a hard halt.

### Preflight System (new)
A first-class capability gate for projects, surfaced as **Mission Control** in the workspace overlay and an always-visible **PreflightTray** with green/yellow/red status:
- **Bundled catalog**: 13 capability recipes ship in the app bundle (`catalog/system/*` for git/node/pnpm/docker, `catalog/services/*` for Anthropic, OpenAI, Gemini, OpenRouter, Stripe, Stripe webhook, Resend, Supabase, Google OAuth). Each entry declares `requires:`, verification steps, and setup hints. Loaded via `serde_yml` with a memoized cache
- **Verification engine** (Rust): four kinds — `shell_command`, `env_var_present`, `secret_present`, `api_probe`. Probes run in parallel via `futures::join_all`. Results emit five Tauri events for live UI updates
- **Project-scoped encrypted secret store**: `preflight_secrets.json` per project, AES-GCM via the new `secret_box` module
- **Detection**: scans `~/.zshrc`, `~/.bashrc`, `~/.profile`, project `.env` for hint variable definitions (presence-only — values are never read into memory). DetectionPrompt asks for explicit consent on first project open
- **Setup flows**: stepper modal with four step kinds — `open-url`, `paste-and-verify` (inline regex validation), `confirm-install` (full-command transparency), `manual-confirm`. Skip-for-now is always available; users are never trapped
- **AI fallback** for long-tail capabilities: fixed prompt + `RawEntry` schema. Forces `secret_present` verification so the model can never invent an API probe for a security-sensitive service. Regex from the model must compile or the entry is rejected. Cached on disk under `catalog-cache/<slug>.yaml`; bundled entries always take priority
- **Self-Drive pre-run gate**: refuses to start if any blocking capability is unsatisfied; legacy projects without `preflight.yaml` fall through cleanly. PF-001..PF-004 audit rules wire into the run flow. New `MidRunPauseModal` shows context; `SetupFlowModal` opens in a separate dialog so two Radix dialogs never nest
- **Auto-generation on spec finalization (Phase 4.5)**: SpecWriter's spec save calls the user's selected LLM to extract capability requirements, resolves them against the catalog, and writes `preflight.yaml` automatically. `system.*` refs become `AutoResolvable+EnvVar`; service refs become `GuidedHuman+SecretBox`

### Settings — encryption at rest
- **AI provider API keys are now encrypted at rest** with AES-GCM (`secret_box`) and per-user key material. Ciphertext lives in `settings.json` as `api_keys_encrypted`; the wire shape (`api_keys`) is decrypted on read. Legacy plaintext keys are migrated opportunistically on next save. The AI Providers tab UI clarifies the new encryption guarantee
- **Stale provider/model auto-reconcile**: Settings now auto-corrects Self-Drive / Super-Bro provider+model when the saved provider no longer has an API key configured. Regression coverage added for both tabs
- **Spec prompts modularized**: `spec-prompts.ts` split into a barrel + per-mode files (`feature-mode.ts`, `new-app-mode.ts`, `build-claude-code-prompt.ts`, `build-system-prompt.ts`, `spec-detection.ts`) for maintainability

### Claude CLI Integration — AskUserQuestion fix (CLI 2.1.126)
- **Bypass-mode auto-approve no longer eats AskUserQuestion**: CLI 2.1.126 ignores PreToolUse hook payloads for AskUserQuestion, so `resolve_tool_approval` cannot carry the user's reply. New `submit_question_answer` resolves the hook (allow) and follows up with `send_message` carrying the formatted answer. Approval server now skips session-mode auto-approve specifically for AskUserQuestion so QuestionModal always opens. QuestionModal + IPC fully wired

### Self-Drive — parity gate + recovery loop
- **Smarter cross-system action parity gate**: Rust `verify_action_parity` now unions caller paths and accepts an optional wire-needle. Frontend derives caller paths across session file dirs and passes the wire signal through. `Cross-system actions` block parses `(wire: x)` for tighter signal
- **Recovery instead of hard halt**: parity failures now produce a `parity-recovery` prompt (with `DEFERRED:` waiver parsing); `lastClaudeResponse` is stashed; `handleAdvance` takes a recovery / DEFERRED bypass route instead of refusing to advance
- **Tick checks after fix-round advance**: `fixing+checkResults` is now treated as verify-class so post-fix advances auto-tick verify items before mark-complete. Opaque "unexpected state" pause replaced with a `checks-incomplete` detail (labels + phase) and mirrored to Tauri logs via `console.warn`
- **Per-session verify prompt scoped** without triggering a global audit

### Crash Recovery
- **CLI session id persisted to SQLite** on first system/init event so force-quit sessions stay resumable. New `mark_session_closed_if_stale` IPC + DB helpers, graceful-exit promotion of open sessions to closed, and snapshot-tick reconciliation from the frontend
- **Integration test** `crash_recovery_resume.rs` covers the full restore flow

### Lifecycle — graduated wake recovery
- **Stale wake_pong streak handling**: tracks consecutive misses. Repaint only on first miss; repaint + webview eval at ticks 2–4 to nudge WebContent; full reload after 5+ misses as a last resort (streak resets after reload). `wake.log` breadcrumbs include the streak. New unit tests cover `recovery_action_for` thresholds. Internal wake-soak runbook added in `docs/internal/wake-soak.md`

### UI Polish
- **Shared modal settling**: `useModalSettle` extracted and reused for destructive and plan-complete dialogs alongside the approval/question flows
- **Crash-recovery toast** now reflects restored vs failed sessions accurately
- **Duplicate AskUserQuestion activity entries** suppressed in the activity feed

### Documentation
- Super-Bro persona feature list adds File Viewer
- Internal `docs/internal/wake-soak.md` runbook for the May 2026 wake incident

### Code Quality
- Rust clippy/style cleanups across `claude`, `settings`, and `preflight` (module_inception flatten, `is_none_or`, `io::Error::other`, ellipsis char, inline format-arg cleanups)
- Test count floors raised: TS unit ≥3,585 (+158), TS integration ≥135 (+3), Rust unit ≥1,438 (+182), Rust integration ≥19 (+9)

## 1.1.9

Hotfix release: early detection of CLI protocol/version mismatches, friendlier error guidance for unprefixed 401s, modal key-press guard, and a changelog summarizer regression that broke OpenAI GPT-5 / Opus 4.7 / OpenRouter.

### Claude CLI Integration
- **Handshake & version mismatch detection**: an outdated or incompatible `claude` install no longer fails silently. A new CLI handshake probe (`cli_handshake_probe.rs`) and version checker (`cli_version.rs`) run at startup, and the stream parser surfaces protocol-failure events instead of dropping them. The Welcome screen and startup flow now show actionable upgrade guidance when the local CLI is too old for the wire protocol CodeMantis speaks
- Integration coverage in `src-tauri/src/utils/cli_handshake_probe.rs` and `cli_version.rs`, plus refreshed `claude_detection.rs` paths

### Error Messages
- **Unprefixed 401s now route to `claude login` guidance**: when the Claude CLI forwards an Anthropic 401 without a provider prefix, the user is told to run `claude login` instead of being sent to Settings → AI Providers. Third-party provider 401s (Anthropic-prefixed, OpenRouter-prefixed) still route to API-key remediation
- **Friendly binary-file preview**: file reads that fail UTF-8 decoding now show a "binary file" preview instead of a raw decode error
- New regression coverage in `src/lib/error-messages.test.ts`

### Modals
- **No more stray key auto-approval on modal open**: in-flight `Enter` / `Escape` keystrokes that landed within the first few ms of a Tool Approval or Question modal opening could auto-confirm before the user saw the dialog. A short settling window now ignores those keys, and keyboard handling moved onto dialog content for proper focus scoping. Regression tests added for both modals

### Changelog Summarizer
- **`temperature` removed from summarizer API bodies**: OpenAI GPT-5 and the reasoning-model series, Anthropic Opus 4.7+, and OpenRouter (which forwards both) all return HTTP 400 on any non-default `temperature`. Body construction is now per-provider with regression tests asserting the field is absent. (Memo: see `project_anthropic_temperature_deprecated.md`.)

### Code Quality
- Test count floors raised: TS unit ≥3,427 (+42), TS integration ≥132 (+8), Rust unit ≥1,256 (+5)

## 1.1.8

Hotfix release: sidebar Git Status crash guard, Self-Drive verification tightening, and crash-recovery for interrupted sessions on restart.

### Sidebar (Hotfix)
- **Git Status no longer crashes during project switch**: when switching to another project while the git hook still reports the previous repo, `GitStatusCard` now requires an active session before rendering — eliminating the null-deref crash that could leave the sidebar in a broken state
- Regression test added for stale `gitStatus` with `null` `activeSessionId`

### Crash Recovery
- **Interrupted sessions restored on restart**: open-session state is now tracked in SQLite, so unclean shutdowns no longer leave you with empty tabs at next launch. New `crashed-session` Tauri commands surface what was open
- **Paused-recovered flow**: when a recovered session is reopened, it lands in a paused-recovered state with explicit Restore/Resume actions, instead of silently re-attaching and racing against the CLI
- Integration coverage for the recovery orchestrator and the frontend restore/resume paths

### Self-Drive
- **Tighter verification phase**: new `FILESYSTEM-BLINDNESS` and `CROSS-ITEM EVIDENCE CREDIT` rules for the verifying phase prevent the orchestrator from demanding evidence it cannot inspect, and from refusing credit for evidence already supplied for an adjacent item
- **`COMPLETENESS RULE` for [integration]**: forbids stacked evidence demands so a single integration item can't snowball into a multi-round interrogation
- **`PRE-EMIT SELF-CHECK` (a/b/c) replaces repeat-pattern escalation**: when the orchestrator detects a repeat pattern it now runs a mandatory self-check before re-emitting, instead of mechanically escalating
- Prompt-contract test coverage extended for all new strings

## 1.1.7

Patch release: recoverable error boundary, Self-Drive accuracy fixes, additional CodeQL hardening, and full security infrastructure (vulnerability disclosure policy, Dependabot, code scanning).

### UI Resilience
- **`AppErrorBoundary` for recoverable render failures**: a top-level React error boundary now catches render-time exceptions in any component and offers a "Reload affected panel" action instead of dropping the user into a blank window. Prior behavior was a fully white app on any uncaught render error; the boundary keeps the rest of the UI alive while the failed subtree resets cleanly.

### Self-Drive
- **Reduced orchestrator false positives** when correlating tool calls to specific session phases. The orchestrator was occasionally attributing tool activity to the wrong phase under interleaved sub-agent traffic, leading to incorrect "phase X never used tool Y" rejections; tool attribution now follows the per-turn boundary instead of the per-session boundary, eliminating the drift
- **Manual "Mark Complete" bypasses the parity gate**: when the user explicitly closes a Self-Drive session via the Mark Complete button, the cross-system action-parity check no longer runs. The parity check is meant to catch *Claude* claiming completion without evidence; it shouldn't override the *user* explicitly ending a session

### Security
- **CodeQL static analysis added** to `dev` (every push + weekly), with `security-extended` + `security-and-quality` query packs. First scan surfaced 4 high-severity findings, all patched in this release:
  - **Preview console URL bar (`preview-console-bridge.js`)**: URL navigation now uses `URL` constructor parsing + `protocol === "http:" || "https:"` check before assigning to `location.href`. Blocks `javascript:`, `data:`, `file:`, `vbscript:` schemes from reaching a navigation sink. (Closes CodeQL `js/xss-through-dom`.)
  - **Clone form host check (`CloneForm.tsx`)**: replaced `.includes("github.com")` substring matching with proper `new URL(...).hostname` equality. Old check matched adversarial inputs like `attacker.com/?x=github.com`. Functional impact was benign (only decided whether to append `.git`), but the fragile pattern is gone. (Closes CodeQL `js/incomplete-url-substring-sanitization` ×3.)
  - **Test polyfill signatures (`src/test/setup.ts`)**: aligned `ResizeObserver` and `IntersectionObserver` polyfills with the DOM lib's constructor signatures so CodeQL's TypeScript extractor stops treating the test stubs as the authoritative type. (Closes 7 `js/superfluous-trailing-arguments` warnings that were polyfill-shadowed false positives in production code.)
- **Vulnerability disclosure policy** at [SECURITY.md](https://github.com/codemantis-dev/codemantis/blob/dev/SECURITY.md), with [private vulnerability reporting](https://github.com/codemantis-dev/codemantis/security/advisories/new) as the preferred channel and documented safe-harbor for good-faith research
- **Dependabot security updates enabled** — auto-creates PRs for new CVEs in tracked dependencies
- **Dependabot version updates** scheduled weekly for cargo, npm, and github-actions ecosystems (`.github/dependabot.yml`)
- **Secret scanning + push protection** enabled — pushes containing secrets are blocked at the git layer
- **README badges**: Security Policy + CodeQL workflow status, plus a `Security` link in the nav row

### Test Infrastructure
- **Radix focus-scope flake on jsdom 28**: `@radix-ui/react-focus-scope` schedules a `setTimeout(0)` during Dialog/Popover unmount that dispatches a `CustomEvent` on the now-detached DOM node. On jsdom 28 the stricter Event-IDL converter throws "parameter 1 is not of type 'Event'", which Vitest 4.x escalates to a CI suite failure even though no real test failed (bit v1.1.6 CI). A surgical capture-phase error filter in `src/test/setup.ts` swallows exactly that error class; genuine unhandled errors still surface

### Documentation
- User guide synced to current build: documents skills discovery and the API Logs UI, with bundled Tauri resources mirroring the docs

### Code Quality
- Test count floors raised: TS unit ≥3,385 (+28), TS integration ≥124 (+2). Rust counts unchanged from v1.1.6

## 1.1.6

Security hardening release. No user-facing feature changes — patches transitive dependency vulnerabilities flagged by Dependabot and shrinks the runtime TLS attack surface.

### Dependency Vulnerability Patches
Resolved Dependabot alerts (11 total at v1.1.5 → 0 at v1.1.6):
- **`rustls-webpki` 0.103.10 → 0.103.13** (high #24, low #15/#16) — DoS via panic on malformed CRL, plus name-constraint corner cases. This crate is in CodeMantis's actual TLS path (`reqwest` rustls-tls → rustls → rustls-webpki); the patch closes the only runtime-reachable advisory in the set.
- **`openssl` 0.10.76 → 0.10.78** (high #19/#20/#21/#23, low #22) — multiple memory-safety bugs in the openssl bindings.
- **`postcss` 8.5.8 → 8.5.13** (medium #25, dev-only) — XSS via unescaped `</style>` in CSS stringify output. PostCSS is a build-time CSS compiler in CodeMantis; the bug is not exploitable in our build pipeline, but patching keeps the development surface clean.
- **`rand` 0.8.5 → 0.8.6, 0.9.2 → 0.9.4** (low #17 only — #18 dismissed) — soundness fix for `rand::rng()` with custom loggers. Build-time only; no runtime exposure.
- **Dismissed alert #18** (`rand` 0.7.3) as `tolerable_risk`: transitive 5 levels deep through `tauri-build → tauri-utils → kuchikiki → selectors → phf_generator`, only consumed at build time, no runtime presence in the shipped binary, and has no patched 0.7.x version available — fix requires upstream Tauri to bump `kuchikiki`/`selectors`.

### TLS Attack Surface Reduction
- **Disabled `reqwest` default features** to remove `openssl` and `native-tls` from the dependency graph entirely. CodeMantis explicitly enables `rustls-tls` for TLS, but the previous configuration also pulled `default-tls` (= native-tls + openssl) implicitly — so two TLS stacks were compiled in but only one was used.
- After the change, `cargo tree -p openssl --target all` and `cargo tree -p native-tls --target all` both report no matches. Removed from the binary: `openssl`, `openssl-sys`, `openssl-macros`, `native-tls`, `hyper-tls`, `tokio-native-tls`, `system-configuration` (and its `-sys` crate), `windows-registry`.
- **Defense-in-depth benefit**: future `openssl` CVEs will not flag this repository because the crate is no longer in the dependency graph. The runtime TLS attack surface is now scoped to the `rustls`/`rustls-webpki`/`ring` chain CodeMantis actually exercises.

### Notes for Updaters
- This is an auto-updater patch release — installed copies of v1.1.5 will pick up v1.1.6 automatically.
- No CLAUDE.md test floor changes. Test counts unchanged from v1.1.5 (TS unit ≥3,357, TS integration ≥122, Rust unit ≥1,227, Rust integration ≥10).

## 1.1.5

Feature release: thinking-effort selector, Self-Drive quality contract, and CLI permission-mode ownership fix.

### Thinking Effort
- **EffortSelector in input chrome**: new selector lets you pick the model's thinking effort per session, with levels read live from the CLI's `initialize` capability manifest — no hardcoded effort lists, so Anthropic-side changes (e.g. the new `xhigh` level on Opus 4.7) are picked up automatically
- **`defaultThinkingEffort` setting** persists your preferred default across sessions; spawn-time resolution passes the documented `--effort` flag to the CLI (SpecWriter sessions unchanged)
- **Level-change pause/resume**: switching effort mid-session pauses the CLI cleanly and resumes with the new flag, instead of forcing a destructive restart
- **Capability-driven matching**: resolved Anthropic model IDs (e.g. `claude-opus-4-7`) map back to initialize manifest entries via token overlap, so per-model effort options follow the actual model
- **No fake defaults**: stopped seeding a synthetic "high" default on new sessions; `ThinkingEffort` is treated as an opaque CLI string everywhere

### Self-Drive
- **Senior-Engineer Quality Contract**: shared `BUILD_MODE` and `FIX_MODE` preambles wrap every building/fixing Claude prompt via `wrapBuildPrompt`, raising the floor for code quality and reducing the rate of half-finished work the orchestrator has to reject
- **Stricter orchestrator stance**: system prompt retargeted to a skeptical senior-reviewer, with explicit workaround-phrase detection and activity-evidence cross-checks against tools-used and turn duration before allowing a session to finish
- **Spec session copy** aligned to deliverables-over-file-fences scope so spec sessions stop hand-waving file boundaries

### Claude CLI Integration
- **Permission mode is host-owned**: stopped syncing session permission mode from the CLI's `system/init.permissionMode` field. The CLI always reports `bypassPermissions` there when CodeMantis spawns with `--dangerously-skip-permissions`, so the previous sync silently overwrote the user's ModeSelector choice every time. Plan/Default/Bypass selections now stick
- **Approval server hardening**: new tokio round-trip tests cover the pending-oneshot → `HookResponse` allow/deny/timeout flow, plus a frontend integration test that exercises the full tool-approval round trip through the `resolve_tool_approval` invoke
- **`classify_permission_mode` marked test-only** so future contributors don't reintroduce the sync that broke this case

### Documentation
- User guide synced to the shipped build: documents the Resume Session project-picker tab, Cmd+F in-chat search, the thinking-effort selector behavior, `defaultThinkingEffort` persistence, and expanded keyboard shortcuts
- New screenshots for the effort UI and resume tab; bundled Tauri resources mirror the docs

### Code Quality
- Test count floors raised to lock in current coverage: TS unit ≥3,357, TS integration ≥122, Rust unit ≥1,227, Rust integration ≥10
- Integration-test fixture indentation fixed (`selfDriveAutoCommit`)

## 1.1.4

Hotfix release focused on macOS lock-screen lifecycle, SpecWriter save UX, and CLI protocol alignment with `claude` 2.1.126.

### macOS Lifecycle (Hotfix)
- **Lock-screen stalls eliminated without destructive reloads**: long-running sessions no longer freeze when the Mac sleeps/locks for extended periods. Combines an App Nap opt-out, a process activity assertion token, and a non-destructive WKWebView repaint recovery path on missed wake pongs
- **No more frontend visibility-triggered reloads**: the visibility-change reload path is gone — unlocking the screen no longer wipes in-memory UI state (active session, scroll position, modal stacks). Recovery now happens at the native layer instead of by reloading the webview
- **Updated wake-recovery tests** to cover the new repaint path and the absence of the visibility reload

### SpecWriter
- **Smarter save dialog filename**: the SpecWriter save dialog now derives its default filename from `docs/specs/<stem>.md` self-references in the body (e.g. Session Plan prompts) before falling back to H1 slugging — so saved specs land at the filename the spec actually claims to use
- **Em/en-dash only as title separators**: filename derivation no longer splits compound names like `Spec-Forge` on hyphens. Helper functions are pure and covered by unit + dialog regression tests
- **Toolbar/list icon sizing normalized**: SpecWriter action buttons and saved-spec list icons render at a consistent visual scale, with collapse chevron typography aligned for legibility
- **Lucide chevrons for saved-specs collapse**: replaced unicode triangle glyphs with `ChevronRight`/`ChevronDown` so the header matches the rest of the Lucide UI and scales cleanly

### Claude CLI 2.1.126 Compatibility
- **Protocol capture harness**: new reproducible suite with scenario NDJSON artifacts and a detailed 2.1.126 audit report, used to drive runtime behavior changes
- **ExitPlanMode plan state preserved across inactive sessions**: switching tabs no longer drops the pending plan from a paused session
- **Protected-path deny toast bucketing**: control-tool denials no longer surface as misleading errors; they're routed through the same protected-path UX introduced in 1.1.3
- **Documented**: `--dangerously-skip-permissions` overrides `--permission-mode` in CLI spawn args (call-site comment, no behavior change)

### Plan Mode Diagnostics
- Cross-stack `[plan-modal]` trace logs at the message router (when `ExitPlanMode`/`EnterPlanMode`/`AskUserQuestion` ToolUseStart events surface), at the activity handler (visibility decision), and at `PlanCompleteModal` (render-state transitions). `@tauri-apps/plugin-log` is mocked in Vitest setup so diagnostic calls remain side-effect-free in tests

## 1.1.3

### Chat
- **In-message search**: new search bar (Cmd+F) lets you find text across the active session's messages with term highlighting in both prose and code blocks, plus next/prev navigation across matches
- **Highlight helpers**: shared `highlight-text` and `highlight-children` utilities so search hits render consistently in MessageBubble and CodeBlock

### Session Resume
- **Resume from Project picker**: the Open Project modal now lists recent sessions across all projects with a per-row Resume action — picking one switches active project and rehydrates the CLI session, instead of forcing you to open the project first
- **Recent-sessions backend**: new SQLite query and Tauri command surface globally-ordered recent sessions with stored-message flag, project path, and capped changelog snippets per row
- **Spec self-reference recognition**: stronger detection of when the assistant references the current spec by name so guide recognition doesn't double-load or mismatch the active plan

### File Viewer & Preview
- **Session-scoped file viewer**: file viewer state is now keyed per session — switching sessions no longer leaks the previously-open file or selection state across tabs
- **Preview progress modal hardening**: clearer phase transitions in the preview loading modal, with port detection improvements that distinguish dev-server boot phases from idle states
- **Claude stream-parser fixes**: process and stream-parser handle additional CLI partial-message edge cases without dropping events or stalling the activity feed

### Claude CLI
- **Protected-path denials surfaced in chat**: when the CLI refuses an operation due to its protected-path guardrail, the denial now appears in chat with the path and reason instead of disappearing silently — makes guardrail behavior debuggable
- **New event types**: `tool_denied` / protected-path event handling wired through `event_types.rs`, the message router, and the chat event handler

### Lifecycle & SpecWriter Recovery
- **Bounded wake-reload backoff**: after a long sleep, the wake observer now reloads with exponential backoff capped at a small budget, so a flaky network or backend doesn't trigger a reload storm at wake
- **SpecWriter wake recovery**: SpecWriter sessions detect post-wake state divergence and either resume the in-flight Claude conversation or restart cleanly with the user notified, instead of leaving a half-dead spec stream
- **Audit companion hardening**: spec audit companion handles missing or moved guide files more gracefully and exposes errors instead of failing silently
- **SaveSpecDialog/SpecPreview polish**: tighter loading/error states and cleaner integration with the audit + recovery flow

### Documentation
- User-guide version references synced to the shipped build (embedded guide and source-of-truth markdown in lockstep)

## 1.1.2

### Self-Drive
- **Static cross-system action parity**: before a session can finish, the orchestrator verifies that backend handlers, frontend wiring, and integration evidence all agree on the same actions — catches half-implemented features that pass code review individually but don't connect end-to-end
- **`request_recheck` loop**: orchestrator can now ask Claude Code to re-state evidence for specific verify items before pausing, up to 2 rounds per session (opt-out via `selfDriveEnableRecheckLoop`)
- **Integration-evidence contracts**: typed contracts make verify items explicit about what evidence is required (file:line citations, test names, behavior descriptions)
- **Handler-authoring carve-out**: parity gate is skipped during pure handler-authoring sessions where the frontend wiring intentionally lands later
- **Orchestrator-authoritative evidence format**: orchestrator now owns the evidence schema instead of letting the verifier and prompts drift apart
- **No verifier truncation**: the verifier no longer truncates Claude's evidence text mid-quote, fixing false PASSes from cut-off file references
- **Token-reset stall handling**: stall timeout and live blocker UI now correctly handle the post-token-reset window where the model legitimately pauses
- **Unknown-blocker recovery hardening**: orchestrator no longer loops indefinitely on unrecognized blocker kinds and stops spamming the compact-log channel
- **Skipped-verify and parity-error fixes**: verify items marked SKIPPED no longer break parity, and the GuidePanel store now stays in sync with orchestrator state

### SpecWriter
- **Preflight input analyzer + clarification gate**: before generating a spec, SpecWriter analyzes the user's input for missing details and asks targeted clarification questions instead of guessing
- **Input-fidelity coverage audit**: new audit pass compares the generated spec against the original input to surface dropped requirements, with auto-recheck on regeneration
- **Coverage panel + report persistence**: dedicated UI surface for coverage findings; reports are saved alongside specs for later review
- **Stream observability in coverage workflow**: live progress and tool activity are visible during coverage runs, not just the final result
- **Phase-based session plans parsed correctly**: guides can now be recognized from specs that organize sessions by phase (`## Phase 1: …` → `### Session 1.1: …`) instead of flat `### Session N` lists
- **Better guide-failure explanations**: surface concrete reasons when guide recognition fails (no plan section, malformed sessions, etc.) instead of a generic toast
- **No project-context truncation**: `gather_spec_context` now uses tighter per-section caps instead of a cumulative budget that silently dropped late files
- **Fewer false stall warnings**: tool-heavy streams (many small reads/edits) no longer trigger the inactivity stall heuristic
- **Unified guide recognition + filename targeting**: single code path for recognize-guide regardless of entry point, with consistent filename matching
- **Context-compaction surfacing**: Claude Code context compactions are now visible in CLI sessions so the user knows when history was rewritten

### Activity Feed
- **No cross-project/session bleed**: activity entries from other projects or sessions can no longer appear in the current feed or detail view (regression from session pinning)
- **Claude settings carve-out failures explained**: when CodeMantis can't write the Claude settings carve-out (permissions, locked files), the activity feed now surfaces the actual reason instead of failing silently

### Claude CLI
- Handle `task_notification` and `task_updated` events from the CLI's background-task system so long-running shell tasks surface progress in the activity feed

### Preview Window
- Distinguish intentional dev-server shutdown from crashes — closing the preview no longer logs the dev server as crashed when the user simply stopped it

### Documentation
- User guide refreshed for the new toolbar layout, default spec models, and current MCP access shortcut (Cmd+Shift+M)

## 1.1.1

### Self-Drive
- **Persistent paused runs**: Self-Drive state is saved to SQLite (`self_drive_runs` table) across app restarts — paused runs rehydrate at boot and require the user to attach a live session before resuming
- **Session and guide pinning**: lock the target sessionId and guide snapshot at start so tab/project switches cannot retarget Claude or swap plans mid-run
- **Structured blockers**: typed blocker kinds with options, resolution lifecycle, and a dedicated recovery phase — the orchestrator verifies blocker resolution via a recovery prompt before normal flow resumes
- **Blocker input required**: pause stamps `prePauseLastMessageId`; Resume is blocked until the user provides resolution via a one-click option pick or main chat reply
- **Tool extraction from activity feed**: derive tool names from activityStore instead of unused activityIds
- **Verification prompt always merges checklist**: custom `verificationPrompt` is now guidance above the numbered `verifyChecks` list so the orchestrator never loses checklist items

### UI
- **Shared CopyButton**: extracted component with lazy `getText()` for click-time snapshots — used in MessageBubble (always-visible copy on latest assistant reply, streaming-safe), RunLogViewer, and Self-Drive paused status
- **Text selection**: `-webkit-user-select` and `.select-text` so Cmd+C works in the Tauri webview; run log body is now selectable
- **Chat scroll stability**: track container `clientHeight` so reflow-driven scroll events (e.g. ThinkingIndicator growth) don't flip the user off the bottom or flash the new-messages affordance

### Claude CLI
- Pass `--thinking-display summarized` so Opus 4.7+ still streams usable thinking summaries for the reasoning panel

### Security
- **Skill template shell expansion allowlist**: validate `!`cmd`!` fragments against a read-only command allowlist before running via `sh`, with null stdin and explicit stdio pipes
- Harden preview `port_detector` regex init with labeled expect/panic messages and a compile smoke test
- MCP `read_json_file` edge-case tests for truncated/empty JSON

### Refactoring
- Extract `useSpecWriterActions` hook from SpecWriterSlideOver (1,479 lines moved to a thinner component + dedicated hook with tests)
- Add `useAssistantAttachments` test coverage

### Testing
- **128 new Rust unit tests** covering IPC command modules: `api_logs`, `clone`, `guide`, `preview`, `specwriter`, `startup`, `super_bro`, `terminal`
- 2 new TypeScript integration tests for Self-Drive navigation safety

### Documentation
- Updated user guide and Super-Bro knowledge for v1.1.0 permission modes, status bar, shortcuts, safety guidance, and Python/uv install hints

## 1.1.0

### Claude Code CLI Compatibility
- **Permission modes**: full support for `auto`, `dontAsk`, and `bypassPermissions` modes (Claude Code 2.1.x) — Rust session variants, approval-server behavior, ModeSelector labels, and keyboard cycle
- **Thinking blocks restored**: always pass `alwaysThinkingEnabled` and `showThinkingSummaries` in `--settings` to counteract CLI v2.1.90+ defaulting thinking summaries off
- **ExitPlanMode plan path**: prefer `plan` and `planFilePath` from the CLI tool input over the Write observer; show plan preview text in the modal and open from in-memory content

### Plan Mode UI
- **Pending-plan banner** in the input area with Review / Implement / Dismiss actions — plan context persists after dismissing the modal so you can act on it later
- Shared `implementPendingPlan` action extracted for reuse across modal and banner
- **AskUserQuestion modal** now displays and submits the full question text instead of header-only labels

### Self-Drive
- **Evidence-based verification**: strict preamble requiring per-item `file:line` evidence, batch-of-10 progress accounting, and explicit PASS/FAIL/SKIPPED output
- Anti-skimming guards: detect batch-pass language, require quoted file evidence for passed checks, and enforce full per-check coverage before advancing
- Mandatory `**Verification Prompt:**` blocks per session in spec prompts

### SpecWriter
- Audit file integration: loading `*.audit.md` selects the audit preview and clears spec content (and vice versa); clearing paired files resets both previews
- Tab-aware copy/edit: Copy uses the active tab content; Edit always targets the spec
- Verify hardening requirements spec added to documentation

### Model Updates
- Align Claude Opus model ID to `claude-opus-4-7` across frontend, backend, pricing, and fixtures

### Code Quality
- Consolidate repeated time/duration formatting and click-outside behavior into shared helpers
- Replace ignored Rust `emit`/`write` errors with explicit `warn`/`error` logging in assistant streaming, preview log writes, and legacy hook cleanup
- Dependency overrides updated (dompurify, undici, flatted, picomatch, brace-expansion)

## 1.0.9

### Input Area
- **Message history picker**: press ArrowUp in the input to open a dropdown of recent user prompts (deduplicated), with keyboard navigation and select-to-fill — quickly re-send or edit previous messages

### Implementation Guide
- **Per-session Verification Prompt**: parse `**Verification Prompt:**` fenced blocks from session plans, prefer them over generic verify prompts, and show a "Verify for me" button on guide session cards even without checklist items
- **Unload Guide**: new action in the Guide panel to unload an active guide (blocked once started), freeing the panel for a different spec
- **Replace Guide confirmation**: when loading a guide from a saved spec while another guide is already active, a confirmation modal prevents accidental overwrites
- **Safety gates**: guide loading is blocked during in-progress sessions and Self-Drive runs

### SpecWriter
- Specs can now load a guide directly from the saved-specs list with replace confirmation
- Stronger spec prompts: cross-session consistency rules, mandatory NOT-negative checks, optional verification-prompt template for complex sessions, and anti-fabrication / `[ASSUMPTION]` guidance

### CLI Slash Commands
- Add `bug`, `loop`, and `usage` to the CLI-only command list

## 1.0.8

### SpecWriter
- **Recognize Guide** action on the toolbar for saved specs that don't yet have a linked guide — runs `parseSessionPlan` + `createGuide` and opens the Guide tab on success, with toasts for already-existing or invalid multi-session plans
- Parse "Implementation Plan" and "Specification" title variants, not just "Session Plan" — and if there is no `## Session Plan` section, fall back to scanning the whole markdown for `### Session N` blocks
- Plan Complete modal: the plan file row is now an actionable control that focuses the file in File Viewer and closes the modal

### Assistant Panel
- Scroll to the latest message when switching back to the Assistant tab, so returning to a long conversation lands on the bottom instead of wherever the previous tab was scrolled

## 1.0.7

### Claude CLI Integration
- Parse `terminal_reason` on result and turn_complete events, and `UsageInfo.iterations` (CLI v2.1.97+)
- Treat user-interrupts (`aborted_streaming`) as a normal turn completion instead of a process error, so cancelling mid-stream no longer surfaces as a failure
- Auto-approve the new Monitor tool in the inline PreTool hook and the approval server
- Add `~/.codemantis/title-hook.sh` and UserPromptSubmit hook wiring in the CLI `--settings` JSON

### SpecWriter
- Audit-over-spec streaming: when early chunks look like a spec but the final content is an audit, restore the pre-stream spec preview and keep the audit tab routing correct
- Auto-switch to the audit tab only the first time an audit appears; manual tab switches are now preserved across re-renders
- "Use Guide" button activates only when the saved file matches the guide's expected filename; stale paths are cleared after a write→done transition
- Info toast when saving a spec that has no "Session Plan" section, so guide generation expectations are clear

## 1.0.6

### Code Quality
- Fix all 27 clippy errors (Rust 1.94.0): suppress `too_many_arguments` on Tauri commands and database helpers, replace `map_err` with `inspect_err`, use `contains()` over `iter().any()`, adopt `clamp()`, `strip_prefix()`, `next_back()`, and the `?` operator where clippy recommends them
- CI clippy gate now passes clean

## 1.0.5

### Plan Mode
- Capture plan files written by Claude into the UI and auto-open them in the File Viewer when the session exits plan mode
- Show the plan filename in the Plan Complete modal for quick reference

### Activity Feed
- Show in Finder action on file detail panels — reveal the current file directly in macOS Finder

### Preview
- Probe dev-server ports on both IPv4 (127.0.0.1) and IPv6 (::1) so Vite and other servers binding to IPv6 are detected correctly

### Self-Drive
- Smarter resume logic: use per-session flags (done, promptSent, verifyRequested) instead of currentPhase so pausing during a fix cycle no longer skips back to verify
- Handle completed sessions by advancing to the next phase and retry unsent prompts after failed starts

### SpecWriter
- Rewrite `docs/specs/*.md` references in session prompts to the actual saved spec filename so implementation plans always point at the correct file

### Approval Server
- Remove AskUserQuestion from the plan-mode auto-allow list so interactive prompts go through user approval

### Documentation
- Updated README with Self-Drive highlights, screenshots, and refreshed demo video

## 1.0.4

### Self-Drive
- Scope autonomous runs to the active project — switching projects no longer leaks state from a running session into another
- Mirror every orchestrator prompt into the chat panel as a synthetic user message so users can see exactly what Self-Drive sent during autonomous execution
- Honor live setting changes (run tests, auto-commit) mid-run instead of using the cached startup config

### Approval Server
- Replace blanket Plan-mode denial with a fine-grained allowlist (Write, Edit, Agent, web tools, tasks, LSP, etc.) so the CLI can use planning tools when it skips permissions
- Tools not on the allowlist (e.g. Bash) now fall through to the normal user-approval flow instead of being auto-denied

### SpecWriter
- Require deployment steps (migrations, deploy, install, restart) in implementation-guide phases that produce deployable artifacts
- Add deployment-aware verify-before-next-session guidance with concrete examples for databases, Edge Functions, containers, and dependencies

### Documentation
- Updated user guide with Self-Drive decision cards and confidence-guard behavior
- Added Self-Drive and SpecWriter guide screenshots

## 1.0.3

### Self-Drive Enhancements
- Decision cards with confidence guards and prompt visibility
- Users can review and approve each orchestrator decision before execution

### SpecWriter
- Promote assistant replies to spec content and broaden spec detection patterns

### Documentation
- Updated user guide for v1.0.3 with Self-Drive decision cards, confidence guards, and version bump

## 1.0.2

### Self-Drive Mode (New Feature)
- Autonomous implementation guide with orchestrator and settings
- Session-scoped chat events and advance phase handling

### SpecWriter
- Persist drafts and keep panel mounted when closed
- Fix badge showing "Working..." when done but still streaming
- Derive hasGuide from guideStore; sync Self-Drive mode in UI
- Fix approval-server session IDs, Plan mode writes, and spec prompts

### Testing Infrastructure
- 296 new tests with comprehensive test infrastructure and testing docs
- Complete test coverage plan: hooks, components, integrations, Rust expansion
- Resolve all pre-existing TypeScript type errors in test files
- Add enforcement rules to CLAUDE.md to prevent test coverage drift

### UI & Fixes
- Semantic font-size tokens from --font-size-base
- /clear resets approvals without clearing activity feed
- Increase Super Bro strip max height
- Fix stale screenshot events after preview unmount; unique attachment IDs

## 1.0.1

- SpecWriter: batched completeTurn, persist spec content, and audit tab sync
- Super Bro: testing context awareness and inline test coverage guidance

## 1.0.0

CodeMantis 1.0.0 — the first stable release. See the full release notes on GitHub.

- First public stable release
- Session logs: auto-save toggles, always restore history, avoid message ID collisions
- Expanded README with product walkthrough, screenshots, and demo assets

## 0.9.9

### Terminal & Preview Fixes
- Fix: clear NODE_PATH on PTY spawn to prevent stale module resolution
- Fix: avoid duplicate/stale port probes and stop probing after PTY exit
- Fix: cm-ipc navigation fallback for toolbar when CSP blocks fetch
- Fix: PTY exit handling for preview dev servers

### SpecWriter Improvements
- Default planning model to Gemini 3 Flash; default provider to Claude Code
- Weak-model warning and stronger feature-mode navigation instructions
- Tighten session sizing, audit handoff, and clean-output prompt rules

### Super Bro
- Clarify CLI-only suggested prompts vs visual checks in persona docs

## 0.9.8

- Super Bro: surface CLAUDE.md presence in project context and coaching prompts

## 0.9.7

- Guide & Super Bro: deterministic verify prompts and completed-guide context awareness
- SpecWriter: widen slide-over layout and ensure verification audit outputs COMPLETE marker
- Test coverage for AUDIT_FILE_PATTERN matcher

## 0.9.6

- Super Bro: per-trigger debounce, 10-second rate limit, and deferred retry to prevent API spam
- Guide: track prompt-sent and verify-requested states for better session flow
- Refactor Super-Bro API helpers into shared utilities

## 0.9.5

### Super Bro — Contextual AI Coach
- Introduce Super Bro: a contextual coaching assistant that watches your coding sessions and offers proactive guidance
- Deployment-aware context with live git status and post-change knowledge modules
- Per-project enable/disable with eye-icon toggle and status dot
- Auto-dismiss guidance strip after 60 seconds; all-good state when no issues detected
- Gate providers on configured API keys; model lists from AI_MODELS and OpenRouter
- Dedicated Super-Bro tab in Settings and API Logs
- Bundle Super-Bro knowledge resources with the app

### Updater & Session Improvements
- Centralize update polling with macOS menu "Check for Updates" command and shared state
- Pass `--name` to Claude CLI for named sessions; flatten extra rate limit fields
- Cost-by-feature matrix on API cost log tab

### UI & UX Polish
- Help chat busy banner with elapsed timer and input hints
- Include verification audit path in Verify-for-me prompt
- Align SpecWriter typography with text-ui and text-chat tokens
- Fix preview port-detection race with Layer 3 port scan
- Bottom padding on main chat column

## 0.9.4

- Tighten SpecWriter system prompts: enforce structured output format, session-plan warning blocks, section-scoped Claude prompts, multi-session audit notes, and VERIFY line pre-counting

## 0.9.3

- Preview toolbar console via Tauri emit with scoped remote capability
- Fix preview toolbar via approval-server fetch and reliable macOS screenshots

## 0.9.2

- Persist right-panel subviews and add uiStore coverage
- Default-expand reasoning panel content
- Auto-focus chat inputs and polish assistant/spec send-stop controls
- Add tab tooltips and Esc-to-stop for SpecWriter streaming
- Preview loading modal and more resilient startup polling
- Expand user guide; fix preview dev server retry and cleanup
- Add reasoning panel and spec writer guide screenshots

## 0.9.1

- Persist session chat logs with retention and restore on resume
- Add Back control to Project Log view
- Migrate app data to dev.codemantis.myapp and simplify build
- Activity-feed reasoning panel and smarter spec options
- Unify MCP modal chrome and validation in McpModal shell
- Fix preview toolbar actions without fetch for strict CSP pages
- Test coverage for preview toolbar, bridge ordering, and CORS preflight

## 0.9.0

- Stream and display extended thinking in chat
- Centralize send-shortcut handling and default to Enter to send
- Add Back button to Session History view
- Rename History tab to Session History
- Open API log file in Finder from settings
- Fix focus main window shortly after launch
- Simplify MCP modal headers and surface template info in form
- Preview console bridge tests, local preview improvements, and approval server enhancements

## 0.8.12

- SpecWriter displayContent for option prompts and bullet multi-select
- Manual preview URL fallback when dev server fails
- Guide verify prompt and spec preview toolbar polish
- Fix inline text attachments for Claude Code assistant and SpecWriter
- Test coverage for preview URL dialog and prompt flow

## 0.8.11

- Modular assistant/spec UI, Rust stream routing, and test sweep
- Parse OpenRouter API errors and improve API logs UI

## 0.8.10

- Add implementation guide sessions and right-panel guide UI
- Add shared OpenRouter model picker and fix meta-model pricing

## 0.8.9

- Route SpecWriter through provider-aware conversation pipeline
- Unify popover layering with shared Portal wrapper
- Add external link guard and richer error/spec parsing helpers

## 0.8.8

- Add OpenRouter provider support across settings and assistant flows
- Add local-only preview guard with loopback detection
- Fix preview bridge layout offsets for toolbar

## 0.8.7

- Fix Docker scaffold verification
- Fix update notification bar layout
- Sync lockfile for 0.8.6

## 0.8.6

- Add friendly error UX with translated error messages and ErrorCard component
- Add project picker busy state during session start
- Refreshed app icons (edge-to-edge source)
- Expand scaffold allowlist and improve template/settings UX

## 0.8.5

- Refresh app icons and sync lockfile
- Add community templates, Code of Conduct, and README/CONTRIBUTING updates

## 0.8.4

- Fix app icon: use correct source with rounded corners (CodeMantisIcon.png)
- Fix git log NUL format and add git command tests

## 0.8.3

- Add UpdateModal: confirmation dialog with progress bar for downloading and installing updates
- "Check Now" in Settings opens the update modal directly when an update is found
- Auto-check banner "Update Now" opens the modal instead of downloading inline

## 0.8.2

- Add recent commits popover in sidebar with git log integration
- Fix DMG icon: regenerate all icons from 1024x1024 source (was broken 16x16)
- Fix CI: add packageManager field for pnpm setup in GitHub Actions

## 0.8.1

- Add in-app auto-update: checks for updates on launch, shows notification banner
- Add "Check for Updates" button in Settings > General
- Configure signed + notarized macOS builds via GitHub Actions
- Build universal binary (Intel + Apple Silicon) with Apple Developer ID signing
- Generate updater artifacts (latest.json) for seamless auto-updates

## 0.8.0

- Version bump to 0.8.0 (pre-release)

## 0.5.5

- Add contextual activity labels: tool-specific status messages (Reading file, Editing code, Running command, Searching code, etc.)
- Add tool_progress heartbeat parsing for liveness detection during long-running tool operations
- Add compacting_status and compact_complete event handling with visual indicator
- Add rate_limit_warning event parsing with utilization tracking (shown when >50%)
- Add SessionStatusBar: persistent bottom bar showing status dot, elapsed time, tokens, cost, context %, rate limit
- Add elapsed timer on ThinkingIndicator ticking from busySince timestamp
- Add tool elapsed time display for long-running tools (>5s)
- Add message timestamps on user and assistant message bubbles
- Add "took Xm Ys" duration display on completed assistant messages
- Add project tab busy indicators: green pulsing dot (active), yellow static dot (stale >30s)
- Improve stale detection to progressive escalation instead of single-shot toast
- Add SessionActivityInfo interface and busySince/sessionCompacting/rateLimitUtilization state to session store
- Add comprehensive transparency test suite (event-classifier-transparency.test.ts)

## 0.5.4

- Fix ProcessExited event emitted to wrong channel causing sessions stuck in "busy" state forever
- Fix race condition: delay ProcessExited 2s to let message router finish draining buffered events
- Fix cross-project contamination: scope file viewer state per-project (openFiles, activeFile, editedContents, dirtyFiles)
- Fix cross-project tool approval leakage: scope alwaysAllowedTools per project path
- Fix auto-open guard: only open files/switch tabs for the active session, not background projects
- Add project name to tool approval modal so users know which project is requesting
- Add `checkProcessAlive` Tauri command for stale connection health checks
- Reduce stale detection aggressiveness: 120s timeout, toast-only (no inline messages), auto-recovery when process dead
- Fix auto-scroll on send: chat scrolls to bottom when new message sent while scrolled up
- Fix "New messages" button background from transparent to opaque

## 0.5.3

- Add file upload, image paste, and drag-drop attachment support to Assistant panel
- Add multimodal image support for API providers (OpenAI, Gemini, Anthropic) with base64 encoding
- Add AssistantAttachmentBar component for per-session attachment display
- Fix slash command palette: solid background, shadow, z-index layering, hide shortcuts when palette open
- Fix slash command execution: /clear restarts CLI, /context shows token usage, /cost shows stats, /exit closes tab, /rename renames tab
- Route CLI-only commands (/model, /config, etc.) to CLI overlay instead of sending as chat text
- Show info message for unknown commands instead of sending raw text
- Add `renameAssistant` action to assistant store
- Add per-session attachments map to assistant store
- Show per-provider default model dropdowns in Settings > Assistant (all providers visible at once)
- Add model submenu to provider selection when creating new assistant tabs
- Add diagnostic logging for API call logging (insert success/failure)

## 0.5.2

- Enlarge Settings modal ~30% (720×560 → 940×730) to better fit 8-tab layout
- Add 5 new AI models: GPT-5.4, Gemini 2.5 Pro, Gemini 3.0 Flash, Gemini 3.1 Pro, Gemini 3.1 Flash Lite

## 0.5.1

- Restructure Settings: split AI Providers tab into separate AI Providers (API keys + pricing) and Changelog (toggle, provider/model, prompt) tabs
- Add Assistant settings: default provider and model selection for new assistant tabs
- Log assistant API calls to database (visible in Settings > API Logs)
- Fix provider dropdown background from near-invisible to solid opaque color
- Read default model from settings when creating new assistant tabs

## 0.5.0

- Add multi-AI assistant support: create assistant tabs with OpenAI, Google Gemini, or Anthropic API providers alongside Claude Code
- Add Rust SSE streaming backend for all 3 API providers (OpenAI, Gemini, Anthropic) with proper token counting
- Add provider selection dropdown when creating new assistant tabs
- Add provider badges (CC/OA/G/A) on assistant tabs with color coding
- Add per-session token usage tracking and cost display on tabs
- Add "Chat only" capability indicator for API assistants
- Add slash command palette (/ commands) support in Claude Code assistant tabs
- Expand textarea input to 4-row minimum (96px) with 200px max height
- Rename settings fields: `changelogApiKeys` → `apiKeys`, `changelogModelPricing` → `modelPricing` (shared across changelog + assistant)
- Add serde aliases for backward-compatible settings migration
- Add `assistantDefaultProvider` and `assistantDefaultModel` to settings
- Refactor `AssistantInstance` type: add `provider`, `model`, `sessionCost` tracking
- Refactor `useAssistantSession` hook: branch `createAssistant` and `sendMessage` by provider type
- Add 37 new tests: assistantStore (18), assistant-provider types (12), AssistantTabs component (7)

## 0.4.1

- Add model selection dropdown in Changelog settings (per provider: OpenAI, Gemini, Anthropic)
- Update available models: GPT-4.1/5-Nano/5-Mini, Gemini 2.5 Flash Lite/Flash, Claude Sonnet 4.6/Haiku 4.5
- Track API token usage and cost for each changelog generation call
- Add pricing module with per-model cost calculation
- Add `api_logs` database table with auto-migration
- Add "API Logs" tab in Settings showing cost summary and scrollable call history
- Auto-delete API logs older than 5 days on tab open
- Pass selected model to `test_changelog_api_key` for accurate validation
- Fix: question text not showing in "Claude has a question" modal (tool input was empty at ContentBlockStart)
- Fix: answers in question modal now sent as regular user messages (old tool_result format was rejected by CLI)
- Fix: changelog model validation ensures model matches the selected provider (prevents cross-provider model mismatch)

## 0.4.0

- Rename project from ClaudeForge to CodeMantis across all source files, configs, and UI strings
- Update Tauri identifier from `com.claudeforge.app` to `dev.codemantis.app`
- Rename data directories from `~/.claudeforge/` to `~/.codemantis/` and `.claudeforge/` to `.codemantis/`
- Add localStorage migration for recent projects key
- Delete `code_example_ui/` directory and `public/vite.svg`
- Move `_requirements/` to `docs/requirements/`
- Add `.codemantis/` to file tree ignore list and `.gitignore`
- Add MIT LICENSE file
- Add CONTRIBUTING.md with dev setup, test, PR process, and code standards
- Add error recovery: "Restart Session" button on process crash, rate limit auto-retry with countdown, and stale connection timeout detection
- Add context meter toast notifications at 80% (warning) and 95% (urgent) thresholds suggesting /compact
- Add "Shortcuts" tab in Settings modal showing all keyboard shortcuts grouped by category
- Add GitHub Actions release workflow for building macOS .dmg on version tags

## 0.3.4

- Add trivia facts that rotate every 10 seconds while Claude is working, shown as a card below the ThinkingIndicator
- Curated dataset of 10,500 facts (1,050 topics × 10 pieces) bundled from input_data/trivia_dataset.json
- Easter egg facts shown every 50th rotation with distinct gold-accented styling
- No consecutive topic repeats; fade-in animation on each new fact
- Custom hook (useTriviaRotation) manages lifecycle, interval, and easter egg scheduling

## 0.3.3

- Fix incorrect MCP template configs: Supabase now uses HTTP cloud type (not stdio), Slack uses SLACK_TEAM_ID (not SLACK_APP_TOKEN), PostgreSQL passes connection URL as argument (not env var), Stripe uses STRIPE_SECRET_KEY with --tools=all flag, Cloudflare URL corrected to include /mcp path
- Add setup hints to templates — contextual guidance shown as info box in the form (OAuth instructions, where to get API keys, how to configure arguments)
- Add help descriptions to all form fields: Name, Scope, Type (with dynamic description per type), Command, Arguments, URL
- Widen MCP modal (640px → 780px) so env var names display fully without truncation
- Widen env var key column (128px → 192px) and add mouseover tooltips on key/value inputs
- Add headers support to template system for HTTP templates

## 0.3.2

- Add MCP server template gallery with 15 pre-configured servers organized in 3 categories (No Setup Required, Requires API Key, Cloud Services)
- Clicking "Add Server" now shows a template picker; selecting a template auto-fills the form with name, command, args, env vars, or URL
- "Manual Configuration" option available for power users who want a blank form
- Cancel from a pre-filled form returns to the template picker, not the server list

## 0.3.1

- Add MCP Server Management modal for viewing, adding, editing, and deleting MCP servers across global (~/.claude.json) and project (.mcp.json) scopes
- Support all three MCP server types: stdio, http, and sse with type-specific configuration forms
- Rust backend reads/writes MCP config files using serde_json::Value to safely preserve all other keys in ~/.claude.json
- Atomic file writes via temp file + rename for safe config updates
- Scope filter toggle (All/Global/Project) and inline delete confirmation
- Environment variable and header values masked by default with eye toggle to reveal
- Add Blocks icon button in title bar and Cmd+Shift+M keyboard shortcut to open MCP modal

## 0.3.0

- Add native slash command engine with three-tier routing: skills expand into prompts (no kill/respawn), built-in commands execute natively, CLI-only commands fall back to CliOverlay
- Add command palette dropdown (type `/` in input area) with fuzzy search, keyboard navigation, and category badges
- Discover custom skills from `.claude/commands/` and `.claude/skills/` directories (project and user level)
- Expand skill templates with `$ARGUMENTS`, positional args, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`, and shell command substitution
- Native built-in commands: `/clear`, `/config`, `/cost`, `/context`, `/help`, `/exit`, `/rename`, `/init`, `/doctor`
- CLI-only commands (`/compact`, `/model`, `/mcp`, etc.) open CliOverlay with command pre-typed
- `Cmd+/` remains as direct CLI escape hatch

## 0.2.9

- Detect CLI process exit and emit `ProcessExited` event to frontend with exit code, stderr tail, and elapsed time
- Show auth failure guidance (with `claude login` instructions + toast) when CLI exits quickly with auth-related stderr
- Show error message with stderr when CLI exits with non-zero code
- Wire `AskUserQuestion` tool to the existing QuestionModal so interactive CLI questions are surfaced to the user
- Add `updateSessionStatus` action to session store for process lifecycle transitions

## 0.2.8

- Add Git status card in sidebar showing branch name, uncommitted change count, last commit time, and last push time
- Add `get_git_status` Tauri command with branch, porcelain status, and remote log queries
- Auto-polls every 10 seconds and refreshes alongside file tree updates

## 0.2.7

- Add session history & resume: persist CLI session ID and model when closing sessions
- Add "Claude History" tab in session sub-tabs to browse and resume closed sessions
- Add `list_session_history` Tauri command with changelog headline previews
- Extend `create_session` to accept `resume_cli_session_id` for resuming prior conversations
- Add database migration for `cli_session_id` and `closed_at` columns on sessions table

## 0.2.6

- Fix context meter showing only non-cached tokens (10K instead of actual context usage)
- Include all token categories (input + cache_creation + cache_read) per Anthropic API spec
- Estimate per-call context window usage by dividing aggregated turn usage by API call count

## 0.2.5

- Add tool badges for TodoWrite, TodoRead, ToolSearch, WebSearch, WebFetch, and Agent tools (task, search, agent categories)
- Fix context token calculation that was double-counting cache tokens as additive instead of subsets of input_tokens

## 0.2.4

- Fix terminal black border by overriding xterm's hardcoded `#000` viewport background
- Set terminal container background to match xterm theme for seamless edges
- Increase terminal padding from 4px to 8px for better breathing room

## 0.2.3

- Fix file tree hiding dotfiles and common directories (`.gitignore`, `.lovable`, `dist`, `build`)
- Replace blanket dotfile filter with explicit ignore list for truly noisy entries (`.git`, `node_modules`, `target`, etc.)

## 0.2.2

- Add "Plan" category to changelog entries for plan-mode sessions
- Pass session mode context to changelog LLM prompt so plan-mode turns are categorized correctly
- Show Plan label with Map icon in Changelog feed

## 0.2.1

- Add bottom padding to Activity Feed, Changelog Feed, and Assistant Panel to prevent content clipping
- Reverse activity feed sort order to show newest entries first
- Merge activity entries from all sessions (main + assistants) per project with source labels
- Add multi-tab file viewer with tab bar, per-file dirty state, and independent editing/saving
- Add `sessionId` to activity entries for cross-session tracking

## 0.2.0

- Add "Thinking..." animated indicator when assistant is processing
- Add right-click context menu on user messages (Copy, Use in Chat, Add as Shortcut)
- Add "Use in Chat" to send assistant messages to the main input area
- Add assistant shortcut system with quick-access chips below the input
- Add "Assistant" tab in Settings for managing shortcuts
- Add version number display on the welcome screen
- Add tooltips to assistant tab close buttons and tab names
- Establish versioning workflow (semver across package.json, Cargo.toml, tauri.conf.json)

## 0.1.0

- Initial release
- Three-panel layout with sidebar, chat, and right panel
- Claude Code CLI integration with streaming JSON
- Tool approval modal
- Activity feed with tool operation entries
- File tree sidebar
- Terminal panel with PTY support
- Multiple session tabs
- Assistant panel with separate Claude sessions
- Changelog generation with LLM providers
- Six color themes
- Settings modal with General, Terminal, Quick Commands, and Changelog tabs
