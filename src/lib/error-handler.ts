import { showToast } from "../stores/toastStore";

/**
 * Consistent error handling: logs to console and shows a toast notification.
 * Use this in catch blocks across the app for uniform error reporting.
 */
export function handleError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context}]`, error);
  showToast(message, "error");
}
