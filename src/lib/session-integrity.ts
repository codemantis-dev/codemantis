import { useSessionStore } from "../stores/sessionStore";
import type { ActivityEntry } from "../types/activity";

/**
 * Invariant check at the activity-store write boundary.
 *
 * Writing activity for a sessionId that does not exist in the session map, or
 * attributing tool work whose file paths live outside the session's own
 * project directory, indicates cross-session misattribution (e.g., bug where
 * Spec-Forge activity ends up keyed under an Atikon session id). Loud warn +
 * stack trace so the offending call site surfaces in a dev run. Does not drop
 * the entry — diagnostic only.
 */
export function assertActivitySessionScope(
  sessionId: string,
  entry: Pick<ActivityEntry, "toolName" | "toolInput">,
  origin: string,
): void {
  const state = useSessionStore.getState();
  const session = state.sessions.get(sessionId);

  if (!session) {
    console.warn(
      `[session-integrity] addEntry to unknown session id (${origin})`,
      {
        sessionId,
        toolName: entry.toolName,
        activeProjectPath: state.activeProjectPath,
        activeSessionId: state.activeSessionId,
        knownSessionIds: [...state.sessions.keys()],
      },
    );
    console.trace("[session-integrity] stack");
    return;
  }

  const filePath = typeof entry.toolInput.file_path === "string"
    ? (entry.toolInput.file_path as string)
    : null;
  const command = typeof entry.toolInput.command === "string"
    ? (entry.toolInput.command as string)
    : null;

  const projectPath = session.project_path;
  const outOfScope =
    (filePath && filePath.startsWith("/") && !filePath.startsWith(projectPath)) ||
    (command && /\/Users\/[^\s"']+/.test(command) && !new RegExp(`\\b${escapeRegex(projectPath)}\\b`).test(command) && hasForeignAbsolutePath(command, projectPath));

  if (outOfScope) {
    console.warn(
      `[session-integrity] addEntry whose tool input references paths outside session.project_path (${origin})`,
      {
        sessionId,
        sessionProjectPath: projectPath,
        activeProjectPath: state.activeProjectPath,
        activeSessionId: state.activeSessionId,
        toolName: entry.toolName,
        filePath,
        commandSnippet: command ? command.slice(0, 200) : null,
      },
    );
    console.trace("[session-integrity] stack");
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasForeignAbsolutePath(command: string, projectPath: string): boolean {
  const abs = command.match(/\/Users\/[^\s"'`]+/g);
  if (!abs) return false;
  return abs.some((p) => !p.startsWith(projectPath));
}
