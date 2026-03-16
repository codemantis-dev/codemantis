import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ClipboardCheck, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { sendMessage, setSessionMode } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";

export default function PlanCompleteModal() {
  const showModal = useUiStore((s) => s.showPlanCompleteModal);
  const sessionId = useUiStore((s) => s.planCompleteSessionId);
  const setShowModal = useUiStore((s) => s.setShowPlanCompleteModal);
  const [autoAccept, setAutoAccept] = useState(false);

  // Reset local state when modal opens
  useEffect(() => {
    if (showModal) {
      setAutoAccept(false);
    }
  }, [showModal]);

  const handleClose = useCallback(() => {
    setShowModal(false);
  }, [setShowModal]);

  const handleImplement = useCallback(async () => {
    if (!sessionId) return;

    const store = useSessionStore.getState();
    const isBusy = store.sessionBusy.get(sessionId) ?? false;
    if (isBusy) {
      showToast("Session is busy — wait for the current operation to finish", "info");
      return;
    }

    // Switch to auto-accept mode if toggled
    if (autoAccept) {
      store.setSessionMode(sessionId, "auto-accept");
      try {
        await setSessionMode(sessionId, "auto-accept");
      } catch (e) {
        console.error("Failed to set auto-accept mode:", e);
        showToast("Failed to enable auto-accept mode", "error");
      }
    }

    // Add user message to store
    const msgId = `msg-plan-impl-${Date.now()}`;
    const prompt = "Go ahead, implement the plan.";
    store.addMessage(sessionId, {
      id: msgId,
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    store.setSessionBusy(sessionId, true);

    // Send via IPC
    try {
      await sendMessage(sessionId, prompt);
    } catch (e) {
      console.error("Failed to send implementation message:", e);
      store.setSessionBusy(sessionId, false);
      showToast("Failed to start implementation — session may have ended", "error");
    }

    setShowModal(false);
  }, [sessionId, autoAccept, setShowModal]);

  // Keyboard shortcut: Enter to implement
  useEffect(() => {
    if (!showModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleImplement();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showModal, handleImplement]);

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
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] rounded-xl border border-border p-6"
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
