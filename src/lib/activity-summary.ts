import type { SessionActivityInfo } from "../stores/sessionStore";

/** Compose a compact, human-readable "what the session is doing now" string
 *  from its live activity info. Used by the status bar and the Activity
 *  Overview lay-over.
 *
 *  e.g., "Editing settings.ts", "Reading App.tsx", "Running command...",
 *  "3 agents". Returns null when there is no active tool to describe.
 */
export function formatActivityDetail(
  activity: SessionActivityInfo | undefined,
  subAgentCount: number,
): string | null {
  if (!activity?.toolName) return null;

  // Agent-aware: show agent count or description
  if (activity.toolName === "Agent") {
    if (subAgentCount > 1) return `${subAgentCount} agents`;
    // Single agent: use the label which already has "Agent: description"
    return activity.label;
  }

  if (activity.filePath) {
    const fileName = activity.filePath.split("/").pop() ?? activity.filePath;
    const verb = activity.label.split(/\s/)[0];
    return `${verb} ${fileName}`;
  }
  return activity.label;
}
