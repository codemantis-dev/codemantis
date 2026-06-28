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
  // Friendly explanation surfaced under an opaque CLI error (e.g. the
  // .claude/settings*.json carve-out). Not the raw error text.
  helpHint?: string;
}

export type ActivityStatus = "pending" | "preparing" | "running" | "done" | "error" | "interrupted";

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
  // CLI v2.1.119+ task_notification surfaces these on completion
  summary?: string;
  outputFile?: string;
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
  // ImageGeneration writes a generated image to disk — semantically a
  // file write from the user's perspective, so the "WR" badge fits.
  const writeTools = ["Write", "NotebookEdit", "ImageGeneration"];
  const editTools = ["Edit"];
  const bashTools = ["Bash"];
  const taskTools = ["TodoWrite", "TodoRead", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList"];
  const searchTools = ["ToolSearch", "WebSearch", "WebFetch"];
  const agentTools = ["Agent"];
  // Control tools that drive a UI prompt rather than a tool execution:
  // Claude's ExitPlanMode / EnterPlanMode are suppressed from the
  // activity feed by `modeControlToolIds` in activity.ts but DO appear
  // in the approval modal — without this entry they'd render as "EX".
  // Codex plans flow through the same ExitPlanMode synthetic tool name
  // via the v1.4.0 translator (see agents/codex/translation.rs).
  const questionTools = ["AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "PermissionRequest"];

  if (readTools.includes(toolName)) return "read";
  if (writeTools.includes(toolName)) return "write";
  if (editTools.includes(toolName)) return "edit";
  if (bashTools.includes(toolName)) return "bash";
  if (taskTools.includes(toolName)) return "task";
  if (searchTools.includes(toolName)) return "search";
  if (agentTools.includes(toolName)) return "agent";
  if (questionTools.includes(toolName)) return "question";
  if (toolName.startsWith("mcp__")) return "mcp";
  // Codex `dynamicToolCall` items are emitted as `dyn__{namespace}__{tool}`
  // (mirroring the mcp__ convention). They're semantically the same kind
  // of dynamic-tool-registration call so the MCP badge fits visually.
  if (toolName.startsWith("dyn__")) return "mcp";
  return "other";
}
