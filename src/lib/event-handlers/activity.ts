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
import { assertActivitySessionScope } from "../session-integrity";
import { detectSettingsCarveout } from "../carveout-detector";
import { isInterruptCancellation } from "../interrupt-detector";
import { handleError } from "../error-handler";
import { info as logInfo } from "@tauri-apps/plugin-log";

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

  // AskUserQuestion: surfaces via QuestionModal (driven by useToolApprovalListener
  // off the approval HTTP server's tool-approval-request event). The CLI also
  // emits this same tool_use through the assistant stream — suppress that copy
  // here so it doesn't render as a stray "User Question" activity entry with
  // duplicated "Answer questions?" text. Registering the tool_use_id in
  // modeControlToolIds also suppresses the matching tool_result (line 231).
  if (event.tool_name === "AskUserQuestion") {
    modeControlToolIds.add(event.tool_use_id);
    return;
  }

  // Mode-control tools: sync session mode and skip activity feed
  if (event.tool_name === "ExitPlanMode" || event.tool_name === "EnterPlanMode") {
    // Diagnostic: pair with [plan-modal] logs in
    // src-tauri/src/claude/message_router.rs and PlanCompleteModal.tsx.
    // Together they trace router emit → activity handler → modal mount.
    const activeAtArrival = sessionStore.activeSessionId;
    const inputKeys = event.tool_input ? Object.keys(event.tool_input) : [];
    logInfo(
      `[plan-modal] activity received ToolUseStart: tool=${event.tool_name} id=${event.tool_use_id} session=${sessionId} active=${activeAtArrival ?? "null"} input_keys=${JSON.stringify(inputKeys)}`,
    ).catch(() => {});

    modeControlToolIds.add(event.tool_use_id);
    const newMode: SessionMode = event.tool_name === "EnterPlanMode" ? "plan" : "normal";
    sessionStore.setSessionMode(sessionId, newMode);
    // Persist to SQLite so the mode survives reload. Surface failures via
    // handleError — silent divergence between frontend and backend has caused
    // mode-revert-on-reload regressions before. The frontend store still
    // updated above, so a sync failure leaves the UI accurate for the
    // current session; the toast tells the user to expect a revert.
    import("../tauri-commands").then(({ syncSessionMode }) => {
      syncSessionMode(sessionId, newMode).catch((e) => {
        handleError(`activity: failed to persist ${newMode} mode for session`, e);
      });
    });

    if (event.tool_name === "ExitPlanMode") {
      // Capture plan state into uiStore regardless of which session the user
      // is currently looking at. The CLI emits ExitPlanMode for the session
      // the agent is running in, NOT the session the user has selected — if
      // the user switched tabs while the agent finished planning, dropping
      // this state means the plan is lost forever (the banner relies on
      // pendingPlanSessionId being set to surface a "Review" affordance when
      // the user returns).
      //
      // Claude Code 2.1.126 emits `plan` (markdown text) directly in the
      // ExitPlanMode tool_input. Older versions sometimes emit `planFilePath`
      // as well (path under ~/.claude/plans/*.md); prefer direct content
      // when available — see docs/internal/cli-2.1.126-protocol-report.md.
      const input = event.tool_input as { plan?: unknown; planFilePath?: unknown } | undefined;
      const directPlanFilePath =
        typeof input?.planFilePath === "string" ? input.planFilePath : null;
      const directPlanContent =
        typeof input?.plan === "string" ? input.plan : null;

      const uiState = useUiStore.getState();
      uiState.setPlanCompleteSessionId(sessionId);
      uiState.setPendingPlanSessionId(sessionId);
      if (directPlanFilePath) {
        uiState.setPlanCompleteFilePath(directPlanFilePath);
      }
      if (directPlanContent) {
        uiState.setPlanCompleteContent(directPlanContent);
        // Persist the generated plan to <project_root>/plans/ for both
        // agents (Codex's synthesized ExitPlanMode flows through here too).
        // Fire-and-forget — failures toast but never block the plan flow.
        import("../plan-actions").then(({ persistPlanDocument }) => {
          void persistPlanDocument(sessionId, directPlanContent);
        });
      }

      // Modal + auto-open the file viewer ONLY for the currently-active
      // session. For any other session, the PlanPendingBanner picks up the
      // pendingPlanSessionId we just set and offers Review on return.
      const isActive = sessionId === sessionStore.activeSessionId;
      logInfo(
        `[plan-modal] activity ExitPlanMode: session=${sessionId} active=${isActive} hasPlanContent=${directPlanContent !== null} hasPlanFilePath=${directPlanFilePath !== null} willOpenModal=${isActive}`,
      ).catch(() => {});
      if (isActive) {
        uiState.setShowPlanCompleteModal(true);

        const planFilePath = directPlanFilePath ?? uiState.planCompleteFilePath;
        if (planFilePath) {
          const fileName = planFilePath.split("/").pop() ?? planFilePath;
          if (directPlanContent) {
            useFileViewerStore.getState().openFile(sessionId, {
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
                useFileViewerStore.getState().openFile(sessionId, {
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
  assertActivitySessionScope(sessionId, entry, "tool_use_start");
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
  // Bump the activity timestamp so useStuckActivityWatchdog observes
  // forward progress. Without this, a tool that completes after the
  // 30s threshold leaves `sessionStuck` set until the next non-result
  // event arrives — which for a tool that returned an error could be
  // never.
  useSessionStore.getState().touchLastEvent(sessionId);

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
  // An interrupt-cancelled tool (the CLI's reason-less "user doesn't want to
  // proceed…" artifact — e.g. a slow MCP tool that hung until a new message
  // interrupted the turn) is NOT a real error/rejection. Classify it as
  // "interrupted" so the feed shows a calm, accurate state instead of a red
  // rejection that makes the agent look like it's "waiting for approval" the
  // user was never shown. See lib/interrupt-detector.ts.
  const interrupted = event.is_error && isInterruptCancellation(event.content);

  activityStore.updateEntryStatus(
    sessionId,
    event.tool_use_id,
    interrupted ? "interrupted" : event.is_error ? "error" : "done",
    event.content ?? undefined,
    interrupted ? false : event.is_error
  );

  // Surface a friendly hint when the CLI silently rejects writes to its own
  // settings files (the 2.1.x privilege-escalation carve-out). The error
  // string is otherwise opaque ("haven't granted it yet") and the
  // PreToolUse hook is never called for these paths, so Auto-Accept can't
  // suppress it. Skip for interrupted tools — they are not real errors.
  if (event.is_error && !interrupted) {
    const entry = activityStore
      .getActiveEntries(sessionId)
      .find((e) => e.toolUseId === event.tool_use_id);
    if (entry) {
      const carveout = detectSettingsCarveout({
        toolName: entry.toolName,
        toolInput: entry.toolInput,
        errorContent: event.content,
        isError: true,
      });
      if (carveout) {
        activityStore.updateEntryExtra(sessionId, event.tool_use_id, {
          helpHint: carveout.hint,
        });
      }
    }
  }

  // Refresh file tree after mutating tools complete
  if (!event.is_error) {
    const allEntries = activityStore.getActiveEntries(sessionId);
    const toolEntry = allEntries.find((e) => e.toolUseId === event.tool_use_id);
    if (toolEntry && MUTATING_TOOLS.has(toolEntry.toolName)) {
      useUiStore.getState().triggerFileTreeRefresh();
    }
  }

  // Auto-open file when Write or Edit tool completes successfully
  // Only auto-switch tab for the active session
  if (!event.is_error && useSettingsStore.getState().settings.autoOpenFiles) {
    const isActiveSession = sessionId === sessionStore.activeSessionId;
    const isMainSession = sessionStore.sessions.has(sessionId);
    const entries = activityStore.getActiveEntries(sessionId);
    const entry = entries.find((e) => e.toolUseId === event.tool_use_id);
    if (entry && isMainSession) {
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
            useFileViewerStore.getState().openFile(sessionId, {
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
            if (isActiveSession) {
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

    case "task_notification": {
      // CLI v2.1.119+ replacement for `task_complete`. Routes the background-task
      // completion signal into the existing Sub-Agent UI when `tool_use_id` is
      // set (which is the Agent tool's use-id on sub-agent tasks).
      sessionStore.touchLastEvent(sessionId);
      const tokenCount = event.usage?.output_tokens ?? undefined;
      const agentStatus: "done" | "error" = event.status === "completed" ? "done" : "error";
      if (event.tool_use_id) {
        const agents = sessionStore.activeSubAgents.get(sessionId);
        const linkedAgent = agents?.find((a) => a.toolUseId === event.tool_use_id);
        if (linkedAgent) {
          sessionStore.updateSubAgent(sessionId, event.tool_use_id, {
            status: agentStatus,
            tokenCount: tokenCount ?? linkedAgent.tokenCount,
            summary: event.summary ?? undefined,
            outputFile: event.output_file ?? undefined,
          });
        }
        if (tokenCount != null && tokenCount > 0) {
          activityStore.updateEntryExtra(sessionId, event.tool_use_id, {
            agentFinalTokenCount: tokenCount,
          });
        }
      }
      break;
    }

    case "task_updated": {
      // Low-volume incremental patch (observed 8 times vs 364 task_notification).
      // Patch shape is not yet characterised — forwarded from Rust verbatim, but
      // we don't interpret it here. Touching the session keeps UI indicators
      // from going stale during long tasks.
      sessionStore.touchLastEvent(sessionId);
      break;
    }
  }
}
