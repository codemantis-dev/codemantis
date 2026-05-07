import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldAlert, ChevronLeft, ChevronRight } from "lucide-react";
import { useActivityStore } from "../../stores/activityStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { useUiStore } from "../../stores/uiStore";
import { resolveToolApproval } from "../../lib/tauri-commands";
import { handleError } from "../../lib/error-handler";
import ToolBadge from "../shared/ToolBadge";

// Ignore keystrokes (and stray pointer-down-outside) for this many ms after the
// modal opens. Absorbs in-flight keys from a chat the user was typing in when
// an unrelated approval popped up — Enter/Escape would otherwise resolve a
// modal the user hadn't even read yet.
const SETTLE_MS = 400;

export default function ToolApproval() {
  const approvalQueue = useActivityStore((s) => s.approvalQueue);
  const currentApprovalIndex = useActivityStore((s) => s.currentApprovalIndex);
  const showModal = useUiStore((s) => s.showApprovalModal);
  const setShowModal = useUiStore((s) => s.setShowApprovalModal);

  const currentApproval = approvalQueue[currentApprovalIndex];
  const queueSize = approvalQueue.length;

  // Derive project path and name from the current approval's session
  const sessionId = currentApproval?.sessionId;
  const session = sessionId ? useSessionStore.getState().sessions.get(sessionId) : undefined;
  const assistantInstance = session
    ? undefined
    : sessionId
      ? useAssistantStore.getState().findAssistantInstance(sessionId)
      : undefined;
  const projectPath = session?.project_path ?? assistantInstance?.projectPath ?? "";
  const projectName = projectPath.split("/").pop() ?? projectPath;

  // Auto-open modal when items enqueue
  useEffect(() => {
    if (queueSize > 0 && !showModal) {
      setShowModal(true);
    }
  }, [queueSize, showModal, setShowModal]);

  // Auto-close modal when queue empties
  useEffect(() => {
    if (queueSize === 0 && showModal) {
      setShowModal(false);
    }
  }, [queueSize, showModal, setShowModal]);

  const navigateQueue = useCallback(
    (direction: -1 | 1) => {
      const newIndex = currentApprovalIndex + direction;
      if (newIndex >= 0 && newIndex < queueSize) {
        useActivityStore.getState().setCurrentApprovalIndex(newIndex);
      }
    },
    [currentApprovalIndex, queueSize]
  );

  const handleResponse = useCallback(
    async (approved: boolean) => {
      if (!currentApproval) return;

      const { requestId, sessionId, toolUseId } = currentApproval;
      const decision = approved ? "approved" : "denied";

      useActivityStore
        .getState()
        .recordApprovalDecision(sessionId, toolUseId, decision);

      try {
        await resolveToolApproval(
          requestId,
          approved,
          approved ? undefined : "Denied by user"
        );
      } catch (e) {
        handleError("approval-response: Failed", e);
      }

      useActivityStore.getState().dequeueApproval(toolUseId);
    },
    [currentApproval]
  );

  const handleApproveAll = useCallback(async () => {
    // Copy the queue since it mutates as we dequeue
    const items = [...approvalQueue];
    for (const item of items) {
      const { requestId, sessionId, toolUseId } = item;

      useActivityStore
        .getState()
        .recordApprovalDecision(sessionId, toolUseId, "approved");

      try {
        await resolveToolApproval(requestId, true);
      } catch (e) {
        handleError("approval-response: Failed in approve-all", e);
      }

      useActivityStore.getState().dequeueApproval(toolUseId);
    }
  }, [approvalQueue]);

  // Settling window — see SETTLE_MS comment at module top.
  const openedAtRef = useRef<number>(0);
  useEffect(() => {
    if (showModal) openedAtRef.current = performance.now();
  }, [showModal]);
  const isSettling = useCallback(
    () => performance.now() - openedAtRef.current < SETTLE_MS,
    []
  );

  const onDialogKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (isSettling()) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleResponse(true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateQueue(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateQueue(1);
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleApproveAll();
      }
    },
    [isSettling, handleResponse, navigateQueue, handleApproveAll]
  );

  const inputStr = useMemo(
    () => currentApproval ? JSON.stringify(currentApproval.toolInput, null, 2) : "",
    [currentApproval]
  );

  if (!currentApproval) return null;

  return (
    <Dialog.Root
      open={showModal}
      onOpenChange={(open) => {
        // Only honor close requests after the settling window — protects against
        // stray Escape / pointer-down-outside in the first ~400ms after open.
        if (!open && isSettling()) return;
        setShowModal(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[440px] rounded-xl border border-border p-6"
          style={{ background: "var(--bg-primary)" }}
          onKeyDown={onDialogKeyDown}
          onEscapeKeyDown={(e) => {
            if (isSettling()) {
              e.preventDefault();
              return;
            }
            e.preventDefault();
            handleResponse(false);
          }}
          onOpenAutoFocus={(e) => {
            // Don't auto-focus the first button ("Always allow …") — a stray
            // Enter would otherwise grant a session-wide permission.
            e.preventDefault();
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-yellow/10">
              <ShieldAlert size={20} className="text-yellow" />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-text-primary font-medium">
                Approve Tool?
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim">
                Claude wants to use a tool
                {projectName && (
                  <> in <span className="text-accent font-medium">{projectName}</span></>
                )}
              </Dialog.Description>
            </div>
            {queueSize > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigateQueue(-1)}
                  disabled={currentApprovalIndex === 0}
                  aria-label="Previous approval"
                  className="p-1 rounded hover:bg-bg-elevated transition-colors disabled:opacity-30"
                >
                  <ChevronLeft size={16} className="text-text-secondary" />
                </button>
                <span className="text-label text-text-dim font-mono min-w-[3ch] text-center">
                  {currentApprovalIndex + 1}/{queueSize}
                </span>
                <button
                  onClick={() => navigateQueue(1)}
                  disabled={currentApprovalIndex >= queueSize - 1}
                  aria-label="Next approval"
                  className="p-1 rounded hover:bg-bg-elevated transition-colors disabled:opacity-30"
                >
                  <ChevronRight size={16} className="text-text-secondary" />
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border-light p-3 mb-4" style={{ background: "var(--bg-elevated)" }}>
            <div className="flex items-center gap-2 mb-2">
              <ToolBadge toolName={currentApproval.toolName} />
              <span className="text-ui text-text-primary font-medium">
                {currentApproval.toolName}
              </span>
            </div>
            <pre className="text-label text-text-dim font-mono whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
              {inputStr}
            </pre>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                if (sessionId) {
                  useActivityStore.getState().addAlwaysAllowedTool(sessionId, currentApproval.toolName);
                }
                handleResponse(true);
              }}
              className="text-label text-text-faint hover:text-text-dim transition-colors text-left min-w-0 break-words"
            >
              Always allow <span className="break-all">{currentApproval.toolName}</span> in this session
            </button>
            <div className="flex gap-2">
              {queueSize > 1 && (
                <button
                  onClick={handleApproveAll}
                  className="px-4 py-2 rounded-lg text-ui text-accent border border-accent/30 hover:bg-accent/10 transition-colors"
                >
                  Approve all ({queueSize})
                </button>
              )}
              <button
                onClick={() => handleResponse(false)}
                className="px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
              >
                Deny
              </button>
              <button
                onClick={() => handleResponse(true)}
                className="px-4 py-2 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors"
              >
                Approve
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
