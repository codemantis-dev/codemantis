import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ClipboardCheck, X } from "lucide-react";
import { info as logInfo } from "@tauri-apps/plugin-log";
import { useUiStore } from "../../stores/uiStore";
import { openFileInViewer } from "../../hooks/useFileViewer";
import { implementPendingPlan } from "../../lib/plan-actions";
import { useModalSettle } from "../../hooks/useModalSettle";

export default function PlanCompleteModal() {
  const showModal = useUiStore((s) => s.showPlanCompleteModal);
  const sessionId = useUiStore((s) => s.planCompleteSessionId);
  const planFilePath = useUiStore((s) => s.planCompleteFilePath);
  const planContent = useUiStore((s) => s.planCompleteContent);
  const setShowModal = useUiStore((s) => s.setShowPlanCompleteModal);
  const [autoAccept, setAutoAccept] = useState(false);

  // Reset local state when modal opens
  useEffect(() => {
    if (showModal) {
      setAutoAccept(false);
    }
  }, [showModal]);

  // Diagnostic: pair with [plan-modal] logs in message_router.rs and
  // activity.ts. Logs every transition of (showModal, sessionId) so a single
  // grep on the codemantis log file traces emit → handler → mount.
  // We log render-decisions (rendered? skipped? why?) only on transitions, not
  // on every render — `useRef` keeps the prior tuple to detect changes.
  const lastLoggedRef = useRef<string>("");
  useEffect(() => {
    const willRender = showModal && sessionId !== null;
    const reason = !showModal
      ? "showModal=false"
      : sessionId === null
        ? "sessionId=null (state not yet set or cleared)"
        : "ok";
    const tuple = `${showModal}|${sessionId ?? "null"}|${willRender}|${reason}`;
    if (lastLoggedRef.current !== tuple) {
      lastLoggedRef.current = tuple;
      logInfo(
        `[plan-modal] modal render decision: showModal=${showModal} sessionId=${sessionId ?? "null"} willRender=${willRender} reason=${reason}`,
      ).catch(() => {});
    }
  }, [showModal, sessionId]);

  const handleClose = useCallback(() => {
    setShowModal(false);
  }, [setShowModal]);

  const handleRevealPlanFile = useCallback(() => {
    if (!planFilePath || !sessionId) return;
    // Reads the file, opens a tab, and switches the right panel to "files".
    // (setActiveFile alone is a no-op when the file isn't already open.)
    void openFileInViewer(planFilePath);
    setShowModal(false);
  }, [planFilePath, sessionId, setShowModal]);

  const handleImplement = useCallback(async () => {
    if (!sessionId) return;
    // Shared helper — used by both this modal's "Implement Now" button and
    // the InputArea banner's "Implement" button. Clears pending state and
    // closes the modal on completion.
    await implementPendingPlan(sessionId, autoAccept);
  }, [sessionId, autoAccept]);

  const isSettling = useModalSettle(showModal);

  // Keyboard shortcut: Enter to implement. Settling guard suppresses a stray
  // Enter that was buffered from the chat input the moment this modal popped.
  useEffect(() => {
    if (!showModal) return;
    const handler = (e: KeyboardEvent) => {
      if (isSettling()) return;
      if (e.key === "Enter" && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleImplement();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showModal, handleImplement, isSettling]);

  if (!showModal || !sessionId) return null;

  return (
    <Dialog.Root
      open={showModal}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] max-h-[85vh] overflow-y-auto rounded-xl border border-border p-6"
          style={{ background: "var(--bg-primary)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green/10">
              <ClipboardCheck size={20} className="text-green" />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-text-primary font-medium">
                Plan Complete
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim">
                Claude has finished planning. Ready to implement?
              </Dialog.Description>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {/* Plan file info */}
          {planFilePath && (
            <button
              type="button"
              onClick={handleRevealPlanFile}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-border bg-bg-subtle mb-4 hover:border-accent/40 hover:bg-bg-elevated transition-colors cursor-pointer"
              title="Reveal in File Viewer"
            >
              <span className="text-label text-text-dim block mb-1">Plan file</span>
              <span className="text-ui text-text-secondary font-mono text-[12px] break-all">
                {planFilePath.split("/").pop() ?? planFilePath}
              </span>
              <span className="text-label text-accent block mt-0.5">
                Reveal in File Viewer →
              </span>
            </button>
          )}

          {/* Plan content preview — shown when the CLI emits the plan text
              directly in the ExitPlanMode input (Claude Code 2.1.x). */}
          {planContent && (
            <div className="mb-4 rounded-lg border border-border bg-bg-subtle overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-label text-text-dim">
                Plan preview
              </div>
              <pre className="px-3 py-2 text-ui text-text-secondary whitespace-pre-wrap break-words max-h-64 overflow-y-auto font-mono text-[12px]">
                {planContent}
              </pre>
            </div>
          )}

          {/* Auto-accept toggle */}
          <label className="flex items-start gap-3 px-3 py-3 rounded-lg border border-border bg-bg-subtle cursor-pointer hover:border-accent/30 transition-colors mb-5">
            <input
              type="checkbox"
              checked={autoAccept}
              onChange={(e) => setAutoAccept(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <div>
              <span className="text-ui text-text-primary font-medium block">
                Enable Auto-Accept
              </span>
              <span className="text-label text-text-dim block">
                Approve all tool calls automatically during implementation
              </span>
            </div>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-lg text-ui font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              Later
            </button>
            <button
              onClick={handleImplement}
              className="px-4 py-2 rounded-lg text-ui font-medium bg-accent text-white hover:bg-accent-light transition-colors"
            >
              Implement Now
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
