import { create } from "zustand";

export type ToastType = "error" | "success" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];

  addToast: (message: string, type: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  info: 5000,
  error: 8000,
};

let toastCounter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (message, type, duration) => {
    const id = `toast-${Date.now()}-${++toastCounter}`;
    const resolvedDuration = duration ?? DEFAULT_DURATIONS[type];

    set({ toasts: [...get().toasts, { id, message, type, duration: resolvedDuration }] });

    setTimeout(() => {
      get().removeToast(id);
    }, resolvedDuration);
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Convenience function to show a toast without needing the hook */
export function showToast(message: string, type: ToastType = "info", duration?: number): void {
  useToastStore.getState().addToast(message, type, duration);
}
