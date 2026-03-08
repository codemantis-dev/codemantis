import { useToastStore } from "../../stores/toastStore";
import type { ToastType } from "../../stores/toastStore";

const BORDER_COLORS: Record<ToastType, string> = {
  error: "var(--red)",
  success: "var(--green)",
  info: "var(--blue)",
};

export default function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-3 w-[360px] max-w-[360px] rounded-lg border px-4 py-3 shadow-lg animate-toast-in"
          style={{
            background: "var(--bg-primary)",
            borderColor: "var(--border)",
            borderLeftWidth: "3px",
            borderLeftColor: BORDER_COLORS[toast.type],
          }}
        >
          <span
            className="flex-1 text-ui break-words"
            style={{ color: "var(--text-primary)" }}
          >
            {toast.message}
          </span>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-text-ghost hover:text-text-secondary transition-colors text-ui leading-none mt-0.5"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}

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
