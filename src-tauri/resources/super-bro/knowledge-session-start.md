═══ SITUATION: NEW SESSION OR PROJECT OPENED ═══

The user just started a new session (Claude Code or Codex) for this project.
Give them orientation.

FIRST IMPRESSION:
- Read the project context file (`CLAUDE.md` for Claude Code sessions;
  `AGENTS.md` for Codex sessions) to understand the project
- Check if there's an Implementation Guide active
- Check git status (uncommitted changes from last time?)
- Check the PreflightTray colour at the top of the workspace — if it's
  yellow or red, the project is missing required capabilities and that's
  worth surfacing before the user starts coding

AGENT-AWARE CONTEXT:
- Claude Code sessions read project context from `CLAUDE.md`.
- Codex sessions read it from `AGENTS.md`. SpecWriter on Codex spawns
  with an `AGENTS.override.md` in an ephemeral cwd, so the user's real
  `AGENTS.md` is untouched by spec writes.
- Slash skills/prompts live in different directories per agent —
  Claude: `.claude/commands/` + `.claude/skills/`. Codex: `.codex/prompts/`.
- If the user wants the agent they DON'T have installed (e.g. to try
  Codex for a second opinion), they don't need a terminal: the Welcome
  screen can install and sign in to either CLI in-app, no npm needed.

GUIDANCE:
- If the project context file exists: "This project uses {stack}. The
  active agent knows about it from {CLAUDE.md or AGENTS.md}."
- If neither file exists on a Claude session: "This project doesn't have
  a CLAUDE.md yet. Consider generating one — it helps Claude understand
  your project from the first message. Use /init or the CLAUDE.md
  generator in CodeMantis."
- If neither file exists on a Codex session: "This project doesn't have
  an AGENTS.md yet. Consider running /init in a Codex CLI overlay to
  create one — Codex reads project context from AGENTS.md (the Codex
  equivalent of CLAUDE.md)."
- If uncommitted changes exist: "You have uncommitted changes
  from a previous session. Consider committing or stashing them
  before starting new work."
- If Guide is active: "You have an Implementation Guide active.
  You're on Session {N} of {total}. The Guide tab has the prompt
  ready."
- If Guide is complete: "Your Implementation Guide is done! All
  {N} sessions complete. Run the final verification prompt from
  the Guide tab for a full spec-wide check."

PROJECT-SPECIFIC OBSERVATIONS:
Include any relevant observations from the observation log, like:
- "Reminder: this project uses pnpm, not npm"
- "Note: Claude tends to forget loading states here"
