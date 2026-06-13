// ═══════════════════════════════════════════════════════════════════════
// Shared action: "implement the pending plan"
// Called from both PlanCompleteModal.handleImplement (Implement Now button)
// and PlanPendingBanner (Implement button on the reopen banner).
// ═══════════════════════════════════════════════════════════════════════

import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { showToast } from "../stores/toastStore";
import { sendMessage, setSessionMode, writeFileContent } from "./tauri-commands";
import { handleError } from "./error-handler";

const IMPLEMENT_PROMPT = "Go ahead, implement the plan.";

/** `2026-06-13T08:09:10.123Z` → `20260613-080910` (filename-safe, sortable). */
function planFileTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Derive a short kebab slug from the plan's first non-empty heading/line. */
function planSlug(planContent: string): string {
  const firstLine =
    planContent
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0) ?? "plan";
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "plan";
}

/**
 * Persist a generated plan to `<project_root>/plans/`. Called on plan
 * generation (when ExitPlanMode completes) for BOTH agents — see
 * `event-handlers/activity.ts`. Fire-and-forget: failures toast but never
 * disrupt the plan flow. Reuses the `write_file_content` command, which
 * creates the `plans/` dir and canonicalizes the path.
 */
export async function persistPlanDocument(
  sessionId: string,
  planContent: string,
): Promise<void> {
  const session = useSessionStore.getState().sessions.get(sessionId);
  if (!session?.project_path) return;
  if (!planContent.trim()) return;

  const now = new Date();
  const fileName = `plan-${planFileTimestamp(now)}-${planSlug(planContent)}.md`;
  const filePath = `${session.project_path}/plans/${fileName}`;
  const agentLabel = session.agent_id === "codex" ? "Codex" : "Claude Code";
  const header =
    `# Plan — ${session.name}\n\n` +
    `- Agent: ${agentLabel}\n` +
    `- Generated: ${now.toISOString()}\n\n---\n\n`;

  try {
    await writeFileContent(filePath, header + planContent);
    showToast(`Plan saved to plans/${fileName}`, "success");
  } catch (e) {
    handleError("Failed to save plan document", e);
  }
}

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
