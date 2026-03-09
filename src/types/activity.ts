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
}

export type ActivityStatus = "pending" | "running" | "done" | "error";

export type ActivityType = "read" | "write" | "edit" | "bash" | "other";

export function getActivityType(toolName: string): ActivityType {
  const readTools = ["Read", "Glob", "Grep"];
  const writeTools = ["Write"];
  const editTools = ["Edit"];
  const bashTools = ["Bash"];

  if (readTools.includes(toolName)) return "read";
  if (writeTools.includes(toolName)) return "write";
  if (editTools.includes(toolName)) return "edit";
  if (bashTools.includes(toolName)) return "bash";
  return "other";
}
