import { create } from "zustand";

export type ToastType = "error" | "success" | "info" | "warning";

/**
 * Optional action button on a toast — used by features like Recognize Guide
 * auto-recovery where the warning surface offers a "Save corrected version"
 * follow-up. The callback runs in the user's interaction context; toast
 * dismissal is handled by the Toast component (action clicks dismiss the
 * toast by default unless `keepOpen` is true).
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
  /** When true, the toast is NOT auto-dismissed after the action fires. */
  keepOpen?: boolean;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];

  addToast: (
    message: string,
    type: ToastType,
    duration?: number,
    action?: ToastAction,
  ) => void;
  removeToast: (id: string) => void;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  info: 5000,
  // Warnings often carry an action button; give the user time to read +
  // click before the toast slides away.
  warning: 12000,
  error: 8000,
};

let toastCounter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (message, type, duration, action) => {
    const id = `toast-${Date.now()}-${++toastCounter}`;
    const resolvedDuration = duration ?? DEFAULT_DURATIONS[type];

    set({
      toasts: [
        ...get().toasts,
        action
          ? { id, message, type, duration: resolvedDuration, action }
          : { id, message, type, duration: resolvedDuration },
      ],
    });

    setTimeout(() => {
      get().removeToast(id);
    }, resolvedDuration);
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Convenience function to show a toast without needing the hook */
export function showToast(
  message: string,
  type: ToastType = "info",
  duration?: number,
  action?: ToastAction,
): void {
  useToastStore.getState().addToast(message, type, duration, action);
}
