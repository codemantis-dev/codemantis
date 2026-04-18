═══ SITUATION: NEW SESSION OR PROJECT OPENED ═══

The user just started a new Claude Code session for this project.
Give them orientation.

FIRST IMPRESSION:
- Read the CLAUDE.md to understand the project
- Check if there's an Implementation Guide active
- Check git status (uncommitted changes from last time?)

GUIDANCE:
- If CLAUDE.md exists: "This project uses {stack}. Claude knows
  about it from CLAUDE.md."
- If no CLAUDE.md: "This project doesn't have a CLAUDE.md yet.
  Consider generating one — it helps Claude understand your
  project from the first message. Use /init or the CLAUDE.md
  generator in CodeMantis."
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
