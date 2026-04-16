import * as Dialog from "@radix-ui/react-dialog";
import { X, RefreshCw } from "lucide-react";

interface Props {
  open: boolean;
  currentGuideTitle: string;
  newSpecFilename: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function GuideReplaceConfirmModal({
  open,
  currentGuideTitle,
  newSpecFilename,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[440px] rounded-xl border shadow-2xl"
          style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-light)" }}>
            <div className="flex items-center gap-2">
              <RefreshCw size={16} style={{ color: "var(--accent)" }} />
              <Dialog.Title className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Replace Implementation Guide?
              </Dialog.Title>
            </div>
            <Dialog.Close className="p-1 rounded hover:bg-bg-elevated transition-colors">
              <X size={14} style={{ color: "var(--text-ghost)" }} />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Unload the current guide for{" "}
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                &ldquo;{currentGuideTitle}&rdquo;
              </span>{" "}
              and load a new guide from{" "}
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {newSpecFilename}
              </span>
              ?
            </p>
            <p className="text-detail leading-relaxed" style={{ color: "var(--text-ghost)" }}>
              The current guide has not been started and will be replaced.
            </p>
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-2 px-5 py-3 border-t"
            style={{ borderColor: "var(--border-light)" }}
          >
            <button
              onClick={onCancel}
              className="px-4 py-1.5 rounded-lg text-xs transition-colors hover:bg-bg-elevated"
              style={{ color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-95"
              style={{ background: "var(--accent)", color: "white" }}
            >
              <RefreshCw size={12} />
              Replace Guide
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
