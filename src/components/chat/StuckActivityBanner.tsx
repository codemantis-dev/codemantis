import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";

interface StuckActivityBannerProps {
  sessionId: string;
}

/**
 * Renders a one-line warning above SessionStatusBar when the watchdog
 * (useStuckActivityWatchdog) has flagged this session as stuck. UI-only:
 * the buttons act on the user's explicit choice — Reopen approval, Stop
 * session. No auto-recovery.
 */
export default function StuckActivityBanner({ sessionId }: StuckActivityBannerProps) {
  const stuck = useSessionStore((s) => s.sessionStuck.get(sessionId));
  const agentId = useSessionStore((s) => s.sessions.get(sessionId)?.agent_id);
  const isCompacting = useSessionStore((s) => s.sessionCompacting.get(sessionId) ?? false);
  const setShowApprovalModal = useUiStore((s) => s.setShowApprovalModal);
  const { freshThreadCodexSession } = useClaudeSession();
  const [freshState, setFreshState] = useState<"idle" | "starting">("idle");
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!stuck) {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.floor((Date.now() - stuck.since) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stuck]);

  if (!stuck) return null;

  const isPendingApproval = stuck.reason === "pending-approval-not-shown";
  // The watchdog fires for any agent; the message must match the actual
  // adapter. Legacy/recovered sessions can have `agent_id` undefined — the
  // type contract is "default to claude_code" (see types/session.ts).
  const agentLabel = agentId === "codex" ? "Codex" : "Claude Code";
  // A Codex session stuck *while compacting* is the upstream-compaction hang
  // (openai/codex#17392): the remote /compact request timed out. "Stop session"
  // here revives the SAME thread → reloads the context → re-hangs, so the
  // primary action must be "Start fresh thread" instead.
  const isCompactionStuck = agentId === "codex" && isCompacting && !isPendingApproval;
  const message = isPendingApproval
    ? `${agentLabel} is waiting for your approval but the prompt isn't showing.`
    : isCompactionStuck
      ? `Codex has been compacting for ${elapsedSec}s — this can hang on a large context (a known OpenAI bug).`
      : `${agentLabel} hasn't responded for ${elapsedSec}s.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-1.5 border-t border-border bg-yellow/10 text-label"
    >
      <AlertTriangle size={14} className="text-yellow shrink-0" />
      <span className="text-yellow font-medium shrink-0">{message}</span>
      <div className="flex-1" />
      {isPendingApproval && (
        <button
          type="button"
          onClick={() => setShowApprovalModal(true)}
          className="px-2 py-0.5 rounded border border-yellow/40 text-yellow hover:bg-yellow/20"
        >
          Reopen approval
        </button>
      )}
      {/* Primary action for a hung compaction: a fresh thread (carries a recap).
          Reviving the same thread just re-loads the doomed context and re-hangs. */}
      {isCompactionStuck && (
        <button
          type="button"
          disabled={freshState === "starting"}
          onClick={async () => {
            setFreshState("starting");
            try {
              await freshThreadCodexSession(sessionId);
            } catch (e) {
              console.error("Start fresh thread failed:", e);
            } finally {
              setFreshState("idle");
            }
          }}
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          <RotateCcw size={11} />
          {freshState === "starting" ? "Starting..." : "Start fresh thread"}
        </button>
      )}
      {/* No generic "Stop session" button here anymore: stopping a busy session
          (including a wedged one) is handled by the input-area Stop button / Esc,
          which escalates a graceful interrupt to a forceful kill+respawn via
          useStopSession. This banner keeps only the two specialised recoveries
          above — reopening a lost approval and starting a fresh Codex thread. */}
    </div>
  );
}
