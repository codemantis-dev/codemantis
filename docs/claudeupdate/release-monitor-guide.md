# Claude Code Release Monitor — Operations Guide

The release monitor detects new Claude Code CLI versions, analyzes changelogs for CodeMantis-relevant changes, and runs live protocol verification against the real CLI.

**Location:** `~/.claude/skills/release-monitor/`

## Prerequisites

- Python 3.10+ (stdlib only, no pip dependencies)
- `claude` CLI installed and on PATH
- Active Claude Pro/Max subscription (for modes that launch the CLI)
- `gh` CLI authenticated (optional, for GitHub release notes)

## Quick Reference

| Command | What it does | API cost |
|---------|-------------|----------|
| `--check` | Version detection + changelog analysis | Zero |
| `--analyze` | Check + live protocol snapshot diff | 1 turn |
| `--deep` | Check + full protocol recording comparison | ~5 turns |
| `--baseline` | Record new baseline for current version | ~5 turns |
| `--report` | Show saved report for a version | Zero |

## Day-to-Day Usage

### 1. Check for new versions (recommended: daily)

```bash
cd ~/.claude/skills/release-monitor/scripts
python3 release_monitor.py --check
```

This is the primary workflow. Zero API cost. It:
- Detects the installed CLI version via `claude --version`
- Fetches the latest version from the npm registry
- Parses the local changelog at `~/.claude/cache/changelog.md`
- Classifies every new changelog entry by severity (CRITICAL / HIGH / MEDIUM / LOW / NONE)
- Maps CRITICAL and HIGH items to specific CodeMantis source files
- Saves a report to `~/.codemantis/release-monitor/reports/`

**Example output when a new version is detected:**

```
=== Release Monitor: Check ===

  Installed:     v2.1.87
  npm latest:    v2.1.87
  npm stable:    v2.1.77
  Last analyzed: v2.1.86

  Analyzing changelog: v2.1.86 → v2.1.87

  Found 18 changes across 1 version(s):
    CRITICAL: 0
    HIGH:     2
    MEDIUM:   4
    LOW:      3

  ACTION REQUIRED — CRITICAL or HIGH changes detected.

  Action Items:
    [HIGH    ] v2.1.87: Added NewTool for ...
              → ~/.codemantis/approval-hook.sh, src-tauri/src/claude/approval_server.rs

  Files to review: ...

  Run: python3 release_monitor.py --analyze  (for live protocol check)
```

### 2. Run protocol verification (when --check flags changes)

```bash
python3 release_monitor.py --analyze
```

Costs 1 API turn. Does everything `--check` does, plus:
- Launches the real Claude CLI
- Captures the `system/init` event
- Diffs it against the stored baseline (tools, agents, skills, fields, slash commands)
- Reports any additions or removals

### 3. Run deep protocol comparison (when --analyze shows changes)

```bash
python3 release_monitor.py --deep
```

Costs ~5 API turns. Does everything `--analyze` does, plus:
- Runs all 5 protocol recording scenarios (simple, tool-use, multi-turn, control, interrupt)
- Compares event type sequences against the baseline recordings
- Detects new event types, changed ordering, or structural differences

### 4. View a saved report

```bash
# Latest report
python3 release_monitor.py --report

# Specific version
python3 release_monitor.py --report 2.1.86
```

## After Implementing Changes

Once you've updated CodeMantis to support a new CLI version:

### Record a new baseline

```bash
python3 release_monitor.py --baseline
```

This captures the current CLI's protocol state as the new reference point:
- Saves the `system/init` snapshot (tools, agents, fields, etc.)
- Runs all 5 recording scenarios and saves them
- Updates the state file

**Important:** Only record a baseline after confirming CodeMantis fully supports the current CLI version. The baseline represents a known-good, verified state.

### Update the protocol reference

After recording a baseline, update the version stamp in the protocol reference document:

```
~/.claude/skills/cli-test-harness/references/protocol-reference.md
```

Change the `VERIFIED against` line to reflect the new version and date.

## Standalone Scripts

Each component can be run independently for debugging or targeted checks.

### Version checker

```bash
# Human-readable summary
python3 version_checker.py

# JSON output (for scripting)
python3 version_checker.py --json
```

### Changelog analyzer

```bash
# Analyze a specific version
python3 changelog_analyzer.py --version 2.1.86

# Analyze a version range
python3 changelog_analyzer.py --from 2.1.84 --to 2.1.86

# JSON output
python3 changelog_analyzer.py --from 2.1.84 --to 2.1.86 --json
```

### Protocol differ

```bash
# Capture and print init snapshot (1 API turn)
python3 protocol_differ.py --snapshot

# Capture and save as baseline (1 API turn)
python3 protocol_differ.py --snapshot --save

# Diff current CLI against stored baseline (1 API turn)
python3 protocol_differ.py --diff

# Diff against a specific baseline version (1 API turn)
python3 protocol_differ.py --diff --baseline 2.1.84

# Full recording comparison (~5 API turns)
python3 protocol_differ.py --deep-diff

# JSON output for any mode
python3 protocol_differ.py --snapshot --json
```

## Severity Categories

The changelog analyzer classifies entries into these categories:

| Category | Severity | What it means for CodeMantis |
|----------|----------|------------------------------|
| `protocol_breaking` | CRITICAL | Wire format changes (stream-json, NDJSON, event types) |
| `hook_change` | CRITICAL | Tool approval hook protocol changes |
| `cli_flag_change` | HIGH | CLI flags used by CodeMantis changed |
| `tool_change` | HIGH | New, renamed, or removed tools |
| `event_field_change` | HIGH | Event fields that CodeMantis parses changed |
| `control_protocol` | HIGH | Control request/response changes |
| `new_capability` | MEDIUM | New features CodeMantis could surface |
| `ui_relevant` | MEDIUM | Thinking, modes, context window changes |
| `performance` | LOW | Startup, memory, token usage changes |
| `irrelevant` | NONE | Terminal UI, IDE extensions, keyboard stuff |

Keywords for each category are configurable in:
```
~/.claude/skills/release-monitor/references/relevance-keywords.json
```

## File Mapping

When a change is flagged, the report maps it to CodeMantis source files:

| Change Type | Files to Review |
|-------------|----------------|
| New event type | `event_types.rs`, `claude-events.ts`, `message_router.rs` |
| New init field | `event_types.rs`, `message_router.rs` |
| New/changed tool | `approval-hook.sh`, `approval_server.rs` |
| Cost field change | `event_types.rs`, `message_router.rs` |
| Hook format change | `approval_server.rs`, `process.rs` |
| New control subtype | `event_types.rs`, `session.rs` |
| New CLI flag | `process.rs` |

## Data Locations

| What | Path |
|------|------|
| Skill scripts | `~/.claude/skills/release-monitor/scripts/` |
| Keywords config | `~/.claude/skills/release-monitor/references/relevance-keywords.json` |
| State file | `~/.codemantis/release-monitor/state.json` |
| Baselines | `~/.codemantis/release-monitor/baselines/v{version}/` |
| Reports | `~/.codemantis/release-monitor/reports/` |
| Local changelog | `~/.claude/cache/changelog.md` (maintained by Claude Code) |
| Protocol reference | `~/.claude/skills/cli-test-harness/references/protocol-reference.md` |

## Scheduling (Optional)

Set up a daily zero-cost check via Claude Code's cron system:

```
CronCreate: cron="17 9 * * *", prompt="/release-monitor --check"
```

## Troubleshooting

**"No changelog entries found"**
- The local changelog at `~/.claude/cache/changelog.md` may not exist or may be empty. Run `claude` once to populate it.

**"No baseline found"**
- Run `python3 release_monitor.py --baseline` to record the initial baseline.

**"Failed to capture init snapshot"**
- Ensure `claude` is on PATH and your subscription is active.
- Check that no other CLI instance is blocking.

**npm version fetch fails**
- Network issue. The tool gracefully falls back to local changelog analysis only.

**False positives in classification**
- Edit `~/.claude/skills/release-monitor/references/relevance-keywords.json` to adjust keyword lists. The bare word "protocol" was already removed after catching a false positive for "Kitty keyboard protocol."

## Workflow Summary

```
Claude Code updates (every 1-3 days)
        │
        ▼
  --check (zero cost)
        │
        ├─ No new version → done
        │
        ├─ New version, no HIGH/CRITICAL → mark analyzed, done
        │
        └─ HIGH/CRITICAL flagged
                │
                ▼
          --analyze (1 API turn)
                │
                ├─ No protocol diff → review changelog items only
                │
                └─ Protocol diff detected
                        │
                        ▼
                  --deep (5 API turns)
                        │
                        ▼
                  Implement changes in CodeMantis
                        │
                        ▼
                  Run cargo test + test_assertions.py
                        │
                        ▼
                  --baseline (record new known-good state)
                        │
                        ▼
                  Update protocol-reference.md
```
