export type ApprovalDecision = "pending" | "approved" | "denied";

export interface ActivityEntry {
  id: string;
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  status: ActivityStatus;
  timestamp: string;
  messageId: string;
  result?: string;
  isError: boolean;
  durationMs?: number;
  approvalStatus?: ApprovalDecision;
  approvalTimestamp?: string;
  sessionId?: string;
}

export type ActivityStatus = "pending" | "running" | "done" | "error";

export type ActivityType = "read" | "write" | "edit" | "bash" | "task" | "search" | "agent" | "question" | "mcp" | "other";

export function getActivityType(toolName: string): ActivityType {
  const readTools = ["Read", "Glob", "Grep"];
  const writeTools = ["Write", "NotebookEdit"];
  const editTools = ["Edit"];
  const bashTools = ["Bash"];
  const taskTools = ["TodoWrite", "TodoRead", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList"];
  const searchTools = ["ToolSearch", "WebSearch", "WebFetch"];
  const agentTools = ["Agent"];
  const questionTools = ["AskUserQuestion"];

  if (readTools.includes(toolName)) return "read";
  if (writeTools.includes(toolName)) return "write";
  if (editTools.includes(toolName)) return "edit";
  if (bashTools.includes(toolName)) return "bash";
  if (taskTools.includes(toolName)) return "task";
  if (searchTools.includes(toolName)) return "search";
  if (agentTools.includes(toolName)) return "agent";
  if (questionTools.includes(toolName)) return "question";
  if (toolName.startsWith("mcp__")) return "mcp";
  return "other";
}
