// First-open consent modal — explains exactly what scanning means and
// gives the user a clean Yes/No choice. The user MUST be in control:
// detection only happens after explicit consent here.

import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";

interface DetectionPromptProps {
  open: boolean;
  /** Called with `true` to run detection, `false` to skip. */
  onChoose: (runDetection: boolean) => void;
}

export default function DetectionPrompt({ open, onChoose }: DetectionPromptProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onChoose(false); // closing == skip, never silent yes
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border p-6"
          style={{
            background: "var(--bg-primary)",
            borderColor: "var(--border)",
            width: "min(92vw, 520px)",
          }}
        >
          <div className="flex items-start gap-3 mb-4">
            <div
              className="rounded-full flex items-center justify-center shrink-0"
              style={{
                width: 36,
                height: 36,
                background: "color-mix(in srgb, var(--accent) 18%, transparent)",
                color: "var(--accent)",
              }}
            >
              <Search size={18} />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-ui font-semibold text-text-primary mb-1">
                Look for things you already have?
              </Dialog.Title>
              <Dialog.Description className="text-label text-text-secondary leading-relaxed">
                Some of the credentials this project needs may already be on
                your system. CodeMantis can briefly scan your environment
                variables and its own secret store to find them, so you don't
                have to enter them again.
              </Dialog.Description>
            </div>
          </div>

          <div
            className="rounded-md p-3 mb-4 space-y-1.5 text-detail text-text-secondary"
            style={{ background: "var(--bg-elevated)" }}
          >
            <p>
              <strong>What we check:</strong> environment variables (presence
              only — we never read their values into memory) and CodeMantis's
              own encrypted secret store.
            </p>
            <p>
              <strong>What we don't do:</strong> we never read or copy any
              value without your explicit confirmation.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onChoose(false)}
              className="px-3 py-1.5 rounded-md text-ui text-text-secondary hover:text-text-primary"
            >
              Skip detection
            </button>
            <button
              type="button"
              onClick={() => onChoose(true)}
              className="px-4 py-1.5 rounded-md text-ui font-medium"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Run detection
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
