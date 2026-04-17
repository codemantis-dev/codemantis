// ═══════════════════════════════════════════════════════════════════════
// Shared action: "implement the pending plan"
// Called from both PlanCompleteModal.handleImplement (Implement Now button)
// and PlanPendingBanner (Implement button on the reopen banner).
// ═══════════════════════════════════════════════════════════════════════

import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { showToast } from "../stores/toastStore";
import { sendMessage, setSessionMode } from "./tauri-commands";
import { handleError } from "./error-handler";

const IMPLEMENT_PROMPT = "Go ahead, implement the plan.";

/**
 * Implement the plan pending for `sessionId`.
 *
 * - Guards against a busy session (shows a toast, returns without sending).
 * - Optionally flips the session into auto-accept mode (matches the modal's
 *   "Enable Auto-Accept" checkbox).
 * - Adds the implement message to the chat log and sends it to the CLI.
 * - Clears the uiStore's pending-plan state via `clearPendingPlan()`.
 */
export async function implementPendingPlan(
  sessionId: string,
  autoAccept: boolean,
): Promise<void> {
  const store = useSessionStore.getState();
  const isBusy = store.sessionBusy.get(sessionId) ?? false;
  if (isBusy) {
    showToast(
      "Session is busy — wait for the current operation to finish",
      "info",
    );
    return;
  }

  // Optionally flip to auto-accept so every tool call during the
  // implementation phase is auto-approved.
  if (autoAccept) {
    store.setSessionMode(sessionId, "auto-accept");
    try {
      await setSessionMode(sessionId, "auto-accept");
    } catch (e) {
      handleError("Failed to set auto-accept mode", e);
    }
  }

  // Add the implement user message to the session.
  const msgId = `msg-plan-impl-${Date.now()}`;
  store.addMessage(sessionId, {
    id: msgId,
    role: "user",
    content: IMPLEMENT_PROMPT,
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: false,
  });
  store.setSessionBusy(sessionId, true);

  try {
    await sendMessage(sessionId, IMPLEMENT_PROMPT);
  } catch (e) {
    store.setSessionBusy(sessionId, false);
    handleError("Failed to send implementation message", e);
  }

  // Always clear pending state after dispatching (success or error — the
  // user can re-plan if the send failed; leaving the banner up would be
  // confusing since the chat message is already visible either way).
  useUiStore.getState().clearPendingPlan();
}
