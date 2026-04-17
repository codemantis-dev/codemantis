import type {
  FrontendEvent,
  ToolUseStartEvent,
  ToolResultEvent,
} from "../../types/claude-events";
import type { ActivityEntry } from "../../types/activity";
import { extractSubAgentInfo } from "../../types/activity";
import type { SessionMode } from "../../types/session";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useFileViewerStore, getLanguageFromPath } from "../../stores/fileViewerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { toolActivityLabel, subAgentActivityLabel, parseAgentUsage } from "../event-classifier";

// Store state types (derived from Zustand store getState())
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;
type ActivityStoreState = ReturnType<typeof useActivityStore.getState>;

// Tools that indicate actual changes were made (not just reads)
export const MUTATING_TOOLS = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);

// Cache file content before Write/Edit tools run, keyed by tool_use_id
export const preEditContentCache = new Map<string, string>();

// Track tool calls per turn for context window estimation (fallback only).
// When usage_update events are available (modern CLI), context is updated
// in real-time per API call. This counter is only used as a fallback for
// older CLI versions that don't emit usage_update events.
export const turnToolCallCount = new Map<string, number>();
/** Tool IDs for mode-control tools (ExitPlanMode/EnterPlanMode) — skipped in activity feed */
export const modeControlToolIds = new Set<string>();

function handleToolUseStart(
  sessionId: string,
  event: ToolUseStartEvent,
  activityStore: ActivityStoreState,
  sessionStore: SessionStoreState,
  now: string,
): void {
  useSessionStore.getState().touchLastEvent(sessionId);
  sessionStore.ensureBusy(sessionId);
  // Track tool calls per turn for context estimation
  turnToolCallCount.set(sessionId, (turnToolCallCount.get(sessionId) ?? 0) + 1);

  // Track sub-agents when Agent tool starts
  if (event.tool_name === "Agent") {
    // Check if a placeholder already exists from agent_preparing
    const existingAgents = sessionStore.activeSubAgents.get(sessionId);
    const placeholder = existingAgents?.find((a) => a.toolUseId === event.tool_use_id);
    if (placeholder) {
      // Upgrade placeholder with real data from tool input
      const agentInfo = extractSubAgentInfo(event.tool_use_id, event.tool_input, now);
      sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
        description: agentInfo.description,
        subagentType: agentInfo.subagentType,
        isBackground: agentInfo.isBackground,
        status: "running",
      });
    } else {
      const agentInfo = extractSubAgentInfo(event.tool_use_id, event.tool_input, now);
      sessionStore.addSubAgent(sessionId, agentInfo);
    }
  }

  // Update activity label to reflect what tool is running
  const filePath = (event.tool_input?.file_path as string) ?? null;
  const label = event.tool_name === "Agent"
    ? subAgentActivityLabel(sessionId)
    : toolActivityLabel(event.tool_name);
  sessionStore.setSessionActivity(sessionId, {
    label,
    toolName: event.tool_name,
    toolElapsed: 0,
    filePath,
  });

  // Mode-control tools: sync session mode and skip activity feed
  if (event.tool_name === "ExitPlanMode" || event.tool_name === "EnterPlanMode") {
    modeControlToolIds.add(event.tool_use_id);
    const newMode: SessionMode = event.tool_name === "EnterPlanMode" ? "plan" : "normal";
    sessionStore.setSessionMode(sessionId, newMode);
    import("../tauri-commands").then(({ syncSessionMode }) => {
      syncSessionMode(sessionId, newMode).catch(console.error);
    });
    // Show "Plan Complete" modal when CLI exits plan mode for the active session
    if (event.tool_name === "ExitPlanMode" && sessionId === sessionStore.activeSessionId) {
      const uiState = useUiStore.getState();
      uiState.setPlanCompleteSessionId(sessionId);
      // Mark the session as having a pending plan. Persists across modal
      // close so the InputArea banner can offer a reopen affordance.
      uiState.setPendingPlanSessionId(sessionId);

      // Claude Code 2.1.x emits `planFilePath` and `plan` directly in the
      // ExitPlanMode tool input. Prefer these over the Write-path observer
      // (which only catches writes under ~/.claude/plans/*.md).
      const input = event.tool_input as { plan?: unknown; planFilePath?: unknown } | undefined;
      const directPlanFilePath =
        typeof input?.planFilePath === "string" ? input.planFilePath : null;
      const directPlanContent =
        typeof input?.plan === "string" ? input.plan : null;

      if (directPlanFilePath) {
        uiState.setPlanCompleteFilePath(directPlanFilePath);
      }
      if (directPlanContent) {
        uiState.setPlanCompleteContent(directPlanContent);
      }

      uiState.setShowPlanCompleteModal(true);

      // Auto-open the plan file in FileViewer. Prefer the direct content
      // (no disk read needed); fall back to readFileContent when the CLI
      // didn't include the plan text (older versions).
      const planFilePath = directPlanFilePath ?? uiState.planCompleteFilePath;
      if (planFilePath) {
        const session = sessionStore.sessions.get(sessionId);
        const projectPath = session?.project_path;
        if (projectPath) {
          const fileName = planFilePath.split("/").pop() ?? planFilePath;
          if (directPlanContent) {
            useFileViewerStore.getState().openFile(projectPath, {
              filePath: planFilePath,
              fileName,
              language: "markdown",
              extension: "md",
              fileSize: new Blob([directPlanContent]).size,
              content: directPlanContent,
              isDiff: false,
            });
            useUiStore.getState().setRightTab("files");
          } else {
            import("../tauri-commands").then(({ readFileContent }) => {
              readFileContent(planFilePath).then((content) => {
                useFileViewerStore.getState().openFile(projectPath, {
                  filePath: planFilePath,
                  fileName,
                  language: "markdown",
                  extension: "md",
                  fileSize: new Blob([content]).size,
                  content,
                  isDiff: false,
                });
                useUiStore.getState().setRightTab("files");
              }).catch((e) => {
                console.error("Failed to auto-open plan file:", e);
              });
            });
          }
        }
      }
    }
    return; // Don't add to activity feed — mode badge already reflects the change
  }

  // Track plan file path: when Write targets ~/.claude/plans/*.md during plan mode
  const sessionMode = sessionStore.sessionModes.get(sessionId);
  if (event.tool_name === "Write" && sessionMode === "plan") {
    const writePath = event.tool_input?.file_path as string | undefined;
    if (writePath && writePath.includes(".claude/plans/") && writePath.endsWith(".md")) {
      useUiStore.getState().setPlanCompleteFilePath(writePath);
    }
  }

  // Check main session store first, then assistant store for the streaming messageId
  let currentMessageId = sessionStore.sessionStreaming.get(sessionId)?.currentMessageId;
  if (!currentMessageId) {
    currentMessageId = useAssistantStore.getState().streaming.get(sessionId)?.currentMessageId;
  }
  const entry: ActivityEntry = {
    id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolUseId: event.tool_use_id,
    toolName: event.tool_name,
    toolInput: event.tool_input,
    status: "running",
    timestamp: now,
    messageId: currentMessageId ?? "",
    isError: false,
    sessionId,
  };
  activityStore.addEntry(sessionId, entry);

  // Cache file content before Write/Edit runs (for diff view)
  if ((event.tool_name === "Write" || event.tool_name === "Edit") && event.tool_input?.file_path) {
    const editFilePath = event.tool_input.file_path as string;
    import("../tauri-commands").then(({ readFileContent }) => {
      readFileContent(editFilePath)
        .then((content) => preEditContentCache.set(event.tool_use_id, content))
        .catch(() => preEditContentCache.set(event.tool_use_id, "")); // new file
    });
  }
}

function handleToolResult(
  sessionId: string,
  event: ToolResultEvent,
  activityStore: ActivityStoreState,
  sessionStore: SessionStoreState,
): void {
  // Mode-control tools were not added to the activity feed — skip their results
  if (modeControlToolIds.has(event.tool_use_id)) {
    modeControlToolIds.delete(event.tool_use_id);
    return;
  }

  // Check if a sub-agent just completed
  const completingAgents = sessionStore.activeSubAgents.get(sessionId);
  const completingAgent = completingAgents?.find((a) => a.toolUseId === event.tool_use_id);
  if (completingAgent) {
    // Parse <usage> tags from agent result for reliable token/tool counts
    const agentUsage = parseAgentUsage(event.content);
    const toolCount = completingAgent.toolCount ?? agentUsage?.toolUses;
    const tokenCount = completingAgent.tokenCount ?? agentUsage?.totalTokens;
    const durationMs = agentUsage?.durationMs;

    const extra: Partial<ActivityEntry> = {};
    if (toolCount != null && toolCount > 0) extra.agentFinalToolCount = toolCount;
    if (tokenCount != null && tokenCount > 0) extra.agentFinalTokenCount = tokenCount;
    if (durationMs != null && durationMs > 0) extra.agentFinalDurationMs = durationMs;
    if (Object.keys(extra).length > 0) {
      activityStore.updateEntryExtra(sessionId, event.tool_use_id, extra);
    }
    sessionStore.completeSubAgent(sessionId, event.tool_use_id);
  }

  // If other agents are still running, keep the agent label
  const remainingAgents = sessionStore.activeSubAgents.get(sessionId);
  if (remainingAgents && remainingAgents.length > 0) {
    sessionStore.setSessionActivity(sessionId, {
      label: subAgentActivityLabel(sessionId),
      toolName: "Agent",
      toolElapsed: 0,
      filePath: null,
    });
  } else {
    sessionStore.setSessionActivity(sessionId, { label: "Thinking...", toolName: null, toolElapsed: 0, filePath: null });
  }
  activityStore.updateEntryStatus(
    sessionId,
    event.tool_use_id,
    event.is_error ? "error" : "done",
    event.content ?? undefined,
    event.is_error
  );

  // Refresh file tree after mutating tools complete
  if (!event.is_error) {
    const allEntries = activityStore.getActiveEntries(sessionId);
    const toolEntry = allEntries.find((e) => e.toolUseId === event.tool_use_id);
    if (toolEntry && MUTATING_TOOLS.has(toolEntry.toolName)) {
      useUiStore.getState().triggerFileTreeRefresh();
    }
  }

  // Auto-open file when Write or Edit tool completes successfully
  // Only auto-switch tab for the active session's project
  if (!event.is_error && useSettingsStore.getState().settings.autoOpenFiles) {
    const isActiveSession = sessionId === sessionStore.activeSessionId;
    const isMainSession = sessionStore.sessions.has(sessionId);
    const session = sessionStore.sessions.get(sessionId);
    const projectPath = session?.project_path;
    const entries = activityStore.getActiveEntries(sessionId);
    const entry = entries.find((e) => e.toolUseId === event.tool_use_id);
    if (entry && projectPath) {
      const toolName = entry.toolName;
      const filePath = entry.toolInput.file_path as string | undefined;
      if (filePath && (toolName === "Write" || toolName === "Edit")) {
        const fileName = filePath.split("/").pop() ?? filePath;
        const language = getLanguageFromPath(filePath);
        const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
        const cachedOldContent = preEditContentCache.get(event.tool_use_id);
        // Read the file content asynchronously for auto-open
        import("../tauri-commands").then(({ readFileContent }) => {
          readFileContent(filePath).then((content) => {
            const hasDiffData = cachedOldContent !== undefined;
            useFileViewerStore.getState().openFile(projectPath, {
              filePath,
              fileName,
              language,
              extension,
              fileSize: new Blob([content]).size,
              content,
              isDiff: hasDiffData,
              oldContent: hasDiffData ? cachedOldContent : undefined,
              newContent: hasDiffData ? content : undefined,
            });
            if (isMainSession && isActiveSession) {
              useUiStore.getState().setRightTab("files");
            }
          }).catch(() => {
            // File may not exist yet or be unreadable — ignore
          });
        });
      }
    }
  }
  // Cleanup pre-edit cache for this tool call
  preEditContentCache.delete(event.tool_use_id);
}

export function handleActivityEvent(sessionId: string, event: FrontendEvent): void {
  const activityStore = useActivityStore.getState();
  const sessionStore = useSessionStore.getState();
  const now = new Date().toISOString();

  switch (event.type) {
    case "agent_preparing": {
      sessionStore.ensureBusy(sessionId);
      // Early visibility: create a placeholder sub-agent before tool input is fully streamed
      const existingAgents = sessionStore.activeSubAgents.get(sessionId);
      const alreadyExists = existingAgents?.find((a) => a.toolUseId === event.tool_use_id);
      if (!alreadyExists) {
        sessionStore.addSubAgent(sessionId, {
          toolUseId: event.tool_use_id,
          description: "Launching agent...",
          subagentType: "general-purpose",
          isBackground: false,
          startedAt: now,
          elapsed: 0,
          status: "preparing",
        });
      }
      sessionStore.setSessionActivity(sessionId, {
        label: "Launching agent...",
        toolName: "Agent",
        toolElapsed: 0,
        filePath: null,
      });
      break;
    }

    case "tool_use_start":
      handleToolUseStart(sessionId, event, activityStore, sessionStore, now);
      break;

    case "tool_progress": {
      useSessionStore.getState().touchLastEvent(sessionId);
      sessionStore.ensureBusy(sessionId);
      const currentActivity = sessionStore.sessionActivity.get(sessionId);

      // Update sub-agent elapsed time (create placeholder if it doesn't exist yet)
      if (event.tool_name === "Agent") {
        const agentList = sessionStore.activeSubAgents.get(sessionId);
        const agentExists = agentList?.find((a) => a.toolUseId === event.tool_use_id);
        if (agentExists) {
          sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
            elapsed: event.elapsed_seconds,
          });
        } else {
          sessionStore.addSubAgent(sessionId, {
            toolUseId: event.tool_use_id,
            description: "Agent running...",
            subagentType: "general-purpose",
            isBackground: false,
            startedAt: now,
            elapsed: event.elapsed_seconds,
            status: "running",
          });
        }
      }

      const label = event.tool_name === "Agent"
        ? subAgentActivityLabel(sessionId)
        : toolActivityLabel(event.tool_name);
      sessionStore.setSessionActivity(sessionId, {
        label,
        toolName: event.tool_name,
        toolElapsed: event.elapsed_seconds,
        filePath: currentActivity?.filePath ?? null,
      });
      break;
    }

    case "tool_result":
      handleToolResult(sessionId, event, activityStore, sessionStore);
      break;

    case "subagent_started": {
      // Phase 2: CLI emitted task_started — add or enrich existing agent info
      const existing = sessionStore.activeSubAgents.get(sessionId);
      const alreadyTracked = existing?.find((a) => a.toolUseId === event.tool_use_id);
      if (!alreadyTracked) {
        sessionStore.addSubAgent(sessionId, {
          toolUseId: event.tool_use_id,
          description: event.description,
          subagentType: event.subagent_type,
          isBackground: false,
          startedAt: now,
          elapsed: 0,
          status: "running",
        });
      } else if (alreadyTracked.description === "Sub-agent" && event.description) {
        // Phase 1 had incomplete input — enrich with Phase 2 data
        sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
          description: event.description,
          subagentType: event.subagent_type,
        });
      }
      sessionStore.setSessionActivity(sessionId, {
        label: subAgentActivityLabel(sessionId),
        toolName: "Agent",
        toolElapsed: 0,
        filePath: null,
      });
      break;
    }

    case "subagent_progress": {
      sessionStore.touchLastEvent(sessionId);
      sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
        toolCount: event.tool_count ?? undefined,
        tokenCount: event.token_count ?? undefined,
        currentActivity: event.current_activity ?? undefined,
      });
      sessionStore.setSessionActivity(sessionId, {
        label: subAgentActivityLabel(sessionId),
        toolName: "Agent",
        toolElapsed: 0,
        filePath: null,
      });
      break;
    }

    case "subagent_complete": {
      sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
        status: "done",
        toolCount: event.tool_count ?? undefined,
        tokenCount: event.token_count ?? undefined,
      });
      break;
    }
  }
}
