---
name: release
description: >
  Complete release checklist for CodeMantis. Syncs help content, runs all quality gates
  (TypeScript type check, lint, unit tests, integration tests, Rust tests, clippy, plugin
  alignment), bumps version across all three locations, writes release notes, commits,
  tags, pushes, monitors both CI workflows, updates GitHub release notes, and publishes.
  Use: /release [major|minor|patch] — defaults to patch.
  Trigger keywords: release, publish, ship, version bump, new version, cut a release.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Edit
  - Write
  - Agent
  - Monitor
  - Skill
---

# Release — CodeMantis Full Release Checklist

> This skill is the single source of truth for cutting a CodeMantis release.
> Every step is mandatory. Do NOT skip quality gates. Do NOT publish without green CI.

## Input

`$ARGUMENTS` controls the version bump type:

| Argument | Effect |
|----------|--------|
| *(empty)* / `patch` | Bump patch: `1.0.5` -> `1.0.6` |
| `minor` | Bump minor: `1.0.5` -> `1.1.0` |
| `major` | Bump major: `1.0.5` -> `2.0.0` |

---

## Phase 0: Update Help Content (Pre-Release)

**Run BEFORE quality gates.** This syncs the in-app user guide and Super-Bro knowledge
files with current source code. It may modify files, so it must be committed before
proceeding.

### 0.1 Run the update-help-content command
```
/update-help-content
```
This invokes `.Codex/commands/update-help-content.md` which:
- Compares the user guide (`docs/user-guide/codemantis-complete-guide.md`) against source files for shortcuts, slash commands, templates, settings, etc.
- Updates the guide and copies it to `src-tauri/resources/user-guide.md`
- Syncs Super-Bro knowledge files in `src-tauri/resources/super-bro/`

### 0.2 Commit help content updates
If Phase 0.1 produced changes:
```bash
git add docs/user-guide/ src-tauri/resources/user-guide.md src-tauri/resources/super-bro/
git commit -m "docs: sync user guide and Super-Bro knowledge for vX.Y.Z"
```
If no changes were needed, skip this commit and proceed.

---

## Phase 1: Pre-Flight Quality Gates

**All gates must pass before ANY version bump or commit.**

Run gates 1.1–1.4 in parallel (tsc, lint, clippy, and the commit log review).
Then run 1.5–1.8 in parallel (all four test suites).
Finally check 1.9 (plugin alignment).

### 1.1 TypeScript Type Check
```bash
pnpm tsc --noEmit
```
- **Must produce ZERO errors.** Type errors in test files count.

### 1.2 ESLint
```bash
pnpm lint
```
- **Must produce ZERO errors.**

### 1.3 Rust Clippy (CRITICAL)
```bash
cd src-tauri && cargo clippy -- -D warnings
```
- **Must produce ZERO errors.**
- This is the gate that runs in CI (`test.yml` → rust job → Clippy step).
- The release workflow does NOT run clippy — only the test workflow does.
- If clippy fails, CI will show the `rust` job as failed even though the release build succeeds.
- **CI may run a newer Rust version than local.** If CI fails with a new lint not caught locally, fix and retag.

### 1.4 Review Commits Since Last Release
```bash
git log --oneline $(git tag --sort=-v:refname | head -1)..HEAD
git log --stat $(git tag --sort=-v:refname | head -1)..HEAD --no-merges
```
- Run this early so release notes can be drafted while tests run.

### 1.5 TypeScript Unit Tests
```bash
pnpm test
```
- **Must produce ZERO failures.**
- Check test count against the floor in AGENTS.md (currently ≥2,762).

### 1.6 TypeScript Integration Tests
```bash
pnpm test:integration
```
- **Must produce ZERO failures.**
- Floor: ≥84 tests (check AGENTS.md).

### 1.7 Rust Unit Tests
```bash
cd src-tauri && cargo test --lib
```
- **Must produce ZERO failures.**
- Floor: ≥1,030 tests (check AGENTS.md).

### 1.8 Rust Integration Tests
```bash
cd src-tauri && cargo test --test '*'
```
- **Must produce ZERO failures.**
- Floor: ≥10 tests.

### 1.9 Tauri Plugin Version Alignment
```bash
# Compare Cargo.lock resolved versions with npm installed versions
grep 'tauri-plugin-' src-tauri/Cargo.toml | grep -v '#' | while read line; do
  name=$(echo "$line" | sed 's/ =.*//');
  lock_ver=$(grep -A1 "name = \"$name\"" src-tauri/Cargo.lock | grep version | head -1 | sed 's/.*"\(.*\)".*/\1/');
  echo "$name: lock=$lock_ver";
done
pnpm list @tauri-apps/plugin-dialog @tauri-apps/plugin-log @tauri-apps/plugin-opener @tauri-apps/plugin-process @tauri-apps/plugin-updater
```
- Tauri build fails if Rust crate and npm package major/minor versions diverge.
- **Preferred lockfile update method:** use `cargo update --workspace` instead of `cargo generate-lockfile` to avoid pulling unrelated dependency updates.

### Report Phase 1 Results
Print a summary table:

| Gate | Result | Count |
|------|--------|-------|
| tsc | ✓/✗ | — |
| lint | ✓/✗ | — |
| clippy | ✓/✗ | 0 errors |
| TS unit tests | ✓/✗ | N (floor X) |
| TS integration tests | ✓/✗ | N (floor X) |
| Rust unit tests | ✓/✗ | N (floor X) |
| Rust integration tests | ✓/✗ | N (floor X) |
| Tauri plugins | ✓/✗ | aligned/mismatched |

**If any gate fails, STOP and fix before proceeding.**

---

## Phase 2: Version Bump

Only proceed here after ALL Phase 1 gates are green.

### 2.1 Determine New Version
Read current version from `package.json`. Apply the bump type from `$ARGUMENTS` (default: patch).

### 2.2 Bump Version in All Three Locations
These MUST stay in sync — edit all three in parallel:

1. **`package.json`** → `"version"` field
2. **`src-tauri/Cargo.toml`** → `version` field under `[package]`
3. **`src-tauri/tauri.conf.json`** → `"version"` field

### 2.3 Update Cargo.lock
```bash
cd src-tauri && cargo update --workspace
```
- Use `--workspace` to avoid pulling unrelated dependency updates.
- Verify only the workspace crate version changed (output should say `Locking 1 package`).

---

## Phase 3: Release Notes

### 3.1 Write Release Notes in RELEASES.md
- Add a new `## X.Y.Z` section at the top (below the `# CodeMantis Releases` header).
- Group changes by area (e.g., Codex CLI Integration, Self-Drive, SpecWriter, Plan Mode, UI, Code Quality, Documentation).
- Write meaningful descriptions — explain *what changed and why*, not just commit subjects.
- Follow the existing format in RELEASES.md.
- For minor/major bumps, note the scope increase in the notes.

---

## Phase 4: Commit, Tag, Push

### 4.1 Stage and Commit
```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json RELEASES.md
git commit -m "release: vX.Y.Z"
```
- Only stage version/release files. Do NOT use `git add -A` unless code changes are part of this release commit.

### 4.2 Tag
```bash
git tag vX.Y.Z
```

### 4.3 Push Branch and Tag
```bash
git push origin dev && git push origin vX.Y.Z
```
- Pushing the tag triggers **two** GitHub workflows:
  1. **`release.yml`** (triggered by `v*` tag push) — builds universal macOS binary, signs, notarizes, creates draft GitHub release
  2. **`test.yml`** (triggered by push to `dev` branch) — TypeScript checks + Rust tests + **clippy**

---

## Phase 5: Monitor BOTH Workflows

**You MUST monitor both workflows.** A green release build with a red test workflow means clippy or tests failed — the release should NOT be published.

### 5.1 Find Run IDs
```bash
gh run list --workflow=release.yml --limit 1
gh run list --workflow=test.yml --limit 1
```

### 5.2 Start Monitors
Launch **two** Monitor tools in parallel:

**Test workflow monitor** (timeout 600s):
```bash
run_id=<TEST_RUN_ID>; while true; do
  run_state=$(gh run view "$run_id" --json status,conclusion --jq '"\(.status) \(.conclusion)"' 2>/dev/null || echo "fetch_error")
  if echo "$run_state" | grep -q "completed"; then
    echo "TEST WORKFLOW FINISHED: $run_state"
    gh run view "$run_id" --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"' 2>/dev/null || true
    exit 0
  fi; sleep 30
done
```

**Release build monitor** (timeout 1500s):
```bash
run_id=<RELEASE_RUN_ID>; while true; do
  run_state=$(gh run view "$run_id" --json status,conclusion --jq '"\(.status) \(.conclusion)"' 2>/dev/null || echo "fetch_error")
  if echo "$run_state" | grep -q "completed"; then
    echo "RELEASE BUILD FINISHED: $run_state"
    exit 0
  fi; sleep 30
done
```

**IMPORTANT:** Use `run_state` as the variable name — `status` is read-only in zsh.

### 5.3 Timing Expectations
- **Test workflow:** 3–5 minutes
- **Release build:** 10–20 minutes (compilation + code signing + Apple notarization)
- Apple notarization can add 5+ minutes; this is normal.

### 5.4 On Test Workflow Failure
- **DO NOT publish the release.**
- Fetch failed logs: `gh run view <run_id> --log-failed 2>&1 | tail -40`
- Common cause: CI running a newer Rust version with new clippy lints not caught locally.
- Fix the issue, commit the fix, then retag and force-push:
  ```bash
  git tag -d vX.Y.Z && git tag vX.Y.Z
  git push origin dev && git push origin vX.Y.Z --force
  ```
- Re-monitor both workflows from Phase 5.1.

### 5.5 On Release Build Failure
- Fetch failed logs: `gh run view <run_id> --log-failed 2>&1 | tail -40`
- Common failures:
  - **Tauri plugin version mismatch:** bump npm package to match Cargo.lock (see Phase 1.9)
  - **Apple notarization 403:** expired/unsigned Apple Developer agreement — user must accept at developer.apple.com, then re-run: `gh run rerun <run_id>`
- For code fixes: commit, retag, force-push (same as 5.4).
- For Apple issues: `gh run rerun <run_id>` (no code change needed).

---

## Phase 6: Publish

**Only publish when BOTH workflows are green.**

### 6.1 Verify Assets
```bash
gh release view vX.Y.Z --json name,isDraft,assets --jq '"Release: \(.name)\nDraft: \(.isDraft)\n\nAssets:\n" + ([.assets[] | "  - \(.name) (\(.size / 1048576 | floor)MB)"] | join("\n"))'
```
Expected assets:
- `CodeMantis_X.Y.Z_universal.dmg` (~48 MB)
- `CodeMantis_universal.app.tar.gz` (~47 MB)
- `CodeMantis_universal.app.tar.gz.sig` (signature)
- `latest.json` (updater manifest)

### 6.2 Update GitHub Release Notes
The release workflow sets a generic body (`"See the assets to download and install CodeMantis."`). **You MUST replace it** with the actual release notes from RELEASES.md:
```bash
gh release edit vX.Y.Z --notes "$(cat <<'EOF'
## What's New

<paste the release notes from RELEASES.md here, formatted as GitHub-flavored markdown>
EOF
)"
```

### 6.3 Publish Draft Release
```bash
gh release edit vX.Y.Z --draft=false
```

### 6.4 Report
Print the published release URL and a summary table:

| Phase | Status |
|-------|--------|
| 0. Help content sync | ✓ updated / ✓ no changes |
| 1. Quality gates (counts) | ✓ all green |
| 2. Version bump (old → new) | ✓ |
| 3. Release notes | ✓ |
| 4. Commit, tag, push | ✓ |
| 5. Both workflows green | ✓ |
| 6. GitHub notes + publish | ✓ |

---

## Quick Reference: What Can Go Wrong

| Failure | Cause | Fix |
|---------|-------|-----|
| Tauri build: version mismatch | `cargo generate-lockfile` bumped a plugin crate beyond npm version | `pnpm add @tauri-apps/plugin-X@Y.Z.W` |
| Clippy errors in CI only | CI has newer Rust (e.g., 1.95 vs local 1.94) with new lints | Fix the lint, commit, retag, force-push |
| Test count below floor | Tests removed or skipped | Restore tests; check for `test.skip` / `#[ignore]` |
| Apple notarization slow | Apple's service under load | Wait 5–20 minutes; not actionable |
| Apple notarization 403 | Expired/unsigned developer agreement | User accepts at developer.apple.com, then `gh run rerun` |
| Tag already exists on remote | Re-releasing same version | `git push origin vX.Y.Z --force` (confirm with user) |
| Release build OK but tests red | Clippy lint in test.yml, not in release.yml | Fix, retag, force-push — do NOT publish |

---

## Lessons Learned

- **Always run clippy locally before pushing.** The release workflow does NOT run clippy — only the test workflow does. A green release build does NOT mean clippy passed.
- **Use `cargo update --workspace`** instead of `cargo generate-lockfile` to avoid pulling unrelated dependency updates that cause plugin version mismatches.
- **Monitor BOTH workflows** — release.yml AND test.yml. Only publish when both are green.
- **`status` is a read-only variable in zsh** — don't use it in monitor scripts; use `run_state` or similar.
- **CI Rust version can differ from local.** New clippy lints may only trigger in CI. Check the Rust version in error output and fix accordingly.
- **Apple notarization failures (403)** are not code issues — they require the developer to accept updated agreements at developer.apple.com. Use `gh run rerun` after resolution instead of retagging.
- **Always update GitHub release notes** before publishing — the release workflow only sets a generic placeholder body.
- **Run `/update-help-content` before quality gates** so any help file changes are committed and tested as part of the release.
