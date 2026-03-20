import { useSessionStore } from "../stores/sessionStore";

/** Maps tool names to human-readable activity labels for the ThinkingIndicator. */
export function toolActivityLabel(toolName: string): string {
  switch (toolName) {
    case "Read": return "Reading file...";
    case "Glob": return "Searching files...";
    case "Grep": return "Searching code...";
    case "Write": return "Writing file...";
    case "Edit": return "Editing code...";
    case "Bash": return "Running command...";
    case "Agent": return "Running sub-agent..."; // default; overridden dynamically
    case "NotebookEdit": return "Editing notebook...";
    case "ListDirectory": case "LS": return "Listing files...";
    case "WebSearch": return "Searching the web...";
    case "WebFetch": return "Fetching web page...";
    case "TodoRead": case "TodoWrite": return "Managing tasks...";
    case "EnterPlanMode": return "Entering plan mode...";
    case "ExitPlanMode": return "Exiting plan mode...";
    case "preview_console": return "Preview console";
    default:
      if (toolName.startsWith("mcp__")) {
        // mcp__server__tool → "Running tool (server)..."
        const parts = toolName.split("__");
        const server = parts[1] ?? "mcp";
        const tool = parts.slice(2).join("_") || "tool";
        return `Running ${tool} (${server})...`;
      }
      return `Running ${toolName}...`;
  }
}

/** Build a contextual label based on active sub-agents for a session. */
export function subAgentActivityLabel(sessionId: string): string {
  const agents = useSessionStore.getState().activeSubAgents.get(sessionId);
  if (!agents || agents.length === 0) return "Thinking...";
  if (agents.length === 1) {
    const a = agents[0];
    const typeTag = a.subagentType !== "general-purpose" ? `[${a.subagentType}] ` : "";
    return `Agent: ${typeTag}${a.description}`;
  }
  // Group by type for a compact summary
  const types = new Map<string, number>();
  for (const a of agents) {
    types.set(a.subagentType, (types.get(a.subagentType) ?? 0) + 1);
  }
  if (types.size === 1) {
    const [type, count] = [...types.entries()][0];
    const label = type !== "general-purpose" ? type : "sub-agent";
    return `Running ${count} ${label} agents...`;
  }
  return `Running ${agents.length} sub-agents...`;
}

/** Parse <usage> tags from Agent tool_result content to extract token/tool counts. */
export function parseAgentUsage(content: string | null | undefined): {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
} | null {
  if (!content) return null;
  const match = content.match(/<usage>([\s\S]*?)<\/usage>/);
  if (!match) return null;
  const block = match[1];
  const totalTokens = block.match(/total_tokens:\s*(\d+)/)?.[1];
  const toolUses = block.match(/tool_uses:\s*(\d+)/)?.[1];
  const durationMs = block.match(/duration_ms:\s*(\d+)/)?.[1];
  return {
    totalTokens: totalTokens ? parseInt(totalTokens, 10) : undefined,
    toolUses: toolUses ? parseInt(toolUses, 10) : undefined,
    durationMs: durationMs ? parseInt(durationMs, 10) : undefined,
  };
}

// Re-export everything from handler modules for backwards compatibility
export { handleChatEvent, flushStreamingBuffer } from "./event-handlers/chat";
export { handleActivityEvent } from "./event-handlers/activity";
export { handleProcessError, handleProcessExited, startStaleDetection, stopStaleDetection } from "./event-handlers/process";
export { handleUsageUpdate, checkContextThresholds, maybeGenerateChangelog, cleanupSession } from "./event-handlers/lifecycle";
