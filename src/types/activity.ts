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
  parentAgentToolUseId?: string;
  parentAgentDescription?: string;
  agentFinalToolCount?: number;
  agentFinalTokenCount?: number;
  agentFinalDurationMs?: number;
}

export type ActivityStatus = "pending" | "preparing" | "running" | "done" | "error";

export type ActivityType = "read" | "write" | "edit" | "bash" | "task" | "search" | "agent" | "question" | "mcp" | "other";

export interface SubAgentInfo {
  toolUseId: string;
  description: string;
  subagentType: string;
  isBackground: boolean;
  startedAt: string;
  elapsed: number;
  status: ActivityStatus;
  // Phase 2: live progress from system task events
  toolCount?: number;
  tokenCount?: number;
  currentActivity?: string;
}

export function extractSubAgentInfo(
  toolUseId: string,
  toolInput: Record<string, unknown>,
  timestamp: string,
): SubAgentInfo {
  return {
    toolUseId,
    description: (toolInput.description as string) ?? "Sub-agent",
    subagentType: (toolInput.subagent_type as string) ?? "general-purpose",
    isBackground: (toolInput.run_in_background as boolean) ?? false,
    startedAt: timestamp,
    elapsed: 0,
    status: "running",
  };
}

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
