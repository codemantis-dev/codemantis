import { useEffect } from "react";
import { listenToolApprovalRequests, resolveToolApproval } from "../lib/tauri-commands";
import type { ToolApprovalRequestEvent } from "../types/claude-events";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";

/**
 * Global listener for tool approval requests from the approval HTTP server.
 *
 * Mode enforcement (auto-accept, plan) is handled at the Rust approval server
 * level — only requests that pass mode checks reach this listener.
 *
 * This listener handles "Always allow" per-tool rules and enqueues remaining
 * approvals for the ToolApproval modal.
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
