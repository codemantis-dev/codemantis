import { Map } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";

/**
 * Codex plan-mode banner. Mounted above the chat message list in ChatPanel.
 * Renders only while the active session is in `plan` mode (set by the Plan
 * pill / `codex_plan_mode_changed` event — see CodexPlanToggle).
 *
 * This signals CodeMantis's native plan-mode approximation: Codex runs
 * read-only and plans (over the full conversation) without editing. The plan
 * itself surfaces through the existing ExitPlanMode (PlanCompleteModal) flow.
 * Distinct from `ReviewModeBanner`, which carries review content.
 */
export default function CodexPlanModeBanner(): React.ReactElement | null {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionModes = useSessionStore((s) => s.sessionModes);
  const sessions = useSessionStore((s) => s.sessions);

  if (!activeSessionId) return null;
  const session = sessions.get(activeSessionId);
  // Plan-mode banner is Codex-only; Claude's plan state has its own surfaces.
  if (session?.agent_id !== "codex") return null;
  if (sessionModes.get(activeSessionId) !== "plan") return null;

  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-lg border border-yellow/40 bg-yellow/10 px-3 py-2"
      role="status"
      aria-label="Codex plan mode active"
    >
      <Map size={14} className="shrink-0 text-yellow" />
      <span className="text-ui font-medium text-text-primary shrink-0">
        Plan mode
      </span>
      <span className="text-label text-text-secondary">
        Codex is read-only and will propose a plan from the full conversation
        before making changes.
      </span>
    </div>
  );
}
