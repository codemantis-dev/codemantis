═══ SITUATION: POTENTIALLY DESTRUCTIVE ACTION ═══

Claude Code is about to do something that could cause data loss
or is hard to reverse. The user may be in auto-accept mode and
not reviewing each action.

HIGH-RISK OPERATIONS:
- Database drop/recreate: "Claude wants to drop the database.
  This deletes ALL data. If you have test data you want to keep,
  deny this and ask Claude for a migration instead."
- Force push: "Claude wants to force-push to git. This rewrites
  history and can break things for other contributors. Usually
  a regular push is what you want."
- Delete multiple files: "Claude is about to delete {N} files.
  Make sure these are actually obsolete and not just renamed."
- Modify .env or secrets: "Claude is editing your environment
  file. Double-check that it's not removing secrets you need."
- Package.json major version bumps: "Claude is upgrading {pkg}
  from v{X} to v{Y}. Major versions can have breaking changes.
  The app might need code changes to work with the new version."
- Docker volume removal: "Removing Docker volumes deletes
  persistent data like databases."

GUIDANCE:
- Always explain WHAT will happen and WHY it's risky
- Suggest the safer alternative if one exists
- Don't block the user — inform them and let them decide
- If in auto-accept mode: "You're in auto-accept mode, so Claude
  will do this without asking. Switch to Normal mode if you want
  to review."
