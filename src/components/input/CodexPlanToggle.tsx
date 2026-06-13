import { useCallback } from "react";
import { Map } from "lucide-react";

import { useSessionStore } from "../../stores/sessionStore";
import { setCodexPlanMode } from "../../lib/tauri-commands";

/**
 * Codex "Plan" toggle pill. Mounted next to the `PolicyPill` for Codex
 * sessions (the toolbar slot where Claude's plan mode lives via
 * `ModeSelector`). Gives Codex plan-mode parity with Claude.
 *
 * Codex 0.139.0 exposes no settable `collaborationMode` over the app-server,
 * so this is CodeMantis's native approximation: toggling on flips the next
 * `turn/start` to a read-only sandbox + a planning preamble (handled in the
 * Rust `set_codex_plan_mode`). The conversation stays in native chat with the
 * full prior context; plan output renders through the existing ExitPlanMode
 * (PlanCompleteModal) flow.
 *
 * State: the session's `SessionMode` is `"plan"` while active. We flip it
 * optimistically and the backend confirms via a `codex_plan_mode_changed`
 * event (chat.ts). On IPC failure we revert.
 */
export interface CodexPlanToggleProps {
  sessionId: string;
  /** Optional override for the IPC commit (tests inject a stub). */
  commit?: (sessionId: string, enabled: boolean) => Promise<void>;
}

export default function CodexPlanToggle({
  sessionId,
  commit = setCodexPlanMode,
}: CodexPlanToggleProps): React.ReactElement {
  const mode = useSessionStore((s) => s.sessionModes.get(sessionId));
  const setSessionMode = useSessionStore((s) => s.setSessionMode);
  const active = mode === "plan";

  const handleToggle = useCallback(() => {
    const next = !active;
    // Optimistic flip; revert on IPC failure.
    setSessionMode(sessionId, next ? "plan" : "normal");
    void commit(sessionId, next).catch(() => {
      setSessionMode(sessionId, next ? "normal" : "plan");
    });
  }, [active, sessionId, setSessionMode, commit]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`flex items-center gap-1 text-label px-3 py-1 rounded-md border font-medium transition-colors ${
        active
          ? "border-yellow bg-yellow text-bg-primary shadow-sm"
          : "border-border bg-bg-elevated text-text-secondary font-normal hover:border-accent/40"
      }`}
      aria-pressed={active}
      title={
        active
          ? "Plan mode on — Codex plans (read-only) using the full conversation. Click to exit."
          : "Plan mode — Codex plans without editing files, using the full conversation."
      }
      data-testid="codex-plan-toggle"
    >
      <Map size={12} />
      <span>Plan</span>
      {active && (
        <span
          className="ml-0.5 flex items-center gap-1 rounded-sm bg-bg-primary/15 px-1 text-micro font-semibold uppercase tracking-wide"
          data-testid="codex-plan-toggle-on"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          On
        </span>
      )}
    </button>
  );
}
