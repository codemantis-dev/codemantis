import { XCircle, CheckCircle2, Info, AlertTriangle, type LucideIcon } from "lucide-react";
import { useToastStore } from "../../stores/toastStore";
import type { ToastType } from "../../stores/toastStore";

const BORDER_COLORS: Record<ToastType, string> = {
  error: "var(--red)",
  success: "var(--green)",
  info: "var(--blue)",
  warning: "var(--yellow, #f59e0b)",
};

const TOAST_ICONS: Record<ToastType, { icon: LucideIcon; color: string }> = {
  error: { icon: XCircle, color: "var(--red)" },
  success: { icon: CheckCircle2, color: "var(--green)" },
  info: { icon: Info, color: "var(--blue)" },
  warning: { icon: AlertTriangle, color: "var(--yellow, #f59e0b)" },
};

export default function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const { icon: Icon, color: iconColor } = TOAST_ICONS[toast.type];
        const handleAction = toast.action
          ? () => {
              // Capture the action ref so a re-render mid-click doesn't lose
              // the handler. Dismiss-by-default keeps the toast from
              // lingering after the user has acted on it.
              const a = toast.action!;
              a.onClick();
              if (!a.keepOpen) removeToast(toast.id);
            }
          : undefined;
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-2.5 w-[360px] max-w-[360px] rounded-lg border px-4 py-3 shadow-lg animate-toast-in"
            style={{
              background: "var(--bg-primary)",
              borderColor: "var(--border)",
              borderLeftWidth: "3px",
              borderLeftColor: BORDER_COLORS[toast.type],
            }}
          >
            <Icon size={16} className="shrink-0 mt-0.5" style={{ color: iconColor }} />
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              <span
                className="text-ui break-words"
                style={{ color: "var(--text-primary)" }}
              >
                {toast.message}
              </span>
              {toast.action && (
                <button
                  type="button"
                  onClick={handleAction}
                  className="self-start rounded-md border px-2.5 py-1 text-ui-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-primary)",
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 text-text-ghost hover:text-text-secondary transition-colors text-ui leading-none mt-0.5"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        );
      })}

      <style>{`
        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateX(16px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-toast-in {
          animation: toast-in 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
