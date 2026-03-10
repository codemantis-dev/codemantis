import { useEffect } from "react";
import { listenToolApprovalRequests, resolveToolApproval } from "../lib/tauri-commands";
import type { ToolApprovalRequestEvent } from "../types/claude-events";
import { useActivityStore, type PendingQuestion } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";

/**
 * Parse the AskUserQuestion tool_input into a PendingQuestion.
 */
function parseAskUserQuestion(
  toolInput: Record<string, unknown>,
  requestId: string,
  sessionId: string,
): PendingQuestion {
  const pq: PendingQuestion = {
    toolUseId: requestId,
    requestId,
    sessionId,
  };

  // Simple text question
  if (typeof toolInput.question === "string") {
    pq.question = toolInput.question;
  }

  // Multi-question with options
  if (Array.isArray(toolInput.questions)) {
    pq.questions = (toolInput.questions as Record<string, unknown>[]).map((q) => ({
      header: typeof q.header === "string" ? q.header : "",
      multiSelect: q.multiSelect === true,
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
    let unlisten: (() => void) | null = null;

    listenToolApprovalRequests((event: ToolApprovalRequestEvent) => {
      console.log("[tool-approval-request]", event);

      const activityStore = useActivityStore.getState();
      const uiStore = useUiStore.getState();

      const { requestId, toolName, toolInput, forgeSessionId } = event;

      // Route AskUserQuestion to the QuestionModal instead of the approval modal
      if (toolName === "AskUserQuestion") {
        const pq = parseAskUserQuestion(toolInput, requestId, forgeSessionId);
        activityStore.setPendingQuestion(forgeSessionId, pq);
        uiStore.setShowQuestionModal(true);
        return;
      }

      // Auto-approve if user previously clicked "Always allow" for this tool
      if (activityStore.isToolAlwaysAllowed(toolName)) {
        console.log("[approval] Auto-approving always-allowed tool:", toolName);
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
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}
