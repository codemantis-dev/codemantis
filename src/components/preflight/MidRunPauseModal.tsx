// MidRunPauseModal — fired when Self-Drive pauses on a capability-missing
// blocker. Surfaces the context (which session, which capability, why it
// failed) and offers a single primary action to open the SetupFlow.
//
// Why this is just a context notice (not the fix flow itself): nesting two
// Dialog modals creates two close buttons, two overlays, accessibility chaos.
// The parent (Self-Drive) wires the "Fix now" click to open the regular
// SetupFlowModal — sequential UX, simple component.

import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, X } from "lucide-react";

interface MidRunPauseModalProps {
  open: boolean;
  /** Display name of the session Self-Drive was about to run. */
  sessionName: string;
  /** Index of the paused session (Self-Drive resumes from here on success). */
  sessionIndex: number;
  /** Human-friendly service name from the catalog (e.g. "Stripe"). */
  serviceName: string;
  /** Optional last-known reason from the verifier (e.g. "API rejected the key"). */
  reason?: string | null;
  /** Called when the user dismisses without fixing — Self-Drive stays paused. */
  onClose: () => void;
  /** Called when the user wants to fix it now — parent opens SetupFlowModal. */
  onFixNow: () => void;
}

export default function MidRunPauseModal({
  open,
  sessionName,
  sessionIndex,
  serviceName,
  reason,
  onClose,
  onFixNow,
}: MidRunPauseModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 rounded-xl border p-5"
          style={{
            background: "var(--bg-primary)",
            borderColor: "var(--border)",
            width: "min(92vw, 480px)",
          }}
          data-testid="mid-run-pause-modal"
        >
          <div className="flex items-start gap-3 mb-4">
            <div
              className="rounded-full flex items-center justify-center shrink-0"
              style={{
                width: 36,
                height: 36,
                background: "color-mix(in srgb, rgb(239, 68, 68) 18%, transparent)",
                color: "rgb(239, 68, 68)",
              }}
            >
              <AlertCircle size={18} />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-ui font-semibold text-text-primary">
                Self-Drive paused
              </Dialog.Title>
              <Dialog.Description className="text-label text-text-secondary mt-1 leading-relaxed">
                We were about to run session {sessionIndex} (
                <span className="text-text-primary">{sessionName}</span>) but{" "}
                <span className="text-text-primary font-medium">{serviceName}</span>{" "}
                didn't pass its check.
              </Dialog.Description>
              {reason && (
                <p
                  className="text-detail mt-2"
                  style={{ color: "rgb(239, 68, 68)" }}
                >
                  {reason}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-text-dim hover:text-text-primary"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <p className="text-label text-text-secondary mb-4 leading-relaxed">
            Set it back up and we'll resume from this session — nothing was
            executed yet, so no work is lost.
          </p>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-ui text-text-secondary hover:text-text-primary"
            >
              Stay paused
            </button>
            <button
              type="button"
              onClick={onFixNow}
              className="px-4 py-1.5 rounded-md text-ui font-medium"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Fix now
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
