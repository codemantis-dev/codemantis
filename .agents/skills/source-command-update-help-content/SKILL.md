---
name: "source-command-update-help-content"
description: "Pre-release task — sync the in-app help guide AND Super-Bro knowledge with current source code"
---

# source-command-update-help-content

Use this skill when the user asks to run the migrated source command `update-help-content`.

## Command Template

# Update Help Content & Super-Bro Knowledge (Pre-Release)

This task has two parts: (1) sync the user guide, (2) sync Super-Bro knowledge files.

---

## Part 1: User Guide

Read the current user guide at `docs/user-guide/codemantis-complete-guide.md`.

Then read these source files to check for changes:
- `src/data/shortcuts.ts` (for keyboard shortcuts)
- `src-tauri/src/commands/slash_commands.rs` (for slash commands)
- `src-tauri/resources/templates.json` (for project templates)
- `src/types/mcp-templates.ts` (for MCP templates)
- `src/types/settings.ts` (for settings)
- `src/components/modals/settings/*.tsx` (for settings tabs)

Compare the source files against what's documented in the user guide. Flag any differences:
- New commands not documented
- Removed commands still documented
- Changed behavior not reflected
- New settings tabs or options not covered
- New keyboard shortcuts not listed

Output a diff summary of what needs updating, then update the guide.

Save the updated guide to `docs/user-guide/codemantis-complete-guide.md`.

Then copy the updated guide to `src-tauri/resources/user-guide.md` so it ships in the app bundle.

---

## Part 2: Super-Bro Knowledge Files

Read ALL Super-Bro knowledge files in `src-tauri/resources/super-bro/`:
- `persona.md` — core persona + CodeMantis feature list
- `knowledge-Codex-response.md`
- `knowledge-build-errors.md`
- `knowledge-test-failures.md`
- `knowledge-runtime-errors.md`
- `knowledge-guide-transitions.md`
- `knowledge-user-stuck.md`
- `knowledge-safety.md`
- `knowledge-session-start.md`

Then read these source files for current state:
- `src/components/modals/settings/*.tsx` (all settings tabs — feature names)
- `src/components/rightpanel/*.tsx` (right panel features — names, behavior)
- `src/components/specwriter/*.tsx` (SpecWriter — current workflow)
- `src/components/input/InputArea.tsx` (toolbar buttons — current features)
- `src/types/settings.ts` (AppSettings — current settings fields)
- `src/stores/guideStore.ts` (Implementation Guide — current state shape)
- `src/hooks/useClaudeSession.ts` (session management — current flow)

### Check persona.md feature list:
- Are all CodeMantis features listed? (Compare against actual settings tabs and right panel tabs)
- Are any listed features renamed or removed?
- Are new features missing from the list?
- Are the descriptions still accurate?

### Check knowledge modules:
- `knowledge-build-errors.md`: Are error patterns still relevant? Any new frameworks used in templates that need patterns added?
- `knowledge-guide-transitions.md`: Does the session workflow still match the Implementation Guide flow?
- `knowledge-session-start.md`: Does the orientation advice match current onboarding?
- `knowledge-safety.md`: Are the destructive action warnings still accurate?

Output a diff summary for each file that needs changes, then apply the updates.

### Do NOT change:
- The output format tags (`<suggested-prompt>`, `<check-file>`, `<observation>`)
- The NOTHING_TO_REPORT sentinel
- The overall tone and brevity guidelines
- Knowledge that is general coding advice (not CodeMantis-specific)
