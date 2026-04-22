import { useEffect, useRef, useCallback, useMemo } from "react";
import { Brain, Layers, MessageSquareShare } from "lucide-react";
import ThinkingContent from "../chat/ThinkingContent";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { useUiStore } from "../../stores/uiStore";
import { EMPTY_ARRAY } from "../../lib/empty-refs";
import { getActivityType } from "../../types/activity";
import type { ActivityEntry } from "../../types/activity";
import { useIncrementalList } from "../../hooks/useIncrementalList";
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
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  // For session scope: narrow selector on active session's entries only
  const activeSessionEntries = useActivityStore((s) => activeSessionId ? s.sessionEntries.get(activeSessionId) ?? EMPTY_ARRAY : EMPTY_ARRAY);
  // For project scope: need all entries (broader subscription)
  const allSessionEntries = useActivityStore((s) => s.sessionEntries);
  const projectAssistants = useAssistantStore((s) => activeProjectPath ? s.projectAssistants.get(activeProjectPath) ?? EMPTY_ARRAY : EMPTY_ARRAY);
  const setSelectedActivityEntry = useUiStore((s) => s.setSelectedActivityEntry);
  const activityFeedScope = useUiStore((s) => s.activityFeedScope);
  const toggleActivityFeedScope = useUiStore((s) => s.toggleActivityFeedScope);
  const showReasoningPanel = useUiStore((s) => s.showReasoningPanel);
  const toggleReasoningPanel = useUiStore((s) => s.toggleReasoningPanel);
  const thinking = useSessionStore((s) =>
    activeSessionId ? s.sessionThinking.get(activeSessionId) : undefined
  );
  const lastThinkingContent = useSessionStore((s) => {
    if (!activeSessionId) return undefined;
    const msgs = s.sessionMessages.get(activeSessionId);
    if (!msgs) return undefined;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].thinkingContent) return msgs[i].thinkingContent;
    }
    return undefined;
  });
  const reasoningContent = thinking?.content || lastThinkingContent || "";
  const reasoningIsStreaming = thinking?.isThinking ?? false;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build entries based on scope: session-only or merged from all project sessions
  const { sortedEntries, showLabels } = useMemo(() => {
    if (!activeProjectPath) return { sortedEntries: [] as LabeledEntry[], showLabels: false };

    // Session scope: use narrow selector (only re-renders when active session's entries change)
    if (activityFeedScope === "session" && activeSessionId) {
      const session = sessions.get(activeSessionId);
      // Defensive invariant: the active session must belong to the active project.
      // Without this, a misattributed entry or a stale activeSessionId would
      // display activity from another project in the wrong tab.
      if (!session || session.project_path !== activeProjectPath) {
        return { sortedEntries: [] as LabeledEntry[], showLabels: false };
      }
      const label = session.name ?? "Chat";
      const labeled = activeSessionEntries.map((entry) => ({ ...entry, computedLabel: label }));
      const sorted = [...labeled].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return { sortedEntries: sorted, showLabels: false };
    }

    // Project scope: merge all sessions in the project
    const merged: LabeledEntry[] = [];

    const projectSessionIds = tabOrder.filter((sid) => {
      const s = sessions.get(sid);
      return s && s.project_path === activeProjectPath;
    });

    for (const sid of projectSessionIds) {
      const entries = allSessionEntries.get(sid) ?? [];
      const session = sessions.get(sid);
      const label = session?.name ?? "Chat";
      for (const entry of entries) {
        merged.push({ ...entry, computedLabel: label });
      }
    }

    // Collect entries from assistant sessions in this project
    for (const assistant of projectAssistants) {
      const entries = allSessionEntries.get(assistant.id) ?? [];
      for (const entry of entries) {
        merged.push({ ...entry, computedLabel: assistant.name });
      }
    }

    // Sort newest first
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Show labels only when there are 2+ active sources
    const sourceCount = projectSessionIds.length + projectAssistants.length;

    return { sortedEntries: merged, showLabels: sourceCount >= 2 };
  }, [activeProjectPath, activeSessionId, activityFeedScope, sessions, tabOrder, activeSessionEntries, allSessionEntries, projectAssistants]);

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

  const reasoningToggle = (
    <button
      onClick={toggleReasoningPanel}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-label transition-colors ${
        showReasoningPanel
          ? "text-accent bg-accent/10"
          : "text-text-ghost hover:text-text-secondary hover:bg-bg-elevated"
      }`}
      title={showReasoningPanel ? "Hide reasoning panel" : "Show Claude reasoning"}
    >
      <Brain size={12} />
      Reasoning
    </button>
  );

  const scopeToggle = (
    <button
      onClick={toggleActivityFeedScope}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      title={activityFeedScope === "session" ? "Showing active session — click for all project activity" : "Showing all project activity — click for active session only"}
    >
      <Layers size={12} />
      {activityFeedScope === "session" ? "Session" : "Project"}
    </button>
  );

  const reasoningPane = showReasoningPanel && (
    <div className="shrink-0 max-h-[33%] flex flex-col border-b border-border-light">
      <div className="flex items-center justify-between px-3 pt-1.5 pb-1 shrink-0">
        <span className="text-ui text-text-dim font-medium">Claude Code Reasoning</span>
        {reasoningToggle}
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-2 min-h-0">
        {reasoningContent ? (
          <ThinkingContent content={reasoningContent} isStreaming={reasoningIsStreaming} maxHeight={undefined} initialExpanded />
        ) : (
          <p className="text-text-faint text-ui text-center py-4">No reasoning yet</p>
        )}
      </div>
    </div>
  );

  const { visibleCount, hasMore, sentinelRef } = useIncrementalList({
    totalCount: sortedEntries.length,
    resetKey: (activeSessionId ?? "") + activityFeedScope,
  });
  const visibleEntries = sortedEntries.slice(0, visibleCount);

  if (sortedEntries.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {reasoningPane}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 pt-1.5">
            {showReasoningPanel && (
              <span className="text-ui text-text-dim font-medium">Activity Details</span>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              {!showReasoningPanel && reasoningToggle}
              {scopeToggle}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-text-faint text-ui">No activity yet</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {reasoningPane}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-3 pt-1.5 mb-1 shrink-0">
          {showReasoningPanel && (
            <span className="text-ui text-text-dim font-medium">Activity Details</span>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {!showReasoningPanel && reasoningToggle}
            {scopeToggle}
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-8 select-text min-h-0">
      {visibleEntries.map((entry, i) => {
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
              {i < visibleEntries.length - 1 && (
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
                    className={`text-detail font-medium px-1.5 py-0.5 rounded-full ml-1 ${
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
                    className="text-detail px-1.5 py-0.5 rounded-full shrink-0 max-w-[120px] truncate"
                    style={{ background: "rgba(74,222,128,0.12)", color: "rgb(74,222,128)" }}
                    title={entry.parentAgentDescription}
                  >
                    {entry.parentAgentDescription}
                  </span>
                )}
                {entry.toolName === "Agent" && entry.agentFinalToolCount != null && entry.agentFinalToolCount > 0 && (
                  <span className="text-detail px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-ghost shrink-0">
                    {entry.agentFinalToolCount} tool uses
                  </span>
                )}
                {entry.toolName === "Agent" && entry.agentFinalTokenCount != null && entry.agentFinalTokenCount > 0 && (
                  <span className="text-detail px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-ghost shrink-0">
                    {entry.agentFinalTokenCount >= 1000
                      ? `${(entry.agentFinalTokenCount / 1000).toFixed(1)}K`
                      : entry.agentFinalTokenCount} tokens
                  </span>
                )}
                {showLabels && (
                  <span className="text-detail px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-ghost shrink-0">
                    {entry.computedLabel}
                  </span>
                )}
                {entry.toolName === "preview_console" && (
                  <button
                    className="ml-auto shrink-0 p-0.5 rounded text-text-ghost hover:text-accent hover:bg-bg-elevated transition-colors"
                    title="Send to chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      const level = (entry.toolInput.level as string || "log").toUpperCase();
                      const msg = entry.result || "";
                      const formatted = msg.includes("\n")
                        ? `Browser console from preview:\n\`\`\`\n[${level}] ${msg}\n\`\`\``
                        : `Browser console from preview: \`[${level}] ${msg}\``;
                      useUiStore.getState().setDraftInput(formatted);
                    }}
                  >
                    <MessageSquareShare size={12} />
                  </button>
                )}
                <span className={`text-label text-text-ghost ${entry.toolName === "preview_console" ? "" : "ml-auto"} shrink-0`}>
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
      {hasMore && <div ref={sentinelRef} className="h-1" />}
        </div>
      </div>
    </div>
  );
}
