// Shared Radix Dialog shell for Branch Map guardrail dialogs, modeled on
// ToolApproval/ConfirmCloseModal: blurred overlay, centered card, an icon tile,
// title + description, a body slot (for the "what will happen" preview), and a
// footer button row. Keeps every branch dialog visually consistent.

import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { LucideIcon } from "lucide-react";
import { useModalSettle } from "../../hooks/useModalSettle";

export type DialogTint = "accent" | "yellow" | "green" | "red" | "blue";

const TINT: Record<DialogTint, { tile: string; icon: string }> = {
  accent: { tile: "bg-accent/10", icon: "text-accent" },
  yellow: { tile: "bg-yellow/10", icon: "text-yellow" },
  green: { tile: "bg-green/10", icon: "text-green" },
  red: { tile: "bg-red/10", icon: "text-red" },
  blue: { tile: "bg-blue/10", icon: "text-blue" },
};

interface BranchDialogShellProps {
  open: boolean;
  onClose: () => void;
  /** Enter-to-confirm handler (suppressed during the settle window). */
  onConfirm?: () => void;
  title: string;
  description?: React.ReactNode;
  Icon: LucideIcon;
  tint: DialogTint;
  children?: React.ReactNode;
  footer: React.ReactNode;
  width?: number;
}

export default function BranchDialogShell({
  open,
  onClose,
  onConfirm,
  title,
  description,
  Icon,
  tint,
  children,
  footer,
  width = 420,
}: BranchDialogShellProps) {
  const isSettling = useModalSettle(open);
  const tintCls = TINT[tint];

  useEffect(() => {
    if (!open || !onConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (isSettling()) return;
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onConfirm, isSettling]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border p-6"
          style={{ background: "var(--bg-primary)", width }}
        >
          <div className="flex items-start gap-3 mb-4">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tintCls.tile}`}
            >
              <Icon size={20} className={tintCls.icon} />
            </div>
            <div className="min-w-0">
              <Dialog.Title className="text-text-primary font-medium text-title">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="text-ui text-text-dim mt-0.5">
                  {description}
                </Dialog.Description>
              )}
            </div>
          </div>

          {children && <div className="mb-2">{children}</div>}

          <div className="flex justify-end gap-2 mt-5">{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Standard footer buttons. */
export function DialogButtons({
  onCancel,
  onConfirm,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmTint = "accent",
  busy = false,
  confirmDisabled = false,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  cancelLabel?: string;
  confirmTint?: "accent" | "red";
  busy?: boolean;
  confirmDisabled?: boolean;
}) {
  const confirmCls =
    confirmTint === "red"
      ? "bg-red hover:brightness-110"
      : "bg-accent hover:bg-accent-light";
  return (
    <>
      <button
        onClick={onCancel}
        disabled={busy}
        className="px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors disabled:opacity-60"
      >
        {cancelLabel}
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || confirmDisabled}
        className={`px-4 py-2 rounded-lg text-ui text-white transition-colors disabled:opacity-60 ${confirmCls}`}
      >
        {confirmLabel}
      </button>
    </>
  );
}
