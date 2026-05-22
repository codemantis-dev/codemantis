import { useEffect } from "react";
import { listenToolApprovalRequests, listenSessionModeChanged, resolveToolApproval } from "../lib/tauri-commands";
import type { ToolApprovalRequestEvent } from "../types/agent-events";
import type { SessionMode } from "../types/session";
import { useActivityStore, type PendingQuestion } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { useSessionStore } from "../stores/sessionStore";
import { assertActivitySessionScope } from "../lib/session-integrity";


/**
 * Parse the AskUserQuestion tool_input into a PendingQuestion.
 */
function parseAskUserQuestion(
  toolInput: Record<string, unknown>,
  requestId: string,
  sessionId: string,
): PendingQuestion {
  // `agentKind` marker is set by the Codex translator (approvals.rs) on
  // `item/tool/requestUserInput` to flip the answer routing. Claude
  // sessions don't send it → defaults to "claude".
  const agentKind =
    toolInput.agentKind === "codex" ? "codex" : "claude";

  const pq: PendingQuestion = {
    toolUseId: requestId,
    requestId,
    sessionId,
    agentKind,
  };

  // Simple text question
  if (typeof toolInput.question === "string") {
    pq.question = toolInput.question;
  }

  // Multi-question with options
  if (Array.isArray(toolInput.questions)) {
    pq.questions = (toolInput.questions as Record<string, unknown>[]).map((q) => ({
      // Codex carries a per-question `id` that keys the structured
      // response (`{ answers: { [id]: { answers: [] } } }`). Claude
      // leaves it undefined → response goes via send_user_message.
      id: typeof q.id === "string" ? q.id : undefined,
      header: typeof q.header === "string" ? q.header : "",
      question: typeof q.question === "string" ? q.question : "",
      multiSelect: q.multiSelect === true,
      isOther: q.isOther === true,
      isSecret: q.isSecret === true,
      options: Array.isArray(q.options)
        ? (q.options as unknown[]).map((o) => {
            if (typeof o === "object" && o !== null) {
              const obj = o as Record<string, unknown>;
              const label = typeof obj.label === "string" ? obj.label : "";
              const value = typeof obj.value === "string" ? obj.value : "";
              const description = typeof obj.description === "string" ? obj.description : "";
              return { label: label || value, value: value || label, description };
            }
            return { label: String(o), value: String(o), description: "" };
          })
        : [],
    }));
  }

  return pq;
}

/**
 * Global listener for tool approval requests from the approval HTTP server.
 *
 * Mode enforcement (auto-accept, plan) is handled at the Rust approval server
 * level — only requests that pass mode checks reach this listener.
 *
 * This listener handles "Always allow" per-tool rules and enqueues remaining
 * approvals for the ToolApproval modal.
 *
 * AskUserQuestion is intercepted here and routed to the QuestionModal instead.
 *
 * Must be mounted once at the App level (not per-session).
 */
export function useToolApprovalListener(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let unlistenModeChange: (() => void) | null = null;

    listenSessionModeChanged(({ sessionId, mode }) => {
      useSessionStore.getState().setSessionMode(sessionId, mode as SessionMode);
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlistenModeChange = fn;
    });

    listenToolApprovalRequests((event: ToolApprovalRequestEvent) => {
      const activityStore = useActivityStore.getState();
      const uiStore = useUiStore.getState();

      const { requestId, toolName, toolInput, forgeSessionId } = event;

      // Route AskUserQuestion to the QuestionModal instead of the approval modal
      if (toolName === "AskUserQuestion") {
        if (import.meta.env.DEV) {
          console.debug(
            "[QuestionModal] tool-approval-request received",
            { requestId, forgeSessionId, hasInput: !!toolInput },
          );
        }
        const pq = parseAskUserQuestion(toolInput, requestId, forgeSessionId);
        activityStore.setPendingQuestion(forgeSessionId, pq);
        uiStore.setShowQuestionModal(true);
        return;
      }

      // Auto-approve if user previously clicked "Always allow" for this tool in this session
      if (activityStore.isToolAlwaysAllowed(forgeSessionId, toolName)) {
        const autoEntry = {
          id: `auto-${requestId}`,
          toolUseId: requestId,
          toolName,
          toolInput,
          status: "running" as const,
          result: "Auto-approved (always allowed)",
          timestamp: new Date().toISOString(),
          messageId: "",
          isError: false,
          approvalStatus: "approved" as const,
          approvalTimestamp: new Date().toISOString(),
        };
        assertActivitySessionScope(forgeSessionId, autoEntry, "approval_auto_allow");
        activityStore.addEntry(forgeSessionId, autoEntry);
        resolveToolApproval(requestId, true).catch((e) =>
          console.error("Failed to auto-approve tool:", e)
        );
        return;
      }

      // Enqueue for user decision via modal
      activityStore.enqueueApproval({
        requestId,
        toolUseId: requestId,
        toolName,
        toolInput,
        sessionId: forgeSessionId,
        timestamp: new Date().toISOString(),
      });

      if (!uiStore.showApprovalModal) {
        uiStore.setShowApprovalModal(true);
      }
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (unlistenModeChange) unlistenModeChange();
    };
  }, []);
}
