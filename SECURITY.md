# Security Policy

CodeMantis takes security seriously. CodeMantis is a desktop app that wraps the Claude Code CLI, executes user-authorized tool calls, and stores session data on the user's machine — so even though it has no network-exposed services, security bugs can still affect users meaningfully (data exfiltration via crafted tool input, supply-chain risk through dependencies, code injection through CLI integration, etc.). This policy describes what to do if you find one.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security problems.** Public disclosure before a fix is published puts users at risk.

### Preferred: Private Vulnerability Reporting

GitHub's [private vulnerability reporting](https://github.com/codemantis-dev/codemantis/security/advisories/new) is the fastest and most reliable channel. It opens a private advisory thread between you and the maintainers, with built-in CVE coordination, fix-tracking, and a published advisory once we ship.

### Backup: Direct Email

If you prefer email or cannot use GitHub's flow, contact the maintainer directly:

> harald.reisinger@siriuspartners.eu

Please include "CodeMantis security" in the subject line so it doesn't get filtered.

## What to Include

The more of these you include, the faster we can verify and fix:

- The CodeMantis version (Help → About, or `package.json` `version` if you're building from source)
- The Claude Code CLI version (`claude --version`)
- macOS version
- A clear reproduction recipe — ideally one that's deterministic
- The impact you observed (crash, data exposure, code execution, privilege escalation, etc.)
- A suggested severity rating (CVSS optional but appreciated)
- Whether you've published anything publicly about this issue yet, and if so, where

## Our Commitments to You

- **Acknowledge** your report within **3 business days**
- **Initial assessment** (severity + reproducibility) within **7 business days**
- **Fix or mitigation plan** communicated back to you within **30 days** of the initial assessment for confirmed vulnerabilities; longer windows are negotiated explicitly
- **Public credit** in the published advisory and release notes if you'd like (and are not anonymous)
- **No legal action** for good-faith research — see "Safe Harbor" below

## Scope

In-scope:
- The CodeMantis Tauri/React/Rust source code in this repository
- Released DMG/`.app` artefacts published on the [Releases page](https://github.com/codemantis-dev/codemantis/releases)
- The auto-updater channel (`latest.json` published with each release)
- Tauri command surfaces and IPC (Rust `#[tauri::command]` functions and the React `invoke` boundary)
- The embedded approval HTTP server on `127.0.0.1` and the `PreToolUse` hook script
- SQLite database schema and migration logic (data corruption, injection, privilege escalation)

Out of scope:
- Vulnerabilities in the **Claude Code CLI itself** — please report those to Anthropic via [their channels](https://docs.claude.com/en/docs/claude-code/) or the [claude-code GitHub repository](https://github.com/anthropics/claude-code).
- Vulnerabilities in **third-party MCP servers** the user configures — report those to the MCP server's maintainer.
- Issues that require an attacker to already have full local code execution as the user (e.g. "if I edit your CLAUDE.md, I can…"). The trust boundary is "files written by an external party that the user opens or imports."
- Social-engineering attacks against the user (e.g. "the agent could be tricked into running rm -rf if you tell it to"). CodeMantis surfaces the agent's actions to the user; the user is the final authority on what runs.
- Self-inflicted issues from disabling security mitigations (e.g. removing `--dangerously-skip-permissions` guards in user code).
- Theoretical denial-of-service against the user's own machine (e.g. "if you start 1,000 sessions, RAM goes up").

## Supply Chain

CodeMantis depends on:
- **Rust** crates resolved by `src-tauri/Cargo.lock`, including the Tauri framework, `reqwest` (with `rustls-tls` only — `default-features` are explicitly disabled), `rusqlite`, and `axum`.
- **npm** packages resolved by `pnpm-lock.yaml`, including React 19, Vite, Tailwind, Radix, Monaco Editor, and `@tauri-apps/*` plugins.
- The user's locally-installed **Claude Code CLI** binary.

Dependabot security updates are enabled on this repository; vulnerabilities in tracked dependencies surface as alerts and are patched on a best-effort schedule (high-severity within days, others bundled into the next regular release). Versions of every dependency at release time can be inspected by reading the lockfiles for the corresponding tag.

## Code Signing & Distribution Integrity

- Released DMGs and `.app.tar.gz` bundles are **signed and notarized by Apple** before publication. Gatekeeper will refuse to launch a tampered binary.
- The auto-updater verifies a Tauri-generated cryptographic signature (`*.sig`) against the public key embedded in the app before applying any update.
- All releases are tagged with `vX.Y.Z` in this repository and reference an immutable commit SHA. The corresponding GitHub Actions workflow runs (`release.yml` and `test.yml`) are publicly auditable.

## Safe Harbor

We support good-faith security research and will not pursue civil or criminal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption while researching.
- Only interact with their own accounts and machines, not those of other users.
- Report any discovered vulnerabilities to us promptly through the channels above.
- Give us a reasonable window to fix issues before public disclosure (we aim for 90 days from initial confirmed report; we'll negotiate openly if more time is needed for complex issues).

If you are uncertain whether your research is in scope or follows this policy, please **ask first** via the channels above — we'd rather have a quick "yes, that's fine" than discover post-facto that something was misunderstood.

## Public Advisories

Confirmed vulnerabilities and their fixes are published as [GitHub Security Advisories](https://github.com/codemantis-dev/codemantis/security/advisories) and called out in the [release notes](RELEASES.md). Subscribe to the repository to be notified when new advisories are published.
