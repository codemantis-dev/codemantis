import { useCallback } from "react";
import { ClipboardCheck, Play, Eye, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { implementPendingPlan } from "../../lib/plan-actions";

/**
 * Slim banner rendered above the InputArea when the active session has a
 * plan pending approval but the Plan Complete modal is currently closed.
 *
 * - Review → reopens the modal with the same plan data.
 * - Implement → dispatches the implement flow (same as modal's "Implement Now").
 * - × → discards the pending plan.
 *
 * Session-scoped: hides when the user switches to a different session, so
 * it never appears for a session that isn't the plan's owner.
 */
export default function PlanPendingBanner() {
  const pendingPlanSessionId = useUiStore((s) => s.pendingPlanSessionId);
  const showModal = useUiStore((s) => s.showPlanCompleteModal);
  const planFilePath = useUiStore((s) => s.planCompleteFilePath);
  const setShowModal = useUiStore((s) => s.setShowPlanCompleteModal);
  const clearPendingPlan = useUiStore((s) => s.clearPendingPlan);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const handleReview = useCallback(() => {
    setShowModal(true);
  }, [setShowModal]);

  const handleImplement = useCallback(() => {
    if (!activeSessionId) return;
    void implementPendingPlan(activeSessionId, false);
  }, [activeSessionId]);

  const handleDismiss = useCallback(() => {
    clearPendingPlan();
  }, [clearPendingPlan]);

  // Hide when:
  //  - no plan is pending,
  //  - the pending plan belongs to a different session,
  //  - the full approval modal is already open (no need to double-show).
  if (
    !pendingPlanSessionId ||
    pendingPlanSessionId !== activeSessionId ||
    showModal
  ) {
    return null;
  }

  const fileLabel = planFilePath
    ? planFilePath.split("/").pop() ?? planFilePath
    : null;

  return (
    <div
      className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-subtle"
      role="status"
      aria-label="Plan ready to implement"
    >
      <ClipboardCheck size={14} className="shrink-0 text-green" />
      <div className="flex-1 min-w-0 flex items-center gap-2 truncate">
        <span className="text-ui text-text-primary font-medium shrink-0">
          Plan ready to implement
        </span>
        {fileLabel && (
          <span className="text-label text-text-dim font-mono truncate">
            {fileLabel}
          </span>
        )}
      </div>
      <button
        onClick={handleReview}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
        title="Reopen the Plan Approval modal"
      >
        <Eye size={12} />
        <span>Review</span>
      </button>
      <button
        onClick={handleImplement}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-label font-medium bg-accent text-white hover:bg-accent-light transition-colors shrink-0"
        title="Send the implement message to Claude"
      >
        <Play size={12} />
        <span>Implement</span>
      </button>
      <button
        onClick={handleDismiss}
        className="w-6 h-6 flex items-center justify-center rounded-md text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
        title="Dismiss — discard the plan"
        aria-label="Dismiss pending plan"
      >
        <X size={12} />
      </button>
    </div>
  );
}
