import { useCallback, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldAlert } from "lucide-react";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { respondToApproval } from "../../lib/tauri-commands";
import ToolBadge from "../shared/ToolBadge";

export default function ToolApproval() {
  const pendingApproval = useActivityStore((s) => s.pendingApproval);
  const showModal = useUiStore((s) => s.showApprovalModal);
  const setShowModal = useUiStore((s) => s.setShowApprovalModal);
  const session = useSessionStore((s) => s.session);
  const setPendingApproval = useActivityStore((s) => s.setPendingApproval);

  const handleResponse = useCallback(
    async (approved: boolean) => {
      if (!pendingApproval || !session) return;

      try {
        await respondToApproval(session.id, pendingApproval.toolUseId, approved);
      } catch (e) {
        console.error("Failed to respond to approval:", e);
      }

      setPendingApproval(null);
      setShowModal(false);
    },
    [pendingApproval, session, setPendingApproval, setShowModal]
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!showModal) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleResponse(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleResponse(false);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showModal, handleResponse]);

  if (!pendingApproval) return null;

  const inputStr = JSON.stringify(pendingApproval.toolInput, null, 2);

  return (
    <Dialog.Root open={showModal} onOpenChange={setShowModal}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[440px] rounded-xl border border-border p-6" style={{ background: "var(--bg-primary)" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-yellow/10">
              <ShieldAlert size={20} className="text-yellow" />
            </div>
            <div>
              <Dialog.Title className="text-text-primary font-medium">
                Approve Tool?
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim">
                Claude wants to use a tool
              </Dialog.Description>
            </div>
          </div>

          <div className="rounded-lg border border-border-light p-3 mb-4" style={{ background: "var(--bg-elevated)" }}>
            <div className="flex items-center gap-2 mb-2">
              <ToolBadge toolName={pendingApproval.toolName} />
              <span className="text-ui text-text-primary font-medium">
                {pendingApproval.toolName}
              </span>
            </div>
            <pre className="text-label text-text-dim font-mono whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
              {inputStr}
            </pre>
          </div>

          <div className="flex items-center justify-between">
            <button className="text-label text-text-faint hover:text-text-dim transition-colors">
              Always allow {pendingApproval.toolName}
            </button>
            <div className="flex gap-2">
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
