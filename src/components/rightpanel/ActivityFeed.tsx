import { useEffect, useRef, useCallback, useMemo } from "react";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { useUiStore } from "../../stores/uiStore";
import { getActivityType } from "../../types/activity";
import type { ActivityEntry } from "../../types/activity";
import ToolBadge from "../shared/ToolBadge";
import StatusDot from "../shared/StatusDot";

const typeColors: Record<string, "blue" | "green" | "yellow" | "purple" | "accent"> = {
  read: "blue",
  write: "green",
  edit: "yellow",
  bash: "purple",
  task: "blue",
  search: "purple",
  agent: "green",
  question: "accent",
  mcp: "purple",
  other: "accent",
};

/** Friendly display names for tools that have ugly internal names. */
const toolDisplayNames: Record<string, string> = {
  AskUserQuestion: "User Question",
};

/** Format MCP tool names: mcp__server__tool → "server: tool" */
function getToolDisplayName(toolName: string): string {
  if (toolDisplayNames[toolName]) return toolDisplayNames[toolName];
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const server = parts[1] ?? "mcp";
    const tool = parts.slice(2).join("_") || "tool";
    return `${server}: ${tool}`;
  }
  return toolName;
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  // Agent tool: show [type] description instead of raw JSON
  if (toolName === "Agent") {
    const desc = input.description as string | undefined;
    const type = input.subagent_type as string | undefined;
    const bg = input.run_in_background as boolean | undefined;
    const typeTag = type && type !== "general-purpose" ? `[${type}] ` : "";
    const bgTag = bg ? " (background)" : "";
    return desc ? `${typeTag}${desc}${bgTag}` : "Running sub-agent...";
  }
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return String(input.pattern);
  if (input.command) return String(input.command);
  if (input.regex) return `"${input.regex}" in ${input.path ?? "."}`;
  if (input.question) return String(input.question);
  // AskUserQuestion: show the question headers instead of raw JSON
  if (toolName === "AskUserQuestion" && Array.isArray(input.questions)) {
    const headers = (input.questions as { header?: string }[])
      .map((q) => q.header)
      .filter(Boolean);
    if (headers.length > 0) return headers.join(", ");
  }
  if (input.questions) return JSON.stringify(input.questions).slice(0, 120);
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  return JSON.stringify(input).slice(0, 80);
}

interface LabeledEntry extends ActivityEntry {
  computedLabel: string;
}

export default function ActivityFeed() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const sessions = useSessionStore((s) => s.sessions);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const sessionEntries = useActivityStore((s) => s.sessionEntries);
  const projectAssistants = useAssistantStore((s) => s.projectAssistants);
  const setSelectedActivityEntry = useUiStore((s) => s.setSelectedActivityEntry);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build merged entries from all sessions in the project
  const { sortedEntries, showLabels } = useMemo(() => {
    if (!activeProjectPath) return { sortedEntries: [] as LabeledEntry[], showLabels: false };

    const merged: LabeledEntry[] = [];

    // Collect entries from main sessions in this project
    const projectSessionIds = tabOrder.filter((sid) => {
      const s = sessions.get(sid);
      return s && s.project_path === activeProjectPath;
    });

    for (const sid of projectSessionIds) {
      const entries = sessionEntries.get(sid) ?? [];
      const session = sessions.get(sid);
      const label = session?.name ?? "Chat";
      for (const entry of entries) {
        merged.push({ ...entry, computedLabel: label });
      }
    }

    // Collect entries from assistant sessions in this project
    const assistants = projectAssistants.get(activeProjectPath) ?? [];
    for (const assistant of assistants) {
      const entries = sessionEntries.get(assistant.id) ?? [];
      for (const entry of entries) {
        merged.push({ ...entry, computedLabel: assistant.name });
      }
    }

    // Sort newest first
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Show labels only when there are 2+ active sources
    const sourceCount = projectSessionIds.length + assistants.length;

    return { sortedEntries: merged, showLabels: sourceCount >= 2 };
  }, [activeProjectPath, sessions, tabOrder, sessionEntries, projectAssistants]);

  // Scroll to top when new entries appear (newest first)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [sortedEntries.length]);

  const handleEntryClick = useCallback(
    (entry: ActivityEntry) => {
      // Don't navigate if user is selecting text
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;

      setSelectedActivityEntry(entry);
    },
    [setSelectedActivityEntry]
  );

  if (sortedEntries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-text-faint text-ui">No activity yet</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-3 pt-2 pb-8 select-text">
      {sortedEntries.map((entry, i) => {
        const activityType = getActivityType(entry.toolName);
        const color = typeColors[activityType] ?? "accent";
        const inputStr = formatToolInput(entry.toolName, entry.toolInput);

        return (
          <div
            key={entry.id}
            className="flex gap-2 mb-0.5 cursor-pointer hover:bg-bg-elevated rounded -mx-1 px-1"
            onClick={() => handleEntryClick(entry)}
          >
            {/* Timeline dot + line */}
            <div className="flex flex-col items-center pt-2 w-4 shrink-0">
              <StatusDot
                color={color}
                pulse={entry.status === "running"}
                size={6}
              />
              {i < sortedEntries.length - 1 && (
                <div className="w-px flex-1 mt-1 bg-border-light" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 py-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <ToolBadge toolName={entry.toolName} />
                <span className="text-ui text-text-secondary font-medium truncate">
                  {getToolDisplayName(entry.toolName)}
                </span>
                {entry.approvalStatus && (
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-1 ${
                      entry.approvalStatus === "approved"
                        ? "bg-green/15 text-green"
                        : entry.approvalStatus === "denied"
                          ? "bg-red/15 text-red"
                          : "bg-yellow/15 text-yellow"
                    }`}
                  >
                    {entry.approvalStatus.toUpperCase()}
                  </span>
                )}
                {entry.parentAgentDescription && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 max-w-[120px] truncate"
                    style={{ background: "rgba(74,222,128,0.12)", color: "rgb(74,222,128)" }}
                    title={entry.parentAgentDescription}
                  >
                    {entry.parentAgentDescription}
                  </span>
                )}
                {entry.toolName === "Agent" && entry.agentFinalToolCount != null && entry.agentFinalToolCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-ghost shrink-0">
                    {entry.agentFinalToolCount} tool uses
                  </span>
                )}
                {entry.toolName === "Agent" && entry.agentFinalTokenCount != null && entry.agentFinalTokenCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-ghost shrink-0">
                    {entry.agentFinalTokenCount >= 1000
                      ? `${(entry.agentFinalTokenCount / 1000).toFixed(1)}K`
                      : entry.agentFinalTokenCount} tokens
                  </span>
                )}
                {showLabels && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-ghost shrink-0">
                    {entry.computedLabel}
                  </span>
                )}
                <span className="text-label text-text-ghost ml-auto shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
              {inputStr && (
                <p className="text-label text-text-dim font-mono mt-0.5 break-all line-clamp-3">
                  {inputStr}
                </p>
              )}
              {entry.status === "done" && entry.result && (
                <p className="text-label text-text-faint mt-0.5 break-all line-clamp-3">
                  {entry.result}
                </p>
              )}
              {entry.status === "error" && activityType === "question" && entry.result && (
                <p className="text-label text-accent mt-0.5 break-all line-clamp-3">
                  Answer: {entry.result}
                </p>
              )}
              {entry.status === "error" && activityType !== "question" && (
                <p className="text-label text-red mt-0.5 break-all line-clamp-3">
                  Error{entry.result ? `: ${entry.result}` : ""}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
