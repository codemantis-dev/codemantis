import { error as logError } from "@tauri-apps/plugin-log";
import { showToast } from "../stores/toastStore";
import { translateErrorForToast } from "./error-messages";

/**
 * Consistent error handling: logs to console and shows a toast notification.
 * Use this in catch blocks across the app for uniform error reporting.
 */
export function handleError(context: string, error: unknown): void {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const toastMessage = translateErrorForToast(rawMessage);
  console.error(`[${context}]`, error);
  showToast(toastMessage, "error");
  logError(`[${context}] ${rawMessage}`).catch(() => {});
}
