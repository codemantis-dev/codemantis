import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";

export interface PendingClose {
  type: "session" | "project";
  id: string;
  name: string;
  sessionCount: number;
}

interface ConfirmCloseModalProps {
  pendingClose: PendingClose | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmCloseModal({
  pendingClose,
  onConfirm,
  onCancel,
}: ConfirmCloseModalProps) {
  const open = pendingClose !== null;

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onConfirm, onCancel]);

  if (!pendingClose) return null;

  const isProject = pendingClose.type === "project";
  const title = isProject
    ? `Close project "${pendingClose.name}"?`
    : `Close session "${pendingClose.name}"?`;

  const description = isProject
    ? pendingClose.sessionCount > 1
      ? `All ${pendingClose.sessionCount} sessions and their CLI processes will be stopped.`
      : "The session and its CLI process will be stopped."
    : "The Claude CLI process will be stopped.";

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[380px] rounded-xl border border-border p-6" style={{ background: "var(--bg-primary)" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-yellow/10">
              <AlertTriangle size={20} className="text-yellow" />
            </div>
            <div>
              <Dialog.Title className="text-text-primary font-medium text-title">
                {title}
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim mt-0.5">
                {description}
              </Dialog.Description>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 rounded-lg text-ui text-white bg-red hover:brightness-110 transition-colors"
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
